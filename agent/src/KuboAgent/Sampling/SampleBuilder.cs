using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace KuboAgent.Sampling;

/// <summary>
/// Arma una <see cref="AgentSample"/> con los lectores. Respeta los topes que valida la central
/// (<c>agent.dto.ts</c>) para que una muestra nunca se rechace por tamaño.
///
/// Errores del Visor de eventos: cada muestra cuenta los nuevos desde la anterior. En la primera
/// no hay referencia: <c>eventErrors</c> es 0 y la referencia pasa a ser ahora.
///
/// CPU y RAM son obligatorios en el contrato: si fallan, <see cref="Build"/> lanza y la muestra se
/// descarta. Los demás lectores degradan (lista vacía, <c>null</c> o 0) y lo registran.
/// </summary>
public sealed class SampleBuilder
{
    public const int MaxDisks = 26;
    public const int MaxIisPools = 200;
    public const int MaxServices = 50;
    public const int MaxName = 256;
    public const int MaxState = 64;

    private readonly string _agentVersion;
    private readonly ICpuReader _cpu;
    private readonly IMemoryReader _memory;
    private readonly IDiskReader _disks;
    private readonly IIisReader _iis;
    private readonly IServiceReader _services;
    private readonly IEventErrorReader _events;
    private readonly ILogger _logger;
    private DateTime? _eventsSince;
    private readonly Dictionary<string, LogThrottle> _warnings = new();

    public SampleBuilder(
        string agentVersion,
        ICpuReader cpu,
        IMemoryReader memory,
        IDiskReader disks,
        IIisReader iis,
        IServiceReader services,
        IEventErrorReader events,
        ILogger<SampleBuilder>? logger = null)
    {
        _agentVersion = agentVersion;
        _cpu = cpu;
        _memory = memory;
        _disks = disks;
        _iis = iis;
        _services = services;
        _events = events;
        _logger = (ILogger?)logger ?? NullLogger.Instance;
    }

    public AgentSample Build(IReadOnlyList<string> watchServices, DateTime nowUtc)
    {
        var cpu = Pct(_cpu.ReadPct());
        var ram = Pct(_memory.ReadPct());

        return new AgentSample(
            _agentVersion,
            cpu,
            ram,
            ReadDisks(),
            ReadIis(),
            ReadServices(watchServices),
            ReadEventErrors(nowUtc));
    }

    private IReadOnlyList<DiskSample> ReadDisks()
    {
        try
        {
            return _disks.Read()
                .Take(MaxDisks)
                .Select(d => d with { Name = Cut(d.Name, MaxName), TotalBytes = Math.Max(0, d.TotalBytes), FreeBytes = Math.Max(0, d.FreeBytes) })
                .ToList();
        }
        catch (Exception ex)
        {
            Warn("disks", ex, "No se pudo leer el espacio de las unidades.");
            return [];
        }
    }

    private IReadOnlyList<IisPoolSample>? ReadIis()
    {
        try
        {
            return _iis.Read()?
                .Where(p => !string.IsNullOrEmpty(p.Name))
                .Take(MaxIisPools)
                .Select(p => new IisPoolSample(Cut(p.Name, MaxName), Cut(p.State, MaxState)))
                .ToList();
        }
        catch (Exception ex)
        {
            Warn("iis", ex, "No se pudo leer el estado de IIS.");
            return null;
        }
    }

    private IReadOnlyList<ServiceSample> ReadServices(IReadOnlyList<string> watchServices)
    {
        var names = watchServices
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Select(n => Cut(n.Trim(), MaxName))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(MaxServices)
            .ToList();
        if (names.Count == 0) return [];
        try
        {
            return _services.Read(names)
                .Select(s => new ServiceSample(s.Name, Cut(s.Status, MaxState)))
                .ToList();
        }
        catch (Exception ex)
        {
            Warn("services", ex, "No se pudo leer el estado de los servicios de Windows.");
            return [];
        }
    }

    private EventErrorCounts ReadEventErrors(DateTime nowUtc)
    {
        if (_eventsSince is not { } since)
        {
            _eventsSince = nowUtc;
            return new EventErrorCounts(0, 0);
        }
        try
        {
            // Ventana [anterior, ahora): el límite superior es la referencia de la muestra siguiente,
            // así un evento no se cuenta en dos muestras.
            var counts = _events.CountSince(since, nowUtc);
            // Solo se avanza la referencia si se pudo contar: un fallo no pierde los errores del intervalo.
            _eventsSince = nowUtc;
            return new EventErrorCounts(Count(counts.System), Count(counts.Application));
        }
        catch (Exception ex)
        {
            Warn("events", ex, "No se pudo leer el Visor de eventos.");
            return new EventErrorCounts(0, 0);
        }
    }

    /// <summary>Un lector que falla en cada muestra se registra al empezar y luego una vez por hora.</summary>
    private void Warn(string reader, Exception ex, string message)
    {
        if (!_warnings.TryGetValue(reader, out var throttle)) _warnings[reader] = throttle = new LogThrottle();
        if (throttle.ShouldLog(ex.GetType().FullName ?? "", out var repeats))
            _logger.LogWarning(ex, "{Message}{Suffix}", message, LogThrottle.Suffix(repeats));
    }

    private static double Pct(double value) =>
        double.IsFinite(value) ? Math.Round(Math.Clamp(value, 0, 100), 1) : 0;

    private static int Count(int value) => Math.Clamp(value, 0, EventErrorReader.MaxCount);

    private static string Cut(string value, int max) => value.Length <= max ? value : value[..max];
}

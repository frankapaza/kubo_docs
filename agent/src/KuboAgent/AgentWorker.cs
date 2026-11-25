using KuboAgent.Sampling;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace KuboAgent;

/// <summary>
/// El servicio: toma una muestra y la envía, y espera con un <see cref="PeriodicTimer"/> el
/// <c>intervalSeconds</c> de la última respuesta (60 s por defecto, acotado de 30 a 600). La lista
/// <c>watchServices</c> de la última respuesta se guarda en memoria y se usa en la muestra siguiente.
///
/// No hay cola: una muestra que no se pudo enviar se descarta y queda registrada. El agente solo
/// envía datos; de la central únicamente lee la lista de servicios y el intervalo.
/// </summary>
public sealed class AgentWorker : BackgroundService
{
    public const int DefaultIntervalSeconds = 60;
    public const int MinIntervalSeconds = 30;
    public const int MaxIntervalSeconds = 600;

    /// <summary>Un mismo fallo repetido se vuelve a registrar cada tantas muestras (1 h a 60 s), no en cada una.</summary>
    public const int RepeatLogEvery = 60;

    private readonly SampleBuilder _builder;
    private readonly CentralClient _central;
    private readonly ILogger<AgentWorker> _logger;
    private readonly Func<DateTime> _utcNow;

    private int _lastStatus = -1;
    private int _repeats;
    private bool _everSent;

    public AgentWorker(SampleBuilder builder, CentralClient central, ILogger<AgentWorker> logger, Func<DateTime>? utcNow = null)
    {
        _builder = builder;
        _central = central;
        _logger = logger;
        _utcNow = utcNow ?? (() => DateTime.UtcNow);
    }

    public int IntervalSeconds { get; private set; } = DefaultIntervalSeconds;

    public IReadOnlyList<string> WatchServices { get; private set; } = [];

    public static int ClampInterval(int seconds) => Math.Clamp(seconds, MinIntervalSeconds, MaxIntervalSeconds);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Agente de KUBO {Version} iniciado. Central: {Central}.", AgentInfo.Version, _central.SamplesUri.GetLeftPart(UriPartial.Authority));

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(IntervalSeconds));
        do
        {
            await TickAsync(stoppingToken).ConfigureAwait(false);
            var period = TimeSpan.FromSeconds(IntervalSeconds);
            if (timer.Period != period) timer.Period = period;
        }
        while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false));
    }

    /// <summary>Una vuelta: muestra, envío y lectura de la respuesta. No lanza salvo por cancelación.</summary>
    public async Task TickAsync(CancellationToken cancellationToken)
    {
        AgentSample sample;
        try
        {
            var watch = WatchServices;
            // La lectura es síncrona (contadores, Visor de eventos): fuera del hilo del host.
            sample = await Task.Run(() => _builder.Build(watch, _utcNow()), cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "No se pudo tomar la muestra; se descarta y se reintenta en {Seconds} s.", IntervalSeconds);
            return;
        }

        var result = await _central.SendAsync(sample, cancellationToken).ConfigureAwait(false);
        if (result.Ok)
        {
            if (result.WatchServices is { } watch) WatchServices = watch.ToArray();
            if (result.IntervalSeconds is { } seconds) IntervalSeconds = ClampInterval(seconds);
            if (!_everSent)
            {
                _logger.LogInformation("Primera muestra aceptada por la central. Intervalo: {Seconds} s; servicios vigilados: {Count}.", IntervalSeconds, WatchServices.Count);
            }
            else if (_lastStatus != 200)
            {
                _logger.LogInformation("Se reanudó el envío de muestras a la central.");
            }
            if (result.Message is not null) _logger.LogWarning("{Message}", result.Message);
            _everSent = true;
            _lastStatus = 200;
            _repeats = 0;
            return;
        }

        // Fallo: la muestra se descarta (no hay cola). Se registra al cambiar de estado y luego cada tanto.
        if (result.Status == _lastStatus) _repeats++;
        else _repeats = 0;
        _lastStatus = result.Status;
        if (_repeats % RepeatLogEvery != 0) return;

        var suffix = _repeats == 0 ? "" : $" (se repite desde hace {_repeats} muestras)";
        if (result.Status == 401 || result.Status == 400 || result.Status == 413)
            _logger.LogError("Muestra descartada. {Message}{Suffix}", result.Message, suffix);
        else
            _logger.LogWarning("Muestra descartada. {Message}{Suffix}", result.Message, suffix);
    }
}

/// <summary>Versión del agente (la del <c>.csproj</c>), la que se envía en <c>agentVersion</c>.</summary>
public static class AgentInfo
{
    public static string Version { get; } = ReadVersion();

    private static string ReadVersion()
    {
        var info = typeof(AgentInfo).Assembly
            .GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute), false)
            .OfType<System.Reflection.AssemblyInformationalVersionAttribute>()
            .FirstOrDefault()?.InformationalVersion;
        var version = string.IsNullOrEmpty(info) ? "0.0.0" : info.Split('+')[0];
        return version.Length <= 40 ? version : version[..40];
    }
}

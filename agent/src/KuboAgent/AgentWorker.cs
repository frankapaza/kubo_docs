using System.ServiceProcess;
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
///
/// Cada problema (muestra que no se pudo tomar, rechazo de la central, respuesta ilegible) se
/// registra al aparecer y luego una vez por hora mientras siga (<see cref="LogThrottle"/>).
/// </summary>
public sealed class AgentWorker : BackgroundService
{
    public const int DefaultIntervalSeconds = 60;
    public const int MinIntervalSeconds = 30;
    public const int MaxIntervalSeconds = 600;

    private readonly SampleBuilder _builder;
    private readonly CentralClient _central;
    private readonly ILogger<AgentWorker> _logger;
    private readonly IHostApplicationLifetime? _appLifetime;
    private readonly IHostLifetime? _hostLifetime;
    private readonly Func<DateTime> _utcNow;
    private readonly LogThrottle _problems = new();
    private bool _everSent;

    public AgentWorker(
        SampleBuilder builder,
        CentralClient central,
        ILogger<AgentWorker> logger,
        IHostApplicationLifetime? appLifetime = null,
        IHostLifetime? hostLifetime = null,
        Func<DateTime>? utcNow = null)
    {
        _builder = builder;
        _central = central;
        _logger = logger;
        _appLifetime = appLifetime;
        _hostLifetime = hostLifetime;
        _utcNow = utcNow ?? (() => DateTime.UtcNow);
    }

    public int IntervalSeconds { get; private set; } = DefaultIntervalSeconds;

    public IReadOnlyList<string> WatchServices { get; private set; } = [];

    public static int ClampInterval(int seconds) => Math.Clamp(seconds, MinIntervalSeconds, MaxIntervalSeconds);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Agente de KUBO {Version} iniciado. Central: {Central}.", AgentInfo.Version, _central.SamplesUri.GetLeftPart(UriPartial.Authority));
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(IntervalSeconds));
            do
            {
                await TickAsync(stoppingToken).ConfigureAwait(false);
                var period = TimeSpan.FromSeconds(IntervalSeconds);
                if (timer.Period != period) timer.Period = period;
            }
            while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        catch (Exception ex)
        {
            // No debería pasar (TickAsync no lanza), pero si el bucle muere el servicio no puede quedar
            // «en marcha» sin enviar nada: termina con código 1 para que Windows lo trate como un fallo.
            _logger.LogCritical(ex, "El agente se detuvo por un error inesperado.");
            Environment.ExitCode = 1;
            if (_hostLifetime is ServiceBase service) service.ExitCode = 1;
            _appLifetime?.StopApplication();
        }
    }

    /// <summary>Una vuelta: muestra, envío y lectura de la respuesta. Solo lanza por cancelación.</summary>
    public async Task TickAsync(CancellationToken cancellationToken)
    {
        try
        {
            await TickCoreAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            Problem($"tick:{ex.GetType().FullName}", LogLevel.Error, ex, "Error inesperado en el envío de la muestra; se reintenta en el intervalo siguiente.");
        }
    }

    private async Task TickCoreAsync(CancellationToken cancellationToken)
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
            Problem($"sample:{ex.GetType().FullName}", LogLevel.Error, ex, "No se pudo tomar la muestra; se descarta y se reintenta en el intervalo siguiente.");
            return;
        }

        var result = await _central.SendAsync(sample, cancellationToken).ConfigureAwait(false);
        if (!result.Ok)
        {
            // Fallo: la muestra se descarta (no hay cola).
            var level = result.Status is 400 or 401 or 413 ? LogLevel.Error : LogLevel.Warning;
            Problem($"status:{result.Status}", level, null, "Muestra descartada. " + result.Message);
            return;
        }

        if (result.WatchServices is { } watchServices) WatchServices = watchServices.ToArray();
        if (result.IntervalSeconds is { } seconds) IntervalSeconds = ClampInterval(seconds);

        if (result.Message is not null)
        {
            // Aceptada, pero la respuesta no se entendió: se conservan el intervalo y los servicios previos.
            Problem("response", LogLevel.Warning, null, result.Message);
        }
        else
        {
            if (!_everSent)
                _logger.LogInformation("Primera muestra aceptada por la central. Intervalo: {Seconds} s; servicios vigilados: {Count}.", IntervalSeconds, WatchServices.Count);
            else if (_problems.Active)
                _logger.LogInformation("Se reanudó el envío normal de muestras a la central.");
            _problems.Reset();
        }
        _everSent = true;
    }

    private void Problem(string key, LogLevel level, Exception? ex, string message)
    {
        if (!_problems.ShouldLog(key, out var repeats)) return;
        _logger.Log(level, ex, "{Message}{Suffix}", message, LogThrottle.Suffix(repeats));
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

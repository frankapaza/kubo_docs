using System.Runtime.Versioning;
using KuboAgent.Sampling;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace KuboAgent;

/// <summary>
/// <c>kubo-agent.exe</c>:
/// <list type="bullet">
/// <item><c>configure --central &lt;url&gt; --token &lt;kma_…&gt;</c>: escribe <c>%ProgramData%\KUBO\Agent\agent.json</c> (lo llama <c>install-kubo-agent.ps1</c>).</item>
/// <item><c>once [servicio…]</c>: toma una muestra y la imprime en JSON; no envía nada (diagnóstico).</item>
/// <item>sin argumentos: corre como el servicio de Windows <c>KuboAgent</c>.</item>
/// </list>
/// </summary>
[SupportedOSPlatform("windows")]
public static class Program
{
    public const string ServiceName = "KuboAgent";

    public static async Task<int> Main(string[] args)
    {
        if (args.Length == 0) return await RunServiceAsync().ConfigureAwait(false);

        switch (args[0].ToLowerInvariant())
        {
            case "configure":
                return Configure(args[1..], AgentConfig.DefaultDirectory, restrictAcl: true, Console.Out, Console.Error);
            case "once":
                return Once(args[1..], Console.Out, Console.Error);
            case "--version":
            case "version":
                Console.Out.WriteLine(AgentInfo.Version);
                return 0;
            case "--help":
            case "-h":
            case "help":
            case "/?":
                Usage(Console.Out);
                return 0;
            default:
                // No se repite lo escrito: podría ser un token pegado por error.
                Console.Error.WriteLine("Orden desconocida.");
                Usage(Console.Error);
                return 2;
        }
    }

    /// <summary>
    /// <c>configure --central &lt;https://…&gt; --token &lt;kma_…&gt;</c>. Valida y escribe <c>agent.json</c>
    /// en <paramref name="configDirectory"/> (parámetro para que las pruebas usen una carpeta temporal).
    /// Devuelve 0 si lo guardó; distinto de 0 si los argumentos no sirven o no pudo escribir.
    /// </summary>
    public static int Configure(string[] args, string configDirectory, bool restrictAcl, TextWriter stdout, TextWriter stderr)
    {
        string? central = null;
        string? token = null;
        for (var i = 0; i < args.Length; i++)
        {
            var name = args[i].ToLowerInvariant();
            if ((name == "--central" || name == "--token") && i + 1 < args.Length)
            {
                if (name == "--central") central = args[++i];
                else token = args[++i];
            }
            else
            {
                // No se repite el valor: podría ser el token.
                stderr.WriteLine($"Argumento no reconocido o sin valor (posición {i + 1}).");
                stderr.WriteLine("Uso: kubo-agent configure --central <https://...> --token <kma_...>");
                return 2;
            }
        }
        if (central is null || token is null)
        {
            stderr.WriteLine("Faltan argumentos. Uso: kubo-agent configure --central <https://...> --token <kma_...>");
            return 2;
        }
        if (!AgentConfig.TryValidateCentralUrl(central, out var urlError))
        {
            stderr.WriteLine(urlError);
            return 3;
        }
        if (!AgentConfig.IsValidToken(token))
        {
            stderr.WriteLine("El token no tiene la forma de un token de agente (kma_...). Cópielo tal cual de Monitoreo > Sondas > Agentes.");
            return 4;
        }

        try
        {
            AgentConfig.Create(central, token).Save(configDirectory, restrictAcl);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Security.Cryptography.CryptographicException or InvalidOperationException)
        {
            stderr.WriteLine($"No se pudo guardar la configuración en {configDirectory}: {ex.Message}");
            return 5;
        }
        stdout.WriteLine($"Configuración guardada en {Path.Combine(configDirectory, AgentConfig.FileName)} (central {AgentConfig.NormalizeCentralUrl(central)}).");
        return 0;
    }

    /// <summary><c>once [servicio…]</c>: una muestra de este equipo, en JSON. Solo lee; no envía nada.</summary>
    public static int Once(string[] serviceNames, TextWriter stdout, TextWriter stderr)
    {
        try
        {
            using var cpu = new CpuReader();
            var builder = NewSampleBuilder(cpu, logger: null);
            var sample = builder.Build(serviceNames, DateTime.UtcNow);
            stdout.WriteLine(System.Text.Json.JsonSerializer.Serialize(sample, AgentJson.Indented));
            return 0;
        }
        catch (Exception ex)
        {
            stderr.WriteLine($"No se pudo tomar la muestra: {ex}");
            return 1;
        }
    }

    private static SampleBuilder NewSampleBuilder(CpuReader cpu, ILogger<SampleBuilder>? logger) => new(
        AgentInfo.Version,
        cpu,
        new MemoryReader(),
        new DiskReader(),
        new IisReader(),
        new ServiceReader(),
        new EventErrorReader(),
        logger);

    private static async Task<int> RunServiceAsync()
    {
        var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings
        {
            DisableDefaults = true,
            ContentRootPath = AppContext.BaseDirectory,
        });
        builder.Services.AddWindowsService(o => o.ServiceName = ServiceName);

        builder.Logging.ClearProviders();
        builder.Logging.SetMinimumLevel(LogLevel.Information);
        builder.Logging.AddFilter("Microsoft", LogLevel.Warning);
        builder.Logging.AddFilter("System", LogLevel.Warning);
        builder.Logging.AddConsole();
        var eventLogReady = EventLogSetup.TryEnsureSource(out var eventLogError);
        if (eventLogReady)
        {
            builder.Logging.AddEventLog(s =>
            {
                s.SourceName = EventLogSetup.SourceName;
                s.LogName = EventLogSetup.LogName;
            });
        }

        string? configError = null;
        AgentConfig? config = null;
        string? token = null;
        try
        {
            config = AgentConfig.Load(AgentConfig.DefaultDirectory);
            token = config.GetToken();
            if (!AgentConfig.IsValidToken(token))
            {
                throw new InvalidOperationException("El token guardado en agent.json no tiene la forma de un token de agente (kma_...). Vuelva a ejecutar el instalador.");
            }
        }
        catch (Exception ex) when (ex is InvalidOperationException or IOException or UnauthorizedAccessException or FormatException or System.Security.Cryptography.CryptographicException)
        {
            configError = ex is InvalidOperationException ? ex.Message : $"No se pudo leer la configuración del agente: {ex.Message}";
        }

        if (configError is null)
        {
            builder.Services.AddSingleton<CpuReader>();
            builder.Services.AddSingleton(sp => NewSampleBuilder(sp.GetRequiredService<CpuReader>(), sp.GetRequiredService<ILogger<SampleBuilder>>()));
            builder.Services.AddSingleton(_ => new CentralClient(config!.CentralUrl, token!, AgentInfo.Version));
            builder.Services.AddHostedService(sp => new AgentWorker(
                sp.GetRequiredService<SampleBuilder>(),
                sp.GetRequiredService<CentralClient>(),
                sp.GetRequiredService<ILogger<AgentWorker>>(),
                sp.GetRequiredService<IHostApplicationLifetime>(),
                sp.GetRequiredService<IHostLifetime>()));
        }

        using var host = builder.Build();
        var logger = host.Services.GetRequiredService<ILoggerFactory>().CreateLogger(ServiceName);
        if (!eventLogReady) logger.LogWarning("{Error}", eventLogError);
        if (configError is not null)
        {
            // Sin configuración no hay nada que hacer: se registra y el servicio termina con error
            // (el instalador configura el reinicio ante fallos).
            logger.LogError("{Error}", configError);
            return 1;
        }

        await host.RunAsync().ConfigureAwait(false);
        // AgentWorker pone ExitCode = 1 si terminó por un error inesperado.
        return Environment.ExitCode;
    }

    private static void Usage(TextWriter w)
    {
        w.WriteLine($"kubo-agent {AgentInfo.Version}: agente de servidor de KUBO Monitoreo.");
        w.WriteLine();
        w.WriteLine("  kubo-agent configure --central <https://...> --token <kma_...>");
        w.WriteLine("      Guarda la central y el token (protegido con DPAPI) en %ProgramData%\\KUBO\\Agent\\agent.json.");
        w.WriteLine("      Lo ejecuta install-kubo-agent.ps1; requiere administrador.");
        w.WriteLine("  kubo-agent once [servicio ...]");
        w.WriteLine("      Toma una muestra de este equipo y la imprime en JSON. No envía nada.");
        w.WriteLine("  kubo-agent");
        w.WriteLine("      Sin argumentos: corre como el servicio de Windows KuboAgent.");
    }
}

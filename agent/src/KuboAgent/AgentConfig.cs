using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace KuboAgent;

/// <summary>
/// <c>%ProgramData%\KUBO\Agent\agent.json</c>: <c>{ centralUrl, tokenProtected }</c>. Lo escribe
/// <c>kubo-agent configure</c> (lo llama <c>install-kubo-agent.ps1</c>) y lo lee el servicio.
/// La carpeta es un parámetro para que las pruebas usen una carpeta temporal.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed partial class AgentConfig
{
    public const string FileName = "agent.json";
    public const string TokenPrefix = "kma_";

    public string CentralUrl { get; init; } = "";
    public string TokenProtected { get; init; } = "";

    public static string DefaultDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "KUBO", "Agent");

    /// <summary>Configuración con la URL normalizada (sin barra final) y el token protegido con DPAPI.</summary>
    public static AgentConfig Create(string centralUrl, string token) => new()
    {
        CentralUrl = NormalizeCentralUrl(centralUrl),
        TokenProtected = TokenProtector.Protect(token),
    };

    public string GetToken() => TokenProtector.Unprotect(TokenProtected);

    /// <summary>
    /// Escribe <c>agent.json</c> en <paramref name="directory"/>. Con <paramref name="restrictAcl"/>
    /// la carpeta deja de heredar permisos y solo SYSTEM y Administradores la leen: DPAPI
    /// <c>LocalMachine</c> lo descifra cualquier proceso del equipo, así que el permiso del archivo
    /// es lo que protege el token. Requiere administrador (lo es el instalador).
    /// </summary>
    public void Save(string directory, bool restrictAcl)
    {
        // Una unión o enlace simbólico en la ruta (p. ej. %ProgramData%\KUBO creado antes por un usuario
        // sin privilegios) llevaría la escritura del token y el cambio de permisos a otra carpeta.
        RefuseReparsePoints(directory);
        var dir = Directory.CreateDirectory(directory);
        RefuseReparsePoints(directory);
        if (restrictAcl) RestrictToSystemAndAdministrators(dir);

        var path = Path.Combine(directory, FileName);
        if (File.Exists(path) && File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint))
        {
            throw new InvalidOperationException($"{path} es un enlace (punto de reanálisis): no se escribe la configuración ahí.");
        }
        var temp = path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(this, Sampling.AgentJson.Indented));
        File.Move(temp, path, overwrite: true);
    }

    /// <summary>Lee y valida <c>agent.json</c>; lanza <see cref="InvalidOperationException"/> con un mensaje legible si falta o no sirve.</summary>
    public static AgentConfig Load(string directory)
    {
        var path = Path.Combine(directory, FileName);
        if (!File.Exists(path))
        {
            throw new InvalidOperationException($"No existe {path}. Ejecute «kubo-agent configure --central <url> --token <token>» como administrador.");
        }
        AgentConfig? config;
        try
        {
            config = JsonSerializer.Deserialize<AgentConfig>(File.ReadAllText(path), Sampling.AgentJson.Options);
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException($"{path} no es un JSON válido: {ex.Message}", ex);
        }
        if (config is null)
        {
            throw new InvalidOperationException($"{path} está vacío.");
        }
        if (!TryValidateCentralUrl(config.CentralUrl, out var error))
        {
            throw new InvalidOperationException($"{path}: centralUrl no válida. {error}");
        }
        if (string.IsNullOrWhiteSpace(config.TokenProtected))
        {
            throw new InvalidOperationException($"{path}: falta tokenProtected.");
        }
        return config;
    }

    /// <summary>La central debe ser <c>https://</c> absoluta, sin credenciales, consulta ni fragmento.</summary>
    public static bool TryValidateCentralUrl(string? url, out string error)
    {
        error = "";
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri))
        {
            error = "La URL de la central no es una URL absoluta.";
            return false;
        }
        if (uri.Scheme != Uri.UriSchemeHttps)
        {
            error = "La URL de la central debe empezar con https:// (la validación TLS nunca se desactiva).";
            return false;
        }
        if (string.IsNullOrEmpty(uri.Host) || uri.UserInfo.Length > 0 || uri.Query.Length > 0 || uri.Fragment.Length > 0)
        {
            error = "La URL de la central no debe llevar usuario, consulta ni fragmento.";
            return false;
        }
        return true;
    }

    /// <summary>Forma del token que emite la web: <c>kma_</c> + base64url.</summary>
    public static bool IsValidToken(string? token) => token is not null && TokenShape().IsMatch(token);

    public static string NormalizeCentralUrl(string url) => url.Trim().TrimEnd('/');

    [GeneratedRegex("^kma_[A-Za-z0-9_-]{16,256}$")]
    private static partial Regex TokenShape();

    /// <summary>Rechaza la carpeta si ella o alguna carpeta existente que la contiene es un punto de reanálisis.</summary>
    internal static void RefuseReparsePoints(string directory)
    {
        for (var current = new DirectoryInfo(Path.GetFullPath(directory)); current is not null; current = current.Parent)
        {
            if (current.Exists && current.Attributes.HasFlag(FileAttributes.ReparsePoint))
            {
                throw new InvalidOperationException($"{current.FullName} es una unión o un enlace simbólico: no se escribe la configuración del agente a través de ella.");
            }
        }
    }

    private static void RestrictToSystemAndAdministrators(DirectoryInfo dir)
    {
        var security = new DirectorySecurity();
        // Dueño Administradores: quien creó la carpeta antes (si no era administrador) deja de poder cambiar sus permisos.
        security.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        foreach (var sid in new[] { WellKnownSidType.LocalSystemSid, WellKnownSidType.BuiltinAdministratorsSid })
        {
            security.AddAccessRule(new FileSystemAccessRule(
                new SecurityIdentifier(sid, null),
                FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None,
                AccessControlType.Allow));
        }
        dir.SetAccessControl(security);
    }
}

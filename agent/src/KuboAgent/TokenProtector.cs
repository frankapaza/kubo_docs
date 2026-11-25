using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;

namespace KuboAgent;

/// <summary>
/// Protege el token con DPAPI <c>LocalMachine</c> y lo codifica en base64. Con ese alcance lo
/// descifra cualquier proceso del equipo: por eso <c>configure</c> además restringe el acceso a
/// <c>agent.json</c> a SYSTEM y Administradores (ver <see cref="AgentConfig.Save"/>). Lo que se
/// evita es que el token quede en claro en el disco o en una copia de respaldo de otro equipo.
/// </summary>
[SupportedOSPlatform("windows")]
public static class TokenProtector
{
    /// <summary>Entropía fija: un blob de otra aplicación del equipo no se descifra como token del agente.</summary>
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("KUBO.Agent.v1");

    public static string Protect(string token)
    {
        var data = ProtectedData.Protect(Encoding.UTF8.GetBytes(token), Entropy, DataProtectionScope.LocalMachine);
        return Convert.ToBase64String(data);
    }

    public static string Unprotect(string tokenProtected)
    {
        var data = ProtectedData.Unprotect(Convert.FromBase64String(tokenProtected), Entropy, DataProtectionScope.LocalMachine);
        return Encoding.UTF8.GetString(data);
    }
}

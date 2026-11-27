using System.Diagnostics;
using System.Security;

namespace KuboAgent;

/// <summary>
/// Origen <c>KuboAgent</c> del Visor de eventos (registro Application). Crear un origen exige
/// administrador: el servicio corre como LocalSystem y lo crea la primera vez. Si no existe y no
/// se puede crear (p. ej. el ejecutable corre sin elevar), el agente sigue sin registro en el Visor
/// de eventos en lugar de caerse.
/// </summary>
public static class EventLogSetup
{
    public const string SourceName = "KuboAgent";
    public const string LogName = "Application";

    /// <summary>Con las funciones reales de <see cref="EventLog"/>.</summary>
    public static bool TryEnsureSource(out string? error) =>
        TryEnsureSource(EventLog.SourceExists, name => EventLog.CreateEventSource(name, LogName), out error);

    /// <summary>
    /// <c>true</c> si el origen existe o se pudo crear. Nunca lanza: <c>SourceExists</c> también
    /// falla sin administrador (recorre el registro Security buscando el origen).
    /// </summary>
    public static bool TryEnsureSource(Func<string, bool> exists, Action<string> create, out string? error)
    {
        error = null;
        try
        {
            if (exists(SourceName)) return true;
            create(SourceName);
            return true;
        }
        catch (Exception ex) when (ex is SecurityException or UnauthorizedAccessException or InvalidOperationException or ArgumentException or IOException)
        {
            error = $"No se pudo crear el origen «{SourceName}» del Visor de eventos ({ex.GetType().Name}: {ex.Message}). Se necesita administrador; el agente sigue sin registrar en el Visor de eventos.";
            return false;
        }
    }
}

namespace KuboAgent;

/// <summary>
/// Evita llenar el Visor de eventos con el mismo problema en cada muestra: un problema se
/// registra la primera vez que aparece (o cuando cambia) y luego una vez cada
/// <see cref="Every"/> repeticiones (≈1 h a 60 s por muestra).
/// </summary>
public sealed class LogThrottle
{
    public const int Every = 60;

    private string? _lastKey;
    private int _repeats;

    /// <summary>
    /// <c>true</c> si este problema se debe registrar ahora; <paramref name="repeats"/> dice cuántas
    /// veces seguidas se repitió antes (0 la primera vez).
    /// </summary>
    public bool ShouldLog(string key, out int repeats)
    {
        if (key == _lastKey) _repeats++;
        else
        {
            _lastKey = key;
            _repeats = 0;
        }
        repeats = _repeats;
        return _repeats % Every == 0;
    }

    /// <summary>El problema se resolvió: la próxima vez que aparezca se registra de inmediato.</summary>
    public void Reset()
    {
        _lastKey = null;
        _repeats = 0;
    }

    /// <summary>Hubo un problema antes del último <see cref="Reset"/>.</summary>
    public bool Active => _lastKey is not null;

    public static string Suffix(int repeats) => repeats == 0 ? "" : $" (se repite desde hace {repeats} muestras)";
}

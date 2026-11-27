using System.Diagnostics;

namespace KuboAgent.Sampling;

/// <summary>
/// <c>Processor / % Processor Time / _Total</c>. La primera lectura de un contador de
/// porcentaje siempre da 0: se descarta y se espera un segundo antes de la primera real.
/// Las siguientes miden el uso promedio desde la lectura anterior (el intervalo de envío).
/// </summary>
public sealed class CpuReader : ICpuReader, IDisposable
{
    private readonly PerformanceCounter _counter = new("Processor", "% Processor Time", "_Total", readOnly: true);
    private bool _primed;

    public double ReadPct()
    {
        if (!_primed)
        {
            _counter.NextValue();
            _primed = true;
            Thread.Sleep(TimeSpan.FromSeconds(1));
        }
        return _counter.NextValue();
    }

    public void Dispose() => _counter.Dispose();
}

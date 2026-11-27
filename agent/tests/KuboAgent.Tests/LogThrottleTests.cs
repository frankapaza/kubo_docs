namespace KuboAgent.Tests;

public class LogThrottleTests
{
    [Fact]
    public void Registra_la_primera_vez_y_luego_cada_60_repeticiones()
    {
        var throttle = new LogThrottle();

        var logged = Enumerable.Range(0, 130).Where(_ => throttle.ShouldLog("x", out _)).Count();

        Assert.Equal(3, logged); // repeticiones 0, 60 y 120
    }

    [Fact]
    public void Un_problema_distinto_o_un_reset_se_registra_de_inmediato()
    {
        var throttle = new LogThrottle();
        Assert.True(throttle.ShouldLog("a", out _));
        Assert.False(throttle.ShouldLog("a", out _));
        Assert.True(throttle.ShouldLog("b", out _));
        throttle.Reset();
        Assert.False(throttle.Active);
        Assert.True(throttle.ShouldLog("b", out var repeats));
        Assert.Equal(0, repeats);
    }
}

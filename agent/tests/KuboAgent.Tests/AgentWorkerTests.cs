using System.Net;
using KuboAgent.Sampling;
using Microsoft.Extensions.Logging.Abstractions;

namespace KuboAgent.Tests;

public class AgentWorkerTests
{
    private static (AgentWorker Worker, FakeHandler Handler, FakeServices Services) Worker(ICpuReader? cpu = null)
    {
        var handler = new FakeHandler();
        var services = new FakeServices();
        var builder = new SampleBuilder("1.0.0", cpu ?? new FakeCpu(10), new FakeMemory(20), new FakeDisks(), new FakeIis(null), services, new FakeEvents(0, 0));
        var central = new CentralClient(handler, "https://central.example.test", "kma_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1.0.0");
        return (new AgentWorker(builder, central, NullLogger<AgentWorker>.Instance), handler, services);
    }

    [Fact]
    public async Task Usa_el_intervalo_y_los_servicios_de_la_ultima_respuesta()
    {
        var (worker, handler, services) = Worker();
        handler.Respond = _ => FakeHandler.Json(HttpStatusCode.OK, """{"watchServices":["W3SVC"],"intervalSeconds":120}""");

        Assert.Equal(60, worker.IntervalSeconds);
        await worker.TickAsync(CancellationToken.None);
        Assert.Equal(120, worker.IntervalSeconds);
        Assert.Equal(["W3SVC"], worker.WatchServices);
        Assert.Empty(services.Calls);

        await worker.TickAsync(CancellationToken.None);
        Assert.Equal(["W3SVC"], Assert.Single(services.Calls));
        Assert.Contains("\"services\":[{\"name\":\"W3SVC\",\"status\":\"Running\"}]", handler.Requests[1].Body);
    }

    [Theory]
    [InlineData(5, 30)]
    [InlineData(30, 30)]
    [InlineData(300, 300)]
    [InlineData(9999, 600)]
    public async Task El_intervalo_queda_entre_30_y_600(int received, int expected)
    {
        var (worker, handler, _) = Worker();
        handler.Respond = _ => FakeHandler.Json(HttpStatusCode.OK, $$"""{"watchServices":[],"intervalSeconds":{{received}}}""");

        await worker.TickAsync(CancellationToken.None);

        Assert.Equal(expected, worker.IntervalSeconds);
    }

    [Fact]
    public async Task Un_401_conserva_los_valores_anteriores_y_sigue()
    {
        var (worker, handler, _) = Worker();
        handler.Respond = _ => FakeHandler.Json(HttpStatusCode.OK, """{"watchServices":["W3SVC"],"intervalSeconds":90}""");
        await worker.TickAsync(CancellationToken.None);

        handler.Respond = _ => FakeHandler.Json(HttpStatusCode.Unauthorized, "{}");
        await worker.TickAsync(CancellationToken.None);
        await worker.TickAsync(CancellationToken.None);

        Assert.Equal(90, worker.IntervalSeconds);
        Assert.Equal(["W3SVC"], worker.WatchServices);
        Assert.Equal(3, handler.Requests.Count);
    }

    [Fact]
    public async Task Si_la_muestra_falla_no_envia_ni_lanza()
    {
        var (worker, handler, _) = Worker(new ThrowingCpu());

        await worker.TickAsync(CancellationToken.None);

        Assert.Empty(handler.Requests);
    }

    private sealed class ThrowingCpu : ICpuReader
    {
        public double ReadPct() => throw new InvalidOperationException("sin contador");
    }
}

using KuboAgent.Sampling;

namespace KuboAgent.Tests;

public class SampleBuilderTests
{
    private static readonly DateTime T0 = new(2026, 11, 24, 15, 0, 0, DateTimeKind.Utc);

    private static SampleBuilder Builder(
        FakeCpu? cpu = null,
        IIisReader? iis = null,
        FakeDisks? disks = null,
        FakeServices? services = null,
        FakeEvents? events = null) => new(
        "1.0.0",
        cpu ?? new FakeCpu(12.54),
        new FakeMemory(61.2),
        disks ?? new FakeDisks(new DiskSample("C:", 107374182400, 9663676416)),
        iis ?? new FakeIis(null),
        services ?? new FakeServices(),
        events ?? new FakeEvents(0, 3));

    [Fact]
    public void Produce_el_json_exacto_del_contrato_con_iisPools_null_sin_IIS()
    {
        var sample = Builder().Build(["W3SVC"], T0);

        Assert.Equal(
            """{"agentVersion":"1.0.0","cpuPct":12.5,"ramPct":61.2,"disks":[{"name":"C:","totalBytes":107374182400,"freeBytes":9663676416}],"iisPools":null,"services":[{"name":"W3SVC","status":"Running"}],"eventErrors":{"system":0,"application":0}}""",
            AgentJson.Serialize(sample));
    }

    [Fact]
    public void Con_IIS_lista_los_grupos_de_aplicaciones_con_su_estado()
    {
        var iis = new FakeIis([new IisPoolSample("DefaultAppPool", "Started"), new IisPoolSample("Api", "Stopped")]);

        var json = AgentJson.Serialize(Builder(iis: iis).Build([], T0));

        Assert.Contains("""
            "iisPools":[{"name":"DefaultAppPool","state":"Started"},{"name":"Api","state":"Stopped"}]
            """.Trim(), json);
        Assert.Contains("\"services\":[]", json);
    }

    [Fact]
    public void Primera_muestra_da_cero_errores_y_la_siguiente_cuenta_desde_la_anterior()
    {
        var events = new FakeEvents(2, 5);
        var builder = Builder(events: events);

        var first = builder.Build([], T0);
        var second = builder.Build([], T0.AddSeconds(60));
        var third = builder.Build([], T0.AddSeconds(120));

        Assert.Equal(new EventErrorCounts(0, 0), first.EventErrors);
        Assert.Equal(new EventErrorCounts(2, 5), second.EventErrors);
        Assert.Equal(new EventErrorCounts(2, 5), third.EventErrors);
        // La primera no consulta: solo fija la referencia. Cada consulta parte de la muestra anterior.
        Assert.Equal([T0, T0.AddSeconds(60)], events.Since);
    }

    [Fact]
    public void Si_el_visor_de_eventos_falla_da_cero_y_no_pierde_el_intervalo()
    {
        var events = new FakeEvents(1, 1);
        var builder = Builder(events: events);
        builder.Build([], T0);

        events.Throw = new InvalidOperationException("sin acceso");
        Assert.Equal(new EventErrorCounts(0, 0), builder.Build([], T0.AddSeconds(60)).EventErrors);

        events.Throw = null;
        builder.Build([], T0.AddSeconds(120));
        Assert.Equal(T0, events.Since[^1]);
    }

    [Fact]
    public void Respeta_los_topes_del_contrato()
    {
        var disks = new FakeDisks(Enumerable.Range(0, 30).Select(i => new DiskSample($"D{i}:", 10, 5)).ToArray());
        var pools = Enumerable.Range(0, 250).Select(i => new IisPoolSample($"p{i}", new string('s', 100))).ToList();
        var names = Enumerable.Range(0, 60).Select(i => $"svc{i}").Append(new string('x', 300)).ToList();

        var sample = Builder(cpu: new FakeCpu(150), disks: disks, iis: new FakeIis(pools)).Build(names, T0);

        Assert.Equal(100, sample.CpuPct);
        Assert.Equal(26, sample.Disks.Count);
        Assert.Equal(200, sample.IisPools!.Count);
        Assert.All(sample.IisPools, p => Assert.Equal(64, p.State.Length));
        Assert.Equal(50, sample.Services.Count);
    }

    [Fact]
    public void Corta_nombres_largos_y_omite_servicios_vacios_o_repetidos()
    {
        var services = new FakeServices();
        var sample = Builder(services: services).Build([new string('x', 300), " ", "W3SVC", "w3svc"], T0);

        Assert.Equal([new string('x', 256), "W3SVC"], sample.Services.Select(s => s.Name));
    }

    [Fact]
    public void Cpu_no_numerica_da_cero_y_un_lector_de_discos_roto_da_lista_vacia()
    {
        var disks = new FakeDisks { Throw = new IOException("roto") };

        var sample = Builder(cpu: new FakeCpu(double.NaN), disks: disks).Build([], T0);

        Assert.Equal(0, sample.CpuPct);
        Assert.Empty(sample.Disks);
    }

    [Fact]
    public void Si_la_cpu_falla_la_muestra_no_se_arma()
    {
        Assert.Throws<InvalidOperationException>(() =>
            new SampleBuilder("1.0.0", new ThrowingCpu(), new FakeMemory(1), new FakeDisks(), new FakeIis(null), new FakeServices(), new FakeEvents(0, 0))
                .Build([], T0));
    }

    [Fact]
    public void La_consulta_xpath_es_la_del_contrato()
    {
        Assert.Equal(
            "*[System[(Level=1 or Level=2) and TimeCreated[@SystemTime>='2026-11-24T15:00:00.000Z']]]",
            EventErrorReader.Query(T0));
    }

    private sealed class ThrowingCpu : ICpuReader
    {
        public double ReadPct() => throw new InvalidOperationException("sin contador");
    }
}

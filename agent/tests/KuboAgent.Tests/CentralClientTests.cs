using System.Net;
using KuboAgent.Sampling;

namespace KuboAgent.Tests;

public class CentralClientTests
{
    private const string Token = "kma_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    private static readonly AgentSample Sample = new(
        "1.0.0", 12.5, 61.2,
        [new DiskSample("C:", 100, 50)],
        null,
        [new ServiceSample("W3SVC", "Running")],
        new EventErrorCounts(0, 3));

    private static (CentralClient Client, FakeHandler Handler) Client(string central = "https://central.example.test")
    {
        var handler = new FakeHandler();
        return (new CentralClient(handler, central, Token, "1.0.0"), handler);
    }

    [Fact]
    public async Task Envia_post_con_bearer_y_json_a_la_ruta_del_contrato()
    {
        var (client, handler) = Client("https://central.example.test/");

        await client.SendAsync(Sample);

        var (request, body, contentType) = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://central.example.test/api/v1/ingest/probe/agent/samples", request.RequestUri!.ToString());
        Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
        Assert.Equal(Token, request.Headers.Authorization.Parameter);
        Assert.Equal("application/json", contentType);
        Assert.Equal(AgentJson.Serialize(Sample), body);
        Assert.Contains("\"iisPools\":null", body);
    }

    [Fact]
    public void Espera_15_segundos_como_maximo()
    {
        Assert.Equal(TimeSpan.FromSeconds(15), Client().Client.HttpTimeout);
    }

    [Fact]
    public async Task Con_200_lee_watchServices_e_intervalSeconds()
    {
        var (client, handler) = Client();
        handler.Respond = _ => FakeHandler.Json(HttpStatusCode.OK, """{"watchServices":["W3SVC","MSSQLSERVER"],"intervalSeconds":120}""");

        var result = await client.SendAsync(Sample);

        Assert.True(result.Ok);
        Assert.Equal(200, result.Status);
        Assert.Equal(["W3SVC", "MSSQLSERVER"], result.WatchServices);
        Assert.Equal(120, result.IntervalSeconds);
    }

    [Fact]
    public async Task Con_401_devuelve_ok_false_sin_lanzar()
    {
        var (client, handler) = Client();
        handler.Respond = _ => FakeHandler.Json(HttpStatusCode.Unauthorized, """{"statusCode":401,"code":"UNAUTHORIZED","message":"Token de agente inválido o revocado."}""");

        var result = await client.SendAsync(Sample);

        Assert.False(result.Ok);
        Assert.Equal(401, result.Status);
        Assert.Null(result.WatchServices);
        Assert.Contains("Token inválido o revocado", result.Message);
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.RequestEntityTooLarge)]
    [InlineData(HttpStatusCode.InternalServerError)]
    public async Task Otros_rechazos_devuelven_ok_false_con_el_codigo(HttpStatusCode status)
    {
        var (client, handler) = Client();
        handler.Respond = _ =>
        {
            var r = FakeHandler.Json(status, """{"code":"X"}""");
            if (status == HttpStatusCode.TooManyRequests) r.Headers.Add("Retry-After", "12");
            return r;
        };

        var result = await client.SendAsync(Sample);

        Assert.False(result.Ok);
        Assert.Equal((int)status, result.Status);
        Assert.False(string.IsNullOrEmpty(result.Message));
    }

    [Fact]
    public async Task Sin_conexion_devuelve_estado_0_sin_lanzar()
    {
        var (client, handler) = Client();
        handler.Respond = _ => throw new HttpRequestException("No se puede establecer una conexión");

        var result = await client.SendAsync(Sample);

        Assert.False(result.Ok);
        Assert.Equal(0, result.Status);
    }

    [Fact]
    public async Task Con_200_y_cuerpo_raro_acepta_sin_cambiar_valores()
    {
        var (client, handler) = Client();
        handler.Respond = _ => FakeHandler.Json(HttpStatusCode.OK, "no es json");

        var result = await client.SendAsync(Sample);

        Assert.True(result.Ok);
        Assert.Null(result.WatchServices);
        Assert.Null(result.IntervalSeconds);
    }
}

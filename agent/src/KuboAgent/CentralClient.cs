using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using KuboAgent.Sampling;

namespace KuboAgent;

/// <summary>
/// Resultado de un envío. <see cref="Status"/> es el código HTTP, o 0 si no hubo respuesta
/// (red, DNS, TLS o el tiempo de espera). <see cref="Message"/> es lo que se registra si falló.
/// </summary>
public sealed record SendResult(bool Ok, IReadOnlyList<string>? WatchServices, int? IntervalSeconds, int Status, string? Message = null);

/// <summary>
/// Envía las muestras a la central: <c>POST {central}/api/v1/ingest/probe/agent/samples</c> con
/// <c>Authorization: Bearer kma_…</c>. Nunca lanza por un fallo de envío: lo devuelve en
/// <see cref="SendResult"/> y el trabajador decide. La validación TLS es la de .NET por defecto
/// (no hay <c>ServerCertificateCustomValidationCallback</c>).
/// </summary>
public sealed class CentralClient : IDisposable
{
    public const string SamplesPath = "/api/v1/ingest/probe/agent/samples";
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(15);

    private readonly HttpClient _http;
    private readonly Uri _samplesUri;
    private readonly string _token;

    public CentralClient(string centralUrl, string token, string agentVersion)
        : this(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(10) }, centralUrl, token, agentVersion)
    {
    }

    /// <summary>Con un <see cref="HttpMessageHandler"/> propio: lo usan las pruebas.</summary>
    public CentralClient(HttpMessageHandler handler, string centralUrl, string token, string agentVersion)
    {
        _http = new HttpClient(handler, disposeHandler: true) { Timeout = Timeout };
        _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("kubo-agent", agentVersion));
        _samplesUri = new Uri(AgentConfig.NormalizeCentralUrl(centralUrl) + SamplesPath);
        _token = token;
    }

    public Uri SamplesUri => _samplesUri;

    public TimeSpan HttpTimeout => _http.Timeout;

    public async Task<SendResult> SendAsync(AgentSample sample, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, _samplesUri)
        {
            Content = new StringContent(AgentJson.Serialize(sample), Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Failed(0, $"La central no respondió en {Timeout.TotalSeconds:0} s.");
        }
        catch (HttpRequestException ex)
        {
            return Failed(0, $"No se pudo conectar con la central: {ex.Message}");
        }

        using (response)
        {
            var status = (int)response.StatusCode;
            switch (response.StatusCode)
            {
                case HttpStatusCode.OK:
                    return await ReadOkAsync(response, cancellationToken).ConfigureAwait(false);
                case HttpStatusCode.Unauthorized:
                    return Failed(status, "Token inválido o revocado: la central respondió 401. Genere un token nuevo en Monitoreo → Sondas → Agentes y vuelva a instalar.");
                case HttpStatusCode.TooManyRequests:
                    return Failed(status, "La central limitó el envío (429): se espera al intervalo siguiente.");
                case HttpStatusCode.BadRequest:
                    return Failed(status, "La central rechazó la muestra (400 BAD_INPUT): " + await Excerpt(response, cancellationToken).ConfigureAwait(false));
                case HttpStatusCode.RequestEntityTooLarge:
                    return Failed(status, "La central rechazó la muestra por tamaño (413, más de 64 KB).");
                default:
                    return Failed(status, $"La central respondió {status}: " + await Excerpt(response, cancellationToken).ConfigureAwait(false));
            }
        }
    }

    private static async Task<SendResult> ReadOkAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            var body = await JsonSerializer.DeserializeAsync<AgentSampleResponse>(stream, AgentJson.Options, cancellationToken).ConfigureAwait(false);
            return new SendResult(true, body?.WatchServices, body?.IntervalSeconds, 200);
        }
        catch (JsonException)
        {
            // La muestra se aceptó; solo no se entiende la respuesta: se mantienen los valores previos.
            return new SendResult(true, null, null, 200, "La central aceptó la muestra pero su respuesta no es el JSON esperado.");
        }
    }

    private static async Task<string> Excerpt(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            return text.Length <= 500 ? text : text[..500] + "…";
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException)
        {
            return "(sin cuerpo)";
        }
    }

    private static SendResult Failed(int status, string message) => new(false, null, null, status, message);

    public void Dispose() => _http.Dispose();
}

using System.Net;
using KuboAgent.Sampling;

namespace KuboAgent.Tests;

internal sealed class FakeCpu(double value) : ICpuReader
{
    public double Value { get; set; } = value;
    public double ReadPct() => Value;
}

internal sealed class FakeMemory(double value) : IMemoryReader
{
    public double ReadPct() => value;
}

internal sealed class FakeDisks(params DiskSample[] disks) : IDiskReader
{
    public Exception? Throw { get; set; }
    public IReadOnlyList<DiskSample> Read() => Throw is null ? disks : throw Throw;
}

internal sealed class FakeIis(IReadOnlyList<IisPoolSample>? pools) : IIisReader
{
    public IReadOnlyList<IisPoolSample>? Read() => pools;
}

/// <summary>Responde <c>Running</c> para todo nombre salvo los de <see cref="Missing"/>.</summary>
internal sealed class FakeServices : IServiceReader
{
    public HashSet<string> Missing { get; } = new(StringComparer.OrdinalIgnoreCase);
    public List<IReadOnlyList<string>> Calls { get; } = [];

    public IReadOnlyList<ServiceSample> Read(IReadOnlyList<string> names)
    {
        Calls.Add(names);
        return names.Select(n => new ServiceSample(n, Missing.Contains(n) ? "NotFound" : "Running")).ToList();
    }
}

internal sealed class FakeEvents(int system, int application) : IEventErrorReader
{
    public List<DateTime> Since { get; } = [];
    public Exception? Throw { get; set; }

    public EventErrorCounts CountSince(DateTime utc)
    {
        Since.Add(utc);
        if (Throw is not null) throw Throw;
        return new EventErrorCounts(system, application);
    }
}

/// <summary>Guarda cada petición (con su cuerpo ya leído) y responde con <see cref="Respond"/>.</summary>
internal sealed class FakeHandler : HttpMessageHandler
{
    public List<(HttpRequestMessage Request, string Body, string? ContentType)> Requests { get; } = [];
    public Func<HttpRequestMessage, HttpResponseMessage> Respond { get; set; } = _ => Json(HttpStatusCode.OK, """{"watchServices":[],"intervalSeconds":60}""");

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
        Requests.Add((request, body, request.Content?.Headers.ContentType?.MediaType));
        return Respond(request);
    }

    public static HttpResponseMessage Json(HttpStatusCode status, string json) => new(status)
    {
        Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json"),
    };
}

/// <summary>Carpeta temporal propia de cada prueba; se borra al terminar.</summary>
internal sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "kubo-agent-tests", Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { if (Directory.Exists(Path)) Directory.Delete(Path, recursive: true); } catch (IOException) { }
    }
}

/// <summary>Prueba solo para Windows (DPAPI, servicios): fuera de Windows se marca como omitida.</summary>
internal sealed class WindowsFactAttribute : FactAttribute
{
    public WindowsFactAttribute()
    {
        if (!OperatingSystem.IsWindows()) Skip = "Solo Windows.";
    }
}

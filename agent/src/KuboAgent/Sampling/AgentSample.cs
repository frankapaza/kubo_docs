using System.Text.Json;

namespace KuboAgent.Sampling;

/// <summary>
/// Una muestra del agente: el cuerpo de <c>POST /api/v1/ingest/probe/agent/samples</c>
/// (contrato de la Task 5, ver <c>backend/src/modules/availability/dto/agent.dto.ts</c>).
/// El orden de las propiedades es el del contrato.
/// </summary>
public sealed record AgentSample(
    string AgentVersion,
    double CpuPct,
    double RamPct,
    IReadOnlyList<DiskSample> Disks,
    IReadOnlyList<IisPoolSample>? IisPools,
    IReadOnlyList<ServiceSample> Services,
    EventErrorCounts EventErrors);

public sealed record DiskSample(string Name, long TotalBytes, long FreeBytes);

public sealed record IisPoolSample(string Name, string State);

public sealed record ServiceSample(string Name, string Status);

public sealed record EventErrorCounts(int System, int Application);

/// <summary>Respuesta 200 de la central.</summary>
public sealed record AgentSampleResponse(IReadOnlyList<string>? WatchServices, int? IntervalSeconds);

/// <summary>JSON en camelCase, con <c>null</c> explícito (p. ej. <c>iisPools: null</c> sin IIS).</summary>
public static class AgentJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    public static readonly JsonSerializerOptions Indented = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public static string Serialize(AgentSample sample) => JsonSerializer.Serialize(sample, Options);
}

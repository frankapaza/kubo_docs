using System.ServiceProcess;

namespace KuboAgent.Sampling;

/// <summary>
/// Estado de cada servicio pedido por la central (<c>watchServices</c>) con <c>ServiceController</c>:
/// <c>Running</c>, <c>Stopped</c>, <c>StartPending</c>…; uno inexistente da <c>"NotFound"</c>.
/// </summary>
public sealed class ServiceReader : IServiceReader
{
    public const string NotFound = "NotFound";

    public IReadOnlyList<ServiceSample> Read(IReadOnlyList<string> names)
    {
        var result = new List<ServiceSample>(names.Count);
        foreach (var name in names)
        {
            result.Add(new ServiceSample(name, StatusOf(name)));
        }
        return result;
    }

    private static string StatusOf(string name)
    {
        try
        {
            using var controller = new ServiceController(name);
            return controller.Status.ToString();
        }
        catch (InvalidOperationException)
        {
            // No existe (o no se puede abrir) un servicio con ese nombre.
            return NotFound;
        }
        catch (ArgumentException)
        {
            // Nombre no válido para el administrador de servicios (vacío, con '\'…).
            return NotFound;
        }
    }
}

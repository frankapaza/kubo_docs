using System.Runtime.InteropServices;
using Microsoft.Web.Administration;

namespace KuboAgent.Sampling;

/// <summary>
/// <c>ServerManager.ApplicationPools</c>. Devuelve <c>null</c> (la central lo toma como «sin IIS»)
/// si IIS no está instalado o si la lectura lanza <c>COMException</c> o <c>FileNotFoundException</c>.
/// También si falta permiso (<c>UnauthorizedAccessException</c>): pasa al correr <c>once</c> sin
/// elevar; el servicio corre como LocalSystem (decisión 4) y sí puede leerlo.
/// </summary>
public sealed class IisReader : IIisReader
{
    private static readonly string ApplicationHostConfig = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.System), "inetsrv", "config", "applicationHost.config");

    public IReadOnlyList<IisPoolSample>? Read()
    {
        if (!File.Exists(ApplicationHostConfig)) return null;
        try
        {
            using var manager = new ServerManager();
            var pools = new List<IisPoolSample>();
            foreach (var pool in manager.ApplicationPools)
            {
                pools.Add(new IisPoolSample(pool.Name, PoolState(pool)));
            }
            return pools;
        }
        catch (COMException)
        {
            return null;
        }
        catch (FileNotFoundException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>El estado lo da el servicio WAS: si está detenido, leerlo lanza y se informa <c>Unknown</c>.</summary>
    private static string PoolState(ApplicationPool pool)
    {
        try
        {
            return pool.State.ToString();
        }
        catch (COMException)
        {
            return nameof(ObjectState.Unknown);
        }
    }
}

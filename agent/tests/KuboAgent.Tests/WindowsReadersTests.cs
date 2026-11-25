using System.Runtime.Versioning;
using System.Security;
using KuboAgent.Sampling;

namespace KuboAgent.Tests;

[SupportedOSPlatform("windows")]
public class WindowsReadersTests
{
    [WindowsFact]
    public void Un_servicio_inexistente_da_NotFound()
    {
        var result = new ServiceReader().Read(["KuboServicioQueNoExiste_7f3a"]);

        Assert.Equal(new ServiceSample("KuboServicioQueNoExiste_7f3a", "NotFound"), Assert.Single(result));
    }

    [WindowsFact]
    public void El_visor_de_eventos_se_consulta_con_la_xpath_sin_fallar()
    {
        // Solo lectura: cuenta los errores del último día en System y Application de esta PC.
        var counts = new EventErrorReader().CountSince(DateTime.UtcNow.AddDays(-1));

        Assert.InRange(counts.System, 0, EventErrorReader.MaxCount);
        Assert.InRange(counts.Application, 0, EventErrorReader.MaxCount);
    }

    [WindowsFact]
    public void Leer_IIS_no_lanza_aunque_no_este_instalado_o_falte_permiso()
    {
        var pools = new IisReader().Read();

        if (pools is not null) Assert.All(pools, p => Assert.False(string.IsNullOrEmpty(p.Name)));
    }

    [Fact]
    public void Sin_permiso_para_crear_el_origen_del_visor_de_eventos_no_se_cae()
    {
        var created = false;
        var ok = EventLogSetup.TryEnsureSource(
            _ => throw new SecurityException("Requested registry access is not allowed."),
            _ => created = true,
            out var error);

        Assert.False(ok);
        Assert.False(created);
        Assert.Contains("KuboAgent", error);
    }

    [Fact]
    public void Si_el_origen_no_existe_y_crearlo_falla_sigue_sin_visor_de_eventos()
    {
        var ok = EventLogSetup.TryEnsureSource(_ => false, _ => throw new UnauthorizedAccessException(), out var error);

        Assert.False(ok);
        Assert.NotNull(error);
    }

    [Fact]
    public void Si_el_origen_existe_no_lo_crea_y_si_falta_lo_crea()
    {
        var created = new List<string>();

        Assert.True(EventLogSetup.TryEnsureSource(_ => true, created.Add, out _));
        Assert.Empty(created);

        Assert.True(EventLogSetup.TryEnsureSource(_ => false, created.Add, out var error));
        Assert.Equal(["KuboAgent"], created);
        Assert.Null(error);
    }
}

using System.Runtime.Versioning;

namespace KuboAgent.Tests;

/// <summary><c>kubo-agent configure</c> contra una carpeta temporal (nunca %ProgramData% de esta PC).</summary>
[SupportedOSPlatform("windows")]
public class ConfigureCommandTests
{
    private const string Token = "kma_Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWpr";

    private static (int Code, string Out, string Err) Run(string dir, params string[] args)
    {
        var stdout = new StringWriter();
        var stderr = new StringWriter();
        var code = Program.Configure(args, dir, restrictAcl: false, stdout, stderr);
        return (code, stdout.ToString(), stderr.ToString());
    }

    [WindowsFact]
    public void Con_http_termina_con_codigo_distinto_de_0_y_no_escribe()
    {
        using var dir = new TempDir();

        var (code, _, err) = Run(dir.Path, "--central", "http://central.example.test", "--token", Token);

        Assert.NotEqual(0, code);
        Assert.Contains("https://", err);
        Assert.False(File.Exists(Path.Combine(dir.Path, AgentConfig.FileName)));
    }

    [WindowsFact]
    public void Con_token_sin_kma_termina_con_codigo_distinto_de_0_y_no_escribe()
    {
        using var dir = new TempDir();

        var (code, _, err) = Run(dir.Path, "--central", "https://central.example.test", "--token", "kmp_Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWpr");

        Assert.NotEqual(0, code);
        Assert.Contains("kma_", err);
        Assert.False(File.Exists(Path.Combine(dir.Path, AgentConfig.FileName)));
    }

    [WindowsFact]
    public void Sin_argumentos_completos_termina_con_codigo_distinto_de_0()
    {
        using var dir = new TempDir();

        Assert.NotEqual(0, Run(dir.Path).Code);
        Assert.NotEqual(0, Run(dir.Path, "--central", "https://central.example.test").Code);
        Assert.NotEqual(0, Run(dir.Path, "--central", "https://central.example.test", "--token").Code);
        Assert.NotEqual(0, Run(dir.Path, "--otro", "x").Code);
    }

    [WindowsFact]
    public void Un_argumento_no_reconocido_no_se_repite_en_la_salida()
    {
        using var dir = new TempDir();

        var (code, output, err) = Run(dir.Path, Token, "--central", "https://central.example.test");

        Assert.NotEqual(0, code);
        Assert.DoesNotContain(Token, err);
        Assert.DoesNotContain(Token, output);
    }

    [WindowsFact]
    public void Con_datos_validos_guarda_y_termina_con_0()
    {
        using var dir = new TempDir();

        var (code, output, _) = Run(dir.Path, "--central", "https://central.example.test/", "--token", Token);

        Assert.Equal(0, code);
        Assert.DoesNotContain(Token, output);
        var config = AgentConfig.Load(dir.Path);
        Assert.Equal("https://central.example.test", config.CentralUrl);
        Assert.Equal(Token, config.GetToken());
    }
}

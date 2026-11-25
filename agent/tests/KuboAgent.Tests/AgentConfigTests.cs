using System.Runtime.Versioning;
using System.Text;
using System.Text.Json;

namespace KuboAgent.Tests;

[SupportedOSPlatform("windows")]
public class AgentConfigTests
{
    private const string Token = "kma_Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWpr";

    [WindowsFact]
    public void Va_y_vuelve_y_el_token_protegido_no_contiene_el_token_en_claro()
    {
        using var dir = new TempDir();

        AgentConfig.Create("https://central.example.test/", Token).Save(dir.Path, restrictAcl: false);
        var text = File.ReadAllText(Path.Combine(dir.Path, AgentConfig.FileName));
        var loaded = AgentConfig.Load(dir.Path);

        Assert.Equal("https://central.example.test", loaded.CentralUrl);
        Assert.Equal(Token, loaded.GetToken());
        Assert.DoesNotContain(Token, text);
        Assert.DoesNotContain(Token["kma_".Length..], text);
        Assert.DoesNotContain(Convert.ToBase64String(Encoding.UTF8.GetBytes(Token)), text);
        Assert.DoesNotContain(Token, Encoding.UTF8.GetString(Convert.FromBase64String(loaded.TokenProtected)));

        using var json = JsonDocument.Parse(text);
        Assert.Equal(["centralUrl", "tokenProtected"], json.RootElement.EnumerateObject().Select(p => p.Name));
    }

    [WindowsFact]
    public void Sin_archivo_da_un_error_legible()
    {
        using var dir = new TempDir();

        var ex = Assert.Throws<InvalidOperationException>(() => AgentConfig.Load(dir.Path));
        Assert.Contains("kubo-agent configure", ex.Message);
    }

    [WindowsFact]
    public void Rechaza_escribir_a_traves_de_una_union()
    {
        using var dir = new TempDir();
        var target = Path.Combine(dir.Path, "destino");
        var link = Path.Combine(dir.Path, "union");
        Directory.CreateDirectory(target);
        // Una unión (junction) no requiere administrador.
        var p = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("cmd.exe", $"/c mklink /J \"{link}\" \"{target}\"")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
        })!;
        p.WaitForExit();
        Assert.True(new DirectoryInfo(link).Attributes.HasFlag(FileAttributes.ReparsePoint));

        var config = AgentConfig.Create("https://central.example.test", Token);
        Assert.Throws<InvalidOperationException>(() => config.Save(link, restrictAcl: false));
        Assert.Throws<InvalidOperationException>(() => config.Save(Path.Combine(link, "Agent"), restrictAcl: false));
        Assert.Empty(Directory.GetFileSystemEntries(target));

        Directory.Delete(link); // borra solo la unión, no el destino
    }

    [Theory]
    [InlineData("https://docs.example.test", true)]
    [InlineData("https://docs.example.test/kubo/", true)]
    [InlineData("http://docs.example.test", false)]
    [InlineData("ftp://docs.example.test", false)]
    [InlineData("docs.example.test", false)]
    [InlineData("https://u:p@docs.example.test", false)]
    [InlineData("https://docs.example.test/?x=1", false)]
    [InlineData("", false)]
    public void Valida_la_url_de_la_central(string url, bool valid)
    {
        Assert.Equal(valid, AgentConfig.TryValidateCentralUrl(url, out _));
    }

    [Theory]
    [InlineData(Token, true)]
    [InlineData("kmp_Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWpr", false)]
    [InlineData("Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWpr", false)]
    [InlineData("kma_", false)]
    [InlineData("kma_abc def ghi jkl mno pqr", false)]
    public void Valida_la_forma_del_token(string token, bool valid)
    {
        Assert.Equal(valid, AgentConfig.IsValidToken(token));
    }
}

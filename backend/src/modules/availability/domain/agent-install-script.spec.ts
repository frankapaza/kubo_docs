import { buildInstallScript } from './agent-install-script';

describe('buildInstallScript', () => {
  const script = buildInstallScript('https://docs.kubo.test', 'kma_abc');

  it('exige administrador y copia kubo-agent.exe a Program Files', () => {
    expect(script).toContain('#Requires -RunAsAdministrator');
    expect(script).toMatch(/IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/);
    expect(script).toContain("Join-Path $PSScriptRoot 'kubo-agent.exe'");
    expect(script).toContain("$destino = 'C:\\Program Files\\KUBO\\Agent'");
    expect(script).toContain('Copy-Item');
  });

  it('configura con la URL y el token como literales entre comillas simples', () => {
    expect(script).toContain("$central = 'https://docs.kubo.test'");
    expect(script).toContain("$token = 'kma_abc'");
    expect(script).toContain('configure --central $central --token $token');
  });

  it('crea el servicio KuboAgent automático como LocalSystem, con reinicio ante fallos, y lo inicia', () => {
    expect(script).toContain('sc.exe');
    expect(script).toContain(`$binPath = 'binPath= "\\"' + $exe + '\\""'`);
    expect(script).toMatch(/create KuboAgent \$binPath start= auto obj= LocalSystem/);
    expect(script).toContain('failure KuboAgent reset= 86400 actions= restart/60000/restart/60000/restart/60000');
    expect(script).toContain('Start-Service -Name KuboAgent');
  });

  it("escapa la ' duplicándola", () => {
    const s = buildInstallScript("https://x.test/a'b", "kma_it's");
    expect(s).toContain("$central = 'https://x.test/a''b'");
    expect(s).toContain("$token = 'kma_it''s'");
    expect(s).not.toContain("'kma_it's'");
  });
});

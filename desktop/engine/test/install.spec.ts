import { buildAclCommands, buildScCommands, buildServiceXml, parseInstallArgs, SERVICE_ID, SERVICE_NAME } from '../src/service/install';

describe('service/install (plan, sin registrar nada)', () => {
  it('parseInstallArgs exige --user y acepta --central, --port y --token-stdin', () => {
    expect(() => parseInstallArgs([])).toThrow(/--user/);
    expect(parseInstallArgs(['--user', 'OFICINA\\ana', '--central', 'https://docs.kuboti.com', '--port', '47801', '--token-stdin'])).toEqual({
      user: 'OFICINA\\ana',
      central: 'https://docs.kuboti.com',
      port: 47801,
      tokenStdin: true,
      dryRun: false,
    });
  });

  it('el XML de WinSW arranca node con main.js, apunta KUBO_MONITOR_HOME y rota sus registros en logs', () => {
    const xml = buildServiceXml({
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      mainJs: 'C:\\Program Files\\KUBO\\engine\\dist\\main.js',
      home: 'C:\\ProgramData\\KUBO\\Monitor',
      workDir: 'C:\\Program Files\\KUBO\\engine',
    });
    expect(xml).toContain(`<id>${SERVICE_ID}</id>`);
    expect(xml).toContain(`<name>${SERVICE_NAME}</name>`);
    expect(xml).toContain('<executable>C:\\Program Files\\nodejs\\node.exe</executable>');
    expect(xml).toContain('<argument>C:\\Program Files\\KUBO\\engine\\dist\\main.js</argument>');
    expect(xml).toContain('<env name="KUBO_MONITOR_HOME" value="C:\\ProgramData\\KUBO\\Monitor"/>');
    expect(xml).toContain('<logpath>C:\\ProgramData\\KUBO\\Monitor\\logs</logpath>');
    expect(xml).toContain('<onfailure action="restart"');
    expect(xml).not.toContain('&<');
  });

  it('el XML escapa caracteres especiales', () => {
    const xml = buildServiceXml({ nodePath: 'C:\\a&b\\node.exe', mainJs: 'C:\\m.js', home: 'C:\\h', workDir: 'C:\\w' });
    expect(xml).toContain('C:\\a&amp;b\\node.exe');
  });

  it('sc: inicio automático, cuenta LocalService y reinicio ante fallo', () => {
    const cmds = buildScCommands();
    expect(cmds).toContainEqual(['sc.exe', ['config', SERVICE_ID, 'start=', 'auto', 'obj=', 'NT AUTHORITY\\LocalService', 'password=', '']]);
    const failure = cmds.find((c) => c[1][0] === 'failure');
    expect(failure![1]).toEqual(['failure', SERVICE_ID, 'reset=', '86400', 'actions=', 'restart/5000/restart/30000/restart/60000']);
    expect(cmds).toContainEqual(['sc.exe', ['failureflag', SERVICE_ID, '1']]);
  });

  it('ACL: SYSTEM y Administradores total, el servicio modifica, el usuario solo atraviesa la carpeta y lee el secreto', () => {
    const cmds = buildAclCommands('C:\\ProgramData\\KUBO\\Monitor', 'OFICINA\\ana');
    expect(cmds[0]).toEqual([
      'icacls.exe',
      [
        'C:\\ProgramData\\KUBO\\Monitor',
        '/inheritance:r',
        '/grant:r',
        '*S-1-5-18:(OI)(CI)F',
        '*S-1-5-32-544:(OI)(CI)F',
        '*S-1-5-19:(OI)(CI)M',
        'OFICINA\\ana:(RX)',
      ],
    ]);
    expect(cmds[1]).toEqual(['icacls.exe', ['C:\\ProgramData\\KUBO\\Monitor\\local-api.secret', '/grant:r', 'OFICINA\\ana:(R)']]);
  });
});

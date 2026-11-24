import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEngineConfig, loadLocalSecret, loadProbeToken, monitorHome, saveProbeToken } from '../src/config';

describe('config', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'kubo-home-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('monitorHome: KUBO_MONITOR_HOME manda; si no, %ProgramData%\\KUBO\\Monitor', () => {
    expect(monitorHome({ KUBO_MONITOR_HOME: 'D:\\x' })).toBe('D:\\x');
    expect(monitorHome({ ProgramData: 'C:\\ProgramData' })).toBe(join('C:\\ProgramData', 'KUBO', 'Monitor'));
  });

  it('loadEngineConfig aplica los valores por defecto (47800, 15000) y quita la barra final', () => {
    writeFileSync(join(home, 'engine.json'), JSON.stringify({ centralUrl: 'https://docs.kuboti.com/', probeCode: 'oficina-01' }));
    expect(loadEngineConfig(home)).toEqual({
      centralUrl: 'https://docs.kuboti.com',
      probeCode: 'oficina-01',
      localPort: 47800,
      syncIntervalMs: 15000,
    });
  });

  it('loadEngineConfig rechaza otra sonda, una URL inválida o un puerto inválido', () => {
    const write = (o: object) => writeFileSync(join(home, 'engine.json'), JSON.stringify(o));
    write({ centralUrl: 'https://x', probeCode: 'kubo-01' });
    expect(() => loadEngineConfig(home)).toThrow(/oficina-01/);
    write({ centralUrl: 'ftp://x', probeCode: 'oficina-01' });
    expect(() => loadEngineConfig(home)).toThrow(/centralUrl/);
    write({ centralUrl: 'https://x', probeCode: 'oficina-01', localPort: 70000 });
    expect(() => loadEngineConfig(home)).toThrow(/localPort/);
  });

  it('loadLocalSecret lee el secreto y rechaza uno vacío', () => {
    writeFileSync(join(home, 'local-api.secret'), 'abc123\r\n');
    expect(loadLocalSecret(home)).toBe('abc123');
    writeFileSync(join(home, 'local-api.secret'), '  ');
    expect(() => loadLocalSecret(home)).toThrow();
  });

  const onWindows = process.platform === 'win32' ? it : it.skip;
  onWindows('token.dat queda protegido con DPAPI (no contiene el token en claro) y se recupera', () => {
    saveProbeToken('kmp_prueba_123', home);
    const raw = readFileSync(join(home, 'token.dat'));
    expect(raw.toString('latin1')).not.toContain('kmp_prueba_123');
    expect(loadProbeToken(home)).toBe('kmp_prueba_123');
  });

  const offWindows = process.platform !== 'win32' ? it : it.skip;
  offWindows('fuera de Windows solo hay archivo en claro con KUBO_MONITOR_INSECURE_PLAIN_TOKEN=1', () => {
    const prev = process.env.KUBO_MONITOR_INSECURE_PLAIN_TOKEN;
    try {
      delete process.env.KUBO_MONITOR_INSECURE_PLAIN_TOKEN;
      expect(() => saveProbeToken('kmp_x', home)).toThrow(/DPAPI/);
      process.env.KUBO_MONITOR_INSECURE_PLAIN_TOKEN = '1';
      saveProbeToken('kmp_x', home);
      expect(loadProbeToken(home)).toBe('kmp_x');
    } finally {
      if (prev === undefined) delete process.env.KUBO_MONITOR_INSECURE_PLAIN_TOKEN;
      else process.env.KUBO_MONITOR_INSECURE_PLAIN_TOKEN = prev;
    }
  });
});

import { LOG_LEVELS, isErrorLevel, meetsMinLevel, normalizeLevel } from './log-level';

describe('normalizeLevel', () => {
  it.each([
    ['debug', 'DEBUG'],
    ['TRACE', 'DEBUG'],
    ['VERBOSE', 'DEBUG'],
    ['ALL', 'DEBUG'],
    ['NOTICE', 'INFO'],
    ['WARNING', 'WARN'],
    ['SEVERE', 'ERROR'],
    ['CRITICAL', 'FATAL'],
    ['ALERT', 'FATAL'],
    ['EMERGENCY', 'FATAL'],
    ['raro', 'INFO'],
    [null, 'INFO'],
    [5, 'INFO'],
  ])('%p -> %s', (raw, esperado) => {
    expect(normalizeLevel(raw)).toBe(esperado);
  });

  it('respeta los cinco niveles canónicos, con espacios y minúsculas', () => {
    for (const n of LOG_LEVELS) expect(normalizeLevel(` ${n.toLowerCase()} `)).toBe(n);
  });
});

describe('meetsMinLevel / isErrorLevel', () => {
  it('compara por orden de gravedad', () => {
    expect(meetsMinLevel('WARN', 'INFO')).toBe(true);
    expect(meetsMinLevel('INFO', 'INFO')).toBe(true);
    expect(meetsMinLevel('DEBUG', 'INFO')).toBe(false);
  });
  it('ERROR y FATAL son errores', () => {
    expect(isErrorLevel('ERROR')).toBe(true);
    expect(isErrorLevel('FATAL')).toBe(true);
    expect(isErrorLevel('WARN')).toBe(false);
  });
});

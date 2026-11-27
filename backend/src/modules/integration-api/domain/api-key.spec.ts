import { apiKeyDisplayPrefix, API_KEY_PREFIX, fingerprintApiKey, generateApiKey, isWellFormedApiKey } from './api-key';

describe('claves de la API de integración (kci_)', () => {
  it('genera claves bien formadas y distintas', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(isWellFormedApiKey(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('la huella es SHA-256 hex y determinista', () => {
    const k = generateApiKey();
    expect(fingerprintApiKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintApiKey(k)).toBe(fingerprintApiKey(k));
  });

  it('rechaza lo que no es una clave kci_', () => {
    expect(isWellFormedApiKey('kdev_' + 'a'.repeat(43))).toBe(false);
    expect(isWellFormedApiKey('')).toBe(false);
    expect(isWellFormedApiKey(undefined)).toBe(false);
    expect(isWellFormedApiKey('kci_' + 'a'.repeat(42))).toBe(false);
    expect(isWellFormedApiKey('kci_' + 'a'.repeat(43))).toBe(true);
  });

  it('el prefijo visible son los 8 primeros caracteres', () => {
    const k = generateApiKey();
    expect(apiKeyDisplayPrefix(k)).toBe(k.slice(0, 8));
  });
});

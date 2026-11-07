import {
  fingerprintInstallationKey,
  generateInstallationKey,
  INSTALLATION_KEY_PREFIX,
  isWellFormedInstallationKey,
  keyDisplayPrefix,
} from './installation-key';

describe('clave de instalación', () => {
  it('casa con el formato klog_ + 43 caracteres base64url', () => {
    const key = generateInstallationKey();
    expect(key.startsWith(INSTALLATION_KEY_PREFIX)).toBe(true);
    expect(key).toMatch(/^klog_[A-Za-z0-9_-]{43}$/);
    expect(isWellFormedInstallationKey(key)).toBe(true);
  });

  it('dos claves generadas son distintas', () => {
    expect(generateInstallationKey()).not.toBe(generateInstallationKey());
  });

  it('la huella son 64 hex y es estable', () => {
    const key = generateInstallationKey();
    const fp = fingerprintInstallationKey(key);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintInstallationKey(key)).toBe(fp);
    expect(fingerprintInstallationKey(generateInstallationKey())).not.toBe(fp);
  });

  it('rechaza null, prefijo ajeno y longitud distinta', () => {
    const body = 'A'.repeat(43);
    expect(isWellFormedInstallationKey(null)).toBe(false);
    expect(isWellFormedInstallationKey(undefined)).toBe(false);
    expect(isWellFormedInstallationKey(42)).toBe(false);
    expect(isWellFormedInstallationKey(`xlog_${body}`)).toBe(false);
    expect(isWellFormedInstallationKey(`klog_${body}A`)).toBe(false);
    expect(isWellFormedInstallationKey(`klog_${body.slice(1)}`)).toBe(false);
    expect(isWellFormedInstallationKey(`klog_${body}`)).toBe(true);
  });

  it('el prefijo de pantalla son los 9 primeros caracteres', () => {
    const key = generateInstallationKey();
    expect(keyDisplayPrefix(key)).toBe(key.slice(0, 9));
    expect(keyDisplayPrefix(key)).toHaveLength(9);
  });
});

import {
  devKeyDisplayPrefix,
  fingerprintDevKey,
  generateDevKey,
  isWellFormedDevKey,
} from './dev-key';

describe('claves kdev_', () => {
  it('genera kdev_ + 43 caracteres base64url y cada una es distinta', () => {
    const a = generateDevKey();
    const b = generateDevKey();
    expect(a).toMatch(/^kdev_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('reconoce solo las bien formadas', () => {
    expect(isWellFormedDevKey('kdev_' + 'a'.repeat(43))).toBe(true);
    expect(isWellFormedDevKey('klog_' + 'a'.repeat(43))).toBe(false);
    expect(isWellFormedDevKey('kdev_corta')).toBe(false);
    expect(isWellFormedDevKey(undefined)).toBe(false);
    expect(isWellFormedDevKey(['kdev_' + 'a'.repeat(43)])).toBe(false);
  });

  it('la huella es SHA-256 hex y estable', () => {
    const k = 'kdev_' + 'b'.repeat(43);
    expect(fingerprintDevKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintDevKey(k)).toBe(fingerprintDevKey(k));
  });

  it('el prefijo visible son 9 caracteres', () => {
    expect(devKeyDisplayPrefix('kdev_AbCdEfGh')).toBe('kdev_AbCd');
  });
});

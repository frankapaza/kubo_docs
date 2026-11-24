import { createHash, randomBytes } from 'crypto';

/**
 * Claves del conector de Claude. Gemelas de `monitoring/domain/installation-key.ts`
 * con otro prefijo: un escáner de secretos (o una persona) distingue a simple
 * vista una clave de logs de una de desarrollo.
 */
export const DEV_KEY_PREFIX = 'kdev_';

const WELL_FORMED = /^kdev_[A-Za-z0-9_-]{43}$/;

/** `kdev_` + 32 bytes del CSPRNG en base64url (43 caracteres, sin relleno). */
export function generateDevKey(): string {
  return DEV_KEY_PREFIX + randomBytes(32).toString('base64url');
}

/** SHA-256 hex: lo único que se guarda. 256 bits de entropía hacen innecesario un hash lento. */
export function fingerprintDevKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** La guarda lo mira antes de tocar la base: lo que no case es 401 sin consulta. */
export function isWellFormedDevKey(key: unknown): key is string {
  return typeof key === 'string' && WELL_FORMED.test(key);
}

/** `kdev_` + 4: para reconocer la clave en pantalla. */
export function devKeyDisplayPrefix(key: string): string {
  return key.slice(0, 9);
}

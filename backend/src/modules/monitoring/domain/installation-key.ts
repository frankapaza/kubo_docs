import { createHash, randomBytes } from 'crypto';

/** Prefijo reconocible: un escáner de secretos o una persona ven de qué es. */
export const INSTALLATION_KEY_PREFIX = 'klog_';

/** `klog_` + 43 caracteres base64url (32 bytes aleatorios, sin relleno). */
const WELL_FORMED = /^klog_[A-Za-z0-9_-]{43}$/;

/** Una clave nueva: 32 bytes del CSPRNG del sistema, en base64url. */
export function generateInstallationKey(): string {
  return INSTALLATION_KEY_PREFIX + randomBytes(32).toString('base64url');
}

/**
 * SHA-256 hex de la clave. Es lo único que se guarda (como
 * `secret_fingerprint` de las invitaciones): la clave tiene 256 bits de
 * entropía, así que un hash rápido basta y permite buscar por igualdad en el
 * índice único sin recorrer la tabla.
 */
export function fingerprintInstallationKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * ¿Tiene la forma de una clave nuestra? La ingesta lo mira antes de tocar la
 * base: cualquier cosa que no case se rechaza con 401 sin consulta.
 */
export function isWellFormedInstallationKey(key: unknown): boolean {
  return typeof key === 'string' && WELL_FORMED.test(key);
}

/** Los 9 primeros caracteres (`klog_` + 4): para reconocer la clave en pantalla. */
export function keyDisplayPrefix(key: string): string {
  return key.slice(0, 9);
}

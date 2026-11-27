import { createHash, randomBytes } from 'crypto';

/**
 * Claves de la API de integración de clientes. Gemelas de
 * `dev-connector/domain/dev-key.ts` con otro prefijo: un escáner de secretos
 * (o una persona) distingue a simple vista una clave de integración.
 */
export const API_KEY_PREFIX = 'kci_';

const WELL_FORMED = /^kci_[A-Za-z0-9_-]{43}$/;

/** `kci_` + 32 bytes del CSPRNG en base64url (43 caracteres, sin relleno). */
export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(32).toString('base64url');
}

/** SHA-256 hex: lo único que se guarda. 256 bits de entropía hacen innecesario un hash lento. */
export function fingerprintApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** La guarda lo mira antes de tocar la base: lo que no case es 401 sin consulta. */
export function isWellFormedApiKey(key: unknown): key is string {
  return typeof key === 'string' && WELL_FORMED.test(key);
}

/** `kci_` + 4: para reconocer la clave en pantalla. */
export function apiKeyDisplayPrefix(key: string): string {
  return key.slice(0, 8);
}

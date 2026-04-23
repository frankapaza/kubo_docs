import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const secret = process.env.CRYPTO_SECRET ?? process.env.JWT_ACCESS_SECRET ?? 'kubo-dev-fallback';
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decryptSecret(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted token');
  const [ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
  return plain.toString('utf8');
}

export function maskSecret(plain: string): string {
  if (!plain) return '';
  if (plain.length <= 8) return '••••';
  return `${plain.slice(0, 4)}••••${plain.slice(-4)}`;
}

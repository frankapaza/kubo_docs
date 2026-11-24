import { createHmac, timingSafeEqual } from 'crypto';

/**
 * `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256 hex del cuerpo **crudo**.
 * Comparación en tiempo constante; cualquier forma inesperada es `false`.
 */
export function verifyGithubSignature(raw: Buffer, secret: string, header: unknown): boolean {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(raw).digest('hex'), 'utf8');
  const got = Buffer.from(header, 'utf8');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

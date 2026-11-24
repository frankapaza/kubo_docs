import { createHmac } from 'crypto';

import { verifyGithubSignature } from './github-signature';

const SECRET = 'a'.repeat(64);
const firma = (raw: Buffer, secret = SECRET) =>
  'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');

describe('verifyGithubSignature', () => {
  const raw = Buffer.from('{"zen":"Keep it logically awesome."}');

  it('acepta la firma correcta', () => {
    expect(verifyGithubSignature(raw, SECRET, firma(raw))).toBe(true);
  });

  it('rechaza otro secreto, otro cuerpo, sin prefijo o sin cabecera', () => {
    expect(verifyGithubSignature(raw, SECRET, firma(raw, 'b'.repeat(64)))).toBe(false);
    expect(verifyGithubSignature(Buffer.from('{}'), SECRET, firma(raw))).toBe(false);
    expect(verifyGithubSignature(raw, SECRET, firma(raw).slice(7))).toBe(false);
    expect(verifyGithubSignature(raw, SECRET, undefined)).toBe(false);
    expect(verifyGithubSignature(raw, SECRET, ['x'])).toBe(false);
  });
});

import { __test } from './signature-json-limit';

describe('rutas con límite de 1 MB para la firma', () => {
  it.each([
    '/api/v1/actas/900/signatures/in-person',
    '/api/v1/actas/900/signatures/email',
    '/api/v1/acta-sign/AbC_123-xyz/confirm',
  ])('%s', (p) => expect(__test.RUTAS_DE_FIRMA.test(p)).toBe(true));

  it.each(['/api/v1/actas/900/signatures', '/api/v1/actas/900/annexes', '/api/v1/client-users'])('no: %s', (p) =>
    expect(__test.RUTAS_DE_FIRMA.test(p)).toBe(false));
});

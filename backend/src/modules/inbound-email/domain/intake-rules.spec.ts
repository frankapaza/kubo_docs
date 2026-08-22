import { isOwnMailbox, judgeAuthentication } from './intake-rules';

describe('judgeAuthentication', () => {
  it('acepta cuando spf y dkim pasan', () => {
    expect(judgeAuthentication('mx.kuboti.com; spf=pass smtp.mailfrom=cliente.com; dkim=pass header.d=cliente.com'))
      .toBe('PASA');
  });

  it('acepta con dkim=pass aunque spf no aparezca', () => {
    expect(judgeAuthentication('mx.kuboti.com; dkim=pass header.d=cliente.com')).toBe('PASA');
  });

  it('rechaza cuando ambos fallan', () => {
    expect(judgeAuthentication('mx.kuboti.com; spf=fail; dkim=fail')).toBe('FALLA');
  });

  it('rechaza spf=softfail y dkim=none', () => {
    expect(judgeAuthentication('mx.kuboti.com; spf=softfail; dkim=none')).toBe('FALLA');
  });

  // El punto entero de este modulo: la ausencia significa NO, nunca
  // "probablemente bien". Si el proveedor no anade la cabecera, no entra
  // ningun correo -- y eso es lo que queremos que pase, en voz alta.
  it('sin cabecera es SIN_CABECERA, que no es PASA', () => {
    expect(judgeAuthentication(null)).toBe('SIN_CABECERA');
    expect(judgeAuthentication(undefined)).toBe('SIN_CABECERA');
    expect(judgeAuthentication('   ')).toBe('SIN_CABECERA');
  });

  // "pass" dentro de otra palabra no es un veredicto.
  it('no confunde una subcadena con un veredicto', () => {
    expect(judgeAuthentication('mx.kuboti.com; spf=fail (passed nothing); dkim=fail')).toBe('FALLA');
  });
});

describe('isOwnMailbox', () => {
  it('reconoce el propio buzon sin distinguir mayusculas', () => {
    expect(isOwnMailbox('Ticket@Kuboti.com', 'ticket@kuboti.com')).toBe(true);
  });

  it('no confunde una direccion que lo contiene', () => {
    expect(isOwnMailbox('ticket@kuboti.com.atacante.net', 'ticket@kuboti.com')).toBe(false);
  });
});

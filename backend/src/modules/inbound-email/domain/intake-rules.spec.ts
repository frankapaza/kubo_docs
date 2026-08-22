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

  // `Authentication-Results` no es texto de confianza de punta a punta:
  // nuestro propio servidor copia dentro de ella datos que escribe el
  // remitente (`smtp.mailfrom`, `smtp.helo`, `header.from`, comentarios).
  // Un veredicto solo cuenta si esta al principio de su propio bloque
  // (segmento separado por ';'), nunca si aparece dentro del valor de otra
  // clave. Las cuatro pruebas siguientes son ataques reales: cada una logra
  // que la cadena contenga la subcadena "spf=pass" o "dkim=pass" con SPF y
  // DKIM realmente en `fail`, y las cuatro deben dar FALLA.
  it('no se deja enganar por spf=pass dentro de una direccion registrada a proposito', () => {
    // "spf=pass@atacante.net" es una direccion de correo valida (RFC 5322
    // permite "=" en la parte local): quien la registra consigue que
    // NUESTRO servidor escriba "spf=pass" dentro de smtp.mailfrom.
    expect(
      judgeAuthentication('mx.kuboti.com; spf=fail smtp.mailfrom=spf=pass@atacante.net; dkim=fail'),
    ).toBe('FALLA');
  });

  it('no se deja enganar por un veredicto falso dentro de un comentario', () => {
    expect(
      judgeAuthentication('mx.kuboti.com; spf=fail (el cliente pidio dkim=pass); dkim=fail'),
    ).toBe('FALLA');
  });

  it('no se deja enganar por una clave parecida pero distinta (x-original-spf)', () => {
    expect(judgeAuthentication('mx.kuboti.com; spf=fail; dkim=fail; x-original-spf=pass')).toBe('FALLA');
  });

  it('no se deja enganar por un valor que empieza como "pass" pero no lo es', () => {
    expect(judgeAuthentication('mx.kuboti.com; spf=pass-nada')).toBe('FALLA');
  });

  // RFC 8601 permite espacios alrededor del "=" dentro de cada resultado.
  it('acepta espacios alrededor del signo igual', () => {
    expect(judgeAuthentication('mx.kuboti.com; dkim = pass header.d=cliente.com')).toBe('PASA');
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

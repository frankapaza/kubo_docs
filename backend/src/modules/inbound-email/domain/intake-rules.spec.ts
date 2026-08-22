import { isOwnMailbox, judgeAuthentication } from './intake-rules';

describe('judgeAuthentication', () => {
  it('acepta cuando dmarc pasa', () => {
    expect(
      judgeAuthentication(
        'mx.kuboti.com; spf=pass smtp.mailfrom=cliente.com; dkim=pass header.d=cliente.com; dmarc=pass header.from=cliente.com',
      ),
    ).toBe('PASA');
  });

  // RFC 8601 permite espacios alrededor del "=" dentro de cada resultado.
  it('acepta espacios alrededor del signo igual en dmarc', () => {
    expect(judgeAuthentication('mx.kuboti.com; dmarc = pass header.from=cliente.com')).toBe('PASA');
  });

  // Ronda de correcciones 2, punto 2: que spf o dkim pasen ya no basta. Un
  // atacante que controla su propio dominio puede firmar DKIM validamente y
  // poner un From: de otra empresa -- eso pasa spf/dkim y falla DMARC, que
  // es exactamente el mecanismo que exige que el pase este alineado con el
  // dominio del From. Por eso ahora solo dmarc=pass decide.
  it('rechaza cuando dmarc falla, aunque spf y dkim pasen', () => {
    expect(
      judgeAuthentication(
        'mx.kuboti.com; spf=pass smtp.mailfrom=cliente.com; dkim=pass header.d=cliente.com; dmarc=fail',
      ),
    ).toBe('FALLA');
  });

  // Ronda de correcciones 3, punto 5: esta cabecera no trae NINGUN segmento
  // "dmarc=" -- no es que dmarc fallara, es que nunca se evaluo. Eso es
  // SIN_DMARC, no FALLA: la causa es "el proveedor no corre/informa DMARC"
  // (se arregla en su consola, afecta al 100% del trafico), distinta de "el
  // remitente fallo la autenticacion".
  it('sin ningun segmento dmarc es SIN_DMARC', () => {
    expect(judgeAuthentication('mx.kuboti.com; spf=softfail; dkim=none')).toBe('SIN_DMARC');
  });

  // El punto entero de este modulo: la ausencia significa NO, nunca
  // "probablemente bien". Si el proveedor no anade la cabecera, no entra
  // ningun correo -- y eso es lo que queremos que pase, en voz alta.
  it('sin cabecera es SIN_CABECERA, que no es PASA', () => {
    expect(judgeAuthentication(null)).toBe('SIN_CABECERA');
    expect(judgeAuthentication(undefined)).toBe('SIN_CABECERA');
    expect(judgeAuthentication('   ')).toBe('SIN_CABECERA');
  });

  // Distinto de los dos casos anteriores: aqui la cabecera SI existe Y SI
  // trae un segmento "dmarc=...", pero no es "pass".
  it('la cabecera presente con un segmento dmarc que no es pass es FALLA', () => {
    expect(
      judgeAuthentication(
        'mx.kuboti.com; spf=pass smtp.mailfrom=cliente.com; dkim=pass header.d=cliente.com; dmarc=none',
      ),
    ).toBe('FALLA');
  });

  it('no confunde una subcadena con un veredicto', () => {
    expect(judgeAuthentication('mx.kuboti.com; dmarc=fail (esto aparentemente paso); spf=fail')).toBe('FALLA');
  });

  it('no se deja enganar por una clave parecida pero distinta (x-original-dmarc)', () => {
    expect(judgeAuthentication('mx.kuboti.com; dmarc=fail; x-original-dmarc=pass')).toBe('FALLA');
  });

  it('no se deja enganar por un valor que empieza como "pass" pero no lo es', () => {
    expect(judgeAuthentication('mx.kuboti.com; dmarc=pass-nada')).toBe('FALLA');
  });

  // Los vectores de ataque de la ronda de correcciones 2 (comillas y
  // comentarios BIEN FORMADOS que esconden un dmarc=pass falso). Se dirigen
  // contra `dmarc`, no contra `spf`/`dkim`: con la politica de la ronda 2
  // esos dos ya no deciden nada por si solos.
  describe('vectores de ataque de la ronda 2 (comillas y comentarios bien formados)', () => {
    it('V1: no se deja enganar por un dmarc=pass dentro de una cadena entrecomillada (smtp.mailfrom)', () => {
      expect(
        judgeAuthentication(
          'mx.kuboti.com; spf=fail smtp.mailfrom="ana;dmarc=pass"@atacante.net; dkim=fail; dmarc=fail',
        ),
      ).toBe('FALLA');
    });

    it('V2: no se deja enganar por un dmarc=pass dentro de un comentario anidado', () => {
      expect(
        judgeAuthentication(
          'mx.kuboti.com; spf=fail (razon: (detalle) ; dmarc=pass ) ; dkim=fail; dmarc=fail',
        ),
      ).toBe('FALLA');
    });

    it('V3: un comentario sin cerrar no deja pasar el texto crudo', () => {
      expect(
        judgeAuthentication('mx.kuboti.com; spf=fail (comentario que dice dmarc=pass y nunca se cierra; dkim=fail'),
      ).toBe('FALLA');
    });

    it('V4: un parentesis sin pareja en el comentario descarta la cabecera entera', () => {
      expect(
        judgeAuthentication(
          'mx.kuboti.com; spf=fail (google.com: domain of user(evil@atacante.net does not designate 1.2.3.4 as permitted sender) smtp.mailfrom=user(evil@atacante.net; dkim=fail; dmarc=pass',
        ),
      ).toBe('FALLA');
    });

    it('V5: no se deja enganar por un dmarc=pass dentro de una cadena entrecomillada (smtp.helo)', () => {
      expect(
        judgeAuthentication('mx.kuboti.com; spf=fail smtp.helo="ana;dmarc=pass"; dkim=fail; dmarc=fail'),
      ).toBe('FALLA');
    });

    it('V6: no se deja enganar por un dmarc=pass dentro de una cadena entrecomillada (header.from)', () => {
      expect(
        judgeAuthentication('mx.kuboti.com; dkim=fail header.from="Attacker;dmarc=pass"; spf=fail; dmarc=fail'),
      ).toBe('FALLA');
    });

    it('V7: un dkim=pass autentico pero no alineado, con dmarc=fail, no basta', () => {
      expect(
        judgeAuthentication(
          'mx.kuboti.com; spf=fail smtp.mailfrom=jefe@kuboti.com; dkim=pass header.i=@atacante.net; dmarc=fail',
        ),
      ).toBe('FALLA');
    });
  });

  // Ronda de correcciones 3: la familia distinta. Los vectores de arriba
  // atacan por DENTRO de comillas y comentarios bien formados; estos atacan
  // ROMPIENDO la estructura desde dentro -- el remitente elige un dato
  // (direccion de correo) que hace que el propio delimitador (el `)` de un
  // comentario) se cierre donde el remitente quiere, no donde el servidor
  // que compuso la cabecera pretendia. Ninguna cantidad de "analizar mejor"
  // arregla esto si el propio texto de entrada ya viene con los
  // delimitadores falseados -- por eso las tres reglas nuevas trabajan
  // juntas: `)` suelto es malformacion: la cabecera ENTERA (no solo la
  // cola) deja de ser de fiar: y la comprobacion de que ninguna aparicion
  // cruda de "dmarc=" cae fuera del unico segmento reconocido no depende de
  // acertar el analisis -- detecta el intento en si.
  describe('vectores de ataque de la ronda 3 (estructura rota desde dentro)', () => {
    // El local-part `"a); dmarc=pass; x"` es valido por RFC 5322 (un
    // local-part entre comillas admite `)`, `;` y espacios). Dentro de un
    // COMENTARIO -- que no reconoce comillas -- el primer `)` sin escapar
    // cierra el comentario antes de tiempo, sea cual sea el campo que lo
    // acarrea.
    it('el parentesis del comentario boilerplate se cierra antes de tiempo por la direccion (smtp.mailfrom)', () => {
      expect(
        judgeAuthentication(
          'mx.kuboti.com; spf=fail (google.com: domain of "a); dmarc=pass; x"@atk.net does not designate 1.2.3.4 as permitted sender) smtp.mailfrom="a); dmarc=pass; x"@atk.net; dmarc=fail (p=REJECT sp=REJECT dis=none) header.from=cliente.com',
        ),
      ).toBe('FALLA');
    });

    it('el parentesis del comentario boilerplate se cierra antes de tiempo por el HELO (smtp.helo)', () => {
      expect(
        judgeAuthentication(
          'mx.kuboti.com; spf=fail (google.com: domain of "a); dmarc=pass; x" does not designate 1.2.3.4 as permitted sender) smtp.helo="a); dmarc=pass; x"; dmarc=fail (p=REJECT) header.from=cliente.com',
        ),
      ).toBe('FALLA');
    });

    it('el parentesis del comentario boilerplate se cierra antes de tiempo por el nombre para mostrar (header.from)', () => {
      expect(
        judgeAuthentication(
          'mx.kuboti.com; dkim=fail (header.from: "a); dmarc=pass; x") header.from="a); dmarc=pass; x"; spf=fail; dmarc=fail (p=REJECT)',
        ),
      ).toBe('FALLA');
    });

    // Sin comillas ni comentarios en absoluto: si el servidor que compuso la
    // cabecera copia el dato sin escapar el ";" (el local-part
    // "a;dmarc=pass;x" solo es valido entrecomillado; si el generador no lo
    // entrecomilla, el ";" queda crudo), el propio texto crea un segmento
    // de nivel superior nuevo.
    it('un ";" crudo sin comillas en smtp.mailfrom crea un segundo resultado dmarc', () => {
      expect(
        judgeAuthentication(
          'mx.kuboti.com; spf=fail smtp.mailfrom=a;dmarc=pass;x@atacante.net; dkim=fail; dmarc=fail',
        ),
      ).toBe('FALLA');
    });

    it('un ";" crudo sin comillas en smtp.helo crea un segundo resultado dmarc', () => {
      expect(
        judgeAuthentication('mx.kuboti.com; spf=fail smtp.helo=a;dmarc=pass;x; dkim=fail; dmarc=fail'),
      ).toBe('FALLA');
    });

    it('un ";" crudo sin comillas en header.from crea un segundo resultado dmarc', () => {
      expect(
        judgeAuthentication('mx.kuboti.com; dkim=fail header.from=a;dmarc=pass;x; spf=fail; dmarc=fail'),
      ).toBe('FALLA');
    });

    // Un ")" sin ningun "(" que lo abra es la prueba directa de que el
    // anidamiento se rompio en algun punto -- hoy (antes de esta ronda) ese
    // caracter se absorbia en silencio como texto normal.
    it('un ")" suelto a nivel superior es una malformacion', () => {
      expect(judgeAuthentication('mx.kuboti.com; spf=fail ) dkim=fail; dmarc=pass')).toBe('FALLA');
    });

    // El formato de rspamd es igual de vulnerable: el comentario de SPF
    // tambien interpola el dato del remitente sin escapar.
    it('el mismo mecanismo funciona igual en el formato de comentario de rspamd', () => {
      expect(
        judgeAuthentication(
          'mx.kuboti.com; spf=fail (no valid SPF record for "a); dmarc=pass; x"@atk.net) smtp.mailfrom="a); dmarc=pass; x"@atk.net; dmarc=fail (p=reject)',
        ),
      ).toBe('FALLA');
    });

    // El punto 2 en su forma mas explicita: la inyeccion va ANTES de la
    // malformacion, como un segmento "dmarc=pass" limpio y bien formado, y
    // la malformacion (un comentario sin cerrar) llega despues, en un
    // segmento distinto. Una implementacion que solo descarta la COLA desde
    // el punto de la malformacion (en vez de invalidar la cabecera entera)
    // ya habria aceptado el "dmarc=pass" de mentira antes de llegar ahi.
    it('una inyeccion limpia ANTES de una malformacion posterior tambien invalida la cabecera entera', () => {
      expect(
        judgeAuthentication(
          'mx.kuboti.com; dmarc=pass; spf=fail (comentario que nunca se cierra y rompe todo lo que sigue; dkim=fail',
        ),
      ).toBe('FALLA');
    });
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

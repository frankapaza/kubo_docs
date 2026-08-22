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

  it('rechaza spf=softfail y dkim=none sin dmarc', () => {
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

  // Distinto del caso anterior: aqui la cabecera SI existe (nuestro servidor
  // la anadio), pero no trae ningun segmento "dmarc=...". Eso no es "nuestro
  // servidor no anade la cabecera" (eso es SIN_CABECERA, y tiene su propia
  // causa operativa: un fallo de configuracion de ESTE servidor). Es "no
  // corrio o no informo la comprobacion de DMARC", que es indistinguible en
  // sus consecuencias de "DMARC no paso": en los dos casos no hay garantia
  // de alineacion con el From, y el mismo "ante la duda, no entra" aplica.
  // Usar SIN_CABECERA aqui mezclaria dos causas operativas distintas bajo
  // la misma etiqueta, justo el problema que SIN_CABECERA existe para
  // evitar en el caso contrario.
  it('la cabecera presente pero sin segmento dmarc es FALLA, no SIN_CABECERA', () => {
    expect(
      judgeAuthentication('mx.kuboti.com; spf=pass smtp.mailfrom=cliente.com; dkim=pass header.d=cliente.com'),
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

  // Los siete vectores de ataque de la ronda de correcciones 2. Todos deben
  // dar FALLA. Se dirigen contra `dmarc`, no contra `spf`/`dkim`: con la
  // politica nueva (punto 2) esos dos ya no deciden nada por si solos, asi
  // que probar la robustez del analizador contra ellos seria una prueba
  // decorativa -- pasaria igual con un analizador roto. El campo que de
  // verdad hay que defender ahora es `dmarc`.
  describe('vectores de ataque contra el analizador', () => {
    // V1: cadena entrecomillada. `"ana;dmarc=pass"@atacante.net` es una
    // direccion valida (RFC 5322 permite ";" dentro de un local-part entre
    // comillas). El ";" de dentro no debe crear un segmento nuevo.
    it('V1: no se deja enganar por un dmarc=pass dentro de una cadena entrecomillada (smtp.mailfrom)', () => {
      expect(
        judgeAuthentication(
          'mx.kuboti.com; spf=fail smtp.mailfrom="ana;dmarc=pass"@atacante.net; dkim=fail; dmarc=fail',
        ),
      ).toBe('FALLA');
    });

    // V2: comentario anidado. RFC 5322 permite que un comentario contenga
    // otro comentario dentro. Un analizador que solo quita `\([^()]*\)`
    // (sin nesting) dejaba el parentesis externo huerfano y el resto de la
    // cadena, incluido el "dmarc=pass" falso, se colaba como segmento real.
    it('V2: no se deja enganar por un dmarc=pass dentro de un comentario anidado', () => {
      expect(
        judgeAuthentication(
          'mx.kuboti.com; spf=fail (razon: (detalle) ; dmarc=pass ) ; dkim=fail; dmarc=fail',
        ),
      ).toBe('FALLA');
    });

    // V3: comentario sin cerrar. El texto crudo no debe entrar sin analizar
    // solo porque el paréntesis de cierre falta -- eso incluye el propio
    // "dmarc=pass" que aparece dentro del comentario roto.
    it('V3: un comentario sin cerrar no deja pasar el texto crudo', () => {
      expect(
        judgeAuthentication('mx.kuboti.com; spf=fail (comentario que dice dmarc=pass y nunca se cierra; dkim=fail'),
      ).toBe('FALLA');
    });

    // V4: parentesis desbalanceado dentro del comentario que compone el
    // propio servidor (al estilo Google), cuando el dato que interpola --la
    // direccion del remitente-- trae un "(" sin su ")" -- ej. un local-part
    // "user(evil" mal escapado. El comentario boilerplate solo aporta un
    // ")" de cierre, asi que el parentesis del atacante deja el comentario
    // abierto hasta el final de la cadena. Fallar cerrado aqui significa
    // descartar TODO lo que sigue -- incluido un "dmarc=pass" genuino que
    // hubiera venido despues -- y es el coste aceptado de un servidor que
    // no escapa bien: preferible a arriesgar que ese hueco se explote.
    it('V4: un parentesis sin pareja en el comentario descarta el resto de la cabecera (falla cerrado)', () => {
      expect(
        judgeAuthentication(
          'mx.kuboti.com; spf=fail (google.com: domain of user(evil@atacante.net does not designate 1.2.3.4 as permitted sender) smtp.mailfrom=user(evil@atacante.net; dkim=fail; dmarc=pass',
        ),
      ).toBe('FALLA');
    });

    // V5: la misma cadena entrecomillada de V1, pero colgada de smtp.helo.
    it('V5: no se deja enganar por un dmarc=pass dentro de una cadena entrecomillada (smtp.helo)', () => {
      expect(
        judgeAuthentication('mx.kuboti.com; spf=fail smtp.helo="ana;dmarc=pass"; dkim=fail; dmarc=fail'),
      ).toBe('FALLA');
    });

    // V6: el mismo mecanismo, pero colgado de header.from -- el nombre para
    // mostrar de un From: es texto libre que tambien elige el remitente.
    it('V6: no se deja enganar por un dmarc=pass dentro de una cadena entrecomillada (header.from)', () => {
      expect(
        judgeAuthentication('mx.kuboti.com; dkim=fail header.from="Attacker;dmarc=pass"; spf=fail; dmarc=fail'),
      ).toBe('FALLA');
    });

    // V7: el ataque del punto 2. Aqui SI hay un dkim=pass autentico -- de un
    // dominio que no es el del From (header.i=@atacante.net) -- y dmarc=fail
    // lo dice explicitamente. Ni el mejor analizador evita esto: hace falta
    // la politica de exigir dmarc=pass.
    it('V7: un dkim=pass autentico pero no alineado, con dmarc=fail, no basta', () => {
      expect(
        judgeAuthentication(
          'mx.kuboti.com; spf=fail smtp.mailfrom=jefe@kuboti.com; dkim=pass header.i=@atacante.net; dmarc=fail',
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

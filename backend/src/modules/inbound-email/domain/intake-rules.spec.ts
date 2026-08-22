import {
  extractAuthenticatedDomain as extractAuthenticatedDomainReal,
  isOwnMailbox,
  judgeAuthentication as judgeAuthenticationReal,
} from './intake-rules';

/**
 * Tanda de cierre: `judgeAuthentication`/`extractAuthenticatedDomain` ganaron
 * un segundo parametro obligatorio (`expectedServerId`, el ancla contra la
 * cabecera fabricada por el propio remitente -- ver "El ancla que faltaba" en
 * el docblock de `judgeAuthentication`). Todas las cabeceras de ejemplo de
 * este archivo, salvo las que se anotan explicitas mas abajo, ya empiezan por
 * `mx.kuboti.com`: este envoltorio le pasa ese valor por omision para que las
 * casi cuarenta pruebas existentes (que ejercitan la logica de `dmarc=`, no
 * la del servidor) no tengan que tocarse una por una. El propio ancla tiene
 * su describe dedicado, mas abajo, con casos explicitos de coincidencia,
 * desajuste y ajuste sin configurar.
 */
const SERVER_ID_POR_OMISION = 'mx.kuboti.com';

function judgeAuthentication(
  topmostHeader: string | null | undefined,
  expectedServerId: string | null = SERVER_ID_POR_OMISION,
) {
  return judgeAuthenticationReal(topmostHeader, expectedServerId);
}

function extractAuthenticatedDomain(
  topmostHeader: string | null | undefined,
  expectedServerId: string | null = SERVER_ID_POR_OMISION,
) {
  return extractAuthenticatedDomainReal(topmostHeader, expectedServerId);
}

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

  // Ronda de correcciones 4, punto 1: la funcion asume que recibe UNA sola
  // cabecera. Si un salto que une varias cabeceras (p. ej. porque hay mas
  // de un `Authentication-Results` en la cadena de saltos y el adaptador
  // las concateno) llega hasta aqui, el atacante puede aportar su propio
  // "dmarc=pass" en SU PROPIA cabecera -- limpio, unico, sin malformacion
  // alguna -- y las tres defensas de `evaluateDmarc` quedan inertes: no hay
  // nada que analizar mal, el segmento es autentico DENTRO de la cadena
  // que le llego a la funcion. El contrato ("pasa solo la cabecera mas
  // externa") no puede vivir solo en un comentario.
  describe('ronda de correcciones 4: la funcion debe negarse si la alimentan mal', () => {
    it('rechaza un valor con salto de linea (senal de cabeceras concatenadas)', () => {
      // Lo que escribio nuestro servidor, a solas, seria SIN_DMARC (no
      // trae dmarc=) y bloquearia. El "dmarc=pass" es una segunda cabecera
      // que el propio atacante anadio a su mensaje.
      expect(judgeAuthentication('mx.kubo.com; spf=pass\nevil.example; dmarc=pass')).toBe('FALLA');
    });

    it('rechaza tambien con el salto de linea en forma CRLF', () => {
      expect(judgeAuthentication('mx.kubo.com; spf=pass\r\nevil.example; dmarc=pass')).toBe('FALLA');
    });
  });

  // Ronda de correcciones 4, punto 2 -- LIMITACION CONOCIDA Y ACEPTADA, no
  // un bug pendiente. Ver el docblock de `judgeAuthentication`: un ";" sin
  // comillas dentro de un campo que controla el remitente (aqui,
  // `smtp.helo`) es indistinguible, en el texto ya serializado, de una
  // cabecera legitima en la que ese campo simplemente contenga un punto y
  // coma. No hay malformacion que detectar, hay exactamente un resultado
  // `dmarc=`, y su unica mencion cruda cae dentro de su propio segmento:
  // las tres capas de `evaluateDmarc` lo aprueban correctamente SEGUN LA
  // CADENA QUE RECIBEN -- el problema es que la cadena, una vez
  // serializada sin comillas, ya perdio la informacion que hacia falta
  // para decidir. Ningun analisis sobre el texto puede recuperar esa
  // informacion; la defensa real es que el servidor de correo rechace en
  // el sobre SMTP el correo que no pase DMARC, ANTES de escribir esta
  // cabecera.
  //
  // Este test documenta el comportamiento ACTUAL (`PASA`), no lo aprueba.
  // Si algun dia empieza a fallar porque alguien encontro una forma real de
  // cerrar este hueco (p. ej. una politica que rechaza en el servidor, o
  // una fuente de datos que SI distingue delimitador de valor), es una
  // buena noticia: actualiza el test, no lo "arregles" para que vuelva a
  // pasar.
  it('LIMITACION CONOCIDA: un ";" sin comillas en smtp.helo es indistinguible de una cabecera legitima', () => {
    expect(judgeAuthentication('mx.kubo.com; spf=fail smtp.helo=evil; dmarc=pass', 'mx.kubo.com')).toBe('PASA');
  });

  /**
   * El mismo vector de arriba, pero mostrando el costo real: no es solo un
   * `PASA` de mentira, es un `header.from=` de mentira tambien -- el
   * remitente lo escribe en el mismo segmento fabricado por su propio `;`
   * sin comillas en `smtp.helo`. Documenta el comportamiento ACTUAL, igual
   * que el test anterior: no lo aprueba, lo deja visible.
   */
  it('LIMITACION CONOCIDA: el mismo ";" sin comillas tambien fabrica un header.from de mentira', () => {
    const cabecera = 'mx.kubo.com; spf=fail smtp.helo=evil; dmarc=pass header.from=victima.com';
    expect(judgeAuthentication(cabecera, 'mx.kubo.com')).toBe('PASA');
    expect(extractAuthenticatedDomain(cabecera, 'mx.kubo.com')).toBe('victima.com');
  });
});

/**
 * Tanda de cierre, el critico: el ancla contra el identificador del propio
 * servidor. Antes de esto, `evaluateDmarc` descartaba el primer segmento
 * (`.slice(1)`) sin comprobar nunca su contenido -- exactamente lo que un
 * remitente que escribe su propia cabecera `Authentication-Results` DENTRO
 * de su propio mensaje puede fabricar sin ninguna dificultad. Ver "El ancla
 * que faltaba" en el docblock de `judgeAuthentication` para el escenario
 * completo de suplantacion que esto cierra.
 */
describe('judgeAuthentication / extractAuthenticatedDomain: el ancla del identificador de servidor', () => {
  const CABECERA_LIMPIA =
    'mx.kuboti.com; spf=pass smtp.mailfrom=cliente.com; dkim=pass header.d=cliente.com; ' +
    'dmarc=pass header.from=cliente.com';

  it('coincide exactamente: PASA, igual que antes de este ancla', () => {
    expect(judgeAuthenticationReal(CABECERA_LIMPIA, 'mx.kuboti.com')).toBe('PASA');
    expect(extractAuthenticatedDomainReal(CABECERA_LIMPIA, 'mx.kuboti.com')).toBe('cliente.com');
  });

  it('no distingue mayusculas al comparar el identificador', () => {
    expect(judgeAuthenticationReal(CABECERA_LIMPIA, 'MX.KUBOTI.COM')).toBe('PASA');
  });

  it('tolera un numero de version de RFC 8601 tras el identificador (solo se compara el primer token)', () => {
    expect(judgeAuthenticationReal('mx.kuboti.com 1; dmarc=pass header.from=cliente.com', 'mx.kuboti.com')).toBe(
      'PASA',
    );
  });

  /**
   * El escenario del docblock, con el vector completo: un correo que un
   * remitente compuso a mano, con su propia cabecera `Authentication-Results`
   * -- impecable, dmarc=pass, un solo resultado -- pero cuyo primer segmento
   * nombra a nuestro servidor sin serlo de verdad (o nombra cualquier otra
   * cosa: el punto es que NO coincide con lo configurado). Sin el ancla,
   * esto daria PASA; con el ancla, SIN_SERVIDOR_PROPIO -- un veredicto propio,
   * no confundible con "el remitente no autentico".
   */
  it('un identificador que no es el nuestro: SIN_SERVIDOR_PROPIO, no PASA ni FALLA', () => {
    const cabeceraFabricada =
      'mx.kubo.com; spf=pass smtp.mailfrom=evil.com; dkim=pass header.d=evil.com; ' +
      'dmarc=pass header.from=kuboti.com';
    expect(judgeAuthenticationReal(cabeceraFabricada, 'mx.kuboti.com')).toBe('SIN_SERVIDOR_PROPIO');
    expect(extractAuthenticatedDomainReal(cabeceraFabricada, 'mx.kuboti.com')).toBeNull();
  });

  // Fallo cerrado: sin el ajuste configurado, ningun correo autentica nunca
  // -- no importa lo limpia que venga la cabecera.
  it('sin identificador configurado (null): SIN_SERVIDOR_PROPIO siempre, nunca PASA', () => {
    expect(judgeAuthenticationReal(CABECERA_LIMPIA, null)).toBe('SIN_SERVIDOR_PROPIO');
    expect(extractAuthenticatedDomainReal(CABECERA_LIMPIA, null)).toBeNull();
  });

  it('se comprueba antes que SIN_DMARC: un servidor equivocado sin dmarc= sigue siendo SIN_SERVIDOR_PROPIO', () => {
    expect(judgeAuthenticationReal('mx.kubo.com; spf=pass; dkim=pass', 'mx.kuboti.com')).toBe(
      'SIN_SERVIDOR_PROPIO',
    );
  });
});

/**
 * Ronda de correcciones 2 de la Task 8: el septimo intento contra la
 * suplantacion del remitente, y el que cierra la familia entera de una vez
 * -- no analizando mejor el `From`, sino comprobando una invariante que
 * tiene que cumplirse pase lo que pase: el dominio que DMARC certifico
 * (`header.from=`) tiene que ser el mismo que el de la direccion que el
 * sistema usa. Ver el docblock de `extractAuthenticatedDomain` para el
 * porque completo, y `imap-mailbox.service.spec.ts` (describe "los seis
 * vectores") para los seis ataques reales, con el `simpleParser` de verdad,
 * que esta comprobacion cierra sin necesitar acertar ningun analisis del
 * `From`.
 */
describe('extractAuthenticatedDomain', () => {
  it('da el dominio de header.from cuando dmarc pasa', () => {
    expect(
      extractAuthenticatedDomain('mx.kuboti.com; spf=pass; dkim=pass; dmarc=pass header.from=cliente.com'),
    ).toBe('cliente.com');
  });

  it('recorta comillas y pone en minuscula el dominio', () => {
    expect(
      extractAuthenticatedDomain('mx.kuboti.com; dmarc=pass header.from="Cliente.COM"'),
    ).toBe('cliente.com');
  });

  /**
   * Reverso teorico del bug de `mailparser` que `normalizeDomain` cierra
   * (ver su docblock en `domain/message-headers.ts`): un servidor real
   * siempre escribe `header.from=` ya en forma codificada, pero si alguno
   * escribiera la forma con caracteres nacionales, el dominio tiene que
   * normalizar igual a punycode -- la misma forma a la que converge
   * `domainOf(message.from)` del otro lado del cruce.
   */
  it('normaliza a su forma codificada un header.from internacionalizado', () => {
    expect(
      extractAuthenticatedDomain('mx.kuboti.com; dmarc=pass header.from=пример.com'),
    ).toBe('xn--e1afmkfd.com');
  });

  it('null si dmarc no pasa', () => {
    expect(extractAuthenticatedDomain('mx.kuboti.com; dmarc=fail header.from=cliente.com')).toBeNull();
  });

  it('null si no hay ninguna cabecera', () => {
    expect(extractAuthenticatedDomain(null)).toBeNull();
    expect(extractAuthenticatedDomain(undefined)).toBeNull();
  });

  it('null si dmarc pasa pero el segmento no declara header.from', () => {
    expect(extractAuthenticatedDomain('mx.kuboti.com; dmarc=pass')).toBeNull();
  });

  it('null si la cabecera esta comprometida (mismo criterio que judgeAuthentication)', () => {
    const comprometida = 'mx.kuboti.com; spf=fail (razon: (detalle) ; dmarc=pass ) ; dkim=fail; dmarc=fail';
    expect(judgeAuthentication(comprometida)).toBe('FALLA');
    expect(extractAuthenticatedDomain(comprometida)).toBeNull();
  });

  it('null si el valor llega con un salto de linea (cabeceras concatenadas)', () => {
    expect(extractAuthenticatedDomain('mx.kubo.com; spf=pass\nevil.example; dmarc=pass header.from=evil.example')).toBeNull();
  });

  /**
   * Un `header.from=` de mentira colado en OTRO segmento (no en el del
   * `dmarc=pass` legitimo) no debe leerse: la busqueda va sobre el texto del
   * segmento ya aislado, nunca sobre la cabecera entera.
   */
  it('no lee un header.from que aparece fuera del segmento dmarc', () => {
    expect(
      extractAuthenticatedDomain(
        'mx.kuboti.com; spf=pass header.from=victima-falsa.com; dmarc=pass',
      ),
    ).toBeNull();
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

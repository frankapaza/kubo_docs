import { randomBytes } from 'crypto';

import {
  INVITATION_SECRET_BYTES,
  INVITATION_TTL_DAYS,
  fingerprintInvitationSecret,
  generateInvitationSecret,
  invitationExpiryFrom,
  invitationFingerprintsMatch,
  isInvitationExpired,
} from './invitation-secret';

/**
 * `crypto` se sustituye por sí mismo con `randomBytes` envuelto en un espía.
 * No es adorno: sin observar la LLAMADA, un generador semillado, uno sobre
 * `Math.random()` y uno de cuatro bytes rellenados hasta 43 caracteres pasan
 * todas las pruebas de forma que se puedan escribir, porque producen valores
 * con exactamente la misma pinta que el bueno.
 *
 * `jest.spyOn(crypto, 'randomBytes')` no sirve —la propiedad no es
 * redefinible—, de ahí el `jest.mock` con `requireActual`. `createHash` queda
 * intacto: las huellas de este fichero son SHA-256 de verdad.
 */
jest.mock('crypto', () => {
  const real = jest.requireActual('crypto');
  return { ...real, randomBytes: jest.fn(real.randomBytes) };
});

const randomBytesEspia = randomBytes as unknown as jest.Mock;

const ALFABETO_BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const MS_POR_DIA = 24 * 60 * 60 * 1000;

beforeEach(() => {
  randomBytesEspia.mockClear();
});

describe('el secreto de la invitación', () => {
  it('son 32 bytes aleatorios codificados para viajar en una URL', () => {
    expect(INVITATION_SECRET_BYTES).toBe(32);
    const secreto = generateInvitationSecret();
    // base64url de 32 bytes: 43 caracteres, y ninguno de los tres que
    // obligarían a escapar el enlace (`+`, `/`, `=`).
    expect(secreto).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  /**
   * LA PRUEBA QUE DE VERDAD IMPORTA DE ESTE BLOQUE, primera mitad: que la
   * fuente criptográfica del sistema se use, y se le pidan los 32 bytes.
   *
   * Mata al mutante de `Math.random()` y al de un generador semillado —
   * ninguno de los dos llama a `randomBytes`— y al de cuatro bytes rellenados,
   * que la llama con el argumento equivocado.
   */
  it('pide sus bytes a la fuente criptográfica del sistema, y pide los 32', () => {
    generateInvitationSecret();
    expect(randomBytesEspia).toHaveBeenCalledTimes(1);
    expect(randomBytesEspia).toHaveBeenCalledWith(INVITATION_SECRET_BYTES);
  });

  /**
   * Segunda mitad: que el secreto SEA esos bytes. Llamar a `randomBytes(32)`
   * y luego devolver otra cosa —los cuatro primeros bytes repetidos, un valor
   * derivado de un contador, los bytes truncados— pasaría la prueba anterior.
   * Con la fuente fijada, la salida está fijada.
   */
  it('el secreto es exactamente esos bytes en base64url: ni derivado, ni truncado, ni rellenado', () => {
    const bytes = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
    expect(bytes).toHaveLength(INVITATION_SECRET_BYTES);
    randomBytesEspia.mockReturnValueOnce(bytes);

    expect(generateInvitationSecret()).toBe(bytes.toString('base64url'));
  });

  /**
   * Necesaria pero MUY lejos de suficiente: `Math.random()` la pasa, y un
   * contador de 64 bits también. Se queda porque una colisión aquí sería un
   * fallo catastrófico y barato de detectar, no porque demuestre nada sobre la
   * calidad de la fuente.
   */
  it('no se repite: mil secretos seguidos son mil valores distintos', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 1000; i += 1) vistos.add(generateInvitationSecret());
    expect(vistos.size).toBe(1000);
  });

  /**
   * La entropía es la que se dice, y está repartida por los 32 bytes.
   *
   * Mide lo que «salen todos distintos» no mide. El mutante de cuatro bytes de
   * entropía rellenados hasta la longitud correcta produce 256 secretos
   * distintos sin problema, pero 28 de sus 32 bytes valen siempre lo mismo.
   * Aquí se decodifica y se mira byte a byte: con bytes uniformes, 256
   * muestras dejan ~162 valores distintos por posición (256·(1−(255/256)^256));
   * el umbral de 100 tiene margen de sobra para no ser inestable, y está muy
   * por encima del 1 que daría cualquier posición de relleno.
   */
  it('los 32 bytes llevan entropía: ninguna posición es constante ni casi', () => {
    const muestras = 256;
    const porPosicion: Array<Set<number>> = Array.from(
      { length: INVITATION_SECRET_BYTES },
      () => new Set<number>(),
    );

    for (let i = 0; i < muestras; i += 1) {
      const bytes = Buffer.from(generateInvitationSecret(), 'base64url');
      expect(bytes).toHaveLength(INVITATION_SECRET_BYTES);
      bytes.forEach((valor, posicion) => porPosicion[posicion].add(valor));
    }

    const flojas = porPosicion
      .map((valores, posicion) => ({ posicion, distintos: valores.size }))
      .filter(({ distintos }) => distintos < 100);
    expect(flojas).toEqual([]);
  });
});

describe('la huella', () => {
  it('es un SHA-256 en hexadecimal: 64 caracteres, todo [0-9a-f]', () => {
    expect(fingerprintInvitationSecret('lo-que-sea')).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * Vector conocido, escrito a mano. Es lo que fija que la función sea SHA-256
   * del secreto tal cual y no «algún hash de algo»: cualquier mutante que
   * cambie el algoritmo, la codificación de entrada o lo que se hashea muere
   * aquí, aunque siga devolviendo 64 caracteres hexadecimales deterministas.
   */
  it('coincide con el vector conocido de SHA-256', () => {
    expect(fingerprintInvitationSecret('kubo')).toBe(
      '3d2f943602eabf82b8d2ebaf6f14e79c69240433799cb6767e9ce1444956d6bd',
    );
    expect(fingerprintInvitationSecret('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('es determinista: el mismo secreto da siempre la misma huella', () => {
    const secreto = generateInvitationSecret();
    expect(fingerprintInvitationSecret(secreto)).toBe(fingerprintInvitationSecret(secreto));
  });

  it('no contiene el secreto: es lo único que permite guardarla sin guardarlo', () => {
    const secreto = generateInvitationSecret();
    const huella = fingerprintInvitationSecret(secreto);
    expect(huella).not.toContain(secreto);
    expect(huella).not.toBe(secreto);
  });

  /**
   * La huella depende del secreto ENTERO, carácter a carácter.
   *
   * Mata de un golpe al mutante que la calcula solo con el primer carácter
   * —colisión forjada al instante, y esa colisión entra por la clave única de
   * la tabla— y a cualquiera que ignore un tramo, lo trunque o lo recorte:
   * si una sola de las 43 posiciones no cambiara la huella, aquí se ve cuál.
   */
  it('cambiar CADA UNO de los 43 caracteres, uno a uno, cambia la huella', () => {
    const secreto = generateInvitationSecret();
    const original = fingerprintInvitationSecret(secreto);

    const posicionesSordas = [...secreto].flatMap((caracter, posicion) => {
      // Un carácter del alfabeto que no sea el que ya estaba.
      const otro = caracter === 'A' ? 'B' : 'A';
      const variante = secreto.slice(0, posicion) + otro + secreto.slice(posicion + 1);
      return fingerprintInvitationSecret(variante) === original ? [posicion] : [];
    });

    expect(posicionesSordas).toEqual([]);
  });

  /**
   * Y depende de la CAJA de cada carácter. Mata al mutante que pasa el secreto
   * a minúsculas antes de hashearlo: `base64url` distingue `A` de `a`, así que
   * bajar la caja tira entropía de cada carácter alfabético del secreto.
   *
   * Se prueba posición a posición, no con un único ejemplo, para que ningún
   * `toLowerCase` parcial se escape.
   */
  it('cambiar la caja de CADA carácter alfabético cambia la huella', () => {
    const secreto = generateInvitationSecret();
    const original = fingerprintInvitationSecret(secreto);

    const alfabeticas = [...secreto].flatMap((caracter, posicion) =>
      /[A-Za-z]/.test(caracter) ? [posicion] : [],
    );
    expect(alfabeticas.length).toBeGreaterThan(0);

    const posicionesSordas = alfabeticas.filter((posicion) => {
      const caracter = secreto[posicion];
      const volteado =
        caracter === caracter.toLowerCase() ? caracter.toUpperCase() : caracter.toLowerCase();
      const variante = secreto.slice(0, posicion) + volteado + secreto.slice(posicion + 1);
      return fingerprintInvitationSecret(variante) === original;
    });

    expect(posicionesSordas).toEqual([]);
  });

  /**
   * LA PROHIBICIÓN DE DECODIFICAR, fijada con una prueba en vez de con un
   * comentario.
   *
   * 32 bytes ocupan 43 caracteres base64url: 258 bits para 256 de datos. Los
   * dos bits sobrantes del último carácter no representan nada y el
   * decodificador los tira, así que hay exactamente CUATRO cadenas distintas
   * que decodifican a los mismos 32 bytes. Si alguien «normalizara» el secreto
   * decodificándolo antes de hashear, las cuatro colapsarían en una sola
   * huella: cuatro enlaces distintos abrirían la misma invitación, y revocar
   * una por su huella dejaría tres enlaces vivos apuntándola.
   *
   * La primera aserción demuestra la premisa (las cuatro son el mismo byte a
   * byte); la segunda, que la huella no se deja engañar por ella.
   */
  it('cuatro cadenas que decodifican a los mismos bytes dan cuatro huellas distintas', () => {
    const secreto = generateInvitationSecret();
    const valorFinal = ALFABETO_BASE64URL.indexOf(secreto[42]);
    // Los dos bits bajos del carácter 43 son el relleno: cero en el canónico.
    const base = valorFinal & 0b111100;
    const variantes = [0, 1, 2, 3].map(
      (relleno) => secreto.slice(0, 42) + ALFABETO_BASE64URL[base + relleno],
    );

    expect(variantes[0]).toBe(secreto);
    const decodificadas = variantes.map((v) => Buffer.from(v, 'base64url').toString('hex'));
    expect(new Set(decodificadas).size).toBe(1);

    const huellas = variantes.map(fingerprintInvitationSecret);
    expect(new Set(huellas).size).toBe(4);
  });

  /** Ni recorta ni rellena: el secreto no es un correo, no hay nada que limpiar. */
  it('no recorta espacios: el secreto se hashea tal cual llega', () => {
    expect(fingerprintInvitationSecret(' kubo')).not.toBe(fingerprintInvitationSecret('kubo'));
    expect(fingerprintInvitationSecret('kubo ')).not.toBe(fingerprintInvitationSecret('kubo'));
  });

  it('secretos distintos dan huellas distintas', () => {
    expect(fingerprintInvitationSecret('a')).not.toBe(fingerprintInvitationSecret('b'));
  });
});

describe('la comparación de huellas', () => {
  const huella = fingerprintInvitationSecret('kubo');

  it('dos huellas iguales coinciden', () => {
    expect(invitationFingerprintsMatch(huella, fingerprintInvitationSecret('kubo'))).toBe(true);
  });

  it('dos huellas que difieren en un solo carácter no coinciden', () => {
    const distinta = `${huella.slice(0, 63)}${huella[63] === 'a' ? 'b' : 'a'}`;
    expect(invitationFingerprintsMatch(huella, distinta)).toBe(false);
  });

  it('la huella de otro secreto no coincide', () => {
    expect(invitationFingerprintsMatch(huella, fingerprintInvitationSecret('kuba'))).toBe(false);
  });

  /**
   * `timingSafeEqual` LANZA si los búferes miden distinto. Ese detalle
   * convierte la comparación ingenua en un 500 en producción, así que la
   * longitud se filtra antes: devuelve `false`, no una excepción.
   */
  it('longitudes distintas devuelven false en vez de lanzar', () => {
    expect(() => invitationFingerprintsMatch(huella, '')).not.toThrow();
    expect(invitationFingerprintsMatch(huella, '')).toBe(false);
    expect(invitationFingerprintsMatch(huella, huella.slice(0, 63))).toBe(false);
    expect(invitationFingerprintsMatch(huella, `${huella}0`)).toBe(false);
  });

  /**
   * No normaliza la caja, por la misma razón que `fingerprintInvitationSecret`
   * no la normaliza: quien compare huellas debe comparar huellas de este
   * módulo, que son siempre hexadecimal en minúsculas.
   */
  it('no normaliza la caja: la misma huella en mayúsculas no coincide', () => {
    expect(invitationFingerprintsMatch(huella, huella.toUpperCase())).toBe(false);
  });

  it('dos cadenas vacías coinciden, sin lanzar', () => {
    expect(invitationFingerprintsMatch('', '')).toBe(true);
  });
});

describe('la caducidad', () => {
  it('son 7 días exactos contados en milisegundos desde el instante dado', () => {
    expect(INVITATION_TTL_DAYS).toBe(7);
    const ahora = new Date('2026-08-26T15:00:00.000Z');
    expect(invitationExpiryFrom(ahora).toISOString()).toBe('2026-09-02T15:00:00.000Z');
  });

  /**
   * EL FALLO QUE YA HA MORDIDO SEIS VECES EN ESTOS PROYECTOS, cazado de una
   * forma que no depende de la zona del proceso.
   *
   * La versión anterior de esta prueba comparaba `getTime()` contra
   * `ahora.getTime() + 7 días` con una fecha que no cruzaba ningún cambio de
   * hora estacional. Era incapaz de fallar: las pruebas de este repositorio
   * fuerzan `TZ=UTC` en `jest.config.js`, y en UTC —que no tiene horario de
   * verano— `setDate(getDate() + 7)` da EXACTAMENTE el mismo instante que
   * sumar 7·24 h. El mutante que nombraba como enemigo pasaba las cuatro zonas
   * «probadas», y correr con otra zona tampoco lo habría delatado, porque el
   * forzado a UTC se aplica igual.
   *
   * Así que en vez de esperar a que la zona lo delate, se observa la
   * implementación: ningún accesor de fecha CIVIL puede intervenir. Esos son
   * los que leen la zona del proceso; `getTime` y el constructor no. Cualquier
   * cálculo por fecha civil —`setDate`, `getFullYear`, `setHours`— muere aquí,
   * en cualquier zona, con o sin horario de verano.
   */
  it('no toca ni un accesor de fecha civil: solo aritmética sobre el instante absoluto', () => {
    const civiles = [
      'getFullYear',
      'getMonth',
      'getDate',
      'getDay',
      'getHours',
      'getMinutes',
      'getSeconds',
      'getTimezoneOffset',
      'setFullYear',
      'setMonth',
      'setDate',
      'setHours',
      'setMinutes',
      'setSeconds',
    ] as const;
    const espias = civiles.map((nombre) => jest.spyOn(Date.prototype, nombre));

    try {
      const ahora = new Date('2026-08-27T02:30:00.000Z');
      const caduca = invitationExpiryFrom(ahora);
      const usados = civiles.filter((_, i) => espias[i].mock.calls.length > 0);

      expect(usados).toEqual([]);
      expect(caduca.getTime()).toBe(ahora.getTime() + INVITATION_TTL_DAYS * MS_POR_DIA);
    } finally {
      espias.forEach((espia) => espia.mockRestore());
    }
  });

  /**
   * Y qué significa «instante absoluto» cuando SÍ hay un cambio de hora de por
   * medio, dicho con una zona nombrada explícitamente y no con la del proceso.
   *
   * América/Santiago adelanta el reloj en la madrugada del 6 de septiembre de
   * 2026 (UTC−4 → UTC−3). Una invitación creada el 1 de septiembre a las 08:00
   * de Santiago caduca 7·24 h después, que allí son las 09:00 del día 8: el
   * reloj de pared se MUEVE una hora, porque lo que se conserva es el instante,
   * no la hora civil. Un cálculo por fecha civil en esa zona habría dejado las
   * 08:00 y regalado una hora de vida.
   *
   * (Lima no sirve de ejemplo: Perú no cambia la hora desde 1994. Por eso el
   * comentario anterior, que solo nombraba UTC y Lima, no describía ningún
   * caso capaz de distinguir las dos aritméticas.)
   */
  it('conserva el instante, no el reloj de pared, al cruzar un cambio de hora estacional', () => {
    const zona = 'America/Santiago';
    const hora = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', { timeZone: zona, hour: '2-digit', hourCycle: 'h23' }).format(d);
    const dia = (d: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zona,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);

    const ahora = new Date('2026-09-01T12:00:00.000Z'); // 08:00 en Santiago (UTC−4)
    const caduca = invitationExpiryFrom(ahora);

    expect([dia(ahora), hora(ahora)]).toEqual(['2026-09-01', '08']);
    expect([dia(caduca), hora(caduca)]).toEqual(['2026-09-08', '09']);
    expect(caduca.toISOString()).toBe('2026-09-08T12:00:00.000Z');
  });

  it('una invitación cuyo instante de caducidad ya pasó está caducada', () => {
    const ahora = new Date('2026-08-26T15:00:00.000Z');
    expect(isInvitationExpired(new Date('2026-08-26T14:59:59.999Z'), ahora)).toBe(true);
  });

  it('el instante exacto de caducidad ya no sirve', () => {
    const ahora = new Date('2026-08-26T15:00:00.000Z');
    expect(isInvitationExpired(new Date('2026-08-26T15:00:00.000Z'), ahora)).toBe(true);
  });

  it('una invitación con caducidad futura no está caducada', () => {
    const ahora = new Date('2026-08-26T15:00:00.000Z');
    expect(isInvitationExpired(new Date('2026-08-26T15:00:00.001Z'), ahora)).toBe(false);
  });

  /**
   * TypeORM hidrata `DATETIME` como `Date`, pero un driver o un doble de
   * prueba puede devolver la cadena. Se admite, SIEMPRE que traiga el desfase
   * horario escrito: `Z`, `+HH:MM` o `-HHMM`. Con desfase, la cadena nombra un
   * instante y las dos formas dan el mismo veredicto.
   */
  it('acepta la caducidad como cadena CON desfase y decide igual que con un Date', () => {
    const ahora = new Date('2026-08-26T15:00:00.000Z');
    expect(isInvitationExpired('2026-08-26T14:00:00.000Z', ahora)).toBe(true);
    expect(isInvitationExpired('2026-08-26T14:00:00+00:00', ahora)).toBe(true);
    // 09:00 en Lima (UTC−5) son las 14:00 UTC: el mismo instante de arriba.
    expect(isInvitationExpired('2026-08-26T09:00:00.000-05:00', ahora)).toBe(true);
    expect(isInvitationExpired('2026-08-27T14:00:00.000Z', ahora)).toBe(false);
    expect(isInvitationExpired('2026-08-27T09:00:00.000-0500', ahora)).toBe(false);
  });

  /**
   * FALLO CERRADO ANTE UNA CADENA SIN ZONA. La mina de esta función.
   *
   * `Date.parse('2026-09-02 15:00:00')` NO devuelve las 15:00 UTC: devuelve
   * las 15:00 de la zona del PROCESO. Y ese formato —sin `T` y sin desfase— es
   * exactamente el que devuelve MySQL para un `DATETIME` en una consulta
   * cruda, algo que la fuente de datos alternativa del proyecto, que no fija
   * `timezone`, hará llegar aquí en cuanto alguien escriba una.
   *
   * Todas estas caducidades están en el FUTURO si se las lee ingenuamente, así
   * que la prueba muere en cuanto alguien devuelva el `Date.parse` a pelo, y
   * muere en cualquier zona: en América/Lima porque la invitación muerta
   * seguiría cinco horas viva, y en UTC —la zona que fuerza `jest.config.js`—
   * porque la cadena se leería como un instante futuro y daría `false`.
   */
  it.each([
    ['2026-09-02 15:00:00', 'formato de MySQL crudo'],
    ['2026-09-02T15:00:00', 'ISO sin desfase'],
    ['2026-09-02T15:00:00.000', 'ISO con milisegundos y sin desfase'],
    ['2026-09-02', 'fecha suelta, que no nombra ningún instante'],
  ])('una caducidad en cadena sin desfase horario (%s: %s) se trata como caducada', (valor) => {
    expect(isInvitationExpired(valor, new Date('2026-08-26T15:00:00.000Z'))).toBe(true);
  });

  /**
   * Fallo cerrado. Una caducidad que no se puede interpretar NO puede
   * significar "todavía sirve": eso es decidir por la ausencia de un valor en
   * vez de por el hecho que lo determina, el defecto recurrente del proyecto.
   */
  it.each([
    ['', 'cadena vacía'],
    ['no-es-una-fecha', 'basura'],
    ['2026-13-45T99:99:99Z', 'con la forma correcta pero imposible'],
  ])('una caducidad ilegible (%s, %s) se trata como caducada', (valor) => {
    expect(isInvitationExpired(valor, new Date('2026-08-26T15:00:00.000Z'))).toBe(true);
  });

  it('una caducidad Invalid Date se trata como caducada', () => {
    expect(isInvitationExpired(new Date('basura'), new Date('2026-08-26T15:00:00.000Z'))).toBe(true);
  });

  /**
   * El otro lado de la misma guarda, que faltaba: un «ahora» ilegible.
   *
   * `x <= NaN` es `false` igual que `NaN <= x`, así que sin esta guarda una
   * invitación de hace año y medio se aceptaría como viva. Que el reloj no se
   * pueda leer no puede abrir puertas.
   */
  it('un «ahora» ilegible se trata como caducado, igual que una caducidad ilegible', () => {
    const hace18Meses = new Date('2025-02-26T15:00:00.000Z');
    expect(isInvitationExpired(hace18Meses, new Date('basura'))).toBe(true);
    expect(isInvitationExpired(hace18Meses, new Date(NaN))).toBe(true);
    // Y tampoco por el lado de una caducidad futura, que es el caso que un
    // `NaN` sin guarda dejaría pasar sin que se notara nunca.
    expect(isInvitationExpired(new Date('2099-01-01T00:00:00.000Z'), new Date(NaN))).toBe(true);
  });
});

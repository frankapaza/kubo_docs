import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * El secreto de una invitación al portal, su huella y su caducidad.
 *
 * Dominio puro: no consulta la base, no manda correo y **no lee el reloj**.
 * El instante actual entra siempre por argumento, igual que los conteos en
 * `inbound-email/domain/throttle.ts`. Que no lea el reloj es lo que permite
 * probar la caducidad sin esperar siete días y, sobre todo, sin que el
 * resultado dependa de la zona del proceso: producción corre en UTC y el host
 * de desarrollo en América/Lima.
 */

/**
 * 32 bytes de fuente criptográfica. No un identificador secuencial, no una
 * marca de tiempo, no un identificador con formato adivinable: este valor es
 * lo único que separa a un desconocido de una credencial válida.
 */
export const INVITATION_SECRET_BYTES = 32;

/** Días que vive una invitación. */
export const INVITATION_TTL_DAYS = 7;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Un secreto nuevo, codificado para viajar dentro de una dirección web.
 *
 * `base64url` y no `hex`: mismos 32 bytes de entropía en 43 caracteres en vez
 * de 64, y sin ninguno de los tres caracteres (`+`, `/`, `=`) que obligarían a
 * escapar el enlace —un enlace que además va a pasar por clientes de correo
 * que reescriben URLs.
 *
 * `randomBytes` y nunca `Math.random()` ni un generador semillado, y los 32
 * bytes enteros y nunca cuatro rellenados hasta la longitud correcta. El spec
 * comprueba la llamada a la fuente criptográfica y su argumento, no solo la
 * forma del resultado: un generador predecible o recortado produce secretos
 * con exactamente la misma pinta —43 caracteres de `[A-Za-z0-9_-]`, todos
 * distintos entre sí— y ninguna prueba de forma lo distinguiría del bueno.
 */
export function generateInvitationSecret(): string {
  return randomBytes(INVITATION_SECRET_BYTES).toString('base64url');
}

/**
 * La huella del secreto: lo ÚNICO que se guarda en la base.
 *
 * SHA-256 a secas y no bcrypt, a diferencia de una contraseña. La razón no es
 * la comodidad: bcrypt existe para encarecer el ataque por diccionario contra
 * un valor que una persona eligió y que por tanto tiene poca entropía. Aquí el
 * valor son 256 bits de `randomBytes` —no hay diccionario que probar— y en
 * cambio sí hace falta poder BUSCAR por la huella con un índice único, cosa
 * que un hash con sal distinta por fila impide por construcción.
 *
 * Lo que sí comparte con bcrypt es lo que importa: no se puede deshacer. Quien
 * lea la base no obtiene ningún enlace utilizable.
 *
 * PROHIBIDO «normalizar» el secreto antes de calcular la huella. En concreto:
 *
 * 1. **No lo decodifiques.** La tentación es «trabajar con los bytes de
 *    verdad»: `createHash('sha256').update(Buffer.from(secret, 'base64url'))`.
 *    Sería un fallo de seguridad. 32 bytes ocupan 43 caracteres base64url, o
 *    sea 258 bits para 256 de datos: los DOS bits sobrantes del carácter 43 no
 *    representan nada y el decodificador los tira. Por eso hay exactamente
 *    CUATRO cadenas distintas —las que solo difieren en esos dos bits— que
 *    decodifican a los mismos 32 bytes. Hashear los bytes las colapsaría en
 *    una sola huella: cuatro enlaces distintos abrirían la misma invitación, y
 *    una invitación revocada por su huella seguiría teniendo tres enlaces
 *    vivos apuntándola. Se hashea la CADENA que viaja en el enlace, tal cual
 *    llega.
 * 2. **No le cambies la caja.** `base64url` distingue mayúsculas de
 *    minúsculas: `A` y `a` son valores distintos. Un `.toLowerCase()` aquí
 *    tiraría entropía de cada carácter alfabético del secreto.
 * 3. **No lo recortes ni lo rellenes.** No es un correo; no hay nada que
 *    normalizar. Lo que no case, no case.
 *
 * El spec fija las tres con pruebas que mueren si alguien lo «arregla».
 */
export function fingerprintInvitationSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Si dos huellas son la misma, en tiempo constante.
 *
 * **Aquí la seguridad no depende de esto**, y conviene dejarlo escrito para
 * que nadie lo quite creyendo que sobra ni lo copie creyendo que basta. El
 * canal de temporización de una comparación byte a byte se explota midiendo lo
 * que tarda el servidor y ajustando la entrada carácter a carácter. Ese ataque
 * aquí no existe, porque lo que el atacante controla es el SECRETO, y el
 * secreto se hashea antes de comparar: cambiarle un bit le cambia la huella
 * entera de forma impredecible, así que no hay ninguna señal que seguir.
 * Hashear la entrada que controla el atacante es lo que cierra ese canal; esta
 * función no.
 *
 * Se exporta igualmente por dos razones. La primera es que es la comparación
 * correcta y hay ocho tareas por delante que van a comparar huellas: mejor una
 * decisión tomada una vez aquí que ocho `===` sueltos, cada uno con su duda.
 * La segunda es que el día que alguien compare un valor que el atacante SÍ
 * controla sin hashear —un código corto de un solo uso, por ejemplo—, la
 * herramienta ya está y se llama por su nombre.
 *
 * No normaliza nada: ni caja, ni recorte, ni relleno. Compara los bytes de las
 * dos cadenas tal cual, por la misma razón que `fingerprintInvitationSecret`.
 * Longitudes distintas devuelven `false` sin llamar a `timingSafeEqual` —que
 * lanzaría—, y eso filtra la longitud, no el contenido: las huellas de este
 * módulo son siempre 64 caracteres hexadecimales, así que no hay longitud que
 * filtrar.
 */
export function invitationFingerprintsMatch(a: string, b: string): boolean {
  const bytesA = Buffer.from(a ?? '', 'utf8');
  const bytesB = Buffer.from(b ?? '', 'utf8');
  if (bytesA.length !== bytesB.length) return false;
  return timingSafeEqual(bytesA, bytesB);
}

/** El instante en que caduca una invitación creada en `now`. */
export function invitationExpiryFrom(now: Date): Date {
  // Aritmética sobre milisegundos absolutos, nunca `setDate`/`getFullYear`:
  // esos leen la zona horaria del proceso y darían un instante distinto en
  // producción (UTC) y en el host de desarrollo (América/Lima).
  return new Date(now.getTime() + INVITATION_TTL_DAYS * MS_POR_DIA);
}

/**
 * Un instante ISO-8601 con desfase horario EXPLÍCITO: `Z`, `+HH:MM` o `-HHMM`.
 *
 * Lo que este patrón rechaza es justo lo peligroso: `2026-09-02 15:00:00`,
 * `2026-09-02T15:00:00` y `2026-09-02T15:00:00.000`, las formas sin zona. Y
 * también la fecha suelta (`2026-09-02`), que no nombra ningún instante.
 */
const INSTANTE_CON_DESFASE =
  /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})$/;

/**
 * Si esa invitación ya caducó.
 *
 * El instante exacto de caducidad cuenta como caducado (`<=`): en la frontera,
 * la respuesta que no da acceso es la correcta.
 *
 * Todo lo que no se pueda comparar como instante absoluto se trata como
 * CADUCADO. Fallo cerrado, en los tres frentes:
 *
 * 1. **Caducidad ilegible** —cadena vacía, basura, `Invalid Date`—. Un `NaN`
 *    comparado sin guarda cede hacia «todavía sirve» (`NaN <= x` es siempre
 *    `false`), que es la dirección equivocada.
 * 2. **`now` ilegible.** El mismo `NaN` por el otro lado: `x <= NaN` también es
 *    `false`, y una invitación de hace año y medio pasaría por viva. Que el
 *    reloj no se pueda leer no puede abrir puertas.
 * 3. **Cadena sin desfase horario explícito.** Este es el frente que no se ve,
 *    y es el que hace que el comentario anterior de esta función —«comparando
 *    dos instantes absolutos»— fuera falso: `Date.parse('2026-09-02 15:00:00')`
 *    NO devuelve las 15:00 UTC, devuelve las 15:00 de la zona del PROCESO. En
 *    el host de desarrollo (América/Lima, UTC-5) eso son las 20:00 UTC, y un
 *    enlace muerto hace una hora se aceptaría durante cinco horas más; en
 *    Asia/Tokyo (UTC+9) el desplazamiento va al otro lado y un enlace vivo se
 *    rechazaría nueve horas antes de tiempo. Ese formato sin zona es
 *    exactamente el que devuelve MySQL para un `DATETIME` en una consulta
 *    cruda.
 *
 *    Hoy no es alcanzable —el mapeo de TypeORM hidrata `expiresAt` como
 *    `Date`—, pero la fuente de datos alternativa del proyecto no fija
 *    `timezone`, así que la primera consulta cruda que alguien escriba llegará
 *    aquí con la cadena.
 *
 *    Se **rechaza** en lugar de suponerla UTC. Suponerla sería adivinar: sin
 *    `timezone` fijado en la conexión, el driver serializa según la zona del
 *    proceso que ESCRIBIÓ la fila, que es UTC en producción y Lima en
 *    desarrollo, así que no hay una respuesta correcta que deducir de la
 *    cadena — y no se deduce ninguna. Rechazar niega el acceso, que es la
 *    dirección segura, y además hace el problema ruidoso el primer día en vez
 *    de silencioso durante meses. Quien tenga una cadena que pasar: que pase
 *    un `Date`, o una cadena con `Z`.
 */
export function isInvitationExpired(expiresAt: Date | string, now: Date): boolean {
  const ahora = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(ahora)) return true;

  const instante =
    expiresAt instanceof Date
      ? expiresAt.getTime()
      : INSTANTE_CON_DESFASE.test(String(expiresAt))
        ? Date.parse(expiresAt)
        : NaN;
  if (!Number.isFinite(instante)) return true;

  return instante <= ahora;
}

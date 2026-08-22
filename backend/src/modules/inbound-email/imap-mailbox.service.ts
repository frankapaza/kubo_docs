import { createHash } from 'crypto';

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { ParsedMail, simpleParser } from 'mailparser';

import { IncomingMessage, Mailbox } from './mailbox.interface';
import { ResolvedImapConfig, WorkspaceService } from '../workspace/workspace.service';

/**
 * El adaptador de correo real: conecta al buzón por IMAP, lee, convierte a
 * `IncomingMessage` y marca. **Ninguna decisión de negocio vive aquí** --
 * nada de autenticación, remitente propio, correos automáticos, límites ni
 * plantillas. Por eso el recorrido completo (`InboundEmailService.drain`) se
 * prueba entero sin red, con un doble trivial de `Mailbox`; este archivo es
 * la única pieza que sí necesita un buzón de verdad delante, y por eso las
 * únicas partes suyas que este archivo prueba sin red son las funciones
 * puras exportadas más abajo (`imap-mailbox.service.spec.ts`) -- una parte de
 * ellas contra un `simpleParser` real, sin doblar, precisamente porque la
 * regla más importante de este fichero es un supuesto sobre las tripas de esa
 * dependencia.
 *
 * ## Las tres trampas que este adaptador tiene que esquivar
 *
 * 1. **`Authentication-Results`: solo la más externa.** Un correo que pasó
 *    por varios saltos trae varias cabeceras con ese nombre, y el remitente
 *    puede haber escrito la suya propia dentro de su propio mensaje. Si se
 *    entregaran unidas (o la que no toca), `judgeAuthentication`
 *    (`domain/intake-rules.ts`) podría leer un `dmarc=pass` que escribió el
 *    atacante. Esa función ya se niega en seco si recibe un valor con salto
 *    de línea -- es su defensa contra una concatenación descuidada -- pero
 *    este adaptador no debe llegar a ponerla en esa situación: `buildRawHeaders`
 *    toma la cabecera tal como aparece **primero** en el bloque de cabeceras
 *    (el orden de archivo, no un `Map` que ya las mezcló), que es justo la
 *    que cualquier MTA añade encima de lo que ya traía el mensaje al
 *    recibirlo -- nunca las junta.
 *
 * 2. **`from`: la dirección que `mailparser` ya analizó, nunca su
 *    re-serialización.** Ronda de correcciones 1 -- el fallo más grave que ha
 *    tenido este proyecto: la primera versión entregaba `parsed.from.text`,
 *    confiando en que `extractSenderAddress`
 *    (`domain/message-headers.ts`) lo desenvolvería después con
 *    `/<([^>]+)>/`. Pero `.text` es una **re-serialización** de
 *    `nombre + dirección` en una sola cadena, y RFC 5322 permite que el
 *    nombre para mostrar sea una `quoted-string` que contenga sus propios
 *    `<`/`>` sin escapar (una comilla sí necesitaría escape; un ángulo, no).
 *    Un remitente puede mandar:
 *
 *    ```
 *    From: "Soporte <victima@kuboti.com>" <atacante@evil.com>
 *    ```
 *
 *    `parsed.from.value[0].address` -- el resultado del propio analizador de
 *    direcciones de `mailparser`, consciente de comillas y comentarios --
 *    dice correctamente `atacante@evil.com`. Pero `parsed.from.text`
 *    reconstruye `'"Soporte <victima@kuboti.com>" <atacante@evil.com>'`, y el
 *    regex ingenuo de `extractSenderAddress` toma el **primer** `<...>` que
 *    encuentra: `victima@kuboti.com`. Y DMARC no lo frena -- no tiene por qué:
 *    valida el dominio de la dirección real del sobre, `evil.com`, que el
 *    atacante controla y para el que publica su propio SPF/DKIM/DMARC. A
 *    partir de ahí el atacante ES la víctima para el resto del recorrido:
 *    escribe en su hilo, abre tickets a su nombre, y si la víctima es del
 *    personal, su mensaje entra como nota interna.
 *
 *    Por eso `extractFromAddress` lee `parsed.from.value[0].address`
 *    directamente y solo cae a `.text` si esa lista viniera vacía (un `From`
 *    que solo es un grupo, sin ninguna dirección directa -- rarísimo, y sin
 *    ninguna dirección "correcta" que perder frente a esa alternativa). No es
 *    "entregar la dirección tal cual llegó, para que la desenvuelva
 *    `extractSenderAddress`" -- es reconocer que `mailparser` ya hizo, con una
 *    gramática completa, el trabajo que esa función solo aproxima con un
 *    regex, y que reconstruir su resultado a texto para volver a analizarlo
 *    con la aproximación más pobre es un paso atrás, no una traducción.
 *
 * 3. **Solo texto, nunca HTML.** `chooseTextBody` prefiere `text/plain`; si
 *    el correo solo trae HTML, `stripHtmlToText` lo convierte y garantiza --
 *    en código, no solo en prosa -- que el resultado no contiene `<` ni `>`
 *    (ronda de correcciones 1: la primera versión decodificaba `&lt;`/`&gt;`
 *    **después** de quitar las etiquetas, así que `&lt;script&gt;` volvía a
 *    convertirse en `<script>` en el texto final). Esta garantía es sobre la
 *    **conversión**, no sobre el cuerpo en general: una parte `text/plain`
 *    nunca pasa por `stripHtmlToText` -- es texto legítimo tal cual lo
 *    escribió alguien, y un `<`/`>` ahí (una URL con angle brackets, un
 *    fragmento de código pegado, la vieja costumbre de escribir
 *    `<correo@dominio.com>` en texto plano) no es marcado que neutralizar.
 *
 * ## `mailboxRef` lleva el UIDVALIDITY, y se comprueba al marcar
 *
 * Un UID de IMAP solo es estable dentro del par (carpeta, UIDVALIDITY): tras
 * una reconexión donde ese valor cambie -- la carpeta se recreó, o el
 * servidor reasignó los UID --, el mismo número puede apuntar a otro
 * mensaje. `encodeMailboxRef` mete el UIDVALIDITY en la propia referencia, y
 * `markProcessed` la compara contra el UIDVALIDITY de la carpeta **en el
 * instante de marcar** (se relee en cada llamada, no se guarda de cuando se
 * leyó el correo) antes de tocar ninguna bandera: si no coincide, no marca
 * nada y lo deja para la vuelta siguiente -- marcar el mensaje equivocado es
 * peor que no marcar ninguno.
 *
 * Un fallo al marcar (por esto o por cualquier otra razón: red, permisos)
 * nunca pierde el correo en silencio: `InboundEmailsRepository` deduplica por
 * `Message-ID` (clave única sobre `inbound_emails.message_id`), así que un
 * correo no marcado simplemente se reprocesa en la próxima pasada y se
 * descarta como duplicado sin crear un segundo ticket ni un segundo mensaje.
 * Degrada a "se reprocesa pero se deduplica", nunca a "se pierde".
 *
 * **La referencia NO incluye la carpeta.** Si el interruptor apunta a otra
 * carpeta más adelante, dos UIDVALIDITY de carpetas distintas podrían, en
 * teoría, coincidir por casualidad y confundir una referencia vieja con un
 * correo nuevo de la otra carpeta. Este proyecto solo lee una carpeta a la
 * vez -- cambiarla es un cambio de configuración manual, no algo que ocurra
 * en caliente --, así que se acepta el hueco en vez de complicar la
 * referencia por un caso que hoy no puede darse en la práctica; queda
 * anotado en el informe de la Task 8 como limitación conocida.
 *
 * ## El "lock" de la carpeta se pide y se suelta en cada operación
 *
 * `getMailboxLock` no es "abrir la carpeta": es un cerrojo de exclusión
 * mutua que, mientras se retiene, **suspende el keepalive/IDLE automático**
 * de `imapflow`. Retenerlo entre pasadas (o entre `fetchUnprocessed` y cada
 * `markProcessed` de la misma pasada) dejaría la conexión sin latido durante
 * el minuto de espera del reloj, y un firewall o el propio servidor podría
 * cortarla sin que nada se entere hasta el siguiente intento. Por eso cada
 * método que toca la carpeta (`fetchUnprocessed`, `markProcessed`) pide su
 * propio candado y lo suelta en un `finally`, tanto si la operación sale bien
 * como si revienta a medias -- la conexión TCP (`this.client`) sí se
 * mantiene entre llamadas mientras siga usable, eso es lo que evita
 * reconectar y volver a autenticar en cada correo.
 */
@Injectable()
export class ImapMailboxService implements Mailbox, OnModuleDestroy {
  private readonly logger = new Logger(ImapMailboxService.name);

  /** La conexión TCP/IMAP en curso, o `null` si no hay ninguna abierta. */
  private client: ImapFlow | null = null;

  constructor(private readonly workspace: WorkspaceService) {}

  async onModuleDestroy(): Promise<void> {
    await this.closeQuietly();
  }

  async fetchUnprocessed(limit: number): Promise<IncomingMessage[]> {
    const config = await this.requireConfig();
    const client = await this.ensureConnected(config);

    const lock = await client.getMailboxLock(config.folder);
    try {
      const mailbox = client.mailbox;
      if (mailbox === false) {
        throw new Error(`No se pudo abrir la carpeta IMAP "${config.folder}".`);
      }
      const uidValidity = mailbox.uidValidity.toString();

      // "No procesado" se traduce aquí como "no leído" (`\Seen`), y marcar
      // como "procesado" pone esa misma bandera (ver `markProcessed`). Es una
      // decisión de política, no un hecho del protocolo -- IMAP no tiene un
      // concepto de "ingerido por Kubo" --, y se apoya en la única bandera
      // estándar disponible sin depender de que el servidor admita banderas
      // (`keywords`) definidas por el cliente. El precio: cualquiera que abra
      // este buzón en un webmail o un cliente de correo y lo lea (o cuyo
      // cliente marque como leído al previsualizar) hace desaparecer esos
      // correos de la ingesta **en silencio** -- nunca se procesan, y tampoco
      // queda un `ERROR` que avise, porque desde este lado son indistinguibles
      // de un correo que ya procesamos nosotros. El buzón de ingesta debe
      // tratarse como de uso exclusivo del sistema.
      const uids = await client.search({ seen: false }, { uid: true });
      if (uids === false || uids.length === 0) return [];

      // Los UID más bajos primero: son los correos más antiguos sin marcar.
      // Con un lote más grande que el límite, procesar por orden de llegada
      // es lo que evita que un correo viejo se quede esperando para siempre
      // detrás de una fuente constante de correos nuevos.
      const toFetch = [...uids].sort((a, b) => a - b).slice(0, limit);

      const messages: IncomingMessage[] = [];
      for (const uid of toFetch) {
        const fetched = await client.fetchOne(uid, { source: true }, { uid: true });
        // El servidor puede no devolver nada si el mensaje desapareció entre
        // el `search` y el `fetch` (alguien lo borró o lo movió a mano) -- no
        // es un error de este correo en concreto, se salta.
        if (!fetched || !fetched.source) continue;

        const parsed = await simpleParser(fetched.source);
        messages.push(toIncomingMessage(parsed, uid, uidValidity, fetched.source));
      }
      return messages;
    } finally {
      lock.release();
    }
  }

  async markProcessed(mailboxRef: string): Promise<void> {
    const parsedRef = decodeMailboxRef(mailboxRef);
    if (!parsedRef) {
      this.logger.error(
        `mailboxRef con forma inesperada, no se marca: "${mailboxRef}". Se reprocesará en la ` +
          'próxima pasada; la clave única de Message-ID evita que se duplique nada.',
      );
      return;
    }

    const config = await this.requireConfig();
    const client = await this.ensureConnected(config);

    const lock = await client.getMailboxLock(config.folder);
    try {
      const mailbox = client.mailbox;
      const uidValidity = mailbox === false ? null : mailbox.uidValidity.toString();

      if (uidValidity !== parsedRef.uidValidity) {
        this.logger.warn(
          `No se marca el correo (uid ${parsedRef.uid}, uidValidity ${parsedRef.uidValidity}): la ` +
            `carpeta tiene ahora UIDVALIDITY ${uidValidity ?? 'desconocido'} (se recreó, o no se pudo ` +
            'abrir). Se reprocesará en la próxima pasada; la clave única de Message-ID evita que se ' +
            'duplique nada -- marcar aquí sería arriesgarse a marcar el mensaje equivocado.',
        );
        return;
      }

      // Un fallo de aquí en adelante (red, permisos, un buzón montado de solo
      // lectura) sube tal cual: lo captura y registra `InboundEmailService.drain`,
      // que ya sabe que un fallo al marcar solo significa "se reprocesa y se
      // deduplica" (ver el docblock de esta clase). Un buzón de solo lectura
      // hace que ESTA llamada falle siempre, para siempre: la ingesta no
      // pierde nada, pero tampoco avanza nunca -- reprocesa el mismo lote sin
      // parar. No hay forma de detectar "de solo lectura" de antemano sin
      // intentarlo, así que no se distingue aquí de cualquier otro fallo de
      // permisos.
      await client.messageFlagsAdd(parsedRef.uid, ['\\Seen'], { uid: true });
    } finally {
      lock.release();
    }
  }

  /** La config IMAP, o un error explícito si la ingesta está encendida sin buzón configurado del todo. */
  private async requireConfig(): Promise<ResolvedImapConfig> {
    const config = await this.workspace.getImapConfig();
    if (!config) {
      throw new Error(
        'La ingesta de correo está encendida pero el buzón IMAP no está configurado del todo ' +
          '(servidor, usuario y contraseña). Configúralo en Datos del emisor → IMAP.',
      );
    }
    return config;
  }

  /**
   * Devuelve la conexión IMAP, reconectando si hace falta. La configuración
   * se relee de `WorkspaceService` en cada llamada (el propio `requireConfig`,
   * llamado antes de esta función por cada operación pública), nunca se
   * guarda entre pasadas -- es el mismo criterio que `EmailService.getSmtpConfig`,
   * y es lo que permite que encender el interruptor o cambiar la contraseña
   * surta efecto sin reiniciar el backend, a partir de la próxima reconexión.
   */
  private async ensureConnected(config: ResolvedImapConfig): Promise<ImapFlow> {
    if (this.client !== null && this.client.usable) {
      return this.client;
    }
    await this.closeQuietly();

    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      logger: false,
    });

    await client.connect();
    this.client = client;
    return client;
  }

  /** Cierra la conexión en curso, si hay una, sin dejar que un fallo al cerrar tumbe nada. */
  private async closeQuietly(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      await client.logout();
    } catch (error) {
      // Cerrar es cortesía hacia el servidor, no una operación de la que
      // dependa la corrección de nada: la conexión ya se olvidó arriba, así
      // que la próxima llamada abrirá una nueva de todos modos.
      this.logger.warn(`No se pudo cerrar la conexión IMAP anterior con cortesía: ${errorText(error)}`);
    }
  }
}

/** El texto de un error, venga de donde venga. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Traduce un mensaje ya parseado a `IncomingMessage`. Función libre (no
 * método) para poder probarla sin instanciar la clase ni tocar `imapflow`.
 */
function toIncomingMessage(
  parsed: ParsedMail,
  uid: number,
  uidValidity: string,
  rawSource: Buffer,
): IncomingMessage {
  const rawHeaders = buildRawHeaders(parsed.headerLines);

  return {
    mailboxRef: encodeMailboxRef(uidValidity, uid),
    messageId: parsed.messageId ?? syntheticMessageId(rawSource),
    from: extractFromAddress(parsed),
    subject: parsed.subject ?? null,
    sentAt: parsed.date ?? null,
    textBody: chooseTextBody(parsed),
    headers: rawHeaders,
    authenticationResults: rawHeaders['authentication-results'] ?? null,
    // Sin filtrar por `related` (las imágenes incrustadas de una firma o un
    // cuerpo HTML, referenciadas por `cid:`): decidir qué adjunto le importa
    // ver a alguien es una decisión de negocio, no una traducción, y filtrar
    // aquí corría además el riesgo de hacer desaparecer un adjunto genuino
    // (un correo reenviado como archivo) si alguna vez compartiera esa
    // marca. Se entrega la lista tal cual la ve `mailparser`; que el ruido de
    // una firma con logo merezca ocultarse es algo que puede decidir --y
    // probarse-- en `InboundEmailService` si hace falta.
    attachmentNames: parsed.attachments.map((a) => a.filename).filter((name): name is string => !!name),
  };
}

/**
 * La referencia opaca que `Mailbox.markProcessed` recibe de vuelta: el
 * UIDVALIDITY de la carpeta que leyó el mensaje, y su UID dentro de ella. Las
 * dos cosas hacen falta -- un UID por sí solo no identifica nada de forma
 * estable, ver el docblock de la clase.
 */
export function encodeMailboxRef(uidValidity: string, uid: number): string {
  return `${uidValidity}:${uid}`;
}

/** El inverso de `encodeMailboxRef`. `null` si `ref` no tiene esa forma. */
export function decodeMailboxRef(ref: string): { uidValidity: string; uid: number } | null {
  const match = /^(\d+):(\d+)$/.exec(ref);
  if (!match) return null;
  return { uidValidity: match[1], uid: Number(match[2]) };
}

/**
 * La dirección del remitente, tal como la extrajo el propio analizador de
 * direcciones de `mailparser` -- **nunca** `parsed.from.text`. Ver el punto 2
 * del docblock de la clase para el porqué exacto: `.text` es una
 * re-serialización de nombre+dirección que no escapa los `<`/`>` que el
 * nombre pueda contener (RFC 5322 sí lo permite dentro de una
 * `quoted-string`), y volver a analizar esa cadena con el regex ingenuo de
 * `extractSenderAddress` puede tomar el `<...>` equivocado -- el que el
 * remitente escondió dentro de su propio nombre para mostrar, no el de su
 * dirección real.
 *
 * Solo cae a `.text` cuando `value` viene vacío: un `From` que es puramente
 * un grupo de direcciones sin ninguna dirección directa es rarísimo, y ahí no
 * hay ninguna "dirección correcta" que perder frente a esa alternativa --
 * `extractSenderAddress`, aguas abajo, seguirá sin encontrar un `<...>` fiable
 * en ese caso tampoco, así que no se está renunciando a nada que sí
 * funcionara.
 */
export function extractFromAddress(parsed: Pick<ParsedMail, 'from'>): string {
  return parsed.from?.value?.[0]?.address ?? parsed.from?.text ?? '';
}

/**
 * Un `Message-ID` sintético para el correo -- vanishingly raro, pero RFC 5322
 * no lo exige, así que un mensaje real puede llegar sin cabecera `Message-ID`
 * en absoluto (distinto del caso, ya cubierto por `normalizeMessageId`, de
 * una cabecera no-ASCII). `IncomingMessage.messageId` no admite `null`, y un
 * valor constante (p. ej. cadena vacía) haría que dos correos DISTINTOS sin
 * esta cabecera colisionaran en la clave única de `inbound_emails` -- el
 * segundo se leería como "ya procesado" y se perdería en silencio.
 *
 * **Hash del contenido crudo del mensaje, no de `(uidValidity, uid)`.** La
 * primera versión de esta función usaba esas dos claves y era estable frente
 * a un reinicio a medio procesar, pero NO frente al suceso que todo este
 * archivo existe para manejar: si la carpeta se recrea (UIDVALIDITY cambia),
 * el mismo correo -- byte a byte idéntico -- recibiría un sustituto distinto
 * la segunda vez, y `inbound_emails` lo trataría como un mensaje nuevo:
 * segundo ticket para el mismo correo. Un hash sobre los bytes crudos del
 * mensaje es estable frente a las dos cosas a la vez: releer el mismo correo
 * (mismo UID, misma UIDVALIDITY) tras una caída da el mismo hash, y releerlo
 * con un UID/UIDVALIDITY distintos tras recrearse la carpeta también -- es el
 * mismo mensaje, byte a byte, en ambos casos.
 *
 * Es, con todo, una decisión de política (qué hacer cuando falta un dato),
 * no una traducción pura -- y se aísla aquí, exportada y con su propia
 * prueba, precisamente porque el contrato de `IncomingMessage.messageId`
 * (Task 6) no admite otra salida: exige un `string` siempre, así que algún
 * valor hay que producir.
 */
export function syntheticMessageId(rawSource: Buffer): string {
  const hash = createHash('sha256').update(rawSource).digest('hex');
  return `<sin-message-id.${hash}@buzon-imap.invalid>`;
}

/**
 * Aplana una cabecera plegada (RFC 5322 §2.2.3: una continuación empieza con
 * un espacio o un tabulador tras el salto de línea) a una sola línea. Es la
 * defensa propia del adaptador -- además de lo que ya haga `mailparser` -- de
 * que ningún valor que salga de aquí lleve un salto de línea:
 * `judgeAuthentication` se niega en seco si lo recibe así (ver el docblock de
 * la clase), y este adaptador no debe llegar nunca a ponerla en esa
 * situación.
 */
function unfold(value: string): string {
  return value.replace(/[\r\n]+[ \t]*/g, ' ').trim();
}

/**
 * Las cabeceras crudas de un mensaje, en minúscula y **sin plegar**, tomando
 * solo la **primera** aparición de cada nombre repetido -- el orden de
 * `headerLines` es el orden real del bloque de cabeceras del mensaje (RFC
 * 5322: cada salto prepende las suyas encima de lo que ya traía), así que la
 * primera aparición de `Authentication-Results` es, siempre, la que añadió el
 * servidor que nos entregó el correo. Cualquier otra copia de esa cabecera
 * más abajo -- un salto anterior, o el propio remitente escribiéndola dentro
 * de su mensaje -- se descarta, nunca se une a la primera.
 *
 * Se construye a mano desde `headerLines` (el array de líneas crudas) y no
 * desde `parsed.headers` (el `Map` ya interpretado de mailparser): ese `Map`
 * decide por su cuenta, cabecera por cabecera, cuándo colapsar una lista de
 * apariciones a un solo valor y con qué criterio (el de `mailparser`, no el
 * de este proyecto) -- una dependencia de un detalle interno de la librería
 * que además podría no coincidir con "la primera es la que importa" para
 * `authentication-results` en concreto.
 *
 * Exportada para poder probarla sin red: es la pieza que sostiene la regla
 * más importante de este adaptador, y `imap-mailbox.service.spec.ts` la
 * ejercita también contra el `simpleParser` real (sin doblar), no solo con
 * `headerLines` fabricadas a mano.
 */
export function buildRawHeaders(
  headerLines: ReadonlyArray<{ key: string; line: string }>,
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const { key, line } of headerLines) {
    if (key in record) continue; // conserva solo la primera aparición
    const colon = line.indexOf(':');
    const rawValue = colon === -1 ? '' : line.slice(colon + 1);
    record[key] = unfold(rawValue);
  }
  return record;
}

/**
 * Quita etiquetas de un HTML de forma burda pero segura: **garantiza** que el
 * resultado no contiene `<` ni `>`, sea cual sea la entrada -- es lo único
 * que de verdad importa aquí, el resultado no se vuelve a interpretar como
 * HTML en ningún sitio del recorrido, así que no hace falta un parser
 * completo.
 *
 * **Ronda de correcciones 1**: la versión anterior decodificaba
 * `&lt;`/`&gt;` a `<`/`>` **después** de quitar las etiquetas reales, así que
 * `<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>` -- que tras quitar el `<p>`
 * real se queda como el texto `&lt;script&gt;alert(1)&lt;/script&gt;` --
 * volvía a convertirse en `<script>alert(1)</script>` en el resultado final:
 * exactamente el marcado que esta función existe para no dejar pasar. La
 * corrección tiene dos capas, no una: `&lt;`/`&gt;` ya **no se decodifican en
 * absoluto** (esas dos entidades son las únicas capaces de reintroducir el
 * carácter prohibido; el resto -- `&amp;`, `&quot;`, `&#39;`, `&nbsp;` -- no
 * puede producir un `<`/`>` y se decodifican con normalidad), y además una
 * pasada final barre cualquier `<`/`>` que quedara por cualquier otro motivo
 * (una etiqueta mal formada que el regex de arriba no reconociera). La
 * garantía queda así escrita en código, no solo prometida en un comentario.
 */
function stripHtmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
    .replace(/[<>]/g, ''); // red de seguridad: nunca debe hacer falta, pero la garantía no depende de que las reglas de arriba acierten siempre.
}

/**
 * El cuerpo de texto de un mensaje: `text/plain` si lo hay -- `mailparser` ya
 * lo entrega decodificado, y se entrega **tal cual**, sin pasar por ningún
 * limpiador -- y una conversión propia de HTML a texto si el correo solo
 * trae HTML. `mailparser` genera él mismo una versión en texto a partir del
 * HTML en el caso común (un mensaje de una sola parte), pero no en todos --
 * un `multipart/mixed` con un único hijo `text/html` y un adjunto no dispara
 * esa conversión interna --, así que este adaptador nunca confía en que
 * `parsed.text` esté poblado solo porque el correo "debería" tener texto: si
 * viene vacío y hay HTML, lo convierte él mismo con `stripHtmlToText`, que sí
 * garantiza un resultado sin `<`/`>`.
 *
 * **La garantía "nunca HTML" es sobre la conversión, no sobre el cuerpo en
 * general.** Un `text/plain` que alguien escribió con un `<` o un `>` a
 * propósito (una URL entre ángulos, un fragmento de código, la vieja
 * costumbre de poner `<correo@dominio.com>` en un pie de firma de texto
 * plano) se entrega exactamente así: no es marcado que neutralizar, es texto
 * legítimo, y "limpiarlo" lo corrompería sin necesidad. Solo el HTML
 * **convertido** por `stripHtmlToText` lleva esa garantía absoluta.
 *
 * Un mensaje sin ninguna de las dos partes (rarísimo, pero posible: un correo
 * de solo asunto, o solo adjuntos) da cadena vacía, no `null`: el resto del
 * recorrido ya sabe tratar un cuerpo vacío como "sin nada que publicar" (ver
 * `DESCARTADO_SIN_CONTENIDO` en `InboundEmailService`).
 */
export function chooseTextBody(parsed: Pick<ParsedMail, 'text' | 'html'>): string {
  if (parsed.text && parsed.text.trim().length > 0) return parsed.text;
  if (parsed.html) return stripHtmlToText(parsed.html);
  return '';
}

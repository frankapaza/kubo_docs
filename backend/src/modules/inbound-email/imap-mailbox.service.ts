import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { ParsedMail, simpleParser } from 'mailparser';

import { IncomingMessage, Mailbox } from './mailbox.interface';
import { WorkspaceService } from '../workspace/workspace.service';

/**
 * El adaptador de correo real: conecta al buzón por IMAP, lee, convierte a
 * `IncomingMessage` y marca. **Ninguna decisión de negocio vive aquí** --
 * nada de autenticación, remitente propio, correos automáticos, límites ni
 * plantillas. Por eso el recorrido completo (`InboundEmailService.drain`) se
 * prueba entero sin red, con un doble trivial de `Mailbox`; este archivo es
 * la única pieza que sí necesita un buzón de verdad delante, y por eso las
 * únicas partes suyas que este archivo prueba sin red son las funciones
 * puras exportadas más abajo (`imap-mailbox.service.spec.ts`).
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
 *    este adaptador no debe llegar a ponerla en esa situación: `rawHeaderOf`
 *    toma la cabecera tal como aparece **primero** en el bloque de cabeceras
 *    (el orden de archivo, no un `Map` que ya las mezcló), que es justo la
 *    que cualquier MTA añade encima de lo que ya traía el mensaje al
 *    recibirlo -- nunca las junta.
 * 2. **`from`: se entrega tal cual llega.** `IncomingMessage.from` documenta
 *    que puede traer nombre para mostrar (`"Ana Quispe" <ana@empresa.com>`) y
 *    que nadie más que `extractSenderAddress` debe desenvolverla. Este
 *    adaptador no la toca -- sería la decisión equivocada tomada en el sitio
 *    equivocado.
 * 3. **Solo texto, nunca HTML.** `chooseTextBody` prefiere `text/plain`; si
 *    el correo solo trae HTML, lo convierte. `IncomingMessage.textBody`
 *    nunca lleva una etiqueta.
 *
 * ## `mailboxRef` lleva el UIDVALIDITY, y se comprueba al marcar
 *
 * Un UID de IMAP solo es estable dentro del par (carpeta, UIDVALIDITY): tras
 * una reconexión donde ese valor cambie -- la carpeta se recreó, o el
 * servidor reasignó los UID --, el mismo número puede apuntar a otro
 * mensaje. `encodeMailboxRef` mete el UIDVALIDITY de la sesión en la propia
 * referencia, y `markProcessed` la compara contra el UIDVALIDITY de la
 * sesión IMAP actual antes de tocar ninguna bandera: si no coincide, no
 * marca nada y lo deja para la vuelta siguiente -- marcar el mensaje
 * equivocado es peor que no marcar ninguno.
 *
 * Un fallo al marcar (por esto o por cualquier otra razón: red, permisos)
 * nunca pierde el correo en silencio: `InboundEmailsRepository` deduplica por
 * `Message-ID` (clave única sobre `inbound_emails.message_id`), así que un
 * correo no marcado simplemente se reprocesa en la próxima pasada y se
 * descarta como duplicado sin crear un segundo ticket ni un segundo mensaje.
 * Degrada a "se reprocesa pero se deduplica", nunca a "se pierde".
 */
@Injectable()
export class ImapMailboxService implements Mailbox, OnModuleDestroy {
  private readonly logger = new Logger(ImapMailboxService.name);

  /**
   * La sesión IMAP en curso, o `null` si no hay ninguna abierta. Se abre en
   * el primer `fetchUnprocessed` de una pasada y se mantiene -- no se cierra
   * al volver -- para que los `markProcessed` de esa misma pasada (llamados
   * uno por uno por `InboundEmailService.drain`, después de procesar cada
   * correo) puedan usarla sin reconectar por cada mensaje. Solo se cierra y
   * se vuelve a abrir cuando deja de ser usable o cuando el módulo se
   * destruye.
   */
  private session: { client: ImapFlow; uidValidity: string; folder: string } | null = null;

  constructor(private readonly workspace: WorkspaceService) {}

  async onModuleDestroy(): Promise<void> {
    await this.closeQuietly();
  }

  async fetchUnprocessed(limit: number): Promise<IncomingMessage[]> {
    const client = await this.ensureSession();

    const uids = await client.search({ seen: false }, { uid: true });
    if (uids === false || uids.length === 0) return [];

    // Los más antiguos primero: son los que llevan más tiempo esperando.
    const toFetch = [...uids].sort((a, b) => a - b).slice(0, limit);

    const messages: IncomingMessage[] = [];
    for (const uid of toFetch) {
      const fetched = await client.fetchOne(uid, { source: true }, { uid: true });
      // El servidor puede no devolver nada si el mensaje desapareció entre el
      // `search` y el `fetch` (alguien lo borró o lo movió a mano) -- no es un
      // error de este correo en concreto, se salta.
      if (!fetched || !fetched.source) continue;

      const parsed = await simpleParser(fetched.source);
      messages.push(this.toIncomingMessage(parsed, uid));
    }
    return messages;
  }

  async markProcessed(mailboxRef: string): Promise<void> {
    const parsed = decodeMailboxRef(mailboxRef);
    if (!parsed) {
      this.logger.error(
        `mailboxRef con forma inesperada, no se marca: "${mailboxRef}". Se reprocesará en la ` +
          'próxima pasada; la clave única de Message-ID evita que se duplique nada.',
      );
      return;
    }

    if (this.session === null || this.session.uidValidity !== parsed.uidValidity) {
      this.logger.warn(
        `No se marca el correo (uid ${parsed.uid}, uidValidity ${parsed.uidValidity}): la sesión ` +
          'IMAP actual no tiene ese mismo UIDVALIDITY (la carpeta se reabrió o se recreó desde que ' +
          'se leyó este correo). Se reprocesará en la próxima pasada; la clave única de Message-ID ' +
          'evita que se duplique nada -- marcar aquí sería arriesgarse a marcar el mensaje equivocado.',
      );
      return;
    }

    // Un fallo de aquí en adelante (red, permisos) sube tal cual: lo captura
    // y registra `InboundEmailService.drain`, que ya sabe que un fallo al
    // marcar solo significa "se reprocesa y se deduplica" (ver el comentario
    // de esta clase).
    await this.session.client.messageFlagsAdd(parsed.uid, ['\\Seen'], { uid: true });
  }

  /**
   * Traduce un mensaje ya parseado a `IncomingMessage`. `uid` (no el
   * `mailboxRef` todavía) porque la referencia se construye aquí mismo, con
   * el UIDVALIDITY de la sesión que lo leyó.
   */
  private toIncomingMessage(parsed: ParsedMail, uid: number): IncomingMessage {
    const session = this.session!; // ensureSession() ya la dejó abierta antes de llamar aquí.
    const rawHeaders = buildRawHeaders(parsed.headerLines);

    const attachmentNames = parsed.attachments
      // `related: true` son las imágenes incrustadas de una firma o un
      // cuerpo HTML (referenciadas por `cid:`), no algo que el remitente
      // adjuntó a propósito -- y de todos modos nunca se muestra el HTML que
      // las referenciaba. Contarlas como adjuntos sería ruido que nadie pidió
      // ver.
      .filter((a) => !a.related)
      .map((a) => a.filename)
      .filter((name): name is string => !!name);

    return {
      mailboxRef: encodeMailboxRef(session.uidValidity, uid),
      messageId: parsed.messageId ?? syntheticMessageId(session.uidValidity, uid),
      from: parsed.from?.text ?? '',
      subject: parsed.subject ?? null,
      sentAt: parsed.date ?? null,
      textBody: chooseTextBody(parsed),
      headers: rawHeaders,
      authenticationResults: rawHeaders['authentication-results'] ?? null,
      attachmentNames,
    };
  }

  /**
   * Devuelve el cliente IMAP con una carpeta abierta y lista para leer,
   * reconectando si hace falta. La configuración se relee de
   * `WorkspaceService` en **cada** intento de (re)conexión, nunca se guarda
   * en este servicio más allá de la sesión en curso: es el mismo criterio que
   * `EmailService.getSmtpConfig`, y es lo que permite que encender el
   * interruptor o cambiar la contraseña surta efecto sin reiniciar el
   * backend -- a partir de la próxima vez que haga falta reconectar.
   */
  private async ensureSession(): Promise<ImapFlow> {
    if (this.session !== null && this.session.client.usable) {
      return this.session.client;
    }
    await this.closeQuietly();

    const config = await this.workspace.getImapConfig();
    if (!config) {
      throw new Error(
        'La ingesta de correo está encendida pero el buzón IMAP no está configurado del todo ' +
          '(servidor, usuario y contraseña). Configúralo en Datos del emisor → IMAP.',
      );
    }

    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      logger: false,
    });

    await client.connect();
    await client.getMailboxLock(config.folder);
    // `client.mailbox` queda con la carpeta ya seleccionada tras el lock.
    const mailbox = client.mailbox;
    if (mailbox === false) {
      await client.logout().catch(() => undefined);
      throw new Error(`No se pudo abrir la carpeta IMAP "${config.folder}".`);
    }

    this.session = { client, uidValidity: mailbox.uidValidity.toString(), folder: config.folder };
    return client;
  }

  /** Cierra la sesión en curso, si hay una, sin dejar que un fallo al cerrar tumbe nada. */
  private async closeQuietly(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (!session) return;
    try {
      await session.client.logout();
    } catch (error) {
      // Cerrar es cortesía hacia el servidor, no una operación de la que
      // dependa la corrección de nada: la sesión ya se olvidó arriba, así que
      // la próxima llamada abrirá una nueva de todos modos.
      this.logger.warn(`No se pudo cerrar la sesión IMAP anterior con cortesía: ${errorText(error)}`);
    }
  }
}

/** El texto de un error, venga de donde venga. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * La referencia opaca que `Mailbox.markProcessed` recibe de vuelta: el
 * UIDVALIDITY de la sesión que leyó el mensaje, y su UID dentro de ella. Las
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
 * Un `Message-ID` sintético para el correo -- vanishingly raro, pero RFC 5322
 * no lo exige, así que un mensaje real puede llegar sin cabecera `Message-ID`
 * en absoluto (distinto del caso, ya cubierto por `normalizeMessageId`, de
 * una cabecera no-ASCII). `IncomingMessage.messageId` no admite `null`, y
 * un valor constante (p. ej. cadena vacía) haría que dos correos DISTINTOS
 * sin esta cabecera colisionaran en la clave única de `inbound_emails` -- el
 * segundo se leería como "ya procesado" y se perdería en silencio.
 *
 * Determinista sobre (uidValidity, uid): el mismo mensaje, releído tras un
 * reinicio a medio procesar, produce el mismo sintético y la deduplicación
 * sigue funcionando; dos mensajes reales distintos (UID distinto) nunca
 * colisionan. El marcador `sin-message-id.` y el dominio `.invalid` (RFC
 * 2606) dejan claro, para quien mire la tabla, que esto no es lo que mandó
 * nadie.
 */
function syntheticMessageId(uidValidity: string, uid: number): string {
  return `<sin-message-id.${uidValidity}.${uid}@buzon-imap.invalid>`;
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
 * más importante de este adaptador.
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
 * Quita etiquetas de un HTML de forma burda pero segura: nunca deja pasar
 * `<`/`>`, que es lo único que de verdad importa aquí -- el resultado no se
 * vuelve a interpretar como HTML en ningún sitio del recorrido, así que no
 * hace falta un parser completo, solo la garantía de que no queda marcado.
 * El contenido de `<script>`/`<style>` se descarta entero: no es texto que
 * nadie escribió para leer.
 */
function stripHtmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * El cuerpo de texto de un mensaje: `text/plain` si lo hay -- `mailparser` ya
 * lo entrega decodificado y sin marcado --, y una conversión propia de HTML a
 * texto si el correo solo trae HTML. `mailparser` genera él mismo una versión
 * en texto a partir del HTML en el caso común (un mensaje de una sola parte),
 * pero no en todos -- un `multipart/mixed` con un único hijo `text/html` y un
 * adjunto no dispara esa conversión interna --, así que este adaptador nunca
 * confía en que `parsed.text` esté poblado solo porque el correo "debería"
 * tener texto: si viene vacío y hay HTML, lo convierte él mismo. El resultado
 * nunca lleva una etiqueta -- ver `stripHtmlToText`.
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

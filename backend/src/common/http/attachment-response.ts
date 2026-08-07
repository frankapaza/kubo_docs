import { Response } from 'express';
import { pipeline } from 'stream/promises';

/**
 * Lo que hace falta para servir un adjunto por HTTP.
 *
 * Se declara aquí, estructuralmente, y no se importa de `ticket-messages`: eso
 * dejaría a `common/` dependiendo de un módulo. `AttachmentDownload`, que es lo
 * que devuelve `TicketAttachmentsService.download`, encaja tal cual.
 */
export interface ServableAttachment {
  /** El flujo del fichero, **ya con su oyente de `error`** (ver `openOrFail`). */
  stream: NodeJS.ReadableStream;
  /** El nombre para mostrar: el que subió quien lo subió, saneado. Puede no ser ASCII. */
  filename: string;
  /** El nombre para la cabecera: ASCII imprimible, sin comillas, sin `;` y sin `%`. */
  headerFilename: string;
  /** El tipo **detectado** por firma de bytes en la subida, nunca el declarado. */
  mimeType: string;
  size: number;
}

/**
 * Los caracteres que `encodeURIComponent` deja pasar y que **no** son
 * `attr-char` (RFC 5987 §3.2.1): `!`, `'`, `(`, `)`, `*`. `~`, `-`, `.` y `_`
 * sí lo son y se quedan como están.
 *
 * `sanitizeFilename` ya quita el `'`, el `*` y el `%` del nombre guardado, pero
 * la cabecera no debe apoyarse en eso: quien la compone tiene que emitir un
 * `ext-value` válido con cualquier cadena que le den.
 */
const NO_ATTR_CHAR = /[!'()*]/g;

/**
 * El nombre real, codificado como el `ext-value` de la RFC 5987.
 *
 * Es lo que hace que al cliente le llegue `facturación.pdf` y no
 * `facturacion.pdf`. **Es una mejora, no la defensa**: la defensa es que el
 * `filename=` de al lado sea `headerFilename`, que es ASCII por construcción.
 */
function rfc5987(filename: string): string {
  return encodeURIComponent(filename).replace(
    NO_ATTR_CHAR,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * La cabecera `Content-Disposition` de una descarga.
 *
 * **Siempre `attachment`.** Nunca `inline`, ni siquiera para las imágenes, y
 * eso no es exceso de celo: existen ficheros que son a la vez un PNG válido y
 * un HTML válido, la detección por firma de bytes los ve como PNG (solo mira la
 * cabecera del fichero) y no hay antivirus detrás. Servir eso en línea lo
 * ejecutaría en el origen de la aplicación. Junto con `nosniff` es la segunda
 * barrera del diseño (spec §4, regla 3), y la única que cubre ese caso.
 *
 * **`filename=` lleva `headerFilename` y no `filename`.** Los dos nombres que
 * devuelve el servicio no son intercambiables: `headerFilename` es ASCII
 * imprimible sin comillas, sin `;` y sin `%`, y promete poder interpolarse aquí
 * sin comprobar nada. `filename` es el original, y con un solo carácter fuera
 * de ASCII (`文件.pdf`, `foto😀.png`) `res.setHeader` lanza `ERR_INVALID_CHAR`:
 * un 500 que cualquiera provoca subiendo un fichero con un nombre legítimo.
 * Fue un defecto real, y por eso vive en un solo sitio.
 *
 * El nombre de verdad viaja detrás, en la forma codificada, que es donde sí
 * cabe. Los clientes que la entienden (todos los navegadores actuales) usan
 * esa; los que no, se quedan con la ASCII y descargan igual.
 */
function contentDisposition(download: ServableAttachment): string {
  return `attachment; filename="${download.headerFilename}"; filename*=UTF-8''${rfc5987(download.filename)}`;
}

/**
 * Sirve el adjunto **forzando la descarga**, y suelta el flujo pase lo que pase.
 *
 * Vive en `common/` porque las dos puertas de descarga -- el panel y el portal
 * -- tienen que servir exactamente igual. Repartir estas cuatro cabeceras en
 * dos ficheros es cómo una de las dos se queda sin `nosniff` el día que alguien
 * toque solo una: la regla 3 del diseño no admite una versión por controlador.
 *
 * **Las dos de seguridad, primero.** Si escribir el nombre llegara a lanzar, lo
 * que quedaría escrito en la respuesta ya obliga a descargar; al revés, el
 * filtro global serviría su JSON de error encima de un `Content-Type:
 * image/png` sin `nosniff`. Hoy es inalcanzable --el servicio garantiza que
 * `headerFilename` es ASCII imprimible-- pero el orden no cuesta nada y no
 * depende de esa garantía.
 *
 * **`pipeline` y no `stream.pipe(res)`.**
 *
 * `pipe` no limpia: si el cliente se va a mitad de la descarga --cerrar la
 * pestaña, perder la cobertura, pulsar atrás: lo más normal que hace un
 * usuario-- la respuesta muere y **el flujo de lectura se queda abierto**, con
 * su descriptor de fichero. Los descriptores no se recuperan solos: se acumulan
 * hasta el límite del proceso y entonces falla *todo*, no solo las descargas,
 * semanas después y sin parecerse a su causa. Medido: 60 abortos dejaban +58
 * manejadores con `.pipe()` y ninguno con `pipeline`. `pipeline` destruye los
 * dos extremos en todos los caminos -- fin normal, error de origen y cliente
 * que se va -- y ese es el motivo principal de usarlo.
 *
 * De paso resuelve el otro: `pipeline` mira el estado del origen en vez de
 * esperar un evento, así que un flujo que **ya** falló --el `ENOENT` que llega
 * antes de que nadie más escuche-- se ve igual y la petición se cierra en vez
 * de quedarse colgada con su `Content-Length` y sin cuerpo.
 *
 * El rechazo se traga **a propósito**, y aquí no se pierde nada: el fallo de
 * lectura ya lo registró el servicio con la clave concreta (ver `openOrFail`),
 * y el otro caso --`ERR_STREAM_PREMATURE_CLOSE`, el cliente que aborta-- no es
 * un error, es un martes. Dejarlo escapar sería peor que inútil: las cabeceras
 * ya salieron, así que el filtro global intentaría escribir su JSON sobre una
 * respuesta que `pipeline` acaba de destruir.
 *
 * Quien llama tiene que haber obtenido el `download` **antes**: si el servicio
 * lanza su 404, no se ha escrito ninguna cabecera y el filtro global puede
 * contestar con su JSON de siempre.
 */
export async function serveAttachment(
  res: Response,
  download: ServableAttachment,
): Promise<void> {
  res.setHeader('Content-Disposition', contentDisposition(download));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', download.mimeType);
  res.setHeader('Content-Length', String(download.size));

  await pipeline(download.stream, res).catch(() => undefined);
}

import { useEffect, useState } from 'react';

import {
  describeAttachmentError,
  type AttachmentBlobFetcher,
} from '../../api/ticket-messages.api';
import { isPreviewableImage } from './attachment-screening';

/**
 * La miniatura de un adjunto **ya guardado**, pintada desde memoria.
 *
 * El problema que resuelve: el endpoint de descarga está detrás del guard, y una
 * etiqueta `<img>` no manda la cabecera `Authorization`. Apuntar su `src` a
 * `/attachments/12/download` produce una petición anónima que el backend corta,
 * y en pantalla queda el icono de imagen rota. No hay ningún truco de HTML que
 * lo arregle: hay que pedir el archivo por JavaScript, con la instancia de axios
 * que lleva el token de esta superficie, y pintar los bytes que vuelven.
 *
 * De ahí que el componente reciba un `fetcher` en vez de importar uno: el panel
 * le pasa `ticketMessagesApi` y el portal `portalTicketMessagesApi`, cada uno
 * con su token. Elegirlo aquí dentro con un booleano sería la forma de mandar
 * algún día la petición del panel firmada con la sesión del cliente.
 *
 * **Lo que se hace con el objeto, y lo que no.** La URL `blob:` que sale de
 * aquí se usa **solo** como `src` de este `<img>`. Nunca se navega a ella: ni
 * `window.open`, ni un `<a href>` que la envuelva, ni `location`. Una `blob:`
 * hereda el origen de la aplicación, y ni el `Content-Disposition: attachment`
 * ni el `X-Content-Type-Options: nosniff` que el servidor puso en la respuesta
 * viajan con el objeto -- se quedan en la respuesta HTTP. Un archivo que sea a
 * la vez PNG válido y HTML válido pasa la detección por firma del backend (que
 * solo mira la cabecera del archivo) y, navegado, se ejecutaría en este dominio.
 * Como `<img src>` no se ejecuta nada: si no es una imagen de verdad, no pinta.
 * Para guardarlo en disco está `saveAttachmentToDisk`, que usa un ancla con
 * `download` y no navega.
 *
 * El tipo del `Blob` lo pone `fetchAttachmentBlob` con el `Content-Type` de la
 * respuesta --el que el backend detectó por los bytes al subirlo-- comprobado
 * contra la lista blanca. Nunca el que adivinaría el navegador.
 */
interface AttachmentImageProps {
  attachmentId: number;
  /** Para el `alt`, que es lo que lee quien no ve la imagen. */
  filename: string;
  /** El tipo que publicó el backend. Decide si hay algo que previsualizar. */
  mimeType: string;
  /**
   * El lado que pregunta: `ticketMessagesApi` o `portalTicketMessagesApi`.
   *
   * **Tiene que ser una referencia estable.** Está en las dependencias del
   * efecto que trae los bytes, así que un objeto creado en línea
   * (`fetcher={{ fetchAttachmentBlob: (id) => … }}`) es distinto en cada
   * renderizado: el efecto se vuelve a lanzar, `setObjectUrl` provoca otro
   * renderizado y la miniatura entra en un bucle de descarga que no para. Los
   * dos objetos de `ticket-messages.api.ts` son constantes de módulo y valen
   * tal cual; cualquier otra cosa, por `useMemo`.
   */
  fetcher: AttachmentBlobFetcher;
  className?: string;
}

export function AttachmentImage({
  attachmentId,
  filename,
  mimeType,
  fetcher,
  className = '',
}: AttachmentImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewable = isPreviewableImage(mimeType);

  useEffect(() => {
    if (!previewable) return;

    // `cancelled` corta el camino tardío y `created` guarda la URL para que la
    // limpieza la revoque en el camino normal.
    let cancelled = false;
    let created: string | null = null;

    fetcher
      .fetchAttachmentBlob(attachmentId)
      .then((blob) => {
        const url = URL.createObjectURL(blob);

        // **La revocación del camino tardío se hace aquí, no en la limpieza.**
        //
        // Si la respuesta llega después de desmontar, la limpieza ya corrió
        // --con `created` todavía a `null`, así que no revocó nada-- y no
        // vuelve a correr nunca. Una URL creada a partir de este punto no
        // tendría a nadie que la liberase y se quedaría viva hasta recargar la
        // página, reteniendo el objeto entero: abrir un hilo con imágenes y
        // salir antes de que terminen de cargar deja hasta 10 MB por adjunto
        // colgados. Guardarla en `created` tampoco valdría: la limpieza que la
        // leería ya pasó.
        //
        // Se crea y se revoca en vez de mirar `cancelled` antes de crear porque
        // así la protección no depende de que entre la comprobación y el
        // `setObjectUrl` no llegue nunca a colarse un `await`.
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }

        created = url;
        setObjectUrl(url);
        setError(null);
      })
      .catch(async (failure: unknown) => {
        // Ningún fallo en silencio: si la miniatura no se puede traer, se dice.
        const described = await describeAttachmentError(failure);
        if (cancelled) return;
        setObjectUrl(null);
        setError(described.message);
      });

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
      setObjectUrl(null);
    };
  }, [attachmentId, fetcher, previewable]);

  if (!previewable) return null;

  if (error) {
    return (
      <p className={`text-xs text-red-600 ${className}`} role="status">
        No se pudo cargar la vista previa de «{filename}». {error}
      </p>
    );
  }

  if (!objectUrl) {
    return (
      <div
        className={`h-24 w-24 animate-pulse rounded-lg bg-slate-100 ${className}`}
        role="status"
        aria-label={`Cargando la vista previa de ${filename}`}
      />
    );
  }

  return (
    <img
      src={objectUrl}
      alt={filename}
      className={`max-h-48 max-w-full rounded-lg border border-slate-200 object-contain ${className}`}
    />
  );
}

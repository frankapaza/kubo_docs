import { useEffect, useRef, useState } from 'react';

import {
  describeAttachmentError,
  portalTicketMessagesApi,
  saveAttachmentToDisk,
} from '../../../api/ticket-messages.api';
import type { PortalTicketAttachment } from '../../../api/types';
import { AttachmentImage, humanSize, isPreviewableImage } from '../../../components/upload';

/**
 * Un adjunto ya guardado, dentro de un mensaje del hilo del **portal**.
 *
 * Es el gemelo de `pages/tickets/thread/ThreadAttachment.tsx` y no una copia por
 * pereza: lo único que comparten es la forma, y lo único que los diferencia es
 * lo que **no** se puede parametrizar sin abrir un agujero. El del panel habla
 * con `ticketMessagesApi` --token del equipo, rutas `/attachments/…`-- y este
 * con `portalTicketMessagesApi` --token del cliente, rutas
 * `/portal/attachments/…`--. Son dos instancias de axios deliberadamente
 * separadas (ver el docblock de `ticket-messages.api.ts`), así que elegir una u
 * otra con un booleano en tiempo de ejecución es exactamente cómo una petición
 * del portal acabaría firmada con la sesión del panel. Aquí no hay elección: el
 * módulo del portal solo sabe nombrar el cliente del portal.
 *
 * Las dos reglas del contrato del componente de subida, cumplidas a propósito:
 *
 * - **El `fetcher` es `portalTicketMessagesApi`, una constante de módulo.** Está
 *   en las dependencias del efecto que trae los bytes; un objeto creado en línea
 *   sería distinto en cada renderizado y la miniatura entraría en un bucle de
 *   descarga que no para.
 * - **A `saveAttachmentToDisk` solo se le pasa lo que devuelve
 *   `fetchAttachmentBlob`.** Esa función acepta cualquier `Blob`, y la garantía
 *   de que el objeto lleva un tipo de la lista blanca la da únicamente quien lo
 *   trae de la API comprobando el `Content-Type` de la respuesta.
 */
export default function PortalThreadAttachment({
  attachment,
}: {
  attachment: PortalTicketAttachment;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La descarga puede tardar y la ficha puede desmontarse por el camino (basta
  // con volver a la lista de tickets): sin esta guarda, la respuesta tardía
  // escribiría en un componente que ya no está.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const download = async () => {
    setDownloading(true);
    setError(null);
    try {
      const blob = await portalTicketMessagesApi.fetchAttachmentBlob(attachment.id);
      if (!alive.current) return;
      saveAttachmentToDisk(blob, attachment.filename);
    } catch (failure) {
      // Ningún fallo en silencio: si el archivo no baja, se dice por qué, con el
      // texto del backend y sin aplanarlo.
      const described = await describeAttachmentError(failure);
      if (!alive.current) return;
      setError(described.message);
    } finally {
      if (alive.current) setDownloading(false);
    }
  };

  const image = isPreviewableImage(attachment.mimeType);

  return (
    <li className="rounded-lg border border-slate-200 bg-white/80 p-2">
      <div className="flex items-center gap-3">
        {!image && (
          <span
            aria-hidden="true"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-500"
          >
            PDF
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-slate-700">
            {attachment.filename}
          </span>
          <span className="block text-[11px] text-slate-500">{humanSize(attachment.size)}</span>
        </span>
        <button
          type="button"
          disabled={downloading}
          onClick={download}
          className="rounded px-2 py-1 text-xs font-medium text-kubo-primary hover:bg-slate-100 disabled:opacity-50"
        >
          {downloading ? 'Descargando…' : 'Descargar'}
        </button>
      </div>

      {image && (
        <AttachmentImage
          attachmentId={attachment.id}
          filename={attachment.filename}
          mimeType={attachment.mimeType}
          fetcher={portalTicketMessagesApi}
          className="mt-2"
        />
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          No se pudo descargar «{attachment.filename}». {error}
        </p>
      )}
    </li>
  );
}

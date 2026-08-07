import type { CSSProperties } from 'react';

import type { TicketAttachment, TicketMessage } from '../../../api/types';
import { VISIBILITY_SKINS } from './message-visibility';
import ThreadAttachment from './ThreadAttachment';

/**
 * Un mensaje del hilo, ya escrito.
 *
 * **El requisito que manda aquí**: una nota interna se tiene que distinguir de
 * una respuesta *sin leer el texto*. Se usan tres señales a la vez, porque una
 * sola falla para alguien:
 *
 * - el **fondo** de la tarjeta entera (ámbar contra blanco), que es lo que se
 *   ve al recorrer la columna con la vista;
 * - el **canto izquierdo rayado**, que sigue funcionando si el fondo se pierde
 *   (impresión, alto contraste, daltonismo);
 * - el **distintivo con el texto** «Nota interna · no la ve el cliente», que es
 *   lo que lee quien va con lupa o con lector de pantalla.
 *
 * Y el `aria-label` del artículo dice el tipo antes que nada, para que un lector
 * de pantalla anuncie «Nota interna…» antes de leer el cuerpo, y no después.
 *
 * Hay un **tercer** aspecto que no es un destino y por eso no sale de
 * `VISIBILITY_SKINS`: el mensaje **entrante** del cliente. Es siempre público
 * (el portal no sabe escribir otra cosa), pero mezclarlo con las respuestas del
 * equipo dejaría el hilo sin saber de un vistazo quién habla. Va en azul y con
 * su propia etiqueta.
 */
export interface ThreadMessageProps {
  message: TicketMessage;
  attachments: TicketAttachment[];
  /** Nombre del autor ya resuelto por quien conoce los catálogos. */
  authorName: string;
}

interface Look {
  chip: string;
  chipClass: string;
  cardClass: string;
  railStyle: CSSProperties;
  /** Cómo se lee este mensaje en voz alta antes del cuerpo. */
  spoken: string;
}

const INCOMING: Look = {
  chip: 'Mensaje del cliente',
  chipClass: 'bg-sky-100 text-sky-900 ring-1 ring-inset ring-sky-300',
  cardClass: 'border-sky-200 bg-sky-50/70',
  railStyle: { background: '#0284c7' },
  spoken: 'Mensaje del cliente',
};

function lookFor(message: TicketMessage): Look {
  if (message.visibility === 'INTERNA') {
    const skin = VISIBILITY_SKINS.INTERNA;
    return {
      chip: skin.chip,
      chipClass: skin.chipClass,
      cardClass: skin.cardClass,
      railStyle: skin.railStyle,
      spoken: 'Nota interna, que el cliente no ve',
    };
  }

  // Público y firmado del lado del cliente: es entrante.
  if (message.authorClientUserId !== null) return INCOMING;

  const skin = VISIBILITY_SKINS.PUBLICA;
  return {
    chip: skin.chip,
    chipClass: skin.chipClass,
    cardClass: skin.cardClass,
    railStyle: skin.railStyle,
    spoken: 'Respuesta que leyó el cliente',
  };
}

export default function ThreadMessage({ message, attachments, authorName }: ThreadMessageProps) {
  const look = lookFor(message);
  const fecha = new Date(message.createdAt).toLocaleString('es-PE');

  return (
    <article
      aria-label={`${look.spoken}, de ${authorName}, ${fecha}`}
      data-visibility={message.visibility}
      className={`relative overflow-hidden rounded-xl border pl-4 pr-3 py-3 ${look.cardClass}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1.5"
        style={look.railStyle}
      />

      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${look.chipClass}`}>
          {look.chip}
        </span>
        <span className="text-xs font-medium text-slate-700">{authorName}</span>
        <span className="ml-auto font-mono text-[11px] text-slate-500">{fecha}</span>
      </header>

      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">
        {message.bodyMd}
      </p>

      {attachments.length > 0 && (
        <ul className="mt-3 space-y-2">
          {attachments.map((attachment) => (
            <ThreadAttachment key={attachment.id} attachment={attachment} />
          ))}
        </ul>
      )}
    </article>
  );
}

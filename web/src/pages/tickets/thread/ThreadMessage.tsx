import type { CSSProperties } from 'react';

import type { TicketAttachment, TicketMessage, TicketMessageVisibility } from '../../../api/types';
import { VISIBILITY_SKINS } from './message-visibility';
import ThreadAttachment from './ThreadAttachment';

/**
 * Un mensaje del hilo, ya escrito.
 *
 * **El requisito que manda aquí**: una nota interna se tiene que distinguir de
 * una respuesta *sin leer el texto*, y **también cuando el color no llega**.
 * Cuatro señales, cada una para un medio distinto:
 *
 * 1. el **fondo** de la tarjeta entera (ámbar contra blanco), que es lo que se
 *    ve al recorrer la columna con la vista en pantalla;
 * 2. el **canto izquierdo rayado**, que añade una textura al color;
 * 3. el **borde discontinuo** de toda la tarjeta -- una nota interna va con
 *    trazo de puntos y una respuesta con trazo continuo. Es la señal que
 *    sobrevive al papel de verdad: un borde es trazo, no relleno, así que se
 *    imprime aunque el navegador descarte los fondos;
 * 4. el **distintivo con el texto** «Nota interna · no la ve el cliente» y, solo
 *    al imprimir, una línea entera que lo dice sin abreviar.
 *
 * **Lo que se aprendió por las malas y no se puede volver a romper.** La
 * cabecera de este mensaje era un `<header>`, y `web/src/index.css` tiene una
 * regla global `header { display: none !important }` dentro de `@media print`.
 * Impresa, la tarjeta perdía el distintivo, el autor y la fecha: una nota
 * interna quedaba **indistinguible de una respuesta al cliente** justo en el
 * medio en el que alguien podría enseñarle esa hoja al cliente. Por eso la
 * cabecera es un `<div>` y por eso las señales de arriba no son todas de color.
 * Si alguien vuelve a poner aquí un elemento de sección (`header`, `nav`,
 * `aside`), lo está desactivando al imprimir sin enterarse.
 *
 * `print-color-adjust: exact` se pide igualmente, para que el ámbar salga
 * cuando el navegador lo permita; pero **no se depende de él**: el usuario
 * puede desactivar los gráficos de fondo en el diálogo de impresión, y ahí solo
 * quedan el trazo discontinuo y el texto.
 *
 * El `aria-label` del artículo dice el tipo antes que nada, para que un lector
 * de pantalla anuncie «Nota interna…» antes de leer el cuerpo, y no después.
 *
 * Hay aspectos que no son un destino y por eso no salen de `VISIBILITY_SKINS`:
 * el mensaje **entrante** del cliente --siempre público, porque el portal no
 * sabe escribir otra cosa, pero mezclarlo con las respuestas del equipo dejaría
 * el hilo sin saber de un vistazo quién habla-- y el mensaje **sin autor
 * legible**, que se dice en vez de atribuirse a nadie (ver `lookFor`).
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
  /** La línea que solo aparece en papel, cuando puede no haber color. */
  printedNotice: string | null;
}

/**
 * El único valor que se pinta como «lo leyó el cliente». Se compara **contra
 * esto y en positivo**; ver `lookFor`.
 */
const PUBLIC_VISIBILITY: TicketMessageVisibility = 'PUBLICA';

const INCOMING: Look = {
  chip: 'Mensaje del cliente',
  chipClass: 'bg-sky-100 text-sky-900 ring-1 ring-inset ring-sky-300',
  cardClass: 'border border-solid border-sky-200 bg-sky-50/70',
  railStyle: { background: '#0284c7' },
  spoken: 'Mensaje del cliente',
  printedNotice: null,
};

const INTERNAL: Look = {
  chip: VISIBILITY_SKINS.INTERNA.chip,
  chipClass: VISIBILITY_SKINS.INTERNA.chipClass,
  // Trazo discontinuo y más grueso: la única de las cuatro señales que no
  // necesita ni color ni relleno para leerse.
  cardClass: 'border-2 border-dashed border-amber-600 bg-amber-50',
  railStyle: VISIBILITY_SKINS.INTERNA.railStyle,
  spoken: 'Nota interna, que el cliente no ve',
  printedNotice:
    'NOTA INTERNA DE KUBO — el cliente no ve este mensaje. No entregar esta hoja al cliente.',
};

const OUTGOING: Look = {
  chip: VISIBILITY_SKINS.PUBLICA.chip,
  chipClass: VISIBILITY_SKINS.PUBLICA.chipClass,
  cardClass: 'border border-solid border-slate-300 bg-white',
  railStyle: VISIBILITY_SKINS.PUBLICA.railStyle,
  spoken: 'Respuesta que leyó el cliente',
  printedNotice: 'RESPUESTA ENVIADA AL CLIENTE — este mensaje lo leyó el cliente.',
};

/**
 * Público, pero **sin ninguna columna de autor legible**. No es ni entrante ni
 * saliente: es una fila que no se puede atribuir a nadie, y decirlo es lo único
 * honesto. Lo mismo que hace `TicketThread.authorName` con el nombre, aquí con
 * el aspecto, para que las dos mitades de la tarjeta cuenten lo mismo.
 */
const UNKNOWN_AUTHOR: Look = {
  chip: 'Respuesta al cliente · autor desconocido',
  chipClass: 'bg-slate-200 text-slate-800 ring-1 ring-inset ring-slate-400',
  cardClass: 'border border-dashed border-slate-400 bg-slate-50',
  railStyle: { background: '#64748b' },
  // El `aria-label` es `${spoken}, de ${authorName}`, y `authorName` ya dice
  // «Autor desconocido»: repetirlo aquí lo hacía sonar dos veces.
  spoken: 'Respuesta que leyó el cliente',
  printedNotice:
    'RESPUESTA ENVIADA AL CLIENTE — este mensaje lo leyó el cliente. No consta quién lo escribió.',
};

/**
 * Qué aspecto le toca a este mensaje. **Las dos decisiones se toman en
 * positivo**, y en las dos lo desconocido cae del lado que no miente.
 *
 * **La visibilidad.** Se pregunta `=== 'PUBLICA'`, nunca `!== 'INTERNA'`. Es la
 * misma regla que aplican `TicketMessagesRepository` en el `WHERE`
 * (`visibility = 'PUBLICA'`) y `notification-rules.ts` antes de mandar un
 * correo, y por el mismo motivo: con la comparación invertida, **todo lo que no
 * sea exactamente la nota interna pasa por respuesta al cliente**. Un tercer
 * valor del ENUM añadido mañana, un `null` de una fila mal migrada o un campo
 * que no llegó en el JSON pintarían la tarjeta de blanco, sin el rayado ni el
 * borde discontinuo, y --lo que no tiene arreglo-- imprimirían la línea que
 * afirma que **el cliente ya lo leyó**. Esta es la única pantalla donde esa
 * distinción es todo el diseño, así que lo desconocido se trata como interno:
 * enseñar de más al equipo no cuesta nada; enseñar de menos, tampoco se puede
 * retirar una hoja de las manos de un cliente.
 *
 * **La autoría.** Se mira **primero la columna del equipo**, igual que
 * `TicketThread.authorName`. No es indiferente: una fila con las dos columnas
 * puestas --que el esquema admite-- salía con el distintivo «Mensaje del
 * cliente» y, unos píxeles al lado, el nombre «Equipo Kubo», porque cada mitad
 * de la misma tarjeta desempataba al revés. Y una fila **sin ninguna** de las
 * dos ya no se cuela por entrante ni por saliente: tiene su propio aspecto.
 */
function lookFor(message: TicketMessage): Look {
  if (message.visibility !== PUBLIC_VISIBILITY) return INTERNAL;

  if (message.authorUserId !== null) return OUTGOING;
  if (message.authorClientUserId !== null) return INCOMING;
  return UNKNOWN_AUTHOR;
}

export default function ThreadMessage({ message, attachments, authorName }: ThreadMessageProps) {
  const look = lookFor(message);
  const fecha = new Date(message.createdAt).toLocaleString('es-PE');

  return (
    <article
      aria-label={`${look.spoken}, de ${authorName}, ${fecha}`}
      data-visibility={message.visibility}
      style={{
        // Que el navegador imprima también el fondo, si el usuario no lo ha
        // desactivado. Es una mejora, no la garantía: la garantía son el trazo
        // discontinuo y el texto de abajo.
        printColorAdjust: 'exact',
        WebkitPrintColorAdjust: 'exact',
      }}
      className={`relative overflow-hidden rounded-xl pl-4 pr-3 py-3 ${look.cardClass}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1.5 print:hidden"
        style={look.railStyle}
      />

      {/*
        `<div>` y no `<header>`: ver el docblock. Un elemento de sección aquí lo
        borra la regla de impresión global de index.css.
      */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={`rounded px-2 py-0.5 text-[11px] font-semibold print:border print:border-black print:bg-transparent print:text-black ${look.chipClass}`}
        >
          {look.chip}
        </span>
        <span className="text-xs font-medium text-slate-700">{authorName}</span>
        <span className="ml-auto font-mono text-[11px] text-slate-500">{fecha}</span>
      </div>

      {look.printedNotice && (
        // Solo en papel. En pantalla sobra --el color y el distintivo ya lo
        // dicen-- pero en papel puede ser lo único que quede.
        <p className="hidden print:block print:mt-1 print:text-[11px] print:font-bold print:uppercase print:tracking-wide print:text-black">
          {look.printedNotice}
        </p>
      )}

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

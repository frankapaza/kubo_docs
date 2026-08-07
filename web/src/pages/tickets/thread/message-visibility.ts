import type { CSSProperties } from 'react';

import type { TicketMessageVisibility } from '../../../api/types';

/**
 * Qué aspecto tiene y cómo se llama cada uno de los **dos destinos** de un
 * mensaje del hilo. Un único sitio, y a propósito.
 *
 * No está repartido por los tres componentes que lo pintan porque todo el
 * diseño de esta pantalla descansa en que el color y la frase sean **los
 * mismos** en los tres momentos en que el usuario los ve:
 *
 * 1. **mientras redacta** — el compositor entero se tiñe del destino que va a
 *    usar el botón que tiene debajo del cursor o del foco;
 * 2. **al confirmar** una respuesta pública — el diálogo enseña el texto ya
 *    vestido con esos mismos colores y etiqueta;
 * 3. **después, en el hilo** — el mensaje conserva exactamente ese aspecto.
 *
 * Si el ámbar del compositor y el del hilo se separasen aunque fuera un tono,
 * el aprendizaje que evita el error de verdad --«ámbar es lo que no sale de
 * aquí»-- dejaría de sostenerse. Por eso los tres leen de esta tabla y ninguno
 * escribe una clase de color por su cuenta.
 *
 * **Por qué ámbar para la nota interna y no gris.** El gris se lee como
 * «secundario» y se ignora; el ámbar se lee como «ojo con esto», que es lo que
 * hace falta para que un vistazo al hilo baste para separar lo que el cliente
 * lee de lo que no. Y es un color que no usa ningún otro elemento de esta
 * pantalla.
 */
export interface VisibilitySkin {
  visibility: TicketMessageVisibility;
  /** Etiqueta del distintivo. Corta, para que quepa en la cabecera del mensaje. */
  chip: string;
  /** El verbo del botón que manda un mensaje a este destino. */
  action: string;
  /** Distintivo. */
  chipClass: string;
  /** La tarjeta del mensaje ya escrito, en el hilo. */
  cardClass: string;
  /** El compositor cuando este destino está previsualizado o en vuelo. */
  composerClass: string;
  /** El aviso de «quién lo va a leer» dentro del compositor y del diálogo. */
  noticeClass: string;
  /** El botón que envía a este destino. */
  buttonClass: string;
  /**
   * El canto izquierdo de la tarjeta. La nota interna lleva rayado diagonal
   * además del color: es lo que la separa de una respuesta **sin leer nada**,
   * incluso de reojo o para quien no distingue bien el ámbar del blanco.
   */
  railStyle: CSSProperties;
}

const PUBLIC_SKIN: VisibilitySkin = {
  visibility: 'PUBLICA',
  chip: 'Respuesta al cliente',
  action: 'Responder al cliente',
  chipClass: 'bg-indigo-100 text-indigo-800 ring-1 ring-inset ring-indigo-300',
  cardClass: 'border-slate-200 bg-white',
  composerClass: 'border-indigo-400 bg-indigo-50/60',
  noticeClass: 'bg-indigo-100 text-indigo-900 ring-1 ring-inset ring-indigo-300',
  buttonClass:
    'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500/40 shadow-sm',
  railStyle: { background: '#4f46e5' },
};

const INTERNAL_SKIN: VisibilitySkin = {
  visibility: 'INTERNA',
  chip: 'Nota interna · no la ve el cliente',
  action: 'Guardar nota interna',
  chipClass: 'bg-amber-200 text-amber-900 ring-1 ring-inset ring-amber-400',
  cardClass: 'border-amber-300 bg-amber-50',
  composerClass: 'border-amber-400 bg-amber-50',
  noticeClass: 'bg-amber-200 text-amber-900 ring-1 ring-inset ring-amber-400',
  buttonClass:
    'bg-amber-500 text-white hover:bg-amber-600 focus:ring-amber-500/40 shadow-sm',
  railStyle: {
    // Rayado, no color liso: dos señales distintas para el mismo hecho.
    backgroundImage:
      'repeating-linear-gradient(135deg, #b45309 0 4px, #f59e0b 4px 8px)',
  },
};

export const VISIBILITY_SKINS: Record<TicketMessageVisibility, VisibilitySkin> = {
  PUBLICA: PUBLIC_SKIN,
  INTERNA: INTERNAL_SKIN,
};

/**
 * Quién va a leer esto, **con todas las letras y nombrando a quien lo lee**.
 *
 * Es la frase de la que depende que nadie se equivoque, así que no dice
 * «público» ni «visible externamente» --jerga que se lee sin procesar--: dice
 * quién lo abre y por dónde le llega. Y en el caso público dice también que no
 * hay vuelta atrás, porque no la hay: sale un correo, y un correo en la bandeja
 * de otro no se borra.
 *
 * El nombre de la empresa entra cuando se conoce. Cuando no --la ficha del
 * cliente puede no haber cargado--, se dice «la empresa del ticket» en vez de
 * callarlo: una frase sin destinatario es justo la que se lee por encima.
 */
export function audienceSentence(
  visibility: TicketMessageVisibility,
  clientName: string | null,
): string {
  if (visibility === 'INTERNA') {
    return 'Solo lo lee el equipo de Kubo. El cliente no lo verá y no se envía ningún correo.';
  }
  const quien = clientName ?? 'la empresa del ticket';
  return `Lo va a leer el cliente: se publica en el portal de ${quien} y sale por correo. Una vez enviado no se puede retirar.`;
}

/** La misma frase, en corto, para el pie de un botón. */
export function consequenceLine(visibility: TicketMessageVisibility): string {
  return visibility === 'INTERNA'
    ? 'No sale de Kubo. Sin correo.'
    : 'Sale por correo. No se puede retirar.';
}

/** El texto del aviso cuando todavía no se ha elegido destino. */
export const NO_DESTINATION_NOTICE =
  'Este mensaje todavía no tiene destino. Los dos botones de abajo son dos envíos distintos: elige con cuál lo mandas.';

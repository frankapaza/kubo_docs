import type { PortalTicketMessage } from '../../../api/types';
import PortalThreadAttachment from './PortalThreadAttachment';

/**
 * Un mensaje del hilo, visto **desde el portal del cliente**.
 *
 * Aquí no se reutiliza `pages/tickets/thread/ThreadMessage.tsx` y el motivo no
 * es estético: casi todo lo que aquel componente hace es decidir cómo se
 * distingue una **nota interna** de una respuesta --el fondo ámbar, el canto
 * rayado, el borde discontinuo, el aviso que solo sale al imprimir-- y en esta
 * pantalla esa distinción no existe. El backend proyecta el hilo campo por
 * campo y **nunca manda `visibility`**: lo que llega aquí ya está filtrado, así
 * que no hay ningún caso «interno» que pintar. Traerse aquel componente
 * significaría traerse un tipo `TicketMessage` con `visibility` y con las dos
 * columnas de autor, es decir, prometerle a esta pantalla unos datos que no
 * recibe y dejar escrita la puerta por la que algún día entrarían.
 *
 * **Lo único que se sabe del autor es de qué lado viene**: `'CLIENT'` o
 * `'STAFF'`. No hay nombre, ni identificador, ni correo de quien contestó desde
 * Kubo, y aquí no se deduce ninguno: enseñar «Usuario #12» sería publicar un
 * identificador interno, y adivinar un nombre sería inventarlo. Un mensaje del
 * propio lado del cliente se atribuye a la empresa y no a «tú»: puede haberlo
 * escrito otra persona de la misma empresa, y el backend no dice cuál.
 *
 * Sobre el `<div>` de la cabecera: `web/src/index.css` tiene una regla global
 * `header { display: none !important }` dentro de `@media print`, así que un
 * elemento de sección aquí desaparecería al imprimir junto con el autor y la
 * fecha. Es la misma trampa que ya se pisó en el panel.
 */
interface Look {
  chip: string;
  chipClass: string;
  cardClass: string;
  railClass: string;
  /** Cómo se anuncia el mensaje antes de leer el cuerpo. */
  spoken: string;
}

const LOOKS: Record<PortalTicketMessage['author'], Look> = {
  STAFF: {
    chip: 'Equipo Kubo',
    chipClass: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-300',
    cardClass: 'border border-slate-300 bg-white',
    railClass: 'bg-kubo-primary',
    spoken: 'Mensaje del equipo de Kubo',
  },
  CLIENT: {
    chip: 'Tu empresa',
    chipClass: 'bg-sky-100 text-sky-900 ring-1 ring-inset ring-sky-300',
    cardClass: 'border border-sky-200 bg-sky-50/70',
    railClass: 'bg-sky-600',
    spoken: 'Mensaje de tu empresa',
  },
};

export default function PortalThreadMessage({ message }: { message: PortalTicketMessage }) {
  const look = LOOKS[message.author];
  const fecha = new Date(message.createdAt).toLocaleString('es-PE');

  return (
    <article
      aria-label={`${look.spoken}, ${fecha}`}
      data-author={message.author}
      className={`relative overflow-hidden rounded-xl py-3 pl-4 pr-3 ${look.cardClass}`}
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1.5 ${look.railClass}`} />

      {/* `<div>` y no `<header>`: ver el docblock. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${look.chipClass}`}>
          {look.chip}
        </span>
        <span className="ml-auto font-mono text-[11px] text-slate-500">{fecha}</span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">
        {message.bodyMd}
      </p>

      {message.attachments.length > 0 && (
        <ul className="mt-3 space-y-2">
          {message.attachments.map((attachment) => (
            <PortalThreadAttachment key={attachment.id} attachment={attachment} />
          ))}
        </ul>
      )}
    </article>
  );
}

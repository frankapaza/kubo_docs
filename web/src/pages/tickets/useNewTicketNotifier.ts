import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { useRealtime, TicketCreatedEvent } from '../../lib/realtime';
import { toast } from '../../ui/Toast';

const ORIGIN_LABELS: Record<string, string> = {
  PORTAL: 'portal',
  EMAIL: 'correo',
  WHATSAPP_TEXT: 'WhatsApp',
  WHATSAPP_AUDIO: 'WhatsApp',
  VOICE_LIVE: 'llamada',
  MEETING: 'reunión',
  NOTE: 'panel',
};

/**
 * Aviso de ticket nuevo en todo el panel del personal, no solo en la bandeja.
 *
 * Dos canales a la vez, porque cubren casos distintos:
 * - el toast, para quien está mirando el panel;
 * - la notificación del sistema operativo, para quien tiene la pestaña en
 *   segundo plano (que es lo normal en una mesa de servicio). Al hacer clic
 *   abre el ticket. Solo sale si el usuario dio permiso; se pide una vez.
 */
export function useNewTicketNotifier(): void {
  const navigate = useNavigate();

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  const onCreated = useCallback(
    (t: TicketCreatedEvent) => {
      const code = t.code ?? `#${t.id}`;
      const via = ORIGIN_LABELS[t.origin] ?? t.origin;
      const subject = t.subject ?? 'Sin asunto';
      toast.info(`${subject} · ${t.priority} · vía ${via}`, `Nuevo ticket ${code}`);

      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        const n = new Notification(`Nuevo ticket ${code}`, {
          body: `${subject} · ${t.priority} · vía ${via}`,
          tag: `ticket-${t.id}`,
        });
        n.onclick = () => {
          window.focus();
          navigate(`/tickets/${t.id}`);
          n.close();
        };
      }
    },
    [navigate],
  );

  useRealtime('ticket:created', onCreated);
}

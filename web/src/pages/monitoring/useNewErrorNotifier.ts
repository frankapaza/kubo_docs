import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { useRealtime, DiskAlertEvent, ErrorNewEvent } from '../../lib/realtime';
import { toast } from '../../ui/Toast';

/**
 * Aviso de error nuevo (o reaparecido) en todo el panel, calcado del de
 * tickets: toast para quien mira el panel y notificación del sistema para
 * quien lo tiene en segundo plano; al hacer clic abre el detalle del error.
 * También avisa cuando el disco de logs supera el umbral.
 */
export function useNewErrorNotifier(): void {
  const navigate = useNavigate();

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  const onNew = useCallback(
    (e: ErrorNewEvent) => {
      const title = e.reopened ? 'Error reaparecido' : 'Error nuevo';
      const body = `${e.title} · ${e.aplicativo} · ${e.clienteNombre ?? 'interno'}`;
      toast.info(body, title);

      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        const n = new Notification(title, { body, tag: `error-${e.id}` });
        n.onclick = () => {
          window.focus();
          navigate(`/monitoreo/errores/${e.id}`);
          n.close();
        };
      }
    },
    [navigate],
  );

  const onDisk = useCallback((d: DiskAlertEvent) => {
    toast.warning(
      `El disco de logs está al ${Math.round(d.usedPct)}% (umbral ${d.threshold}%).`,
      'Disco de logs casi lleno',
    );
  }, []);

  useRealtime('error:new', onNew);
  useRealtime('monitoreo:disco', onDisk);
}

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useRealtime, DiskAlertEvent, ErrorNewEvent, LogDigestEvent } from '../../lib/realtime';
import { toast } from '../../ui/Toast';

/**
 * Notificación de Windows cuando el panel no tiene el foco (otra pestaña,
 * otra ventana o minimizado); si lo tiene, basta el toast. El permiso se pide
 * con el botón de NotificationPermissionBanner.
 */
function notifyOs(title: string, body: string, tag: string, onClick: () => void): boolean {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  if (!document.hidden && document.hasFocus()) return false;
  const n = new Notification(title, { body, tag });
  n.onclick = () => {
    window.focus();
    onClick();
    n.close();
  };
  return true;
}

const fmtN = (n: number) => n.toLocaleString('es-PE');
const plural = (n: number, uno: string, varios: string) => `${fmtN(n)} ${n === 1 ? uno : varios}`;

/** El texto del resumen de logs, corto: Windows recorta lo que pase de unas 4 líneas. */
export function digestText(d: LogDigestEvent): { title: string; body: string } {
  const errores = d.porNivel.ERROR + d.porNivel.FATAL;
  const lines: string[] = [];
  lines.push(
    d.total === 0
      ? 'No llegó ningún log.'
      : `${plural(d.total, 'log', 'logs')} · ${plural(errores, 'error', 'errores')} · ${plural(d.porNivel.WARN, 'aviso', 'avisos')}`,
  );
  const top = d.fuentes.find((f) => f.errores > 0);
  if (top) lines.push(`Más errores: ${top.nombre} (${fmtN(top.errores)})`);
  if (d.callados.length > 0) {
    lines.push(`Dejó de enviar: ${d.callados.slice(0, 2).join(', ')}${d.callados.length > 2 ? ` y ${d.callados.length - 2} más` : ''}`);
  }
  return { title: 'Resumen de logs · últimos 30 min', body: lines.join('\n') };
}

/**
 * Avisos de monitoreo en todo el panel: error nuevo (o reaparecido), el
 * resumen de logs cada 30 min y el disco de logs casi lleno.
 */
export function useNewErrorNotifier(): void {
  const navigate = useNavigate();

  const onNew = useCallback(
    (e: ErrorNewEvent) => {
      const title = e.reopened ? 'Error reaparecido' : 'Error nuevo';
      const body = `${e.title} · ${e.aplicativo} · ${e.clienteNombre ?? 'interno'}`;
      toast.info(body, title);
      notifyOs(title, body, `error-${e.id}`, () => navigate(`/monitoreo/errores/${e.id}`));
    },
    [navigate],
  );

  const onDigest = useCallback(
    (d: LogDigestEvent) => {
      const { title, body } = digestText(d);
      // Con el panel delante, el resumen no interrumpe: solo va a Windows.
      notifyOs(title, body, 'logs-resumen', () => navigate('/monitoreo/logs'));
    },
    [navigate],
  );

  const onDisk = useCallback(
    (d: DiskAlertEvent) => {
      const title = 'Disco de logs casi lleno';
      const body = `El disco de logs está al ${Math.round(d.usedPct)}% (umbral ${d.threshold}%).`;
      toast.warning(body, title);
      notifyOs(title, body, 'logs-disco', () => navigate('/monitoreo/instalaciones'));
    },
    [navigate],
  );

  useRealtime('error:new', onNew);
  useRealtime('logs:resumen', onDigest);
  useRealtime('monitoreo:disco', onDisk);
}

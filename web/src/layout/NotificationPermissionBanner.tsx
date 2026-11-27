import { useState } from 'react';

const DISMISS_KEY = 'kubo:notif-banner-oculto';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Pide permiso para las notificaciones de Windows con un clic del usuario:
 * Chrome y Brave bloquean en silencio la petición que se hace sola al cargar.
 * Al concederlo, manda una de prueba para confirmar que Windows la muestra.
 */
export default function NotificationPermissionBanner() {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [perm, setPerm] = useState<NotificationPermission>(supported ? Notification.permission : 'denied');
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!supported || perm === 'granted' || dismissed) return null;

  const enable = async () => {
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p === 'granted') {
        new Notification('Notificaciones activadas', {
          body: 'Así te avisaremos de errores nuevos y del resumen de logs cada 30 minutos.',
        });
      }
    } catch {
      setPerm(Notification.permission);
    }
  };

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* sin almacenamiento: se oculta solo en esta sesión */
    }
  };

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '0 0 20px', padding: '10px 14px',
        borderRadius: 8, fontSize: 13, background: 'var(--k-accent-soft)', color: 'var(--k-accent-ink)',
        border: '1px solid #A7E3D9',
      }}
    >
      <span style={{ flex: 1, minWidth: 240 }}>
        {perm === 'default' ? (
          <>Activa las notificaciones de Windows para enterarte de <b>errores nuevos</b> y del <b>resumen de logs</b> aunque estés en otra ventana.</>
        ) : (
          <>
            Las notificaciones están <b>bloqueadas</b> en este navegador. Para activarlas: clic en el ícono a la izquierda de la
            dirección → <b>Notificaciones</b> → <b>Permitir</b>, y recarga la página.
          </>
        )}
      </span>
      {perm === 'default' && (
        <button
          type="button"
          onClick={enable}
          style={{ fontSize: 13, fontWeight: 600, padding: '6px 12px', borderRadius: 6, background: 'var(--k-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          Activar notificaciones
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, background: 'transparent', color: 'var(--k-accent-ink)', border: '1px solid #A7E3D9', cursor: 'pointer' }}
      >
        Ahora no
      </button>
    </div>
  );
}

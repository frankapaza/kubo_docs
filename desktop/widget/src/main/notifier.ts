import { app, Notification, shell } from 'electron';
import { isAllowedUrl, type Toast } from '../shared/notify-policy';

export { isAllowedUrl };

export const APP_ID = 'com.kubo.monitor.widget';

/**
 * Los avisos se retienen hasta su clic o cierre: si el recolector se lleva la instancia,
 * Windows ya no entrega el clic.
 */
const live = new Set<Notification>();

/**
 * Empaquetado, el instalador NSIS crea el acceso directo con `APP_ID` (requisito de Windows para
 * mostrar avisos). En desarrollo no hay acceso directo: se usa la ruta del ejecutable.
 */
export function initNotifier(): void {
  app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);
}

/** Muestra el aviso; el clic abre la URL solo si es de la central (/monitoreo/). */
export function showToast(toast: Toast, centralUrl: string): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: toast.title, body: toast.body });
  live.add(n);
  const release = (): void => { live.delete(n); };
  n.on('click', () => {
    release();
    if (isAllowedUrl(toast.url, centralUrl)) void shell.openExternal(toast.url);
  });
  n.on('close', release);
  n.on('failed', release);
  n.show();
}

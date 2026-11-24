import { app, Notification, shell } from 'electron';
import { isAllowedUrl, type Toast } from '../shared/notify-policy';

export { isAllowedUrl };

export function initNotifier(): void {
  app.setAppUserModelId('com.kubo.monitor.widget');
}

/** Muestra el aviso; el clic abre la URL solo si es de la central (/monitoreo/). */
export function showToast(toast: Toast, centralUrl: string): void {
  const n = new Notification({ title: toast.title, body: toast.body });
  n.on('click', () => {
    if (isAllowedUrl(toast.url, centralUrl)) void shell.openExternal(toast.url);
  });
  n.show();
}

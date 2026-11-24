import { join } from 'node:path';
import { app, ipcMain, shell, type IpcMainEvent } from 'electron';
import { healthFrom } from '../shared/health';
import type { IpcChannel } from '../shared/ipc';
import { summarize, type LoginSummary } from '../shared/login-summary';
import { isAllowedUrl, type Toast } from '../shared/notify-policy';
import { isCorner } from '../shared/window-position';
import type { WidgetModel } from '../shared/widget-model';
import { EngineClient, monitorHome } from './engine-client';
import { enginePort } from './engine-port';
import { initNotifier, showToast } from './notifier';
import { fetchAllEvents, Poller, POLL_INTERVAL_MS } from './poller';
import { WidgetStore } from './store';
import { WidgetTray } from './tray';
import { WidgetWindow } from './window';

const LAST_SEEN_INTERVAL_MS = 60_000;

// Solo para desarrollo y pruebas: carpeta de datos del widget fuera del perfil.
if (process.env.KUBO_WIDGET_DATA_DIR) app.setPath('userData', process.env.KUBO_WIDGET_DATA_DIR);

let widget: WidgetWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => widget?.show());
  app.on('window-all-closed', () => { /* sigue en la bandeja */ });
  void app.whenReady().then(start);
}

function start(): void {
  const startedAt = Date.now();
  initNotifier();
  const store = new WidgetStore(app.getPath('userData'));
  // Arranque con la sesión, sin elevación, una sola vez; nunca en desarrollo.
  if (app.isPackaged && !store.loginItemConfigured) {
    app.setLoginItemSettings({ openAtLogin: true });
    store.loginItemConfigured = true;
  }

  const home = monitorHome();
  const client = new EngineClient({ home, port: enginePort(home), startedAt });
  const win = new WidgetWindow({
    preload: join(__dirname, '../preload/preload.js'),
    html: join(__dirname, '../renderer/index.html'),
    store,
  });
  widget = win;

  let model: WidgetModel | null = null;
  let summary: LoginSummary | null = null;
  let healthOpen = false;
  let quitting = false;

  const relayout = (): void => {
    win.setLayout({ expanded: model?.expanded ?? false, rows: model?.rows.length ?? 0, summary: summary !== null, health: healthOpen });
  };

  const poller = new Poller({
    client,
    store,
    startedAt,
    now: Date.now,
    notify: (t, centralUrl) => showToast(t, centralUrl),
    onModel: (m, reach) => {
      model = m;
      win.send('widget:model', m);
      tray.update(m);
      if (healthOpen) win.send('widget:health', healthFrom(reach));
      relayout();
    },
  });

  const openCentral = (path: string): void => {
    if (!poller.centralUrl) return;
    const url = `${poller.centralUrl}${path}`;
    if (isAllowedUrl(url, poller.centralUrl)) void shell.openExternal(url);
  };

  const tray = new WidgetTray(join(app.getAppPath(), 'assets'), {
    showWidget: () => win.show(),
    openDashboard: () => openCentral('/monitoreo/estado'),
    openIncidents: () => openCentral('/monitoreo/incidentes'),
    testNotification: () => {
      const central = poller.centralUrl ?? '';
      const toast: Toast = {
        title: 'KUBO · Notificación de prueba',
        body: 'Si ves este aviso, las notificaciones de Windows funcionan.',
        url: central ? `${central}/monitoreo/estado` : '',
        dedupeKey: 'TEST:',
      };
      showToast(toast, central);
    },
    showHealth: () => {
      healthOpen = true;
      win.send('widget:health', healthFrom(poller.lastReach));
      relayout();
      win.show();
    },
    quit: () => app.quit(),
  });

  // IPC: solo desde nuestra ventana y con cada valor validado.
  const on = (channel: IpcChannel, fn: (value: unknown) => void): void => {
    ipcMain.on(channel, (e: IpcMainEvent, value: unknown) => {
      if (e.sender !== win.webContents) return;
      fn(value);
    });
  };
  on('widget:open-incident', (id) => {
    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) openCentral(`/monitoreo/incidentes/${id}`);
  });
  on('widget:open-dashboard', () => openCentral('/monitoreo/estado'));
  on('widget:dismiss-summary', () => {
    summary = null;
    win.send('widget:summary', null);
    relayout();
  });
  on('widget:close-health', () => {
    healthOpen = false;
    win.send('widget:health', null);
    relayout();
  });
  on('widget:set-corner', (c) => {
    if (isCorner(c)) win.setCorner(c);
  });

  // Resumen al iniciar sesión: lo ocurrido desde la última vez que corrió el widget.
  const since = store.lastSeenAt;
  let summaryDone = false;
  let lastSeenTimer: NodeJS.Timeout | null = null;
  const loadSummary = async (): Promise<void> => {
    if (summaryDone || poller.lastReach.kind !== 'ok' || !model) return;
    try {
      const events = await fetchAllEvents(client);
      summary = summarize(events, since, model);
    } catch {
      return; // Se reintenta en el siguiente paso.
    }
    summaryDone = true;
    if (summary) {
      win.send('widget:summary', summary);
      relayout();
    }
    // Desde aquí, «visto» avanza cada minuto y al salir.
    store.lastSeenAt = new Date().toISOString();
    lastSeenTimer = setInterval(() => { store.lastSeenAt = new Date().toISOString(); }, LAST_SEEN_INTERVAL_MS);
  };

  const loop = async (): Promise<void> => {
    await poller.tick();
    await loadSummary();
    if (!quitting) setTimeout(() => { void loop(); }, POLL_INTERVAL_MS);
  };

  // Un renderer recargado recibe el estado actual.
  win.webContents.on('did-finish-load', () => {
    if (model) win.send('widget:model', model);
    win.send('widget:summary', summary);
    win.send('widget:health', healthOpen ? healthFrom(poller.lastReach) : null);
  });

  // Alt+F4 oculta; solo «Salir» cierra.
  win.win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.win.hide();
    }
  });
  app.on('before-quit', () => {
    quitting = true;
    if (lastSeenTimer) clearInterval(lastSeenTimer);
    if (summaryDone) store.lastSeenAt = new Date().toISOString();
    tray.destroy();
  });

  void loop();
}

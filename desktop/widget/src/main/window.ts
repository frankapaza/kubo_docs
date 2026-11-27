import { BrowserWindow, screen } from 'electron';
import type { IpcChannel } from '../shared/ipc';
import type { Corner } from '../shared/types';
import { nearestCorner, positionFor, WIDTH, windowHeight, type Layout } from '../shared/window-position';

export interface WindowOptions {
  preload: string;
  html: string;
  store: { corner: Corner };
}

/** Ventana sin marco, siempre encima, fijada en una esquina del área de trabajo. */
export class WidgetWindow {
  readonly win: BrowserWindow;
  private layout: Layout = { expanded: false, rows: 0, summary: false, health: false };

  constructor(private readonly opts: WindowOptions) {
    this.win = new BrowserWindow({
      width: WIDTH,
      height: windowHeight(this.layout),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      show: false,
      title: 'KUBO Monitor',
      webPreferences: {
        preload: opts.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        devTools: process.env.KUBO_WIDGET_DEVTOOLS === '1',
      },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setMenu(null);
    const wc = this.win.webContents;
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.session.setPermissionRequestHandler((_wc, _perm, done) => done(false));
    // Al soltar tras arrastrar por la barra: se acopla a la esquina más cercana.
    this.win.on('moved', () => {
      const corner = nearestCorner(this.win.getBounds(), this.workArea());
      this.opts.store.corner = corner;
      this.place();
    });
    screen.on('display-metrics-changed', () => this.place());
    screen.on('display-removed', () => this.place());
    this.win.once('ready-to-show', () => {
      this.place();
      this.win.showInactive();
    });
    void this.win.loadFile(opts.html);
  }

  get webContents(): Electron.WebContents { return this.win.webContents; }

  send(channel: IpcChannel, value: unknown): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, value);
  }

  setLayout(layout: Layout): void {
    const before = windowHeight(this.layout);
    const grew = layout.expanded && !this.layout.expanded;
    this.layout = layout;
    if (windowHeight(layout) !== before) this.place();
    if (grew && !this.win.isVisible()) this.win.showInactive();
  }

  setCorner(corner: Corner): void {
    this.opts.store.corner = corner;
    this.place();
  }

  show(): void {
    this.place();
    this.win.show();
    this.win.focus();
  }

  private workArea(): Electron.Rectangle {
    return screen.getDisplayMatching(this.win.getBounds()).workArea;
  }

  private place(): void {
    if (this.win.isDestroyed()) return;
    const size = { width: WIDTH, height: windowHeight(this.layout) };
    const { x, y } = positionFor(this.opts.store.corner, this.workArea(), size);
    this.win.setBounds({ x, y, ...size });
  }
}

import { join } from 'node:path';
import { Menu, nativeImage, Tray } from 'electron';
import type { Tone, WidgetModel } from '../shared/widget-model';

export interface TrayActions {
  showWidget(): void;
  openDashboard(): void;
  openIncidents(): void;
  testNotification(): void;
  showHealth(): void;
  quit(): void;
}

const TOOLTIP_MAX = 127;

/** Icono de bandeja según el tono del modelo, con el menú del widget. */
export class WidgetTray {
  private readonly tray: Tray;
  private tone: Tone | null = null;
  private tooltip = '';

  constructor(private readonly assetsDir: string, actions: TrayActions) {
    this.tray = new Tray(this.icon('grey'));
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Mostrar widget', click: actions.showWidget },
      { label: 'Abrir tablero', click: actions.openDashboard },
      { label: 'Ver incidentes', click: actions.openIncidents },
      { type: 'separator' },
      { label: 'Probar notificación', click: actions.testNotification },
      { label: 'Salud del monitor', click: actions.showHealth },
      { type: 'separator' },
      { label: 'Salir', click: actions.quit },
    ]));
    this.tray.on('click', actions.showWidget);
    this.update(null);
  }

  /** Solo toca el icono y el texto si cambiaron. */
  update(model: WidgetModel | null): void {
    const tone = model?.tone ?? 'grey';
    if (tone !== this.tone) {
      this.tone = tone;
      this.tray.setImage(this.icon(tone));
    }
    const tooltip = `KUBO Monitor · ${model?.headline.replace(/^KUBO · /, '') ?? 'Conectando…'}`.slice(0, TOOLTIP_MAX);
    if (tooltip !== this.tooltip) {
      this.tooltip = tooltip;
      this.tray.setToolTip(tooltip);
    }
  }

  destroy(): void {
    this.tray.destroy();
  }

  private icon(tone: Tone): Electron.NativeImage {
    // `tray-<tono>.png` (16 px) y `tray-<tono>@2x.png` (32 px): Electron elige según el DPI.
    return nativeImage.createFromPath(join(this.assetsDir, `tray-${tone}.png`));
  }
}

import type { HealthRows } from './health';
import type { LoginSummary } from './login-summary';
import type { Corner } from './types';
import type { WidgetModel } from './widget-model';

/**
 * Canales IPC entre main y renderer. El preload (sandbox) no puede importar módulos locales:
 * repite estos literales y TypeScript los comprueba contra este tipo.
 */
export type IpcChannel =
  | 'widget:model'
  | 'widget:summary'
  | 'widget:health'
  | 'widget:open-incident'
  | 'widget:open-dashboard'
  | 'widget:dismiss-summary'
  | 'widget:close-health'
  | 'widget:set-corner';

/** Única API que el preload expone en `window.kubo`. */
export interface WidgetApi {
  onModel(cb: (model: WidgetModel) => void): () => void;
  onSummary(cb: (summary: LoginSummary | null) => void): () => void;
  onHealth(cb: (rows: HealthRows | null) => void): () => void;
  openIncident(id: number): void;
  openDashboard(): void;
  dismissSummary(): void;
  closeHealth(): void;
  setCorner(corner: Corner): void;
}

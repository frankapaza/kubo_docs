import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Corner } from '../shared/types';

const FILE = 'widget-state.json';
const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

interface State {
  cursor: number;
  corner: Corner;
  lastSeenAt: string | null;
  loginItemConfigured: boolean;
}

const DEFAULTS: State = { cursor: 0, corner: 'bottom-right', lastSeenAt: null, loginItemConfigured: false };

/** Estado del widget en un JSON dentro de `dir` (app.getPath('userData') en producción). */
export class WidgetStore {
  private state: State;
  private readonly file: string;

  constructor(private readonly dir: string) {
    this.file = join(dir, FILE);
    this.state = this.load();
  }

  get cursor(): number { return this.state.cursor; }
  set cursor(v: number) { this.set('cursor', v); }
  get corner(): Corner { return this.state.corner; }
  set corner(c: Corner) { this.set('corner', c); }
  get lastSeenAt(): string | null { return this.state.lastSeenAt; }
  set lastSeenAt(v: string | null) { this.set('lastSeenAt', v); }
  get loginItemConfigured(): boolean { return this.state.loginItemConfigured; }
  set loginItemConfigured(v: boolean) { this.set('loginItemConfigured', v); }

  /** Solo escribe a disco si el valor cambió. */
  private set<K extends keyof State>(k: K, v: State[K]): void {
    if (this.state[k] === v) return;
    this.state[k] = v;
    this.save();
  }

  private load(): State {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<State>;
      return {
        cursor: Number.isInteger(raw.cursor) && (raw.cursor as number) >= 0 ? (raw.cursor as number) : DEFAULTS.cursor,
        corner: CORNERS.includes(raw.corner as Corner) ? (raw.corner as Corner) : DEFAULTS.corner,
        lastSeenAt: typeof raw.lastSeenAt === 'string' ? raw.lastSeenAt : DEFAULTS.lastSeenAt,
        loginItemConfigured: raw.loginItemConfigured === true,
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  private save(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state));
      renameSync(tmp, this.file);
    } catch {
      // Sin disco no se pierde nada crítico: el estado sigue en memoria.
    }
  }
}

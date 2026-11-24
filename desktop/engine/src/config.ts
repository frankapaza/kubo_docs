import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { protectMachine, unprotectMachine } from './dpapi';

export interface EngineConfig {
  /** Origen de la central, sin barra final: `https://docs.kuboti.com`. */
  centralUrl: string;
  probeCode: 'oficina-01';
  localPort: number;
  syncIntervalMs: number;
}

export const DEFAULT_LOCAL_PORT = 47800;
export const DEFAULT_SYNC_INTERVAL_MS = 15000;

export const CONFIG_FILE = 'engine.json';
export const TOKEN_FILE = 'token.dat';
export const SECRET_FILE = 'local-api.secret';
export const DB_FILE = 'engine.db';
export const LOGS_DIR = 'logs';

/**
 * Carpeta de datos del motor: `%ProgramData%\KUBO\Monitor`. `KUBO_MONITOR_HOME`
 * la sustituye (pruebas, humo de desarrollo y el XML del servicio la fija).
 */
export function monitorHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.KUBO_MONITOR_HOME) return env.KUBO_MONITOR_HOME;
  return join(env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData', 'KUBO', 'Monitor');
}

export function loadEngineConfig(home: string = monitorHome()): EngineConfig {
  const file = join(home, CONFIG_FILE);
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

  if (raw.probeCode !== 'oficina-01') {
    throw new Error(`${file}: probeCode debe ser 'oficina-01' (es ${JSON.stringify(raw.probeCode)}).`);
  }
  let url: URL;
  try {
    url = new URL(String(raw.centralUrl));
  } catch {
    throw new Error(`${file}: centralUrl no es una URL válida.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${file}: centralUrl debe ser http(s).`);
  }
  const localPort = raw.localPort === undefined ? DEFAULT_LOCAL_PORT : raw.localPort;
  if (!Number.isInteger(localPort) || (localPort as number) < 1 || (localPort as number) > 65535) {
    throw new Error(`${file}: localPort inválido (${String(localPort)}).`);
  }
  const syncIntervalMs = raw.syncIntervalMs === undefined ? DEFAULT_SYNC_INTERVAL_MS : raw.syncIntervalMs;
  if (!Number.isInteger(syncIntervalMs) || (syncIntervalMs as number) < 1000) {
    throw new Error(`${file}: syncIntervalMs inválido (${String(syncIntervalMs)}).`);
  }
  return {
    centralUrl: String(raw.centralUrl).replace(/\/+$/, ''),
    probeCode: 'oficina-01',
    localPort: localPort as number,
    syncIntervalMs: syncIntervalMs as number,
  };
}

/** Token `kmp_…` de la sonda, guardado con DPAPI (ámbito máquina) en `token.dat`. */
export function loadProbeToken(home: string = monitorHome()): string {
  const token = unprotectMachine(readFileSync(join(home, TOKEN_FILE))).trim();
  if (!token) throw new Error(`${join(home, TOKEN_FILE)}: token vacío.`);
  return token;
}

export function saveProbeToken(token: string, home: string = monitorHome()): void {
  const t = token.trim();
  if (!t) throw new Error('Token vacío.');
  writeFileSync(join(home, TOKEN_FILE), protectMachine(t));
}

/** Secreto compartido con el widget (lo crea el instalador). */
export function loadLocalSecret(home: string = monitorHome()): string {
  const secret = readFileSync(join(home, SECRET_FILE), 'utf8').trim();
  if (!secret) throw new Error(`${join(home, SECRET_FILE)}: secreto vacío.`);
  return secret;
}

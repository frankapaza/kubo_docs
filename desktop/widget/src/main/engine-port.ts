import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_ENGINE_PORT = 47800;
const CONFIG_FILE = 'engine.json';

function validPort(v: unknown): number | null {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

/**
 * Puerto de la API local del motor: `KUBO_MONITOR_PORT`, o `localPort` de `engine.json` si el
 * usuario puede leerlo (la ACL del instalador solo le deja leer el secreto), o 47800.
 */
export function enginePort(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
  read: (file: string) => string = (f) => readFileSync(f, 'utf8'),
): number {
  const fromEnv = validPort(env.KUBO_MONITOR_PORT);
  if (fromEnv !== null) return fromEnv;
  try {
    const fromFile = validPort((JSON.parse(read(join(home, CONFIG_FILE))) as { localPort?: unknown }).localPort);
    if (fromFile !== null) return fromFile;
  } catch {
    // Sin acceso o JSON inválido: puerto por defecto.
  }
  return DEFAULT_ENGINE_PORT;
}

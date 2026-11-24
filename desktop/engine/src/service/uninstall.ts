/**
 * Detiene y da de baja el servicio «KUBO Monitor Engine».
 *
 *   node dist/service/uninstall.js [--purge]
 *
 * Por defecto conserva `%ProgramData%\KUBO\Monitor` (config, token, cola pendiente y
 * registros): una reinstalación sigue donde lo dejó. `--purge` lo borra también.
 * Debe ejecutarse como administrador.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { monitorHome } from '../config';
import { SERVICE_ID, SERVICE_NAME } from './install';

function tryRun(cmd: string, args: string[]): boolean {
  console.log(`> ${cmd} ${args.join(' ')}`);
  try {
    execFileSync(cmd, args, { stdio: 'inherit', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export function uninstall(purge: boolean): void {
  if (process.platform !== 'win32') throw new Error('El desinstalador solo funciona en Windows.');
  const exe = join(resolve(__dirname, '..', '..'), 'service', `${SERVICE_ID}.exe`);
  tryRun('sc.exe', ['stop', SERVICE_ID]);
  const removed = existsSync(exe) ? tryRun(exe, ['uninstall']) : false;
  if (!removed) tryRun('sc.exe', ['delete', SERVICE_ID]);
  if (purge) {
    const home = monitorHome();
    rmSync(home, { recursive: true, force: true });
    console.log(`Borrado ${home}.`);
  }
  console.log(`Servicio «${SERVICE_NAME}» dado de baja.`);
}

if (require.main === module) {
  try {
    uninstall(process.argv.includes('--purge'));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

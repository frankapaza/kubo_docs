import { execFileSync } from 'node:child_process';

/**
 * DPAPI de ámbito máquina (`DataProtectionScope.LocalMachine`) mediante una
 * llamada corta a PowerShell (`System.Security.Cryptography.ProtectedData`).
 * Así no hace falta un módulo nativo ni herramientas de compilación: Windows
 * PowerShell 5.1 viene con el sistema. Los datos viajan en base64 por stdin y
 * stdout, nunca en la línea de órdenes.
 *
 * Ámbito máquina: cualquier proceso del equipo puede descifrar el blob, así que
 * la protección real del archivo la pone su ACL (SYSTEM, Administradores y la
 * cuenta del servicio; ver `service/install.ts`). DPAPI evita que el token quede
 * en claro en disco, en copias de seguridad o fuera de este equipo.
 */
const ENTROPY = 'KUBO.Monitor.ProbeToken.v1';

const SCRIPT = (op: 'Protect' | 'Unprotect') =>
  [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Security',
    '$in = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
    `$e = [Text.Encoding]::UTF8.GetBytes('${ENTROPY}')`,
    `$out = [Security.Cryptography.ProtectedData]::${op}($in, $e, [Security.Cryptography.DataProtectionScope]::LocalMachine)`,
    '[Console]::Out.Write([Convert]::ToBase64String($out))',
  ].join('; ');

function powershell(op: 'Protect' | 'Unprotect', input: Buffer): Buffer {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT(op)], {
    input: input.toString('base64'),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  return Buffer.from(out.trim(), 'base64');
}

/** Solo para pruebas fuera de Windows: archivo en claro, con bandera explícita. */
export function plainFallbackAllowed(): boolean {
  return process.platform !== 'win32' && process.env.KUBO_MONITOR_INSECURE_PLAIN_TOKEN === '1';
}

function assertWindows(): void {
  if (process.platform !== 'win32') {
    throw new Error('DPAPI solo existe en Windows (para pruebas fuera de Windows: KUBO_MONITOR_INSECURE_PLAIN_TOKEN=1).');
  }
}

export function protectMachine(plain: string): Buffer {
  if (plainFallbackAllowed()) return Buffer.from(plain, 'utf8');
  assertWindows();
  return powershell('Protect', Buffer.from(plain, 'utf8'));
}

export function unprotectMachine(blob: Buffer): string {
  if (plainFallbackAllowed()) return blob.toString('utf8');
  assertWindows();
  return powershell('Unprotect', blob).toString('utf8');
}

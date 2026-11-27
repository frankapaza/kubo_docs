/**
 * Registra el motor como servicio de Windows «KUBO Monitor Engine».
 *
 *   node dist/service/install.js --user OFICINA\ana --central https://docs.kuboti.com [--port 47800] [--token-stdin] [--dry-run]
 *
 * - Envoltorio de servicio: WinSW (el `winsw.exe` que trae `node-windows`), con un XML propio
 *   (no usamos la API de `node-windows`): arranca `node dist/main.js` con `KUBO_MONITOR_HOME`.
 * - `sc.exe`: inicio automático (sin sesión iniciada), cuenta `NT AUTHORITY\LocalService`
 *   (mínimos privilegios) y reinicio ante fallo (5 s, 30 s, 60 s; se reinicia el contador al día).
 * - `%ProgramData%\KUBO\Monitor\` con ACL propia (sin herencia): SYSTEM y Administradores
 *   control total, LocalService modificar, el usuario de escritorio solo atravesar la carpeta
 *   y leer `local-api.secret` (no puede leer `token.dat` ni la base).
 * - Crea `logs\` (rotación: winston en el motor y WinSW en sus propios registros), el secreto
 *   local y, con `--token-stdin`, `token.dat` protegido con DPAPI.
 *
 * Debe ejecutarse como administrador.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, win32 } from 'node:path';
import { CONFIG_FILE, DEFAULT_LOCAL_PORT, DEFAULT_SYNC_INTERVAL_MS, LOGS_DIR, monitorHome, saveProbeToken, SECRET_FILE } from '../config';

export const SERVICE_ID = 'KuboMonitorEngine';
export const SERVICE_NAME = 'KUBO Monitor Engine';
export const SERVICE_ACCOUNT = 'NT AUTHORITY\\LocalService';

/** SIDs bien conocidos: no dependen del idioma de Windows («Administradores»). */
const SID_SYSTEM = '*S-1-5-18';
const SID_ADMINS = '*S-1-5-32-544';
const SID_LOCAL_SERVICE = '*S-1-5-19';

export interface InstallArgs {
  user: string;
  central: string | null;
  port: number | null;
  tokenStdin: boolean;
  dryRun: boolean;
}

export type Command = [string, string[]];

export function parseInstallArgs(argv: string[]): InstallArgs {
  const out: InstallArgs = { user: '', central: null, port: null, tokenStdin: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Falta el valor de ${a}.`);
      return v;
    };
    if (a === '--user') out.user = value();
    else if (a === '--central') out.central = value();
    else if (a === '--port') {
      const p = Number(value());
      if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`--port inválido.`);
      out.port = p;
    } else if (a === '--token-stdin') out.tokenStdin = true;
    else if (a === '--dry-run') out.dryRun = true;
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  if (!out.user) throw new Error('Falta --user DOMINIO\\usuario (el usuario de escritorio que usará el widget).');
  return out;
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildServiceXml(o: { nodePath: string; mainJs: string; home: string; workDir: string }): string {
  const e = xmlEscape;
  return [
    '<service>',
    `  <id>${SERVICE_ID}</id>`,
    `  <name>${SERVICE_NAME}</name>`,
    '  <description>KUBO: sonda de disponibilidad de la oficina (oficina-01). Mide los servicios y envía los resultados a la central.</description>',
    `  <executable>${e(o.nodePath)}</executable>`,
    `  <argument>${e(o.mainJs)}</argument>`,
    `  <env name="KUBO_MONITOR_HOME" value="${e(o.home)}"/>`,
    '  <env name="NODE_ENV" value="production"/>',
    `  <workingdirectory>${e(o.workDir)}</workingdirectory>`,
    `  <logpath>${e(win32.join(o.home, LOGS_DIR))}</logpath>`,
    '  <logmode>roll</logmode>',
    '  <startmode>Automatic</startmode>',
    '  <onfailure action="restart" delay="5 sec"/>',
    '  <onfailure action="restart" delay="30 sec"/>',
    '  <onfailure action="restart" delay="60 sec"/>',
    '  <resetfailure>1 day</resetfailure>',
    '  <stopparentprocessfirst>true</stopparentprocessfirst>',
    '</service>',
    '',
  ].join('\r\n');
}

/** Inicio automático, cuenta de mínimos privilegios y reinicio ante fallo (también con salida != 0). */
export function buildScCommands(): Command[] {
  return [
    ['sc.exe', ['config', SERVICE_ID, 'start=', 'auto', 'obj=', SERVICE_ACCOUNT, 'password=', '']],
    ['sc.exe', ['failure', SERVICE_ID, 'reset=', '86400', 'actions=', 'restart/5000/restart/30000/restart/60000']],
    ['sc.exe', ['failureflag', SERVICE_ID, '1']],
  ];
}

/**
 * Primero Administradores pasa a ser dueño de la carpeta (y de lo que ya contenga): así
 * quien la hubiera creado antes no conserva el derecho implícito de cambiar su ACL.
 */
export function buildAclCommands(home: string, user: string): Command[] {
  return [
    ['icacls.exe', [home, '/setowner', SID_ADMINS, '/T', '/C']],
    [
      'icacls.exe',
      [home, '/inheritance:r', '/grant:r', `${SID_SYSTEM}:(OI)(CI)F`, `${SID_ADMINS}:(OI)(CI)F`, `${SID_LOCAL_SERVICE}:(OI)(CI)M`, `${user}:(RX)`],
    ],
    ['icacls.exe', [win32.join(home, SECRET_FILE), '/grant:r', `${user}:(R)`]],
  ];
}

function run([cmd, args]: Command, dryRun: boolean, allowFail = false): boolean {
  console.log(`> ${cmd} ${args.map((a) => (/\s/.test(a) || a === '' ? `"${a}"` : a)).join(' ')}`);
  if (dryRun) return true;
  try {
    execFileSync(cmd, args, { stdio: 'inherit', windowsHide: true });
    return true;
  } catch (err) {
    if (allowFail) return false;
    throw err;
  }
}

/**
 * La cuenta LocalService ejecuta `process.execPath`: debe ser un Node 20 instalado para todo
 * el equipo, no uno por usuario (nvm, %LOCALAPPDATA%, perfil), que LocalService no puede leer.
 */
export function assertSystemNode(execPath: string, version: string): void {
  if (!/^v20\./.test(version)) {
    throw new Error(`Se necesita Node 20 LTS (este instalador corre con ${version}). Ejecútelo con el node.exe de Node 20 instalado para todo el equipo.`);
  }
  if (/[\\/](Users|AppData|nvm|\.nvm|scoop)[\\/]/i.test(execPath)) {
    throw new Error(`${execPath} es un Node por usuario: instale Node 20 para todo el equipo (p. ej. C:\\Program Files\\nodejs) y ejecute el instalador con él.`);
  }
}

function isAdmin(): boolean {
  try {
    execFileSync('net', ['session'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function serviceExists(): boolean {
  try {
    execFileSync('sc.exe', ['query', SERVICE_ID], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function readStdin(): string {
  return readFileSync(0, 'utf8');
}

export function install(args: InstallArgs): void {
  if (process.platform !== 'win32') throw new Error('El instalador solo funciona en Windows.');
  if (!args.dryRun && !isAdmin()) throw new Error('Ejecute el instalador como administrador.');
  if (args.dryRun) {
    try {
      assertSystemNode(process.execPath, process.version);
    } catch (err) {
      console.warn(`AVISO: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    assertSystemNode(process.execPath, process.version);
  }

  const home = monitorHome();
  const packageRoot = resolve(__dirname, '..', '..');
  const mainJs = join(packageRoot, 'dist', 'main.js');
  const serviceDir = join(packageRoot, 'service');
  const winswDir = join(dirname(require.resolve('node-windows/package.json')), 'bin', 'winsw');

  // 1. Carpeta de datos y su ACL.
  if (!args.dryRun) mkdirSync(join(home, LOGS_DIR), { recursive: true });
  const [aclOwner, aclHome, aclSecret] = buildAclCommands(home, args.user);
  run(aclOwner, args.dryRun);
  run(aclHome, args.dryRun);

  // 2. engine.json (se conserva lo que ya hubiera; --central/--port lo actualizan).
  const cfgFile = join(home, CONFIG_FILE);
  const current = existsSync(cfgFile) ? (JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>) : {};
  const cfg = {
    centralUrl: args.central ?? current.centralUrl,
    probeCode: 'oficina-01',
    localPort: args.port ?? current.localPort ?? DEFAULT_LOCAL_PORT,
    syncIntervalMs: current.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
  };
  if (!cfg.centralUrl) throw new Error('Falta --central https://… (no hay engine.json previo).');
  console.log(`engine.json: ${JSON.stringify(cfg)}`);
  if (!args.dryRun) writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

  // 3. Secreto de la API local (se conserva si existe: el widget ya lo conoce).
  const secretFile = join(home, SECRET_FILE);
  if (!args.dryRun && !existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString('hex'));
  run(aclSecret, args.dryRun);

  // 4. Token de la sonda (DPAPI, ámbito máquina).
  if (args.tokenStdin) {
    const token = readStdin().trim();
    if (!/^kmp_\S+$/.test(token)) throw new Error('El token leído por stdin no tiene la forma kmp_….');
    if (!args.dryRun) saveProbeToken(token, home);
    console.log('token.dat guardado (DPAPI).');
  } else if (!existsSync(join(home, 'token.dat'))) {
    console.warn('AVISO: no hay token.dat; el motor no podrá hablar con la central. Repita con --token-stdin.');
  }

  // 5. Servicio (WinSW) y su configuración en el SCM.
  const exe = join(serviceDir, `${SERVICE_ID}.exe`);
  const xml = buildServiceXml({ nodePath: process.execPath, mainJs, home, workDir: packageRoot });
  console.log(`${join(serviceDir, `${SERVICE_ID}.xml`)}:\n${xml}`);
  const exists = !args.dryRun && serviceExists();
  if (!args.dryRun) {
    if (exists) run(['sc.exe', ['stop', SERVICE_ID]], false, true);
    mkdirSync(serviceDir, { recursive: true });
    if (!exists || !existsSync(exe)) {
      copyFileSync(join(winswDir, 'winsw.exe'), exe);
      copyFileSync(join(winswDir, 'winsw.exe.config'), `${exe}.config`);
    }
    writeFileSync(join(serviceDir, `${SERVICE_ID}.xml`), xml);
  }
  if (!exists) run([exe, ['install']], args.dryRun);
  for (const c of buildScCommands()) run(c, args.dryRun);
  run(['sc.exe', ['start', SERVICE_ID]], args.dryRun);
  console.log(`Servicio «${SERVICE_NAME}» instalado. Datos y registros en ${home}.`);
}

if (require.main === module) {
  try {
    install(parseInstallArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

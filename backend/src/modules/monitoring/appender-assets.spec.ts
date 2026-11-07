import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * El guardián del paquete del appender que sirve DevDocs.
 *
 * El zip, el manual y el manifest se generan en la máquina del equipo con
 * `tools/kubo-log-appender/build.ps1` (la imagen de Docker no tiene .NET) y se
 * versionan. Sin esta prueba, subir una versión nueva del appender sin
 * regenerar el paquete dejaría a DevDocs ofreciendo una DLL vieja, o un zip
 * cuyo SHA-256 ya no coincide con el manifest.
 *
 * Mismo recurso que `migraciones-desplegadas.spec.ts`: lee ficheros del
 * repositorio desde el backend.
 */

/** `backend/src/modules/monitoring` → la raíz del repositorio. */
const RAIZ = join(__dirname, '..', '..', '..', '..');
const ASSETS = join(RAIZ, 'backend', 'assets', 'kubo-log-appender');
const PROPS = join(RAIZ, 'tools', 'kubo-log-appender', 'Directory.Build.props');
const AYUDA = 'Ejecuta tools/kubo-log-appender/build.ps1';

function manifest(): Record<string, string> {
  const ruta = join(ASSETS, 'manifest.json');
  if (!existsSync(ruta)) throw new Error(`Falta ${ruta}. ${AYUDA}`);
  return JSON.parse(readFileSync(ruta, 'utf8'));
}

describe('paquete del appender de logs', () => {
  it('existe el manifest.json', () => {
    if (!existsSync(join(ASSETS, 'manifest.json'))) throw new Error(`Falta manifest.json. ${AYUDA}`);
  });

  it('el zip que nombra el manifest existe y su SHA-256 coincide', () => {
    const m = manifest();
    const ruta = join(ASSETS, m.zip);
    if (!existsSync(ruta)) throw new Error(`Falta ${m.zip}. ${AYUDA}`);
    const hash = createHash('sha256').update(readFileSync(ruta)).digest('hex');
    if (hash !== m.sha256) throw new Error(`El SHA-256 del zip no coincide con el manifest. ${AYUDA}`);
  });

  it('están el manual en Markdown y en HTML', () => {
    const m = manifest();
    for (const f of [m.manualMd, m.manualHtml]) {
      if (!existsSync(join(ASSETS, f))) throw new Error(`Falta ${f}. ${AYUDA}`);
    }
  });

  it('la versión del manifest es la de Directory.Build.props', () => {
    const props = readFileSync(PROPS, 'utf8');
    const version = /<Version>([^<]+)<\/Version>/.exec(props)?.[1];
    if (manifest().version !== version) {
      throw new Error(`El paquete es de la ${manifest().version} y el appender es la ${version}. ${AYUDA}`);
    }
  });

  it('la DLL no lleva el commit de git (ni en la versión informativa ni en el Source Link)', () => {
    // El SDK de .NET 8+ añade "+<sha del commit>" a AssemblyInformationalVersion y mete el commit en el
    // Source Link del PDB, cuyo identificador queda en la DLL. Con eso la DLL, y por tanto el zip y su
    // SHA-256, cambian con cada commit aunque el appender no se haya tocado, y build.ps1 deja
    // backend/assets/ modificado en cada corrida.
    const props = readFileSync(PROPS, 'utf8');
    expect(props).toMatch(
      /<EnableSourceControlManagerQueries>\s*false\s*<\/EnableSourceControlManagerQueries>/,
    );
    expect(props).toMatch(
      /<IncludeSourceRevisionInInformationalVersion>\s*false\s*<\/IncludeSourceRevisionInInformationalVersion>/,
    );
  });
});

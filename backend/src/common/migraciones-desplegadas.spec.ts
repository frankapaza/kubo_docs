import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TICKET_ORIGINS } from '../modules/tickets/entities/ticket.entity';

/**
 * El guardián de las tres listas de despliegue.
 *
 * Existe porque es el único fallo de una migración nueva que **rompe el
 * arranque en producción** y que ninguna prueba de código detectaría: el
 * backend compila, las pruebas pasan, y la tabla no está. Las migraciones solo
 * llegan a una base por `docker-entrypoint-initdb.d` (los dos `docker-compose`)
 * o por el bucle de `deploy.yml`; si el fichero no está nombrado en las tres,
 * alguna de las bases se queda sin él.
 *
 * Mismo recurso que `bulk-users-contrato-web.spec.ts`, que ya lee un fichero
 * del repositorio desde el backend: es la única punta desde la que se ven las
 * listas y las migraciones a la vez.
 */

/** `backend/src/common` → la raíz del repositorio. */
const RAIZ = join(__dirname, '..', '..', '..');
const MIGRACIONES = join(RAIZ, 'backend', 'sql', 'migrations');

const LISTAS_DE_DESPLIEGUE = [
  join(RAIZ, '.github', 'workflows', 'deploy.yml'),
  join(RAIZ, 'docker-compose.yml'),
  join(RAIZ, 'docker-compose.dev.yml'),
];

/** La de número más alto: la que se acaba de escribir. */
function ultimaMigracion(): string {
  const nombres = readdirSync(MIGRACIONES)
    .filter((n) => /^\d{3}_.+\.sql$/.test(n))
    .sort();
  if (nombres.length === 0) throw new Error('No hay ninguna migración en backend/sql/migrations.');
  return nombres[nombres.length - 1].replace(/\.sql$/, '');
}

describe('la última migración está en las tres listas de despliegue', () => {
  it.each(LISTAS_DE_DESPLIEGUE)('%s la nombra', (lista) => {
    expect(readFileSync(lista, 'utf8')).toContain(ultimaMigracion());
  });
});

/**
 * Dos ramas que escriben su migración a la vez cogen el mismo número (pasó con
 * la 031: conector y disponibilidad). Los nombres distintos ocultan el choque
 * y el orden de aplicación queda al azar del nombre; se renumera al integrar.
 */
describe('no hay dos migraciones con el mismo número', () => {
  it('cada prefijo NNN_ es único', () => {
    const numeros = readdirSync(MIGRACIONES)
      .filter((n) => /^\d{3}_.+\.sql$/.test(n))
      .map((n) => n.slice(0, 3));
    const repetidos = numeros.filter((n, i) => numeros.indexOf(n) !== i);
    expect(repetidos).toEqual([]);
  });
});

describe('las migraciones de disponibilidad están en las tres listas de despliegue', () => {
  const NOMBRES = [
    '035_disponibilidad_nucleo',
    '036_disponibilidad_escritorio',
    '037_disponibilidad_informe',
    '038_disponibilidad_historial_agente',
    '039_disponibilidad_protocolo_http',
    '040_api_integracion_clientes',
  ];
  it.each(LISTAS_DE_DESPLIEGUE)('%s las nombra', (lista) => {
    const texto = readFileSync(lista, 'utf8');
    for (const nombre of NOMBRES) expect(texto).toContain(nombre);
  });
});

describe('la migración del catálogo no borra ni una fila', () => {
  const sql = () =>
    readFileSync(join(MIGRACIONES, '029_catalogo_de_sistemas.sql'), 'utf8').toUpperCase();

  it.each(['DROP TABLE', 'TRUNCATE', 'DELETE FROM'])('no contiene «%s»', (prohibido) => {
    expect(sql()).not.toContain(prohibido);
  });

  it('anota los dudosos en su propia tabla en vez de decidir por ellos', () => {
    expect(sql()).toContain('SYSTEM_CATALOG_CONFLICTS');
  });
});

describe('la migración del monitoreo', () => {
  const crudo = () => readFileSync(join(MIGRACIONES, '030_logs_centralizados.sql'), 'utf8');
  const sql = () => crudo().toUpperCase();

  /** La lista de orígenes, escrita a mano: es lo que ata la migración a la entidad. */
  const ORIGENES = [
    'EMAIL',
    'WHATSAPP_TEXT',
    'WHATSAPP_AUDIO',
    'VOICE_LIVE',
    'MEETING',
    'NOTE',
    'PORTAL',
    'MONITOREO',
  ];

  it.each(['DROP TABLE', 'TRUNCATE', 'DELETE FROM'])('no contiene «%s»', (prohibido) => {
    expect(sql()).not.toContain(prohibido);
  });

  it('amplía el ENUM de tickets.origin con la lista completa y en orden', () => {
    const lista = ORIGENES.map((o) => `'${o}'`).join(',');
    // Se ignoran espacios y saltos de línea: el SQL parte la lista en varias líneas.
    expect(crudo().replace(/\s+/g, '')).toContain(`ENUM(${lista})`);
  });

  it('la lista de la migración coincide con TICKET_ORIGINS de la entidad', () => {
    expect([...TICKET_ORIGINS]).toEqual(ORIGENES);
  });
});

describe('la migración 002 en una base nueva', () => {
  // schema.sql ya declara participants.document_number, y los dos docker-compose ejecutan la 002 detrás de
  // él en initdb: un ALTER sin guarda aborta el arranque de MySQL con «Duplicate column name» y ninguna
  // migración posterior llega a correr.
  const sql = () =>
    readFileSync(join(MIGRACIONES, '002_participants_and_members.sql'), 'utf8').toUpperCase();

  it('añade document_number solo si no existe', () => {
    const texto = sql();
    const guarda = texto.search(/IF NOT EXISTS \(\s*SELECT 1 FROM INFORMATION_SCHEMA\.COLUMNS[^)]*'DOCUMENT_NUMBER'/);
    const alter = texto.search(/ALTER TABLE PARTICIPANTS\s+ADD COLUMN DOCUMENT_NUMBER/);
    expect(guarda).toBeGreaterThanOrEqual(0);
    // El ALTER tiene que quedar dentro de la guarda, no antes ni suelto.
    expect(alter).toBeGreaterThan(guarda);
    expect(texto.match(/ADD COLUMN DOCUMENT_NUMBER/g)).toHaveLength(1);
  });
});

describe('la migración del conector de tickets', () => {
  const sql = () =>
    readFileSync(join(MIGRACIONES, '031_conector_repos.sql'), 'utf8').toUpperCase();

  it.each(['DROP TABLE', 'TRUNCATE', 'DELETE FROM'])('no contiene «%s»', (prohibido) => {
    expect(sql()).not.toContain(prohibido);
  });

  it.each(['DEV_REPOS', 'DEV_KEYS', 'DEV_LINKS'])('crea %s', (tabla) => {
    expect(sql()).toContain(`CREATE TABLE IF NOT EXISTS ${tabla}`);
  });

  it('da a work_items su sistema', () => {
    expect(sql()).toMatch(/'WORK_ITEMS',\s*'CLIENT_SYSTEM_ID'/);
  });
});

describe('deploy.sh nombra la migración 037 (aviso de aplicarla a mano)', () => {
  it('la menciona', () => {
    expect(readFileSync(join(RAIZ, 'deploy.sh'), 'utf8')).toContain('037_disponibilidad_informe');
  });
});

describe('el bucle de migraciones de deploy.yml', () => {
  /** Las palabras entre `for m in` y `; do`, con las continuaciones de línea resueltas. */
  function palabras(): string[] {
    const yml = readFileSync(LISTAS_DE_DESPLIEGUE[0], 'utf8').replace(/\r\n/g, '\n');
    const m = yml.match(/for m in([\s\S]*?);\s*do/);
    if (!m) throw new Error('No se encontró el bucle for m in de deploy.yml.');
    // La barra invertida de continuación se quita; una «\n» literal queda como palabra y se detecta.
    return m[1].replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean);
  }

  it('solo contiene nombres de migración (ninguna palabra suelta)', () => {
    for (const w of palabras()) expect(w).toMatch(/^\d{3}_[a-z0-9_]+$/);
  });

  it('incluye la 037', () => {
    expect(palabras()).toContain('037_disponibilidad_informe');
  });

  it('incluye la 038', () => {
    expect(palabras()).toContain('038_disponibilidad_historial_agente');
  });

  it('incluye la 039', () => {
    expect(palabras()).toContain('039_disponibilidad_protocolo_http');
  });

  it('incluye la 040', () => {
    expect(palabras()).toContain('040_api_integracion_clientes');
  });
});

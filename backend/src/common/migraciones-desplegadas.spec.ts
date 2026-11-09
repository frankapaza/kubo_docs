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

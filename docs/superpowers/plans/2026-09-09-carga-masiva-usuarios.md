# Carga masiva de usuarios de cliente — Plan de implementación

> **Para trabajadores agénticos:** SUB-HABILIDAD REQUERIDA: usa superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans para implementar este plan tarea a tarea. Los pasos usan casillas (`- [ ]`) para poder marcarlos.

**Goal:** Que el personal de la casa dé de alta a los usuarios de una empresa cliente recién creada subiendo una hoja de cálculo, generando **invitaciones** —nunca contraseñas—, con una revisión previa que enseña fila a fila qué va a pasar antes de que salga ningún correo.

**Architecture:** Dos pasos, dos rutas. `POST …/carga-masiva/revision` analiza el archivo **en el servidor** (`exceljs` para `.xlsx`, analizador propio para texto separado), evalúa cada fila contra la base y devuelve un veredicto por fila más un **bloque opaco firmado con HMAC** que describe lo aprobado. `POST …/carga-masiva/envio` verifica esa firma, **vuelve a evaluar cada fila contra la base**, y crea las invitaciones una a una reutilizando el motor de R4 (secreto de 32 bytes, huella en base, caducidad de 7 días, uso único). La invitación gana un segundo tipo de autor —el personal— con columna propia, sin mentir sobre cuál fue.

**Tech Stack:** NestJS 10 · TypeORM 0.3 (`synchronize: false`) · MySQL 8 · Jest 29 (con `TZ=UTC` forzado desde `jest.config.js`) · multer (memoria) · **`exceljs` (única dependencia nueva, backend)** · React 18 + Vite + TypeScript + Tailwind

**Spec:** `docs/superpowers/specs/2026-09-09-carga-masiva-usuarios-design.md`
**Spec de la que cuelga (vigente, no la contradigas):** `docs/superpowers/specs/2026-08-26-usuarios-desde-el-portal-design.md`

## Global Constraints

Todas las tareas de este plan las incluyen implícitamente. Van copiadas al pie de la letra.

- **`synchronize: false`**: todo cambio de esquema es una migración SQL escrita a mano, idempotente, con el patrón de las anteriores. **Si hace falta migración, la nueva es la 027 y tiene que ir en las TRES listas de despliegue** (`.github/workflows/deploy.yml`, `docker-compose.yml`, `docker-compose.dev.yml`). Olvidar una rompe el arranque en producción.
- **TypeORM devuelve `bigint` como cadena.** Nunca `===` entre identificadores; usa `sameId` de `backend/src/common/ids.ts`.
- **Transacciones:** `runInTransaction` + `manager.getRepository(...)`, jamás el repositorio inyectado.
- **Proyección campo a campo con lista blanca.** El secreto de una invitación **nunca** sale hacia arriba, ni en claro ni su huella.
- **El interceptor de auditoría tacha por patrón** cualquier campo cuyo nombre contenga contraseña, secreto o credencial. Comprueba que lo que mande esta funcionalidad no se salte eso.
- **Producción corre en UTC y el desarrollo en América/Lima.** Ha habido **siete** fallos de zona horaria en esta serie. Y **las pruebas fuerzan la zona a universal**, así que ejecutar con otra zona no demuestra nada en esta máquina: razona y fija el comportamiento con pruebas que no dependan de la zona del proceso.
- **Los mensajes de validación y los textos van en español.**
- Al final de cada tarea: `cd backend && npx jest && npx tsc --noEmit`, y si toca frontend `cd web && npx tsc --noEmit && npm run build`.

## Estructura de ficheros

**Backend — se crean:**
- `backend/sql/migrations/027_carga_masiva_usuarios.sql` — el segundo tipo de autor de una invitación.
- `backend/src/modules/portal/domain/bulk-user-file.ts` — contrato de columnas, análisis de texto separado, tope de filas. **Puro**: sin base, sin red, sin reloj, **sin `exceljs`**.
- `backend/src/modules/portal/bulk-users-workbook.ts` — **el único fichero que importa `exceljs`**: genera la plantilla, lee el libro, guarda de ZIP.
- `backend/src/modules/portal/domain/bulk-users-review.ts` — el bloque firmado, su MAC y su caducidad. **Puro**, con el instante por argumento.
- `backend/src/modules/portal/client-users-bulk.service.ts` — la orquestación: revisar y enviar.
- `backend/src/modules/portal/dto/bulk-users.dto.ts`
- `backend/src/modules/portal/interceptors/bulk-upload-errors.interceptor.ts`
- Los `.spec.ts` de cada uno, al lado.

**Backend — se modifican:**
- `backend/src/modules/portal/entities/client-user-invitation.entity.ts` — `invitedByUserId` nueva, `invitedByClientUserId` nulable.
- `backend/src/modules/portal/portal-invitations.service.ts` — autor de dos tipos, en `invite`, `accept` y `preview`.
- `backend/src/modules/portal/portal-users.controller.ts` — el call site de `invite`.
- `backend/src/modules/portal/client-users.controller.ts` — las tres rutas nuevas.
- `backend/src/modules/portal/portal.module.ts` — `UsersModule`, servicio nuevo.
- `backend/src/config/throttler.config.ts` — `BULK_INVITE_THROTTLE`.
- `backend/src/config/portal-schema.validator.ts` (+ su spec).
- `backend/package.json` — `exceljs`.
- `.github/workflows/deploy.yml`, `docker-compose.yml`, `docker-compose.dev.yml`.

**Web — se crean:**
- `web/src/api/client-users-bulk.api.ts`
- `web/src/pages/client-users/BulkInviteDialog.tsx`

**Web — se modifican:**
- `web/src/pages/ClientUsersPage.tsx`

---

### Task 1: El segundo tipo de autor — migración 027, entidad y las tres listas de despliegue

**Files:**
- Create: `backend/sql/migrations/027_carga_masiva_usuarios.sql`
- Modify: `backend/src/modules/portal/entities/client-user-invitation.entity.ts`
- Modify: `backend/src/config/portal-schema.validator.ts`
- Modify: `.github/workflows/deploy.yml`, `docker-compose.yml`, `docker-compose.dev.yml`
- Test: `backend/src/config/portal-schema.validator.spec.ts`

**Interfaces:**
- Consume: nada (primera tarea).
- Produce:
  - Columna `client_user_invitations.invited_by_user_id BIGINT UNSIGNED NULL` (apunta a `users`).
  - `client_user_invitations.invited_by_client_user_id` pasa de `NOT NULL` a `NULL`.
  - Restricción `chk_cui_un_solo_autor`: exactamente una de las dos informada.
  - En la entidad: `ClientUserInvitation.invitedByClientUserId!: number | null` y `ClientUserInvitation.invitedByUserId!: number | null`.
  - `PortalSchemaValidator.MIGRATION_027 = 'migrations/027_carga_masiva_usuarios.sql'`.

Contexto que hay que leer antes: **las tres listas de despliegue están escritas a mano y no comparten formato.** `deploy.yml` es un bucle `for m in …` con los nombres **sin extensión**; `docker-compose.yml` monta cada fichero **con su propio nombre**; `docker-compose.dev.yml` los monta **renumerados** (`035_mig_026.sql`) y tiene **un seed detrás que también hay que renumerar**. Olvidar cualquiera de las tres deja el backend abortando al arrancar por `PortalSchemaValidator`.

- [ ] **Step 1: Escribir la prueba que falla, en el validador de esquema**

En `backend/src/config/portal-schema.validator.spec.ts`, junto a los bloques `TABLA_026` / `COLUMNA_026` que ya existen:

```ts
/**
 * La columna que añade la 027: el miembro del personal que lanzó una carga
 * masiva. `invited_by_client_user_id` pasando a nulable NO se comprueba aquí
 * —este validador mira presencia de tablas y columnas en `information_schema`,
 * y "existe pero admite nulo" no es ninguna de las dos cosas—, pero como la
 * 027 hace las dos cosas en el mismo fichero, exigir la columna nueva ya exige
 * haber pasado la migración entera.
 */
const COLUMNA_027 = {
  tableName: 'client_user_invitations',
  columnName: 'invited_by_user_id',
};
```

Añade `COLUMNA_027` a `COLUMNAS_ESPERADAS` y escribe:

```ts
it('atribuye a la 027 el autor de personal de una invitación', async () => {
  const validator = new PortalSchemaValidator(
    dataSourceWith(
      TABLAS_ESPERADAS,
      COLUMNAS_ESPERADAS.filter(
        (c) =>
          !(c.tableName === 'client_user_invitations' && c.columnName === 'invited_by_user_id'),
      ),
    ),
  );

  await expect(validator.onApplicationBootstrap()).rejects.toThrow(
    /027_carga_masiva_usuarios\.sql/,
  );
});
```

- [ ] **Step 2: Ejecutarla y ver que falla**

Run: `cd backend && npx jest src/config/portal-schema.validator.spec.ts`
Expected: FAIL — el validador no conoce ninguna columna `invited_by_user_id`, así que no falta nada y la promesa resuelve en vez de rechazar.

- [ ] **Step 3: Añadir la 027 al validador**

En `backend/src/config/portal-schema.validator.ts`, junto a las constantes hermanas:

```ts
  private static readonly MIGRATION_027 = 'migrations/027_carga_masiva_usuarios.sql';
```

Y en la lista de columnas requeridas, donde estén las de la 026:

```ts
      {
        kind: 'columna',
        name: 'client_user_invitations.invited_by_user_id',
        files: [PortalSchemaValidator.MIGRATION_027],
      },
```

- [ ] **Step 4: Escribir la migración**

Crea `backend/sql/migrations/027_carga_masiva_usuarios.sql`. Copia el patrón exacto de la 026: `USE`, `SET NAMES`, procedimiento guardado por `information_schema`, `DROP PROCEDURE IF EXISTS` antes y después.

```sql
-- =========================================================================
--  Migración 027 — Carga masiva de usuarios de cliente
-- =========================================================================
--  Una invitación puede nacer de dos sitios distintos, y hay que poder
--  saber de cuál sin inventarse nada.
--
--  Hasta aquí solo nacía en el portal, así que `invited_by_client_user_id`
--  era NOT NULL y apuntaba a `client_users`. La carga masiva la lanza
--  personal de la casa sobre una empresa que NO TIENE NINGÚN USUARIO -ese
--  es exactamente el problema que resuelve-, así que no hay ningún usuario
--  de cliente al que apuntar.
--
--  Se hace lo mismo que la 026 hizo con `client_users.created_by`: columna
--  aparte para el autor nuevo, y la vieja pasa a admitir vacío. NO un
--  `invited_by` polimórfico con discriminador: `users` y `client_users` son
--  tablas distintas a propósito (ver la 013) y un mismo entero no puede
--  significar una fila de una o de otra según el viento.
--
--  El CHECK es lo que impide la tercera posibilidad -las dos vacías, o las
--  dos puestas-, que no significa nada y que el código tendría que decidir
--  cómo interpretar. Se valida contra las filas existentes al crearse: hoy
--  todas tienen `invited_by_client_user_id` y la columna nueva vacía, así
--  que la cumplen. Si alguna no la cumpliera, esta migración FALLA, y esa
--  es la dirección correcta del fallo.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- -------------------------------------------------------------------------
-- 1) El autor de personal
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_column_027;
DELIMITER //
CREATE PROCEDURE kubo_add_column_027(
  IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_ddl VARCHAR(512))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'kubo_devdocs'
      AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE ', p_table, ' ADD COLUMN ', p_ddl);
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

CALL kubo_add_column_027('client_user_invitations', 'invited_by_user_id',
  'invited_by_user_id BIGINT UNSIGNED NULL '
  "COMMENT 'el miembro del personal que lanzo la carga masiva; NULL si invito un administrador de cliente' "
  'AFTER invited_by_client_user_id');

DROP PROCEDURE IF EXISTS kubo_add_column_027;

-- -------------------------------------------------------------------------
-- 2) El autor de cliente deja de ser obligatorio
-- -------------------------------------------------------------------------
--  Guardado por IS_NULLABLE y no por presencia de columna: la columna ya
--  existe desde la 026, así que el ayudante de arriba no serviría. Mismo
--  criterio que la sección 3 de la 026.
--
--  Un MODIFY sobre una columna que ya admite nulo no daría error, pero
--  reescribiría la tabla entera en cada pasada.
DROP PROCEDURE IF EXISTS kubo_relax_column_027;
DELIMITER //
CREATE PROCEDURE kubo_relax_column_027()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'kubo_devdocs'
      AND TABLE_NAME = 'client_user_invitations'
      AND COLUMN_NAME = 'invited_by_client_user_id'
      AND IS_NULLABLE = 'NO'
  ) THEN
    ALTER TABLE client_user_invitations
      MODIFY COLUMN invited_by_client_user_id BIGINT UNSIGNED NULL
      COMMENT 'el administrador de cliente que invito; NULL si la invitacion la creo el personal';
  END IF;
END //
DELIMITER ;

CALL kubo_relax_column_027();
DROP PROCEDURE IF EXISTS kubo_relax_column_027;

-- -------------------------------------------------------------------------
-- 3) Exactamente uno de los dos autores
-- -------------------------------------------------------------------------
--  Requiere MySQL 8.0.16+, que es lo que corre. Guardado por presencia de
--  la restricción, no por try/catch: repetir el ALTER daría error de
--  duplicado y pararía el arranque.
DROP PROCEDURE IF EXISTS kubo_add_check_027;
DELIMITER //
CREATE PROCEDURE kubo_add_check_027()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = 'kubo_devdocs'
      AND TABLE_NAME = 'client_user_invitations'
      AND CONSTRAINT_NAME = 'chk_cui_un_solo_autor'
  ) THEN
    ALTER TABLE client_user_invitations
      ADD CONSTRAINT chk_cui_un_solo_autor CHECK (
        (invited_by_client_user_id IS NULL) <> (invited_by_user_id IS NULL)
      );
  END IF;
END //
DELIMITER ;

CALL kubo_add_check_027();
DROP PROCEDURE IF EXISTS kubo_add_check_027;
```

- [ ] **Step 5: Ablandar la entidad**

En `backend/src/modules/portal/entities/client-user-invitation.entity.ts`, sustituye la declaración de `invitedByClientUserId` por estas dos:

```ts
  /**
   * El administrador de cliente que invitó, si la invitación nació en el
   * portal. **Nulable desde la 027**: cuando la lanza una carga masiva del
   * panel no hay ningún usuario de cliente al que apuntar —la empresa puede
   * no tener ninguno todavía, que es el problema que esa funcionalidad
   * resuelve—, y rellenarlo con uno inventado es el defecto recurrente de
   * este proyecto: decidir por la ausencia de un valor en vez de por el hecho
   * que lo determina.
   *
   * **Exactamente una de las dos columnas de autor está informada**, nunca
   * las dos y nunca ninguna. Lo sostiene `chk_cui_un_solo_autor` en la base;
   * el código no se apoya en eso y trata «ninguna» como enlace no válido.
   */
  @Column({ name: 'invited_by_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  invitedByClientUserId!: number | null;

  /** El miembro del personal que lanzó la carga masiva. Ver la columna hermana. */
  @Column({ name: 'invited_by_user_id', type: 'bigint', unsigned: true, nullable: true })
  invitedByUserId!: number | null;
```

- [ ] **Step 6: Ejecutar la prueba y verla pasar**

Run: `cd backend && npx jest src/config/portal-schema.validator.spec.ts`
Expected: PASS

- [ ] **Step 7: Las tres listas de despliegue**

En `.github/workflows/deploy.yml`, dentro del bucle `for m in …`, detrás de `026_invitaciones_portal`:

```yaml
                     026_invitaciones_portal \
                     027_carga_masiva_usuarios; do
```

En `docker-compose.yml`, detrás del montaje de la 026:

```yaml
      # La 027 da a una invitacion un segundo tipo de autor: el personal de la
      # casa que lanza una carga masiva. Anade invited_by_user_id, ablanda
      # invited_by_client_user_id a nulable y exige por CHECK que este
      # informado exactamente uno de los dos.
      - ./backend/sql/migrations/027_carga_masiva_usuarios.sql:/docker-entrypoint-initdb.d/027_carga_masiva_usuarios.sql:ro
```

En `docker-compose.dev.yml`, detrás de `035_mig_026.sql`, **y renumerando el seed que va detrás** (de `036_seed_templates.sql` a `037_seed_templates.sql`):

```yaml
      - ./backend/sql/migrations/027_carga_masiva_usuarios.sql:/docker-entrypoint-initdb.d/036_mig_027.sql:ro
      # Seeds — van detrás de todas las migraciones, así que el seed se
      # renumera cada vez que entra una migración nueva.
      - ./backend/sql/seed_document_templates.sql:/docker-entrypoint-initdb.d/037_seed_templates.sql:ro
```

- [ ] **Step 8: Verificación completa**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS. `tsc` es aquí la prueba de verdad de la entidad: cualquier sitio que leyera `invitedByClientUserId` como `number` sin admitir `null` deja de compilar, y esos son exactamente los sitios que la Task 5 tiene que arreglar. Si aparecen errores en `portal-invitations.service.ts`, **no los arregles todavía con un `!` ni con un `as number`**: apúntalos, y si son solo esos, ciérralos con `Number(...)` que ya está en el código actual (`Number(inv.invitedByClientUserId)`), que sigue compilando con `number | null`.

- [ ] **Step 9: Commit**

```bash
git add backend/sql/migrations/027_carga_masiva_usuarios.sql \
        backend/src/modules/portal/entities/client-user-invitation.entity.ts \
        backend/src/config/portal-schema.validator.ts \
        backend/src/config/portal-schema.validator.spec.ts \
        .github/workflows/deploy.yml docker-compose.yml docker-compose.dev.yml
git commit -m "feat(portal): una invitacion puede tener por autor al personal de la casa"
```

---

### Task 2: El dominio del archivo — columnas, texto separado y tope de filas

**Files:**
- Create: `backend/src/modules/portal/domain/bulk-user-file.ts`
- Test: `backend/src/modules/portal/domain/bulk-user-file.spec.ts`

**Interfaces:**
- Consume: nada de tareas anteriores.
- Produce, todo desde `domain/bulk-user-file.ts`:
  - `MAX_BULK_ROWS = 200`
  - `MAX_BULK_FILE_BYTES = 512 * 1024`
  - `BULK_UPLOAD_LIMITS: { fileSize: number; files: number }`
  - `COLUMNA_NOMBRE = 'Nombre completo'`, `COLUMNA_CORREO = 'Correo electrónico'`
  - `interface RawBulkRow { line: number; fullName: string; email: string }`
  - `normalizeHeader(text: string): string`
  - `looksLikeZip(buffer: Buffer): boolean`
  - `decodeTextFile(buffer: Buffer): string`
  - `sniffDelimiter(headerLine: string): string`
  - `parseDelimitedText(text: string): string[][]`
  - `gridToRows(grid: string[][]): RawBulkRow[]`
  - `archivoRechazado(message: string): BadRequestException` — cuerpo `{ code: 'ARCHIVO_NO_VALIDO', message }`

**Puro**: sin base, sin red, sin reloj, **sin `exceljs`**. Lanza excepciones de Nest, como ya hace `modules/ticket-messages/domain/attachment-rules.ts`: es el precedente de la casa para un dominio que decide admisión.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `backend/src/modules/portal/domain/bulk-user-file.spec.ts`:

```ts
import {
  COLUMNA_CORREO,
  COLUMNA_NOMBRE,
  MAX_BULK_ROWS,
  decodeTextFile,
  gridToRows,
  looksLikeZip,
  normalizeHeader,
  parseDelimitedText,
  sniffDelimiter,
} from './bulk-user-file';

const CABECERA = [COLUMNA_NOMBRE, COLUMNA_CORREO];

describe('normalizeHeader', () => {
  it('recorta, baja a minúsculas, colapsa espacios y quita tildes', () => {
    expect(normalizeHeader('  Correo   ELECTRÓNICO ')).toBe('correo electronico');
  });

  it('no revienta con lo que no es una cadena', () => {
    expect(normalizeHeader(undefined as unknown as string)).toBe('');
  });
});

describe('looksLikeZip', () => {
  it('reconoce la firma PK\\x03\\x04', () => {
    expect(looksLikeZip(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toBe(true);
  });

  it('un texto no es un ZIP por mucho que se llame .xlsx', () => {
    expect(looksLikeZip(Buffer.from('Nombre completo,Correo', 'utf8'))).toBe(false);
  });

  it('un buffer más corto que la firma no revienta', () => {
    expect(looksLikeZip(Buffer.from([0x50, 0x4b]))).toBe(false);
  });
});

describe('decodeTextFile', () => {
  it('se come la marca de orden de bytes y no la deja en el primer encabezado', () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('Nombre completo,Correo electrónico', 'utf8'),
    ]);
    expect(decodeTextFile(bytes).startsWith(COLUMNA_NOMBRE)).toBe(true);
  });

  it('lee UTF-8 cuando los bytes son UTF-8 válido', () => {
    expect(decodeTextFile(Buffer.from('Muñoz Peña', 'utf8'))).toBe('Muñoz Peña');
  });

  it('cae a latin1 cuando los bytes NO son UTF-8 válido — el Excel en español', () => {
    // `Muñoz` con la eñe en un solo byte (0xF1): lo que escribe Excel al
    // guardar «CSV (delimitado por comas)» en un Windows en español.
    expect(decodeTextFile(Buffer.from('Mu\xf1oz', 'latin1'))).toBe('Muñoz');
  });

  it('rechaza un binario disfrazado: un byte nulo no aparece en un archivo de texto', () => {
    expect(() => decodeTextFile(Buffer.from([0x41, 0x00, 0x42]))).toThrow(/hoja de cálculo/i);
  });
});

describe('sniffDelimiter', () => {
  it('coma', () => {
    expect(sniffDelimiter('Nombre completo,Correo electrónico')).toBe(',');
  });

  it('punto y coma — lo que escribe Excel en un Windows en español', () => {
    expect(sniffDelimiter('Nombre completo;Correo electrónico')).toBe(';');
  });

  it('tabulador', () => {
    expect(sniffDelimiter('Nombre completo\tCorreo electrónico')).toBe('\t');
  });

  it('no cuenta los separadores que van dentro de comillas', () => {
    // Una sola columna entrecomillada con comas dentro y un punto y coma de
    // verdad al final: gana el punto y coma, no la coma.
    expect(sniffDelimiter('"Pérez, Ana";Correo')).toBe(';');
  });

  it('sin ningún separador no hay dos columnas: se rechaza', () => {
    expect(() => sniffDelimiter('Nombre completo')).toThrow(/separador/i);
  });
});

describe('parseDelimitedText', () => {
  it('entiende comillas con el separador dentro y comillas dobles escapadas', () => {
    const texto = 'Nombre completo,Correo electrónico\r\n"Pérez, Ana",ana@x.com\r\n"Di ""Bo""",bo@x.com';
    expect(parseDelimitedText(texto)).toEqual([
      ['Nombre completo', 'Correo electrónico'],
      ['Pérez, Ana', 'ana@x.com'],
      ['Di "Bo"', 'bo@x.com'],
    ]);
  });

  it('entiende \\n a secas igual que \\r\\n', () => {
    expect(parseDelimitedText('a;b\nc;d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('gridToRows', () => {
  it('exige las dos columnas, sin importar tildes ni mayúsculas', () => {
    const filas = gridToRows([
      ['  nombre COMPLETO ', 'CORREO ELECTRONICO'],
      ['Ana Pérez', 'ana@x.com'],
    ]);
    expect(filas).toEqual([{ line: 2, fullName: 'Ana Pérez', email: 'ana@x.com' }]);
  });

  it('el número de fila es el del ARCHIVO, contando la cabecera', () => {
    const filas = gridToRows([CABECERA, ['Ana', 'a@x.com'], ['Bea', 'b@x.com']]);
    expect(filas.map((f) => f.line)).toEqual([2, 3]);
  });

  it('salta las filas del todo vacías que deja Excel al arrastrar', () => {
    const filas = gridToRows([CABECERA, ['', ''], ['Ana', 'a@x.com'], ['   ', '']]);
    expect(filas).toEqual([{ line: 4, fullName: 'Ana', email: 'a@x.com' }]);
  });

  it('una fila con UN solo campo relleno NO está vacía: se conserva para que se informe de ella', () => {
    const filas = gridToRows([CABECERA, ['Ana', '']]);
    expect(filas).toEqual([{ line: 2, fullName: 'Ana', email: '' }]);
  });

  it('rechaza el archivo entero si sobra una columna', () => {
    expect(() => gridToRows([[...CABECERA, 'Es administrador'], ['Ana', 'a@x.com', 'sí']])).toThrow(
      /Nombre completo/,
    );
  });

  it('rechaza el archivo entero si las columnas están en otro orden — no se adivina por posición', () => {
    expect(() => gridToRows([[COLUMNA_CORREO, COLUMNA_NOMBRE], ['a@x.com', 'Ana']])).toThrow(
      /Nombre completo/,
    );
  });

  it('rechaza un archivo sin ninguna fila de datos', () => {
    expect(() => gridToRows([CABECERA])).toThrow(/ninguna fila/i);
  });

  it('rechaza el archivo ENTERO al pasarse del tope, no recorta las primeras', () => {
    const grid = [CABECERA, ...Array.from({ length: MAX_BULK_ROWS + 1 }, (_, i) => [`P${i}`, `p${i}@x.com`])];
    expect(() => gridToRows(grid)).toThrow(new RegExp(String(MAX_BULK_ROWS)));
  });
});
```

- [ ] **Step 2: Ejecutarlas y ver que fallan**

Run: `cd backend && npx jest src/modules/portal/domain/bulk-user-file.spec.ts`
Expected: FAIL — `Cannot find module './bulk-user-file'`.

- [ ] **Step 3: Escribir el dominio**

Crea `backend/src/modules/portal/domain/bulk-user-file.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

/**
 * El contrato del archivo de carga masiva de usuarios de cliente.
 *
 * Dominio puro: no consulta la base, no manda correo, no lee el reloj y
 * **no importa `exceljs`**. Lo que sabe de hojas de cálculo vive en
 * `../bulk-users-workbook.ts`; aquí solo entran cuadrículas de texto ya
 * leídas y buffers de texto plano.
 *
 * Lanza excepciones de Nest, como `ticket-messages/domain/attachment-rules.ts`:
 * es el precedente de la casa para un dominio que decide admisión, y evita que
 * cada llamante invente su propio código de error para la misma regla.
 */

/**
 * Tope de filas de datos. Pasarse rechaza el ARCHIVO ENTERO; no se recortan
 * las primeras 200.
 *
 * Truncar en silencio es el peor de los tres resultados posibles: el operador
 * vería «invitadas 200» y no tendría forma de saber que faltan. El caso real
 * son 22 personas.
 */
export const MAX_BULK_ROWS = 200;

/**
 * Tope de tamaño: 512 KB. La plantilla con 22 filas pesa unos 6 KB, así que
 * esto son dos órdenes de magnitud de margen y sigue siendo irrelevante para
 * la memoria del proceso.
 */
export const MAX_BULK_FILE_BYTES = 512 * 1024;

/**
 * El mismo tope con la forma que espera multer, y **un solo archivo por
 * petición**. Es la criba que corta ANTES de tener el archivo entero en
 * memoria; no es quien decide si el contenido vale. Mismo criterio, y por el
 * mismo motivo, que `ATTACHMENT_UPLOAD_LIMITS`.
 */
export const BULK_UPLOAD_LIMITS = { fileSize: MAX_BULK_FILE_BYTES, files: 1 } as const;

/** Los dos encabezados, tal cual se escriben en la plantilla. */
export const COLUMNA_NOMBRE = 'Nombre completo';
export const COLUMNA_CORREO = 'Correo electrónico';

/** Una fila del archivo, todavía sin validar nada de su contenido. */
export interface RawBulkRow {
  /** Número de fila **en el archivo**, contando la cabecera. Es lo único que hace accionable el informe. */
  line: number;
  fullName: string;
  email: string;
}

/** Cuerpo único de los rechazos que tumban el archivo entero. */
export function archivoRechazado(message: string): BadRequestException {
  return new BadRequestException({ code: 'ARCHIVO_NO_VALIDO', message });
}

/**
 * El encabezado, comparable.
 *
 * Recorta, baja a minúsculas, quita las tildes y colapsa los espacios. Las
 * cuatro cosas porque las cuatro pasan de verdad: quien rellena la plantilla
 * escribe «CORREO ELECTRONICO», o mete un espacio de más, o su Excel
 * autocorrige la tilde. Rechazar por eso sería rechazar por nada.
 *
 * `normalize('NFD')` + quitar los diacríticos, no una tabla de sustituciones:
 * una tabla se olvida de la diéresis el día que alguien escriba «Bilingüe».
 */
export function normalizeHeader(text: string): string {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Firma de un ZIP local file header: `PK\x03\x04`. */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

/**
 * Si esos bytes empiezan por la firma de un ZIP —y por tanto pueden ser un
 * `.xlsx`, que es un ZIP—.
 *
 * **Por los bytes, jamás por la extensión ni por el `Content-Type`.** Los dos
 * los pone quien sube, y comprobar la extensión es no comprobar nada. Misma
 * disciplina que `attachment-rules.ts`.
 */
export function looksLikeZip(buffer: Buffer): boolean {
  if (buffer.length < ZIP_SIGNATURE.length) return false;
  return ZIP_SIGNATURE.every((byte, i) => buffer[i] === byte);
}

/** Marca de orden de bytes de UTF-8. */
const BOM = [0xef, 0xbb, 0xbf];

/**
 * Los bytes, convertidos a texto.
 *
 * Dos cuidados, y los dos vienen de lo que Excel hace de verdad al guardar un
 * CSV (decisión 2 de la spec):
 *
 * 1. **La marca de orden de bytes se quita.** Excel la escribe al guardar
 *    «CSV UTF-8» y no al guardar «CSV» a secas. Si se deja, el primer
 *    encabezado pasa a ser `﻿Nombre completo` y no casa con nada — un
 *    archivo perfectamente correcto rechazado por un carácter invisible.
 * 2. **La codificación se deduce, no se supone.** Si los bytes son UTF-8
 *    válido, es UTF-8; si no, se lee como `latin1`, que es lo que escribe un
 *    Excel en español cuando no pone la marca. La comprobación es
 *    reinterpretar y comparar los bytes, la misma que hace
 *    `decodeMultipartFilename` en `common/http/`, y no una lista de
 *    codificaciones a probar: el caso real es exactamente ese, nombres con
 *    tildes y eñes.
 *
 * Y una tercera cosa, que es una defensa y no una comodidad: **un byte nulo
 * significa que esto no es texto**. Es lo que descarta un binario cualquiera
 * renombrado a `.csv`, que es lo único que llega a esta rama después de que
 * `looksLikeZip` se haya llevado los ZIP.
 */
export function decodeTextFile(buffer: Buffer): string {
  const sinBom =
    buffer.length >= 3 && BOM.every((byte, i) => buffer[i] === byte) ? buffer.subarray(3) : buffer;

  if (sinBom.includes(0x00)) {
    throw archivoRechazado(
      'El archivo no es una hoja de cálculo ni un archivo de texto. ' +
        'Descarga la plantilla, rellénala y súbela sin cambiarle el formato.',
    );
  }

  const comoUtf8 = sinBom.toString('utf8');
  const esUtf8Valido = Buffer.from(comoUtf8, 'utf8').equals(sinBom);
  return esUtf8Valido ? comoUtf8 : sinBom.toString('latin1');
}

/** Los tres separadores que se aceptan, en orden de preferencia ante un empate. */
const SEPARADORES = [',', ';', '\t'] as const;

/**
 * El separador del archivo, olfateado en la línea de encabezado.
 *
 * Se cuenta **fuera de comillas**: un encabezado entrecomillado con comas
 * dentro (`"Pérez, Ana"`) no debe ganarle al separador de verdad. Sin esto, un
 * archivo con `;` y una celda con comas se partía por donde no era.
 */
export function sniffDelimiter(headerLine: string): string {
  const conteo = new Map<string, number>(SEPARADORES.map((s) => [s, 0]));
  let dentroDeComillas = false;

  for (const caracter of headerLine) {
    if (caracter === '"') {
      dentroDeComillas = !dentroDeComillas;
      continue;
    }
    if (dentroDeComillas) continue;
    const previo = conteo.get(caracter);
    if (previo !== undefined) conteo.set(caracter, previo + 1);
  }

  let mejor = '';
  let mejorConteo = 0;
  for (const separador of SEPARADORES) {
    const veces = conteo.get(separador)!;
    if (veces > mejorConteo) {
      mejor = separador;
      mejorConteo = veces;
    }
  }

  if (!mejor) {
    throw archivoRechazado(
      'No se reconoce el separador del archivo. La primera fila tiene que llevar las columnas ' +
        `«${COLUMNA_NOMBRE}» y «${COLUMNA_CORREO}» separadas por coma, punto y coma o tabulador.`,
    );
  }
  return mejor;
}

/**
 * El texto separado, convertido en cuadrícula.
 *
 * Escrito a mano y no con un paquete: el acuerdo es **una sola dependencia
 * nueva** (`exceljs`, para la otra mitad del formato), y lo que hace falta aquí
 * —olfatear el separador y deducir la codificación— no lo hace ningún
 * analizador genérico a nuestro gusto. El subconjunto que se cubre es el que
 * escribe Excel: comillas, comillas dobles escapadas, y los dos finales de
 * línea.
 */
export function parseDelimitedText(text: string): string[][] {
  const primeraLinea = text.split(/\r?\n/, 1)[0] ?? '';
  const separador = sniffDelimiter(primeraLinea);

  const filas: string[][] = [];
  let celdas: string[] = [];
  let celda = '';
  let dentroDeComillas = false;

  for (let i = 0; i < text.length; i++) {
    const caracter = text[i];

    if (dentroDeComillas) {
      if (caracter === '"') {
        // Dos comillas seguidas dentro de un campo entrecomillado son UNA
        // comilla literal, no el cierre. Es como Excel escribe un apellido
        // con comillas dentro.
        if (text[i + 1] === '"') {
          celda += '"';
          i++;
        } else {
          dentroDeComillas = false;
        }
      } else {
        celda += caracter;
      }
      continue;
    }

    if (caracter === '"') {
      dentroDeComillas = true;
    } else if (caracter === separador) {
      celdas.push(celda);
      celda = '';
    } else if (caracter === '\n') {
      celdas.push(celda);
      filas.push(celdas);
      celdas = [];
      celda = '';
    } else if (caracter !== '\r') {
      celda += caracter;
    }
  }

  // La última fila no lleva salto detrás si el archivo no termina en uno.
  if (celda !== '' || celdas.length > 0) {
    celdas.push(celda);
    filas.push(celdas);
  }

  return filas;
}

/**
 * La cuadrícula, comprobada contra el contrato de columnas y convertida en
 * filas con su número de línea.
 *
 * **No se adivina por posición.** Un archivo con las dos columnas cambiadas de
 * sitio se rechaza en vez de invitar a todo el mundo con el nombre en el
 * correo. La cabecera es un contrato, y esta función es donde se exige.
 */
export function gridToRows(grid: string[][]): RawBulkRow[] {
  const cabecera = (grid[0] ?? []).map(normalizeHeader);
  const esperada = [COLUMNA_NOMBRE, COLUMNA_CORREO].map(normalizeHeader);

  const cabeceraCorrecta =
    cabecera.length === esperada.length && esperada.every((nombre, i) => cabecera[i] === nombre);

  if (!cabeceraCorrecta) {
    throw archivoRechazado(
      `La primera fila tiene que llevar exactamente dos columnas: «${COLUMNA_NOMBRE}» y ` +
        `«${COLUMNA_CORREO}», en ese orden. Descarga la plantilla y rellénala sin añadir ni ` +
        'quitar columnas.',
    );
  }

  const filas: RawBulkRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const fullName = (grid[i][0] ?? '').trim();
    const email = (grid[i][1] ?? '').trim();

    // Del todo vacía: la deja Excel al arrastrar y no es un error de nadie.
    // Una fila con UN campo relleno SÍ es un error, y se conserva para poder
    // informar de ella — callarla sería decidir por la ausencia de un valor.
    if (fullName === '' && email === '') continue;

    if (filas.length >= MAX_BULK_ROWS) {
      throw archivoRechazado(
        `El archivo tiene más de ${MAX_BULK_ROWS} filas. Divídelo en varios archivos y súbelos ` +
          'de uno en uno.',
      );
    }
    filas.push({ line: i + 1, fullName, email });
  }

  if (filas.length === 0) {
    throw archivoRechazado('El archivo no tiene ninguna fila con datos debajo de la cabecera.');
  }

  return filas;
}
```

- [ ] **Step 4: Ejecutar las pruebas y verlas pasar**

Run: `cd backend && npx jest src/modules/portal/domain/bulk-user-file.spec.ts`
Expected: PASS

- [ ] **Step 5: Verificación completa**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/portal/domain/bulk-user-file.ts \
        backend/src/modules/portal/domain/bulk-user-file.spec.ts
git commit -m "feat(portal): contrato del archivo de carga masiva y lectura de texto separado"
```

---

### Task 3: La hoja de cálculo — plantilla, lectura y guarda contra la bomba de ZIP

**Files:**
- Modify: `backend/package.json` (dependencia nueva)
- Create: `backend/src/modules/portal/bulk-users-workbook.ts`
- Test: `backend/src/modules/portal/bulk-users-workbook.spec.ts`

**Interfaces:**
- Consume de la Task 2: `COLUMNA_NOMBRE`, `COLUMNA_CORREO`, `MAX_BULK_ROWS`, `looksLikeZip`, `decodeTextFile`, `parseDelimitedText`, `archivoRechazado` de `./domain/bulk-user-file`.
- Produce, todo desde `bulk-users-workbook.ts`:
  - `BULK_TEMPLATE_FILENAME = 'plantilla-usuarios-portal.xlsx'`
  - `BULK_TEMPLATE_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`
  - `MAX_ZIP_ENTRIES = 64`, `MAX_ZIP_DECLARED_BYTES = 8 * 1024 * 1024`
  - `buildBulkTemplate(): Promise<Buffer>`
  - `assertUsableWorkbookZip(buffer: Buffer): void`
  - `cellText(value: unknown): string`
  - `readUploadedGrid(buffer: Buffer): Promise<string[][]>` — **la única puerta**: decide por bytes si es libro o texto y devuelve la cuadrícula.

Esta tarea introduce **la única dependencia nueva del proyecto**. `exceljs` se elige porque con un solo paquete escribe la plantilla y lee el libro; el paquete `xlsx` de npm quedó congelado en 2022 con CVE de contaminación de prototipo y de ReDoS, y sus versiones nuevas viven fuera del registro. El razonamiento entero está en la decisión 8 de la spec. **Este es el único fichero del proyecto que puede importar `exceljs`.**

- [ ] **Step 1: Instalar la dependencia**

```bash
cd backend && npm install exceljs@^4.4.0
```

`exceljs` trae sus propios tipos de TypeScript, así que **no** hay que instalar ningún `@types/exceljs`. Comprueba que queda en `dependencies` y no en `devDependencies`: corre en producción.

- [ ] **Step 2: Escribir las pruebas que fallan**

Crea `backend/src/modules/portal/bulk-users-workbook.spec.ts`:

```ts
import * as ExcelJS from 'exceljs';

import { COLUMNA_CORREO, COLUMNA_NOMBRE } from './domain/bulk-user-file';
import {
  MAX_ZIP_ENTRIES,
  assertUsableWorkbookZip,
  buildBulkTemplate,
  cellText,
  readUploadedGrid,
} from './bulk-users-workbook';

/** Un libro de verdad con las filas que se le pasen: no se prueba contra un ZIP inventado. */
async function libroCon(filas: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet('Usuarios');
  filas.forEach((fila) => hoja.addRow(fila));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Reescribe el tamaño sin comprimir de la primera entrada del directorio
 * central. Vive en la prueba y no en el código: es una forja, no una utilidad.
 */
function inflarPrimerTamanoDeclarado(zip: Buffer, tamano: number): Buffer {
  const copia = Buffer.from(zip);
  const inicio = copia.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  if (inicio < 0) throw new Error('el ZIP de prueba no tiene directorio central');
  copia.writeUInt32LE(tamano, inicio + 24);
  return copia;
}

/** Una EOCD mínima, para forjar ZIP que no son libros. */
function zipForjado(entradas: number): Buffer {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entradas, 10);
  eocd.writeUInt32LE(4, 16);
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), eocd]);
}

describe('buildBulkTemplate', () => {
  it('produce un .xlsx de verdad, con las dos columnas del contrato en la primera fila', async () => {
    const grid = await readUploadedGrid(await buildBulkTemplate());
    expect(grid[0]).toEqual([COLUMNA_NOMBRE, COLUMNA_CORREO]);
  });

  it('no lleva ninguna fecha: la forma más barata de no tener un octavo fallo de zona horaria', async () => {
    const grid = await readUploadedGrid(await buildBulkTemplate());
    const todo = grid.flat().join(' ');
    expect(todo).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(todo).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
  });
});

describe('cellText — lo que Excel mete de verdad en una celda', () => {
  it('el correo convertido en hipervínculo, que es lo que hace Excel al teclearlo', () => {
    expect(cellText({ text: 'ana@x.com', hyperlink: 'mailto:ana@x.com' })).toBe('ana@x.com');
  });

  it('texto enriquecido', () => {
    expect(cellText({ richText: [{ text: 'Ana ' }, { text: 'Pérez' }] })).toBe('Ana Pérez');
  });

  it('el resultado de una fórmula, no la fórmula', () => {
    expect(cellText({ formula: 'CONCAT(A1,B1)', result: 'ana@x.com' })).toBe('ana@x.com');
  });

  it('un número se pasa a texto en vez de reventar', () => {
    expect(cellText(1234)).toBe('1234');
  });

  it('vacío y nulo son la cadena vacía', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
  });

  it('una fecha se RECHAZA: no hay lectura correcta de una fecha en estas dos columnas', () => {
    expect(() => cellText(new Date(0))).toThrow(/no se puede leer/i);
  });

  it('un error de fórmula se RECHAZA en vez de colar «#DIV/0!» como nombre', () => {
    expect(() => cellText({ formula: 'A1/0', result: { error: '#DIV/0!' } })).toThrow(
      /no se puede leer/i,
    );
  });
});

describe('assertUsableWorkbookZip', () => {
  it('deja pasar la plantilla que genera este mismo módulo', async () => {
    expect(() => assertUsableWorkbookZip(Buffer.from(await buildBulkTemplate()))).not.toThrow();
  });

  it('un buffer vacío no es un ZIP', () => {
    expect(() => assertUsableWorkbookZip(Buffer.alloc(0))).toThrow(/hoja de cálculo/i);
  });

  it('rechaza un ZIP sin xl/workbook.xml — un .docx también es un ZIP válido', () => {
    expect(() => assertUsableWorkbookZip(zipForjado(0))).toThrow(/hoja de cálculo/i);
  });

  it('rechaza un ZIP con demasiadas entradas', () => {
    expect(() => assertUsableWorkbookZip(zipForjado(MAX_ZIP_ENTRIES + 1))).toThrow(
      /demasiadas partes/i,
    );
  });

  it('rechaza un ZIP que declara más bytes sin comprimir de los que se admiten', async () => {
    const bueno = Buffer.from(await buildBulkTemplate());
    // Se reescribe el tamaño DECLARADO, no se descomprime nada: la guarda lee
    // cabeceras, y esta prueba comprueba justo eso.
    expect(() => assertUsableWorkbookZip(inflarPrimerTamanoDeclarado(bueno, 0xfffffffe))).toThrow(
      /demasiado grande/i,
    );
  });

  it('rechaza la marca de ZIP64: un libro de 200 filas no la necesita', async () => {
    const bueno = Buffer.from(await buildBulkTemplate());
    expect(() => assertUsableWorkbookZip(inflarPrimerTamanoDeclarado(bueno, 0xffffffff))).toThrow(
      /demasiado grande/i,
    );
  });
});

describe('readUploadedGrid — decide por los bytes, nunca por la extensión', () => {
  it('lee un libro con el correo hecho hipervínculo por Excel', async () => {
    const libro = await libroCon([
      [COLUMNA_NOMBRE, COLUMNA_CORREO],
      ['Ana Pérez', { text: 'ana@x.com', hyperlink: 'mailto:ana@x.com' }],
    ]);
    expect(await readUploadedGrid(libro)).toEqual([
      [COLUMNA_NOMBRE, COLUMNA_CORREO],
      ['Ana Pérez', 'ana@x.com'],
    ]);
  });

  it('lee texto separado por punto y coma en latin1, sin marca de codificación', async () => {
    const csv = Buffer.from(
      `${COLUMNA_NOMBRE};${COLUMNA_CORREO}\r\nMu\xf1oz Pe\xf1a;m@x.com\r\n`,
      'latin1',
    );
    expect(await readUploadedGrid(csv)).toEqual([
      [COLUMNA_NOMBRE, COLUMNA_CORREO],
      ['Muñoz Peña', 'm@x.com'],
    ]);
  });

  it('un PNG renombrado a .xlsx no pasa: no es ZIP y no decodifica a texto', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    await expect(readUploadedGrid(png)).rejects.toThrow(/hoja de cálculo/i);
  });
});
```

- [ ] **Step 3: Ejecutarlas y ver que fallan**

Run: `cd backend && npx jest src/modules/portal/bulk-users-workbook.spec.ts`
Expected: FAIL — `Cannot find module './bulk-users-workbook'`.

- [ ] **Step 4: Escribir el módulo**

Crea `backend/src/modules/portal/bulk-users-workbook.ts`:

```ts
import * as ExcelJS from 'exceljs';

import {
  COLUMNA_CORREO,
  COLUMNA_NOMBRE,
  MAX_BULK_ROWS,
  archivoRechazado,
  decodeTextFile,
  looksLikeZip,
  parseDelimitedText,
} from './domain/bulk-user-file';

/**
 * La hoja de cálculo de la carga masiva: la que se reparte y la que vuelve.
 *
 * **Este es el único fichero del proyecto que importa `exceljs`.** No es una
 * convención de estilo: es lo que hace que cambiar de librería el día que
 * haga falta sea reescribir un fichero en vez de buscarla por el proyecto
 * (riesgo 4 de la spec). Quien necesite leer un archivo subido llama a
 * `readUploadedGrid` y recibe texto.
 */

export const BULK_TEMPLATE_FILENAME = 'plantilla-usuarios-portal.xlsx';
export const BULK_TEMPLATE_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Guardas contra la bomba de descompresión (decisión 9 de la spec).
 *
 * Un `.xlsx` es un ZIP, y un ZIP de 300 KB puede declararse como gigabytes al
 * descomprimir. `exceljs` carga el libro entero en memoria, así que la guarda
 * tiene que aplicarse **antes** de dárselo.
 *
 * Un libro de dos columnas y 200 filas tiene una docena de entradas y unos
 * pocos cientos de KB sin comprimir. 64 y 8 MB dejan margen de sobra y siguen
 * muy por debajo de lo que hace daño.
 */
export const MAX_ZIP_ENTRIES = 64;
export const MAX_ZIP_DECLARED_BYTES = 8 * 1024 * 1024;

/** Marca de que un tamaño de 32 bits no cabe y vive en el registro ZIP64. */
const ZIP64_MARK = 0xffffffff;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
/** El comentario final de un ZIP cabe en 65 535 bytes; la EOCD ocupa 22. */
const MAX_EOCD_SEARCH = 65535 + 22;

/**
 * La plantilla que se descarga.
 *
 * Es `.xlsx` y no CSV a propósito (decisión 2 de la spec): Excel la abre sin
 * asistente de importación, y aquí se puede dejar la columna de correo
 * **formateada como texto** —lo que impide que Excel autocorrija o reformatee
 * una dirección— y la cabecera inmovilizada.
 *
 * **Sin ninguna fecha**, ni en el contenido ni en el nombre del archivo. Es la
 * forma más barata de no tener el octavo fallo de zona horaria de esta serie,
 * y no cuesta nada: el nombre no necesita el día.
 */
export async function buildBulkTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet('Usuarios');

  hoja.columns = [
    { header: COLUMNA_NOMBRE, key: 'fullName', width: 34 },
    { header: COLUMNA_CORREO, key: 'email', width: 38 },
  ];
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: 'frozen', ySplit: 1 }];
  // Texto, no «general»: sin esto Excel se toma libertades con lo que parezca
  // otra cosa, y una dirección reformateada es una invitación a alguien que no
  // existe.
  hoja.getColumn('fullName').numFmt = '@';
  hoja.getColumn('email').numFmt = '@';

  hoja.addRow({ fullName: 'Ana Pérez Ramos', email: 'ana.perez@empresa.com' });

  const nota = hoja.addRow([
    `Borra la fila de ejemplo. Máximo ${MAX_BULK_ROWS} filas. La contraseña la elige cada ` +
      'persona desde el enlace que recibe; esta carga no crea administradores.',
  ]);
  nota.font = { italic: true, color: { argb: 'FF6B7280' } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Una celda de Excel convertida a texto.
 *
 * **Una celda no es siempre una cadena**, y ahí hay una trampa concreta: al
 * teclear un correo, Excel lo convierte en hipervínculo y `exceljs` devuelve
 * `{ text, hyperlink }`. Un `String(valor)` a secas metería `[object Object]`
 * en el correo de alguien. Es el fallo que solo se caza en producción, porque
 * en desarrollo los archivos de prueba se escriben con un script y no
 * tecleando en Excel.
 *
 * Lo que no sabe convertir lo **rechaza** en vez de adivinarlo: una fecha en la
 * columna del nombre no tiene ninguna lectura correcta, y un `#DIV/0!` tampoco.
 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (typeof value === 'object' && !(value instanceof Date)) {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return v.richText
        .map((f) => String((f as { text?: unknown }).text ?? ''))
        .join('')
        .trim();
    }
    // El hipervínculo que Excel pone solo. Recursivo, porque su `text` puede
    // ser a su vez texto enriquecido.
    if ('text' in v) return cellText(v.text);
    // `{ formula, result }`. Si el resultado es un error de fórmula, la
    // recursión cae al rechazo de abajo, que es lo que se quiere.
    if ('result' in v && !('error' in v)) return cellText(v.result);
  }

  throw archivoRechazado(
    'Hay una celda que no se puede leer como texto (una fecha, un error de fórmula o algo ' +
      'incrustado). Deja en las dos columnas solo texto y vuelve a subirlo.',
  );
}

/**
 * Comprueba que ese ZIP es un libro de Excel **usable**, sin descomprimir ni un
 * byte: se recorre el directorio central, que son cabeceras.
 *
 * Tres reglas, todas fallando cerrado (decisión 9 de la spec):
 *  1. Tiene que llevar `xl/workbook.xml`. Un `.docx`, un `.jar` y un `.zip` con
 *     fotos son todos ZIP válidos y ninguno es una hoja de cálculo.
 *  2. Como mucho `MAX_ZIP_ENTRIES` entradas.
 *  3. La suma de tamaños declarados sin comprimir, por debajo de
 *     `MAX_ZIP_DECLARED_BYTES`. Un tamaño con la marca de ZIP64 se rechaza: un
 *     libro de 200 filas no la necesita, y aceptarla sería aceptar un tamaño
 *     que la cabecera ya no dice.
 *
 * **Límite conocido:** esos tamaños los escribe quien construyó el archivo y
 * pueden mentir. Esta guarda para la bomba ingenua. Lo que acota el caso
 * adverso es que la ruta está detrás de sesión, personal de la casa, rol ADMIN
 * y asiento en `audit_log`: no es una superficie anónima.
 */
export function assertUsableWorkbookZip(buffer: Buffer): void {
  const eocd = buscarEocd(buffer);
  if (eocd < 0) throw noEsUnLibro();

  const entradas = buffer.readUInt16LE(eocd + 10);
  if (entradas > MAX_ZIP_ENTRIES) {
    throw archivoRechazado(
      'El archivo tiene demasiadas partes dentro para ser una plantilla rellenada. ' +
        'Descarga la plantilla y vuelve a rellenarla.',
    );
  }

  let offset = buffer.readUInt32LE(eocd + 16);
  let declarados = 0;
  let tieneLibro = false;

  for (let i = 0; i < entradas; i++) {
    if (offset + 46 > buffer.length) throw noEsUnLibro();
    if (buffer.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE) throw noEsUnLibro();

    const sinComprimir = buffer.readUInt32LE(offset + 24);
    const nombreLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const comentarioLen = buffer.readUInt16LE(offset + 32);

    if (sinComprimir === ZIP64_MARK) throw demasiadoGrande();
    declarados += sinComprimir;
    if (declarados > MAX_ZIP_DECLARED_BYTES) throw demasiadoGrande();

    const nombre = buffer.toString('latin1', offset + 46, offset + 46 + nombreLen);
    if (nombre === 'xl/workbook.xml') tieneLibro = true;

    offset += 46 + nombreLen + extraLen + comentarioLen;
  }

  if (!tieneLibro) throw noEsUnLibro();
}

function noEsUnLibro(): ReturnType<typeof archivoRechazado> {
  return archivoRechazado(
    'El archivo no es una hoja de cálculo de Excel. Descarga la plantilla, rellénala y súbela.',
  );
}

function demasiadoGrande(): ReturnType<typeof archivoRechazado> {
  return archivoRechazado(
    'El archivo declara un contenido demasiado grande para una plantilla de usuarios. ' +
      'Descarga la plantilla y vuelve a rellenarla.',
  );
}

/** La cabecera final del ZIP, buscada desde el final. El archivo cabe en 512 KB: es barato. */
function buscarEocd(buffer: Buffer): number {
  const desde = Math.max(0, buffer.length - MAX_EOCD_SEARCH);
  for (let i = buffer.length - 22; i >= desde; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/**
 * **La única puerta de lectura de un archivo subido.**
 *
 * Decide por los BYTES, jamás por la extensión ni por el `Content-Type`: los
 * dos los pone quien sube. Si empieza por la firma de un ZIP va a la rama del
 * libro; si no, a la de texto separado, que exige que decodifique a texto sin
 * ningún byte nulo.
 */
export async function readUploadedGrid(buffer: Buffer): Promise<string[][]> {
  if (!looksLikeZip(buffer)) {
    return parseDelimitedText(decodeTextFile(buffer));
  }

  assertUsableWorkbookZip(buffer);

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    // El detalle del fallo de `exceljs` es diagnóstico interno y puede llevar
    // rutas internas del paquete: no sale hacia arriba.
    throw noEsUnLibro();
  }

  const hoja = wb.worksheets[0];
  if (!hoja) throw noEsUnLibro();

  const grid: string[][] = [];
  // `includeEmpty: true` a propósito: sin él, una fila del todo vacía en medio
  // desplazaría la numeración de todas las de abajo, y el número de fila es lo
  // único que hace accionable el informe. `gridToRows` ya salta las vacías.
  hoja.eachRow({ includeEmpty: true }, (row) => {
    grid.push([cellText(row.getCell(1).value), cellText(row.getCell(2).value)]);
  });

  return grid;
}
```

- [ ] **Step 5: Ejecutar las pruebas y verlas pasar**

Run: `cd backend && npx jest src/modules/portal/bulk-users-workbook.spec.ts`
Expected: PASS

- [ ] **Step 6: Verificación completa**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/package-lock.json \
        backend/src/modules/portal/bulk-users-workbook.ts \
        backend/src/modules/portal/bulk-users-workbook.spec.ts
git commit -m "feat(portal): plantilla xlsx, lectura del libro subido y guarda contra la bomba de zip"
```

---

### Task 4: La revisión firmada — que no se pueda confirmar otra cosa

**Files:**
- Create: `backend/src/modules/portal/domain/bulk-users-review.ts`
- Test: `backend/src/modules/portal/domain/bulk-users-review.spec.ts`

**Interfaces:**
- Consume: nada de tareas anteriores.
- Produce, todo desde `domain/bulk-users-review.ts`:
  - `REVIEW_TTL_MS = 30 * 60 * 1000`, `REVIEW_VERSION = 1`
  - `interface ReviewRow { line: number; fullName: string; email: string }`
  - `interface ReviewPayload { v: number; clientId: number; issuedAt: number; rows: ReviewRow[] }`
  - `deriveReviewKey(secret: string): Buffer`
  - `encodeReview(payload: ReviewPayload): string`
  - `decodeReview(blob: string): ReviewPayload | null`
  - `reviewMac(key: Buffer, blob: string): string`
  - `reviewMacMatches(a: string, b: string): boolean`
  - `isReviewExpired(issuedAt: unknown, now: Date): boolean`
  - `reviewExpiryLabel(issuedAt: number): string`

**Puro**: sin base, sin red, **sin leer el reloj** — el instante entra por argumento, igual que `domain/invitation-secret.ts`. Es lo que permite probar la caducidad sin esperar media hora y, sobre todo, sin que el resultado dependa de la zona del proceso.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `backend/src/modules/portal/domain/bulk-users-review.spec.ts`:

```ts
import {
  REVIEW_TTL_MS,
  REVIEW_VERSION,
  decodeReview,
  deriveReviewKey,
  encodeReview,
  isReviewExpired,
  reviewExpiryLabel,
  reviewMac,
  reviewMacMatches,
} from './bulk-users-review';

const CLAVE = deriveReviewKey('un-secreto-de-pruebas');

const PAYLOAD = {
  v: REVIEW_VERSION,
  clientId: 7,
  issuedAt: 1_757_000_000_000,
  rows: [{ line: 2, fullName: 'Ana Pérez', email: 'ana@x.com' }],
};

describe('el bloque firmado', () => {
  it('va y vuelve entero', () => {
    expect(decodeReview(encodeReview(PAYLOAD))).toEqual(PAYLOAD);
  });

  it('el MAC se calcula sobre LA CADENA, así que un bloque cambiado ya no casa', () => {
    const blob = encodeReview(PAYLOAD);
    const otro = encodeReview({
      ...PAYLOAD,
      rows: [{ line: 2, fullName: 'Ana Pérez', email: 'mia@x.com' }],
    });
    expect(reviewMacMatches(reviewMac(CLAVE, blob), reviewMac(CLAVE, otro))).toBe(false);
  });

  it('con otra clave no casa: la firma no la puede fabricar quien manda el bloque', () => {
    const blob = encodeReview(PAYLOAD);
    expect(
      reviewMacMatches(reviewMac(CLAVE, blob), reviewMac(deriveReviewKey('otro-secreto'), blob)),
    ).toBe(false);
  });

  it('la empresa va DENTRO del bloque firmado', () => {
    const blob = encodeReview(PAYLOAD);
    expect(decodeReview(blob)!.clientId).toBe(7);
    expect(
      reviewMacMatches(
        reviewMac(CLAVE, blob),
        reviewMac(CLAVE, encodeReview({ ...PAYLOAD, clientId: 8 })),
      ),
    ).toBe(false);
  });

  it('la clave se DERIVA del secreto, no es el secreto', () => {
    expect(deriveReviewKey('x')).toHaveLength(32);
    expect(deriveReviewKey('x').toString('utf8')).not.toBe('x');
  });

  it('comparar no revienta con longitudes distintas', () => {
    expect(reviewMacMatches('abc', 'abc')).toBe(true);
    expect(reviewMacMatches('abc', 'abcd')).toBe(false);
    expect(reviewMacMatches('', '')).toBe(true);
  });
});

describe('decodeReview — todo lo que no tenga EXACTAMENTE la forma es null', () => {
  it.each([
    ['basura que no decodifica a JSON', Buffer.from('no soy json').toString('base64url')],
    ['JSON que no es un objeto', Buffer.from('[1,2,3]').toString('base64url')],
    ['versión desconocida', encodeReview({ ...PAYLOAD, v: 99 })],
    ['sin empresa', encodeReview({ ...PAYLOAD, clientId: 0 })],
    ['sin filas', encodeReview({ ...PAYLOAD, rows: [] })],
    [
      'una fila sin correo',
      encodeReview({ ...PAYLOAD, rows: [{ line: 2, fullName: 'A', email: '' }] }),
    ],
    [
      'issuedAt que no es número',
      encodeReview({ ...PAYLOAD, issuedAt: 'ayer' as unknown as number }),
    ],
  ])('%s → null', (_caso, blob) => {
    expect(decodeReview(blob)).toBeNull();
  });
});

describe('isReviewExpired — instantes absolutos, nunca la zona del proceso', () => {
  // Todos los instantes son NÚMEROS de época construidos a mano. Ni una sola
  // cadena de fecha: `Date.parse` de una cadena sin desfase explícito la
  // interpreta en la zona del proceso, que es justo lo que esta prueba no
  // puede permitirse hacer.
  const emitida = 1_757_000_000_000;

  it('recién emitida, vale', () => {
    expect(isReviewExpired(emitida, new Date(emitida + 1_000))).toBe(false);
  });

  it('un milisegundo antes de cumplirse el plazo, vale', () => {
    expect(isReviewExpired(emitida, new Date(emitida + REVIEW_TTL_MS - 1))).toBe(false);
  });

  it('en el instante exacto del plazo ya NO vale: en la frontera gana la respuesta que no hace nada', () => {
    expect(isReviewExpired(emitida, new Date(emitida + REVIEW_TTL_MS))).toBe(true);
  });

  it('una emisión ilegible cuenta como caducada — falla cerrado', () => {
    expect(isReviewExpired(Number.NaN, new Date(emitida))).toBe(true);
    expect(isReviewExpired('ayer', new Date(emitida))).toBe(true);
    expect(isReviewExpired(null, new Date(emitida))).toBe(true);
  });

  it('un reloj ilegible cuenta como caducada: que no se pueda leer la hora no abre puertas', () => {
    expect(isReviewExpired(emitida, new Date(Number.NaN))).toBe(true);
  });

  it('una emisión en el futuro cuenta como caducada: un reloj movido no estira el plazo', () => {
    expect(isReviewExpired(emitida + 60_000, new Date(emitida))).toBe(true);
  });
});

describe('reviewExpiryLabel', () => {
  /**
   * Instante fijo construido con `Date.UTC`: la revisión caduca el 2026-09-09
   * a las 20:45Z, que en Lima (UTC-5) son las 15:45.
   *
   * Esta aserción es la que caza que alguien quite el `timeZone` del
   * formateador. `jest.config.js` fuerza `TZ=UTC`, así que un formateador sin
   * zona imprimiría 20:45 y la prueba fallaría. Funciona GRACIAS a `TZ=UTC`,
   * no a pesar de él.
   */
  it('imprime la hora de Lima, no la del proceso', () => {
    const emitida = Date.UTC(2026, 8, 9, 20, 45, 0) - REVIEW_TTL_MS;
    const etiqueta = reviewExpiryLabel(emitida);
    expect(etiqueta).toContain('15:45');
    expect(etiqueta).not.toContain('20:45');
  });
});
```

- [ ] **Step 2: Ejecutarlas y ver que fallan**

Run: `cd backend && npx jest src/modules/portal/domain/bulk-users-review.spec.ts`
Expected: FAIL — `Cannot find module './bulk-users-review'`.

- [ ] **Step 3: Escribir el dominio**

Crea `backend/src/modules/portal/domain/bulk-users-review.ts`:

```ts
import { createHmac, timingSafeEqual } from 'crypto';

import { PERU_TIME_ZONE } from '../../../common/time-zone';

/**
 * Lo que hace que **no se pueda confirmar una cosa distinta de la que se
 * revisó** (decisión 15 de la spec).
 *
 * Dominio puro: no consulta la base, no manda correo y **no lee el reloj**. El
 * instante actual entra siempre por argumento, igual que
 * `domain/invitation-secret.ts`. Que no lea el reloj es lo que permite probar
 * la caducidad sin esperar media hora y, sobre todo, sin que el resultado
 * dependa de la zona del proceso: producción corre en UTC y el host de
 * desarrollo en América/Lima.
 *
 * **Esto NO es una credencial.** El bloque firmado no da acceso a nada: solo
 * autentica un dato que quien lo tiene ya tiene entero, y la ruta que lo recibe
 * exige sesión, personal de la casa y rol ADMIN igual que si no existiera. Por
 * eso su campo se llama `mac` y no cae bajo el patrón de tachado de la
 * auditoría, y por eso conviene que quede legible en el asiento: es lo que
 * permite reconstruir qué revisión se confirmó. El día que alguien quiera que
 * valga por sí solo para hacer algo sin sesión, pasa a ser una credencial y
 * tiene que cambiar de nombre para que el patrón la tache.
 */

/**
 * Lo que vale una revisión: media hora.
 *
 * Es más de lo que se tarda en leer 22 filas y menos de lo que se tarda en
 * olvidarse de una pestaña abierta. Es un número elegido, no derivado.
 */
export const REVIEW_TTL_MS = 30 * 60 * 1000;

/**
 * Versión del bloque. Va **dentro de lo firmado**: si mañana cambia la forma,
 * un bloque viejo no se interpreta con las reglas nuevas — se rechaza, y quien
 * lo tenga vuelve a subir el archivo.
 */
export const REVIEW_VERSION = 1;

/** Una fila aprobada en la revisión. El correo ya viene normalizado. */
export interface ReviewRow {
  /** Número de fila en el archivo, para poder señalarla en el informe final. */
  line: number;
  fullName: string;
  email: string;
}

export interface ReviewPayload {
  v: number;
  /** La empresa. Va DENTRO de lo firmado, y la confirmación no acepta ninguna otra. */
  clientId: number;
  /** Instante absoluto en milisegundos de época. Nunca una fecha civil. */
  issuedAt: number;
  rows: ReviewRow[];
}

/**
 * La clave del MAC, derivada de `JWT_ACCESS_SECRET`.
 *
 * **Derivada, no el secreto tal cual.** `JwtSecretsValidator` ya obliga a que
 * ese secreto exista y a que no sea un valor de ejemplo en producción, así que
 * apoyarse en él evita una variable de entorno nueva y un secreto más que
 * rotar. Pero usarlo directamente haría que este uso y la firma de los tokens
 * compartieran material de clave; la etiqueta de separación de dominio lo
 * impide, y cuesta una línea.
 */
export function deriveReviewKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('kubo:carga-masiva-usuarios:v1').digest();
}

/** El bloque, listo para viajar en un JSON y volver verbatim. */
export function encodeReview(payload: ReviewPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * El MAC **de la cadena del bloque, tal cual llega**.
 *
 * Sobre la cadena y no sobre el objeto reconstruido, y ahí está toda la
 * robustez: no hay ninguna canonicalización que acordar entre las dos puntas,
 * así que no hay ninguna forma de que un `JSON.stringify` con las claves en
 * otro orden rompa la firma por sorpresa. Se verifica **antes** de decodificar.
 */
export function reviewMac(key: Buffer, blob: string): string {
  return createHmac('sha256', key).update(blob, 'utf8').digest('hex');
}

/**
 * Si dos MAC son el mismo, en tiempo constante.
 *
 * Aquí sí importa, a diferencia de `invitationFingerprintsMatch`: lo que el
 * cliente controla es el MAC mismo, sin pasar por ningún hash intermedio, así
 * que una comparación byte a byte sí daría una señal que seguir.
 *
 * Longitudes distintas devuelven `false` sin llamar a `timingSafeEqual` —que
 * lanzaría—, y eso filtra la longitud, no el contenido: estos MAC son siempre
 * 64 caracteres hexadecimales.
 */
export function reviewMacMatches(a: string, b: string): boolean {
  const bytesA = Buffer.from(a ?? '', 'utf8');
  const bytesB = Buffer.from(b ?? '', 'utf8');
  if (bytesA.length !== bytesB.length) return false;
  return timingSafeEqual(bytesA, bytesB);
}

/**
 * El bloque decodificado, o `null` si no tiene EXACTAMENTE la forma esperada.
 *
 * `null` y no una excepción: quien llama ya tiene un cuerpo de error para «esta
 * revisión no vale», y las dos causas —firma mala y forma mala— tienen que
 * salir por el mismo sitio.
 *
 * Se comprueba campo a campo y no con un `as`: este valor viene del cuerpo de
 * una petición, y que el MAC case solo dice que lo firmamos nosotros, no que un
 * despliegue anterior no firmara otra forma.
 */
export function decodeReview(blob: string): ReviewPayload | null {
  let crudo: unknown;
  try {
    crudo = JSON.parse(Buffer.from(blob, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return null;
  const p = crudo as Record<string, unknown>;

  if (p.v !== REVIEW_VERSION) return null;
  if (typeof p.clientId !== 'number' || !Number.isInteger(p.clientId) || p.clientId <= 0) {
    return null;
  }
  if (typeof p.issuedAt !== 'number' || !Number.isFinite(p.issuedAt)) return null;
  if (!Array.isArray(p.rows) || p.rows.length === 0) return null;

  const rows: ReviewRow[] = [];
  for (const fila of p.rows) {
    if (!fila || typeof fila !== 'object') return null;
    const f = fila as Record<string, unknown>;
    if (typeof f.line !== 'number' || !Number.isInteger(f.line) || f.line < 1) return null;
    if (typeof f.fullName !== 'string' || f.fullName.trim() === '') return null;
    if (typeof f.email !== 'string' || f.email.trim() === '') return null;
    rows.push({ line: f.line, fullName: f.fullName, email: f.email });
  }

  return { v: p.v, clientId: p.clientId, issuedAt: p.issuedAt, rows };
}

/**
 * Si esa revisión ya no vale.
 *
 * Aritmética sobre milisegundos absolutos, nunca `setMinutes`/`getHours`, que
 * leen la zona del proceso.
 *
 * **Falla cerrado en los tres frentes**, igual que `isInvitationExpired`:
 *  1. Emisión ilegible → caducada. Un `NaN` comparado sin guarda cede hacia
 *     «todavía vale», que es la dirección equivocada.
 *  2. Reloj ilegible → caducada. Que no se pueda leer la hora no abre puertas.
 *  3. **Emisión en el futuro → caducada.** Un bloque con un `issuedAt` por
 *     delante del reloj no es una revisión joven: es un reloj que se movió o
 *     una firma de otro despliegue, y en los dos casos lo que corresponde es
 *     volver a subir el archivo.
 */
export function isReviewExpired(issuedAt: unknown, now: Date): boolean {
  const ahora = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(ahora)) return true;

  const emitida = typeof issuedAt === 'number' ? issuedAt : Number.NaN;
  if (!Number.isFinite(emitida)) return true;
  if (emitida > ahora) return true;

  return ahora - emitida >= REVIEW_TTL_MS;
}

/**
 * Hasta cuándo vale, en hora de Lima y escrito para leerse.
 *
 * `timeZone: PERU_TIME_ZONE` **explícito**, nunca `toLocaleTimeString` a secas:
 * producción corre en UTC y quien lee esto está en Lima. Es el mismo fallo que
 * ya mordió en los correos de tickets, y por eso su prueba compara contra la
 * hora exacta.
 */
export function reviewExpiryLabel(issuedAt: number): string {
  return new Date(issuedAt + REVIEW_TTL_MS).toLocaleTimeString('es-PE', {
    timeZone: PERU_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
```

- [ ] **Step 4: Ejecutar las pruebas y verlas pasar**

Run: `cd backend && npx jest src/modules/portal/domain/bulk-users-review.spec.ts`
Expected: PASS

- [ ] **Step 5: Verificación completa**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/portal/domain/bulk-users-review.ts \
        backend/src/modules/portal/domain/bulk-users-review.spec.ts
git commit -m "feat(portal): bloque de revision firmado, con caducidad que no depende de la zona del proceso"
```

---

### Task 5: Una invitación creada por la casa — autoría honesta en las tres rutas

**Files:**
- Modify: `backend/src/modules/portal/portal-invitations.service.ts`
- Modify: `backend/src/modules/portal/portal-users.controller.ts`
- Modify: `backend/src/modules/portal/portal-invitations.service.spec.ts` (solo el call site)
- Modify: `backend/src/modules/portal/portal.module.ts`
- Test: `backend/src/modules/portal/portal-invitations.staff-author.spec.ts` (nuevo)

**Interfaces:**
- Consume de la Task 1: `ClientUserInvitation.invitedByUserId: number | null` y `invitedByClientUserId: number | null`.
- Produce, desde `portal-invitations.service.ts`:
  - `export type InvitationAuthor = { kind: 'CLIENT_ADMIN'; clientUserId: number } | { kind: 'STAFF'; userId: number }`
  - `invite(clientId: number, author: InvitationAuthor, dto: InvitePortalUserDto): Promise<PortalInvitationView>` — **la firma cambia**: el segundo parámetro era un `number`.
  - `inviteWithSecret(clientId: number, author: InvitationAuthor, dto: InvitePortalUserDto): Promise<{ view: PortalInvitationView; secret: string; invitation: ClientUserInvitation }>` — misma clase de cambio.
  - `resend(clientId, invitationId)` y `accept(dto)` y `preview(secret)` **no cambian de firma**.
- Produce en `PortalModule`: `UsersModule` importado, para que `PortalInvitationsService` pueda inyectar `UsersService`.

Por qué la firma cambia en vez de añadir un `inviteFromStaff` al lado: el autor es **un dato de la invitación**, no un modo de llamada, y dos métodos con la misma tripa terminan con dos comportamientos. Un tipo unión obliga a que cada llamante diga cuál de los dos es, y hace que olvidarse no compile.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `backend/src/modules/portal/portal-invitations.staff-author.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';

import { PortalInvitationsService, INVITATION_INVALID_MESSAGE } from './portal-invitations.service';
import { ClientUserInvitation } from './entities/client-user-invitation.entity';
import { ClientUser } from './entities/client-user.entity';
import { fingerprintInvitationSecret } from './domain/invitation-secret';

/**
 * Doble de repositorio de TypeORM sobre un array. Solo lo que usan `accept` y
 * `replaceInvitation`; nada genérico, para que se vea qué se está fingiendo.
 */
function repoSobre<T extends { id?: number }>(filas: T[]) {
  return {
    filas,
    create: (data: Partial<T>) => ({ ...data }) as T,
    save: async (fila: T) => {
      const guardada = { ...fila, id: fila.id ?? filas.length + 1 } as T;
      filas.push(guardada);
      return guardada;
    },
    findOne: async ({ where }: { where: Record<string, unknown> }) =>
      filas.find((f) =>
        Object.entries(where).every(
          ([k, v]) => typeof v !== 'object' && (f as Record<string, unknown>)[k] === v,
        ),
      ) ?? null,
    update: async (criterio: unknown, patch: Partial<T>) => {
      const id = typeof criterio === 'object' ? (criterio as { id?: number }).id : (criterio as number);
      const fila = filas.find((f) => f.id === id);
      if (!fila) return { affected: 0 };
      Object.assign(fila, patch);
      return { affected: 1 };
    },
  };
}

interface Mundo {
  invitaciones: ClientUserInvitation[];
  usuariosDeCliente: ClientUser[];
  personal: { id: number; isActive: number }[];
  correosEnviados: { to: string }[];
}

function crearServicio(mundo: Mundo) {
  const invRepo = repoSobre(mundo.invitaciones as unknown as { id?: number }[]);
  const userRepo = repoSobre(mundo.usuariosDeCliente as unknown as { id?: number }[]);

  const invitations = {
    runInTransaction: async (work: (m: unknown) => Promise<unknown>) =>
      work({
        getRepository: (entidad: unknown) => (entidad === ClientUserInvitation ? invRepo : userRepo),
      }),
    findLiveByEmail: async () => null,
    findByFingerprint: async (huella: string) =>
      mundo.invitaciones.find((i) => i.secretFingerprint === huella) ?? null,
    findPendingByIdForClient: async () => null,
    markSent: async () => undefined,
  };

  const clientUsers = {
    findByEmail: async (email: string) =>
      mundo.usuariosDeCliente.find((u) => u.email === email) ?? null,
    findById: async (id: number) => mundo.usuariosDeCliente.find((u) => Number(u.id) === id) ?? null,
  };

  const email = { send: async (m: { to: string }) => void mundo.correosEnviados.push(m) };
  const clients = { findByIdOrFail: async (id: number) => ({ id, razonSocial: 'ACME', status: 'CLIENT' }) };
  const users = { findById: async (id: number) => mundo.personal.find((u) => u.id === id) ?? null };
  const config = new ConfigService({ FRONTEND_URL: 'https://portal.example' });

  return new PortalInvitationsService(
    invitations as never,
    clientUsers as never,
    email as never,
    clients as never,
    config,
    users as never,
  );
}

const DTO = { email: 'ana@x.com', fullName: 'Ana Pérez' };

function mundoVacio(): Mundo {
  return { invitaciones: [], usuariosDeCliente: [], personal: [{ id: 40, isActive: 1 }], correosEnviados: [] };
}

describe('invitar desde el panel — el autor es del personal, y se dice cuál', () => {
  it('escribe invited_by_user_id y deja vacío el del portal: exactamente uno de los dos', async () => {
    const mundo = mundoVacio();
    const service = crearServicio(mundo);

    await service.invite(7, { kind: 'STAFF', userId: 40 }, DTO);

    expect(mundo.invitaciones).toHaveLength(1);
    expect(Number(mundo.invitaciones[0].invitedByUserId)).toBe(40);
    expect(mundo.invitaciones[0].invitedByClientUserId).toBeNull();
  });

  it('invitar desde el portal sigue escribiendo el del portal y no el del personal', async () => {
    const mundo = mundoVacio();
    const service = crearServicio(mundo);

    await service.invite(7, { kind: 'CLIENT_ADMIN', clientUserId: 3 }, DTO);

    expect(Number(mundo.invitaciones[0].invitedByClientUserId)).toBe(3);
    expect(mundo.invitaciones[0].invitedByUserId).toBeNull();
  });
});

describe('aceptar una invitación de la casa', () => {
  /** Deja en el mundo una invitación viva creada por el personal y devuelve su secreto. */
  async function invitacionDeLaCasa(mundo: Mundo): Promise<string> {
    const service = crearServicio(mundo);
    const { secret } = await service.inviteWithSecret(7, { kind: 'STAFF', userId: 40 }, DTO);
    return secret;
  }

  it('el usuario nace con created_by del personal y sin autor de cliente — decisión 8 de R4', async () => {
    const mundo = mundoVacio();
    const secret = await invitacionDeLaCasa(mundo);

    await crearServicio(mundo).accept({
      secret,
      password: 'unaClaveLarga1',
      passwordConfirmation: 'unaClaveLarga1',
    });

    expect(mundo.usuariosDeCliente).toHaveLength(1);
    expect(Number(mundo.usuariosDeCliente[0].createdBy)).toBe(40);
    expect(mundo.usuariosDeCliente[0].createdByClientUserId).toBeNull();
    // Y sigue sin poder nacer administrador desde ninguna de las dos puertas.
    expect(mundo.usuariosDeCliente[0].isAdmin).toBe(0);
  });

  it('si el empleado que invitó queda desactivado, el enlace se invalida solo', async () => {
    const mundo = mundoVacio();
    const secret = await invitacionDeLaCasa(mundo);
    mundo.personal[0].isActive = 0;

    await expect(
      crearServicio(mundo).accept({
        secret,
        password: 'unaClaveLarga1',
        passwordConfirmation: 'unaClaveLarga1',
      }),
    ).rejects.toThrow(INVITATION_INVALID_MESSAGE);
  });

  it('la vista previa responde EXACTAMENTE lo mismo en ese caso: las dos rutas no pueden divergir', async () => {
    const mundo = mundoVacio();
    const secret = await invitacionDeLaCasa(mundo);
    mundo.personal[0].isActive = 0;

    await expect(crearServicio(mundo).preview(secret)).rejects.toThrow(INVITATION_INVALID_MESSAGE);
  });

  it('la vista previa saluda mientras el empleado siga activo', async () => {
    const mundo = mundoVacio();
    const secret = await invitacionDeLaCasa(mundo);

    await expect(crearServicio(mundo).preview(secret)).resolves.toEqual({
      fullName: 'Ana Pérez',
      clientName: 'ACME',
    });
  });

  it('una fila SIN ninguno de los dos autores es enlace no válido — falla cerrado', async () => {
    const mundo = mundoVacio();
    const secret = 'A'.repeat(43);
    mundo.invitaciones.push({
      id: 1,
      clientId: 7,
      email: 'ana@x.com',
      fullName: 'Ana Pérez',
      secretFingerprint: fingerprintInvitationSecret(secret),
      invitedByClientUserId: null,
      invitedByUserId: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      usedAt: null,
      acceptedClientUserId: null,
      revokedAt: null,
      lastSentAt: null,
      sendError: null,
      createdAt: new Date(),
    } as ClientUserInvitation);

    await expect(crearServicio(mundo).preview(secret)).rejects.toThrow(INVITATION_INVALID_MESSAGE);
  });
});
```

- [ ] **Step 2: Ejecutarlas y ver que fallan**

Run: `cd backend && npx jest src/modules/portal/portal-invitations.staff-author.spec.ts`
Expected: FAIL — el constructor no acepta un sexto argumento y `invite` espera un `number` como segundo parámetro.

- [ ] **Step 3: El tipo del autor y el reparto al crear**

En `backend/src/modules/portal/portal-invitations.service.ts`, junto a las constantes de arriba:

```ts
/**
 * De dónde salió una invitación. Dos formas, y exactamente una por invitación.
 *
 * Es un tipo unión y no dos parámetros opcionales porque olvidarse tiene que
 * **no compilar**: con dos opcionales, una llamada sin ninguno pasaría el
 * compilador y llegaría a la base a chocar contra `chk_cui_un_solo_autor` en
 * producción.
 *
 * `CLIENT_ADMIN` es la puerta de R4 (el portal). `STAFF` es la de la carga
 * masiva del panel, que existe porque una empresa nueva no tiene ningún
 * usuario de cliente al que atribuir la invitación — y rellenarlo con uno
 * inventado es el defecto recurrente de este proyecto (decisión 8 de R4).
 */
export type InvitationAuthor =
  | { kind: 'CLIENT_ADMIN'; clientUserId: number }
  | { kind: 'STAFF'; userId: number };

/** Las dos columnas de autor a partir del tipo unión. Exactamente una informada. */
function columnasDeAutor(author: InvitationAuthor): {
  invitedByClientUserId: number | null;
  invitedByUserId: number | null;
} {
  return author.kind === 'CLIENT_ADMIN'
    ? { invitedByClientUserId: author.clientUserId, invitedByUserId: null }
    : { invitedByClientUserId: null, invitedByUserId: author.userId };
}

/** El autor de una invitación ya guardada, leído de sus dos columnas. */
function autorDe(inv: ClientUserInvitation): InvitationAuthor | null {
  if (isUsableId(inv.invitedByClientUserId)) {
    return { kind: 'CLIENT_ADMIN', clientUserId: Number(inv.invitedByClientUserId) };
  }
  if (isUsableId(inv.invitedByUserId)) {
    return { kind: 'STAFF', userId: Number(inv.invitedByUserId) };
  }
  // Ninguno de los dos: fila imposible por el CHECK de la 027, pero el código
  // no se apoya en eso. Sin autor no hay a quién comprobar, así que el enlace
  // no vale. Falla cerrado.
  return null;
}
```

Añade `isUsableId` al import de `../../common/ids` (ya está `sameId`) y `UsersService` al de `../users/users.service`.

En el constructor, un sexto parámetro:

```ts
    private readonly config: ConfigService,
    /**
     * Solo para saber si el empleado que lanzó una carga masiva sigue activo.
     * Es la misma comprobación que ya se hacía sobre el administrador de
     * cliente, para el otro tipo de autor: una invitación de la casa no puede
     * sobrevivir a que ese empleado deje la empresa.
     */
    private readonly users: UsersService,
```

- [ ] **Step 4: Cambiar `invite`, `inviteWithSecret`, `replaceInvitation` y `resend`**

En `invite`:

```ts
  async invite(
    clientId: number,
    author: InvitationAuthor,
    dto: InvitePortalUserDto,
  ): Promise<PortalInvitationView> {
    const { invitation, secret } = await this.inviteWithSecret(clientId, author, dto);
    return this.deliver(invitation, secret);
  }
```

En `inviteWithSecret`, cambia el segundo parámetro y la guarda de sesión:

```ts
  async inviteWithSecret(
    clientId: number,
    author: InvitationAuthor,
    dto: InvitePortalUserDto,
  ): Promise<{ view: PortalInvitationView; secret: string; invitation: ClientUserInvitation }> {
    assertSessionScope(clientId, 'clientId', PortalInvitationsService.name);
    // El identificador del autor, sea del tipo que sea: un valor falsy dejaría
    // la invitación sin autor real y con las dos columnas vacías.
    assertSessionScope(
      author.kind === 'CLIENT_ADMIN' ? author.clientUserId : author.userId,
      author.kind === 'CLIENT_ADMIN' ? 'clientUserId' : 'userId',
      PortalInvitationsService.name,
    );
```

…y en la llamada a `replaceInvitation`, sustituye `invitedByClientUserId` por `author`:

```ts
    const invitation = await this.replaceInvitation({
      clientId,
      email: dto.email,
      fullName: dto.fullName.trim(),
      secretFingerprint: fingerprintInvitationSecret(secret),
      author,
      expiresAt: invitationExpiryFrom(ahora),
      revokeVivaAt: viva ? ahora : undefined,
    });
```

En `replaceInvitation`, cambia el campo del objeto de parámetros de `invitedByClientUserId: number` a `author: InvitationAuthor`, y en el `create`:

```ts
      return invRepo.save(
        invRepo.create({
          clientId: params.clientId,
          email,
          fullName: params.fullName,
          // La huella, jamás el secreto.
          secretFingerprint: params.secretFingerprint,
          // Exactamente una de las dos columnas de autor.
          ...columnasDeAutor(params.author),
          expiresAt: params.expiresAt,
        }),
      );
```

En `resend`, el autor se conserva leyéndolo de la invitación previa. Atribuírselo a quien pulsa «reenviar» seguiría siendo reescribir un hecho pasado:

```ts
    const autorPrevio = autorDe(previa);
    // Una invitación sin ningún autor no se puede reenviar: no habría a quién
    // atribuir la nueva, y inventarlo es justo lo que la decisión 8 prohíbe.
    if (!autorPrevio) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invitación no encontrada' });
    }

    const invitation = await this.replaceInvitation({
      clientId,
      email: previa.email,
      fullName: previa.fullName,
      secretFingerprint: fingerprintInvitationSecret(secret),
      author: autorPrevio,
      expiresAt: invitationExpiryFrom(ahora),
      revokeVivaAt: ahora,
    });
```

- [ ] **Step 5: La comprobación del autor, una sola vez, para `accept` y `preview`**

Añade el método privado:

```ts
  /**
   * Si el autor de esa invitación sigue habilitado para haberla hecho.
   *
   * Es el mismo motivo de invalidez de R4 —«se invalida sola si el
   * administrador que invitó queda desactivado»— extendido al segundo tipo de
   * autor: una invitación lanzada por la casa no puede sobrevivir a que ese
   * empleado deje la empresa.
   *
   * **Vive en un solo sitio y lo llaman `accept` y `preview`.** Si cada una
   * escribiera la suya, la vista previa podría saludar ante un enlace que
   * aceptar rechaza, y esa diferencia delata el motivo tan bien como un texto
   * distinto (decisión 10 de R4).
   */
  private async autorSigueValido(inv: ClientUserInvitation): Promise<boolean> {
    const autor = autorDe(inv);
    if (!autor) return false;

    if (autor.kind === 'CLIENT_ADMIN') {
      const invitador = await this.clientUsers.findById(autor.clientUserId);
      return !!invitador && !!invitador.isActive;
    }

    const empleado = await this.users.findById(autor.userId);
    return !!empleado && !!empleado.isActive;
  }
```

En `accept`, sustituye las dos líneas del invitador por:

```ts
      if (!(await this.autorSigueValido(inv))) throw enlaceNoValido();
```

Y en `preview`, exactamente igual, sustituyendo sus dos líneas equivalentes.

- [ ] **Step 6: La autoría del usuario que nace**

En `accept`, dentro del `userRepo.create({ … })`, sustituye las dos líneas de autoría:

```ts
        // Autoría honesta, y en la columna que toca: o lo dio de alta el
        // personal (carga masiva del panel), o lo invitó un administrador de
        // cliente. **Nunca las dos, nunca ninguna** — es la decisión 8 de R4
        // aplicada al segundo tipo de autor, no una regla nueva. Se copian de
        // la invitación, que es el hecho que lo determina.
        createdBy: isUsableId(inv.invitedByUserId) ? Number(inv.invitedByUserId) : null,
        createdByClientUserId: isUsableId(inv.invitedByClientUserId)
          ? Number(inv.invitedByClientUserId)
          : null,
```

- [ ] **Step 7: Los dos call sites que dejan de compilar**

En `backend/src/modules/portal/portal-users.controller.ts`:

```ts
    return this.invitations.invite(
      user.clientId,
      { kind: 'CLIENT_ADMIN', clientUserId: user.clientUserId },
      dto,
    );
```

En `backend/src/modules/portal/portal-invitations.service.spec.ts`, línea del `inviteWithSecret`:

```ts
    const { secret } = await service.inviteWithSecret(7, { kind: 'CLIENT_ADMIN', clientUserId: 3 }, DTO);
```

Si ese spec construye el servicio a mano, añádele el sexto argumento (un doble con `findById`); si lo construye con `Test.createTestingModule`, añade el proveedor de `UsersService`.

- [ ] **Step 8: El módulo**

En `backend/src/modules/portal/portal.module.ts`, importa `UsersModule` y anótalo:

```ts
    // Solo se consume `UsersService.findById`, ya exportado por `UsersModule`,
    // y para una sola cosa: saber si el empleado que lanzó una carga masiva
    // sigue activo. La dependencia va en un solo sentido — `UsersModule` no
    // conoce el portal — y no arrastra colas ni nada pesado.
    UsersModule,
```

- [ ] **Step 9: Ejecutar las pruebas y verlas pasar**

Run: `cd backend && npx jest src/modules/portal/`
Expected: PASS, incluidos los specs de invitaciones que ya existían.

- [ ] **Step 10: Verificación completa**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add backend/src/modules/portal/portal-invitations.service.ts \
        backend/src/modules/portal/portal-invitations.service.spec.ts \
        backend/src/modules/portal/portal-invitations.staff-author.spec.ts \
        backend/src/modules/portal/portal-users.controller.ts \
        backend/src/modules/portal/portal.module.ts
git commit -m "feat(portal): la casa puede ser autora de una invitacion, y la autoria no miente"
```

---

### Task 6: El servicio de carga masiva — la revisión

**Files:**
- Create: `backend/src/modules/portal/client-users-bulk.service.ts`
- Test: `backend/src/modules/portal/client-users-bulk.review.spec.ts`
- Modify: `backend/src/modules/portal/portal.module.ts`

**Interfaces:**
- Consume: `readUploadedGrid`, `buildBulkTemplate` (Task 3); `gridToRows`, `archivoRechazado`, `RawBulkRow` (Task 2); `encodeReview`, `reviewMac`, `deriveReviewKey`, `reviewExpiryLabel`, `ReviewRow` (Task 4); `normalizeEmailAddress`, `admiteReinvitacion`, `ClientUsersRepository`, `ClientUserInvitationsRepository`, `ClientsService`.
- Produce, desde `client-users-bulk.service.ts`:
  - `type BulkRowVerdict = 'SE_INVITARA' | 'SE_REINVITARA' | 'RECHAZADA'`
  - `interface BulkReviewRow { line: number; fullName: string; email: string; verdict: BulkRowVerdict; reason: string | null }`
  - `interface BulkReviewResult { clientId: number; clientName: string; rows: BulkReviewRow[]; totals: { willInvite: number; willReinvite: number; rejected: number }; revision: string; mac: string; expiresAtLabel: string }`
  - `class ClientUsersBulkService` con `template(): Promise<Buffer>` y `review(clientId: number, buffer: Buffer): Promise<BulkReviewResult>`.
  - `MAX_FULL_NAME_LENGTH = 180`, `MAX_EMAIL_LENGTH = 180`
- La Task 7 añade `send(...)` a esta misma clase y **reutiliza el `evaluar` privado que se escribe aquí**: no lo dupliques allí.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `backend/src/modules/portal/client-users-bulk.review.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';

import { ClientUsersBulkService } from './client-users-bulk.service';
import { COLUMNA_CORREO, COLUMNA_NOMBRE } from './domain/bulk-user-file';
import { decodeReview } from './domain/bulk-users-review';

/** El archivo, en la forma más simple de las dos que se aceptan. */
function csv(filas: string[][]): Buffer {
  return Buffer.from(
    [[COLUMNA_NOMBRE, COLUMNA_CORREO], ...filas].map((f) => f.join(',')).join('\r\n'),
    'utf8',
  );
}

interface Mundo {
  usuarios: { id: number; clientId: number; email: string; isActive: number; isAdmin: number }[];
  invitacionesVivas: { clientId: number; email: string }[];
  clientes: { id: number; razonSocial: string; status: string }[];
}

function crearServicio(mundo: Mundo) {
  const clientUsers = {
    findByEmail: async (email: string) => mundo.usuarios.find((u) => u.email === email) ?? null,
  };
  const invitations = {
    findLiveByEmail: async (email: string) =>
      mundo.invitacionesVivas.find((i) => i.email === email) ?? null,
  };
  const clients = {
    findByIdOrFail: async (id: number) => {
      const c = mundo.clientes.find((x) => x.id === id);
      if (!c) throw new Error('no existe');
      return c;
    },
  };
  const config = new ConfigService({ JWT_ACCESS_SECRET: 'secreto-de-pruebas' });

  return new ClientUsersBulkService(
    clientUsers as never,
    invitations as never,
    clients as never,
    {} as never, // PortalInvitationsService: no se usa en la revisión
    config,
  );
}

function mundo(parcial: Partial<Mundo> = {}): Mundo {
  return {
    usuarios: [],
    invitacionesVivas: [],
    clientes: [{ id: 7, razonSocial: 'ACME S.A.C.', status: 'CLIENT' }],
    ...parcial,
  };
}

describe('review — veredictos, uno por fila', () => {
  it('una fila limpia se va a invitar, y el correo sale normalizado', async () => {
    const r = await crearServicio(mundo()).review(7, csv([['Ana Pérez', '  ANA@X.COM ']]));

    expect(r.rows).toEqual([
      { line: 2, fullName: 'Ana Pérez', email: 'ana@x.com', verdict: 'SE_INVITARA', reason: null },
    ]);
    expect(r.totals).toEqual({ willInvite: 1, willReinvite: 0, rejected: 0 });
    expect(r.clientName).toBe('ACME S.A.C.');
  });

  it('rechaza el correo mal escrito, el nombre vacío y lo que se pasa de largo — con el motivo', async () => {
    const r = await crearServicio(mundo()).review(
      7,
      csv([
        ['Ana', 'no-es-un-correo'],
        ['', 'b@x.com'],
        ['N'.repeat(181), 'c@x.com'],
      ]),
    );

    expect(r.rows.map((f) => f.verdict)).toEqual(['RECHAZADA', 'RECHAZADA', 'RECHAZADA']);
    expect(r.rows[0].reason).toMatch(/correo/i);
    expect(r.rows[1].reason).toMatch(/nombre/i);
    expect(r.rows[2].reason).toMatch(/180/);
  });

  it('el repetido dentro del archivo se detecta con el correo YA normalizado, y dice en qué fila estaba', async () => {
    const r = await crearServicio(mundo()).review(
      7,
      csv([
        ['Ana Pérez', 'ana@x.com'],
        ['Ana P.', 'ANA@X.COM'],
      ]),
    );

    expect(r.rows[0].verdict).toBe('SE_INVITARA');
    expect(r.rows[1].verdict).toBe('RECHAZADA');
    expect(r.rows[1].reason).toMatch(/fila 2/);
  });

  it('quien ya es usuario activo de esta empresa se rechaza: su contraseña no se toca', async () => {
    const m = mundo({
      usuarios: [{ id: 1, clientId: 7, email: 'ana@x.com', isActive: 1, isAdmin: 0 }],
    });
    const r = await crearServicio(m).review(7, csv([['Ana', 'ana@x.com']]));

    expect(r.rows[0].verdict).toBe('RECHAZADA');
    expect(r.rows[0].reason).toMatch(/ya es usuario/i);
  });

  it('quien está desactivado y no es administrador se invita: al aceptar recupera su acceso', async () => {
    const m = mundo({
      usuarios: [{ id: 1, clientId: 7, email: 'ana@x.com', isActive: 0, isAdmin: 0 }],
    });
    const r = await crearServicio(m).review(7, csv([['Ana', 'ana@x.com']]));

    expect(r.rows[0].verdict).toBe('SE_INVITARA');
    expect(r.rows[0].reason).toMatch(/recuperará su acceso/i);
  });

  it('un administrador desactivado NO se toca: la carga no toca administradores en ninguna dirección', async () => {
    const m = mundo({
      usuarios: [{ id: 1, clientId: 7, email: 'jefe@x.com', isActive: 0, isAdmin: 1 }],
    });
    const r = await crearServicio(m).review(7, csv([['Jefe', 'jefe@x.com']]));

    expect(r.rows[0].verdict).toBe('RECHAZADA');
    expect(r.rows[0].reason).toMatch(/administrador/i);
  });

  it('quien ya es de otra empresa se rechaza SIN nombrarla — excepción de la decisión 10', async () => {
    // El nombre de la empresa 9 ('OTRA S.A.') está en el mundo para comprobar
    // justo lo contrario de lo que comprobaba esta prueba antes: que NO
    // aparece en el motivo. Este informe sale del panel hacia un correo al
    // cliente, y ese correo no lo lee ningún ADMIN.
    const m = mundo({
      usuarios: [{ id: 1, clientId: 9, email: 'ana@x.com', isActive: 1, isAdmin: 0 }],
      clientes: [
        { id: 7, razonSocial: 'ACME S.A.C.', status: 'CLIENT' },
        { id: 9, razonSocial: 'OTRA S.A.', status: 'CLIENT' },
      ],
    });
    const r = await crearServicio(m).review(7, csv([['Ana', 'ana@x.com']]));

    expect(r.rows[0].verdict).toBe('RECHAZADA');
    expect(r.rows[0].reason).toMatch(/otra empresa/i);
    expect(r.rows[0].reason).not.toContain('OTRA S.A.');
  });

  it('quien ya tiene invitación viva en esta empresa se REINVITA, y se avisa de que el enlace anterior muere', async () => {
    const m = mundo({ invitacionesVivas: [{ clientId: 7, email: 'ana@x.com' }] });
    const r = await crearServicio(m).review(7, csv([['Ana', 'ana@x.com']]));

    expect(r.rows[0].verdict).toBe('SE_REINVITARA');
    expect(r.rows[0].reason).toMatch(/dejará de funcionar/i);
  });

  it('una invitación viva de OTRA empresa se rechaza, y la ajena no se toca', async () => {
    const m = mundo({ invitacionesVivas: [{ clientId: 9, email: 'ana@x.com' }] });
    const r = await crearServicio(m).review(7, csv([['Ana', 'ana@x.com']]));

    expect(r.rows[0].verdict).toBe('RECHAZADA');
    expect(r.rows[0].reason).toMatch(/otra empresa/i);
  });

  it('una empresa que dejó de ser cliente tumba el archivo entero antes de mirar ninguna fila', async () => {
    const m = mundo({ clientes: [{ id: 7, razonSocial: 'ACME', status: 'FORMER_CLIENT' }] });

    await expect(crearServicio(m).review(7, csv([['Ana', 'ana@x.com']]))).rejects.toThrow(
      /dejó de ser cliente/i,
    );
  });

  it('un prospecto SÍ puede recibir invitaciones, igual que en R4', async () => {
    const m = mundo({ clientes: [{ id: 7, razonSocial: 'ACME', status: 'PROSPECT' }] });
    const r = await crearServicio(m).review(7, csv([['Ana', 'ana@x.com']]));

    expect(r.rows[0].verdict).toBe('SE_INVITARA');
  });
});

describe('review — el bloque firmado que sale', () => {
  it('lleva SOLO las filas aprobadas, con la empresa dentro, y va firmado', async () => {
    const m = mundo({
      usuarios: [{ id: 1, clientId: 7, email: 'ya@x.com', isActive: 1, isAdmin: 0 }],
    });
    const r = await crearServicio(m).review(
      7,
      csv([
        ['Ana', 'ana@x.com'],
        ['Ya', 'ya@x.com'],
      ]),
    );

    const payload = decodeReview(r.revision)!;
    expect(payload.clientId).toBe(7);
    expect(payload.rows).toEqual([{ line: 2, fullName: 'Ana', email: 'ana@x.com' }]);
    expect(r.mac).toHaveLength(64);
  });

  it('un archivo sin ninguna fila aprobada NO devuelve bloque: no hay nada que confirmar', async () => {
    const r = await crearServicio(mundo()).review(7, csv([['Ana', 'no-es-un-correo']]));

    expect(r.totals.rejected).toBe(1);
    expect(r.revision).toBe('');
    expect(r.mac).toBe('');
  });
});
```

- [ ] **Step 2: Ejecutarlas y ver que fallan**

Run: `cd backend && npx jest src/modules/portal/client-users-bulk.review.spec.ts`
Expected: FAIL — `Cannot find module './client-users-bulk.service'`.

- [ ] **Step 3: Escribir el servicio (parte de revisión)**

Crea `backend/src/modules/portal/client-users-bulk.service.ts`:

```ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClientsService } from '../clients/clients.service';
import { ClientUsersRepository } from './client-users.repository';
import { ClientUserInvitationsRepository } from './client-user-invitations.repository';
import { PortalInvitationsService, admiteReinvitacion } from './portal-invitations.service';
import { normalizeEmailAddress } from './email-address';
import { sameId } from '../../common/ids';
import { buildBulkTemplate, readUploadedGrid } from './bulk-users-workbook';
import { RawBulkRow, archivoRechazado, gridToRows } from './domain/bulk-user-file';
import {
  REVIEW_VERSION,
  ReviewRow,
  deriveReviewKey,
  encodeReview,
  reviewExpiryLabel,
  reviewMac,
} from './domain/bulk-users-review';

/**
 * La carga masiva de usuarios de cliente, desde el panel de la casa.
 *
 * Dos pasos, y el primero **no escribe nada ni manda ningún correo**
 * (decisión 3 de la spec): con 22 mensajes saliendo hacia personas reales,
 * descubrir el error a mitad no tiene arreglo.
 *
 * **Aquí se dice el motivo de cada rechazo**, al revés que en el portal
 * (decisión 7 de R4). No es una incoherencia: la regla de fondo es «no le
 * digas a nadie algo que no pudiera obtener ya por otro camino», y quien llega
 * aquí es personal de la casa con rol ADMIN, que ya puede leerse la lista
 * entera de empresas y de sus usuarios. La valla que lo sostiene es que estos
 * textos **viven solo aquí** y no se exportan hacia ninguna superficie del
 * portal. Ver la decisión 10 de la spec.
 *
 * **Una excepción dentro de esa misma regla:** cuando el motivo es que el
 * correo ya es de otra empresa, el texto lo dice **sin nombrarla**. Este
 * informe concreto sale del panel —se copia y se manda por correo al cliente
 * para que corrija su hoja— y ese correo lo lee alguien de fuera, al que la
 * lista de empresas sí le está vedada. Quien necesite saber cuál es la busca
 * en el panel.
 */

/** Los mismos límites que `InvitePortalUserDto`, no unos nuevos. */
export const MAX_FULL_NAME_LENGTH = 180;
export const MAX_EMAIL_LENGTH = 180;

/**
 * Comprobación de forma de correo, deliberadamente laxa: algo, una arroba,
 * algo con un punto. No se intenta reimplementar la RFC 5322 —nadie la
 * implementa entera y las aproximaciones estrictas rechazan direcciones
 * válidas—, y no hace falta: lo que decide de verdad si una dirección existe
 * es que el correo llegue.
 */
const FORMA_DE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type BulkRowVerdict = 'SE_INVITARA' | 'SE_REINVITARA' | 'RECHAZADA';

export interface BulkReviewRow {
  /** Fila del archivo, contando la cabecera. Es lo que hace accionable el informe. */
  line: number;
  fullName: string;
  email: string;
  verdict: BulkRowVerdict;
  /** El motivo, escrito. `null` solo cuando no hay nada que explicar. */
  reason: string | null;
}

export interface BulkReviewResult {
  clientId: number;
  clientName: string;
  rows: BulkReviewRow[];
  totals: { willInvite: number; willReinvite: number; rejected: number };
  /** Bloque opaco con lo aprobado. Cadena vacía si no hay nada que confirmar. */
  revision: string;
  /** Su firma. Cadena vacía si no hay bloque. */
  mac: string;
  /** Hasta cuándo vale, en hora de Lima. Cadena vacía si no hay bloque. */
  expiresAtLabel: string;
}

@Injectable()
export class ClientUsersBulkService {
  private readonly logger = new Logger(ClientUsersBulkService.name);

  constructor(
    private readonly clientUsers: ClientUsersRepository,
    private readonly invitations: ClientUserInvitationsRepository,
    private readonly clients: ClientsService,
    private readonly portalInvitations: PortalInvitationsService,
    private readonly config: ConfigService,
  ) {}

  /** La plantilla que se descarga. Ver `buildBulkTemplate`: sin ninguna fecha. */
  template(): Promise<Buffer> {
    return buildBulkTemplate();
  }

  /**
   * Analiza el archivo y dice, fila a fila, qué pasaría. **No escribe nada.**
   *
   * Devuelve además un bloque firmado con las filas aprobadas: es lo que hace
   * que la confirmación no pueda mandar otra cosa (decisión 15 de la spec).
   */
  async review(clientId: number, buffer: Buffer): Promise<BulkReviewResult> {
    const empresa = await this.empresaQuePuedeRecibirInvitaciones(clientId);
    const crudas = gridToRows(await readUploadedGrid(buffer));

    const vistos = new Map<string, number>();
    const rows: BulkReviewRow[] = [];

    for (const cruda of crudas) {
      rows.push(await this.evaluar(cruda, clientId, vistos));
    }

    const aprobadas: ReviewRow[] = rows
      .filter((f) => f.verdict !== 'RECHAZADA')
      .map((f) => ({ line: f.line, fullName: f.fullName, email: f.email }));

    const totals = {
      willInvite: rows.filter((f) => f.verdict === 'SE_INVITARA').length,
      willReinvite: rows.filter((f) => f.verdict === 'SE_REINVITARA').length,
      rejected: rows.filter((f) => f.verdict === 'RECHAZADA').length,
    };

    // Sin ninguna fila aprobada no se firma nada: un bloque vacío sería un
    // vale para confirmar la nada, y la pantalla tiene que empujar a corregir
    // el archivo, no a pulsar «enviar».
    if (aprobadas.length === 0) {
      return { clientId, clientName: empresa.razonSocial, rows, totals, revision: '', mac: '', expiresAtLabel: '' };
    }

    const issuedAt = Date.now();
    const revision = encodeReview({ v: REVIEW_VERSION, clientId, issuedAt, rows: aprobadas });

    return {
      clientId,
      clientName: empresa.razonSocial,
      rows,
      totals,
      revision,
      mac: reviewMac(this.reviewKey(), revision),
      expiresAtLabel: reviewExpiryLabel(issuedAt),
    };
  }

  /**
   * La clave del MAC. Se deriva en cada uso y no se guarda en un campo: es
   * barato, y así no hay ninguna copia del material de clave viva en el
   * proceso más tiempo del necesario.
   */
  private reviewKey(): Buffer {
    return deriveReviewKey(this.config.get<string>('JWT_ACCESS_SECRET') || '');
  }

  /**
   * La empresa, si puede recibir invitaciones.
   *
   * **`FORMER_CLIENT` tumba el archivo entero, antes de mirar ninguna fila.**
   * Una invitación a una empresa que dejó de ser cliente nace muerta —`accept`
   * la rechaza— así que mandar 22 correos con enlaces que no van a funcionar
   * es peor que no dejar hacerlo. Un `PROSPECT` sí puede, exactamente como en
   * R4: `clients` no tiene columna de activo, tiene `status`.
   */
  private async empresaQuePuedeRecibirInvitaciones(clientId: number) {
    const empresa = await this.clients.findByIdOrFail(clientId);
    if (empresa.status === 'FORMER_CLIENT') {
      throw archivoRechazado(
        'Esa empresa dejó de ser cliente, así que sus invitaciones no funcionarían. ' +
          'Cámbiale el estado antes de dar de alta a su gente.',
      );
    }
    return empresa;
  }

  /**
   * El veredicto de una fila. **La misma función la usan la revisión y el
   * envío** (Task 7): si el envío tuviera su propia copia, las dos podrían
   * discrepar y se invitaría a alguien que la pantalla dijo que no.
   *
   * `vistos` acumula los correos ya normalizados de este mismo archivo, con la
   * fila donde apareció cada uno. Se compara con el correo **normalizado**
   * porque `Ana@X.com` y `ana@x.com` son la misma persona, y dos filas para la
   * misma persona son un error del archivo, no dos invitaciones.
   */
  private async evaluar(
    cruda: RawBulkRow,
    clientId: number,
    vistos: Map<string, number>,
  ): Promise<BulkReviewRow> {
    const fullName = cruda.fullName.trim();
    const email = cruda.email === '' ? '' : normalizeEmailAddress(cruda.email);
    const base = { line: cruda.line, fullName, email };
    const rechazo = (reason: string): BulkReviewRow => ({ ...base, verdict: 'RECHAZADA', reason });

    if (fullName === '') return rechazo('Falta el nombre.');
    if (fullName.length > MAX_FULL_NAME_LENGTH) {
      return rechazo(`El nombre pasa de ${MAX_FULL_NAME_LENGTH} caracteres.`);
    }
    if (email === '') return rechazo('Falta el correo.');
    if (email.length > MAX_EMAIL_LENGTH) {
      return rechazo(`El correo pasa de ${MAX_EMAIL_LENGTH} caracteres.`);
    }
    if (!FORMA_DE_CORREO.test(email)) return rechazo('El correo no está bien escrito.');

    const yaVistoEn = vistos.get(email);
    if (yaVistoEn !== undefined) {
      return rechazo(`Ese correo ya aparece en la fila ${yaVistoEn} de este archivo.`);
    }
    vistos.set(email, cruda.line);

    const yaEsUsuario = await this.clientUsers.findByEmail(email);
    if (yaEsUsuario) {
      if (!sameId(yaEsUsuario.clientId, clientId)) {
        // Se dice QUE es de otra empresa, nunca CUÁL. Es la excepción de la
        // decisión 10: este informe sale del panel hacia un correo al cliente,
        // y ese correo no lo lee ningún ADMIN. Quien necesite el nombre lo
        // busca en el panel, que es donde esa consulta queda auditada.
        return rechazo('Ese correo ya es de un usuario de otra empresa.');
      }
      if (yaEsUsuario.isAdmin) {
        return rechazo(
          'Es administrador de esta empresa. La carga masiva no toca administradores; ' +
            'usa la edición del panel.',
        );
      }
      if (yaEsUsuario.isActive) {
        return rechazo('Ya es usuario activo de esta empresa; su contraseña no se toca.');
      }
      // Desactivado, no administrador y de esta empresa: reinvitación de la
      // decisión 12 de R4. Se decide con `admiteReinvitacion`, la MISMA
      // función que usan invitar y aceptar, no con una copia de sus tres
      // reglas — dos copias terminan divergiendo y la que se olvide es la que
      // deja reactivar a quien no debía.
      if (!admiteReinvitacion(yaEsUsuario, clientId)) {
        return rechazo('Ese correo no se puede invitar desde aquí.');
      }
      return {
        ...base,
        verdict: 'SE_INVITARA',
        reason: 'Está desactivado en esta empresa: al aceptar recuperará su acceso y su historial.',
      };
    }

    const viva = await this.invitations.findLiveByEmail(email, new Date());
    if (viva) {
      if (!sameId(viva.clientId, clientId)) {
        // No se toca la ajena: sería un efecto cruzado entre empresas por la
        // puerta de atrás. Misma regla que R4.
        return rechazo(
          'Ese correo tiene una invitación pendiente en otra empresa. No se puede invitar ' +
            'hasta que caduque.',
        );
      }
      return {
        ...base,
        verdict: 'SE_REINVITARA',
        reason:
          'Ya tiene una invitación pendiente: se le mandará un enlace nuevo y el anterior ' +
          'dejará de funcionar.',
      };
    }

    return { ...base, verdict: 'SE_INVITARA', reason: null };
  }
}
```

**No hay ningún mapa de razones sociales cacheado en esta clase, y es a propósito.** Una versión anterior de este plan memorizaba la razón social de la otra empresa en un `Map<number, string>` de por vida del proceso, para poder nombrarla en el mensaje de rechazo — con el riesgo de que ese nombre quedara viejo dentro de un mensaje ya mandado. La decisión 10 de la spec ahora dice que ese mensaje **no nombra a la otra empresa**, así que no hay nada que memorizar: el `Map` desaparece con el motivo que lo justificaba, no se deja «por si acaso». Si algún día otra cosa necesita el nombre de una empresa por su id dentro de este servicio, se pide a `ClientsService` en el momento, sin cachear nada.

- [ ] **Step 4: Registrar el servicio en el módulo**

En `backend/src/modules/portal/portal.module.ts`, añade `ClientUsersBulkService` a `providers` (no hace falta exportarlo: solo lo usa `ClientUsersController`, del mismo módulo).

- [ ] **Step 5: Ejecutar las pruebas y verlas pasar**

Run: `cd backend && npx jest src/modules/portal/client-users-bulk.review.spec.ts`
Expected: PASS

- [ ] **Step 6: Verificación completa**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/portal/client-users-bulk.service.ts \
        backend/src/modules/portal/client-users-bulk.review.spec.ts \
        backend/src/modules/portal/portal.module.ts
git commit -m "feat(portal): revision de la carga masiva, con el motivo de cada fila y un bloque firmado"
```

---

### Task 7: El servicio de carga masiva — el envío

**Files:**
- Create: `backend/src/modules/portal/dto/bulk-users.dto.ts`
- Modify: `backend/src/modules/portal/client-users-bulk.service.ts`
- Test: `backend/src/modules/portal/client-users-bulk.send.spec.ts`

**Interfaces:**
- Consume de la Task 6: `ClientUsersBulkService`, su `evaluar` privado y `empresaQuePuedeRecibirInvitaciones`. Consume de la Task 5: `PortalInvitationsService.invite(clientId, { kind: 'STAFF', userId }, dto)` y su `PortalInvitationView` con `deliveryFailed`.
- Produce, en `dto/bulk-users.dto.ts`:
  - `class ConfirmBulkInviteDto { revision: string; mac: string }` — **sin `clientId`**: la empresa va dentro del bloque firmado.
- Produce, en `client-users-bulk.service.ts`:
  - `type BulkSendOutcome = 'INVITADA' | 'INVITADA_SIN_CORREO' | 'OMITIDA' | 'FALLO'`
  - `interface BulkSendRow { line: number; fullName: string; email: string; outcome: BulkSendOutcome; reason: string | null }`
  - `interface BulkSendResult { rows: BulkSendRow[]; totals: { invited: number; invitedWithoutEmail: number; skipped: number; failed: number } }`
  - `send(staffUserId: number, dto: ConfirmBulkInviteDto): Promise<BulkSendResult>`
  - `REVISION_NO_VALIDA_MESSAGE` (exportada, para que la prueba del controlador no la reescriba).

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `backend/src/modules/portal/client-users-bulk.send.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';

import { ClientUsersBulkService } from './client-users-bulk.service';
import {
  REVIEW_TTL_MS,
  REVIEW_VERSION,
  deriveReviewKey,
  encodeReview,
  reviewMac,
} from './domain/bulk-users-review';

const SECRETO = 'secreto-de-pruebas';
const CLAVE = deriveReviewKey(SECRETO);

interface Mundo {
  usuarios: { id: number; clientId: number; email: string; isActive: number; isAdmin: number }[];
  invitacionesVivas: { clientId: number; email: string }[];
  clientes: { id: number; razonSocial: string; status: string }[];
  /** Cada llamada a invitar, en orden. Es lo que prueba que van en serie. */
  invitadas: { clientId: number; author: unknown; email: string }[];
  /** Correos que el transporte rechaza. Ver `deliveryFailed`. */
  correosQueFallan: Set<string>;
  /** Correos cuya escritura revienta, para probar que una fila mala no tumba las buenas. */
  escriturasQueRevientan: Set<string>;
}

function mundo(parcial: Partial<Mundo> = {}): Mundo {
  return {
    usuarios: [],
    invitacionesVivas: [],
    clientes: [{ id: 7, razonSocial: 'ACME S.A.C.', status: 'CLIENT' }],
    invitadas: [],
    correosQueFallan: new Set(),
    escriturasQueRevientan: new Set(),
    ...parcial,
  };
}

function crearServicio(m: Mundo) {
  const clientUsers = {
    findByEmail: async (email: string) => m.usuarios.find((u) => u.email === email) ?? null,
  };
  const invitations = {
    findLiveByEmail: async (email: string) =>
      m.invitacionesVivas.find((i) => i.email === email) ?? null,
  };
  const clients = {
    findByIdOrFail: async (id: number) => {
      const c = m.clientes.find((x) => x.id === id);
      if (!c) throw new Error('no existe');
      return c;
    },
  };
  const portalInvitations = {
    invite: async (clientId: number, author: unknown, dto: { email: string; fullName: string }) => {
      if (m.escriturasQueRevientan.has(dto.email)) throw new Error('la base se cayó');
      m.invitadas.push({ clientId, author, email: dto.email });
      return {
        id: m.invitadas.length,
        fullName: dto.fullName,
        email: dto.email,
        expiresAt: '2026-09-16T00:00:00.000Z',
        lastSentAt: '2026-09-09T00:00:00.000Z',
        deliveryFailed: m.correosQueFallan.has(dto.email),
        createdAt: '2026-09-09T00:00:00.000Z',
      };
    },
  };

  return new ClientUsersBulkService(
    clientUsers as never,
    invitations as never,
    clients as never,
    portalInvitations as never,
    new ConfigService({ JWT_ACCESS_SECRET: SECRETO }),
  );
}

function bloque(
  filas: { line: number; fullName: string; email: string }[],
  opciones: { clientId?: number; issuedAt?: number } = {},
) {
  const revision = encodeReview({
    v: REVIEW_VERSION,
    clientId: opciones.clientId ?? 7,
    issuedAt: opciones.issuedAt ?? Date.now(),
    rows: filas,
  });
  return { revision, mac: reviewMac(CLAVE, revision) };
}

const ANA = { line: 2, fullName: 'Ana Pérez', email: 'ana@x.com' };
const BEA = { line: 3, fullName: 'Bea Ruiz', email: 'bea@x.com' };

describe('send — la correspondencia con lo revisado', () => {
  it('un MAC cambiado no pasa', async () => {
    const b = bloque([ANA]);
    await expect(crearServicio(mundo()).send(40, { ...b, mac: 'f'.repeat(64) })).rejects.toThrow(
      /revisión/i,
    );
  });

  it('un bloque cambiado con su MAC viejo no pasa', async () => {
    const b = bloque([ANA]);
    const otro = bloque([{ ...ANA, email: 'mia@x.com' }]);
    await expect(
      crearServicio(mundo()).send(40, { revision: otro.revision, mac: b.mac }),
    ).rejects.toThrow(/revisión/i);
  });

  it('una revisión de hace 31 minutos ya no vale', async () => {
    const b = bloque([ANA], { issuedAt: Date.now() - REVIEW_TTL_MS - 1 });
    await expect(crearServicio(mundo()).send(40, b)).rejects.toThrow(/revisión/i);
  });

  it('la empresa sale del bloque firmado: el cuerpo no la trae y no hay dónde ponerla', async () => {
    const m = mundo({ clientes: [{ id: 9, razonSocial: 'OTRA', status: 'CLIENT' }] });
    // El bloque dice empresa 7, que en este mundo no existe: la lectura falla,
    // y no hay ningún `clientId` en el cuerpo que pudiera apuntar a la 9.
    await expect(crearServicio(m).send(40, bloque([ANA]))).rejects.toThrow();
    expect(m.invitadas).toHaveLength(0);
  });
});

describe('send — invitar', () => {
  it('invita con autor de PERSONAL y en el orden del archivo, una a una', async () => {
    const m = mundo();
    const r = await crearServicio(m).send(40, bloque([ANA, BEA]));

    expect(m.invitadas).toEqual([
      { clientId: 7, author: { kind: 'STAFF', userId: 40 }, email: 'ana@x.com' },
      { clientId: 7, author: { kind: 'STAFF', userId: 40 }, email: 'bea@x.com' },
    ]);
    expect(r.totals).toEqual({ invited: 2, invitedWithoutEmail: 0, skipped: 0, failed: 0 });
  });

  it('si el correo no sale, la invitación queda igual y se dice — no se calla', async () => {
    const m = mundo({ correosQueFallan: new Set(['bea@x.com']) });
    const r = await crearServicio(m).send(40, bloque([ANA, BEA]));

    expect(r.rows.map((f) => f.outcome)).toEqual(['INVITADA', 'INVITADA_SIN_CORREO']);
    expect(r.rows[1].reason).toMatch(/vuelve a subir/i);
    expect(r.totals).toEqual({ invited: 1, invitedWithoutEmail: 1, skipped: 0, failed: 0 });
  });

  it('una fila que revienta al escribir NO tumba las buenas', async () => {
    const CHE = { line: 4, fullName: 'Che Lópe', email: 'che@x.com' };
    const m = mundo({ escriturasQueRevientan: new Set(['bea@x.com']) });
    const r = await crearServicio(m).send(40, bloque([ANA, BEA, CHE]));

    expect(r.rows.map((f) => f.outcome)).toEqual(['INVITADA', 'FALLO', 'INVITADA']);
    expect(r.totals).toEqual({ invited: 2, invitedWithoutEmail: 0, skipped: 0, failed: 1 });
    // Y el motivo técnico NO sale en la respuesta: es diagnóstico interno.
    expect(r.rows[1].reason).not.toMatch(/la base se cayó/);
  });

  it('los cuatro contadores suman siempre el total de filas', async () => {
    const m = mundo({ correosQueFallan: new Set(['bea@x.com']) });
    const r = await crearServicio(m).send(40, bloque([ANA, BEA]));
    const { invited, invitedWithoutEmail, skipped, failed } = r.totals;
    expect(invited + invitedWithoutEmail + skipped + failed).toBe(r.rows.length);
  });
});

describe('send — el mundo pudo cambiar entre la revisión y la confirmación', () => {
  it('una fila que ya no se puede invitar sale OMITIDA con su motivo, y NO se invita', async () => {
    // Entre los dos pasos, alguien dio de alta a Ana desde el panel.
    const m = mundo({
      usuarios: [{ id: 1, clientId: 7, email: 'ana@x.com', isActive: 1, isAdmin: 0 }],
    });
    const r = await crearServicio(m).send(40, bloque([ANA, BEA]));

    expect(r.rows[0].outcome).toBe('OMITIDA');
    expect(r.rows[0].reason).toMatch(/ya es usuario/i);
    expect(m.invitadas.map((i) => i.email)).toEqual(['bea@x.com']);
  });

  it('si la empresa pasó a ex-cliente entre los dos pasos, no sale ni un correo', async () => {
    const m = mundo({ clientes: [{ id: 7, razonSocial: 'ACME', status: 'FORMER_CLIENT' }] });
    await expect(crearServicio(m).send(40, bloque([ANA, BEA]))).rejects.toThrow(
      /dejó de ser cliente/i,
    );
    expect(m.invitadas).toHaveLength(0);
  });
});

describe('send — el secreto de la invitación no sube', () => {
  it('en la respuesta no aparece nada con la forma de un secreto de invitación', async () => {
    const r = await crearServicio(mundo()).send(40, bloque([ANA, BEA]));
    // 43 caracteres del alfabeto base64url: la forma de un secreto. Se busca
    // la FORMA y no una clave concreta, para que la prueba no se quede vieja
    // el día que alguien añada un campo.
    expect(JSON.stringify(r)).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });
});
```

- [ ] **Step 2: Ejecutarlas y ver que fallan**

Run: `cd backend && npx jest src/modules/portal/client-users-bulk.send.spec.ts`
Expected: FAIL — `ClientUsersBulkService.send is not a function`.

- [ ] **Step 3: Escribir el DTO**

Crea `backend/src/modules/portal/dto/bulk-users.dto.ts`:

```ts
import { IsString, Length, Matches } from 'class-validator';

/**
 * La confirmación de una carga masiva.
 *
 * **Sin `clientId` a propósito, y esto es la mitad de la decisión 15 de la
 * spec.** La empresa va dentro del bloque firmado, así que no hay ningún sitio
 * donde escribir una distinta: una revisión del cliente A no se puede confirmar
 * contra el cliente B porque no existe el campo. Con el `ValidationPipe` global
 * (`forbidNonWhitelisted`), mandarlo devuelve 400 antes de llegar al servicio.
 *
 * `revision` y `mac` viajan **verbatim**: el navegador los recibe de la
 * revisión y los devuelve tal cual, sin volver a serializar nada. El MAC se
 * calcula sobre la cadena, no sobre el objeto reconstruido, así que
 * reconstruirlo en el navegador rompería la firma — y esa es exactamente la
 * propiedad que se quiere.
 */
export class ConfirmBulkInviteDto {
  @IsString({ message: 'Falta la revisión que se está confirmando.' })
  @Length(1, 200_000, { message: 'La revisión no tiene un tamaño admisible.' })
  revision!: string;

  /**
   * SHA-256 en hexadecimal: 64 caracteres. Se comprueba la forma aquí para no
   * llegar al servicio con algo que no puede casar con nada — pero **el
   * rechazo por forma y el rechazo por firma tienen que decir lo mismo**, y
   * por eso el mensaje es el mismo texto genérico: distinguirlos convertiría
   * el par de respuestas en una pista sobre la firma.
   */
  @IsString({ message: 'La revisión no es válida. Vuelve a subir el archivo.' })
  @Matches(/^[0-9a-f]{64}$/, { message: 'La revisión no es válida. Vuelve a subir el archivo.' })
  mac!: string;
}
```

- [ ] **Step 4: Escribir `send` en el servicio**

En `backend/src/modules/portal/client-users-bulk.service.ts`, añade los tipos y el método. Importa `ConfirmBulkInviteDto`, `decodeReview`, `isReviewExpired`, `reviewMacMatches`.

```ts
export type BulkSendOutcome = 'INVITADA' | 'INVITADA_SIN_CORREO' | 'OMITIDA' | 'FALLO';

export interface BulkSendRow {
  line: number;
  fullName: string;
  email: string;
  outcome: BulkSendOutcome;
  reason: string | null;
}

export interface BulkSendResult {
  rows: BulkSendRow[];
  totals: { invited: number; invitedWithoutEmail: number; skipped: number; failed: number };
}

/**
 * Único cuerpo para cualquier motivo por el que una revisión no vale: firma
 * que no casa, forma mala, versión vieja, caducada.
 *
 * No se distinguen porque al operador le sirven todos para lo mismo —volver a
 * subir el archivo— y porque distinguirlos daría pistas sobre la firma sin
 * ayudar a nadie.
 */
export const REVISION_NO_VALIDA_MESSAGE =
  'Esa revisión ya no vale. Vuelve a subir el archivo y revísalo otra vez antes de enviar.';
```

Y el método, dentro de la clase:

```ts
  /**
   * Crea las invitaciones de una revisión ya confirmada y manda los correos.
   *
   * **Tres cosas pasan aquí, y las tres importan:**
   *
   *  1. Se verifica la firma **antes de decodificar nada**, sobre la cadena
   *     tal cual llegó. Es lo que impide confirmar algo distinto de lo
   *     revisado.
   *  2. **Cada fila se vuelve a evaluar contra la base**, con la MISMA función
   *     que la evaluó en la revisión. La firma garantiza que la entrada es la
   *     misma; no puede garantizar que el veredicto siga siéndolo, porque en
   *     esos minutos alguien pudo dar de alta a una de esas direcciones desde
   *     el panel. Nunca se invita nada que no estuviera aprobado **y** siga
   *     aprobado.
   *  3. **Cada fila es su propia transacción y su propio try/catch.** Una fila
   *     que revienta no puede deshacer las anteriores ni impedir las
   *     siguientes (decisión 5 de la spec), y la única forma de cumplirlo es
   *     no envolver el lote en una transacción única.
   *
   * Los envíos van **en serie**: veintidós conexiones SMTP simultáneas es la
   * forma más rápida de que el proveedor nos marque.
   */
  async send(staffUserId: number, dto: ConfirmBulkInviteDto): Promise<BulkSendResult> {
    // La firma primero, sobre la cadena. Si no casa, no se decodifica nada:
    // no hay ninguna razón para interpretar un bloque que no firmamos.
    if (!reviewMacMatches(reviewMac(this.reviewKey(), dto.revision), dto.mac)) {
      throw revisionNoValida();
    }

    const payload = decodeReview(dto.revision);
    if (!payload) throw revisionNoValida();
    if (isReviewExpired(payload.issuedAt, new Date())) throw revisionNoValida();

    // La empresa sale del bloque firmado, nunca del cuerpo. Y se vuelve a
    // comprobar que puede recibir invitaciones: pudo pasar a ex-cliente entre
    // los dos pasos, y entonces no sale ni un correo.
    await this.empresaQuePuedeRecibirInvitaciones(payload.clientId);

    const vistos = new Map<string, number>();
    const rows: BulkSendRow[] = [];

    for (const fila of payload.rows) {
      rows.push(await this.enviarUna(staffUserId, payload.clientId, fila, vistos));
    }

    return {
      rows,
      totals: {
        invited: rows.filter((f) => f.outcome === 'INVITADA').length,
        invitedWithoutEmail: rows.filter((f) => f.outcome === 'INVITADA_SIN_CORREO').length,
        skipped: rows.filter((f) => f.outcome === 'OMITIDA').length,
        failed: rows.filter((f) => f.outcome === 'FALLO').length,
      },
    };
  }

  /** Una fila: revalidar, invitar, y no dejar que su fallo salpique a las demás. */
  private async enviarUna(
    staffUserId: number,
    clientId: number,
    fila: ReviewRow,
    vistos: Map<string, number>,
  ): Promise<BulkSendRow> {
    const base = { line: fila.line, fullName: fila.fullName, email: fila.email };

    try {
      const ahora = await this.evaluar(fila, clientId, vistos);
      if (ahora.verdict === 'RECHAZADA') {
        return { ...base, outcome: 'OMITIDA', reason: ahora.reason };
      }

      const view = await this.portalInvitations.invite(
        clientId,
        { kind: 'STAFF', userId: staffUserId },
        { email: fila.email, fullName: fila.fullName },
      );

      // `deliver` ya se traga el fallo de envío y deja la invitación creada
      // (decisión 6 de R4): aquí solo se traduce ese hecho a algo que el
      // operador pueda accionar. El motivo técnico del rechazo del SMTP se
      // queda en el log, como ya se queda hoy.
      return view.deliveryFailed
        ? {
            ...base,
            outcome: 'INVITADA_SIN_CORREO',
            reason:
              'La invitación quedó creada pero el correo no salió. Vuelve a subir esta fila ' +
              'para mandarle un enlace nuevo.',
          }
        : { ...base, outcome: 'INVITADA', reason: null };
    } catch (err) {
      // Al log entero, a la respuesta nunca: por qué exactamente falló la
      // escritura es diagnóstico interno, y en la pantalla solo sirve para
      // asustar. Lo que el operador necesita es saber a quién le tocó.
      this.logger.error(
        `Carga masiva: falló la fila ${fila.line} (${fila.email}): ${(err as Error)?.message}`,
      );
      return {
        ...base,
        outcome: 'FALLO',
        reason: 'No se pudo crear su invitación. Vuelve a subir esta fila.',
      };
    }
  }
```

Y la función suelta, al final del fichero junto a las demás:

```ts
function revisionNoValida(): BadRequestException {
  return new BadRequestException({
    code: 'REVISION_NO_VALIDA',
    message: REVISION_NO_VALIDA_MESSAGE,
  });
}
```

`evaluar` recibe un `RawBulkRow` y una `ReviewRow` tiene exactamente los mismos tres campos, así que la llamada compila tal cual. **No cambies `evaluar`**: es la misma función a propósito.

- [ ] **Step 5: Ejecutar las pruebas y verlas pasar**

Run: `cd backend && npx jest src/modules/portal/client-users-bulk`
Expected: PASS (los dos specs, revisión y envío).

- [ ] **Step 6: Verificación completa**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/portal/dto/bulk-users.dto.ts \
        backend/src/modules/portal/client-users-bulk.service.ts \
        backend/src/modules/portal/client-users-bulk.send.spec.ts
git commit -m "feat(portal): el envio de la carga masiva, fila a fila y sin que una mala tumbe las buenas"
```

---

### Task 8: Las tres rutas del panel — guardas, límites de subida y tope de envío

**Files:**
- Create: `backend/src/modules/portal/interceptors/bulk-upload-errors.interceptor.ts`
- Modify: `backend/src/modules/portal/client-users.controller.ts`
- Modify: `backend/src/config/throttler.config.ts`
- Test: `backend/src/modules/portal/client-users.bulk.controller.spec.ts`

**Interfaces:**
- Consume: `ClientUsersBulkService` (Tasks 6 y 7), `ConfirmBulkInviteDto` (Task 7), `BULK_UPLOAD_LIMITS` (Task 2), `BULK_TEMPLATE_FILENAME` / `BULK_TEMPLATE_MIME` (Task 3).
- Produce, rutas HTTP:
  - `GET /client-users/carga-masiva/plantilla` → el `.xlsx`, forzado a descarga.
  - `POST /client-users/carga-masiva/revision?clientId=N`, multipart campo `file` → `BulkReviewResult` (200).
  - `POST /client-users/carga-masiva/envio`, JSON `{ revision, mac }` → `BulkSendResult` (200).
- Produce, en `config/throttler.config.ts`: `BULK_INVITE_THROTTLE`.

Contexto: **las tres cuelgan de `ClientUsersController`, que ya lleva `@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)` a nivel de clase.** Lo que hay que decidir por ruta es el `@Roles`, y el criterio se copia de sus hermanas: `create` y `update` —las dos mutaciones— llevan `@Roles('ADMIN')`; `list` no. Ver la decisión 11 de la spec: **las tres nuevas llevan `ADMIN`**.

Y **el orden de las rutas importa**: `carga-masiva/plantilla` tiene que declararse antes que cualquier `@Get(':id')` que se añada mañana a este controlador. Hoy no hay ninguno, así que no hay conflicto; queda anotado para que no lo haya.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `backend/src/modules/portal/client-users.bulk.controller.spec.ts`. Son pruebas de **metadatos y de cableado**, no de HTTP real: comprueban que cada ruta lleva las guardas, el rol y los límites que dice el diseño — que es exactamente lo que se cae en silencio cuando alguien añade una ruta al lado.

```ts
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import {
  BULK_INVITE_THROTTLE,
  THROTTLER_BURST,
  THROTTLER_SUSTAINED,
} from '../../config/throttler.config';
import { BULK_UPLOAD_LIMITS, MAX_BULK_FILE_BYTES } from './domain/bulk-user-file';
import { ClientUsersController } from './client-users.controller';
import { ApiThrottlerGuard } from '../../common/guards/api-throttler.guard';
import { BulkUploadErrorsInterceptor } from './interceptors/bulk-upload-errors.interceptor';

/** Los `@Roles` declarados sobre un método del controlador. */
function rolesDe(metodo: string): string[] | undefined {
  return Reflect.getMetadata(ROLES_KEY, (ClientUsersController.prototype as never)[metodo]);
}

function interceptoresDe(metodo: string): unknown[] {
  return Reflect.getMetadata('__interceptors__', (ClientUsersController.prototype as never)[metodo]) ?? [];
}

function guardasDe(metodo: string): unknown[] {
  return Reflect.getMetadata('__guards__', (ClientUsersController.prototype as never)[metodo]) ?? [];
}

describe('las tres rutas de carga masiva', () => {
  it('las tres exigen rol ADMIN, como sus hermanas mutantes del mismo controlador', () => {
    expect(rolesDe('bulkTemplate')).toEqual(['ADMIN']);
    expect(rolesDe('bulkReview')).toEqual(['ADMIN']);
    expect(rolesDe('bulkSend')).toEqual(['ADMIN']);
  });

  it('el traductor de errores de subida va POR DELANTE de FileInterceptor', () => {
    // Es su `next.handle()` el que envuelve a la subida y el único sitio desde
    // el que se ve el error que produce multer. Al revés, no se ve nunca.
    const [primero] = interceptoresDe('bulkReview');
    expect(primero).toBe(BulkUploadErrorsInterceptor);
  });

  it('SOLO la ruta de envío lleva tope de frecuencia', () => {
    // La revisión no manda nada, y limitarla molestaría justo en el paso que
    // existe para corregir y volver a intentarlo. Ver la decisión 12.
    expect(guardasDe('bulkSend')).toContain(ApiThrottlerGuard);
    expect(guardasDe('bulkReview')).not.toContain(ApiThrottlerGuard);
    expect(guardasDe('bulkTemplate')).not.toContain(ApiThrottlerGuard);
  });

  it('el tope de envío es estrecho: una carga de 22 se hace una vez, y dos clientes seguidos también caben', () => {
    expect(BULK_INVITE_THROTTLE[THROTTLER_BURST].limit).toBe(1);
    expect(BULK_INVITE_THROTTLE[THROTTLER_SUSTAINED].limit).toBe(3);
  });

  it('el tope de tamaño llega de verdad a multer, y es un solo archivo', () => {
    expect(BULK_UPLOAD_LIMITS.fileSize).toBe(MAX_BULK_FILE_BYTES);
    expect(BULK_UPLOAD_LIMITS.files).toBe(1);
  });
});

describe('el cableado de cada ruta', () => {
  const servicio = {
    template: jest.fn(async () => Buffer.from('xlsx')),
    review: jest.fn(async () => ({ rows: [] })),
    send: jest.fn(async () => ({ rows: [], totals: {} })),
  };
  const controller = new ClientUsersController({} as never, servicio as never);

  beforeEach(() => jest.clearAllMocks());

  it('la revisión pasa el clientId de la QUERY y el buffer del archivo', async () => {
    await controller.bulkReview(7, { buffer: Buffer.from('x') } as never);
    expect(servicio.review).toHaveBeenCalledWith(7, Buffer.from('x'));
  });

  it('sin archivo, un 400 en español y no un TypeError', async () => {
    await expect(controller.bulkReview(7, undefined as never)).rejects.toThrow(/archivo/i);
  });

  it('el envío toma el id del PERSONAL de la sesión, nunca del cuerpo', async () => {
    const dto = { revision: 'r', mac: 'f'.repeat(64) };
    await controller.bulkSend({ id: 40 } as never, dto);
    expect(servicio.send).toHaveBeenCalledWith(40, dto);
  });
});
```

`ROLES_KEY` ya está exportado por `backend/src/common/decorators/roles.decorator.ts` (vale `'roles'`); úsalo en vez de repetir el literal, que es cómo una de las dos copias se queda vieja.

Y una prueba más en el mismo fichero, que ejecuta **el guard de verdad** en vez de mirar solo el metadato — es lo que fija que un `DEVELOPER` se coma un 403:

```ts
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from '../../common/guards/roles.guard';

/** Contexto mínimo: el rol de quien pide y el manejador al que apunta. */
function contextoCon(role: string, metodo: string): ExecutionContext {
  const handler = (ClientUsersController.prototype as never)[metodo];
  return {
    getHandler: () => handler,
    getClass: () => ClientUsersController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 1, email: 'a@b.c', role } }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard sobre las tres rutas', () => {
  const guard = new RolesGuard(new Reflector());

  it.each(['bulkTemplate', 'bulkReview', 'bulkSend'])('un ADMIN pasa por %s', (metodo) => {
    expect(guard.canActivate(contextoCon('ADMIN', metodo))).toBe(true);
  });

  it.each(['bulkTemplate', 'bulkReview', 'bulkSend'])('un DEVELOPER NO pasa por %s', (metodo) => {
    expect(() => guard.canActivate(contextoCon('DEVELOPER', metodo))).toThrow();
  });
});
```

> Si `RolesGuard.canActivate` devuelve `false` en vez de lanzar, cambia el `toThrow()` por `toBe(false)`: lo que esta prueba fija es que **no deja pasar**, no la forma exacta del rechazo. Mira el fichero del guard antes de escribirla y ajústala a lo que hace; no cambies el guard para que encaje con la prueba.

- [ ] **Step 2: Ejecutarlas y ver que fallan**

Run: `cd backend && npx jest src/modules/portal/client-users.bulk.controller.spec.ts`
Expected: FAIL — `Cannot find module './interceptors/bulk-upload-errors.interceptor'`.

- [ ] **Step 3: El tope de frecuencia**

En `backend/src/config/throttler.config.ts`, **corrige el comentario de `NOTIFICATION_TEST_THROTTLE`** —donde dice «la única excepción a esa regla es el envío de prueba» pasa a decir que son **dos**— y añade al final:

```ts
/**
 * Override para `POST /client-users/carga-masiva/envio`.
 *
 * **La segunda excepción al «el panel interno no se limita»**, y por el mismo
 * motivo que la primera (`NOTIFICATION_TEST_THROTTLE`): efecto externo e
 * irreversible. Aquí en peor, además: una sola petición saca hasta 200 correos
 * de verdad por el SMTP de producción, y quemar la cuota del proveedor o la
 * reputación del remitente es el riesgo que hunde la funcionalidad entera por
 * perfecto que esté el código.
 *
 * **NO es el tope de invitar del portal, y conviene saber por qué.** Aquel
 * existe para cerrar un oráculo —un 201 contra un 400 dice si una dirección
 * está libre—. Aquí ese oráculo no existe, y no porque lo hayamos cerrado:
 * porque el panel dice el motivo de cada fila a propósito (decisión 10 de la
 * spec), y lo dice porque quien mira ya puede leerse la lista entera de
 * empresas y usuarios. Copiar aquel tope sería copiar el mecanismo sin su
 * motivo, que es como se acumulan las reglas que nadie sabe por qué están.
 *
 * Las otras dos rutas de la carga masiva —la plantilla y la revisión— van SIN
 * tope: no mandan nada, y limitar la revisión molestaría justo en el paso que
 * existe para que el operador corrija y vuelva a intentarlo.
 *
 * **Los números, y por qué estos y no otros (decisión 2 de esta revisión del
 * diseño):** el caso real es una carga de 22 una vez, pero el tope no se
 * calibra contra ese caso suelto sino contra la sesión de trabajo completa,
 * que puede traer **dos clientes seguidos** el mismo rato.
 *
 * - **Ráfaga: 1 por minuto.** Entre revisar 22 filas y confirmar pasa siempre
 *   más de un minuto, así que ningún uso legítimo la roza; lo único que corta
 *   es un doble clic.
 * - **Sostenido: 3 cada quince minutos.** Caben los dos clientes seguidos
 *   **y** un reintento —volver a subir el archivo entero porque una fila
 *   quedó `INVITADA_SIN_CORREO` (decisión 13 de la spec)— sin esperar entre
 *   medias. Con 2 cabría la pareja y nada más: el primer reintento del día
 *   chocaría con el tope, y reintentar no es un caso raro.
 *
 * El techo teórico queda anotado tal cual: 3 × 200 = 600 correos cada quince
 * minutos desde una dirección. Es la mitad del que dejaban los valores
 * anteriores de este mismo diseño (2 y 6, con un techo de 1200), y llegar a él
 * exige de todos modos tres archivos de 200 filas en el mismo cuarto de hora
 * desde una sesión con rol ADMIN y asiento en `audit_log` — no es el patrón de
 * un cliente cargándose, es el patrón de alguien intentando algo raro. Bajarlo
 * más (a 1) sí estorbaría el uso legítimo: dejaría sin sitio al segundo
 * cliente del día o a cualquier reintento del primero.
 */
export const BULK_INVITE_THROTTLE = {
  [THROTTLER_BURST]: { ttl: ONE_MINUTE_MS, limit: 1 },
  [THROTTLER_SUSTAINED]: { ttl: FIFTEEN_MINUTES_MS, limit: 3 },
};
```

- [ ] **Step 4: El traductor de errores de subida**

Crea `backend/src/modules/portal/interceptors/bulk-upload-errors.interceptor.ts`:

```ts
import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';

import { MAX_BULK_FILE_BYTES } from '../domain/bulk-user-file';

/**
 * Traduce al idioma y a la forma de la casa los errores que produce la propia
 * subida, antes de que llegue a ejecutarse el método del controlador.
 *
 * **Por qué no se reutiliza `AttachmentUploadErrorsInterceptor`**, que hace lo
 * mismo para los adjuntos de tickets: su mensaje nombra el tope de 10 MB por
 * archivo adjunto, que es otro número y otra superficie. Reutilizarlo obligaría
 * a parametrizarlo —y a tocar dos controladores que están en producción por una
 * funcionalidad nueva— o a que esta ruta mintiera sobre su propio tope. Son
 * ochenta líneas de las que solo se repiten diez, y la copia queda anotada en
 * las dos puntas.
 *
 * **Por qué no un `ExceptionFilter` con `@Catch(MulterError)`:** porque no se
 * dispararía. `@nestjs/platform-express` pasa todos los errores de multer por
 * `transformException` y los convierte en `HttpException` antes de que ningún
 * filtro los vea.
 *
 * Va **por delante** de `FileInterceptor` en `@UseInterceptors`: es su
 * `next.handle()` el que envuelve a la subida y el único sitio desde el que se
 * ve ese error.
 */
@Injectable()
export class BulkUploadErrorsInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(catchError((error) => throwError(() => traducir(error))));
  }
}

const MAX_KB = Math.round(MAX_BULK_FILE_BYTES / 1024);

const DEMASIADO_GRANDE = {
  code: 'PAYLOAD_TOO_LARGE',
  message:
    `El archivo supera el máximo de ${MAX_KB} KB. Una plantilla rellenada con doscientas ` +
    'filas no llega ni a la décima parte: comprueba que estás subiendo la plantilla y no otra cosa.',
} as const;

const SUBIDA_ILEGIBLE = {
  code: 'UPLOAD_ERROR',
  message: 'No se pudo leer el archivo enviado. Adjúntalo en el campo «file» y vuelve a intentarlo.',
} as const;

/**
 * El criterio para saber si hay que traducirlo es **si ya trae `code`**, el
 * mismo que usa `HttpExceptionFilter.resolveCode`. Todo lo que lanzan el
 * dominio y el servicio lo trae; lo que sale de `transformException` es un
 * `HttpException` con un texto suelto en inglés, y no. Así no hay que reconocer
 * mensajes concretos de una librería, que es lo que se rompe en la siguiente
 * versión menor.
 */
function traducir(error: unknown): unknown {
  if (!(error instanceof HttpException) || yaTieneCodigo(error)) return error;
  if (error instanceof PayloadTooLargeException) return new PayloadTooLargeException(DEMASIADO_GRANDE);
  if (error instanceof BadRequestException) return new BadRequestException(SUBIDA_ILEGIBLE);
  return error;
}

function yaTieneCodigo(error: HttpException): boolean {
  const cuerpo = error.getResponse();
  return (
    typeof cuerpo === 'object' &&
    cuerpo !== null &&
    typeof (cuerpo as { code?: unknown }).code === 'string'
  );
}
```

- [ ] **Step 5: Las tres rutas**

En `backend/src/modules/portal/client-users.controller.ts`, añade los imports y las tres rutas **detrás de `list` y antes de `create`** (el orden de declaración no importa aquí porque no hay ningún `@Get(':id')`, pero mantenerlas juntas sí):

```ts
  /**
   * La plantilla que se rellena. **Se genera en el servidor** (decisión 1 de la
   * spec): el análisis tiene que ocurrir donde se puede validar, y generar aquí
   * mantiene la plantilla y el analizador pegados — si mañana cambia una
   * columna, cambia en el mismo sitio.
   *
   * `@Roles('ADMIN')` aunque no lea datos de nadie: es el primer paso de una
   * operación que solo un ADMIN puede terminar, y dejar que un rol menor se la
   * descargue para chocar contra un 403 al subirla es una pantalla que promete
   * algo que no puede cumplir. Es la decisión más blanda de las tres y está
   * anotada como tal en la spec.
   */
  @Get('carga-masiva/plantilla')
  @Roles('ADMIN')
  async bulkTemplate(@Res() res: Response): Promise<void> {
    const buffer = await this.bulk.template();
    // Descarga forzada y `nosniff`, igual que los adjuntos: el nombre es ASCII
    // por construcción, así que no hace falta la codificación RFC 5987 de
    // `serveAttachment` — y ese ayudante sirve flujos, no buffers.
    res.setHeader('Content-Disposition', `attachment; filename="${BULK_TEMPLATE_FILENAME}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', BULK_TEMPLATE_MIME);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  /**
   * Analiza el archivo y devuelve qué pasaría con cada fila. **No manda ningún
   * correo y no escribe nada** (decisión 3 de la spec).
   *
   * `@HttpCode(200)` y no 201: no se ha creado nada.
   *
   * **El `clientId` va en la query y no en el cuerpo**, y no es un capricho: el
   * cuerpo aquí es multipart, donde todo campo llega como cadena y la
   * validación de un `@Body()` se vuelve un asunto de conversiones implícitas.
   * En la query lo mira `ParseIntPipe` y se acabó — el mismo sitio del que ya
   * lo toma `list`, unas líneas más arriba.
   *
   * Efecto lateral bueno: `req.body` queda vacío, así que los nombres y
   * correos del archivo **no se copian a `audit_log` en el paso que no hace
   * nada**. Se copian en el envío, que es donde el asiento tiene sentido.
   */
  @Post('carga-masiva/revision')
  @Roles('ADMIN')
  @HttpCode(200)
  // El orden importa: el traductor va POR DELANTE, porque es su `next.handle()`
  // el que envuelve a `FileInterceptor` y el único sitio desde el que se ve el
  // error que produce la propia subida.
  @UseInterceptors(
    BulkUploadErrorsInterceptor,
    FileInterceptor('file', { limits: BULK_UPLOAD_LIMITS }),
  )
  async bulkReview(
    @Query('clientId', ParseIntPipe) clientId: number,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<BulkReviewResult> {
    if (!file) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Falta el archivo en el campo «file». Descarga la plantilla, rellénala y súbela.',
      });
    }
    return this.bulk.review(clientId, file.buffer);
  }

  /**
   * Manda los correos de una revisión ya confirmada.
   *
   * **El único sitio de esta funcionalidad con tope de frecuencia**, y no por
   * el motivo del tope de invitar del portal —allí cierra un oráculo que aquí
   * no existe— sino por el de `NOTIFICATION_TEST_THROTTLE`: efecto externo e
   * irreversible. Ver `BULK_INVITE_THROTTLE`.
   *
   * `user.id` sale del token que `JwtAuthGuard` acaba de verificar; el cuerpo
   * solo aporta la revisión y su firma, y **no trae ninguna empresa**: esa va
   * dentro del bloque firmado.
   */
  @Post('carga-masiva/envio')
  @Roles('ADMIN')
  @HttpCode(200)
  @UseGuards(ApiThrottlerGuard)
  @Throttle(BULK_INVITE_THROTTLE)
  bulkSend(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmBulkInviteDto,
  ): Promise<BulkSendResult> {
    return this.bulk.send(user.id, dto);
  }
```

Y en el constructor, el servicio nuevo:

```ts
  constructor(
    private readonly service: ClientUsersService,
    private readonly bulk: ClientUsersBulkService,
  ) {}
```

- [ ] **Step 6: Ejecutar las pruebas y verlas pasar**

Run: `cd backend && npx jest src/modules/portal/client-users.bulk.controller.spec.ts`
Expected: PASS

- [ ] **Step 7: Comprobar que el tachado de la auditoría no se salta nada**

`scrubSecrets` **no está exportada** y `safePayload` es privado, así que la comprobación se hace donde ya se hace en este proyecto: **atravesando el interceptor**, con el mismo montaje que usa `backend/src/common/interceptors/audit.interceptor.spec.ts` (ver ahí `makeInterceptor` y `asientoDe`). No exportes nada nuevo para esto: el asiento es lo que hay que mirar, y el asiento se obtiene ejecutando.

Añade al final de `client-users.bulk.controller.spec.ts`. **Los `import` van arriba, fundidos con los que ya escribiste en los pasos 1 y 4** —`ExecutionContext` ya está importado de `@nestjs/common` por el bloque de `RolesGuard`, y un segundo `import` del mismo módulo no compila limpio—:

```ts
import { CallHandler } from '@nestjs/common'; // junto a ExecutionContext, que ya está
import { firstValueFrom, of } from 'rxjs';
import { Repository } from 'typeorm';

import { AuditLog } from '../../modules/audit/entities/audit-log.entity';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';

/**
 * El asiento que dejaría en `audit_log` un POST con ese cuerpo y esa
 * respuesta. Mismo montaje que `audit.interceptor.spec.ts`.
 */
async function asientoDe(body: unknown, response: unknown) {
  const guardados: Partial<AuditLog>[] = [];
  const repo = {
    create: (data: Partial<AuditLog>) => data,
    save: async (data: Partial<AuditLog>) => void guardados.push(data),
  };
  const interceptor = new AuditInterceptor(repo as unknown as Repository<AuditLog>);
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        url: '/api/v1/client-users/carga-masiva/envio',
        route: { path: '/api/v1/client-users/carga-masiva/envio' },
        body,
        headers: {},
        ip: '10.0.0.1',
        user: { id: 40, email: 'admin@kubo.pe', role: 'ADMIN' },
      }),
    }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of(response) };

  await firstValueFrom(interceptor.intercept(ctx, next));
  return guardados[0]?.payloadJson as { request: unknown; response: unknown };
}

describe('lo que esta funcionalidad deja en audit_log', () => {
  const CUERPO = { revision: 'eyJ2IjoxfQ', mac: 'a'.repeat(64) };
  const RESPUESTA = {
    rows: [{ line: 2, fullName: 'Ana Pérez', email: 'ana@x.com', outcome: 'INVITADA', reason: null }],
    totals: { invited: 1, invitedWithoutEmail: 0, skipped: 0, failed: 0 },
  };

  /**
   * Por esta funcionalidad **no pasa ninguna contraseña** —crea invitaciones,
   * no contraseñas— **ni ningún secreto de invitación**: el secreto nace y
   * muere dentro de `deliver`, y lo que sube es `PortalInvitationView`, lista
   * blanca campo a campo sin huella y sin secreto.
   *
   * Se mira **la respuesta**, que es por donde podría escaparse un secreto, y
   * por la FORMA y no por una clave concreta, para que la prueba no se quede
   * vieja el día que alguien añada un campo: ahí no puede aparecer ninguna
   * cadena de 43 caracteres del alfabeto `base64url`.
   *
   * No se mira el cuerpo con esta misma regla a propósito: el `mac` son 64
   * caracteres hexadecimales, que también están en ese alfabeto, y casaría
   * siempre. Lo que cubre al cuerpo es la prueba de abajo más el hecho de que
   * por él solo viajan `revision` y `mac`.
   */
  it('la respuesta del envío no lleva nada con la forma de un secreto', async () => {
    const asiento = await asientoDe(CUERPO, RESPUESTA);
    expect(JSON.stringify(asiento.response)).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });

  it('cada fila del informe lleva exactamente cinco campos, y ninguno es un secreto', async () => {
    const asiento = await asientoDe(CUERPO, RESPUESTA);
    const fila = (asiento.response as { rows: Record<string, unknown>[] }).rows[0];
    expect(Object.keys(fila).sort()).toEqual(['email', 'fullName', 'line', 'outcome', 'reason']);
  });

  it('«mac» NO se tacha, y eso es deliberado: no es una credencial', async () => {
    // Autentica un dato que quien lo tiene ya tiene entero, y dejarlo legible
    // es lo que permite reconstruir qué revisión se confirmó. Si algún día
    // valiera por sí solo para hacer algo sin sesión, pasa a ser credencial y
    // tendría que cambiar de nombre para que el patrón lo tachara.
    const asiento = await asientoDe(CUERPO, RESPUESTA);
    expect(JSON.stringify(asiento.request)).toContain('a'.repeat(64));
  });
});
```

- [ ] **Step 8: Verificación completa**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/portal/client-users.controller.ts \
        backend/src/modules/portal/interceptors/bulk-upload-errors.interceptor.ts \
        backend/src/modules/portal/client-users.bulk.controller.spec.ts \
        backend/src/config/throttler.config.ts
git commit -m "feat(portal): rutas de carga masiva en el panel, con rol ADMIN y tope solo en el envio"
```

---

### Task 9: La pantalla — descargar, subir, revisar y confirmar

**Files:**
- Create: `web/src/api/client-users-bulk.api.ts`
- Create: `web/src/pages/client-users/BulkInviteDialog.tsx`
- Modify: `web/src/pages/ClientUsersPage.tsx`

**Interfaces:**
- Consume del backend, tal cual lo publican las tareas 6, 7 y 8:
  - `GET /client-users/carga-masiva/plantilla` → `.xlsx` (blob)
  - `POST /client-users/carga-masiva/revision?clientId=N`, multipart `file` → `BulkReviewResult`
  - `POST /client-users/carga-masiva/envio`, `{ revision, mac }` → `BulkSendResult`
- Produce, en `web/src/api/client-users-bulk.api.ts`: los tipos `BulkRowVerdict`, `BulkReviewRow`, `BulkReviewResult`, `BulkSendOutcome`, `BulkSendRow`, `BulkSendResult` y el objeto `clientUsersBulkApi` con `downloadTemplate()`, `review(clientId, file)` y `send(revision, mac)`.
- Produce, en la página: un botón «Carga masiva» junto a «Nuevo usuario», deshabilitado mientras no haya cliente elegido.

**`web/` no tiene ejecutor de pruebas** (`package.json` no trae jest ni vitest; la verificación de la casa es `tsc --noEmit && npm run build`). Así que aquí **la comprobación que falla primero es el compilador**, y el paso 1 la provoca a propósito: se escribe el consumo antes que el módulo. No es un sustituto de una prueba unitaria y no se pretende que lo sea; es la comprobación que este proyecto tiene, ejecutada en el orden correcto.

- [ ] **Step 1: Escribir el consumo, y ver que el compilador falla**

En `web/src/pages/ClientUsersPage.tsx`, añade el import y el estado del diálogo:

```tsx
import BulkInviteDialog from './client-users/BulkInviteDialog';
```

```tsx
  const [bulkOpen, setBulkOpen] = useState(false);
```

Run: `cd web && npx tsc --noEmit`
Expected: FAIL — `Cannot find module './client-users/BulkInviteDialog'`.

- [ ] **Step 2: El cliente de la API**

Crea `web/src/api/client-users-bulk.api.ts`:

```ts
import { api } from './client';
import { saveAttachmentToDisk } from './ticket-messages.api';

/**
 * La carga masiva de usuarios de cliente, desde el panel.
 *
 * **El navegador no analiza nada.** Descarga bytes y sube bytes; quien lee la
 * hoja de cálculo, valida y decide es el servidor (decisión 1 del diseño). Aquí
 * no hay ninguna regla de negocio que pudiera divergir de la suya.
 */

export type BulkRowVerdict = 'SE_INVITARA' | 'SE_REINVITARA' | 'RECHAZADA';

export interface BulkReviewRow {
  /** Fila del archivo, contando la cabecera. Es lo que deja ir a corregirla. */
  line: number;
  fullName: string;
  email: string;
  verdict: BulkRowVerdict;
  /** El motivo, escrito. Aquí sí se dice: ver la decisión 10 del diseño. */
  reason: string | null;
}

export interface BulkReviewResult {
  clientId: number;
  clientName: string;
  rows: BulkReviewRow[];
  totals: { willInvite: number; willReinvite: number; rejected: number };
  /**
   * Bloque opaco con lo aprobado. **Se devuelve verbatim al confirmar**: no lo
   * decodifiques, no lo reordenes y no lo vuelvas a serializar. Su firma se
   * calcula sobre esta cadena tal cual, así que tocarlo la rompe — que es
   * exactamente lo que se quiere. Cadena vacía si no hay nada que confirmar.
   */
  revision: string;
  /** Su firma. Se devuelve verbatim, igual. */
  mac: string;
  /** Hasta cuándo vale la revisión, en hora de Lima, ya formateado por el backend. */
  expiresAtLabel: string;
}

export type BulkSendOutcome = 'INVITADA' | 'INVITADA_SIN_CORREO' | 'OMITIDA' | 'FALLO';

export interface BulkSendRow {
  line: number;
  fullName: string;
  email: string;
  outcome: BulkSendOutcome;
  reason: string | null;
}

export interface BulkSendResult {
  rows: BulkSendRow[];
  totals: { invited: number; invitedWithoutEmail: number; skipped: number; failed: number };
}

export const clientUsersBulkApi = {
  /**
   * Descarga la plantilla y la guarda. `saveAttachmentToDisk` y no un `<a>`
   * suelto: ahí vive el `revokeObjectURL`, y una URL `blob:` que nadie suelta
   * es memoria que no vuelve mientras la pestaña siga abierta.
   */
  downloadTemplate: async (): Promise<void> => {
    const res = await api.get<Blob>('/client-users/carga-masiva/plantilla', {
      responseType: 'blob',
    });
    saveAttachmentToDisk(res.data, 'plantilla-usuarios-portal.xlsx');
  },

  /** Sube el archivo y devuelve qué pasaría. **No manda ningún correo.** */
  review: (clientId: number, file: File): Promise<BulkReviewResult> => {
    const form = new FormData();
    form.append('file', file);
    // El `clientId` va en la query, no en el formulario: así lo valida un
    // `ParseIntPipe` en el servidor y el cuerpo multipart queda solo con el
    // archivo. Ver el comentario de `bulkReview` en el controlador.
    return api
      .post<BulkReviewResult>('/client-users/carga-masiva/revision', form, { params: { clientId } })
      .then((r) => r.data);
  },

  /**
   * Confirma y manda los correos. **Los dos valores van verbatim**, tal como
   * llegaron: no se acompaña de ninguna empresa ni de ninguna lista de filas,
   * porque todo eso va dentro del bloque firmado.
   */
  send: (revision: string, mac: string): Promise<BulkSendResult> =>
    api
      .post<BulkSendResult>('/client-users/carga-masiva/envio', { revision, mac })
      .then((r) => r.data),
};
```

- [ ] **Step 3: El diálogo**

Crea `web/src/pages/client-users/BulkInviteDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';

import {
  clientUsersBulkApi,
  type BulkReviewResult,
  type BulkRowVerdict,
  type BulkSendOutcome,
  type BulkSendResult,
} from '../../api/client-users-bulk.api';
import { Button } from '../../components/ui/Button';
import { toast } from '../../ui/Toast';
import { toErrorList } from './error-list';

interface Props {
  open: boolean;
  /** Cliente elegido en la página; `null` mientras no haya ninguno. */
  clientId: number | null;
  clientName: string;
  onCancel: () => void;
  /**
   * Se llama justo después del envío, con el diálogo todavía abierto: la
   * página refresca el listado en segundo plano mientras el diálogo enseña el
   * informe. No lo cierra — eso lo decide quien lo lee.
   */
  onSent: () => void;
}

const VERDICT_LABEL: Record<BulkRowVerdict, string> = {
  SE_INVITARA: 'Se invitará',
  SE_REINVITARA: 'Enlace nuevo',
  RECHAZADA: 'No se invitará',
};

const VERDICT_CLASS: Record<BulkRowVerdict, string> = {
  SE_INVITARA: 'text-emerald-700',
  SE_REINVITARA: 'text-amber-700',
  RECHAZADA: 'text-red-700',
};

const OUTCOME_LABEL: Record<BulkSendOutcome, string> = {
  INVITADA: 'Invitada',
  INVITADA_SIN_CORREO: 'Invitada, sin correo',
  OMITIDA: 'Omitida',
  FALLO: 'Falló',
};

const OUTCOME_CLASS: Record<BulkSendOutcome, string> = {
  INVITADA: 'text-emerald-700',
  INVITADA_SIN_CORREO: 'text-amber-700',
  OMITIDA: 'text-slate-500',
  FALLO: 'text-red-700',
};

export default function BulkInviteDialog({ open, clientId, clientName, onCancel, onSent }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [review, setReview] = useState<BulkReviewResult | null>(null);
  const [result, setResult] = useState<BulkSendResult | null>(null);
  const [busy, setBusy] = useState(false);
  // Lista y no cadena: un 400 puede traer varios motivos a la vez, igual que
  // en los demás diálogos del panel.
  const [errors, setErrors] = useState<string[]>([]);

  // Se resetea en cada apertura y se mantiene montado para no perder el
  // listener de Escape entre aperturas: mismo patrón que NewClientUserDialog.
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setReview(null);
    setResult(null);
    setBusy(false);
    setErrors([]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const descargar = async () => {
    try {
      await clientUsersBulkApi.downloadTemplate();
    } catch (e) {
      setErrors(toErrorList(e));
    }
  };

  const revisar = async () => {
    if (!file || clientId === null) return;
    setBusy(true);
    setErrors([]);
    setResult(null);
    try {
      setReview(await clientUsersBulkApi.review(clientId, file));
    } catch (e) {
      setReview(null);
      setErrors(toErrorList(e));
    } finally {
      setBusy(false);
    }
  };

  const enviar = async () => {
    if (!review || review.revision === '') return;
    setBusy(true);
    setErrors([]);
    try {
      // Verbatim los dos, tal como llegaron. Reconstruirlos rompería la firma.
      const r = await clientUsersBulkApi.send(review.revision, review.mac);
      setResult(r);
      setReview(null);
      onSent();
      toast.success(`${r.totals.invited} invitaciones enviadas`);
    } catch (e) {
      setErrors(toErrorList(e));
    } finally {
      setBusy(false);
    }
  };

  const puedeEnviar = !!review && review.revision !== '' && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Carga masiva de usuarios</h2>
            <p className="text-sm text-slate-500 mt-1">
              {clientName}. Se crean <strong>invitaciones</strong>, no contraseñas: cada persona
              elige la suya desde el enlace que recibe. La carga no crea administradores; a quien
              deba serlo se le asciende después con «Editar», y solo cuando ya haya aceptado.
            </p>
          </div>

          {errors.length > 0 && (
            <ul className="text-sm text-red-600 bg-red-50 rounded-lg p-3 space-y-1">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}

          {/* Paso 1 y 2: plantilla y archivo. Siguen visibles durante la
              revisión, para poder corregir y volver a subir sin cerrar. */}
          {!result && (
            <div className="space-y-3 border border-slate-200 rounded-lg p-4">
              <Button variant="secondary" size="sm" onClick={descargar}>
                Descargar plantilla
              </Button>
              <input
                type="file"
                className="block w-full text-sm"
                // Sugerencia para el selector de archivos, nada más: quien
                // decide qué es el archivo es el servidor, por sus bytes.
                accept=".xlsx,.csv,.txt"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setReview(null);
                }}
              />
              <Button onClick={revisar} disabled={!file || busy}>
                {busy && !review ? 'Revisando…' : 'Revisar el archivo'}
              </Button>
            </div>
          )}

          {review && (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                Se invitará a <strong>{review.totals.willInvite + review.totals.willReinvite}</strong>{' '}
                {review.totals.rejected > 0 && <>y quedarán fuera <strong>{review.totals.rejected}</strong> </>}
                — todavía no se ha mandado ningún correo. Esta revisión vale hasta las{' '}
                {review.expiresAtLabel}.
              </p>

              {review.totals.willReinvite > 0 && (
                <p className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3">
                  {review.totals.willReinvite} de estas personas ya tienen una invitación pendiente.
                  Recibirán un <strong>enlace nuevo</strong>, y el que ya se les mandó{' '}
                  <strong>dejará de funcionar</strong>.
                </p>
              )}

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-slate-500 uppercase border-b border-slate-100">
                    <th className="py-2 pr-3">Fila</th>
                    <th className="py-2 pr-3">Nombre</th>
                    <th className="py-2 pr-3">Correo</th>
                    <th className="py-2">Qué pasará</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {review.rows.map((f) => (
                    <tr key={f.line}>
                      <td className="py-2 pr-3 text-slate-400">{f.line}</td>
                      <td className="py-2 pr-3">{f.fullName || '—'}</td>
                      <td className="py-2 pr-3 text-slate-600">{f.email || '—'}</td>
                      <td className={`py-2 ${VERDICT_CLASS[f.verdict]}`}>
                        {VERDICT_LABEL[f.verdict]}
                        {f.reason && <span className="block text-xs text-slate-500">{f.reason}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {review.revision === '' && (
                <p className="text-sm text-slate-500">
                  No hay ninguna fila que se pueda invitar. Corrige el archivo y vuelve a subirlo.
                </p>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                Invitadas <strong>{result.totals.invited}</strong>. Sin correo{' '}
                <strong>{result.totals.invitedWithoutEmail}</strong>. Omitidas{' '}
                <strong>{result.totals.skipped}</strong>. Fallidas{' '}
                <strong>{result.totals.failed}</strong>.
              </p>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {result.rows.map((f) => (
                    <tr key={f.line}>
                      <td className="py-2 pr-3 text-slate-400">{f.line}</td>
                      <td className="py-2 pr-3">{f.fullName}</td>
                      <td className="py-2 pr-3 text-slate-600">{f.email}</td>
                      <td className={`py-2 ${OUTCOME_CLASS[f.outcome]}`}>
                        {OUTCOME_LABEL[f.outcome]}
                        {f.reason && <span className="block text-xs text-slate-500">{f.reason}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onCancel}>
              {result ? 'Cerrar' : 'Cancelar'}
            </Button>
            {!result && (
              <Button onClick={enviar} disabled={!puedeEnviar}>
                {busy && review ? 'Enviando…' : 'Enviar las invitaciones'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Enganchar el diálogo en la página**

En `web/src/pages/ClientUsersPage.tsx`, junto al botón «Nuevo usuario»:

```tsx
        <Button
          variant="secondary"
          onClick={() => setBulkOpen(true)}
          disabled={clientId === ''}
          title={clientId === '' ? 'Elige un cliente primero' : undefined}
        >
          Carga masiva
        </Button>
```

Y junto a los otros dos diálogos, al final del componente:

```tsx
      <BulkInviteDialog
        open={bulkOpen}
        clientId={clientId === '' ? null : clientId}
        clientName={selectedClient?.razonSocial ?? ''}
        onCancel={() => setBulkOpen(false)}
        onSent={invalidateUsers}
      />
```

No hace falta ninguna comprobación de rol nueva: la página entera ya está detrás de `canManageUsers(current)` —que es `role === 'ADMIN'`— con su `<Navigate to="/clients" replace />`, y las tres rutas del servidor exigen lo mismo. El guard de pantalla y los del servidor coinciden, y coincidir es lo que se quiere.

Y actualiza el párrafo de cabecera de la página, que hoy dice «El alta la hace siempre el equipo interno; no existe autorregistro» — sigue siendo cierto, pero ya no es toda la verdad:

```tsx
            Cuentas con las que las empresas cliente entran al portal de soporte. El alta la hace
            siempre el equipo interno; no existe autorregistro. Para una empresa nueva, «Carga
            masiva» manda invitaciones desde una hoja de cálculo: nadie teclea la contraseña de
            otro.
```

- [ ] **Step 5: Verificación completa**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: PASS, sin avisos nuevos de tamaño del paquete — la librería de hojas de cálculo vive en el backend, y el navegador no la ve.

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS (no se ha tocado el backend, pero cerrar la última tarea con la suite entera verde es lo que dice el proyecto).

- [ ] **Step 6: Commit**

```bash
git add web/src/api/client-users-bulk.api.ts \
        web/src/pages/client-users/BulkInviteDialog.tsx \
        web/src/pages/ClientUsersPage.tsx
git commit -m "feat(web): carga masiva de usuarios de cliente desde el panel, con revision antes de enviar"
```

---

## Notas para quien ejecute

**Nueve tareas.** Backend las ocho primeras, frontend la novena, en ese orden.

Las cuatro primeras son independientes entre sí salvo por lo que declaran sus **Interfaces**, y se pueden repartir. De la 5 en adelante hay dependencia real: la 6 usa el `invite` con autor de la 5, la 7 usa el `evaluar` de la 6, y la 8 usa las dos.

**Tres cosas que no se pueden negociar sobre la marcha**, porque están decididas y razonadas en el diseño y cambiarlas sin volver a él rompe una propiedad:

1. **La firma se verifica sobre la cadena, antes de decodificar.** Si acabas canonicalizando el objeto para firmarlo, has vuelto al problema que esto existe para cerrar.
2. **`evaluar` es una sola función**, y la usan la revisión y el envío. Dos copias divergirán, y la que se olvide es la que invita a quien la pantalla dijo que no.
3. **Exactamente una columna de autor por invitación.** Ni las dos, ni ninguna, ni un valor inventado para rellenar. Es la decisión 8 de R4 y es la que más veces ha vuelto a morder en este proyecto.

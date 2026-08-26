# Usuarios desde el portal — Plan de implementación

> **Para trabajadores agénticos:** SUB-HABILIDAD REQUERIDA: usa superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans para implementar este plan tarea a tarea. Los pasos usan casillas (`- [ ]`) para poder marcarlos.

**Goal:** Que el administrador de una empresa cliente dé de alta y quite el acceso a su propia gente desde el portal, invitando por correo con un enlace de un solo uso que caduca, sin que nadie teclee una contraseña por otro.

**Architecture:** El secreto de la invitación se genera con `crypto.randomBytes(32)`, viaja solo en el correo, y en la base únicamente vive su huella SHA-256 — la búsqueda al aceptar se hace por huella. Aceptar es una sola transacción (`runInTransaction` + `manager.getRepository`) que crea el usuario y consume la invitación, o no deja nada. La empresa sale siempre de la sesión (al invitar, listar y desactivar) o de la invitación (al aceptar), jamás del cuerpo. El correo se manda en el acto por `EmailService`, no por la cola de `ticket_events`, y la invitación sobrevive al fallo de envío para que el reenvío haga de reintento visible.

**Tech Stack:** NestJS 10 · TypeORM 0.3 (`synchronize: false`) · MySQL 8 · Jest 29 (con `TZ=UTC` forzado desde `jest.config.js`) · bcrypt · nodemailer vía `EmailService` · React 18 + Vite + TypeScript + Tailwind

**Spec:** `docs/superpowers/specs/2026-08-26-usuarios-desde-el-portal-design.md`

## Global Constraints

Todas las tareas de este plan las incluyen implícitamente. Van copiadas al pie de la letra.

- **`synchronize: false`**: todo cambio de esquema es una migración SQL escrita a mano.
- **La migración 026 tiene que ir en las TRES listas de despliegue**: `.github/workflows/deploy.yml`, `docker-compose.yml` y `docker-compose.dev.yml`. Mira cómo están las tres anteriores y sigue el patrón exacto. Olvidarlo rompe el arranque en producción.
- **TypeORM devuelve `bigint` como cadena.** Nunca compares identificadores con `===`; usa `sameId` de `backend/src/common/ids.ts`.
- **Producción corre en UTC y el desarrollo en América/Lima.** Ha habido **seis** fallos de zona horaria en estos proyectos. Toda comparación de caducidad va contra un instante absoluto, nunca contra una fecha civil derivada de la zona del proceso.
- **Transacciones**: `runInTransaction` + `manager.getRepository(...)`, jamás el repositorio inyectado.
- **Proyección campo a campo con lista blanca** al devolver entidades; nunca la entidad cruda.
- **404, no 403**, para recursos de otra empresa.
- **Los mensajes de validación van en español.**
- Al final de cada tarea: `cd backend && npx jest && npx tsc --noEmit`, y si toca frontend `cd web && npx tsc --noEmit && npm run build`.

## Estructura de ficheros

**Backend — se crean:**
- `backend/sql/migrations/026_invitaciones_portal.sql` — la tabla de invitaciones; `client_users.created_by` pasa a nulable y gana hermana de cliente.
- `backend/src/modules/portal/domain/invitation-secret.ts` — secreto, huella y caducidad. **Puro**: sin base, sin red, sin reloj propio (el `now` entra por argumento).
- `backend/src/modules/portal/email-address.ts` — la normalización de correo, en un solo sitio para los dos repositorios que la aplican.
- `backend/src/modules/portal/entities/client-user-invitation.entity.ts`
- `backend/src/modules/portal/client-user-invitations.repository.ts`
- `backend/src/modules/portal/portal-users.service.ts` — listar y desactivar.
- `backend/src/modules/portal/portal-invitations.service.ts` — invitar, reenviar, aceptar.
- `backend/src/modules/portal/invitation-email.ts` — el texto del correo y la URL de aceptación. Puro salvo la lectura de `FRONTEND_URL`.
- `backend/src/modules/portal/portal-users.controller.ts` — `/portal/usuarios`, con sesión y `ClientAdminGuard`.
- `backend/src/modules/portal/portal-invitations.controller.ts` — `/portal/invitaciones`, **público**, con tope de intentos.
- `backend/src/modules/portal/dto/portal-user.dto.ts`
- `backend/src/modules/portal/dto/accept-invitation.dto.ts`
- `backend/src/modules/portal/portal-users.integration.spec.ts`
- Sus ficheros de prueba `.spec.ts` junto a cada uno.

**Backend — se modifican:**
- `backend/src/modules/portal/entities/client-user.entity.ts` — `createdBy` nulable, `createdByClientUserId` nueva.
- `backend/src/modules/portal/client-users.repository.ts` — usa `normalizeEmailAddress` en vez de su copia privada.
- `backend/src/modules/portal/client-users.service.ts` — el alta del panel fija `createdByClientUserId: null` explícitamente.
- `backend/src/modules/portal/guards/client-admin.guard.ts` — el mensaje deja de nombrar solo los requerimientos.
- `backend/src/modules/portal/portal.module.ts`
- `backend/src/config/throttler.config.ts` — `PORTAL_INVITATION_THROTTLE`.
- `backend/src/config/portal-schema.validator.ts` (+ su spec)
- `backend/src/modules/portal/portal-validation.integration.spec.ts` — el mensaje del guard.
- `.github/workflows/deploy.yml`, `docker-compose.yml`, `docker-compose.dev.yml`

**Web — se crean:**
- `web/src/pages/portal/PortalUsersPage.tsx`
- `web/src/pages/portal/InvitePortalUserDialog.tsx`
- `web/src/pages/portal/PortalAcceptInvitationPage.tsx` — **pública**, sin sesión.

**Web — se modifican:**
- `web/src/api/portal.api.ts`, `web/src/api/types.ts`, `web/src/App.tsx`, `web/src/layout/PortalLayout.tsx`

---

### Task 1: Esquema, entidad ablandada y las tres listas de despliegue

**Files:**
- Create: `backend/sql/migrations/026_invitaciones_portal.sql`
- Modify: `backend/src/modules/portal/entities/client-user.entity.ts`
- Modify: `backend/src/modules/portal/client-users.service.ts`
- Modify: `backend/src/config/portal-schema.validator.ts`
- Modify: `.github/workflows/deploy.yml`, `docker-compose.yml`, `docker-compose.dev.yml`
- Test: `backend/src/config/portal-schema.validator.spec.ts`

**Interfaces:**
- Consume: nada (primera tarea).
- Produce:
  - Tabla `client_user_invitations` con las columnas: `id`, `client_id`, `email`, `full_name`, `secret_fingerprint`, `invited_by_client_user_id`, `expires_at`, `used_at`, `accepted_client_user_id`, `revoked_at`, `last_sent_at`, `send_error`, `created_at`.
  - `client_users.created_by BIGINT UNSIGNED NULL` (antes `NOT NULL`) y `client_users.created_by_client_user_id BIGINT UNSIGNED NULL`.
  - En la entidad: `ClientUser.createdBy!: number | null` y `ClientUser.createdByClientUserId!: number | null`.
  - `PortalSchemaValidator.MIGRATION_026 = 'migrations/026_invitaciones_portal.sql'`.

Contexto: **las tres listas de despliegue van escritas a mano y no tienen el mismo formato.** `deploy.yml` es un bucle `for m in …` con nombres sin extensión; `docker-compose.yml` monta cada fichero con su propio nombre; `docker-compose.dev.yml` los monta **renumerados** (`034_mig_025.sql`) y tiene un seed detrás que **también hay que renumerar**. Olvidar cualquiera de las tres deja el backend abortando en el arranque por `PortalSchemaValidator`.

- [ ] **Step 1: Escribir la prueba que falla, en el validador de esquema**

En `backend/src/config/portal-schema.validator.spec.ts`, junto a los bloques `COLUMNAS_021` / `COLUMNA_023` que ya existen:

```ts
/** La tabla que añade la 026: las invitaciones a usuarios de cliente. */
const TABLA_026 = 'client_user_invitations';

/**
 * La columna que añade la 026. `created_by` pasando a nulable NO se comprueba
 * aquí: este validador mira presencia de tablas y columnas en
 * `information_schema`, y "la columna existe pero admite nulo" no es ninguna
 * de las dos cosas. La hermana sí, y como la 026 hace las dos cosas en el
 * mismo fichero, exigir la hermana ya exige haber pasado la migración.
 */
const COLUMNA_026 = { tableName: 'client_users', columnName: 'created_by_client_user_id' };
```

Añade `TABLA_026` a `TABLAS_ESPERADAS` y `COLUMNA_026` a `COLUMNAS_ESPERADAS`, y escribe la prueba de atribución:

```ts
it('atribuye a la 026 la tabla de invitaciones y la autoría de cliente', async () => {
  const validator = new PortalSchemaValidator(
    dataSourceWith(
      TABLAS_ESPERADAS.filter((t) => t !== TABLA_026),
      COLUMNAS_ESPERADAS.filter(
        (c) => !(c.tableName === 'client_users' && c.columnName === 'created_by_client_user_id'),
      ),
    ),
  );

  await expect(validator.onApplicationBootstrap()).rejects.toThrow(
    /026_invitaciones_portal\.sql/,
  );
});
```

- [ ] **Step 2: Correr la prueba y verla fallar**

Run: `cd backend && npx jest src/config/portal-schema.validator.spec.ts`
Expected: FAIL — la prueba nueva no encuentra `026_invitaciones_portal.sql` en el mensaje, y la de «arranca si las tablas y todas las columnas esperadas estan» también falla, porque el catálogo ahora incluye una tabla y una columna que el validador todavía no exige.

- [ ] **Step 3: Escribir la migración 026**

Crea `backend/sql/migrations/026_invitaciones_portal.sql`. Sigue el patrón idempotente de la 024: procedimiento guardado que consulta `information_schema`, se crea, se usa y se tira en el mismo fichero.

```sql
-- =========================================================================
--  Migración 026 — Invitaciones a usuarios del portal
-- =========================================================================
--  El administrador de una empresa cliente da de alta a su gente sin que
--  nadie teclee una contraseña por otro: se manda una invitación y la
--  persona elige la suya.
--
--  EN LA BASE SOLO VIVE LA HUELLA DEL SECRETO. Un enlace cifrado se podría
--  descifrar con la clave de la aplicación; una huella no se deshace. Quien
--  lea la base -un respaldo filtrado, una consulta de más- no obtiene
--  ningún enlace utilizable. Por eso la columna se llama
--  `secret_fingerprint` y no `token`: el nombre tiene que delatar a quien
--  intente guardar ahí el valor en claro.
--
--  `created_by` PASA A ADMITIR VACÍO Y NO SE PIERDE NADA. Hoy es
--  `NOT NULL` y apunta a `users` (el personal de la casa). Cuando quien da
--  el alta es un administrador de cliente no hay ningún miembro del
--  personal a quien apuntar, y rellenarlo con "el primer administrador que
--  haya" sería decidir por la ausencia de un valor en vez de por el hecho
--  que lo determina -el defecto recurrente de este proyecto-. El MODIFY
--  solo relaja la nulabilidad: las filas existentes conservan su valor.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- -------------------------------------------------------------------------
-- 1) Las invitaciones
-- -------------------------------------------------------------------------
--  `secret_fingerprint` es un SHA-256 en hexadecimal: 64 caracteres, todos
--  [0-9a-f]. `CHARACTER SET ascii` porque nunca puede ser otra cosa, y así
--  la clave única pesa 64 bytes en vez de 256.
--
--  LA CLAVE ÚNICA SOBRE LA HUELLA ES LA QUE SOSTIENE LA BÚSQUEDA AL
--  ACEPTAR: se busca por huella, jamás por el secreto, y una huella
--  repetida no puede existir.
--
--  `used_at` y `revoked_at` son dos hechos distintos y por eso son dos
--  columnas: "alguien la usó" y "se reemplazó por otra". Un solo `estado`
--  obligaría a inventar un valor para el caso en que las dos fueran
--  ciertas.
--
--  `send_error` guarda por qué falló el correo, si falló. La invitación
--  queda creada igual (no hay cola ni reintento automático: el reenvío es
--  el reintento, y es visible), y esta columna es lo que permite explicar
--  en la pantalla por qué sigue pendiente.
CREATE TABLE IF NOT EXISTS client_user_invitations (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id                 BIGINT UNSIGNED NOT NULL COMMENT 'la empresa, tomada de la sesion de quien invita',
  email                     VARCHAR(180)    NOT NULL COMMENT 'ya normalizado: minusculas, recortado, dominio codificado',
  full_name                 VARCHAR(180)    NOT NULL,
  secret_fingerprint        CHAR(64) CHARACTER SET ascii NOT NULL
                            COMMENT 'SHA-256 hex del secreto; el secreto EN CLARO NO SE GUARDA NUNCA',
  invited_by_client_user_id BIGINT UNSIGNED NOT NULL COMMENT 'el administrador de cliente que invito',
  expires_at                DATETIME        NOT NULL COMMENT 'instante absoluto UTC; se compara contra el reloj, nunca contra una fecha civil',
  used_at                   DATETIME        NULL     COMMENT 'NULL = sin usar; se marca en la misma transaccion que crea el usuario',
  accepted_client_user_id   BIGINT UNSIGNED NULL     COMMENT 'el usuario que salio de aceptarla',
  revoked_at                DATETIME        NULL     COMMENT 'NULL = viva; se marca al reemplazarla por otra invitacion al mismo correo',
  last_sent_at              DATETIME        NULL     COMMENT 'ultimo intento de envio; NULL = nunca se llego a intentar',
  send_error                VARCHAR(500)    NULL     COMMENT 'por que fallo el ultimo envio; NULL = fue bien o no hubo',
  created_at                DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_cui_fingerprint (secret_fingerprint),
  KEY idx_cui_client_pendientes (client_id, used_at, revoked_at),
  KEY idx_cui_email_vivas (email, used_at, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 2) La autoría honesta en client_users
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_column_026;
DELIMITER //
CREATE PROCEDURE kubo_add_column_026(
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

CALL kubo_add_column_026('client_users', 'created_by_client_user_id',
  'created_by_client_user_id BIGINT UNSIGNED NULL '
  "COMMENT 'el administrador de cliente que invito; NULL si el alta la hizo el personal' "
  'AFTER created_by');

DROP PROCEDURE IF EXISTS kubo_add_column_026;

-- -------------------------------------------------------------------------
-- 3) `created_by` deja de ser obligatorio
-- -------------------------------------------------------------------------
--  Guardado por IS_NULLABLE y no por presencia de columna: la columna ya
--  existe desde la 013, así que el ayudante de arriba no serviría. Mismo
--  criterio que la sección 2.0b de la 021, que corrige una nulabilidad con
--  esta misma consulta.
--
--  Un `MODIFY` sobre una columna que ya admite nulo no daría error, pero
--  reescribiría la tabla entera en cada pasada. `client_users` tiene filas
--  reales; la guarda no es cosmética.
DROP PROCEDURE IF EXISTS kubo_relax_column_026;
DELIMITER //
CREATE PROCEDURE kubo_relax_column_026()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'kubo_devdocs'
      AND TABLE_NAME = 'client_users' AND COLUMN_NAME = 'created_by'
      AND IS_NULLABLE = 'NO'
  ) THEN
    ALTER TABLE client_users
      MODIFY COLUMN created_by BIGINT UNSIGNED NULL
      COMMENT 'quien del equipo lo dio de alta; NULL si lo invito un administrador de cliente';
  END IF;
END //
DELIMITER ;

CALL kubo_relax_column_026();

DROP PROCEDURE IF EXISTS kubo_relax_column_026;
```

- [ ] **Step 4: Añadir la 026 al validador de esquema**

En `backend/src/config/portal-schema.validator.ts`, junto a las demás constantes de migración:

```ts
  private static readonly MIGRATION_026 = 'migrations/026_invitaciones_portal.sql';
```

En `REQUIRED_TABLES`, detrás de `ticket_attachments`:

```ts
    // 026: las invitaciones del portal. `ClientUserInvitation` la declara como
    // entidad, así que sin ella TypeORM revienta en cuanto un administrador de
    // cliente abre la pantalla de su gente — y el alta desde el portal deja de
    // existir sin que nadie sepa por qué.
    { table: 'client_user_invitations', files: [PortalSchemaValidator.MIGRATION_026] },
```

En `REQUIRED_COLUMNS`, detrás de la entrada de `workspace_settings.imap_enabled`:

```ts
    // 026: la autoría honesta. `client-user.entity.ts` ya declara esta columna,
    // así que TypeORM la emite en TODO SELECT e INSERT sobre `client_users`:
    // sin ella el login del portal responde 500 (ER_BAD_FIELD_ERROR), no solo
    // el alta nueva.
    //
    // `created_by` pasando a nulable no se exige aquí: este validador mira
    // presencia, no nulabilidad. Va en el mismo fichero que esta columna, así
    // que exigir la columna ya exige haber pasado la migración entera.
    {
      table: 'client_users',
      column: 'created_by_client_user_id',
      files: [PortalSchemaValidator.MIGRATION_026],
    },
```

- [ ] **Step 5: Correr la prueba y verla pasar**

Run: `cd backend && npx jest src/config/portal-schema.validator.spec.ts`
Expected: PASS

- [ ] **Step 6: Ablandar la entidad y ponerle la hermana**

En `backend/src/modules/portal/entities/client-user.entity.ts`, sustituye el bloque de `createdBy`:

```ts
  /**
   * Quién del equipo lo dio de alta. **Nulable desde la 026**: cuando quien
   * invita es un administrador de cliente no hay ningún miembro del personal
   * a quien apuntar, y rellenarlo con uno inventado es exactamente el defecto
   * recurrente de este proyecto —decidir por la ausencia de un valor en vez
   * de por el hecho que lo determina—. Un vacío honesto es mejor que un
   * `created_by` que atribuye el alta a alguien que no hizo nada.
   */
  @Column({ name: 'created_by', type: 'bigint', unsigned: true, nullable: true })
  createdBy!: number | null;

  /**
   * El administrador de cliente que invitó, cuando el alta vino del portal.
   * Columna aparte y no un `created_by` polimórfico: `users` y `client_users`
   * son tablas distintas a propósito (ver la 013) y un mismo entero no puede
   * significar una fila de una o de otra según el viento.
   *
   * Las dos a la vez, nunca: o lo dio de alta el personal, o lo invitó un
   * administrador de cliente.
   */
  @Column({ name: 'created_by_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  createdByClientUserId!: number | null;
```

- [ ] **Step 7: Que el alta del panel siga diciendo la verdad**

En `backend/src/modules/portal/client-users.service.ts`, dentro del objeto que `create` le pasa a `this.repo.create({ … })`:

```ts
        createdBy: staffUserId,
        // Explícito, no por omisión: este alta la hace el personal, así que la
        // columna del administrador de cliente tiene que quedar vacía y tiene
        // que verse que se quiere vacía.
        createdByClientUserId: null,
```

- [ ] **Step 8: Añadir la 026 a `.github/workflows/deploy.yml`**

En el bucle `for m in …` (sobre la línea 178), detrás de `025_normalizar_email_existente`:

```yaml
                     024_correo_entrante_identificador_servidor \
                     025_normalizar_email_existente \
                     026_invitaciones_portal; do
```

**No toques ningún otro paso del fichero**: despliega contra un servidor de producción vivo. Las comprobaciones de más abajo no cambian: la 026 no siembra ninguna plantilla, así que el contador `PLANTILLAS` sigue siendo 9.

- [ ] **Step 9: Añadir la 026 a `docker-compose.yml`**

Detrás del montaje de la 025, con su comentario como el de los vecinos:

```yaml
      # La 026 anade las invitaciones del portal (client_user_invitations) y
      # ablanda client_users.created_by a nulable, con su columna hermana para
      # el administrador de cliente que invito. Ninguna de las dos cosas pierde
      # informacion: el MODIFY solo relaja la nulabilidad.
      - ./backend/sql/migrations/026_invitaciones_portal.sql:/docker-entrypoint-initdb.d/026_invitaciones_portal.sql:ro
```

- [ ] **Step 10: Añadir la 026 a `docker-compose.dev.yml` y renumerar el seed**

Aquí los ficheros van **renumerados** con el prefijo de orden de `docker-entrypoint-initdb.d`, y el seed va detrás de todas las migraciones. Entran dos cambios, no uno:

```yaml
      - ./backend/sql/migrations/025_normalizar_email_existente.sql:/docker-entrypoint-initdb.d/034_mig_025.sql:ro
      - ./backend/sql/migrations/026_invitaciones_portal.sql:/docker-entrypoint-initdb.d/035_mig_026.sql:ro
      # Seeds — van detrás de todas las migraciones, así que el seed se
      # renumera cada vez que entra una migración nueva.
      - ./backend/sql/seed_document_templates.sql:/docker-entrypoint-initdb.d/036_seed_templates.sql:ro
```

Si el seed se queda en `035_…` mientras la migración nueva también es `035_…`, el orden pasa a depender del nombre del fichero: justo el fallo silencioso del que avisa el comentario que ya está ahí.

- [ ] **Step 11: Correr la suite entera y el compilador**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS. Si `client-users.service.spec.ts` falla porque el objeto que recibe el repositorio ahora lleva `createdByClientUserId: null`, actualiza la expectativa: es un cambio deliberado de contrato, no un fallo.

- [ ] **Step 12: Commit**

```bash
git add backend/sql/migrations/026_invitaciones_portal.sql \
        backend/src/config/portal-schema.validator.ts \
        backend/src/config/portal-schema.validator.spec.ts \
        backend/src/modules/portal/entities/client-user.entity.ts \
        backend/src/modules/portal/client-users.service.ts \
        backend/src/modules/portal/client-users.service.spec.ts \
        .github/workflows/deploy.yml docker-compose.yml docker-compose.dev.yml
git commit -m "feat(portal): esquema de invitaciones y autoria honesta en client_users"
```

---

### Task 2: El secreto de la invitación — dominio puro

**Files:**
- Create: `backend/src/modules/portal/domain/invitation-secret.ts`
- Create: `backend/src/modules/portal/domain/invitation-secret.spec.ts`

**Interfaces:**
- Consume: nada del plan (solo `crypto` de Node).
- Produce, todo desde `backend/src/modules/portal/domain/invitation-secret.ts`:
  - `INVITATION_SECRET_BYTES: 32`
  - `INVITATION_TTL_DAYS: 7`
  - `generateInvitationSecret(): string` — 32 bytes de `randomBytes` en base64url; 43 caracteres, sin `+`, `/` ni `=`.
  - `fingerprintInvitationSecret(secret: string): string` — SHA-256 en hexadecimal, 64 caracteres.
  - `invitationExpiryFrom(now: Date): Date`
  - `isInvitationExpired(expiresAt: Date | string, now: Date): boolean`

Este módulo es **puro**: no consulta la base, no manda nada y **no lee el reloj por su cuenta** — el `now` entra siempre por argumento. Misma disciplina que `inbound-email/domain/*`. Que no lea el reloj es lo que hace que la caducidad se pueda probar sin esperar siete días y sin depender de la zona del proceso.

- [ ] **Step 1: Escribir las pruebas que fallan**

`backend/src/modules/portal/domain/invitation-secret.spec.ts`:

```ts
import {
  INVITATION_SECRET_BYTES,
  INVITATION_TTL_DAYS,
  fingerprintInvitationSecret,
  generateInvitationSecret,
  invitationExpiryFrom,
  isInvitationExpired,
} from './invitation-secret';

describe('el secreto de la invitación', () => {
  it('son 32 bytes aleatorios codificados para viajar en una URL', () => {
    expect(INVITATION_SECRET_BYTES).toBe(32);
    const secreto = generateInvitationSecret();
    // base64url de 32 bytes: 43 caracteres, y ninguno de los tres que
    // obligarían a escapar el enlace (`+`, `/`, `=`).
    expect(secreto).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('no es adivinable: mil secretos seguidos son mil valores distintos', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 1000; i += 1) vistos.add(generateInvitationSecret());
    expect(vistos.size).toBe(1000);
  });

  /**
   * La prueba que de verdad importa de este bloque. Un identificador
   * secuencial, una marca de tiempo o un id con formato adivinable dan
   * secretos con prefijos comunes; 32 bytes de fuente criptográfica, no.
   */
  it('dos secretos consecutivos no comparten ni el primer carácter de forma sistemática', () => {
    const primeros = new Set<string>();
    for (let i = 0; i < 200; i += 1) primeros.add(generateInvitationSecret()[0]);
    expect(primeros.size).toBeGreaterThan(10);
  });
});

describe('la huella', () => {
  it('es un SHA-256 en hexadecimal: 64 caracteres, todo [0-9a-f]', () => {
    expect(fingerprintInvitationSecret('lo-que-sea')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('es determinista: el mismo secreto da siempre la misma huella', () => {
    const secreto = generateInvitationSecret();
    expect(fingerprintInvitationSecret(secreto)).toBe(fingerprintInvitationSecret(secreto));
  });

  it('no contiene el secreto: es lo único que permite guardarla sin guardarlo', () => {
    const secreto = generateInvitationSecret();
    const huella = fingerprintInvitationSecret(secreto);
    expect(huella).not.toContain(secreto);
    expect(huella).not.toBe(secreto);
  });

  it('secretos distintos dan huellas distintas', () => {
    expect(fingerprintInvitationSecret('a')).not.toBe(fingerprintInvitationSecret('b'));
  });
});

describe('la caducidad', () => {
  it('son 7 días exactos contados en milisegundos desde el instante dado', () => {
    expect(INVITATION_TTL_DAYS).toBe(7);
    const ahora = new Date('2026-08-26T15:00:00.000Z');
    expect(invitationExpiryFrom(ahora).toISOString()).toBe('2026-09-02T15:00:00.000Z');
  });

  /**
   * El fallo que ya ha mordido seis veces en estos proyectos. Producción corre
   * en UTC y el host de desarrollo en América/Lima (UTC-5). Una caducidad
   * calculada con `setDate`/`getFullYear` -que leen la zona del proceso- cae en
   * un instante distinto según dónde corra, y encima cruza el cambio de día
   * justo en el tramo horario en que más se usa el portal.
   *
   * Se comprueba con un instante que en Lima es el día ANTERIOR: si el cálculo
   * pasara por una fecha civil, el resultado saldría desplazado.
   */
  it('se calcula sobre el instante absoluto, no sobre la fecha civil del proceso', () => {
    // 02:30 UTC del 27 = 21:30 del 26 en Lima. Dos días civiles distintos.
    const ahora = new Date('2026-08-27T02:30:00.000Z');
    expect(invitationExpiryFrom(ahora).getTime()).toBe(
      ahora.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
  });

  it('una invitación cuyo instante de caducidad ya pasó está caducada', () => {
    const ahora = new Date('2026-08-26T15:00:00.000Z');
    expect(isInvitationExpired(new Date('2026-08-26T14:59:59.999Z'), ahora)).toBe(true);
  });

  it('el instante exacto de caducidad ya no sirve', () => {
    const ahora = new Date('2026-08-26T15:00:00.000Z');
    expect(isInvitationExpired(new Date('2026-08-26T15:00:00.000Z'), ahora)).toBe(true);
  });

  it('una invitación con caducidad futura no está caducada', () => {
    const ahora = new Date('2026-08-26T15:00:00.000Z');
    expect(isInvitationExpired(new Date('2026-08-26T15:00:00.001Z'), ahora)).toBe(false);
  });

  /**
   * TypeORM hidrata `DATETIME` como `Date`, pero un driver o un doble de
   * prueba puede devolver la cadena. Se admiten las dos formas, y las dos
   * tienen que dar el mismo veredicto.
   */
  it('acepta la caducidad como cadena y decide igual que con un Date', () => {
    const ahora = new Date('2026-08-26T15:00:00.000Z');
    expect(isInvitationExpired('2026-08-26T14:00:00.000Z', ahora)).toBe(true);
    expect(isInvitationExpired('2026-08-27T14:00:00.000Z', ahora)).toBe(false);
  });

  /**
   * Fallo cerrado. Una caducidad que no se puede interpretar NO puede
   * significar "todavía sirve": eso es decidir por la ausencia de un valor en
   * vez de por el hecho que lo determina, el defecto recurrente del proyecto.
   */
  it.each([['', 'cadena vacía'], ['no-es-una-fecha', 'basura']])(
    'una caducidad ilegible (%s, %s) se trata como caducada',
    (valor) => {
      expect(isInvitationExpired(valor, new Date('2026-08-26T15:00:00.000Z'))).toBe(true);
    },
  );
});
```

- [ ] **Step 2: Correr las pruebas y verlas fallar**

Run: `cd backend && npx jest src/modules/portal/domain/invitation-secret.spec.ts`
Expected: FAIL con «Cannot find module './invitation-secret'».

- [ ] **Step 3: Escribir el módulo**

`backend/src/modules/portal/domain/invitation-secret.ts`:

```ts
import { createHash, randomBytes } from 'crypto';

/**
 * El secreto de una invitación al portal, su huella y su caducidad.
 *
 * Dominio puro: no consulta la base, no manda correo y **no lee el reloj**.
 * El instante actual entra siempre por argumento, igual que los conteos en
 * `inbound-email/domain/throttle.ts`. Que no lea el reloj es lo que permite
 * probar la caducidad sin esperar siete días y, sobre todo, sin que el
 * resultado dependa de la zona del proceso: producción corre en UTC y el host
 * de desarrollo en América/Lima.
 */

/**
 * 32 bytes de fuente criptográfica. No un identificador secuencial, no una
 * marca de tiempo, no un identificador con formato adivinable: este valor es
 * lo único que separa a un desconocido de una credencial válida.
 */
export const INVITATION_SECRET_BYTES = 32;

/** Días que vive una invitación. */
export const INVITATION_TTL_DAYS = 7;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Un secreto nuevo, codificado para viajar dentro de una dirección web.
 *
 * `base64url` y no `hex`: mismos 32 bytes de entropía en 43 caracteres en vez
 * de 64, y sin ninguno de los tres caracteres (`+`, `/`, `=`) que obligarían a
 * escapar el enlace —un enlace que además va a pasar por clientes de correo
 * que reescriben URLs.
 */
export function generateInvitationSecret(): string {
  return randomBytes(INVITATION_SECRET_BYTES).toString('base64url');
}

/**
 * La huella del secreto: lo ÚNICO que se guarda en la base.
 *
 * SHA-256 a secas y no bcrypt, a diferencia de una contraseña. La razón no es
 * la comodidad: bcrypt existe para encarecer el ataque por diccionario contra
 * un valor que una persona eligió y que por tanto tiene poca entropía. Aquí el
 * valor son 256 bits de `randomBytes` —no hay diccionario que probar— y en
 * cambio sí hace falta poder BUSCAR por la huella con un índice único, cosa
 * que un hash con sal distinta por fila impide por construcción.
 *
 * Lo que sí comparte con bcrypt es lo que importa: no se puede deshacer. Quien
 * lea la base no obtiene ningún enlace utilizable.
 */
export function fingerprintInvitationSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** El instante en que caduca una invitación creada en `now`. */
export function invitationExpiryFrom(now: Date): Date {
  // Aritmética sobre milisegundos absolutos, nunca `setDate`/`getFullYear`:
  // esos leen la zona horaria del proceso y darían un instante distinto en
  // producción (UTC) y en el host de desarrollo (América/Lima).
  return new Date(now.getTime() + INVITATION_TTL_DAYS * MS_POR_DIA);
}

/**
 * Si esa invitación ya caducó, comparando dos instantes absolutos.
 *
 * El instante exacto de caducidad cuenta como caducado (`<=`): en la frontera,
 * la respuesta que no da acceso es la correcta.
 *
 * Una caducidad ilegible —cadena vacía, basura, `Invalid Date`— se trata como
 * CADUCADA. Fallo cerrado: una caducidad que no se puede interpretar no puede
 * significar «todavía sirve», que es justo la dirección en la que un `NaN`
 * cedería si se comparara sin guarda (`NaN <= x` es siempre `false`, o sea,
 * «no ha caducado»).
 */
export function isInvitationExpired(expiresAt: Date | string, now: Date): boolean {
  const instante = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (!Number.isFinite(instante)) return true;
  return instante <= now.getTime();
}
```

- [ ] **Step 4: Correr las pruebas y verlas pasar**

Run: `cd backend && npx jest src/modules/portal/domain/invitation-secret.spec.ts`
Expected: PASS (14 pruebas)

- [ ] **Step 5: Suite completa y compilador**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/portal/domain/invitation-secret.ts \
        backend/src/modules/portal/domain/invitation-secret.spec.ts
git commit -m "feat(portal): secreto, huella y caducidad de la invitacion como dominio puro"
```

---

### Task 3: Entidad y repositorio de invitaciones — el secreto no toca la base

**Files:**
- Create: `backend/src/modules/portal/email-address.ts`
- Create: `backend/src/modules/portal/entities/client-user-invitation.entity.ts`
- Create: `backend/src/modules/portal/client-user-invitations.repository.ts`
- Create: `backend/src/modules/portal/client-user-invitations.repository.spec.ts`
- Modify: `backend/src/modules/portal/client-users.repository.ts`
- Modify: `backend/src/modules/portal/portal.module.ts`

**Interfaces:**
- Consume, de la Task 2: `fingerprintInvitationSecret(secret: string): string` de `./domain/invitation-secret`.
- Produce:
  - `normalizeEmailAddress(email: string): string` desde `backend/src/modules/portal/email-address.ts`.
  - Entidad `ClientUserInvitation` (tabla `client_user_invitations`) con: `id: number`, `clientId: number`, `email: string`, `fullName: string`, `secretFingerprint: string`, `invitedByClientUserId: number`, `expiresAt: Date`, `usedAt: Date | null`, `acceptedClientUserId: number | null`, `revokedAt: Date | null`, `lastSentAt: Date | null`, `sendError: string | null`, `createdAt: Date`.
  - `ClientUserInvitationsRepository`, con:
    - `runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T>`
    - `create(data: NewInvitation): Promise<ClientUserInvitation>` donde `NewInvitation = { clientId: number; email: string; fullName: string; secretFingerprint: string; invitedByClientUserId: number; expiresAt: Date }`
    - `findLiveByEmail(email: string, now: Date): Promise<ClientUserInvitation | null>`
    - `listPendingByClient(clientId: number, now: Date): Promise<ClientUserInvitation[]>`
    - `findPendingByIdForClient(id: number, clientId: number): Promise<ClientUserInvitation | null>`
    - `revokeLiveByEmail(email: string, clientId: number, revokedAt: Date): Promise<void>`
    - `markSent(id: number, sentAt: Date, sendError: string | null): Promise<void>`

`normalizeEmailAddress` sale de `client-users.repository.ts`, donde hoy vive como función privada `normalizeEmail`. Se mueve porque a partir de aquí **dos** repositorios normalizan correos, y dos copias de la normalización son dos reglas de identidad distintas: la que alguien olvide actualizar es la que deja entrar un duplicado con mayúsculas. Es el mismo argumento que el docblock de `sameId` en `common/ids.ts` hace para la comparación de identificadores.

- [ ] **Step 1: Escribir las pruebas que fallan**

`backend/src/modules/portal/client-user-invitations.repository.spec.ts`:

```ts
import { EntityManager, Repository } from 'typeorm';

import { ClientUserInvitationsRepository } from './client-user-invitations.repository';
import { ClientUserInvitation } from './entities/client-user-invitation.entity';
import { fingerprintInvitationSecret, generateInvitationSecret } from './domain/invitation-secret';

/**
 * Doble del `Repository` de TypeORM que GUARDA lo que le mandan escribir, para
 * poder inspeccionarlo después. Es la única forma de comprobar la promesa
 * central de esta funcionalidad —que el secreto en claro no llega a la base—
 * sin levantar MySQL.
 */
function repoDoble() {
  const guardado: Array<Partial<ClientUserInvitation>> = [];
  const actualizado: Array<[unknown, Partial<ClientUserInvitation>]> = [];
  const repo = {
    guardado,
    actualizado,
    create: jest.fn((d: Partial<ClientUserInvitation>) => d),
    save: jest.fn(async (d: Partial<ClientUserInvitation>) => {
      guardado.push(d);
      return { id: 1, ...d } as ClientUserInvitation;
    }),
    update: jest.fn(async (where: unknown, patch: Partial<ClientUserInvitation>) => {
      actualizado.push([where, patch]);
      return { affected: 1 };
    }),
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
  };
  return repo;
}

function makeRepo() {
  const orm = repoDoble();
  const repo = new ClientUserInvitationsRepository(
    orm as unknown as Repository<ClientUserInvitation>,
    { transaction: jest.fn() } as any,
  );
  return { repo, orm };
}

describe('ClientUserInvitationsRepository', () => {
  /**
   * LA PRUEBA QUE SOSTIENE LA DECISIÓN 3 DE LA SPEC. No es un comentario que
   * promete que el secreto no se guarda: es la comprobación de que ningún
   * campo de la fila que se escribe contiene el secreto en claro, ni entero ni
   * como subcadena, ni en la clave ni en el valor.
   */
  it('el secreto en claro no aparece por ningún lado en la fila que se escribe', async () => {
    const { repo, orm } = makeRepo();
    const secreto = generateInvitationSecret();

    await repo.create({
      clientId: 7,
      email: 'Ana@Kuboti.com ',
      fullName: 'Ana',
      secretFingerprint: fingerprintInvitationSecret(secreto),
      invitedByClientUserId: 3,
      expiresAt: new Date('2026-09-02T15:00:00.000Z'),
    });

    expect(orm.guardado).toHaveLength(1);
    expect(JSON.stringify(orm.guardado[0])).not.toContain(secreto);
  });

  it('guarda la huella, y la huella es la del secreto', async () => {
    const { repo, orm } = makeRepo();
    const secreto = generateInvitationSecret();

    await repo.create({
      clientId: 7,
      email: 'ana@kuboti.com',
      fullName: 'Ana',
      secretFingerprint: fingerprintInvitationSecret(secreto),
      invitedByClientUserId: 3,
      expiresAt: new Date('2026-09-02T15:00:00.000Z'),
    });

    expect(orm.guardado[0].secretFingerprint).toBe(fingerprintInvitationSecret(secreto));
  });

  /**
   * La misma normalización, en el mismo orden, en los dos lados de cualquier
   * comparación por correo: si al escribir se guardara `Ana@Kuboti.com` y al
   * buscar se buscara `ana@kuboti.com`, la invitación existiría y nadie la
   * encontraría nunca.
   */
  it('normaliza el correo al escribir: minúsculas y recortado', async () => {
    const { repo, orm } = makeRepo();
    await repo.create({
      clientId: 7,
      email: '  Ana@Kuboti.COM ',
      fullName: 'Ana',
      secretFingerprint: 'f'.repeat(64),
      invitedByClientUserId: 3,
      expiresAt: new Date('2026-09-02T15:00:00.000Z'),
    });
    expect(orm.guardado[0].email).toBe('ana@kuboti.com');
  });

  it('normaliza el correo también al buscar una invitación viva', async () => {
    const { repo, orm } = makeRepo();
    await repo.findLiveByEmail('  Ana@Kuboti.COM ', new Date('2026-08-26T15:00:00.000Z'));
    expect(orm.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ email: 'ana@kuboti.com' }) }),
    );
  });

  /**
   * `revokeLiveByEmail` acota por empresa además de por correo. Sin el
   * `clientId` en el WHERE, invitar desde la empresa B a una dirección que la
   * empresa A tiene pendiente le anularía la invitación a A — un efecto
   * cruzado entre empresas por la puerta de atrás.
   */
  it('revocar invitaciones vivas va acotado a la empresa que pide, no solo al correo', async () => {
    const { repo, orm } = makeRepo();
    await repo.revokeLiveByEmail('Ana@Kuboti.com', 7, new Date('2026-08-26T15:00:00.000Z'));
    const [where] = orm.actualizado[0];
    expect(where).toEqual(
      expect.objectContaining({ email: 'ana@kuboti.com', clientId: 7 }),
    );
  });

  it('marcar el envío guarda el instante y el error, sin tocar nada más', async () => {
    const { repo, orm } = makeRepo();
    const cuando = new Date('2026-08-26T15:00:00.000Z');
    await repo.markSent(9, cuando, 'SMTP dijo que no');
    expect(orm.actualizado[0]).toEqual([9, { lastSentAt: cuando, sendError: 'SMTP dijo que no' }]);
  });

  it('un envío correcto borra el error anterior en vez de dejarlo colgando', async () => {
    const { repo, orm } = makeRepo();
    const cuando = new Date('2026-08-26T15:00:00.000Z');
    await repo.markSent(9, cuando, null);
    expect(orm.actualizado[0]).toEqual([9, { lastSentAt: cuando, sendError: null }]);
  });
});
```

- [ ] **Step 2: Correr las pruebas y verlas fallar**

Run: `cd backend && npx jest src/modules/portal/client-user-invitations.repository.spec.ts`
Expected: FAIL con «Cannot find module './client-user-invitations.repository'».

- [ ] **Step 3: Sacar la normalización a su propio fichero**

Crea `backend/src/modules/portal/email-address.ts`:

```ts
import { withEncodedDomain } from '../inbound-email/domain/message-headers';

/**
 * Recorta, pone en minúsculas y codifica el dominio de un correo.
 *
 * **La misma normalización, en el mismo orden, en los dos lados de cualquier
 * comparación por correo.** Vivía dentro de `client-users.repository.ts` como
 * función privada, y salió aquí cuando un segundo repositorio
 * (`client-user-invitations.repository.ts`) pasó a normalizar también: dos
 * copias serían dos reglas de identidad distintas, y la que alguien olvide
 * actualizar es la que deja entrar un duplicado con mayúsculas o un dominio
 * internacionalizado sin codificar. Mismo argumento que hace `sameId` en
 * `common/ids.ts` para la comparación de identificadores.
 *
 * El porqué de `withEncodedDomain` está entero en el docblock que dejó
 * `client-users.repository.ts`: un cliente dado de alta con `ana@пример.com`
 * nunca coincidía con el `ana@xn--e1afmkfd.com` que escribe cualquier MTA.
 */
export function normalizeEmailAddress(email: string): string {
  return withEncodedDomain(email.trim().toLowerCase());
}
```

En `backend/src/modules/portal/client-users.repository.ts`, sustituye la función privada `normalizeEmail` y sus dos usos sueltos por la importada, dejando el docblock largo que ya existe como referencia:

```ts
import { normalizeEmailAddress } from './email-address';

// … el docblock largo de por qué se normaliza se queda donde está, apuntando
// ahora a `email-address.ts`, que es donde vive la implementación única.
function normalizeEmail(data: Partial<ClientUser>): Partial<ClientUser> {
  if (data.email === undefined) return data;
  return { ...data, email: normalizeEmailAddress(data.email) };
}
```

y en `findByEmail`:

```ts
  findByEmail(email: string): Promise<ClientUser | null> {
    return this.repo.findOne({ where: { email: normalizeEmailAddress(email) } });
  }
```

- [ ] **Step 4: Escribir la entidad**

`backend/src/modules/portal/entities/client-user-invitation.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Una invitación para que alguien se dé de alta como usuario de una empresa
 * cliente.
 *
 * **Aquí NO está el secreto.** Solo su huella (`secretFingerprint`). La
 * columna se llama así, y no `token`, para que el nombre delate a quien
 * intente escribir en ella el valor en claro. El secreto solo existe en dos
 * sitios: en memoria durante la petición que lo crea, y en el correo que sale.
 */
@Entity('client_user_invitations')
@Index('idx_cui_client_pendientes', ['clientId', 'usedAt', 'revokedAt'])
@Index('idx_cui_email_vivas', ['email', 'usedAt', 'revokedAt'])
export class ClientUserInvitation {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  /** La empresa. Sale de la sesión de quien invita, jamás del cuerpo. */
  @Column({ name: 'client_id', type: 'bigint', unsigned: true })
  clientId!: number;

  /** Ya normalizado por `normalizeEmailAddress` al escribir. */
  @Column({ type: 'varchar', length: 180 })
  email!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 180 })
  fullName!: string;

  /** SHA-256 hexadecimal del secreto. Ver `domain/invitation-secret.ts`. */
  @Column({ name: 'secret_fingerprint', type: 'varchar', length: 64 })
  secretFingerprint!: string;

  @Column({ name: 'invited_by_client_user_id', type: 'bigint', unsigned: true })
  invitedByClientUserId!: number;

  /**
   * Instante absoluto. Se compara con `isInvitationExpired` contra el reloj,
   * nunca contra una fecha civil derivada de la zona del proceso.
   */
  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt!: Date;

  /** `null` = sin usar. Se marca dentro de la transacción que crea el usuario. */
  @Column({ name: 'used_at', type: 'datetime', nullable: true })
  usedAt!: Date | null;

  @Column({ name: 'accepted_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  acceptedClientUserId!: number | null;

  /**
   * `null` = viva. Se marca al reemplazarla por otra invitación al mismo
   * correo. Es un hecho DISTINTO de `usedAt` y por eso es otra columna: «se
   * reemplazó» y «alguien la usó» no son lo mismo, y un único campo `estado`
   * obligaría a inventar un valor para cuando las dos fueran ciertas.
   */
  @Column({ name: 'revoked_at', type: 'datetime', nullable: true })
  revokedAt!: Date | null;

  /** Último intento de envío. `null` = nunca se llegó a intentar. */
  @Column({ name: 'last_sent_at', type: 'datetime', nullable: true })
  lastSentAt!: Date | null;

  /** Por qué falló el último envío. `null` = fue bien, o no hubo intento. */
  @Column({ name: 'send_error', type: 'varchar', length: 500, nullable: true })
  sendError!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
```

- [ ] **Step 5: Escribir el repositorio**

`backend/src/modules/portal/client-user-invitations.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, MoreThan, Repository } from 'typeorm';

import { ClientUserInvitation } from './entities/client-user-invitation.entity';
import { normalizeEmailAddress } from './email-address';

/** Lo mínimo para crear una invitación. Sin `usedAt` ni `revokedAt`: nace viva. */
export interface NewInvitation {
  clientId: number;
  email: string;
  fullName: string;
  /** La huella, nunca el secreto. Ver `domain/invitation-secret.ts`. */
  secretFingerprint: string;
  invitedByClientUserId: number;
  expiresAt: Date;
}

@Injectable()
export class ClientUserInvitationsRepository {
  constructor(
    @InjectRepository(ClientUserInvitation)
    private readonly repo: Repository<ClientUserInvitation>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Ejecuta `work` dentro de una única transacción. Quien llame debe hacer
   * TODAS sus escrituras a través del `EntityManager` que recibe
   * (`manager.getRepository(...)`), nunca de los repositorios inyectados por
   * Nest: solo así comparten conexión y confirman o revierten juntas. Copia
   * literal del criterio de `TicketsRepository.runInTransaction`.
   */
  runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  create(data: NewInvitation): Promise<ClientUserInvitation> {
    return this.repo.save(
      this.repo.create({ ...data, email: normalizeEmailAddress(data.email) }),
    );
  }

  /**
   * La invitación viva de esa dirección, si la hay: sin usar, sin revocar y
   * sin caducar. Los tres en el `WHERE`, no en un `if` posterior — la consulta
   * no debe poder devolver nunca una invitación gastada.
   */
  findLiveByEmail(email: string, now: Date): Promise<ClientUserInvitation | null> {
    return this.repo.findOne({
      where: {
        email: normalizeEmailAddress(email),
        usedAt: IsNull(),
        revokedAt: IsNull(),
        expiresAt: MoreThan(now),
      },
    });
  }

  /** Las pendientes de esa empresa, de la más reciente a la más antigua. */
  listPendingByClient(clientId: number, now: Date): Promise<ClientUserInvitation[]> {
    return this.repo.find({
      where: { clientId, usedAt: IsNull(), revokedAt: IsNull(), expiresAt: MoreThan(now) },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Una invitación pendiente concreta de esa empresa. El `clientId` va en el
   * `WHERE` y no en una comprobación posterior: la consulta no debe devolver
   * ni un instante una invitación de otra empresa. Quien llame convierte el
   * `null` en 404, nunca en 403.
   */
  findPendingByIdForClient(id: number, clientId: number): Promise<ClientUserInvitation | null> {
    return this.repo.findOne({
      where: { id, clientId, usedAt: IsNull(), revokedAt: IsNull() },
    });
  }

  /**
   * Invalida las invitaciones vivas de esa dirección **dentro de esa
   * empresa**. El `clientId` no es adorno: sin él, invitar desde la empresa B
   * a una dirección que la empresa A tiene pendiente le anularía la invitación
   * a A, un efecto cruzado entre empresas por la puerta de atrás.
   */
  async revokeLiveByEmail(email: string, clientId: number, revokedAt: Date): Promise<void> {
    await this.repo.update(
      {
        email: normalizeEmailAddress(email),
        clientId,
        usedAt: IsNull(),
        revokedAt: IsNull(),
      },
      { revokedAt },
    );
  }

  /**
   * Deja constancia del último intento de envío. `sendError` a `null` cuando
   * fue bien, para que un error viejo no quede colgando y la pantalla no siga
   * enseñando un fallo que ya se resolvió reenviando.
   */
  async markSent(id: number, sentAt: Date, sendError: string | null): Promise<void> {
    await this.repo.update(id, { lastSentAt: sentAt, sendError });
  }
}
```

- [ ] **Step 6: Registrar entidad y repositorio en el módulo**

En `backend/src/modules/portal/portal.module.ts`:

```ts
import { ClientUserInvitation } from './entities/client-user-invitation.entity';
import { ClientUserInvitationsRepository } from './client-user-invitations.repository';
```

y en el `imports`, `providers`:

```ts
    TypeOrmModule.forFeature([ClientUser, ClientUserInvitation]),
```
```ts
    ClientUserInvitationsRepository,
```

- [ ] **Step 7: Correr las pruebas y verlas pasar**

Run: `cd backend && npx jest src/modules/portal/`
Expected: PASS, incluidas las de `client-users.repository.spec.ts`, que no deben haber cambiado de comportamiento al mover la normalización.

- [ ] **Step 8: Suite completa y compilador**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/portal/email-address.ts \
        backend/src/modules/portal/entities/client-user-invitation.entity.ts \
        backend/src/modules/portal/client-user-invitations.repository.ts \
        backend/src/modules/portal/client-user-invitations.repository.spec.ts \
        backend/src/modules/portal/client-users.repository.ts \
        backend/src/modules/portal/portal.module.ts
git commit -m "feat(portal): entidad y repositorio de invitaciones, con la huella como unico rastro"
```

---

### Task 4: Listar y desactivar la gente de mi empresa

**Files:**
- Create: `backend/src/modules/portal/dto/portal-user.dto.ts`
- Create: `backend/src/modules/portal/portal-users.service.ts`
- Create: `backend/src/modules/portal/portal-users.service.spec.ts`
- Create: `backend/src/modules/portal/portal-users.controller.ts`
- Modify: `backend/src/modules/portal/client-users.repository.ts`
- Modify: `backend/src/modules/portal/guards/client-admin.guard.ts`
- Modify: `backend/src/modules/portal/portal-validation.integration.spec.ts`
- Modify: `backend/src/modules/portal/portal.module.ts`

**Interfaces:**
- Consume, de la Task 3: `normalizeEmailAddress`, `ClientUserInvitationsRepository` (todavía no se usa aquí), la entidad `ClientUser` ya ablandada.
- Produce:
  - `PortalClientUserView` desde `backend/src/modules/portal/dto/portal-user.dto.ts`:
    `{ id: number; fullName: string; email: string; isAdmin: boolean; isActive: boolean; lastLoginAt: string | null; createdAt: string }`
  - `ClientUsersRepository.deactivate(id: number): Promise<void>` — método nuevo. Para leer se reusa el `listByClient(clientId: number): Promise<ClientUser[]>` y el `findById(id: number): Promise<ClientUser | null>` que ya existen; **no se añade ningún método de lectura**.
  - `PortalUsersService` con:
    - `list(clientId: number): Promise<PortalClientUserView[]>`
    - `deactivate(clientId: number, actorClientUserId: number, targetId: number): Promise<PortalClientUserView>`
  - Rutas `GET /portal/usuarios` y `POST /portal/usuarios/:id/desactivar`, ambas bajo `ClientJwtGuard` + `ClientAdminGuard`.

Contexto: `ClientAdminGuard` hoy dice «Solo el administrador de la empresa puede crear requerimientos.» Ese texto deja de ser cierto en cuanto el guard cubre una segunda superficie. Se generaliza aquí, y hay que tocar también `portal-validation.integration.spec.ts:347`, que lo compara literalmente.

- [ ] **Step 1: Escribir las pruebas que fallan**

`backend/src/modules/portal/portal-users.service.spec.ts`:

```ts
import { NotFoundException, UnauthorizedException } from '@nestjs/common';

import { PortalUsersService } from './portal-users.service';

/** Fila tal como la devuelve TypeORM: los `bigint` salen como CADENA. */
function fila(over: Record<string, unknown> = {}) {
  return {
    id: '5',
    clientId: '7',
    email: 'ana@kuboti.com',
    passwordHash: '$2b$10$loquesea',
    fullName: 'Ana Pérez',
    isAdmin: 0,
    isActive: 1,
    lastLoginAt: new Date('2026-08-20T10:00:00.000Z'),
    createdBy: null,
    createdByClientUserId: '3',
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-01T10:00:00.000Z'),
    ...over,
  } as any;
}

function makeService(filas: any[] = [fila()]) {
  const repo = {
    listByClient: jest.fn(async () => filas),
    findById: jest.fn(async (id: number) => filas.find((f) => String(f.id) === String(id)) ?? null),
    deactivate: jest.fn(async () => undefined),
  };
  return { service: new PortalUsersService(repo as any), repo };
}

describe('PortalUsersService.list', () => {
  it('devuelve solo los campos de la lista blanca, y jamás el hash', async () => {
    const { service } = makeService();
    const [vista] = await service.list(7);

    expect(Object.keys(vista).sort()).toEqual(
      ['createdAt', 'email', 'fullName', 'id', 'isActive', 'isAdmin', 'lastLoginAt'].sort(),
    );
    expect(JSON.stringify(vista)).not.toContain('$2b$');
  });

  it('convierte los bigint que TypeORM devuelve como cadena a número', async () => {
    const { service } = makeService();
    const [vista] = await service.list(7);
    expect(vista.id).toBe(5);
  });

  it('no publica el clientId: la empresa es la de la sesión, no un dato que enseñar', async () => {
    const { service } = makeService();
    const [vista] = await service.list(7);
    expect(vista).not.toHaveProperty('clientId');
  });

  it('acota siempre por la empresa que le llega', async () => {
    const { service, repo } = makeService();
    await service.list(7);
    expect(repo.listByClient).toHaveBeenCalledWith(7);
  });

  it.each([[0], [-1], [Number.NaN]])(
    'una sesión con clientId inservible (%s) se rechaza sin consultar',
    async (malo) => {
      const { service, repo } = makeService();
      await expect(service.list(malo as number)).rejects.toThrow(UnauthorizedException);
      expect(repo.listByClient).not.toHaveBeenCalled();
    },
  );
});

describe('PortalUsersService.deactivate', () => {
  it('desactiva a alguien de su empresa', async () => {
    const { service, repo } = makeService([fila({ id: '5', clientId: '7' })]);
    const vista = await service.deactivate(7, 3, 5);
    expect(repo.deactivate).toHaveBeenCalledWith(5);
    expect(vista.isActive).toBe(false);
  });

  /**
   * 404 y NO 403: un 403 confirmaría que ese identificador existe de verdad,
   * que es justo lo que un atacante quiere saber. La respuesta de "es de otra
   * empresa" tiene que ser indistinguible de la de "no existe".
   */
  it('un usuario de otra empresa responde 404, no 403, y no se toca', async () => {
    const { service, repo } = makeService([fila({ id: '5', clientId: '99' })]);
    await expect(service.deactivate(7, 3, 5)).rejects.toThrow(NotFoundException);
    expect(repo.deactivate).not.toHaveBeenCalled();
  });

  it('un usuario que no existe responde exactamente lo mismo que uno ajeno', async () => {
    const ajeno = makeService([fila({ id: '5', clientId: '99' })]);
    const inexistente = makeService([]);

    const cuerpoAjeno = await ajeno.service.deactivate(7, 3, 5).catch((e) => e.getResponse());
    const cuerpoInexistente = await inexistente.service
      .deactivate(7, 3, 5)
      .catch((e) => e.getResponse());

    expect(cuerpoAjeno).toEqual(cuerpoInexistente);
  });

  /**
   * Decisión 5 de la spec. Si un administrador pudiera desactivarse a sí
   * mismo, una empresa podría quedarse sin ningún administrador y sin forma de
   * recuperarlo salvo llamándonos. Se rechaza en el servidor, no solo en la
   * pantalla.
   */
  it('un administrador no puede desactivarse a sí mismo', async () => {
    const { service, repo } = makeService([fila({ id: 3, clientId: 7, isAdmin: 1 })]);
    await expect(service.deactivate(7, 3, 3)).rejects.toThrow(/no puedes quitarte a ti/i);
    expect(repo.deactivate).not.toHaveBeenCalled();
  });

  /**
   * Y ahora con los tipos que llegan DE VERDAD: el id del actor viene del token
   * (número) y el de la fila viene de la base (cadena, porque TypeORM hidrata
   * todo `bigint` así). Con `===` esta comparación sería siempre falsa y el
   * administrador SÍ podría quitarse el acceso — la empresa se quedaría sin
   * nadie que pudiera invitar. Por eso `sameId`.
   */
  it('se reconoce a sí mismo aunque el id de la fila llegue como cadena', async () => {
    const { service, repo } = makeService([fila({ id: '3', clientId: '7', isAdmin: 1 })]);
    await expect(service.deactivate(7, 3, 3)).rejects.toThrow(/no puedes quitarte a ti/i);
    expect(repo.deactivate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr las pruebas y verlas fallar**

Run: `cd backend && npx jest src/modules/portal/portal-users.service.spec.ts`
Expected: FAIL con «Cannot find module './portal-users.service'».

- [ ] **Step 3: Escribir la vista del portal**

`backend/src/modules/portal/dto/portal-user.dto.ts`:

```ts
import { IsEmail, IsString, Length } from 'class-validator';

/**
 * Lo que un administrador de cliente ve de la gente de su empresa.
 *
 * Lista blanca escrita a mano, nunca un spread de la entidad menos
 * `passwordHash`: una columna nueva en `client_users` dentro de seis meses no
 * puede publicarse sola.
 *
 * **Sin `clientId` a propósito.** La empresa es la de la sesión de quien
 * pregunta: no es un dato que esta pantalla tenga que enseñar, y no ponerlo
 * evita que el frontend caiga en la tentación de mandarlo de vuelta.
 */
export interface PortalClientUserView {
  id: number;
  fullName: string;
  email: string;
  isAdmin: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/**
 * Alta de una invitación desde el portal. **Sin `clientId` y sin `isAdmin`.**
 *
 * No es una omisión: con el `ValidationPipe` global (`forbidNonWhitelisted`)
 * mandarlos devuelve 400 antes de llegar al servicio, y aunque llegaran, el
 * servicio construye la fila campo a campo y no los leería. Un administrador
 * de cliente no puede nombrar administradores (decisión 2 de la spec), y la
 * empresa sale de la sesión.
 */
export class InvitePortalUserDto {
  @IsEmail({}, { message: 'Escribe un correo electrónico válido.' })
  @Length(1, 180, { message: 'El correo no puede pasar de 180 caracteres.' })
  email!: string;

  @IsString({ message: 'El nombre es obligatorio.' })
  @Length(1, 180, { message: 'El nombre es obligatorio y no puede pasar de 180 caracteres.' })
  fullName!: string;
}
```

- [ ] **Step 4: Añadir `deactivate` al repositorio de usuarios de cliente**

En `backend/src/modules/portal/client-users.repository.ts`, junto a `touchLastLogin`:

```ts
  /**
   * Le quita el acceso, no borra la fila. Sus tickets, sus mensajes y su
   * rastro en los informes tienen que seguir siendo legibles (decisión 4 de
   * la spec): un usuario desactivado no puede entrar y no aparece en los
   * desplegables, pero su historia queda.
   */
  async deactivate(id: number): Promise<void> {
    await this.repo.update(id, { isActive: 0 });
  }
```

- [ ] **Step 5: Escribir el servicio**

`backend/src/modules/portal/portal-users.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { sameId } from '../../common/ids';
import { ClientUsersRepository } from './client-users.repository';
import { ClientUser } from './entities/client-user.entity';
import { PortalClientUserView } from './dto/portal-user.dto';
import { assertSessionScope, toIso } from './session-scope';

/**
 * La gente de una empresa cliente, vista y gestionada por su propio
 * administrador. `clientId` y `actorClientUserId` entran SIEMPRE por argumento
 * desde el token — nunca desde el cuerpo, la URL ni la query.
 */
@Injectable()
export class PortalUsersService {
  constructor(private readonly repo: ClientUsersRepository) {}

  async list(clientId: number): Promise<PortalClientUserView[]> {
    assertSessionScope(clientId, 'clientId', PortalUsersService.name);
    const filas = await this.repo.listByClient(clientId);
    return filas.map(toPortalView);
  }

  /**
   * Le quita el acceso a alguien de su empresa.
   *
   * Dos comprobaciones y en este orden: primero que el usuario sea de esta
   * empresa (si no, 404), y solo después que no sea uno mismo. Al revés, un
   * administrador podría averiguar por el mensaje de error que un id ajeno
   * coincide con el suyo.
   */
  async deactivate(
    clientId: number,
    actorClientUserId: number,
    targetId: number,
  ): Promise<PortalClientUserView> {
    assertSessionScope(clientId, 'clientId', PortalUsersService.name);
    assertSessionScope(actorClientUserId, 'clientUserId', PortalUsersService.name);

    const usuario = await this.repo.findById(targetId);
    // `sameId` y no `===`: TypeORM devuelve `client_id` como cadena y el del
    // token es un número de verdad. Con la comparación estricta, el dueño
    // legítimo se comería un 404.
    if (!usuario || !sameId(usuario.clientId, clientId)) throw this.noExiste();

    if (sameId(usuario.id, actorClientUserId)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message:
          'No puedes quitarte a ti mismo el acceso: la empresa se quedaría sin administrador.',
      });
    }

    await this.repo.deactivate(Number(usuario.id));
    return toPortalView({ ...usuario, isActive: 0 });
  }

  /**
   * Un usuario de otra empresa y uno que no existe dan exactamente esta misma
   * respuesta. Distinguirlos confirmaría cuáles existen de verdad — de ahí
   * 404 y nunca 403.
   */
  private noExiste(): NotFoundException {
    return new NotFoundException({
      code: 'NOT_FOUND',
      message: 'Usuario no encontrado',
    });
  }
}

/**
 * Lista blanca campo a campo. Nunca `{...u}` menos claves: eso publica por
 * omisión cualquier columna que alguien añada mañana a la entidad, empezando
 * por `passwordHash`.
 */
function toPortalView(u: ClientUser): PortalClientUserView {
  return {
    id: Number(u.id),
    fullName: u.fullName,
    email: u.email,
    isAdmin: !!u.isAdmin,
    isActive: !!u.isActive,
    lastLoginAt: toIso(u.lastLoginAt),
    createdAt: toIso(u.createdAt)!,
  };
}
```

- [ ] **Step 6: Escribir el controlador**

`backend/src/modules/portal/portal-users.controller.ts`:

```ts
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { ClientJwtGuard } from './guards/client-jwt.guard';
import { ClientAdminGuard } from './guards/client-admin.guard';
import { CurrentClientUser } from './decorators/current-client-user.decorator';
import { AuthClientUser } from './strategies/client-jwt.strategy';
import { PortalUsersService } from './portal-users.service';
import { PortalClientUserView } from './dto/portal-user.dto';

const userIdPipe = new ParseIntPipe({
  exceptionFactory: () =>
    new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'El identificador del usuario no es válido.',
    }),
});

/**
 * La gente de la propia empresa, gestionada por su administrador.
 *
 * **Ninguna ruta acepta `clientId`**: el único que existe aquí es el del token
 * que `ClientJwtGuard` acaba de verificar. Mismo criterio que
 * `PortalRequirementsController`.
 *
 * `ClientAdminGuard` va a nivel de controlador, no por ruta: aquí no hay nada
 * que un usuario normal deba poder hacer —ni siquiera listar—, y ponerlo
 * arriba hace que una ruta nueva lo herede sin que nadie tenga que acordarse.
 */
@Controller('portal/usuarios')
@UseGuards(ClientJwtGuard, ClientAdminGuard)
export class PortalUsersController {
  constructor(private readonly service: PortalUsersService) {}

  @Get()
  list(@CurrentClientUser() user: AuthClientUser): Promise<PortalClientUserView[]> {
    return this.service.list(user.clientId);
  }

  /**
   * `POST` y no `DELETE`: no se borra nada. El usuario sigue existiendo con
   * todo su rastro; lo que se quita es el acceso (decisión 4 de la spec).
   */
  @Post(':id/desactivar')
  @HttpCode(200)
  deactivate(
    @CurrentClientUser() user: AuthClientUser,
    @Param('id', userIdPipe) id: number,
  ): Promise<PortalClientUserView> {
    return this.service.deactivate(user.clientId, user.clientUserId, id);
  }
}
```

- [ ] **Step 7: Generalizar el mensaje del guard**

En `backend/src/modules/portal/guards/client-admin.guard.ts`, el guard ya no cubre solo los requerimientos:

```ts
        message: 'Solo el administrador de la empresa puede hacer esto.',
```

Y ajusta la expectativa que lo compara literalmente en
`backend/src/modules/portal/portal-validation.integration.spec.ts` (línea ~347):

```ts
        message: 'Solo el administrador de la empresa puede hacer esto.',
```

- [ ] **Step 8: Cablear en el módulo**

En `backend/src/modules/portal/portal.module.ts`, añade `PortalUsersController` a `controllers` y `PortalUsersService` a `providers`, con sus dos `import`.

- [ ] **Step 9: Correr las pruebas y verlas pasar**

Run: `cd backend && npx jest src/modules/portal/`
Expected: PASS

- [ ] **Step 10: Suite completa y compilador**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add backend/src/modules/portal/dto/portal-user.dto.ts \
        backend/src/modules/portal/portal-users.service.ts \
        backend/src/modules/portal/portal-users.service.spec.ts \
        backend/src/modules/portal/portal-users.controller.ts \
        backend/src/modules/portal/client-users.repository.ts \
        backend/src/modules/portal/guards/client-admin.guard.ts \
        backend/src/modules/portal/portal-validation.integration.spec.ts \
        backend/src/modules/portal/portal.module.ts
git commit -m "feat(portal): el administrador ve y desactiva a la gente de su empresa"
```

---

### Task 5: Invitar — la empresa sale de la sesión, y el error no dice si el correo existe

**Files:**
- Create: `backend/src/modules/portal/portal-invitations.service.ts`
- Create: `backend/src/modules/portal/portal-invitations.service.spec.ts`
- Modify: `backend/src/modules/portal/dto/portal-user.dto.ts`
- Modify: `backend/src/modules/portal/portal-users.controller.ts`
- Modify: `backend/src/modules/portal/portal.module.ts`

**Interfaces:**
- Consume:
  - Task 2: `generateInvitationSecret()`, `fingerprintInvitationSecret(secret)`, `invitationExpiryFrom(now)`.
  - Task 3: `ClientUserInvitationsRepository` con `create`, `findLiveByEmail`, `listPendingByClient`, `revokeLiveByEmail`.
  - Task 4: `InvitePortalUserDto`, `assertSessionScope`, `toIso`.
  - Existente: `ClientUsersRepository.findByEmail(email): Promise<ClientUser | null>`.
- Produce:
  - `PortalInvitationView` desde `dto/portal-user.dto.ts`:
    `{ id: number; fullName: string; email: string; expiresAt: string; lastSentAt: string | null; deliveryFailed: boolean; createdAt: string }`
  - `INVITE_REJECTED_MESSAGE: string` exportado desde `portal-invitations.service.ts`.
  - `PortalInvitationsService` con, por ahora:
    - `invite(clientId: number, invitedByClientUserId: number, dto: InvitePortalUserDto): Promise<PortalInvitationView>`
    - `inviteWithSecret(clientId: number, invitedByClientUserId: number, dto: InvitePortalUserDto): Promise<{ view: PortalInvitationView; secret: string; invitation: ClientUserInvitation }>` — la Task 6 la usa para mandar el correo; el secreto no sale nunca por HTTP.
    - `listPending(clientId: number): Promise<PortalInvitationView[]>`
  - `toInvitationView(i: ClientUserInvitation): PortalInvitationView`, exportada desde `portal-invitations.service.ts`.
  - Rutas `GET /portal/usuarios/invitaciones` y `POST /portal/usuarios/invitaciones`.

En esta tarea la invitación se **crea** pero todavía no se manda ningún correo: el envío entra en la Task 6. Se separa así porque son dos gates distintos — un revisor puede aceptar la regla de frontera y rechazar el texto del correo, o al revés.

`invite` devuelve la vista **sin el secreto**: el secreto solo sale por correo. El método lo genera, calcula su huella, guarda la huella y deja el valor en claro en una variable local que muere con la petición.

- [ ] **Step 1: Escribir las pruebas que fallan**

`backend/src/modules/portal/portal-invitations.service.spec.ts`:

```ts
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import { INVITE_REJECTED_MESSAGE, PortalInvitationsService } from './portal-invitations.service';
import { fingerprintInvitationSecret } from './domain/invitation-secret';

function makeService(opciones: {
  usuarioExistente?: any;
  invitacionViva?: any;
} = {}) {
  const escritas: any[] = [];
  const revocadas: any[] = [];

  const invitations = {
    escritas,
    revocadas,
    create: jest.fn(async (d: any) => {
      escritas.push(d);
      return { id: 11, usedAt: null, revokedAt: null, lastSentAt: null, sendError: null,
        createdAt: new Date('2026-08-26T15:00:00.000Z'), ...d };
    }),
    findLiveByEmail: jest.fn(async () => opciones.invitacionViva ?? null),
    listPendingByClient: jest.fn(async () => []),
    revokeLiveByEmail: jest.fn(async (...args: any[]) => {
      revocadas.push(args);
    }),
  };

  const clientUsers = {
    findByEmail: jest.fn(async () => opciones.usuarioExistente ?? null),
  };

  const service = new PortalInvitationsService(invitations as any, clientUsers as any);
  return { service, invitations, clientUsers };
}

const DTO = { email: 'Nuevo@Kuboti.com', fullName: 'Nuevo Nombre' };

describe('PortalInvitationsService.invite', () => {
  it('fija la empresa desde el argumento de sesión', async () => {
    const { service, invitations } = makeService();
    await service.invite(7, 3, DTO);
    expect(invitations.escritas[0].clientId).toBe(7);
    expect(invitations.escritas[0].invitedByClientUserId).toBe(3);
  });

  /**
   * LA PRUEBA DE LA FRONTERA, con la petición manipulada y no confiando en el
   * tipo. El `ValidationPipe` global ya rechazaría un `clientId` en el cuerpo,
   * pero esa es la SEGUNDA barrera. Esta comprueba la primera: aunque llegara,
   * el servicio no lo lee.
   */
  it('ignora una empresa ajena colada en el cuerpo', async () => {
    const { service, invitations } = makeService();
    await service.invite(7, 3, { ...DTO, clientId: 99 } as any);
    expect(invitations.escritas[0].clientId).toBe(7);
  });

  /**
   * Decisión 2 de la spec: el administrador de cliente NO puede nombrar
   * administradores. Ni aunque la petición lo pida explícitamente. Lo que se
   * guarda en la invitación no lleva ningún campo de rol, así que no hay por
   * dónde colarlo.
   */
  it('un isAdmin en el cuerpo no llega a la invitación por ningún camino', async () => {
    const { service, invitations } = makeService();
    await service.invite(7, 3, { ...DTO, isAdmin: true } as any);
    expect(JSON.stringify(invitations.escritas[0])).not.toContain('isAdmin');
  });

  it('guarda la huella del secreto, y nunca el secreto', async () => {
    const { service, invitations } = makeService();
    await service.invite(7, 3, DTO);
    const fila = invitations.escritas[0];
    expect(fila.secretFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fila).not.toHaveProperty('secret');
  });

  it('el secreto que se genera es el que corresponde a la huella guardada', async () => {
    const { service, invitations } = makeService();
    const { secret } = await service.inviteWithSecret(7, 3, DTO);
    expect(invitations.escritas[0].secretFingerprint).toBe(fingerprintInvitationSecret(secret));
  });

  it('la vista que devuelve no contiene ni el secreto ni la huella', async () => {
    const { service } = makeService();
    const vista = await service.invite(7, 3, DTO);
    expect(Object.keys(vista).sort()).toEqual(
      ['createdAt', 'deliveryFailed', 'email', 'expiresAt', 'fullName', 'id', 'lastSentAt'].sort(),
    );
  });

  it('caduca a los 7 días del instante en que se crea', async () => {
    const { service, invitations } = makeService();
    const antes = Date.now();
    await service.invite(7, 3, DTO);
    const caduca = (invitations.escritas[0].expiresAt as Date).getTime();
    expect(caduca - antes).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 5000);
    expect(caduca - antes).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 5000);
  });

  /**
   * Decisión 7 de la spec. Decir «ese correo ya está registrado» convierte el
   * portal en un comprobador de quiénes son nuestros clientes.
   */
  it('un correo que ya es de un usuario de la propia empresa se rechaza con el texto genérico', async () => {
    const { service, invitations } = makeService({
      usuarioExistente: { id: '5', clientId: '7', email: 'nuevo@kuboti.com' },
    });
    await expect(service.invite(7, 3, DTO)).rejects.toMatchObject({
      response: { message: INVITE_REJECTED_MESSAGE },
    });
    expect(invitations.create).not.toHaveBeenCalled();
  });

  it('un correo que ya es de OTRA empresa se rechaza con exactamente el mismo cuerpo', async () => {
    const propio = makeService({ usuarioExistente: { id: '5', clientId: '7' } });
    const ajeno = makeService({ usuarioExistente: { id: '8', clientId: '99' } });

    const cuerpoPropio = await propio.service.invite(7, 3, DTO).catch((e) => e.getResponse());
    const cuerpoAjeno = await ajeno.service.invite(7, 3, DTO).catch((e) => e.getResponse());

    expect(cuerpoPropio).toEqual(cuerpoAjeno);
  });

  it('un correo con una invitación viva en OTRA empresa se rechaza, y no se le toca la suya', async () => {
    const { service, invitations } = makeService({
      invitacionViva: { id: 4, clientId: '99', email: 'nuevo@kuboti.com' },
    });
    await expect(service.invite(7, 3, DTO)).rejects.toThrow(BadRequestException);
    expect(invitations.revokeLiveByEmail).not.toHaveBeenCalled();
    expect(invitations.create).not.toHaveBeenCalled();
  });

  /**
   * «Un mismo correo no acumula invitaciones vivas: invitar de nuevo reemplaza
   * la anterior, que deja de servir.» Dentro de la MISMA empresa, y en este
   * orden: primero se revoca la vieja, después se crea la nueva. Al revés,
   * durante un instante habría dos vivas y la revocación se llevaría por
   * delante la recién creada.
   */
  it('invitar de nuevo al mismo correo dentro de la empresa revoca la anterior antes de crear la nueva', async () => {
    const { service, invitations } = makeService({
      invitacionViva: { id: 4, clientId: '7', email: 'nuevo@kuboti.com' },
    });
    await service.invite(7, 3, DTO);

    expect(invitations.revokeLiveByEmail).toHaveBeenCalledWith(
      'Nuevo@Kuboti.com', 7, expect.any(Date),
    );
    expect(invitations.revokeLiveByEmail.mock.invocationCallOrder[0]).toBeLessThan(
      invitations.create.mock.invocationCallOrder[0],
    );
  });

  it.each([[0], [-1], [Number.NaN]])(
    'una sesión con clientId inservible (%s) se rechaza sin escribir nada',
    async (malo) => {
      const { service, invitations } = makeService();
      await expect(service.invite(malo as number, 3, DTO)).rejects.toThrow(UnauthorizedException);
      expect(invitations.create).not.toHaveBeenCalled();
    },
  );

  it('una sesión sin clientUserId utilizable tampoco escribe: la invitación quedaría sin autor', async () => {
    const { service, invitations } = makeService();
    await expect(service.invite(7, 0, DTO)).rejects.toThrow(UnauthorizedException);
    expect(invitations.create).not.toHaveBeenCalled();
  });
});

describe('PortalInvitationsService.listPending', () => {
  it('acota por la empresa de la sesión', async () => {
    const { service, invitations } = makeService();
    await service.listPending(7);
    expect(invitations.listPendingByClient).toHaveBeenCalledWith(7, expect.any(Date));
  });
});
```

- [ ] **Step 2: Correr las pruebas y verlas fallar**

Run: `cd backend && npx jest src/modules/portal/portal-invitations.service.spec.ts`
Expected: FAIL con «Cannot find module './portal-invitations.service'».

- [ ] **Step 3: Añadir la vista de invitación al DTO**

En `backend/src/modules/portal/dto/portal-user.dto.ts`:

```ts
/**
 * Lo que el administrador ve de una invitación pendiente.
 *
 * **Ni el secreto ni la huella.** El secreto solo existe en el correo; la
 * huella no le sirve de nada a nadie fuera de la base y publicarla sería
 * regalar la mitad del trabajo a quien quisiera atacar el índice.
 *
 * `deliveryFailed` es un booleano derivado y no el texto del error: por qué
 * exactamente rechazó el servidor SMTP es información de diagnóstico interno,
 * y el administrador solo necesita saber que tiene que reenviar.
 */
export interface PortalInvitationView {
  id: number;
  fullName: string;
  email: string;
  expiresAt: string;
  lastSentAt: string | null;
  deliveryFailed: boolean;
  createdAt: string;
}
```

- [ ] **Step 4: Escribir el servicio**

`backend/src/modules/portal/portal-invitations.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';

import { ClientUsersRepository } from './client-users.repository';
import { ClientUserInvitationsRepository } from './client-user-invitations.repository';
import { ClientUserInvitation } from './entities/client-user-invitation.entity';
import { InvitePortalUserDto, PortalInvitationView } from './dto/portal-user.dto';
import {
  fingerprintInvitationSecret,
  generateInvitationSecret,
  invitationExpiryFrom,
} from './domain/invitation-secret';
import { assertSessionScope, toIso } from './session-scope';
import { sameId } from '../../common/ids';

/**
 * Único texto para cualquier motivo por el que no se puede invitar a una
 * dirección: ya es de un usuario de esta empresa, ya es de un usuario de otra,
 * o ya tiene una invitación viva en otra.
 *
 * Decisión 7 de la spec: distinguirlos convertiría el portal en un comprobador
 * de quiénes son nuestros clientes. La consecuencia conocida y aceptada es que
 * un administrador que se equivoque tecleando no sabrá exactamente por qué
 * falla — por eso el texto le dice qué hacer.
 */
export const INVITE_REJECTED_MESSAGE =
  'No se puede invitar a esa dirección. Revisa que esté bien escrita, ' +
  'o escríbenos si crees que debería poder entrar.';

@Injectable()
export class PortalInvitationsService {
  constructor(
    private readonly invitations: ClientUserInvitationsRepository,
    private readonly clientUsers: ClientUsersRepository,
  ) {}

  /**
   * Crea la invitación y devuelve la vista. **El secreto no sale por aquí**:
   * quien necesita mandarlo por correo usa `inviteWithSecret`.
   */
  async invite(
    clientId: number,
    invitedByClientUserId: number,
    dto: InvitePortalUserDto,
  ): Promise<PortalInvitationView> {
    const { view } = await this.inviteWithSecret(clientId, invitedByClientUserId, dto);
    return view;
  }

  /**
   * El alta de verdad. Devuelve la vista **y** el secreto en claro, que existe
   * solo en esta variable y en el correo que sale: no se guarda, no se registra
   * en ningún log y no se devuelve por HTTP.
   */
  async inviteWithSecret(
    clientId: number,
    invitedByClientUserId: number,
    dto: InvitePortalUserDto,
  ): Promise<{ view: PortalInvitationView; secret: string; invitation: ClientUserInvitation }> {
    // Los dos, y antes de tocar la base: un clientId falsy haría desaparecer
    // el filtro de empresa, y un clientUserId falsy dejaría la invitación sin
    // autor real.
    assertSessionScope(clientId, 'clientId', PortalInvitationsService.name);
    assertSessionScope(invitedByClientUserId, 'clientUserId', PortalInvitationsService.name);

    const ahora = new Date();

    // El correo es único en `client_users` para TODO el sistema (ver la clave
    // `uq_client_users_email` de la 013), así que esta comprobación es global
    // a propósito: si la dirección ya es de alguien, da igual de qué empresa.
    const yaEsUsuario = await this.clientUsers.findByEmail(dto.email);
    if (yaEsUsuario) throw invitacionRechazada();

    const viva = await this.invitations.findLiveByEmail(dto.email, ahora);
    if (viva && !sameId(viva.clientId, clientId)) {
      // Viva en OTRA empresa: se rechaza y no se le toca la suya. Anularla
      // sería un efecto cruzado entre empresas, aunque no revele nada.
      throw invitacionRechazada();
    }
    if (viva) {
      // Viva en la propia: se reemplaza. Primero revocar y después crear —al
      // revés, durante un instante habría dos vivas y la revocación se
      // llevaría por delante la recién creada.
      await this.invitations.revokeLiveByEmail(dto.email, clientId, ahora);
    }

    const secret = generateInvitationSecret();
    const invitation = await this.invitations.create({
      clientId,
      email: dto.email,
      fullName: dto.fullName.trim(),
      // La huella, jamás el secreto.
      secretFingerprint: fingerprintInvitationSecret(secret),
      invitedByClientUserId,
      expiresAt: invitationExpiryFrom(ahora),
    });

    // Campo a campo, y sin ningún campo de rol: no hay por dónde colar un
    // `isAdmin` que llegara en el cuerpo, porque este objeto no lo tiene.
    return { view: toInvitationView(invitation), secret, invitation };
  }

  async listPending(clientId: number): Promise<PortalInvitationView[]> {
    assertSessionScope(clientId, 'clientId', PortalInvitationsService.name);
    const filas = await this.invitations.listPendingByClient(clientId, new Date());
    return filas.map(toInvitationView);
  }
}

function invitacionRechazada(): BadRequestException {
  return new BadRequestException({
    code: 'INVITACION_RECHAZADA',
    message: INVITE_REJECTED_MESSAGE,
  });
}

/**
 * Lista blanca campo a campo. `secretFingerprint` no aparece, y no puede
 * aparecer por descuido porque no hay ningún spread de la entidad.
 */
export function toInvitationView(i: ClientUserInvitation): PortalInvitationView {
  return {
    id: Number(i.id),
    fullName: i.fullName,
    email: i.email,
    expiresAt: toIso(i.expiresAt)!,
    lastSentAt: toIso(i.lastSentAt),
    // Por el hecho, no por la ausencia: hay fallo si hay TEXTO de error, no si
    // falta `lastSentAt` (que solo significa "todavía no se intentó").
    deliveryFailed: !!i.sendError,
    createdAt: toIso(i.createdAt)!,
  };
}
```

- [ ] **Step 5: Añadir las dos rutas al controlador**

En `backend/src/modules/portal/portal-users.controller.ts`, **antes** de la ruta `:id/desactivar` para que se lea el orden con claridad:

```ts
  /**
   * Las invitaciones pendientes de esta empresa. Van en este controlador y no
   * en uno propio porque son la otra mitad de la misma pantalla: una persona
   * invitada todavía no es un usuario, pero el administrador la ve en la misma
   * lista y necesita saber que sigue pendiente.
   */
  @Get('invitaciones')
  listInvitations(@CurrentClientUser() user: AuthClientUser): Promise<PortalInvitationView[]> {
    return this.invitations.listPending(user.clientId);
  }

  @Post('invitaciones')
  invite(
    @CurrentClientUser() user: AuthClientUser,
    @Body() dto: InvitePortalUserDto,
  ): Promise<PortalInvitationView> {
    // Los dos identificadores salen del token que `ClientJwtGuard` acaba de
    // verificar. El cuerpo solo aporta nombre y correo.
    return this.invitations.invite(user.clientId, user.clientUserId, dto);
  }
```

Añade al constructor `private readonly invitations: PortalInvitationsService` y los `import` de `Body`, `InvitePortalUserDto`, `PortalInvitationView` y `PortalInvitationsService`.

- [ ] **Step 6: Cablear en el módulo**

En `backend/src/modules/portal/portal.module.ts`, añade `PortalInvitationsService` a `providers` con su `import`.

- [ ] **Step 7: Correr las pruebas y verlas pasar**

Run: `cd backend && npx jest src/modules/portal/`
Expected: PASS

- [ ] **Step 8: Suite completa y compilador**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/portal/portal-invitations.service.ts \
        backend/src/modules/portal/portal-invitations.service.spec.ts \
        backend/src/modules/portal/dto/portal-user.dto.ts \
        backend/src/modules/portal/portal-users.controller.ts \
        backend/src/modules/portal/portal.module.ts
git commit -m "feat(portal): invitar fija la empresa desde la sesion y no dice si el correo existe"
```

---

### Task 6: El correo de invitación, y el reenvío como reintento visible

**Files:**
- Create: `backend/src/modules/portal/invitation-email.ts`
- Create: `backend/src/modules/portal/invitation-email.spec.ts`
- Modify: `backend/src/modules/portal/portal-invitations.service.ts`
- Modify: `backend/src/modules/portal/portal-invitations.service.spec.ts`
- Modify: `backend/src/modules/portal/portal-users.controller.ts`
- Modify: `backend/src/modules/portal/portal.module.ts`

**Interfaces:**
- Consume:
  - Task 5: `PortalInvitationsService.inviteWithSecret`, `toInvitationView`, `PortalInvitationView`.
  - Task 3: `ClientUserInvitationsRepository.markSent`, `findPendingByIdForClient`, `revokeLiveByEmail`.
  - Existente: `EmailService.send(input: SendEmailInput)` de `modules/email/email.service.ts`; `ClientsService.findByIdOrFail(id)`; `resolveClientRazonSocial(clients, clientId)` de `./client-name`.
- Produce, desde `backend/src/modules/portal/invitation-email.ts`:
  - `buildInvitationUrl(frontendUrl: string, secret: string): string`
  - `resolveFrontendUrl(config: ConfigService): string`
  - `buildInvitationEmail(input: InvitationEmailInput): { subject: string; html: string; text: string }` con `InvitationEmailInput = { fullName: string; clientName: string | null; acceptUrl: string; expiresAt: Date }`
- Produce, en `PortalInvitationsService`:
  - `resend(clientId: number, invitationId: number): Promise<PortalInvitationView>`
  - `invite` pasa a mandar el correo tras crear la invitación, sin cambiar su firma.
- Produce, ruta: `POST /portal/usuarios/invitaciones/:id/reenviar`.

Contexto (decisión 6 de la spec): **la invitación no va por la cola de avisos.** El despachador recorre `ticket_events`, y una invitación no es un evento de ticket; meterla ahí obligaría a inventar un evento falso. Se manda directamente por `EmailService`, el mismo transporte SMTP que ya usa el envío de firmas (`document-signatories.service.ts`), que es el precedente exacto de «quien no es el despachador manda un correo».

Consecuencia conocida: sin cola no hay reintento automático. A cambio, **la invitación queda creada aunque el correo falle** y el reenvío es el reintento, visible en la pantalla.

- [ ] **Step 1: Escribir las pruebas que fallan, del texto del correo**

`backend/src/modules/portal/invitation-email.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';

import { buildInvitationEmail, buildInvitationUrl, resolveFrontendUrl } from './invitation-email';

const cfg = (valor?: string) =>
  ({ get: (k: string, fallback?: string) => (k === 'FRONTEND_URL' ? valor : fallback) }) as
    unknown as ConfigService;

describe('la dirección del enlace', () => {
  it('cuelga de la ruta pública de aceptar invitación', () => {
    expect(buildInvitationUrl('https://kuboti.com', 'SECRETO')).toBe(
      'https://kuboti.com/portal/invitacion/SECRETO',
    );
  });

  it('no duplica la barra si la base ya la trae', () => {
    expect(buildInvitationUrl('https://kuboti.com/', 'SECRETO')).toBe(
      'https://kuboti.com/portal/invitacion/SECRETO',
    );
  });

  /**
   * `||` y no `??`. `docker-compose.yml` declara `FRONTEND_URL: ${FRONTEND_URL}`
   * y Compose SUSTITUYE POR CADENA VACÍA cuando la variable no está en el
   * `.env`: no omite la clave. Con `??`, ese vacío pasaría por "configurado" y
   * el enlace saldría como `/portal/invitacion/<secreto>`, sin host —
   * irreparable para quien lo recibe. Mismo criterio que `resolveFrontendUrl`
   * en el despachador de avisos y que el envío de firmas.
   */
  it.each([[undefined], [''], ['   ']])(
    'una FRONTEND_URL ausente o en blanco (%s) cae al valor por defecto, no deja el enlace sin host',
    (valor) => {
      expect(resolveFrontendUrl(cfg(valor))).toBe('http://localhost:5173');
    },
  );

  it('recorta las barras finales de la base configurada', () => {
    expect(resolveFrontendUrl(cfg('https://kuboti.com//'))).toBe('https://kuboti.com');
  });
});

describe('el correo de invitación', () => {
  const base = {
    fullName: 'Ana Pérez',
    clientName: 'Acme S.A.C.',
    acceptUrl: 'https://kuboti.com/portal/invitacion/SECRETO',
    expiresAt: new Date('2026-09-02T15:00:00.000Z'),
  };

  it('lleva el enlace en el cuerpo, en las dos versiones', () => {
    const { html, text } = buildInvitationEmail(base);
    expect(html).toContain(base.acceptUrl);
    expect(text).toContain(base.acceptUrl);
  });

  it('siempre hay versión de texto: un cliente que no pinte HTML tiene que ver el enlace', () => {
    expect(buildInvitationEmail(base).text.trim().length).toBeGreaterThan(0);
  });

  it('nombra a la persona y a su empresa', () => {
    const { html } = buildInvitationEmail(base);
    expect(html).toContain('Ana Pérez');
    expect(html).toContain('Acme S.A.C.');
  });

  it('si no se pudo resolver la empresa, el correo sale igual y sin huecos raros', () => {
    const { html, subject } = buildInvitationEmail({ ...base, clientName: null });
    expect(html).not.toContain('null');
    expect(subject).not.toContain('null');
  });

  /**
   * Riesgo 1 de la spec: el correo acaba en spam. Se evita el vocabulario que
   * disparan los filtros — nada de "gratis", "urgente", "haz clic aquí ahora",
   * ni asuntos en mayúsculas o con signos de exclamación.
   */
  it('el asunto no usa el vocabulario que disparan los filtros de spam', () => {
    const { subject } = buildInvitationEmail(base);
    expect(subject).not.toMatch(/!|gratis|urgente|haz clic|oferta/i);
    expect(subject).not.toBe(subject.toUpperCase());
  });

  it('dice hasta cuándo sirve el enlace, en hora de Lima', () => {
    // 15:00 UTC del 2 de septiembre son las 10:00 del mismo día en Lima.
    expect(buildInvitationEmail(base).html).toContain('2 de septiembre');
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `cd backend && npx jest src/modules/portal/invitation-email.spec.ts`
Expected: FAIL con «Cannot find module './invitation-email'».

- [ ] **Step 3: Escribir el constructor del correo**

`backend/src/modules/portal/invitation-email.ts`:

```ts
import { ConfigService } from '@nestjs/config';

import { PERU_TIME_ZONE } from '../../common/time-zone';

/** URL base del frontend cuando no hay `FRONTEND_URL`. La misma que el envío de firmas. */
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

/**
 * `|| ''` y no `??`: `docker-compose.yml` inyecta `FRONTEND_URL: ${FRONTEND_URL}`
 * y Compose **sustituye por cadena vacía** cuando la variable no está en el
 * `.env` — no omite la clave. Con `??`, ese vacío pasaría de largo y el enlace
 * saldría sin host: irreparable para quien lo recibe, porque el correo ya salió.
 *
 * Es la tercera copia de este mismo criterio en el proyecto (las otras dos
 * están en `notification-dispatcher.service.ts` y en
 * `document-signatories.service.ts`). Se repite a propósito y no se factoriza:
 * cada una vive en el módulo que la usa, y lo que no puede divergir —el `||`—
 * está anotado en las tres.
 */
export function resolveFrontendUrl(config: ConfigService): string {
  const raw = (config.get<string>('FRONTEND_URL') || '').trim();
  return (raw || DEFAULT_FRONTEND_URL).replace(/\/+$/, '');
}

/**
 * La dirección de la página pública de aceptar invitación.
 *
 * El secreto viaja en la ruta y no en la query porque los servidores intermedios
 * registran la query con más alegría, y este valor es una credencial.
 */
export function buildInvitationUrl(frontendUrl: string, secret: string): string {
  return `${frontendUrl.replace(/\/+$/, '')}/portal/invitacion/${secret}`;
}

export interface InvitationEmailInput {
  fullName: string;
  /** Razón social de la empresa, o `null` si no se pudo resolver. */
  clientName: string | null;
  acceptUrl: string;
  expiresAt: Date;
}

/**
 * Fecha legible en hora de Lima, nunca en la del proceso.
 *
 * Producción corre en UTC; imprimir con `toLocaleDateString` sin `timeZone` le
 * diría a un cliente peruano un día distinto del que ve en el portal. Es el
 * mismo fallo que ya mordió una vez en los correos de tickets.
 */
function fechaLegible(d: Date): string {
  return d.toLocaleDateString('es-PE', {
    timeZone: PERU_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * El correo que lleva la invitación.
 *
 * Tono deliberadamente sobrio: sin exclamaciones, sin mayúsculas en el asunto y
 * sin el vocabulario que disparan los filtros («gratis», «urgente», «haz clic
 * aquí»). Es el riesgo número 1 de la spec —que la invitación acabe en no
 * deseado— y lo poco que se puede hacer desde el texto se hace.
 */
export function buildInvitationEmail(input: InvitationEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  // `|| null` y no `?? null`: una razón social guardada como cadena vacía es
  // igual de inservible que la ausencia, y las dos tienen que caer al texto
  // neutro en vez de dejar un hueco en la frase.
  const empresa = (input.clientName || '').trim() || null;
  const deLaEmpresa = empresa ? ` de ${empresa}` : '';
  const caduca = fechaLegible(input.expiresAt);

  const subject = empresa
    ? `Acceso al portal de clientes de ${empresa}`
    : 'Acceso al portal de clientes';

  const text = [
    `Hola ${input.fullName}:`,
    '',
    `Te damos acceso al portal de clientes${deLaEmpresa}. Para entrar, primero`,
    'elige tu contraseña en esta dirección:',
    '',
    input.acceptUrl,
    '',
    `El enlace sirve hasta el ${caduca} y solo se puede usar una vez.`,
    'Si no esperabas este mensaje, puedes ignorarlo.',
  ].join('\n');

  const html = `
    <p>Hola ${input.fullName}:</p>
    <p>Te damos acceso al portal de clientes${deLaEmpresa}. Para entrar, primero
       elige tu contraseña:</p>
    <p><a href="${input.acceptUrl}">Elegir mi contraseña</a></p>
    <p>Si el enlace no funciona, copia esta dirección en tu navegador:<br>
       ${input.acceptUrl}</p>
    <p>El enlace sirve hasta el ${caduca} y solo se puede usar una vez.</p>
    <p>Si no esperabas este mensaje, puedes ignorarlo.</p>
  `.trim();

  return { subject, html, text };
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `cd backend && npx jest src/modules/portal/invitation-email.spec.ts`
Expected: PASS

- [ ] **Step 5: Escribir las pruebas que fallan, del envío y el reenvío**

Añade a `backend/src/modules/portal/portal-invitations.service.spec.ts`. El `makeService` de la Task 5 gana tres dobles más — actualízalo así:

```ts
function makeService(opciones: {
  usuarioExistente?: any;
  invitacionViva?: any;
  pendiente?: any;
  envioFalla?: Error;
} = {}) {
  const escritas: any[] = [];
  const enviados: any[] = [];
  const marcados: any[] = [];

  const invitations = {
    escritas, marcados,
    create: jest.fn(async (d: any) => {
      escritas.push(d);
      return { id: 11, usedAt: null, revokedAt: null, lastSentAt: null, sendError: null,
        createdAt: new Date('2026-08-26T15:00:00.000Z'), ...d };
    }),
    findLiveByEmail: jest.fn(async () => opciones.invitacionViva ?? null),
    listPendingByClient: jest.fn(async () => []),
    findPendingByIdForClient: jest.fn(async () => opciones.pendiente ?? null),
    revokeLiveByEmail: jest.fn(async () => undefined),
    markSent: jest.fn(async (...args: any[]) => {
      marcados.push(args);
    }),
  };

  const clientUsers = { findByEmail: jest.fn(async () => opciones.usuarioExistente ?? null) };

  const email = {
    enviados,
    send: jest.fn(async (input: any) => {
      if (opciones.envioFalla) throw opciones.envioFalla;
      enviados.push(input);
      return { messageId: 'x', accepted: [input.to], rejected: [] };
    }),
  };

  const clients = { findByIdOrFail: jest.fn(async () => ({ id: 7, razonSocial: 'Acme S.A.C.' })) };
  const config = { get: (k: string, f?: string) => (k === 'FRONTEND_URL' ? 'https://kuboti.com' : f) };

  const service = new PortalInvitationsService(
    invitations as any, clientUsers as any, email as any, clients as any, config as any,
  );
  return { service, invitations, clientUsers, email, clients };
}
```

Y las pruebas nuevas:

```ts
describe('el envío de la invitación', () => {
  it('sale en el acto, a la dirección invitada, con el enlace dentro', async () => {
    const { service, email } = makeService();
    await service.invite(7, 3, DTO);

    expect(email.send).toHaveBeenCalledTimes(1);
    const enviado = email.enviados[0];
    expect(enviado.to).toBe('Nuevo@Kuboti.com');
    expect(enviado.html).toMatch(/https:\/\/kuboti\.com\/portal\/invitacion\/[A-Za-z0-9_-]{43}/);
  });

  it('el enlace del correo lleva el secreto que corresponde a la huella guardada', async () => {
    const { service, email, invitations } = makeService();
    await service.invite(7, 3, DTO);

    const secreto = email.enviados[0].html.match(/\/portal\/invitacion\/([A-Za-z0-9_-]{43})/)[1];
    expect(invitations.escritas[0].secretFingerprint).toBe(fingerprintInvitationSecret(secreto));
  });

  /**
   * Decisión 6 de la spec: sin cola no hay reintento automático, así que la
   * invitación NO puede perderse porque el SMTP esté caído. Queda creada, se
   * anota el fallo, y el administrador la ve pendiente con opción de reenviar.
   */
  it('si el correo falla, la invitación queda creada igual y se anota el fallo', async () => {
    const { service, invitations } = makeService({ envioFalla: new Error('SMTP dijo que no') });

    const vista = await service.invite(7, 3, DTO);

    expect(invitations.create).toHaveBeenCalledTimes(1);
    expect(vista.deliveryFailed).toBe(true);
    expect(invitations.marcados[0][2]).toContain('SMTP dijo que no');
  });

  it('un envío correcto deja el registro sin error', async () => {
    const { service, invitations } = makeService();
    const vista = await service.invite(7, 3, DTO);
    expect(invitations.marcados[0][2]).toBeNull();
    expect(vista.deliveryFailed).toBe(false);
  });

  it('el secreto no aparece en la vista que devuelve la petición', async () => {
    const { service, email } = makeService();
    const vista = await service.invite(7, 3, DTO);
    const secreto = email.enviados[0].html.match(/\/portal\/invitacion\/([A-Za-z0-9_-]{43})/)[1];
    expect(JSON.stringify(vista)).not.toContain(secreto);
  });
});

describe('PortalInvitationsService.resend', () => {
  const pendiente = {
    id: '11', clientId: '7', email: 'nuevo@kuboti.com', fullName: 'Nuevo Nombre',
    secretFingerprint: 'a'.repeat(64), invitedByClientUserId: '3',
    expiresAt: new Date('2026-09-02T15:00:00.000Z'),
    usedAt: null, revokedAt: null, lastSentAt: null, sendError: 'fallo viejo',
    acceptedClientUserId: null, createdAt: new Date('2026-08-26T15:00:00.000Z'),
  };

  /**
   * El reenvío emite un secreto NUEVO y revoca el anterior. No se puede
   * reenviar el viejo: no lo tenemos —solo su huella— y ese es justo el punto
   * de guardar solo la huella.
   */
  it('emite un secreto nuevo y deja de servir el anterior', async () => {
    const { service, invitations, email } = makeService({ pendiente });
    await service.resend(7, 11);

    expect(invitations.revokeLiveByEmail).toHaveBeenCalledWith(
      'nuevo@kuboti.com', 7, expect.any(Date),
    );
    const secreto = email.enviados[0].html.match(/\/portal\/invitacion\/([A-Za-z0-9_-]{43})/)[1];
    expect(invitations.escritas[0].secretFingerprint).toBe(fingerprintInvitationSecret(secreto));
  });

  it('conserva el nombre, el correo y quién invitó de la invitación original', async () => {
    const { service, invitations } = makeService({ pendiente });
    await service.resend(7, 11);
    expect(invitations.escritas[0]).toMatchObject({
      clientId: 7, email: 'nuevo@kuboti.com', fullName: 'Nuevo Nombre', invitedByClientUserId: 3,
    });
  });

  it('una invitación de otra empresa responde 404, no 403, y no manda nada', async () => {
    const { service, email } = makeService({ pendiente: null });
    await expect(service.resend(7, 11)).rejects.toThrow(NotFoundException);
    expect(email.send).not.toHaveBeenCalled();
  });
});
```

Añade al principio del fichero `import { NotFoundException } from '@nestjs/common';`.

- [ ] **Step 6: Correr y ver fallar**

Run: `cd backend && npx jest src/modules/portal/portal-invitations.service.spec.ts`
Expected: FAIL — el constructor todavía recibe dos dependencias y `resend` no existe.

- [ ] **Step 7: Mandar el correo desde el servicio**

En `backend/src/modules/portal/portal-invitations.service.ts`, amplía el constructor y añade el envío:

```ts
import { ConfigService } from '@nestjs/config';
import { Logger, NotFoundException } from '@nestjs/common';

import { ClientsService } from '../clients/clients.service';
import { EmailService } from '../email/email.service';
import { resolveClientRazonSocial } from './client-name';
import { buildInvitationEmail, buildInvitationUrl, resolveFrontendUrl } from './invitation-email';
```

```ts
  private readonly logger = new Logger(PortalInvitationsService.name);

  constructor(
    private readonly invitations: ClientUserInvitationsRepository,
    private readonly clientUsers: ClientUsersRepository,
    private readonly email: EmailService,
    private readonly clients: ClientsService,
    private readonly config: ConfigService,
  ) {}
```

`invite` deja de delegar la vista y pasa a mandar el correo:

```ts
  async invite(
    clientId: number,
    invitedByClientUserId: number,
    dto: InvitePortalUserDto,
  ): Promise<PortalInvitationView> {
    const { invitation, secret } = await this.inviteWithSecret(clientId, invitedByClientUserId, dto);
    return this.deliver(invitation, secret);
  }

  /**
   * Vuelve a mandar una invitación pendiente, **con un secreto nuevo**.
   *
   * No se puede reenviar el anterior: solo tenemos su huella, y ese es
   * exactamente el punto de guardar solo la huella. Emitir uno nuevo y revocar
   * el viejo tiene además la propiedad correcta — un enlace que se filtró por
   * el camino deja de servir en cuanto alguien reenvía.
   */
  async resend(clientId: number, invitationId: number): Promise<PortalInvitationView> {
    assertSessionScope(clientId, 'clientId', PortalInvitationsService.name);

    const previa = await this.invitations.findPendingByIdForClient(invitationId, clientId);
    // Una invitación de otra empresa y una que no existe dan esta misma
    // respuesta: 404 y nunca 403.
    if (!previa) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invitación no encontrada' });
    }

    const ahora = new Date();
    await this.invitations.revokeLiveByEmail(previa.email, clientId, ahora);

    const secret = generateInvitationSecret();
    const invitation = await this.invitations.create({
      clientId,
      email: previa.email,
      fullName: previa.fullName,
      secretFingerprint: fingerprintInvitationSecret(secret),
      // Se conserva quién invitó originalmente. Atribuírselo a quien pulsa
      // «reenviar» sería reescribir un hecho pasado.
      invitedByClientUserId: Number(previa.invitedByClientUserId),
      expiresAt: invitationExpiryFrom(ahora),
    });

    return this.deliver(invitation, secret);
  }

  /**
   * Manda el correo y deja constancia del intento.
   *
   * **El fallo del envío no tumba la petición.** Decisión 6 de la spec: la
   * invitación queda creada aunque el correo falle, y la pantalla ofrece
   * reenviar. Propagar aquí el error dejaría al administrador creyendo que no
   * se creó nada cuando sí se creó, y le haría invitar otra vez —revocando la
   * que sí existía— en un bucle sin salida.
   */
  private async deliver(
    invitation: ClientUserInvitation,
    secret: string,
  ): Promise<PortalInvitationView> {
    const acceptUrl = buildInvitationUrl(resolveFrontendUrl(this.config), secret);
    const clientName = await resolveClientRazonSocial(this.clients, Number(invitation.clientId));
    const { subject, html, text } = buildInvitationEmail({
      fullName: invitation.fullName,
      clientName,
      acceptUrl,
      expiresAt: invitation.expiresAt,
    });

    const ahora = new Date();
    try {
      await this.email.send({ to: invitation.email, subject, html, text });
      await this.invitations.markSent(Number(invitation.id), ahora, null);
      return toInvitationView({ ...invitation, lastSentAt: ahora, sendError: null });
    } catch (err) {
      const motivo = (err as Error).message.slice(0, 500);
      // Al log entero, a la base recortado, y a la respuesta NUNCA: el detalle
      // de por qué rechazó el servidor SMTP es diagnóstico interno.
      this.logger.error(
        `No se pudo enviar la invitación ${String(invitation.id)}: ${(err as Error).message}`,
      );
      await this.invitations.markSent(Number(invitation.id), ahora, motivo);
      return toInvitationView({ ...invitation, lastSentAt: ahora, sendError: motivo });
    }
  }
```

- [ ] **Step 8: Añadir la ruta de reenviar**

En `backend/src/modules/portal/portal-users.controller.ts`, junto a las otras dos de invitaciones:

```ts
  @Post('invitaciones/:id/reenviar')
  @HttpCode(200)
  resend(
    @CurrentClientUser() user: AuthClientUser,
    @Param('id', userIdPipe) id: number,
  ): Promise<PortalInvitationView> {
    return this.invitations.resend(user.clientId, id);
  }
```

- [ ] **Step 9: Cablear `EmailModule` en el módulo del portal**

En `backend/src/modules/portal/portal.module.ts`, en `imports`:

```ts
    // Solo se consume `EmailService`, ya exportado por `EmailModule`. La
    // invitación NO va por la cola de avisos (que recorre `ticket_events`):
    // una invitación no es un evento de ticket, y meterla ahí obligaría a
    // inventar un evento falso. Mismo camino que el envío de firmas.
    EmailModule,
```

`ClientsModule` ya está importado desde antes (lo usa `ClientUsersService`), así que `ClientsService` está disponible sin tocar nada más.

- [ ] **Step 10: Correr y ver pasar**

Run: `cd backend && npx jest src/modules/portal/`
Expected: PASS

- [ ] **Step 11: Suite completa y compilador**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add backend/src/modules/portal/invitation-email.ts \
        backend/src/modules/portal/invitation-email.spec.ts \
        backend/src/modules/portal/portal-invitations.service.ts \
        backend/src/modules/portal/portal-invitations.service.spec.ts \
        backend/src/modules/portal/portal-users.controller.ts \
        backend/src/modules/portal/portal.module.ts
git commit -m "feat(portal): la invitacion sale en el acto por SMTP y el reenvio hace de reintento"
```

---

### Task 7: Aceptar — una sola transacción, y todos los fallos responden lo mismo

**Files:**
- Create: `backend/src/modules/portal/dto/accept-invitation.dto.ts`
- Create: `backend/src/modules/portal/portal-invitations.controller.ts`
- Create: `backend/src/modules/portal/portal-invitations.accept.spec.ts`
- Modify: `backend/src/modules/portal/portal-invitations.service.ts`
- Modify: `backend/src/config/throttler.config.ts`
- Modify: `backend/src/modules/portal/portal.module.ts`

**Interfaces:**
- Consume:
  - Task 2: `fingerprintInvitationSecret`, `isInvitationExpired`.
  - Task 3: `ClientUserInvitationsRepository.runInTransaction`, la entidad `ClientUserInvitation`, `normalizeEmailAddress`.
  - Task 5/6: `PortalInvitationsService`, sus cinco dependencias de constructor.
  - Existente: `ClientUser`, `Client` (`status: 'PROSPECT' | 'CLIENT' | 'FORMER_CLIENT'`), `THROTTLER_BURST`/`THROTTLER_SUSTAINED` de `config/throttler.config.ts`, `ApiThrottlerGuard`.
- Produce:
  - `AcceptInvitationDto` desde `dto/accept-invitation.dto.ts`: `{ secret: string; password: string; passwordConfirmation: string }`.
  - `INVITATION_INVALID_MESSAGE: string` exportado desde `portal-invitations.service.ts`.
  - `PortalInvitationsService.accept(dto: AcceptInvitationDto): Promise<{ email: string }>`.
  - `PORTAL_INVITATION_THROTTLE` desde `config/throttler.config.ts`.
  - Ruta pública `POST /portal/invitaciones/aceptar`.

Decisiones de forma que hay que respetar al pie de la letra:

- **No hay ruta `GET` para consultar una invitación.** La página pide contraseña y su confirmación y ya está: no pide el correo (ya lo lleva la invitación, y pedirlo permitiría probar direcciones) y no hay ninguna superficie que responda «este enlace vale» sin consumirlo.
- **Aceptar no inicia sesión.** Devuelve el correo con el que la persona tiene que entrar, y la pantalla la manda al login. Es el paso 6 del recorrido de la spec.
- **La confirmación de contraseña se comprueba ANTES que el enlace.** Al revés, mandar dos contraseñas distintas serviría de oráculo: un 400 de validación significaría «el enlace es bueno» y el cuerpo genérico significaría «no lo es».

- [ ] **Step 1: Escribir las pruebas que fallan**

`backend/src/modules/portal/portal-invitations.accept.spec.ts`:

```ts
import * as bcrypt from 'bcrypt';

import { INVITATION_INVALID_MESSAGE, PortalInvitationsService } from './portal-invitations.service';
import { fingerprintInvitationSecret } from './domain/invitation-secret';

/**
 * Un secreto cualquiera de pruebas. No hace falta que salga de
 * `generateInvitationSecret`: lo que se ejerce aquí es que la búsqueda vaya
 * por su huella, y la huella se calcula igual venga de donde venga.
 */
const SECRETO = 'secreto-de-pruebas-de-la-invitacion';

/** Invitación tal como la devuelve TypeORM: los `bigint` salen como CADENA. */
function invitacion(over: Record<string, unknown> = {}) {
  return {
    id: '11',
    clientId: '7',
    email: 'nuevo@kuboti.com',
    fullName: 'Nuevo Nombre',
    secretFingerprint: fingerprintInvitationSecret(SECRETO),
    invitedByClientUserId: '3',
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    usedAt: null,
    acceptedClientUserId: null,
    revokedAt: null,
    lastSentAt: null,
    sendError: null,
    createdAt: new Date('2026-08-26T15:00:00.000Z'),
    ...over,
  } as any;
}

/**
 * Doble del `EntityManager` de una transacción. `runInTransaction` invoca el
 * callback con él y **descarta lo pendiente si el callback lanza**, que es lo
 * que hace un ROLLBACK: por eso las escrituras se acumulan en `pendientes` y
 * solo se vuelcan a `confirmadas` cuando el callback termina bien. Mismo
 * criterio que el doble de `tickets.service.spec.ts`.
 */
function makeService(opciones: {
  fila?: any;
  invitador?: any;
  empresa?: any;
  fallaEn?: 'usuario' | 'marcado';
  filasAfectadasAlMarcar?: number;
} = {}) {
  const pendientes = { usuarios: [] as any[], marcados: [] as any[] };
  const confirmadas = { usuarios: [] as any[], marcados: [] as any[] };
  /** Toda consulta que llega al repositorio de invitaciones, para inspeccionarla. */
  const consultas: any[] = [];

  const manager = {
    getRepository: (entidad: any) => {
      const nombre = entidad?.name ?? '';
      if (nombre === 'ClientUser') {
        return {
          create: (d: any) => d,
          save: async (d: any) => {
            if (opciones.fallaEn === 'usuario') throw new Error('fallo al guardar el usuario');
            pendientes.usuarios.push(d);
            return { id: '55', ...d };
          },
        };
      }
      return {
        findOne: async (args: any) => {
          consultas.push(args);
          return opciones.fila ?? null;
        },
        update: async (where: any, patch: any) => {
          if (opciones.fallaEn === 'marcado') throw new Error('fallo al marcar la invitación');
          pendientes.marcados.push([where, patch]);
          return { affected: opciones.filasAfectadasAlMarcar ?? 1 };
        },
      };
    },
  };

  const invitations = {
    runInTransaction: jest.fn(async (work: (m: any) => Promise<unknown>) => {
      const r = await work(manager);
      confirmadas.usuarios.push(...pendientes.usuarios);
      confirmadas.marcados.push(...pendientes.marcados);
      return r;
    }),
    create: jest.fn(),
    findLiveByEmail: jest.fn(async () => null),
    listPendingByClient: jest.fn(async () => []),
    findPendingByIdForClient: jest.fn(async () => null),
    revokeLiveByEmail: jest.fn(async () => undefined),
    markSent: jest.fn(async () => undefined),
  };

  const clientUsers = {
    findByEmail: jest.fn(async () => null),
    findById: jest.fn(async () => opciones.invitador ?? { id: '3', isActive: 1 }),
  };
  const email = { send: jest.fn(async () => ({ messageId: 'x', accepted: [], rejected: [] })) };
  const clients = {
    findByIdOrFail: jest.fn(async () => opciones.empresa ?? { id: 7, razonSocial: 'Acme', status: 'CLIENT' }),
  };
  const config = { get: (k: string, f?: string) => f };

  const service = new PortalInvitationsService(
    invitations as any, clientUsers as any, email as any, clients as any, config as any,
  );
  return { service, invitations, clientUsers, confirmadas, consultas };
}

const BUENO = { secret: SECRETO, password: 'contrasena-larga', passwordConfirmation: 'contrasena-larga' };

describe('aceptar una invitación', () => {
  it('crea el usuario con el nombre, el correo y la empresa DE LA INVITACIÓN', async () => {
    const { service, confirmadas } = makeService({ fila: invitacion() });
    await service.accept(BUENO);

    expect(confirmadas.usuarios[0]).toMatchObject({
      clientId: 7,
      email: 'nuevo@kuboti.com',
      fullName: 'Nuevo Nombre',
    });
  });

  /**
   * La empresa sale de la invitación, jamás de nada que ponga quien acepta.
   * Con la petición manipulada, no confiando en el tipo.
   */
  it('ignora una empresa colada en el cuerpo de quien acepta', async () => {
    const { service, confirmadas } = makeService({ fila: invitacion() });
    await service.accept({ ...BUENO, clientId: 99 } as any);
    expect(confirmadas.usuarios[0].clientId).toBe(7);
  });

  /**
   * Decisión 2 de la spec: no se puede crear un administrador desde el portal
   * ni aunque la petición lo pida explícitamente.
   */
  it('el usuario nace SIN ser administrador aunque el cuerpo lo pida', async () => {
    const { service, confirmadas } = makeService({ fila: invitacion() });
    await service.accept({ ...BUENO, isAdmin: true } as any);
    expect(confirmadas.usuarios[0].isAdmin).toBe(0);
  });

  it('la autoría queda honesta: sin personal inventado y con el administrador que invitó', async () => {
    const { service, confirmadas } = makeService({ fila: invitacion() });
    await service.accept(BUENO);
    expect(confirmadas.usuarios[0].createdBy).toBeNull();
    expect(confirmadas.usuarios[0].createdByClientUserId).toBe(3);
  });

  it('la contraseña se guarda cifrada, nunca en claro', async () => {
    const { service, confirmadas } = makeService({ fila: invitacion() });
    await service.accept(BUENO);
    const hash = confirmadas.usuarios[0].passwordHash;
    expect(hash).not.toBe(BUENO.password);
    expect(await bcrypt.compare(BUENO.password, hash)).toBe(true);
  });

  /**
   * La búsqueda va por huella. Si alguna consulta llevara el secreto en claro
   * significaría que existe una columna que lo guarda —o que alguien piensa
   * que existe—, y esta funcionalidad entera se apoya en que no.
   */
  it('busca por huella, y el secreto en claro no aparece en ninguna consulta', async () => {
    const { service, consultas, confirmadas } = makeService({ fila: invitacion() });
    await service.accept(BUENO);

    expect(consultas[0].where.secretFingerprint).toBe(fingerprintInvitationSecret(SECRETO));
    expect(JSON.stringify(consultas)).not.toContain(SECRETO);
    expect(JSON.stringify(confirmadas)).not.toContain(SECRETO);
  });

  it('marca la invitación como usada y anota quién la aceptó', async () => {
    const { service, confirmadas } = makeService({ fila: invitacion() });
    await service.accept(BUENO);
    const [, patch] = confirmadas.marcados[0];
    expect(patch.usedAt).toBeInstanceOf(Date);
    expect(patch.acceptedClientUserId).toBe(55);
  });

  it('devuelve el correo con el que entrar, y ningún token de sesión', async () => {
    const { service } = makeService({ fila: invitacion() });
    const r = await service.accept(BUENO);
    expect(r).toEqual({ email: 'nuevo@kuboti.com' });
  });
});

describe('la transacción de aceptar es todo o nada', () => {
  it.each([
    ['al crear el usuario', 'usuario'],
    ['al marcar la invitación como usada', 'marcado'],
  ] as const)('si falla %s no queda ni usuario ni invitación gastada', async (_d, punto) => {
    const { service, confirmadas } = makeService({ fila: invitacion(), fallaEn: punto });

    await expect(service.accept(BUENO)).rejects.toThrow();

    expect(confirmadas.usuarios).toHaveLength(0);
    expect(confirmadas.marcados).toHaveLength(0);
  });

  /**
   * La carrera de dos aceptaciones simultáneas. El `UPDATE` va condicionado a
   * que la invitación siga sin usar; si no afectó a ninguna fila es que otra
   * petición se adelantó, y hay que reventar la transacción para que el
   * usuario que esta acababa de crear no sobreviva.
   */
  it('si el marcado no afecta a ninguna fila, el usuario tampoco queda', async () => {
    const { service, confirmadas } = makeService({
      fila: invitacion(),
      filasAfectadasAlMarcar: 0,
    });

    await expect(service.accept(BUENO)).rejects.toMatchObject({
      response: { message: INVITATION_INVALID_MESSAGE },
    });
    expect(confirmadas.usuarios).toHaveLength(0);
  });
});

describe('todos los fallos al aceptar responden exactamente lo mismo', () => {
  const casos: Array<[string, Parameters<typeof makeService>[0]]> = [
    ['no existe', { fila: null }],
    ['caducada', { fila: invitacion({ expiresAt: new Date(Date.now() - 1000) }) }],
    ['ya usada', { fila: invitacion({ usedAt: new Date() }) }],
    ['revocada por otra posterior', { fila: invitacion({ revokedAt: new Date() }) }],
    ['quien invitó está desactivado', { fila: invitacion(), invitador: { id: '3', isActive: 0 } }],
    [
      'la empresa ya no es cliente',
      { fila: invitacion(), empresa: { id: 7, razonSocial: 'Acme', status: 'FORMER_CLIENT' } },
    ],
  ];

  it.each(casos)('%s falla', async (_nombre, opciones) => {
    const { service } = makeService(opciones);
    await expect(service.accept(BUENO)).rejects.toMatchObject({
      response: { code: 'INVITACION_NO_VALIDA', message: INVITATION_INVALID_MESSAGE },
    });
  });

  /**
   * LA PRUEBA QUE PIDE LA SPEC: no basta con que los seis fallen; los CUERPOS
   * tienen que ser idénticos entre sí, byte a byte. La diferencia entre «no
   * existe», «caducada» y «ya usada» solo le sirve a quien está probando.
   */
  it('los cuerpos de respuesta son idénticos entre sí', async () => {
    const cuerpos = [];
    for (const [, opciones] of casos) {
      const { service } = makeService(opciones);
      cuerpos.push(await service.accept(BUENO).catch((e) => JSON.stringify(e.getResponse())));
    }
    expect(new Set(cuerpos).size).toBe(1);
  });

  it('y ninguno de ellos deja usuario creado', async () => {
    for (const [, opciones] of casos) {
      const { service, confirmadas } = makeService(opciones);
      await service.accept(BUENO).catch(() => undefined);
      expect(confirmadas.usuarios).toHaveLength(0);
    }
  });
});

describe('la contraseña', () => {
  /**
   * La confirmación se comprueba ANTES de mirar el enlace. Al revés, mandar
   * dos contraseñas distintas serviría de oráculo: un error de validación
   * significaría "el enlace es bueno" y el cuerpo genérico, "no lo es".
   */
  it('si las dos no coinciden falla por eso, sin llegar a mirar el enlace', async () => {
    const { service, invitations } = makeService({ fila: null });
    await expect(
      service.accept({ ...BUENO, passwordConfirmation: 'otra-cosa-distinta' }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(invitations.runInTransaction).not.toHaveBeenCalled();
  });

  it('el mensaje de la confirmación va en español y no menciona el enlace', async () => {
    const { service } = makeService({ fila: invitacion() });
    const cuerpo = await service
      .accept({ ...BUENO, passwordConfirmation: 'otra-cosa-distinta' })
      .catch((e) => e.getResponse());
    expect(cuerpo.message).toMatch(/no coinciden/i);
    expect(cuerpo.message).not.toMatch(/enlace|invitaci/i);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `cd backend && npx jest src/modules/portal/portal-invitations.accept.spec.ts`
Expected: FAIL — `accept` no existe todavía.

- [ ] **Step 3: Escribir el DTO de aceptación**

`backend/src/modules/portal/dto/accept-invitation.dto.ts`:

```ts
import { IsString, MinLength } from 'class-validator';

/**
 * Lo que manda la página pública de aceptar invitación.
 *
 * **Sin correo.** Ya lo lleva la invitación, y pedirlo permitiría probar
 * direcciones: quien tuviera un enlace podría averiguar si una dirección
 * cualquiera está registrada según cómo respondiera.
 *
 * **Sin `clientId` y sin `isAdmin`.** La empresa sale de la invitación, y un
 * administrador de cliente no puede nombrar administradores. Con
 * `forbidNonWhitelisted` mandarlos ya devuelve 400 antes de llegar al
 * servicio; que además el servicio no los lea es la primera barrera, no la
 * segunda.
 *
 * El mínimo de 8 caracteres es el mismo que ya rige en `CreateClientUserDto`
 * para el alta desde el panel: aquí no se inventan reglas nuevas.
 */
export class AcceptInvitationDto {
  @IsString({ message: 'El enlace no es válido o ha caducado.' })
  @MinLength(1, { message: 'El enlace no es válido o ha caducado.' })
  secret!: string;

  @IsString({ message: 'La contraseña es obligatoria.' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  password!: string;

  @IsString({ message: 'Repite la contraseña.' })
  @MinLength(8, { message: 'Repite la contraseña.' })
  passwordConfirmation!: string;
}
```

- [ ] **Step 4: Escribir `accept` en el servicio**

En `backend/src/modules/portal/portal-invitations.service.ts`:

```ts
import * as bcrypt from 'bcrypt';
import { IsNull } from 'typeorm';

import { ClientUser } from './entities/client-user.entity';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { isInvitationExpired } from './domain/invitation-secret';

/**
 * Mismo coste que el resto del portal (`ClientUsersService.BCRYPT_ROUNDS` y el
 * hash señuelo de `PortalAuthService`). No se inventa uno nuevo: un alta con
 * otro coste reabriría el canal de tiempos que ese señuelo existe para cerrar.
 */
const BCRYPT_ROUNDS = 10;

/**
 * Único cuerpo para CUALQUIER fallo al aceptar: no existe, caducada, ya usada,
 * revocada, quien invitó está desactivado, o la empresa dejó de ser cliente.
 *
 * No se distinguen porque la diferencia solo le sirve a quien está probando
 * enlaces. Es la superficie más expuesta del producto —abierta a internet y sin
 * autenticar— y lo que da a cambio es una credencial.
 */
export const INVITATION_INVALID_MESSAGE =
  'El enlace no es válido o ha caducado. Pide a quien te invitó que te mande uno nuevo.';
```

y el método:

```ts
  /**
   * Convierte una invitación en un usuario. **Una sola transacción**: o quedan
   * el usuario creado y la invitación consumida, o no queda nada.
   *
   * No inicia sesión: devuelve el correo con el que la persona tiene que
   * entrar, y la pantalla la manda al login. Es el paso 6 del recorrido de la
   * spec, y evita que esta ruta pública emita tokens.
   */
  async accept(dto: AcceptInvitationDto): Promise<{ email: string }> {
    // ANTES de tocar nada: si las dos contraseñas no coinciden, eso se dice y
    // punto. Comprobarlo después del enlace convertiría el par
    // "error de validación" / "cuerpo genérico" en un oráculo de si el enlace
    // vale.
    if (dto.password !== dto.passwordConfirmation) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Las dos contraseñas no coinciden.',
      });
    }

    const huella = fingerprintInvitationSecret(dto.secret);
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const ahora = new Date();

    return this.invitations.runInTransaction(async (manager) => {
      const invRepo = manager.getRepository(ClientUserInvitation);
      const userRepo = manager.getRepository(ClientUser);

      // Se busca POR HUELLA, nunca por el secreto: el secreto no está en la
      // base y no puede estarlo. El bloqueo de escritura es lo que cierra la
      // carrera de dos aceptaciones simultáneas del mismo enlace.
      const inv = await invRepo.findOne({
        where: { secretFingerprint: huella },
        lock: { mode: 'pessimistic_write' },
      });

      if (!inv) throw enlaceNoValido();
      if (inv.usedAt || inv.revokedAt) throw enlaceNoValido();
      // Contra un instante absoluto, nunca contra una fecha civil derivada de
      // la zona del proceso: producción corre en UTC y el desarrollo en Lima.
      if (isInvitationExpired(inv.expiresAt, ahora)) throw enlaceNoValido();

      // Se invalida sola si quien invitó quedó desactivado, o si la empresa
      // dejó de ser cliente. Se comprueba AQUÍ, al aceptar, no por un proceso
      // aparte que podría no haber corrido todavía.
      const invitador = await this.clientUsers.findById(Number(inv.invitedByClientUserId));
      if (!invitador || !invitador.isActive) throw enlaceNoValido();

      // Solo el "no existe" degrada a enlace no válido. Cualquier otro fallo
      // —la base caída, por ejemplo— sigue subiendo: silenciarlo lo disfrazaría
      // de "invitación mala" y perdería el 500 que de verdad es. Mismo criterio
      // que `resolveClientRazonSocial` en `client-name.ts`.
      const empresa = await this.clients.findByIdOrFail(Number(inv.clientId)).catch((err) => {
        if (err instanceof NotFoundException) return null;
        throw err;
      });
      // `FORMER_CLIENT` es lo que este producto llama "empresa desactivada":
      // `clients` no tiene `is_active`, tiene `status` (ver `client.entity.ts`).
      if (!empresa || empresa.status === 'FORMER_CLIENT') throw enlaceNoValido();

      const usuario = await userRepo.save(
        userRepo.create({
          // Todo sale de la invitación. Nada del cuerpo.
          clientId: Number(inv.clientId),
          email: inv.email,
          passwordHash,
          fullName: inv.fullName,
          // Literal, no un valor calculado ni leído de ningún sitio: desde el
          // portal no se puede nombrar a un administrador, y este `0` es el
          // sitio donde eso se hace verdad.
          isAdmin: 0,
          isActive: 1,
          // Autoría honesta: no hubo personal, hubo un administrador de cliente.
          createdBy: null,
          createdByClientUserId: Number(inv.invitedByClientUserId),
        }),
      );

      // El `usedAt: IsNull()` del WHERE es la otra mitad del uso único: si otra
      // petición se adelantó, este UPDATE no afecta a ninguna fila y hay que
      // reventar para que el usuario recién creado no sobreviva al commit.
      const marcado = await invRepo.update(
        { id: inv.id, usedAt: IsNull() },
        { usedAt: ahora, acceptedClientUserId: Number(usuario.id) },
      );
      if (marcado.affected !== 1) throw enlaceNoValido();

      return { email: inv.email };
    });
  }
```

y el ayudante, junto a `invitacionRechazada`:

```ts
function enlaceNoValido(): BadRequestException {
  return new BadRequestException({
    code: 'INVITACION_NO_VALIDA',
    message: INVITATION_INVALID_MESSAGE,
  });
}
```

- [ ] **Step 5: Añadir el tope de intentos a la configuración**

En `backend/src/config/throttler.config.ts`, al final:

```ts
/**
 * Override para `POST /portal/invitaciones/aceptar`.
 *
 * Es la tercera superficie del producto abierta a internet y la primera sin
 * autenticar que entrega una credencial. El contador va **por dirección de
 * origen** (`ThrottlerGuard.getTracker` usa `req.ip`), nunca por el secreto:
 * contar por secreto permitiría distinguir un enlace que existe de uno que no
 * según cuál empezara a devolver 429 antes, deshaciendo justo el trabajo de
 * que todos los fallos respondan lo mismo.
 *
 * Falla cerrado por construcción: el guard corre ANTES del pipe y ANTES del
 * servicio, así que cuenta todas las peticiones por igual —válidas, inválidas
 * y malformadas—, y si su almacén de contadores revienta, la excepción sube y
 * la petición no se atiende. Misma disciplina que los topes del correo
 * entrante: un tope que falla abierto no es un tope.
 *
 * Los límites son los del login, no los del refresco: aceptar una invitación
 * es algo que una persona hace una vez, y adivinar un secreto de 32 bytes no
 * es el escenario —el escenario es el ruido y el abuso.
 */
export const PORTAL_INVITATION_THROTTLE = {
  [THROTTLER_BURST]: { ttl: ONE_MINUTE_MS, limit: 5 },
  [THROTTLER_SUSTAINED]: { ttl: FIFTEEN_MINUTES_MS, limit: 20 },
};
```

- [ ] **Step 6: Escribir el controlador público**

`backend/src/modules/portal/portal-invitations.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ApiThrottlerGuard } from '../../common/guards/api-throttler.guard';
import { PORTAL_INVITATION_THROTTLE } from '../../config/throttler.config';
import { PortalInvitationsService } from './portal-invitations.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';

/**
 * **La única ruta del portal sin sesión que entrega una credencial.**
 *
 * Sin `ClientJwtGuard` a propósito: quien acepta una invitación todavía no
 * tiene cuenta, así que no puede tener token. Lo que sí lleva es el tope de
 * intentos, igual que `PortalAuthController` — el guard va a nivel de
 * controlador para que una segunda ruta aquí lo herede sin que nadie tenga que
 * acordarse.
 *
 * NO hay ruta `GET` para consultar una invitación, y su ausencia es deliberada:
 * sería una superficie que responde «este enlace vale» sin consumirlo, justo el
 * oráculo que el cuerpo de error único existe para negar.
 */
@Controller('portal/invitaciones')
@UseGuards(ApiThrottlerGuard)
export class PortalInvitationsController {
  constructor(private readonly service: PortalInvitationsService) {}

  /**
   * Devuelve solo el correo con el que entrar. **No emite tokens**: la persona
   * pasa por el login como cualquier otra, y así esta ruta pública nunca es una
   * vía para obtener una sesión sin escribir una contraseña.
   */
  @Post('aceptar')
  @HttpCode(200)
  @Throttle(PORTAL_INVITATION_THROTTLE)
  accept(@Body() dto: AcceptInvitationDto): Promise<{ email: string }> {
    return this.service.accept(dto);
  }
}
```

- [ ] **Step 7: Cablear en el módulo**

En `backend/src/modules/portal/portal.module.ts`, añade `PortalInvitationsController` a `controllers` con su `import`. El `ThrottlerModule.forRoot` ya está registrado en este módulo desde el portal de clientes, así que `ApiThrottlerGuard` tiene sus proveedores disponibles sin tocar nada más.

- [ ] **Step 8: Correr y ver pasar**

Run: `cd backend && npx jest src/modules/portal/`
Expected: PASS

- [ ] **Step 9: Suite completa y compilador**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/portal/dto/accept-invitation.dto.ts \
        backend/src/modules/portal/portal-invitations.controller.ts \
        backend/src/modules/portal/portal-invitations.accept.spec.ts \
        backend/src/modules/portal/portal-invitations.service.ts \
        backend/src/config/throttler.config.ts \
        backend/src/modules/portal/portal.module.ts
git commit -m "feat(portal): aceptar la invitacion es una sola transaccion y todos sus fallos responden igual"
```

---

### Task 8: La frontera, atravesando el ciclo completo de la petición

**Files:**
- Create: `backend/src/modules/portal/portal-users.integration.spec.ts`

**Interfaces:**
- Consume: los dos controladores (`PortalUsersController`, `PortalInvitationsController`), `ClientJwtStrategy`, `ClientAdminGuard`, `PortalUsersService`, `PortalInvitationsService`, `INVITE_REJECTED_MESSAGE`, `INVITATION_INVALID_MESSAGE`, `UNEXPECTED_PROPERTY_MESSAGE` de `common/validation/validation-pipe.factory`, `startTestHttpApp`/`TestHttpApp` de `test-utils/test-http-app`.
- Produce: nada que consuman otras tareas. Es el gate que demuestra que la frontera existe **montada**, no solo escrita.

Por qué esta tarea existe aparte: las pruebas de servicio de las tareas 4 a 7 comprueban las reglas, pero no que los guards estén puestos, que el orden guard → pipe → controlador sea el correcto, ni qué cuerpo sale de verdad tras pasar por el `HttpExceptionFilter`. Con solo aquellas, quitar `@UseGuards(ClientJwtGuard, ClientAdminGuard)` del controlador dejaría la suite entera en verde. Es exactamente el argumento que ya escribió `auth-boundary.integration.spec.ts`; esto lo extiende a la superficie nueva.

- [ ] **Step 1: Escribir la prueba de integración que falla**

`backend/src/modules/portal/portal-users.integration.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import { PORTAL_AUTH_THROTTLERS } from '../../config/throttler.config';
import { UNEXPECTED_PROPERTY_MESSAGE } from '../../common/validation/validation-pipe.factory';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { ClientJwtStrategy } from './strategies/client-jwt.strategy';
import { PortalUsersController } from './portal-users.controller';
import { PortalUsersService } from './portal-users.service';
import { PortalInvitationsController } from './portal-invitations.controller';
import {
  INVITATION_INVALID_MESSAGE,
  INVITE_REJECTED_MESSAGE,
  PortalInvitationsService,
} from './portal-invitations.service';

/**
 * La frontera de la gestión de usuarios desde el portal, atravesando el ciclo
 * completo: guard de sesión → guard de administrador → `ValidationPipe` →
 * controlador → `HttpExceptionFilter`.
 *
 * Las pruebas de servicio comprueban las reglas; estas comprueban que están
 * MONTADAS. Sin ellas, quitar `@UseGuards(ClientJwtGuard, ClientAdminGuard)`
 * del controlador dejaría la suite en verde. Mismo argumento, y mismo
 * andamiaje, que `auth-boundary.integration.spec.ts`.
 */

const CLIENT_ACCESS_SECRET = 'secreto-de-pruebas-del-portal';
const jwt = new JwtService({});

function tokenDe(payload: Record<string, unknown>): string {
  return jwt.sign(payload, { secret: CLIENT_ACCESS_SECRET, expiresIn: '5m' });
}

/** Quita del cuerpo lo que cambia entre dos respuestas por fuerza. */
function cuerpoComparable(body: any) {
  const { timestamp, ...resto } = body ?? {};
  return resto;
}

describe('Portal — gestión de usuarios (integración HTTP)', () => {
  let app: TestHttpApp;
  let admin: string;
  let normal: string;
  let usersList: jest.Mock;
  let usersDeactivate: jest.Mock;
  let invite: jest.Mock;
  let accept: jest.Mock;

  beforeAll(async () => {
    usersList = jest.fn().mockResolvedValue([]);
    usersDeactivate = jest.fn().mockResolvedValue({ id: 5, isActive: false });
    invite = jest.fn().mockResolvedValue({ id: 11 });
    accept = jest.fn().mockResolvedValue({ email: 'nuevo@kuboti.com' });

    const config = {
      get: (key: string, fallback?: string) =>
        ({ JWT_CLIENT_ACCESS_SECRET: CLIENT_ACCESS_SECRET })[key] ?? fallback,
    };

    const moduleRef = await Test.createTestingModule({
      // El throttler no es el objeto de esta prueba, pero sin él
      // `PortalInvitationsController` no se puede instanciar.
      imports: [PassportModule, ThrottlerModule.forRoot({ throttlers: PORTAL_AUTH_THROTTLERS })],
      controllers: [PortalUsersController, PortalInvitationsController],
      providers: [
        { provide: ConfigService, useValue: config },
        ClientJwtStrategy,
        {
          provide: PortalUsersService,
          useValue: { list: usersList, deactivate: usersDeactivate },
        },
        {
          provide: PortalInvitationsService,
          useValue: {
            invite,
            listPending: jest.fn().mockResolvedValue([]),
            resend: jest.fn().mockResolvedValue({ id: 11 }),
            accept,
          },
        },
      ],
    }).compile();

    app = await startTestHttpApp(moduleRef);
    admin = tokenDe({ sub: 3, email: 'jefe@kuboti.com', clientId: 7, isClientAdmin: true });
    normal = tokenDe({ sub: 4, email: 'curro@kuboti.com', clientId: 7, isClientAdmin: false });
  });

  afterAll(() => app.close());

  describe('las guardas están montadas de verdad', () => {
    it.each([
      ['GET', '/portal/usuarios'],
      ['GET', '/portal/usuarios/invitaciones'],
      ['POST', '/portal/usuarios/invitaciones'],
      ['POST', '/portal/usuarios/5/desactivar'],
      ['POST', '/portal/usuarios/invitaciones/11/reenviar'],
    ])('%s %s sin token responde 401', async (metodo, ruta) => {
      const res = await app.request(metodo, ruta, { body: metodo === 'POST' ? {} : undefined });
      expect(res.status).toBe(401);
    });

    it.each([
      ['GET', '/portal/usuarios'],
      ['POST', '/portal/usuarios/5/desactivar'],
    ])('%s %s con un usuario que no es administrador responde 403', async (metodo, ruta) => {
      const res = await app.request(metodo, ruta, {
        token: normal,
        body: metodo === 'POST' ? {} : undefined,
      });
      expect(res.status).toBe(403);
    });

    it('el servicio ni se llega a tocar cuando el guard corta', async () => {
      usersList.mockClear();
      await app.get('/portal/usuarios', { token: normal });
      expect(usersList).not.toHaveBeenCalled();
    });

    /**
     * Un token manipulado puede traer `1` o `"true"` donde debería ir un
     * booleano. Solo `true` abre la puerta.
     */
    it.each([[1], ['true'], [null]])(
      'un isClientAdmin que no es el booleano true (%s) no pasa',
      async (valor) => {
        const raro = tokenDe({ sub: 4, email: 'x@y.com', clientId: 7, isClientAdmin: valor });
        expect((await app.get('/portal/usuarios', { token: raro })).status).toBe(403);
      },
    );
  });

  describe('la empresa viene de la sesión, no del cuerpo', () => {
    /**
     * LA PRUEBA QUE PIDE LA SPEC, con la petición manipulada y no confiando en
     * el tipo: una empresa ajena en el cuerpo se ignora. Aquí la corta el
     * `ValidationPipe` global con `forbidNonWhitelisted`, que es la segunda
     * barrera; la primera —que el servicio no lo lea aunque llegue— la
     * comprueba `portal-invitations.service.spec.ts`.
     */
    it('un clientId ajeno en el cuerpo del alta se rechaza con el texto genérico', async () => {
      const res = await app.post('/portal/usuarios/invitaciones', {
        token: admin,
        body: { email: 'nuevo@kuboti.com', fullName: 'Nuevo', clientId: 99 },
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(UNEXPECTED_PROPERTY_MESSAGE);
      // Y el nombre de la propiedad NO sale en la respuesta: confirmársela al
      // atacante sería regalarle justo lo que estaba buscando.
      expect(JSON.stringify(res.body)).not.toContain('clientId');
    });

    it('nunca llega al servicio una petición con clientId en el cuerpo', async () => {
      invite.mockClear();
      await app.post('/portal/usuarios/invitaciones', {
        token: admin,
        body: { email: 'nuevo@kuboti.com', fullName: 'Nuevo', clientId: 99 },
      });
      expect(invite).not.toHaveBeenCalled();
    });

    it('cuando el alta es legítima, el controlador pasa el clientId DEL TOKEN', async () => {
      invite.mockClear();
      await app.post('/portal/usuarios/invitaciones', {
        token: admin,
        body: { email: 'nuevo@kuboti.com', fullName: 'Nuevo' },
      });
      expect(invite).toHaveBeenCalledWith(7, 3, expect.objectContaining({
        email: 'nuevo@kuboti.com',
      }));
    });
  });

  describe('no se puede nombrar un administrador desde el portal', () => {
    it('un isAdmin en el alta se rechaza y no llega al servicio', async () => {
      invite.mockClear();
      const res = await app.post('/portal/usuarios/invitaciones', {
        token: admin,
        body: { email: 'nuevo@kuboti.com', fullName: 'Nuevo', isAdmin: true },
      });
      expect(res.status).toBe(400);
      expect(invite).not.toHaveBeenCalled();
    });

    it('un isAdmin al aceptar tampoco pasa', async () => {
      accept.mockClear();
      const res = await app.post('/portal/invitaciones/aceptar', {
        body: {
          secret: 'x'.repeat(43),
          password: 'contrasena-larga',
          passwordConfirmation: 'contrasena-larga',
          isAdmin: true,
        },
      });
      expect(res.status).toBe(400);
      expect(accept).not.toHaveBeenCalled();
    });
  });

  describe('la página de aceptar es pública', () => {
    it('acepta una petición SIN ningún token', async () => {
      const res = await app.post('/portal/invitaciones/aceptar', {
        body: {
          secret: 'x'.repeat(43),
          password: 'contrasena-larga',
          passwordConfirmation: 'contrasena-larga',
        },
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ email: 'nuevo@kuboti.com' });
    });

    it('no existe ninguna ruta GET que consulte una invitación por su secreto', async () => {
      const res = await app.get(`/portal/invitaciones/${'x'.repeat(43)}`);
      expect(res.status).toBe(404);
    });
  });

  describe('todos los fallos al aceptar salen iguales por el cable', () => {
    /**
     * La comprobación de las tareas anteriores es sobre el cuerpo que lanza el
     * servicio. Esta es sobre el JSON que sale de verdad tras el
     * `HttpExceptionFilter`, que añade `statusCode`, `path`, `details` y
     * `timestamp`: si alguno de esos delatara el motivo, el trabajo de igualar
     * los mensajes no habría servido de nada.
     */
    it('los tres motivos dan la misma respuesta HTTP, byte a byte salvo la marca de tiempo', async () => {
      const cuerpos = [];
      for (const _motivo of ['no existe', 'caducada', 'ya usada']) {
        accept.mockRejectedValueOnce(
          new BadRequestException({
            code: 'INVITACION_NO_VALIDA',
            message: INVITATION_INVALID_MESSAGE,
          }),
        );
        const res = await app.post('/portal/invitaciones/aceptar', {
          body: {
            secret: 'x'.repeat(43),
            password: 'contrasena-larga',
            passwordConfirmation: 'contrasena-larga',
          },
        });
        cuerpos.push(JSON.stringify({ status: res.status, body: cuerpoComparable(res.body) }));
      }
      expect(new Set(cuerpos).size).toBe(1);
    });
  });

  describe('el error de invitar tampoco dice si el correo existe', () => {
    it('sale el texto genérico y ningún dato de la dirección', async () => {
      invite.mockRejectedValueOnce(
        new BadRequestException({
          code: 'INVITACION_RECHAZADA',
          message: INVITE_REJECTED_MESSAGE,
        }),
      );
      const res = await app.post('/portal/usuarios/invitaciones', {
        token: admin,
        body: { email: 'yaexiste@otraempresa.com', fullName: 'Nuevo' },
      });
      expect(res.body.message).toBe(INVITE_REJECTED_MESSAGE);
      expect(JSON.stringify(res.body)).not.toContain('otraempresa.com');
    });
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `cd backend && npx jest src/modules/portal/portal-users.integration.spec.ts`
Expected: FAIL en el primer arranque si algún guard o ruta no está donde debe. Si pasa todo a la primera, **comprueba que la prueba prueba algo**: quita temporalmente `ClientAdminGuard` del `@UseGuards` del controlador y verifica que los bloques de 403 se ponen en rojo. Vuelve a ponerlo antes de seguir.

- [ ] **Step 3: Correr y ver pasar**

Run: `cd backend && npx jest src/modules/portal/portal-users.integration.spec.ts`
Expected: PASS

- [ ] **Step 4: Suite completa y compilador**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/portal/portal-users.integration.spec.ts
git commit -m "test(portal): la frontera de usuarios, atravesando el ciclo completo de la peticion"
```

---

### Task 9: La pantalla de «Mi equipo» dentro del portal

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/portal.api.ts`
- Create: `web/src/pages/portal/PortalUsersPage.tsx`
- Create: `web/src/pages/portal/InvitePortalUserDialog.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/layout/PortalLayout.tsx`

**Interfaces:**
- Consume del backend, tal cual lo publican las tareas 4 a 6:
  - `GET /portal/usuarios` → `PortalTeamMember[]`
  - `GET /portal/usuarios/invitaciones` → `PortalInvitation[]`
  - `POST /portal/usuarios/invitaciones` `{ email, fullName }` → `PortalInvitation`
  - `POST /portal/usuarios/invitaciones/:id/reenviar` → `PortalInvitation`
  - `POST /portal/usuarios/:id/desactivar` → `PortalTeamMember`
- Produce, en `web/src/api/types.ts`:
  - `PortalTeamMember = { id: number; fullName: string; email: string; isAdmin: boolean; isActive: boolean; lastLoginAt: string | null; createdAt: string }`
  - `PortalInvitation = { id: number; fullName: string; email: string; expiresAt: string; lastSentAt: string | null; deliveryFailed: boolean; createdAt: string }`
- Produce, en `web/src/api/portal.api.ts`: `portalApi.listTeam`, `portalApi.listInvitations`, `portalApi.invite`, `portalApi.resendInvitation`, `portalApi.deactivateTeamMember`, y `PORTAL_INVITE_NAME_MAX_LENGTH = 180`, `PORTAL_INVITE_EMAIL_MAX_LENGTH = 180`.
- Produce, ruta interna del portal: `/portal/equipo`, **dentro** de `PortalProtectedRoute` y `PortalLayout`, y **antes** del catch-all `/portal/*`.

Ojo con el catch-all: `/portal/*` se traga cualquier subruta que no esté enumerada antes que él. Una ruta nueva escrita después manda al cliente a `/portal/tickets` sin ningún error visible.

- [ ] **Step 1: Declarar los tipos que publica el backend**

En `web/src/api/types.ts`, detrás del bloque del portal:

```ts
// ---------------------------------------------------------------------------
// Gestión de la propia gente desde el portal. Reflejan exactamente la
// proyección de `PortalUsersController`, no las entidades: `clientId` no está
// (la empresa es la de la sesión) y `passwordHash` no puede estar.
// ---------------------------------------------------------------------------

export interface PortalTeamMember {
  id: number;
  fullName: string;
  email: string;
  isAdmin: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/**
 * Una invitación pendiente. **Sin el secreto y sin su huella**: el secreto solo
 * existe en el correo que se mandó.
 *
 * `deliveryFailed` es un booleano y no el texto del error del SMTP a
 * propósito: por qué exactamente lo rechazó el servidor es diagnóstico interno
 * y el administrador solo necesita saber que tiene que reenviar.
 */
export interface PortalInvitation {
  id: number;
  fullName: string;
  email: string;
  expiresAt: string;
  lastSentAt: string | null;
  deliveryFailed: boolean;
  createdAt: string;
}
```

- [ ] **Step 2: Añadir las llamadas al cliente del portal**

En `web/src/api/portal.api.ts`, dentro de `portalApi` y con los tipos importados arriba:

```ts
  /**
   * La gente de mi empresa. El backend acota por el `clientId` del token: esta
   * llamada no manda ninguna empresa, y el `ValidationPipe` global rechazaría
   * con 400 cualquier propiedad de más si alguien la añadiera.
   */
  listTeam: () => portalApiClient.get<PortalTeamMember[]>('/portal/usuarios').then((r) => r.data),

  listInvitations: () =>
    portalApiClient.get<PortalInvitation[]>('/portal/usuarios/invitaciones').then((r) => r.data),

  invite: (body: { email: string; fullName: string }) =>
    portalApiClient
      .post<PortalInvitation>('/portal/usuarios/invitaciones', body)
      .then((r) => r.data),

  /** Emite un enlace nuevo y anula el anterior. Es el reintento del envío. */
  resendInvitation: (id: number) =>
    portalApiClient
      .post<PortalInvitation>(`/portal/usuarios/invitaciones/${id}/reenviar`)
      .then((r) => r.data),

  /** Le quita el acceso; no borra nada. El servidor rechaza que uno se quite a sí mismo. */
  deactivateTeamMember: (id: number) =>
    portalApiClient.post<PortalTeamMember>(`/portal/usuarios/${id}/desactivar`).then((r) => r.data),
```

y al final del fichero, junto a los otros límites:

```ts
/** Límites de `InvitePortalUserDto` en el backend: deben coincidir siempre con él. */
export const PORTAL_INVITE_NAME_MAX_LENGTH = 180;
export const PORTAL_INVITE_EMAIL_MAX_LENGTH = 180;
```

- [ ] **Step 3: Escribir el diálogo de invitar**

`web/src/pages/portal/InvitePortalUserDialog.tsx`. Copia la disciplina de `NewPortalRequirementDialog`: `alive` para cortar el camino tardío tras desmontar, `inFlight` (un `ref`, no el estado `busy`) como freno **síncrono** al doble envío, y el desglose del error en viñetas.

```tsx
import { useEffect, useRef, useState } from 'react';

import {
  portalApi,
  PORTAL_INVITE_EMAIL_MAX_LENGTH,
  PORTAL_INVITE_NAME_MAX_LENGTH,
} from '../../api/portal.api';
import type { PortalInvitation } from '../../api/types';
import { Button } from '../../components/ui/Button';

interface Props {
  open: boolean;
  onCancel: () => void;
  onInvited: (invitation: PortalInvitation) => void;
}

/** Mismo criterio que los otros dos diálogos del portal: `{ code, message, details }`. */
function toErrorList(e: any): string[] {
  const data = e?.response?.data as { message?: string; details?: unknown } | undefined;
  if (Array.isArray(data?.details) && data.details.length > 0) return data.details.map(String);
  if (typeof data?.message === 'string' && data.message.length > 0) return [data.message];
  return ['No se pudo enviar la invitación. Inténtalo de nuevo.'];
}

export default function InvitePortalUserDialog({ open, onCancel, onInvited }: Props) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Freno **síncrono** al doble envío, marcado antes de cualquier `await`. Un
   * segundo clic puede pasar antes de que `busy` —estado asíncrono— llegue a
   * deshabilitar el botón, y aquí eso significaría dos invitaciones: la
   * segunda revocaría a la primera y la persona recibiría dos correos, uno de
   * ellos ya inservible.
   */
  const inFlight = useRef(false);

  useEffect(() => {
    if (!open) return;
    setFullName('');
    setEmail('');
    setErrors([]);
    setBusy(false);
    inFlight.current = false;
  }, [open]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setErrors([]);
    try {
      const invitation = await portalApi.invite({ email: email.trim(), fullName: fullName.trim() });
      if (alive.current) onInvited(invitation);
    } catch (err) {
      if (alive.current) setErrors(toErrorList(err));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <form
        onSubmit={submit}
        className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 space-y-4"
      >
        <h2 className="text-lg font-semibold text-slate-900">Invitar a alguien de mi equipo</h2>
        <p className="text-sm text-slate-500">
          Le mandaremos un correo para que elija su propia contraseña. Tú no tienes que
          teclearla ni conocerla.
        </p>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Nombre y apellidos</span>
          <input
            value={fullName}
            onChange={(ev) => setFullName(ev.target.value)}
            maxLength={PORTAL_INVITE_NAME_MAX_LENGTH}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Correo electrónico</span>
          <input
            type="email"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            maxLength={PORTAL_INVITE_EMAIL_MAX_LENGTH}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        {errors.length > 0 && (
          <ul className="text-sm text-red-600 list-disc pl-5 space-y-1">
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar invitación'}
          </Button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Escribir la pantalla**

`web/src/pages/portal/PortalUsersPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';

import { portalApi } from '../../api/portal.api';
import type { PortalInvitation, PortalTeamMember } from '../../api/types';
import { usePortalAuth } from '../../auth/PortalAuthContext';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { UsersIcon, PlusIcon } from '../../components/ui/Icon';
import { fmtDate } from './PortalTicketsListPage';
import InvitePortalUserDialog from './InvitePortalUserDialog';

export default function PortalUsersPage() {
  const { clientUser } = usePortalAuth();
  const [team, setTeam] = useState<PortalTeamMember[]>([]);
  const [invitations, setInvitations] = useState<PortalInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([portalApi.listTeam(), portalApi.listInvitations()])
      .then(([t, i]) => {
        if (cancelled) return;
        setTeam(t);
        setInvitations(i);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.response?.data?.message ?? 'No se pudo cargar la lista de tu equipo.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  const deactivate = (m: PortalTeamMember) => {
    setError(null);
    portalApi
      .deactivateTeamMember(m.id)
      .then(() => load())
      .catch((e) =>
        setError(e?.response?.data?.message ?? 'No se pudo quitar el acceso. Inténtalo de nuevo.'),
      );
  };

  const resend = (i: PortalInvitation) => {
    setError(null);
    portalApi
      .resendInvitation(i.id)
      .then(() => load())
      .catch((e) =>
        setError(e?.response?.data?.message ?? 'No se pudo reenviar la invitación.'),
      );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Mi equipo</h1>
          <p className="text-sm text-slate-500">
            Da acceso al portal a la gente de tu empresa, o quítaselo a quien ya no está.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <PlusIcon size={16} />
          Invitar
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Cargando…</p>}

      {!loading && invitations.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Invitaciones pendientes</h2>
          <ul className="divide-y divide-slate-100">
            {invitations.map((i) => (
              <li key={i.id} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{i.fullName}</p>
                  <p className="text-xs text-slate-500 truncate">{i.email}</p>
                  {/*
                    Riesgo 1 de la spec: la invitación existe, el administrador
                    la ve pendiente, y la persona no recibe nada porque el
                    correo se perdió o cayó en no deseado. Que el fallo del
                    envío se VEA es lo que convierte el reenvío en un reintento
                    útil en vez de en un botón a ciegas.
                  */}
                  {i.deliveryFailed && (
                    <p className="text-xs text-amber-600 mt-1">
                      No se pudo entregar el correo. Reenvíalo, o revisa que la dirección
                      esté bien escrita.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Badge tone="warning">Pendiente</Badge>
                  <Button variant="secondary" onClick={() => resend(i)}>
                    Reenviar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!loading && team.length === 0 && (
        <EmptyState
          icon={<UsersIcon size={32} />}
          title="Todavía no hay nadie más"
          description="Invita a la gente de tu empresa para que pueda abrir tickets y seguir sus requerimientos."
        />
      )}

      {!loading && team.length > 0 && (
        <Card>
          <ul className="divide-y divide-slate-100">
            {team.map((m) => (
              <li key={m.id} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{m.fullName}</p>
                  <p className="text-xs text-slate-500 truncate">{m.email}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {m.lastLoginAt ? `Última entrada: ${fmtDate(m.lastLoginAt)}` : 'Nunca ha entrado'}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {m.isAdmin && <Badge tone="primary">Administra</Badge>}
                  {m.isActive ? (
                    <Badge tone="success">Con acceso</Badge>
                  ) : (
                    <Badge tone="neutral">Sin acceso</Badge>
                  )}
                  {/*
                    El botón no se ofrece para uno mismo. Esconderlo NO es la
                    defensa —el servidor rechaza la operación igualmente
                    (decisión 5 de la spec)—; esto solo evita mostrar algo que
                    se va a denegar. Mismo criterio que el botón de alta de
                    requerimientos frente a `ClientAdminGuard`.
                  */}
                  {m.isActive && m.id !== clientUser?.id && (
                    <Button variant="secondary" onClick={() => deactivate(m)}>
                      Quitar acceso
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <InvitePortalUserDialog
        open={dialogOpen}
        onCancel={() => setDialogOpen(false)}
        onInvited={() => {
          setDialogOpen(false);
          load();
        }}
      />
    </div>
  );
}
```

`UsersIcon` y `PlusIcon` ya existen en `web/src/components/ui/Icon.tsx`; no hace falta añadir ninguno. `Badge` admite los tonos `neutral | primary | success | warning | danger | info | purple`, y `Button` las variantes `primary | secondary | ghost | danger | success | warning`: los usados aquí están todos en esas listas.

- [ ] **Step 5: Declarar la ruta, ANTES del catch-all**

En `web/src/App.tsx`, dentro del bloque de `PortalLayout` y **por encima** de `<Route path="/portal/*" …>`:

```tsx
            {/*
              Gestión de la propia gente. Va dentro de `PortalProtectedRoute`
              (hace falta sesión) y ANTES del catch-all de abajo, que se traga
              cualquier subruta no enumerada y mandaría aquí a /portal/tickets
              sin ningún error visible. El guard de administrador vive en el
              backend: esta ruta es alcanzable por cualquier usuario del portal
              y lo que hace es enseñar el error que responde el servidor.
            */}
            <Route path="/portal/equipo" element={<PortalUsersPage />} />
```

con su `import PortalUsersPage from './pages/portal/PortalUsersPage';` arriba.

- [ ] **Step 6: Enlazarla desde la cabecera, solo para quien administra**

En `web/src/layout/PortalLayout.tsx`, junto a los otros `NavLink` y antes del de Ayuda:

```tsx
            {/*
              Solo para quien administra su empresa. `isAdmin` viene del
              backend (`portal-auth.service.ts`, `!!user.isAdmin`), no de una
              suposición del navegador. Esconder el enlace NO es la defensa: la
              defensa es `ClientAdminGuard`.
            */}
            {clientUser?.isAdmin && (
              <NavLink
                to="/portal/equipo"
                className={({ isActive }) =>
                  `text-sm font-medium transition ${
                    isActive ? 'text-kubo-primary' : 'text-slate-600 hover:text-slate-900'
                  }`
                }
              >
                Mi equipo
              </NavLink>
            )}
```

- [ ] **Step 7: Compilar y construir**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add web/src/api/types.ts web/src/api/portal.api.ts \
        web/src/pages/portal/PortalUsersPage.tsx \
        web/src/pages/portal/InvitePortalUserDialog.tsx \
        web/src/App.tsx web/src/layout/PortalLayout.tsx
git commit -m "feat(web): el administrador gestiona a su equipo desde el portal"
```

---

### Task 10: La página pública de aceptar la invitación

**Files:**
- Create: `web/src/pages/portal/PortalAcceptInvitationPage.tsx`
- Modify: `web/src/api/portal.api.ts`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consume: `POST /portal/invitaciones/aceptar` con `{ secret, password, passwordConfirmation }` → `{ email: string }` (Task 7); `PORTAL_TOKEN_STORAGE_KEY` y compañía ya existentes en `portal.api.ts`.
- Produce:
  - `portalApi.acceptInvitation(body: { secret: string; password: string; passwordConfirmation: string }): Promise<{ email: string }>`
  - Ruta **pública** `/portal/invitacion/:secret`.

Tres cosas que es fácil hacer mal aquí, y son justo las que la spec señala:

1. **La ruta no puede heredar ninguna guarda.** Va como hermana de `/portal/login`, dentro de `PortalRoot` pero **fuera** de `PortalProtectedRoute`. Si cae dentro del guard, quien abra el enlace sin sesión rebota al login y no puede aceptar nunca.
2. **La llamada no debe pasar por el interceptor de refresco.** Un 400 no lo dispara, pero un `localStorage` con un refreshToken viejo sí puede meter ruido; se añade la ruta a `isPortalAuthRequest` para que ningún 401 de aquí intente refrescar una sesión que no existe.
3. **Aceptar no inicia sesión.** El backend devuelve el correo y nada más. La pantalla lo enseña y manda al login.

- [ ] **Step 1: Añadir la llamada y excluirla del refresco**

En `web/src/api/portal.api.ts`, dentro de `portalApi`:

```ts
  /**
   * Acepta una invitación. **No devuelve sesión**: el backend responde con el
   * correo con el que hay que entrar, y la pantalla manda al login. Así esta
   * ruta pública nunca es una vía para obtener un token sin pasar por el
   * inicio de sesión normal.
   *
   * El secreto viaja en el cuerpo, no en la query, por lo mismo que viaja en
   * la ruta del enlace y no en su query: es una credencial, y las cadenas de
   * consulta acaban en registros de servidores intermedios con demasiada
   * facilidad.
   */
  acceptInvitation: (body: { secret: string; password: string; passwordConfirmation: string }) =>
    portalApiClient
      .post<{ email: string }>('/portal/invitaciones/aceptar', body)
      .then((r) => r.data),
```

y amplía el reconocedor de rutas que **nunca** deben disparar un refresco:

```ts
/**
 * Rutas del portal que un 401 jamás debe convertir en un intento de refresco.
 * Las dos de autenticación, y la de aceptar una invitación: quien la usa no
 * tiene sesión por definición, así que refrescar allí sería intentar renovar
 * algo que no existe —y, si hubiera un refreshToken viejo en `localStorage`
 * de otra sesión del mismo navegador, gastaría cupo del limitador por nada.
 */
function isPortalAuthRequest(url: string | undefined): boolean {
  return !!url && /\/portal\/(auth\/(login|refresh)|invitaciones\/aceptar)(\?|$)/.test(url);
}
```

- [ ] **Step 2: Escribir la pantalla**

`web/src/pages/portal/PortalAcceptInvitationPage.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { portalApi } from '../../api/portal.api';
import { Button } from '../../components/ui/Button';

/**
 * Página pública: **la única del portal que se abre sin sesión y da a cambio
 * una credencial**. No pide el correo —ya lo lleva la invitación, y pedirlo
 * permitiría probar direcciones— y no consulta nada al servidor hasta que la
 * persona envía el formulario: no existe ninguna ruta que responda «este
 * enlace vale» sin consumirlo.
 *
 * Aceptar no inicia sesión. El servidor devuelve el correo con el que entrar y
 * de aquí se va al login como cualquier otra persona.
 */
export default function PortalAcceptInvitationPage() {
  const { secret } = useParams<{ secret: string }>();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneEmail, setDoneEmail] = useState<string | null>(null);

  /**
   * Freno **síncrono** al doble envío, marcado antes de cualquier `await`.
   * Aquí importa más que en ningún otro formulario del portal: la invitación
   * es de un solo uso, así que un segundo envío que se cuele antes de que
   * `busy` reptinte recibiría el cuerpo genérico de «enlace no válido» —el de
   * su propia aceptación, que acaba de funcionar— y la persona creería que
   * algo ha fallado cuando su cuenta ya existe.
   */
  const inFlight = useRef(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;

    // La comparación en el navegador es una cortesía, no la validación: el
    // servidor la repite y es la suya la que manda (§«La contraseña» de la
    // spec).
    if (password !== confirmation) {
      setError('Las dos contraseñas no coinciden.');
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { email } = await portalApi.acceptInvitation({
        secret: secret ?? '',
        password,
        passwordConfirmation: confirmation,
      });
      setDoneEmail(email);
    } catch (err: any) {
      setError(
        err?.response?.data?.message ??
          'No se pudo completar el alta. Inténtalo de nuevo en unos minutos.',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (doneEmail) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full text-center space-y-4">
          <h1 className="text-xl font-bold text-slate-800">Tu cuenta ya está lista</h1>
          <p className="text-slate-500 text-sm">
            Entra al portal con <strong>{doneEmail}</strong> y la contraseña que acabas de
            elegir.
          </p>
          <Button onClick={() => navigate('/portal/login', { replace: true })}>
            Ir a iniciar sesión
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="bg-white rounded-xl shadow-md p-8 max-w-md w-full space-y-4"
      >
        <h1 className="text-xl font-bold text-slate-800">Elige tu contraseña</h1>
        <p className="text-slate-500 text-sm">
          Es la que usarás para entrar al portal. Nadie más la conoce ni puede verla.
        </p>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Contraseña</span>
          <input
            type="password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            minLength={8}
            required
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Repite la contraseña</span>
          <input
            type="password"
            value={confirmation}
            onChange={(ev) => setConfirmation(ev.target.value)}
            minLength={8}
            required
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        {/*
          El servidor responde exactamente lo mismo tanto si el enlace no
          existe como si caducó o si ya se usó. Aquí se pinta tal cual: no se
          intenta adivinar cuál de las tres cosas pasó, porque esa distinción
          solo le serviría a quien está probando enlaces.
        */}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Creando tu cuenta…' : 'Crear mi cuenta'}
        </Button>

        <p className="text-xs text-slate-400 text-center">
          ¿Ya tienes cuenta? <Link className="underline" to="/portal/login">Inicia sesión</Link>
        </p>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Declarar la ruta pública**

En `web/src/App.tsx`, **como hermana de `/portal/login`**, dentro de `<Route element={<PortalRoot />}>` y **fuera** de `<Route element={<PortalProtectedRoute />}>`:

```tsx
      <Route element={<PortalRoot />}>
        <Route path="/portal/login" element={<PortalLoginPage />} />
        {/*
          PÚBLICA, y aquí y no en cualquier otro sitio. Quien abre este enlace
          no tiene ni puede tener sesión: si la ruta cayera dentro de
          `PortalProtectedRoute`, el guard lo mandaría a /portal/login y no
          podría aceptar nunca. Y tiene que estar dentro de `PortalRoot` para
          quedar fuera del guard de la sesión INTERNA, que la trataría como una
          ruta del panel y la mandaría al otro login.
        */}
        <Route path="/portal/invitacion/:secret" element={<PortalAcceptInvitationPage />} />
        <Route element={<PortalProtectedRoute />}>
```

con su `import PortalAcceptInvitationPage from './pages/portal/PortalAcceptInvitationPage';` arriba.

- [ ] **Step 4: Comprobar a mano que la ruta no está protegida**

Run: `cd web && npm run dev`, abre en una ventana privada (sin ninguna sesión de portal en `localStorage`) `http://localhost:5173/portal/invitacion/loquesea`.
Expected: se ve el formulario de contraseña. **Si redirige a `/portal/login`, la ruta quedó dentro del guard** — es el fallo que esta tarea existe para evitar. Cierra el servidor al terminar.

- [ ] **Step 5: Compilar y construir**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/portal/PortalAcceptInvitationPage.tsx \
        web/src/api/portal.api.ts web/src/App.tsx
git commit -m "feat(web): pagina publica para aceptar la invitacion y elegir contrasena"
```

---

## Autorrevisión

**1. Cobertura de la especificación.**

| Requisito de la spec | Tarea |
| --- | --- |
| Decisión 1 — nadie teclea la contraseña de otro; solo nombre y correo | 5, 7, 9, 10 |
| Decisión 2 — no se puede nombrar administradores desde el portal | 5 (el DTO no lo admite), 7 (`isAdmin: 0` literal), 8 (por HTTP) |
| Decisión 3 — 32 bytes, solo la huella, caduca, un solo uso | 2, 3, 7 |
| Decisión 4 — desactivar, no borrar | 1 (nada se borra), 4 (`deactivate` pone `is_active = 0`) |
| Decisión 5 — nadie se desactiva a sí mismo, y se rechaza en el servidor | 4 (servicio), 9 (la pantalla solo esconde el botón) |
| Decisión 6 — envío en el acto por SMTP, no por la cola; reenviar es el reintento | 6 |
| Decisión 7 — el error no dice si el correo existe | 5, 8 |
| Decisión 8 — autoría honesta: `created_by` nulable + columna de cliente | 1, 7 |
| Recorrido, pasos 1-6 | 5 (1-2), 6 (3), 10 (4), 7 (5), 10 (6) |
| Frontera: listar acotado | 4 |
| Frontera: invitar fija la empresa desde la sesión | 5, 8 |
| Frontera: desactivar responde 404 y no 403 | 4, 8 |
| Frontera: aceptar toma la empresa de la invitación | 7 |
| El enlace: no adivinable, huella, 7 días en UTC, un uso, se invalida si el invitador o la empresa caen, no acumula vivas, fallos idénticos, tope por origen | 2, 3, 5, 6, 7 |
| La contraseña: mismas reglas del portal, doble y comparada en el servidor | 7 |
| Cómo se prueba — frontera en las cuatro operaciones | 4, 5, 7, 8 |
| Cómo se prueba — el enlace | 2, 3, 7 |
| Cómo se prueba — la transacción de aceptar | 7 |
| Cómo se prueba — las guardas | 4, 8 |
| Cómo se prueba — la empresa viene de la sesión, con petición manipulada | 5, 8 |
| Riesgo 4 — la migración sobre tabla viva, idempotente, sin perder datos | 1 |

Fuera de alcance de la spec y por tanto sin tarea, a propósito: recuperar contraseña, editar datos de otro, reactivar a un desactivado, invitar administradores.

**2. Coherencia de tipos entre tareas.** `PortalClientUserView` y `PortalInvitationView` (backend, tareas 4 y 5) tienen exactamente los mismos campos que `PortalTeamMember` y `PortalInvitation` (frontend, tarea 9). `accept` devuelve `{ email: string }` en la Task 7 y eso mismo consume la Task 10. `inviteWithSecret` la declara la Task 5 y la consume la Task 6. `fingerprintInvitationSecret` / `isInvitationExpired` / `invitationExpiryFrom` se declaran en la Task 2 con la firma exacta que usan las tareas 3, 5, 6 y 7. `normalizeEmailAddress` se declara en la Task 3 y la usan los dos repositorios.

**3. Orden.** Backend entero (tareas 1-8) antes del frontend (9-10). La pantalla pública va la última, cuando ya hay contra qué hablar.

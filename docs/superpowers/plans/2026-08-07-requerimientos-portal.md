# Requerimientos desde el portal — Plan de implementación

> **Para trabajadores agénticos:** SUB-HABILIDAD REQUERIDA: usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Goal:** Que el usuario administrador de una empresa cliente pueda pedir requerimientos desde el portal, y que la casa los acepte fijando prioridad y fecha comprometida, o los rechace con motivo.

**Architecture:** Se reutiliza el módulo `work-items` que ya existe: un requerimiento del portal es un `WorkItem` con `origin = 'PORTAL'` que nace en un estado nuevo, `SOLICITADO`, fuera de las columnas del tablero. El portal recibe una superficie propia (`PortalRequirementsService` + `PortalRequirementsController`) con proyección campo a campo, igual que la que ya existe para tickets. El rol se activa con un guard que lee un campo que el token ya trae.

**Tech Stack:** NestJS 10 · TypeORM 0.3 (`synchronize: false`) · MySQL 8 · Jest 29 · React 18 + Vite + TypeScript + Tailwind · Passport JWT

**Spec:** `docs/superpowers/specs/2026-08-07-requerimientos-portal-design.md`

## Global Constraints

- **Nunca decidir por la ausencia de un valor** en lugar de por el hecho que lo determina. Es el defecto que más veces ha reaparecido en este proyecto (ocho veces). Toda frontera de visibilidad se decide por un hecho positivo y explícito.
- **404, nunca 403, para recursos de otra empresa**, con cuerpo idéntico al de un recurso inexistente.
- **Proyección campo a campo** para todo lo que ve un cliente. Nunca *spread* menos claves.
- **Escrituras transaccionales** con `repo.runInTransaction(...)` y `manager.getRepository(...)` dentro del callback — nunca el repositorio inyectado ni un servicio externo.
- **TypeORM devuelve las columnas `bigint` como cadenas.** Nunca comparar identificadores con `===`; usar `sameId` de `backend/src/common/ids.ts`.
- **Cuerpos de error** con la forma `{ code, message }` y mensaje en español dirigido a una persona.
- **Ninguna prueba debe consagrar el comportamiento equivocado.** Dos veces en este proyecto una prueba fijó como contrato un descuido de visibilidad.
- **El esquema de la base es `kubo_devdocs`** (las migraciones lo escriben literal).
- **`synchronize` está desactivado**: todo cambio de esquema va en un fichero de migración.
- Prefijo de código de requerimiento: `RQ-` con 4 dígitos (`buildCode` en `work-items.service.ts:120`).

## Estructura de ficheros

**Backend — se crean:**
- `backend/sql/migrations/020_requerimientos_portal.sql` — esquema.
- `backend/src/modules/portal/portal-requirements.service.ts` — alta, listado, detalle y proyección para el cliente.
- `backend/src/modules/portal/portal-requirements.service.spec.ts`
- `backend/src/modules/portal/portal-requirements.controller.ts` — rutas del portal.
- `backend/src/modules/portal/guards/client-admin.guard.ts` — el rol.
- `backend/src/modules/portal/guards/client-admin.guard.spec.ts`
- `backend/src/modules/portal/dto/create-portal-requirement.dto.ts`
- `backend/src/modules/portal/dto/portal-requirement.dto.ts` — la vista publicada.
- `backend/src/modules/work-items/work-item-intake.service.ts` — aceptar y rechazar.
- `backend/src/modules/work-items/work-item-intake.service.spec.ts`
- `backend/src/modules/work-items/dto/accept-work-item.dto.ts`
- `backend/src/modules/work-items/dto/reject-work-item.dto.ts`

**Backend — se modifican:**
- `backend/src/modules/work-items/domain/work-item-board.ts` — estados nuevos, `PRE_BOARD_STATUSES`, `assertMovable`.
- `backend/src/modules/work-items/entities/work-item.entity.ts` — `origin`, `createdByClientUserId`, `createdBy` nulable.
- `backend/src/modules/work-items/entities/work-item-event.entity.ts` — `actorClientUserId`, tipos de evento nuevos.
- `backend/src/modules/work-items/work-item-board.service.ts` — llama a `assertMovable`.
- `backend/src/modules/work-items/work-items.controller.ts` — dos rutas nuevas.
- `backend/src/modules/work-items/work-items.module.ts` — registra el servicio nuevo.
- `backend/src/modules/portal/portal.module.ts` — registra controlador y servicio nuevos.
- `backend/src/modules/portal/portal-auth.service.ts` — `isAdmin` en la respuesta.
- `backend/src/config/portal-schema.validator.ts` — exige `work_items.origin`.

**Web — se crean:**
- `web/src/pages/portal/PortalRequirementsListPage.tsx`
- `web/src/pages/portal/PortalRequirementDetailPage.tsx`
- `web/src/pages/portal/NewPortalRequirementDialog.tsx`
- `web/src/pages/work-items/RequirementIntakeInbox.tsx` — bandeja interna.

**Web — se modifican:**
- `web/src/api/portal.api.ts` — llamadas nuevas.
- `web/src/api/types.ts` — tipos nuevos, `isAdmin` en `PortalClientUser`.
- `web/src/api/work-items.api.ts` — aceptar y rechazar.
- `web/src/App.tsx` — rutas.
- `web/src/layout/PortalLayout.tsx` — navegación.
- `web/src/pages/client-users/EditClientUserDialog.tsx` y `NewClientUserDialog.tsx` — quitar «reservado».

---

### Task 1: Migración 020 y validador de esquema

**Files:**
- Create: `backend/sql/migrations/020_requerimientos_portal.sql`
- Modify: `backend/src/config/portal-schema.validator.ts`
- Test: `backend/src/config/portal-schema.validator.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: las columnas `work_items.origin` (`ENUM('INTERNO','PORTAL') NOT NULL DEFAULT 'INTERNO'`), los valores de enum `'SOLICITADO'` y `'RECHAZADO'` en `work_items.status`, `work_item_events.from_status` y `work_item_events.to_status`, y `'REQUESTED'`, `'ACCEPTED'`, `'REJECTED'` en `work_item_events.type`.

- [ ] **Step 1: Escribir la migración**

Crea `backend/sql/migrations/020_requerimientos_portal.sql`:

```sql
-- ---------------------------------------------------------------------------
-- 020: requerimientos pedidos desde el portal de clientes.
--
-- Idempotente, como las anteriores: se puede volver a pasar sin romper nada.
--
-- Las columnas de autoría (work_items.created_by_client_user_id,
-- work_item_events.actor_client_user_id) NO se crean aquí: ya las creó la 013,
-- y `PortalSchemaValidator` las exige desde entonces. Lo único que faltaba era
-- que las entidades las mapearan, que es trabajo de código y no de esquema.
-- ---------------------------------------------------------------------------

-- 1) origin: el hecho que decide si el cliente puede ver el requerimiento.
--
-- Se guarda aparte de created_by_client_user_id a propósito. Quién creó algo y
-- si el cliente puede verlo son dos hechos distintos; colgar el segundo del
-- primero obliga a falsear el autor el día que se quiera compartir con el
-- cliente algo que nació dentro de casa.
--
-- Todas las filas existentes quedan en 'INTERNO' por el DEFAULT: ningún
-- requerimiento ya creado se destapa en el portal al desplegar.
DROP PROCEDURE IF EXISTS kubo_add_column_020;
DELIMITER //
CREATE PROCEDURE kubo_add_column_020(
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

CALL kubo_add_column_020('work_items', 'origin',
  "origin ENUM('INTERNO','PORTAL') NOT NULL DEFAULT 'INTERNO' AFTER client_id");

DROP PROCEDURE IF EXISTS kubo_add_column_020;

-- 2) Estados nuevos.
--
-- MODIFY sobre un ENUM reescribe la tabla. Es idempotente en el sentido que
-- importa: volver a pasarlo deja la columna igual. Los valores existentes se
-- conservan porque el enum nuevo los contiene a todos.
ALTER TABLE work_items
  MODIFY status ENUM(
    'PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO','BLOQUEADO','CANCELADO',
    'SOLICITADO','RECHAZADO'
  ) NOT NULL DEFAULT 'PENDIENTE';

ALTER TABLE work_item_events
  MODIFY from_status ENUM(
    'PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO','BLOQUEADO','CANCELADO',
    'SOLICITADO','RECHAZADO'
  ) NULL;

ALTER TABLE work_item_events
  MODIFY to_status ENUM(
    'PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO','BLOQUEADO','CANCELADO',
    'SOLICITADO','RECHAZADO'
  ) NULL;

-- 3) Tipos de evento nuevos.
ALTER TABLE work_item_events
  MODIFY type ENUM(
    'CREATED','MOVED','ASSIGNED','COMMENT','BLOCKED','UNBLOCKED',
    'CLOSED','REOPENED','CANCELLED','PRIORITY_CHANGED',
    'REQUESTED','ACCEPTED','REJECTED'
  ) NOT NULL;

-- 4) El listado del portal filtra siempre por los dos campos a la vez.
CREATE INDEX idx_wi_client_origin ON work_items (client_id, origin);
```

Nota sobre el paso 4: `CREATE INDEX` no admite `IF NOT EXISTS` en MySQL 8. Si la migración se pasa dos veces, ese último comando falla con `ER_DUP_KEYNAME` y **el resto ya se aplicó**. Es aceptable y es el mismo comportamiento que las migraciones anteriores; quien la re-ejecute verá el error del índice duplicado y nada más.

- [ ] **Step 2: Escribir la prueba que falla en el validador**

En `backend/src/config/portal-schema.validator.spec.ts`, localiza el array de columnas esperadas (empieza con `{ tableName: 'work_item_events', columnName: 'actor_client_user_id' }`) y añade el caso nuevo:

```ts
  { tableName: 'work_items', columnName: 'origin' },
```

- [ ] **Step 3: Ejecutar la prueba y comprobar que falla**

Run: `cd backend && npx jest src/config/portal-schema.validator.spec.ts`
Expected: FAIL — el validador no exige todavía `work_items.origin`.

- [ ] **Step 4: Añadir la columna a la lista del validador**

En `backend/src/config/portal-schema.validator.ts`, dentro de `REQUIRED_COLUMNS`, justo después de la línea de `work_items.created_by_client_user_id`:

```ts
    // 020: sin ella, `work-item.entity.ts` pide una columna que no existe y
    // TypeORM la emite en TODO SELECT sobre work_items — el tablero interno
    // entero deja de cargar, no solo el portal. Falla en el arranque, que es
    // donde se ve, en vez de en la primera consulta de un usuario.
    { table: 'work_items', column: 'origin', files: [PortalSchemaValidator.MIGRATION_020] },
```

Y declara la constante junto a las otras `MIGRATION_*` de la clase:

```ts
  private static readonly MIGRATION_020 = '020_requerimientos_portal.sql';
```

- [ ] **Step 5: Ejecutar la prueba y comprobar que pasa**

Run: `cd backend && npx jest src/config/portal-schema.validator.spec.ts`
Expected: PASS

- [ ] **Step 6: Aplicar la migración en desarrollo y verificarla**

Run:
```bash
mysql -u root -p kubo_devdocs < backend/sql/migrations/020_requerimientos_portal.sql
mysql -u root -p kubo_devdocs -e "SHOW COLUMNS FROM work_items WHERE Field IN ('origin','status');"
```
Expected: `origin` con tipo `enum('INTERNO','PORTAL')` y por defecto `INTERNO`; `status` incluyendo `SOLICITADO` y `RECHAZADO`.

- [ ] **Step 7: Commit**

```bash
git add backend/sql/migrations/020_requerimientos_portal.sql backend/src/config/portal-schema.validator.ts backend/src/config/portal-schema.validator.spec.ts
git commit -m "feat(requerimientos): esquema para el alta desde el portal"
```

---

### Task 2: Dominio — estados nuevos y `assertMovable`

**Files:**
- Modify: `backend/src/modules/work-items/domain/work-item-board.ts`
- Test: `backend/src/modules/work-items/domain/work-item-board.spec.ts`

**Interfaces:**
- Consumes: nada (módulo puro, sin inyección de dependencias ni base de datos).
- Produces:
  - `WorkItemStatus` incluye ahora `'SOLICITADO'` y `'RECHAZADO'`.
  - `export const PRE_BOARD_STATUSES: WorkItemStatus[]`
  - `export function assertMovable(fromStatus: WorkItemStatus): void`
  - `BOARD_COLUMNS` **no cambia**: sigue siendo exactamente `['PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO']`.

Contexto que el implementador necesita: este módulo **no tiene máquina de estados** — su propio comentario dice *"cualquier columna puede ir a cualquier columna"*. `OUT_OF_FLOW_STATUSES` no significa "fuera del tablero": significa **"exige motivo"**, porque es lo único que consulta `requiresReason`. Por eso `RECHAZADO` va ahí y `SOLICITADO` no.

- [ ] **Step 1: Escribir las pruebas que fallan**

Añade a `backend/src/modules/work-items/domain/work-item-board.spec.ts`:

```ts
import {
  WORK_ITEM_STATUSES,
  BOARD_COLUMNS,
  PRE_BOARD_STATUSES,
  requiresReason,
  assertMovable,
} from './work-item-board';

describe('estados previos al tablero', () => {
  it('SOLICITADO y RECHAZADO son estados válidos', () => {
    expect(WORK_ITEM_STATUSES).toContain('SOLICITADO');
    expect(WORK_ITEM_STATUSES).toContain('RECHAZADO');
  });

  it('no son columnas del tablero', () => {
    expect(BOARD_COLUMNS).toEqual(['PENDIENTE', 'EN_PROCESO', 'PRUEBAS', 'CERRADO']);
    expect(PRE_BOARD_STATUSES).toEqual(['SOLICITADO', 'RECHAZADO']);
  });

  it('RECHAZADO exige motivo; SOLICITADO no', () => {
    expect(requiresReason('RECHAZADO')).toBe(true);
    // Nace del portal sin que nadie lo motive: pedirle motivo lo haría
    // imposible de crear.
    expect(requiresReason('SOLICITADO')).toBe(false);
  });

  it('assertMovable rechaza mover lo que aún no entró al tablero', () => {
    expect(() => assertMovable('SOLICITADO')).toThrow(/aceptado/i);
    expect(() => assertMovable('RECHAZADO')).toThrow(/rechazado/i);
  });

  it('assertMovable deja pasar cualquier estado del tablero', () => {
    for (const s of BOARD_COLUMNS) {
      expect(() => assertMovable(s)).not.toThrow();
    }
    expect(() => assertMovable('BLOQUEADO')).not.toThrow();
    expect(() => assertMovable('CANCELADO')).not.toThrow();
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `cd backend && npx jest src/modules/work-items/domain/work-item-board.spec.ts`
Expected: FAIL — `PRE_BOARD_STATUSES` y `assertMovable` no existen.

- [ ] **Step 3: Implementar**

En `backend/src/modules/work-items/domain/work-item-board.ts`:

Añade los dos valores al tipo y al array (al final, para no alterar el orden de los existentes):

```ts
export type WorkItemStatus =
  | 'PENDIENTE'
  | 'EN_PROCESO'
  | 'PRUEBAS'
  | 'CERRADO'
  | 'BLOQUEADO'
  | 'CANCELADO'
  | 'SOLICITADO'
  | 'RECHAZADO';

export const WORK_ITEM_STATUSES: WorkItemStatus[] = [
  'PENDIENTE',
  'EN_PROCESO',
  'PRUEBAS',
  'CERRADO',
  'BLOQUEADO',
  'CANCELADO',
  'SOLICITADO',
  'RECHAZADO',
];
```

`BOARD_COLUMNS` se queda **exactamente como está**.

`RECHAZADO` entra en los que exigen motivo:

```ts
/** Estados fuera del flujo: no son columnas, exigen motivo. */
export const OUT_OF_FLOW_STATUSES: WorkItemStatus[] = ['BLOQUEADO', 'CANCELADO', 'RECHAZADO'];
```

Y debajo de `assertReason`, lo nuevo:

```ts
/**
 * Estados anteriores al tablero: un requerimiento que el cliente pidió y que
 * nadie ha aceptado todavía, y uno que se rechazó.
 *
 * No son columnas y **no se llega a ellos ni se sale de ellos arrastrando**.
 * Se sale por `WorkItemIntakeService.accept` o `.reject`, que son los únicos
 * sitios donde se fija la fecha comprometida o se exige el motivo.
 */
export const PRE_BOARD_STATUSES: WorkItemStatus[] = ['SOLICITADO', 'RECHAZADO'];

/**
 * Exige que el ítem ya esté en el tablero antes de dejar que alguien lo mueva.
 *
 * Hace falta porque aquí no hay máquina de estados: `move` acepta cualquier
 * columna de destino desde cualquier origen. Sin esta guarda, arrastrar una
 * tarjeta llevaría un SOLICITADO directo a EN_PROCESO y se saltaría la
 * aceptación entera — que es lo único que garantiza que exista una fecha
 * comprometida, de la que depende el informe mensual del cliente.
 *
 * Se comprueba el estado de ORIGEN, no el de destino: lo que está prohibido es
 * sacar de aquí arrastrando, no llegar aquí (a `SOLICITADO` no llega nada, y a
 * `RECHAZADO` solo llega `reject`).
 */
export function assertMovable(fromStatus: WorkItemStatus): void {
  if (!PRE_BOARD_STATUSES.includes(fromStatus)) return;

  const message =
    fromStatus === 'SOLICITADO'
      ? 'El requerimiento aún no ha sido aceptado: acéptalo antes de moverlo en el tablero.'
      : 'El requerimiento fue rechazado y no vuelve al tablero.';

  throw new BadRequestException({ code: 'BAD_INPUT', message });
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `cd backend && npx jest src/modules/work-items/domain/work-item-board.spec.ts`
Expected: PASS, incluidas las pruebas que ya había.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/work-items/domain/work-item-board.ts backend/src/modules/work-items/domain/work-item-board.spec.ts
git commit -m "feat(requerimientos): estados SOLICITADO y RECHAZADO, fuera del tablero"
```

---

### Task 3: El tablero se niega a mover lo que no ha entrado

**Files:**
- Modify: `backend/src/modules/work-items/work-item-board.service.ts`
- Test: `backend/src/modules/work-items/work-item-board.service.spec.ts`

**Interfaces:**
- Consumes: `assertMovable(fromStatus: WorkItemStatus): void` de la tarea 2.
- Produces: `WorkItemBoardService.move` lanza `BAD_INPUT` si el ítem está en `SOLICITADO` o `RECHAZADO`.

- [ ] **Step 1: Escribir la prueba que falla**

En `backend/src/modules/work-items/work-item-board.service.spec.ts`, siguiendo el mismo `makeService(...)`/`item({...})` que ya usa el fichero:

```ts
  it('no deja arrastrar un requerimiento que aún no fue aceptado', async () => {
    const { service } = makeService(item({ status: 'SOLICITADO' }));
    await expect(
      service.move({ workItemId: 1, actorUserId: 5, toStatus: 'EN_PROCESO', toIndex: 0 }),
    ).rejects.toThrow(/aceptado/i);
  });

  it('no deja devolver al tablero un requerimiento rechazado', async () => {
    const { service } = makeService(item({ status: 'RECHAZADO' }));
    await expect(
      service.move({ workItemId: 1, actorUserId: 5, toStatus: 'PENDIENTE', toIndex: 0 }),
    ).rejects.toThrow(/rechazado/i);
  });

  it('no escribe nada cuando rechaza el movimiento', async () => {
    const { service, patches, savedEvents } = makeService(item({ status: 'SOLICITADO' }));
    await expect(
      service.move({ workItemId: 1, actorUserId: 5, toStatus: 'PRUEBAS', toIndex: 0 }),
    ).rejects.toThrow();
    expect(patches).toHaveLength(0);
    expect(savedEvents).toHaveLength(0);
  });
```

La tercera prueba es la que importa: comprobar solo que lanza dejaría pasar una implementación que ya escribió antes de comprobar.

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `cd backend && npx jest src/modules/work-items/work-item-board.service.spec.ts`
Expected: FAIL — hoy el movimiento se realiza sin quejarse.

- [ ] **Step 3: Implementar**

En `work-item-board.service.ts`, importa `assertMovable` desde `./domain/work-item-board` y llámala **en cuanto se conoce el estado actual del ítem y antes de cualquier escritura**:

```ts
      // Antes de tocar nada: un requerimiento que el cliente pidió y que nadie
      // aceptó todavía no está en ninguna columna, y arrastrarlo se saltaría la
      // aceptación — el único sitio donde se fija la fecha comprometida.
      assertMovable(fresh.status);
```

Colócala inmediatamente después de la lectura que ya obtiene el ítem dentro de la transacción (la variable que el fichero llama `fresh`), antes del cálculo de columnas y del `patch`.

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `cd backend && npx jest src/modules/work-items/work-item-board.service.spec.ts`
Expected: PASS, incluidas las pruebas anteriores del tablero.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/work-items/work-item-board.service.ts backend/src/modules/work-items/work-item-board.service.spec.ts
git commit -m "fix(tablero): un requerimiento sin aceptar no se arrastra"
```

---

### Task 4: Las entidades dejan de mentir sobre el esquema

**Files:**
- Modify: `backend/src/modules/work-items/entities/work-item.entity.ts`
- Modify: `backend/src/modules/work-items/entities/work-item-event.entity.ts`

**Interfaces:**
- Consumes: `WorkItemStatus` de la tarea 2; las columnas de la tarea 1.
- Produces:
  - `export type WorkItemOrigin = 'INTERNO' | 'PORTAL'`
  - `export const WORK_ITEM_ORIGINS: WorkItemOrigin[]`
  - `WorkItem.origin!: WorkItemOrigin`
  - `WorkItem.createdByClientUserId!: number | null`
  - `WorkItem.createdBy!: number | null`
  - `WorkItemEvent.actorClientUserId!: number | null`
  - `WorkItemEventType` incluye `'REQUESTED' | 'ACCEPTED' | 'REJECTED'`

Contexto: `work_items.created_by_client_user_id`, `work_item_events.actor_client_user_id` y la nulabilidad de `created_by` **ya existen en producción** desde la migración 013. Esta tarea solo hace que las entidades las conozcan.

- [ ] **Step 1: Modificar `work-item.entity.ts`**

Añade el tipo, junto a los imports de dominio:

```ts
/** Cómo nació el requerimiento. Es el hecho que decide si el cliente lo ve. */
export type WorkItemOrigin = 'INTERNO' | 'PORTAL';

export const WORK_ITEM_ORIGINS: WorkItemOrigin[] = ['INTERNO', 'PORTAL'];
```

Dentro de la clase, tras `clientId`:

```ts
  /**
   * `INTERNO` para todo lo que nace dentro de casa (actas, reuniones, Jira, el
   * tablero); `PORTAL` para lo que pidió el cliente.
   *
   * **Es el único criterio de visibilidad del portal**, y está separado de
   * `createdByClientUserId` a propósito: quién lo creó y si el cliente puede
   * verlo son dos hechos distintos.
   */
  @Column({ type: 'enum', enum: WORK_ITEM_ORIGINS, default: 'INTERNO' })
  origin!: WorkItemOrigin;
```

Y cambia la autoría:

```ts
  /** Nulo cuando lo creó un usuario de cliente desde el portal. */
  @Column({ name: 'created_by', type: 'bigint', unsigned: true, nullable: true })
  createdBy!: number | null;

  /** Nulo salvo que lo creara un usuario de cliente. Columna de la migración 013. */
  @Column({ name: 'created_by_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  createdByClientUserId!: number | null;
```

- [ ] **Step 2: Modificar `work-item-event.entity.ts`**

Añade los tres tipos de evento al tipo y al array (al final):

```ts
export type WorkItemEventType =
  | 'CREATED'
  | 'MOVED'
  | 'ASSIGNED'
  | 'COMMENT'
  | 'BLOCKED'
  | 'UNBLOCKED'
  | 'CLOSED'
  | 'REOPENED'
  | 'CANCELLED'
  | 'PRIORITY_CHANGED'
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'REJECTED';
```

(y los mismos tres al final de `WORK_ITEM_EVENT_TYPES`).

Y la columna del actor de cliente, tras `actorUserId`:

```ts
  /** Nulo salvo que el autor del evento fuese un usuario de cliente. Migración 013. */
  @Column({ name: 'actor_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  actorClientUserId!: number | null;
```

- [ ] **Step 3: Compilar y pasar la batería entera**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: compila y las 973 pruebas siguen en verde.

Si `tsc` se queja de que `createdBy` puede ser nulo en algún sitio que esperaba un número, **no lo silencies con `!` ni con un `as number`**: el valor de verdad puede faltar ahora. Trátalo donde salte.

- [ ] **Step 4: Arrancar el backend contra la base real**

Run: `cd backend && npm run start:dev`
Expected: arranca sin que `PortalSchemaValidator` aborte, y `GET /api/v1/work-items` responde. Esto comprueba lo que ninguna prueba unitaria comprueba: que las columnas que TypeORM ahora pide existen de verdad.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/work-items/entities/
git commit -m "feat(requerimientos): las entidades mapean origin y la autoria de cliente"
```

---

### Task 5: `ClientAdminGuard`

**Files:**
- Create: `backend/src/modules/portal/guards/client-admin.guard.ts`
- Test: `backend/src/modules/portal/guards/client-admin.guard.spec.ts`

**Interfaces:**
- Consumes: `AuthClientUser` de `../strategies/client-jwt.strategy`, que ya trae `isClientAdmin: boolean`.
- Produces: `export class ClientAdminGuard implements CanActivate`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `backend/src/modules/portal/guards/client-admin.guard.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { ClientAdminGuard } from './client-admin.guard';

function ctx(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('ClientAdminGuard', () => {
  const guard = new ClientAdminGuard();

  it('deja pasar al administrador de la empresa', () => {
    expect(guard.canActivate(ctx({ clientUserId: 1, clientId: 7, isClientAdmin: true }))).toBe(true);
  });

  it('deniega a un usuario de cliente que no es administrador', () => {
    expect(() => guard.canActivate(ctx({ clientUserId: 1, clientId: 7, isClientAdmin: false })))
      .toThrow(ForbiddenException);
  });

  // Las tres siguientes son el punto de esta clase: la ausencia debe
  // significar «no». El defecto que más veces ha reaparecido en este proyecto
  // es decidir por la ausencia de un valor, y aquí se prueba explícitamente.
  it('deniega cuando el token no trae el campo', () => {
    expect(() => guard.canActivate(ctx({ clientUserId: 1, clientId: 7 })))
      .toThrow(ForbiddenException);
  });

  it('deniega cuando no hay usuario en la petición', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });

  it('deniega cuando el campo llega con un valor que no es booleano', () => {
    // Un token manipulado puede traer cualquier cosa. Solo `true` pasa.
    expect(() => guard.canActivate(ctx({ isClientAdmin: 'true' }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx({ isClientAdmin: 1 }))).toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `cd backend && npx jest src/modules/portal/guards/client-admin.guard.spec.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

Crea `backend/src/modules/portal/guards/client-admin.guard.ts`:

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import { AuthClientUser } from '../strategies/client-jwt.strategy';

/**
 * Exige que la sesión del portal sea la de un administrador de su empresa.
 *
 * Va **siempre después** de `ClientJwtGuard`, que es quien deja el usuario en
 * la petición; por sí solo no autentica nada.
 *
 * Compara contra `true` en vez de mirar si el valor es verdadero. La diferencia
 * importa: `isClientAdmin` viaja dentro de un token, y un token manipulado
 * puede traer `1`, `"true"` o cualquier otra cosa que un `if` daría por buena.
 * Solo el booleano `true` —el que escribe `portal-auth.service.ts` con
 * `!!user.isAdmin`— abre la puerta. Todo lo demás, incluida la ausencia del
 * campo y la ausencia del usuario entero, es «no».
 */
@Injectable()
export class ClientAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: AuthClientUser }>().user;

    if (user?.isClientAdmin !== true) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Solo el administrador de la empresa puede crear requerimientos.',
      });
    }

    return true;
  }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `cd backend && npx jest src/modules/portal/guards/client-admin.guard.spec.ts`
Expected: PASS (6 pruebas).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/portal/guards/client-admin.guard.ts backend/src/modules/portal/guards/client-admin.guard.spec.ts
git commit -m "feat(portal): guard del rol administrador de cliente"
```

---

### Task 6: Alta de requerimiento desde el portal

**Files:**
- Create: `backend/src/modules/portal/portal-requirements.service.ts`
- Create: `backend/src/modules/portal/dto/create-portal-requirement.dto.ts`
- Create: `backend/src/modules/portal/dto/portal-requirement.dto.ts`
- Test: `backend/src/modules/portal/portal-requirements.service.spec.ts`

**Interfaces:**
- Consumes: `WorkItemsRepository` (con `runInTransaction`), las entidades de la tarea 4, `sameId`/`isUsableId` de `backend/src/common/ids.ts`.
- Produces:
  - `PortalRequirementView` — la vista publicada (ver tabla de campos abajo).
  - `PortalRequirementsService.create(clientUserId: number, clientId: number, dto: CreatePortalRequirementDto): Promise<PortalRequirementView>`

- [ ] **Step 1: Escribir los DTO**

`backend/src/modules/portal/dto/create-portal-requirement.dto.ts`:

```ts
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Lo único que el cliente aporta. **No hay prioridad ni fecha**: las fija la
 * casa al aceptar, y aceptarlas aquí sería dejar que el cliente se
 * autocomprometa un plazo.
 */
export class CreatePortalRequirementDto {
  // `trim` antes de validar: un título de solo espacios pasaría MinLength(3)
  // y crearía una fila con el título en blanco. Ya pasó con los tickets.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  title!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(16383)
  descriptionMd!: string;
}
```

`backend/src/modules/portal/dto/portal-requirement.dto.ts`:

```ts
import { WorkItemPriority } from '../../work-items/domain/work-item-board';

/** Cómo se le llama a cada estado de cara al cliente. */
export type PortalRequirementStatusLabel =
  | 'Solicitado'
  | 'Aceptado, en cola'
  | 'En desarrollo'
  | 'En pruebas'
  | 'Entregado'
  | 'Bloqueado'
  | 'Cancelado'
  | 'Rechazado';

/**
 * Lo único que el portal publica de un requerimiento. Lista blanca: lo que no
 * está aquí no sale, y añadir un campo es una decisión, no un descuido.
 *
 * Fuera quedan a propósito `labels`, `boardOrder`, `projectId`,
 * `assigneeUserId`, `acceptanceCriteria` y `createdBy`.
 */
export interface PortalRequirementView {
  id: number;
  code: string | null;
  title: string;
  descriptionMd: string | null;
  status: PortalRequirementStatusLabel;
  /** `null` mientras esté en SOLICITADO: antes de aceptar no hay compromiso. */
  priority: WorkItemPriority | null;
  /** Fecha comprometida (`due_date`), `YYYY-MM-DD`. `null` hasta la aceptación. */
  committedDate: string | null;
  closedAt: string | null;
  createdAt: string;
  /** Solo cuando el estado es Rechazado. */
  rejectionReason: string | null;
}
```

- [ ] **Step 2: Escribir la prueba que falla**

Crea `backend/src/modules/portal/portal-requirements.service.spec.ts`. Usa un doble del repositorio con un `runInTransaction` que ejecute el callback con un `manager` falso, siguiendo el estilo de `work-items.service.spec.ts`:

```ts
import { PortalRequirementsService } from './portal-requirements.service';

describe('PortalRequirementsService.create', () => {
  it('nace en SOLICITADO, con origen PORTAL y sin autor interno', async () => {
    const { service, guardado } = makeService();

    await service.create(9, 7, { title: 'Exportar a Excel', descriptionMd: 'Desde el listado' });

    expect(guardado.status).toBe('SOLICITADO');
    expect(guardado.origin).toBe('PORTAL');
    expect(guardado.clientId).toBe(7);
    expect(guardado.createdByClientUserId).toBe(9);
    // Nulo, no 0: no hubo ningún usuario interno. Un 0 sería una referencia
    // a un usuario que no existe.
    expect(guardado.createdBy).toBeNull();
  });

  it('no ocupa posición en el tablero', async () => {
    const { service, guardado } = makeService();
    await service.create(9, 7, { title: 'Exportar a Excel', descriptionMd: 'x' });
    // Un SOLICITADO no está en ninguna columna. La posición se calcula al
    // aceptar, no antes.
    expect(guardado.boardOrder).toBe(0);
  });

  it('escribe el evento REQUESTED con el actor de cliente', async () => {
    const { service, eventos } = makeService();
    await service.create(9, 7, { title: 'Exportar a Excel', descriptionMd: 'x' });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      type: 'REQUESTED',
      toStatus: 'SOLICITADO',
      actorUserId: null,
      actorClientUserId: 9,
    });
  });

  it('devuelve la vista del portal, sin prioridad todavía', async () => {
    const { service } = makeService();
    const vista = await service.create(9, 7, { title: 'Exportar a Excel', descriptionMd: 'x' });
    expect(vista.status).toBe('Solicitado');
    expect(vista.priority).toBeNull();
    expect(vista.committedDate).toBeNull();
    expect(vista.rejectionReason).toBeNull();
    expect(vista.code).toBe('RQ-0001');
  });

  it('rechaza una sesión sin empresa utilizable', async () => {
    const { service } = makeService();
    await expect(service.create(9, 0, { title: 'x'.repeat(5), descriptionMd: 'y' }))
      .rejects.toThrow(/no identifica a ninguna empresa/i);
    await expect(service.create(0, 7, { title: 'x'.repeat(5), descriptionMd: 'y' }))
      .rejects.toThrow(/no identifica a ninguna empresa/i);
  });
});
```

Escribe `makeService()` en el mismo fichero: debe devolver `{ service, guardado, eventos }`, donde `guardado` es el objeto que se pasó a `save` del repositorio de `WorkItem` y `eventos` el array de los guardados como `WorkItemEvent`. El `save` falso debe devolver el objeto con `id: 1` para que `buildCode` produzca `RQ-0001`.

- [ ] **Step 3: Ejecutar y comprobar que falla**

Run: `cd backend && npx jest src/modules/portal/portal-requirements.service.spec.ts`
Expected: FAIL — el servicio no existe.

- [ ] **Step 4: Implementar el alta**

Crea `backend/src/modules/portal/portal-requirements.service.ts`. Puntos que la implementación debe respetar:

```ts
  /**
   * Camino de escritura propio, corto, y **no** `WorkItemsService.create`.
   *
   * Aquel calcula la posición del ítem dentro de la columna PENDIENTE y
   * renumera la columna entera. Un SOLICITADO no está en ninguna columna, así
   * que ese cálculo no solo sobra: metería un ítem que el cliente aún no tiene
   * aceptado en medio del orden del tablero interno.
   *
   * Lo que sí se copia de allí es la disciplina: todo dentro de una
   * transacción, el código `RQ-` asignado después del insert porque depende
   * del id autoincremental, y el evento escrito con el mismo manager para que
   * no quede huérfano si algo falla antes del commit.
   */
  async create(
    clientUserId: number,
    clientId: number,
    dto: CreatePortalRequirementDto,
  ): Promise<PortalRequirementView> {
    // Los dos, y antes de tocar la base: un clientId falsy haría desaparecer
    // el filtro de empresa en cualquier consulta posterior, y un
    // clientUserId falsy grabaría una fila sin autor real.
    assertSessionScope(clientId, 'clientId');
    assertSessionScope(clientUserId, 'clientUserId');

    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);

      const saved = await itemRepo.save(
        itemRepo.create({
          clientId,
          projectId: null,
          title: dto.title.trim(),
          descriptionMd: dto.descriptionMd.trim(),
          acceptanceCriteria: null,
          labels: null,
          priority: DEFAULT_PRIORITY,
          status: 'SOLICITADO',
          origin: 'PORTAL',
          assigneeUserId: null,
          dueDate: null,
          boardOrder: 0,
          createdBy: null,
          createdByClientUserId: clientUserId,
        }),
      );

      const code = `RQ-${String(saved.id).padStart(4, '0')}`;
      await itemRepo.update(saved.id, { code });

      const eventRepo = manager.getRepository(WorkItemEvent);
      await eventRepo.save(
        eventRepo.create({
          workItemId: saved.id,
          type: 'REQUESTED',
          actorUserId: null,
          actorClientUserId: clientUserId,
          fromStatus: null,
          toStatus: 'SOLICITADO',
          reason: null,
          payload: null,
        }),
      );

      return this.toPortalView({ ...saved, code }, null);
    });
  }
```

`assertSessionScope` y `toIso` son funciones privadas de `portal-tickets.service.ts`. **No las importes desde allí ni las dupliques**: muévelas a `backend/src/modules/portal/session-scope.ts` y haz que los dos servicios las importen de ahí. `portal-tickets.service.ts` debe seguir exportando `sameId` como hoy para no romper a quien lo importe.

Al mover `assertSessionScope`, su `Logger` deja de poder nombrar `PortalTicketsService`: pásale el nombre del servicio como tercer parámetro, con el valor que cada llamador ya usa.

`DEFAULT_PRIORITY` (`'MEDIA'`) se graba porque la columna no admite nulo; **la vista lo esconde** mientras el estado sea `SOLICITADO`, que es donde importa.

- [ ] **Step 5: Implementar la proyección**

En el mismo fichero, privado:

```ts
/**
 * Cómo se llama cada estado de cara al cliente.
 *
 * `PENDIENTE` significa para la casa «aceptado y en cola», pero un cliente que
 * lee «Pendiente» no lo distingue de «Solicitado» — que es justo la diferencia
 * entre «lo pediste» y «nos comprometimos». El `Record` completo obliga a
 * nombrar aquí cualquier estado nuevo, o deja de compilar.
 */
const STATUS_LABELS: Record<WorkItemStatus, PortalRequirementStatusLabel> = {
  SOLICITADO: 'Solicitado',
  PENDIENTE: 'Aceptado, en cola',
  EN_PROCESO: 'En desarrollo',
  PRUEBAS: 'En pruebas',
  CERRADO: 'Entregado',
  BLOQUEADO: 'Bloqueado',
  CANCELADO: 'Cancelado',
  RECHAZADO: 'Rechazado',
};

  /**
   * Lista blanca campo a campo. Nunca `{...w}` menos claves: eso publica por
   * omisión cualquier columna que alguien añada mañana a la entidad.
   */
  private toPortalView(w: WorkItem, rejectionReason: string | null): PortalRequirementView {
    return {
      id: Number(w.id),
      code: w.code ?? null,
      title: w.title,
      descriptionMd: w.descriptionMd ?? null,
      status: STATUS_LABELS[w.status],
      // Por el estado, no por si `dueDate` está vacío: la prioridad guardada es
      // el valor por defecto de la columna, y enseñarlo antes de aceptar
      // comunicaría un compromiso que nadie ha asumido.
      priority: w.status === 'SOLICITADO' ? null : w.priority,
      committedDate: w.dueDate ?? null,
      closedAt: toIso(w.closedAt),
      createdAt: toIso(w.createdAt)!,
      rejectionReason: w.status === 'RECHAZADO' ? rejectionReason : null,
    };
  }
```

- [ ] **Step 6: Ejecutar y comprobar que pasa**

Run: `cd backend && npx jest src/modules/portal/portal-requirements.service.spec.ts`
Expected: PASS

- [ ] **Step 7: Comprobar que no se rompió el portal de tickets**

Run: `cd backend && npx jest src/modules/portal`
Expected: PASS — el movimiento de `assertSessionScope` no cambió comportamiento.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/portal/
git commit -m "feat(requerimientos): alta desde el portal, en SOLICITADO"
```

---

### Task 7: Listado y detalle en el portal

**Files:**
- Modify: `backend/src/modules/portal/portal-requirements.service.ts`
- Test: `backend/src/modules/portal/portal-requirements.service.spec.ts`

**Interfaces:**
- Consumes: `PortalRequirementView` y `toPortalView` de la tarea 6.
- Produces:
  - `PortalRequirementsService.list(clientId: number): Promise<PortalRequirementView[]>`
  - `PortalRequirementsService.findOne(clientId: number, requirementId: number): Promise<PortalRequirementView>`

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
describe('PortalRequirementsService.list', () => {
  it('devuelve solo los del portal de la propia empresa', async () => {
    const { service } = makeService([
      fila({ id: 1, clientId: 7, origin: 'PORTAL' }),
      fila({ id: 2, clientId: 7, origin: 'INTERNO' }),   // trabajo interno
      fila({ id: 3, clientId: 8, origin: 'PORTAL' }),    // otra empresa
    ]);

    const vistas = await service.list(7);

    expect(vistas.map((v) => v.id)).toEqual([1]);
  });
});

describe('PortalRequirementsService.findOne', () => {
  it('devuelve el requerimiento propio', async () => {
    const { service } = makeService([fila({ id: 1, clientId: 7, origin: 'PORTAL' })]);
    await expect(service.findOne(7, 1)).resolves.toMatchObject({ id: 1 });
  });

  // Las dos siguientes son la frontera entre empresas. 404 y no 403: un 403
  // confirmaría que el recurso existe.
  it('da 404 con un requerimiento de otra empresa', async () => {
    const { service } = makeService([fila({ id: 1, clientId: 8, origin: 'PORTAL' })]);
    await expect(service.findOne(7, 1)).rejects.toMatchObject({ status: 404 });
  });

  it('da 404 con un requerimiento interno de la propia empresa', async () => {
    const { service } = makeService([fila({ id: 1, clientId: 7, origin: 'INTERNO' })]);
    await expect(service.findOne(7, 1)).rejects.toMatchObject({ status: 404 });
  });

  it('da el mismo cuerpo que uno inexistente', async () => {
    const { service } = makeService([fila({ id: 1, clientId: 8, origin: 'PORTAL' })]);
    const ajeno = await service.findOne(7, 1).catch((e) => e.getResponse());
    const inexistente = await service.findOne(7, 999).catch((e) => e.getResponse());
    expect(ajeno).toEqual(inexistente);
  });

  it('publica exactamente las claves de la lista blanca', async () => {
    const { service } = makeService([fila({ id: 1, clientId: 7, origin: 'PORTAL' })]);
    const vista = await service.findOne(7, 1);
    expect(Object.keys(vista).sort()).toEqual(
      ['closedAt', 'code', 'committedDate', 'createdAt', 'descriptionMd',
       'id', 'priority', 'rejectionReason', 'status', 'title'].sort(),
    );
  });

  it('esconde la prioridad mientras no esté aceptado', async () => {
    const { service } = makeService([
      fila({ id: 1, clientId: 7, origin: 'PORTAL', status: 'SOLICITADO', priority: 'MEDIA' }),
    ]);
    await expect(service.findOne(7, 1)).resolves.toMatchObject({ priority: null });
  });

  it('trae el motivo del último evento REJECTED cuando está rechazado', async () => {
    const { service } = makeService(
      [fila({ id: 1, clientId: 7, origin: 'PORTAL', status: 'RECHAZADO' })],
      [{ workItemId: 1, type: 'REJECTED', reason: 'Fuera del alcance del contrato' }],
    );
    await expect(service.findOne(7, 1)).resolves.toMatchObject({
      status: 'Rechazado',
      rejectionReason: 'Fuera del alcance del contrato',
    });
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `cd backend && npx jest src/modules/portal/portal-requirements.service.spec.ts`
Expected: FAIL — `list` y `findOne` no existen.

- [ ] **Step 3: Implementar**

```ts
  async list(clientId: number): Promise<PortalRequirementView[]> {
    assertSessionScope(clientId, 'clientId');

    const filas = await this.repo.listPortalRequirements(clientId);
    // El motivo solo se busca para los rechazados: es una consulta por ítem y
    // en un listado de veinte no tiene sentido hacerla veinte veces para
    // descartarla diecinueve.
    return filas.map((w) => this.toPortalView(w, null));
  }

  /**
   * Los dos filtros van en el WHERE, no en un `if` posterior: la consulta no
   * debe poder devolver nunca una fila de otra empresa ni un requerimiento
   * interno, ni siquiera un instante antes de descartarla.
   */
  async findOne(clientId: number, requirementId: number): Promise<PortalRequirementView> {
    assertSessionScope(clientId, 'clientId');

    const w = await this.repo.findPortalRequirement(clientId, requirementId);
    if (!w) throw this.noExiste();

    const reason = w.status === 'RECHAZADO'
      ? await this.repo.lastRejectionReason(requirementId)
      : null;

    return this.toPortalView(w, reason);
  }

  /**
   * Un requerimiento de otra empresa, uno interno y uno que no existe dan
   * exactamente esto. Distinguirlos confirmaría cuáles existen.
   */
  private noExiste(): NotFoundException {
    return new NotFoundException({
      code: 'NOT_FOUND',
      message: 'Requerimiento no encontrado',
    });
  }
```

En `WorkItemsRepository` añade los tres métodos:

```ts
  /** Solo lo que pidió esa empresa desde el portal. Los dos filtros, siempre. */
  listPortalRequirements(clientId: number): Promise<WorkItem[]> {
    return this.repo.find({
      where: { clientId, origin: 'PORTAL' },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  async findPortalRequirement(clientId: number, id: number): Promise<WorkItem | null> {
    return this.repo.findOne({ where: { id, clientId, origin: 'PORTAL' } });
  }

  async lastRejectionReason(workItemId: number): Promise<string | null> {
    const ev = await this.eventsRepo.findOne({
      where: { workItemId, type: 'REJECTED' },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return ev?.reason ?? null;
  }
```

Si `WorkItemsRepository` no tiene todavía acceso al repositorio de `WorkItemEvent`, inyéctalo con `@InjectRepository(WorkItemEvent)` como ya hace con `WorkItem`.

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `cd backend && npx jest src/modules/portal/portal-requirements.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/portal/ backend/src/modules/work-items/work-items.repository.ts
git commit -m "feat(requerimientos): listado y detalle en el portal, con frontera por empresa"
```

---

### Task 8: Rutas del portal

**Files:**
- Create: `backend/src/modules/portal/portal-requirements.controller.ts`
- Modify: `backend/src/modules/portal/portal.module.ts`

**Interfaces:**
- Consumes: `ClientJwtGuard`, `ClientAdminGuard` (tarea 5), `CurrentClientUser`, `PortalRequirementsService` (tareas 6 y 7).
- Produces: `POST /portal/requerimientos`, `GET /portal/requerimientos`, `GET /portal/requerimientos/:id`.

- [ ] **Step 1: Escribir el controlador**

```ts
/**
 * Ninguna ruta acepta `clientId`: el único que existe aquí es el del token que
 * `ClientJwtGuard` acaba de verificar. Mismo criterio que
 * `PortalTicketsController`.
 */
const requirementIdPipe = new ParseIntPipe({
  exceptionFactory: () =>
    new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'El identificador del requerimiento no es válido.',
    }),
});

@Controller('portal/requerimientos')
@UseGuards(ClientJwtGuard)
export class PortalRequirementsController {
  constructor(private readonly service: PortalRequirementsService) {}

  /**
   * El único punto con `ClientAdminGuard`. Leer queda abierto a cualquier
   * usuario de la empresa: es el registro del trabajo que su compañía pidió.
   */
  @Post()
  @UseGuards(ClientAdminGuard)
  create(
    @CurrentClientUser() user: AuthClientUser,
    @Body() dto: CreatePortalRequirementDto,
  ): Promise<PortalRequirementView> {
    return this.service.create(user.clientUserId, user.clientId, dto);
  }

  @Get()
  list(@CurrentClientUser() user: AuthClientUser): Promise<PortalRequirementView[]> {
    return this.service.list(user.clientId);
  }

  @Get(':id')
  findOne(
    @CurrentClientUser() user: AuthClientUser,
    @Param('id', requirementIdPipe) id: number,
  ): Promise<PortalRequirementView> {
    return this.service.findOne(user.clientId, id);
  }
}
```

- [ ] **Step 2: Registrar en el módulo**

En `portal.module.ts`:
- añade `PortalRequirementsController` a `controllers`,
- añade `PortalRequirementsService` a `providers`,
- añade `WorkItemsModule` a `imports`.

`WorkItemsModule` ya exporta `WorkItemsRepository`, así que no hay que tocarlo. Importarlo entero es seguro aquí: solo arrastra `ClientsModule` —que el portal ya usa para resolver la razón social— y `ProjectsModule`. No es el caso de `AudioModule`, que arrastraba la cola de BullMQ y obligó a extraer `StorageModule`.

- [ ] **Step 3: Comprobar que el backend arranca**

Run: `cd backend && npx tsc --noEmit && npm run start:dev`
Expected: arranca sin errores de inyección. Un `useMocker` que devuelve `{}` a todo ha escondido dependencias irresolubles en este proyecto: la comprobación que vale es el arranque real.

- [ ] **Step 4: Probar las tres rutas contra el servidor**

Con una sesión de cliente **administrador**:
```bash
curl -s -X POST http://localhost:3000/api/v1/portal/requerimientos \
  -H "Authorization: Bearer $TOKEN_ADMIN" -H 'Content-Type: application/json' \
  -d '{"title":"Exportar el listado a Excel","descriptionMd":"Desde la pantalla de tickets"}'
curl -s http://localhost:3000/api/v1/portal/requerimientos -H "Authorization: Bearer $TOKEN_ADMIN"
```
Expected: `201` con la vista (`status: "Solicitado"`, `priority: null`), y el listado devolviéndolo.

Con una sesión de cliente **no administrador**:
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/v1/portal/requerimientos \
  -H "Authorization: Bearer $TOKEN_NORMAL" -H 'Content-Type: application/json' \
  -d '{"title":"Prueba de permisos","descriptionMd":"No debe crearse"}'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/v1/portal/requerimientos \
  -H "Authorization: Bearer $TOKEN_NORMAL"
```
Expected: `403` en el alta y `200` en el listado.

Sin token: `401` en las tres.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/portal/
git commit -m "feat(requerimientos): rutas del portal, alta solo para el administrador"
```

---

### Task 9: Aceptar y rechazar

**Files:**
- Create: `backend/src/modules/work-items/work-item-intake.service.ts`
- Create: `backend/src/modules/work-items/dto/accept-work-item.dto.ts`
- Create: `backend/src/modules/work-items/dto/reject-work-item.dto.ts`
- Modify: `backend/src/modules/work-items/work-items.controller.ts`
- Modify: `backend/src/modules/work-items/work-items.module.ts`
- Test: `backend/src/modules/work-items/work-item-intake.service.spec.ts`

**Interfaces:**
- Consumes: `insertionIndex`, `reorder` y `assertReason` de `./domain/work-item-board`; `WorkItemsRepository` (con `runInTransaction`, `applyOrder`, `listColumn`).
- Produces:
  - `WorkItemIntakeService.accept(id: number, actorUserId: number, dto: AcceptWorkItemDto): Promise<WorkItem>`
  - `WorkItemIntakeService.reject(id: number, actorUserId: number, dto: RejectWorkItemDto): Promise<WorkItem>`
  - `POST /work-items/:id/accept`, `POST /work-items/:id/reject`

- [ ] **Step 1: Escribir los DTO**

`accept-work-item.dto.ts`:

```ts
import { IsDateString, IsIn } from 'class-validator';
import { WORK_ITEM_PRIORITIES, WorkItemPriority } from '../domain/work-item-board';

export class AcceptWorkItemDto {
  @IsIn(WORK_ITEM_PRIORITIES)
  priority!: WorkItemPriority;

  /**
   * Fecha comprometida, `YYYY-MM-DD`. **Obligatoria**: es lo único que
   * garantiza que `due_date` esté relleno, y de ella depende el informe
   * mensual que el cliente descargará. Hoy el campo es opcional y nadie lo
   * rellena.
   */
  @IsDateString({ strict: true })
  committedDate!: string;
}
```

`reject-work-item.dto.ts`:

```ts
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class RejectWorkItemDto {
  // `trim` antes de validar: un motivo de solo espacios pasaría MinLength y
  // dejaría al cliente con un rechazo sin explicación.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason!: string;
}
```

- [ ] **Step 2: Escribir las pruebas que fallan**

```ts
describe('WorkItemIntakeService.accept', () => {
  it('pasa a PENDIENTE fijando prioridad y fecha comprometida', async () => {
    const { service, patch } = makeService(fila({ status: 'SOLICITADO' }));
    await service.accept(1, 5, { priority: 'ALTA', committedDate: '2026-09-30' });
    expect(patch).toMatchObject({ status: 'PENDIENTE', priority: 'ALTA', dueDate: '2026-09-30' });
  });

  it('escribe el evento ACCEPTED con el actor interno', async () => {
    const { service, eventos } = makeService(fila({ status: 'SOLICITADO' }));
    await service.accept(1, 5, { priority: 'ALTA', committedDate: '2026-09-30' });
    expect(eventos[0]).toMatchObject({
      type: 'ACCEPTED', fromStatus: 'SOLICITADO', toStatus: 'PENDIENTE', actorUserId: 5,
    });
  });

  it('lo coloca en la columna PENDIENTE por su banda de prioridad', async () => {
    const { service, orden } = makeService(fila({ id: 9, status: 'SOLICITADO' }), [
      fila({ id: 1, status: 'PENDIENTE', priority: 'ALTA' }),
      fila({ id: 2, status: 'PENDIENTE', priority: 'BAJA' }),
    ]);
    await service.accept(9, 5, { priority: 'MEDIA', committedDate: '2026-09-30' });
    // Un MEDIA nuevo aterriza sobre los BAJA y debajo de los ALTA.
    expect(orden).toEqual([1, 9, 2]);
  });

  it('rechaza una fecha comprometida anterior a hoy', async () => {
    const { service } = makeService(fila({ status: 'SOLICITADO' }));
    await expect(service.accept(1, 5, { priority: 'ALTA', committedDate: '2020-01-01' }))
      .rejects.toThrow(/anterior a hoy/i);
  });

  it('no acepta lo que no está en SOLICITADO', async () => {
    const { service } = makeService(fila({ status: 'EN_PROCESO' }));
    await expect(service.accept(1, 5, { priority: 'ALTA', committedDate: '2026-09-30' }))
      .rejects.toThrow(/no está pendiente de aceptación/i);
  });

  it('no escribe nada cuando rechaza la aceptación', async () => {
    const { service, patch, eventos } = makeService(fila({ status: 'CERRADO' }));
    await expect(service.accept(1, 5, { priority: 'ALTA', committedDate: '2026-09-30' }))
      .rejects.toThrow();
    expect(patch).toBeNull();
    expect(eventos).toHaveLength(0);
  });
});

describe('WorkItemIntakeService.reject', () => {
  it('pasa a RECHAZADO y guarda el motivo en el evento', async () => {
    const { service, patch, eventos } = makeService(fila({ status: 'SOLICITADO' }));
    await service.reject(1, 5, { reason: 'Fuera del alcance del contrato' });
    expect(patch).toMatchObject({ status: 'RECHAZADO' });
    expect(eventos[0]).toMatchObject({
      type: 'REJECTED', toStatus: 'RECHAZADO', reason: 'Fuera del alcance del contrato',
    });
  });

  it('no rechaza lo que no está en SOLICITADO', async () => {
    const { service } = makeService(fila({ status: 'PENDIENTE' }));
    await expect(service.reject(1, 5, { reason: 'Ya no aplica' }))
      .rejects.toThrow(/no está pendiente de aceptación/i);
  });
});
```

`makeService(item, columnaPendiente?)` devuelve `{ service, patch, eventos, orden }`: `patch` es lo último pasado a `update` (o `null`), `eventos` los guardados, `orden` lo pasado a `applyOrder`.

La prueba de la fecha pasada debe fijar la fecha del sistema (`jest.useFakeTimers().setSystemTime(new Date('2026-08-07T12:00:00'))`) para no volverse falsa con el paso del tiempo.

- [ ] **Step 3: Ejecutar y comprobar que falla**

Run: `cd backend && npx jest src/modules/work-items/work-item-intake.service.spec.ts`
Expected: FAIL — el servicio no existe.

- [ ] **Step 4: Implementar**

Puntos que la implementación debe respetar:

```ts
  /**
   * La aceptación es el acto que convierte una petición en un compromiso: aquí
   * y solo aquí se fija la fecha que el cliente verá y que el informe medirá.
   *
   * Todo va en una transacción porque son tres escrituras que no tienen
   * sentido por separado: el cambio de estado, el evento y la renumeración de
   * la columna.
   */
  async accept(id: number, actorUserId: number, dto: AcceptWorkItemDto): Promise<WorkItem> {
    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);
      const actual = await itemRepo.findOne({ where: { id } });
      if (!actual) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Requerimiento no encontrado' });

      // Por el estado, no por si `dueDate` está vacío ni por el origen: lo que
      // habilita la aceptación es estar esperándola.
      this.assertEsperandoAceptacion(actual.status);
      this.assertFechaNoPasada(dto.committedDate);

      // La columna a la que entra, leída con el manager transaccional para que
      // el orden que se calcula sea consistente con lo que se va a escribir.
      // Mismo criterio (y misma ventana aceptada de concurrencia) que
      // WorkItemsService.create.
      const pendientes = await itemRepo.find({
        where: { status: 'PENDIENTE' },
        order: { boardOrder: 'ASC', id: 'ASC' },
      });
      const index = insertionIndex(pendientes.map((w) => w.priority), dto.priority);

      await itemRepo.update(id, {
        status: 'PENDIENTE',
        priority: dto.priority,
        dueDate: dto.committedDate,
        boardOrder: index,
      });

      const eventRepo = manager.getRepository(WorkItemEvent);
      await eventRepo.save(
        eventRepo.create({
          workItemId: id,
          type: 'ACCEPTED',
          actorUserId,
          // Nulo: quien acepta es siempre alguien de casa. El cliente pide;
          // no se acepta a sí mismo.
          actorClientUserId: null,
          fromStatus: 'SOLICITADO',
          toStatus: 'PENDIENTE',
          reason: null,
          payload: { priority: dto.priority, committedDate: dto.committedDate },
        }),
      );

      // Renumera la columna con el ítem nuevo ya en su sitio.
      const orderedIds = reorder(pendientes.map((w) => w.id), id, index);
      await this.repo.applyOrder(manager, orderedIds);

      const aceptado = await itemRepo.findOne({ where: { id } });
      // No puede ser nulo: lo acabamos de actualizar dentro de la misma
      // transacción. Se comprueba igual, porque un `!` aquí es una promesa que
      // nadie vuelve a verificar.
      if (!aceptado) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Requerimiento no encontrado' });
      }
      return aceptado;
    });
  }

  private assertEsperandoAceptacion(status: WorkItemStatus): void {
    if (status === 'SOLICITADO') return;
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: 'El requerimiento no está pendiente de aceptación.',
    });
  }

  /**
   * Comparación por fecha civil, no por instante: `committedDate` es un `date`
   * sin hora, y comparar contra `new Date()` rechazaría el propio día de hoy
   * a partir de las 00:00 según la zona horaria del servidor. Este servicio
   * corre en producción en UTC y en desarrollo en hora de Lima; la diferencia
   * es de cinco horas y ya mordió una vez en las fechas de los correos.
   */
  private assertFechaNoPasada(committedDate: string): void {
    const hoy = new Date();
    const hoyCivil = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    if (committedDate >= hoyCivil) return;
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: 'La fecha comprometida no puede ser anterior a hoy.',
    });
  }
```

`reject` sigue el mismo esqueleto: comprueba el estado, escribe `status: 'RECHAZADO'`, y el evento `REJECTED` con `reason: dto.reason`. No toca el orden del tablero — un rechazado no entra en ninguna columna.

- [ ] **Step 5: Ejecutar y comprobar que pasa**

Run: `cd backend && npx jest src/modules/work-items/work-item-intake.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Exponer las rutas**

En `work-items.controller.ts` (que ya corre bajo `@UseGuards(JwtAuthGuard, StaffOnlyGuard)`):

```ts
  /**
   * Aceptar compromete una fecha de entrega con un cliente. Va con los mismos
   * guards que el resto del controlador —sin `RolesGuard`, que este módulo no
   * usa— y está anotado como riesgo en la especificación.
   */
  @Post(':id/accept')
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AcceptWorkItemDto,
  ): Promise<WorkItem> {
    return this.intake.accept(id, user.id, dto);
  }

  @Post(':id/reject')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectWorkItemDto,
  ): Promise<WorkItem> {
    return this.intake.reject(id, user.id, dto);
  }
```

Registra `WorkItemIntakeService` en `providers` de `work-items.module.ts`.

- [ ] **Step 7: Probar el ciclo completo contra el servidor**

Run:
```bash
# con el id del requerimiento creado en la tarea 8, y sesión de personal
curl -s -X POST http://localhost:3000/api/v1/work-items/$ID/accept \
  -H "Authorization: Bearer $TOKEN_STAFF" -H 'Content-Type: application/json' \
  -d '{"priority":"ALTA","committedDate":"2026-09-30"}'
# y luego, desde el portal
curl -s http://localhost:3000/api/v1/portal/requerimientos/$ID -H "Authorization: Bearer $TOKEN_ADMIN"
```
Expected: el portal devuelve `status: "Aceptado, en cola"`, `priority: "ALTA"`, `committedDate: "2026-09-30"`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/work-items/
git commit -m "feat(requerimientos): aceptar con compromiso o rechazar con motivo"
```

---

### Task 10: El login del portal dice si la sesión es administradora

**Files:**
- Modify: `backend/src/modules/portal/portal-auth.service.ts`
- Test: `backend/src/modules/portal/portal-auth.service.spec.ts`

**Interfaces:**
- Consumes: `ClientUser.isAdmin` (tinyint).
- Produces: la respuesta de login y de refresh incluye `clientUser.isAdmin: boolean`.

Sin esto el frontend no puede saber si enseñar el botón de alta: `PortalClientUser` no lleva el dato hoy, aunque el token sí.

- [ ] **Step 1: Escribir la prueba que falla**

```ts
  it('la sesión dice si el usuario administra su empresa', async () => {
    const { service } = makeService({ /* ...usuario... */ isAdmin: 1 });
    const sesion = await service.login({ email: 'a@x.com', password: 'secreta' });
    // Booleano, no el tinyint: el frontend hace `if (user.isAdmin)` y un 0
    // llegado como cadena '0' sería verdadero.
    expect(sesion.clientUser.isAdmin).toBe(true);
  });

  it('un usuario normal llega con isAdmin en false', async () => {
    const { service } = makeService({ /* ...usuario... */ isAdmin: 0 });
    const sesion = await service.login({ email: 'a@x.com', password: 'secreta' });
    expect(sesion.clientUser.isAdmin).toBe(false);
  });
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `cd backend && npx jest src/modules/portal/portal-auth.service.spec.ts`
Expected: FAIL — `isAdmin` no está en la respuesta.

- [ ] **Step 3: Implementar**

En la interfaz de la respuesta, dentro de `clientUser`:

```ts
    /**
     * Si administra su empresa. El mismo hecho que viaja en el token como
     * `isClientAdmin` y que gobierna `ClientAdminGuard`; aquí va para que la
     * interfaz pueda esconder lo que el guard ya deniega.
     *
     * Esconder el botón **no** es la defensa: la defensa es el guard.
     */
    isAdmin: boolean;
```

Y en el objeto devuelto, junto a los demás campos:

```ts
        isAdmin: !!user.isAdmin,
```

Aplícalo en los dos sitios que construyen la respuesta (login y refresh) si están separados; si comparten un método privado, en ese.

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `cd backend && npx jest src/modules/portal`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/portal/portal-auth.service.ts backend/src/modules/portal/portal-auth.service.spec.ts
git commit -m "feat(portal): la sesion informa si el usuario administra su empresa"
```

---

### Task 11: El portal, en pantalla

**Files:**
- Create: `web/src/pages/portal/PortalRequirementsListPage.tsx`
- Create: `web/src/pages/portal/PortalRequirementDetailPage.tsx`
- Create: `web/src/pages/portal/NewPortalRequirementDialog.tsx`
- Modify: `web/src/api/portal.api.ts`, `web/src/api/types.ts`, `web/src/App.tsx`, `web/src/layout/PortalLayout.tsx`

**Interfaces:**
- Consumes: `GET/POST /portal/requerimientos` (tarea 8), `clientUser.isAdmin` (tarea 10).
- Produces: rutas `/portal/requerimientos` y `/portal/requerimientos/:id`.

- [ ] **Step 1: Tipos y llamadas**

En `web/src/api/types.ts`, añade `isAdmin: boolean;` a `PortalClientUser`, y el tipo de la vista **copiando los nombres del backend exactamente**:

```ts
export type PortalRequirementStatusLabel =
  | 'Solicitado' | 'Aceptado, en cola' | 'En desarrollo' | 'En pruebas'
  | 'Entregado' | 'Bloqueado' | 'Cancelado' | 'Rechazado';

export interface PortalRequirement {
  id: number;
  code: string | null;
  title: string;
  descriptionMd: string | null;
  status: PortalRequirementStatusLabel;
  priority: 'ALTA' | 'MEDIA' | 'BAJA' | null;
  committedDate: string | null;
  closedAt: string | null;
  createdAt: string;
  rejectionReason: string | null;
}
```

En `web/src/api/portal.api.ts`, junto a las de tickets, y con los límites del DTO como constantes exportadas igual que los de ticket:

```ts
export const PORTAL_REQUIREMENT_TITLE_MAX_LENGTH = 240;
export const PORTAL_REQUIREMENT_DESCRIPTION_MAX_LENGTH = 16383;

export const listPortalRequirements = () =>
  portalApiClient.get<PortalRequirement[]>('/portal/requerimientos').then((r) => r.data);

export const getPortalRequirement = (id: number) =>
  portalApiClient.get<PortalRequirement>(`/portal/requerimientos/${id}`).then((r) => r.data);

export const createPortalRequirement = (body: { title: string; descriptionMd: string }) =>
  portalApiClient.post<PortalRequirement>('/portal/requerimientos', body).then((r) => r.data);
```

- [ ] **Step 2: El listado**

`PortalRequirementsListPage.tsx`: tabla con código, título, estado, fecha comprometida y fecha de alta. Cada fila enlaza al detalle.

El botón «Pedir un requerimiento» se pinta **solo si** `clientUser.isAdmin` (léelo de `PortalAuthContext`).

Estados vacíos, siguiendo el tono de `PortalTicketsListPage`:
- Sin ninguno y administrador: «Todavía no has pedido ningún requerimiento.»
- Sin ninguno y no administrador: «Tu empresa todavía no ha pedido ningún requerimiento. Puede hacerlo el administrador de tu cuenta.»

Pinta la fecha comprometida vacía como «Pendiente de aceptación», no como un guion: el guion se lee como «no hay» y aquí lo que hay es «todavía no».

- [ ] **Step 3: El detalle**

`PortalRequirementDetailPage.tsx`: título, código, estado, prioridad (oculta si viene `null`), fecha comprometida, descripción.

Si el estado es `'Rechazado'`, muestra `rejectionReason` en un bloque destacado y con la etiqueta «Motivo del rechazo». Si viniera `null` estando rechazado, escribe «Sin motivo registrado» — **no dejes el bloque vacío**, que se lee como un fallo de carga.

- [ ] **Step 4: El diálogo de alta**

`NewPortalRequirementDialog.tsx`, tomando `NewPortalTicketDialog.tsx` como modelo:
- Campos: título y descripción. Nada más — ni prioridad ni fecha.
- Contador de caracteres contra las constantes del paso 1.
- **Guarda de vida**: deshabilita el envío si el título o la descripción quedan vacíos tras `trim()`.
- **Freno síncrono al doble envío**: marca el envío en curso antes del `await`, no en un `useEffect`. Este defecto ya se coló dos veces en este proyecto y produjo altas duplicadas.
- Al terminar con éxito, cierra y recarga el listado.

- [ ] **Step 5: Rutas y navegación**

En `App.tsx`, dentro del bloque protegido del portal:

```tsx
          <Route path="/portal/requerimientos" element={<PortalRequirementsListPage />} />
          <Route path="/portal/requerimientos/:id" element={<PortalRequirementDetailPage />} />
```

En `PortalLayout.tsx`, un `NavLink` a `/portal/requerimientos` con la etiqueta «Requerimientos», junto al de tickets.

- [ ] **Step 6: Comprobar en el navegador**

Run: `cd web && npm run build && npm run dev`

Con sesión de cliente **administrador**: el botón aparece, el alta crea y el listado lo muestra como «Solicitado» sin prioridad.
Con sesión de cliente **normal**: el botón no aparece, el listado sí.
Pide manualmente el detalle de un requerimiento de otra empresa (cambia el id en la barra de direcciones): debe verse el mismo mensaje que con un id inexistente.

- [ ] **Step 7: Commit**

```bash
git add web/src
git commit -m "feat(portal): pantallas de requerimientos y alta para el administrador"
```

---

### Task 12: La bandeja interna, y quitar el «reservado»

**Files:**
- Create: `web/src/pages/work-items/RequirementIntakeInbox.tsx`
- Modify: `web/src/api/work-items.api.ts`, `web/src/pages/WorkItemsBoardPage.tsx`
- Modify: `web/src/pages/client-users/EditClientUserDialog.tsx`, `web/src/pages/client-users/NewClientUserDialog.tsx`

**Interfaces:**
- Consumes: `POST /work-items/:id/accept` y `/reject` (tarea 9).
- Produces: la bandeja de solicitados dentro de la pantalla del tablero.

- [ ] **Step 1: Llamadas**

En `web/src/api/work-items.api.ts`:

```ts
export const acceptWorkItem = (id: number, body: { priority: 'ALTA' | 'MEDIA' | 'BAJA'; committedDate: string }) =>
  apiClient.post<WorkItem>(`/work-items/${id}/accept`, body).then((r) => r.data);

export const rejectWorkItem = (id: number, body: { reason: string }) =>
  apiClient.post<WorkItem>(`/work-items/${id}/reject`, body).then((r) => r.data);
```

El listado de solicitados se obtiene del listado que ya existe: `WorkItemListFilters` ya admite `status?: WorkItemStatus` y `WorkItemsRepository.list` ya lo traduce a un `WHERE`, así que basta con pedir `GET /work-items?status=SOLICITADO`. No hay que tocar el repositorio.

- [ ] **Step 2: La bandeja**

`RequirementIntakeInbox.tsx`, encima del tablero en `WorkItemsBoardPage`, y **visible solo si hay al menos uno**: una franja vacía permanente entrena a ignorarla.

Cada fila: código, título, empresa, quién lo pidió, fecha de alta, y dos botones.

- «Aceptar» abre un diálogo con **prioridad** (ALTA/MEDIA/BAJA) y **fecha comprometida** (selector de fecha, mínimo hoy). Ambos obligatorios; el botón deshabilitado hasta que los dos estén.
- «Rechazar» abre un diálogo con el motivo. Deshabilitado mientras el motivo quede vacío tras `trim()`.
- Los dos diálogos con el mismo freno síncrono al doble envío del paso 4 de la tarea 11.

Advierte en el diálogo de aceptar, en texto pequeño: «La fecha se le mostrará al cliente en su portal.» Es un compromiso, no una estimación interna, y quien la escribe debe saberlo.

- [ ] **Step 3: Manejo de errores**

Si una llamada falla, muestra el `message` que devuelve el backend. Al reintentar, **limpia el error anterior antes de empezar**: un botón de reintento que limpia un error pero no el otro dejó una vez un éxito invisible, y el técnico reenvió — dos correos idénticos al cliente.

- [ ] **Step 4: Quitar el «reservado»**

En `EditClientUserDialog.tsx` y `NewClientUserDialog.tsx`, la etiqueta de la casilla pasa de:

```
Administrador de la empresa (reservado, sin efecto todavía)
```

a:

```
Administrador de la empresa — puede pedir requerimientos desde el portal
```

- [ ] **Step 5: Comprobar el ciclo entero en el navegador**

Run: `cd web && npm run build && npm run dev`

1. Desde el portal, con sesión administradora, pide un requerimiento.
2. Desde el panel interno, aparece en la bandeja. Acéptalo con prioridad ALTA y fecha del mes que viene.
3. Comprueba que sale del listado de solicitados y aparece en la columna PENDIENTE del tablero, por encima de los MEDIA.
4. **Intenta arrastrarlo antes de aceptarlo** (con otro requerimiento nuevo): debe negarse con el mensaje de la tarea 2.
5. Desde el portal, el requerimiento aceptado muestra «Aceptado, en cola», prioridad ALTA y la fecha.
6. Pide otro y recházalo: el portal muestra «Rechazado» y el motivo.

- [ ] **Step 6: Batería completa y commit**

Run: `cd backend && npm test && npx tsc --noEmit` y `cd web && npm run build`
Expected: todo en verde.

```bash
git add web/src
git commit -m "feat(requerimientos): bandeja interna de aceptacion y rechazo"
```

---

## Comprobación final antes de fusionar

- [ ] `cd backend && npm test` — las 973 anteriores más las nuevas, en verde.
- [ ] `cd backend && npx tsc --noEmit` — limpio.
- [ ] `cd web && npm run build` — limpio.
- [ ] El backend arranca contra la base real sin que `PortalSchemaValidator` aborte.
- [ ] `SELECT COUNT(*) FROM work_items WHERE origin = 'PORTAL';` en desarrollo devuelve solo los creados durante las pruebas — ningún requerimiento preexistente se destapó.
- [ ] `SELECT COUNT(*) FROM ticket_events WHERE notified_at IS NULL;` sigue en `0`. Este plan no toca notificaciones, y si ese número no es cero es que algo escribió donde no debía.

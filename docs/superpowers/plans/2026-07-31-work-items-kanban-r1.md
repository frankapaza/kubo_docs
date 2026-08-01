# Work items y tablero Kanban (R1) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear la entidad `work_items` y su tablero Kanban, la pieza intermedia entre un ticket de mesa de servicio y un proyecto, para que Kubo deje de depender de Jira.

**Architecture:** Backend NestJS por capas (controller → service → repository) siguiendo el módulo `tickets` construido en T1. La lógica de reordenación y las reglas de motivo viven en `domain/`, sin dependencias de base de datos, para probarse con tests unitarios rápidos. En el frontend, un tablero con columnas fijas, arrastrar y soltar nativo del navegador (no hay librería de DnD en el proyecto y no se añade una) y un menú «Mover a…» equivalente para teclado.

**Tech Stack:** NestJS 10 · TypeORM 0.3 · MySQL 8 · Jest 29 + ts-jest · React 18 + Vite + TypeScript + axios.

## Global Constraints

- **Spec de referencia:** `docs/superpowers/specs/2026-07-31-work-items-kanban-r1-design.md`. Ante cualquier duda, la spec manda.
- **Rama de trabajo:** crear `feat/work-items-r1` desde `feat/mesa-servicio-t1`. No trabajar sobre `master` ni `main`.
- **Base de datos:** MySQL en el contenedor `kubo-mysql-dev`, esquema `kubo_devdocs`, `root`/`root`.
  - Consultar: `docker exec kubo-mysql-dev mysql -uroot -proot -e "USE kubo_devdocs; SHOW COLUMNS FROM work_items;"`
  - Ejecutar fichero: `docker exec -i kubo-mysql-dev mysql -uroot -proot < backend/sql/migrations/NNN.sql`
  - El aviso `[Warning] Using a password on the command line interface can be insecure.` es normal.
  - Redis corre en `kubo-redis-dev`. **No arrancar, parar ni recrear contenedores.**
- **API en desarrollo:** `http://localhost:3003/api/v1`. Login `admin@kubo.pe` / `Admin123*`. Web en `http://localhost:5173`.
- **Migraciones:** `backend/sql/migrations/NNN_nombre.sql`, correlativas, empezando con `USE kubo_devdocs;`. La última existente es `011_drop_client_requests.sql`, así que la nueva es la **012**. Toda migración debe ser idempotente: los `ALTER TABLE` van guardados con `information_schema` (ver `010_service_desk.sql` tras su corrección).
- **Montar la migración nueva** en `docker-compose.dev.yml` y `docker-compose.yml`, siguiendo el esquema de prefijos de cada fichero. Olvidarlo deja un entorno nuevo sin la tabla.
- **TypeORM** corre con `synchronize: false` y `autoLoadEntities: true`: el esquema solo cambia por SQL. Un `@Column({ name })` equivocado falla al ejecutar la consulta, no al compilar.
- **Idioma:** identificadores en inglés; enums de dominio, mensajes de usuario y comentarios en español.
- **Errores de API:** siempre `{ code, message }` con `message` en español. Códigos en uso: `NOT_FOUND`, `BAD_INPUT`, `CONFLICT`.
- **Estados, exactamente seis:** `PENDIENTE`, `EN_PROCESO`, `PRUEBAS`, `CERRADO` (columnas del tablero, en ese orden) más `BLOQUEADO` y `CANCELADO` (fuera de flujo).
- **Prioridades, exactamente tres:** `ALTA`, `MEDIA`, `BAJA`. Por defecto `MEDIA`. **No** usar `P1`–`P4`: eso es vocabulario de tickets y allí existe porque hay un SLA detrás.
- **No hay máquina de estados.** Cualquier columna puede ir a cualquier columna. Las únicas reglas son: motivo obligatorio al pasar a `BLOQUEADO` o `CANCELADO`, y `CERRADO` sella `closed_at` (reabrir lo limpia).
- **No hay SLA.** `due_date` es un objetivo del equipo: sin reloj, sin cron, sin evento automático, sin métrica de cumplimiento. Solo señal visual y filtro.
- **Disciplina de escritura** (aprendida a base de cinco hallazgos en T1): toda mutación que cambie el ítem **y** escriba su evento va en una sola transacción, vía `manager.getRepository(...)`. Nada se escapa por el repositorio no transaccional dentro del callback. No anidar transacciones. Referencia del idioma: `TicketsService.create()` y `TicketTransitionsService.transition()` en `backend/src/modules/tickets/`.
- **Nada de `status`, `board_order` ni `priority` en el `PATCH` genérico.** Cada uno tiene su endpoint y cada uno escribe su evento.
- **Tests:** `npm test` desde `backend/`. Hay 70 tests existentes que deben seguir en verde.
- **Cada tarea termina con el build en verde**, backend y web. No se deja el repositorio sin compilar entre commits.
- **Los commits deben ser autocontenidos:** pasar `npm ci && npm run build` en un clon limpio. Toda dependencia va commiteada con el código que la usa.

---

## Estructura de archivos

**Lógica pura (sin BD, unitariamente testeable):**

| Archivo | Responsabilidad |
|---|---|
| `backend/src/modules/work-items/domain/work-item-board.ts` | Estados, prioridades, regla de motivo, reordenación y posición de inserción por prioridad |

**Persistencia y orquestación:**

| Archivo | Responsabilidad |
|---|---|
| `entities/work-item.entity.ts` · `work-item-event.entity.ts` | Mapeo TypeORM |
| `work-items.repository.ts` · `work-item-events.repository.ts` | Acceso a datos, incluido `runInTransaction` |
| `work-item-events.service.ts` | Escritura del timeline (append-only) |
| `work-items.service.ts` | CRUD, generación de `code`, inserción por prioridad |
| `work-item-board.service.ts` | `move`, `assign`, `changePriority` — todo transaccional |
| `work-items.controller.ts` · `dto/` | HTTP |

**Web:**

| Archivo | Responsabilidad |
|---|---|
| `api/work-items.api.ts` | Cliente HTTP |
| `pages/work-items/workitem-ui.ts` | Paleta de estados y prioridades |
| `pages/WorkItemsBoardPage.tsx` | Tablero: columnas, filtros en la URL |
| `pages/work-items/WorkItemCard.tsx` | Tarjeta, con arrastre y menú «Mover a…» |
| `pages/work-items/WorkItemPanel.tsx` | Detalle en panel lateral, con timeline |
| `pages/work-items/NewWorkItemDialog.tsx` | Alta de un ítem |

---

## Orden de ejecución

| # | Tarea | Depende de |
|---|---|---|
| 1 | Dominio: reordenación, inserción por prioridad, regla de motivo | — |
| 2 | Migración 012 + montaje en compose | — |
| 3 | Entidades, repositorios y módulo | 2 |
| 4 | Timeline (`work_item_events`) | 3 |
| 5 | `WorkItemsService`: CRUD, `code`, inserción por prioridad | 1, 3, 4 |
| 6 | `WorkItemBoardService`: move, assign, priority | 1, 5 |
| 7 | Controlador y DTOs | 5, 6 |
| 8 | Web: tipos y cliente API | 7 |
| 9 | Web: tablero, columnas y filtros | 8 |
| 10 | Web: arrastrar y soltar + menú de teclado | 9 |
| 11 | Web: panel de detalle y alta | 9 |
| 12 | Web: ruta, menú lateral y verificación de extremo a extremo | 9, 10, 11 |

---

### Task 1: Dominio — reordenación y reglas

**Files:**
- Create: `backend/src/modules/work-items/domain/work-item-board.ts`
- Test: `backend/src/modules/work-items/domain/work-item-board.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `WorkItemStatus`, `WORK_ITEM_STATUSES`, `BOARD_COLUMNS`, `OUT_OF_FLOW_STATUSES`, `WorkItemPriority`, `WORK_ITEM_PRIORITIES`, `DEFAULT_PRIORITY`, `requiresReason(toStatus): boolean`, `assertReason(toStatus, reason): void` (lanza `BAD_INPUT`), `reorder(columnIds, movedId, toIndex): number[]`, `insertionIndex(columnPriorities, priority): number`.

Dos funciones puras y dos listas. Todo lo que sigue en el plan depende de que estas estén bien.

**Una ambigüedad de la spec resuelta aquí.** La spec dice que un ítem nuevo «entra arriba de su grupo de prioridad» y a la vez que «un `ALTA` nuevo aterriza sobre los `MEDIA`». Se resuelve como lo segundo, que es lo inequívoco: el ítem entra **al final de su propia banda de prioridad**, justo antes del primer ítem de prioridad inferior. Es decir, FIFO dentro de cada prioridad.

- [ ] **Step 1: Escribir el test que falla**

`backend/src/modules/work-items/domain/work-item-board.spec.ts`:

```ts
import {
  reorder,
  insertionIndex,
  requiresReason,
  BOARD_COLUMNS,
  DEFAULT_PRIORITY,
} from './work-item-board';

describe('BOARD_COLUMNS', () => {
  it('son las cuatro columnas de flujo, en orden', () => {
    expect(BOARD_COLUMNS).toEqual(['PENDIENTE', 'EN_PROCESO', 'PRUEBAS', 'CERRADO']);
  });

  it('la prioridad por defecto es MEDIA', () => {
    expect(DEFAULT_PRIORITY).toBe('MEDIA');
  });
});

describe('requiresReason', () => {
  it('exige motivo al bloquear y al cancelar', () => {
    expect(requiresReason('BLOQUEADO')).toBe(true);
    expect(requiresReason('CANCELADO')).toBe(true);
  });

  it('no exige motivo en las columnas de flujo', () => {
    expect(requiresReason('PENDIENTE')).toBe(false);
    expect(requiresReason('EN_PROCESO')).toBe(false);
    expect(requiresReason('PRUEBAS')).toBe(false);
    expect(requiresReason('CERRADO')).toBe(false);
  });
});

describe('reorder', () => {
  it('mueve hacia abajo dentro de la misma columna', () => {
    expect(reorder([1, 2, 3], 1, 2)).toEqual([2, 3, 1]);
  });

  it('mueve hacia arriba dentro de la misma columna', () => {
    expect(reorder([1, 2, 3], 3, 0)).toEqual([3, 1, 2]);
  });

  it('deja el orden intacto si se suelta en su misma posicion', () => {
    expect(reorder([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });

  it('inserta un item que viene de otra columna', () => {
    expect(reorder([1, 2], 9, 1)).toEqual([1, 9, 2]);
  });

  it('inserta en una columna vacia', () => {
    expect(reorder([], 5, 0)).toEqual([5]);
  });

  it('acota un indice mayor que la longitud', () => {
    expect(reorder([1, 2], 9, 99)).toEqual([1, 2, 9]);
  });

  it('acota un indice negativo', () => {
    expect(reorder([1, 2], 9, -3)).toEqual([9, 1, 2]);
  });

  it('no muta el array de entrada', () => {
    const input = [1, 2, 3];
    reorder(input, 1, 2);
    expect(input).toEqual([1, 2, 3]);
  });
});

describe('insertionIndex', () => {
  it('coloca un ALTA justo antes del primer MEDIA', () => {
    expect(insertionIndex(['ALTA', 'ALTA', 'MEDIA', 'BAJA'], 'ALTA')).toBe(2);
  });

  it('coloca un MEDIA justo antes del primer BAJA', () => {
    expect(insertionIndex(['ALTA', 'ALTA', 'MEDIA', 'BAJA'], 'MEDIA')).toBe(3);
  });

  it('coloca un BAJA al final', () => {
    expect(insertionIndex(['ALTA', 'ALTA', 'MEDIA', 'BAJA'], 'BAJA')).toBe(4);
  });

  it('coloca cualquier prioridad en 0 si la columna esta vacia', () => {
    expect(insertionIndex([], 'ALTA')).toBe(0);
    expect(insertionIndex([], 'BAJA')).toBe(0);
  });

  it('coloca un ALTA al principio si solo hay prioridades inferiores', () => {
    expect(insertionIndex(['MEDIA', 'BAJA'], 'ALTA')).toBe(0);
  });

  it('coloca al final si todas las existentes son de igual o mayor prioridad', () => {
    expect(insertionIndex(['ALTA', 'ALTA'], 'ALTA')).toBe(2);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd backend && npm test -- work-item-board`
Expected: FAIL — `Cannot find module './work-item-board'`.

- [ ] **Step 3: Implementar**

`backend/src/modules/work-items/domain/work-item-board.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

export type WorkItemStatus =
  | 'PENDIENTE'
  | 'EN_PROCESO'
  | 'PRUEBAS'
  | 'CERRADO'
  | 'BLOQUEADO'
  | 'CANCELADO';

export const WORK_ITEM_STATUSES: WorkItemStatus[] = [
  'PENDIENTE',
  'EN_PROCESO',
  'PRUEBAS',
  'CERRADO',
  'BLOQUEADO',
  'CANCELADO',
];

/** Las cuatro columnas de flujo del tablero, en orden de izquierda a derecha. */
export const BOARD_COLUMNS: WorkItemStatus[] = [
  'PENDIENTE',
  'EN_PROCESO',
  'PRUEBAS',
  'CERRADO',
];

/** Estados fuera del flujo: no son columnas, exigen motivo. */
export const OUT_OF_FLOW_STATUSES: WorkItemStatus[] = ['BLOQUEADO', 'CANCELADO'];

export type WorkItemPriority = 'ALTA' | 'MEDIA' | 'BAJA';

export const WORK_ITEM_PRIORITIES: WorkItemPriority[] = ['ALTA', 'MEDIA', 'BAJA'];

export const DEFAULT_PRIORITY: WorkItemPriority = 'MEDIA';

/** Menor número, mayor prioridad. */
const PRIORITY_RANK: Record<WorkItemPriority, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };

/**
 * A diferencia de los tickets, aquí no hay máquina de estados: cualquier columna
 * puede ir a cualquier columna. La única restricción es dejar constancia del
 * motivo al sacar un ítem del flujo.
 */
export function requiresReason(toStatus: WorkItemStatus): boolean {
  return OUT_OF_FLOW_STATUSES.includes(toStatus);
}

export function assertReason(toStatus: WorkItemStatus, reason: string | null | undefined): void {
  if (!requiresReason(toStatus)) return;
  if (reason && reason.trim().length > 0) return;
  throw new BadRequestException({
    code: 'BAD_INPUT',
    message: `Pasar a «${toStatus}» exige indicar un motivo.`,
  });
}

/**
 * Orden final de una columna tras soltar `movedId` en la posición `toIndex`.
 *
 * Sirve tanto para reordenar dentro de la misma columna (el id ya está en la
 * lista) como para recibir un ítem de otra (no está). Se renumera la columna
 * entera: con decenas de ítems es imperceptible y evita los casos borde de los
 * rangos dispersos y de LexoRank — sin agotamiento de huecos ni rebalanceos.
 *
 * No muta la entrada.
 */
export function reorder(columnIds: number[], movedId: number, toIndex: number): number[] {
  const without = columnIds.filter((id) => id !== movedId);
  const index = Math.max(0, Math.min(toIndex, without.length));
  return [...without.slice(0, index), movedId, ...without.slice(index)];
}

/**
 * Posición en la que entra un ítem recién creado: al final de su propia banda de
 * prioridad, justo antes del primer ítem de prioridad inferior. Un ALTA nuevo
 * aterriza sobre los MEDIA; un BAJA, al fondo.
 *
 * Evita que un ALTA nuevo nazca debajo de todos los BAJA, que es la
 * contradicción más obvia de tener orden manual y prioridad a la vez.
 */
export function insertionIndex(
  columnPriorities: WorkItemPriority[],
  priority: WorkItemPriority,
): number {
  const rank = PRIORITY_RANK[priority];
  const firstLower = columnPriorities.findIndex((p) => PRIORITY_RANK[p] > rank);
  return firstLower === -1 ? columnPriorities.length : firstLower;
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `cd backend && npm test -- work-item-board`
Expected: PASS — 17 tests.

- [ ] **Step 5: Ejecutar la suite completa**

Run: `cd backend && npm test`
Expected: PASS — los 70 tests existentes siguen en verde, más los nuevos.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/work-items/domain
git commit -m "feat(work-items): reordenacion del tablero e insercion por prioridad"
```

---

### Task 2: Migración 012 y montaje en compose

**Files:**
- Create: `backend/sql/migrations/012_work_items.sql`
- Modify: `docker-compose.dev.yml`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: tablas `clients`, `projects`, `users` existentes.
- Produces: tablas `work_items` y `work_item_events`.

- [ ] **Step 1: Escribir la migración**

`backend/sql/migrations/012_work_items.sql`:

```sql
-- =========================================================================
--  Migración 012 — Work items y tablero Kanban (R1)
-- =========================================================================
--  La pieza intermedia entre un ticket de mesa de servicio y un proyecto:
--  el requerimiento. Sustituye el uso que se le daba a Jira.
--
--  Sin sprint_id (llega en R3) ni origin_ticket_id (R2): cada uno con su
--  migración cuando toque.
-- =========================================================================

USE kubo_devdocs;

CREATE TABLE IF NOT EXISTS work_items (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code                 VARCHAR(20)     NULL COMMENT 'RQ-0001, se asigna tras el insert',

  client_id            BIGINT UNSIGNED NOT NULL COMMENT 'todo trabajo es para alguien',
  project_id           BIGINT UNSIGNED NULL COMMENT 'NULL = requerimiento suelto',

  title                VARCHAR(240)    NOT NULL,
  description_md       TEXT            NULL,
  acceptance_criteria  JSON            NULL,
  labels               JSON            NULL,

  status               ENUM('PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO',
                            'BLOQUEADO','CANCELADO') NOT NULL DEFAULT 'PENDIENTE',
  priority             ENUM('ALTA','MEDIA','BAJA') NOT NULL DEFAULT 'MEDIA',
  assignee_user_id     BIGINT UNSIGNED NULL,
  board_order          INT UNSIGNED    NOT NULL DEFAULT 0
                       COMMENT 'posición dentro de su columna',

  due_date             DATE            NULL
                       COMMENT 'objetivo del equipo, NO un SLA: sin reloj ni cron',
  closed_at            DATETIME        NULL,

  created_by           BIGINT UNSIGNED NOT NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_work_items_code (code),
  INDEX idx_wi_client (client_id),
  INDEX idx_wi_project (project_id),
  INDEX idx_wi_status (status),
  INDEX idx_wi_assignee (assignee_user_id),
  INDEX idx_wi_due (due_date),
  INDEX idx_wi_board (status, board_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_item_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  work_item_id   BIGINT UNSIGNED NOT NULL,
  type           ENUM('CREATED','MOVED','ASSIGNED','COMMENT','BLOCKED','UNBLOCKED',
                      'CLOSED','REOPENED','CANCELLED','PRIORITY_CHANGED') NOT NULL,
  from_status    ENUM('PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO',
                      'BLOQUEADO','CANCELADO') NULL,
  to_status      ENUM('PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO',
                      'BLOQUEADO','CANCELADO') NULL,
  actor_user_id  BIGINT UNSIGNED NULL COMMENT 'NULL cuando el actor es el sistema',
  reason         TEXT            NULL,
  payload        JSON            NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_wie_item (work_item_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

No hay `ALTER TABLE`, así que el fichero es idempotente tal cual: los dos `CREATE TABLE IF NOT EXISTS` son inocuos al repetirse.

- [ ] **Step 2: Montar la migración en los dos compose**

En `docker-compose.dev.yml`, en la lista de volúmenes del servicio `mysql`, tras la línea de la migración 011, añadir la 012 siguiendo el prefijo numérico que use ese fichero.

En `docker-compose.yml`, hacer lo propio siguiendo su esquema (usa un prefijo distinto — leerlo antes).

Esto es obligatorio: la revisión de rama de T1 encontró que las migraciones 009–011 no estaban montadas y un entorno nuevo arrancaba sin tablas.

- [ ] **Step 3: Ejecutar la migración**

```bash
docker exec -i kubo-mysql-dev mysql -uroot -proot < backend/sql/migrations/012_work_items.sql
```

- [ ] **Step 4: Verificar**

```sql
USE kubo_devdocs;
SHOW TABLES LIKE 'work_item%';
SHOW CREATE TABLE work_items\G
SHOW CREATE TABLE work_item_events\G
```

Expected: las dos tablas existen; los enums de `status` y `priority` coinciden exactamente con la migración; el índice `idx_wi_board` es `(status, board_order)`.

- [ ] **Step 5: Verificar la idempotencia**

Volver a ejecutar el Step 3.
Expected: sin errores. Confirmar con `SHOW TABLES LIKE 'work_item%';` que sigue habiendo dos tablas.

- [ ] **Step 6: Commit**

```bash
git add backend/sql/migrations/012_work_items.sql docker-compose.dev.yml docker-compose.yml
git commit -m "feat(db): migracion 012 — work items y su timeline"
```

---

### Task 3: Entidades, repositorios y módulo

**Files:**
- Create: `backend/src/modules/work-items/entities/work-item.entity.ts`
- Create: `backend/src/modules/work-items/entities/work-item-event.entity.ts`
- Create: `backend/src/modules/work-items/work-items.repository.ts`
- Create: `backend/src/modules/work-items/work-item-events.repository.ts`
- Create: `backend/src/modules/work-items/work-items.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `WorkItemStatus`, `WorkItemPriority` de `domain/work-item-board`.
- Produces:
  - Entidades `WorkItem` y `WorkItemEvent`; tipo `WorkItemEventType` y array `WORK_ITEM_EVENT_TYPES`.
  - `WorkItemsRepository` con `list(filters)`, `findById(id)`, `create(data)`, `update(id, data)`, `remove(id)`, `listColumn(status)`, `applyOrder(manager, orderedIds)`, `runInTransaction(work)`.
  - `WorkItemEventsRepository` con `append(data)` y `listByItem(workItemId)`.
  - `WorkItemListFilters` con `clientId`, `projectId`, `status`, `priority`, `assigneeUserId`, `dueFilter`, `q`.

`listColumn(status)` devuelve los ítems de una columna ordenados por `board_order`; es lo que consume la reordenación. `applyOrder(manager, orderedIds)` escribe el nuevo `board_order` de cada id según su posición en el array, y recibe el `EntityManager` para poder correr dentro de una transacción.

- [ ] **Step 1: Crear la entidad `WorkItem`**

`backend/src/modules/work-items/entities/work-item.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  WorkItemStatus,
  WORK_ITEM_STATUSES,
  WorkItemPriority,
  WORK_ITEM_PRIORITIES,
} from '../domain/work-item-board';

@Entity('work_items')
@Index('idx_wi_client', ['clientId'])
@Index('idx_wi_status', ['status'])
@Index('idx_wi_board', ['status', 'boardOrder'])
export class WorkItem {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  code!: string | null;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true })
  clientId!: number;

  @Column({ name: 'project_id', type: 'bigint', unsigned: true, nullable: true })
  projectId!: number | null;

  @Column({ type: 'varchar', length: 240 })
  title!: string;

  @Column({ name: 'description_md', type: 'text', nullable: true })
  descriptionMd!: string | null;

  @Column({ name: 'acceptance_criteria', type: 'json', nullable: true })
  acceptanceCriteria!: string[] | null;

  @Column({ type: 'json', nullable: true })
  labels!: string[] | null;

  @Column({ type: 'enum', enum: WORK_ITEM_STATUSES, default: 'PENDIENTE' })
  status!: WorkItemStatus;

  @Column({ type: 'enum', enum: WORK_ITEM_PRIORITIES, default: 'MEDIA' })
  priority!: WorkItemPriority;

  @Column({ name: 'assignee_user_id', type: 'bigint', unsigned: true, nullable: true })
  assigneeUserId!: number | null;

  @Column({ name: 'board_order', type: 'int', unsigned: true, default: 0 })
  boardOrder!: number;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ name: 'closed_at', type: 'datetime', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true })
  createdBy!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

`dueDate` se tipa `string` y no `Date` a propósito: la columna es `DATE`, sin hora. Tratarla como `Date` la arrastraría a la conversión de zona horaria del driver, que es justo el problema que costó una tanda de correcciones en T1.

- [ ] **Step 2: Crear la entidad `WorkItemEvent`**

`backend/src/modules/work-items/entities/work-item-event.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { WorkItemStatus, WORK_ITEM_STATUSES } from '../domain/work-item-board';

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
  | 'PRIORITY_CHANGED';

export const WORK_ITEM_EVENT_TYPES: WorkItemEventType[] = [
  'CREATED',
  'MOVED',
  'ASSIGNED',
  'COMMENT',
  'BLOCKED',
  'UNBLOCKED',
  'CLOSED',
  'REOPENED',
  'CANCELLED',
  'PRIORITY_CHANGED',
];

/** Append-only: nunca se actualiza ni se borra. */
@Entity('work_item_events')
@Index('idx_wie_item', ['workItemId', 'createdAt'])
export class WorkItemEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'work_item_id', type: 'bigint', unsigned: true })
  workItemId!: number;

  @Column({ type: 'enum', enum: WORK_ITEM_EVENT_TYPES })
  type!: WorkItemEventType;

  @Column({ name: 'from_status', type: 'enum', enum: WORK_ITEM_STATUSES, nullable: true })
  fromStatus!: WorkItemStatus | null;

  @Column({ name: 'to_status', type: 'enum', enum: WORK_ITEM_STATUSES, nullable: true })
  toStatus!: WorkItemStatus | null;

  @Column({ name: 'actor_user_id', type: 'bigint', unsigned: true, nullable: true })
  actorUserId!: number | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'json', nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
```

- [ ] **Step 3: Crear `WorkItemsRepository`**

`backend/src/modules/work-items/work-items.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { WorkItem } from './entities/work-item.entity';
import { WorkItemStatus, WorkItemPriority } from './domain/work-item-board';

export type DueFilter = 'vencidos' | 'semana';

export interface WorkItemListFilters {
  clientId?: number;
  projectId?: number;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  assigneeUserId?: number;
  dueFilter?: DueFilter;
  q?: string;
}

@Injectable()
export class WorkItemsRepository {
  constructor(
    @InjectRepository(WorkItem) private readonly repo: Repository<WorkItem>,
    private readonly dataSource: DataSource,
  ) {}

  async list(filters: WorkItemListFilters): Promise<WorkItem[]> {
    const qb = this.repo.createQueryBuilder('w');

    if (filters.clientId) qb.andWhere('w.client_id = :clientId', { clientId: filters.clientId });
    if (filters.projectId) qb.andWhere('w.project_id = :projectId', { projectId: filters.projectId });
    if (filters.status) qb.andWhere('w.status = :status', { status: filters.status });
    if (filters.priority) qb.andWhere('w.priority = :priority', { priority: filters.priority });
    if (filters.assigneeUserId) {
      qb.andWhere('w.assignee_user_id = :assignee', { assignee: filters.assigneeUserId });
    }
    if (filters.dueFilter === 'vencidos') {
      qb.andWhere('w.due_date IS NOT NULL AND w.due_date < CURDATE()');
    }
    if (filters.dueFilter === 'semana') {
      qb.andWhere('w.due_date IS NOT NULL AND w.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)');
    }
    if (filters.q) {
      qb.andWhere('(w.title LIKE :q OR w.description_md LIKE :q OR w.code LIKE :q)', {
        q: `%${filters.q}%`,
      });
    }

    qb.orderBy('w.status', 'ASC').addOrderBy('w.board_order', 'ASC').limit(1000);
    return qb.getMany();
  }

  /** Los ítems de una columna, en su orden actual. Base de la reordenación. */
  listColumn(status: WorkItemStatus): Promise<WorkItem[]> {
    return this.repo.find({ where: { status }, order: { boardOrder: 'ASC', id: 'ASC' } });
  }

  findById(id: number): Promise<WorkItem | null> {
    return this.repo.findOne({ where: { id } });
  }

  create(data: Partial<WorkItem>): Promise<WorkItem> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<WorkItem>): Promise<WorkItem | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }

  /**
   * Escribe el board_order de cada id según su posición en el array.
   * Recibe el manager para poder correr dentro de una transacción.
   */
  async applyOrder(manager: EntityManager, orderedIds: number[]): Promise<void> {
    const repo = manager.getRepository(WorkItem);
    for (let i = 0; i < orderedIds.length; i += 1) {
      await repo.update(orderedIds[i], { boardOrder: i });
    }
  }

  /** Mismo idioma que TicketsRepository.runInTransaction. */
  runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }
}
```

- [ ] **Step 4: Crear `WorkItemEventsRepository`**

`backend/src/modules/work-items/work-item-events.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkItemEvent } from './entities/work-item-event.entity';

@Injectable()
export class WorkItemEventsRepository {
  constructor(@InjectRepository(WorkItemEvent) private readonly repo: Repository<WorkItemEvent>) {}

  append(data: Partial<WorkItemEvent>): Promise<WorkItemEvent> {
    return this.repo.save(this.repo.create(data));
  }

  listByItem(workItemId: number): Promise<WorkItemEvent[]> {
    return this.repo.find({ where: { workItemId }, order: { createdAt: 'ASC', id: 'ASC' } });
  }
}
```

- [ ] **Step 5: Crear el módulo y registrarlo**

`backend/src/modules/work-items/work-items.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WorkItem } from './entities/work-item.entity';
import { WorkItemEvent } from './entities/work-item-event.entity';
import { WorkItemsRepository } from './work-items.repository';
import { WorkItemEventsRepository } from './work-item-events.repository';

@Module({
  imports: [TypeOrmModule.forFeature([WorkItem, WorkItemEvent])],
  providers: [WorkItemsRepository, WorkItemEventsRepository],
  exports: [WorkItemsRepository, WorkItemEventsRepository],
})
export class WorkItemsModule {}
```

En `backend/src/app.module.ts`, importar `WorkItemsModule` y añadirlo al array `imports`, junto a `TicketsModule`.

- [ ] **Step 6: Verificar que compila y arranca**

Run: `cd backend && npm run build` — sin errores.
Run: `cd backend && npm run start:dev` — Nest arranca sin errores de mapeo de entidades. Detener con Ctrl+C.
Run: `cd backend && npm test` — los tests siguen en verde.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/work-items backend/src/app.module.ts
git commit -m "feat(work-items): entidades, repositorios y modulo base"
```

---

### Task 4: Timeline de eventos

**Files:**
- Create: `backend/src/modules/work-items/work-item-events.service.ts`
- Modify: `backend/src/modules/work-items/work-items.module.ts`

**Interfaces:**
- Consumes: `WorkItemEventsRepository`, `WorkItemEvent`, `WorkItemEventType`, `WorkItemStatus`.
- Produces: `WorkItemEventsService` con `record(input)`, `listByItem(id)`, y `typeForMove(from, to): WorkItemEventType` **público** (lo necesita el servicio de tablero para escribir el evento dentro de su transacción sin duplicar la tabla de clasificación — el mismo motivo por el que `TicketEventsService.typeForTransition` es público).

- [ ] **Step 1: Implementar**

`backend/src/modules/work-items/work-item-events.service.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { WorkItemEventsRepository } from './work-item-events.repository';
import { WorkItemEvent, WorkItemEventType } from './entities/work-item-event.entity';
import { WorkItemStatus } from './domain/work-item-board';

export interface RecordWorkItemEventInput {
  workItemId: number;
  type: WorkItemEventType;
  actorUserId: number | null;
  fromStatus?: WorkItemStatus | null;
  toStatus?: WorkItemStatus | null;
  reason?: string | null;
  payload?: Record<string, unknown> | null;
}

/** Append-only: sin actualización ni borrado, a propósito. */
@Injectable()
export class WorkItemEventsService {
  constructor(private readonly repo: WorkItemEventsRepository) {}

  record(input: RecordWorkItemEventInput): Promise<WorkItemEvent> {
    return this.repo.append({
      workItemId: input.workItemId,
      type: input.type,
      actorUserId: input.actorUserId,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      reason: input.reason?.trim() || null,
      payload: input.payload ?? null,
    });
  }

  /**
   * Tipo de evento más específico para un movimiento, para que el timeline se
   * lea sin tener que interpretar pares de estados. Público porque el servicio
   * de tablero lo necesita dentro de su transacción.
   */
  typeForMove(from: WorkItemStatus, to: WorkItemStatus): WorkItemEventType {
    if (to === 'BLOQUEADO') return 'BLOCKED';
    if (to === 'CANCELADO') return 'CANCELLED';
    if (to === 'CERRADO') return 'CLOSED';
    if (from === 'CERRADO') return 'REOPENED';
    if (from === 'BLOQUEADO') return 'UNBLOCKED';
    return 'MOVED';
  }

  listByItem(workItemId: number): Promise<WorkItemEvent[]> {
    return this.repo.listByItem(workItemId);
  }
}
```

- [ ] **Step 2: Registrar en el módulo**

Añadir `WorkItemEventsService` a `providers` y `exports` de `work-items.module.ts`.

- [ ] **Step 3: Verificar que compila**

Run: `cd backend && npm run build` — sin errores.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/work-items
git commit -m "feat(work-items): servicio de timeline append-only"
```

---

### Task 5: `WorkItemsService` — CRUD, `code` e inserción por prioridad

**Files:**
- Create: `backend/src/modules/work-items/work-items.service.ts`
- Create: `backend/src/modules/work-items/dto/create-work-item.dto.ts`
- Create: `backend/src/modules/work-items/dto/update-work-item.dto.ts`
- Test: `backend/src/modules/work-items/work-items.service.spec.ts`
- Modify: `backend/src/modules/work-items/work-items.module.ts`

**Interfaces:**
- Consumes: `WorkItemsRepository`, `WorkItemEventsService`, `ClientsService.findByIdOrFail`, `ProjectsService.findById`, `insertionIndex`, `DEFAULT_PRIORITY`.
- Produces: `WorkItemsService` con `list(filters)`, `findByIdOrFail(id)`, `findWithTimeline(id)`, `create(userId, dto)`, `update(id, dto)`, `remove(id)`. `CreateWorkItemDto`, `UpdateWorkItemDto`.

Al crear: se valida cliente y proyecto, se coloca el ítem según su prioridad en `PENDIENTE` renumerando la columna, se asigna el `code` y se registra `CREATED` — todo en una transacción.

- [ ] **Step 1: Crear los DTO**

`backend/src/modules/work-items/dto/create-work-item.dto.ts`:

```ts
import {
  IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength,
} from 'class-validator';
import { WORK_ITEM_PRIORITIES, WorkItemPriority } from '../domain/work-item-board';

export class CreateWorkItemDto {
  @IsInt() @Min(1)
  clientId!: number;

  @IsOptional() @IsInt() @Min(1)
  projectId?: number;

  @IsString() @MinLength(1) @MaxLength(240)
  title!: string;

  @IsOptional() @IsString()
  descriptionMd?: string;

  @IsOptional() @IsArray()
  acceptanceCriteria?: string[];

  @IsOptional() @IsArray()
  labels?: string[];

  @IsOptional() @IsIn(WORK_ITEM_PRIORITIES)
  priority?: WorkItemPriority;

  @IsOptional() @IsInt() @Min(1)
  assigneeUserId?: number;

  /** Objetivo del equipo, no un SLA. Formato YYYY-MM-DD. */
  @IsOptional() @IsDateString()
  dueDate?: string;
}
```

`backend/src/modules/work-items/dto/update-work-item.dto.ts`:

```ts
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateWorkItemDto } from './create-work-item.dto';

/**
 * No admite `status`, `boardOrder` ni `priority`: cada uno tiene su endpoint y
 * cada uno escribe su evento. En T1 el update() de tickets recalculaba la
 * prioridad sin dejar rastro y hubo que corregirlo en la revisión de rama.
 *
 * `priority` se omite explícitamente de la base heredada; `status` y
 * `boardOrder` nunca estuvieron en CreateWorkItemDto.
 */
export class UpdateWorkItemDto extends PartialType(
  OmitType(CreateWorkItemDto, ['priority'] as const),
) {}
```

- [ ] **Step 2: Escribir el test que falla**

`backend/src/modules/work-items/work-items.service.spec.ts`:

```ts
import { WorkItemsService } from './work-items.service';
import { WorkItem } from './entities/work-item.entity';

const column = (priorities: string[]): WorkItem[] =>
  priorities.map((p, i) => ({ id: i + 1, priority: p, boardOrder: i }) as WorkItem);

const makeService = (pendingColumn: WorkItem[] = []) => {
  const created = { id: 99, status: 'PENDIENTE', priority: 'MEDIA' } as WorkItem;
  const applied: number[][] = [];
  const repo = {
    listColumn: jest.fn().mockResolvedValue(pendingColumn),
    applyOrder: jest.fn().mockImplementation((_m, ids: number[]) => {
      applied.push(ids);
      return Promise.resolve();
    }),
    findById: jest.fn().mockResolvedValue(created),
    runInTransaction: jest.fn().mockImplementation((work) =>
      work({ getRepository: () => ({
        save: jest.fn().mockImplementation((e) => Promise.resolve({ ...created, ...e })),
        create: jest.fn().mockImplementation((e) => e),
        update: jest.fn().mockResolvedValue(undefined),
      }) }),
    ),
  };
  const events = { record: jest.fn().mockResolvedValue({}), listByItem: jest.fn() };
  const clients = { findByIdOrFail: jest.fn().mockResolvedValue({ id: 1 }) };
  const projects = { findById: jest.fn().mockResolvedValue({ id: 1 }) };
  return {
    service: new WorkItemsService(repo as any, events as any, clients as any, projects as any),
    repo, events, clients, projects, applied,
  };
};

describe('create', () => {
  it('valida el cliente', async () => {
    const { service, clients } = makeService();
    await service.create(5, { clientId: 1, title: 'Ajustar IGV' });
    expect(clients.findByIdOrFail).toHaveBeenCalledWith(1);
  });

  it('valida el proyecto solo si viene', async () => {
    const { service, projects } = makeService();
    await service.create(5, { clientId: 1, title: 'X' });
    expect(projects.findById).not.toHaveBeenCalled();

    const b = makeService();
    await b.service.create(5, { clientId: 1, projectId: 7, title: 'X' });
    expect(b.projects.findById).toHaveBeenCalledWith(7);
  });

  it('usa MEDIA cuando no se indica prioridad', async () => {
    const { service, repo } = makeService();
    await service.create(5, { clientId: 1, title: 'X' });
    const saved = repo.runInTransaction.mock.calls.length;
    expect(saved).toBe(1);
  });

  it('coloca un ALTA nuevo sobre los MEDIA, renumerando la columna', async () => {
    // columna: ids 1(ALTA) 2(MEDIA) 3(BAJA) -> el nuevo (99) va al indice 1
    const { service, applied } = makeService(column(['ALTA', 'MEDIA', 'BAJA']));
    await service.create(5, { clientId: 1, title: 'Urgente', priority: 'ALTA' });
    expect(applied[0]).toEqual([1, 99, 2, 3]);
  });

  it('coloca un BAJA nuevo al fondo', async () => {
    const { service, applied } = makeService(column(['ALTA', 'MEDIA']));
    await service.create(5, { clientId: 1, title: 'Cosmetico', priority: 'BAJA' });
    expect(applied[0]).toEqual([1, 2, 99]);
  });

  it('registra exactamente un evento CREATED', async () => {
    const { service, events } = makeService();
    await service.create(5, { clientId: 1, title: 'X' });
    expect(events.record).toHaveBeenCalledTimes(1);
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CREATED', toStatus: 'PENDIENTE', actorUserId: 5 }),
    );
  });
});
```

- [ ] **Step 3: Ejecutar el test y verificar que falla**

Run: `cd backend && npm test -- work-items.service`
Expected: FAIL — `Cannot find module './work-items.service'`.

- [ ] **Step 4: Implementar**

`backend/src/modules/work-items/work-items.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { WorkItemsRepository, WorkItemListFilters } from './work-items.repository';
import { WorkItemEventsService } from './work-item-events.service';
import { ClientsService } from '../clients/clients.service';
import { ProjectsService } from '../projects/projects.service';

import { WorkItem } from './entities/work-item.entity';
import { WorkItemEvent } from './entities/work-item-event.entity';
import { CreateWorkItemDto } from './dto/create-work-item.dto';
import { UpdateWorkItemDto } from './dto/update-work-item.dto';
import { insertionIndex, reorder, DEFAULT_PRIORITY, WorkItemPriority } from './domain/work-item-board';

@Injectable()
export class WorkItemsService {
  constructor(
    private readonly repo: WorkItemsRepository,
    private readonly events: WorkItemEventsService,
    private readonly clients: ClientsService,
    private readonly projects: ProjectsService,
  ) {}

  async findByIdOrFail(id: number): Promise<WorkItem> {
    const w = await this.repo.findById(id);
    if (!w) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Requerimiento no encontrado' });
    }
    return w;
  }

  list(filters: WorkItemListFilters): Promise<WorkItem[]> {
    return this.repo.list(filters);
  }

  async findWithTimeline(id: number): Promise<{ workItem: WorkItem; timeline: WorkItemEvent[] }> {
    const workItem = await this.findByIdOrFail(id);
    const timeline = await this.events.listByItem(id);
    return { workItem, timeline };
  }

  async create(userId: number, dto: CreateWorkItemDto): Promise<WorkItem> {
    await this.clients.findByIdOrFail(dto.clientId);
    if (dto.projectId !== undefined) await this.projects.findById(dto.projectId);

    const priority: WorkItemPriority = dto.priority ?? DEFAULT_PRIORITY;
    const pending = await this.repo.listColumn('PENDIENTE');
    const index = insertionIndex(pending.map((w) => w.priority), priority);

    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);

      const saved = await itemRepo.save(
        itemRepo.create({
          clientId: dto.clientId,
          projectId: dto.projectId ?? null,
          title: dto.title.trim(),
          descriptionMd: dto.descriptionMd ?? null,
          acceptanceCriteria: dto.acceptanceCriteria ?? null,
          labels: dto.labels ?? null,
          priority,
          status: 'PENDIENTE',
          assigneeUserId: dto.assigneeUserId ?? null,
          dueDate: dto.dueDate ?? null,
          boardOrder: index,
          createdBy: userId,
        }),
      );

      // El código depende del id autoincremental, así que se asigna después.
      await itemRepo.update(saved.id, { code: this.buildCode(saved.id) });

      // Renumera la columna con el ítem nuevo en su posición por prioridad.
      const orderedIds = reorder(pending.map((w) => w.id), saved.id, index);
      await this.repo.applyOrder(manager, orderedIds);

      await this.events.record({
        workItemId: saved.id,
        type: 'CREATED',
        actorUserId: userId,
        toStatus: 'PENDIENTE',
        payload: { priority },
      });

      return (await itemRepo.findOne({ where: { id: saved.id } }))!;
    });
  }

  private buildCode(id: number): string {
    return `RQ-${String(id).padStart(4, '0')}`;
  }

  async update(id: number, dto: UpdateWorkItemDto): Promise<WorkItem> {
    await this.findByIdOrFail(id);
    if (dto.clientId !== undefined) await this.clients.findByIdOrFail(dto.clientId);
    if (dto.projectId !== undefined) await this.projects.findById(dto.projectId);

    const updated = await this.repo.update(id, { ...dto } as Partial<WorkItem>);
    return updated!;
  }

  async remove(id: number): Promise<void> {
    const w = await this.findByIdOrFail(id);
    if (w.status !== 'PENDIENTE') {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'Solo se puede borrar un requerimiento pendiente. Cancélalo en su lugar.',
      });
    }
    await this.repo.remove(id);
  }
}
```

- [ ] **Step 5: Registrar en el módulo**

En `work-items.module.ts`: importar `ClientsModule` y `ProjectsModule`, añadirlos a `imports`, y `WorkItemsService` a `providers`/`exports`.

- [ ] **Step 6: Ejecutar los tests**

Run: `cd backend && npm test -- work-items.service`
Expected: PASS — 6 tests.

Run: `cd backend && npm test` — todo en verde.
Run: `cd backend && npm run build` — sin errores.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/work-items
git commit -m "feat(work-items): CRUD, codigo legible e insercion por prioridad"
```

---

### Task 6: `WorkItemBoardService` — move, assign y prioridad

**Files:**
- Create: `backend/src/modules/work-items/work-item-board.service.ts`
- Create: `backend/src/modules/work-items/dto/move-work-item.dto.ts`
- Create: `backend/src/modules/work-items/dto/assign-work-item.dto.ts`
- Create: `backend/src/modules/work-items/dto/change-priority.dto.ts`
- Test: `backend/src/modules/work-items/work-item-board.service.spec.ts`
- Modify: `backend/src/modules/work-items/work-items.module.ts`

**Interfaces:**
- Consumes: `WorkItemsRepository`, `WorkItemEventsService`, `assertReason`, `reorder`.
- Produces: `WorkItemBoardService` con `move(input)`, `assign(input)`, `changePriority(input)`.

Las tres escriben el cambio y su evento en una sola transacción. `move` renumera la columna de origen y la de destino.

- [ ] **Step 1: Crear los DTO**

`backend/src/modules/work-items/dto/move-work-item.dto.ts`:

```ts
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { WORK_ITEM_STATUSES, WorkItemStatus } from '../domain/work-item-board';

export class MoveWorkItemDto {
  @IsIn(WORK_ITEM_STATUSES)
  toStatus!: WorkItemStatus;

  @IsInt() @Min(0)
  toIndex!: number;

  /** Obligatorio cuando toStatus es BLOQUEADO o CANCELADO. */
  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}
```

`backend/src/modules/work-items/dto/assign-work-item.dto.ts`:

```ts
import { IsInt, IsOptional, Min } from 'class-validator';

export class AssignWorkItemDto {
  /** null desasigna. */
  @IsOptional() @IsInt() @Min(1)
  assigneeUserId?: number | null;
}
```

`backend/src/modules/work-items/dto/change-priority.dto.ts`:

```ts
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { WORK_ITEM_PRIORITIES, WorkItemPriority } from '../domain/work-item-board';

export class ChangePriorityDto {
  @IsIn(WORK_ITEM_PRIORITIES)
  priority!: WorkItemPriority;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}
```

- [ ] **Step 2: Escribir el test que falla**

`backend/src/modules/work-items/work-item-board.service.spec.ts`:

```ts
import { WorkItemBoardService } from './work-item-board.service';
import { WorkItem } from './entities/work-item.entity';

const item = (over: Partial<WorkItem> = {}): WorkItem =>
  ({ id: 2, status: 'PENDIENTE', priority: 'MEDIA', boardOrder: 1, closedAt: null, ...over }) as WorkItem;

const makeService = (current: WorkItem, columns: Record<string, WorkItem[]> = {}) => {
  const applied: Array<number[]> = [];
  const patches: Array<Record<string, unknown>> = [];
  const repo = {
    findById: jest.fn().mockResolvedValue(current),
    listColumn: jest.fn().mockImplementation((s: string) => Promise.resolve(columns[s] ?? [])),
    applyOrder: jest.fn().mockImplementation((_m, ids: number[]) => { applied.push(ids); return Promise.resolve(); }),
    runInTransaction: jest.fn().mockImplementation((work) =>
      work({ getRepository: () => ({
        update: jest.fn().mockImplementation((_id, p) => { patches.push(p); return Promise.resolve(); }),
        save: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockImplementation((e) => e),
        findOne: jest.fn().mockResolvedValue(current),
      }) }),
    ),
  };
  const events = {
    record: jest.fn().mockResolvedValue({}),
    typeForMove: jest.fn().mockReturnValue('MOVED'),
  };
  return { service: new WorkItemBoardService(repo as any, events as any), repo, events, applied, patches };
};

describe('move', () => {
  it('rechaza pasar a BLOQUEADO sin motivo', async () => {
    const { service } = makeService(item());
    await expect(
      service.move({ workItemId: 2, actorUserId: 5, toStatus: 'BLOQUEADO', toIndex: 0 }),
    ).rejects.toThrow();
  });

  it('rechaza pasar a CANCELADO sin motivo', async () => {
    const { service } = makeService(item());
    await expect(
      service.move({ workItemId: 2, actorUserId: 5, toStatus: 'CANCELADO', toIndex: 0 }),
    ).rejects.toThrow();
  });

  it('acepta BLOQUEADO con motivo y lo registra', async () => {
    const { service, events } = makeService(item());
    await service.move({
      workItemId: 2, actorUserId: 5, toStatus: 'BLOQUEADO', toIndex: 0,
      reason: 'Esperando respuesta del cliente',
    });
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Esperando respuesta del cliente', toStatus: 'BLOQUEADO' }),
    );
  });

  it('reordena dentro de la misma columna y renumera una sola vez', async () => {
    const cols = { PENDIENTE: [item({ id: 1, boardOrder: 0 }), item({ id: 2, boardOrder: 1 }), item({ id: 3, boardOrder: 2 })] };
    const { service, applied } = makeService(item({ id: 2 }), cols);
    await service.move({ workItemId: 2, actorUserId: 5, toStatus: 'PENDIENTE', toIndex: 0 });
    expect(applied).toEqual([[2, 1, 3]]);
  });

  it('al cambiar de columna renumera origen y destino', async () => {
    const cols = {
      PENDIENTE: [item({ id: 1 }), item({ id: 2 })],
      EN_PROCESO: [item({ id: 7, status: 'EN_PROCESO' })],
    };
    const { service, applied } = makeService(item({ id: 2 }), cols);
    await service.move({ workItemId: 2, actorUserId: 5, toStatus: 'EN_PROCESO', toIndex: 0 });
    expect(applied).toContainEqual([1]);       // origen sin el movido
    expect(applied).toContainEqual([2, 7]);    // destino con el movido arriba
  });

  it('sella closed_at al cerrar', async () => {
    const { service, patches } = makeService(item());
    await service.move({ workItemId: 2, actorUserId: 5, toStatus: 'CERRADO', toIndex: 0 });
    expect(patches.some((p) => p.closedAt instanceof Date)).toBe(true);
  });

  it('limpia closed_at al reabrir', async () => {
    const { service, patches } = makeService(item({ status: 'CERRADO', closedAt: new Date() }));
    await service.move({ workItemId: 2, actorUserId: 5, toStatus: 'EN_PROCESO', toIndex: 0 });
    expect(patches.some((p) => p.closedAt === null)).toBe(true);
  });
});

describe('assign', () => {
  it('escribe el asignado y registra el evento', async () => {
    const { service, patches, events } = makeService(item());
    await service.assign({ workItemId: 2, actorUserId: 5, assigneeUserId: 11 });
    expect(patches.some((p) => p.assigneeUserId === 11)).toBe(true);
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'ASSIGNED' }));
  });
});

describe('changePriority', () => {
  it('escribe la prioridad y registra PRIORITY_CHANGED con el valor anterior', async () => {
    const { service, patches, events } = makeService(item({ priority: 'BAJA' }));
    await service.changePriority({ workItemId: 2, actorUserId: 5, priority: 'ALTA' });
    expect(patches.some((p) => p.priority === 'ALTA')).toBe(true);
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PRIORITY_CHANGED', payload: { from: 'BAJA', to: 'ALTA' } }),
    );
  });
});
```

- [ ] **Step 3: Ejecutar el test y verificar que falla**

Run: `cd backend && npm test -- work-item-board.service`
Expected: FAIL — `Cannot find module './work-item-board.service'`.

- [ ] **Step 4: Implementar**

`backend/src/modules/work-items/work-item-board.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';

import { WorkItemsRepository } from './work-items.repository';
import { WorkItemEventsService } from './work-item-events.service';
import { WorkItem } from './entities/work-item.entity';
import { assertReason, reorder, WorkItemStatus, WorkItemPriority } from './domain/work-item-board';

export interface MoveInput {
  workItemId: number;
  actorUserId: number;
  toStatus: WorkItemStatus;
  toIndex: number;
  reason?: string;
}

@Injectable()
export class WorkItemBoardService {
  constructor(
    private readonly repo: WorkItemsRepository,
    private readonly events: WorkItemEventsService,
  ) {}

  private async findOrFail(id: number): Promise<WorkItem> {
    const w = await this.repo.findById(id);
    if (!w) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Requerimiento no encontrado' });
    }
    return w;
  }

  /**
   * Única vía por la que cambian `status` y `board_order`. Cambiar de columna y
   * reordenar dentro de ella son la misma acción desde el tablero.
   */
  async move(input: MoveInput): Promise<WorkItem> {
    const current = await this.findOrFail(input.workItemId);
    const from = current.status;
    const to = input.toStatus;

    // Se valida antes de escribir nada.
    assertReason(to, input.reason);

    const reason = input.reason?.trim() || null;
    const now = new Date();

    const targetColumn = await this.repo.listColumn(to);
    const targetIds = reorder(targetColumn.map((w) => w.id), current.id, input.toIndex);

    const sourceIds =
      from === to
        ? null
        : (await this.repo.listColumn(from)).map((w) => w.id).filter((id) => id !== current.id);

    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);

      const patch: Partial<WorkItem> = { status: to };
      if (to === 'CERRADO') patch.closedAt = now;
      if (from === 'CERRADO' && to !== 'CERRADO') patch.closedAt = null;
      await itemRepo.update(current.id, patch);

      if (sourceIds) await this.repo.applyOrder(manager, sourceIds);
      await this.repo.applyOrder(manager, targetIds);

      await this.events.record({
        workItemId: current.id,
        type: this.events.typeForMove(from, to),
        actorUserId: input.actorUserId,
        fromStatus: from,
        toStatus: to,
        reason,
      });

      return (await itemRepo.findOne({ where: { id: current.id } }))!;
    });
  }

  async assign(input: {
    workItemId: number;
    actorUserId: number;
    assigneeUserId: number | null;
  }): Promise<WorkItem> {
    await this.findOrFail(input.workItemId);

    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);
      await itemRepo.update(input.workItemId, { assigneeUserId: input.assigneeUserId });
      await this.events.record({
        workItemId: input.workItemId,
        type: 'ASSIGNED',
        actorUserId: input.actorUserId,
        payload: { assigneeUserId: input.assigneeUserId },
      });
      return (await itemRepo.findOne({ where: { id: input.workItemId } }))!;
    });
  }

  async changePriority(input: {
    workItemId: number;
    actorUserId: number;
    priority: WorkItemPriority;
    reason?: string;
  }): Promise<WorkItem> {
    const current = await this.findOrFail(input.workItemId);

    return this.repo.runInTransaction(async (manager) => {
      const itemRepo = manager.getRepository(WorkItem);
      await itemRepo.update(input.workItemId, { priority: input.priority });
      await this.events.record({
        workItemId: input.workItemId,
        type: 'PRIORITY_CHANGED',
        actorUserId: input.actorUserId,
        reason: input.reason?.trim() || null,
        payload: { from: current.priority, to: input.priority },
      });
      return (await itemRepo.findOne({ where: { id: input.workItemId } }))!;
    });
  }
}
```

Nótese que `changePriority` **no** reordena la columna: la posición manual manda, y mover el ítem por debajo del usuario sería una sorpresa. La inserción por prioridad solo aplica al crear.

- [ ] **Step 5: Registrar en el módulo**

Añadir `WorkItemBoardService` a `providers` y `exports`.

- [ ] **Step 6: Ejecutar los tests**

Run: `cd backend && npm test -- work-item-board.service`
Expected: PASS — 10 tests.

Run: `cd backend && npm test` y `npm run build` — todo en verde.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/work-items
git commit -m "feat(work-items): move, assign y cambio de prioridad transaccionales"
```

---

### Task 7: Controlador y DTOs

**Files:**
- Create: `backend/src/modules/work-items/work-items.controller.ts`
- Modify: `backend/src/modules/work-items/work-items.module.ts`

**Interfaces:**
- Consumes: `WorkItemsService`, `WorkItemBoardService`, los cuatro DTO, `JwtAuthGuard`, `CurrentUser`/`AuthUser`.
- Produces: las rutas bajo `/work-items`.

- [ ] **Step 1: Implementar el controlador**

`backend/src/modules/work-items/work-items.controller.ts`:

```ts
import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { WorkItemsService } from './work-items.service';
import { WorkItemBoardService } from './work-item-board.service';
import { CreateWorkItemDto } from './dto/create-work-item.dto';
import { UpdateWorkItemDto } from './dto/update-work-item.dto';
import { MoveWorkItemDto } from './dto/move-work-item.dto';
import { AssignWorkItemDto } from './dto/assign-work-item.dto';
import { ChangePriorityDto } from './dto/change-priority.dto';
import { DueFilter } from './work-items.repository';
import { WorkItemStatus, WorkItemPriority } from './domain/work-item-board';

@Controller('work-items')
@UseGuards(JwtAuthGuard)
export class WorkItemsController {
  constructor(
    private readonly service: WorkItemsService,
    private readonly board: WorkItemBoardService,
  ) {}

  @Get()
  list(
    @Query('clientId') clientId?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: WorkItemStatus,
    @Query('priority') priority?: WorkItemPriority,
    @Query('assigneeId') assigneeId?: string,
    @Query('dueFilter') dueFilter?: DueFilter,
    @Query('q') q?: string,
  ) {
    return this.service.list({
      clientId: clientId ? Number(clientId) : undefined,
      projectId: projectId ? Number(projectId) : undefined,
      status,
      priority,
      assigneeUserId: assigneeId ? Number(assigneeId) : undefined,
      dueFilter,
      q,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findWithTimeline(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkItemDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorkItemDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }

  @Post(':id/move')
  move(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoveWorkItemDto,
  ) {
    return this.board.move({
      workItemId: id,
      actorUserId: user.id,
      toStatus: dto.toStatus,
      toIndex: dto.toIndex,
      reason: dto.reason,
    });
  }

  @Post(':id/assign')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignWorkItemDto,
  ) {
    return this.board.assign({
      workItemId: id,
      actorUserId: user.id,
      assigneeUserId: dto.assigneeUserId ?? null,
    });
  }

  @Post(':id/priority')
  changePriority(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangePriorityDto,
  ) {
    return this.board.changePriority({
      workItemId: id,
      actorUserId: user.id,
      priority: dto.priority,
      reason: dto.reason,
    });
  }
}
```

- [ ] **Step 2: Registrar el controlador**

Añadir un array `controllers: [WorkItemsController]` al módulo.

- [ ] **Step 3: Verificar de extremo a extremo**

Run: `cd backend && npm run build` — sin errores.

Levantar el backend y, con un token de `admin@kubo.pe` / `Admin123*` contra `http://localhost:3003/api/v1`:

```bash
# crear
curl -s -X POST $API/work-items -H "$AH" -H "$JH" \
  -d '{"clientId":1,"title":"Exportar cartera a Excel","priority":"ALTA","dueDate":"2026-08-15"}'
```

Expected: HTTP 201, `code` tipo `RQ-0001`, `status: "PENDIENTE"`, `priority: "ALTA"`, `boardOrder` según la posición por prioridad.

```bash
# mover a EN_PROCESO
curl -s -X POST $API/work-items/1/move -H "$AH" -H "$JH" -d '{"toStatus":"EN_PROCESO","toIndex":0}'
# bloquear sin motivo -> debe fallar
curl -s -X POST $API/work-items/1/move -H "$AH" -H "$JH" -d '{"toStatus":"BLOQUEADO","toIndex":0}'
# ver el timeline
curl -s $API/work-items/1 -H "$AH"
```

Expected: el `move` devuelve 200; el bloqueo sin motivo devuelve 400 con `code: "BAD_INPUT"`; el detalle devuelve `{ workItem, timeline }` con `CREATED` y `MOVED`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/work-items
git commit -m "feat(work-items): endpoints del tablero"
```

---

### Task 8: Web — tipos y cliente API

**Files:**
- Create: `web/src/api/work-items.api.ts`
- Modify: `web/src/api/types.ts`

**Interfaces:**
- Produces: tipos `WorkItemStatus`, `WorkItemPriority`, `WorkItemEventType`, `WorkItem`, `WorkItemEvent`, `WorkItemDetail`; y `workItemsApi`.

Puramente aditivo: no se borra nada.

- [ ] **Step 1: Añadir los tipos**

En `web/src/api/types.ts`:

```ts
export type WorkItemStatus =
  | 'PENDIENTE' | 'EN_PROCESO' | 'PRUEBAS' | 'CERRADO' | 'BLOQUEADO' | 'CANCELADO';

export type WorkItemPriority = 'ALTA' | 'MEDIA' | 'BAJA';

export type WorkItemEventType =
  | 'CREATED' | 'MOVED' | 'ASSIGNED' | 'COMMENT' | 'BLOCKED' | 'UNBLOCKED'
  | 'CLOSED' | 'REOPENED' | 'CANCELLED' | 'PRIORITY_CHANGED';

export interface WorkItem {
  id: number;
  code: string | null;
  clientId: number;
  projectId: number | null;
  title: string;
  descriptionMd: string | null;
  acceptanceCriteria: string[] | null;
  labels: string[] | null;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assigneeUserId: number | null;
  boardOrder: number;
  dueDate: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface WorkItemEvent {
  id: number;
  workItemId: number;
  type: WorkItemEventType;
  fromStatus: WorkItemStatus | null;
  toStatus: WorkItemStatus | null;
  actorUserId: number | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface WorkItemDetail {
  workItem: WorkItem;
  timeline: WorkItemEvent[];
}
```

- [ ] **Step 2: Crear el cliente**

`web/src/api/work-items.api.ts`, siguiendo el patrón de `tickets.api.ts`:

```ts
import { api } from './client';
import type {
  WorkItem, WorkItemDetail, WorkItemStatus, WorkItemPriority,
} from './types';

export interface WorkItemListParams {
  clientId?: number;
  projectId?: number;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  assigneeId?: number;
  dueFilter?: 'vencidos' | 'semana';
  q?: string;
}

export interface CreateWorkItemBody {
  clientId: number;
  projectId?: number;
  title: string;
  descriptionMd?: string;
  acceptanceCriteria?: string[];
  labels?: string[];
  priority?: WorkItemPriority;
  assigneeUserId?: number;
  dueDate?: string;
}

export const workItemsApi = {
  list: (params?: WorkItemListParams) =>
    api.get<WorkItem[]>('/work-items', { params }).then((r) => r.data),

  findOne: (id: number) => api.get<WorkItemDetail>(`/work-items/${id}`).then((r) => r.data),

  create: (body: CreateWorkItemBody) =>
    api.post<WorkItem>('/work-items', body).then((r) => r.data),

  update: (id: number, body: Partial<Omit<CreateWorkItemBody, 'priority'>>) =>
    api.patch<WorkItem>(`/work-items/${id}`, body).then((r) => r.data),

  remove: (id: number) => api.delete<{ ok: true }>(`/work-items/${id}`).then((r) => r.data),

  move: (id: number, body: { toStatus: WorkItemStatus; toIndex: number; reason?: string }) =>
    api.post<WorkItem>(`/work-items/${id}/move`, body).then((r) => r.data),

  assign: (id: number, body: { assigneeUserId: number | null }) =>
    api.post<WorkItem>(`/work-items/${id}/assign`, body).then((r) => r.data),

  changePriority: (id: number, body: { priority: WorkItemPriority; reason?: string }) =>
    api.post<WorkItem>(`/work-items/${id}/priority`, body).then((r) => r.data),
};
```

- [ ] **Step 3: Verificar**

Run: `cd web && npm run build` — sin errores.

Comprobar que las rutas, verbos y nombres de parámetro coinciden con `work-items.controller.ts`. Un desajuste aquí compila y falla en ejecución.

- [ ] **Step 4: Commit**

```bash
git add web/src/api
git commit -m "feat(web): tipos y cliente API de work items"
```

---

### Task 9: Web — el tablero

**Files:**
- Create: `web/src/pages/work-items/workitem-ui.ts`
- Create: `web/src/pages/work-items/WorkItemCard.tsx`
- Create: `web/src/pages/WorkItemsBoardPage.tsx`

**Interfaces:**
- Consumes: `workItemsApi`, `supportAgentsApi` (para resolver nombres sin depender de `/users`, que está restringido por rol), `clientsApi`.
- Produces: `WorkItemsBoardPage` (default export), `WorkItemCard({ item, assigneeName, onOpen, onMove })`, y de `workitem-ui.ts`: `STATUS_LABELS`, `PRIORITY_STYLES`, `BOARD_COLUMNS`, `dueDateStyle(dueDate, status)`.

**Convenciones heredadas de la rama T1**, todas verificadas por sus revisiones:
- Guardas `cancelled` en los efectos asíncronos.
- Controles reales: `<button>`, `<Link>`, `<label>`. Nunca `<div>` pinchables. `aria-label` con contexto de fila.
- Ningún fallo se traga en silencio, y un fallo de escritura se distingue de un fallo de refresco posterior.
- Búsqueda con debounce (280 ms) y guarda contra respuestas fuera de orden.
- **Los nombres de usuario se resuelven con `supportAgentsApi.list()`**, no con `usersApi.list()`: el segundo está restringido a ADMIN/PRODUCT_OWNER/SCRUM_MASTER y dejaría a los técnicos viendo ids crudos.

- [ ] **Step 1: Crear la paleta**

`web/src/pages/work-items/workitem-ui.ts`:

```ts
import type { WorkItemPriority, WorkItemStatus } from '../../api/types';

export interface Swatch { bg: string; fg: string }

/** Las cuatro columnas de flujo, en orden. */
export const BOARD_COLUMNS: WorkItemStatus[] = ['PENDIENTE', 'EN_PROCESO', 'PRUEBAS', 'CERRADO'];

export const STATUS_LABELS: Record<WorkItemStatus, string> = {
  PENDIENTE: 'Pendiente',
  EN_PROCESO: 'En proceso',
  PRUEBAS: 'Pruebas',
  CERRADO: 'Cerrado',
  BLOQUEADO: 'Bloqueado',
  CANCELADO: 'Cancelado',
};

export const PRIORITY_STYLES: Record<WorkItemPriority, Swatch> = {
  ALTA:  { bg: 'oklch(0.94 0.04 25)',  fg: 'oklch(0.5 0.16 25)' },
  MEDIA: { bg: 'oklch(0.94 0.05 78)',  fg: 'oklch(0.5 0.11 70)' },
  BAJA:  { bg: '#eceeef',              fg: '#4a5052' },
};

export const OUT_OF_FLOW_STYLES: Record<'BLOQUEADO' | 'CANCELADO', Swatch> = {
  BLOQUEADO: { bg: 'oklch(0.95 0.04 290)', fg: 'oklch(0.45 0.13 290)' },
  CANCELADO: { bg: '#eceeef',              fg: '#6d7577' },
};

/**
 * Color de la etiqueta de fecha. No es un SLA: solo informa.
 * Un ítem cerrado o cancelado nunca se pinta como vencido.
 */
export function dueDateStyle(
  dueDate: string | null,
  status: WorkItemStatus,
): { color: string; overdue: boolean } {
  if (!dueDate) return { color: '#6d7577', overdue: false };
  if (status === 'CERRADO' || status === 'CANCELADO') return { color: '#6d7577', overdue: false };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) return { color: 'oklch(0.5 0.16 25)', overdue: true };
  if (days <= 3) return { color: 'oklch(0.5 0.11 70)', overdue: false };
  return { color: '#6d7577', overdue: false };
}
```

- [ ] **Step 2: Crear la tarjeta**

`web/src/pages/work-items/WorkItemCard.tsx` — muestra `code`, `title`, la etiqueta de prioridad, la fecha con su color, y el nombre del asignado. Recibe `onOpen` y `onMove` como props; el arrastre y el menú se añaden en la Tarea 10.

La tarjeta es un `<article>` con un `<button>` interno que abre el detalle — no un `<div onClick>`.

- [ ] **Step 3: Crear el tablero**

`web/src/pages/WorkItemsBoardPage.tsx`. Estructura:

- Barra superior con filtros: cliente (`<select>` alimentado por `clientsApi.list({ status: 'CLIENT' })`), prioridad, asignado, y los botones de fecha «Todos / Vencidos / Esta semana», más el buscador con debounce.
- Los filtros viven en la URL con `useSearchParams`, de modo que un tablero filtrado es un enlace compartible.
- Cuatro columnas en un `display: grid` de cuatro, cada una con su título, su contador y sus tarjetas ordenadas por `boardOrder`.
- Los ítems en `BLOQUEADO` y `CANCELADO` no son columnas: aparecen en una franja plegable bajo el tablero, porque están fuera del flujo pero no deben desaparecer de la vista.

El listado se pide una sola vez sin filtrar por estado y se reparte en columnas en el cliente — el endpoint ya devuelve todo ordenado por `(status, board_order)`.

- [ ] **Step 4: Verificar**

Run: `cd web && npm run build` — sin errores.

Con backend y web levantados, abrir `/work-items` (la ruta se añade en la Tarea 12; hasta entonces, verificar el componente montándolo temporalmente o esperar a esa tarea y verificar ahí). Confirmar que las cuatro columnas se pintan, que las tarjetas caen en la columna correcta y en su orden, y que los filtros cambian el resultado.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/work-items web/src/pages/WorkItemsBoardPage.tsx
git commit -m "feat(web): tablero de requerimientos con columnas y filtros"
```

---

### Task 10: Web — arrastrar y soltar, y el menú de teclado

**Files:**
- Modify: `web/src/pages/work-items/WorkItemCard.tsx`
- Modify: `web/src/pages/WorkItemsBoardPage.tsx`
- Create: `web/src/pages/work-items/MoveReasonDialog.tsx`

**Interfaces:**
- Consumes: `workItemsApi.move`, el patrón de diálogo de `web/src/ui/ConfirmDialog.tsx`.
- Produces: `MoveReasonDialog({ open, toStatus, onCancel, onConfirm })`.

No hay librería de arrastre en el proyecto y **no se añade una**: se usa la API nativa HTML5 (`draggable`, `onDragStart`, `onDragOver`, `onDrop`).

**El menú de teclado no es un extra.** El arrastre nativo no funciona sin ratón, y toda la rama sigue la convención de que los controles son accesibles. Cada tarjeta lleva un `<button>` «Mover a…» que despliega las seis destinaciones y hace exactamente lo mismo que el arrastre.

- [ ] **Step 1: Crear el diálogo de motivo**

`web/src/pages/work-items/MoveReasonDialog.tsx` — pide el motivo cuando el destino es `BLOQUEADO` o `CANCELADO`. Sigue el patrón de `web/src/ui/ConfirmDialog.tsx`: `role="dialog"`, `aria-modal`, cierre con Escape y con clic en el backdrop, `stopPropagation` en el panel interno, y el botón de confirmar deshabilitado mientras el motivo esté vacío.

- [ ] **Step 2: Añadir el arrastre a la tarjeta y a las columnas**

En la tarjeta: `draggable`, y en `onDragStart` guardar el id en `event.dataTransfer`.

En cada columna: `onDragOver` con `preventDefault()` para permitir soltar, un indicador visual de la posición de inserción, y `onDrop` que calcule el índice de destino según dónde se soltó y llame a `onMove(id, toStatus, toIndex)`.

- [ ] **Step 3: Añadir el menú «Mover a…»**

Un `<button aria-haspopup="menu">` en cada tarjeta que abra la lista de los seis estados. Al elegir uno, mueve el ítem al final de esa columna (`toIndex` = longitud actual). Reordenar dentro de una columna con teclado no entra en R1: el menú cubre el cambio de columna, que es lo que importa para no quedar bloqueado sin ratón.

- [ ] **Step 4: Conectar con la API**

El manejador `onMove` en la página:

- Si el destino exige motivo (`BLOQUEADO` o `CANCELADO`), abre `MoveReasonDialog` primero y solo llama a la API al confirmar.
- Llama a `workItemsApi.move` y **recarga la lista**. Nada de mover la tarjeta solo en el cliente: el servidor renumera la columna y es la fuente de verdad.
- Un fallo de la escritura muestra un mensaje distinto al de un fallo del refresco posterior.

- [ ] **Step 5: Verificar en un navegador real**

Run: `cd web && npm run build` — sin errores.

Con la app levantada, comprobar y dejar evidencia por ruta:
- Arrastrar una tarjeta entre columnas y confirmar que el orden persiste tras recargar la página.
- Arrastrar a Bloqueado sin motivo: el diálogo aparece y sin texto no envía.
- Recorrer el tablero solo con `Tab`, abrir «Mover a…» con `Enter` y mover una tarjeta sin tocar el ratón.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/work-items web/src/pages/WorkItemsBoardPage.tsx
git commit -m "feat(web): arrastrar y soltar con alternativa por teclado"
```

---

### Task 11: Web — panel de detalle y alta

**Files:**
- Create: `web/src/pages/work-items/WorkItemPanel.tsx`
- Create: `web/src/pages/work-items/NewWorkItemDialog.tsx`
- Modify: `web/src/pages/WorkItemsBoardPage.tsx`

**Interfaces:**
- Consumes: `workItemsApi.findOne/create/update/assign/changePriority`, `clientsApi`, `supportAgentsApi`.
- Produces: `WorkItemPanel({ workItemId, onClose, onChanged })`, `NewWorkItemDialog({ open, onCancel, onCreated })`.

- [ ] **Step 1: Crear el panel de detalle**

Panel lateral que se abre al pulsar una tarjeta. Muestra código, título, descripción, criterios de aceptación, cliente, proyecto, fecha objetivo, asignado y prioridad; permite cambiar asignado y prioridad; y lista el timeline.

El timeline reutiliza la forma de `web/src/pages/tickets/TicketTimeline.tsx` — leerlo y seguir su estructura, con las etiquetas de los tipos de evento de work items.

- [ ] **Step 2: Crear el diálogo de alta**

Formulario con cliente (obligatorio, de `clientsApi.list({ status: 'CLIENT' })`), proyecto opcional, título, descripción, prioridad, asignado y fecha objetivo. Sigue el patrón de `ConfirmDialog` para Escape y backdrop.

Un aviso visible bajo el campo de fecha: es un objetivo del equipo, no un compromiso de SLA. La distinción importa y la interfaz es donde se aprende.

- [ ] **Step 3: Conectar en la página**

Un botón «+ Nuevo requerimiento» en la barra superior abre el diálogo; al crear, recarga la lista y abre el panel del ítem nuevo.

- [ ] **Step 4: Verificar**

Run: `cd web && npm run build` — sin errores.

En el navegador: crear un requerimiento con prioridad ALTA y confirmar que **aterriza sobre los MEDIA** en la columna Pendiente, no al fondo. Abrir el panel, cambiar la prioridad y confirmar que el timeline suma `PRIORITY_CHANGED` con el valor anterior.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/work-items web/src/pages/WorkItemsBoardPage.tsx
git commit -m "feat(web): panel de detalle y alta de requerimientos"
```

---

### Task 12: Web — ruta, menú lateral y verificación de extremo a extremo

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/layout/AppLayout.tsx`

**Interfaces:**
- Consumes: `WorkItemsBoardPage`.
- Produces: la ruta `/work-items` y la entrada «Requerimientos» en el menú.

- [ ] **Step 1: Añadir la ruta**

En `App.tsx`, importar `WorkItemsBoardPage` y añadir `<Route path="/work-items" element={<WorkItemsBoardPage />} />` junto a las de tickets.

- [ ] **Step 2: Añadir la entrada al menú**

En `web/src/layout/AppLayout.tsx`, junto al enlace de Tickets (alrededor de la línea 100), añadir uno a `/work-items` con la etiqueta «Requerimientos», siguiendo exactamente el marcado y las clases del que ya está.

- [ ] **Step 3: Verificación completa**

Run: `cd web && npm run build` — sin errores.
Run: `cd backend && npm run build` — sin errores.
Run: `cd backend && npm test` — todos en verde.

Con la app levantada, recorrer el ciclo entero **sin tocar la base de datos a mano**:

1. Entrar por «Requerimientos» en el menú
2. Crear uno con prioridad ALTA y fecha objetivo pasada → aparece en Pendiente, sobre los MEDIA, con la fecha en rojo
3. Filtrar por «Vencidos» → aparece; quitar el filtro → sigue ahí
4. Arrastrarlo a En proceso → persiste al recargar
5. Arrastrarlo a Bloqueado → pide motivo; sin motivo no envía; con motivo se mueve y el motivo se ve en el timeline
6. Devolverlo a En proceso → el timeline suma `UNBLOCKED`
7. Moverlo a Cerrado → la fecha deja de pintarse en rojo (un cerrado no está vencido)
8. Reabrirlo a En proceso → el timeline suma `REOPENED`
9. Comprobar que todo el recorrido se puede hacer también solo con teclado

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx web/src/layout/AppLayout.tsx
git commit -m "feat(web): ruta y entrada de menu para requerimientos"
```

---

## Verificación de cobertura de la spec

| Sección de la spec | Tareas |
|---|---|
| §2 `work_items` | 2 (SQL), 3 (entidad), 5 (creación) |
| §2 `work_item_events` | 2, 3, 4 |
| §3 columnas fijas | 1, 2, 9 |
| §3 sin máquina de estados | 1 (solo `requiresReason`), 6 |
| §3 motivo en `BLOQUEADO`/`CANCELADO` | 1, 6, 10 |
| §3 `CERRADO` sella `closed_at`, reabrir lo limpia | 6 |
| §3 renumeración de la columna | 1, 6 |
| §3 inserción por prioridad al crear | 1, 5, 11 |
| §3 prioridad y orden conviven | 5, 6 (`changePriority` no reordena) |
| §4 escritura transaccional con su evento | 5, 6 |
| §5 `due_date` sin SLA | 2, 5, 9 (`dueDateStyle`), 11 (aviso en el formulario) |
| §5 filtros «vencidos» y «esta semana» | 3 (repositorio), 7 (endpoint), 9 (UI) |
| §6 endpoints | 7 |
| §6 `PATCH` sin `status`/`board_order`/`priority` | 5 (`UpdateWorkItemDto`) |
| §7 estructura de código | 1–12 |
| §7 accesibilidad del tablero | 10 |
| §8 pruebas | 1, 5, 6 |

**Fuera de R1 por decisión de la spec §9**, sin tarea: el puente desde tickets y actas (R2), sprints y MVP (R3), apagar Jira y reescribir el ROADMAP (R4), estimación, comentarios de usuario, adjuntos, notificaciones, columnas configurables.

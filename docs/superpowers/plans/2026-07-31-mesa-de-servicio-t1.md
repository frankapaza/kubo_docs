# Mesa de servicio T1 — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el núcleo de la mesa de servicio Kuboti — entidad `tickets` con ciclo de vida, prioridad por impacto × urgencia, reloj de SLA con pausa, timeline auditable y derivación por niveles — reemplazando el módulo `client-requests`.

**Architecture:** Backend NestJS por capas (controller → service → repository) siguiendo el patrón ya establecido en `backend/src/modules/`. La lógica de negocio pura (matriz de prioridad, máquina de estados, cálculo de SLA) vive en módulos **sin dependencias de base de datos** para poder probarse unitariamente. La migración se parte en dos: `010` crea las tablas nuevas y `011` elimina la vieja, de modo que el repositorio compila y arranca en todo momento hasta el cutover final.

**Tech Stack:** NestJS 10 · TypeORM 0.3 · MySQL 8 · Jest 29 + ts-jest · BullMQ + `@nestjs/schedule` · React 18 + Vite + TypeScript · axios.

## Global Constraints

- **Spec de referencia:** `docs/superpowers/specs/2026-07-31-mesa-de-servicio-t1-design.md`. Ante cualquier duda, la spec manda.
- **Base de datos:** MySQL, esquema `kubo_devdocs`. Todas las migraciones empiezan con `USE kubo_devdocs;`.
- **Migraciones:** `backend/sql/migrations/NNN_nombre.sql`, numeración correlativa. La última existente es `009_attended_at.sql`.
- **TypeORM `synchronize: false`** — el esquema SOLO cambia por migración SQL. Nunca confiar en la sincronización automática.
- **Errores de API:** siempre `{ code, message }` con `message` en español. Códigos en uso: `NOT_FOUND`, `BAD_INPUT`, `CONFLICT`, `LLM_ERROR`. Se añade `INVALID_TRANSITION`.
- **Idioma:** identificadores de código en inglés; enums de dominio, mensajes de usuario y comentarios en español, tal como el código existente.
- **SLA en T1: horas corridas 24×7.** No hay calendario laboral ni horario de cobertura. La columna `sla_policies.coverage` se crea pero no se lee.
- **Prioridades:** `P1`, `P2`, `P3`, `P4`. **Nunca** `LOW`/`MEDIUM`/`HIGH` (ese era el modelo viejo).
- **Rama de trabajo:** `feat/mesa-servicio-t1`.
- **Tests:** `npm test` desde `backend/`. Un commit por tarea, tras verificar que los tests pasan.

---

## Estructura de archivos

**Lógica pura (sin BD, unitariamente testeable):**

| Archivo | Responsabilidad |
|---|---|
| `backend/src/modules/tickets/domain/ticket-priority.ts` | Matriz impacto × urgencia → P1–P4 |
| `backend/src/modules/tickets/domain/ticket-state-machine.ts` | Transiciones válidas y qué exige motivo |
| `backend/src/modules/tickets/domain/sla.calculator.ts` | Vencimientos, desplazamiento por pausa, umbral de riesgo |

**Persistencia y orquestación:**

| Archivo | Responsabilidad |
|---|---|
| `entities/ticket.entity.ts` · `ticket-event.entity.ts` · `sla-policy.entity.ts` · `support-agent.entity.ts` · `client-system.entity.ts` | Mapeo TypeORM |
| `tickets.repository.ts` · `ticket-events.repository.ts` · `sla-policies.repository.ts` · `support-agents.repository.ts` · `client-systems.repository.ts` | Acceso a datos |
| `ticket-events.service.ts` | Escritura del timeline (append-only) |
| `sla.service.ts` | Resuelve la política del cliente y aplica el cálculo al ticket |
| `tickets.service.ts` | CRUD, generación de `code`, orquestación |
| `ticket-transitions.service.ts` | Transiciones, asignación, derivación, override de prioridad |
| `ticket-ai.service.ts` | Triaje IA, push a Jira, transcripción, documento de cierre (portado) |
| `sla-risk.scheduler.ts` | Cron cada 5 min que marca `sla_at_risk` |
| `support-agents.service.ts` · `client-systems.service.ts` | Catálogos |
| `tickets.controller.ts` · `support-agents.controller.ts` · `client-systems.controller.ts` | HTTP |

`tickets.service.ts` y `ticket-transitions.service.ts` se separan a propósito: las transiciones concentran las reglas de negocio y son lo que más crecerá en T2–T4.

**Web:**

| Archivo | Responsabilidad |
|---|---|
| `web/src/api/tickets.api.ts` | Cliente HTTP |
| `web/src/pages/TicketsListPage.tsx` | Bandeja con chips de filtro y barra de SLA |
| `web/src/pages/TicketDetailPage.tsx` | Detalle, timeline, acciones, reloj |
| `web/src/pages/tickets/TicketTimeline.tsx` · `TicketSlaClock.tsx` · `TicketActions.tsx` | Piezas del detalle |

---

## Orden de ejecución

Tareas 1–3 son lógica pura sin BD: se pueden ejecutar en paralelo. Las demás son secuenciales.

| # | Tarea | Depende de |
|---|---|---|
| 1 | Jest + matriz de prioridad | — |
| 2 | Máquina de estados | 1 (jest config) |
| 3 | Calculadora de SLA | 1 (jest config) |
| 4 | Migración 010 — tablas nuevas | — |
| 5 | Entidades, repositorios y módulo | 4 |
| 6 | Timeline (`ticket_events`) | 5 |
| 7 | `SlaService` con BD | 3, 5 |
| 8 | `TicketsService`: CRUD + `code` | 5, 6, 7 |
| 9 | Transiciones y reglas de cierre | 2, 8 |
| 10 | Asignación, derivación y sugerencia | 5, 9 |
| 11 | Catálogos: sistemas y agentes | 5 |
| 12 | Cron de SLA en riesgo | 7, 9 |
| 13 | Portar IA, Jira y transcripción | 8 |
| 14 | **Cutover**: migración 011 y borrado del módulo viejo | 13 |
| 15 | Web: tipos y cliente API | 14 |
| 16 | Web: bandeja | 15 |
| 17 | Web: detalle | 15 |
| 18 | Web: catálogos y rutas | 15 |

---

### Task 1: Jest y matriz de prioridad

**Files:**
- Create: `backend/jest.config.js`
- Create: `backend/src/modules/tickets/domain/ticket-priority.ts`
- Test: `backend/src/modules/tickets/domain/ticket-priority.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `TicketImpact`, `TicketUrgency`, `TicketPriority`, `TICKET_PRIORITIES`, `DEFAULT_PRIORITY`, `derivePriority(impact: TicketImpact | null, urgency: TicketUrgency | null): TicketPriority`.

El repositorio tiene `jest` y `ts-jest` en `devDependencies` y el script `"test": "jest"`, pero **no hay configuración ni un solo test**. Esta tarea deja la infraestructura lista además de la primera pieza de dominio.

- [ ] **Step 1: Crear la configuración de Jest**

`backend/jest.config.js`:

```js
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
```

- [ ] **Step 2: Escribir el test que falla**

`backend/src/modules/tickets/domain/ticket-priority.spec.ts`:

```ts
import { derivePriority, DEFAULT_PRIORITY } from './ticket-priority';

describe('derivePriority', () => {
  it('mapea las nueve combinaciones de impacto x urgencia', () => {
    expect(derivePriority('ALTO', 'ALTA')).toBe('P1');
    expect(derivePriority('ALTO', 'MEDIA')).toBe('P2');
    expect(derivePriority('ALTO', 'BAJA')).toBe('P3');

    expect(derivePriority('MEDIO', 'ALTA')).toBe('P2');
    expect(derivePriority('MEDIO', 'MEDIA')).toBe('P3');
    expect(derivePriority('MEDIO', 'BAJA')).toBe('P3');

    expect(derivePriority('BAJO', 'ALTA')).toBe('P3');
    expect(derivePriority('BAJO', 'MEDIA')).toBe('P4');
    expect(derivePriority('BAJO', 'BAJA')).toBe('P4');
  });

  it('cae a la prioridad por defecto cuando falta impacto o urgencia', () => {
    expect(derivePriority(null, 'ALTA')).toBe(DEFAULT_PRIORITY);
    expect(derivePriority('ALTO', null)).toBe(DEFAULT_PRIORITY);
    expect(derivePriority(null, null)).toBe(DEFAULT_PRIORITY);
    expect(DEFAULT_PRIORITY).toBe('P3');
  });
});
```

- [ ] **Step 3: Ejecutar el test y verificar que falla**

Run: `cd backend; npm test -- ticket-priority`
Expected: FAIL — `Cannot find module './ticket-priority'`.

- [ ] **Step 4: Implementar**

`backend/src/modules/tickets/domain/ticket-priority.ts`:

```ts
export type TicketImpact = 'ALTO' | 'MEDIO' | 'BAJO';
export type TicketUrgency = 'ALTA' | 'MEDIA' | 'BAJA';
export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4';

export const TICKET_IMPACTS: TicketImpact[] = ['ALTO', 'MEDIO', 'BAJO'];
export const TICKET_URGENCIES: TicketUrgency[] = ['ALTA', 'MEDIA', 'BAJA'];
export const TICKET_PRIORITIES: TicketPriority[] = ['P1', 'P2', 'P3', 'P4'];

/** Prioridad cuando no se conoce impacto o urgencia. */
export const DEFAULT_PRIORITY: TicketPriority = 'P3';

const MATRIX: Record<TicketImpact, Record<TicketUrgency, TicketPriority>> = {
  ALTO: { ALTA: 'P1', MEDIA: 'P2', BAJA: 'P3' },
  MEDIO: { ALTA: 'P2', MEDIA: 'P3', BAJA: 'P3' },
  BAJO: { ALTA: 'P3', MEDIA: 'P4', BAJA: 'P4' },
};

/**
 * Deriva la prioridad del ticket a partir de la matriz impacto x urgencia.
 * Función pura: no consulta base de datos ni depende de la política de SLA.
 */
export function derivePriority(
  impact: TicketImpact | null,
  urgency: TicketUrgency | null,
): TicketPriority {
  if (!impact || !urgency) return DEFAULT_PRIORITY;
  return MATRIX[impact][urgency];
}
```

- [ ] **Step 5: Ejecutar el test y verificar que pasa**

Run: `cd backend; npm test -- ticket-priority`
Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/jest.config.js backend/src/modules/tickets/domain/ticket-priority.ts backend/src/modules/tickets/domain/ticket-priority.spec.ts
git commit -m "feat(tickets): matriz de prioridad impacto x urgencia y config de jest"
```

---

### Task 2: Máquina de estados

**Files:**
- Create: `backend/src/modules/tickets/domain/ticket-state-machine.ts`
- Test: `backend/src/modules/tickets/domain/ticket-state-machine.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `TicketStatus`, `TICKET_STATUSES`, `OPEN_STATUSES`, `canTransition(from, to): boolean`, `assertTransition(from, to): void`, `requiresReason(from, to): boolean`, `isCancellation(from, to): boolean`.

`assertTransition` lanza `BadRequestException` con `{ code: 'INVALID_TRANSITION', message }`. Es la única pieza de `domain/` que importa de NestJS: solo el tipo de excepción, sin inyección de dependencias, así que sigue siendo testeable sin módulo de test.

- [ ] **Step 1: Escribir el test que falla**

`backend/src/modules/tickets/domain/ticket-state-machine.spec.ts`:

```ts
import {
  canTransition,
  assertTransition,
  requiresReason,
  isCancellation,
  OPEN_STATUSES,
} from './ticket-state-machine';

describe('canTransition', () => {
  it('acepta el camino feliz completo', () => {
    expect(canTransition('NUEVO', 'TRIAJE')).toBe(true);
    expect(canTransition('TRIAJE', 'ASIGNADO')).toBe(true);
    expect(canTransition('ASIGNADO', 'EN_ATENCION')).toBe(true);
    expect(canTransition('EN_ATENCION', 'RESUELTO')).toBe(true);
    expect(canTransition('RESUELTO', 'CERRADO')).toBe(true);
  });

  it('acepta los desvios de espera y derivacion en ambos sentidos', () => {
    expect(canTransition('EN_ATENCION', 'ESPERA_CLIENTE')).toBe(true);
    expect(canTransition('ESPERA_CLIENTE', 'EN_ATENCION')).toBe(true);
    expect(canTransition('EN_ATENCION', 'DERIVADO')).toBe(true);
    expect(canTransition('DERIVADO', 'EN_ATENCION')).toBe(true);
  });

  it('acepta la reapertura desde RESUELTO', () => {
    expect(canTransition('RESUELTO', 'EN_ATENCION')).toBe(true);
  });

  it('permite cancelar desde cualquier estado abierto', () => {
    for (const s of OPEN_STATUSES) {
      expect(canTransition(s, 'CERRADO')).toBe(true);
    }
  });

  it('rechaza saltos invalidos', () => {
    expect(canTransition('NUEVO', 'RESUELTO')).toBe(false);
    expect(canTransition('NUEVO', 'EN_ATENCION')).toBe(false);
    expect(canTransition('TRIAJE', 'EN_ATENCION')).toBe(false);
    expect(canTransition('ASIGNADO', 'RESUELTO')).toBe(false);
    expect(canTransition('DERIVADO', 'RESUELTO')).toBe(false);
  });

  it('CERRADO es terminal', () => {
    expect(canTransition('CERRADO', 'EN_ATENCION')).toBe(false);
    expect(canTransition('CERRADO', 'CERRADO')).toBe(false);
  });
});

describe('assertTransition', () => {
  it('no lanza en una transicion valida', () => {
    expect(() => assertTransition('NUEVO', 'TRIAJE')).not.toThrow();
  });

  it('lanza INVALID_TRANSITION en una invalida', () => {
    expect(() => assertTransition('NUEVO', 'RESUELTO')).toThrow();
    try {
      assertTransition('NUEVO', 'RESUELTO');
    } catch (e: any) {
      expect(e.getResponse().code).toBe('INVALID_TRANSITION');
    }
  });
});

describe('isCancellation / requiresReason', () => {
  it('cerrar desde RESUELTO es cierre normal, no cancelacion', () => {
    expect(isCancellation('RESUELTO', 'CERRADO')).toBe(false);
    expect(requiresReason('RESUELTO', 'CERRADO')).toBe(false);
  });

  it('cerrar desde un estado abierto es cancelacion y exige motivo', () => {
    expect(isCancellation('EN_ATENCION', 'CERRADO')).toBe(true);
    expect(requiresReason('EN_ATENCION', 'CERRADO')).toBe(true);
    expect(requiresReason('NUEVO', 'CERRADO')).toBe(true);
  });

  it('derivar exige motivo', () => {
    expect(requiresReason('EN_ATENCION', 'DERIVADO')).toBe(true);
    expect(requiresReason('ASIGNADO', 'DERIVADO')).toBe(true);
  });

  it('reabrir exige motivo', () => {
    expect(requiresReason('RESUELTO', 'EN_ATENCION')).toBe(true);
  });

  it('las transiciones ordinarias no exigen motivo', () => {
    expect(requiresReason('ASIGNADO', 'EN_ATENCION')).toBe(false);
    expect(requiresReason('EN_ATENCION', 'ESPERA_CLIENTE')).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd backend; npm test -- ticket-state-machine`
Expected: FAIL — `Cannot find module './ticket-state-machine'`.

- [ ] **Step 3: Implementar**

`backend/src/modules/tickets/domain/ticket-state-machine.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

export type TicketStatus =
  | 'NUEVO'
  | 'TRIAJE'
  | 'ASIGNADO'
  | 'EN_ATENCION'
  | 'ESPERA_CLIENTE'
  | 'DERIVADO'
  | 'RESUELTO'
  | 'CERRADO';

export const TICKET_STATUSES: TicketStatus[] = [
  'NUEVO',
  'TRIAJE',
  'ASIGNADO',
  'EN_ATENCION',
  'ESPERA_CLIENTE',
  'DERIVADO',
  'RESUELTO',
  'CERRADO',
];

/** Estados que cuentan como "abierto" en la bandeja, los KPI y el job de riesgo. */
export const OPEN_STATUSES: TicketStatus[] = [
  'NUEVO',
  'TRIAJE',
  'ASIGNADO',
  'EN_ATENCION',
  'ESPERA_CLIENTE',
  'DERIVADO',
];

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NUEVO: ['TRIAJE', 'ASIGNADO', 'CERRADO'],
  TRIAJE: ['ASIGNADO', 'CERRADO'],
  ASIGNADO: ['EN_ATENCION', 'DERIVADO', 'CERRADO'],
  EN_ATENCION: ['ESPERA_CLIENTE', 'DERIVADO', 'RESUELTO', 'CERRADO'],
  ESPERA_CLIENTE: ['EN_ATENCION', 'RESUELTO', 'CERRADO'],
  DERIVADO: ['EN_ATENCION', 'CERRADO'],
  RESUELTO: ['CERRADO', 'EN_ATENCION'],
  CERRADO: [],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (canTransition(from, to)) return;
  throw new BadRequestException({
    code: 'INVALID_TRANSITION',
    message: `No se puede pasar de «${from}» a «${to}».`,
  });
}

/** Cerrar sin haber resuelto es cancelar: el prototipo exige dejar constancia. */
export function isCancellation(from: TicketStatus, to: TicketStatus): boolean {
  return to === 'CERRADO' && from !== 'RESUELTO';
}

/** Reabrir un ticket ya resuelto. */
export function isReopen(from: TicketStatus, to: TicketStatus): boolean {
  return from === 'RESUELTO' && to === 'EN_ATENCION';
}

/**
 * Transiciones que no se aceptan sin `reason`.
 * Regla 03 del prototipo (derivar) y trazabilidad de cancelación y reapertura.
 */
export function requiresReason(from: TicketStatus, to: TicketStatus): boolean {
  return to === 'DERIVADO' || isCancellation(from, to) || isReopen(from, to);
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `cd backend; npm test -- ticket-state-machine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tickets/domain/ticket-state-machine.ts backend/src/modules/tickets/domain/ticket-state-machine.spec.ts
git commit -m "feat(tickets): maquina de estados del ciclo de vida de servicio"
```

---

### Task 3: Calculadora de SLA

**Files:**
- Create: `backend/src/modules/tickets/domain/sla.calculator.ts`
- Test: `backend/src/modules/tickets/domain/sla.calculator.spec.ts`

**Interfaces:**
- Consumes: `TicketPriority` de `./ticket-priority`.
- Produces: `SlaTargets`, `SlaMatrix`, `DEFAULT_SLA_MATRIX`, `AT_RISK_THRESHOLD`, `computeDueDates(createdAt, priority, matrix): { responseDueAt, resolutionDueAt }`, `shiftForPause(input): { pausedSeconds, responseDueAt, resolutionDueAt }`, `consumedRatio(input): number`, `isAtRisk(input): boolean`.

Todo en horas corridas 24×7, según la decisión de la spec §4.2. Sin `Date.now()` interno: el instante actual siempre se recibe por parámetro, para que los tests sean deterministas.

- [ ] **Step 1: Escribir el test que falla**

`backend/src/modules/tickets/domain/sla.calculator.spec.ts`:

```ts
import {
  computeDueDates,
  shiftForPause,
  consumedRatio,
  isAtRisk,
  DEFAULT_SLA_MATRIX,
  AT_RISK_THRESHOLD,
} from './sla.calculator';

const T0 = new Date('2026-07-31T08:00:00.000Z');
const min = (n: number) => n * 60 * 1000;

describe('computeDueDates', () => {
  it('aplica los minutos de la matriz por defecto para P1', () => {
    const r = computeDueDates(T0, 'P1', DEFAULT_SLA_MATRIX);
    expect(r.responseDueAt.getTime()).toBe(T0.getTime() + min(15));
    expect(r.resolutionDueAt.getTime()).toBe(T0.getTime() + min(240));
  });

  it('aplica los minutos de la matriz por defecto para P4', () => {
    const r = computeDueDates(T0, 'P4', DEFAULT_SLA_MATRIX);
    expect(r.responseDueAt.getTime()).toBe(T0.getTime() + min(240));
    expect(r.resolutionDueAt.getTime()).toBe(T0.getTime() + min(1440));
  });

  it('cuenta horas corridas: cruza la noche y el fin de semana sin pausar', () => {
    const viernes17 = new Date('2026-07-31T17:00:00.000Z');
    const r = computeDueDates(viernes17, 'P3', DEFAULT_SLA_MATRIX);
    // P3 resolucion 12h -> vence a las 05:00 del dia siguiente
    expect(r.resolutionDueAt.toISOString()).toBe('2026-08-01T05:00:00.000Z');
  });
});

describe('shiftForPause', () => {
  it('desplaza ambos vencimientos por la duracion de la pausa', () => {
    const due = computeDueDates(T0, 'P2', DEFAULT_SLA_MATRIX);
    const pausedAt = new Date(T0.getTime() + min(10));
    const resumedAt = new Date(T0.getTime() + min(40)); // 30 min de pausa

    const r = shiftForPause({
      pausedAt,
      resumedAt,
      responseDueAt: due.responseDueAt,
      resolutionDueAt: due.resolutionDueAt,
    });

    expect(r.pausedSeconds).toBe(30 * 60);
    expect(r.responseDueAt.getTime()).toBe(due.responseDueAt.getTime() + min(30));
    expect(r.resolutionDueAt.getTime()).toBe(due.resolutionDueAt.getTime() + min(30));
  });

  it('acumula pausas sucesivas', () => {
    const due = computeDueDates(T0, 'P2', DEFAULT_SLA_MATRIX);

    const p1 = shiftForPause({
      pausedAt: new Date(T0.getTime() + min(10)),
      resumedAt: new Date(T0.getTime() + min(40)),
      responseDueAt: due.responseDueAt,
      resolutionDueAt: due.resolutionDueAt,
    });
    const p2 = shiftForPause({
      pausedAt: new Date(T0.getTime() + min(60)),
      resumedAt: new Date(T0.getTime() + min(75)),
      responseDueAt: p1.responseDueAt,
      resolutionDueAt: p1.resolutionDueAt,
    });

    expect(p2.resolutionDueAt.getTime()).toBe(due.resolutionDueAt.getTime() + min(45));
  });

  it('no acepta una reanudacion anterior a la pausa', () => {
    const due = computeDueDates(T0, 'P2', DEFAULT_SLA_MATRIX);
    expect(() =>
      shiftForPause({
        pausedAt: new Date(T0.getTime() + min(40)),
        resumedAt: new Date(T0.getTime() + min(10)),
        responseDueAt: due.responseDueAt,
        resolutionDueAt: due.resolutionDueAt,
      }),
    ).toThrow();
  });
});

describe('consumedRatio', () => {
  const due = computeDueDates(T0, 'P1', DEFAULT_SLA_MATRIX); // 240 min

  it('es 0 al crear y 1 al vencer', () => {
    expect(
      consumedRatio({ now: T0, createdAt: T0, resolutionDueAt: due.resolutionDueAt, pausedTotalSeconds: 0, pausedAt: null }),
    ).toBeCloseTo(0);
    expect(
      consumedRatio({ now: due.resolutionDueAt, createdAt: T0, resolutionDueAt: due.resolutionDueAt, pausedTotalSeconds: 0, pausedAt: null }),
    ).toBeCloseTo(1);
  });

  it('descuenta el tiempo ya pausado', () => {
    // 120 min transcurridos, de los cuales 60 fueron pausa -> 60/240 activos
    const shifted = new Date(due.resolutionDueAt.getTime() + min(60));
    const ratio = consumedRatio({
      now: new Date(T0.getTime() + min(120)),
      createdAt: T0,
      resolutionDueAt: shifted,
      pausedTotalSeconds: 60 * 60,
      pausedAt: null,
    });
    expect(ratio).toBeCloseTo(0.25);
  });

  it('descuenta tambien la pausa en curso', () => {
    // 120 min transcurridos, en pausa desde el minuto 60 -> 60 activos de 240
    const ratio = consumedRatio({
      now: new Date(T0.getTime() + min(120)),
      createdAt: T0,
      resolutionDueAt: due.resolutionDueAt,
      pausedTotalSeconds: 0,
      pausedAt: new Date(T0.getTime() + min(60)),
    });
    expect(ratio).toBeCloseTo(0.25);
  });
});

describe('isAtRisk', () => {
  const due = computeDueDates(T0, 'P1', DEFAULT_SLA_MATRIX); // 240 min

  it('el umbral es 70%', () => {
    expect(AT_RISK_THRESHOLD).toBe(0.7);
  });

  it('no marca en riesgo por debajo del umbral', () => {
    const now = new Date(T0.getTime() + min(167)); // 69.6%
    expect(isAtRisk({ now, createdAt: T0, resolutionDueAt: due.resolutionDueAt, pausedTotalSeconds: 0, pausedAt: null })).toBe(false);
  });

  it('marca en riesgo al alcanzar el umbral', () => {
    const now = new Date(T0.getTime() + min(168)); // 70%
    expect(isAtRisk({ now, createdAt: T0, resolutionDueAt: due.resolutionDueAt, pausedTotalSeconds: 0, pausedAt: null })).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd backend; npm test -- sla.calculator`
Expected: FAIL — `Cannot find module './sla.calculator'`.

- [ ] **Step 3: Implementar**

`backend/src/modules/tickets/domain/sla.calculator.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { TicketPriority } from './ticket-priority';

export interface SlaTargets {
  responseMinutes: number;
  resolutionMinutes: number;
}

export type SlaMatrix = Record<TicketPriority, SlaTargets>;

/** Semilla de la política «Estándar» (spec §2.3). */
export const DEFAULT_SLA_MATRIX: SlaMatrix = {
  P1: { responseMinutes: 15, resolutionMinutes: 240 },
  P2: { responseMinutes: 30, resolutionMinutes: 360 },
  P3: { responseMinutes: 60, resolutionMinutes: 720 },
  P4: { responseMinutes: 240, resolutionMinutes: 1440 },
};

/** Fracción del plazo de resolución a partir de la cual el ticket se marca en riesgo. */
export const AT_RISK_THRESHOLD = 0.7;

const MINUTE_MS = 60 * 1000;

/**
 * Vencimientos absolutos a partir de la creación. Horas corridas 24x7:
 * en T1 no existe calendario laboral ni horario de cobertura.
 */
export function computeDueDates(
  createdAt: Date,
  priority: TicketPriority,
  matrix: SlaMatrix,
): { responseDueAt: Date; resolutionDueAt: Date } {
  const targets = matrix[priority];
  return {
    responseDueAt: new Date(createdAt.getTime() + targets.responseMinutes * MINUTE_MS),
    resolutionDueAt: new Date(createdAt.getTime() + targets.resolutionMinutes * MINUTE_MS),
  };
}

/**
 * Al salir de ESPERA_CLIENTE se desplazan los vencimientos por lo que duró la pausa.
 * Se mueven las fechas absolutas en vez de recalcularlas en cada lectura, para que
 * la consulta de vencidos siga siendo un WHERE sobre una columna indexada.
 */
export function shiftForPause(input: {
  pausedAt: Date;
  resumedAt: Date;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
}): { pausedSeconds: number; responseDueAt: Date | null; resolutionDueAt: Date | null } {
  const deltaMs = input.resumedAt.getTime() - input.pausedAt.getTime();
  if (deltaMs < 0) {
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: 'La reanudación no puede ser anterior a la pausa.',
    });
  }
  return {
    pausedSeconds: Math.round(deltaMs / 1000),
    responseDueAt: input.responseDueAt ? new Date(input.responseDueAt.getTime() + deltaMs) : null,
    resolutionDueAt: input.resolutionDueAt
      ? new Date(input.resolutionDueAt.getTime() + deltaMs)
      : null,
  };
}

export interface SlaClockState {
  now: Date;
  createdAt: Date;
  resolutionDueAt: Date;
  pausedTotalSeconds: number;
  /** No nulo mientras el ticket está en ESPERA_CLIENTE. */
  pausedAt: Date | null;
}

/**
 * Fracción del plazo de resolución ya consumida, descontando el tiempo en pausa
 * (el acumulado y el de la pausa en curso, si la hay).
 */
export function consumedRatio(state: SlaClockState): number {
  const pausedMs = state.pausedTotalSeconds * 1000;
  const ongoingPauseMs = state.pausedAt ? state.now.getTime() - state.pausedAt.getTime() : 0;

  const activeMs = state.now.getTime() - state.createdAt.getTime() - pausedMs - ongoingPauseMs;
  // El plazo original: la fecha de vencimiento ya incorpora los desplazamientos por pausa.
  const windowMs = state.resolutionDueAt.getTime() - state.createdAt.getTime() - pausedMs;

  if (windowMs <= 0) return 1;
  return activeMs / windowMs;
}

export function isAtRisk(state: SlaClockState): boolean {
  return consumedRatio(state) >= AT_RISK_THRESHOLD;
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `cd backend; npm test -- sla.calculator`
Expected: PASS.

- [ ] **Step 5: Ejecutar la suite completa**

Run: `cd backend; npm test`
Expected: PASS — 3 archivos de test.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/tickets/domain/sla.calculator.ts backend/src/modules/tickets/domain/sla.calculator.spec.ts
git commit -m "feat(tickets): calculadora de SLA con pausa y umbral de riesgo"
```

---

### Task 4: Migración 010 — tablas nuevas

**Files:**
- Create: `backend/sql/migrations/010_service_desk.sql`

**Interfaces:**
- Consumes: tablas `clients`, `projects`, `users`, `meetings` ya existentes.
- Produces: tablas `tickets`, `ticket_events`, `sla_policies`, `support_agents`, `client_systems`; columna `clients.sla_policy_id`; fila semilla en `sla_policies` con `is_default = 1`.

**No elimina `client_requests`.** Ese DROP va en la migración `011`, dentro del cutover de la Tarea 14, para que el sistema siga arrancando mientras se construye el módulo nuevo.

- [ ] **Step 1: Escribir la migración**

`backend/sql/migrations/010_service_desk.sql`:

```sql
-- =========================================================================
--  Migración 010 — Mesa de servicio (T1)
-- =========================================================================
--  Crea el núcleo de la mesa de servicio:
--    · sla_policies    matriz de tiempos por prioridad
--    · client_systems  catálogo de sistemas bajo soporte por cliente
--    · support_agents  técnicos con nivel y especialidades
--    · tickets         entidad principal, con ciclo de vida y reloj de SLA
--    · ticket_events   timeline append-only (evidencia auditable)
--
--  NO elimina client_requests: eso ocurre en 011_drop_client_requests.sql,
--  una vez que el módulo nuevo esté completo.
-- =========================================================================

USE kubo_devdocs;

-- -------------------------------------------------------------------------
-- 1) Políticas de SLA
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sla_policies (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name                   VARCHAR(80)     NOT NULL,
  is_default             TINYINT(1)      NOT NULL DEFAULT 0,

  p1_response_minutes    INT UNSIGNED    NOT NULL,
  p1_resolution_minutes  INT UNSIGNED    NOT NULL,
  p2_response_minutes    INT UNSIGNED    NOT NULL,
  p2_resolution_minutes  INT UNSIGNED    NOT NULL,
  p3_response_minutes    INT UNSIGNED    NOT NULL,
  p3_resolution_minutes  INT UNSIGNED    NOT NULL,
  p4_response_minutes    INT UNSIGNED    NOT NULL,
  p4_resolution_minutes  INT UNSIGNED    NOT NULL,

  -- Reservado: en T1 el reloj corre 24x7 y esta columna no se lee.
  coverage               VARCHAR(40)     NULL COMMENT 'reservado, sin uso en T1',

  created_at             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                         ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sla_policies_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO sla_policies
  (name, is_default,
   p1_response_minutes, p1_resolution_minutes,
   p2_response_minutes, p2_resolution_minutes,
   p3_response_minutes, p3_resolution_minutes,
   p4_response_minutes, p4_resolution_minutes)
SELECT 'Estándar', 1, 15, 240, 30, 360, 60, 720, 240, 1440
WHERE NOT EXISTS (SELECT 1 FROM sla_policies WHERE name = 'Estándar');

-- Política de SLA por cliente (NULL => se usa la marcada is_default)
ALTER TABLE clients
  ADD COLUMN sla_policy_id BIGINT UNSIGNED NULL AFTER jira_code,
  ADD INDEX idx_clients_sla_policy (sla_policy_id);

-- -------------------------------------------------------------------------
-- 2) Sistemas bajo soporte
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_systems (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id   BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(120)    NOT NULL,
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_client_systems (client_id, name),
  INDEX idx_client_systems_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 3) Técnicos de la mesa
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_agents (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  level        ENUM('N1','N2','N3') NOT NULL DEFAULT 'N1',
  specialties  JSON            NULL COMMENT 'array de ServiceCategory',
  is_active    TINYINT(1)      NOT NULL DEFAULT 1,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_support_agents_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 4) Tickets
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code                  VARCHAR(20)     NULL COMMENT 'KB-0001, se asigna tras el insert',

  client_id             BIGINT UNSIGNED NULL,
  project_id            BIGINT UNSIGNED NULL,
  system_id             BIGINT UNSIGNED NULL,
  meeting_id            BIGINT UNSIGNED NULL,

  origin                ENUM('EMAIL','WHATSAPP_TEXT','WHATSAPP_AUDIO','VOICE_LIVE',
                             'MEETING','NOTE','PORTAL') NOT NULL DEFAULT 'NOTE',
  request_type          ENUM('INCIDENCIA','BUG','MEJORA','FEATURE','AJUSTE') NULL,
  service_category      ENUM('SOFTWARE','SOPORTE','CAPACITACION','CONSULTA',
                             'ASESORIA','VISITA_SITIO','OTRO') NULL,

  subject               VARCHAR(240)    NULL,
  raw_text              TEXT            NOT NULL,
  raw_audio_filename    VARCHAR(255)    NULL,
  description_md        TEXT            NULL,
  acceptance_criteria   JSON            NULL,
  labels                JSON            NULL,
  module_name           VARCHAR(80)     NULL,
  screen_name           VARCHAR(120)    NULL,
  flow_context          VARCHAR(200)    NULL,

  impact                ENUM('ALTO','MEDIO','BAJO') NULL,
  urgency               ENUM('ALTA','MEDIA','BAJA') NULL,
  priority              ENUM('P1','P2','P3','P4') NOT NULL DEFAULT 'P3',
  priority_overridden   TINYINT(1)      NOT NULL DEFAULT 0,

  status                ENUM('NUEVO','TRIAJE','ASIGNADO','EN_ATENCION',
                             'ESPERA_CLIENTE','DERIVADO','RESUELTO','CERRADO')
                        NOT NULL DEFAULT 'NUEVO',

  assignee_user_id      BIGINT UNSIGNED NULL,
  escalation_level      ENUM('N1','N2','N3') NULL,

  sla_policy_id         BIGINT UNSIGNED NULL COMMENT 'snapshot al crear',
  sla_response_due_at   DATETIME        NULL,
  sla_resolution_due_at DATETIME        NULL,
  first_response_at     DATETIME        NULL,
  paused_at             DATETIME        NULL COMMENT 'no nulo mientras espera al cliente',
  paused_total_seconds  INT UNSIGNED    NOT NULL DEFAULT 0,
  sla_at_risk           TINYINT(1)      NOT NULL DEFAULT 0,

  captured_at           DATETIME        NOT NULL,
  attended_at           DATETIME        NULL,
  resolved_at           DATETIME        NULL,
  closed_at             DATETIME        NULL,

  resolution_md         TEXT            NULL,
  root_cause            TEXT            NULL,
  corrective_action     TEXT            NULL,

  scheduled_at          DATETIME        NULL,
  duration_minutes      INT UNSIGNED    NULL,

  jira_integration_id   BIGINT UNSIGNED NULL,
  jira_project_key      VARCHAR(20)     NULL,
  jira_issue_key        VARCHAR(30)     NULL,
  jira_issue_url        VARCHAR(500)    NULL,
  sent_at               DATETIME        NULL,
  closure_document_id   BIGINT UNSIGNED NULL,

  created_by            BIGINT UNSIGNED NOT NULL,
  created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_tickets_code (code),
  INDEX idx_tickets_client (client_id),
  INDEX idx_tickets_project (project_id),
  INDEX idx_tickets_system (system_id),
  INDEX idx_tickets_status (status),
  INDEX idx_tickets_priority (priority),
  INDEX idx_tickets_assignee (assignee_user_id),
  INDEX idx_tickets_created (created_at),
  INDEX idx_tickets_resolution_due (sla_resolution_due_at),
  INDEX idx_tickets_category (service_category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 5) Timeline — append-only
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id      BIGINT UNSIGNED NOT NULL,
  type           ENUM('CREATED','TRIAGED','ASSIGNED','TAKEN','STATUS_CHANGED',
                      'ESCALATED','COMMENT','RESOLVED','CLOSED','REOPENED',
                      'SLA_AT_RISK','PRIORITY_OVERRIDDEN') NOT NULL,
  from_status    ENUM('NUEVO','TRIAJE','ASIGNADO','EN_ATENCION',
                      'ESPERA_CLIENTE','DERIVADO','RESUELTO','CERRADO') NULL,
  to_status      ENUM('NUEVO','TRIAJE','ASIGNADO','EN_ATENCION',
                      'ESPERA_CLIENTE','DERIVADO','RESUELTO','CERRADO') NULL,
  actor_user_id  BIGINT UNSIGNED NULL COMMENT 'NULL cuando el actor es el sistema',
  reason         TEXT            NULL,
  payload        JSON            NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_ticket_events_ticket (ticket_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Ejecutar la migración contra desarrollo**

```bash
docker compose -f docker-compose.dev.yml exec -T mysql \
  mysql -u root -p"$MYSQL_ROOT_PASSWORD" < backend/sql/migrations/010_service_desk.sql
```

Si el entorno de MySQL es distinto, usar el mismo mecanismo que `backend/sql/run_009.sh`.
Expected: sin errores.

- [ ] **Step 3: Verificar el resultado**

```sql
USE kubo_devdocs;
SHOW TABLES LIKE '%ticket%';          -- tickets, ticket_events
SHOW TABLES LIKE 'sla_policies';
SHOW TABLES LIKE 'support_agents';
SHOW TABLES LIKE 'client_systems';
SELECT name, is_default, p1_response_minutes, p1_resolution_minutes FROM sla_policies;
SHOW COLUMNS FROM clients LIKE 'sla_policy_id';
```

Expected: las cinco tablas existen; `sla_policies` tiene una fila `Estándar` con `is_default = 1`, `15` y `240`; `clients.sla_policy_id` existe.

- [ ] **Step 4: Verificar que la migración es idempotente**

Volver a ejecutar el Step 2.
Expected: falla solo en el `ALTER TABLE clients` (`Duplicate column name 'sla_policy_id'`); las tablas y el `INSERT ... WHERE NOT EXISTS` no duplican nada. Confirmar con `SELECT COUNT(*) FROM sla_policies;` → 1.

- [ ] **Step 5: Commit**

```bash
git add backend/sql/migrations/010_service_desk.sql
git commit -m "feat(db): migracion 010 — tablas de mesa de servicio"
```

---

### Task 5: Entidades, repositorios y módulo

**Files:**
- Create: `backend/src/modules/tickets/entities/ticket.entity.ts`
- Create: `backend/src/modules/tickets/entities/ticket-event.entity.ts`
- Create: `backend/src/modules/tickets/entities/sla-policy.entity.ts`
- Create: `backend/src/modules/tickets/entities/support-agent.entity.ts`
- Create: `backend/src/modules/tickets/entities/client-system.entity.ts`
- Create: `backend/src/modules/tickets/tickets.repository.ts`
- Create: `backend/src/modules/tickets/ticket-events.repository.ts`
- Create: `backend/src/modules/tickets/sla-policies.repository.ts`
- Create: `backend/src/modules/tickets/support-agents.repository.ts`
- Create: `backend/src/modules/tickets/client-systems.repository.ts`
- Create: `backend/src/modules/tickets/tickets.module.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/modules/clients/entities/client.entity.ts`

**Interfaces:**
- Consumes: `TicketStatus` y `OPEN_STATUSES` de `domain/ticket-state-machine`; `TicketPriority`, `TicketImpact`, `TicketUrgency` de `domain/ticket-priority`; `SlaMatrix` de `domain/sla.calculator`.
- Produces:
  - `Ticket`, `TicketEvent`, `SlaPolicy`, `SupportAgent`, `ClientSystem` (entidades).
  - `TicketOrigin`, `TicketRequestType`, `ServiceCategory`, `SERVICE_CATEGORIES`, `TicketEventType`, `AgentLevel`.
  - `TicketsRepository` con `list(filters)`, `findById(id)`, `findByCode(code)`, `create(data)`, `update(id, data)`, `remove(id)`, `listByClientAndRange({clientId, from, to})`, `countOpenByAssignee()`, `listOpenForRiskScan()`.
  - `TicketEventsRepository.append(data)` y `.listByTicket(ticketId)`.
  - `SlaPoliciesRepository.findById(id)`, `.findDefault()`, `.list()`, `.update(id, data)`.
  - `SupportAgentsRepository` y `ClientSystemsRepository` con CRUD básico.

`listByClientAndRange` conserva deliberadamente la firma del repositorio viejo para que `reports.service.ts` pueda reapuntarse en la Tarea 14 sin reescribir su lógica.

- [ ] **Step 1: Crear la entidad `Ticket`**

`backend/src/modules/tickets/entities/ticket.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { TicketStatus, TICKET_STATUSES } from '../domain/ticket-state-machine';
import {
  TicketImpact,
  TicketUrgency,
  TicketPriority,
  TICKET_IMPACTS,
  TICKET_URGENCIES,
  TICKET_PRIORITIES,
} from '../domain/ticket-priority';

export type TicketOrigin =
  | 'EMAIL'
  | 'WHATSAPP_TEXT'
  | 'WHATSAPP_AUDIO'
  | 'VOICE_LIVE'
  | 'MEETING'
  | 'NOTE'
  | 'PORTAL';

export type TicketRequestType = 'INCIDENCIA' | 'BUG' | 'MEJORA' | 'FEATURE' | 'AJUSTE';

export type ServiceCategory =
  | 'SOFTWARE'
  | 'SOPORTE'
  | 'CAPACITACION'
  | 'CONSULTA'
  | 'ASESORIA'
  | 'VISITA_SITIO'
  | 'OTRO';

export type AgentLevel = 'N1' | 'N2' | 'N3';

export const TICKET_ORIGINS: TicketOrigin[] = [
  'EMAIL',
  'WHATSAPP_TEXT',
  'WHATSAPP_AUDIO',
  'VOICE_LIVE',
  'MEETING',
  'NOTE',
  'PORTAL',
];

export const TICKET_REQUEST_TYPES: TicketRequestType[] = [
  'INCIDENCIA',
  'BUG',
  'MEJORA',
  'FEATURE',
  'AJUSTE',
];

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  'SOFTWARE',
  'SOPORTE',
  'CAPACITACION',
  'CONSULTA',
  'ASESORIA',
  'VISITA_SITIO',
  'OTRO',
];

export const AGENT_LEVELS: AgentLevel[] = ['N1', 'N2', 'N3'];

@Entity('tickets')
@Index('idx_tickets_client', ['clientId'])
@Index('idx_tickets_status', ['status'])
@Index('idx_tickets_assignee', ['assigneeUserId'])
@Index('idx_tickets_resolution_due', ['slaResolutionDueAt'])
export class Ticket {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  code!: string | null;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true, nullable: true })
  clientId!: number | null;

  @Column({ name: 'project_id', type: 'bigint', unsigned: true, nullable: true })
  projectId!: number | null;

  @Column({ name: 'system_id', type: 'bigint', unsigned: true, nullable: true })
  systemId!: number | null;

  @Column({ name: 'meeting_id', type: 'bigint', unsigned: true, nullable: true })
  meetingId!: number | null;

  @Column({ type: 'enum', enum: TICKET_ORIGINS, default: 'NOTE' })
  origin!: TicketOrigin;

  @Column({ name: 'request_type', type: 'enum', enum: TICKET_REQUEST_TYPES, nullable: true })
  requestType!: TicketRequestType | null;

  @Column({ name: 'service_category', type: 'enum', enum: SERVICE_CATEGORIES, nullable: true })
  serviceCategory!: ServiceCategory | null;

  @Column({ type: 'varchar', length: 240, nullable: true })
  subject!: string | null;

  @Column({ name: 'raw_text', type: 'text' })
  rawText!: string;

  @Column({ name: 'raw_audio_filename', type: 'varchar', length: 255, nullable: true })
  rawAudioFilename!: string | null;

  @Column({ name: 'description_md', type: 'text', nullable: true })
  descriptionMd!: string | null;

  @Column({ name: 'acceptance_criteria', type: 'json', nullable: true })
  acceptanceCriteria!: string[] | null;

  @Column({ type: 'json', nullable: true })
  labels!: string[] | null;

  @Column({ name: 'module_name', type: 'varchar', length: 80, nullable: true })
  moduleName!: string | null;

  @Column({ name: 'screen_name', type: 'varchar', length: 120, nullable: true })
  screenName!: string | null;

  @Column({ name: 'flow_context', type: 'varchar', length: 200, nullable: true })
  flowContext!: string | null;

  @Column({ type: 'enum', enum: TICKET_IMPACTS, nullable: true })
  impact!: TicketImpact | null;

  @Column({ type: 'enum', enum: TICKET_URGENCIES, nullable: true })
  urgency!: TicketUrgency | null;

  @Column({ type: 'enum', enum: TICKET_PRIORITIES, default: 'P3' })
  priority!: TicketPriority;

  @Column({ name: 'priority_overridden', type: 'tinyint', default: 0 })
  priorityOverridden!: number;

  @Column({ type: 'enum', enum: TICKET_STATUSES, default: 'NUEVO' })
  status!: TicketStatus;

  @Column({ name: 'assignee_user_id', type: 'bigint', unsigned: true, nullable: true })
  assigneeUserId!: number | null;

  @Column({ name: 'escalation_level', type: 'enum', enum: AGENT_LEVELS, nullable: true })
  escalationLevel!: AgentLevel | null;

  @Column({ name: 'sla_policy_id', type: 'bigint', unsigned: true, nullable: true })
  slaPolicyId!: number | null;

  @Column({ name: 'sla_response_due_at', type: 'datetime', nullable: true })
  slaResponseDueAt!: Date | null;

  @Column({ name: 'sla_resolution_due_at', type: 'datetime', nullable: true })
  slaResolutionDueAt!: Date | null;

  @Column({ name: 'first_response_at', type: 'datetime', nullable: true })
  firstResponseAt!: Date | null;

  @Column({ name: 'paused_at', type: 'datetime', nullable: true })
  pausedAt!: Date | null;

  @Column({ name: 'paused_total_seconds', type: 'int', unsigned: true, default: 0 })
  pausedTotalSeconds!: number;

  @Column({ name: 'sla_at_risk', type: 'tinyint', default: 0 })
  slaAtRisk!: number;

  @Column({ name: 'captured_at', type: 'datetime' })
  capturedAt!: Date;

  @Column({ name: 'attended_at', type: 'datetime', nullable: true })
  attendedAt!: Date | null;

  @Column({ name: 'resolved_at', type: 'datetime', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'closed_at', type: 'datetime', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'resolution_md', type: 'text', nullable: true })
  resolutionMd!: string | null;

  @Column({ name: 'root_cause', type: 'text', nullable: true })
  rootCause!: string | null;

  @Column({ name: 'corrective_action', type: 'text', nullable: true })
  correctiveAction!: string | null;

  @Column({ name: 'scheduled_at', type: 'datetime', nullable: true })
  scheduledAt!: Date | null;

  @Column({ name: 'duration_minutes', type: 'int', unsigned: true, nullable: true })
  durationMinutes!: number | null;

  @Column({ name: 'jira_integration_id', type: 'bigint', unsigned: true, nullable: true })
  jiraIntegrationId!: number | null;

  @Column({ name: 'jira_project_key', type: 'varchar', length: 20, nullable: true })
  jiraProjectKey!: string | null;

  @Column({ name: 'jira_issue_key', type: 'varchar', length: 30, nullable: true })
  jiraIssueKey!: string | null;

  @Column({ name: 'jira_issue_url', type: 'varchar', length: 500, nullable: true })
  jiraIssueUrl!: string | null;

  @Column({ name: 'sent_at', type: 'datetime', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'closure_document_id', type: 'bigint', unsigned: true, nullable: true })
  closureDocumentId!: number | null;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true })
  createdBy!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

- [ ] **Step 2: Crear las entidades restantes**

`backend/src/modules/tickets/entities/ticket-event.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TicketStatus, TICKET_STATUSES } from '../domain/ticket-state-machine';

export type TicketEventType =
  | 'CREATED'
  | 'TRIAGED'
  | 'ASSIGNED'
  | 'TAKEN'
  | 'STATUS_CHANGED'
  | 'ESCALATED'
  | 'COMMENT'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED'
  | 'SLA_AT_RISK'
  | 'PRIORITY_OVERRIDDEN';

export const TICKET_EVENT_TYPES: TicketEventType[] = [
  'CREATED',
  'TRIAGED',
  'ASSIGNED',
  'TAKEN',
  'STATUS_CHANGED',
  'ESCALATED',
  'COMMENT',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
  'SLA_AT_RISK',
  'PRIORITY_OVERRIDDEN',
];

/** Append-only: nunca se actualiza ni se borra. Es la evidencia auditable. */
@Entity('ticket_events')
@Index('idx_ticket_events_ticket', ['ticketId', 'createdAt'])
export class TicketEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'ticket_id', type: 'bigint', unsigned: true })
  ticketId!: number;

  @Column({ type: 'enum', enum: TICKET_EVENT_TYPES })
  type!: TicketEventType;

  @Column({ name: 'from_status', type: 'enum', enum: TICKET_STATUSES, nullable: true })
  fromStatus!: TicketStatus | null;

  @Column({ name: 'to_status', type: 'enum', enum: TICKET_STATUSES, nullable: true })
  toStatus!: TicketStatus | null;

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

`backend/src/modules/tickets/entities/sla-policy.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { SlaMatrix } from '../domain/sla.calculator';

@Entity('sla_policies')
export class SlaPolicy {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ name: 'is_default', type: 'tinyint', default: 0 })
  isDefault!: number;

  @Column({ name: 'p1_response_minutes', type: 'int', unsigned: true })
  p1ResponseMinutes!: number;

  @Column({ name: 'p1_resolution_minutes', type: 'int', unsigned: true })
  p1ResolutionMinutes!: number;

  @Column({ name: 'p2_response_minutes', type: 'int', unsigned: true })
  p2ResponseMinutes!: number;

  @Column({ name: 'p2_resolution_minutes', type: 'int', unsigned: true })
  p2ResolutionMinutes!: number;

  @Column({ name: 'p3_response_minutes', type: 'int', unsigned: true })
  p3ResponseMinutes!: number;

  @Column({ name: 'p3_resolution_minutes', type: 'int', unsigned: true })
  p3ResolutionMinutes!: number;

  @Column({ name: 'p4_response_minutes', type: 'int', unsigned: true })
  p4ResponseMinutes!: number;

  @Column({ name: 'p4_resolution_minutes', type: 'int', unsigned: true })
  p4ResolutionMinutes!: number;

  /** Reservado para el horario de cobertura. En T1 no se lee. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  coverage!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

/** Convierte la fila de BD en la matriz que consume `sla.calculator`. */
export function toSlaMatrix(policy: SlaPolicy): SlaMatrix {
  return {
    P1: { responseMinutes: policy.p1ResponseMinutes, resolutionMinutes: policy.p1ResolutionMinutes },
    P2: { responseMinutes: policy.p2ResponseMinutes, resolutionMinutes: policy.p2ResolutionMinutes },
    P3: { responseMinutes: policy.p3ResponseMinutes, resolutionMinutes: policy.p3ResolutionMinutes },
    P4: { responseMinutes: policy.p4ResponseMinutes, resolutionMinutes: policy.p4ResolutionMinutes },
  };
}
```

`backend/src/modules/tickets/entities/support-agent.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { AgentLevel, AGENT_LEVELS, ServiceCategory } from './ticket.entity';

@Entity('support_agents')
export class SupportAgent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId!: number;

  @Column({ type: 'enum', enum: AGENT_LEVELS, default: 'N1' })
  level!: AgentLevel;

  @Column({ type: 'json', nullable: true })
  specialties!: ServiceCategory[] | null;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

`backend/src/modules/tickets/entities/client-system.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('client_systems')
@Index('idx_client_systems_client', ['clientId'])
export class ClientSystem {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true })
  clientId!: number;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

- [ ] **Step 3: Añadir `slaPolicyId` a la entidad `Client`**

En `backend/src/modules/clients/entities/client.entity.ts`, después de la columna `jiraCode`:

```ts
  @Column({ name: 'sla_policy_id', type: 'bigint', unsigned: true, nullable: true })
  slaPolicyId!: number | null;
```

- [ ] **Step 4: Crear `TicketsRepository`**

`backend/src/modules/tickets/tickets.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';

import { Ticket, ServiceCategory } from './entities/ticket.entity';
import { TicketStatus, OPEN_STATUSES } from './domain/ticket-state-machine';
import { TicketPriority } from './domain/ticket-priority';

export interface TicketListFilters {
  status?: TicketStatus;
  open?: boolean;
  clientId?: number;
  projectId?: number;
  systemId?: number;
  priority?: TicketPriority;
  assigneeUserId?: number;
  serviceCategory?: ServiceCategory;
  atRisk?: boolean;
  q?: string;
}

@Injectable()
export class TicketsRepository {
  constructor(@InjectRepository(Ticket) private readonly repo: Repository<Ticket>) {}

  async list(filters: TicketListFilters): Promise<Ticket[]> {
    const qb = this.repo.createQueryBuilder('t');

    if (filters.status) qb.andWhere('t.status = :status', { status: filters.status });
    if (filters.open) qb.andWhere('t.status IN (:...open)', { open: OPEN_STATUSES });
    if (filters.clientId) qb.andWhere('t.client_id = :clientId', { clientId: filters.clientId });
    if (filters.projectId) qb.andWhere('t.project_id = :projectId', { projectId: filters.projectId });
    if (filters.systemId) qb.andWhere('t.system_id = :systemId', { systemId: filters.systemId });
    if (filters.priority) qb.andWhere('t.priority = :priority', { priority: filters.priority });
    if (filters.assigneeUserId) {
      qb.andWhere('t.assignee_user_id = :assignee', { assignee: filters.assigneeUserId });
    }
    if (filters.serviceCategory) {
      qb.andWhere('t.service_category = :cat', { cat: filters.serviceCategory });
    }
    if (filters.atRisk) qb.andWhere('t.sla_at_risk = 1');
    if (filters.q) {
      qb.andWhere('(t.raw_text LIKE :q OR t.subject LIKE :q OR t.code LIKE :q)', {
        q: `%${filters.q}%`,
      });
    }

    qb.orderBy('t.created_at', 'DESC').limit(500);
    return qb.getMany();
  }

  findById(id: number): Promise<Ticket | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByCode(code: string): Promise<Ticket | null> {
    return this.repo.findOne({ where: { code } });
  }

  create(data: Partial<Ticket>): Promise<Ticket> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<Ticket>): Promise<Ticket | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }

  /**
   * Firma heredada del repositorio de client_requests: la consume
   * reports.service.ts para el informe mensual de atención.
   */
  listByClientAndRange(params: { clientId: number; from: Date; to: Date }): Promise<Ticket[]> {
    return this.repo
      .createQueryBuilder('t')
      .where('t.client_id = :c', { c: params.clientId })
      .andWhere('t.created_at >= :from', { from: params.from })
      .andWhere('t.created_at < :to', { to: params.to })
      .orderBy('t.service_category', 'ASC')
      .addOrderBy('t.created_at', 'DESC')
      .getMany();
  }

  /** Carga por técnico: cuántos tickets abiertos tiene asignados cada uno. */
  async countOpenByAssignee(): Promise<Map<number, number>> {
    const rows = await this.repo
      .createQueryBuilder('t')
      .select('t.assignee_user_id', 'userId')
      .addSelect('COUNT(*)', 'total')
      .where('t.status IN (:...open)', { open: OPEN_STATUSES })
      .andWhere('t.assignee_user_id IS NOT NULL')
      .groupBy('t.assignee_user_id')
      .getRawMany<{ userId: string; total: string }>();

    return new Map(rows.map((r) => [Number(r.userId), Number(r.total)]));
  }

  /** Candidatos del job de riesgo: abiertos, no pausados y con plazo definido. */
  listOpenForRiskScan(): Promise<Ticket[]> {
    return this.repo.find({
      where: {
        status: In(OPEN_STATUSES),
        pausedAt: IsNull(),
        slaAtRisk: 0,
      },
    });
  }
}
```

- [ ] **Step 5: Crear los repositorios restantes**

`backend/src/modules/tickets/ticket-events.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TicketEvent } from './entities/ticket-event.entity';

@Injectable()
export class TicketEventsRepository {
  constructor(@InjectRepository(TicketEvent) private readonly repo: Repository<TicketEvent>) {}

  append(data: Partial<TicketEvent>): Promise<TicketEvent> {
    return this.repo.save(this.repo.create(data));
  }

  listByTicket(ticketId: number): Promise<TicketEvent[]> {
    return this.repo.find({ where: { ticketId }, order: { createdAt: 'ASC', id: 'ASC' } });
  }
}
```

`backend/src/modules/tickets/sla-policies.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SlaPolicy } from './entities/sla-policy.entity';

@Injectable()
export class SlaPoliciesRepository {
  constructor(@InjectRepository(SlaPolicy) private readonly repo: Repository<SlaPolicy>) {}

  list(): Promise<SlaPolicy[]> {
    return this.repo.find({ order: { isDefault: 'DESC', name: 'ASC' } });
  }

  findById(id: number): Promise<SlaPolicy | null> {
    return this.repo.findOne({ where: { id } });
  }

  findDefault(): Promise<SlaPolicy | null> {
    return this.repo.findOne({ where: { isDefault: 1 } });
  }

  async update(id: number, data: Partial<SlaPolicy>): Promise<SlaPolicy | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }
}
```

`backend/src/modules/tickets/support-agents.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportAgent } from './entities/support-agent.entity';

@Injectable()
export class SupportAgentsRepository {
  constructor(@InjectRepository(SupportAgent) private readonly repo: Repository<SupportAgent>) {}

  list(): Promise<SupportAgent[]> {
    return this.repo.find({ order: { level: 'ASC', id: 'ASC' } });
  }

  listActive(): Promise<SupportAgent[]> {
    return this.repo.find({ where: { isActive: 1 } });
  }

  findById(id: number): Promise<SupportAgent | null> {
    return this.repo.findOne({ where: { id } });
  }

  findByUserId(userId: number): Promise<SupportAgent | null> {
    return this.repo.findOne({ where: { userId } });
  }

  create(data: Partial<SupportAgent>): Promise<SupportAgent> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<SupportAgent>): Promise<SupportAgent | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
```

`backend/src/modules/tickets/client-systems.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientSystem } from './entities/client-system.entity';

@Injectable()
export class ClientSystemsRepository {
  constructor(@InjectRepository(ClientSystem) private readonly repo: Repository<ClientSystem>) {}

  listByClient(clientId: number): Promise<ClientSystem[]> {
    return this.repo.find({ where: { clientId }, order: { name: 'ASC' } });
  }

  findById(id: number): Promise<ClientSystem | null> {
    return this.repo.findOne({ where: { id } });
  }

  create(data: Partial<ClientSystem>): Promise<ClientSystem> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<ClientSystem>): Promise<ClientSystem | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
```

- [ ] **Step 6: Crear el módulo**

`backend/src/modules/tickets/tickets.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Ticket } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';
import { SlaPolicy } from './entities/sla-policy.entity';
import { SupportAgent } from './entities/support-agent.entity';
import { ClientSystem } from './entities/client-system.entity';

import { TicketsRepository } from './tickets.repository';
import { TicketEventsRepository } from './ticket-events.repository';
import { SlaPoliciesRepository } from './sla-policies.repository';
import { SupportAgentsRepository } from './support-agents.repository';
import { ClientSystemsRepository } from './client-systems.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, TicketEvent, SlaPolicy, SupportAgent, ClientSystem]),
  ],
  providers: [
    TicketsRepository,
    TicketEventsRepository,
    SlaPoliciesRepository,
    SupportAgentsRepository,
    ClientSystemsRepository,
  ],
  exports: [
    TicketsRepository,
    TicketEventsRepository,
    SlaPoliciesRepository,
    SupportAgentsRepository,
    ClientSystemsRepository,
  ],
})
export class TicketsModule {}
```

- [ ] **Step 7: Registrar el módulo en `app.module.ts`**

Añadir el import junto a los demás módulos:

```ts
import { TicketsModule } from './modules/tickets/tickets.module';
```

Y añadir `TicketsModule,` al array `imports`, inmediatamente después de `ClientRequestsModule,`.

- [ ] **Step 8: Verificar que compila y arranca**

Run: `cd backend; npm run build`
Expected: sin errores de TypeScript.

Run: `cd backend; npm run start:dev`
Expected: Nest arranca sin errores de mapeo de entidades. `ClientRequestsModule` sigue presente y funcionando. Detener con Ctrl+C.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/tickets backend/src/app.module.ts backend/src/modules/clients/entities/client.entity.ts
git commit -m "feat(tickets): entidades, repositorios y modulo base"
```

---

### Task 6: Timeline de eventos

**Files:**
- Create: `backend/src/modules/tickets/ticket-events.service.ts`
- Modify: `backend/src/modules/tickets/tickets.module.ts`

**Interfaces:**
- Consumes: `TicketEventsRepository`, `TicketEvent`, `TicketEventType`, `TicketStatus`.
- Produces: `TicketEventsService` con:
  - `record(input: RecordEventInput): Promise<TicketEvent>`
  - `recordStatusChange(input): Promise<TicketEvent>`
  - `listByTicket(ticketId: number): Promise<TicketEvent[]>`
  - Interfaz `RecordEventInput { ticketId, type, actorUserId, fromStatus?, toStatus?, reason?, payload? }`

- [ ] **Step 1: Implementar el servicio**

`backend/src/modules/tickets/ticket-events.service.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { TicketEventsRepository } from './ticket-events.repository';
import { TicketEvent, TicketEventType } from './entities/ticket-event.entity';
import { TicketStatus } from './domain/ticket-state-machine';

export interface RecordEventInput {
  ticketId: number;
  type: TicketEventType;
  /** null cuando el actor es el sistema (por ejemplo, el job de riesgo). */
  actorUserId: number | null;
  fromStatus?: TicketStatus | null;
  toStatus?: TicketStatus | null;
  reason?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Escritura del timeline. Append-only: este servicio no expone actualización
 * ni borrado a propósito — el historial es la evidencia auditable del ticket.
 */
@Injectable()
export class TicketEventsService {
  constructor(private readonly repo: TicketEventsRepository) {}

  record(input: RecordEventInput): Promise<TicketEvent> {
    return this.repo.append({
      ticketId: input.ticketId,
      type: input.type,
      actorUserId: input.actorUserId,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      reason: input.reason?.trim() || null,
      payload: input.payload ?? null,
    });
  }

  /**
   * Registra un cambio de estado eligiendo el tipo de evento más específico
   * disponible, para que el timeline se lea sin tener que interpretar estados.
   */
  recordStatusChange(input: {
    ticketId: number;
    actorUserId: number | null;
    fromStatus: TicketStatus;
    toStatus: TicketStatus;
    reason?: string | null;
    payload?: Record<string, unknown> | null;
  }): Promise<TicketEvent> {
    return this.record({
      ...input,
      type: this.typeForTransition(input.fromStatus, input.toStatus),
    });
  }

  private typeForTransition(from: TicketStatus, to: TicketStatus): TicketEventType {
    if (to === 'DERIVADO') return 'ESCALATED';
    if (to === 'RESUELTO') return 'RESOLVED';
    if (to === 'CERRADO') return 'CLOSED';
    if (from === 'RESUELTO' && to === 'EN_ATENCION') return 'REOPENED';
    if (to === 'TRIAJE') return 'TRIAGED';
    if (to === 'EN_ATENCION' && from === 'ASIGNADO') return 'TAKEN';
    return 'STATUS_CHANGED';
  }

  listByTicket(ticketId: number): Promise<TicketEvent[]> {
    return this.repo.listByTicket(ticketId);
  }
}
```

- [ ] **Step 2: Registrar el servicio en el módulo**

En `tickets.module.ts`, importar `TicketEventsService` y añadirlo a `providers` y a `exports`.

- [ ] **Step 3: Verificar que compila**

Run: `cd backend; npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/tickets/ticket-events.service.ts backend/src/modules/tickets/tickets.module.ts
git commit -m "feat(tickets): servicio de timeline append-only"
```

---

### Task 7: `SlaService` con base de datos

**Files:**
- Create: `backend/src/modules/tickets/sla.service.ts`
- Test: `backend/src/modules/tickets/sla.service.spec.ts`
- Modify: `backend/src/modules/tickets/tickets.module.ts`
- Modify: `backend/src/modules/tickets/tickets.module.ts` (importar `ClientsModule`)

**Interfaces:**
- Consumes: `SlaPoliciesRepository`, `ClientsService.findByIdOrFail`, y de `domain/sla.calculator`: `computeDueDates`, `shiftForPause`, `consumedRatio`, `isAtRisk`, `DEFAULT_SLA_MATRIX`.
- Produces: `SlaService` con:
  - `resolveMatrixForClient(clientId: number | null): Promise<{ policyId: number | null; matrix: SlaMatrix }>`
  - `initForTicket(input: { clientId, createdAt, priority }): Promise<{ slaPolicyId, slaResponseDueAt, slaResolutionDueAt }>`
  - `applyPause(ticket: Ticket, resumedAt: Date): { pausedTotalSeconds, slaResponseDueAt, slaResolutionDueAt, pausedAt: null }`
  - `evaluateRisk(ticket: Ticket, now: Date): boolean`
  - `remainingLabel(ticket: Ticket, now: Date): string`

`resolveMatrixForClient` cae a `DEFAULT_SLA_MATRIX` si no hay ninguna política marcada por defecto en base de datos, de modo que un ticket nunca se queda sin reloj.

- [ ] **Step 1: Escribir el test que falla**

`backend/src/modules/tickets/sla.service.spec.ts`:

```ts
import { SlaService } from './sla.service';
import { DEFAULT_SLA_MATRIX } from './domain/sla.calculator';
import { SlaPolicy } from './entities/sla-policy.entity';
import { Ticket } from './entities/ticket.entity';

const policyRow = (over: Partial<SlaPolicy> = {}): SlaPolicy =>
  ({
    id: 1,
    name: 'Estándar',
    isDefault: 1,
    p1ResponseMinutes: 15,
    p1ResolutionMinutes: 240,
    p2ResponseMinutes: 30,
    p2ResolutionMinutes: 360,
    p3ResponseMinutes: 60,
    p3ResolutionMinutes: 720,
    p4ResponseMinutes: 240,
    p4ResolutionMinutes: 1440,
    coverage: null,
    ...over,
  }) as SlaPolicy;

const makeService = (opts: {
  defaultPolicy?: SlaPolicy | null;
  byId?: SlaPolicy | null;
  clientPolicyId?: number | null;
}) => {
  const policies = {
    findDefault: jest.fn().mockResolvedValue(opts.defaultPolicy ?? null),
    findById: jest.fn().mockResolvedValue(opts.byId ?? null),
  };
  const clients = {
    findByIdOrFail: jest.fn().mockResolvedValue({ id: 9, slaPolicyId: opts.clientPolicyId ?? null }),
  };
  return {
    service: new SlaService(policies as any, clients as any),
    policies,
    clients,
  };
};

describe('resolveMatrixForClient', () => {
  it('usa la politica del cliente cuando la tiene', async () => {
    const custom = policyRow({ id: 7, p1ResolutionMinutes: 120 });
    const { service, policies } = makeService({ byId: custom, clientPolicyId: 7 });

    const r = await service.resolveMatrixForClient(9);

    expect(policies.findById).toHaveBeenCalledWith(7);
    expect(r.policyId).toBe(7);
    expect(r.matrix.P1.resolutionMinutes).toBe(120);
  });

  it('cae a la politica por defecto si el cliente no tiene una', async () => {
    const { service } = makeService({ defaultPolicy: policyRow(), clientPolicyId: null });
    const r = await service.resolveMatrixForClient(9);
    expect(r.policyId).toBe(1);
    expect(r.matrix.P1.resolutionMinutes).toBe(240);
  });

  it('cae a la matriz embebida si no hay ninguna politica en BD', async () => {
    const { service } = makeService({ defaultPolicy: null, clientPolicyId: null });
    const r = await service.resolveMatrixForClient(null);
    expect(r.policyId).toBeNull();
    expect(r.matrix).toEqual(DEFAULT_SLA_MATRIX);
  });
});

describe('initForTicket', () => {
  it('calcula los vencimientos con la matriz resuelta', async () => {
    const { service } = makeService({ defaultPolicy: policyRow(), clientPolicyId: null });
    const createdAt = new Date('2026-07-31T08:00:00.000Z');

    const r = await service.initForTicket({ clientId: null, createdAt, priority: 'P1' });

    expect(r.slaPolicyId).toBe(1);
    expect(r.slaResponseDueAt!.toISOString()).toBe('2026-07-31T08:15:00.000Z');
    expect(r.slaResolutionDueAt!.toISOString()).toBe('2026-07-31T12:00:00.000Z');
  });
});

describe('applyPause', () => {
  it('acumula segundos y desplaza los vencimientos', () => {
    const { service } = makeService({});
    const ticket = {
      pausedAt: new Date('2026-07-31T09:00:00.000Z'),
      pausedTotalSeconds: 600,
      slaResponseDueAt: new Date('2026-07-31T08:15:00.000Z'),
      slaResolutionDueAt: new Date('2026-07-31T12:00:00.000Z'),
    } as Ticket;

    const r = service.applyPause(ticket, new Date('2026-07-31T09:30:00.000Z'));

    expect(r.pausedTotalSeconds).toBe(600 + 1800);
    expect(r.slaResolutionDueAt!.toISOString()).toBe('2026-07-31T12:30:00.000Z');
    expect(r.pausedAt).toBeNull();
  });

  it('es inocuo si el ticket no estaba pausado', () => {
    const { service } = makeService({});
    const ticket = {
      pausedAt: null,
      pausedTotalSeconds: 0,
      slaResponseDueAt: new Date('2026-07-31T08:15:00.000Z'),
      slaResolutionDueAt: new Date('2026-07-31T12:00:00.000Z'),
    } as Ticket;

    const r = service.applyPause(ticket, new Date('2026-07-31T09:30:00.000Z'));

    expect(r.pausedTotalSeconds).toBe(0);
    expect(r.slaResolutionDueAt!.toISOString()).toBe('2026-07-31T12:00:00.000Z');
  });
});

describe('evaluateRisk', () => {
  it('es falso sin plazo de resolucion', () => {
    const { service } = makeService({});
    const ticket = { slaResolutionDueAt: null } as Ticket;
    expect(service.evaluateRisk(ticket, new Date())).toBe(false);
  });

  it('marca riesgo al 70% del plazo', () => {
    const { service } = makeService({});
    const ticket = {
      createdAt: new Date('2026-07-31T08:00:00.000Z'),
      slaResolutionDueAt: new Date('2026-07-31T12:00:00.000Z'), // 240 min
      pausedTotalSeconds: 0,
      pausedAt: null,
    } as Ticket;

    expect(service.evaluateRisk(ticket, new Date('2026-07-31T10:47:00.000Z'))).toBe(false);
    expect(service.evaluateRisk(ticket, new Date('2026-07-31T10:48:00.000Z'))).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd backend; npm test -- sla.service`
Expected: FAIL — `Cannot find module './sla.service'`.

- [ ] **Step 3: Implementar**

`backend/src/modules/tickets/sla.service.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { SlaPoliciesRepository } from './sla-policies.repository';
import { ClientsService } from '../clients/clients.service';
import { SlaPolicy, toSlaMatrix } from './entities/sla-policy.entity';
import { Ticket } from './entities/ticket.entity';
import { TicketPriority } from './domain/ticket-priority';
import {
  SlaMatrix,
  DEFAULT_SLA_MATRIX,
  computeDueDates,
  shiftForPause,
  consumedRatio,
  isAtRisk,
} from './domain/sla.calculator';

@Injectable()
export class SlaService {
  constructor(
    private readonly policies: SlaPoliciesRepository,
    private readonly clients: ClientsService,
  ) {}

  /**
   * Política aplicable: la del cliente, si no la marcada por defecto, y si no
   * hay ninguna en base de datos, la matriz embebida. Un ticket nunca se queda
   * sin reloj de SLA.
   */
  async resolveMatrixForClient(
    clientId: number | null,
  ): Promise<{ policyId: number | null; matrix: SlaMatrix }> {
    let policy: SlaPolicy | null = null;

    if (clientId) {
      const client = await this.clients.findByIdOrFail(clientId);
      if (client.slaPolicyId) {
        policy = await this.policies.findById(client.slaPolicyId);
      }
    }
    if (!policy) policy = await this.policies.findDefault();
    if (!policy) return { policyId: null, matrix: DEFAULT_SLA_MATRIX };

    return { policyId: policy.id, matrix: toSlaMatrix(policy) };
  }

  /** Snapshot de política y vencimientos absolutos al crear el ticket. */
  async initForTicket(input: {
    clientId: number | null;
    createdAt: Date;
    priority: TicketPriority;
  }): Promise<{
    slaPolicyId: number | null;
    slaResponseDueAt: Date | null;
    slaResolutionDueAt: Date | null;
  }> {
    const { policyId, matrix } = await this.resolveMatrixForClient(input.clientId);
    const due = computeDueDates(input.createdAt, input.priority, matrix);
    return {
      slaPolicyId: policyId,
      slaResponseDueAt: due.responseDueAt,
      slaResolutionDueAt: due.resolutionDueAt,
    };
  }

  /**
   * Al salir de ESPERA_CLIENTE. Devuelve el parche a aplicar sobre el ticket.
   * Si no estaba pausado, devuelve los valores sin tocar.
   */
  applyPause(
    ticket: Ticket,
    resumedAt: Date,
  ): {
    pausedTotalSeconds: number;
    slaResponseDueAt: Date | null;
    slaResolutionDueAt: Date | null;
    pausedAt: null;
  } {
    if (!ticket.pausedAt) {
      return {
        pausedTotalSeconds: ticket.pausedTotalSeconds,
        slaResponseDueAt: ticket.slaResponseDueAt,
        slaResolutionDueAt: ticket.slaResolutionDueAt,
        pausedAt: null,
      };
    }

    const shifted = shiftForPause({
      pausedAt: ticket.pausedAt,
      resumedAt,
      responseDueAt: ticket.slaResponseDueAt,
      resolutionDueAt: ticket.slaResolutionDueAt,
    });

    return {
      pausedTotalSeconds: ticket.pausedTotalSeconds + shifted.pausedSeconds,
      slaResponseDueAt: shifted.responseDueAt,
      slaResolutionDueAt: shifted.resolutionDueAt,
      pausedAt: null,
    };
  }

  evaluateRisk(ticket: Ticket, now: Date): boolean {
    if (!ticket.slaResolutionDueAt) return false;
    return isAtRisk({
      now,
      createdAt: ticket.createdAt,
      resolutionDueAt: ticket.slaResolutionDueAt,
      pausedTotalSeconds: ticket.pausedTotalSeconds,
      pausedAt: ticket.pausedAt,
    });
  }

  consumed(ticket: Ticket, now: Date): number | null {
    if (!ticket.slaResolutionDueAt) return null;
    return consumedRatio({
      now,
      createdAt: ticket.createdAt,
      resolutionDueAt: ticket.slaResolutionDueAt,
      pausedTotalSeconds: ticket.pausedTotalSeconds,
      pausedAt: ticket.pausedAt,
    });
  }

  /** Etiqueta legible del reloj para la bandeja y el detalle: «1h 22m», «vencido». */
  remainingLabel(ticket: Ticket, now: Date): string {
    if (!ticket.slaResolutionDueAt) return 'sin SLA';
    if (ticket.pausedAt) return 'en pausa';
    if (ticket.status === 'RESUELTO' || ticket.status === 'CERRADO') return 'cumplido';

    const ms = ticket.slaResolutionDueAt.getTime() - now.getTime();
    if (ms <= 0) return 'vencido';

    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }
}
```

- [ ] **Step 4: Registrar en el módulo**

En `tickets.module.ts`: importar `ClientsModule` de `'../clients/clients.module'`, añadirlo a `imports`, e importar `SlaService` añadiéndolo a `providers` y `exports`.

- [ ] **Step 5: Ejecutar el test y verificar que pasa**

Run: `cd backend; npm test -- sla.service`
Expected: PASS.

- [ ] **Step 6: Verificar que compila**

Run: `cd backend; npm run build`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/tickets/sla.service.ts backend/src/modules/tickets/sla.service.spec.ts backend/src/modules/tickets/tickets.module.ts
git commit -m "feat(tickets): SlaService con resolucion de politica por cliente"
```

---

### Task 8: `TicketsService` — CRUD y generación de `code`

**Files:**
- Create: `backend/src/modules/tickets/tickets.service.ts`
- Create: `backend/src/modules/tickets/dto/create-ticket.dto.ts`
- Create: `backend/src/modules/tickets/dto/update-ticket.dto.ts`
- Create: `backend/src/modules/tickets/tickets.controller.ts`
- Modify: `backend/src/modules/tickets/tickets.module.ts`

**Interfaces:**
- Consumes: `TicketsRepository`, `TicketEventsService`, `SlaService`, `ClientsService`, `ProjectsService`, `derivePriority`.
- Produces: `TicketsService` con `list(filters)`, `findByIdOrFail(id)`, `findWithTimeline(id)`, `create(userId, dto)`, `update(id, dto)`, `remove(id)`, `decorate(ticket, now)`. `CreateTicketDto`, `UpdateTicketDto`. `TicketsController` en la ruta `/tickets`.

`decorate` añade al ticket los campos derivados que consume la UI —`slaLabel`, `slaPct`, `slaOverdue`— para que la bandeja no tenga que recalcular el reloj en el navegador.

- [ ] **Step 1: Crear los DTO**

`backend/src/modules/tickets/dto/create-ticket.dto.ts`:

```ts
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  TICKET_ORIGINS,
  TICKET_REQUEST_TYPES,
  SERVICE_CATEGORIES,
  TicketOrigin,
  TicketRequestType,
  ServiceCategory,
} from '../entities/ticket.entity';
import { TICKET_IMPACTS, TICKET_URGENCIES, TicketImpact, TicketUrgency } from '../domain/ticket-priority';

export class CreateTicketDto {
  @IsString()
  @MinLength(1)
  rawText!: string;

  @IsOptional() @IsString() @MaxLength(240)
  subject?: string;

  @IsOptional() @IsIn(TICKET_ORIGINS)
  origin?: TicketOrigin;

  @IsOptional() @IsIn(TICKET_REQUEST_TYPES)
  requestType?: TicketRequestType;

  @IsOptional() @IsIn(SERVICE_CATEGORIES)
  serviceCategory?: ServiceCategory;

  @IsOptional() @IsIn(TICKET_IMPACTS)
  impact?: TicketImpact;

  @IsOptional() @IsIn(TICKET_URGENCIES)
  urgency?: TicketUrgency;

  @IsOptional() @IsInt() @Min(1) clientId?: number;
  @IsOptional() @IsInt() @Min(1) projectId?: number;
  @IsOptional() @IsInt() @Min(1) systemId?: number;
  @IsOptional() @IsInt() @Min(1) meetingId?: number;

  @IsOptional() @IsDateString() capturedAt?: string;
  @IsOptional() @IsDateString() scheduledAt?: string;
  @IsOptional() @IsInt() @Min(0) durationMinutes?: number;

  @IsOptional() @IsString() @MaxLength(255) rawAudioFilename?: string;
  @IsOptional() @IsArray() labels?: string[];
}
```

`backend/src/modules/tickets/dto/update-ticket.dto.ts`:

```ts
import { PartialType } from '@nestjs/mapped-types';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { CreateTicketDto } from './create-ticket.dto';

/**
 * Update NO admite `status`, `priority` ni `assigneeUserId`: esos cambios pasan
 * obligatoriamente por los endpoints de transición, para que ninguno escape al
 * timeline ni a las reglas de la máquina de estados.
 */
export class UpdateTicketDto extends PartialType(CreateTicketDto) {
  @IsOptional() @IsString() descriptionMd?: string;
  @IsOptional() @IsArray() acceptanceCriteria?: string[];
  @IsOptional() @IsString() moduleName?: string;
  @IsOptional() @IsString() screenName?: string;
  @IsOptional() @IsString() flowContext?: string;
}
```

- [ ] **Step 2: Implementar el servicio**

`backend/src/modules/tickets/tickets.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { TicketsRepository, TicketListFilters } from './tickets.repository';
import { TicketEventsService } from './ticket-events.service';
import { SlaService } from './sla.service';
import { ClientsService } from '../clients/clients.service';
import { ProjectsService } from '../projects/projects.service';

import { Ticket } from './entities/ticket.entity';
import { TicketEvent } from './entities/ticket-event.entity';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { derivePriority } from './domain/ticket-priority';
import { OPEN_STATUSES } from './domain/ticket-state-machine';

export interface DecoratedTicket extends Ticket {
  slaLabel: string;
  slaPct: number | null;
  slaOverdue: boolean;
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly repo: TicketsRepository,
    private readonly events: TicketEventsService,
    private readonly sla: SlaService,
    private readonly clients: ClientsService,
    private readonly projects: ProjectsService,
  ) {}

  async findByIdOrFail(id: number): Promise<Ticket> {
    const t = await this.repo.findById(id);
    if (!t) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ticket no encontrado' });
    }
    return t;
  }

  async list(filters: TicketListFilters): Promise<DecoratedTicket[]> {
    const now = new Date();
    const rows = await this.repo.list(filters);
    return rows.map((t) => this.decorate(t, now));
  }

  async findWithTimeline(id: number): Promise<{ ticket: DecoratedTicket; timeline: TicketEvent[] }> {
    const ticket = await this.findByIdOrFail(id);
    const timeline = await this.events.listByTicket(id);
    return { ticket: this.decorate(ticket, new Date()), timeline };
  }

  /**
   * Campos derivados del reloj de SLA. Se calculan en el servidor para que la
   * bandeja y el detalle muestren lo mismo sin duplicar la lógica en el cliente.
   */
  decorate(ticket: Ticket, now: Date): DecoratedTicket {
    const consumed = this.sla.consumed(ticket, now);
    return Object.assign({}, ticket, {
      slaLabel: this.sla.remainingLabel(ticket, now),
      slaPct: consumed === null ? null : Math.min(100, Math.round(consumed * 100)),
      slaOverdue:
        consumed !== null && consumed >= 1 && OPEN_STATUSES.includes(ticket.status),
    }) as DecoratedTicket;
  }

  async create(userId: number, dto: CreateTicketDto): Promise<Ticket> {
    if (dto.clientId) await this.clients.findByIdOrFail(dto.clientId);
    if (dto.projectId) await this.projects.findById(dto.projectId);

    const createdAt = new Date();
    const priority = derivePriority(dto.impact ?? null, dto.urgency ?? null);
    const slaInit = await this.sla.initForTicket({
      clientId: dto.clientId ?? null,
      createdAt,
      priority,
    });

    const ticket = await this.repo.create({
      clientId: dto.clientId ?? null,
      projectId: dto.projectId ?? null,
      systemId: dto.systemId ?? null,
      meetingId: dto.meetingId ?? null,
      origin: dto.origin ?? 'NOTE',
      requestType: dto.requestType ?? null,
      serviceCategory: dto.serviceCategory ?? null,
      subject: dto.subject?.trim() || null,
      rawText: dto.rawText.trim(),
      rawAudioFilename: dto.rawAudioFilename ?? null,
      labels: dto.labels ?? null,
      impact: dto.impact ?? null,
      urgency: dto.urgency ?? null,
      priority,
      status: 'NUEVO',
      capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : createdAt,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      durationMinutes: dto.durationMinutes ?? null,
      slaPolicyId: slaInit.slaPolicyId,
      slaResponseDueAt: slaInit.slaResponseDueAt,
      slaResolutionDueAt: slaInit.slaResolutionDueAt,
      createdBy: userId,
    });

    // El código legible depende del id autoincremental, así que se asigna después.
    const withCode = await this.repo.update(ticket.id, { code: this.buildCode(ticket.id) });

    await this.events.record({
      ticketId: ticket.id,
      type: 'CREATED',
      actorUserId: userId,
      toStatus: 'NUEVO',
      payload: { origin: ticket.origin, priority: ticket.priority },
    });

    return withCode!;
  }

  private buildCode(id: number): string {
    return `KB-${String(id).padStart(4, '0')}`;
  }

  async update(id: number, dto: UpdateTicketDto): Promise<Ticket> {
    const current = await this.findByIdOrFail(id);
    if (current.status === 'CERRADO') {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'Un ticket cerrado no admite modificaciones.',
      });
    }

    const patch: Partial<Ticket> = { ...dto } as Partial<Ticket>;
    if (dto.capturedAt) patch.capturedAt = new Date(dto.capturedAt);
    if (dto.scheduledAt) patch.scheduledAt = new Date(dto.scheduledAt);

    // Cambiar impacto o urgencia recalcula la prioridad, salvo override manual.
    const touchesMatrix = dto.impact !== undefined || dto.urgency !== undefined;
    if (touchesMatrix && current.priorityOverridden === 0) {
      patch.priority = derivePriority(
        (dto.impact ?? current.impact) ?? null,
        (dto.urgency ?? current.urgency) ?? null,
      );
    }

    const updated = await this.repo.update(id, patch);
    return updated!;
  }

  async remove(id: number): Promise<void> {
    const t = await this.findByIdOrFail(id);
    if (t.status !== 'NUEVO' && t.status !== 'TRIAJE') {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'Solo se puede borrar un ticket que aún no fue asignado. Ciérralo en su lugar.',
      });
    }
    await this.repo.remove(id);
  }
}
```

- [ ] **Step 3: Implementar el controlador**

`backend/src/modules/tickets/tickets.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { ServiceCategory } from './entities/ticket.entity';
import { TicketStatus } from './domain/ticket-state-machine';
import { TicketPriority } from './domain/ticket-priority';

@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly service: TicketsService) {}

  @Get()
  list(
    @Query('status') status?: TicketStatus,
    @Query('open') open?: string,
    @Query('clientId') clientId?: string,
    @Query('projectId') projectId?: string,
    @Query('systemId') systemId?: string,
    @Query('priority') priority?: TicketPriority,
    @Query('assigneeId') assigneeId?: string,
    @Query('serviceCategory') serviceCategory?: ServiceCategory,
    @Query('atRisk') atRisk?: string,
    @Query('q') q?: string,
  ) {
    return this.service.list({
      status,
      open: open === 'true',
      clientId: clientId ? Number(clientId) : undefined,
      projectId: projectId ? Number(projectId) : undefined,
      systemId: systemId ? Number(systemId) : undefined,
      priority,
      assigneeUserId: assigneeId ? Number(assigneeId) : undefined,
      serviceCategory,
      atRisk: atRisk === 'true',
      q,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findWithTimeline(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTicketDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }
}
```

- [ ] **Step 4: Registrar en el módulo**

En `tickets.module.ts`: importar `ProjectsModule` de `'../projects/projects.module'` y añadirlo a `imports`; añadir `TicketsService` a `providers` y `exports`; añadir `TicketsController` al array `controllers` (crearlo si el módulo aún no lo tiene).

- [ ] **Step 5: Verificar que compila y arranca**

Run: `cd backend; npm run build`
Expected: sin errores.

- [ ] **Step 6: Probar el ciclo de creación a mano**

Levantar el backend (`npm run start:dev`) y, con un JWT válido:

```bash
curl -s -X POST http://localhost:3000/tickets \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"rawText":"El ERP no emite comprobantes desde las 08:05","subject":"Caida de facturacion","impact":"ALTO","urgency":"ALTA"}'
```

Expected: HTTP 201 con `code: "KB-0001"` (o el correlativo que toque), `priority: "P1"`, `status: "NUEVO"`, `slaResponseDueAt` 15 minutos después de la creación y `slaResolutionDueAt` 4 horas después.

```bash
curl -s http://localhost:3000/tickets/1 -H "Authorization: Bearer $TOKEN"
```

Expected: objeto `{ ticket, timeline }` con un único evento `CREATED`, y `slaLabel` con el tiempo restante.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/tickets
git commit -m "feat(tickets): CRUD, codigo legible e inicializacion de SLA"
```

---

### Task 9: Transiciones y reglas de cierre

**Files:**
- Create: `backend/src/modules/tickets/ticket-transitions.service.ts`
- Create: `backend/src/modules/tickets/dto/transition-ticket.dto.ts`
- Test: `backend/src/modules/tickets/ticket-transitions.service.spec.ts`
- Modify: `backend/src/modules/tickets/tickets.controller.ts`
- Modify: `backend/src/modules/tickets/tickets.module.ts`

**Interfaces:**
- Consumes: `TicketsRepository`, `TicketEventsService`, `SlaService`, `TicketsService.findByIdOrFail`, y de `domain/ticket-state-machine`: `assertTransition`, `requiresReason`, `isReopen`.
- Produces: `TicketTransitionsService.transition(input: TransitionInput): Promise<Ticket>` donde
  `TransitionInput = { ticketId, actorUserId, toStatus, reason?, resolutionMd?, rootCause?, correctiveAction? }`.
  `TransitionTicketDto`.

Concentra las cinco reglas del prototipo. Es el punto por el que pasa **todo** cambio de estado: `update` no puede tocar `status`.

- [ ] **Step 1: Crear el DTO**

`backend/src/modules/tickets/dto/transition-ticket.dto.ts`:

```ts
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TICKET_STATUSES, TicketStatus } from '../domain/ticket-state-machine';

export class TransitionTicketDto {
  @IsIn(TICKET_STATUSES)
  toStatus!: TicketStatus;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;

  @IsOptional() @IsString() @MinLength(1)
  resolutionMd?: string;

  @IsOptional() @IsString() @MinLength(1)
  rootCause?: string;

  @IsOptional() @IsString() @MinLength(1)
  correctiveAction?: string;
}
```

- [ ] **Step 2: Escribir el test que falla**

`backend/src/modules/tickets/ticket-transitions.service.spec.ts`:

```ts
import { TicketTransitionsService } from './ticket-transitions.service';
import { Ticket } from './entities/ticket.entity';
import { TicketStatus } from './domain/ticket-state-machine';

const ticketRow = (over: Partial<Ticket> = {}): Ticket =>
  ({
    id: 1,
    status: 'EN_ATENCION' as TicketStatus,
    createdAt: new Date('2026-07-31T08:00:00.000Z'),
    pausedAt: null,
    pausedTotalSeconds: 0,
    slaResponseDueAt: new Date('2026-07-31T08:15:00.000Z'),
    slaResolutionDueAt: new Date('2026-07-31T12:00:00.000Z'),
    firstResponseAt: null,
    ...over,
  }) as Ticket;

const makeService = (current: Ticket) => {
  const repo = {
    findById: jest.fn().mockResolvedValue(current),
    update: jest.fn().mockImplementation((_id, patch) => Promise.resolve({ ...current, ...patch })),
  };
  const events = { record: jest.fn().mockResolvedValue({}), recordStatusChange: jest.fn().mockResolvedValue({}) };
  const sla = {
    applyPause: jest.fn().mockReturnValue({
      pausedTotalSeconds: 1800,
      slaResponseDueAt: new Date('2026-07-31T08:45:00.000Z'),
      slaResolutionDueAt: new Date('2026-07-31T12:30:00.000Z'),
      pausedAt: null,
    }),
  };
  return {
    service: new TicketTransitionsService(repo as any, events as any, sla as any),
    repo,
    events,
    sla,
  };
};

describe('transition', () => {
  it('rechaza una transicion invalida', async () => {
    const { service } = makeService(ticketRow({ status: 'NUEVO' }));
    await expect(
      service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'RESUELTO' }),
    ).rejects.toThrow();
  });

  it('exige motivo al derivar', async () => {
    const { service } = makeService(ticketRow());
    await expect(
      service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'DERIVADO' }),
    ).rejects.toThrow();
  });

  it('acepta derivar con motivo y registra el evento', async () => {
    const { service, events } = makeService(ticketRow());
    await service.transition({
      ticketId: 1,
      actorUserId: 5,
      toStatus: 'DERIVADO',
      reason: 'Saturacion del pool de conexiones',
    });
    expect(events.recordStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'DERIVADO', reason: 'Saturacion del pool de conexiones' }),
    );
  });

  it('rechaza RESUELTO sin solucion, causa raiz o accion correctiva', async () => {
    const { service } = makeService(ticketRow());
    await expect(
      service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'RESUELTO' }),
    ).rejects.toThrow();
    await expect(
      service.transition({
        ticketId: 1,
        actorUserId: 5,
        toStatus: 'RESUELTO',
        resolutionMd: 'Se amplio el pool',
        rootCause: 'Configuracion insuficiente',
      }),
    ).rejects.toThrow();
  });

  it('acepta RESUELTO con la evidencia completa y sella resolved_at', async () => {
    const { service, repo } = makeService(ticketRow());
    await service.transition({
      ticketId: 1,
      actorUserId: 5,
      toStatus: 'RESUELTO',
      resolutionMd: 'Se amplio el pool a 120',
      rootCause: 'Configuracion insuficiente para el crecimiento',
      correctiveAction: 'CHG-061: alerta al 70% de saturacion',
    });
    const patch = repo.update.mock.calls[0][1];
    expect(patch.status).toBe('RESUELTO');
    expect(patch.resolvedAt).toBeInstanceOf(Date);
  });

  it('al entrar en ESPERA_CLIENTE marca paused_at', async () => {
    const { service, repo } = makeService(ticketRow());
    await service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'ESPERA_CLIENTE' });
    expect(repo.update.mock.calls[0][1].pausedAt).toBeInstanceOf(Date);
  });

  it('al salir de ESPERA_CLIENTE desplaza los vencimientos', async () => {
    const { service, repo, sla } = makeService(
      ticketRow({ status: 'ESPERA_CLIENTE', pausedAt: new Date('2026-07-31T09:00:00.000Z') }),
    );
    await service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'EN_ATENCION' });
    expect(sla.applyPause).toHaveBeenCalled();
    const patch = repo.update.mock.calls[0][1];
    expect(patch.pausedAt).toBeNull();
    expect(patch.pausedTotalSeconds).toBe(1800);
  });

  it('la primera entrada en EN_ATENCION fija first_response_at', async () => {
    const { service, repo } = makeService(ticketRow({ status: 'ASIGNADO', firstResponseAt: null }));
    await service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'EN_ATENCION' });
    expect(repo.update.mock.calls[0][1].firstResponseAt).toBeInstanceOf(Date);
  });

  it('no reescribe first_response_at si ya existe', async () => {
    const previo = new Date('2026-07-31T08:03:00.000Z');
    const { service, repo } = makeService(
      ticketRow({ status: 'ESPERA_CLIENTE', pausedAt: new Date(), firstResponseAt: previo }),
    );
    await service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'EN_ATENCION' });
    expect(repo.update.mock.calls[0][1].firstResponseAt).toBeUndefined();
  });

  it('cerrar desde RESUELTO no exige motivo y sella closed_at', async () => {
    const { service, repo } = makeService(ticketRow({ status: 'RESUELTO' }));
    await service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'CERRADO' });
    expect(repo.update.mock.calls[0][1].closedAt).toBeInstanceOf(Date);
  });

  it('cancelar desde un estado abierto exige motivo', async () => {
    const { service } = makeService(ticketRow());
    await expect(
      service.transition({ ticketId: 1, actorUserId: 5, toStatus: 'CERRADO' }),
    ).rejects.toThrow();
  });

  it('reabrir limpia resolved_at y conserva la solucion', async () => {
    const { service, repo } = makeService(
      ticketRow({ status: 'RESUELTO', resolvedAt: new Date(), resolutionMd: 'texto previo' } as Partial<Ticket>),
    );
    await service.transition({
      ticketId: 1,
      actorUserId: 5,
      toStatus: 'EN_ATENCION',
      reason: 'El cliente reporta que persiste',
    });
    const patch = repo.update.mock.calls[0][1];
    expect(patch.resolvedAt).toBeNull();
    expect(patch.resolutionMd).toBeUndefined();
  });
});
```

- [ ] **Step 3: Ejecutar el test y verificar que falla**

Run: `cd backend; npm test -- ticket-transitions`
Expected: FAIL — `Cannot find module './ticket-transitions.service'`.

- [ ] **Step 4: Implementar**

`backend/src/modules/tickets/ticket-transitions.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { TicketsRepository } from './tickets.repository';
import { TicketEventsService } from './ticket-events.service';
import { SlaService } from './sla.service';
import { Ticket } from './entities/ticket.entity';
import {
  TicketStatus,
  assertTransition,
  requiresReason,
  isReopen,
} from './domain/ticket-state-machine';

export interface TransitionInput {
  ticketId: number;
  actorUserId: number;
  toStatus: TicketStatus;
  reason?: string;
  resolutionMd?: string;
  rootCause?: string;
  correctiveAction?: string;
}

/**
 * Único camino por el que un ticket cambia de estado. Concentra las reglas
 * de negocio del prototipo (§4 de la spec) y garantiza que toda transición
 * quede escrita en el timeline.
 */
@Injectable()
export class TicketTransitionsService {
  constructor(
    private readonly repo: TicketsRepository,
    private readonly events: TicketEventsService,
    private readonly sla: SlaService,
  ) {}

  async transition(input: TransitionInput): Promise<Ticket> {
    const current = await this.repo.findById(input.ticketId);
    if (!current) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ticket no encontrado' });
    }

    const from = current.status;
    const to = input.toStatus;

    assertTransition(from, to);

    const reason = input.reason?.trim() || null;
    if (requiresReason(from, to) && !reason) {
      throw new BadRequestException({
        code: 'BAD_INPUT',
        message: 'Esta transición exige indicar un motivo.',
      });
    }

    const now = new Date();
    const patch: Partial<Ticket> = { status: to };

    // Regla 05 — no se resuelve sin evidencia.
    if (to === 'RESUELTO') {
      const resolutionMd = input.resolutionMd?.trim() || current.resolutionMd;
      const rootCause = input.rootCause?.trim() || current.rootCause;
      const correctiveAction = input.correctiveAction?.trim() || current.correctiveAction;

      if (!resolutionMd || !rootCause || !correctiveAction) {
        throw new BadRequestException({
          code: 'BAD_INPUT',
          message:
            'Para resolver hay que registrar solución aplicada, causa raíz y acción correctiva.',
        });
      }
      patch.resolutionMd = resolutionMd;
      patch.rootCause = rootCause;
      patch.correctiveAction = correctiveAction;
      patch.resolvedAt = now;
      if (!current.attendedAt) patch.attendedAt = now;
    }

    if (to === 'CERRADO') patch.closedAt = now;

    // Reapertura: se limpia la marca de resolución pero se conserva el texto,
    // para que el técnico lo corrija en vez de reescribirlo desde cero.
    if (isReopen(from, to)) patch.resolvedAt = null;

    // El reloj solo se detiene en ESPERA_CLIENTE.
    if (to === 'ESPERA_CLIENTE') {
      patch.pausedAt = now;
    } else if (from === 'ESPERA_CLIENTE') {
      const resumed = this.sla.applyPause(current, now);
      patch.pausedAt = resumed.pausedAt;
      patch.pausedTotalSeconds = resumed.pausedTotalSeconds;
      patch.slaResponseDueAt = resumed.slaResponseDueAt;
      patch.slaResolutionDueAt = resumed.slaResolutionDueAt;
    }

    // Regla 02 — la primera entrada en atención es la primera respuesta.
    if (to === 'EN_ATENCION' && !current.firstResponseAt) {
      patch.firstResponseAt = now;
    }

    const updated = await this.repo.update(input.ticketId, patch);

    await this.events.recordStatusChange({
      ticketId: input.ticketId,
      actorUserId: input.actorUserId,
      fromStatus: from,
      toStatus: to,
      reason,
    });

    return updated!;
  }
}
```

- [ ] **Step 5: Ejecutar el test y verificar que pasa**

Run: `cd backend; npm test -- ticket-transitions`
Expected: PASS — 12 tests.

- [ ] **Step 6: Exponer el endpoint**

En `tickets.controller.ts`, inyectar `TicketTransitionsService` en el constructor y añadir:

```ts
  @Post(':id/transition')
  transition(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransitionTicketDto,
  ) {
    return this.transitions.transition({
      ticketId: id,
      actorUserId: user.id,
      toStatus: dto.toStatus,
      reason: dto.reason,
      resolutionMd: dto.resolutionMd,
      rootCause: dto.rootCause,
      correctiveAction: dto.correctiveAction,
    });
  }
```

Registrar `TicketTransitionsService` en `providers` y `exports` del módulo.

- [ ] **Step 7: Verificar que compila**

Run: `cd backend; npm run build`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/tickets
git commit -m "feat(tickets): transiciones con reglas de cierre, pausa y motivo obligatorio"
```

---

### Task 10: Asignación, derivación y sugerencia de técnico

**Files:**
- Create: `backend/src/modules/tickets/ticket-assignment.service.ts`
- Create: `backend/src/modules/tickets/dto/assign-ticket.dto.ts`
- Create: `backend/src/modules/tickets/dto/escalate-ticket.dto.ts`
- Create: `backend/src/modules/tickets/dto/override-priority.dto.ts`
- Test: `backend/src/modules/tickets/ticket-assignment.service.spec.ts`
- Modify: `backend/src/modules/tickets/tickets.controller.ts`
- Modify: `backend/src/modules/tickets/tickets.module.ts`

**Interfaces:**
- Consumes: `TicketsRepository`, `TicketEventsService`, `TicketTransitionsService`, `SupportAgentsRepository`.
- Produces: `TicketAssignmentService` con `assign(input)`, `take(input)`, `escalate(input)`, `overridePriority(input)`, `suggestAssignee(ticketId)`.

`SupportAgentsRepository` viene de la Tarea 5, no de la 11: esta tarea solo necesita leer los agentes, no gestionarlos, así que no depende del CRUD de catálogos.

- [ ] **Step 1: Crear los DTO**

`backend/src/modules/tickets/dto/assign-ticket.dto.ts`:

```ts
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class AssignTicketDto {
  @IsInt() @Min(1)
  assigneeUserId!: number;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}
```

`backend/src/modules/tickets/dto/escalate-ticket.dto.ts`:

```ts
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { AGENT_LEVELS, AgentLevel } from '../entities/ticket.entity';

export class EscalateTicketDto {
  @IsIn(AGENT_LEVELS)
  toLevel!: AgentLevel;

  /** Regla 03: derivar sin motivo no se acepta. */
  @IsString() @MinLength(3) @MaxLength(2000)
  reason!: string;

  @IsOptional() @IsInt() @Min(1)
  assigneeUserId?: number;
}
```

`backend/src/modules/tickets/dto/override-priority.dto.ts`:

```ts
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  TICKET_IMPACTS,
  TICKET_URGENCIES,
  TICKET_PRIORITIES,
  TicketImpact,
  TicketUrgency,
  TicketPriority,
} from '../domain/ticket-priority';

export class OverridePriorityDto {
  @IsOptional() @IsIn(TICKET_IMPACTS) impact?: TicketImpact;
  @IsOptional() @IsIn(TICKET_URGENCIES) urgency?: TicketUrgency;

  /** Si viene, fija la prioridad a mano y marca priority_overridden. */
  @IsOptional() @IsIn(TICKET_PRIORITIES) priority?: TicketPriority;

  @IsString() @MinLength(3) @MaxLength(2000)
  reason!: string;
}
```

- [ ] **Step 2: Escribir el test que falla**

`backend/src/modules/tickets/ticket-assignment.service.spec.ts`:

```ts
import { TicketAssignmentService } from './ticket-assignment.service';
import { Ticket } from './entities/ticket.entity';

const ticketRow = (over: Partial<Ticket> = {}): Ticket =>
  ({ id: 1, status: 'NUEVO', priority: 'P3', priorityOverridden: 0, impact: null, urgency: null, ...over }) as Ticket;

const makeService = (current: Ticket, agents: any[] = []) => {
  const repo = {
    findById: jest.fn().mockResolvedValue(current),
    update: jest.fn().mockImplementation((_id, patch) => Promise.resolve({ ...current, ...patch })),
    countOpenByAssignee: jest.fn().mockResolvedValue(new Map([[10, 5], [11, 1]])),
  };
  const events = { record: jest.fn().mockResolvedValue({}) };
  const transitions = { transition: jest.fn().mockResolvedValue(current) };
  const agentsRepo = { listActive: jest.fn().mockResolvedValue(agents) };
  return {
    service: new TicketAssignmentService(repo as any, events as any, transitions as any, agentsRepo as any),
    repo,
    events,
    transitions,
  };
};

describe('assign', () => {
  it('asigna y transiciona a ASIGNADO desde NUEVO', async () => {
    const { service, repo, transitions } = makeService(ticketRow({ status: 'NUEVO' }));
    await service.assign({ ticketId: 1, actorUserId: 5, assigneeUserId: 10 });
    expect(repo.update).toHaveBeenCalledWith(1, expect.objectContaining({ assigneeUserId: 10 }));
    expect(transitions.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'ASIGNADO' }),
    );
  });

  it('reasignar un ticket ya en atencion no cambia el estado', async () => {
    const { service, transitions } = makeService(ticketRow({ status: 'EN_ATENCION' }));
    await service.assign({ ticketId: 1, actorUserId: 5, assigneeUserId: 11 });
    expect(transitions.transition).not.toHaveBeenCalled();
  });
});

describe('escalate', () => {
  it('registra nivel destino y motivo, y transiciona a DERIVADO', async () => {
    const { service, repo, transitions } = makeService(ticketRow({ status: 'EN_ATENCION' }));
    await service.escalate({
      ticketId: 1,
      actorUserId: 5,
      toLevel: 'N3',
      reason: 'Requiere infraestructura',
    });
    expect(repo.update).toHaveBeenCalledWith(1, expect.objectContaining({ escalationLevel: 'N3' }));
    expect(transitions.transition).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: 'DERIVADO', reason: 'Requiere infraestructura' }),
    );
  });
});

describe('overridePriority', () => {
  it('fijar prioridad a mano marca priority_overridden y registra el evento', async () => {
    const { service, repo, events } = makeService(ticketRow());
    await service.overridePriority({
      ticketId: 1,
      actorUserId: 5,
      priority: 'P1',
      reason: 'El cliente escalo por contrato',
    });
    const patch = repo.update.mock.calls[0][1];
    expect(patch.priority).toBe('P1');
    expect(patch.priorityOverridden).toBe(1);
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PRIORITY_OVERRIDDEN' }),
    );
  });

  it('cambiar impacto y urgencia recalcula sin marcar override', async () => {
    const { service, repo } = makeService(ticketRow());
    await service.overridePriority({
      ticketId: 1,
      actorUserId: 5,
      impact: 'ALTO',
      urgency: 'ALTA',
      reason: 'Afecta las 3 sedes',
    });
    const patch = repo.update.mock.calls[0][1];
    expect(patch.priority).toBe('P1');
    expect(patch.priorityOverridden).toBe(0);
  });
});

describe('suggestAssignee', () => {
  it('prefiere al agente con la especialidad y menor carga', async () => {
    const agents = [
      { id: 1, userId: 10, level: 'N2', specialties: ['SOPORTE'], isActive: 1 },
      { id: 2, userId: 11, level: 'N2', specialties: ['SOPORTE'], isActive: 1 },
      { id: 3, userId: 12, level: 'N1', specialties: ['CAPACITACION'], isActive: 1 },
    ];
    const { service } = makeService(ticketRow({ serviceCategory: 'SOPORTE' } as Partial<Ticket>), agents);
    const r = await service.suggestAssignee(1);
    // userId 11 tiene 1 ticket abierto frente a los 5 del userId 10
    expect(r?.userId).toBe(11);
  });

  it('devuelve null si ningun agente cubre la categoria', async () => {
    const agents = [{ id: 3, userId: 12, level: 'N1', specialties: ['CAPACITACION'], isActive: 1 }];
    const { service } = makeService(ticketRow({ serviceCategory: 'SOPORTE' } as Partial<Ticket>), agents);
    expect(await service.suggestAssignee(1)).toBeNull();
  });
});
```

- [ ] **Step 3: Ejecutar el test y verificar que falla**

Run: `cd backend; npm test -- ticket-assignment`
Expected: FAIL — `Cannot find module './ticket-assignment.service'`.

- [ ] **Step 4: Implementar**

`backend/src/modules/tickets/ticket-assignment.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';

import { TicketsRepository } from './tickets.repository';
import { TicketEventsService } from './ticket-events.service';
import { TicketTransitionsService } from './ticket-transitions.service';
import { SupportAgentsRepository } from './support-agents.repository';

import { Ticket, AgentLevel } from './entities/ticket.entity';
import { SupportAgent } from './entities/support-agent.entity';
import {
  TicketImpact,
  TicketUrgency,
  TicketPriority,
  derivePriority,
} from './domain/ticket-priority';

@Injectable()
export class TicketAssignmentService {
  constructor(
    private readonly repo: TicketsRepository,
    private readonly events: TicketEventsService,
    private readonly transitions: TicketTransitionsService,
    private readonly agents: SupportAgentsRepository,
  ) {}

  private async findOrFail(id: number): Promise<Ticket> {
    const t = await this.repo.findById(id);
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ticket no encontrado' });
    return t;
  }

  /** Regla 01: la asignación siempre la confirma una persona. */
  async assign(input: {
    ticketId: number;
    actorUserId: number;
    assigneeUserId: number;
    reason?: string;
  }): Promise<Ticket> {
    const current = await this.findOrFail(input.ticketId);

    await this.repo.update(input.ticketId, { assigneeUserId: input.assigneeUserId });
    await this.events.record({
      ticketId: input.ticketId,
      type: 'ASSIGNED',
      actorUserId: input.actorUserId,
      reason: input.reason ?? null,
      payload: { assigneeUserId: input.assigneeUserId },
    });

    // Solo mueve el estado si el ticket aún no había sido asignado.
    if (current.status === 'NUEVO' || current.status === 'TRIAJE') {
      return this.transitions.transition({
        ticketId: input.ticketId,
        actorUserId: input.actorUserId,
        toStatus: 'ASIGNADO',
      });
    }
    return this.findOrFail(input.ticketId);
  }

  /** Regla 02: tomar el ticket lo pone en atención y arranca el reloj de respuesta. */
  take(input: { ticketId: number; actorUserId: number }): Promise<Ticket> {
    return this.repo.update(input.ticketId, { assigneeUserId: input.actorUserId }).then(() =>
      this.transitions.transition({
        ticketId: input.ticketId,
        actorUserId: input.actorUserId,
        toStatus: 'EN_ATENCION',
      }),
    );
  }

  /** Regla 03: derivar exige motivo y nivel destino. El reloj no se reinicia. */
  async escalate(input: {
    ticketId: number;
    actorUserId: number;
    toLevel: AgentLevel;
    reason: string;
    assigneeUserId?: number;
  }): Promise<Ticket> {
    await this.findOrFail(input.ticketId);

    const patch: Partial<Ticket> = { escalationLevel: input.toLevel };
    if (input.assigneeUserId) patch.assigneeUserId = input.assigneeUserId;
    await this.repo.update(input.ticketId, patch);

    return this.transitions.transition({
      ticketId: input.ticketId,
      actorUserId: input.actorUserId,
      toStatus: 'DERIVADO',
      reason: input.reason,
    });
  }

  /**
   * Cambiar impacto/urgencia recalcula la prioridad. Fijarla a mano marca
   * `priorityOverridden`: a partir de ahí la matriz deja de recalcular.
   */
  async overridePriority(input: {
    ticketId: number;
    actorUserId: number;
    impact?: TicketImpact;
    urgency?: TicketUrgency;
    priority?: TicketPriority;
    reason: string;
  }): Promise<Ticket> {
    const current = await this.findOrFail(input.ticketId);

    const impact = input.impact ?? current.impact;
    const urgency = input.urgency ?? current.urgency;

    const manual = input.priority !== undefined;
    const priority = manual ? input.priority! : derivePriority(impact, urgency);

    const updated = await this.repo.update(input.ticketId, {
      impact,
      urgency,
      priority,
      priorityOverridden: manual ? 1 : current.priorityOverridden,
    });

    await this.events.record({
      ticketId: input.ticketId,
      type: 'PRIORITY_OVERRIDDEN',
      actorUserId: input.actorUserId,
      reason: input.reason,
      payload: { from: current.priority, to: priority, manual },
    });

    return updated!;
  }

  /**
   * Regla 01: propone el agente activo cuya especialidad cubre la categoría
   * del ticket y que menos tickets abiertos tiene. Es una sugerencia.
   */
  async suggestAssignee(ticketId: number): Promise<SupportAgent | null> {
    const ticket = await this.findOrFail(ticketId);
    if (!ticket.serviceCategory) return null;

    const active = await this.agents.listActive();
    const candidates = active.filter((a) =>
      (a.specialties ?? []).includes(ticket.serviceCategory!),
    );
    if (candidates.length === 0) return null;

    const load = await this.repo.countOpenByAssignee();
    return candidates.reduce((best, a) =>
      (load.get(a.userId) ?? 0) < (load.get(best.userId) ?? 0) ? a : best,
    );
  }
}
```

- [ ] **Step 5: Ejecutar el test y verificar que pasa**

Run: `cd backend; npm test -- ticket-assignment`
Expected: PASS — 7 tests.

- [ ] **Step 6: Exponer los endpoints**

En `tickets.controller.ts`, inyectar `TicketAssignmentService` y añadir:

```ts
  @Post(':id/assign')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignTicketDto,
  ) {
    return this.assignment.assign({
      ticketId: id,
      actorUserId: user.id,
      assigneeUserId: dto.assigneeUserId,
      reason: dto.reason,
    });
  }

  @Post(':id/take')
  take(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.assignment.take({ ticketId: id, actorUserId: user.id });
  }

  @Post(':id/escalate')
  escalate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EscalateTicketDto,
  ) {
    return this.assignment.escalate({
      ticketId: id,
      actorUserId: user.id,
      toLevel: dto.toLevel,
      reason: dto.reason,
      assigneeUserId: dto.assigneeUserId,
    });
  }

  @Post(':id/priority')
  overridePriority(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: OverridePriorityDto,
  ) {
    return this.assignment.overridePriority({
      ticketId: id,
      actorUserId: user.id,
      impact: dto.impact,
      urgency: dto.urgency,
      priority: dto.priority,
      reason: dto.reason,
    });
  }

  @Get(':id/suggest-assignee')
  suggestAssignee(@Param('id', ParseIntPipe) id: number) {
    return this.assignment.suggestAssignee(id);
  }
```

Registrar `TicketAssignmentService` en `providers` y `exports`.

- [ ] **Step 7: Verificar que compila y que la suite pasa**

Run: `cd backend; npm run build`
Expected: sin errores.

Run: `cd backend; npm test`
Expected: PASS — 6 archivos de test.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/tickets
git commit -m "feat(tickets): asignacion, derivacion por niveles y override de prioridad"
```

---

### Task 11: Catálogos — sistemas por cliente y técnicos

**Files:**
- Create: `backend/src/modules/tickets/client-systems.service.ts`
- Create: `backend/src/modules/tickets/client-systems.controller.ts`
- Create: `backend/src/modules/tickets/support-agents.service.ts`
- Create: `backend/src/modules/tickets/support-agents.controller.ts`
- Create: `backend/src/modules/tickets/dto/client-system.dto.ts`
- Create: `backend/src/modules/tickets/dto/support-agent.dto.ts`
- Modify: `backend/src/modules/tickets/tickets.module.ts`

**Interfaces:**
- Consumes: `ClientSystemsRepository`, `SupportAgentsRepository`, `ClientsService`, `UsersService`.
- Produces: `ClientSystemsService` con `listByClient`, `create`, `update`, `remove`; `SupportAgentsService` con `list`, `create`, `update`, `remove`. Rutas `/clients/:clientId/systems` y `/support-agents`.

`SupportAgentsService.list()` devuelve el agente enriquecido con `fullName` y `email` del usuario y con `openTickets`, para que la UI no tenga que cruzar tres endpoints.

- [ ] **Step 1: Crear los DTO**

`backend/src/modules/tickets/dto/client-system.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateClientSystemDto {
  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;
}

export class UpdateClientSystemDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  name?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
```

`backend/src/modules/tickets/dto/support-agent.dto.ts`:

```ts
import { ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { AGENT_LEVELS, SERVICE_CATEGORIES, AgentLevel, ServiceCategory } from '../entities/ticket.entity';

export class CreateSupportAgentDto {
  @IsInt() @Min(1)
  userId!: number;

  @IsIn(AGENT_LEVELS)
  level!: AgentLevel;

  @IsOptional() @IsArray() @ArrayUnique() @IsIn(SERVICE_CATEGORIES, { each: true })
  specialties?: ServiceCategory[];
}

export class UpdateSupportAgentDto {
  @IsOptional() @IsIn(AGENT_LEVELS) level?: AgentLevel;

  @IsOptional() @IsArray() @ArrayUnique() @IsIn(SERVICE_CATEGORIES, { each: true })
  specialties?: ServiceCategory[];

  @IsOptional() @IsBoolean() isActive?: boolean;
}
```

- [ ] **Step 2: Implementar `ClientSystemsService`**

`backend/src/modules/tickets/client-systems.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { ClientSystemsRepository } from './client-systems.repository';
import { ClientsService } from '../clients/clients.service';
import { ClientSystem } from './entities/client-system.entity';
import { CreateClientSystemDto, UpdateClientSystemDto } from './dto/client-system.dto';

@Injectable()
export class ClientSystemsService {
  constructor(
    private readonly repo: ClientSystemsRepository,
    private readonly clients: ClientsService,
  ) {}

  async listByClient(clientId: number): Promise<ClientSystem[]> {
    await this.clients.findByIdOrFail(clientId);
    return this.repo.listByClient(clientId);
  }

  async create(clientId: number, dto: CreateClientSystemDto): Promise<ClientSystem> {
    await this.clients.findByIdOrFail(clientId);
    const name = dto.name.trim();

    const existing = await this.repo.listByClient(clientId);
    if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `El cliente ya tiene un sistema llamado «${name}».`,
      });
    }
    return this.repo.create({ clientId, name, isActive: 1 });
  }

  async update(id: number, dto: UpdateClientSystemDto): Promise<ClientSystem> {
    const current = await this.repo.findById(id);
    if (!current) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Sistema no encontrado' });
    }
    const patch: Partial<ClientSystem> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.isActive !== undefined) patch.isActive = dto.isActive ? 1 : 0;

    const updated = await this.repo.update(id, patch);
    return updated!;
  }

  async remove(id: number): Promise<void> {
    const current = await this.repo.findById(id);
    if (!current) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Sistema no encontrado' });
    }
    await this.repo.remove(id);
  }
}
```

- [ ] **Step 3: Implementar `SupportAgentsService`**

`backend/src/modules/tickets/support-agents.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { SupportAgentsRepository } from './support-agents.repository';
import { TicketsRepository } from './tickets.repository';
import { UsersService } from '../users/users.service';
import { SupportAgent } from './entities/support-agent.entity';
import { CreateSupportAgentDto, UpdateSupportAgentDto } from './dto/support-agent.dto';

export interface SupportAgentView extends SupportAgent {
  fullName: string;
  email: string;
  openTickets: number;
}

@Injectable()
export class SupportAgentsService {
  constructor(
    private readonly repo: SupportAgentsRepository,
    private readonly tickets: TicketsRepository,
    private readonly users: UsersService,
  ) {}

  /** Enriquecido con datos del usuario y carga actual, para la UI de equipo. */
  async list(): Promise<SupportAgentView[]> {
    const [agents, load] = await Promise.all([
      this.repo.list(),
      this.tickets.countOpenByAssignee(),
    ]);

    return Promise.all(
      agents.map(async (a) => {
        const user = await this.users.findById(a.userId);
        return Object.assign({}, a, {
          fullName: user?.fullName ?? '(usuario eliminado)',
          email: user?.email ?? '',
          openTickets: load.get(a.userId) ?? 0,
        }) as SupportAgentView;
      }),
    );
  }

  async create(dto: CreateSupportAgentDto): Promise<SupportAgent> {
    const user = await this.users.findById(dto.userId);
    if (!user) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
    }
    const existing = await this.repo.findByUserId(dto.userId);
    if (existing) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `${user.fullName} ya está registrado como técnico de la mesa.`,
      });
    }
    return this.repo.create({
      userId: dto.userId,
      level: dto.level,
      specialties: dto.specialties ?? [],
      isActive: 1,
    });
  }

  async update(id: number, dto: UpdateSupportAgentDto): Promise<SupportAgent> {
    const current = await this.repo.findById(id);
    if (!current) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Técnico no encontrado' });
    }
    const patch: Partial<SupportAgent> = {};
    if (dto.level !== undefined) patch.level = dto.level;
    if (dto.specialties !== undefined) patch.specialties = dto.specialties;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive ? 1 : 0;

    const updated = await this.repo.update(id, patch);
    return updated!;
  }

  async remove(id: number): Promise<void> {
    const current = await this.repo.findById(id);
    if (!current) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Técnico no encontrado' });
    }
    await this.repo.remove(id);
  }
}
```

Si `UsersService` no expone `findById`, usar el método equivalente que ya tenga (revisar `backend/src/modules/users/users.service.ts`) y ajustar la llamada.

- [ ] **Step 4: Implementar los controladores**

`backend/src/modules/tickets/client-systems.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ClientSystemsService } from './client-systems.service';
import { CreateClientSystemDto, UpdateClientSystemDto } from './dto/client-system.dto';

@Controller('clients/:clientId/systems')
@UseGuards(JwtAuthGuard)
export class ClientSystemsController {
  constructor(private readonly service: ClientSystemsService) {}

  @Get()
  list(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.service.listByClient(clientId);
  }

  @Post()
  create(@Param('clientId', ParseIntPipe) clientId: number, @Body() dto: CreateClientSystemDto) {
    return this.service.create(clientId, dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateClientSystemDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }
}
```

`backend/src/modules/tickets/support-agents.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupportAgentsService } from './support-agents.service';
import { CreateSupportAgentDto, UpdateSupportAgentDto } from './dto/support-agent.dto';

@Controller('support-agents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SupportAgentsController {
  constructor(private readonly service: SupportAgentsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateSupportAgentDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSupportAgentDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.service.remove(id);
    return { ok: true };
  }
}
```

- [ ] **Step 5: Registrar en el módulo**

En `tickets.module.ts`: importar `UsersModule`, añadir los dos servicios a `providers`/`exports` y los dos controladores a `controllers`.

- [ ] **Step 6: Verificar de extremo a extremo**

Run: `cd backend; npm run build` — sin errores.

Con el backend levantado:

```bash
curl -s -X POST http://localhost:3000/clients/1/systems \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"ERP Core"}'
curl -s http://localhost:3000/clients/1/systems -H "Authorization: Bearer $TOKEN"
```

Expected: el sistema se crea y aparece en el listado. Repetir el POST con el mismo nombre → HTTP 409 con `code: "CONFLICT"`.

```bash
curl -s -X POST http://localhost:3000/support-agents \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"userId":1,"level":"N2","specialties":["SOPORTE","SOFTWARE"]}'
curl -s http://localhost:3000/support-agents -H "Authorization: Bearer $TOKEN"
```

Expected: el listado devuelve el agente con `fullName`, `email` y `openTickets: 0`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/tickets
git commit -m "feat(tickets): catalogos de sistemas por cliente y tecnicos de la mesa"
```

---

### Task 12: Cron de SLA en riesgo

**Files:**
- Create: `backend/src/modules/tickets/sla-risk.scheduler.ts`
- Modify: `backend/src/modules/tickets/tickets.module.ts`

**Interfaces:**
- Consumes: `TicketsRepository.listOpenForRiskScan()`, `SlaService.evaluateRisk`, `TicketEventsService.record`.
- Produces: `SlaRiskScheduler.scan(now?: Date): Promise<number>` — devuelve cuántos tickets marcó. El método es público para poder invocarlo en pruebas manuales sin esperar al cron.

`ScheduleModule.forRoot()` ya está activo en `app.module.ts` y hay precedente de `@Cron` en `audio-retention.service.ts`.

- [ ] **Step 1: Implementar**

`backend/src/modules/tickets/sla-risk.scheduler.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { TicketsRepository } from './tickets.repository';
import { TicketEventsService } from './ticket-events.service';
import { SlaService } from './sla.service';

/**
 * Regla 04 del prototipo: al consumir el 70% del plazo de resolución sin
 * actividad, el ticket se marca en riesgo y queda constancia en el timeline.
 *
 * Idempotente: `listOpenForRiskScan` ya excluye los que tienen sla_at_risk = 1,
 * así que el evento nunca se emite dos veces para el mismo ticket.
 */
@Injectable()
export class SlaRiskScheduler {
  private readonly logger = new Logger(SlaRiskScheduler.name);

  constructor(
    private readonly repo: TicketsRepository,
    private readonly events: TicketEventsService,
    private readonly sla: SlaService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron(): Promise<void> {
    try {
      const marked = await this.scan();
      if (marked > 0) this.logger.log(`SLA en riesgo: ${marked} ticket(s) marcados`);
    } catch (err) {
      this.logger.error(`Fallo el escaneo de SLA en riesgo: ${err}`);
    }
  }

  async scan(now: Date = new Date()): Promise<number> {
    const candidates = await this.repo.listOpenForRiskScan();
    let marked = 0;

    for (const ticket of candidates) {
      if (!this.sla.evaluateRisk(ticket, now)) continue;

      await this.repo.update(ticket.id, { slaAtRisk: 1 });
      await this.events.record({
        ticketId: ticket.id,
        type: 'SLA_AT_RISK',
        actorUserId: null, // el actor es el sistema
        payload: {
          priority: ticket.priority,
          resolutionDueAt: ticket.slaResolutionDueAt?.toISOString() ?? null,
        },
      });
      marked += 1;
    }
    return marked;
  }
}
```

- [ ] **Step 2: Registrar en el módulo**

Añadir `SlaRiskScheduler` a `providers` de `tickets.module.ts`. No hace falta exportarlo.

- [ ] **Step 3: Verificar que compila y arranca**

Run: `cd backend; npm run build` — sin errores.
Run: `cd backend; npm run start:dev` — Nest arranca y registra el cron sin advertencias.

- [ ] **Step 4: Verificar el comportamiento contra la base de datos**

Crear un ticket P1 y forzar su vencimiento para que supere el 70 %:

```sql
USE kubo_devdocs;
UPDATE tickets
   SET created_at = DATE_SUB(NOW(), INTERVAL 200 MINUTE),
       sla_resolution_due_at = DATE_ADD(NOW(), INTERVAL 40 MINUTE),
       status = 'EN_ATENCION', sla_at_risk = 0
 WHERE id = 1;
```

Esperar al siguiente tick del cron (máx. 5 min) y comprobar:

```sql
SELECT id, sla_at_risk FROM tickets WHERE id = 1;
SELECT type, actor_user_id FROM ticket_events WHERE ticket_id = 1 ORDER BY id DESC LIMIT 1;
```

Expected: `sla_at_risk = 1` y un evento `SLA_AT_RISK` con `actor_user_id` nulo. Esperar otro tick y confirmar que **no** se añade un segundo evento.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tickets
git commit -m "feat(tickets): cron que marca los tickets con SLA en riesgo"
```

---

### Task 13: Portar triaje IA, Jira, transcripción y cierre documental

**Files:**
- Create: `backend/src/modules/tickets/ticket-ai.service.ts`
- Modify: `backend/src/modules/tickets/tickets.controller.ts`
- Modify: `backend/src/modules/tickets/tickets.module.ts`

**Interfaces:**
- Consumes: `TicketsRepository`, `TicketEventsService`, `TicketTransitionsService`, `ClientsService`, `ProjectsService`, `IntegrationsService`, `JiraService`, `LLMService`, `DocumentsService`, `TRANSCRIPTION_PROVIDER`.
- Produces: `TicketAIService` con `triage(id)`, `pushToJira(id)`, `transcribeAudioBuffer(buffer, mimeType)`, `generateClosureDocument(id, userId)`.

Se **porta** desde `client-requests.service.ts`, con tres cambios: el prompt ahora devuelve además `impact` y `urgency` (para alimentar la matriz en lugar de `LOW/MEDIUM/HIGH`); el estado resultante es `TRIAJE` en vez de `STRUCTURED`; y cada operación deja su evento en el timeline.

- [ ] **Step 1: Implementar el servicio**

`backend/src/modules/tickets/ticket-ai.service.ts`. Copiar íntegramente de `client-requests.service.ts` los métodos `pushToJira`, `buildDescription`, `buildClosureMarkdown`, `slug` y `transcribeAudioBuffer`, sustituyendo `ClientRequest` por `Ticket`, `req.title` por `ticket.subject`, `req.source` por `ticket.origin` y `this.repo` por `TicketsRepository`. El `priorityMap` de Jira pasa a ser:

```ts
    const priorityMap: Record<TicketPriority, 'Highest' | 'High' | 'Medium' | 'Low'> = {
      P1: 'Highest',
      P2: 'High',
      P3: 'Medium',
      P4: 'Low',
    };
```

El método de triaje reemplaza a `structureWithAI`:

```ts
interface TriagePayload {
  requestType: TicketRequestType;
  serviceCategory: ServiceCategory;
  impact: TicketImpact;
  urgency: TicketUrgency;
  moduleName: string | null;
  screenName: string | null;
  flowContext: string | null;
  subject: string;
  descriptionMd: string;
  acceptanceCriteria: string[];
  labels: string[];
  confidence: number;
}

  async triage(id: number, actorUserId: number): Promise<Ticket> {
    const ticket = await this.findOrFail(id);

    const clientLabel = ticket.clientId
      ? (await this.clients.findByIdOrFail(ticket.clientId)).razonSocial
      : '(sin cliente asignado)';

    const systemPrompt = [
      'Eres el triaje de una mesa de servicio. Recibes el texto crudo de una',
      'incidencia (correo, WhatsApp, nota o transcripción) y devuelves SOLO un JSON:',
      '{',
      '  "requestType": "INCIDENCIA" | "BUG" | "MEJORA" | "FEATURE" | "AJUSTE",',
      '  "serviceCategory": "SOFTWARE" | "SOPORTE" | "CAPACITACION" | "CONSULTA" | "ASESORIA" | "VISITA_SITIO" | "OTRO",',
      '  "impact": "ALTO" | "MEDIO" | "BAJO",',
      '  "urgency": "ALTA" | "MEDIA" | "BAJA",',
      '  "moduleName": string | null,',
      '  "screenName": string | null,',
      '  "flowContext": string | null,',
      '  "subject": string,',
      '  "descriptionMd": string,',
      '  "acceptanceCriteria": string[],',
      '  "labels": string[],',
      '  "confidence": number',
      '}',
      '',
      'Reglas:',
      '- impact: ALTO si el servicio está caído o afecta a varias sedes/usuarios;',
      '  MEDIO si degrada el trabajo pero hay alternativa; BAJO si es cosmético o aislado.',
      '- urgency: ALTA si bloquea la operación ahora; MEDIA si se puede esperar horas;',
      '  BAJA si puede esperar días. NO devuelvas prioridad: se deriva de impacto x urgencia.',
      '- requestType: INCIDENCIA si algo dejó de funcionar; BUG si es un defecto reproducible;',
      '  MEJORA/FEATURE/AJUSTE si es trabajo de desarrollo solicitado.',
      '- subject: resumen corto (máx 90 caracteres), sin prefijos entre corchetes.',
      '- descriptionMd: markdown con "## Contexto" y "## Detalle". Cita frases del cliente.',
      '- confidence: 0 a 100, tu confianza en la clasificación.',
      'Responde únicamente el JSON, sin explicaciones ni bloques de código.',
    ].join('\n');

    const userPrompt = [
      `Cliente: ${clientLabel}`,
      '',
      'Texto crudo:',
      '"""',
      ticket.rawText,
      '"""',
    ].join('\n');

    const raw = await this.llm.chat(systemPrompt, [{ role: 'user', content: userPrompt }]);
    const parsed = this.parseTriageJson(raw);

    const priority = derivePriority(parsed.impact, parsed.urgency);
    const slaInit = await this.sla.initForTicket({
      clientId: ticket.clientId,
      createdAt: ticket.createdAt,
      priority,
    });

    await this.repo.update(id, {
      requestType: parsed.requestType,
      serviceCategory: parsed.serviceCategory,
      impact: parsed.impact,
      urgency: parsed.urgency,
      // El triaje no pisa una prioridad que un humano ya fijó a mano.
      ...(ticket.priorityOverridden === 1
        ? {}
        : {
            priority,
            slaPolicyId: slaInit.slaPolicyId,
            slaResponseDueAt: slaInit.slaResponseDueAt,
            slaResolutionDueAt: slaInit.slaResolutionDueAt,
          }),
      moduleName: parsed.moduleName,
      screenName: parsed.screenName,
      flowContext: parsed.flowContext,
      subject: parsed.subject,
      descriptionMd: parsed.descriptionMd,
      acceptanceCriteria: parsed.acceptanceCriteria,
      labels: parsed.labels,
    });

    await this.events.record({
      ticketId: id,
      type: 'TRIAGED',
      actorUserId,
      payload: { confidence: parsed.confidence, priority, impact: parsed.impact, urgency: parsed.urgency },
    });

    // Solo mueve el estado si el ticket seguía recién creado.
    if (ticket.status === 'NUEVO') {
      return this.transitions.transition({ ticketId: id, actorUserId, toStatus: 'TRIAJE' });
    }
    return this.findOrFail(id);
  }
```

`parseTriageJson` replica la validación defensiva de `parseStructuredJson`: limpia las vallas de código, hace `JSON.parse` dentro de un `try` que lanza `{ code: 'LLM_ERROR' }`, y valida cada campo contra su lista de valores admitidos cayendo a `'INCIDENCIA'`, `'SOPORTE'`, `'MEDIO'`, `'MEDIA'` y `confidence: 0` cuando el valor no es válido.

- [ ] **Step 2: Exponer los endpoints**

En `tickets.controller.ts`, inyectar `TicketAIService` y añadir `POST :id/triage`, `POST :id/push-to-jira`, `POST :id/closure-document` y `POST transcribe`. Este último replica el `FileInterceptor` con `limits: { fileSize: 25 * 1024 * 1024 }` de `client-requests.controller.ts:91-95`.

**Cuidado con el orden de rutas:** `@Post('transcribe')` debe declararse **antes** que cualquier ruta `@Post(':id/...')` que pudiera capturarla. En el controlador viejo estaba al final y funcionaba porque no había colisión; aquí conviene declararlo arriba.

- [ ] **Step 3: Registrar en el módulo**

En `tickets.module.ts`: añadir `IntegrationsModule`, `AIModule`, `TranscriptionsModule` y `DocumentsModule` a `imports`, y `TicketAIService` a `providers`.

- [ ] **Step 4: Verificar**

Run: `cd backend; npm run build` — sin errores.

Con el backend levantado y un proveedor de IA configurado:

```bash
curl -s -X POST http://localhost:3000/tickets/1/triage -H "Authorization: Bearer $TOKEN"
```

Expected: el ticket vuelve con `impact`, `urgency`, `priority` derivada, `status: "TRIAJE"`, y el timeline suma un evento `TRIAGED` con la confianza en el `payload`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tickets
git commit -m "feat(tickets): triaje IA con impacto y urgencia, Jira y transcripcion portados"
```

---

### Task 14: Cutover — eliminar `client_requests`

**Files:**
- Create: `backend/sql/migrations/011_drop_client_requests.sql`
- Delete: `backend/src/modules/client-requests/` (directorio completo)
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/modules/reports/reports.module.ts`
- Modify: `backend/src/modules/reports/reports.service.ts`

**Interfaces:**
- Consumes: `TicketsRepository.listByClientAndRange` (misma firma que el repositorio eliminado), `Ticket`, `SERVICE_CATEGORIES`, `ServiceCategory` de `tickets/entities/ticket.entity`.
- Produces: nada nuevo. El repositorio queda sin rastro del modelo viejo.

Punto de no retorno: la migración `011` borra la tabla. Autorizado explícitamente porque el módulo nunca se usó en producción.

- [ ] **Step 1: Confirmar que no hay datos que conservar**

```sql
USE kubo_devdocs;
SELECT COUNT(*) AS filas FROM client_requests;
```

Si el conteo es distinto de 0, **detenerse y preguntar** antes de continuar. La spec autoriza el DROP sobre la premisa de que la tabla está vacía o solo tiene datos de prueba.

- [ ] **Step 2: Escribir la migración**

`backend/sql/migrations/011_drop_client_requests.sql`:

```sql
-- =========================================================================
--  Migración 011 — Eliminar client_requests
-- =========================================================================
--  El módulo client-requests queda reemplazado por `tickets` (migración 010).
--  Nunca se usó en producción, por lo que no hay migración de datos.
--  Ejecutar SOLO después de verificar: SELECT COUNT(*) FROM client_requests;
-- =========================================================================

USE kubo_devdocs;

DROP TABLE IF EXISTS client_requests;
```

- [ ] **Step 3: Reapuntar `reports.service.ts`**

Sustituir los imports de las líneas 9–10:

```ts
import { TicketsRepository } from '../tickets/tickets.repository';
import { Ticket, SERVICE_CATEGORIES, ServiceCategory } from '../tickets/entities/ticket.entity';
```

En el constructor, cambiar `private readonly clientRequestsRepo: ClientRequestsRepository` por `private readonly ticketsRepo: TicketsRepository`, y la llamada de la línea 522 por `this.ticketsRepo.listByClientAndRange({ ... })`. La firma es idéntica, así que el cuerpo no cambia.

Cambiar la firma de `groupByCategory(tickets: ClientRequest[])` a `groupByCategory(tickets: Ticket[])` y el tipo del `Map` interno a `Map<string, Ticket[]>`.

**Un cambio de semántica que hay que hacer:** las líneas 531 y 633 filtran por `t.status === 'COMPLETED'`, estado que ya no existe. En el modelo nuevo, «atendido» equivale a resuelto o cerrado:

```ts
const isCompleted = (t: Ticket) => t.status === 'RESUELTO' || t.status === 'CERRADO';
```

Usarlo en ambos sitios en lugar de la comparación literal.

- [ ] **Step 4: Reapuntar `reports.module.ts`**

Sustituir `ClientRequestsModule` por `TicketsModule` en el array `imports`.

- [ ] **Step 5: Eliminar el módulo viejo**

```bash
git rm -r backend/src/modules/client-requests
```

En `app.module.ts`, eliminar el import de `ClientRequestsModule` y su entrada en el array `imports`.

- [ ] **Step 6: Verificar que compila**

Run: `cd backend; npm run build`
Expected: sin errores. Si aparece algún `Cannot find module '../client-requests/...'`, quedó una referencia sin reapuntar — buscarla con `grep -rn "client-requests\|ClientRequest" backend/src`.

- [ ] **Step 7: Ejecutar la migración**

```bash
docker compose -f docker-compose.dev.yml exec -T mysql \
  mysql -u root -p"$MYSQL_ROOT_PASSWORD" < backend/sql/migrations/011_drop_client_requests.sql
```

Verificar: `SHOW TABLES LIKE 'client_requests';` → vacío.

- [ ] **Step 8: Verificar que el informe mensual sigue funcionando**

Levantar el backend y, con un cliente que tenga tickets en el rango:

```bash
curl -s "http://localhost:3000/reports/monthly-attention?clientId=1&from=2026-07-01&to=2026-07-31" \
  -H "Authorization: Bearer $TOKEN"
```

(Ajustar la ruta al endpoint real de `reports.controller.ts`.)
Expected: HTTP 200 con `totals` y `byCategory` calculados sobre `tickets`, y `completed` contando los `RESUELTO`/`CERRADO`.

- [ ] **Step 9: Ejecutar la suite completa**

Run: `cd backend; npm test`
Expected: PASS — los 7 archivos de test.

- [ ] **Step 10: Commit**

```bash
git add -A backend
git commit -m "refactor(tickets): cutover — eliminar client_requests y reapuntar reportes"
```

---

### Task 15: Web — tipos y cliente API

**Files:**
- Create: `web/src/api/tickets.api.ts`
- Modify: `web/src/api/types.ts`

`client-requests.api.ts` **no** se borra aquí: las páginas viejas todavía lo
importan y el build debe quedar verde al final de cada tarea. Se elimina en la
Tarea 17, junto con la última página que lo consume.

**Interfaces:**
- Consumes: `api` de `./client`.
- Produces: tipos `TicketStatus`, `TicketPriority`, `TicketImpact`, `TicketUrgency`, `TicketOrigin`, `TicketRequestType`, `AgentLevel`, `Ticket`, `TicketEvent`, `TicketDetail`, `ClientSystem`, `SupportAgent`; y `ticketsApi`, `clientSystemsApi`, `supportAgentsApi`.

- [ ] **Step 1: Añadir los tipos**

En `web/src/api/types.ts`, **añadir** los tipos siguientes. Los `ClientRequest*`
se conservan por ahora — los borra la Tarea 17, cuando ya nadie los importe:

```ts
export type TicketStatus =
  | 'NUEVO' | 'TRIAJE' | 'ASIGNADO' | 'EN_ATENCION'
  | 'ESPERA_CLIENTE' | 'DERIVADO' | 'RESUELTO' | 'CERRADO';

export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4';
export type TicketImpact = 'ALTO' | 'MEDIO' | 'BAJO';
export type TicketUrgency = 'ALTA' | 'MEDIA' | 'BAJA';
export type AgentLevel = 'N1' | 'N2' | 'N3';

export type TicketOrigin =
  | 'EMAIL' | 'WHATSAPP_TEXT' | 'WHATSAPP_AUDIO' | 'VOICE_LIVE'
  | 'MEETING' | 'NOTE' | 'PORTAL';

export type TicketRequestType = 'INCIDENCIA' | 'BUG' | 'MEJORA' | 'FEATURE' | 'AJUSTE';

export type TicketEventType =
  | 'CREATED' | 'TRIAGED' | 'ASSIGNED' | 'TAKEN' | 'STATUS_CHANGED'
  | 'ESCALATED' | 'COMMENT' | 'RESOLVED' | 'CLOSED' | 'REOPENED'
  | 'SLA_AT_RISK' | 'PRIORITY_OVERRIDDEN';

export interface Ticket {
  id: number;
  code: string | null;
  clientId: number | null;
  projectId: number | null;
  systemId: number | null;
  origin: TicketOrigin;
  requestType: TicketRequestType | null;
  serviceCategory: ServiceCategory | null;
  subject: string | null;
  rawText: string;
  descriptionMd: string | null;
  impact: TicketImpact | null;
  urgency: TicketUrgency | null;
  priority: TicketPriority;
  priorityOverridden: number;
  status: TicketStatus;
  assigneeUserId: number | null;
  escalationLevel: AgentLevel | null;
  slaResponseDueAt: string | null;
  slaResolutionDueAt: string | null;
  firstResponseAt: string | null;
  pausedAt: string | null;
  slaAtRisk: number;
  resolvedAt: string | null;
  closedAt: string | null;
  resolutionMd: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  jiraIssueKey: string | null;
  jiraIssueUrl: string | null;
  createdAt: string;
  // Derivados que calcula el backend (TicketsService.decorate)
  slaLabel: string;
  slaPct: number | null;
  slaOverdue: boolean;
}

export interface TicketEvent {
  id: number;
  ticketId: number;
  type: TicketEventType;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus | null;
  actorUserId: number | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface TicketDetail {
  ticket: Ticket;
  timeline: TicketEvent[];
}

export interface ClientSystem {
  id: number;
  clientId: number;
  name: string;
  isActive: number;
}

export interface SupportAgent {
  id: number;
  userId: number;
  level: AgentLevel;
  specialties: ServiceCategory[] | null;
  isActive: number;
  fullName: string;
  email: string;
  openTickets: number;
}
```

- [ ] **Step 2: Crear el cliente API**

`web/src/api/tickets.api.ts`:

```ts
import { api } from './client';
import type {
  Ticket, TicketDetail, TicketStatus, TicketPriority, TicketImpact, TicketUrgency,
  TicketOrigin, TicketRequestType, ServiceCategory, ClientSystem, SupportAgent, AgentLevel,
} from './types';

export interface CreateTicketBody {
  rawText: string;
  subject?: string;
  origin?: TicketOrigin;
  requestType?: TicketRequestType;
  serviceCategory?: ServiceCategory;
  impact?: TicketImpact;
  urgency?: TicketUrgency;
  clientId?: number;
  projectId?: number;
  systemId?: number;
  capturedAt?: string;
  scheduledAt?: string;
  durationMinutes?: number;
}

export interface TicketListParams {
  status?: TicketStatus;
  open?: boolean;
  clientId?: number;
  systemId?: number;
  priority?: TicketPriority;
  assigneeId?: number;
  serviceCategory?: ServiceCategory;
  atRisk?: boolean;
  q?: string;
}

export const ticketsApi = {
  list: (params?: TicketListParams) =>
    api.get<Ticket[]>('/tickets', { params }).then((r) => r.data),

  findOne: (id: number) => api.get<TicketDetail>(`/tickets/${id}`).then((r) => r.data),

  create: (body: CreateTicketBody) => api.post<Ticket>('/tickets', body).then((r) => r.data),

  update: (id: number, body: Partial<CreateTicketBody> & { descriptionMd?: string }) =>
    api.patch<Ticket>(`/tickets/${id}`, body).then((r) => r.data),

  remove: (id: number) => api.delete<{ ok: true }>(`/tickets/${id}`).then((r) => r.data),

  transition: (
    id: number,
    body: {
      toStatus: TicketStatus;
      reason?: string;
      resolutionMd?: string;
      rootCause?: string;
      correctiveAction?: string;
    },
  ) => api.post<Ticket>(`/tickets/${id}/transition`, body).then((r) => r.data),

  assign: (id: number, body: { assigneeUserId: number; reason?: string }) =>
    api.post<Ticket>(`/tickets/${id}/assign`, body).then((r) => r.data),

  take: (id: number) => api.post<Ticket>(`/tickets/${id}/take`).then((r) => r.data),

  escalate: (id: number, body: { toLevel: AgentLevel; reason: string; assigneeUserId?: number }) =>
    api.post<Ticket>(`/tickets/${id}/escalate`, body).then((r) => r.data),

  overridePriority: (
    id: number,
    body: { impact?: TicketImpact; urgency?: TicketUrgency; priority?: TicketPriority; reason: string },
  ) => api.post<Ticket>(`/tickets/${id}/priority`, body).then((r) => r.data),

  suggestAssignee: (id: number) =>
    api.get<SupportAgent | null>(`/tickets/${id}/suggest-assignee`).then((r) => r.data),

  triage: (id: number) => api.post<Ticket>(`/tickets/${id}/triage`).then((r) => r.data),

  pushToJira: (id: number) => api.post<Ticket>(`/tickets/${id}/push-to-jira`).then((r) => r.data),

  transcribe: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<{ text: string; language: string | null }>('/tickets/transcribe', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
};

export const clientSystemsApi = {
  list: (clientId: number) =>
    api.get<ClientSystem[]>(`/clients/${clientId}/systems`).then((r) => r.data),
  create: (clientId: number, body: { name: string }) =>
    api.post<ClientSystem>(`/clients/${clientId}/systems`, body).then((r) => r.data),
  update: (clientId: number, id: number, body: { name?: string; isActive?: boolean }) =>
    api.patch<ClientSystem>(`/clients/${clientId}/systems/${id}`, body).then((r) => r.data),
  remove: (clientId: number, id: number) =>
    api.delete<{ ok: true }>(`/clients/${clientId}/systems/${id}`).then((r) => r.data),
};

export const supportAgentsApi = {
  list: () => api.get<SupportAgent[]>('/support-agents').then((r) => r.data),
  create: (body: { userId: number; level: AgentLevel; specialties?: ServiceCategory[] }) =>
    api.post<SupportAgent>('/support-agents', body).then((r) => r.data),
  update: (id: number, body: { level?: AgentLevel; specialties?: ServiceCategory[]; isActive?: boolean }) =>
    api.patch<SupportAgent>(`/support-agents/${id}`, body).then((r) => r.data),
  remove: (id: number) => api.delete<{ ok: true }>(`/support-agents/${id}`).then((r) => r.data),
};
```

- [ ] **Step 3: Verificar que compila**

Run: `cd web; npm run build`
Expected: sin errores. Esta tarea solo añade código nuevo: las páginas viejas
siguen intactas y funcionando.

- [ ] **Step 4: Commit**

```bash
git add web/src/api
git commit -m "feat(web): tipos y cliente API de tickets"
```

---

### Task 16: Web — bandeja de tickets

**Files:**
- Create: `web/src/pages/TicketsListPage.tsx`
- Create: `web/src/pages/tickets/ticket-ui.ts`
- Delete: `web/src/pages/RequestsListPage.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `ticketsApi.list`, tipos de `api/types`.
- Produces: `TicketsListPage` (default export); y de `ticket-ui.ts`: `STATUS_STYLES`, `PRIORITY_STYLES`, `STATUS_LABELS`, `slaBarColor(pct, overdue)`.

`ticket-ui.ts` centraliza los colores del prototipo para que bandeja y detalle no diverjan.

- [ ] **Step 1: Crear el módulo de estilos compartidos**

`web/src/pages/tickets/ticket-ui.ts`:

```ts
import type { TicketPriority, TicketStatus } from '../../api/types';

export interface Swatch {
  bg: string;
  fg: string;
}

/** Paleta del prototipo Claude Design (oklch). */
export const STATUS_STYLES: Record<TicketStatus, Swatch> = {
  NUEVO:          { bg: 'oklch(0.95 0.03 205)', fg: 'oklch(0.52 0.1 205)' },
  TRIAJE:         { bg: 'oklch(0.95 0.04 290)', fg: 'oklch(0.45 0.13 290)' },
  ASIGNADO:       { bg: 'oklch(0.94 0.05 78)',  fg: 'oklch(0.5 0.11 70)' },
  EN_ATENCION:    { bg: 'oklch(0.94 0.05 78)',  fg: 'oklch(0.5 0.11 70)' },
  ESPERA_CLIENTE: { bg: '#eceeef',              fg: '#4a5052' },
  DERIVADO:       { bg: 'oklch(0.95 0.04 290)', fg: 'oklch(0.45 0.13 290)' },
  RESUELTO:       { bg: 'oklch(0.94 0.05 150)', fg: 'oklch(0.45 0.11 150)' },
  CERRADO:        { bg: '#eceeef',              fg: '#4a5052' },
};

export const PRIORITY_STYLES: Record<TicketPriority, Swatch> = {
  P1: { bg: 'oklch(0.94 0.04 25)',  fg: 'oklch(0.5 0.16 25)' },
  P2: { bg: 'oklch(0.94 0.05 78)',  fg: 'oklch(0.5 0.11 70)' },
  P3: { bg: 'oklch(0.95 0.03 205)', fg: 'oklch(0.52 0.1 205)' },
  P4: { bg: '#eceeef',              fg: '#4a5052' },
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  NUEVO: 'Nuevo',
  TRIAJE: 'Triaje',
  ASIGNADO: 'Asignado',
  EN_ATENCION: 'En atención',
  ESPERA_CLIENTE: 'Espera cliente',
  DERIVADO: 'Derivado',
  RESUELTO: 'Resuelto',
  CERRADO: 'Cerrado',
};

/** Verde con margen, ámbar acercándose al umbral, rojo pasado o vencido. */
export function slaBarColor(pct: number | null, overdue: boolean): string {
  if (overdue) return 'oklch(0.5 0.16 25)';
  if (pct === null) return '#e2e5e6';
  if (pct >= 70) return 'oklch(0.5 0.16 25)';
  if (pct >= 45) return 'oklch(0.68 0.14 78)';
  return 'oklch(0.6 0.12 150)';
}
```

- [ ] **Step 2: Crear la página**

`web/src/pages/TicketsListPage.tsx`. Seguir el patrón de estado y carga de la página que se elimina (`RequestsListPage.tsx`) — leerla antes de borrarla para copiar cómo maneja `loading`, errores y el layout general. La estructura propia de esta página:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ticketsApi } from '../api/tickets.api';
import type { Ticket, TicketStatus } from '../api/types';
import { STATUS_STYLES, PRIORITY_STYLES, STATUS_LABELS, slaBarColor } from './tickets/ticket-ui';

type Chip = 'Todos' | 'Abiertos' | 'P1' | 'SLA en riesgo' | TicketStatus;

const CHIPS: Chip[] = ['Todos', 'Abiertos', 'P1', 'SLA en riesgo', 'DERIVADO', 'ESPERA_CLIENTE', 'RESUELTO'];

const chipLabel = (c: Chip): string =>
  c === 'Todos' || c === 'Abiertos' || c === 'P1' || c === 'SLA en riesgo'
    ? c
    : STATUS_LABELS[c];

export default function TicketsListPage() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<Chip>('Todos');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // El filtrado va al backend: es donde vive la definición de "abierto" y de
  // "en riesgo", y así la bandeja no diverge del informe.
  useEffect(() => {
    setLoading(true);
    setError(null);
    ticketsApi
      .list({
        open: filter === 'Abiertos' ? true : undefined,
        priority: filter === 'P1' ? 'P1' : undefined,
        atRisk: filter === 'SLA en riesgo' ? true : undefined,
        status: ['DERIVADO', 'ESPERA_CLIENTE', 'RESUELTO'].includes(filter as string)
          ? (filter as TicketStatus)
          : undefined,
        q: q.trim() || undefined,
      })
      .then(setTickets)
      .catch((e) => setError(e?.response?.data?.message ?? 'No se pudo cargar la bandeja'))
      .finally(() => setLoading(false));
  }, [filter, q]);

  const count = useMemo(() => tickets.length, [tickets]);

  return (
    <div style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 22 }}>
      <section style={{ background: '#fff', border: '1px solid #e2e5e6', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '13px 18px', borderBottom: '1px solid #eceeef', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {CHIPS.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              style={{
                cursor: 'pointer', fontSize: 12, fontWeight: 500, padding: '6px 12px',
                borderRadius: 16,
                border: `1px solid ${filter === c ? '#15191a' : '#dfe3e4'}`,
                background: filter === c ? '#15191a' : '#fff',
                color: filter === c ? '#fff' : '#3a4041',
              }}
            >
              {chipLabel(c)}
            </button>
          ))}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por código, asunto o texto"
            style={{ marginLeft: 'auto', fontSize: 12, padding: '6px 10px', border: '1px solid #dfe3e4', borderRadius: 6, minWidth: 240 }}
          />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#6d7577' }}>
            {count} tickets
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '82px 1fr 118px 96px 116px 110px 130px', gap: 12, padding: '10px 18px', borderBottom: '1px solid #eceeef', background: '#fafbfb', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6d7577' }}>
          <span>Ticket</span><span>Asunto</span><span>Categoría</span>
          <span>Prior.</span><span>Estado</span><span>Asignado</span><span>SLA</span>
        </div>

        {loading && <div style={{ padding: 18, fontSize: 13, color: '#6d7577' }}>Cargando…</div>}
        {error && <div style={{ padding: 18, fontSize: 13, color: 'oklch(0.5 0.16 25)' }}>{error}</div>}
        {!loading && !error && tickets.length === 0 && (
          <div style={{ padding: 18, fontSize: 13, color: '#6d7577' }}>
            No hay tickets que coincidan con el filtro.
          </div>
        )}

        {tickets.map((t) => {
          const st = STATUS_STYLES[t.status];
          const pr = PRIORITY_STYLES[t.priority];
          return (
            <div
              key={t.id}
              onClick={() => navigate(`/tickets/${t.id}`)}
              style={{ display: 'grid', gridTemplateColumns: '82px 1fr 118px 96px 116px 110px 130px', gap: 12, alignItems: 'center', padding: '13px 18px', borderBottom: '1px solid #f1f3f3', cursor: 'pointer' }}
            >
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: '#6d7577' }}>{t.code}</span>
              <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.subject ?? t.rawText.slice(0, 80)}
              </span>
              <span style={{ fontSize: 12, color: '#4a5052' }}>{t.serviceCategory ?? '—'}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, justifySelf: 'start', padding: '2px 7px', borderRadius: 4, background: pr.bg, color: pr.fg }}>
                {t.priority}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, justifySelf: 'start', padding: '3px 8px', borderRadius: 4, background: st.bg, color: st.fg }}>
                {STATUS_LABELS[t.status]}
              </span>
              <span style={{ fontSize: 12, color: '#4a5052' }}>{t.assigneeUserId ?? '—'}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 5, borderRadius: 3, background: '#eceeef' }}>
                  <div style={{ height: '100%', width: `${t.slaPct ?? 0}%`, background: slaBarColor(t.slaPct, t.slaOverdue), borderRadius: 3 }} />
                </div>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#6d7577' }}>{t.slaLabel}</span>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
```

La columna «Asignado» muestra el `assigneeUserId` en crudo. Resolver el nombre requiere el listado de usuarios; hacerlo con el mismo hook o llamada que usen las páginas existentes para poblar selects de usuario (revisar `ProjectMembersPage.tsx`) y mapear id → `fullName`.

- [ ] **Step 3: Actualizar el enrutado**

En `web/src/App.tsx`, sustituir el import y las rutas de `/requests` por:

```tsx
import TicketsListPage from './pages/TicketsListPage';
// ...
<Route path="/tickets" element={<TicketsListPage />} />
```

La ruta de detalle se añade en la Tarea 17. Actualizar también el enlace correspondiente en el menú lateral (`web/src/layout/`), cambiando la etiqueta a «Tickets» y el destino a `/tickets`.

- [ ] **Step 4: Eliminar la página vieja**

```bash
git rm web/src/pages/RequestsListPage.tsx
```

- [ ] **Step 5: Verificar en el navegador**

Run: `cd web; npm run dev`

Abrir `/tickets`. Expected: la bandeja lista los tickets creados en las tareas anteriores, con su código, prioridad coloreada, estado y barra de SLA. Los chips filtran, la búsqueda filtra, y hacer clic navega a `/tickets/:id` (aún 404 hasta la Tarea 17).

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(web): bandeja de tickets con filtros y barra de SLA"
```

---

### Task 17: Web — detalle de ticket

**Files:**
- Create: `web/src/pages/TicketDetailPage.tsx`
- Create: `web/src/pages/tickets/TicketTimeline.tsx`
- Create: `web/src/pages/tickets/TicketSlaClock.tsx`
- Create: `web/src/pages/tickets/ResolveDialog.tsx`
- Delete: `web/src/pages/RequestDetailPage.tsx`
- Delete: `web/src/api/client-requests.api.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/api/types.ts` (eliminar los tipos `ClientRequest*`)

**Interfaces:**
- Consumes: `ticketsApi.findOne/transition/take/escalate/triage`, `STATUS_STYLES`, `PRIORITY_STYLES`, `STATUS_LABELS`, `slaBarColor`.
- Produces: `TicketDetailPage` (default export); `TicketTimeline({ events })`; `TicketSlaClock({ ticket })`; `ResolveDialog({ open, onCancel, onConfirm })`.

- [ ] **Step 1: Crear `TicketTimeline`**

`web/src/pages/tickets/TicketTimeline.tsx`:

```tsx
import type { TicketEvent, TicketEventType } from '../../api/types';

const EVENT_LABELS: Record<TicketEventType, string> = {
  CREATED: 'Ticket creado',
  TRIAGED: 'Triaje IA',
  ASSIGNED: 'Asignado',
  TAKEN: 'Tomado por el técnico',
  STATUS_CHANGED: 'Cambio de estado',
  ESCALATED: 'Derivado',
  COMMENT: 'Comentario',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
  REOPENED: 'Reabierto',
  SLA_AT_RISK: 'SLA en riesgo',
  PRIORITY_OVERRIDDEN: 'Prioridad ajustada',
};

const DOTS: Partial<Record<TicketEventType, string>> = {
  CREATED: 'oklch(0.52 0.1 205)',
  TRIAGED: 'oklch(0.45 0.13 290)',
  ESCALATED: 'oklch(0.45 0.13 290)',
  RESOLVED: 'oklch(0.45 0.11 150)',
  CLOSED: '#4a5052',
  SLA_AT_RISK: 'oklch(0.5 0.16 25)',
  REOPENED: 'oklch(0.5 0.11 70)',
};

export default function TicketTimeline({ events }: { events: TicketEvent[] }) {
  if (events.length === 0) {
    return <span style={{ fontSize: 12, color: '#6d7577' }}>Sin eventos todavía.</span>;
  }

  return (
    <>
      {events.map((e) => (
        <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: DOTS[e.type] ?? 'oklch(0.6 0.13 78)', marginTop: 5 }} />
            <span style={{ flex: 1, width: 1, background: '#e6e9e9' }} />
          </div>
          <div style={{ paddingBottom: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{EVENT_LABELS[e.type]}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#6d7577' }}>
                {new Date(e.createdAt).toLocaleString('es-PE')}
              </span>
            </div>
            {e.fromStatus && e.toStatus && (
              <span style={{ fontSize: 12, color: '#4a5052' }}>
                {e.fromStatus} → {e.toStatus}
              </span>
            )}
            {e.reason && (
              <span style={{ fontSize: 12, color: '#4a5052', lineHeight: 1.55 }}>{e.reason}</span>
            )}
            {e.actorUserId === null && (
              <span style={{ fontSize: 11, color: '#6d7577' }}>Registrado por el sistema</span>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Crear `TicketSlaClock`**

`web/src/pages/tickets/TicketSlaClock.tsx`:

```tsx
import type { Ticket } from '../../api/types';
import { slaBarColor } from './ticket-ui';

export default function TicketSlaClock({ ticket }: { ticket: Ticket }) {
  const color = slaBarColor(ticket.slaPct, ticket.slaOverdue);

  return (
    <section style={{ background: '#fff', border: '1px solid #e2e5e6', borderRadius: 10, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Reloj de SLA</h2>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 26, fontWeight: 600, color }}>
          {ticket.slaLabel}
        </span>
        <span style={{ fontSize: 12, color: '#6d7577' }}>restante para resolución</span>
      </div>
      <div style={{ height: 7, borderRadius: 4, background: '#eceeef', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${ticket.slaPct ?? 0}%`, background: color }} />
      </div>
      <span style={{ fontSize: 11, color: '#6d7577', lineHeight: 1.5 }}>
        El reloj se pausa en «Espera cliente». Derivar no lo detiene ni lo reinicia.
      </span>
    </section>
  );
}
```

- [ ] **Step 3: Crear `ResolveDialog`**

`web/src/pages/tickets/ResolveDialog.tsx` — modal con tres campos de texto obligatorios (`resolutionMd`, `rootCause`, `correctiveAction`). El botón de confirmar permanece deshabilitado mientras alguno esté vacío, de modo que la regla 05 se comunique en la UI antes de que el backend la rechace:

```tsx
import { useState } from 'react';

interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: (v: { resolutionMd: string; rootCause: string; correctiveAction: string }) => void;
}

export default function ResolveDialog({ open, onCancel, onConfirm }: Props) {
  const [resolutionMd, setResolutionMd] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');

  if (!open) return null;
  const ready = resolutionMd.trim() && rootCause.trim() && correctiveAction.trim();

  const field = (label: string, value: string, set: (v: string) => void, rows: number) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => set(e.target.value)}
        style={{ fontSize: 13, padding: 9, border: '1px solid #dfe3e4', borderRadius: 6, resize: 'vertical', fontFamily: 'inherit' }}
      />
    </label>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: 22, width: 560, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Marcar como resuelto</h2>
        <span style={{ fontSize: 12, color: '#6d7577', lineHeight: 1.5 }}>
          Los tres campos son obligatorios: sin ellos el ticket no se puede resolver.
        </span>
        {field('Solución aplicada', resolutionMd, setResolutionMd, 4)}
        {field('Causa raíz', rootCause, setRootCause, 2)}
        {field('Acción correctiva / preventiva', correctiveAction, setCorrectiveAction, 2)}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ fontSize: 13, padding: '9px 14px', borderRadius: 7, background: '#fff', border: '1px solid #d8dcdd', cursor: 'pointer' }}>
            Cancelar
          </button>
          <button
            disabled={!ready}
            onClick={() => onConfirm({ resolutionMd, rootCause, correctiveAction })}
            style={{ fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 7, background: ready ? '#15191a' : '#c9cdce', color: '#fff', border: 'none', cursor: ready ? 'pointer' : 'not-allowed' }}
          >
            Resolver
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Crear `TicketDetailPage`**

`web/src/pages/TicketDetailPage.tsx`. Layout en dos columnas (`1fr 316px`) según el prototipo. Columna izquierda: cabecera con código, estado, prioridad y fecha; asunto; cuerpo del `rawText`; sección de solución y causa raíz cuando existan; y el timeline. Columna derecha: acciones, ficha y `TicketSlaClock`.

El bloque de acciones y la recarga tras cada operación:

```tsx
  const reload = () => ticketsApi.findOne(id).then(setDetail);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'La acción no se pudo completar');
    } finally {
      setBusy(false);
    }
  };

  const escalate = () => {
    const reason = window.prompt('Motivo de la derivación (obligatorio):');
    if (!reason?.trim()) return; // el backend también lo rechaza; evitamos el viaje
    act(() => ticketsApi.escalate(id, { toLevel: 'N3', reason }));
  };
```

Los botones que se muestran dependen del estado, para no ofrecer transiciones que la máquina de estados va a rechazar:

```tsx
  const canTake = ['NUEVO', 'TRIAJE', 'ASIGNADO'].includes(ticket.status);
  const canWait = ticket.status === 'EN_ATENCION';
  const canResume = ticket.status === 'ESPERA_CLIENTE';
  const canEscalate = ['ASIGNADO', 'EN_ATENCION'].includes(ticket.status);
  const canResolve = ['EN_ATENCION', 'ESPERA_CLIENTE'].includes(ticket.status);
  const canClose = ticket.status === 'RESUELTO';
```

Cada botón llama a `act(...)` con la operación correspondiente: `take`, `transition({ toStatus: 'ESPERA_CLIENTE' })`, `transition({ toStatus: 'EN_ATENCION' })`, `escalate`, abrir el `ResolveDialog`, y `transition({ toStatus: 'CERRADO' })`. Mostrar `error` en un banner sobre las acciones. Deshabilitar todos los botones mientras `busy`.

- [ ] **Step 5: Actualizar el enrutado y eliminar la página vieja**

En `App.tsx`, añadir `<Route path="/tickets/:ticketId" element={<TicketDetailPage />} />` y quitar la ruta `/requests/:requestId` junto con su import.

Esta es la última página que consumía el modelo viejo, así que ahora sí se elimina por completo:

```bash
git rm web/src/pages/RequestDetailPage.tsx web/src/api/client-requests.api.ts
```

Y en `web/src/api/types.ts`, borrar los tipos `ClientRequest`, `ClientRequestStatus`, `ClientRequestType`, `ClientRequestPriority` y `ClientRequestSource`.

- [ ] **Step 6: Verificar que compila**

Run: `cd web; npm run build`
Expected: sin errores de TypeScript. Si aparece algún `Cannot find module './client-requests.api'`, quedó una referencia — buscarla con `grep -rn "client-requests\|clientRequests\|ClientRequest" web/src`.

- [ ] **Step 7: Verificar el flujo completo en el navegador**

Con backend y frontend levantados, sobre un ticket real:

1. Abrir `/tickets`, entrar a un ticket → se ve el detalle con un solo evento `CREATED`.
2. **Tomar** → el estado pasa a `EN_ATENCION`, aparece un evento `TAKEN`, y `first_response_at` queda fijado.
3. **Derivar** sin motivo → el diálogo no envía. Con motivo → estado `DERIVADO` y evento `ESCALATED` con el motivo visible en el timeline.
4. Volver a `EN_ATENCION`, luego **Esperar cliente** → el reloj muestra «en pausa».
5. **Reanudar** → el `slaLabel` refleja un vencimiento desplazado por el tiempo en pausa.
6. **Resolver** con los tres campos → estado `RESUELTO`. Intentar resolver dejando uno vacío → el botón sigue deshabilitado.
7. **Cerrar** → estado `CERRADO`; los botones de acción desaparecen.

- [ ] **Step 8: Commit**

```bash
git add web/src
git commit -m "feat(web): detalle de ticket con timeline, reloj de SLA y acciones"
```

---

### Task 18: Web — catálogos de sistemas y técnicos

**Files:**
- Create: `web/src/pages/tickets/ClientSystemsTab.tsx`
- Create: `web/src/pages/tickets/SupportAgentsSection.tsx`
- Modify: `web/src/pages/ClientDetailPage.tsx`
- Modify: `web/src/pages/UsersPage.tsx`

**Interfaces:**
- Consumes: `clientSystemsApi`, `supportAgentsApi`, tipos `ClientSystem`, `SupportAgent`, `ServiceCategory`, `AgentLevel`.
- Produces: `ClientSystemsTab({ clientId })` y `SupportAgentsSection()`, ambos default export.

- [ ] **Step 1: Crear `ClientSystemsTab`**

`web/src/pages/tickets/ClientSystemsTab.tsx` — lista los sistemas del cliente con un campo para añadir uno nuevo y un botón para desactivar cada uno:

```tsx
import { useEffect, useState } from 'react';
import { clientSystemsApi } from '../../api/tickets.api';
import type { ClientSystem } from '../../api/types';

export default function ClientSystemsTab({ clientId }: { clientId: number }) {
  const [systems, setSystems] = useState<ClientSystem[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => clientSystemsApi.list(clientId).then(setSystems);
  useEffect(() => { load(); }, [clientId]);

  const add = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      await clientSystemsApi.create(clientId, { name: name.trim() });
      setName('');
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'No se pudo crear el sistema');
    }
  };

  const toggle = async (s: ClientSystem) => {
    await clientSystemsApi.update(clientId, s.id, { isActive: s.isActive === 0 });
    await load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Nombre del sistema (ej. ERP Core)"
          style={{ flex: 1, fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6 }}
        />
        <button onClick={add} style={{ fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 6, background: '#15191a', color: '#fff', border: 'none', cursor: 'pointer' }}>
          Añadir
        </button>
      </div>

      {error && <span style={{ fontSize: 12, color: 'oklch(0.5 0.16 25)' }}>{error}</span>}

      {systems.length === 0 && (
        <span style={{ fontSize: 12, color: '#6d7577' }}>
          Este cliente no tiene sistemas registrados. Los tickets podrán crearse igualmente, pero
          el informe no podrá agruparse por sistema.
        </span>
      )}

      {systems.map((s) => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid #f1f3f3' }}>
          <span style={{ flex: 1, fontSize: 13, color: s.isActive ? '#15191a' : '#9aa0a1' }}>{s.name}</span>
          <button onClick={() => toggle(s)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 5, background: '#fff', border: '1px solid #d8dcdd', cursor: 'pointer' }}>
            {s.isActive ? 'Desactivar' : 'Activar'}
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Crear `SupportAgentsSection`**

`web/src/pages/tickets/SupportAgentsSection.tsx` — tabla de técnicos con nombre, nivel, especialidades y carga (`openTickets`), más un formulario para registrar a un usuario existente como técnico. El nivel es un `<select>` con `N1`/`N2`/`N3`; las especialidades, checkboxes sobre `SERVICE_CATEGORIES`. Cada cambio llama a `supportAgentsApi.update` y recarga.

Mostrar la carga como un dato visible: es lo que alimenta la sugerencia de asignatario del backend, y verla ayuda a entender por qué propone a quien propone.

- [ ] **Step 3: Integrar en las páginas existentes**

En `ClientDetailPage.tsx`, añadir una pestaña «Sistemas» al conjunto de tabs existente que renderice `<ClientSystemsTab clientId={clientId} />`.

En `UsersPage.tsx`, añadir debajo del listado de usuarios una sección «Técnicos de la mesa» que renderice `<SupportAgentsSection />`.

- [ ] **Step 4: Verificar que compila y funciona**

Run: `cd web; npm run build` — sin errores.

En el navegador:
1. Cliente → pestaña Sistemas → añadir «ERP Core» → aparece. Añadirlo de nuevo → mensaje de conflicto.
2. Usuarios → Técnicos de la mesa → registrar un usuario como N2 con especialidad `SOPORTE` → aparece con `openTickets`.
3. Volver a un ticket con `serviceCategory: SOPORTE` y comprobar que `GET /tickets/:id/suggest-assignee` devuelve a ese técnico.

- [ ] **Step 5: Ejecutar la verificación final de T1**

Run: `cd backend; npm test`
Expected: PASS — 7 archivos de test, todos verdes.

Run: `cd backend; npm run build` — sin errores.
Run: `cd web; npm run build` — sin errores.

Run: `grep -rn "client-requests\|ClientRequest\|clientRequests" backend/src web/src`
Expected: sin resultados. Cualquier coincidencia es una referencia al modelo eliminado.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(web): catalogos de sistemas por cliente y tecnicos de la mesa"
```

---

## Verificación de cobertura de la spec

| Sección de la spec | Tareas que la implementan |
|---|---|
| §2.1 `tickets` | 4 (SQL), 5 (entidad), 8 (creación) |
| §2.2 `ticket_events` | 4, 5, 6 |
| §2.3 `sla_policies` + semilla | 4, 5, 7 |
| §2.4 `support_agents` | 4, 5, 11 |
| §2.5 `client_systems` | 4, 5, 11, 18 |
| §3 Máquina de estados | 2, 9 |
| §3 Reapertura | 2, 9 |
| §3 Regla 01 asignación sugerida | 10, 11 |
| §3 Regla 02 tomar | 9, 10 |
| §3 Regla 03 derivar con motivo | 2, 9, 10 |
| §3 Regla 04 SLA en riesgo | 3, 12 |
| §3 Regla 05 cierre con evidencia | 9, 17 |
| §4.1 Prioridad derivada + override | 1, 8, 10 |
| §4.2 Reloj, pausa, 24×7 | 3, 7, 9 |
| §4.3 Job de riesgo | 12 |
| §5 Estructura backend | 5–13 |
| §5 Endpoints | 8, 9, 10, 11, 13 |
| §5 Web | 15, 16, 17, 18 |
| §6 Pruebas | 1, 2, 3, 7, 9, 10 |
| §8 Riesgo: migración irreversible | 14 (paso 1: verificar conteo antes del DROP) |
| §8 Riesgo: `reports.service` | 14 (pasos 3, 4, 8) |

**Fuera de T1 por decisión de la spec §7**, sin tarea asociada: ingesta IMAP, plantillas de correo, portal del cliente, CSAT, informe ISO ampliado, PRB/CHG, recurrencias IA, vista móvil del técnico, calendario laboral.

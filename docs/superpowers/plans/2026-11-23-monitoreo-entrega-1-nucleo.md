# Monitoreo · Entrega 1 (Núcleo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medir los servicios de cada cliente desde la oficina en Lima y desde el VPS de KUBO, cruzar las dos mediciones, abrir incidentes con ticket automático (oculto al cliente hasta validar) y verlos en las pantallas Estado e Incidentes de la web del personal.

**Architecture:** Un paquete puro `packages/monitoring-core` (pruebas TCP/HTTPS/ICMP, planificador en hora de Lima, confirmación, degradación, ejecutor) lo usan el motor de oficina (`desktop/engine`, servicio de Windows en Node) y el contenedor `monitor-worker` (sonda `kubo-01` y evaluador). El backend NestJS gana un módulo `monitoring` con la ingesta de la sonda, la API del personal y la regla que oculta al cliente los tickets automáticos. Las sondas mandan resultados y **señales** (fallo confirmado, recuperación…); el evaluador del worker las convierte en incidentes y tickets.

**Tech Stack:** Node 20, TypeScript, NestJS 10 + TypeORM 0.3 + MySQL 8, Jest + ts-jest, React 18 + Vite + Tailwind + TanStack Query, better-sqlite3 (motor).

**Spec:** `docs/superpowers/specs/2026-11-23-monitoreo-disponibilidad-design.md` (aprobado). Prototipo visual: `docs/superpowers/specs/prototipos/2026-11-23-monitoreo-v2.html`.

**Esta es la primera de cuatro entregas** (spec, «Entregas del piloto»). Quedan fuera y van en planes posteriores: widget Electron y notificaciones de Windows, vigilancia cruzada de sondas por correo, mantenimientos, resúmenes diarios e informe de disponibilidad, agente .NET y pantalla Servidores, WinMTR, importación CSV, sección de disponibilidad del portal.

## Global Constraints

- Node `>=20 <21` en backend, `packages/monitoring-core` y `desktop/engine`.
- Migraciones SQL manuales numeradas desde `029_`, idempotentes con procedimientos guardados contra `information_schema` (patrón de `backend/sql/migrations/028_tickets_archivados.sql`); se aplican a mano antes del despliegue (`deploy.sh`).
- Todos los instantes se guardan en UTC. La hora de Lima es UTC−5 fija (sin horario de verano); en el backend se usan `common/time-zone.ts`, `common/peru-month.ts`, `common/peru-date-time.ts`.
- Valores por defecto, configurables: cada **5 min de 07:00 a 22:00** y cada **1 min de 22:00 a 07:00** (Lima); reintentos a **+30 s y +60 s** del primer intento; **3 fallos** confirman; **3 ciclos regulares lentos** = degradación; **2 comprobaciones correctas seguidas** = recuperación; retención de `monitor_checks` **90 días**.
- Concurrencia máxima por sonda **16**; tiempos de espera **TCP 5 s, HTTPS 10 s**, ICMP 5 s.
- **Nunca hay dos pruebas simultáneas del mismo servicio desde la misma sonda.**
- La validación TLS nunca se desactiva. Solo se prueban destinos del inventario; ninguna ruta acepta destinos libres.
- Prefijo global `/api/v1`. Ingesta bajo `/api/v1/monitoring/ingest/*`, con token de sonda guardado solo como hash SHA-256; API del personal con `@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)`.
- Ticket automático: `requestType 'INCIDENCIA'`, `origin 'MONITOREO'`, `escalationLevel 'N1'`, **sin asignado**; prioridad por criticidad (HIGH → P1, MEDIUM → P2, LOW → P3). La recuperación agrega un evento y **no** cierra el ticket. Las degradaciones no abren ticket.
- Un ticket con `origin = 'MONITOREO'` es visible para el cliente solo si `monitor_client_settings.portal_availability_visible = 1` para su cliente. El personal lo ve siempre.
- Textos visibles en español. Código e identificadores en inglés, como el resto del repositorio.
- **No hacer commit sin autorización del usuario.** Los pasos «Commit» se ejecutan solo si la dio para esta ejecución; si no, se dejan los cambios sin confirmar y se sigue.
- No leer `.env`, `SECRETS.local.txt` ni ningún archivo de credenciales.

## Decisiones de este plan (añadidas a la spec)

La spec deja estos puntos al constructor o no los nombra; se fijan aquí para que todas las tareas usen lo mismo:

1. **Empaquetado de `monitoring-core`:** fuente única en `packages/monitoring-core/src`. El backend recibe una copia generada y versionada en `backend/src/modules/monitoring/core/` mediante `backend/scripts/sync-monitoring-core.mjs` (mismo patrón que `web/scripts/sync-attachment-rules.mjs`, con `--check` en `prebuild` y `--skip-if-missing`), porque la imagen Docker del backend solo ve `backend/`. El motor la consume con `"@kubo/monitoring-core": "file:../../packages/monitoring-core"`.
2. **Autor de los tickets automáticos:** `TicketActor` solo admite `STAFF` o `CLIENT`. La migración 029 crea un usuario de sistema `monitoreo@sistema.kubo` («Monitoreo KUBO», rol `STAKEHOLDER`, `is_active = 0` para que no pueda iniciar sesión, `password_hash = '!'`). El monitoreo escribe como `{ kind: 'STAFF', userId }` de ese usuario. Como el autor no es un usuario de cliente, `plansForEvent` no avisa al cliente.
3. **Tablas auxiliares** que la spec no lista: `monitor_probe_signals` (señales recibidas de las sondas), `monitor_probe_orders` («probar ahora» y comprobación cruzada) y `monitor_probe_states` (estado actual por servicio y sonda).
4. **Ticket idempotente:** cada ticket automático lleva la etiqueta `monitoreo:incidente:<id>`; antes de crear uno, el evaluador busca por esa etiqueta.
5. **La pantalla Inventario (básica) y la de Sondas** entran en esta entrega aunque la spec solo nombre Estado e Incidentes: sin ellas no se puede cargar `VMI2571371` ni emitir el token de la oficina. La importación CSV queda para la Entrega 3.
6. **El worker no emite avisos en vivo** del gateway de tickets (no tiene servidor HTTP): los tickets automáticos aparecen en la bandeja al refrescar.

## Review Focus

1. **La sonda reenvía el mismo lote** porque se perdió la respuesta: no se duplica ninguna comprobación ni señal, y la respuesta cuenta los duplicados. Prueba en la Tarea 7.
2. **El reloj de la PC de la oficina está desfasado** varios minutos: la central guarda `received_at`, el evaluador ordena por orden de llegada (`id`) y no por la hora de la sonda, y `monitor_probes.clock_skew_ms` registra el desfase. Prueba en la Tarea 7.
3. **Se pausa o archiva un servicio (o su servidor) con un incidente abierto:** el incidente se cierra con el evento «Servicio pausado», sin aviso de recuperación, y el ticket recibe un comentario. Prueba en la Tarea 6.
4. **El motor se reinicia a mitad de una verificación** (reintentos pendientes): tras el arranque no se emite ningún `CONFIRMED_FAILURE` sin tres fallos reales, y la cola SQLite no reenvía como nuevos los resultados ya confirmados. Prueba en la Tarea 11.
5. **El worker cae entre crear el ticket y guardar `ticket_id`** en el incidente: al volver no se crea un segundo ticket. Prueba en la Tarea 9.

---

## Estructura de archivos

```
packages/monitoring-core/
  package.json, tsconfig.json, jest.config.js
  src/index.ts            exporta todo
  src/types.ts            tipos compartidos
  src/schedule.ts         franjas en hora de Lima y desfase por servicio
  src/checks.ts           pruebas TCP/HTTPS/ICMP
  src/tracker.ts          confirmación, recuperación, degradación por (servicio, sonda)
  src/office-outage.ts    regla de caída del internet de la oficina
  src/runner.ts           ejecutor: franjas, reintentos, concurrencia, sin solapes
  test/*.spec.ts
backend/scripts/sync-monitoring-core.mjs
backend/sql/migrations/029_monitoreo_nucleo.sql
backend/src/modules/monitoring/
  core/                   COPIA GENERADA de packages/monitoring-core/src
  entities/*.entity.ts
  domain/diagnose.ts           tabla de cruce de sondas
  domain/incident-rules.ts     agrupación por servidor, reapertura, cierre
  domain/combined-state.ts     estado combinado de un servicio
  domain/ticket-text.ts        asunto y texto del ticket automático
  probe-token.guard.ts
  monitoring-ingest.controller.ts / monitoring-ingest.service.ts
  monitoring-inventory.controller.ts / monitoring-inventory.service.ts
  monitoring-state.controller.ts / monitoring-state.service.ts
  monitoring-tickets.service.ts
  monitoring-evaluator.service.ts
  monitoring.module.ts
  monitoring-worker.module.ts
backend/src/monitoring-worker.ts
backend/src/modules/tickets/domain/client-visibility.ts   (regla de la decisión 21)
desktop/engine/
  package.json, tsconfig.json, jest.config.js
  src/config.ts  src/outbox.ts  src/central-client.ts  src/engine.ts
  src/local-api.ts  src/main.ts  src/service/install.ts  src/service/uninstall.ts
  test/*.spec.ts
web/src/api/monitoring.api.ts
web/src/pages/monitoring/{MonitoringStatePage,MonitoringIncidentsPage,MonitoringIncidentDetailPage,MonitoringInventoryPage,MonitoringProbesPage}.tsx
```

---

### Task 1: `monitoring-core` — tipos y planificador en hora de Lima

**Files:**
- Create: `packages/monitoring-core/{package.json,tsconfig.json,jest.config.js}`, `src/types.ts`, `src/schedule.ts`, `src/index.ts`
- Test: `packages/monitoring-core/test/schedule.spec.ts`

**Interfaces:**
- Produces (`src/types.ts`):
  ```ts
  export type Protocol = 'TCP' | 'HTTPS' | 'ICMP';
  export type CheckKind = 'REGULAR' | 'RETRY' | 'MANUAL' | 'CROSS';
  export type Criticality = 'HIGH' | 'MEDIUM' | 'LOW';
  export interface ServiceTarget { id: number; protocol: Protocol; target: string; port: number | null; latencyThresholdMs: number; }
  export interface CheckResult { id: string /* UUID v4 */; serviceId: number; kind: CheckKind; cycleAt: string /* ISO */; startedAt: string; durationMs: number; ok: boolean; errorCode: CheckErrorCode | null; httpStatus: number | null; orderId: number | null; }
  export type CheckErrorCode = 'TIMEOUT' | 'REFUSED' | 'DNS' | 'TLS' | 'HTTP_STATUS' | 'NETWORK';
  export interface ScheduleConfig { dayStartHour: number; nightStartHour: number; dayIntervalMin: number; nightIntervalMin: number; }
  ```
- Produces (`src/schedule.ts`):
  - `DEFAULT_SCHEDULE: ScheduleConfig = { dayStartHour: 7, nightStartHour: 22, dayIntervalMin: 5, nightIntervalMin: 1 }`
  - `LIMA_OFFSET_MINUTES = -300`
  - `intervalMsAt(instant: Date, cfg: ScheduleConfig): number`
  - `serviceOffsetMs(serviceId: number): number`: `((serviceId * 37) % 60) * 1000`
  - `nextCycleAt(serviceId: number, after: Date, cfg: ScheduleConfig): Date`: el primer instante estrictamente posterior a `after` que cae en una franja alineada al reloj de Lima (`:00, :05, …` de día; cada minuto de noche) más el desfase del servicio.

- [ ] **Step 1: Crear el paquete** con `package.json` (`"name": "@kubo/monitoring-core"`, `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`, scripts `build: tsc`, `test: jest`; devDependencies `typescript`, `jest`, `ts-jest`, `@types/jest`, `@types/node` en las versiones que ya usa `backend/package.json`). `jest.config.js` fuerza `process.env.TZ = 'UTC'` igual que `backend/jest.config.js` y además corre la suite dos veces en CI local: una vez así y otra con `TZ=America/Lima npx jest` (paso 4) para probar que no depende de la zona del proceso.

- [ ] **Step 2: Write the failing test** `test/schedule.spec.ts`
  ```ts
  const lima = (s: string) => new Date(`${s}-05:00`);
  it('de día cada 5 min, de noche cada 1 min', () => {
    expect(intervalMsAt(lima('2026-11-23T06:59:59'), DEFAULT_SCHEDULE)).toBe(60_000);
    expect(intervalMsAt(lima('2026-11-23T07:00:00'), DEFAULT_SCHEDULE)).toBe(300_000);
    expect(intervalMsAt(lima('2026-11-23T21:59:59'), DEFAULT_SCHEDULE)).toBe(300_000);
    expect(intervalMsAt(lima('2026-11-23T22:00:00'), DEFAULT_SCHEDULE)).toBe(60_000);
  });
  it('alinea al reloj de Lima con el desfase del servicio', () => {
    // serviceOffsetMs(1) = 37 s
    expect(nextCycleAt(1, lima('2026-11-23T10:01:00'), DEFAULT_SCHEDULE)).toEqual(lima('2026-11-23T10:05:37'));
    expect(nextCycleAt(1, lima('2026-11-23T23:10:40'), DEFAULT_SCHEDULE)).toEqual(lima('2026-11-23T23:11:37'));
  });
  it('al cruzar las 22:00 pasa a la franja de 1 min sin saltarse la de las 22:00', () => {
    expect(nextCycleAt(1, lima('2026-11-23T21:55:37'), DEFAULT_SCHEDULE)).toEqual(lima('2026-11-23T22:00:37'));
    expect(nextCycleAt(1, lima('2026-11-23T22:00:37'), DEFAULT_SCHEDULE)).toEqual(lima('2026-11-23T22:01:37'));
  });
  it('al cruzar las 07:00 pasa a la franja de 5 min', () => {
    expect(nextCycleAt(1, lima('2026-11-24T06:59:37'), DEFAULT_SCHEDULE)).toEqual(lima('2026-11-24T07:00:37'));
    expect(nextCycleAt(1, lima('2026-11-24T07:00:37'), DEFAULT_SCHEDULE)).toEqual(lima('2026-11-24T07:05:37'));
  });
  ```
- [ ] **Step 3: Run** `cd packages/monitoring-core && npm install && npx jest test/schedule.spec.ts` → FAIL (módulo inexistente).
- [ ] **Step 4: Implement** `src/types.ts`, `src/schedule.ts` y `src/index.ts`. La franja se decide con la hora de Lima del **inicio de la franja candidata**: se calcula en minutos desde la medianoche de Lima con `LIMA_OFFSET_MINUTES`, nunca con la zona del proceso.
- [ ] **Step 5: Run** `npx jest` y luego `TZ=America/Lima npx jest` → PASS en las dos.
- [ ] **Step 6: Commit** `feat(monitoring-core): tipos y planificador en hora de Lima`

---

### Task 2: `monitoring-core` — pruebas TCP, HTTPS e ICMP

**Files:**
- Create: `packages/monitoring-core/src/checks.ts`
- Test: `packages/monitoring-core/test/checks.spec.ts`

**Interfaces:**
- Consumes: tipos de la Task 1.
- Produces:
  - `DEFAULT_TIMEOUTS_MS: Record<Protocol, number> = { TCP: 5000, HTTPS: 10000, ICMP: 5000 }`
  - `runCheck(target: ServiceTarget, kind: CheckKind, cycleAt: Date, opts?: { timeoutsMs?: Partial<Record<Protocol, number>>; orderId?: number | null; now?: () => Date }): Promise<CheckResult>`: nunca lanza; todo fallo se devuelve como `ok: false` con `errorCode`.
  - `type CheckFn = typeof runCheck`
- TCP: `target` es el host y `port` el puerto. HTTPS: `target` es la URL completa (`https://…`); `GET` con `redirect: 'manual'`; éxito con 2xx o 3xx; guarda `httpStatus`. ICMP: `ping` del sistema (`-n 1 -w <ms>` en Windows, `-c 1 -W <s>` en Linux) o un socket propio, a elección del constructor (spec, «Lo que queda al constructor»).

- [ ] **Step 1: Write the failing tests** contra servidores locales levantados en la prueba (`net.createServer`, `https.createServer` con un certificado autofirmado generado en la prueba):
  - `TCP: puerto que escucha → ok true, errorCode null, durationMs >= 0`
  - `TCP: puerto cerrado → ok false, errorCode 'REFUSED'`
  - `TCP: host que no responde (10.255.255.1) con timeout 300 ms → ok false, errorCode 'TIMEOUT', durationMs < 1000`
  - `HTTPS: certificado autofirmado → ok false, errorCode 'TLS'` (prueba de que TLS nunca se desactiva)
  - `HTTPS: 503 → ok false, errorCode 'HTTP_STATUS', httpStatus 503`. Para tener HTTP válido sin desactivar TLS, la prueba inyecta la CA autofirmada con `NODE_EXTRA_CA_CERTS` en un proceso hijo, o se usa el puerto HTTP de `undici` MockAgent; a elección del constructor, pero sin ninguna opción `rejectUnauthorized: false` en `checks.ts`.
  - `HTTPS: 302 → ok true, httpStatus 302`
  - `DNS: host inexistente (nohost.invalid) → errorCode 'DNS'`
  - `el resultado trae un UUID v4 nuevo en cada llamada, kind y cycleAt tal como se pasaron`
- [ ] **Step 2: Run** `npx jest test/checks.spec.ts` → FAIL.
- [ ] **Step 3: Implement** `runCheck` en `src/checks.ts` con `node:net`, `fetch` de Node 20 con `AbortSignal.timeout` y `crypto.randomUUID()`.
- [ ] **Step 4: Run** → PASS. Comprobar con `grep -rn "rejectUnauthorized" packages/monitoring-core/src` → sin resultados.
- [ ] **Step 5: Commit** `feat(monitoring-core): pruebas TCP, HTTPS e ICMP`

---

### Task 3: `monitoring-core` — confirmación, recuperación, degradación y caída de oficina

**Files:**
- Create: `packages/monitoring-core/src/tracker.ts`, `src/office-outage.ts`
- Test: `packages/monitoring-core/test/tracker.spec.ts`, `test/office-outage.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SignalType = 'VERIFYING' | 'CONFIRMED_FAILURE' | 'TRANSIENT_FAILURE' | 'RECOVERED' | 'DEGRADED' | 'DEGRADATION_CLEARED' | 'OFFICE_OUTAGE_START' | 'OFFICE_OUTAGE_END';
  export interface ProbeSignal { id: string /* UUID */; type: SignalType; serviceId: number | null; at: string; firstFailureAt: string | null; }
  export interface TrackerOptions { retryOffsetsMs: [number, number] /* [30000, 60000] */; recoveryOkCount: number /* 2 */; degradationCycles: number /* 3 */; degradationClearOkCount: number /* 2 */; trackDegradation: boolean; }
  export const DEFAULT_TRACKER: TrackerOptions;
  export type TrackerState = 'OK' | 'VERIFYING' | 'FAILED' | 'DEGRADED';
  export class ServiceProbeTracker {
    constructor(service: ServiceTarget, opts?: Partial<TrackerOptions>);
    onResult(r: CheckResult): ProbeSignal[];
    pendingRetryAt(): Date | null;   // cuándo toca el próximo reintento, o null
    state(): TrackerState;
  }
  export function isOfficeOutage(referencesOk: boolean[], serviceResultsOk: boolean[]): boolean;
  ```
- Reglas (spec, «Confirmación», «Degradación», «Recuperación»): fallo REGULAR → `VERIFYING` y reintentos en `primerFallo + 30 s` y `+ 60 s`; tres fallos → `CONFIRMED_FAILURE` con `firstFailureAt`; un reintento correcto → `TRANSIENT_FAILURE` y vuelve a `OK`; en `FAILED`, dos correctos seguidos (de cualquier tipo) → `RECOVERED`. Con `trackDegradation`, tres REGULAR correctos seguidos con `durationMs > latencyThresholdMs` → `DEGRADED`; en `DEGRADED`, dos correctos bajo el umbral → `DEGRADATION_CLEARED`. Los resultados `MANUAL` y `CROSS` no inician verificación (los evalúa la central) pero sí cuentan para la recuperación. `isOfficeOutage`: todas las referencias fallan **y** fallan al menos `ceil(n/2)` destinos (con `n ≥ 1`).

- [ ] **Step 1: Write the failing tests** (con un ayudante `res(kind, ok, at, durationMs?)`):
  - `fallo regular + dos reintentos fallidos → [VERIFYING], [], [CONFIRMED_FAILURE con firstFailureAt del primero]`
  - `pendingRetryAt devuelve primerFallo+30s y luego primerFallo+60s, y null tras confirmar`
  - `fallo regular + reintento correcto → TRANSIENT_FAILURE y state OK`
  - `tras confirmar: un correcto no recupera; el segundo seguido emite RECOVERED`
  - `tras confirmar: correcto, fallo, correcto → no recupera` (deben ser seguidos)
  - `3 regulares lentos → DEGRADED; 2 rápidos → DEGRADATION_CLEARED; con trackDegradation false nunca DEGRADED`
  - `2 lentos y 1 rápido → no degrada` (deben ser seguidos)
  - `un CROSS fallido en OK no emite VERIFYING`
  - `isOfficeOutage([false,false],[false,false,true,true]) === true; ([false,true],[false,false]) === false; ([false,false],[false,true,true]) === false`
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `ServiceProbeTracker` y `isOfficeOutage`. Cada señal lleva un `crypto.randomUUID()` propio: la central deduplica por él.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(monitoring-core): confirmación, recuperación y degradación`

---

### Task 4: `monitoring-core` — ejecutor de la sonda

**Files:**
- Create: `packages/monitoring-core/src/runner.ts`, `src/clock.ts`
- Test: `packages/monitoring-core/test/runner.spec.ts`, `test/fake-clock.ts`

**Interfaces:**
- Consumes: `nextCycleAt`, `intervalMsAt`, `runCheck`/`CheckFn`, `ServiceProbeTracker`, `isOfficeOutage`.
- Produces:
  ```ts
  export interface Clock { now(): Date; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void; }
  export const systemClock: Clock;
  export interface RunnerOptions {
    services: ServiceTarget[]; schedule: ScheduleConfig; concurrency: number /* 16 */;
    clock: Clock; check: CheckFn; tracker?: Partial<TrackerOptions>;
    references?: ServiceTarget[];          // solo la oficina: 1.1.1.1 y 8.8.8.8 (ICMP o TCP 443/53, a elección del constructor)
    onResult(result: CheckResult, signals: ProbeSignal[]): void;
  }
  export class ProbeRunner {
    constructor(opts: RunnerOptions);
    start(): void; stop(): void;
    updateServices(services: ServiceTarget[]): void;      // altas, bajas y cambios sin reiniciar
    runNow(serviceId: number, kind: 'MANUAL' | 'CROSS', orderId: number | null): void;
    states(): Map<number, TrackerState>;
    officeOutage(): boolean;
  }
  ```
- Garantías: una sola prueba en curso por servicio; si un reintento coincide con la franja regular siguiente, **se omite la regular** y el reintento queda como `RETRY`; un `runNow` sobre un servicio con prueba en curso se encola detrás de ella, no en paralelo; nunca más de `concurrency` pruebas en vuelo. Con `references`, en cada franja regular se prueban las referencias y, si `isOfficeOutage` pasa a verdadero o a falso, se emite **una** señal `OFFICE_OUTAGE_START`/`END` (con `serviceId: null`) por `onResult` de la primera prueba de la franja.

- [ ] **Step 1: Write `test/fake-clock.ts`** (reloj manual con `advance(ms)` que ejecuta los temporizadores vencidos y espera las promesas pendientes) **and the failing tests**:
  - `cada servicio recibe exactamente una prueba REGULAR por franja durante 2 h simuladas cruzando las 22:00`
  - `un reintento que cae en la franja siguiente sustituye a la regular: en ningún instante hay dos pruebas del mismo servicio en vuelo` (la `check` falsa registra entradas y salidas y la prueba afirma un máximo de 1 por servicio)
  - `nunca más de 16 pruebas en vuelo`
  - **Carga (spec, «Cuándo el piloto está listo»):** `50 servicios, franja de 1 min, 10 de ellos tardan 10 s y fallan: durante 10 min simulados cada servicio sano empieza su prueba regular a menos de 15 s de su cycleAt y ninguna franja se pierde`
  - `runNow durante una prueba en curso espera a que termine`
  - `updateServices quita un servicio: no se le programan más pruebas`
  - `referencias y la mitad de los destinos caen: una sola OFFICE_OUTAGE_START; al volver, una sola OFFICE_OUTAGE_END`
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `ProbeRunner` con una cola de prioridad por instante y un semáforo de concurrencia; un `ServiceProbeTracker` por servicio.
- [ ] **Step 4: Run** `npx jest` (toda la suite del paquete) → PASS.
- [ ] **Step 5: Commit** `feat(monitoring-core): ejecutor con franjas, reintentos y concurrencia`

---

### Task 5: Copia de `monitoring-core` en el backend, migración 029 y entidades

**Files:**
- Create: `backend/scripts/sync-monitoring-core.mjs`, `backend/src/modules/monitoring/core/**` (generado), `backend/sql/migrations/029_monitoreo_nucleo.sql`, `backend/src/modules/monitoring/entities/*.entity.ts`
- Modify: `backend/package.json` (`"prebuild": "node scripts/sync-monitoring-core.mjs --check --skip-if-missing"`), `backend/Dockerfile` (añadir `COPY scripts ./scripts` antes de `RUN npm run build` en la etapa `builder`), `backend/src/modules/tickets/entities/ticket.entity.ts:20-50` (`'MONITOREO'` en `TicketOrigin` y `TICKET_ORIGINS`), `web/src/api/types.ts` y `web/src/pages/tickets/ticket-ui.ts` (origen `MONITOREO`, etiqueta «Monitoreo»)
- Test: `backend/src/modules/monitoring/entities/entities.spec.ts`

**Interfaces:**
- Produces, tablas de la migración (todas InnoDB, utf8mb4, instantes `DATETIME(3)` en UTC):
  - `monitor_servers` (`id`, `client_id` FK `clients`, `name`, `host`, `role`, `provider`, `region`, `status ENUM('ACTIVE','PAUSED','ARCHIVED')`, `agent_token_hash NULL`, `agent_last_seen_at NULL`, timestamps)
  - `monitor_services` (`id`, `server_id` FK, `system_id NULL` FK `client_systems`, `name`, `protocol ENUM('TCP','HTTPS','ICMP')`, `target`, `port NULL`, `latency_threshold_ms INT DEFAULT 1500`, `criticality ENUM('HIGH','MEDIUM','LOW') DEFAULT 'MEDIUM'`, `schedule_override JSON NULL`, `status ENUM('ACTIVE','PAUSED','ARCHIVED')`, `last_manual_check_at NULL`, timestamps)
  - `monitor_probes` (`id`, `code` único, `kind ENUM('OFFICE','DATACENTER')`, `token_hash NULL`, `token_created_at NULL`, `last_seen_at NULL`, `version NULL`, `clock_skew_ms INT NULL`); **filas semilla** `('oficina-01','OFFICE')` y `('kubo-01','DATACENTER')`
  - `monitor_checks` (`id CHAR(36)`, `probe_id`, `service_id`, `kind ENUM`, `cycle_at`, `started_at`, `duration_ms`, `ok`, `error_code NULL`, `http_status NULL`, `order_id NULL`, `received_at`); **PK `(probe_id, id)`**; índice `(service_id, probe_id, started_at)`
  - `monitor_probe_signals` (`id BIGINT` autoincremental, `uuid CHAR(36)`, `probe_id`, `service_id NULL`, `type ENUM(...SignalType)`, `at`, `first_failure_at NULL`, `received_at`, `processed_at NULL`, `awaiting_cross_until NULL`, `cross_order_id NULL`); **único `(probe_id, uuid)`**; índice `(processed_at, id)`
  - `monitor_probe_orders` (`id`, `probe_id`, `service_id`, `kind ENUM('MANUAL','CROSS')`, `created_at`, `taken_at NULL`, `done_at NULL`)
  - `monitor_probe_states` (`service_id`, `probe_id`, `state ENUM('OK','VERIFYING','FAILED','DEGRADED')`, `last_check_at NULL`, `last_ok NULL`, `last_latency_ms NULL`, `updated_at`); PK `(service_id, probe_id)`
  - `monitor_incidents` (`id`, `service_id NULL`, `server_id`, `parent_id NULL`, `kind ENUM('DOWN','ROUTE','DEGRADED')`, `first_failure_at`, `confirmed_at`, `recovered_at NULL`, `close_reason ENUM('RECOVERED','SERVICE_PAUSED') NULL`, `ticket_id NULL`, `acknowledged_by NULL`, `acknowledged_at NULL`); columna generada `open_service_id = IF(recovered_at IS NULL AND service_id IS NOT NULL, service_id, NULL)` con **índice único** (garantiza un solo incidente abierto por servicio), y lo mismo para el incidente de servidor: `open_server_parent = IF(recovered_at IS NULL AND service_id IS NULL, server_id, NULL)` único
  - `monitor_incident_events` (`id`, `incident_id`, `at`, `type VARCHAR(40)`, `detail JSON NULL`, `author_user_id NULL`)
  - `monitor_office_outages` (`id`, `probe_id`, `started_at`, `ended_at NULL`, `affected_services INT`)
  - `monitor_client_settings` (`client_id` PK FK, `portal_availability_visible TINYINT(1) NOT NULL DEFAULT 0`, `updated_at`, `updated_by NULL`)
  - `ALTER TABLE tickets MODIFY origin ENUM(<todos los valores actuales>, 'MONITOREO') NOT NULL DEFAULT 'NOTE'` (leer la definición vigente con `SHOW CREATE TABLE tickets` antes de escribirla; el procedimiento la aplica solo si `'MONITOREO'` no está en `information_schema.COLUMNS.COLUMN_TYPE`)
  - `INSERT ... SELECT ... WHERE NOT EXISTS` del usuario `monitoreo@sistema.kubo` (decisión 2 de este plan)
- Produces: entidades TypeORM `MonitorServer`, `MonitorService`, `MonitorProbe`, `MonitorCheck`, `MonitorProbeSignal`, `MonitorProbeOrder`, `MonitorProbeState`, `MonitorIncident`, `MonitorIncidentEvent`, `MonitorOfficeOutage`, `MonitorClientSettings`, con los nombres de columna anteriores en camelCase.
- Produces: `MONITORING_ACTOR_EMAIL = 'monitoreo@sistema.kubo'` en `backend/src/modules/monitoring/monitoring.constants.ts`.

- [ ] **Step 1: Write `sync-monitoring-core.mjs`** copiando `packages/monitoring-core/src/**/*.ts` a `backend/src/modules/monitoring/core/` con una cabecera «GENERADO — no editar; fuente: packages/monitoring-core/src»; `--check` sale con código 1 si difiere; `--skip-if-missing` sale con 0 si no existe la fuente.
- [ ] **Step 2: Run** `cd backend && node scripts/sync-monitoring-core.mjs && node scripts/sync-monitoring-core.mjs --check` → código 0. Editar a mano un archivo de `core/` y repetir `--check` → código 1; restaurar.
- [ ] **Step 3: Write the failing test** `entities.spec.ts`: construye un `DataSource` de TypeORM con las entidades nuevas sin conectar (`new DataSource({ type: 'mysql', entities: [...] }).buildMetadatas()`) y afirma `MonitorCheck` tiene clave primaria `['probeId','id']`, `MonitorProbeSignal` tiene índice único `['probeId','uuid']`, y `TICKET_ORIGINS` incluye `'MONITOREO'`.
- [ ] **Step 4: Run** `npx jest src/modules/monitoring/entities` → FAIL.
- [ ] **Step 5: Implement** migración, entidades, constante y los cambios de `origin` en backend y web.
- [ ] **Step 6: Apply the migration twice** contra la base local de desarrollo (`docker compose -f docker-compose.dev.yml up -d mysql`, luego `mysql ... < backend/sql/migrations/029_monitoreo_nucleo.sql` dos veces) → la segunda vez sin errores ni cambios. Comprobar `SELECT code, kind FROM monitor_probes` → 2 filas y `SELECT is_active FROM users WHERE email='monitoreo@sistema.kubo'` → 0.
- [ ] **Step 7: Run** `npx jest src/modules/monitoring/entities && npm run build` → PASS y build sin errores; `cd ../web && npm run build` → sin errores.
- [ ] **Step 8: Commit** `feat(monitoring): migración 029, entidades y origen MONITOREO`

---

### Task 6: Inventario, sondas y opciones por cliente (API del personal)

**Files:**
- Create: `backend/src/modules/monitoring/monitoring-inventory.service.ts`, `monitoring-inventory.controller.ts`, `dto/*.dto.ts`, `monitoring.module.ts`
- Modify: `backend/src/app.module.ts` (importar `MonitoringModule`)
- Test: `backend/src/modules/monitoring/monitoring-inventory.service.spec.ts`

**Interfaces:**
- Consumes: entidades de la Task 5; `ClientsService.findByIdOrFail`; `ClientSystemsRepository` (para validar que `systemId` pertenece al cliente del servidor).
- Produces (todas bajo `@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)`, prefijo `/monitoring`):
  - `GET/POST /servers`, `PATCH /servers/:id` (incluye `status`)
  - `GET /services?serverId=`, `POST /services`, `PATCH /services/:id` (incluye `status`)
  - `POST /services/test` con cuerpo `{ serviceId }` → `CheckResult` (ejecuta `runCheck` una vez desde el backend; solo servicios del inventario)
  - `GET /probes` → `{ id, code, kind, lastSeenAt, version, clockSkewMs, hasToken }[]`
  - `POST /probes/:id/token` → `{ token }` en claro **una sola vez** (`kmp_` + 32 bytes aleatorios en base64url); guarda `sha256` hex
  - `DELETE /probes/:id/token` → revoca
  - `PUT /clients/:clientId/monitoring-settings` `{ portalAvailabilityVisible: boolean }`
  - `MonitoringInventoryService.setServiceStatus(id, status, actorUserId)` y `setServerStatus(...)`: al pasar a `PAUSED` o `ARCHIVED` cierran los incidentes abiertos afectados con `close_reason = 'SERVICE_PAUSED'` llamando a `MonitoringEvaluatorService.closeForPause(serviceIds, actorUserId)` (Task 9). Hasta que exista la Task 9, la prueba usa un doble.
- Validación: `protocol HTTPS` exige `target` con `https://`; `TCP` exige `port` 1–65535; `systemId` debe pertenecer al cliente del servidor (400 `BAD_INPUT` si no).

- [ ] **Step 1: Write the failing tests** (con dobles de repositorio, estilo `ticket-transitions.service.spec.ts`):
  - `crear servicio HTTPS con target http:// → BAD_INPUT`
  - `crear servicio con systemId de otro cliente → BAD_INPUT`
  - `emitir token devuelve kmp_… y guarda solo su sha256; una segunda lectura de probes no trae el token`
  - `pausar un servicio con incidente abierto llama a closeForPause([id], actor)` (Review Focus 3)
  - `archivar un servidor llama a closeForPause con todos sus servicios`
- [ ] **Step 2: Run** `npx jest src/modules/monitoring/monitoring-inventory` → FAIL.
- [ ] **Step 3: Implement** servicio, DTO con `class-validator`, controlador y módulo.
- [ ] **Step 4: Run** → PASS; `npm run build` → OK.
- [ ] **Step 5: Commit** `feat(monitoring): inventario, tokens de sonda y opciones por cliente`

---

### Task 7: Ingesta de la sonda de oficina

**Files:**
- Create: `backend/src/modules/monitoring/probe-token.guard.ts`, `monitoring-ingest.service.ts`, `monitoring-ingest.controller.ts`, `dto/ingest.dto.ts`, `domain/combined-state.ts`
- Test: `monitoring-ingest.service.spec.ts`, `probe-token.guard.spec.ts`, `domain/combined-state.spec.ts`, `monitoring-ingest.integration.spec.ts` (con `test-utils/test-http-app.ts`)

**Interfaces:**
- Consumes: entidades; tipos `CheckResult`, `ProbeSignal`, `ServiceTarget`, `ScheduleConfig` desde `./core`.
- Produces:
  - `ProbeTokenGuard`: `Authorization: Bearer <token>` → busca `monitor_probes` por `sha256(token)`; 401 si no existe o no tiene token; deja `req.probe: MonitorProbe`.
  - `MonitoringIngestService.acceptBatch(probe: MonitorProbe, batch: { checks: CheckResult[]; signals: ProbeSignal[]; version: string }, receivedAt: Date): Promise<{ acceptedChecks: number; duplicateChecks: number; acceptedSignals: number; duplicateSignals: number }>`: `INSERT IGNORE` por `(probe_id, id)` y `(probe_id, uuid)`; actualiza `last_seen_at`, `version` y `clock_skew_ms` (= mediana de `receivedAt − startedAt` del lote menos `durationMs`, redondeada); actualiza `monitor_probe_states.last_check_at/last_ok/last_latency_ms`; marca `done_at` de las órdenes cuyo `orderId` llega. **La usa también el worker** (Task 10) para la sonda `kubo-01`.
  - `MonitoringIngestService.sync(probe, configVersion: string | null): Promise<SyncResponse>`
    ```ts
    interface SyncResponse { configVersion: string; config: { services: ServiceTarget[]; schedule: ScheduleConfig; references: ServiceTarget[] } | null /* null si no cambió */; orders: { id: number; serviceId: number; kind: 'MANUAL' | 'CROSS' }[]; state: CombinedStateRow[]; }
    ```
    `configVersion` = sha256 del JSON canónico de servicios `ACTIVE` + horario + referencias. Las órdenes devueltas quedan con `taken_at`.
  - Rutas: `POST /api/v1/monitoring/ingest/office/batch` (máx. 500 checks, 200 señales, cuerpo ≤ 1 MB, `@Throttle` 60/min por sonda), `GET /api/v1/monitoring/ingest/office/sync?configVersion=`. Ambas con `ProbeTokenGuard` y **sin** `JwtAuthGuard`.
  - `domain/combined-state.ts`:
    ```ts
    export type CombinedStatus = 'OK' | 'VERIFYING' | 'DEGRADED' | 'DOWN' | 'ROUTE' | 'NO_DATA';
    export interface ProbeView { state: TrackerState; lastCheckAt: Date | null; lastLatencyMs: number | null; }
    export interface CombinedStateRow { serviceId: number; serverId: number; clientId: number; serviceName: string; serverName: string; criticality: Criticality; office: ProbeView | null; datacenter: ProbeView | null; status: CombinedStatus; incidentId: number | null; parentIncidentId: number | null; ticketCode: string | null; }
    export function combineStatus(office: ProbeView | null, dc: ProbeView | null, openIncidentKind: 'DOWN' | 'ROUTE' | 'DEGRADED' | null, now: Date, intervalMs: number): CombinedStatus;
    ```
    Prioridad: incidente `DOWN` → `DOWN`; `ROUTE` → `ROUTE`; alguna sonda `VERIFYING` o `FAILED` sin incidente → `VERIFYING`; `DEGRADED` → `DEGRADED`; las dos sin comprobación en `3 × intervalMs` → `NO_DATA`; si no, `OK`.

- [ ] **Step 1: Write the failing tests:**
  - guard: `token válido → deja req.probe; token desconocido → 401; sin cabecera → 401; sonda con token revocado → 401`
  - `acceptBatch dos veces con el mismo lote → la segunda devuelve 0 aceptados y N duplicados en checks y señales` (Review Focus 1)
  - `checks con startedAt 10 min en el futuro se aceptan, received_at es la hora de la central y clock_skew_ms ≈ -600000` (Review Focus 2)
  - `sync con la configVersion vigente → config null; tras editar un servicio → config con la lista nueva`
  - `sync entrega cada orden una sola vez`
  - `combineStatus`: un caso por fila de la regla de prioridad, más `NO_DATA` con las dos sondas sin datos en 3 franjas
  - integración: `POST /api/v1/monitoring/ingest/office/batch` con un JWT de personal en vez de token de sonda → 401; con token válido y cuerpo de 501 checks → 400
- [ ] **Step 2: Run** `npx jest src/modules/monitoring` → FAIL en las nuevas.
- [ ] **Step 3: Implement** guard, DTO (validan UUID, ISO, enums y topes), servicio, controlador y `combined-state.ts`.
- [ ] **Step 4: Run** → PASS; `npm run build` → OK.
- [ ] **Step 5: Commit** `feat(monitoring): ingesta de la sonda de oficina y estado combinado`

---

### Task 8: Tickets automáticos ocultos al cliente (decisión 21)

**Files:**
- Create: `backend/src/modules/tickets/domain/client-visibility.ts`, `backend/src/modules/monitoring/domain/ticket-text.ts`, `backend/src/modules/monitoring/monitoring-tickets.service.ts`
- Modify: `backend/src/modules/tickets/tickets.repository.ts` (`TicketListFilters` + `list`, `listForClientPeriod`, `countResolvedInPeriod`, nuevo `findByLabel`, nuevo `isVisibleToClient`), `backend/src/modules/portal/portal-tickets.service.ts:112-134`, `backend/src/modules/portal/portal-reports.service.ts:~250`, y **cualquier otra lectura de tickets con identidad de cliente** (buscar con `grep -rn "tickets\.\(list\|find\|count\)" backend/src/modules/portal backend/src/modules/notifications`; cubrir cada una)
- Test: `tickets/domain/client-visibility.spec.ts`, `portal/portal-tickets.service.spec.ts` (ampliar), `portal/portal-reports.service.spec.ts` (ampliar), `notifications/domain/notification-rules.spec.ts` (ampliar), `monitoring/monitoring-tickets.service.spec.ts`, `monitoring/domain/ticket-text.spec.ts`

**Interfaces:**
- Produces (`client-visibility.ts`), **único lugar de la regla**:
  ```ts
  /** Fragmento SQL que aplica la regla sobre el alias de `tickets`. */
  export function clientVisibilityCondition(alias: string): string;
  // `${alias}.origin <> 'MONITOREO' OR EXISTS (SELECT 1 FROM monitor_client_settings s WHERE s.client_id = ${alias}.client_id AND s.portal_availability_visible = 1)`
  ```
- Produces (repositorio): `TicketListFilters.clientFacing?: boolean`; `listForClientPeriod(clientId, from, to, opts: { clientFacing: boolean })` y `countResolvedInPeriod(clientId, from, to, opts: { clientFacing: boolean })` con `opts` **obligatorio** (que cada llamador decida; el compilador señala a todos); `isVisibleToClient(ticketId: number): Promise<boolean>`; `findByLabel(label: string): Promise<Ticket | null>`.
- Portal: `PortalTicketsService.list` pasa `clientFacing: true`; `detail` responde el mismo `ticketNotFound()` si `!isVisibleToClient`; `PortalReportsService.monthly` pasa `clientFacing: true`. Llamadores del personal pasan `clientFacing: false`.
- Produces (`ticket-text.ts`): `buildIncidentTicket(input: { kind: 'DOWN' | 'ROUTE'; serviceNames: string[]; serverName: string; firstFailureAt: Date; confirmedAt: Date; diagnosis: string }): { subject: string; rawText: string }`. Asunto `Caída: <servicio> (<servidor>)` o `Sin acceso desde Perú: <servicio> (<servidor>)`; con varios servicios, `Caída del servidor <servidor> (<n> servicios)`. Las horas con `formatPeruDateTime`.
- Produces (`MonitoringTicketsService`):
  - `ensureTicket(incident: MonitorIncident, ctx: { clientId: number; systemId: number | null; criticality: Criticality; serviceNames: string[]; serverName: string }): Promise<Ticket>`: si `findByLabel('monitoreo:incidente:<id>')` encuentra un ticket, lo devuelve; si no, `TicketsService.create({ kind: 'STAFF', userId: monitoringUserId }, dto)` con `origin 'MONITOREO'`, `requestType 'INCIDENCIA'`, `serviceCategory 'SOPORTE'`, `impact 'ALTO'` y `urgency` `ALTA`/`MEDIA`/`BAJA` según criticidad (→ P1/P2/P3 por la matriz existente), `labels: ['monitoreo', 'monitoreo:incidente:<id>']`; después fija `escalationLevel 'N1'` con `TicketsRepository.update`. Nunca asigna.
  - `raisePriority(ticketId, criticality)`: usa `TicketAssignmentService.overridePriority` (leer su firma en `ticket-assignment.service.ts:160`) con el usuario de monitoreo y el motivo «Se sumó un servicio más crítico al incidente de servidor». Solo sube, nunca baja.
  - `reopenOrReplace(incident, ticketId, ctx): Promise<Ticket>`: `RESUELTO` → `TicketTransitionsService.transition({ toStatus: 'EN_ATENCION', reason: 'El servicio volvió a caer antes de 30 minutos de recuperado.', actorUserId })`; `CERRADO` o transición no permitida (`canTransition` falso) → ticket nuevo vía `ensureTicket` cuyo `rawText` empieza por «Continúa el incidente del ticket <código anterior>»; abierto → solo comentario.
  - `comment(ticketId, text, payload)`: `TicketEventsService.record({ type: 'COMMENT', actorUserId: monitoringUserId, reason: text, payload: { source: 'MONITOREO', ...payload } })`.
  - `monitoringUserId` se resuelve una vez por email (`MONITORING_ACTOR_EMAIL`) y falla al arrancar si no existe («Falta el usuario de monitoreo: aplicar la migración 029»).

- [ ] **Step 1: Write the failing tests:**
  - portal list: `cliente con portal desactivado no ve el ticket MONITOREO y sí los demás; activado lo ve` (sobre una base real si el repositorio ya tiene pruebas de integración de MySQL; si no, se prueba que `list` añade `clientVisibilityCondition` cuando `clientFacing` es verdadero y no cuando es falso, y la condición se prueba en `client-visibility.spec.ts` como texto)
  - portal detail: `ticket MONITOREO oculto → la misma excepción que un ticket inexistente`
  - portal informe: `listForClientPeriod y countResolvedInPeriod reciben clientFacing: true`
  - notificaciones: `plansForEvent({ type: 'CREATED', origin: 'MONITOREO', hasClientAuthor: false, … })` → sin plan `CLIENT` ni `TEAM`
  - `ticket-text`: un caso DOWN, uno ROUTE y uno de servidor con 3 servicios; las horas en Lima
  - `ensureTicket` sin ticket previo → crea con P1 para HIGH, P2 para MEDIUM, P3 para LOW, `escalationLevel 'N1'`, sin `assigneeUserId`, etiqueta correcta
  - `ensureTicket` con un ticket que ya tiene la etiqueta → no crea otro (Review Focus 5)
  - `reopenOrReplace`: RESUELTO → transición con motivo; CERRADO → ticket nuevo que cita el código anterior; EN_ATENCION → solo comentario
  - `raisePriority` de P2 a P1 → llama a `overridePriority`; de P1 con LOW → no hace nada
- [ ] **Step 2: Run** `npx jest src/modules/tickets src/modules/portal src/modules/notifications src/modules/monitoring` → FAIL en las nuevas.
- [ ] **Step 3: Implement** la regla, los cambios de repositorio y portal, `ticket-text.ts` y `MonitoringTicketsService`. Registrar `MonitoringTicketsService` en `MonitoringModule` (que importa `TicketsModule` y `UsersModule`).
- [ ] **Step 4: Run** `npx jest` (suite completa del backend) → PASS; `npm run build` → OK.
- [ ] **Step 5: Commit** `feat(tickets): tickets de monitoreo ocultos al cliente hasta validar`

---

### Task 9: Evaluador — señales a incidentes

**Files:**
- Create: `backend/src/modules/monitoring/domain/diagnose.ts`, `domain/incident-rules.ts`, `monitoring-evaluator.service.ts`
- Test: `domain/diagnose.spec.ts`, `domain/incident-rules.spec.ts`, `monitoring-evaluator.service.spec.ts`

**Interfaces:**
- Consumes: entidades, `MonitoringTicketsService` (Task 8), `MonitoringIngestService` no (el evaluador solo lee tablas).
- Produces (`diagnose.ts`), la tabla de la spec «Cruce de sondas»:
  ```ts
  export type Diagnosis = { kind: 'DOWN' | 'ROUTE'; label: string } | { kind: 'NONE'; label: string };
  export function diagnose(input: { reporter: 'OFFICE' | 'DATACENTER'; crossOk: boolean | null /* null = no llegó en 2 min */; officeOutage: boolean }): Diagnosis;
  ```
  OFFICE+cruce falla → DOWN «Sin respuesta confirmada»; OFFICE+cruce responde → ROUTE «Sin acceso desde Perú»; OFFICE+null → ROUTE (se reclasifica al llegar); DATACENTER+oficina falla → DOWN; DATACENTER+oficina responde → NONE «Problema de la sonda del servidor»; DATACENTER+(null u `officeOutage`) → DOWN. Un `CONFIRMED_FAILURE` de la oficina con `officeOutage` verdadero no llega a `diagnose`: se descarta antes.
- Produces (`incident-rules.ts`):
  - `GROUPING_WINDOW_MS = 180_000`, `REOPEN_WINDOW_MS = 1_800_000`, `CROSS_TIMEOUT_MS = 120_000`
  - `groupDecision(newConfirmedAt: Date, openSiblings: { incidentId: number; confirmedAt: Date; parentId: number | null }[], openServerParentId: number | null): { action: 'ALONE' } | { action: 'JOIN_PARENT'; parentId: number } | { action: 'CREATE_PARENT'; siblingIds: number[] }`
  - `reopenCandidate(lastClosed: { id: number; kind: string; recoveredAt: Date; closeReason: string } | null, now: Date): number | null`: solo `DOWN`/`ROUTE` cerrados por `RECOVERED` hace menos de 30 min.
  - `recoveryCloses(kind: 'DOWN' | 'ROUTE' | 'DEGRADED', office: TrackerState | null, dc: TrackerState | null): boolean`: DOWN exige las dos sondas en `OK` (o la oficina sin datos por caída de oficina); ROUTE exige la oficina en `OK`; DEGRADED exige que llegue `DEGRADATION_CLEARED`.
- Produces (`MonitoringEvaluatorService`):
  - `tick(now: Date): Promise<void>`: procesa en orden de `id` las señales con `processed_at IS NULL`, de a 200, cada una en su transacción:
    - `OFFICE_OUTAGE_START/END` → abre o cierra `monitor_office_outages` (`affected_services` = destinos fallidos de esa franja).
    - `VERIFYING`/`TRANSIENT_FAILURE` → actualiza `monitor_probe_states`.
    - `CONFIRMED_FAILURE` de la oficina con caída de oficina abierta → se marca procesada sin más.
    - `CONFIRMED_FAILURE` sin incidente abierto → crea la orden `CROSS` para la otra sonda (oficina: fila en `monitor_probe_orders`; `kubo-01`: llama al `crossCheck(serviceId)` inyectado por el worker) y deja `awaiting_cross_until = now + 2 min`; no la marca procesada.
    - `CONFIRMED_FAILURE` de `kubo-01` con incidente `ROUTE` abierto → pasa a `DOWN`, evento `UPGRADED_TO_DOWN`, comentario en el ticket.
    - Señales en espera: si llegó el resultado `CROSS` (check de la otra sonda con `order_id = cross_order_id`, o `kind CROSS` posterior a la señal para `kubo-01`) o venció `awaiting_cross_until` → `diagnose`. `NONE` → evento en la sonda, sin incidente. `DOWN`/`ROUTE` → `reopenCandidate`; si no hay, abre incidente nuevo; aplica `groupDecision`; luego `ensureTicket` (sobre el padre si lo hay; `raisePriority` si el servicio que entra es más crítico; si se crea el padre, hereda el `ticket_id` del primer hijo y el ticket recibe un comentario con la lista de servicios).
    - `RECOVERED` → actualiza el estado; si `recoveryCloses`, fija `recovered_at`, `close_reason 'RECOVERED'`, evento `RECOVERED` y comentario en el ticket con la duración (aunque el ticket esté resuelto; decisión 20); un padre se cierra cuando se cierra su último hijo, y el comentario va una sola vez, en el padre.
    - `DEGRADED`/`DEGRADATION_CLEARED` de la oficina → abre o cierra el incidente `DEGRADED`, sin ticket.
    - Al final, reintenta `ensureTicket` de incidentes `DOWN`/`ROUTE` abiertos con `ticket_id` nulo (recuperación tras caída del worker).
  - `closeForPause(serviceIds: number[], actorUserId: number): Promise<void>`: cierra con `close_reason 'SERVICE_PAUSED'`, evento «Servicio pausado», comentario en el ticket, **sin** evento `RECOVERED`.

- [ ] **Step 1: Write the failing tests** de dominio (puros):
  - `diagnose`: una prueba por fila de la tabla anterior
  - `groupDecision`: segundo servicio a los 2 min → `CREATE_PARENT`; a los 4 min → `ALONE`; con padre abierto → `JOIN_PARENT`
  - `reopenCandidate`: cerrado hace 29 min → id; 31 min → null; cerrado por `SERVICE_PAUSED` → null
  - `recoveryCloses`: DOWN con oficina OK y servidor FAILED → false; con las dos OK → true; ROUTE con oficina OK → true
- [ ] **Step 2: Write the failing tests** del servicio (dobles de repositorio y de `MonitoringTicketsService`), con los escenarios de la spec:
  - `HTTPS caído con TCP operativo`: solo el servicio HTTPS abre incidente y ticket
  - `ROUTE`: oficina confirma, cruce del servidor responde → ROUTE con ticket; luego el servidor confirma → mismo incidente pasa a DOWN, sin ticket nuevo
  - `cruce que no llega`: a los 2 min se abre ROUTE con la información disponible
  - `servidor confirma y oficina responde` → ningún incidente, ningún ticket
  - `caída de oficina`: `OFFICE_OUTAGE_START` y luego `CONFIRMED_FAILURE` de 5 servicios de la oficina → cero incidentes, una fila en `monitor_office_outages`
  - `dos servicios del mismo servidor en 2 min` → un padre, un ticket, prioridad del más crítico
  - `recae a los 10 min de recuperado` → mismo incidente y `reopenOrReplace`
  - `tick procesado dos veces seguidas (reinicio)` → no duplica incidentes ni tickets
  - `incidente abierto sin ticket_id` → `ensureTicket` en el siguiente tick (Review Focus 5)
  - `closeForPause` → cierra sin `RECOVERED` y comenta (Review Focus 3)
  - `recuperación con ticket RESUELTO` → comentario igual (decisión 20)
- [ ] **Step 3: Run** `npx jest src/modules/monitoring` → FAIL en las nuevas.
- [ ] **Step 4: Implement** `diagnose.ts`, `incident-rules.ts` y `MonitoringEvaluatorService`. Conectar `closeForPause` en `MonitoringInventoryService` (Task 6) en lugar del doble.
- [ ] **Step 5: Run** `npx jest` → PASS; `npm run build` → OK.
- [ ] **Step 6: Commit** `feat(monitoring): evaluador de señales, cruce de sondas e incidentes`

---

### Task 10: Contenedor `monitor-worker`

**Files:**
- Create: `backend/src/monitoring-worker.ts`, `backend/src/modules/monitoring/monitoring-worker.module.ts`, `backend/src/modules/monitoring/datacenter-probe.service.ts`, `backend/src/modules/monitoring/monitoring-purge.service.ts`, `backend/src/config/typeorm.options.ts`
- Modify: `backend/src/app.module.ts` (usar `typeorm.options.ts`), `docker-compose.yml` y `docker-compose.dev.yml` (servicio `monitor-worker`), `deploy.sh` y `README.md` (migración 029 y el servicio nuevo)
- Test: `datacenter-probe.service.spec.ts`, `monitoring-purge.service.spec.ts`

**Interfaces:**
- Consumes: `ProbeRunner`, `runCheck` (de `./core`), `MonitoringIngestService.acceptBatch`, `MonitoringEvaluatorService.tick` y `crossCheck`.
- Produces:
  - `typeOrmOptionsFactory(config: ConfigService): TypeOrmModuleOptions` extraída de `app.module.ts` sin cambiar su comportamiento; la usan los dos módulos raíz.
  - `MonitoringWorkerModule`: `ConfigModule`, `ScheduleModule`, `TypeOrmModule.forRootAsync(typeOrmOptionsFactory)`, `BullModule.forRootAsync` igual que `AppModule` si alguna dependencia de `TicketsModule` lo necesita (comprobar arrancando), `MonitoringModule`.
  - `monitoring-worker.ts`: `NestFactory.createApplicationContext(MonitoringWorkerModule)`, `enableShutdownHooks()`, log `Monitor worker iniciado (kubo-01)`.
  - `DatacenterProbeService` (`OnApplicationBootstrap`/`OnApplicationShutdown`): crea un `ProbeRunner` con `trackDegradation: false`, sin referencias, servicios `ACTIVE` del inventario (recarga cada 60 s con `updateServices`), y `onResult` → `acceptBatch(probe kubo-01, { checks: [r], signals, version: 'worker' })`. Expone `crossCheck(serviceId)` → `runner.runNow(serviceId, 'CROSS', null)`. Cada 5 s toma las órdenes pendientes de `kubo-01` en `monitor_probe_orders` (las crea «Probar ahora» desde el backend, Task 12), las marca `taken_at` y las ejecuta con `runNow(serviceId, kind, orderId)`. Ejecuta `MonitoringEvaluatorService.tick(new Date())` cada 5 s, sin solaparse (si un tick sigue en curso, el siguiente se salta).
  - `MonitoringPurgeService`: `@Cron('0 0 3 * * *', { timeZone: 'America/Lima' })` → borra `monitor_checks` con `started_at < now − 90 días` y `monitor_probe_signals` procesadas con la misma antigüedad, en lotes de 5000 hasta vaciar.
  - `docker-compose.yml`: servicio `monitor-worker` con el mismo `build` y `environment` de base de datos que `backend`, `command: ["node", "dist/monitoring-worker.js"]`, `mem_limit: 512m`, `restart: unless-stopped`, `depends_on` mysql (healthy) y redis; sin puertos ni entrada en el `Caddyfile`.

- [ ] **Step 1: Write the failing tests:**
  - `DatacenterProbeService`: con `ProbeRunner` y reloj falsos, un resultado se entrega a `acceptBatch` con la sonda `kubo-01`; `crossCheck(7)` llama `runNow(7, 'CROSS', null)`; una orden `MANUAL` pendiente de `kubo-01` se toma una sola vez y llama `runNow(id, 'MANUAL', orderId)`; un tick lento no se solapa con el siguiente
  - `MonitoringPurgeService`: con un doble que devuelve 5000, 5000 y 12 filas borradas, ejecuta tres lotes y para
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** lo anterior y actualizar compose, `deploy.sh` (paso «aplicar 029» en la lista de migraciones manuales y levantar `monitor-worker`) y `README.md` (una sección corta «Monitoreo»).
- [ ] **Step 4: Run** `npx jest` → PASS; `npm run build` → OK, y `ls dist/monitoring-worker.js` existe.
- [ ] **Step 5: Smoke local:** `docker compose -f docker-compose.dev.yml up -d --build monitor-worker`, cargar por la API del personal (Task 6) un servidor de prueba con un servicio TCP a `127.0.0.1:9` (puerto cerrado), esperar 3 min → `SELECT kind, ok FROM monitor_checks ORDER BY started_at DESC LIMIT 5` muestra REGULAR y RETRY fallidos de `kubo-01`, y `docker compose logs monitor-worker` no tiene errores. Borrar el servidor de prueba (archivarlo).
- [ ] **Step 6: Commit** `feat(monitoring): contenedor monitor-worker con sonda kubo-01 y purga`

---

### Task 11: Motor de la oficina (`desktop/engine`)

**Files:**
- Create: `desktop/engine/{package.json,tsconfig.json,jest.config.js}`, `src/config.ts`, `src/outbox.ts`, `src/central-client.ts`, `src/engine.ts`, `src/local-api.ts`, `src/main.ts`, `src/service/install.ts`, `src/service/uninstall.ts`, `README.md`
- Test: `desktop/engine/test/outbox.spec.ts`, `test/engine.spec.ts`, `test/local-api.spec.ts`

**Interfaces:**
- Consumes: `@kubo/monitoring-core` (`ProbeRunner`, `runCheck`, tipos); API de la Task 7.
- Produces:
  - `config.ts`: `loadEngineConfig(): EngineConfig` desde `%ProgramData%\KUBO\Monitor\engine.json` → `{ centralUrl: string; probeCode: 'oficina-01'; localPort: number /* 47800 */; syncIntervalMs: 15000 }`; `loadProbeToken(): string` desde `token.dat` protegido con DPAPI (ámbito máquina; librería a elección del constructor); `loadLocalSecret(): string` desde `local-api.secret` (lo crea el instalador).
  - `Outbox` (better-sqlite3, `%ProgramData%\KUBO\Monitor\engine.db`): `enqueueCheck(r: CheckResult)`, `enqueueSignal(s: ProbeSignal)`, `peekBatch(max: number): { checks: CheckResult[]; signals: ProbeSignal[] }` (orden de inserción), `ack(checkIds: string[], signalIds: string[])`, `saveConfig(version: string, json: string)`, `loadConfig(): { version: string; json: string } | null`, `pendingCount(): number`.
  - `CentralClient`: `sync(configVersion: string | null): Promise<SyncResponse>`, `sendBatch(batch): Promise<{ acceptedChecks; duplicateChecks; acceptedSignals; duplicateSignals }>`; `fetch` con `Authorization: Bearer`, tiempo de espera 10 s, validación TLS normal.
  - `Engine`: `constructor({ config, outbox, central, clock, check })`, `start()`, `stop()`, `status(): EngineStatus`.
    ```ts
    interface EngineStatus { engine: { version: string; startedAt: string }; central: { reachable: boolean; lastSyncAt: string | null; consecutiveFailures: number }; officeOutage: boolean; pending: number; services: CombinedStateRow[]; }
    ```
    Cada 15 s: envía lotes de hasta 500/200 mientras haya pendientes y la central responda; `sync`; aplica configuración nueva con `runner.updateServices` y la guarda en el `Outbox`; ejecuta las órdenes con `runner.runNow`. `central.reachable` pasa a `false` tras **3** sondeos fallidos seguidos. Si la central no responde, `services` es el último estado recibido con el estado local del `ProbeRunner` superpuesto en la columna de oficina. Al arrancar sin red usa la configuración guardada.
  - `local-api.ts`: `startLocalApi(engine, { port, secret }): http.Server` escuchando **solo en `127.0.0.1`**; `GET /v1/status` → `EngineStatus`; exige cabecera `X-Kubo-Secret` (401 si falta o no coincide); cualquier otra ruta 404.
  - `service/install.ts`: registra el servicio de Windows «KUBO Monitor Engine» con inicio automático, reinicio ante fallo y cuenta de mínimos privilegios; crea `%ProgramData%\KUBO\Monitor\` con su ACL (SYSTEM, Administradores y el usuario de escritorio indicado por argumento), el secreto local y `logs\` con rotación. Librería de servicio a elección del constructor (spec, «Lo que queda al constructor»).

- [ ] **Step 1: Write the failing tests:**
  - `Outbox`: `encolar, peek, ack → pendingCount 0`; `reabrir la base conserva lo pendiente`; `ack de ids desconocidos no falla`
  - `Engine` (central falsa y reloj falso):
    - `central caída en 3 sondeos → central.reachable false; los resultados se acumulan; al volver la central se vacía la cola y cada id llega una sola vez`
    - `config nueva en sync → updateServices con la lista nueva y se guarda en el Outbox`
    - `orden CROSS → runNow(serviceId,'CROSS',orderId) y el resultado lleva orderId`
    - `arranque sin red con config guardada → empieza a medir con ella`
    - **Reinicio a mitad de verificación** (Review Focus 4): `fallo regular, se detiene el motor antes de los reintentos, se arranca otro Engine sobre el mismo Outbox → ningún CONFIRMED_FAILURE hasta tres fallos nuevos, y los resultados previos se envían una sola vez`
  - `local-api`: `sin secreto → 401; con secreto → 200 con EngineStatus; el servidor escucha en 127.0.0.1` (afirmar `server.address().address === '127.0.0.1'`)
- [ ] **Step 2: Run** `cd desktop/engine && npm install && npx jest` → FAIL.
- [ ] **Step 3: Implement** los módulos, `main.ts` (carga config, crea `Outbox`, `CentralClient`, `Engine` con `systemClock` y `runCheck`, arranca la API local) y los scripts de instalación. `README.md` del motor: cómo instalar, dónde están config, token y registros, y cómo emitir el token desde la pantalla Sondas.
- [ ] **Step 4: Run** `npx jest` → PASS; `npm run build` → OK.
- [ ] **Step 5: Smoke en esta PC:** instalar el servicio apuntando a la central local de desarrollo, con un token emitido desde `POST /monitoring/probes/:id/token`; reiniciar Windows **sin iniciar sesión** durante 2 min (o detener y arrancar el servicio si no se puede reiniciar ahora y anotarlo como pendiente) → `monitor_probes.last_seen_at` de `oficina-01` se actualiza; `curl -H "X-Kubo-Secret: …" http://127.0.0.1:47800/v1/status` devuelve el estado.
- [ ] **Step 6: Commit** `feat(desktop): motor de la oficina como servicio de Windows`

---

### Task 12: API de estado e incidentes para el personal

**Files:**
- Create: `backend/src/modules/monitoring/monitoring-state.service.ts`, `monitoring-state.controller.ts`
- Test: `monitoring-state.service.spec.ts`

**Interfaces:**
- Consumes: `combineStatus`, entidades, `TicketsRepository.findById` (para `ticketCode`).
- Produces (bajo `/monitoring`, guardas del personal):
  - `GET /state?clientId=&status=&serverId=` → `CombinedStateRow[]`, ordenado: `DOWN`, `ROUTE`, `VERIFYING`, `DEGRADED`, `NO_DATA`, `OK`, y por nombre
  - `GET /state.csv` con los mismos filtros → CSV (`;` como separador, UTF-8 con BOM; mismo formato que `web/src/lib/csv.ts` si aplica)
  - `POST /services/:id/check-now` → crea órdenes `MANUAL` en `monitor_probe_orders` para las dos sondas (la oficina las recoge en su `sync`; `kubo-01` las recoge el worker, Task 10); **429** si `last_manual_check_at` es de hace menos de 15 s
  - `GET /incidents?open=true|false&clientId=&from=&to=` → `IncidentListRow[]` (`id, kind, serviceName | null, serverName, clientName, firstFailureAt, confirmedAt, recoveredAt, durationMinutes, ticketId, ticketCode, childCount`)
  - `GET /incidents/:id` → `{ incident, children: IncidentListRow[], events: MonitorIncidentEvent[], checks: { office: CheckRow[]; datacenter: CheckRow[] } /* últimas 30 de cada sonda alrededor del incidente */, diagnosis: string, winmtrTarget: string /* host del servidor */ }`
  - `POST /incidents/:id/ack` → `acknowledged_by/at` y evento `ACKNOWLEDGED`
  - `POST /incidents/:id/notes` `{ text }` → evento `NOTE` con `author_user_id`

- [ ] **Step 1: Write the failing tests:** orden de `GET /state`; filtro por cliente no devuelve servicios de otro cliente; `check-now` dos veces en 10 s → la segunda 429; detalle trae hijos y eventos en orden cronológico; `ack` dos veces no duplica el evento.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx jest` → PASS; `npm run build` → OK.
- [ ] **Step 5: Commit** `feat(monitoring): API de estado e incidentes para el personal`

---

### Task 13: Pantallas del personal (Estado, Incidentes, Inventario, Sondas)

**Files:**
- Create: `web/src/api/monitoring.api.ts`, `web/src/pages/monitoring/MonitoringStatePage.tsx`, `MonitoringIncidentsPage.tsx`, `MonitoringIncidentDetailPage.tsx`, `MonitoringInventoryPage.tsx`, `MonitoringProbesPage.tsx`, `monitoring-ui.ts`
- Modify: `web/src/App.tsx` (rutas), `web/src/layout/AppLayout.tsx` (sección «Monitoreo» de la barra lateral)

**Interfaces:**
- Consumes: rutas de las Tasks 6 y 12; tipos copiados a mano en `monitoring.api.ts` (la web no importa del backend; mismo criterio que `ticket-ui.ts`).
- Produces: rutas `/monitoring` (Estado), `/monitoring/incidents`, `/monitoring/incidents/:id`, `/monitoring/inventory`, `/monitoring/probes`. `monitoring-ui.ts` con `STATUS_LABELS: Record<CombinedStatus, string>` = `{ OK: 'Operativo', VERIFYING: 'Verificando', DEGRADED: 'Degradado', DOWN: 'Caído', ROUTE: 'Sin acceso desde Perú', NO_DATA: 'Sin datos' }` y sus colores (rojo DOWN/ROUTE, ámbar VERIFYING/DEGRADED, gris NO_DATA, verde OK).
- Comportamiento (referencia visual: prototipo, vista «Central»):
  - **Estado:** tabla con columnas «Servicio», «Servidor», «Cliente», «Desde Perú», «Desde servidor», «Estado», «Ticket»; filtros cliente/estado/servidor; botón «Probar ahora» (deshabilitado 15 s tras usarlo; muestra el 429 como «Espera unos segundos»); «Exportar CSV»; refresco cada 15 s con `refetchInterval`.
  - **Incidentes:** pestañas «Abiertos» y «Cerrados»; fila de incidente de servidor desplegable en sus servicios; clic → detalle.
  - **Detalle:** diagnóstico, enlace al ticket (`/tickets/:id`), lo que vio cada sonda (dos listas de comprobaciones), cronología, «Reconocer», notas, «Copiar destino WinMTR» (copia `winmtrTarget` al portapapeles). «Adjuntar WinMTR» queda para la Entrega 3: no se muestra.
  - **Inventario:** servidores por cliente con sus servicios; alta y edición en un formulario lateral (cliente, sistema del cliente, protocolo, destino, puerto, umbral, criticidad); «Pausar», «Archivar» (con confirmación que avisa que cierra incidentes abiertos); «Probar configuración».
  - **Sondas:** las dos sondas con última conexión, versión y desfase de reloj; «Emitir token» (muestra el token una sola vez con botón copiar y el aviso «No se volverá a mostrar») y «Revocar»; por cliente, el interruptor «Mostrar disponibilidad y tickets de monitoreo en el portal» con confirmación.

- [ ] **Step 1: Implement** `monitoring.api.ts` con el patrón de `clients.api.ts`.
- [ ] **Step 2: Implement** las cinco páginas, las rutas y la sección de la barra lateral.
- [ ] **Step 3: Run** `cd web && npm run build` → sin errores de TypeScript ni de Vite.
- [ ] **Step 4: Verificación manual** con backend y worker locales levantados: cargar un servidor de prueba con un servicio TCP a un puerto cerrado y otro a uno abierto; en Estado el primero pasa a «Verificando» y luego a «Caído» o «Sin acceso desde Perú», el segundo queda «Operativo»; aparece el incidente con su ticket `KB-…` en la bandeja de tickets con origen «Monitoreo», prioridad P2 (criticidad media) y sin asignado; entrando al portal como usuario de ese cliente el ticket **no** aparece; activar el interruptor en Sondas → aparece; desactivarlo de nuevo. Abrir el puerto → «Operativo» y el incidente cerrado con su comentario en el ticket. Comparar a ojo con el prototipo.
- [ ] **Step 5: Commit** `feat(web): sección Monitoreo (estado, incidentes, inventario y sondas)`

---

### Task 14: Aceptación de la Entrega 1

**Files:**
- Create: `docs/superpowers/plans/2026-11-23-monitoreo-entrega-1-aceptacion.md` (resultado de cada criterio, con fecha y evidencia)

- [ ] **Step 1: Run** las tres suites: `cd packages/monitoring-core && npx jest`, `cd backend && npx jest`, `cd desktop/engine && npx jest` → todo PASS; `cd backend && node scripts/sync-monitoring-core.mjs --check` → 0.
- [ ] **Step 2: Comprobar en el entorno local**, uno por uno, los criterios de la spec que caen en esta entrega y anotar el resultado:
  - tras reiniciar la PC y antes de iniciar sesión, la central recibe mediciones de la oficina;
  - el cambio de las 07:00 y las 22:00 cambia la frecuencia sin pruebas duplicadas (consulta sobre `monitor_checks` de esa franja);
  - un fallo aislado queda en el historial sin incidente; tres intentos fallidos abren un incidente y un ticket; la recuperación cierra el mismo incidente;
  - HTTPS caído con TCP operativo; falla solo desde Perú (ROUTE); caída del internet de la oficina (desconectar el cable: ningún ticket, una fila en `monitor_office_outages`); central detenida (el motor acumula y vacía la cola al volver); reinicio del backend y del worker con un incidente abierto (sin duplicar incidente ni ticket);
  - un ticket automático no aparece en el portal del cliente ni cuenta en el SLA de su informe con el portal desactivado; al activarlo aparece.
- [ ] **Step 3:** Presentar el documento de aceptación al usuario antes de cargar `VMI2571371` en producción. Cargarlo solo con su visto bueno.

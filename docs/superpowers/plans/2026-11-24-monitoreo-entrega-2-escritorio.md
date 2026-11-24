# Monitoreo · Entrega 2 (Escritorio) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un widget de escritorio pequeño y siempre visible en la PC de la oficina que muestra el estado de los servicios, avisa con notificaciones de Windows solo lo crítico, tiene icono en la bandeja y resume al iniciar sesión lo ocurrido; y la central avisa por correo si una sonda deja de reportar.

**Architecture:** El motor de la oficina (Entrega 1) gana un **diario de eventos** en su SQLite: compara cada estado nuevo con el anterior y registra las transiciones que importan (caída, recuperación, caída de oficina, central sin respuesta), marcando cuáles merecen notificación. El widget (Electron) habla solo con la API local del motor: lee `/v1/status` para pintar y `/v1/events` para notificar y resumir; él mismo detecta si el motor no responde. En el backend, un vigilante revisa cada minuto el último contacto de cada sonda y escribe a los administradores.

**Tech Stack:** Electron (TypeScript, React 18 en el renderer, Vite), Jest + ts-jest para la lógica pura; el motor existente (Node 20, better-sqlite3); backend NestJS 10 + TypeORM + MySQL 8.

**Spec:** `docs/superpowers/specs/2026-11-23-monitoreo-disponibilidad-design.md` — secciones «El widget», «Notificaciones de Windows», «Vigilancia de las propias sondas», decisiones 4, 10, 17 y 19. Prototipo visual: `docs/superpowers/specs/prototipos/2026-11-23-monitoreo-v2.html`, vista «PC de oficina».

**Rama:** `feat/monitoreo-escritorio`, creada desde `feat/monitoreo-nucleo` (Entrega 1 construida, sin fusionar aún a `main`).

**Fuera de esta entrega:** la fila «Disco con menos del 10 % libre» de la tabla de notificaciones depende del agente de servidor (Entrega 3); el widget deja el tipo de evento previsto pero ningún productor lo emite todavía.

## Global Constraints

- Node `>=20 <21` para backend y motor. El widget usa una versión estable de Electron (su Node interno es el suyo; el widget no usa módulos nativos).
- Todo evento queda en el diario del motor aunque Windows haya silenciado la notificación (spec, «Notificaciones de Windows»).
- **El widget habla solo con el motor local por `127.0.0.1`** (decisión 17), con la cabecera `X-Kubo-Secret` leída de `%ProgramData%\KUBO\Monitor\local-api.secret` (ruta base sobreescribible con `KUBO_MONITOR_HOME`, igual que el motor).
- Ventana **sin marco, siempre encima, fijable en cualquier esquina**. Plegada es una barra «KUBO · Todo operativo · hh:mm» (hora de Lima).
- Tonos: **rojo** (caída o sin acceso), **ámbar** (verificando, degradado, central caída o rechazando), **gris** (motor caído); con problema se despliega sola con **una fila por problema**; una caída de servidor es **una fila por servidor** que se despliega en sus servicios (decisión 19). Cada fila: «Perú ✕ · Servidor ✓ · <ticket>».
- Notificaciones de Windows **solo** para: caída confirmada (DOWN) criticidad Alta; sin acceso desde Perú (ROUTE) criticidad Alta; la recuperación de esas dos (un aviso); internet de oficina caído (un aviso agrupado); la central no responde; el motor no responde. **Nunca** para Media/Baja, degradación ni fallos transitorios. Una caída de servidor es **un solo aviso**.
- Cada notificación y cada fila abren el incidente en la web: `<centralUrl>/monitoreo/incidentes/<id>`; «Abrir tablero» abre `<centralUrl>/monitoreo/estado`.
- Arranca con la sesión del usuario, **sin elevación**. Icono de bandeja con: mostrar widget, abrir tablero, ver incidentes, probar notificación, ver salud del monitor.
- Al iniciar sesión, resumen de lo ocurrido mientras no había sesión y lo que sigue activo.
- Central: si no recibe resultados de una sonda durante **10 minutos**, correo al personal (administradores activos); un aviso por silencio y otro al volver.
- Textos visibles en español; código en inglés; comillas simples en TS.
- Commits por tarea en la rama local; sin push ni merge. No leer `.env`, `SECRETS.local.txt` ni credenciales. No instalar servicios ni el widget en la PC del usuario durante el desarrollo.

## Decisiones de este plan

1. **El motor decide qué es un evento; el widget decide cómo mostrarlo.** Así el resumen al iniciar sesión funciona aunque el widget no estuviera abierto: el motor corre como servicio todo el tiempo.
2. **Los eventos solo salen de estado fresco.** Mientras la central no responde, el motor no deriva caídas ni recuperaciones del estado congelado; solo registra «central sin respuesta». Al volver, compara contra el último estado fresco.
3. **El ticket llega a la PC.** `sync` empieza a rellenar `ticketCode` (hoy siempre `null`) con la misma consulta por lotes que usa la API del personal. La PC de la oficina es del personal.
4. **La central vigila a las dos sondas**, no solo a la oficina: el mismo vigilante cubre `kubo-01` (si el worker cae, se deja de medir desde el VPS sin que nadie lo note). Coste: un correo más posible.
5. **Destinatarios del correo:** usuarios activos con rol `ADMIN`. No se crea plantilla editable: es un aviso operativo fijo.
6. **Empaquetado:** `electron-builder` con instalador NSIS **por usuario** (sin elevación) y arranque con la sesión vía `app.setLoginItemSettings({ openAtLogin: true })`.

## Review Focus

1. **El widget arranca antes que el motor** al iniciar sesión: durante los primeros 30 s se muestra gris «Conectando con el motor…» sin notificar «El motor no responde». Prueba en la Task 4.
2. **Un servicio que parpadea** no inunda de avisos: como mucho un aviso por apertura y uno por recuperación de cada incidente, y nunca dos avisos iguales del mismo incidente en 2 minutos. Prueba en las Tasks 1 y 5.
3. **La central deja de responder con incidentes abiertos:** no salen avisos de recuperación falsos desde estado congelado; al volver, si el incidente se cerró mientras tanto, sale un solo aviso de recuperación. Prueba en la Task 1.
4. **La base del motor se recrea** (ids de eventos reinician por debajo del cursor del widget): el widget detecta que su cursor es mayor que el último id y se reinicia sin perder eventos nuevos ni repetir viejos. Prueba en la Task 5.
5. **Otro usuario de Windows abre el widget** y no puede leer el secreto: el widget queda gris con «Sin permiso para leer el monitor», sin cerrarse ni reintentar en bucle. Prueba en la Task 4.

---

## Estructura de archivos

```
backend/src/modules/availability/
  availability-ingest.service.ts           (sync rellena ticketCode)
  probe-silence.watch.ts                   (vigilante de sondas mudas)
  domain/probe-silence.ts                  (regla pura)
backend/sql/migrations/032_disponibilidad_escritorio.sql
desktop/engine/src/
  events/diff-states.ts                    (transiciones → eventos, puro)
  events/event-journal.ts                  (tabla events en el Outbox)
  engine.ts / local-api.ts                 (registrar y exponer eventos)
desktop/widget/
  package.json, tsconfig*.json, jest.config.js, electron-builder.yml, vite.config.ts
  src/shared/types.ts                      (tipos del motor copiados + IPC)
  src/shared/widget-model.ts               (estado → filas, tono, titular; puro)
  src/shared/notify-policy.ts              (eventos → avisos; puro)
  src/shared/login-summary.ts              (resumen; puro)
  src/main/engine-client.ts                (lee secreto, /v1/status, /v1/events)
  src/main/main.ts, window.ts, tray.ts, notifier.ts, store.ts
  src/preload/preload.ts
  src/renderer/{index.html, main.tsx, App.tsx, components/*}
  test/*.spec.ts
```

---

### Task 1: Diario de eventos en el motor

**Files:**
- Create: `desktop/engine/src/events/diff-states.ts`, `desktop/engine/src/events/event-journal.ts`
- Modify: `desktop/engine/src/outbox.ts` (tabla `events`), `desktop/engine/src/engine.ts` (registrar tras cada sync y en cambios de motor), `desktop/engine/src/local-api.ts` (`GET /v1/events`)
- Test: `desktop/engine/test/diff-states.spec.ts`, `test/event-journal.spec.ts`, ampliar `test/engine.spec.ts` y `test/local-api.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type EngineEventKind =
    | 'INCIDENT_OPENED' | 'INCIDENT_RECOVERED' | 'INCIDENT_UPGRADED'
    | 'DEGRADED_STARTED' | 'DEGRADED_CLEARED'
    | 'OFFICE_OUTAGE_STARTED' | 'OFFICE_OUTAGE_ENDED'
    | 'CENTRAL_UNREACHABLE' | 'CENTRAL_BACK' | 'CENTRAL_REJECTING';
  export interface EngineEvent {
    id: number;                 // autoincremental del diario
    at: string;                 // ISO, hora de la PC
    kind: EngineEventKind;
    incidentKey: number | null; // parentIncidentId ?? incidentId (decisión 19)
    incidentKind: 'DOWN' | 'ROUTE' | 'DEGRADED' | null;
    serverName: string | null;
    serviceNames: string[];     // los servicios afectados (uno o varios)
    criticality: 'HIGH' | 'MEDIUM' | 'LOW' | null; // la más alta de los afectados
    ticketCode: string | null;
    notify: boolean;            // regla de la tabla «Notificaciones de Windows»
  }
  export function diffStates(prev: CombinedStateRow[] | null, next: CombinedStateRow[]): Omit<EngineEvent, 'id' | 'at'>[];
  export class EventJournal { constructor(db: Database.Database); append(e: Omit<EngineEvent,'id'>): EngineEvent; after(afterId: number, limit: number): EngineEvent[]; lastId(): number; }
  ```
  `GET /v1/events?after=<id>&limit=<n>` (límite por defecto 200, máximo 500) → `{ lastId: number; events: EngineEvent[] }`, con el mismo secreto que `/v1/status`.
- Reglas de `diffStates`: agrupa filas por `incidentKey`; una clave nueva con estado DOWN/ROUTE → `INCIDENT_OPENED`; una clave que desaparece o deja de estar en DOWN/ROUTE → `INCIDENT_RECOVERED`; ROUTE→DOWN de la misma clave → `INCIDENT_UPGRADED`; DEGRADED análogo. `notify = true` solo para OPENED/RECOVERED/UPGRADED con criticidad `HIGH`. Con `prev === null` (primer estado tras arrancar) no se emite nada.
- En el motor: `diffStates` se llama **solo** tras un `sync` exitoso, contra el último estado fresco (decisión 2). `officeOutage` false→true / true→false → `OFFICE_OUTAGE_*` con `notify = true` (uno por transición). `central.reachable` true→false → `CENTRAL_UNREACHABLE` (`notify = true`), false→true → `CENTRAL_BACK` (`notify = false`); `rejecting` false→true → `CENTRAL_REJECTING` (`notify = true`). Retención del diario: 30 días o 5000 filas, lo que se alcance primero.

- [ ] **Step 1: Write the failing tests:**
  - `diffStates`: abrir DOWN HIGH → 1 evento OPENED con `notify` true; MEDIUM → `notify` false; dos servicios del mismo servidor con el mismo `parentIncidentId` → **un** OPENED con los dos nombres; recuperar → 1 RECOVERED; ROUTE→DOWN → UPGRADED; `prev === null` → []; DEGRADED → DEGRADED_STARTED con `notify` false
  - `EventJournal`: `append` devuelve ids crecientes; `after(id, n)` ordena y limita; retención por filas
  - motor: central cae con un incidente abierto y, mientras tanto, el estado local cambia → **ningún** RECOVERED (Review Focus 3); al volver la central con el incidente cerrado → **un** RECOVERED y un CENTRAL_BACK; caída de oficina → un OFFICE_OUTAGE_STARTED y al terminar un ENDED
  - API local: `/v1/events` sin secreto → 401; `after` y `limit` respetados; `lastId` presente
- [ ] **Step 2: Run** `cd desktop/engine && npx jest` → FAIL en las nuevas.
- [ ] **Step 3: Implement** según las interfaces.
- [ ] **Step 4: Run** `npx jest && npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(desktop): diario de eventos del motor y /v1/events`

---

### Task 2: `sync` entrega el código de ticket

**Files:**
- Modify: `backend/src/modules/availability/availability-ingest.service.ts` (~178), `domain/combined-state-builder.ts` (comentario)
- Test: ampliar `availability-ingest.service.spec.ts`

**Interfaces:**
- Consumes: `TicketsRepository.findCodesByIds(ids)` (ya existe, Entrega 1) y la regla «ticket del incidente o del padre» que usa `availability-state.service.ts` — reutilizarla extrayéndola a una función compartida si hoy vive dentro del servicio de estado.
- Produces: `SyncResponse.state[].ticketCode` relleno.

- [ ] **Step 1: Write the failing test:** `sync con un incidente abierto que tiene ticket → la fila trae ticketCode 'KB-0007'; un hijo trae el código del padre; sin incidente → null; una sola llamada a findCodesByIds`.
- [ ] **Step 2: Run** `cd backend && npx jest src/modules/availability/availability-ingest` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx jest src/modules/availability && npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(disponibilidad): sync entrega el código de ticket a la sonda`

---

### Task 3: La central avisa cuando una sonda deja de reportar

**Files:**
- Create: `backend/src/modules/availability/domain/probe-silence.ts`, `backend/src/modules/availability/probe-silence.watch.ts`, `backend/sql/migrations/032_disponibilidad_escritorio.sql`
- Modify: entidad `MonitorProbe` (columna nueva), `availability.module.ts` (proveedor; importa `EmailModule` y `UsersModule`), las tres listas de migraciones que exige `src/common/migraciones-desplegadas.spec.ts` (deploy.yml, docker-compose.yml, docker-compose.dev.yml)
- Test: `domain/probe-silence.spec.ts`, `probe-silence.watch.spec.ts`

**Interfaces:**
- Migración 032: `ALTER TABLE monitor_probes ADD COLUMN silence_alerted_at DATETIME(3) NULL` (protegida con `information_schema`, patrón de la 028).
- Produces:
  ```ts
  export const PROBE_SILENCE_MS = 600_000;
  export function silenceDecision(p: { lastSeenAt: Date | null; silenceAlertedAt: Date | null; hasToken: boolean; kind: 'OFFICE' | 'DATACENTER' }, now: Date): 'ALERT' | 'RECOVERED' | 'NONE';
  ```
  `ALERT` si `now − lastSeenAt ≥ 10 min` (o `lastSeenAt` nulo y la sonda ya reportó alguna vez — una oficina sin token nunca configurada **no** alerta) y aún no se avisó; `RECOVERED` si ya se avisó y `lastSeenAt` es posterior a `silenceAlertedAt`; si no, `NONE`.
- `ProbeSilenceWatch`: `@Cron('0 * * * * *')` (cada minuto) en el backend; para cada sonda aplica `silenceDecision`; `ALERT` → `EmailService.send` a los ADMIN activos con asunto «Monitoreo: la sonda <code> dejó de reportar» y fija `silence_alerted_at` con una actualización condicional (solo si sigue nulo, para no duplicar); `RECOVERED` → correo «Monitoreo: la sonda <code> volvió a reportar» y limpia la columna. Un fallo de correo se registra y se reintenta en el siguiente minuto (la columna se fija solo tras enviar).

- [ ] **Step 1: Write the failing tests:** una prueba por rama de `silenceDecision` (9 min → NONE; 10 min → ALERT; ya avisada → NONE; vuelve → RECOVERED; oficina sin token y sin `lastSeenAt` → NONE); el vigilante envía un solo correo aunque corra dos veces seguidas; sin ADMIN activos registra un aviso y no falla; si el correo falla no fija la columna.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**, y validar la 032 dos veces en un contenedor desechable (`kubo-mon-e2-mysql`, receta de la Entrega 1), deteniéndolo al final.
- [ ] **Step 4: Run** `cd backend && npx jest && npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(disponibilidad): aviso por correo cuando una sonda deja de reportar`

---

### Task 4: Widget — esqueleto, cliente del motor y modelo de pantalla

**Files:**
- Create: `desktop/widget/{package.json,tsconfig.json,tsconfig.main.json,jest.config.js,vite.config.ts,README.md}`, `src/shared/types.ts`, `src/shared/widget-model.ts`, `src/main/engine-client.ts`, `test/widget-model.spec.ts`, `test/engine-client.spec.ts`

**Interfaces:**
- Consumes: `GET /v1/status` (`EngineStatus` del motor, Task 1 añade `/v1/events`). Los tipos se **copian** a `src/shared/types.ts` (el widget no importa del motor), con comentario de origen.
- Produces:
  ```ts
  export type Tone = 'ok' | 'red' | 'amber' | 'grey';
  export interface WidgetRow { key: string; tone: Tone; title: string; detail: string; incidentId: number | null; children: WidgetRow[] }
  export interface WidgetModel { tone: Tone; headline: string; time: string /* hh:mm Lima */; rows: WidgetRow[]; expanded: boolean }
  export type EngineReach = { kind: 'ok'; status: EngineStatus } | { kind: 'connecting' } | { kind: 'down' } | { kind: 'forbidden' };
  export function deriveModel(reach: EngineReach, now: Date): WidgetModel;
  export class EngineClient { constructor(opts: { home: string; port: number; fetch?: typeof fetch }); status(): Promise<EngineReach>; events(after: number, limit?: number): Promise<{ lastId: number; events: EngineEvent[] }>; }
  ```
- Reglas de `deriveModel`: `connecting` → gris «Conectando con el motor…»; `down` → gris «El motor no responde»; `forbidden` → gris «Sin permiso para leer el monitor»; con estado: una fila por servidor con incidente (`parentIncidentId`) desplegable en sus servicios, una fila por servicio con problema suelto; DOWN/ROUTE → rojo; VERIFYING/DEGRADED → ámbar; central no alcanzable o `rejecting` → fila ámbar «La central no responde» / «La central rechaza los envíos»; caída de oficina → fila ámbar «Sin internet en la oficina»; detalle «Perú ✕ · Servidor ✓ · KB-0007» (✓ OK, ✕ FAILED, … VERIFYING, ~ DEGRADED, – sin datos); sin problemas → ok «KUBO · Todo operativo»; `expanded` = hay filas.
- `EngineClient.status()`: secreto ilegible (EACCES/EPERM) → `forbidden` sin reintentar en bucle (se reintenta cada 60 s); conexión rechazada → `down`; durante los primeros 30 s desde el arranque del widget `down` se informa como `connecting` (Review Focus 1).

- [ ] **Step 1: Write the failing tests** para cada regla de `deriveModel` (incluida la agrupación por servidor con dos servicios y la hora en Lima) y para `EngineClient` (secreto ilegible → `forbidden`; conexión rechazada en el segundo 10 → `connecting`, en el segundo 40 → `down`; 200 → `ok`; envía `X-Kubo-Secret`).
- [ ] **Step 2: Run** `cd desktop/widget && npm install && npx jest` → FAIL.
- [ ] **Step 3: Implement** el paquete (Electron, React, Vite, electron-builder como dependencias; scripts `build`, `test`, `dev`, `dist`) y los dos módulos.
- [ ] **Step 4: Run** `npx jest && npx tsc -p tsconfig.json --noEmit` → PASS.
- [ ] **Step 5: Commit** `feat(widget): cliente del motor y modelo de pantalla`

---

### Task 5: Widget — avisos de Windows

**Files:**
- Create: `desktop/widget/src/shared/notify-policy.ts`, `src/main/notifier.ts`, `src/main/store.ts`, `test/notify-policy.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Toast { title: string; body: string; url: string; dedupeKey: string }
  export function toastsFor(events: EngineEvent[], centralUrl: string, recent: Map<string, number>, now: number): Toast[];
  export function engineDownToast(centralUrl: string): Toast;
  export class WidgetStore { /* JSON en app.getPath('userData') */ get cursor(): number; set cursor(v: number); get corner(): Corner; set corner(c: Corner); get lastSeenAt(): string | null; set lastSeenAt(v: string | null); }
  ```
- `toastsFor`: solo eventos con `notify = true`; títulos: «Caída: <servicio o servidor>», «Sin acceso desde Perú: …», «Recuperado: …», «Sin internet en la oficina», «La central no responde», «La central rechaza los envíos»; cuerpo con servicios, ticket y hora; `url` del incidente (`<centralUrl>/monitoreo/incidentes/<incidentKey>`) o del tablero; descarta un toast con el mismo `dedupeKey` (`kind:incidentKey`) emitido hace menos de 2 min (Review Focus 2).
- `notifier.ts`: `app.setAppUserModelId('com.kubo.monitor.widget')`; `Notification` de Electron; clic → `shell.openExternal(url)` (solo URLs que empiezan por `centralUrl`). El motor caído (paso de `ok` a `down`, no de `connecting`) produce **un** `engineDownToast` hasta que vuelva.
- Cursor: el widget lee `/v1/events?after=<cursor>` cada 5 s; si `lastId < cursor` (base del motor recreada) pone el cursor en 0 y descarta para avisar los eventos con `at` anterior a su arranque (Review Focus 4).

- [ ] **Step 1: Write the failing tests:** OPENED HIGH → un toast con url del incidente; MEDIUM o DEGRADED → ninguno; el mismo OPENED dos veces en 1 min → un toast, a los 3 min → dos; OFFICE_OUTAGE_STARTED → un toast agrupado; url externa a `centralUrl` rechazada por el validador de `notifier`; cursor mayor que `lastId` → reinicio sin repetir eventos viejos.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx jest` → PASS.
- [ ] **Step 5: Commit** `feat(widget): avisos de Windows solo para lo crítico`

---

### Task 6: Widget — ventana, bandeja, resumen al iniciar sesión y empaquetado

**Files:**
- Create: `desktop/widget/src/main/{main.ts,window.ts,tray.ts}`, `src/preload/preload.ts`, `src/renderer/{index.html,main.tsx,App.tsx}`, `src/renderer/components/{Bar.tsx,Rows.tsx,Summary.tsx,Health.tsx}`, `src/shared/login-summary.ts`, `test/login-summary.spec.ts`, `test/window-position.spec.ts`, `electron-builder.yml`, `assets/` (iconos ok/rojo/ámbar/gris)
- Modify: `desktop/widget/README.md`

**Interfaces:**
- Consumes: `deriveModel`, `EngineClient`, `toastsFor`, `WidgetStore`.
- Produces:
  ```ts
  export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  export function positionFor(corner: Corner, workArea: { x: number; y: number; width: number; height: number }, size: { width: number; height: number }, margin?: number): { x: number; y: number };
  export interface LoginSummary { opened: number; recovered: number; officeOutages: number; centralOutages: number; stillActive: WidgetRow[]; lines: string[] }
  export function summarize(events: EngineEvent[], since: string | null, model: WidgetModel): LoginSummary | null; // null si no hubo nada
  ```
- Ventana: `frame: false`, `alwaysOnTop: true` (nivel `'screen-saver'`), `skipTaskbar: true`, `resizable: false`; plegada 320×40, desplegada 320×(40 + 56 por fila, máx. 6 filas con scroll); se despliega sola cuando `model.expanded` pasa a true; arrastrable por la barra, al soltar se acopla a la esquina más cercana (`positionFor`) y se guarda en `WidgetStore`. Renderer con `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; el preload expone solo `onModel`, `onSummary`, `openIncident(id)`, `openDashboard()`, `dismissSummary()`, `setCorner(c)` por IPC tipado.
- Colores iguales a la web (copiar la paleta de `web/src/pages/availability/availability-ui.ts`). Referencia visual: prototipo, vista «PC de oficina».
- Bandeja: icono según tono; menú «Mostrar widget», «Abrir tablero» (`/monitoreo/estado`), «Ver incidentes» (`/monitoreo/incidentes`), «Probar notificación» (toast de prueba), «Salud del monitor» (panel `Health` con versión del motor, central alcanzable, último sync, pendientes, `rejecting`), «Salir».
- Resumen: al arrancar, `summarize(eventos desde lastSeenAt)`; si no es null se muestra el panel `Summary` hasta que el usuario lo cierre; `lastSeenAt` se actualiza cada minuto mientras el widget corre y al salir.
- Arranque con la sesión: `app.setLoginItemSettings({ openAtLogin: true })` al primer inicio; una sola instancia (`requestSingleInstanceLock`).
- `electron-builder.yml`: Windows NSIS `perMachine: false`, `oneClick: true`, sin elevación; `appId: com.kubo.monitor.widget`; nombre «KUBO Monitor».

- [ ] **Step 1: Write the failing tests:** `positionFor` para las cuatro esquinas con margen 12; `summarize`: sin eventos → null; 2 OPENED + 1 RECOVERED + 1 caída de oficina desde `since` → contadores y líneas en español; eventos anteriores a `since` ignorados; `stillActive` = filas actuales.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** ventana, bandeja, renderer, resumen y empaquetado.
- [ ] **Step 4: Run** `npx jest && npm run build && npx electron-builder --win --dir` (genera la carpeta sin instalar) → PASS y existe `dist/win-unpacked/KUBO Monitor.exe`.
- [ ] **Step 5: Smoke sin instalar:** con la central local y el motor en primer plano (receta de la Entrega 1, contenedores `kubo-mon-e2-*`, `KUBO_MONITOR_HOME` temporal), ejecutar `npm run dev` del widget; provocar una caída de un servicio HIGH (puerto cerrado) y su recuperación; capturar pantalla de la barra plegada, de la fila roja desplegada y de los dos avisos; detener todo y los contenedores. Si el entorno no permite ver notificaciones, anotarlo como pendiente del usuario.
- [ ] **Step 6: Commit** `feat(widget): ventana siempre visible, bandeja, resumen y empaquetado`

---

### Task 7: Aceptación de la Entrega 2

**Files:**
- Create: `docs/superpowers/plans/2026-11-24-monitoreo-entrega-2-aceptacion.md`

- [ ] **Step 1: Run** todas las suites: `packages/monitoring-core`, `backend` (más `sync --check` y `build`), `desktop/engine`, `desktop/widget` (`npx jest` y `npm run build`).
- [ ] **Step 2: Documentar**, en el mismo formato que la aceptación de la Entrega 1, cada requisito de las secciones «El widget», «Notificaciones de Windows» y «Vigilancia de las propias sondas» como VERIFICADO (con evidencia del smoke), CUBIERTO POR PRUEBAS o PENDIENTE DEL USUARIO (instalar el widget con el instalador por usuario, comprobar que arranca con la sesión, que las notificaciones no están silenciadas por Windows y que el clic abre el incidente; apagar el motor y ver el aviso; desconectar el cable y ver un solo aviso).
- [ ] **Step 3: Commit** `docs(disponibilidad): aceptación de la Entrega 2`

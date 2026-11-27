# Monitoreo · Entrega 3 (Informe y agente) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar lo que la spec agrupa en la Entrega 3:
- mantenimientos;
- evidencia WinMTR;
- resúmenes diarios;
- informe mensual de disponibilidad del personal;
- agente de servidor y pantalla de Servidores, con avisos de disco y de silencio del agente;
- importación CSV del inventario.

**Architecture:** Todo el cálculo nuevo vive en módulos puros de `backend/src/modules/availability/domain/`, probados con entradas y salidas. Los servicios Nest solo juntan datos y guardan. Los trabajos programados (resumen diario, informe del día 1, purga) corren en el backend, igual que el evaluador: el `monitor-worker` sigue siendo solo la sonda `kubo-01`. El agente es un ejecutable .NET autocontenido en `agent/`. Habla con la central por `POST /api/v1/ingest/probe/agent/samples` con su propio token (`kma_…`). La central entrega al motor de la oficina las alertas de servidor (disco, agente mudo) y la marca de mantenimiento dentro del `sync` que ya existe.

**Tech Stack:** NestJS 10, TypeORM 0.3, MySQL 8 (migraciones SQL manuales), React/Vite, Electron (widget), Node 20 (motor), .NET 10 (agente), xUnit.

**Spec:** `docs/superpowers/specs/2026-11-23-monitoreo-disponibilidad-design.md`.

**Base:** rama `feat/monitoreo-informe`, creada desde `feat/monitoreo-escritorio` (dfe2a0d), en el worktree `C:/LanFnkDev/Proyectos/kubo_documentacion-informe`.

## Decisiones de este plan

Cada una lleva su coste si resulta equivocada.

1. **El agente usa .NET 10, no .NET 8 (desvío de la decisión 11).** .NET 8 dejó de tener soporte el 10-11-2026 y en la PC de desarrollo solo están los SDK 10. El ejecutable es autocontenido: el servidor no necesita nada instalado.
   - *Coste:* ninguno para el servidor. Si se quisiera .NET 8, basta cambiar el `TargetFramework`.
2. **El instalador del agente es un script, no un `.exe` generado.** La web emite el token y descarga `install-kubo-agent.ps1`, que ya lleva la URL de la central y el token. El personal copia ese script junto a `kubo-agent.exe` (se publica con `agent/build.ps1`) y lo ejecuta como administrador.
   - *Coste:* un paso manual de copia por servidor.
3. **El agente no entra al CI.** CI corre en Linux y las pruebas del agente usan DPAPI y el Visor de eventos. Se prueban en Windows con `dotnet test`.
   - *Coste:* una regresión del agente no frena un PR. Se mitiga con la lista de aceptación.
4. **El agente corre como `LocalSystem`.** Leer el estado de IIS (`Microsoft.Web.Administration`) exige permisos de administrador. El agente sigue sin aceptar órdenes y solo envía datos.
5. **Mantenimiento:**
   - El incidente se abre igual (se sigue midiendo).
   - El ticket no se crea mientras la ventana está activa. Queda el evento `MAINTENANCE_SUPPRESSED`.
   - Si al terminar la ventana el incidente sigue abierto, el barrido crea el ticket.
   - En el motor, las filas en mantenimiento se «congelan» (se usa la última fila previa): no hay avisos al entrar ni durante la ventana. Si al salir el servicio sigue caído con otro incidente, se avisa.
   - *Coste:* una recuperación ocurrida durante la ventana se avisa recién al terminarla.
6. **Las dos cifras del cliente son sumas, no promedios:** `1 − ΣDOWN ÷ ΣT` sobre sus servicios. El tiempo medio de recuperación usa los incidentes de primer nivel (`parent_id` nulo), así una caída de servidor cuenta una vez. Los incidentes abiertos al cierre del mes no entran en ese promedio.
7. **Los percentiles mensuales salen de histogramas diarios** (`latency_hist`), no del promedio de percentiles diarios. Se tienen P50/P95 exactos a la cubeta sin releer 90 días de `monitor_checks`.
   - Los recursos del servidor siguen el mismo camino: CPU y RAM en histogramas diarios.
   - Así el informe del día 1 no pierde días por la purga de 30 días de `monitor_agent_samples`.
8. **El informe se puede generar para el mes en curso**, marcado `partial: true`, con `T` hasta el momento de la generación. Sirve para la revisión de los siete días del piloto. Los resúmenes del día en curso no existen todavía: latencia y cobertura llegan hasta ayer.
9. **«Ventanas sin datos»** son:
   - las caídas de oficina (`monitor_office_outages`);
   - los huecos de más de 10 min sin ninguna comprobación de una sonda. El resumen diario los calcula y los guarda en `monitor_probe_gaps`.
10. **La importación CSV recibe el texto en JSON (`{ csv }`, máximo 256 KB), sin multipart.**
    - Detecta `;` o `,` mirando la cabecera (Excel en es-PE guarda con `;`).
    - El cliente y el sistema se buscan por nombre exacto, sin distinguir mayúsculas.
    - Un servicio ya existente (o repetido en el mismo archivo), con el mismo servidor, protocolo, destino y puerto, es duplicado y se salta.
11. **Los avisos del agente:**
    - Disco con menos del 10 % libre: notificación de Windows y fila ámbar en el widget.
    - Agente mudo 10 min: fila ámbar en el widget y correo a los administradores, igual que una sonda muda. No genera notificación de Windows: la tabla de la spec no la pide.

## Global Constraints

- Todos los instantes se guardan en UTC. Los días y meses de resúmenes e informes son de Lima (`America/Lima`, UTC−5 fijo). Para formatear se usan `common/peru-*`.
- La plantilla de las migraciones es la de `035_disponibilidad_nucleo.sql`:
  - `CREATE TABLE IF NOT EXISTS`;
  - índices y columnas protegidos contra `information_schema`, con procedimientos temporales `kubo_*_034`;
  - `USE kubo_devdocs;`.
- Retención:
  - `monitor_checks`: 90 días;
  - `monitor_agent_samples`: 30 días;
  - `monitor_daily_rollups`, `monitor_agent_daily_rollups`, `monitor_probe_gaps` y `monitor_monthly_reports`: 12 meses.
- Las rutas del personal van bajo `/api/v1/availability/*`, con `JwtAuthGuard, StaffOnlyGuard, RolesGuard`. Lo que escribe exige `@Roles('ADMIN')`. La ingesta va bajo `/api/v1/ingest/probe/*`.
- Los tokens se guardan solo como SHA-256 y se muestran una sola vez. Prefijos: `kmp_` para sonda y `kma_` para agente.
- La validación TLS nunca se desactiva, tampoco en el agente.
- Los textos de la interfaz van en español de Perú.
- Pantallas nuevas en el menú «Monitoreo»: `/monitoreo/servidores` y `/monitoreo/disponibilidad`.
- Los tickets automáticos siguen siendo internos (decisión 21): el informe del personal muestra el código del ticket.
- Disco bajo = espacio libre ÷ total < 0,10 en una unidad fija. Agente mudo = 10 min sin muestras (`PROBE_SILENCE_MS`).
- Informe del mes anterior: día 1 a las 08:00 de Lima. Se identifica por `(client_id, month)`, y regenerarlo reemplaza la versión anterior.
- Fórmulas del informe, copiadas de la spec:
  - `T` = minutos del mes − minutos de mantenimiento;
  - Disponibilidad = 1 − DOWN ÷ T;
  - Acceso desde Perú = 1 − (DOWN + ROUTE) ÷ T;
  - duración de un incidente = de `first_failure_at` a `recovered_at`, recortada al mes y sin el mantenimiento superpuesto;
  - cobertura = regulares ejecutadas ÷ esperadas;
  - MTTR = promedio de las duraciones DOWN y ROUTE.
- Ninguna tarea instala servicios en la PC del usuario, la reinicia ni toca servidores del cliente.

## Review Focus

1. **Un incidente que cruza el límite del mes**, o que sigue abierto al generar el informe. Debe contar solo los minutos dentro del mes: no puede dar disponibilidad negativa ni contar el mes siguiente. Lo cubre una prueba en la Task 6.
2. **Un ROUTE que pasó a DOWN a mitad del incidente.** Se separa en la hora del evento `UPGRADED_TO_DOWN`: los minutos previos son ROUTE y los posteriores DOWN. Lo cubre una prueba en la Task 6.
3. **Una ventana de mantenimiento de servidor superpuesta con la caída de un servicio** cuenta una sola vez y no puede dejar `T ≤ 0`. Si `T = 0`, las cifras son `null`, no `NaN`. Lo cubre una prueba en la Task 6.
4. **El reinicio del backend el día 1 antes de las 08:00, o después sin informe.** Se genera una sola vez por cliente, sin duplicados, gracias a la clave única y la actualización. Lo cubre una prueba en la Task 6.
5. **Un CSV guardado por Excel** con BOM, `;`, comillas, filas vacías y `\r\n` se importa sin filas fantasma. Lo cubre una prueba en la Task 8.

---

## Task 1: Migración 034 y entidades

**Files:**
- Create: `backend/sql/migrations/037_disponibilidad_informe.sql`
- Create: `backend/src/modules/availability/entities/` →
  - `monitor-maintenance.entity.ts`
  - `monitor-evidence.entity.ts`
  - `monitor-daily-rollup.entity.ts`
  - `monitor-rollup-day.entity.ts`
  - `monitor-probe-gap.entity.ts`
  - `monitor-agent-sample.entity.ts`
  - `monitor-agent-daily-rollup.entity.ts`
  - `monitor-monthly-report.entity.ts`
- Modify:
  - `entities/monitor-server.entity.ts` (columnas nuevas);
  - `availability.module.ts` (`forFeature`);
  - `entities/entities.spec.ts`.
- Modify (listas de migraciones):
  - `.github/workflows/deploy.yml:189`;
  - `docker-compose.yml`;
  - `docker-compose.dev.yml`;
  - `deploy.sh`.

  La guarda `backend/src/common/migraciones-desplegadas.spec.ts` exige que `037_disponibilidad_informe` aparezca en las tres listas y que el número no se repita.

**Tablas** (todas `BIGINT UNSIGNED` como id autoincremental salvo que se diga otra cosa):

| Tabla | Columnas | Claves e índices |
|---|---|---|
| `monitor_maintenance` | `server_id` NULL, `service_id` NULL, `starts_at`, `ends_at` DATETIME(3), `reason` VARCHAR(255), `created_by` BIGINT, `created_at` | `idx_monitor_maintenance_range (starts_at, ends_at)`; FK a servers/services. Exactamente uno de `server_id` o `service_id` (CHECK) |
| `monitor_evidence` | `incident_id`, `captured_at` DATETIME(3), `origin` ENUM('OFICINA','SERVIDOR','OTRO'), `notes` VARCHAR(1000) NULL, `storage_key` VARCHAR(255), `file_name` VARCHAR(255), `mime_type` VARCHAR(100), `size_bytes` INT, `created_by`, `created_at` | `idx_monitor_evidence_incident (incident_id)`; FK a incidentes |
| `monitor_daily_rollups` | `service_id`, `probe_id`, `date` DATE, `expected`, `executed`, `succeeded` INT, `p50_ms`, `p95_ms` INT NULL, `latency_hist` JSON, `down_minutes`, `route_minutes`, `no_data_minutes` DECIMAL(8,2) | `UNIQUE uq_monitor_daily_rollup (service_id, probe_id, date)`; `idx (date)` |
| `monitor_rollup_days` | `date` DATE PK, `computed_at` DATETIME(3) | — |
| `monitor_probe_gaps` | `probe_id`, `started_at`, `ended_at` DATETIME(3), `cause` ENUM('OFFICE_OUTAGE','PROBE_SILENT'), `date` DATE | `idx (probe_id, started_at)`; `idx (date)` |
| `monitor_agent_samples` | `server_id`, `at` DATETIME(3), `cpu_pct`, `ram_pct` DECIMAL(5,2), `disks`, `iis`, `services` JSON, `event_errors` INT, `agent_version` VARCHAR(40) | `idx_monitor_agent_samples (server_id, at)` |
| `monitor_agent_daily_rollups` | `server_id`, `date`, `samples` INT, `cpu_hist`, `ram_hist` JSON, `disks_close` JSON | `UNIQUE (server_id, date)` |
| `monitor_monthly_reports` | `client_id`, `month` CHAR(7) ('YYYY-MM'), `partial` TINYINT(1), `generated_at` DATETIME(3), `generated_by` BIGINT NULL, `data` JSON | `UNIQUE uq_monitor_monthly_report (client_id, month)` |

- `monitor_servers` suma:
  - `agent_watch_services` JSON NULL;
  - `agent_token_created_at` DATETIME(3) NULL;
  - `agent_silence_alerted_at` DATETIME(3) NULL;
  - `agent_version` VARCHAR(40) NULL.
- `monitor_checks` suma el índice `idx_monitor_checks_probe_started (probe_id, started_at)`, que usa el cálculo de huecos.

**Interfaces:**
- Produces: las entidades TypeORM, con nombres de propiedad en camelCase (`startsAt`, `latencyHist`, `agentWatchServices`, `generatedBy`…) y JSON tipado:
  - `latencyHist: number[]`;
  - `disks: AgentDisk[]`;
  - `data: AvailabilityReportData`, que es `unknown` hasta la Task 6.

- [ ] **Step 1: Escribir las pruebas que fallan.** En `entities.spec.ts`, cada entidad nueva se registra en `AvailabilityModule` y su `tableName` coincide con la tabla. En `migraciones-desplegadas.spec.ts` (ya existente), comprobar que la 034 figura en las cuatro listas.
- [ ] **Step 2: Correrlas.** `cd backend && npx jest entities.spec migraciones-desplegadas` → FAIL.
- [ ] **Step 3: Escribir la migración y las entidades; registrarlas en `forFeature` y en las cuatro listas.**
- [ ] **Step 4: Verificar.**
  - Correr de nuevo: PASS.
  - Aplicar las migraciones 001–034 dos veces en un MySQL 8 descartable:

    ```bash
    docker run -d --name m034 -e MYSQL_ROOT_PASSWORD=x -e MYSQL_DATABASE=kubo_devdocs mysql:8.0
    ```

    Luego `for f in backend/sql/migrations/0*.sql; do docker exec -i m034 mysql -uroot -px < $f; done`, dos veces. No debe haber errores.
  - Al terminar, `docker rm -f m034`.
- [ ] **Step 5: Commit** `feat(disponibilidad): migración 034 y entidades del informe y el agente`

---

## Task 2: Mantenimientos (backend)

**Files:**
- Create: `domain/maintenance.ts`, `domain/maintenance.spec.ts`, `availability-maintenance.service.ts` (+spec), `availability-maintenance.controller.ts`, `dto/maintenance.dto.ts`
- Modify:
  - `evaluator/ticket-sync.ts` (suprimir el ticket);
  - `domain/combined-state.ts` y `domain/combined-state-builder.ts` (campo `maintenance`);
  - `availability-ingest.service.ts` (cargar las ventanas activas para el estado);
  - `availability-state.service.ts` (lo mismo para la API del personal);
  - `availability.module.ts`.

**Interfaces:**
- Produces:
  - `interface MaintenanceWindow { id: number; serverId: number | null; serviceId: number | null; startsAt: Date; endsAt: Date; reason: string }`
  - `activeWindowFor(target: { serviceId: number | null; serverId: number }, at: Date, windows: MaintenanceWindow[]): MaintenanceWindow | null`. Una ventana de servidor cubre a todos sus servicios. Si `serviceId` es nulo (incidente de servidor), solo cuentan las ventanas del servidor.
  - `maintenanceIntervalsFor(serviceId: number, serverId: number, windows: MaintenanceWindow[], from: Date, to: Date): Array<[Date, Date]>`: une las ventanas que se superponen y recorta a `[from, to)`. Lo usa la Task 6.
  - `CombinedStateRow.maintenance: boolean`: lo ven el motor (Task 9) y la pantalla Estado.
  - API:
    - `GET /availability/maintenance?from&to` → `MaintenanceView[]`, con `targetLabel` («VMI2571371» o «VMI2571371 · Web»);
    - `POST /availability/maintenance` (ADMIN) con `{ serverId? , serviceId?, startsAt, endsAt, reason }`;
    - `POST /availability/maintenance/:id/end` (ADMIN): pone `ends_at = now`, solo si está activa;
    - `DELETE /availability/maintenance/:id` (ADMIN): solo si `starts_at > now`; si no, 409 `MAINTENANCE_STARTED`.
  - Validación (400 `BAD_INPUT`):
    - exactamente uno de `serverId` o `serviceId`;
    - `endsAt > startsAt`;
    - `endsAt > now`;
    - duración ≤ 7 días;
    - `reason` de 3 a 255 caracteres.
- Consumes: `TicketSync.ensure` y `sweep` (ver `evaluator/ticket-sync.ts`).

- [ ] **Step 1: Pruebas puras** en `maintenance.spec.ts`:
  - una ventana de servidor cubre a un servicio de ese servidor;
  - una ventana de servicio no cubre a otro servicio;
  - `activeWindowFor` en `endsAt` exacto devuelve `null` (intervalo semiabierto);
  - `maintenanceIntervalsFor` une `[10:00,11:00)` y `[10:30,12:00)` en `[10:00,12:00)` y recorta al rango.
- [ ] **Step 2: Pruebas de servicio y de ticket.**
  - Crear con las dos claves da 400.
  - Borrar una ventana iniciada da 409.
  - En `availability-evaluator.service.spec.ts` (usa `TicketSync`):
    - un incidente DOWN confirmado durante una ventana activa no llama a `ensureTicket` y deja **un** evento `MAINTENANCE_SUPPRESSED`, aunque el barrido corra 3 veces;
    - al pasar `now` por `endsAt` con el incidente abierto, el barrido crea el ticket.
  - El estado combinado marca `maintenance: true` solo para los servicios cubiertos.
- [ ] **Step 3: Correr.** `npx jest maintenance ticket availability-evaluator combined-state` → FAIL.
- [ ] **Step 4: Implementar.**
  - En `TicketSync.ensure`, antes de crear el ticket, cargar las ventanas activas y consultar `activeWindowFor`. Agregar el evento solo si no hay un `MAINTENANCE_SUPPRESSED` posterior al último de `TICKET_RESET_EVENTS`.
  - Las ventanas activas se leen una vez por barrido, no por incidente.
- [ ] **Step 5: Correr.** Todas en PASS, y `npx jest src/modules/availability` en verde.
- [ ] **Step 6: Commit** `feat(disponibilidad): ventanas de mantenimiento sin ticket ni aviso`

---

## Task 3: Evidencia WinMTR (backend y detalle de incidente)

**Files:**
- Create: `availability-evidence.service.ts` (+spec), `availability-evidence.controller.ts`
- Modify:
  - `availability-state.service.ts`: el detalle de incidente incluye `evidence: EvidenceView[]`;
  - `web/src/pages/availability/AvailabilityIncidentDetailPage.tsx`: botón «Adjuntar WinMTR», lista y descarga;
  - el cliente de API de la web, donde viven las otras llamadas `availability`.
- Usa `STORAGE_SERVICE` (`IStorageService`) de `common/storage/storage.module.ts`. Se importa `StorageModule` en `AvailabilityModule`.

**Interfaces:**
- Produces:
  - `POST /availability/incidents/:id/evidence` (cualquier usuario del personal: `StaffOnlyGuard`, sin `@Roles`): multipart `file`, más `origin` (`OFICINA|SERVIDOR|OTRO`), `notes?` y `capturedAt?` (ISO; por defecto, ahora).
    - Límite 2 MB.
    - Extensiones admitidas: `.txt .html .htm .csv .png .jpg`. Cualquier otra da 400 `EVIDENCIA_TIPO`.
    - Clave de almacenamiento: `availability/evidence/<incidentId>/<uuid><ext>`.
  - `GET /availability/evidence/:id/file`: hace stream con `Content-Disposition: attachment` y el `file_name` original saneado.
  - `DELETE /availability/evidence/:id` (ADMIN): borra el archivo y la fila.
  - `EvidenceView { id, capturedAt, origin, notes, fileName, sizeBytes, createdByName }`.
  - `EvidenceService.listForIncidents(ids: number[]): Promise<Map<number, EvidenceView[]>>`: lo usa la Task 6.

- [ ] **Step 1: Pruebas.**
  - `.exe` da 400.
  - 2 MB + 1 byte da 413 o 400.
  - Un incidente inexistente da 404.
  - Al subir, se guarda con la clave esperada y `save` recibe el buffer.
  - Al borrar, se llama a `storage.remove`.
  - `listForIncidents` agrupa por incidente.
- [ ] **Step 2: Correr** → FAIL.
- [ ] **Step 3: Implementar.** Backend y página: formulario con selector de origen y notas, y la lista con enlace de descarga, que se hace con `fetch` autenticado y un blob, igual que las descargas existentes de tickets.
- [ ] **Step 4: Verificar.** Correr las pruebas (PASS) y `cd web && npm run build` (OK).
- [ ] **Step 5: Commit** `feat(disponibilidad): adjuntar evidencia WinMTR a un incidente`

---

## Task 4: Resúmenes diarios y huecos de sonda

**Files:**
- Create:
  - `domain/latency-histogram.ts` (+spec);
  - `domain/expected-slots.ts` (+spec);
  - `domain/probe-gaps.ts` (+spec);
  - `domain/incident-intervals.ts` (+spec);
  - `availability-rollup.service.ts` (+spec).
- Modify: `availability.module.ts`; `availability-purge.service.ts` (+spec): retención de 12 meses para rollups, rollup days, gaps y reports, y para los incidentes recuperados hace más de 12 meses. Estos se borran en orden: archivos y filas de `monitor_evidence`, `monitor_incident_events`, incidentes hijos e incidentes padre. Nunca toca tickets.

**Interfaces:**
- Produces:
  - `incidentIntervals(inc: { kind; firstFailureAt; recoveredAt: Date | null }, upgradedAt: Date | null, until: Date): Array<{ kind: 'DOWN' | 'ROUTE'; from: Date; to: Date }>`. Lo reusa la Task 6.
    - Un ROUTE con `upgradedAt` (hora del evento `UPGRADED_TO_DOWN`) da `[ROUTE: first → upgradedAt]` y `[DOWN: upgradedAt → recovered ?? until]`.
    - DEGRADED da `[]`.
  - `LATENCY_BUCKETS_MS: number[]`: 0, 25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, +∞. Son 19 cubetas; cada número es el límite inferior inclusivo.
  - `histogramOf(values: number[], bounds = LATENCY_BUCKETS_MS): number[]`
  - `mergeHistograms(hs: number[][]): number[]`
  - `percentileFromHistogram(h: number[], p: number, bounds = LATENCY_BUCKETS_MS): number | null`: devuelve el límite **superior** de la cubeta que alcanza `p`. La última cubeta devuelve su límite inferior. Si el histograma está vacío, devuelve `null`.
  - `PERCENT_BUCKETS`: 0, 5, 10, …, 95, 100. Son 21 cubetas para CPU y RAM; las usa la Task 5.
  - `limaDayBounds(date: string /* YYYY-MM-DD */): { from: Date; to: Date }`, con `from = date 00:00 Lima`.
  - `expectedSlots(serviceId: number, date: string, cfg: ScheduleConfig = DEFAULT_SCHEDULE): number`: cuenta `nextCycleAt` desde `from − 1 ms` mientras sea `< to`.
  - `probeGaps(startedAtSorted: Date[], from: Date, to: Date, minGapMs = PROBE_SILENCE_MS): Array<[Date, Date]>`: incluye el hueco desde `from` hasta el primer check y desde el último hasta `to`. Con cero checks, devuelve `[[from, to]]`.
  - `AvailabilityRollupService`:
    - `rollupDay(date: string, now: Date): Promise<void>`: es idempotente. Borra e inserta los rollups y huecos de esa fecha y luego actualiza `monitor_rollup_days`.
    - `ensureRange(fromDate: string, toDate: string, now: Date): Promise<void>`: calcula solo los días que faltan en `monitor_rollup_days`, nunca el día en curso ni días de hace más de 89.
    - `@Cron('0 30 0 * * *', { timeZone: 'America/Lima' }) run()`: llama a `ensureRange(hoy − 89, ayer)`. También corre en `onApplicationBootstrap`, sin bloquear el arranque: lanzarlo y registrar el error.
- Por cada servicio activo o pausado y cada sonda, en el día:
  - `expected` = `expectedSlots`;
  - `executed` = checks `REGULAR`;
  - `succeeded` = de esos, los que tienen `ok`;
  - `latency_hist` sale de la `duration_ms` de los regulares con `ok`;
  - `p50_ms` y `p95_ms` salen del histograma;
  - `down_minutes` y `route_minutes` son la superposición con el día de los incidentes del servicio (con `incidentIntervals`);
  - `no_data_minutes` = `max(0, expected − executed) × (1440 ÷ expected)`, es decir, los minutos medios por franja del día.
- Huecos por sonda (todas las comprobaciones de cualquier servicio):
  - `PROBE_SILENT` = `probeGaps` sobre `monitor_checks(probe_id, started_at)` del día, ordenados;
  - `OFFICE_OUTAGE` = las `monitor_office_outages` recortadas al día;
  - un hueco silencioso que cae dentro de una caída de oficina se guarda una sola vez, como `OFFICE_OUTAGE`.

- [ ] **Step 1: Pruebas puras.**
  - `histogramOf([10, 30, 30, 1200])` → cubeta 0 = 1, cubeta 25 = 2, cubeta 1000 = 1.
  - `percentileFromHistogram(..., 0.5)` → 50.
  - Un histograma vacío → `null`.
  - `expectedSlots(1, '2026-11-20')` = **720**, porque 180 franjas de día y 540 de noche con `DEFAULT_SCHEDULE`, para cualquier `serviceId` de 1 a 50.
  - `probeGaps` con checks a las 10:00 y 10:25 y `min = 10 min` → `[[10:00, 10:25]]` más los bordes.
- [ ] **Step 2: Pruebas del servicio** con base en memoria o con mocks del repositorio, según el patrón de `availability-purge.service.spec.ts`:
  - `rollupDay` dos veces deja las mismas filas, sin duplicados;
  - `ensureRange` salta los días ya marcados;
  - la purga borra rollups de más de 12 meses y deja los de 11.
- [ ] **Step 3: Correr** → FAIL. **Step 4: Implementar.** **Step 5: Correr** → PASS. Correr también `npx jest src/modules/availability`.
- [ ] **Step 6: Commit** `feat(disponibilidad): resúmenes diarios con histogramas de latencia y huecos de sonda`

---

## Task 5: Ingesta del agente, alertas de servidor y silencio del agente

**Files:**
- Create:
  - `agent-token.guard.ts` (+spec);
  - `availability-agent.controller.ts`;
  - `availability-agent.service.ts` (+spec);
  - `dto/agent.dto.ts`;
  - `domain/server-alerts.ts` (+spec);
  - `domain/disk-trend.ts` (+spec);
  - `agent-silence.watch.ts` (+spec);
  - `domain/agent-install-script.ts` (+spec).
- Modify:
  - `availability-inventory.service.ts` y su controlador: token del agente y `agentWatchServices` en `UpdateServerDto`;
  - `availability-ingest.service.ts`: `SyncResponse.serverAlerts`;
  - `availability-rollup.service.ts`: rollup del agente;
  - `availability-purge.service.ts`: muestras a 30 días;
  - `main.ts` y `probe-ingest-json-limit.ts`: límite de 64 KB para la ruta del agente, mismo patrón.

**Contrato con el agente** (lo consume la Task 10):

```
POST /api/v1/ingest/probe/agent/samples
Authorization: Bearer kma_<43 chars base64url>
{ "agentVersion": "1.0.0",
  "cpuPct": 12.5, "ramPct": 61.2,
  "disks": [{ "name": "C:", "totalBytes": 107374182400, "freeBytes": 9663676416 }],
  "iisPools": [{ "name": "DefaultAppPool", "state": "Started" }] | null,
  "services": [{ "name": "W3SVC", "status": "Running" }],
  "eventErrors": { "system": 0, "application": 3 } }
→ 200 { "watchServices": ["W3SVC"], "intervalSeconds": 60 }
→ 401 token inválido · 429 si llega otra muestra del mismo servidor antes de 20 s · 400 BAD_INPUT
```

Límites de validación:
- `cpuPct` y `ramPct`: de 0 a 100;
- `disks`: hasta 26;
- `iisPools`: hasta 200;
- `services`: hasta 50;
- nombres: hasta 256 caracteres;
- `eventErrors`: enteros ≥ 0.

El instante de la muestra es la hora de recepción de la central. `event_errors` = `system + application`.

**Interfaces:**
- Produces:
  - `type ServerAlertKind = 'DISK_LOW' | 'AGENT_SILENT'`
  - `interface ServerAlert { serverId: number; serverName: string; kind: ServerAlertKind; detail: string }`. Ejemplos de `detail`: `«C: 7 % libre»` y `«sin datos desde 14:32»`.
  - `serverAlertsFor(servers: Array<{ id; name; hasAgent: boolean; agentLastSeenAt: Date | null; agentTokenCreatedAt: Date | null; lastDisks: AgentDisk[] | null }>, now: Date): ServerAlert[]`:
    - `AGENT_SILENT` si `hasAgent` y han pasado más de `PROBE_SILENCE_MS` desde `agentLastSeenAt` (o desde `agentTokenCreatedAt` si nunca reportó);
    - `DISK_LOW` por cada unidad con `free/total < 0.10`. Solo se evalúa si el agente no está mudo.
  - `SyncResponse.serverAlerts: ServerAlert[]` para los servidores `ACTIVE`.
  - `estimateDaysToFull(points: Array<{ at: Date; freeBytes: number }>): number | null`: pendiente lineal por mínimos cuadrados de los últimos 7 días. Devuelve `null` si hay menos de 2 puntos, si la pendiente es ≥ 0 o si el resultado supera 3650.
  - `GET /availability/servers/:id/agent` → `{ lastSampleAt, agentVersion, cpuPct, ramPct, disks: [{ name, totalBytes, freeBytes, freePct, daysToFull }], iisPools, services, eventErrors24h, series24h: Array<{ at, cpuPct, ramPct }> }`.
  - `POST /availability/servers/:id/agent-token` (ADMIN) → `{ token, installScript }`. `installScript` = `buildInstallScript(centralUrl, token)`, con `centralUrl` tomado de `FRONTEND_URL` sin barra final.
  - `DELETE /availability/servers/:id/agent-token` (ADMIN) → 204. Pone `agent_token_hash` en nulo y el servidor deja de dar `AGENT_SILENT`.
  - `buildInstallScript(centralUrl: string, token: string): string`, un PowerShell que:
    - exige administrador;
    - copia `kubo-agent.exe` (de la carpeta del script) a `C:\Program Files\KUBO\Agent\`;
    - corre `kubo-agent.exe configure --central <url> --token <token>`;
    - crea el servicio `KuboAgent` (`sc.exe create … start= auto obj= LocalSystem`, `sc.exe failure KuboAgent reset= 86400 actions= restart/60000/restart/60000/restart/60000`);
    - lo inicia.

    Escapa la URL y el token como literales de PowerShell entre comillas simples, duplicando las `'`.
  - Rollup del agente dentro de `rollupDay`, para cada servidor con muestras ese día:
    - `samples`;
    - `cpu_hist` y `ram_hist` con `PERCENT_BUCKETS`;
    - `disks_close` = los discos de la última muestra del día.
  - `AgentSilenceWatch`: el mismo patrón y las mismas protecciones que `ProbeSilenceWatch` (cron cada minuto, `STARTUP_GRACE_MS`, `silenceDecision`, correo a los ADMIN activos), sobre `monitor_servers.agent_silence_alerted_at`.
    - Asunto: `«[KUBO Monitoreo] El agente de <servidor> no reporta»`.
    - Al volver: `«… volvió a reportar»`.

- [ ] **Step 1: Pruebas.**
  - La guarda: `kmp_` da 401 en la ruta del agente, y un `kma_` revocado también da 401.
  - Una muestra válida guarda la fila y actualiza `agent_last_seen_at` y `agent_version`.
  - Dos muestras en menos de 20 s → 429.
  - Con `cpuPct: 101` → 400.
  - `serverAlertsFor`:
    - con C: 9 % y D: 50 % da un `DISK_LOW` con «C: 9 % libre»;
    - un agente mudo no da `DISK_LOW`;
    - un servidor sin token no da `AGENT_SILENT`.
  - `estimateDaysToFull`: con 100 GB libres que bajan 1 GB por día da ≈ 100; con espacio estable da `null`.
  - `buildInstallScript` con un token que tiene `'` lo escapa.
  - `AgentSilenceWatch` envía un solo correo por silencio.
  - La purga borra muestras de más de 30 días.
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4: Correr** → PASS, más la suite de `availability`.
- [ ] **Step 5: Commit** `feat(disponibilidad): ingesta del agente, alertas de disco y de silencio`

---

## Task 6: Informe mensual de disponibilidad (backend)

**Files:**
- Create:
  - `domain/availability-report.ts` (+spec);
  - `availability-report.service.ts` (+spec);
  - `availability-report.controller.ts`.
- Modify: `availability.module.ts`.

**Interfaces:**
- Consumes: `incidentIntervals` (Task 4), `maintenanceIntervalsFor` (Task 2), `EvidenceService.listForIncidents` (Task 3), `PERCENT_BUCKETS`, `percentileFromHistogram` y `mergeHistograms` (Task 4).
- Produces:
  - `computeAvailabilityReport(input: ReportInput): AvailabilityReportData`, una función pura. Su `ReportInput` trae:
    - `client`, `month`, `from`, `to` (`to = min(fin de mes, now)`), `partial`, `generatedAt`;
    - los `services` con servidor, sistema y criticidad;
    - los `incidents` de servicio (hijos o sueltos) con `upgradedAt`;
    - los `topIncidents` (primer nivel) con sus nombres de servicio, `ticketCode` y `evidence`;
    - `maintenance: MaintenanceWindow[]`, `rollups`, `gaps`, `agentRollups`.
  - El esquema de `AvailabilityReportData`:

    ```ts
    interface AvailabilityReportData {
      version: 1; clientId: number; clientName: string; month: string; partial: boolean;
      from: string; to: string; generatedAt: string; criteria: string[];
      totals: { availabilityPct: number | null; peruAccessPct: number | null; mttrMinutes: number | null;
                incidents: number; downMinutes: number; routeMinutes: number; maintenanceMinutes: number };
      services: Array<{ serviceId: number; serviceName: string; serverName: string; systemName: string | null;
        criticality: Criticality; availabilityPct: number | null; peruAccessPct: number | null;
        downMinutes: number; routeMinutes: number; maintenanceMinutes: number; incidents: number;
        latency: { office: { p50: number | null; p95: number | null }; datacenter: { p50: number | null; p95: number | null } };
        coverage: { office: number | null; datacenter: number | null } }>;
      incidents: Array<{ incidentId: number; kind: 'DOWN' | 'ROUTE'; serverName: string; serviceNames: string[];
        firstFailureAt: string; recoveredAt: string | null; minutesInMonth: number; ticketId: number | null; ticketCode: string | null;
        evidence: Array<{ id: number; origin: string; capturedAt: string; fileName: string }> }>;
      noDataWindows: Array<{ probeCode: string; cause: 'OFFICE_OUTAGE' | 'PROBE_SILENT'; startedAt: string; endedAt: string; minutes: number }>;
      maintenance: Array<{ targetLabel: string; startsAt: string; endsAt: string; reason: string; minutesInMonth: number }>;
      servers: Array<{ serverName: string; cpuP95: number | null; ramP95: number | null; disksAtClose: Array<{ name: string; freePct: number }> }>;
    }
    ```

  - Reglas de cálculo:
    - porcentajes redondeados a 3 decimales (`99.987`);
    - minutos a 2 decimales;
    - `null` si `T ≤ 0`;
    - los minutos de cada servicio salen de la unión de sus intervalos menos sus intervalos de mantenimiento (`maintenanceIntervalsFor`);
    - los huecos contiguos de la misma sonda y causa en días seguidos se unen.
  - `criteria`: las fórmulas de la sección «Disponibilidad mensual» de la spec, como frases en español. Se incluye la frase «Los minutos sin datos desde la oficina no cuentan como caída».
  - `AvailabilityReportService`:
    - `generate(clientId: number, month: string, now: Date, by: number | null): Promise<AvailabilityReportData>`:
      - llama antes a `rollups.ensureRange` para los días del mes hasta ayer;
      - hace upsert por `(client_id, month)`;
      - rechaza un mes futuro (400 `MES_FUTURO`).
    - `@Cron('0 0 8 1 * *', { timeZone: 'America/Lima' }) monthly()`: genera el mes anterior para cada cliente con al menos un servicio no archivado o con incidentes en ese mes.
    - `catchUp(now)` en `onApplicationBootstrap`, sin bloquear: si ya pasó el día 1 a las 08:00 de Lima, genera los clientes del mes anterior **que no tengan fila**.
    - Una sola pasada a la vez, con un indicador `running`.
  - Servicios del cliente:
    - entran los de sus servidores con estado distinto de `ARCHIVED`, más los archivados que tengan incidentes en el mes;
    - en el informe no aparece ningún servicio, incidente ni evidencia de otro cliente.
  - API:
    - `GET /availability/reports?clientId=` → `Array<{ month, partial, generatedAt }>`;
    - `GET /availability/reports/:clientId/:month` → `AvailabilityReportData` (404 si no existe);
    - `POST /availability/reports/:clientId/:month/generate` (ADMIN) → `AvailabilityReportData`.

- [ ] **Step 1: Pruebas puras** en `availability-report.spec.ts`, con datos a mano. Mes de 30 días: `T = 43200`.
  - Un DOWN de 60 min da `99.861`.
  - Un DOWN del 30 a las 23:30 al día 1 siguiente a las 00:30 cuenta 30 min (**Review Focus 1**).
  - Un incidente abierto con `to = now` en un mes parcial cuenta hasta `now`.
  - Un ROUTE de 40 min que pasó a DOWN a los 10 min da ROUTE 10 y DOWN 30, con «acceso desde Perú» calculado sobre 40 (**Review Focus 2**).
  - Una ventana de servidor de 2 h, superpuesta en 30 min con un DOWN de 60 min, da DOWN 30 y `T = 43200 − 120` (**Review Focus 3**).
  - Una ventana que cubre todo el mes da cifras `null`.
  - MTTR: el promedio de dos incidentes de primer nivel cerrados, de 20 y 40 min, es 30. Un incidente abierto se excluye.
  - Dos clientes: el informe del A no contiene nada del B.
- [ ] **Step 2: Pruebas de servicio.**
  - `catchUp` con un informe ya existente no regenera.
  - `catchUp` el día 1 a las 07:59 de Lima no genera.
  - Dos `generate` del mismo `(cliente, mes)` dejan una sola fila (**Review Focus 4**).
  - Un mes futuro da 400.
- [ ] **Step 3: Correr** → FAIL. **Step 4: Implementar.** **Step 5: Correr** → PASS, más la suite de `availability`.
- [ ] **Step 6: Commit** `feat(disponibilidad): informe mensual de disponibilidad por cliente`

---

## Task 7: Pantallas: Disponibilidad, Servidores, mantenimientos y token del agente

**Files:**
- Create:
  - `web/src/pages/availability/AvailabilityReportPage.tsx`;
  - `web/src/pages/availability/AvailabilityServersPage.tsx`;
  - `web/src/pages/availability/MaintenancePanel.tsx`;
  - `web/src/pages/availability/report-format.ts` (+ `report-format.test.ts` si la web tiene vitest; si no, la lógica va dentro y se prueba con el build).
- Modify:
  - `web/src/App.tsx`: rutas `/monitoreo/disponibilidad` y `/monitoreo/servidores`;
  - `web/src/layout/AppLayout.tsx`: entradas «Servidores» y «Disponibilidad» en el menú Monitoreo;
  - `AvailabilityProbesPage.tsx`: sección «Mantenimientos» con `MaintenancePanel` y sección «Agentes», con emitir y revocar el token y descargar `install-kubo-agent.ps1` como blob;
  - `AvailabilityStatePage.tsx`: chip «En mantenimiento» cuando `maintenance`;
  - `AvailabilityInventoryPage.tsx`: editar `agentWatchServices` en el servidor, como lista separada por comas.

**Contenido:**
- **Disponibilidad.**
  - Selector de cliente y de mes. Los meses son los generados más «mes en curso (parcial)».
  - Botón «Generar / Regenerar» (ADMIN) y botón «Imprimir», que llama a `window.print()`. Las reglas `@media print` ocultan la barra lateral y los controles.
  - Lo que muestra:
    - encabezado con las dos cifras y el MTTR;
    - tabla por servicio con las columnas de `services`;
    - incidentes con un enlace al ticket (`/tickets/<ticketId>`, con el texto `ticketCode`) y la evidencia;
    - ventanas sin datos y mantenimientos;
    - recursos del servidor;
    - al pie, «Criterio de cálculo» con `criteria`.
  - Si el informe es parcial, aparece el aviso «Informe parcial al <fecha>».
- **Servidores.**
  - Una tarjeta por servidor con:
    - estado del agente: «Reportando», «Sin datos desde …» o «Sin agente»;
    - CPU y RAM actuales;
    - discos con barra de libre, en ámbar si está por debajo del 10 %, y «≈ N días para llenarse»;
    - grupos de IIS;
    - servicios vigilados;
    - errores del Visor de eventos en 24 h;
    - una minigráfica SVG de CPU y RAM en 24 h, sin librería nueva.
  - Acepta `?serverId=` para resaltar una tarjeta, que es a donde lleva el clic del widget.
- **Mantenimientos.**
  - Tabla: próximos, activos y últimos 30 días.
  - Formulario: servidor o servicio, inicio, fin y motivo.
  - Acciones: «Terminar ahora» si está activo y «Eliminar» si es futuro.
  - Las horas se ingresan y se muestran en hora de Lima.

- [ ] **Step 1: Implementar las pantallas** con los componentes y estilos que ya usan las otras páginas de `availability`.
- [ ] **Step 2: Verificar el build.** `cd web && npm run build` → OK.
- [ ] **Step 3: Revisión visual.** Con el backend y la web de desarrollo contra una base local con datos sembrados, sacar capturas de Disponibilidad, Servidores y Mantenimientos y guardarlas en `docs/superpowers/plans/2026-11-24-monitoreo-entrega-3-capturas/`. Si no se puede levantar el entorno, se anota en el informe y se sigue.
- [ ] **Step 4: Commit** `feat(disponibilidad): pantallas de Disponibilidad, Servidores y Mantenimientos`

---

## Task 8: Importación CSV del inventario

**Files:**
- Create: `domain/csv-import.ts` (+spec), `availability-import.service.ts` (+spec), `dto/import.dto.ts`
- Modify:
  - `availability-inventory.controller.ts`;
  - `AvailabilityInventoryPage.tsx`: botón «Importar CSV», vista previa y confirmación;
  - `availability.module.ts`.

**Formato:**
- Cabecera, en cualquier orden y sin distinguir mayúsculas ni tildes: `cliente, servidor, host, rol, proveedor, region, servicio, protocolo, destino, puerto, criticidad, umbral_ms, sistema`.
- Obligatorias: `cliente, servidor, host, servicio, protocolo, destino`.
- `criticidad` admite `ALTA|MEDIA|BAJA` o `HIGH|MEDIUM|LOW`.

**Interfaces:**
- Produces:
  - `parseCsv(text: string): { header: string[]; rows: Array<{ line: number; cells: string[] }> }`:
    - quita el BOM;
    - detecta `;` o `,` por la cabecera;
    - entiende comillas dobles con `""` y saltos de línea dentro de comillas;
    - acepta `\r\n`;
    - descarta las filas vacías;
    - `line` es el número de línea del archivo.
  - `ImportRowResult { line: number; status: 'NEW' | 'DUPLICATE' | 'INVALID'; errors: string[]; serverAction: 'CREATE' | 'REUSE' | null; data: { … } | null }`
  - Errores, en español: `«Cliente "X" no existe»`, `«El servidor "S" ya existe con otro host (1.2.3.4)»`, `«Protocolo inválido»`, `«Puerto fuera de rango»`, `«HTTPS requiere una URL https://»`, `«Sistema "Y" no pertenece al cliente»`.
  - Endpoints (ADMIN; cuerpo `{ csv: string }` de hasta 256 KB, y más da 413):
    - `POST /availability/import/preview` → `{ rows: ImportRowResult[]; summary: { new; duplicate; invalid } }`;
    - `POST /availability/import/commit` → `{ createdServers; createdServices; skipped }`. Vuelve a validar y crea todas las filas `NEW` en **una transacción**: si una falla, no se crea ninguna.

- [ ] **Step 1: Pruebas** en `csv-import.spec.ts`, con un CSV de Excel: BOM, `;`, una celda con `"a;b"`, una fila vacía al final y `\r\n`. Deben salir 2 filas y `line` correcto (**Review Focus 5**). En el servicio:
  - una fila repetida en el archivo → `DUPLICATE`;
  - un servicio existente → `DUPLICATE`;
  - un cliente inexistente → `INVALID` con el mensaje;
  - el mismo servidor con otro host → `INVALID`;
  - `commit` con un error forzado a mitad no deja nada creado.
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4: Correr** → PASS; `cd web && npm run build` → OK.
- [ ] **Step 5: Commit** `feat(disponibilidad): importación CSV del inventario con vista previa`

---

## Task 9: Motor y widget: mantenimiento y alertas de servidor

**Files:**
- Modify:
  - `desktop/engine/src/central-client.ts`: `CombinedStateRow.maintenance?: boolean` y `SyncResponse.serverAlerts?: ServerAlert[]`, ambos opcionales para no romper contra una central vieja;
  - `desktop/engine/src/events/diff-states.ts`;
  - `desktop/engine/src/engine.ts`: guarda y siembra las alertas previas junto al estado;
  - `desktop/engine/src/local-api.ts`: `/v1/status` incluye `serverAlerts`;
  - `desktop/widget/src/shared/types.ts`, `widget-model.ts`, `notify-policy.ts`, `login-summary.ts`;
  - `desktop/widget/src/main/notifier.ts`: textos y URL.
- Tests junto a cada archivo, con el patrón existente.

**Interfaces:**
- Produces:
  - `EngineEventKind` suma `'SERVER_ALERT_STARTED' | 'SERVER_ALERT_CLEARED'`.
  - `EngineEvent` suma `serverId: number | null`, `alertKind: 'DISK_LOW' | 'AGENT_SILENT' | null` y `detail: string | null`. Son `null` en los eventos existentes.
  - `notify`: `true` solo en `SERVER_ALERT_STARTED` con `DISK_LOW`.
  - Clave de alerta = `serverId:kind:detail-sin-cifras`. Una baja de 9 % a 8 % en C: no es una alerta nueva: la clave usa la unidad, no el porcentaje.
  - `diffServerAlerts(prev: ServerAlert[] | null, next: ServerAlert[]): EngineEventDraft[]`. Con `prev` nulo (primer arranque sin estado guardado) no emite nada.
  - `maskMaintenance(prev: CombinedStateRow[] | null, next: CombinedStateRow[]): CombinedStateRow[]`:
    - una fila con `maintenance` se reemplaza por la fila previa del mismo servicio;
    - si no hay fila previa, se reemplaza por la misma fila con `status: 'OK'`, `incidentId: null` y `parentIncidentId: null`.

    El motor guarda y compara el resultado enmascarado (decisión 5).
  - Widget:
    - las alertas son filas ámbar: «Disco con poco espacio · <servidor> · <detail>» y «Agente sin datos · <servidor> · <detail>»;
    - los servicios en mantenimiento no son filas de problema; la barra agrega «· N en mantenimiento»;
    - el clic en una alerta abre `<central>/monitoreo/servidores?serverId=<id>`;
    - la notificación de Windows de `DISK_LOW` dice título «Disco con poco espacio» y cuerpo «<servidor> · <detail>».

- [ ] **Step 1: Pruebas.**
  - `maskMaintenance`:
    - un servicio caído que entra en mantenimiento no genera `INCIDENT_RECOVERED`;
    - un incidente nuevo abierto durante la ventana no genera `INCIDENT_OPENED` hasta que `maintenance` pasa a `false`, y ahí sí lo genera.
  - `diffServerAlerts`:
    - aparecer un `DISK_LOW` da `STARTED` con `notify: true`;
    - aparecer un `AGENT_SILENT` da `notify: false`;
    - desaparecer da `CLEARED` con `notify: false`;
    - C: de 9 % a 8 % no emite.
  - Widget: el modelo con una alerta tiene barra ámbar y la fila. El resumen al iniciar sesión cuenta las alertas que siguen activas.
- [ ] **Step 2: Correr.** `cd desktop/engine && npm test`; `cd desktop/widget && npm test` → FAIL.
- [ ] **Step 3: Implementar.** **Step 4: Correr** → PASS en los dos paquetes; `npm run build` en el widget OK.
- [ ] **Step 5: Commit** `feat(escritorio): alertas de servidor y mantenimiento en motor y widget`

---

## Task 10: Agente .NET

**Files:**
- Create:
  - `agent/KuboAgent.sln`;
  - `agent/src/KuboAgent/KuboAgent.csproj`: `net10.0-windows`, `OutputType Exe`, `RuntimeIdentifier win-x64`, `SelfContained true`, `PublishSingleFile true`, `AssemblyName kubo-agent`;
  - `agent/src/KuboAgent/`: `Program.cs`, `AgentConfig.cs`, `TokenProtector.cs`, `Sampling/*.cs`, `CentralClient.cs`, `AgentWorker.cs`;
  - `agent/tests/KuboAgent.Tests/` con xUnit;
  - `agent/build.ps1`;
  - `agent/uninstall-kubo-agent.ps1`;
  - `agent/README.md`.
- Modify: `.gitignore` (`agent/**/bin`, `agent/**/obj`, `agent/publish`).

**Paquetes:**
- `Microsoft.Extensions.Hosting`;
- `Microsoft.Extensions.Hosting.WindowsServices`;
- `Microsoft.Extensions.Logging.EventLog`;
- `System.Diagnostics.PerformanceCounter`;
- `System.Security.Cryptography.ProtectedData`;
- `Microsoft.Web.Administration`;
- `System.Diagnostics.EventLog`.

Ninguno más.

**Interfaces:**
- Consumes: el contrato de la Task 5, exacto.
- Produces:
  - **CLI:**
    - `kubo-agent configure --central <url> --token <kma_…>`: valida que la URL sea `https://` y que el token tenga forma `kma_`. Escribe `%ProgramData%\KUBO\Agent\agent.json` con `{ centralUrl, tokenProtected }`, donde `tokenProtected` es el token protegido con DPAPI `LocalMachine` y codificado en base64. Termina con código 0.
    - Sin argumentos, el ejecutable corre como servicio (`UseWindowsService`, nombre `KuboAgent`).
    - `kubo-agent once`: toma una muestra, la imprime en JSON y no envía nada. Sirve para el diagnóstico.
  - **Interfaces de lectura** (una clase real y una falsa en las pruebas para cada una):
    - `ICpuReader.ReadPct()`: `PerformanceCounter("Processor", "% Processor Time", "_Total")`, con una primera lectura descartada;
    - `IMemoryReader.ReadPct()`: `GlobalMemoryStatusEx`;
    - `IDiskReader.Read()`: `DriveInfo` con `DriveType.Fixed` e `IsReady`;
    - `IIisReader.Read()`: `ServerManager.ApplicationPools`. Devuelve `null` si IIS no está instalado o si lanza `COMException` o `FileNotFoundException`;
    - `IServiceReader.Read(IReadOnlyList<string> names)`: `ServiceController`. Un servicio inexistente da `"NotFound"`;
    - `IEventErrorReader.CountSince(DateTime utc)`: `EventLogReader` con XPath `*[System[(Level=1 or Level=2) and TimeCreated[@SystemTime>='…']]]` sobre System y Application.
  - `SampleBuilder.Build(…) → AgentSample`: el JSON en camelCase con `System.Text.Json`. En la primera muestra, `eventErrors` es 0 y la referencia es ahora.
  - `CentralClient.SendAsync(AgentSample) → SendResult { Ok, WatchServices?, IntervalSeconds?, Status }`:
    - `HttpClient` con timeout de 15 s y la validación TLS por defecto (sin `ServerCertificateCustomValidationCallback`);
    - 401: registra «token inválido o revocado» y sigue intentando cada intervalo;
    - 429: espera el intervalo siguiente.
  - `AgentWorker`:
    - `PeriodicTimer` con el `intervalSeconds` de la última respuesta (por defecto 60, rango 30 a 600);
    - `watchServices` de la última respuesta, en memoria;
    - no hay cola: una muestra que no se pudo enviar se descarta y queda registrada.
  - El registro va al Visor de eventos, origen `KuboAgent`.

- [ ] **Step 1: Pruebas xUnit.**
  - `SampleBuilder`, con lectores falsos, produce el JSON exacto del contrato, con nombres en camelCase e `iisPools` en `null` sin IIS.
  - `CentralClient`, con un `HttpMessageHandler` falso:
    - envía `Authorization: Bearer kma_…` y `Content-Type: application/json`;
    - con 200, lee `watchServices`;
    - con 401, devuelve `Ok = false` sin lanzar.
  - `AgentConfig` va y vuelve: el token protegido no contiene el token en claro. La prueba es solo para Windows y se marca con `[SupportedOSPlatform]` y un `Skip` fuera de Windows.
  - `configure`:
    - con `http://` da código distinto de 0;
    - con un token sin `kma_` da código distinto de 0.
- [ ] **Step 2: Correr.** `cd agent && dotnet test` → FAIL.
- [ ] **Step 3: Implementar.** `build.ps1` corre `dotnet publish src/KuboAgent -c Release -o publish`.
- [ ] **Step 4: Verificar.**
  - `dotnet test` → PASS.
  - `pwsh -File agent/build.ps1` (o `powershell`) genera `agent/publish/kubo-agent.exe`.
  - `agent/publish/kubo-agent.exe once` imprime una muestra de esta PC. Es solo lectura y no instala nada.
- [ ] **Step 5: Commit** `feat(agente): agente de servidor .NET con muestras de CPU, RAM, discos, IIS y servicios`

---

## Task 11: Aceptación y despliegue

**Files:**
- Create: `docs/superpowers/plans/2026-11-24-monitoreo-entrega-3-aceptacion.md`
- Modify: `docs/superpowers/plans/2026-11-24-monitoreo-despliegue.md`, que suma la migración 034, el `FRONTEND_URL` del script de instalación, la publicación del agente y su instalación en `VMI2571371` **solo con la autorización escrita del cliente**.

- [ ] **Step 1: Escribir el documento de aceptación**, con el mismo formato que el de la Entrega 2: tabla de criterios de la spec con estado `CUBIERTO POR PRUEBAS`, `VERIFICADO`, `PENDIENTE DEL USUARIO` o `FUERA DE ESTA ENTREGA`. Debe incluir:
  - el escenario «informe de un mes en que el worker no corrió el día 1», hoy cubierto por `catchUp`;
  - «con dos clientes, cada informe contiene solo lo del cliente»;
  - las pruebas que dependen del usuario: instalar el agente en un servidor, llenar un disco de prueba hasta pasar el 10 % y detener el agente 10 min;
  - capturas de la Task 7.
- [ ] **Step 2: Correr las suites completas.**
  - `cd backend && npx jest` → todo PASS;
  - `node scripts/sync-monitoring-core.mjs --check` → OK;
  - `cd web && npm run build` → OK;
  - `desktop/engine` y `desktop/widget` `npm test` → PASS;
  - `cd agent && dotnet test` → PASS.

  Anotar las cifras en el documento.
- [ ] **Step 3: Commit** `docs(disponibilidad): aceptación y despliegue de la Entrega 3`

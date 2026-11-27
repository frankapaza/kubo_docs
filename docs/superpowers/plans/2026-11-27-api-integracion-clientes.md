# API de integración para clientes — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** API REST de solo lectura (JSON y CSV) con clave por cliente para que cada cliente consulte sus tickets y requerimientos y arme dashboards.

**Architecture:** Módulo NestJS nuevo `backend/src/modules/integration-api` con: claves `kci_` (tabla `client_api_keys`, patrón del conector `dev-connector`), una guarda propia, consultas con cursor sobre `tickets` y `work_items` aplicando la misma frontera de visibilidad del portal, un resumen que reutiliza `buildMonthlyReport` mes a mes, y salida CSV. Gestión de claves en el portal (CLIENT_ADMIN) y en el panel (ADMIN). Página de ayuda en el portal.

**Tech Stack:** NestJS 10, TypeORM 0.3, MySQL 8 (migraciones SQL manuales), React + react-query (web).

**Spec:** `docs/superpowers/specs/2026-11-27-api-integracion-clientes-design.md`

## Global Constraints

- Solo lectura: rutas GET bajo `/api/v1/integracion`; otros métodos → 405 `{ code: 'METHOD_NOT_ALLOWED' }`.
- Clave: `kci_` + 32 bytes base64url (43 chars); se guarda SHA-256 hex; prefijo visible = primeros 8 chars (`kci_xxxx`); se muestra una vez (campo `secret`, que `AuditInterceptor` tacha).
- Cabeceras: `Authorization: Bearer kci_…` o `X-Api-Key: kci_…`; si llegan ambas manda `Authorization`. Nunca por query.
- 401 idéntico para mal formada, desconocida, revocada o cliente inactivo: `{ code: 'UNAUTHORIZED', message: 'Clave de API inválida o revocada.' }`.
- Límites: 60 req/min por clave y 120 req/min por cliente (`FixedWindowLimiter`), 429 `{ code: 'RATE_LIMITED', retryAfterSec }` + cabecera `Retry-After`.
- Máximo 10 claves activas por cliente → 409 `{ code: 'LIMITE_CLAVES' }`.
- `ultimoUso` como mucho una escritura por minuto por clave, solo en peticiones autenticadas.
- Frontera: tickets del cliente con `excludeInternal` (sin origen interno); descripción con la regla `visibleDescription` del portal; historial solo eventos `PortalVisibleEventType`. Requerimientos: `clientId` + `origin = 'PORTAL'`, estado con `REQUIREMENT_STATUS_LABELS`. Recurso ajeno o inexistente → 404 `{ code: 'NOT_FOUND' }`.
- Campos JSON en español camelCase; fechas ISO 8601 UTC; fechas sin hora `YYYY-MM-DD`.
- Paginación: `limite` (100 por defecto, máx 500; máx 5000 con `formato=csv`) y `cursor` opaco = base64url de `{"t":"<ISO actualizadoEn>","i":<id>}`; orden (`updated_at`, `id`) ascendente; respuesta `{ datos, siguienteCursor }`; en CSV el cursor va en la cabecera `X-Siguiente-Cursor`.
- CSV: UTF-8 con BOM, `;`, CRLF, celdas con `csvEscape` (anti fórmulas) de `availability/domain/csv.ts`.
- Resumen: meses civiles de Perú (`common/peru-month.ts`), cifras de SLA con `buildMonthlyReport` (mismas que el informe mensual).
- Migración `040_api_integracion_clientes.sql` idempotente y registrada en `deploy.yml`, `docker-compose.yml`, `docker-compose.dev.yml` (`044d_mig_040.sql`) y `deploy.sh`; la guarda `migraciones-desplegadas.spec.ts` la exige.

## Review Focus

1. Una clave del cliente A pidiendo `/tickets/<código de B>` o `/requerimientos/<código de B>` → 404, nunca datos de B (prueba en T3 y T6).
2. Cursor manipulado (base64 inválido, JSON roto, fecha inválida) → 400 `BAD_INPUT`, no 500 (prueba en T3).
3. `actualizadosDesde` / `creadosDesde` con formato inválido → 400 (prueba en T3).
4. Ticket de origen interno (MONITOREO) del mismo cliente → nunca en lista ni detalle (prueba en T3).
5. Clave de un cliente desactivado → 401 aunque la clave esté activa (prueba en T2).

---

### Task 1: Tabla, entidad y dominio de claves

**Files:**
- Create: `backend/sql/migrations/040_api_integracion_clientes.sql`, `backend/src/modules/integration-api/entities/client-api-key.entity.ts`, `backend/src/modules/integration-api/domain/api-key.ts`, `backend/src/modules/integration-api/domain/api-key.spec.ts`
- Modify: `.github/workflows/deploy.yml`, `docker-compose.yml`, `docker-compose.dev.yml`, `deploy.sh`, `backend/src/common/migraciones-desplegadas.spec.ts`

**Interfaces — Produces:**
- `ClientApiKey` entity → tabla `client_api_keys`: `id, clientId, name (varchar 80), keyPrefix (char 8), keyHash (char 64, unique), createdByUserId|null, createdByClientUserId|null, createdAt, lastUsedAt|null, revokedAt|null, revokedByUserId|null, revokedByClientUserId|null`; índice `(client_id, revoked_at)`.
- `API_KEY_PREFIX = 'kci_'`, `generateApiKey(): string`, `fingerprintApiKey(key: string): string`, `isWellFormedApiKey(k: unknown): k is string` (regex `^kci_[A-Za-z0-9_-]{43}$`), `apiKeyDisplayPrefix(key): string` (8 chars).

- [ ] **Step 1:** Tests en `api-key.spec.ts`: la clave generada cumple `isWellFormedApiKey`; dos llamadas difieren; `fingerprintApiKey` da 64 hex y es determinista; `isWellFormedApiKey('kdev_…')`, `''`, `undefined`, una de 42 chars → false; `apiKeyDisplayPrefix(k)` === `k.slice(0, 8)`.
- [ ] **Step 2:** Implementar `domain/api-key.ts` como gemelo de `dev-connector/domain/dev-key.ts` con el prefijo `kci_`. Migración con `CREATE TABLE IF NOT EXISTS` (patrón de la 037). Registrar la 040 en los cuatro sitios y en `NOMBRES` + test `incluye la 040` de la guarda (usar un script Node, no `sed`, para no escribir `\n` literal en `deploy.yml`).
- [ ] **Step 3:** `npx jest src/modules/integration-api/domain src/common/migraciones-desplegadas.spec.ts` → PASS. Aplicar la 040 dos veces en un MySQL 8 local → sin errores.
- [ ] **Step 4:** Commit `feat(integracion): tabla y claves kci_ de la API de integracion`.

### Task 2: Servicio de claves, guarda y gestión (portal y panel)

**Files:**
- Create: `integration-api/api-keys.service.ts` (+ `.spec.ts`), `integration-api/api-key.guard.ts` (+ `.spec.ts`), `integration-api/portal-api-keys.controller.ts`, `integration-api/staff-api-keys.controller.ts`, `integration-api/dto/api-keys.dto.ts`, `integration-api/integration-api.module.ts`
- Modify: `backend/src/app.module.ts` (importar `IntegrationApiModule`)

**Interfaces — Consumes:** T1. **Produces:**
- `ApiKeysService.list(clientId): Promise<ApiKeyView[]>`; `issue(clientId, name, actor: { userId?: number; clientUserId?: number }): Promise<{ key: ApiKeyView; secret: string }>`; `revoke(clientId, keyId, actor): Promise<void>`; `resolve(fingerprint, now): Promise<ApiPrincipal | null>`.
- `ApiKeyView = { id, nombre, prefijo, estado: 'ACTIVA' | 'REVOCADA', creadaEn, ultimoUso, revocadaEn }`; `ApiPrincipal = { keyId: number; clientId: number }`.
- `ApiKeyGuard` pone `req.integration = ApiPrincipal`. Limitadores: `ApiKeyRateLimiter(60/min)` por `keyId` y `ApiClientRateLimiter(120/min)` por `clientId` (dos clases que extienden `FixedWindowLimiter`, como `DevRateLimiter`).
- Rutas de gestión: portal `GET/POST /portal/integraciones/claves`, `POST /portal/integraciones/claves/:id/revocar` con `ClientJwtGuard, ClientAdminGuard` (clientId del token). Panel `GET/POST /clients/:clientId/api-keys`, `POST /clients/:clientId/api-keys/:id/revoke` con `JwtAuthGuard, RolesGuard` + `@Roles('ADMIN')`.

- [ ] **Step 1: Tests del servicio:** `issue` guarda hash y prefijo, devuelve `secret` que resuelve; `issue` con 10 activas → 409 `LIMITE_CLAVES`; `revoke` de una clave de otro cliente → 404; `resolve` de revocada → null; `resolve` de clave cuyo cliente está inactivo → null; `resolve` actualiza `lastUsedAt` si pasó ≥ 60 s y no si pasaron 30 s; `name` vacío o > 80 → 400.
- [ ] **Step 2: Tests de la guarda:** sin cabecera → 401; `Authorization: Bearer kdev_…` → 401 sin consultar; válida por `X-Api-Key` → pasa; con `Authorization` válida y `X-Api-Key` basura → pasa (manda Authorization); 61ª petición de la misma clave en la ventana → 429 con `retryAfterSec`; dos claves del mismo cliente, 121ª en total → 429.
- [ ] **Step 3:** Implementar. El cliente activo se comprueba en la misma consulta de `resolve` (JOIN `clients` con `status = 'ACTIVE'` o el campo equivalente de la entidad Client).
- [ ] **Step 4:** Tests HTTP (`test-http-app`) de las rutas de gestión: un usuario de portal no admin → 403; POST devuelve `secret` solo en el alta; GET nunca devuelve `secret` ni hash.
- [ ] **Step 5:** `npx jest src/modules/integration-api` → PASS. Commit `feat(integracion): gestion de claves y guarda de la API`.

### Task 3: Consultas de tickets y requerimientos (JSON)

**Files:**
- Create: `integration-api/domain/cursor.ts` (+ spec), `integration-api/domain/filters.ts` (+ spec), `integration-api/integration-query.service.ts` (+ spec con MySQL real si hay uno disponible; si no, con repositorio simulado), `integration-api/integration.controller.ts`, `integration-api/dto/integration-views.ts`
- Modify: `portal/portal-tickets.service.ts` — exportar `isClientVisible` y una función pura `portalVisibleDescription(t: Ticket): string | null` (sacada de `visibleDescription`) para reutilizarlas sin duplicar.

**Interfaces — Produces:**
- `encodeCursor({ t: Date, i: number }): string`, `decodeCursor(s: string): { t: Date; i: number }` (lanza `BadRequestException BAD_INPUT`).
- `parseListQuery(q: Record<string, unknown>, csv: boolean): ListQuery` con `estados?: string[], prioridades?: string[], sistemaId?: number, creadosDesde?, creadosHasta?, actualizadosDesde?: Date, limite: number, cursor?: {t,i}`; estados desconocidos o fechas inválidas → 400.
- `IntegrationQueryService.tickets(clientId, q): Promise<{ datos: TicketApiView[]; siguienteCursor: string | null }>`, `ticket(clientId, codigo): Promise<TicketApiDetail>`, `requerimientos(clientId, q)`, `requerimiento(clientId, codigo)`, `sistemas(clientId)`.
- `TicketApiView = { id, codigo, asunto, descripcion, estado, prioridad, sistemaId, sistema, creadoEn, actualizadoEn, resueltoEn, cerradoEn, venceRespuesta, venceResolucion, slaEnRiesgo: boolean }`; `TicketApiDetail = TicketApiView & { historial: { tipo, desde, hasta, fecha }[] }`.
- `RequerimientoApiView = { id, codigo, titulo, descripcion, estado, prioridad, fechaComprometida, cerradoEn, creadoEn, actualizadoEn, motivoRechazo, preguntaPendiente, tipo }`.
- Controlador `@Controller('integracion')` con `@UseGuards(ApiKeyGuard)`, GET `tickets`, `tickets/:codigo`, `requerimientos`, `requerimientos/:codigo`, `sistemas`, y un `@All('*')` que responde 405 para cualquier método no GET.

- [ ] **Step 1: Tests de dominio:** cursor ida y vuelta; `decodeCursor('###')`, de JSON sin `i`, y con fecha inválida → 400. `parseListQuery`: `estado=NUEVO,EN_ATENCION` → array; `estado=FOO` → 400; `limite=501` → 400 en JSON, 5000 válido en CSV; `actualizadosDesde=ayer` → 400.
- [ ] **Step 2: Tests del servicio** (datos: cliente A con 3 tickets —uno de origen MONITOREO— y 1 requerimiento PORTAL y 1 interno; cliente B con 1 ticket): lista de A devuelve 2 tickets en orden (`updated_at`, `id`); con `limite=1` el `siguienteCursor` trae el segundo y luego `null`; `ticket(A, códigoDeB)` → 404; `ticket(A, códigoMonitoreo)` → 404; historial sin eventos internos; requerimientos de A solo el de origen PORTAL; `actualizadosDesde` filtra por `updated_at >= valor`.
- [ ] **Step 3:** Implementar con QueryBuilder: `client_id = :clientId`, exclusión de origen interno igual que `TicketsRepository.list({ excludeInternal: true })`, keyset `(updated_at > :t OR (updated_at = :t AND id > :i))`, `LIMIT limite + 1` para saber si hay siguiente. `slaEnRiesgo` = columna `sla_at_risk` = 1.
- [ ] **Step 4:** Tests HTTP del controlador: GET con clave válida → 200 `{ datos, siguienteCursor }`; POST `/integracion/tickets` → 405; sin clave → 401.
- [ ] **Step 5:** `npx jest src/modules/integration-api src/modules/portal` → PASS. Commit `feat(integracion): consultas de tickets y requerimientos`.

### Task 4: Resumen para dashboards

**Files:**
- Create: `integration-api/domain/summary.ts` (+ spec), método `resumen` en `integration-query.service.ts`, ruta `GET integracion/resumen`.

**Interfaces — Produces:**
- `parseMonthRange(desde?: string, hasta?: string, now: Date): Array<{ year: number; month: number }>` — `YYYY-MM`; por defecto los 12 meses hasta el actual (Perú); máximo 24 meses; formato inválido o `desde > hasta` → 400.
- `ResumenApi = { abiertos: { porEstado: Record<string, number>; porPrioridad: Record<string, number> }, meses: Array<{ mes: 'YYYY-MM'; tickets: { recibidos, resueltosEnMes, pendientes, cumplimientoRespuestaPct, cumplimientoResolucionPct, resolucionMediaHoras, resolucionMedianaHoras }; requerimientos: { solicitados, aceptados, entregados, rechazados, cumplimientoCompromisoPct } }> }`.
- Por mes: `peruMonthBounds`, `tickets.listForClientPeriod` + `countResolvedInPeriod`, `workItems.listPortalRequirementsInPeriod`, `buildMonthlyReport` con `toReportTicketRow`/`toReportRequirementRow` de `portal-reports.service.ts`; las cifras salen de `totals`. Media y mediana de resolución = horas entre `createdAt` y `resolvedAt` de los tickets resueltos dentro del mes (`null` si ninguno).
- `abiertos`: tickets visibles del cliente con estado distinto de `RESUELTO`/`CERRADO`.

- [ ] **Step 1: Tests de `summary.ts`:** `parseMonthRange(undefined, undefined, 2026-11-27)` → 12 meses de `2025-12` a `2026-11`; `('2026-13')` → 400; rango de 25 meses → 400; mediana de [1, 3, 10] h = 3, media = 4.67 (2 decimales).
- [ ] **Step 2: Test del servicio:** las cifras de cumplimiento de un mes coinciden con las de `buildMonthlyReport` para los mismos datos (mismo input → mismo `%`).
- [ ] **Step 3:** Implementar; mes en curso incluido (parcial).
- [ ] **Step 4:** `npx jest src/modules/integration-api` → PASS. Commit `feat(integracion): resumen mensual para dashboards`.

### Task 5: Salida CSV

**Files:**
- Create: `integration-api/domain/csv-views.ts` (+ spec)
- Modify: `integration.controller.ts` (rutas de lista y resumen aceptan `formato=csv`)

**Interfaces — Produces:** `ticketCsvHeader: string[]`, `ticketCsvRow(v: TicketApiView): string[]`, igual para requerimientos; `resumenCsvRows(r: ResumenApi): string[][]` con cabecera `['metrica','dimension','mes','valor']`.

- [ ] **Step 1: Tests:** cabecera de tickets = los nombres de campo de `TicketApiView` en el mismo orden; booleano `slaEnRiesgo` → `si`/`no`; null → celda vacía; `asunto` `=SUMA(1)` sale neutralizado; el resumen produce una fila por métrica, dimensión y mes.
- [ ] **Step 2:** En el controlador, con `formato=csv`: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="tickets.csv"`, cabecera `X-Siguiente-Cursor` si hay, y escritura por streaming (`res.write` del BOM + cabecera y luego fila a fila) en vez de armar un solo string. `formato` distinto de `json`/`csv` → 400.
- [ ] **Step 3:** Test HTTP: `GET /integracion/tickets?formato=csv` → 200, el cuerpo empieza por `﻿` y la cabecera CSV.
- [ ] **Step 4:** `npx jest src/modules/integration-api` → PASS. Commit `feat(integracion): exportacion CSV`.

### Task 6: Web — Integraciones (portal), claves (panel) y arreglo de Estado

**Files:**
- Create: `web/src/pages/portal/PortalIntegrationsPage.tsx`, `web/src/api/integration-keys.api.ts`, `web/src/pages/client-api-keys/ClientApiKeysPanel.tsx`
- Modify: `web/src/App.tsx` (ruta `/portal/integraciones`), `web/src/layout/PortalLayout.tsx` (entrada «Integraciones» solo para administradores, junto a «Equipo»), `web/src/pages/ClientDetailPage.tsx` (sección «API de integración» solo para ADMIN), `web/src/pages/availability/AvailabilityStatePage.tsx`

**Interfaces — Consumes:** rutas de gestión de T2.

- [ ] **Step 1:** Portal «Integraciones»:
  - tabla de claves (nombre, prefijo, estado, creada, último uso) y botón «Revocar» con confirmación;
  - «Nueva clave» pide un nombre y muestra la clave una sola vez, con botón «Copiar» y el aviso «Guárdala ahora: no se volverá a mostrar»;
  - debajo, la ayuda: URL base `https://docs.kuboti.com/api/v1/integracion`, cabecera `Authorization: Bearer <clave>`, tabla de rutas y filtros, ejemplo `curl` de `/tickets?actualizadosDesde=…` y de `?formato=csv`, y la receta de Power BI («Obtener datos → Web → Avanzado», encabezado `Authorization`).
- [ ] **Step 2:** Panel: el mismo listado, alta y revocación en la ficha del cliente, contra `/clients/:clientId/api-keys`.
- [ ] **Step 3:** Estado: mostrar «No se pudo cargar el estado» solo si `state.error && !state.data`.
- [ ] **Step 4:** `npm run build` en `web` → sin errores. Comprobación visual en local (portal como admin del cliente y como usuario no admin: este no ve la entrada). Commit `feat(integracion): pantallas de claves y ayuda de la API`.

### Task 7: Verificación final y publicación

- [ ] **Step 1:** Backend completo (`npx jest`), web build, sincronización del núcleo sin cambios.
- [ ] **Step 2:** Prueba de punta a punta en local (MySQL con migraciones hasta la 040 + backend): crear clave en el portal, `curl` a `/integracion/tickets`, `/tickets/:codigo`, `/resumen`, `?formato=csv`, revocar y comprobar 401.
- [ ] **Step 3:** Push de la rama, PR, CI verde, merge y seguimiento del despliegue (la 040 debe aparecer en el log).

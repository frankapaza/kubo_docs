# Logs y errores centralizados en DevDocs — Plan de implementación

> **Para trabajadores agénticos:** SUB-HABILIDAD REQUERIDA: usa superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans para implementar este plan tarea a tarea. Los pasos usan casillas (`- [ ]`) para poder marcarlos.

**Goal:** Que los logs de todos los aplicativos .NET de todos los clientes lleguen a DevDocs con una DLL y una entrada en `log4net.config`, se puedan buscar y ver en vivo, y que sus errores se agrupen, avisen en tiempo real y se conviertan en ticket interno o se den por resueltos — sin entrar por escritorio remoto a ningún servidor.

**Architecture:** Un appender propio de log4net (`Kubo.Log4Net.KuboLogAppender`, en `tools/kubo-log-appender/`) encola en memoria y envía lotes JSON por HTTPS desde un hilo propio a `POST /api/v1/ingest/logs`. El backend identifica la instalación por la huella de su clave, aplica el nivel mínimo y los límites, escribe las líneas en **Loki** (contenedor nuevo, 30 días) y agrupa los ERROR/FATAL en **MySQL** (`error_groups`, `error_occurrences`, `error_group_daily`, migración 030) con una máquina de estados pura. El gateway de socket que ya existe (`/tickets`) gana `error:new` y la cola en vivo `logs:lines`. «Crear ticket» pasa por `TicketsService.create` con el origen nuevo `MONITOREO`, que el portal excluye en todas sus puertas. La web gana el menú «Monitoreo» (Errores, Logs, Instalaciones).

**Tech Stack:** NestJS 10 · TypeORM 0.3 (`synchronize: false`) · MySQL 8 · Jest 29 (`TZ=UTC` desde `jest.config.js`) · socket.io 4 · Loki 3 (`grafana/loki:3.4.2`, almacenamiento en disco) · React 18 + Vite + react-query + Tailwind · .NET SDK 10 compilando `net45`/`net462`/`netstandard2.0` · log4net 2.0.8 y 3.2.0 · xUnit 2

**Spec:** `docs/superpowers/specs/2026-11-07-logs-centralizados-design.md`

## Global Constraints

Todas las tareas los incluyen implícitamente. Los valores van copiados de la spec o fijados aquí una sola vez para que las tareas no los reinventen.

**Del repo**
- `synchronize: false`: la migración es SQL a mano, **idempotente**, con procedimientos guardados por `information_schema` que se crean, se usan y se tiran en el mismo fichero (ver `backend/sql/migrations/028_tickets_archivados.sql` y `029_catalogo_de_sistemas.sql`). La de este plan es **`backend/sql/migrations/030_logs_centralizados.sql`** y vive entera en la Tarea 5.
- TypeORM devuelve `bigint` como cadena: nunca `===` entre ids; `sameId` de `backend/src/common/ids.ts`.
- Transacciones: `runInTransaction` + `manager.getRepository(...)`, nunca el repositorio inyectado.
- Errores HTTP con cuerpo `{ code, message }` (`HttpExceptionFilter`). Proyecciones con lista blanca, nunca la entidad cruda.
- Producción y CI corren Node 20; nada puede depender de una API de Node posterior.
- Producción en UTC, desarrollo en América/Lima: ninguna prueba puede depender de la zona del proceso.
- Comentarios y textos en español, explicando **el porqué**.
- Commits: `tipo(ámbito): ...` en español y en minúsculas, terminados en `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Sin push.
- Al final de cada tarea de backend: `cd backend && npx jest && npx tsc --noEmit`. De web: `cd web && npx tsc --noEmit -p . && npm run build`. Del appender: `dotnet test tools/kubo-log-appender/Kubo.Log4Net.sln`.

**Del appender (spec, «El appender»)**
- Clase `Kubo.Log4Net.KuboLogAppender : AppenderSkeleton`, ensamblado `Kubo.Log4Net.dll`, proyecto SDK-style en `tools/kubo-log-appender/`.
- Variantes: `net45` contra **log4net 2.0.8**; `net462` y `netstandard2.0` contra **log4net 3.x** (se fija **3.2.0**, la que usan los 24 proyectos de log4net 3 del inventario: sin `bindingRedirect` para ellos).
- **Sin dependencias externas**: JSON a mano, `HttpWebRequest`, `GZipStream`. (`Microsoft.NETFramework.ReferenceAssemblies` entra solo como herramienta de compilación con `PrivateAssets="all"`: esta máquina no tiene los reference assemblies de 4.6.2.)
- `Append` solo encola; hilo de fondo; cola acotada que descarta lo más viejo y cuenta lo descartado; reintento con espera creciente ante red/503/429; timeout corto; `OnClose` vacía con tope de tiempo; **nunca** lanza al aplicativo; sus fallos van a `log4net.Util.LogLog`.
- TLS 1.2 **sumado** a los protocolos activos, sin quitar ninguno.
- Parámetros: `Url`, `ApiKey`, `Aplicativo`, `Threshold` (el estándar), `BatchSize` (200), `FlushIntervalMs` (2000), `MaxQueueSize` (10000), `TimeoutMs` (5000), `Proxy` (opcional). Los números entre paréntesis son los valores por omisión que fija este plan.
- Zip `kubo-log-appender-<versión>.zip` con las DLL por variante, `MANUAL.md` y `MANUAL.html`. Versión inicial **1.0.0**.

**Del contrato de recepción (spec, «Recepción»)** — compartido por appender y backend; ningún lado lo cambia sin el otro.
- `POST /api/v1/ingest/logs`, cabecera `X-Kubo-Log-Key`, sin JWT. Clave inválida o revocada → **401**.
- Cuerpo: `{ loteId, aplicativo, servidor, appenderVersion, descartados, eventos: [ { ts, nivel, logger, mensaje, excepcion?, hilo?, propiedades? } ] }`; `ts` ISO 8601 UTC; admite `Content-Encoding: gzip`. `loteId` (GUID, el mismo en cada reintento del mismo lote) y `descartados` (eventos que el appender tiró por cola llena desde el último envío) son **añadidos de este plan** (ver Review Focus 1 y la spec: «cuenta lo descartado, que se reporta en el siguiente lote»). El servidor tolera campos desconocidos.
- Límites: lote ≤ **1000** eventos y ≤ **2 MB** descomprimido (413); `mensaje` y `excepcion` recortados a **32 KB** (32768 caracteres) cada uno; **600 lotes/min** por instalación → **429** con `Retry-After`; `aplicativo` y `servidor` ≤ 100 caracteres; `propiedades` ≤ 50 claves de ≤ 1024 caracteres.
- Respuesta **202** `{ aceptados, descartadosPorNivel }`. Loki caído o 5xx → **503** (el appender reintenta) y los errores de MySQL se procesan igual.
- La propiedad `kubo:ruc` solo cuenta en instalaciones internas; en las de cliente se ignora.

**Del almacenamiento**
- Loki: etiquetas fijas `instalacion`, `cliente` (id o `interno`), `sistema` (`systems.id` o `ninguno`), `aplicativo`, `servidor`, `nivel` (`DEBUG|INFO|WARN|ERROR|FATAL`). `instalacion` es un añadido de este plan (baja cardinalidad; lo necesita «ver logs alrededor»). Todo lo demás va en la línea, como JSON.
- Retención: Loki **30 días** (`LOKI_RETENTION`, por omisión `720h`); ocurrencias y conteos diarios **180 días**; el grupo se conserva mientras tenga ticket o se haya visto en 180 días.
- `LOKI_URL` por omisión `http://loki:3100`. Loki no se publica por Caddy.
- Nivel mínimo por instalación, por omisión **`INFO`**. Muestras por grupo: **50**.
- Estados del grupo: `NUEVO`, `CON_TICKET`, `RESUELTO`. Origen de ticket nuevo: `MONITOREO`.

**De seguridad y tiempo real**
- Lectura de logs y errores: `JwtAuthGuard` + `StaffOnlyGuard`. Instalaciones, claves, paquete y manual: además `RolesGuard` + `@Roles('ADMIN')`.
- La clave se muestra **una sola vez**; en la base solo su huella SHA-256 (como `secret_fingerprint` de las invitaciones). Formato: `klog_` + 43 caracteres base64url (32 bytes aleatorios).
- Socket: namespace `/tickets`, path `/api/socket.io`, solo personal (sala `staff`). Eventos nuevos: `error:new`, `errors:changed`, `logs:lines`, `monitoreo:disco`; del cliente: `logs:subscribe`, `logs:unsubscribe`. Tope en vivo: **200 líneas por segundo y socket**; el exceso se cuenta en `omitidas`.

## Review Focus

Las cinco entradas que la spec implica y que ninguna prueba ejercitaría sin esto escrito. Cada una tiene su prueba en la tarea que posee el código.

1. **Loki responde 503 y el appender reintenta el mismo lote.** La spec dice que los errores de MySQL «se procesan igual»: sin más, cada reintento vuelve a sumar las mismas ocurrencias. Un lote reintentado (mismo `loteId`, misma instalación, en 15 min) solo reintenta Loki: no suma ocurrencias ni vuelve a publicar en vivo. → Tarea 13.
2. **El reloj del servidor del cliente va desfasado** (horas, o días tras una caída de BIOS). Loki rechaza muestras de más de 7 días o del futuro, el ingreso respondería 4xx/503 para siempre y el appender reintentaría sin fin. Un `ts` fuera de `[ahora − 7 días, ahora + 5 min]` se guarda con la hora de recepción y el original va en la línea como `tsOriginal`; un 4xx de Loki se registra y responde 202, nunca 503. → Tareas 8 y 13.
3. **La clave en claro acabando en `audit_log`.** `AuditInterceptor` guarda cuerpo y respuesta de todo POST: la respuesta de crear o regenerar clave la llevaría en claro, y cada lote de logs (hasta 2 MB) llenaría la auditoría. La respuesta lleva la clave en un campo llamado `secret` (el tachado ya lo cubre) y la ruta de ingesta queda fuera de la auditoría. → Tareas 10 y 13.
4. **La pantalla de Logs en vivo tras una reconexión del socket** (token renovado, red caída). socket.io pierde la suscripción al reconectar; la página tiene que volver a mandar `logs:subscribe` en cada `connect`. Y en el servidor, un `logs:subscribe` que llega antes de que el handshake asíncrono haya metido al socket en `staff` se ignora. → Tareas 9 y 18.
5. **Dos personas pulsan «Crear ticket» a la vez** (o un doble clic). Sin reserva previa salen dos tickets para el mismo error. El grupo se reserva con un `UPDATE ... WHERE status <> 'CON_TICKET'` antes de crear el ticket; el segundo recibe 409 y no crea nada. → Tarea 12.

---

## Orden y paralelismo

```
.NET  (independiente de todo el backend; solo comparte el contrato de arriba)
  T1 ─► T2 ─► T3 ─► T4

Backend
  T5 ─► T6
  T8 ─► T7 (Loki)          T5, T8 y T1 no dependen de nada: se arrancan a la vez
  T8 ─► T9 (socket)
  T5 + T8 ─► T10 (instalaciones)
  T5 + T8 + T9 + T10 ─► T11 (grupos) ─► T12 (acciones)
  T7 + T9 + T10 + T11 ─► T13 (recepción)
  T7 + T10 ─► T14 (búsqueda de logs)
  T9 + T10 + T11 ─► T15 (retención, disco, paquete)

Web  (necesita los contratos de T10–T15; compila sin el backend corriendo)
  T16 ─► T17 ∥ T18 ∥ T19
Cierre
  T20 (todo)
```

Independientes entre sí: **{T1–T4}** con cualquier tarea de backend; **T5, T8** entre sí; **T6, T7, T9, T10** entre sí una vez hechas T5 y T8; **T12, T13, T14, T15** entre sí una vez hecha T11 (T14 no necesita T11); **T17, T18, T19** entre sí. T4 escribe en `backend/assets/` y en un spec propio, ficheros que ninguna otra tarea toca.

## Estructura de ficheros

**Appender — se crean** (`tools/kubo-log-appender/`)
- `Kubo.Log4Net.sln` (formato `.sln`: `dotnet new sln --format sln`), `Directory.Build.props` (`<Version>1.0.0</Version>`, `<LangVersion>7.3</LangVersion>`, `<Nullable>disable</Nullable>`).
- `src/Kubo.Log4Net/Kubo.Log4Net.csproj` — `TargetFrameworks` `net45;net462;netstandard2.0`; log4net condicional por TFM; `InternalsVisibleTo` de los tests.
- `src/Kubo.Log4Net/KuboLogAppender.cs` — el adaptador a log4net; lo único que ve log4net.
- `src/Kubo.Log4Net/Internal/LogEventData.cs`, `BatchPayload.cs` — el evento ya copiado, sin tipos de log4net.
- `src/Kubo.Log4Net/Internal/KuboJson.cs` — escritura JSON a mano.
- `src/Kubo.Log4Net/Internal/KuboLogClient.cs` — cola, hilo, lotes, reintentos, cierre.
- `src/Kubo.Log4Net/Internal/HttpBatchSender.cs` — `HttpWebRequest` + gzip + proxy + TLS.
- `src/Kubo.Log4Net/Internal/ClientOptions.cs`, `Backoff.cs`, `TlsSetup.cs`.
- `tests/Kubo.Log4Net.Tests/Kubo.Log4Net.Tests.csproj` — `TargetFrameworks` `net10.0;net48`; `FakeIngestServer.cs` (servidor HTTP sobre `TcpListener`), `KuboJsonTests.cs`, `KuboLogClientTests.cs`, `HttpBatchSenderTests.cs`, `KuboLogAppenderTests.cs`.
- `MANUAL.md`, `manual-template.html`, `ejemplo-log4net.config`, `build.ps1`.

**Backend — se crean**
- `backend/sql/migrations/030_logs_centralizados.sql`.
- `backend/src/modules/monitoring/` — módulo nuevo:
  - `monitoring.module.ts`
  - `domain/log-level.ts`, `domain/event-time.ts`, `domain/ingest-batch.ts`, `domain/log-filter.ts`, `domain/error-fingerprint.ts`, `domain/error-group-state.ts`, `domain/installation-key.ts`, `domain/error-ticket-text.ts` (+ un `.spec.ts` por fichero)
  - `entities/log-installation.entity.ts`, `log-installation-source.entity.ts`, `error-group.entity.ts`, `error-occurrence.entity.ts`, `error-group-daily.entity.ts`
  - `loki/loki.client.ts`, `loki/logql.ts` (+ specs)
  - `installations.repository.ts`, `installations.service.ts`, `installations.controller.ts`, `dto/installation.dto.ts` (+ spec del servicio)
  - `error-groups.repository.ts`, `error-groups.service.ts`, `error-actions.service.ts`, `errors.controller.ts`, `dto/error-group.dto.ts` (+ specs)
  - `ingest/installation-key.guard.ts`, `ingest/ingest.controller.ts`, `ingest/ingest.service.ts`, `ingest/ingest-rate-limiter.ts`, `ingest/recent-batches.ts`, `ingest/ingest-json-limit.ts` (+ specs e `ingest.integration.spec.ts`)
  - `logs.service.ts`, `logs.controller.ts`, `dto/log-search.dto.ts` (+ spec)
  - `monitoring-retention.scheduler.ts`, `disk-watch.service.ts`, `appender-package.service.ts` (+ specs), `appender-assets.spec.ts` (Tarea 4)
- `backend/assets/kubo-log-appender/` — `manifest.json`, el zip, `MANUAL.md`, `MANUAL.html` (los genera `build.ps1`).
- `loki/loki-config.yaml` (raíz del repo).

**Backend — se modifican**
- `backend/src/modules/tickets/entities/ticket.entity.ts` — `MONITOREO` en `TicketOrigin`/`TICKET_ORIGINS`; `INTERNAL_TICKET_ORIGINS`, `isInternalTicketOrigin`.
- `backend/src/modules/tickets/tickets.repository.ts` (+ spec) — `excludeInternal` en `list`; el informe del portal excluye `MONITOREO`.
- `backend/src/modules/portal/portal-tickets.service.ts` (+ spec), `backend/src/modules/ticket-messages/actor-scope.ts` (+ spec nuevo), `backend/src/modules/notifications/domain/notification-rules.ts` (+ spec).
- `backend/src/modules/tickets/tickets-realtime.gateway.ts` (+ spec).
- `backend/src/common/interceptors/audit.interceptor.ts` (+ spec).
- `backend/src/config/portal-schema.validator.ts` (+ spec), `backend/src/common/migraciones-desplegadas.spec.ts`.
- `backend/src/main.ts`, `backend/src/test-utils/test-http-app.ts`, `backend/src/app.module.ts`, `backend/Dockerfile`, `backend/.env.example`.
- `docker-compose.yml`, `docker-compose.dev.yml`, `.github/workflows/deploy.yml`, `.env.production.example`.

**Web — se crean**
- `web/src/api/monitoring.api.ts` (tipos y llamadas del monitoreo, aparte de `types.ts`).
- `web/src/pages/monitoring/`: `MonitoringErrorsPage.tsx`, `MonitoringErrorDetailPage.tsx`, `CreateTicketFromErrorDialog.tsx`, `ErrorOccurrencesChart.tsx`, `MonitoringLogsPage.tsx`, `LogLineRow.tsx`, `MonitoringFilters.tsx`, `MonitoringInstallationsPage.tsx`, `InstallationKeyDialog.tsx`, `monitoring-ui.ts`, `useNewErrorNotifier.ts`.

**Web — se modifican**
- `web/src/lib/realtime.ts`, `web/src/layout/AppLayout.tsx`, `web/src/App.tsx`, `web/src/auth/permissions.ts`, `web/src/api/types.ts`, `web/src/pages/tickets/ticket-ui.ts`, `web/src/pages/tickets/useNewTicketNotifier.ts`, `web/src/pages/TicketDetailPage.tsx`.

---

## Tarea 1: Appender — solución, evento copiado y JSON a mano

**Files:**
- Create: `tools/kubo-log-appender/Kubo.Log4Net.sln`, `Directory.Build.props`, `src/Kubo.Log4Net/Kubo.Log4Net.csproj`, `src/Kubo.Log4Net/Internal/LogEventData.cs`, `Internal/BatchPayload.cs`, `Internal/KuboJson.cs`
- Create: `tools/kubo-log-appender/tests/Kubo.Log4Net.Tests/Kubo.Log4Net.Tests.csproj`, `KuboJsonTests.cs`
- Modify: `.gitignore` (añadir `tools/kubo-log-appender/**/bin/`, `**/obj/`, `tools/kubo-log-appender/out/`)

**Interfaces:**
- Produces:
  - `internal sealed class LogEventData { DateTime TimestampUtc; string Level; string Logger; string Message; string Exception /*null*/; string Thread /*null*/; IDictionary<string,string> Properties /*nunca null*/ }`
  - `internal sealed class BatchPayload { string LoteId; string Aplicativo; string Servidor; string AppenderVersion; long Descartados; IList<LogEventData> Eventos }`
  - `internal static class KuboJson { string Serialize(BatchPayload p); void WriteString(StringBuilder sb, string value); const int MaxTextChars = 32768; string Truncate(string s, int max); }`

- [ ] **Paso 1: proyecto y solución.** `Kubo.Log4Net.csproj`: `TargetFrameworks` `net45;net462;netstandard2.0`; `PackageReference log4net` `2.0.8` con `Condition="'$(TargetFramework)'=='net45'"` y `3.2.0` en las otras dos; `Microsoft.NETFramework.ReferenceAssemblies` `1.0.3` con `PrivateAssets="all"`; `<InternalsVisibleTo Include="Kubo.Log4Net.Tests" />`; `RootNamespace` `Kubo.Log4Net`. Tests: `TargetFrameworks` `net10.0;net48`, `xunit` 2.9.x, `xunit.runner.visualstudio` 2.8.x, `Microsoft.NET.Test.Sdk` 17.x, y **dos** `ProjectReference` condicionales al mismo proyecto: en `net48` con `SetTargetFramework="TargetFramework=net45"` (prueba la variante log4net 2.0.8) y en `net10.0` con `SetTargetFramework="TargetFramework=netstandard2.0"` (log4net 3.2.0), cada una con su `PackageReference log4net` igual a la de la variante. Comentario en el csproj explicando por qué hay dos referencias.

- [ ] **Paso 2: pruebas que fallan** en `KuboJsonTests.cs`:
  - `Serialize_EscribeLosCamposDelContrato`: un lote con un evento produce exactamente las claves `loteId`, `aplicativo`, `servidor`, `appenderVersion`, `descartados`, `eventos` y en el evento `ts`, `nivel`, `logger`, `mensaje`, `excepcion`, `hilo`, `propiedades` (`excepcion`/`hilo` se omiten si son null).
  - `Ts_EsIsoUtcConMilisegundos`: `new DateTime(2026,11,7,15,4,5,123,DateTimeKind.Utc)` → `"2026-11-07T15:04:05.123Z"`, con `CultureInfo("es-PE")` como cultura actual del hilo.
  - `WriteString_Escapa`: `"a\"b\\c\n\r\t\u0001é😀"` → `"a\"b\\c\n\r\t\u0001é😀"` en JSON válido (comillas, barra, controles como `\uXXXX`, no-ASCII sin escapar).
  - `Truncate_CortaA32KYMarca`: un texto de 40000 caracteres queda en 32768 y termina en `…[recortado]`; uno corto no cambia; null sigue null.
  - `Serialize_EsParseableYRedondo`: en `net10.0`, `System.Text.Json.JsonDocument.Parse` del resultado devuelve los mismos valores (solo el proyecto de tests puede usar `System.Text.Json`; bajo `#if NET`).

- [ ] **Paso 3: correr y ver fallar.** `dotnet test tools/kubo-log-appender/Kubo.Log4Net.sln` → FAIL (tipos no existen).

- [ ] **Paso 4: implementar** `LogEventData`, `BatchPayload` y `KuboJson` con `StringBuilder`, sin reflexión. `ts` con `ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture)`. El recorte respeta pares sustitutos (no deja medio emoji).

- [ ] **Paso 5: correr.** Mismo comando → PASS en `net10.0` y `net48`.

- [ ] **Paso 6: commit.** `feat(appender): proyecto Kubo.Log4Net con evento propio y JSON escrito a mano`

---

## Tarea 2: Appender — cliente de envío (cola, hilo, lotes, reintentos, TLS, proxy)

**Files:**
- Create: `tools/kubo-log-appender/src/Kubo.Log4Net/Internal/ClientOptions.cs`, `Backoff.cs`, `TlsSetup.cs`, `HttpBatchSender.cs`, `KuboLogClient.cs`
- Create: `tools/kubo-log-appender/tests/Kubo.Log4Net.Tests/FakeIngestServer.cs`, `HttpBatchSenderTests.cs`, `KuboLogClientTests.cs`

**Interfaces:**
- Consumes: `KuboJson.Serialize`, `BatchPayload`, `LogEventData` (Tarea 1).
- Produces:
  - `internal sealed class ClientOptions { string Url; string ApiKey; string Aplicativo; string Servidor; string AppenderVersion; int BatchSize = 200; int FlushIntervalMs = 2000; int MaxQueueSize = 10000; int TimeoutMs = 5000; string Proxy; int ShutdownTimeoutMs = 3000; int MaxBatchChars = 1500000; }`
  - `internal enum SendOutcome { Ok, Retry, RetryLater /*401*/, Drop /*400, 413*/ }`
  - `internal interface IBatchSender { SendOutcome Send(string json, out int retryAfterMs); }`
  - `internal sealed class HttpBatchSender : IBatchSender { HttpBatchSender(ClientOptions o); }`
  - `internal static class TlsSetup { void EnsureTls12(); }`
  - `internal static class Backoff { int DelayMs(int attempt, int retryAfterMs, Random rnd); }` — `min(1000·2^attempt, 60000)` + 0–20 % de jitter; si `retryAfterMs > 0`, el mayor de los dos.
  - `internal sealed class KuboLogClient : IDisposable { KuboLogClient(ClientOptions o, IBatchSender sender, Action<string, Exception> diag); void Enqueue(LogEventData e); bool Flush(int timeoutMs); void Dispose(); long DroppedCount { get; } int QueueCount { get; } }`

- [ ] **Paso 1: `FakeIngestServer`** sobre `TcpListener(IPAddress.Loopback, 0)` (no `HttpListener`: exige reservas de URL en Windows). Lee línea de petición, cabeceras y `Content-Length`; guarda cada petición (`RequestLine`, `Headers`, `Body` ya descomprimido si `Content-Encoding: gzip`); responde con una cola de códigos configurable (`Enqueue(int status, string retryAfter = null)`, por omisión 202) y opcionalmente con retraso (`DelayMs`). Expone `Url` (`http://127.0.0.1:{puerto}/api/v1/ingest/logs`), `Requests` y `WaitForRequests(int n, int timeoutMs)`.

- [ ] **Paso 2: pruebas que fallan** en `HttpBatchSenderTests.cs`:
  - `EnviaGzipConCabecerasDelContrato`: la petición llega con `POST`, `X-Kubo-Log-Key: <clave>`, `Content-Type: application/json; charset=utf-8`, `Content-Encoding: gzip` y el cuerpo descomprimido igual al JSON entregado.
  - `MapeaCodigos`: 202→`Ok`; 503, 500, 429 y conexión rechazada→`Retry`; 429 con `Retry-After: 7`→`retryAfterMs == 7000`; 401→`RetryLater`; 400 y 413→`Drop`.
  - `RespetaTimeout`: servidor con `DelayMs = 3000` y `TimeoutMs = 300` → `Retry` en menos de 2 s.
  - `UsaElProxy`: `Proxy = fake.BaseUrl`, `Url = "http://kubo.invalid/api/v1/ingest/logs"` → el falso recibe `RequestLine` que empieza por `POST http://kubo.invalid/api/v1/ingest/logs`.
  - `Tls12SeSumaSinQuitar`: con `ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls`, `TlsSetup.EnsureTls12()` deja `Tls | Tls12`; con el valor `0` (SystemDefault) lo deja en `0` (forzar Tls12 ahí quitaría TLS 1.3 en .NET 5+). Restaura el valor original al terminar. `[Collection("Global")]` para no correr en paralelo con otras pruebas que tocan `ServicePointManager`.

- [ ] **Paso 3: pruebas que fallan** en `KuboLogClientTests.cs` (cliente real + `HttpBatchSender` + `FakeIngestServer`):
  - `EnviaAlLlegarABatchSize`: `BatchSize = 5`, `FlushIntervalMs = 60000`; 5 eventos → 1 petición con 5 eventos en menos de 2 s.
  - `EnviaPorTiempo`: `FlushIntervalMs = 200`; 1 evento → llega antes de 2 s.
  - `EnqueueNoBloqueaConElServidorColgado`: servidor con `DelayMs = 10000`; 10 000 llamadas a `Enqueue` tardan < 200 ms.
  - `ColaAcotadaDescartaLoMasViejoYLoReporta`: `MaxQueueSize = 10`, servidor que responde 503 a todo; 25 eventos → `QueueCount == 10`, `DroppedCount == 15`; luego el servidor responde 202 y el primer lote aceptado lleva `"descartados":15` y el contador vuelve a 0; los eventos que llegan son los 10 más nuevos.
  - `ReintentaElMismoLoteConElMismoLoteId`: 503, 503, 202 → tres peticiones con el mismo `loteId` y los mismos eventos, en ese orden.
  - `Un400DescartaElLoteYSigue`: 400 y luego 202 → el segundo lote no repite los eventos del primero; `diag` recibió un aviso.
  - `LoteNoSuperaMaxBatchChars`: 300 eventos de 30 000 caracteres con `BatchSize = 1000` → ningún cuerpo supera 1 500 000 caracteres y llegan los 300.
  - `DisposeVaciaConTope`: 50 eventos encolados, servidor sano → `Dispose()` envía los 50 y vuelve; con servidor colgado (`DelayMs = 10000`), `Dispose()` vuelve en menos de `ShutdownTimeoutMs + 1000`.
  - `NingunFalloEscapa`: un `IBatchSender` que lanza `InvalidOperationException` → `Enqueue`/`Flush`/`Dispose` no lanzan y `diag` lo recibe.

- [ ] **Paso 4: correr y ver fallar.** `dotnet test tools/kubo-log-appender/Kubo.Log4Net.sln` → FAIL.

- [ ] **Paso 5: implementar.** `HttpBatchSender.Send`: `HttpWebRequest` con `Method = "POST"`, `Timeout = ReadWriteTimeout = TimeoutMs`, `ServicePoint.Expect100Continue = false`, `Proxy = new WebProxy(Proxy) { UseDefaultCredentials = true }` si viene, cuerpo UTF-8 sin BOM comprimido con `GZipStream`; `WebException` con respuesta → por código; sin respuesta → `Retry`. `TlsSetup.EnsureTls12` usa el valor numérico `3072` (Tls12) y `0` (SystemDefault, que no existe en el enum de net45). `KuboLogClient`: cola `Queue<LogEventData>` bajo `lock`, `AutoResetEvent` para despertar al hilo (`IsBackground = true`, nombre `KuboLogAppender`); el lote en vuelo se conserva entre reintentos con su `loteId` (`Guid.NewGuid().ToString()`); `RetryLater` espera 5 minutos; durante el cierre solo un intento por lote y sin esperas.

- [ ] **Paso 6: correr.** Mismo comando → PASS en las dos plataformas.

- [ ] **Paso 7: commit.** `feat(appender): cola acotada con hilo propio, lotes gzip, reintentos, TLS 1.2 y proxy`

---

## Tarea 3: Appender — `KuboLogAppender` sobre log4net 2.0.8 y 3.2.0

**Files:**
- Create: `tools/kubo-log-appender/src/Kubo.Log4Net/KuboLogAppender.cs`
- Create: `tools/kubo-log-appender/tests/Kubo.Log4Net.Tests/KuboLogAppenderTests.cs`

**Interfaces:**
- Consumes: `KuboLogClient`, `ClientOptions`, `HttpBatchSender`, `TlsSetup` (Tarea 2).
- Produces: `public class KuboLogAppender : AppenderSkeleton` con propiedades públicas `Url`, `ApiKey`, `Aplicativo`, `BatchSize`, `FlushIntervalMs`, `MaxQueueSize`, `TimeoutMs`, `Proxy` (las que log4net rellena desde XML), y `internal KuboLogAppender(Func<ClientOptions, IBatchSender> senderFactory)` para las pruebas. Nombre de tipo para el XML: `Kubo.Log4Net.KuboLogAppender, Kubo.Log4Net`.

- [ ] **Paso 1: pruebas que fallan** (todas configuran log4net por XML desde una cadena con `XmlConfigurator.Configure(repo, XmlElement)` en un repositorio propio por prueba, contra `FakeIngestServer`; corren en `net48`→log4net 2.0.8 y en `net10.0`→3.2.0):
  - `ConfiguracionXmlRellenaParametros`: el XML del manual con `Url`, `ApiKey`, `Aplicativo`, `BatchSize`, `Threshold value="INFO"` → un `log.Info` llega con `aplicativo` igual al configurado y `servidor == Environment.MachineName`; un `log.Debug` no llega.
  - `CopiaPropiedadesEnElHiloQueEscribe`: `ThreadContext.Properties["kubo:ruc"] = "20123456789"`, `log.Error(...)`, `ThreadContext.Properties.Remove("kubo:ruc")`, `Flush` → el evento lleva `"kubo:ruc":"20123456789"`. Igual con `LogicalThreadContext`.
  - `OmiteLasPropiedadesInternasDeLog4net`: ninguna clave que empiece por `log4net:` llega.
  - `ExcepcionYNivel`: `log.Error("x", new InvalidOperationException("y"))` → `nivel == "ERROR"`, `excepcion` empieza por `System.InvalidOperationException: y`; `log.Fatal` → `"FATAL"`.
  - `SinUrlOClaveNoRompe`: `ActivateOptions` sin `Url` → `LogLog` recibe un error, `log.Info` no lanza y no hay petición.
  - `NuncaLanzaAlAplicativo`: con un `senderFactory` que lanza en `Send`, 1000 llamadas a `log.Error` no lanzan.
  - `CerrarElRepositorioVacia`: 20 eventos y `repo.Shutdown()` → llegan los 20.

- [ ] **Paso 2: correr y ver fallar.** `dotnet test tools/kubo-log-appender/Kubo.Log4Net.sln` → FAIL.

- [ ] **Paso 3: implementar.** `ActivateOptions`: valida `Url`/`ApiKey`/`Aplicativo` (si falta alguno, `LogLog.Error` y queda inerte), llama a `TlsSetup.EnsureTls12()`, crea el cliente con `AppenderVersion` = versión del ensamblado. `Append(LoggingEvent e)`: dentro de `try/catch` total, copia **en ese momento** `TimeStamp.ToUniversalTime()`, `Level.Name`, `LoggerName`, `RenderedMessage`, `GetExceptionString()`, `ThreadName` y `GetProperties()` (valores con `ToString()`, sin claves `log4net:`; recorte a 32 KB del mensaje y la excepción, 50 propiedades de 1024 caracteres) y encola. `OnClose`: `Dispose` del cliente. El mismo fichero compila contra las dos versiones de log4net: si alguna API difiere, `#if NET45`.

- [ ] **Paso 4: correr.** Mismo comando → PASS en `net48` y `net10.0`. Además `dotnet build tools/kubo-log-appender/src/Kubo.Log4Net -c Release` → tres DLL sin advertencias de referencia.

- [ ] **Paso 5: commit.** `feat(appender): KuboLogAppender para log4net 2.0.8 y 3.2.0, que copia el evento y nunca lanza`

---

## Tarea 4: Appender — manual, script de compilación y paquete servido por el backend

**Files:**
- Create: `tools/kubo-log-appender/MANUAL.md`, `manual-template.html`, `ejemplo-log4net.config`, `build.ps1`
- Create (los genera el script y se versionan): `backend/assets/kubo-log-appender/manifest.json`, `kubo-log-appender-1.0.0.zip`, `MANUAL.md`, `MANUAL.html`
- Create: `backend/src/modules/monitoring/appender-assets.spec.ts`

**Interfaces:**
- Produces: `manifest.json` con la forma `{ "version": "1.0.0", "zip": "kubo-log-appender-1.0.0.zip", "sha256": "<hex del zip>", "manualMd": "MANUAL.md", "manualHtml": "MANUAL.html", "generatedAt": "<ISO>" }` — la lee `AppenderPackageService` (Tarea 15).
- Zip: `kubo-log-appender-1.0.0/{MANUAL.md, MANUAL.html, ejemplo-log4net.config, log4net-2.x/net45/Kubo.Log4Net.dll, log4net-3.x/net462/Kubo.Log4Net.dll, log4net-3.x/netstandard2.0/Kubo.Log4Net.dll}`.

- [ ] **Paso 1: prueba que falla** `appender-assets.spec.ts` (lee el repo desde el backend, como `migraciones-desplegadas.spec.ts`): existe `backend/assets/kubo-log-appender/manifest.json`; el zip que nombra existe y su SHA-256 coincide con `sha256`; existen `MANUAL.md` y `MANUAL.html`; `version` coincide con `<Version>` de `tools/kubo-log-appender/Directory.Build.props`. Mensaje de fallo: «Ejecuta tools/kubo-log-appender/build.ps1».

- [ ] **Paso 2: correr.** `cd backend && npx jest src/modules/monitoring/appender-assets.spec.ts` → FAIL.

- [ ] **Paso 3: escribir `MANUAL.md`** en español, con estas secciones y en este orden (spec, «El manual de implementación»): 1) Qué es y qué no cambia (el archivo local sigue). 2) Pedir la clave en DevDocs → Monitoreo → Instalaciones (se ve una sola vez). 3) Elegir la variante: tabla «log4net 2.0.x → `log4net-2.x/net45`; log4net 3.x en .NET Framework 4.6.2–4.8 → `log4net-3.x/net462`; .NET 5 o posterior → `log4net-3.x/netstandard2.0`», y cómo ver la versión de log4net (referencia en el `.csproj`/`packages.config`, o propiedades del archivo `bin\log4net.dll`). 4) Copiar la DLL a `bin`. 5) `log4net.config`: el `<appender name="kubo" type="Kubo.Log4Net.KuboLogAppender, Kubo.Log4Net">` completo con todos los parámetros y `<threshold value="INFO" />`, y la línea `<appender-ref ref="kubo" />` en `<root>` junto a las que ya hay (mismo contenido que `ejemplo-log4net.config`). 6) `bindingRedirect` para .NET Framework cuando la versión de log4net del aplicativo no es 2.0.8 (variante net45) o 3.2.0 (net462), con el bloque `<dependentAssembly>` de `log4net` y `publicKeyToken="669e0ddf0bb1aa2a"`. 7) Instalaciones compartidas: `log4net.ThreadContext.Properties["kubo:ruc"] = ruc;` en una línea, y `LogicalThreadContext` para código asíncrono. 8) Publicar y verificar en Monitoreo → Logs (filtro por aplicativo) y en Instalaciones (último envío). 9) Solución de problemas: no llega nada (activar `log4net.Internal.Debug` y mirar la salida de `LogLog`), TLS, proxy (`Proxy`), clave revocada (401 en `LogLog`), nivel mínimo de la instalación. 10) Recomendación: retirar el `SmtpAppender` con la contraseña en texto plano. Sin bloques que dependan de Markdown no estándar.

- [ ] **Paso 4: `build.ps1`** (PowerShell 5.1, `$ErrorActionPreference = 'Stop'`): lee la versión de `Directory.Build.props`; `dotnet test Kubo.Log4Net.sln -c Release`; `dotnet build src/Kubo.Log4Net -c Release`; arma `out/kubo-log-appender-<v>/` con el diseño de arriba; genera `MANUAL.html` con `npx --yes marked@12.0.2 -i MANUAL.md` insertado en `manual-template.html` (CSS en línea, sin recursos externos; es una herramienta de compilación, no una dependencia del appender); crea el zip con `Compress-Archive`; borra de `backend/assets/kubo-log-appender/` los zip anteriores y copia zip, `MANUAL.md`, `MANUAL.html` y `manifest.json` (con `Get-FileHash -Algorithm SHA256`, en minúsculas). Comentario al inicio: por qué se compila aquí y no en Docker (spec).

- [ ] **Paso 5: ejecutar.** `powershell -ExecutionPolicy Bypass -File tools/kubo-log-appender/build.ps1` → termina sin error y deja los cuatro ficheros. Abrir el zip y comprobar las tres DLL.

- [ ] **Paso 6: correr.** `cd backend && npx jest src/modules/monitoring/appender-assets.spec.ts` → PASS.

- [ ] **Paso 7: commit.** `feat(appender): manual de implementacion y script que arma el paquete que sirve DevDocs`

---

## Tarea 5: Migración 030, validador de esquema, listas de despliegue y origen `MONITOREO`

**Files:**
- Create: `backend/sql/migrations/030_logs_centralizados.sql`
- Modify: `backend/src/config/portal-schema.validator.ts`, `backend/src/config/portal-schema.validator.spec.ts`, `backend/src/common/migraciones-desplegadas.spec.ts`
- Modify: `docker-compose.yml` (volumen de initdb `030_logs_centralizados.sql`, con comentario como el de la 029), `docker-compose.dev.yml` (`039_mig_030.sql`; la siembra pasa de `039_seed_templates.sql` a `040_seed_templates.sql`), `.github/workflows/deploy.yml` (añadir `030_logs_centralizados` al bucle tras `029_catalogo_de_sistemas`)
- Modify: `backend/src/modules/tickets/entities/ticket.entity.ts`

**Interfaces:**
- Produces:
  - Tablas (nombres de columna exactos; tipos `BIGINT UNSIGNED` para ids, `DATETIME(3)` para instantes de log, `utf8mb4_unicode_ci`):
    - `log_installations`: `id`, `kind ENUM('CLIENTE','INTERNA') NOT NULL`, `client_system_id NULL` (→ `client_systems.id`, solo `CLIENTE`), `name VARCHAR(120) NULL` (solo `INTERNA`), `system_id NULL` (→ `systems.id`, opcional en `INTERNA`; en `CLIENTE` se lee de la asignación), `min_level ENUM('DEBUG','INFO','WARN','ERROR','FATAL') NOT NULL DEFAULT 'INFO'`, `key_fingerprint CHAR(64) CHARACTER SET ascii NULL`, `key_prefix VARCHAR(12) NULL`, `key_created_at DATETIME NULL`, `key_revoked_at DATETIME NULL`, `last_seen_at DATETIME(3) NULL`, `created_by NULL`, `created_at`, `updated_at`; `UNIQUE uq_log_inst_fingerprint (key_fingerprint)`, `UNIQUE uq_log_inst_client_system (client_system_id)`; `CHECK` que exige `client_system_id` en `CLIENTE` y `name` en `INTERNA`.
    - `log_installation_sources`: `id`, `installation_id`, `aplicativo VARCHAR(100)`, `servidor VARCHAR(100)`, `appender_version VARCHAR(20) NULL`, `first_seen_at DATETIME(3)`, `last_seen_at DATETIME(3)`; `UNIQUE (installation_id, aplicativo, servidor)`.
    - `error_groups`: `id`, `fingerprint CHAR(64) CHARACTER SET ascii NOT NULL UNIQUE`, `installation_id`, `client_id NULL`, `system_id NULL` (catálogo), `aplicativo VARCHAR(100)`, `exception_type VARCHAR(255) NULL`, `title VARCHAR(300)`, `logger VARCHAR(255)`, `first_seen_at DATETIME(3)`, `last_seen_at DATETIME(3)`, `occurrences_total INT UNSIGNED NOT NULL DEFAULT 0`, `servers JSON NOT NULL`, `status ENUM('NUEVO','CON_TICKET','RESUELTO') NOT NULL DEFAULT 'NUEVO'`, `reopened_at DATETIME NULL`, `reopen_reason VARCHAR(200) NULL`, `ticket_id NULL`, `ticket_linked_by NULL`, `ticket_linked_at DATETIME NULL`, `resolved_by NULL`, `resolved_at DATETIME(3) NULL`, `resolution_note TEXT NULL`, `created_at`, `updated_at`; índices `(status, last_seen_at)`, `(client_id, last_seen_at)`, `(ticket_id)`, `(last_seen_at)`.
    - `error_occurrences`: `id`, `group_id`, `occurred_at DATETIME(3)`, `servidor VARCHAR(100)`, `hilo VARCHAR(100) NULL`, `logger VARCHAR(255)`, `message TEXT`, `exception TEXT NULL`, `properties JSON NULL`, `received_at DATETIME(3)`; índices `(group_id, occurred_at)`, `(occurred_at)`.
    - `error_group_daily`: `group_id`, `day DATE`, `count INT UNSIGNED`; `PRIMARY KEY (group_id, day)`, índice `(day)`.
  - `tickets.origin` amplía su ENUM conservando el orden y con el valor nuevo al final: `('EMAIL','WHATSAPP_TEXT','WHATSAPP_AUDIO','VOICE_LIVE','MEETING','NOTE','PORTAL','MONITOREO')`, guardado por `COLUMN_TYPE LIKE '%''MONITOREO''%'` como la sección 3 de la 028.
  - En `ticket.entity.ts`: `'MONITOREO'` en `TicketOrigin` y `TICKET_ORIGINS`; `export const INTERNAL_TICKET_ORIGINS: readonly TicketOrigin[] = ['MONITOREO']`; `export function isInternalTicketOrigin(origin: TicketOrigin | string | null | undefined): boolean`.

- [ ] **Paso 1: pruebas que fallan.**
  - En `portal-schema.validator.spec.ts`: `TABLAS_030 = ['log_installations','log_installation_sources','error_groups','error_occurrences','error_group_daily']` dentro de `TABLAS_ESPERADAS`; prueba `'atribuye a la 030 las tablas del monitoreo'` (quitar `error_groups` → el error nombra `030_logs_centralizados.sql`).
  - En `migraciones-desplegadas.spec.ts`, `describe('la migración del monitoreo')`: no contiene `DROP TABLE`, `TRUNCATE` ni `DELETE FROM`; contiene la lista completa del ENUM de arriba en ese orden; y la lista coincide con `TICKET_ORIGINS` importado de la entidad (las dos se escriben a mano: esta prueba es lo que las ata).
  - La prueba de las tres listas ya existente fallará sola al aparecer la 030.

- [ ] **Paso 2: correr.** `cd backend && npx jest src/config src/common/migraciones-desplegadas.spec.ts` → FAIL.

- [ ] **Paso 3: escribir la migración** con la cabecera explicativa (qué guarda cada tabla y por qué los logs no van a MySQL) y los procedimientos `kubo_*_030`; las tablas con `CREATE TABLE IF NOT EXISTS`. Registrar las cinco tablas en `REQUIRED_TABLES` con `MIGRATION_030` y su comentario («sin ellas el ingreso responde 500 y el aplicativo reintenta sin fin»). Añadir el origen en la entidad. Añadir la 030 a las tres listas.

- [ ] **Paso 4: aplicar contra la base de desarrollo dos veces** (idempotencia): `docker compose -f docker-compose.dev.yml exec -T mysql mysql -uroot -proot kubo_devdocs < backend/sql/migrations/030_logs_centralizados.sql` → sin error ambas veces; `SHOW COLUMNS FROM tickets LIKE 'origin'` muestra `MONITOREO` al final.

- [ ] **Paso 5: correr.** `cd backend && npx jest && npx tsc --noEmit` → PASS.

- [ ] **Paso 6: commit.** `feat(monitoreo): migracion 030 con instalaciones, grupos de error y el origen MONITOREO`

---

## Tarea 6: El portal no ve los tickets de `MONITOREO`

**Files:**
- Modify: `backend/src/modules/tickets/tickets.repository.ts`, `tickets.repository.spec.ts`
- Modify: `backend/src/modules/portal/portal-tickets.service.ts`, `portal-tickets.service.spec.ts`
- Modify: `backend/src/modules/ticket-messages/actor-scope.ts`; Create: `backend/src/modules/ticket-messages/actor-scope.spec.ts`
- Modify: `backend/src/modules/notifications/domain/notification-rules.ts`, `notification-rules.spec.ts`

**Interfaces:**
- Consumes: `INTERNAL_TICKET_ORIGINS`, `isInternalTicketOrigin` (Tarea 5).
- Produces: `TicketListFilters.excludeInternal?: boolean` (`t.origin NOT IN (:...internal)`).

- [ ] **Paso 1: pruebas que fallan.**
  - `tickets.repository.spec.ts`: `listForClientPeriod` y `countResolvedInPeriod` llaman con `where` que incluye `origin: Not(In(['MONITOREO']))` además de lo que ya tenían (actualizar los dos literales existentes y comprobar el operador por su forma, como `expectOpenRangeOperator`).
  - `portal-tickets.service.spec.ts`: `'el listado pide excluir los tickets internos'` (`tickets.list` recibe `{ clientId, excludeInternal: true }`); `'el detalle de un ticket MONITOREO del propio cliente responde NOT_FOUND, igual que uno inexistente'`.
  - `actor-scope.spec.ts`: `ticketIsVisible` — un ticket `MONITOREO` del mismo `clientId` es invisible con alcance restringido y visible sin restringir; un ticket `PORTAL` del mismo cliente sigue visible. (Es la puerta común de mensajes y adjuntos del portal.)
  - `notification-rules.spec.ts`: `'un ticket MONITOREO nunca produce aviso al cliente, con cualquier tipo, estado o autor'` recorriendo `TICKET_EVENT_TYPES × TICKET_STATUSES × hasClientAuthor ∈ {true,false} × messageVisibility ∈ {null,'PUBLICA'}`: ningún plan con `audience: 'CLIENT'`.

- [ ] **Paso 2: correr.** `cd backend && npx jest src/modules/tickets src/modules/portal src/modules/ticket-messages src/modules/notifications` → FAIL.

- [ ] **Paso 3: implementar.** Filtro en `list`, `Not(In(INTERNAL_TICKET_ORIGINS))` en las dos consultas del informe, `excludeInternal: true` en `PortalTicketsService.list`, la condición en `detail` (mismo `ticketNotFound()`), `&& !isInternalTicketOrigin(ticket.origin)` en la rama restringida de `ticketIsVisible`, y en `plansForEvent` la guarda `if (isInternalTicketOrigin(event.origin))` antes del bloque de cliente. Cada cambio con su comentario: los tickets del monitoreo son internos por decisión del responsable (spec) y hoy ya no avisarían, pero la regla no puede depender de que el autor sea del equipo.

- [ ] **Paso 4: correr.** `cd backend && npx jest && npx tsc --noEmit` → PASS.

- [ ] **Paso 5: commit.** `feat(portal): los tickets del monitoreo son internos en listado, detalle, hilo, informe y avisos`

---

## Tarea 7: Loki — contenedor, configuración y cliente

**Files:**
- Create: `loki/loki-config.yaml`
- Modify: `docker-compose.yml`, `docker-compose.dev.yml`, `.env.production.example`, `backend/.env.example`
- Create: `backend/src/modules/monitoring/loki/loki.client.ts`, `loki.client.spec.ts`, `loki/logql.ts`, `logql.spec.ts`

**Interfaces:**
- Consumes: `LogLevel`, `LOG_LEVELS`, `LogFilter` (Tarea 8).
- Produces:
  - `export interface LokiLabels { instalacion: string; cliente: string; sistema: string; aplicativo: string; servidor: string; nivel: LogLevel }`
  - `export interface LokiStream { labels: LokiLabels; entries: Array<{ at: Date; line: string }> }`
  - `export type LokiPushResult = { ok: true } | { ok: false; retryable: boolean; status: number | null; message: string }`
  - `export interface LokiEntry { labels: Record<string, string>; tsNs: string; line: string }`
  - `@Injectable() class LokiClient { push(streams: LokiStream[]): Promise<LokiPushResult>; queryRange(q: { query: string; start: Date; end: Date; limit: number; direction: 'backward' | 'forward' }): Promise<LokiEntry[]>; ready(): Promise<boolean> }` — `queryRange` lanza `ServiceUnavailableException({ code: 'LOKI_UNAVAILABLE', ... })` si Loki falla.
  - `logql.ts`: `escapeLogqlString(s: string): string`, `escapeRegex(s: string): string`, `buildLogQuery(f: LogFilter): string`.

- [ ] **Paso 1: pruebas que fallan.**
  - `logql.spec.ts`: sin filtros → `{instalacion=~".+"}`; con `cliente: 'interno'`, `sistemaId: 4`, `aplicativo: 'GCC.WEB'` → `{instalacion=~".+",cliente="interno",sistema="4",aplicativo="GCC.WEB"}`; `nivelMinimo: 'WARN'` → `nivel=~"WARN|ERROR|FATAL"`; `texto: 'a"b\\c.*'` → `|~ "(?i)a\"b\\\\c\\.\\*"` (comilla y barra escapadas para LogQL, metacaracteres escapados para la regex); un `aplicativo` con `"} or {x="` no puede cerrar el selector.
  - `loki.client.spec.ts` (sustituyendo `fetch` por un doble en la instancia): `push` manda `POST {LOKI_URL}/loki/api/v1/push` con `{ streams: [{ stream: labels, values: [[ns, line]] }] }`, `ns` en nanosegundos como cadena y estrictamente creciente para dos entradas del mismo milisegundo; 204→`{ok:true}`; 500/502/503, timeout (`AbortSignal` a `LOKI_TIMEOUT_MS`, por omisión 5000) y red caída → `retryable: true`; 400 → `retryable: false` con el mensaje de Loki; `queryRange` arma `query`, `start`/`end` en ns, `limit`, `direction` y aplana `data.result[].values` a `LokiEntry[]` ordenadas según `direction`.

- [ ] **Paso 2: correr.** `cd backend && npx jest src/modules/monitoring/loki` → FAIL.

- [ ] **Paso 3: implementar** con `fetch` de Node 20 (sin dependencias nuevas). `LOKI_URL` desde `ConfigService`, por omisión `http://loki:3100`.

- [ ] **Paso 4: `loki/loki-config.yaml`** (Loki 3, monolito, disco): `auth_enabled: false`; `server.http_listen_port: 3100`, `log_level: warn`; `common.path_prefix: /loki`, `replication_factor: 1`, anillo `inmemory`, `storage.filesystem`; `schema_config` con `store: tsdb`, `object_store: filesystem`, `schema: v13`, índice diario, `from: 2026-11-01`; `compactor` con `working_directory: /loki/compactor`, `retention_enabled: true`, `delete_request_store: filesystem`; `limits_config` con `retention_period: ${LOKI_RETENTION:-720h}`, `ingestion_rate_mb: 8`, `ingestion_burst_size_mb: 16`, `max_line_size: 256KB`, `reject_old_samples: true`, `reject_old_samples_max_age: 168h`; `analytics.reporting_enabled: false`. Comentarios con el porqué de cada límite.

- [ ] **Paso 5: compose.** Producción: servicio `loki` (`grafana/loki:3.4.2`, `restart: unless-stopped`, `command: ["-config.file=/etc/loki/config.yaml", "-config.expand-env=true"]`, `environment: LOKI_RETENTION: ${LOKI_RETENTION:-720h}` y `GOMEMLIMIT: 400MiB`, `mem_limit: 512m`, volúmenes `./loki/loki-config.yaml:/etc/loki/config.yaml:ro` y `loki_data:/loki`, red `internal`, **sin `ports`**); volumen `loki_data`; en `backend`: `LOKI_URL: http://loki:3100`, `LOKI_DATA_PATH: /loki-data`, `LOKI_DISK_ALERT_PCT: ${LOKI_DISK_ALERT_PCT:-80}`, `APPENDER_ASSETS_DIR: /app/assets/kubo-log-appender`, volumen `loki_data:/loki-data:ro` y `depends_on.loki: { condition: service_started }`. Desarrollo: el mismo servicio con `ports: ["3100:3100"]` y volumen `loki_dev_data`. `.env.production.example` y `backend/.env.example` documentan `LOKI_URL` (en desarrollo `http://localhost:3100`), `LOKI_RETENTION`, `LOKI_DISK_ALERT_PCT`, `LOKI_DATA_PATH`, `APPENDER_ASSETS_DIR`.

- [ ] **Paso 6: verificar.** `docker compose -f docker-compose.dev.yml up -d loki` y `curl -s localhost:3100/ready` → `ready` (puede tardar ~15 s). `docker compose config -q` y `docker compose -f docker-compose.dev.yml config -q` → sin salida.

- [ ] **Paso 7: correr.** `cd backend && npx jest src/modules/monitoring/loki && npx tsc --noEmit` → PASS.

- [ ] **Paso 8: commit.** `feat(monitoreo): Loki con retencion de 30 dias y cliente de push y consulta`

---

## Tarea 8: Dominio puro del monitoreo

**Files:**
- Create: `backend/src/modules/monitoring/domain/log-level.ts`, `event-time.ts`, `ingest-batch.ts`, `log-filter.ts`, `error-fingerprint.ts`, `error-group-state.ts` y un `.spec.ts` por cada uno

**Interfaces:**
- Produces:
  - `log-level.ts`: `type LogLevel = 'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL'`; `LOG_LEVELS: readonly LogLevel[]` en ese orden; `normalizeLevel(raw: unknown): LogLevel`; `meetsMinLevel(level: LogLevel, min: LogLevel): boolean`; `isErrorLevel(level: LogLevel): boolean`.
  - `event-time.ts`: `MAX_EVENT_AGE_MS = 7 * 24 * 3600 * 1000`, `MAX_EVENT_FUTURE_MS = 5 * 60 * 1000`; `resolveEventTime(rawTs: unknown, receivedAt: Date): { at: Date; original: string | null }` (`original` solo cuando se sustituyó); `peruDay(instant: Date): string` (`YYYY-MM-DD` en hora de Perú, con `PERU_UTC_OFFSET_MINUTES` de `common/peru-month.ts`).
  - `ingest-batch.ts`: constantes `MAX_EVENTS_PER_BATCH = 1000`, `MAX_BATCH_BYTES = 2 * 1024 * 1024`, `MAX_TEXT_CHARS = 32768`, `MAX_LABEL_CHARS = 100`, `MAX_PROPERTIES = 50`, `MAX_PROPERTY_CHARS = 1024`; `interface IngestEvent { ts: unknown; nivel: LogLevel; logger: string; mensaje: string; excepcion: string | null; hilo: string | null; propiedades: Record<string, string> }`; `interface IngestBatch { loteId: string | null; aplicativo: string; servidor: string; appenderVersion: string | null; descartados: number; eventos: IngestEvent[] }`; `parseIngestBatch(raw: unknown): { ok: true; batch: IngestBatch } | { ok: false; message: string }`; `truncateText(s: string, max: number): string`.
  - `log-filter.ts`: `interface LogFilter { instalacionId?: number; cliente?: number | 'interno'; sistemaId?: number; aplicativo?: string; servidor?: string; nivelMinimo?: LogLevel; texto?: string }`; `parseLogFilter(raw: unknown): LogFilter` (descarta lo inválido; `texto` ≤ 200).
  - `error-fingerprint.ts`: `FRAMEWORK_PREFIXES: readonly string[]` (`System.`, `Microsoft.`, `log4net.`, `Newtonsoft.`, `Dapper.`, `Oracle.`, `MySql.`, `Npgsql.`, `RestSharp.`, `Owin.`, `Castle.`, `Autofac.`, `NHibernate.`, `EntityFramework`, `lambda_method`); `normalizeMessage(msg: string): string`; `parseException(text: string | null): { type: string | null; frames: string[] }`; `firstOwnFrame(frames: string[]): string | null`; `computeErrorFingerprint(i: { clienteKey: string; sistemaKey: string; aplicativo: string; logger: string; mensaje: string; excepcion: string | null }): { fingerprint: string; exceptionType: string | null; title: string }`.
  - `error-group-state.ts`: `type ErrorGroupStatus = 'NUEVO'|'CON_TICKET'|'RESUELTO'`; `interface LinkedTicketState { code: string; status: TicketStatus; resolvedAt: Date | null; closedAt: Date | null }`; `interface GroupState { status: ErrorGroupStatus; resolvedAt: Date | null; ticketId: number | null; ticket: LinkedTicketState | null }`; `interface OccurrenceDecision { status: ErrorGroupStatus; notify: boolean; reopened: boolean; reason: string | null }`; `decideOnOccurrence(group: GroupState | null, occurredAt: Date): OccurrenceDecision`; `assertCanCreateTicket(s)`, `assertCanResolve(s)`, `assertCanReopen(s)` (lanzan `ConflictException({ code: 'CONFLICT', ... })`).

- [ ] **Paso 1: pruebas que fallan** (una suite por fichero):
  - `normalizeLevel`: `'debug'`, `TRACE`, `VERBOSE`, `ALL`→`DEBUG`; `NOTICE`→`INFO`; `WARNING`→`WARN`; `SEVERE`→`ERROR`; `CRITICAL`, `ALERT`, `EMERGENCY`→`FATAL`; `'raro'`, `null`, `5`→`INFO`. `meetsMinLevel('WARN','INFO') === true`, `('DEBUG','INFO') === false`.
  - `resolveEventTime` (con `receivedAt` fijo): ISO válido dentro de la ventana → ese instante y `original: null`; hace 8 días, dentro de 10 minutos, `'no-es-fecha'` y `undefined` → `receivedAt` y `original` con la cadena recibida. `peruDay(new Date('2026-11-08T03:00:00Z')) === '2026-11-07'`.
  - `parseIngestBatch`: lote mínimo válido; campos desconocidos ignorados (no error); falta `aplicativo` o `servidor`, o `eventos` no es arreglo → `ok: false`; 1001 eventos → `ok: false` con mensaje que dice 1000; `mensaje` de 40 000 caracteres → 32 768; `aplicativo` con saltos de línea y 150 caracteres → sin controles y 100; 60 propiedades → 50; propiedad objeto → descartada; número/booleano → cadena; `descartados` negativo o no numérico → 0; `loteId` no cadena → `null`.
  - `error-fingerprint`: `normalizeMessage` sobre `'Pedido 12345 del cliente 3f2504e0-4f89-11d3-9a0c-0305e82c3301 falló el 07/11/2026 10:15:00 en C:\\inetpub\\gcc\\x.config (0x1A)'` → `'Pedido <n> del cliente <guid> falló el <fecha> en <ruta> (<hex>)'`; ISO `2026-11-07T10:15:00.123Z` → `<fecha>`; espacios repetidos colapsados; recorte a 500. `parseException` del texto en inglés (`   at GCC.BL.Pagos.Aplicar(Int32 id) in C:\\src\\Pagos.cs:line 42`) y en español (`   en GCC.BL.Pagos.Aplicar(Int32 id) en C:\\src\\Pagos.cs:línea 42`) → mismo `type` y mismos marcos sin ruta ni línea; con `---> ` interna toma el tipo exterior. `firstOwnFrame` salta `System.`/`Microsoft.` y devuelve `GCC.BL.Pagos.Aplicar(Int32 id)`. `computeErrorFingerprint`: misma excepción con otro número de pedido y otra línea de código → misma huella; otro cliente → otra huella; sin excepción → depende de mensaje normalizado y `logger`; `title` = `'System.NullReferenceException: <primera línea del mensaje, ≤ 200>'`; huella de 64 hex.
  - `decideOnOccurrence` (tabla): `null` → `NUEVO`, notify, no reopened; `NUEVO` → `NUEVO`, sin notify; `RESUELTO` con `resolvedAt` anterior → `NUEVO`, notify, reopened, `reason: 'Reapareció después de marcarse como resuelto'`; `RESUELTO` con ocurrencia **anterior** a `resolvedAt` (llegó tarde de una cola) → sigue `RESUELTO`, sin notify; `CON_TICKET` con ticket `EN_ATENCION` → igual, sin notify; `CON_TICKET` con ticket `RESUELTO` (`resolvedAt` antes) → `NUEVO`, notify, reopened, `reason: 'Reapareció tras el ticket KB-0012'`; ticket `CERRADO` sin `resolvedAt` usa `closedAt`; ticket resuelto **después** de la ocurrencia → sigue `CON_TICKET`; `ticketId` con `ticket: null` (borrado) → `NUEVO`, notify, `reason: 'Reapareció y su ticket ya no existe'`. `assertCanCreateTicket('CON_TICKET')`, `assertCanResolve('RESUELTO')` y `assertCanReopen('NUEVO')` lanzan 409.

- [ ] **Paso 2: correr.** `cd backend && npx jest src/modules/monitoring/domain` → FAIL.

- [ ] **Paso 3: implementar.** Orden de `normalizeMessage` (el orden importa: una fecha contiene números): GUID → fechas ISO y `dd/MM/yyyy[ hh:mm[:ss][ a. m.]]` → horas sueltas `hh:mm:ss` (→ `<hora>`) → rutas Windows (`X:\…`), UNC (`\\…`) y Unix de dos o más segmentos → `0x…` → números (incluidos decimales) → espacios. Los marcos se normalizan igual para los dígitos (`<>c__DisplayClass5_0` cambia entre compilaciones). La huella es `sha256` hex de `[clienteKey, sistemaKey, aplicativo, type ?? '', normalizeMessage(mensaje), firstOwnFrame ?? (excepcion ? '' : logger)].join('\n')`.

- [ ] **Paso 4: correr.** `cd backend && npx jest src/modules/monitoring/domain && npx tsc --noEmit` → PASS.

- [ ] **Paso 5: commit.** `feat(monitoreo): niveles, hora del evento, lote, huella del error y su maquina de estados`

---

## Tarea 9: Socket — `error:new`, cola en vivo `logs:lines` y aviso de disco

**Files:**
- Create: `backend/src/modules/monitoring/domain/live-tail.ts`, `live-tail.spec.ts`
- Modify: `backend/src/modules/tickets/tickets-realtime.gateway.ts`, `tickets-realtime.gateway.spec.ts`

**Interfaces:**
- Consumes: `LogFilter`, `parseLogFilter`, `LogLevel`, `meetsMinLevel` (Tarea 8).
- Produces:
  - `live-tail.ts`: `interface LiveLogLine { ts: string; nivel: LogLevel; instalacionId: number; clienteId: number | null; sistemaId: number | null; aplicativo: string; servidor: string; logger: string; mensaje: string; excepcion: string | null; hilo: string | null }`; `matchesLogFilter(f: LogFilter, l: LiveLogLine): boolean` (`texto` sin distinguir mayúsculas sobre mensaje, excepción y logger; `cliente: 'interno'` casa con `clienteId === null`); `LIVE_MAX_LINES_PER_SECOND = 200`; `interface LiveBudget { windowStart: number; sent: number }`; `takeLiveBudget(b: LiveBudget | undefined, wanted: number, now: number): { budget: LiveBudget; allowed: number }`.
  - En el gateway: `interface ErrorNewPayload { id: number; title: string; aplicativo: string; clienteNombre: string | null; reopened: boolean; reason: string | null }`; `notifyErrorNew(p: ErrorNewPayload): void` (emite `error:new` y `errors:changed`); `notifyErrorsChanged(): void`; `notifyDiskAlert(p: { usedPct: number; threshold: number }): void` (`monitoreo:disco`); `@SubscribeMessage('logs:subscribe') subscribeLogs(client: Socket, raw: unknown): { ok: boolean }`; `@SubscribeMessage('logs:unsubscribe') unsubscribeLogs(client: Socket): { ok: true }`; `publishLogLines(lines: LiveLogLine[], now?: number): void` que emite `logs:lines` con `{ lines: LiveLogLine[]; omitidas: number }`.

- [ ] **Paso 1: pruebas que fallan.**
  - `live-tail.spec.ts`: filtros por cada campo; `texto` sin mayúsculas; `takeLiveBudget` deja 200 en un segundo, 0 el resto del segundo y vuelve a 200 al cambiar de ventana.
  - `tickets-realtime.gateway.spec.ts` (con el `server` simulado como `{ to, sockets: Map }`): `'un logs:subscribe antes de entrar en staff se ignora'` (socket sin `rooms.has('staff')` → `{ ok: false }` y no se une a `logs-live`); `'guarda el filtro saneado y se une a logs-live'`; `'publishLogLines solo manda a cada socket lo que casa con su filtro'`; `'con 500 líneas en un segundo un socket recibe 200 y omitidas 300'`; `'un socket que se dio de baja no recibe nada'`; `'notifyErrorNew emite error:new y errors:changed a staff'`; `'publicar nunca lanza aunque el servidor no esté montado'`.

- [ ] **Paso 2: correr.** `cd backend && npx jest src/modules/tickets/tickets-realtime.gateway.spec.ts src/modules/monitoring/domain/live-tail.spec.ts` → FAIL.

- [ ] **Paso 3: implementar.** El `server` de un gateway con `namespace` es el `Namespace`: se recorre `server.sockets` (Map) quedándose con los sockets en la sala `logs-live`; el filtro vive en `socket.data.logFilter` y el presupuesto en `socket.data.liveBudget`. Todo envuelto como `emit` (nunca tumba la recepción). Actualizar el comentario de cabecera del gateway con los mensajes nuevos.

- [ ] **Paso 4: correr.** `cd backend && npx jest && npx tsc --noEmit` → PASS.

- [ ] **Paso 5: commit.** `feat(monitoreo): el socket del personal avisa de errores nuevos y transmite logs en vivo con filtro y tope`

---

## Tarea 10: Módulo de monitoreo, instalaciones y claves (solo ADMIN)

**Files:**
- Create: `backend/src/modules/monitoring/monitoring.module.ts`, `entities/log-installation.entity.ts`, `entities/log-installation-source.entity.ts`, `domain/installation-key.ts`, `domain/installation-key.spec.ts`, `installations.repository.ts`, `installations.service.ts`, `installations.service.spec.ts`, `installations.controller.ts`, `dto/installation.dto.ts`
- Modify: `backend/src/app.module.ts`, `backend/src/common/interceptors/audit.interceptor.spec.ts`

**Interfaces:**
- Consumes: `LogLevel`, `LOG_LEVELS` (Tarea 8); `ClientSystemsRepository.findById`, `SystemsRepository.findById` (existentes, exportados por `TicketsModule`); `ClientsRepository` (exportado por `ClientsModule`).
- Produces:
  - `installation-key.ts`: `INSTALLATION_KEY_PREFIX = 'klog_'`; `generateInstallationKey(): string`; `fingerprintInstallationKey(key: string): string` (SHA-256 hex); `isWellFormedInstallationKey(key: unknown): boolean` (`/^klog_[A-Za-z0-9_-]{43}$/`); `keyDisplayPrefix(key: string): string` (9 primeros caracteres).
  - `interface ResolvedInstallation { id: number; kind: 'CLIENTE' | 'INTERNA'; clientId: number | null; systemId: number | null; minLevel: LogLevel; displayName: string }`
  - `interface InstallationView { id; kind; displayName; clientId; clientName; clientSystemId; systemId; systemName; minLevel; keyPrefix: string | null; keyStatus: 'ACTIVA' | 'REVOCADA' | 'SIN_CLAVE'; keyCreatedAt: string | null; lastSeenAt: string | null; sources: Array<{ aplicativo: string; servidor: string; appenderVersion: string | null; lastSeenAt: string }> }`
  - `interface IssuedKey { installation: InstallationView; secret: string }` — **el campo se llama `secret`** (lo tacha `AuditInterceptor`).
  - `InstallationsService`: `list(): Promise<InstallationView[]>`; `create(dto: CreateInstallationDto, actorUserId: number): Promise<IssuedKey>`; `regenerateKey(id: number): Promise<IssuedKey>`; `revokeKey(id: number): Promise<InstallationView>`; `update(id: number, dto: UpdateInstallationDto): Promise<InstallationView>`; `findActiveByFingerprint(fp: string): Promise<ResolvedInstallation | null>`; `touchSource(installationId: number, aplicativo: string, servidor: string, appenderVersion: string | null, at: Date): Promise<void>`; `listSourceOptions(): Promise<{ installations: Array<{ id: number; displayName: string; clientId: number | null; systemId: number | null }>; aplicativos: string[]; servidores: string[] }>`.
  - DTO: `CreateInstallationDto { kind: 'CLIENTE' | 'INTERNA'; clientSystemId?: number; name?: string; systemId?: number; minLevel?: LogLevel }`; `UpdateInstallationDto { minLevel?: LogLevel; name?: string }`.
  - Rutas (`@Controller('monitoring')`): `GET installations`, `POST installations`, `PATCH installations/:id`, `POST installations/:id/key` (regenerar), `DELETE installations/:id/key` (revocar) — `JwtAuthGuard, StaffOnlyGuard, RolesGuard` + `@Roles('ADMIN')`; `GET sources` — solo personal, sin rol.

- [ ] **Paso 1: pruebas que fallan.**
  - `installation-key.spec.ts`: la clave casa con el formato; dos claves distintas; huella de 64 hex y estable; `isWellFormedInstallationKey` rechaza `null`, prefijo ajeno y longitud distinta.
  - `installations.service.spec.ts` (repos simulados): `'CLIENTE exige una asignación que exista y tenga producto del catálogo'` (asignación inexistente → 404; `system_id` nulo, marcada por la 029 → 400); `'una asignación solo tiene una instalación'` (repetida → 409); `'INTERNA exige nombre'`; `'la clave se devuelve una vez y solo se guarda su huella'` (lo guardado tiene `keyFingerprint === fingerprintInstallationKey(secret)` y ninguna columna contiene `secret`); `'regenerar invalida la anterior'` (la huella vieja deja de resolver); `'revocar hace que findActiveByFingerprint devuelva null'`; `'findActiveByFingerprint de una CLIENTE trae cliente y producto de la asignación'`; `'una CLIENTE cuya asignación se borró no resuelve'`; `'minLevel por omisión es INFO'`.
  - `audit.interceptor.spec.ts`: `'la clave de instalación recién emitida no llega en claro al audit_log'` — respuesta `{ installation: { id: 3 }, secret: 'klog_…' }` → `payloadJson.response.secret === '***'`.

- [ ] **Paso 2: correr.** `cd backend && npx jest src/modules/monitoring src/common/interceptors` → FAIL.

- [ ] **Paso 3: implementar** las entidades (mismo estilo que `client-system.entity.ts`), el repositorio, el servicio, el controlador y `MonitoringModule` (`TypeOrmModule.forFeature` de las entidades, `imports: [TicketsModule, ClientsModule]`), y registrar el módulo en `app.module.ts`.

- [ ] **Paso 4: correr.** `cd backend && npx jest && npx tsc --noEmit` → PASS.

- [ ] **Paso 5: commit.** `feat(monitoreo): instalaciones de cliente e internas con clave de una sola vista y nivel minimo`

---

## Tarea 11: Agrupación de errores — registrar ocurrencias y leerlas

**Files:**
- Create: `backend/src/modules/monitoring/entities/error-group.entity.ts`, `error-occurrence.entity.ts`, `error-group-daily.entity.ts`, `error-groups.repository.ts`, `error-groups.service.ts`, `error-groups.service.spec.ts`, `errors.controller.ts`, `dto/error-group.dto.ts`
- Modify: `backend/src/modules/monitoring/monitoring.module.ts`

**Interfaces:**
- Consumes: `computeErrorFingerprint`, `decideOnOccurrence`, `peruDay` (Tarea 8); `TicketsRealtimeGateway.notifyErrorNew/notifyErrorsChanged` (Tarea 9); `TicketsRepository.findById` (existente).
- Produces:
  - `interface OccurrenceContext { installationId: number; aplicativo: string; servidor: string; receivedAt: Date }`
  - `interface ErrorEventInput { at: Date; clientId: number | null; systemId: number | null; nivel: LogLevel; logger: string; mensaje: string; excepcion: string | null; hilo: string | null; propiedades: Record<string, string> }`
  - `ErrorGroupsService.recordOccurrences(ctx: OccurrenceContext, events: ErrorEventInput[]): Promise<void>`
  - `ErrorGroupsService.list(q: ErrorListQueryDto): Promise<{ items: ErrorGroupView[]; total: number }>`; `summary(): Promise<{ nuevos: number }>`; `detail(id: number): Promise<ErrorGroupDetailView>`.
  - `ErrorListQueryDto { cliente?: string /* id o 'interno' */; sistemaId?: number; aplicativo?: string; servidor?: string; status?: ErrorGroupStatus; desde?: string; hasta?: string; q?: string; orden?: 'ultima' | 'cantidad'; ticketId?: number; page?: number; pageSize?: number /* ≤ 100, por omisión 25 */ }`
  - `ErrorGroupView { id; title; exceptionType; aplicativo; logger; installationId; clientId; clientName; systemId; systemName; status; firstSeenAt; lastSeenAt; occurrencesTotal; servers: string[]; reopenedAt; reopenReason; ticket: { id: number; code: string; status: TicketStatus } | null; resolvedAt; resolvedByName; resolutionNote }` (fechas ISO).
  - `ErrorGroupDetailView = ErrorGroupView & { occurrences: Array<{ id; occurredAt; servidor; hilo; logger; message; exception; properties }>; daily: Array<{ day: string; count: number }> /* últimos 30 días, con ceros */ }`
  - Rutas (`@Controller('monitoring/errors')`, personal): `GET /`, `GET summary`, `GET :id`.

- [ ] **Paso 1: pruebas que fallan** en `error-groups.service.spec.ts` (repos y gateway simulados, reloj fijo):
  - `'tres eventos con la misma huella en un lote son un grupo con tres ocurrencias y un solo aviso'`.
  - `'un grupo nuevo avisa con error:new y uno que sigue NUEVO no'`.
  - `'un RESUELTO que vuelve pasa a NUEVO, guarda reopened_at y el motivo, y avisa con reopened'`.
  - `'un CON_TICKET con el ticket abierto solo suma'` y `'con el ticket RESUELTO antes de la ocurrencia se reabre con «Reapareció tras el ticket KB-0012»'` (consulta el ticket por `ticketId`).
  - `'conserva solo las 50 ocurrencias más recientes'` (llama al recorte con 50) y `'servers une sin repetir y con tope de 20'`.
  - `'cuenta por día de Perú'` (un evento a las 03:00 UTC del 8 suma al día 7).
  - `'una instalación interna sin RUC usa interno en la huella'` y `'con cliente resuelto usa ese cliente'`.
  - `'si el INSERT del grupo choca con la clave única (otro lote lo creó a la vez), recarga y actualiza'` (el doble lanza `{ code: 'ER_DUP_ENTRY' }` la primera vez).
  - `'list filtra por cliente interno con client_id IS NULL'` y `'ordena por cantidad'` (sobre el query builder simulado o, si el repositorio es fino, sobre sus parámetros).
  - `'detail rellena con ceros los días sin ocurrencias'`.

- [ ] **Paso 2: correr.** `cd backend && npx jest src/modules/monitoring/error-groups.service.spec.ts` → FAIL.

- [ ] **Paso 3: implementar.** Por cada huella, una transacción: `SELECT ... FOR UPDATE` por `fingerprint`; si no existe, `INSERT` (y ante `ER_DUP_ENTRY`, volver a leer con bloqueo); `decideOnOccurrence` con la ocurrencia más reciente del lote; actualizar `last_seen_at = GREATEST(...)`, `occurrences_total += n`, `servers`, estado y motivo; insertar como mucho las 50 últimas ocurrencias del lote y recortar el grupo a 50; `INSERT ... ON DUPLICATE KEY UPDATE count = count + VALUES(count)` en `error_group_daily`. Los avisos, **después** del commit; `notifyErrorsChanged` como mucho cada 5 s (contador en el servicio) para no recargar la lista en cada lote.

- [ ] **Paso 4: correr.** `cd backend && npx jest && npx tsc --noEmit` → PASS.

- [ ] **Paso 5: commit.** `feat(monitoreo): errores agrupados por huella con muestras, conteo diario y reapertura`

---

## Tarea 12: Acciones sobre un error — Crear ticket, Resuelto, Reabrir

**Files:**
- Create: `backend/src/modules/monitoring/domain/error-ticket-text.ts`, `error-ticket-text.spec.ts`, `error-actions.service.ts`, `error-actions.service.spec.ts`
- Modify: `backend/src/modules/monitoring/errors.controller.ts`, `dto/error-group.dto.ts`, `monitoring.module.ts`

**Interfaces:**
- Consumes: `TicketsService.create(actor, dto, emailOrigin?, requirement?)`, `ClientSystemsRepository.findByClientAndSystem` (existentes); `assertCanCreateTicket/Resolve/Reopen` (Tarea 8); `ErrorGroupsService.detail` (Tarea 11).
- Produces:
  - `buildErrorTicketText(g: { id: number; title: string; aplicativo: string; logger: string; servers: string[]; firstSeenAt: Date; lastSeenAt: Date; occurrencesTotal: number }, last: { message: string; exception: string | null } | null, frontendUrl: string): { subject: string; rawText: string }` — `subject` = título ≤ 240; `rawText` con aplicativo, servidores, primera y última vez en hora de Perú (`formatPeruDateTime`), total, logger, mensaje, traza de la última ocurrencia y el enlace `{FRONTEND_URL}/monitoreo/errores/{id}`; recortado a 60 000 caracteres.
  - `CreateTicketFromErrorDto { clientId?: number; systemId?: number /* client_systems.id */ }`, `ResolveErrorDto { note?: string /* ≤ 2000 */ }`.
  - `ErrorActionsService`: `createTicket(id: number, actorUserId: number, dto: CreateTicketFromErrorDto): Promise<{ group: ErrorGroupView; ticket: { id: number; code: string } }>`; `resolve(id: number, actorUserId: number, note?: string): Promise<ErrorGroupView>`; `reopen(id: number, actorUserId: number): Promise<ErrorGroupView>`.
  - Rutas: `POST monitoring/errors/:id/ticket`, `POST monitoring/errors/:id/resolve`, `POST monitoring/errors/:id/reopen` (personal).

- [ ] **Paso 1: pruebas que fallan.**
  - `error-ticket-text.spec.ts`: contiene cada dato y el enlace; fechas en hora de Perú sin depender de la zona del proceso; una traza enorme deja el texto en 60 000.
  - `error-actions.service.spec.ts`:
    - `'crea el ticket con origen MONITOREO, actor del equipo, INCIDENCIA/SOFTWARE y la asignación del cliente y producto del grupo'` (comprueba los argumentos de `TicketsService.create`).
    - `'un grupo sin cliente acepta cliente y asignación elegidos en el diálogo'` y `'un grupo con cliente rechaza otro cliente en el cuerpo (400)'`.
    - `'si el alta exige sistema, el 400 «Elige el sistema afectado.» llega tal cual y el grupo vuelve a su estado'`.
    - `'reserva antes de crear: si el UPDATE condicional no afecta filas responde 409 y no crea ticket'` (Review Focus 5).
    - `'un fallo del alta deshace la reserva'`.
    - `'resolver guarda autor, fecha y nota y no crea ticket ni avisa al cliente'`; `'reabrir solo desde RESUELTO y deja reopen_reason «Reabierto a mano»'`.

- [ ] **Paso 2: correr.** `cd backend && npx jest src/modules/monitoring/error-actions.service.spec.ts src/modules/monitoring/domain/error-ticket-text.spec.ts` → FAIL.

- [ ] **Paso 3: implementar.** Reserva: `UPDATE error_groups SET status = 'CON_TICKET', ticket_linked_by = ?, ticket_linked_at = NOW() WHERE id = ? AND status <> 'CON_TICKET'`; si `affected === 0`, 409 `'Este error ya tiene un ticket.'`. Luego `TicketsService.create({ kind: 'STAFF', userId }, { rawText, subject, origin: 'MONITOREO', requestType: 'INCIDENCIA', serviceCategory: 'SOFTWARE', clientId, systemId })` con el requisito por omisión (`'EXIGIDO'`); si falla, restaurar el estado y `ticket_id` previos y relanzar; si va bien, `ticket_id = ticket.id`. La asignación sale de `findByClientAndSystem(group.clientId, group.systemId)` cuando las dos existen; si no hay, la del cuerpo. `FRONTEND_URL` desde `ConfigService` como hace el resto del backend.

- [ ] **Paso 4: correr.** `cd backend && npx jest && npx tsc --noEmit` → PASS.

- [ ] **Paso 5: commit.** `feat(monitoreo): crear ticket interno desde un error, marcarlo resuelto o reabrirlo`

---

## Tarea 13: Recepción `POST /api/v1/ingest/logs`

**Files:**
- Create: `backend/src/modules/monitoring/ingest/installation-key.guard.ts`, `ingest.controller.ts`, `ingest.service.ts`, `ingest.service.spec.ts`, `ingest-rate-limiter.ts`, `ingest-rate-limiter.spec.ts`, `recent-batches.ts`, `recent-batches.spec.ts`, `ingest-json-limit.ts`, `ingest.integration.spec.ts`
- Modify: `backend/src/main.ts`, `backend/src/test-utils/test-http-app.ts`, `backend/src/common/interceptors/audit.interceptor.ts`, `audit.interceptor.spec.ts`, `backend/src/modules/monitoring/monitoring.module.ts`

**Interfaces:**
- Consumes: `parseIngestBatch`, `resolveEventTime`, `meetsMinLevel`, `isErrorLevel`, `MAX_BATCH_BYTES` (Tarea 8); `LokiClient.push`, `LokiStream` (Tarea 7); `publishLogLines`, `LiveLogLine` (Tarea 9); `InstallationsService.findActiveByFingerprint/touchSource`, `ResolvedInstallation`, `fingerprintInstallationKey`, `isWellFormedInstallationKey` (Tarea 10); `ErrorGroupsService.recordOccurrences` (Tarea 11); `ClientsRepository.findByRuc` (existente).
- Produces:
  - `IngestRateLimiter.take(installationId: number, now: number): { ok: true } | { ok: false; retryAfterSec: number }` — ventana fija de 60 s, 600 lotes.
  - `RecentBatches.seen(installationId: number, loteId: string, now: number): boolean`; `remember(installationId: number, loteId: string, now: number): void` — TTL 15 min, tope 50 000 entradas.
  - `IngestService.ingest(inst: ResolvedInstallation, raw: unknown, receivedAt?: Date): Promise<{ aceptados: number; descartadosPorNivel: number }>`.
  - `registerIngestJsonLimit(app: INestApplication): void` — `json({ limit: MAX_BATCH_BYTES, inflate: true })` solo para `POST` a `/ingest/logs`, mismo patrón que `registerBulkSendJsonLimit`.

- [ ] **Paso 1: pruebas que fallan.**
  - `ingest-rate-limiter.spec.ts` y `recent-batches.spec.ts`: el lote 601 de un minuto da `retryAfterSec > 0`; otra instalación no se ve afectada; la ventana siguiente vuelve a dejar pasar; un `loteId` recordado se ve durante 15 min y deja de verse después.
  - `ingest.service.spec.ts` (Loki, repos y gateway simulados):
    - `'descarta lo que está por debajo del nivel mínimo y lo cuenta'`.
    - `'una instalación de cliente ignora kubo:ruc'`; `'una interna resuelve kubo:ruc contra clients.ruc y consulta cada RUC una vez por lote'`; `'un RUC desconocido queda como interno y no se rechaza'`.
    - `'agrupa en streams por etiquetas'` (`cliente`, `sistema`, `nivel`, `instalacion`, `aplicativo`, `servidor`) y la línea es JSON con `logger`, `mensaje`, `excepcion`, `hilo`, `propiedades`.
    - `'un ts fuera de ventana usa la hora de recepción y guarda tsOriginal en la línea'` (Review Focus 2).
    - `'si el appender descartó eventos, escribe una línea WARN que lo dice'`.
    - `'Loki reintentable → 503, pero los errores se registran'`; `'Loki 400 → se registra y responde normal, nunca 503'`.
    - `'un lote reintentado con el mismo loteId no vuelve a sumar ocurrencias ni a publicar en vivo, pero sí reintenta Loki'` (Review Focus 1).
    - `'solo ERROR y FATAL van a recordOccurrences'`; `'actualiza el origen (aplicativo, servidor, versión) y last_seen'`; `'publica en vivo las líneas aceptadas'`.
  - `ingest.integration.spec.ts` (con `startTestHttpApp`, el controlador real y servicios simulados; usa `app.raw(...)` para cabeceras y cuerpos binarios): sin cabecera → 401; clave mal formada → 401 sin consultar la base; clave válida → 202 `{ aceptados }`; cuerpo gzip → 202 con el mismo resultado; cuerpo de 2,5 MB descomprimido → 413; campo desconocido en el cuerpo → 202 (no `VALIDATION_ERROR`); lote 601 del minuto → 429 con `Retry-After`.
  - `audit.interceptor.spec.ts`: `'el ingreso de logs no se audita'` (POST a `/api/v1/ingest/logs` no guarda nada).

- [ ] **Paso 2: correr.** `cd backend && npx jest src/modules/monitoring/ingest src/common/interceptors` → FAIL.

- [ ] **Paso 3: implementar.** Guarda: lee `x-kubo-log-key`, comprueba formato, busca por huella, deja `req.installation`; 401 `{ code: 'UNAUTHORIZED', message: 'Clave de instalación inválida o revocada.' }`. Controlador: `@Controller('ingest')`, `@Post('logs')`, `@HttpCode(202)`, `@Body() body: unknown` (sin DTO a propósito: el pipe global con `forbidNonWhitelisted` rechazaría un appender más nuevo; ver comentario), `Retry-After` con `@Res({ passthrough: true })`. Servicio en este orden: límite de ritmo → `parseIngestBatch` (400) → nivel mínimo → hora → cliente → Loki → (si el lote no se había visto) errores y vivo → `remember` → fuente y `last_seen`. `AuditInterceptor`: salir antes de guardar si `req.path` termina en `/ingest/logs`, con el porqué. `registerIngestJsonLimit` en `main.ts` y en `startTestHttpApp`, junto a la del envío masivo.

- [ ] **Paso 4: correr.** `cd backend && npx jest && npx tsc --noEmit` → PASS.

- [ ] **Paso 5: prueba a mano** con el stack de desarrollo y Loki arriba: crear una instalación por `POST /api/v1/monitoring/installations` (token de ADMIN), luego `curl -i -X POST localhost:3000/api/v1/ingest/logs -H "X-Kubo-Log-Key: <clave>" -H "Content-Type: application/json" -d '{"aplicativo":"PRUEBA","servidor":"PC","eventos":[{"ts":"<ahora ISO>","nivel":"ERROR","logger":"X","mensaje":"falló 123"}]}'` → `202`; `curl -G localhost:3100/loki/api/v1/query_range --data-urlencode 'query={aplicativo="PRUEBA"}'` trae la línea; `SELECT * FROM error_groups` tiene un grupo.

- [ ] **Paso 6: commit.** `feat(monitoreo): recepcion de lotes con clave, limites, nivel minimo, RUC y reintentos sin duplicar`

---

## Tarea 14: Búsqueda de logs desde Loki

**Files:**
- Create: `backend/src/modules/monitoring/logs.service.ts`, `logs.service.spec.ts`, `logs.controller.ts`, `dto/log-search.dto.ts`
- Modify: `backend/src/modules/monitoring/monitoring.module.ts`

**Interfaces:**
- Consumes: `LokiClient.queryRange`, `buildLogQuery` (Tarea 7); `LogFilter` (Tarea 8).
- Produces:
  - `LogSearchQueryDto { instalacionId?: number; cliente?: string; sistemaId?: number; aplicativo?: string; servidor?: string; nivel?: LogLevel; q?: string; desde?: string; hasta?: string; cursor?: string; limit?: number }`
  - `LogLineView { id: string /* tsNs + índice */; ts: string; nivel: LogLevel; instalacionId: number; clienteId: number | null; sistemaId: number | null; aplicativo: string; servidor: string; logger: string; mensaje: string; excepcion: string | null; hilo: string | null; propiedades: Record<string, string> }`
  - `LogsService.search(q: LogSearchQueryDto, now?: Date): Promise<{ lines: LogLineView[]; nextCursor: string | null }>`
  - Ruta: `GET monitoring/logs` (personal).

- [ ] **Paso 1: pruebas que fallan** en `logs.service.spec.ts` (Loki simulado):
  - `'sin rango busca la última hora'`; `'un rango de más de 30 días responde 400'`; `'desde posterior a hasta responde 400'`.
  - `'limit por omisión 200 y tope 500'`.
  - `'pagina hacia atrás: nextCursor es el ns del último devuelto menos 1 y la siguiente consulta lo usa como end'`; `'con menos líneas que el límite nextCursor es null'`.
  - `'una línea que no es JSON se muestra como mensaje tal cual'`.
  - `'Loki caído responde 503 LOKI_UNAVAILABLE'`.

- [ ] **Paso 2: correr.** `cd backend && npx jest src/modules/monitoring/logs.service.spec.ts` → FAIL.

- [ ] **Paso 3: implementar** con `direction: 'backward'`. `cliente` se valida con `^(\d+|interno)$`.

- [ ] **Paso 4: correr.** `cd backend && npx jest && npx tsc --noEmit` → PASS.

- [ ] **Paso 5: commit.** `feat(monitoreo): busqueda paginada de logs con los filtros del panel`

---

## Tarea 15: Retención de 180 días, vigilancia de disco y descarga del paquete

**Files:**
- Create: `backend/src/modules/monitoring/monitoring-retention.scheduler.ts`, `monitoring-retention.scheduler.spec.ts`, `disk-watch.service.ts`, `disk-watch.service.spec.ts`, `appender-package.service.ts`, `appender-package.service.spec.ts`
- Modify: `backend/src/modules/monitoring/installations.controller.ts`, `monitoring.module.ts`, `backend/Dockerfile`

**Interfaces:**
- Consumes: `notifyDiskAlert` (Tarea 9); el formato de `manifest.json` (Tarea 4; las pruebas usan un directorio temporal, no dependen de ella).
- Produces:
  - `MonitoringRetentionScheduler.purge(now: Date): Promise<{ occurrences: number; daily: number; groups: number }>` con `@Cron('0 30 3 * * *')` (03:30 UTC).
  - `interface DiskStatus { path: string; usedPct: number | null; threshold: number; alert: boolean; checkedAt: string | null }`; `DiskWatchService.check(): Promise<DiskStatus>` con `@Cron(CronExpression.EVERY_10_MINUTES)`; `DiskWatchService.status(): DiskStatus`.
  - `interface AppenderManifest { version: string; zip: string; sha256: string; manualMd: string; manualHtml: string; generatedAt: string }`; `AppenderPackageService.manifest(): Promise<AppenderManifest>` (404 `NOT_FOUND` si falta); `packageFile(): Promise<{ path: string; filename: string }>`; `manual(): Promise<{ version: string; html: string; markdown: string }>`.
  - Rutas ADMIN: `GET monitoring/disk`, `GET monitoring/appender/package` (zip con `Content-Disposition: attachment; filename="kubo-log-appender-<v>.zip"`), `GET monitoring/appender/manual`.

- [ ] **Paso 1: pruebas que fallan.**
  - Retención: borra ocurrencias y días con más de 180 días; borra grupos sin ticket no vistos en 180 días **con** sus ocurrencias y días; **no** borra un grupo viejo con `ticket_id`; borra en tandas de 5 000 hasta que no quede nada (el doble devuelve 5 000, 5 000, 12).
  - Disco (con `statfs` sustituido): 85 % con umbral 80 → `alert: true` y un solo `notifyDiskAlert` aunque se compruebe tres veces seguidas; baja a 70 % y vuelve a 85 % → avisa otra vez; ruta inexistente (desarrollo) → `usedPct: null`, sin alerta y sin lanzar.
  - Paquete (con `APPENDER_ASSETS_DIR` a un directorio temporal): sin `manifest.json` → 404; con él, `packageFile` devuelve la ruta del zip nombrado; un `zip` con `..` o separadores en el manifiesto → 404 (no sale del directorio); `manual` devuelve el HTML y el Markdown.

- [ ] **Paso 2: correr.** `cd backend && npx jest src/modules/monitoring/monitoring-retention.scheduler.spec.ts src/modules/monitoring/disk-watch.service.spec.ts src/modules/monitoring/appender-package.service.spec.ts` → FAIL.

- [ ] **Paso 3: implementar.** Disco con `fs.promises.statfs` (Node 20): `usedPct = round(100 · (1 − bavail / blocks))`; `LOKI_DATA_PATH` por omisión `/loki-data`, `LOKI_DISK_ALERT_PCT` por omisión `80`. `APPENDER_ASSETS_DIR` por omisión `join(process.cwd(), 'assets', 'kubo-log-appender')`. Descarga con `res.download`/stream como `serveAttachment` de `common/http/attachment-response.ts` si encaja. `Dockerfile`: en la etapa `runtime`, `COPY assets ./assets` antes del `chown`, con comentario (el `.dockerignore` excluye `*.md` solo en la raíz del contexto, así que los manuales entran).

- [ ] **Paso 4: correr.** `cd backend && npx jest && npx tsc --noEmit` → PASS. `docker compose build backend` y `docker compose run --rm --no-deps backend ls assets/kubo-log-appender` → los cuatro ficheros.

- [ ] **Paso 5: commit.** `feat(monitoreo): retencion de 180 dias, vigilancia del disco de Loki y descarga del appender`

---

## Tarea 16: Web — contrato, socket, aviso de error nuevo, menú y rutas

**Files:**
- Create: `web/src/api/monitoring.api.ts`, `web/src/pages/monitoring/useNewErrorNotifier.ts`, `web/src/pages/monitoring/monitoring-ui.ts`
- Create (vacías, con título): `MonitoringErrorsPage.tsx`, `MonitoringErrorDetailPage.tsx`, `MonitoringLogsPage.tsx`, `MonitoringInstallationsPage.tsx`
- Modify: `web/src/lib/realtime.ts`, `web/src/layout/AppLayout.tsx`, `web/src/App.tsx`, `web/src/auth/permissions.ts`, `web/src/api/types.ts`, `web/src/pages/tickets/ticket-ui.ts`, `web/src/pages/tickets/useNewTicketNotifier.ts`, `web/src/pages/TicketDetailPage.tsx`

**Interfaces:**
- Consumes: las rutas y formas de las Tareas 10–15 (copiadas como tipos TypeScript en `monitoring.api.ts`).
- Produces:
  - `monitoringApi`: `listErrors(params)`, `errorsSummary()`, `getError(id)`, `createTicketFromError(id, body)`, `resolveError(id, note?)`, `reopenError(id)`, `searchLogs(params)`, `sources()`, `listInstallations()`, `createInstallation(body)`, `updateInstallation(id, body)`, `regenerateKey(id)`, `revokeKey(id)`, `disk()`, `downloadPackage()` (blob + `saveAttachmentToDisk`), `manual()`.
  - `realtime.ts`: eventos `'error:new'`, `'errors:changed'`, `'logs:lines'`, `'monitoreo:disco'` en `RealtimeEvents`; `emitRealtime(event: 'logs:subscribe' | 'logs:unsubscribe', payload?: unknown): void`; `useRealtimeConnect(handler: () => void): void` (se llama en cada `connect`, incluida la reconexión).
  - `canManageLogInstallations = (user) => user?.role === 'ADMIN'`.
  - Rutas: `/monitoreo/errores`, `/monitoreo/errores/:errorId`, `/monitoreo/logs`, `/monitoreo/instalaciones`.

- [ ] **Paso 1:** `'MONITOREO'` en `TicketOrigin` de `types.ts`; `ORIGIN_LABELS` en `ticket-ui.ts` (`'Monitoreo'`; el `Record` no compila sin ella) y en `useNewTicketNotifier.ts` (`'monitoreo'`).

- [ ] **Paso 2:** `monitoring.api.ts`, las cuatro páginas con su título, las rutas en `App.tsx` dentro de `AppLayout`, y en `AppLayout` la sección «Monitoreo» tras «Principal» con «Errores» (con el número de `errorsSummary().nuevos` si es > 0, recargado al recibir `errors:changed`), «Logs» y, solo con `canManageLogInstallations`, «Instalaciones».

- [ ] **Paso 3:** `useNewErrorNotifier` calcado de `useNewTicketNotifier`: toast `'Error nuevo'` o `'Error reaparecido'` con `title · aplicativo · cliente`, notificación del sistema con `tag: error-<id>` que abre `/monitoreo/errores/<id>`; además escucha `monitoreo:disco` y muestra un toast de aviso. Montarlo en `AppLayout` junto al de tickets.

- [ ] **Paso 4:** en `TicketDetailPage`, si `ticket.origin === 'MONITOREO'`, consultar `listErrors({ ticketId })` y mostrar «Ver el error» enlazando al detalle.

- [ ] **Paso 5: verificar.** `cd web && npx tsc --noEmit -p . && npm run build` → sin errores.

- [ ] **Paso 6: commit.** `feat(monitoreo): menu Monitoreo, rutas, contrato del API y aviso de error nuevo en el panel`

---

## Tarea 17: Web — Errores (lista, detalle, acciones)

**Files:**
- Create: `web/src/pages/monitoring/MonitoringFilters.tsx`, `CreateTicketFromErrorDialog.tsx`, `ErrorOccurrencesChart.tsx`
- Modify: `web/src/pages/monitoring/MonitoringErrorsPage.tsx`, `MonitoringErrorDetailPage.tsx`, `monitoring-ui.ts`

**Interfaces:**
- Consumes: `monitoringApi` y `useRealtime('errors:changed', ...)` (Tarea 16); `clientsApi` y `ticketsApi` existentes para clientes, catálogo y asignaciones.
- Produces: `MonitoringFilters` (`value: MonitoringFilterValue`, `onChange`, `show: Array<'cliente'|'sistema'|'aplicativo'|'servidor'|'estado'|'nivel'|'rango'|'texto'>`), reutilizado por la Tarea 18.

- [ ] **Paso 1: lista.** Filtros cliente (con «Sin cliente» = `interno`), sistema, aplicativo, servidor (de `sources()`), estado, rango, texto; orden «Última vez» / «Cantidad»; tabla con estado (insignia), título, cliente · sistema, aplicativo, ocurrencias, última vez, ticket; paginación de 25; filtros en la URL (`useSearchParams`) para que «ver logs» y el enlace del ticket funcionen; recarga con `errors:changed`.

- [ ] **Paso 2: detalle.** Título, insignia de estado y motivo de reapertura, cliente/sistema/aplicativo/logger, servidores, primera y última vez, total; `ErrorOccurrencesChart` (barras SVG de los 30 días de `daily`, sin librerías); traza de la última ocurrencia en `<pre>` con desplazamiento; lista de ocurrencias expandible (mensaje, hilo, propiedades); botones según estado: **Crear ticket** (si no es `CON_TICKET`), **Resuelto** (con nota opcional, `ConfirmDialog`), **Reabrir** (si `RESUELTO`); enlace al ticket; **Ver logs alrededor** → `/monitoreo/logs?instalacionId=<id>&desde=<última−5min>&hasta=<última+5min>`.

- [ ] **Paso 3: diálogo de ticket.** Si el grupo tiene cliente y sistema, confirma sin preguntar; si no, pide cliente (opcional) y, con cliente, su asignación activa. Si el backend responde 400 `Elige el sistema afectado.`, el diálogo se abre (o se queda) con el selector de sistema marcado. 409 → toast y recarga.

- [ ] **Paso 4: verificar.** `cd web && npx tsc --noEmit -p . && npm run build`; con el backend de desarrollo, recorrer: lista → detalle → Crear ticket → el ticket abre con origen Monitoreo y enlace de vuelta → Resuelto → Reabrir.

- [ ] **Paso 5: commit.** `feat(monitoreo): pantallas de errores con detalle, grafico diario y acciones`

---

## Tarea 18: Web — Logs (búsqueda y en vivo)

**Files:**
- Create: `web/src/pages/monitoring/LogLineRow.tsx`
- Modify: `web/src/pages/monitoring/MonitoringLogsPage.tsx`

**Interfaces:**
- Consumes: `monitoringApi.searchLogs`, `emitRealtime`, `useRealtime('logs:lines')`, `useRealtimeConnect` (Tarea 16); `MonitoringFilters` (Tarea 17).

- [ ] **Paso 1: búsqueda.** Filtros (incluido `instalacionId` leído de la URL), nivel mínimo, texto y rango (por omisión la última hora); resultados con `useInfiniteQuery` y botón «Cargar más» con `nextCursor`; `LogLineRow` muestra hora, nivel (color por nivel), cliente · aplicativo · servidor, logger y mensaje en una línea, y al expandir hilo, excepción en `<pre>` y propiedades.

- [ ] **Paso 2: en vivo.** Interruptor **En vivo**: al encender, `emitRealtime('logs:subscribe', filtros)` y otra vez en cada `connect` (`useRealtimeConnect`; Review Focus 4); al apagar o desmontar, `logs:unsubscribe`. Las líneas entran arriba, se conservan las 1 000 últimas, el desplazamiento se pausa si el usuario subió, y `omitidas > 0` muestra «N líneas omitidas (siguen en la búsqueda)». Cambiar filtros con el vivo encendido vuelve a suscribir.

- [ ] **Paso 3: verificar.** `cd web && npx tsc --noEmit -p . && npm run build`; con el backend de desarrollo, encender En vivo, mandar un lote con `curl` (Tarea 13, Paso 5) y verlo aparecer; reiniciar el backend y comprobar que tras reconectar siguen llegando.

- [ ] **Paso 4: commit.** `feat(monitoreo): pantalla de logs con busqueda paginada y modo en vivo`

---

## Tarea 19: Web — Instalaciones (solo ADMIN)

**Files:**
- Create: `web/src/pages/monitoring/InstallationKeyDialog.tsx`
- Modify: `web/src/pages/monitoring/MonitoringInstallationsPage.tsx`

**Interfaces:**
- Consumes: `monitoringApi` (instalaciones, `disk`, `downloadPackage`, `manual`) y `canManageLogInstallations` (Tarea 16).

- [ ] **Paso 1: lista y alta.** Si no es ADMIN, mensaje y nada más. Tabla: cliente · sistema (o nombre de la interna), último envío, aplicativos y servidores vistos (con versión del appender), estado de la clave (`ACTIVA`/`REVOCADA`/`SIN_CLAVE` con su prefijo), nivel mínimo editable en línea (`updateInstallation`). «Nueva instalación»: de cliente (cliente → asignación activa con producto) o interna (nombre y sistema opcional).

- [ ] **Paso 2: claves.** Crear/regenerar abre `InstallationKeyDialog` con la clave, botón copiar y el aviso «No se volverá a mostrar»; al cerrarlo la clave se descarta del estado. Revocar con `ConfirmDialog`.

- [ ] **Paso 3: paquete, manual y disco.** Botón «Descargar appender v<versión>» (`downloadPackage`); sección «Manual de implementación» con el HTML de `manual()` en un `<iframe sandbox="" srcDoc=...>` (el renderizador de Markdown del panel no tiene bloques de código y el manual vive de ellos); franja de aviso si `disk().alert`, con el porcentaje y cómo acortar `LOKI_RETENTION`.

- [ ] **Paso 4: verificar.** `cd web && npx tsc --noEmit -p . && npm run build`; con el backend de desarrollo, crear una instalación interna, copiar la clave, mandar un lote con `curl` y ver «último envío» y el aplicativo; descargar el zip.

- [ ] **Paso 5: commit.** `feat(monitoreo): pantalla de instalaciones con claves, nivel minimo, descarga y manual`

---

## Tarea 20: Verificación de punta a punta

**Files:** ninguno nuevo; solo correcciones que salgan de aquí.

- [ ] **Paso 1:** `cd backend && npx jest && npx tsc --noEmit && npm run build` → todo verde.
- [ ] **Paso 2:** `cd web && npx tsc --noEmit -p . && npm run build` → sin errores.
- [ ] **Paso 3:** `dotnet test tools/kubo-log-appender/Kubo.Log4Net.sln` y `powershell -ExecutionPolicy Bypass -File tools/kubo-log-appender/build.ps1` → verde; `git status` no muestra cambios en `backend/assets/` (el paquete versionado es el de la versión actual).
- [ ] **Paso 4:** `docker compose config -q`, `docker compose -f docker-compose.dev.yml config -q`; base de desarrollo nueva (`docker compose -f docker-compose.dev.yml down -v && ... up -d`) → la 030 corre en initdb y el backend arranca con «Esquema del portal de clientes verificado».
- [ ] **Paso 5: humo con el appender real.** Una consola `net48` de prueba en un directorio temporal (fuera del repo) con log4net 2.0.12, la DLL `log4net-2.x/net45` y el `bindingRedirect` del manual, apuntando a `http://localhost:3000/api/v1/ingest/logs`: un `Info`, un `Error` con excepción y `kubo:ruc` → aparecen en Logs (en vivo), el error en Errores con toast, y «Crear ticket» deja un ticket que el portal del cliente no ve (`GET /api/v1/portal/tickets` con su sesión → no está; detalle → 404).
- [ ] **Paso 6: commit** de las correcciones, si las hubo: `fix(monitoreo): ajustes de la verificacion de punta a punta`.

---

## Auto-revisión (hecha al escribir el plan)

- **Cobertura de la spec:** Logs con filtros y en vivo (T7, T9, T13, T14, T18); Errores agrupados con traza, cuántas veces y dónde (T8, T11, T17); Crear ticket / Resuelto / Reabrir con autor y fecha (T12, T17); aviso en tiempo real (T9, T16); instalación sencilla y descarga con manual (T1–T4, T15, T19); dos tipos de instalación y `kubo:ruc` (T10, T13); clave de una sola vista con huella, revocar y regenerar (T10, T19); nivel mínimo por instalación (T10, T13, T19); recepción con límites, 401/429/503 y gzip (T13); huella con normalización y primer marco propio (T8); reapertura tras resolver y tras el ticket (T8, T11); tickets internos fuera del portal en listado, detalle, adjuntos/mensajes, informe y avisos (T6); Loki con 30 días y tope de memoria (T7); retención de 180 días (T15); vigilancia de disco y `LOKI_RETENTION` (T7, T15, T19); migración 030 registrada (T5); TLS 1.2, proxy, cola acotada y nunca lanza (T2, T3).
- **Consistencia de nombres:** `LogFilter`/`parseLogFilter` (T8) los usan T7, T9 y T14; `ResolvedInstallation` (T10) lo usa T13; `ErrorNewPayload`/`notifyErrorNew` (T9) los usa T11; `recordOccurrences`/`ErrorEventInput` (T11) los usa T13; el campo `secret` (T10) es el que espera la prueba de auditoría; `manifest.json` (T4) es el que lee T15.

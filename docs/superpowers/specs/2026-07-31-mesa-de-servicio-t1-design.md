# Mesa de servicio Kuboti — T1: núcleo de tickets

**Fecha:** 2026-07-31
**Estado:** aprobado para plan de implementación
**Origen:** prototipo Claude Design `Sistema de Tickets Kuboti.dc.html`
(proyecto `87cddcd2-b96d-4890-89f6-61679061ed41`)

---

## 1. Contexto y decisión de partida

El prototipo describe una mesa de servicio completa alineada a ISO/IEC 20000-1:
ingesta por correo, triaje IA, SLA, derivación por niveles, portal del cliente con
conformidad por estrellas e informe mensual de servicio.

El repositorio ya contenía el módulo `client-requests`, que modelaba un flujo
distinto — *solicitud de cliente → backlog → Jira* — con estados
`INBOX → STRUCTURED → SENT → ARCHIVED → COMPLETED`.

**Ese módulo no llegó a usarse en producción.** Por eso se reemplaza por una
entidad `tickets` única en lugar de mantener dos modelos en paralelo con un puente
entre ellos. Un solo modelo expresa ambos casos mediante dos facetas
independientes:

- `origin` — de dónde llegó el ticket
- `request_type` — en qué deriva (incidencia de servicio o trabajo de desarrollo)

Un ticket `INCIDENCIA` corre su SLA y cierra con conformidad. Un ticket `FEATURE`
se empuja a Jira con el mecanismo existente. Comparten bandeja, timeline y métricas.

### Qué se conserva del módulo eliminado

No es una reescritura desde cero. Se conservan y reubican en `tickets`:

- `structureWithAI()` — triaje asistido por IA
- `transcribeAudioBuffer()` — notas de voz de WhatsApp y grabación en vivo
- `pushToJira()` y los campos `jira_*`
- El enum `ServiceCategory` (`SOFTWARE`, `SOPORTE`, `CAPACITACION`, `CONSULTA`,
  `ASESORIA`, `VISITA_SITIO`, `OTRO`)
- `scheduled_at`, `duration_minutes`, `closure_document_id`
- `acceptance_criteria`, `labels`

### Descomposición en fases

El alcance solicitado abarca cuatro subsistemas. Se entregan en fases, cada una
con su propio spec y plan:

| Fase | Contenido | Razón del orden |
|---|---|---|
| **T1** (este spec) | `tickets`, estados, P1–P4, SLA, timeline, derivación, bandeja y detalle | Núcleo del que cuelga todo lo demás. Operativo con carga manual desde el día 1. |
| **T2** | Ingesta IMAP + plantillas de correo por transición | Automatiza la entrada sobre un ciclo de vida ya probado. Aislado: si el proveedor de correo falla, T1 sigue en producción. |
| **T3** | Portal del cliente + conformidad CSAT | Requiere tickets cerrándose de verdad para tener sentido. |
| **T4** | Informe ISO ampliado (SLA, TMR/TMS, CSAT, no conformidades) | Necesita un mes de datos reales de T1–T3. Antes graficaría ceros. |

Sin fase asignada: registro de Problemas (PRB) y Cambios (CHG), detección IA de
recurrencias, vista móvil del técnico.

---

## 2. Modelo de datos

Migración `backend/sql/migrations/010_service_desk.sql`. Elimina la tabla
`client_requests` y crea cinco tablas nuevas.

### 2.1 `tickets`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | bigint unsigned PK | |
| `code` | varchar(20) unique | `KB-0001`. Generado tras el insert, en la misma transacción, como `CONCAT('KB-', LPAD(id, 4, '0'))`. En T2 va en el asunto del correo. |
| `client_id` | bigint → `clients` | |
| `project_id` | bigint nullable → `projects` | |
| `system_id` | bigint nullable → `client_systems` | |
| `meeting_id` | bigint nullable → `meetings` | conservado del modelo anterior |
| `origin` | enum | `EMAIL`, `WHATSAPP_TEXT`, `WHATSAPP_AUDIO`, `VOICE_LIVE`, `MEETING`, `NOTE`, `PORTAL` |
| `request_type` | enum nullable | `INCIDENCIA`, `BUG`, `MEJORA`, `FEATURE`, `AJUSTE` |
| `service_category` | enum nullable | sin cambios respecto al modelo anterior |
| `subject` | varchar(240) | |
| `raw_text` | text | texto original tal como llegó |
| `raw_audio_filename` | varchar(255) nullable | |
| `description_md` | text nullable | redacción estructurada |
| `acceptance_criteria` | json nullable | |
| `labels` | json nullable | |
| `impact` | enum nullable | `ALTO`, `MEDIO`, `BAJO` |
| `urgency` | enum nullable | `ALTA`, `MEDIA`, `BAJA` |
| `priority` | enum | `P1`…`P4`. Derivada de impacto × urgencia; admite override. |
| `priority_overridden` | tinyint default 0 | marca que un humano fijó la prioridad a mano |
| `status` | enum | ver §3 |
| `assignee_user_id` | bigint nullable → `users` | |
| `escalation_level` | enum nullable | `N1`, `N2`, `N3` |
| `sla_policy_id` | bigint nullable → `sla_policies` | snapshot al crear |
| `sla_response_due_at` | datetime nullable | |
| `sla_resolution_due_at` | datetime nullable | |
| `first_response_at` | datetime nullable | |
| `paused_at` | datetime nullable | no nulo mientras está en `ESPERA_CLIENTE` |
| `paused_total_seconds` | int unsigned default 0 | |
| `sla_at_risk` | tinyint default 0 | lo marca el job de §4.3 |
| `attended_at` | datetime nullable | conservado |
| `resolved_at` | datetime nullable | |
| `closed_at` | datetime nullable | |
| `resolution_md` | text nullable | |
| `root_cause` | text nullable | |
| `corrective_action` | text nullable | |
| `scheduled_at` | datetime nullable | conservado |
| `duration_minutes` | int unsigned nullable | conservado |
| `jira_integration_id`, `jira_project_key`, `jira_issue_key`, `jira_issue_url`, `sent_at` | | conservados |
| `closure_document_id` | bigint nullable | conservado |
| `created_by` | bigint → `users` | |
| `created_at`, `updated_at` | timestamp | |

Índices: `client_id`, `project_id`, `system_id`, `status`, `priority`,
`assignee_user_id`, `created_at`, `sla_resolution_due_at`.

Reservados para fases posteriores y **no incluidos en T1**: `csat_rating`,
`csat_comment`, `portal_token`, `email_message_id`, `email_thread_id`.

### 2.2 `ticket_events`

Append-only. Nunca se actualiza ni se borra: es la evidencia auditable.

```
id
ticket_id        → tickets
type             CREATED | TRIAGED | ASSIGNED | TAKEN | STATUS_CHANGED
                 | ESCALATED | COMMENT | RESOLVED | CLOSED | SLA_AT_RISK
                 | PRIORITY_OVERRIDDEN
from_status      enum nullable
to_status        enum nullable
actor_user_id    → users, nullable (nulo cuando el actor es el sistema)
reason           text nullable — obligatorio en ESCALATED y PRIORITY_OVERRIDDEN
payload          json nullable
created_at       timestamp
```

Índice compuesto `(ticket_id, created_at)`.

### 2.3 `sla_policies`

```
id
name                     varchar(80)     "Estándar"
is_default               tinyint
p1_response_minutes      int    p1_resolution_minutes  int
p2_response_minutes      int    p2_resolution_minutes  int
p3_response_minutes      int    p3_resolution_minutes  int
p4_response_minutes      int    p4_resolution_minutes  int
coverage                 varchar(40) nullable   — reservado, sin uso en T1 (§4.2)
created_at, updated_at
```

Semilla — política `Estándar`, `is_default = 1`:

| Prioridad | Respuesta | Resolución |
|---|---|---|
| P1 | 15 min | 4 h |
| P2 | 30 min | 6 h |
| P3 | 60 min | 12 h |
| P4 | 240 min | 24 h |

Se añade `clients.sla_policy_id` (bigint nullable). Nulo ⇒ se usa la política
`is_default`.

### 2.4 `support_agents`

```
id
user_id      → users, unique
level        enum N1 | N2 | N3
specialties  json — array de ServiceCategory
is_active    tinyint default 1
created_at, updated_at
```

Un usuario existente se marca como agente sin cambiar su `role`: un `DEVELOPER`
puede ser técnico N2. La carga de trabajo se calcula
(`COUNT(tickets abiertos asignados)`), no se almacena.

### 2.5 `client_systems`

```
id
client_id    → clients
name         varchar(120)     "ERP Core", "Portal Clientes", "VPN Sede"
is_active    tinyint default 1
created_at, updated_at
```

Unique `(client_id, name)`.

---

## 3. Máquina de estados

```
NUEVO ──▶ TRIAJE ──▶ ASIGNADO ──▶ EN_ATENCION ──▶ RESUELTO ──▶ CERRADO
                                       │  ▲
                                       │  │
                          ESPERA_CLIENTE  DERIVADO
                          (ida y vuelta) (vuelve a EN_ATENCION)
```

Transiciones válidas, exhaustivas:

| Desde | Hacia |
|---|---|
| `NUEVO` | `TRIAJE`, `ASIGNADO`, `CERRADO` |
| `TRIAJE` | `ASIGNADO`, `CERRADO` |
| `ASIGNADO` | `EN_ATENCION`, `DERIVADO`, `CERRADO` |
| `EN_ATENCION` | `ESPERA_CLIENTE`, `DERIVADO`, `RESUELTO`, `CERRADO` |
| `ESPERA_CLIENTE` | `EN_ATENCION`, `RESUELTO`, `CERRADO` |
| `DERIVADO` | `EN_ATENCION`, `CERRADO` |
| `RESUELTO` | `CERRADO`, `EN_ATENCION` (reapertura) |
| `CERRADO` | — terminal |

Cualquier transición no listada se rechaza con `400 INVALID_TRANSITION`. El paso
directo a `CERRADO` desde estados tempranos representa la cancelación y **exige
motivo**.

**Reapertura.** Al volver de `RESUELTO` a `EN_ATENCION` se limpia `resolved_at` y
se conservan `resolution_md`, `root_cause` y `corrective_action` (el agente los
corrige, no los reescribe desde cero). Los plazos de SLA **no se recalculan**: el
ticket sigue midiéndose contra su compromiso original, y el evento de reapertura
queda en el timeline.

### Reglas de negocio

Numeradas según las reglas del prototipo:

1. **Asignación sugerida** — el sistema propone técnico ordenando los
   `support_agents` activos cuyas `specialties` incluyen la `service_category`
   del ticket, por menor carga. Es una sugerencia: la asignación siempre la
   confirma una persona.
2. **Tomar el ticket** — transición a `EN_ATENCION`. Registra actor y hora, y
   fija `first_response_at` si aún era nulo.
3. **Derivar exige motivo y nivel destino** — sin `reason` y `escalation_level`,
   error de validación. El evento `ESCALATED` conserva ambos responsables. El
   reloj de SLA **no se reinicia** al derivar.
4. **SLA en riesgo** — al consumir ≥70 % del plazo de resolución sin actividad,
   `sla_at_risk = 1` y evento `SLA_AT_RISK`.
5. **Cierre con evidencia** — la transición a `RESUELTO` requiere
   `resolution_md`, `root_cause` y `corrective_action` no vacíos. En T1 el cierre
   lo da el agente; en T3 pasará a depender de la conformidad del cliente.

---

## 4. Prioridad y SLA

### 4.1 Prioridad derivada

| | Urgencia ALTA | MEDIA | BAJA |
|---|---|---|---|
| **Impacto ALTO** | P1 | P2 | P3 |
| **MEDIO** | P2 | P3 | P3 |
| **BAJO** | P3 | P4 | P4 |

Función pura. Cuando falta impacto o urgencia, la prioridad por defecto es `P3`.
El override manual fija `priority_overridden = 1` y emite
`PRIORITY_OVERRIDDEN` con motivo obligatorio; a partir de ahí, cambiar impacto o
urgencia ya no recalcula la prioridad.

### 4.2 Cálculo del reloj

Al crear el ticket se resuelve la política (la del cliente o la default), se
guarda `sla_policy_id` como snapshot y se calculan **fechas absolutas** de
vencimiento a partir de `created_at`.

**Decisión: horas corridas 24×7.** No hay calendario laboral en T1. Un P3 de 12 h
creado un viernes a las 17:00 vence el sábado a las 05:00. La columna `coverage`
existe en `sla_policies` para poder activar horario de atención más adelante sin
migrar el esquema, pero en T1 se ignora.

**Pausa.** `ESPERA_CLIENTE` es el **único** estado que detiene el reloj. `DERIVADO`
no lo pausa ni lo reinicia: el compromiso es con el cliente, no con el técnico, y
escalar internamente no le concede tiempo extra a la mesa.

Al entrar en `ESPERA_CLIENTE` se fija `paused_at`. Al salir:

```
delta                 = now - paused_at
paused_total_seconds += delta
sla_response_due_at   += delta      (si aún no hubo primera respuesta)
sla_resolution_due_at += delta
paused_at              = NULL
```

Se desplazan las fechas absolutas en lugar de recalcularlas en cada lectura. Así
la consulta de vencidos y en riesgo es un `WHERE` directo sobre una columna
indexada — que es lo que ejecutan el job de §4.3, la bandeja y el informe de T4.

### 4.3 Job de riesgo

Cron cada 5 minutos sobre BullMQ (ya presente en el stack). Recorre los tickets
abiertos y sin pausar, marca `sla_at_risk` y emite el evento cuando el consumo
alcanza el 70 %. Idempotente: no re-emite el evento si `sla_at_risk` ya era 1.

---

## 5. Estructura de código

### Backend

Se elimina `backend/src/modules/client-requests/`. Se crea:

```
backend/src/modules/tickets/
  tickets.controller.ts
  tickets.service.ts          orquestación y reglas de negocio
  tickets.repository.ts
  sla.service.ts              matriz, cálculo, pausa, riesgo — sin BD
  ticket-events.service.ts    escritura del timeline
  ticket-state-machine.ts     tabla de transiciones — sin BD
  entities/  ticket.entity.ts, ticket-event.entity.ts, sla-policy.entity.ts,
             support-agent.entity.ts, client-system.entity.ts
  dto/
```

`sla.service.ts`, `ticket-state-machine.ts` y el cálculo de prioridad se mantienen
libres de dependencias de base de datos: son las piezas que más crecerán en T2–T4
y las que se prueban unitariamente.

Se reapunta `reports.service.ts`, que ya consumía el repositorio anterior para el
informe mensual de atención — y cuya variable interna ya se llamaba `tickets`.

### Endpoints

```
GET    /tickets                     filtros: status, clientId, projectId,
                                    systemId, priority, assigneeId,
                                    serviceCategory, atRisk, q
GET    /tickets/:id                 incluye timeline
POST   /tickets
PATCH  /tickets/:id
DELETE /tickets/:id
POST   /tickets/:id/transition      { toStatus, reason?, ...campos requeridos }
POST   /tickets/:id/assign          { assigneeUserId, reason? }
POST   /tickets/:id/take
POST   /tickets/:id/escalate        { toLevel, assigneeUserId?, reason }   reason obligatorio
POST   /tickets/:id/priority        { impact?, urgency?, priority?, reason }
POST   /tickets/:id/comment         { body }
POST   /tickets/:id/structure       triaje IA (conservado)
POST   /tickets/:id/push-to-jira    (conservado)
POST   /tickets/transcribe          (conservado)
GET    /tickets/:id/suggest-assignee

GET/POST/PATCH/DELETE  /clients/:id/systems
GET/POST/PATCH/DELETE  /support-agents
GET/PATCH              /sla-policies
```

### Web

| Actual | Nuevo |
|---|---|
| `RequestsListPage.tsx` | `TicketsListPage.tsx` — chips de filtro, columnas y barra de SLA del prototipo |
| `RequestDetailPage.tsx` | `TicketDetailPage.tsx` — cabecera, triaje IA, timeline, solución/causa raíz, sidebar (acciones · ficha · reloj de SLA) |
| — | Sistemas: tab nuevo en `ClientDetailPage.tsx` |
| — | Agentes: sección nueva en `UsersPage.tsx` |
| `api/client-requests.api.ts` | `api/tickets.api.ts` |

El prototipo es un Design Component (`sc-for`, `sc-if`, `DCLogic`), no React: no
se importa. Sirve como especificación visual, y se reconstruye en React tomando
sus tokens de color y tipografía (IBM Plex Sans/Mono, paleta oklch).

---

## 6. Pruebas

Con tests unitarios, por ser lógica pura y de fallo silencioso:

- **Matriz de prioridad** — las nueve combinaciones, más los casos sin impacto o
  sin urgencia.
- **Máquina de estados** — cada transición válida, y rechazo de las inválidas.
- **Cálculo de SLA** — vencimientos por prioridad; una pausa; pausas múltiples
  acumuladas; que derivar no reinicie el reloj; el umbral del 70 %.
- **Reglas de cierre** — `RESUELTO` rechazado sin solución, causa raíz o acción
  correctiva.

Con tests de integración: creación de ticket con generación de `code`, y que cada
transición escriba exactamente un `ticket_event`.

---

## 7. Fuera de alcance en T1

Ingesta IMAP y plantillas de correo (T2) · portal del cliente y CSAT (T3) ·
informe ISO ampliado (T4) · Problemas y Cambios (PRB/CHG) · detección IA de
recurrencias · vista móvil del técnico · horario de cobertura y calendario
laboral en el cálculo de SLA.

---

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| La migración elimina `client_requests` de forma irreversible | Autorizado explícitamente: el módulo nunca se usó en producción. Aun así, la migración se ejecuta primero contra desarrollo y se verifica con el flujo existente de `backend/sql/verify_migration.sh`. |
| `reports.service.ts` deja de compilar al borrar el repositorio anterior | Se reapunta en el mismo commit que la migración; el informe mensual entra en la verificación de T1. |
| SLA 24×7 genera vencimientos en fin de semana que la mesa no atiende | Aceptado conscientemente para T1. `sla_policies.coverage` queda preparado para activar horario sin migrar esquema. |
| La sugerencia de asignatario propone mal con pocos agentes cargados | Es sugerencia, no automatismo: siempre la confirma una persona. |

# Conector de tickets para Claude (repos de desarrollo ↔ DevDocs)

**Fecha:** 2026-11-24 · **Estado:** borrador para aprobación

## 1. Intención

Que el desarrollador, al abrir Claude Code dentro del repo de un cliente,
vea **solo** los tickets (`KB-`) y requerimientos (`RQ-`) de ese cliente y
sistema, los trabaje sin copiar y pegar, y que cada ticket muestre en DevDocs
el código que lo atendió (ramas, commits, PR).

Hoy la relación vive en la cabeza del equipo: el ticket está en DevDocs, el
código en GitHub, y nada los une.

### Objetivos

1. Un repo de GitHub queda **registrado** en DevDocs y asociado a una
   asignación cliente–sistema (`client_systems`).
2. Claude Code en ese repo lista, lee y comenta los pendientes de esa
   asignación mediante un MCP único (`kubo-devdocs`) y una clave personal.
3. DevDocs registra ramas, commits y PR que nombran un `KB-xxxx`/`RQ-xxxx`
   (webhook de GitHub) y los muestra en el detalle del ticket/requerimiento.

### No objetivos (esta entrega)

- Responder al cliente desde Claude (mensaje `PUBLICA`). Fase 3.
- Resolver o cerrar desde Claude. Siempre lo hace una persona en DevDocs.
- Crear tickets desde Claude. **Los crea el administrador en DevDocs**
  (decisión del usuario), además de los canales que ya existen (portal, correo).
- Sincronizar con herramientas de tickets de terceros.

### Anti-objetivos

- Una clave que permita ver tickets de **otro** cliente. El alcance lo decide
  el servidor por la clave; nada que se configure en la laptop lo amplía.
- Claves guardadas dentro de un repo o en texto plano en la base.
- Que Claude cambie algo que el cliente ve sin una persona de por medio.

## 2. Caso piloto: Cobros Seguros

Repos (GitHub, organización `cobrosseguros`), trabajados en **otra laptop**:

| Repo | Asignación en DevDocs (a confirmar por el admin) |
|---|---|
| `cobrosseguros/cobranza` | Cobros Seguros · Cobranza |
| `cobrosseguros/administracion` | Cobros Seguros · Administración |
| `cobrosseguros/legal` | Cobros Seguros · Legal |

Varios repos pueden apuntar a la misma asignación; un repo apunta a una sola.

## 3. Modelo de datos (migración `031_conector_repos.sql`)

Mismo estilo que 029/030: idempotente, `utf8mb4_unicode_ci`, comentarios en
español. Confirmar el número contra `main` al implementar.

### 3.1 `dev_repos` — repo registrado

| Columna | Tipo | Nota |
|---|---|---|
| id | BIGINT PK | |
| client_system_id | BIGINT NOT NULL FK `client_systems` | alcance del repo |
| github_full_name | VARCHAR(140) NOT NULL UNIQUE | `cobrosseguros/cobranza`, en minúsculas |
| webhook_secret_enc | TEXT NULL | secreto HMAC, cifrado con el mismo mecanismo que `ai_providers.api_key_encrypted` |
| is_active | TINYINT(1) DEFAULT 1 | |
| created_by, created_at, updated_at | | |

### 3.2 `dev_keys` — clave personal por desarrollador y repo

| Columna | Tipo | Nota |
|---|---|---|
| id | BIGINT PK | |
| dev_repo_id | BIGINT NOT NULL FK `dev_repos` | |
| user_id | BIGINT NOT NULL FK `users` | dueño; autor de notas y cambios |
| key_fingerprint | CHAR(64) ascii UNIQUE | SHA-256; la clave en claro no se guarda |
| key_prefix | VARCHAR(12) | `kdev_` + 4, para reconocerla en pantalla |
| last_used_at | DATETIME(3) NULL | |
| revoked_at | DATETIME NULL | |
| created_at | TIMESTAMP | |

Clave: `kdev_` + 43 caracteres base64url (32 bytes del CSPRNG). Helpers
gemelos de `monitoring/domain/installation-key.ts` (generar, huella, forma,
prefijo). Se muestra **una sola vez** al crearla.

Por qué por desarrollador y no por repo: así las notas y cambios de estado
llevan autor real (`author_user_id`, `actor_user_id`), y revocar a una persona
no rompe al resto.

### 3.3 `work_items.client_system_id`

`BIGINT UNSIGNED NULL`, FK `client_systems`, índice `(client_system_id, status)`.
Sin esta columna un `RQ-` solo sabe el cliente, no el sistema. Los existentes
quedan `NULL`; el formulario de requerimiento gana el selector de sistema
(opcional, filtrado por el cliente elegido). Un `RQ-` con `NULL` **no** lo ve
ningún repo.

### 3.4 `dev_links` — código asociado

| Columna | Tipo | Nota |
|---|---|---|
| id | BIGINT PK | |
| dev_repo_id | BIGINT FK | |
| ticket_id | BIGINT NULL | excluyente con la siguiente (CHECK) |
| work_item_id | BIGINT NULL | |
| kind | ENUM('BRANCH','COMMIT','PR') | |
| ref | VARCHAR(255) | nombre de rama, SHA completo o número de PR |
| title | VARCHAR(255) NULL | primera línea del commit o título del PR |
| url | VARCHAR(500) | |
| author_login | VARCHAR(100) NULL | |
| state | VARCHAR(20) NULL | PR: `open`/`merged`/`closed` |
| source | ENUM('WEBHOOK','MCP') | |
| occurred_at | DATETIME | |

Único `(dev_repo_id, kind, ref, ticket_id, work_item_id)`: el webhook y el MCP
pueden informar lo mismo sin duplicar. Un PR que cambia de estado actualiza
`state`, no inserta.

## 4. API para el conector (`/api/v1/dev/*`)

Autenticación: cabecera `X-Kubo-Dev-Key`. Forma incorrecta → 401 sin consultar
la base (igual que la ingesta de logs). Clave revocada, repo inactivo o
asignación inactiva → 401. Límite: 60 peticiones/min por clave (reusar el
limitador de la ingesta). Toda respuesta y búsqueda se filtra por el
`client_system_id` del repo de la clave; un código de otra asignación responde
**404** (no 403, para no confirmar que existe).

| Método | Ruta | Hace |
|---|---|---|
| GET | `/dev/contexto` | cliente, sistema, repo y usuario de la clave (para que Claude confirme dónde está) |
| GET | `/dev/pendientes` | **todos** los abiertos de la asignación (decisión del usuario), cada uno con `es_mio` = asignado al dueño de la clave: tickets en `OPEN_STATUSES` + RQ en `PENDIENTE`/`EN_PROCESO`/`PRUEBAS`/`BLOQUEADO`; orden: míos primero, luego prioridad, vencimiento SLA o `due_date`; máx. 50 |
| GET | `/dev/items/:code` | detalle: asunto, descripción, criterios de aceptación, módulo/pantalla, prioridad, estado, SLA, mensajes (públicos e internos, marcados), lista de adjuntos (nombre, tamaño; sin contenido), `dev_links` |
| POST | `/dev/items/:code/nota` | `{ texto }` → `ticket_messages` `INTERNA` con `author_user_id` = dueño de la clave, o `work_item_events` `COMMENT`; marca `payload.via = 'claude'` |
| POST | `/dev/items/:code/estado` | ver 4.1 |
| POST | `/dev/items/:code/vinculos` | `{ kind, ref, title?, url? }` → `dev_links` con `source = MCP` |

### 4.1 Estados permitidos al conector

Lista blanca; todo lo demás → 409 con el motivo.

- Ticket: `ASIGNADO → EN_ATENCION` y `ESPERA_CLIENTE → EN_ATENCION`, solo si el
  ticket está asignado al dueño de la clave (si no, 409 "tómalo en DevDocs").
- Requerimiento: `PENDIENTE → EN_PROCESO`, `EN_PROCESO → PRUEBAS`, solo si está
  asignado al dueño de la clave (`assignee_user_id`); si no, 409.
- Notas y vínculos se permiten sobre cualquier ítem de la asignación; cambiar
  estado, solo sobre los propios.

Pasan por los servicios existentes (`TicketTransitionsService`,
`WorkItemBoardService`) para que eventos, SLA, avisos y socket en vivo se
comporten igual que desde la web.

### 4.2 Webhook de GitHub

`POST /api/v1/dev/github/webhook`, público, sin JWT.

- Verifica `X-Hub-Signature-256` con el secreto del repo (`repository.full_name`
  del cuerpo → `dev_repos`). Repo no registrado o firma mala → 401.
  Cuerpo máximo 1 MB.
- Eventos: `push` (cada commit y la rama), `create` (rama), `pull_request`
  (opened, edited, closed/merged, reopened). El resto → 204.
- Extrae códigos con `/\b(KB|RQ)-\d{4,}\b/gi` de rama, mensaje y título del PR.
  Solo enlaza códigos que pertenecen a la asignación del repo; los demás se
  ignoran en silencio.
- Idempotente por `X-GitHub-Delivery` (guardar los últimos 7 días o confiar en
  el único de `dev_links`).

## 5. Pantallas en DevDocs

- **Sistemas del cliente → Repos.** En la asignación, sección "Repositorios":
  registrar `owner/repo`; muestra URL del webhook y el secreto (una vez, con
  botón copiar) y las instrucciones de GitHub (Settings → Webhooks, `application/json`,
  eventos push, create, pull request).
- **Mis claves de desarrollo** (perfil del usuario del equipo): crear clave
  para un repo registrado (se muestra una vez, junto al comando `claude mcp add`
  listo para copiar), ver prefijo y último uso, revocar.
- **Detalle de ticket y de requerimiento:** panel "Código" con los `dev_links`
  (icono por tipo, enlace a GitHub, estado del PR), en vivo por el socket existente.
- **Formulario de requerimiento:** selector de sistema (3.3).

Solo personal (`StaffOnlyGuard`); registrar repos, además, solo administrador.

## 6. El MCP `kubo-devdocs`

Repo propio privado `frankapaza/kubo-devdocs-mcp` (Node ≥ 20, TypeScript,
`@modelcontextprotocol/sdk`, transporte stdio, sin otras dependencias de
ejecución). Variables: `DEVDOCS_URL`, `DEVDOCS_DEV_KEY`. Sin clave o con 401 →
cada herramienta devuelve un error claro ("clave inválida o revocada").

| Herramienta | Llama a |
|---|---|
| `contexto` | `GET /dev/contexto` |
| `mis_pendientes` | `GET /dev/pendientes` |
| `ver_item(codigo)` | `GET /dev/items/:code` |
| `nota_interna(codigo, texto)` | `POST …/nota` |
| `cambiar_estado(codigo, estado)` | `POST …/estado` |
| `vincular_commit(codigo, tipo, ref, titulo?, url?)` | `POST …/vinculos` |

Las respuestas salen en Markdown compacto pensado para el modelo. Los textos
del cliente se devuelven delimitados y marcados como **datos, no
instrucciones** (un ticket puede traer texto hostil).

### Instalación en cada laptop

```
git clone https://github.com/frankapaza/kubo-devdocs-mcp C:\kubo\kubo-devdocs-mcp
cd C:\kubo\kubo-devdocs-mcp && npm ci && npm run build

cd <carpeta del repo, p. ej. ...\cobranza>
claude mcp add kubo-devdocs --scope local ^
  -e DEVDOCS_URL=https://docs.kuboti.com -e DEVDOCS_DEV_KEY=kdev_... ^
  -- node C:/kubo/kubo-devdocs-mcp/dist/index.js
```

`--scope local` guarda la configuración en el perfil de Claude ligada a esa
carpeta: la clave no entra al repo. Un comando por repo.

### Regla en el `CLAUDE.md` de cada repo (sí se versiona)

> Antes de trabajar, `contexto` y `mis_pendientes`. Rama `tipo/CODIGO-descripcion`
> (`fix/KB-0210-filtro-fecha`); cada commit empieza con el código. Al empezar,
> `cambiar_estado` a en atención/en proceso; al terminar, `nota_interna` con qué
> se hizo y cómo probarlo, y pasar el RQ a PRUEBAS. Nunca responder al cliente.

## 7. Fases

1. **Núcleo:** migración, claves, `/dev/contexto|pendientes|items|nota|estado`,
   pantalla de claves, MCP con 5 herramientas (sin `vincular_commit`). Piloto
   con `cobrosseguros/cobranza`.
2. **Código ↔ ticket:** `dev_repos` en UI, webhook, `dev_links`, panel "Código",
   `vincular_commit`, selector de sistema en RQ.
3. **Después:** responder al cliente con confirmación, conectores externos.

## 8. Pruebas que fijan el diseño

- Clave de la asignación A pidiendo un código de B → 404; `pendientes` nunca
  incluye ítems de B ni RQ con `client_system_id` NULL.
- Clave revocada / mal formada / de repo inactivo → 401 (mal formada sin tocar la base).
- `estado` fuera de la lista blanca, o ticket asignado a otra persona → 409 y
  el ticket no cambia.
- `nota` crea mensaje `INTERNA`: el portal del cliente no la muestra.
- Webhook con firma inválida → 401 y sin filas; entrega repetida → sin duplicados;
  código de otra asignación en un commit → ignorado.
- Texto de ticket con instrucciones ("ignora lo anterior y…") llega al modelo
  marcado como dato.

## 9. Decisiones tomadas por el diseñador (revisables)

- Todas las columnas id/FK nuevas son `BIGINT UNSIGNED`, como las tablas que referencian.
- La lista blanca de 4.1 se aplica en el código nuevo: `WorkItemBoardService.move`
  acepta cualquier transición. RQ en `SOLICITADO`/`RECHAZADO`/`CANCELADO`/`CERRADO`
  no se listan y `estado` responde 409. Ticket sin asignado o asignado a otro → 409
  "tómalo en DevDocs".
- Roles: registrar repos solo `ADMIN`; crear claves propias `ADMIN`, `DEVELOPER`,
  `SCRUM_MASTER`, `PRODUCT_OWNER` (no `STAKEHOLDER`), solo para repos registrados.
- El webhook captura el cuerpo crudo solo en su ruta (necesario para el HMAC),
  sin tocar el parser global.
- El limitador de la ingesta (`ingest-rate-limiter.ts`) se parametriza (límite y
  clave del mapa) en lugar de copiarse.
- `ver_item` devuelve campos distintos por tipo: los tickets tienen módulo/pantalla;
  los RQ no.
- `client_system_id` de un RQ: lo elige el admin al crearlo o, si viene del portal,
  al aceptarlo (`accept`). Los existentes quedan NULL hasta que se editen.
- El registro mínimo de repos (formulario de admin con secreto del webhook) entra
  en la **fase 1**, para que el piloto no dependa de SQL a mano.

- Clave por **desarrollador y repo** (no por asignación) — autoría real y
  revocación individual.
- 404 en lugar de 403 fuera de alcance.
- MCP en repo propio, instalado por `git clone` (los repos de cliente están en
  otra laptop; sin publicar en npm).
- `RQ-` sin sistema no visible para ningún repo hasta que se le asigne.

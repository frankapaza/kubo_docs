# Notificaciones por correo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un cliente sepa por correo qué pasa con su ticket, y que el equipo se entere de que ha llegado uno, sin tocar ninguno de los nueve puntos donde hoy se escriben los eventos.

**Architecture:** `ticket_events` ya registra transaccionalmente todo lo que le pasa a un ticket, así que se usa como bandeja de salida: una columna de notificación y un vigilante que lee las filas ya confirmadas. Los textos viven en una tabla de plantillas editable desde el panel, con el juego de variables acotado por público para que un correo al cliente no pueda filtrar lo que el portal le oculta.

**Tech Stack:** NestJS 10 · TypeORM 0.3 · MySQL 8 · `@nestjs/schedule` · nodemailer (vía el `EmailService` existente) · Jest 29 · React 18 + Vite.

## Global Constraints

- **Spec de referencia:** `docs/superpowers/specs/2026-08-02-notificaciones-correo-design.md`. Ante cualquier duda, la spec manda.
- **Rama:** crear `feat/notificaciones-correo` desde `feat/portal-clientes-p1`. No trabajar sobre `master` ni `main`.
- **Base de datos:** MySQL en `kubo-mysql-dev`, esquema `kubo_devdocs`, `root`/`root`.
  - Consultar: `docker exec kubo-mysql-dev mysql -uroot -proot -e "USE kubo_devdocs; ..."`
  - Ejecutar fichero: `docker exec -i kubo-mysql-dev mysql -uroot -proot < backend/sql/migrations/015_notificaciones.sql`
  - El aviso de contraseña por stderr es normal. **No arrancar, parar ni recrear contenedores.**
- **Servidores:** backend en 3003 y Vite en 5173, ya levantados y en uso. Usarlos; no matarlos, no reiniciarlos, **no levantar duplicados**. Si hace falta una instancia propia, `PORT=3099` y bajarla al terminar.
- **API:** `http://localhost:3003/api/v1`. Personal: `admin@kubo.pe` / `Admin123*`. Cliente: `portal.test@clienteprueba.pe` / `Portal2026!`.
- **Migraciones:** `backend/sql/migrations/NNN_nombre.sql`, correlativas, empezando con `USE kubo_devdocs;`. La última es `014_audit_client_user.sql`, así que esta es la **015**. Todo `ALTER TABLE ... ADD COLUMN` va guardado con `information_schema`. **Montarla en los dos `docker-compose`.**
- **`PortalSchemaValidator`** (`backend/src/config/portal-schema.validator.ts`) comprueba al arranque que las migraciones del portal están aplicadas y aborta nombrando la que falta. **Toda columna o tabla nueva de esta funcionalidad se añade a esa comprobación**, o su ausencia se manifestará como un fallo confuso en vez de un mensaje claro.
- **TypeORM** con `synchronize: false`: el esquema solo cambia por SQL. Un `@Column({ name })` equivocado falla al ejecutar, no al compilar. Y TypeORM devuelve las columnas `bigint` como **cadena** aunque la entidad las declare `number`: nunca compares identificadores con `===` estricto.
- **Idioma:** identificadores en inglés; enums de dominio, mensajes de usuario y comentarios en español.
- **Errores:** `{ code, message }` con `message` en español. Códigos en uso: `NOT_FOUND`, `BAD_INPUT`, `CONFLICT`, `INVALID_TRANSITION`, `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`.
- **Disciplina de escritura:** toda mutación que cambie una entidad y escriba su evento va en una sola transacción, vía `runInTransaction` + `manager.getRepository(...)`.
- **Guards:** los controladores internos llevan `JwtAuthGuard, StaffOnlyGuard, RolesGuard` **en ese orden**, y `@Roles('ADMIN')` en las mutaciones de administración.
- **Tests:** `npm test` desde `backend/`. Hay **270** que deben seguir en verde.
- **Cada tarea termina con los dos builds en verde**, backend y web.
- **Commits autocontenidos.**

### Las tres reglas que gobiernan esta funcionalidad

1. **Nunca se envía un correo de algo que se deshizo.** El vigilante solo lee filas ya confirmadas. Ningún envío ocurre dentro de una transacción.
2. **Un correo al cliente no puede contener nada que el portal le oculte**: ni prioridad, ni política ni plazos de SLA, ni el responsable asignado, ni el motivo de una transición. El correo es más grave que el portal, porque no se puede retirar.
3. **Un fallo de envío no afecta jamás a la operación que lo originó.** El ticket ya está guardado antes de que el vigilante lo vea.

---

## Estructura de archivos

**Backend** — módulo nuevo `backend/src/modules/notifications/`:

| Archivo | Responsabilidad |
|---|---|
| `domain/template-renderer.ts` | Sustitución de variables, escapado y validación por público. **Puro**: sin DI, sin base, todo por parámetro |
| `domain/notification-rules.ts` | Qué evento genera qué aviso y para quién. **Puro** |
| `entities/notification-template.entity.ts` | Mapeo de `notification_templates` |
| `notification-templates.repository.ts` · `.service.ts` · `.controller.ts` | Lectura y edición desde el panel |
| `notification-dispatcher.service.ts` | Resuelve destinatarios, compone y envía |
| `notification.scheduler.ts` | Drena la bandeja de salida |
| `notifications.module.ts` | Cableado |

**Web:** `api/notifications.api.ts` y `pages/admin/NotificationTemplatesPage.tsx`.

---

## Orden de ejecución

| # | Tarea | Depende de |
|---|---|---|
| 1 | Migración 015, sellado del histórico y guarda de esquema | — |
| 2 | `template-renderer`: dominio puro | — |
| 3 | `notification-rules`: dominio puro | — |
| 4 | Entidad, repositorio, servicio y módulo de plantillas | 1 |
| 5 | El despachador | 2, 3, 4 |
| 6 | El vigilante y los reintentos | 5 |
| 7 | Controlador de plantillas, previsualización y prueba | 4, 5 |
| 8 | Web: API y pantalla de administración | 7 |
| 9 | Verificación de extremo a extremo con correos reales | 8 |

Las tareas 2 y 3 son dominio puro sin dependencias: se pueden hacer en cualquier orden respecto a la 1.

---

### Task 1: Migración 015, sellado del histórico y guarda de esquema

**Files:**
- Create: `backend/sql/migrations/015_notificaciones.sql`
- Modify: `docker-compose.dev.yml` · `docker-compose.yml` · `backend/src/config/portal-schema.validator.ts`
- Test: `backend/src/config/portal-schema.validator.spec.ts`

**Interfaces:**
- Produces: `ticket_events.notified_at`, `.notify_attempts`, `.notify_last_error`; tabla `notification_templates` sembrada; `workspace_settings.team_inbox_email`.

- [ ] **Step 1: Escribir la migración**

Estructura de `015_notificaciones.sql`, siguiendo el patrón guardado de la 013 y la 014:

```sql
USE kubo_devdocs;
```

**1) Columnas de notificación en `ticket_events`.** Con procedimiento guardado por `information_schema`, como la 013:

- `notified_at DATETIME NULL` — cuándo se procesó la fila. Nula significa pendiente.
- `notify_attempts INT NOT NULL DEFAULT 0`
- `notify_last_error VARCHAR(500) NULL`
- Índice sobre `(notified_at, id)` para que el vigilante no recorra la tabla entera.

**2) El sellado del histórico. Es el paso que no se puede equivocar.**

`ticket_events` tiene cientos de filas de meses atrás. Si nacen con `notified_at` nula, el primer arranque del vigilante manda un correo por cada una de ellas a clientes reales, y eso no se puede recoger.

El `UPDATE` que sella lo existente **va dentro del mismo `IF` que crea la columna**, no después. Razón: el `ADD COLUMN` está guardado y se salta en la segunda pasada, pero un `UPDATE` suelto se ejecutaría siempre — y en una reejecución sellaría como notificados los eventos que estaban legítimamente pendientes, apagando en silencio los avisos que faltaban por mandar. Es un fallo que no da ningún error y que solo se nota porque los correos dejan de llegar.

```sql
IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE()
                 AND TABLE_NAME = 'ticket_events'
                 AND COLUMN_NAME = 'notified_at') THEN
  ALTER TABLE ticket_events ADD COLUMN notified_at DATETIME NULL AFTER created_at;
  -- Sella TODO lo existente como ya notificado. Sin esto, el primer arranque
  -- del vigilante envía un correo por cada evento histórico. Va aquí dentro,
  -- no fuera: en una reejecución apagaría los avisos pendientes de verdad.
  UPDATE ticket_events SET notified_at = created_at;
END IF;
```

Usa `DATABASE()` y no el nombre del esquema literal: es como lo hace la 010, y la 013 se desvió de ese patrón.

**3) Tabla `notification_templates`:**

| Columna | Notas |
|---|---|
| `id` | `BIGINT UNSIGNED` autoincremental |
| `trigger_key` | `VARCHAR(60)`, único junto a `audience`. Identifica el aviso |
| `audience` | `ENUM('CLIENT','TEAM')` |
| `subject` | `VARCHAR(300)` |
| `body_md` | `TEXT` |
| `is_active` | `TINYINT(1) NOT NULL DEFAULT 1` |
| `updated_by` | `BIGINT UNSIGNED NULL` |
| `created_at` · `updated_at` | timestamps al uso |

Único sobre `(trigger_key, audience)`.

**4) Siembra de las plantillas por defecto**, con `INSERT ... ON DUPLICATE KEY UPDATE id = id` para que reejecutar no pise lo que el usuario haya editado. Las siete filas de la spec §3: cinco de cliente (creado, espera del cliente, resuelto, cerrado, reabierto) y dos de equipo (ticket nuevo desde el portal, SLA en riesgo).

Los textos por defecto los escribes tú, en español de Perú, tono directo. Cada uno debe decir explícitamente que **no se puede responder a ese correo**, porque no hay ingesta de correo entrante y el instinto de cualquiera es darle a Responder. Usa solo variables del público que corresponda (ver Task 2).

**5) `workspace_settings.team_inbox_email VARCHAR(180) NULL`**, guardada. Es el buzón del equipo.

- [ ] **Step 2: Montar en los dos compose**

`docker-compose.dev.yml` y `docker-compose.yml` usan **esquemas de prefijos distintos**: léelos antes. En el `.dev.yml` la 014 es `023_mig_014.sql` y el seed quedó en `024`; comprueba si hay que renumerarlo otra vez.

- [ ] **Step 3: Ampliar la guarda de esquema del arranque**

`backend/src/config/portal-schema.validator.ts` ya comprueba las migraciones 013 y 014 y aborta nombrando la que falta. Añade lo de la 015: la tabla `notification_templates` y las tres columnas de `ticket_events`. Amplía también su spec.

- [ ] **Step 4: Ejecutar y verificar**

```bash
docker exec -i kubo-mysql-dev mysql -uroot -proot < backend/sql/migrations/015_notificaciones.sql
```

Comprobar: las tres columnas existen; la tabla existe con sus siete filas; `workspace_settings` tiene la columna nueva.

**Y lo más importante:** `SELECT COUNT(*) FROM ticket_events WHERE notified_at IS NULL;` debe devolver **0**. Si devuelve cualquier otra cosa, el sellado no funcionó y hay que arreglarlo antes de seguir.

- [ ] **Step 5: Verificar la idempotencia, y en concreto la del sellado**

Este es el paso que demuestra el punto delicado. En orden:

1. Insertar a mano un evento de prueba con `notified_at` nula.
2. Volver a ejecutar la migración entera.
3. Comprobar que ese evento **sigue con `notified_at` nula**.

Si se ha sellado, el `UPDATE` está fuera del `IF` y hay que moverlo dentro. Deja la salida de los tres pasos en el informe.

- [ ] **Step 6: Commit**

---

### Task 2: `template-renderer`, dominio puro

**Files:**
- Create: `backend/src/modules/notifications/domain/template-renderer.ts`
- Test: `backend/src/modules/notifications/domain/template-renderer.spec.ts`

**Interfaces:**
- Produces: `NotificationAudience = 'CLIENT' | 'TEAM'`; `CLIENT_VARIABLES` y `TEAM_VARIABLES`; `variablesFor(audience)`; `validateTemplate(text, audience): { ok: true } | { ok: false; unknown: string[] }`; `render(text, audience, values): string`.

Sin DI, sin base de datos, sin `Date.now()`: todo entra por parámetro. Es el módulo más probable de esta funcionalidad y el que más barato es probar a fondo.

**Los dos juegos de variables**, según la spec §4:

- **Cliente:** `codigo`, `asunto`, `estado`, `fecha`, `cliente`, `enlacePortal`.
- **Equipo:** las de cliente más `prioridad`, `venceSla`, `responsable`, `motivo`, `enlacePanel`.

- [ ] **Step 1: Escribir los tests que fallan**

Cubre, como mínimo:

- Sustituye una variable conocida.
- Sustituye la misma variable varias veces.
- Tolera espacios dentro de las llaves: `{{ codigo }}` y `{{codigo}}` valen igual.
- **`validateTemplate` rechaza una variable de equipo en una plantilla de cliente**, y devuelve cuál. Este es el test que sostiene la regla de fuga.
- `validateTemplate` rechaza una variable que no existe en ningún público, y no la confunde con la anterior.
- **`render` con un valor que contiene HTML lo escapa.** El asunto de un ticket lo escribe el cliente: un `<` suelto no puede romper el correo.
- Un valor nulo o ausente se sustituye por un texto legible, no por `undefined` ni por la llave cruda.
- Una llave suelta que no es una variable —una llave en el texto— no revienta el renderizado.

- [ ] **Step 2: RED.** Ejecutar y comprobar que fallan por módulo inexistente.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: GREEN**, y la suite completa sigue en verde.
- [ ] **Step 5: Commit**

---

### Task 3: `notification-rules`, dominio puro

**Files:**
- Create: `backend/src/modules/notifications/domain/notification-rules.ts`
- Test: `backend/src/modules/notifications/domain/notification-rules.spec.ts`

**Interfaces:**
- Produces: `NotificationPlan = { triggerKey: string; audience: NotificationAudience }[]`; `plansForEvent(event): NotificationPlan`.

Recibe lo mínimo del evento —tipo, estado de destino, origen del ticket, si el ticket tiene autor de cliente, si tiene responsable— y devuelve qué avisos corresponden. Puro: sin base, sin DI.

La tabla de la spec §3 es la especificación exacta. Los avisos al cliente salen de: creación, paso a `ESPERA_CLIENTE`, `RESUELTO`, `CERRADO` y reapertura. Los del equipo: alta con origen `PORTAL`, y SLA en riesgo.

- [ ] **Step 1: Escribir los tests que fallan**

- Cada uno de los cinco disparadores de cliente produce su aviso.
- **Un cambio de estado que no está en la lista no produce ninguno.** Comprueba explícitamente `TRIAJE` y `ASIGNADO`: son los que más tentación dan de notificar y los que más ruido harían.
- **Un ticket sin autor de cliente no produce ningún aviso de cliente**, aunque el evento sea de los que notifican. No hay a quién escribir.
- Un alta con origen distinto de `PORTAL` no avisa al equipo.
- Un mismo evento puede producir dos avisos, uno por público: el alta desde el portal avisa al cliente **y** al equipo.
- Los tipos que el portal ya excluye —`ASSIGNED`, `COMMENT`, `PRIORITY_OVERRIDDEN`— no producen ningún aviso de cliente.

- [ ] **Step 2: RED** · **Step 3: Implementar** · **Step 4: GREEN** · **Step 5: Commit**

---

### Task 4: Entidad, repositorio, servicio y módulo de plantillas

**Files:**
- Create: `entities/notification-template.entity.ts`, `notification-templates.repository.ts`, `notification-templates.service.ts`, `notifications.module.ts`, `dto/update-notification-template.dto.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces: `NotificationTemplate`; `NotificationTemplatesService.list()`, `.findActive(triggerKey, audience)`, `.update(id, staffUserId, dto)`.

Contrasta la entidad columna por columna contra el esquema real antes de darla por buena.

`update` **valida el texto con `validateTemplate` antes de guardar**, con el público de la propia plantilla, y rechaza con `400 BAD_INPUT` nombrando las variables inválidas. Es donde la regla de fuga se hace cumplir: una plantilla de cliente con `{{motivo}}` no se guarda. El público **no** es editable: cambiarlo convertiría una plantilla revisada para un lector en otra cosa.

Registrar `NotificationsModule` en `app.module.ts`.

- [ ] **Steps:** tests primero (que `update` rechaza la variable de equipo en plantilla de cliente; que el público no se puede cambiar; que devuelve 404 si no existe), rojo, implementación, verde, build, commit.

---

### Task 5: El despachador

**Files:**
- Create: `notification-dispatcher.service.ts`
- Test: `notification-dispatcher.service.spec.ts`
- Modify: `notifications.module.ts`

**Interfaces:**
- Consumes: `plansForEvent`, `render`, `NotificationTemplatesService`, `TicketsRepository`, `ClientUsersRepository`, `UsersService`, `WorkspaceService`, `EmailService`.
- Produces: `NotificationDispatcher.dispatchForEvent(event): Promise<{ sent: number; skipped: string | null }>`.

Para un evento: pide los planes, y para cada uno resuelve destinatario, carga la plantilla activa, compone y envía por `EmailService.send`.

**Los destinatarios**, según la spec §3:
- Cliente: **el autor del ticket**, `created_by_client_user_id`. Nadie más de la empresa. Si no hay autor de cliente, no se envía.
- Equipo: para el SLA en riesgo, el responsable asignado; si no hay, el buzón del equipo. Para el ticket nuevo, el buzón del equipo. Si el buzón está vacío, cae a la dirección del remitente SMTP.

**Los valores de las variables se construyen por público, no se filtran de un juego común.** Construir el juego completo y luego quitar claves para el cliente es el mismo error que un *spread* menos unas claves: el día que se añada una variable, aparece sola en el correo del cliente. Dos funciones distintas, cada una enumerando lo suyo.

`EmailService.send` recibe `{ to, subject, html }`. El cuerpo de la plantilla es texto con variables; conviértelo a HTML sencillo y manda también `text`.

- [ ] **Step 1: Escribir los tests que fallan.** Los que sostienen las reglas:

- **El correo compuesto para el cliente no contiene la prioridad, ni el plazo de SLA, ni el nombre del responsable, ni el motivo.** Compruébalo sobre el `html` y el `subject` que de verdad se pasan a `EmailService.send`, no sobre el juego de variables. Es el mismo test de fuga que tiene el portal.
- Un ticket sin autor de cliente no llama a `EmailService.send` ni una vez.
- Una plantilla desactivada no envía nada.
- El SLA en riesgo con responsable va al responsable; sin responsable, al buzón del equipo; con el buzón vacío, al remitente.
- Un fallo de `EmailService.send` **se propaga** al llamador y no se traga: es el vigilante quien decide reintentar.

- [ ] **Step 2: RED** · **Step 3: Implementar** · **Step 4: GREEN** · **Step 5: Commit**

---

### Task 6: El vigilante y los reintentos

**Files:**
- Create: `notification.scheduler.ts`
- Test: `notification.scheduler.spec.ts`
- Modify: `notifications.module.ts`

**Interfaces:**
- Produces: `NotificationScheduler.drain(now): Promise<{ processed: number; sent: number; failed: number }>`.

Sigue el patrón de `backend/src/modules/tickets/sla-risk.scheduler.ts`: `@Cron` que llama a un método público con la lógica, para poder probarlo sin esperar al reloj. Cada minuto.

El bucle: coge un lote de eventos con `notified_at IS NULL` ordenados por `id`, y para cada uno llama al despachador.

- **Éxito:** sella `notified_at`.
- **Un tipo que no genera ningún aviso:** sella igualmente. Si no, la cola crece sin fin y cada pasada rearrastra lo mismo.
- **Fallo:** incrementa `notify_attempts`, guarda el error truncado, y **deja `notified_at` nula** para reintentar. Espera creciente entre intentos, en función del número de intentos.
- **Superado el tope de intentos:** sella `notified_at` y deja el error grabado. No se reintenta para siempre.
- **Un fallo en un evento no detiene el lote:** los siguientes se procesan igual.

`drain` recibe `now` como parámetro, para poder probar la espera creciente sin esperar de verdad.

- [ ] **Step 1: Escribir los tests que fallan.** Los que importan:

- Un evento ya notificado no se vuelve a procesar.
- Un evento sin aviso se sella y no envía nada.
- Un fallo incrementa los intentos y **no** sella.
- Un evento que ya agotó los intentos se sella y no se vuelve a intentar.
- Un evento que falla no impide que se procesen los demás del lote.
- El reintento respeta la espera: un evento que falló hace un instante no se reintenta en la pasada siguiente.

- [ ] **Step 2: RED** · **Step 3: Implementar** · **Step 4: GREEN** · **Step 5: Commit**

---

### Task 7: Controlador de plantillas, previsualización y prueba

**Files:**
- Create: `notification-templates.controller.ts`
- Modify: `notification-templates.service.ts`

**Interfaces:**
- Produces: `GET /notification-templates`, `PATCH /notification-templates/:id`, `POST /notification-templates/:id/preview`, `POST /notification-templates/:id/test`.

`@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)` y `@Roles('ADMIN')` en las mutaciones, la previsualización y la prueba.

- **`preview`** devuelve el asunto y el cuerpo compuestos con datos de ejemplo, sin enviar nada. Usa el mismo camino de composición que el envío real: si la previsualización compone distinto, no sirve para lo único que se le pide.
- **`test`** envía ese correo de ejemplo **al usuario que hace la petición**, y a nadie más. Ni a una dirección que venga en el cuerpo: un endpoint autenticado que manda correo a donde le digan es un relé de spam.

- [ ] **Steps:** tests (que `test` ignora cualquier destinatario del cuerpo y usa el del token; que `preview` no envía), rojo, implementación, verde, verificación con `curl` de que llega un correo real, commit.

---

### Task 8: Web — API y pantalla de administración

**Files:**
- Create: `web/src/api/notifications.api.ts`, `web/src/pages/admin/NotificationTemplatesPage.tsx`
- Modify: `web/src/App.tsx`, el menú lateral, `web/src/api/types.ts`

La ruta es `/admin/notifications`. **Ojo: `/admin/templates` ya existe** y es la de plantillas de documentos; no las confundas ni reutilices su página.

Lee los controladores reales para cada ruta y cada forma: el backend es la autoridad. Y mira `web/src/pages/admin/ClientUsersPage.tsx`, que es la página de administración más reciente, para las convenciones.

La pantalla lista las plantillas agrupadas por público, permite editar asunto y cuerpo, muestra **qué variables puede usar cada una** —tomadas del backend, no escritas a mano en el frontend—, previsualiza y envía la de prueba. Un error de validación al guardar se muestra legible: es el caso normal cuando alguien escribe una variable que no existe.

Convenciones del proyecto, todas de hallazgos reales: guardas `cancelled` en los efectos asíncronos; controles reales, nunca un `<div>` pinchable; diálogos que cierran con Escape y con clic en el fondo, con `stopPropagation` dentro y limpieza del listener; ningún fallo tragado en silencio, y un fallo de escritura que se lea distinto de uno de refresco; botón deshabilitado mientras la petición está en vuelo.

- [ ] **Verificar** en el navegador con Chrome DevTools y commitear.

---

### Task 9: Verificación de extremo a extremo

El entregable es la evidencia. Con el SMTP real ya configurado:

- [ ] Abrir un ticket desde el portal y comprobar que llega el acuse al correo del autor, y el aviso de ticket nuevo al buzón del equipo.
- [ ] Mover el ticket a `ESPERA_CLIENTE` desde el panel, con un motivo escrito. Comprobar que llega el aviso **y que el motivo no aparece en él**.
- [ ] Resolver y cerrar: llegan los dos avisos.
- [ ] Mover el ticket a `ASIGNADO`: **no** llega ningún correo.
- [ ] Un ticket creado desde el panel, sin autor de cliente, no genera ningún correo hacia fuera.
- [ ] Desactivar una plantilla y comprobar que ese aviso deja de enviarse.
- [ ] Inspeccionar el cuerpo de un correo de cliente y confirmar que no contiene prioridad, plazos de SLA, responsable ni motivo.
- [ ] Comprobar en la base que los eventos procesados quedan con `notified_at`, y que no hay ninguna fila antigua pendiente.
- [ ] `cd backend && npm test`, `npm run build`, y `cd web && npm run build` — los tres limpios.

**Y una comprobación que no es de código:** mirar en qué carpeta cae el correo. Si va a no deseado, el dominio no tiene SPF y DKIM en regla y la funcionalidad no sirve por perfecto que esté el código. Deja constancia de dónde cayó; el arreglo es del hosting, no del repositorio.

---

## Verificación de cobertura de la spec

| Sección de la spec | Tareas |
|---|---|
| §2 bandeja de salida sobre `ticket_events` | 1, 6 |
| §2 sellado del histórico | 1 (Steps 1, 4 y 5) |
| §3 disparadores y destinatarios | 3, 5 |
| §3 buzón del equipo | 1, 5 |
| §4 plantillas editables y sembradas | 1, 4, 7, 8 |
| §4 variables acotadas por público | 2, 4, 5 |
| §4 escapado del contenido del usuario | 2 |
| §5 reintentos y tope | 6 |
| §5 el aviso de que no se puede responder | 1 (textos por defecto) |
| §7 pruebas | 2, 3, 5, 6, 9 |
| §9 riesgo de reputación (SPF/DKIM) | 9 |

**Fuera de alcance por decisión de la spec §8**, sin tarea: ingesta de correo entrante · notificaciones dentro de la aplicación, push o resumen diario · adjuntos · editor visual · avisos a usuarios de cliente que no son el autor · notificaciones de requerimientos.

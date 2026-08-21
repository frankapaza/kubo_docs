# Requerimientos desde el portal de clientes — Diseño

**Fecha:** 2026-08-07
**Estado:** propuesto
**Alcance:** R1 de tres proyectos relacionados. R3 (tickets por correo) y R2 (informe mensual descargable) tendrán su propia especificación.

## Problema

Un cliente solo puede abrir tickets: incidencias sobre algo que ya existe y falla. No tiene forma de pedir trabajo nuevo — una mejora, una funcionalidad, un ajuste. Eso hoy se recoge por teléfono, por correo o en una reunión, y acaba en el tablero interno sin que quede constancia de quién lo pidió ni de qué se le prometió.

Se quiere que el cliente pueda pedirlo por escrito, que la casa responda con un compromiso explícito o con un rechazo motivado, y que ambas cosas queden registradas.

## Decisiones ya tomadas

Estas cuatro se acordaron antes de escribir el documento y no se reabren aquí:

1. **Solo el administrador del cliente puede crear requerimientos.** El resto de usuarios de esa empresa los leen, pero no los crean.
2. **Compromiso, no SLA.** Un requerimiento no es una incidencia: no tiene reloj de respuesta ni de resolución. Lo que se mide es una *fecha comprometida* frente a la fecha real de entrega.
3. **Entrada con aceptación previa.** Lo que llega del portal no cae en el tablero. Queda en `SOLICITADO` hasta que alguien de la casa lo acepta —fijando prioridad y fecha comprometida— o lo rechaza con motivo.
4. **El cliente ve solo lo que él pidió.** El trabajo interno que la casa planifica para ese cliente (nacido de actas, reuniones o Jira) sigue siendo invisible en el portal.

## Lo que ya existe

Buena parte del terreno se preparó en el portal (P1) y no hay que construirlo:

- **`work_items.created_by` ya admite nulo** y **`work_items.created_by_client_user_id` ya existe** en la base de datos. Los añadió la migración `013_portal_clientes.sql` y `PortalSchemaValidator` los exige al arrancar. Lo mismo con **`work_item_events.actor_client_user_id`**. Lo que falta es que **las entidades los mapeen**: hoy `WorkItem` declara `createdBy!: number` como obligatorio y no conoce ninguna de las dos columnas.
- **`isClientAdmin` ya viaja dentro del token del portal** (`client-jwt.strategy.ts`). No hay ningún guard que lo lea: ese es todo el trabajo pendiente del rol.
- **La interfaz de administración ya tiene la casilla** para marcar a un usuario como administrador de su empresa, etiquetada *"reservado, sin efecto todavía"*.
- **El módulo distingue estados de columnas**: `WORK_ITEM_STATUSES` es un superconjunto de `BOARD_COLUMNS`. Los estados nuevos no tocan el tablero.
- **`work_item_events.reason` existe**, y `assertReason` ya obliga a motivar cualquier estado listado en `OUT_OF_FLOW_STATUSES`.

## Fuera de alcance

- **Correo.** R1 no envía ninguna notificación. El despachador (`notification-dispatcher.service.ts`) está construido enteramente sobre `TicketEvent` y `ticket_events`; darle una segunda fuente es un trabajo aparte, no un añadido. El cliente se entera de la aceptación o del rechazo al entrar al portal. **Esto es una limitación conocida y deliberada**: un rechazo que el cliente no lee sigue siendo un rechazo que no llegó.
- **Hilo de conversación y adjuntos en requerimientos.** El motivo de rechazo y la descripción son texto y bastan para R1.
- **Criterios de aceptación visibles para el cliente.** Se escriben internamente y a menudo a medias; exponerlos es una decisión de producto que no toca ahora.
- **El informe.** Es R2.

## Modelo de datos

### Migración `020_requerimientos_portal.sql`

Sigue el patrón idempotente de las migraciones anteriores (`IF NOT EXISTS`, procedimiento de añadir columna).

1. **`work_items.origin`** — `ENUM('INTERNO','PORTAL') NOT NULL DEFAULT 'INTERNO'`. Todas las filas existentes quedan en `INTERNO`.

   Se añade aunque `created_by_client_user_id` ya permita deducirlo, y a propósito: *quién lo creó* y *si el cliente puede verlo* son dos hechos distintos, y colgar la visibilidad de la autoría obliga a falsear el autor el día que se quiera compartir algo nacido dentro. Un hecho, una columna.

2. **`work_items.status`** — el enum admite además `'SOLICITADO'` y `'RECHAZADO'`.

3. **`work_item_events.from_status` y `to_status`** — mismos dos valores nuevos.

4. **`work_item_events.type`** — admite además `'REQUESTED'`, `'ACCEPTED'`, `'REJECTED'`.

5. **Índice `idx_wi_client_origin (client_id, origin)`** — el listado del portal filtra siempre por los dos.

### Entidades

`WorkItem`:
- `createdBy!: number | null` (la columna ya es nulable en base de datos; la entidad miente hoy).
- `createdByClientUserId!: number | null` — columna nueva en la entidad, ya existente en base de datos.
- `origin!: WorkItemOrigin` — `'INTERNO' | 'PORTAL'`.

`WorkItemEvent`:
- `actorClientUserId!: number | null` — ya existente en base de datos.

## Estados y transiciones

`SOLICITADO` y `RECHAZADO` entran en `WORK_ITEM_STATUSES` pero **no** en `BOARD_COLUMNS`.

`RECHAZADO` entra además en `OUT_OF_FLOW_STATUSES`, con lo que hereda la exigencia de motivo. `SOLICITADO` **no** entra ahí: nace sin motivo y no debe pedirlo.

### La regla nueva

Hoy no hay máquina de estados en este módulo: *"cualquier columna puede ir a cualquier columna"*. Sin una regla nueva, el tablero movería un `SOLICITADO` a `EN_PROCESO` y se saltaría la aceptación entera, que es justo lo que este proyecto existe para impedir.

Por eso se añade al dominio:

```ts
/** Estados que solo cambian por aceptación o rechazo, nunca arrastrando en el tablero. */
export const PRE_BOARD_STATUSES: WorkItemStatus[] = ['SOLICITADO', 'RECHAZADO'];

export function assertMovable(fromStatus: WorkItemStatus): void
```

`assertMovable` lanza `BAD_INPUT` si el ítem está en `SOLICITADO` o `RECHAZADO`. La llama `WorkItemBoardService.move` antes de tocar nada.

### Transiciones válidas de un requerimiento del portal

| Desde | Hasta | Por | Exige |
|---|---|---|---|
| — | `SOLICITADO` | alta desde el portal | — |
| `SOLICITADO` | `PENDIENTE` | aceptar | prioridad + fecha comprometida |
| `SOLICITADO` | `RECHAZADO` | rechazar | motivo |
| `PENDIENTE` en adelante | lo de siempre | tablero | lo de siempre |

`RECHAZADO` es terminal. Nada vuelve a `SOLICITADO`.

## Permisos: el rol de administrador de cliente

`ClientAdminGuard`, en `modules/portal/guards/`. Corre **después** de `ClientJwtGuard` y lee `isClientAdmin` del usuario que aquel dejó en la petición.

**Falla cerrado por construcción**: un token que no traiga el campo da `undefined`, que es falso, y la petición se rechaza. Esto importa porque el error que más veces ha mordido en este repositorio es decidir por la ausencia de un valor en lugar de por el hecho que lo determina — aquí la ausencia debe significar *no*, y significa *no*.

Responde `403` con `{ code: 'FORBIDDEN', message: 'Solo el administrador de la empresa puede crear requerimientos.' }`.

Se aplica **solo a la creación**. Leer el listado y el detalle queda abierto a cualquier usuario de esa empresa: es el registro del trabajo que su compañía pidió, y esconderlo no protege nada.

## Superficie del portal

Todas bajo `ClientJwtGuard`. Ninguna acepta `clientId`: el único que existe es el del token, igual que en `PortalTicketsController`.

| Ruta | Guard adicional | Cuerpo | Devuelve |
|---|---|---|---|
| `POST /portal/requerimientos` | `ClientAdminGuard` | `title`, `descriptionMd` | la vista del requerimiento creado |
| `GET /portal/requerimientos` | — | — | lista de vistas |
| `GET /portal/requerimientos/:id` | — | — | la vista, o `404` |

El alta **no** acepta prioridad ni fecha: las fija la casa al aceptar. El cliente expresa la urgencia en el texto.

Toda lectura filtra por `client_id` del token **y** `origin = 'PORTAL'`. Un requerimiento de otra empresa, o interno, responde **`404` con el mismo cuerpo que uno inexistente** — nunca `403`, que confirmaría que existe.

### La sesión debe decir si administra

`isClientAdmin` viaja en el **token**, pero no en el objeto `clientUser` que devuelven el login y el refresh (`portal-auth.service.ts`), que es lo único que el navegador puede leer. Sin él, la interfaz no puede saber si enseñar el botón de alta.

Se añade `isAdmin: boolean` a esa respuesta, calculado con `!!user.isAdmin` igual que ya se calcula para el token — booleano, nunca el `tinyint` crudo, que llegado como `'0'` sería verdadero en un `if`.

Esconder el botón **no es la defensa**. La defensa es `ClientAdminGuard`. Lo uno evita ofrecer algo que se va a denegar; lo otro lo deniega.

## Superficie interna

En `WorkItemsController`, que hoy corre bajo `@UseGuards(JwtAuthGuard, StaffOnlyGuard)` — sin `RolesGuard`. Las dos rutas nuevas heredan eso y **no** añaden restricción por rol, para no introducir un patrón que el resto del controlador no sigue. Ver el riesgo 5.

| Ruta | Cuerpo | Efecto |
|---|---|---|
| `POST /work-items/:id/accept` | `priority`, `committedDate` | `SOLICITADO` → `PENDIENTE`, fija `priority` y `due_date`, coloca en el tablero por `insertionIndex`, escribe evento `ACCEPTED` |
| `POST /work-items/:id/reject` | `reason` | `SOLICITADO` → `RECHAZADO`, escribe evento `REJECTED` con el motivo |

Ambas rechazan con `BAD_INPUT` si el ítem no está en `SOLICITADO`.

`committedDate` llega como `YYYY-MM-DD` (`due_date` es de tipo `date`, sin hora). Es obligatoria y no puede ser anterior a hoy. Es la única garantía de que el campo del que dependerá el informe (R2) esté relleno: hoy `due_date` es opcional y nadie lo rellena.

Al **crear** desde el portal no se calcula posición de tablero: un `SOLICITADO` no está en ninguna columna, así que `board_order` queda en `0` y solo cobra sentido en la aceptación. `WorkItemsService.create` sí calcula posición, de modo que el alta del portal **no** puede delegar en él sin más — necesita su propio camino de escritura, más corto.

Las dos escrituras van en `runInTransaction`, con el repositorio del manager transaccional —nunca el inyectado— igual que `WorkItemsService.create`.

## Qué ve el cliente

Lista blanca explícita, campo a campo. Nunca por difusión ni por descarte:

| Campo | Nota |
|---|---|
| `id`, `code` | |
| `title`, `descriptionMd` | lo que él escribió |
| `status` | traducido, ver abajo |
| `priority` | **`null` mientras no haya sido aceptado** — es decir, en `SOLICITADO` **y también en `RECHAZADO`** (el conjunto `PRE_BOARD_STATUSES`). La columna no admite nulo, así que un requerimiento que nunca pasó por la aceptación conserva el `MEDIA` por defecto que le puso el alta; enseñarlo comunicaría un compromiso que nadie asumió. La decisión se toma por el hecho «¿ya fue aceptado?», nunca por si la fecha comprometida está vacía |
| `committedDate` | `due_date`; `null` hasta la aceptación |
| `closedAt`, `createdAt` | |
| `rejectionReason` | solo cuando `status` es `RECHAZADO`; se lee del `reason` del último evento `REJECTED` del ítem, que es donde vive — `work_items` no guarda motivos |

**No se exponen:** `labels`, `boardOrder`, `projectId`, `assigneeUserId`, `acceptanceCriteria`, `createdBy`.

### Estados traducidos

`PENDIENTE` significa para la casa "aceptado y en cola", pero para el cliente "Pendiente" se confundiría con "Solicitado". Se traduce:

| Interno | Cliente |
|---|---|
| `SOLICITADO` | Solicitado |
| `PENDIENTE` | Aceptado, en cola |
| `EN_PROCESO` | En desarrollo |
| `PRUEBAS` | En pruebas |
| `CERRADO` | Entregado |
| `BLOQUEADO` | Bloqueado |
| `CANCELADO` | Cancelado |
| `RECHAZADO` | Rechazado |

El `Record` completo obliga a nombrar cualquier estado nuevo aquí también, o deja de compilar.

## Interfaz

**Portal** (`web/src/pages/portal/`):
- `PortalRequirementsListPage` — listado con estado y fecha comprometida.
- `PortalRequirementDetailPage` — detalle, con el motivo si fue rechazado.
- `NewPortalRequirementDialog` — solo visible si la sesión es administradora. El botón oculto **no** es la defensa: la defensa es el guard.
- Entrada en la navegación del portal.

**Interno:**
- Una bandeja de requerimientos solicitados, con aceptar y rechazar.
- En `EditClientUserDialog` y `NewClientUserDialog`, quitar el *"(reservado, sin efecto todavía)"* de la casilla de administrador.

## Pruebas

El backend tiene 973 pruebas y `web/` no tiene ninguna. Los peores defectos de este proyecto han sido de frontend, así que la lista blanca de campos y la traducción de estados se prueban **en el backend**, donde se calculan.

- **Dominio** (puro, sin base de datos): `assertMovable` rechaza `SOLICITADO` y `RECHAZADO` y deja pasar el resto; `requiresReason('RECHAZADO')` es cierto y `requiresReason('SOLICITADO')` es falso.
- **Guard**: sin `isClientAdmin` deniega; con `false` deniega; con `true` permite. La ausencia se prueba explícitamente.
- **Servicio del portal**: un requerimiento de otra empresa da `404`; uno interno del propio cliente da `404`; la proyección devuelve exactamente las claves de la lista blanca y ninguna más; `priority` es `null` en `SOLICITADO`.
- **Aceptación**: sin fecha comprometida falla; con fecha pasada falla; sobre un ítem que no está en `SOLICITADO` falla.
- **Rechazo**: sin motivo falla; con espacios en blanco falla.
- **Tablero**: mover un ítem en `SOLICITADO` falla.

Ninguna prueba debe consagrar el comportamiento equivocado: dos veces en este proyecto una prueba fijó como contrato un descuido de visibilidad, y eso es peor que el descuido.

## Riesgos

1. **La migración altera dos enums de tablas en producción.** `work_items` y `work_item_events` tienen datos reales. `ALTER TABLE ... MODIFY COLUMN` sobre un enum reescribe la tabla; con el volumen actual (1 requerimiento) es instantáneo, pero la migración va con copia de seguridad previa como todas.

2. **Mapear columnas que la entidad ignoraba cambia todo `SELECT` sobre `work_items`.** TypeORM pasará a pedir `origin` y `created_by_client_user_id` en cada consulta del tablero, que es código en producción que hoy funciona. Si la columna no existiera en algún entorno, el tablero entero dejaría de cargar. `PortalSchemaValidator` ya exige `created_by_client_user_id` al arrancar; **`origin` debe añadirse a esa lista** para que la ausencia se detecte en el arranque y no en la primera consulta de un usuario.

3. **El rechazo no llega por correo.** Consecuencia aceptada de dejar las notificaciones fuera de alcance.

4. **Datos escasos.** En producción hay 1 requerimiento y 2 tickets. La función quedará casi vacía un tiempo; no es señal de que esté rota.

5. **Cualquier usuario interno puede comprometer una fecha de entrega.** `WorkItemsController` no usa `RolesGuard`, así que aceptar un requerimiento —que es un compromiso comercial con un cliente— queda al alcance de cualquier sesión de personal, igual que hoy lo está cerrar o cancelar un ítem. Se deja así para no introducir en este proyecto un patrón de permisos que el módulo entero no sigue, pero **es una decisión que conviene revisar**: es de la misma familia que la deuda ya anotada de `TicketsController`, donde cualquier sesión interna puede borrar un ticket.

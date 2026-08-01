# Work items y tablero Kanban — R1

**Fecha:** 2026-07-31
**Estado:** pendiente de revisión del usuario
**Contexto previo:** [mesa de servicio T1](2026-07-31-mesa-de-servicio-t1-design.md)

---

## 1. La decisión de partida

Kubo deja de exportar a Jira y pasa a ser el sitio donde vive el trabajo. El
motivo es doble: el coste de la suscripción, y que la pieza intermedia —«el
cliente pidió un ajuste»— hoy no tiene dónde vivir. Un ticket se le queda corto y
un proyecto le queda enorme.

Esto contradice el posicionamiento que declara `ROADMAP.md` («Kubo NO es otro
Jira… el pipeline único voz → transcripción → acta → backlog → herramienta
externa») y deja sin sentido su Fase 2, que planeaba ampliar las integraciones a
Azure DevOps, Trello y Linear. **Ese roadmap hay que reescribirlo**, y conviene
hacerlo a la vez que R4, no después.

### No hay que construir Jira

El uso real de Jira en este código son tres operaciones de negocio, todas en
[`jira.service.ts`](../../../backend/src/modules/integrations/jira.service.ts):

| Operación | Qué hace | Sustituto |
|---|---|---|
| `exportBacklog` | vuelca a Jira el backlog que sale de un acta | R2: aterriza en `work_items` |
| `createSingleIssue` | empuja un ítem suelto (hoy desde tickets) | R2: el ticket engendra un work item |
| `getMonthlyReport` | relee los issues de Jira para el informe | R4: consulta local, más simple |

El resto de ese servicio —`listProjects`, `testConnection`, `getIssueTypes`,
`inspectStoryFields`, `rollbackIssues`— es fontanería para hablar con una API
ajena, y desaparece entera.

Nada de JQL, épicas anidadas, workflows configurables, permisos por proyecto ni
campos personalizados. Si algo de eso hace falta, aparecerá solo.

### Migración

**Ninguna.** Decisión del usuario: lo que hay en Jira o está terminado o no se
consulta. R1 nace vacío y R4 apaga sin importar nada.

### Descomposición

| Fase | Contenido | Por qué en ese orden |
|---|---|---|
| **R1** (esta spec) | `work_items` + tablero Kanban | Todo lo demás cuelga de esto, y es lo que hoy no existe de ninguna forma |
| **R2** | El backlog del acta y el ticket-que-es-mejora aterrizan aquí | Es el bucle de producto. Con R1 hecho, es cambiar el destino |
| **R3** | Proyectos con MVP y sprints; el mismo tablero filtrado por sprint | Necesita ítems reales dentro para diseñarse sobre algo |
| **R4** | Apagar Jira: informe local, fuera la UI de integraciones y las columnas `jira_*`. Reescribir el ROADMAP | Al final, cuando nada dependa ya de Jira |

**Un solo tablero.** El mismo componente sirve a requerimientos en R1 y a sprints
en R3: cambia el filtro, no el código.

---

## 2. Modelo de datos

### `work_items`

Una sola entidad para las dos cosas que el usuario describió como
«requerimiento» y «tarea de proyecto». Se distinguen por si tienen proyecto:

| Columna | Tipo | Notas |
|---|---|---|
| `id` | bigint unsigned PK | |
| `code` | varchar(20) unique | `RQ-0001`. Se asigna tras el insert, como `KB-` en tickets |
| `client_id` | bigint **NOT NULL** → `clients` | todo trabajo es para alguien |
| `project_id` | bigint nullable → `projects` | nulo = requerimiento suelto |
| `title` | varchar(240) NOT NULL | |
| `description_md` | text nullable | |
| `acceptance_criteria` | json nullable | |
| `labels` | json nullable | |
| `status` | enum | `PENDIENTE`, `EN_PROCESO`, `PRUEBAS`, `CERRADO`, `BLOQUEADO`, `CANCELADO` |
| `priority` | enum | `ALTA`, `MEDIA`, `BAJA` — default `MEDIA` |
| `assignee_user_id` | bigint nullable → `users` | |
| `board_order` | int unsigned NOT NULL | posición dentro de su columna |
| `due_date` | date nullable | objetivo del equipo, **no** un SLA (§5) |
| `closed_at` | datetime nullable | |
| `created_by` | bigint → `users` | |
| `created_at`, `updated_at` | timestamp | |

Índices: `client_id`, `project_id`, `status`, `assignee_user_id`, `due_date`, y
un compuesto `(status, board_order)` que es por el que consulta el tablero.

**No se crean todavía** `sprint_id` (R3) ni `origin_ticket_id` (R2). En T1 se
aprendió que reservar columnas «por si acaso» solo añade ruido; cada una llega
con su migración de una línea cuando toca.

### `work_item_events`

Timeline append-only, misma forma que `ticket_events`:

```
id
work_item_id   → work_items
type           CREATED | MOVED | ASSIGNED | COMMENT | BLOCKED
               | UNBLOCKED | CLOSED | REOPENED | CANCELLED | PRIORITY_CHANGED
from_status    enum nullable
to_status      enum nullable
actor_user_id  → users, nullable (nulo = el sistema)
reason         text nullable — obligatorio en BLOCKED y CANCELLED
payload        json nullable
created_at     timestamp
```

Índice compuesto `(work_item_id, created_at)`.

Existe porque «¿quién movió esto a Pruebas y cuándo?» es la pregunta que se hace
en cuanto algo se retrasa, y porque el motivo de un bloqueo debe vivir en un
registro auditable en lugar de en un campo que se sobrescribe.

---

## 3. El tablero

### Columnas fijas

```
PENDIENTE  →  EN_PROCESO  →  PRUEBAS  →  CERRADO
                    ↕
            BLOQUEADO / CANCELADO
```

Cuatro columnas de flujo, iguales para todo el sistema, más dos estados fuera de
flujo.

**Por qué fijas y no configurables por proyecto.** No es preferencia estética:
`project_id` es opcional, así que la mitad de los ítems —los requerimientos
sueltos— no pertenecen a ningún proyecto del que heredar una configuración. Unas
columnas por proyecto dejarían ese tablero sin definir, y parchearlo con un juego
global de respaldo crea dos fuentes de verdad para lo mismo. Además `CERRADO`
dejaría de significar lo mismo en cada tablero, con lo que «cuántos
requerimientos cerramos este mes» perdería respuesta comparable.

Fijo → configurable es una migración fácil si algún día hace falta. Configurable
→ fijo es una conversación incómoda con cada equipo que ya configuró el suyo.

### Sin máquina de estados

A diferencia de los tickets, **cualquier columna puede ir a cualquier columna**.
Un tablero significa precisamente eso, y aplicarle la rigidez de un ciclo de vida
ISO importaría una restricción que en tickets se justifica —hay un SLA y un
cliente esperando— y aquí no.

Las dos únicas reglas:

1. **`BLOQUEADO` y `CANCELADO` exigen motivo**, que queda en el timeline.
2. **`CERRADO` sella `closed_at`**; reabrir lo limpia.

### El orden dentro de la columna

Al soltar un ítem se **renumera la columna entera** dentro de una transacción.

Se descartan los rangos dispersos y LexoRank a propósito. Con decenas de ítems
por columna la renumeración son decenas de `UPDATE` imperceptibles, y a cambio
no existen los casos borde de los otros métodos: sin agotamiento de huecos, sin
rebalanceo, sin claves fraccionarias que se degradan. Si alguna columna llega a
miles de ítems se cambia el mecanismo, sabiendo ya que hacía falta.

**Al crear**, el ítem nace siempre en `PENDIENTE` y entra arriba de su grupo de
prioridad, no al fondo: un `ALTA` nuevo aterriza sobre los `MEDIA`, y un `BAJA`
al fondo de la columna. Esto mitiga la contradicción inherente a tener orden
manual y prioridad a la vez: no se arranca ya contradiciéndose.

### Prioridad y orden conviven

`ALTA`/`MEDIA`/`BAJA` es una etiqueta visible y filtrable, útil para hablar con
el cliente. El orden manual es lo que gobierna qué se hace primero. Son dos
señales que **pueden discrepar** —un `ALTA` arrastrado al fondo— y eso se acepta
conscientemente: manda el orden.

---

## 4. Escritura y trazabilidad

Se hereda la disciplina que costó cinco hallazgos en T1:

- Toda mutación que cambie el ítem **y** escriba su evento va en una sola
  transacción, vía `manager.getRepository(...)`.
- Nada se escapa por el repositorio no transaccional dentro del callback.
- Un `move` reordena la columna y escribe el evento atómicamente: o cuadra todo
  o no cuadra nada.

Referencia del idioma ya establecido: `TicketsRepository.runInTransaction`,
`TicketTransitionsService.transition`.

---

## 5. Fechas, que no son SLA

`due_date` es un objetivo que pone el equipo, no un compromiso contractual. La
diferencia es deliberada y estructural:

| | SLA de tickets | `due_date` de work items |
|---|---|---|
| Origen | contrato con el cliente | decisión del equipo |
| Cálculo | automático desde la prioridad | se escribe a mano |
| Reloj | corre, se pausa, se desplaza | no hay reloj |
| Incumplir | genera evento, alimenta el informe | solo se pone en rojo |
| Job | cron cada 5 min marca en riesgo | ninguno |

Un solo campo, no un rango: el inicio real se deduce del timeline (cuándo entró
en `EN_PROCESO`), así que guardarlo aparte duplicaría un dato que ya existe.

Se llama `due_date` igual que en la tabla `commitments`, para que cuando en R2 el
backlog del acta aterrice aquí el campo se llame igual a ambos lados.

**Al pasarse la fecha**: la tarjeta se marca y aparece en el filtro «vencidos».
Nada más. Sin cron, sin evento automático, sin notificación, sin métrica de
cumplimiento.

---

## 6. Endpoints

```
GET    /work-items          clientId, projectId, status, priority,
                            assigneeId, dueFilter (vencidos|semana), q
GET    /work-items/:id      devuelve { workItem, timeline }
POST   /work-items
PATCH  /work-items/:id      no admite status, board_order ni priority
DELETE /work-items/:id      solo en PENDIENTE; el flujo normal es CANCELADO
POST   /work-items/:id/move      { toStatus, toIndex, reason? }
POST   /work-items/:id/assign    { assigneeUserId }
POST   /work-items/:id/priority  { priority, reason? }
```

`move` es un único endpoint para toda la interacción del tablero: cambiar de
columna y reordenar dentro de ella son la misma acción desde la interfaz. Cuando
`toStatus` coincide con el estado actual, es una simple reordenación. `reason` es
obligatorio cuando `toStatus` es `BLOQUEADO` o `CANCELADO`.

`PATCH` no acepta `status`, `board_order` ni `priority` por la misma razón que
`UpdateTicketDto` no acepta `status`: que ningún cambio escape al timeline. Los
tres tienen su endpoint, y cada uno escribe su evento en la misma transacción que
el cambio.

Esto último no es teórico: en T1 el `update()` de tickets recalculaba la prioridad
sin emitir evento ni transacción, y hubo que corregirlo en la tanda final de la
revisión de rama. Aquí se evita desde el diseño.

---

## 7. Estructura de código

**Backend** — `backend/src/modules/work-items/`, siguiendo el patrón del módulo
`tickets`:

```
domain/work-item-board.ts      reordenación y reglas de motivo — puro, sin BD
entities/work-item.entity.ts   work-item-event.entity.ts
work-items.repository.ts       work-item-events.repository.ts
work-items.service.ts          CRUD y código legible
work-item-board.service.ts     move, assign, timeline
work-item-events.service.ts
work-items.controller.ts
dto/
```

La lógica de reordenación vive en `domain/` sin dependencias de base de datos,
igual que `ticket-priority.ts` y `sla.calculator.ts`, para poder probarse con
tests unitarios rápidos.

**Web**

| Archivo | Responsabilidad |
|---|---|
| `api/work-items.api.ts` | cliente HTTP |
| `pages/WorkItemsBoardPage.tsx` | el tablero: columnas, filtros en la URL |
| `pages/work-items/WorkItemCard.tsx` | tarjeta: título, prioridad, fecha, asignado |
| `pages/work-items/WorkItemPanel.tsx` | detalle en panel lateral, con timeline |
| `pages/work-items/workitem-ui.ts` | paleta de estados y prioridades |

Entrada «Requerimientos» en el menú lateral, junto a Tickets. Los filtros viven
en la URL, así que un tablero filtrado por cliente es un enlace compartible.

### Accesibilidad del tablero

El arrastrar y soltar nativo del navegador no funciona con teclado. Toda la rama
de T1 sigue la convención de que los controles son accesibles, así que cada
tarjeta lleva además un menú **«Mover a…»** que hace exactamente lo mismo que el
arrastre. No es un extra: sin él el tablero es inutilizable sin ratón.

---

## 8. Pruebas

Con tests unitarios, por ser lógica pura y de fallo silencioso:

- **Reordenación**: mover dentro de la misma columna, mover a otra columna, mover
  al principio, al final, y el caso de una columna vacía.
- **Inserción por prioridad**: un `ALTA` nuevo entra sobre los `MEDIA`; un `BAJA`
  entra al fondo; con la columna vacía entra en la posición 0.
- **Reglas de motivo**: `BLOQUEADO` y `CANCELADO` se rechazan sin motivo.

Con test de integración: que un `move` escriba exactamente un evento y deje la
columna renumerada sin huecos ni duplicados.

---

## 9. Fuera de alcance en R1

El puente desde tickets y desde las actas (R2) · sprints y MVP (R3) · apagar
Jira y reescribir el ROADMAP (R4) · estimación en puntos u horas · comentarios de
usuario en los ítems · adjuntos · notificaciones por correo (dependen de T2 de la
mesa de servicio, que no existe) · columnas configurables por proyecto.

---

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| R1 no sustituye nada por sí solo: sin R2 el trabajo sigue sin llegar aquí | Aceptado. R1 es infraestructura; el valor llega en R2, que es corto una vez existe la tabla |
| Renumerar la columna es O(n) | A esta escala es imperceptible. El disparador para cambiarlo es una columna con cientos de ítems |
| Orden manual y prioridad pueden contradecirse | Aceptado conscientemente. Se mitiga insertando por prioridad al crear; manda el orden |
| Apagar Jira contradice el posicionamiento declarado en `ROADMAP.md` y anula su Fase 2 | Reescribir el ROADMAP forma parte de R4, no se deja para después |

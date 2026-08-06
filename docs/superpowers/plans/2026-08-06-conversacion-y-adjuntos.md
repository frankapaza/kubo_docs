# Conversación y adjuntos en tickets — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el cliente y el equipo puedan hablar dentro del ticket, con notas internas que el cliente no ve, y adjuntar capturas y PDF arrastrando o pegando.

**Architecture:** Un hilo de mensajes con dos visibilidades, y adjuntos que **heredan la visibilidad de su mensaje**. Se reutiliza el almacenamiento ya abstraído, se valida por la firma de bytes y no por la extensión, y la respuesta del cliente sobre un ticket en espera pasa por el camino de reanudación de SLA que ya existe, en la misma transacción que el mensaje.

**Tech Stack:** NestJS 10 · TypeORM 0.3 · MySQL 8 · multer (`FileInterceptor`) · Jest 29 · React 18 + Vite + Tailwind.

## Global Constraints

- **Spec de referencia:** `docs/superpowers/specs/2026-08-06-conversacion-y-adjuntos-design.md`. Ante cualquier duda, la spec manda.
- **Rama:** crear `feat/conversacion-adjuntos` desde `master`. **`master` es lo que está en producción ahora mismo**, así que un fallo aquí llega lejos.
- **Base de datos:** MySQL en `kubo-mysql-dev`, esquema `kubo_devdocs`, `root`/`root`.
  - `docker exec kubo-mysql-dev mysql -uroot -proot -e "USE kubo_devdocs; ..."`
  - `docker exec -i kubo-mysql-dev mysql -uroot -proot < backend/sql/migrations/018_...sql`
  - El aviso de contraseña por stderr es normal. **No arrancar, parar ni recrear contenedores.**
- **Servidores:** backend en 3003 y Vite en 5173, en uso. No matarlos, no duplicarlos. Si hace falta Nest, un puerto libre y bajarlo.
- **Migraciones:** la última es la `017`, así que esta es la **018**. Empieza con `USE kubo_devdocs;`, todo `ALTER TABLE ... ADD COLUMN` guardado con `information_schema` y `TABLE_SCHEMA = DATABASE()`. **Montarla en los dos `docker-compose`.**
- **`PortalSchemaValidator`** (`backend/src/config/portal-schema.validator.ts`) aborta el arranque si falta una tabla o columna que el código da por hecha. **Todo lo que añada la 018 se registra ahí.**
- **`.github/workflows/deploy.yml` aplica las migraciones al desplegar, desde una lista escrita a mano.** Si la 018 no entra en esa lista, el despliegue no la aplicará, el validador abortará el arranque y la producción se queda abajo. **Añadirla.**
- **TypeORM** con `synchronize: false`. Y devuelve las columnas `bigint` como **cadena** aunque la entidad diga `number`: nunca compares identificadores con `===` estricto.
- **Disciplina transaccional:** toda mutación que cambie una entidad y escriba su evento va en una sola transacción, vía `runInTransaction` + `manager.getRepository(...)`.
- **Guards:** los controladores internos llevan `JwtAuthGuard, StaffOnlyGuard, RolesGuard` en ese orden; los del portal, `ClientJwtGuard`.
- **Errores:** `{ code, message }` con `message` en español. Códigos en uso: `NOT_FOUND`, `BAD_INPUT`, `CONFLICT`, `INVALID_TRANSITION`, `UNAUTHORIZED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, `INTERNAL`.
- **Idioma:** identificadores en inglés; enums de dominio, textos de usuario y comentarios en español.
- **Tests:** `npm test` desde `backend/`. Hay **507** que deben seguir en verde.
- **Cada tarea termina con los dos builds limpios.** Commits autocontenidos.

### Las cinco reglas de seguridad, que gobiernan todo el plan

Es la primera vez que **gente de fuera sube ficheros al servidor**.

1. **El nombre del fichero que manda el cliente no se usa jamás como ruta.** Se guarda como dato para mostrarlo; la clave del almacenamiento la genera el servidor.
2. **Se valida por los bytes**, no por la extensión ni por el tipo declarado: los dos los pone quien sube.
3. **Todo se descarga forzado, con `nosniff`.** Nunca en línea.
4. **La descarga comprueba el cliente del token**, y lo ajeno devuelve **404, no 403**.
5. **Un adjunto hereda la visibilidad de su mensaje.** El de una nota interna no existe para el portal: ni en la lista, ni en la descarga, ni en el conteo.

---

## Estructura de archivos

**Backend** — módulo nuevo `backend/src/modules/ticket-messages/` (fuera de `tickets/`, que ya es el módulo más grande del proyecto):

| Archivo | Responsabilidad |
|---|---|
| `domain/attachment-rules.ts` | Tipos permitidos, validación por firma de bytes, límites. **Puro** |
| `entities/ticket-message.entity.ts` · `ticket-attachment.entity.ts` | Mapeo |
| `ticket-messages.repository.ts` | Acceso a datos |
| `ticket-messages.service.ts` | Escritura transaccional: mensaje + evento + transición |
| `ticket-attachments.service.ts` | Subida, validación y descarga |
| `ticket-messages.controller.ts` | Panel |
| `portal-messages.controller.ts` | Portal |
| `dto/` | Entradas y la proyección del portal |

**Común:** `backend/src/common/storage/storage.module.ts` (extraído de `audio/`).

**Web:** `components/upload/FileDropZone.tsx` compartido, y el hilo en las dos pantallas de detalle.

---

## Orden de ejecución

| # | Tarea | Depende de |
|---|---|---|
| 1 | Migración 018, módulo de almacenamiento y guardas | — |
| 2 | `attachment-rules`: dominio puro | — |
| 3 | Entidades, repositorio y módulo | 1 |
| 4 | Servicio de mensajes: transacción y transición | 3 |
| 5 | Servicio de adjuntos: subida y descarga | 2, 3 |
| 6 | Controlador del panel | 4, 5 |
| 7 | Controlador del portal | 4, 5 |
| 8 | Notificaciones de mensajes | 4 |
| 9 | Web: componente de subida compartido | 6 |
| 10 | Web: hilo en el panel | 9 |
| 11 | Web: hilo en el portal | 9 |
| 12 | Verificación de extremo a extremo | 11 |

---

### Task 1: Migración 018, módulo de almacenamiento y guardas

**Files:**
- Create: `backend/sql/migrations/018_conversacion_adjuntos.sql`
- Create: `backend/src/common/storage/storage.module.ts`
- Modify: `backend/src/modules/audio/audio.module.ts` · `docker-compose.dev.yml` · `docker-compose.yml` · `.github/workflows/deploy.yml` · `backend/src/config/portal-schema.validator.ts` (+ su spec) · `backend/src/modules/audio/services/local-storage.service.ts` (+ spec nueva)

**Interfaces:**
- Produces: tablas `ticket_messages` y `ticket_attachments`; el tipo de evento nuevo en `ticket_events.type`; dos plantillas sembradas; `StorageModule` exportando `STORAGE_SERVICE`.

- [ ] **Step 1: La migración**

`ticket_messages`:

| Columna | Notas |
|---|---|
| `id` | `BIGINT UNSIGNED` autoincremental |
| `ticket_id` | `BIGINT UNSIGNED NOT NULL`, indexado con `created_at` |
| `body_md` | `TEXT NOT NULL` |
| `visibility` | `ENUM('PUBLICA','INTERNA') NOT NULL` |
| `author_user_id` | `BIGINT UNSIGNED NULL` — del equipo |
| `author_client_user_id` | `BIGINT UNSIGNED NULL` — del cliente |
| `created_at` | `TIMESTAMP` |

Las dos columnas de autor **nunca van juntas ni las dos nulas**: es la misma invariante que en `tickets`, y se sostiene en el servicio, no en el esquema.

`ticket_attachments`:

| Columna | Notas |
|---|---|
| `id` · `ticket_id` | `ticket_id NOT NULL`, indexado |
| `message_id` | `BIGINT UNSIGNED NULL` — nulo si se subió al crear el ticket |
| `filename` | `VARCHAR(255)` — el nombre **original**, solo para mostrar |
| `storage_key` | `VARCHAR(255)` — la clave que genera el servidor |
| `mime_type` | `VARCHAR(120)` — el **detectado**, no el declarado |
| `size_bytes` | `INT UNSIGNED` |
| `uploaded_by_user_id` · `uploaded_by_client_user_id` | mismas hermanas |
| `created_at` | `TIMESTAMP` |

**El tipo de evento nuevo.** `ticket_events.type` es un `ENUM`; hay que ampliarlo. Elige un nombre que no se confunda con `COMMENT`, que ya significa «marcador de la IA», y déjalo razonado en el fichero. El `ALTER` del enum **es idempotente por naturaleza** —redefinirlo con el mismo conjunto no falla—, pero tiene que listar **todos** los valores actuales o los borra: léelos de la base antes de escribirlo, no de memoria.

**Las dos plantillas de aviso**, sembradas como en la 015, con `INSERT ... ON DUPLICATE KEY UPDATE id = id` para no pisar ediciones. Sus claves y públicos los fija la Tarea 8; acuérdalas con ella o hazlas en la misma tarea.

- [ ] **Step 2: Extraer el módulo de almacenamiento**

Hoy `STORAGE_SERVICE` lo provee y exporta `AudioModule`. Importar `AudioModule` desde el módulo nuevo arrastraría su cola de BullMQ y sus dependencias. Extrae un `StorageModule` que provea y exporte `STORAGE_SERVICE`, y haz que `AudioModule` lo importe en vez de proveerlo. **Comprueba que la subida de audio sigue funcionando** — es código en producción.

- [ ] **Step 3: Endurecer `getPath`**

`LocalStorageService.getPath` hace `path.join(this.basePath, key)` **sin comprobar contención**: una clave con `../` escribe fuera del directorio. Hoy es inofensivo porque las claves las genera el servidor, pero esta funcionalidad añade un segundo consumidor y la regla 1 depende de ello.

Que resuelva la ruta y **verifique que sigue bajo `basePath`**, lanzando si no. Con test: una clave con `../` no escapa, y una normal sigue funcionando.

- [ ] **Step 4: Montar y registrar**

Los dos compose, `PortalSchemaValidator` (tablas y el enum ampliado no; las tablas sí), y **la lista de migraciones de `.github/workflows/deploy.yml`**. Ese último es el que, si se olvida, tumba producción en el siguiente despliegue.

- [ ] **Step 5: Ejecutar, verificar e idempotencia**

Aplicar, comprobar las dos tablas y el enum, y **reejecutar entera** comprobando que no da error ni duplica plantillas.

- [ ] **Step 6: Commit**

---

### Task 2: `attachment-rules`, dominio puro

**Files:**
- Create: `backend/src/modules/ticket-messages/domain/attachment-rules.ts` + spec

**Interfaces:**
- Produces: `ALLOWED_TYPES`; `detectMimeType(buffer): string | null`; `assertAcceptable({ buffer, declaredMime, filename, size })`; `MAX_FILE_BYTES`, `MAX_TICKET_BYTES`.

Sin DI, sin base, sin `Date.now()`. Es el módulo que sostiene las reglas 2 y 3 y el más barato de probar a fondo.

**Los tipos:** PNG, JPEG, WebP, GIF y PDF. **SVG no**, y el test tiene que decir por qué: es XML y admite `<script>`, y es la trampa clásica de una lista de «imágenes».

**La detección es por los primeros bytes**, la firma del fichero. No uses la extensión ni el tipo declarado más que para el mensaje de error.

- [ ] **Step 1: Los tests que fallan.** Como mínimo:
  - Cada tipo permitido se detecta por su firma.
  - **Un fichero con extensión `.png` y tipo declarado `image/png` pero bytes de otra cosa se rechaza.** Es el test central.
  - Un SVG se rechaza aunque se anuncie como imagen.
  - Un fichero vacío o más corto que la firma se rechaza sin reventar.
  - Un fichero que pasa el límite se rechaza, y el mensaje dice el límite en unidades legibles.
  - El nombre original se conserva tal cual para mostrarlo, sin sanear —el saneado es cosa de quien lo pinta—, pero **nunca se devuelve como clave**.

- [ ] **Step 2: RED** · **Step 3: Implementar** · **Step 4: GREEN** · **Step 5: Commit**

---

### Task 3: Entidades, repositorio y módulo

**Files:** las dos entidades, `ticket-messages.repository.ts`, `ticket-messages.module.ts`; modificar `app.module.ts`.

**Interfaces:**
- Produces: `TicketMessage`, `TicketAttachment`; el repositorio con `listByTicket(ticketId, { includeInternal })`, `findAttachment(id)`, `listAttachments(ticketId, { includeInternal })`, `sumBytes(ticketId)`.

**El filtro de visibilidad va en el `WHERE`, no en memoria.** Filtrar después de traer es cómo se filtra una vez y se olvida la siguiente; y `sumBytes` cuenta todo, interno incluido, porque el límite del disco no distingue.

Contrasta las entidades columna por columna contra el esquema real antes de darlas por buenas.

- [ ] Tests del repositorio sobre los argumentos reales pasados a TypeORM, build, commit.

---

### Task 4: Servicio de mensajes

**Files:** `ticket-messages.service.ts` + spec; `dto/create-message.dto.ts`.

**Interfaces:**
- Consumes: el repositorio, `TicketsRepository`, `TicketEventsService`, `TicketTransitionsService` o `SlaService`, `DataSource`.
- Produces: `post(actor, ticketId, { bodyMd, visibility })`, donde `actor` es la misma unión discriminada que ya usa `TicketsService.create`.

**Lo que hay que acertar:**

**La transición automática.** Si el actor es de cliente, el mensaje es público y el ticket está en `ESPERA_CLIENTE`, el ticket vuelve a `EN_ATENCION`. **No lo implementes a mano:** `SlaService` ya tiene el camino de reanudación, que devuelve un parche desplazando los vencimientos por lo que duró la pausa, y las transiciones ya saben escribir su evento. Reutiliza. Si recalculas los vencimientos desde cero, el cliente pierde el tiempo que estuvo esperando.

**Una sola transacción** para el mensaje, su evento y el cambio de estado. Un mensaje guardado con el ticket todavía en espera es el ticket dormido con la respuesta dentro que esto viene a evitar.

**Un cliente no puede escribir notas internas.** El actor de cliente fuerza `PUBLICA`, y el DTO del portal ni siquiera declara el campo.

- [ ] **Tests que fallan, los que sostienen las reglas:**
  - Un mensaje de cliente sobre un ticket en espera deja **el mensaje y el cambio de estado**, o ninguno de los dos. Comprueba el fallo a mitad.
  - Los vencimientos quedan **desplazados** por la pausa, no recalculados.
  - Un mensaje de cliente sobre un ticket en otro estado no cambia el estado.
  - Un actor de cliente pidiendo `INTERNA` no crea una nota interna.
  - Las dos columnas de autor nunca quedan las dos puestas ni las dos nulas.
  - Un `actor.kind` desconocido lanza antes de abrir la transacción.

- [ ] RED, implementar, GREEN, commit.

---

### Task 5: Servicio de adjuntos

**Files:** `ticket-attachments.service.ts` + spec.

**Interfaces:**
- Produces: `upload(actor, ticketId, messageId | null, file)`, `download(actor, attachmentId)` devolviendo `{ stream, filename, mimeType, size }`.

**Lo que hay que acertar:**

- **La clave la genera el servidor**, con algo no adivinable, y agrupada por ticket. El nombre original **no participa** en ella.
- **Se valida con `assertAcceptable` antes de escribir nada.** Un fichero rechazado no llega al disco.
- **El límite por ticket** se comprueba sumando lo ya guardado, en servidor.
- **`download` aplica la regla 4 y la 5**: el cliente del token, y la visibilidad del mensaje al que cuelga. Lo ajeno y lo interno devuelven el **mismo 404**.
- Si la escritura en disco falla después de insertar la fila, o al revés, **no puede quedar una fila sin fichero**. Decide el orden y déjalo razonado; lo más simple es escribir primero y borrar el fichero si la fila falla.

- [ ] **Tests:**
  - Un fichero no permitido no llega a `IStorageService.save`.
  - La clave generada no contiene el nombre original.
  - Descargar un adjunto de otro cliente da 404, con el **mismo cuerpo** que uno inexistente.
  - Descargar un adjunto de una nota interna, desde el portal, da 404.
  - Pasarse del límite por ticket se rechaza aunque el fichero suelto quepa.

- [ ] RED, implementar, GREEN, commit.

---

### Task 6: Controlador del panel

**Files:** `ticket-messages.controller.ts` + spec.

Rutas bajo `tickets/:ticketId/messages` y `attachments`. `@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)`.

- La subida usa `FileInterceptor` con `limits.fileSize`, como `audio.controller.ts`. **El límite de multer no sustituye a la validación**: es la primera criba, no la comprobación.
- **La descarga fuerza `Content-Disposition: attachment` y `X-Content-Type-Options: nosniff`**, siempre, para todos los tipos. Y el nombre del fichero en la cabecera va codificado: un nombre con comillas o salto de línea rompe la cabecera o inyecta otra.
- [ ] Tests, verificación con `curl` subiendo un fichero real, commit.

---

### Task 7: Controlador del portal

**Files:** `portal-messages.controller.ts` + spec; `dto/portal-message.dto.ts`.

Rutas bajo `portal/tickets/:ticketId/messages`. `@UseGuards(ClientJwtGuard)`, `clientId` **siempre del token**.

**La proyección se construye campo por campo**, como todo lo que ve un cliente. Nunca un *spread* de la entidad menos unas claves: el día que se añada una columna, aparece sola.

Lo que el cliente ve de un mensaje: cuerpo, si es suyo o del equipo, fecha, y sus adjuntos. **No** ve la visibilidad —solo existen los públicos para él—, ni el identificador del autor interno.

- [ ] **Tests:** que un mensaje interno no aparece en la respuesta **ni él ni sus adjuntos**, comprobado sobre el cuerpo serializado; y que el conteo de adjuntos tampoco los incluye.
- [ ] RED, implementar, GREEN, commit.

---

### Task 8: Notificaciones de mensajes

**Files:** modificar `modules/notifications/domain/notification-rules.ts` (+ spec), el despachador si hace falta; las plantillas de la Tarea 1.

- Mensaje **público** de cliente → al equipo: al responsable si lo hay, si no al buzón.
- Mensaje **público** del equipo → al autor del ticket.
- **Nota interna → a nadie.** Con test propio: es la regla que no puede depender del cuidado de quien escriba.

Las reglas son lista blanca, como ya están: un tipo de evento nuevo queda callado por omisión.

**El cuerpo del mensaje en el correo:** decide si viaja o si el correo solo avisa y obliga a entrar. Si viaja, pasa por el mismo escapado que el resto y **solo en los correos del público que corresponda**. Déjalo razonado.

- [ ] RED, implementar, GREEN, commit.

---

### Task 9: Web — el componente de subida compartido

**Files:** `web/src/components/upload/FileDropZone.tsx`, `web/src/api/ticket-messages.api.ts`, tipos.

Un solo componente para el panel y el portal:

- **Arrastrar y soltar**, con estado visual claro de «suelta aquí» y volviendo a la normalidad al salir. Cuidado con los eventos de arrastre anidados, que es donde parpadea.
- **Pegar con Ctrl+V**, leyendo los ficheros del portapapeles. Una captura pegada llega **sin nombre**: hay que ponerle uno legible con la fecha, no `image.png` repetido.
- **Elegir con un botón**, que es lo que usa quien no arrastra ni pega. Un `<input type=file>` real, nunca un `<div>` pinchable.
- Los tipos y los límites **se piden al backend o se comparten**, no se escriben a mano en el frontend: si divergen, la interfaz acepta lo que el servidor rechaza.
- Un fichero rechazado se dice **por qué**, con el nombre delante. «Error» no sirve cuando alguien arrastró cinco.

**Las vistas previas:** las imágenes se piden por JavaScript con la sesión y se pintan desde memoria. Una etiqueta `<img>` no puede mandar la cabecera de sesión, así que apuntar su `src` al endpoint protegido **no funciona**. Libera los objetos creados al desmontar, o cada hilo abierto deja memoria retenida.

- [ ] Verificar en el navegador con Chrome DevTools, build limpio, commit.

---

### Task 10: Web — el hilo en el panel

**Files:** modificar `web/src/pages/TicketDetailPage.tsx`; componentes nuevos del hilo.

**Lo más importante de esta tarea no es técnico.** Es que sea **imposible** equivocarse de tipo de mensaje. Una nota interna escrita como respuesta pública ya no se puede retirar.

- Dos botones distintos, no un desplegable.
- El mensaje **ya escrito** se ve distinto según a dónde vaya: color, etiqueta, y que diga quién lo va a leer.
- En el hilo, una nota interna se distingue de una respuesta de un vistazo.

Convenciones de siempre: guardas `cancelled` en los efectos, controles reales, ningún fallo tragado, botón deshabilitado en vuelo.

- [ ] Verificar en el navegador, commit.

---

### Task 11: Web — el hilo en el portal

**Files:** modificar `web/src/pages/portal/PortalTicketDetailPage.tsx`.

Más simple: un solo tipo de mensaje, sin elección. El cliente escribe, adjunta y ve el hilo.

Si el ticket vuelve de «Espera cliente» a «En atención» al responder, **que se vea**: el estado cambia delante de él sin recargar.

- [ ] Verificar en el navegador, commit.

---

### Task 12: Verificación de extremo a extremo

El entregable es la evidencia.

- [ ] Cliente abre un ticket con una captura arrastrada. Llega, se ve en el hilo, y el fichero está en disco con clave generada.
- [ ] Equipo responde con una respuesta pública y un PDF. El cliente lo ve y lo descarga.
- [ ] Equipo escribe una **nota interna con adjunto**. Inspeccionar el cuerpo crudo de la respuesta del portal: **ni el mensaje ni el adjunto aparecen**, y el conteo no los cuenta.
- [ ] Con el token del cliente, pedir el adjunto de la nota interna por su identificador: **404**.
- [ ] Con el token de un cliente, pedir un adjunto de otro cliente: **404**, mismo cuerpo.
- [ ] Subir un fichero con extensión `.png` y bytes de otra cosa: **rechazado**, y no queda nada en disco.
- [ ] Subir un SVG: rechazado.
- [ ] Cliente responde a un ticket en «Espera cliente»: vuelve a «En atención» y **los vencimientos de SLA quedan desplazados**, no recalculados. Comprobar los valores en la base antes y después.
- [ ] La nota interna **no genera ningún correo**; la respuesta pública sí.
- [ ] Pegar una captura con Ctrl+V en los dos lados.
- [ ] `cd backend && npm test`, `npm run build`, `cd web && npm run build` — los tres limpios.

**Y una comprobación de operación:** cuánto ocupa el directorio de subidas y cuánto disco queda. Con gente de fuera subiendo ficheros, ese número deja de ser anecdótico.

---

## Verificación de cobertura de la spec

| Sección de la spec | Tareas |
|---|---|
| §2 hilo con dos visibilidades | 1, 3, 4, 10 |
| §2 adjuntos heredan la visibilidad | 3, 5, 7, 12 |
| §3 tipos permitidos y validación por bytes | 2, 5, 12 |
| §3 SVG fuera | 2 |
| §3 vistas previas sin servir en línea | 9 |
| §4 regla 1, la clave la genera el servidor | 1 (Step 3), 5 |
| §4 regla 2, validar por bytes | 2, 5 |
| §4 regla 3, descarga forzada y `nosniff` | 6 |
| §4 regla 4, 404 y no 403 | 5, 7, 12 |
| §4 regla 5, lo interno no existe para el portal | 5, 7, 12 |
| §5 transición y SLA reanudado | 4, 12 |
| §5 avisos, y la nota interna que no avisa | 8, 12 |
| §7 pruebas | 2, 4, 5, 7, 8, 12 |

**Fuera de alcance por decisión de la spec §8**, sin tarea: antivirus · miniaturas en servidor · comprimidos, ejecutables y ofimática · editar o borrar mensajes · menciones y reacciones · retención de adjuntos · adjuntos en requerimientos.

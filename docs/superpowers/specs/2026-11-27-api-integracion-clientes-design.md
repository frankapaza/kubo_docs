# API de integración para clientes (tickets y requerimientos) — Diseño

## Para qué

Los clientes quieren conocer el estado de sus tickets y requerimientos desde sus propios sistemas, para armar dashboards (Power BI, Excel, intranet) y hacer seguimiento sin entrar al portal. Hoy esos datos solo se ven en el portal, con usuario y contraseña de una persona.

## Objetivos

- Una API **de solo lectura**, por cliente, con autenticación por **clave de API**.
- Datos en **JSON** y también en **CSV** (`?formato=csv`) para Excel.
- Sincronización incremental: traer solo lo que cambió desde una fecha.
- Un resumen listo para dashboards.
- El administrador del cliente gestiona sus claves desde el portal; el personal de KUBO también puede hacerlo desde el panel.

## No objetivos

- Crear, modificar o comentar tickets o requerimientos (decidido: solo lectura).
- Avisos automáticos o webhooks (fase posterior si alguien los pide).
- Adjuntos, mensajes del hilo o documentos (Especificación, Manual, Acta).
- Datos de otros módulos: monitoreo, reuniones, proyectos.

## Anti-objetivos (sería un fracaso aunque funcione)

- Que una clave vea datos de **otro cliente**, o datos internos que el portal no muestra.
- Que una clave filtrada no se pueda cortar al momento.
- Que la API exponga identificadores o campos internos «de paso», fuera de una lista blanca escrita a mano.

## Enfoques considerados

| | Enfoque | Resultado |
|---|---|---|
| A | API REST de solo lectura con clave por cliente (JSON) | **Elegido** |
| B | A + exportación CSV en las mismas rutas | **Elegido** (añadido a A) |
| C | Webhooks: KUBO avisa al sistema del cliente en cada cambio | Descartado por ahora: exige reintentos, firmas y una URL pública del cliente; `actualizadosDesde` cubre el seguimiento |

## Frontera de visibilidad (la misma del portal)

La API ve **exactamente lo que ve el portal** de ese cliente, reutilizando sus reglas:

- **Tickets:** todos los del cliente (`clientId`) salvo los de origen interno (`isInternalTicketOrigin`, p. ej. MONITOREO), como `PortalTicketsService`. La descripción, solo con la regla `visibleDescription` del portal.
- **Requerimientos:** los del cliente con `origin = 'PORTAL'` (`WorkItemsRepository.listPortalRequirements` / `findPortalRequirement`), con las etiquetas de estado del portal (`PortalRequirementStatusLabel`).
- **Historial de tickets:** solo los eventos visibles en el portal (`PortalVisibleEventType`).

Un recurso ajeno o inexistente responde el mismo **404**.

## Claves de API

- Formato `kci_` + 32 bytes aleatorios en base64url. Se muestra **una sola vez** al crearla.
- Se guarda el **hash SHA-256**, el prefijo visible (`kci_xxxx…`), el nombre que le da el cliente («Power BI gerencia»), quién la creó, cuándo, el último uso y la revocación. Mismo patrón que las claves del conector de desarrollo (`dev-connector`).
- Cada clave pertenece a **un cliente**; el `clientId` sale siempre de la clave, nunca de la petición.
- Revocar es inmediato. Sin caducidad automática (decisión del constructor si se quiere añadir una fecha opcional).
- Máximo **10 claves activas** por cliente.
- Se envía en la cabecera `Authorization: Bearer kci_…` (también `X-Api-Key`, que algunas herramientas de BI piden). Nunca en la URL.

**Quién las gestiona**

- Portal: cualquier administrador del cliente (`CLIENT_ADMIN`) en una sección «Integraciones»: ve **todas** las claves de su empresa, crea (con nombre), copia la clave una sola vez y revoca cualquiera.
- Panel: el personal con rol ADMIN de KUBO, desde la ficha del cliente, con lo mismo. Los demás roles del personal no ven las claves.
- La clave es **de la empresa**, no de quien la creó: sigue activa si esa persona se desactiva (se registra el creador solo para trazabilidad). Si el cliente se desactiva, todas sus claves dejan de funcionar.
- Cada alta y revocación queda registrada (en la auditoría existente si admite actores del portal; si no, en una tabla de eventos de la clave — decisión del constructor tras revisar `AuditService`).

## Endpoints

Prefijo `/api/v1/integracion`. Todas son `GET`.

| Ruta | Devuelve |
|---|---|
| `/tickets` | Lista paginada |
| `/tickets/:codigo` | Detalle + historial de estados |
| `/requerimientos` | Lista paginada |
| `/requerimientos/:codigo` | Detalle |
| `/resumen` | Métricas para dashboards |
| `/sistemas` | Sistemas del cliente (para traducir `sistemaId`) |

Se identifica por **código** (`TK-…`, `RQ-…`), que es lo que el cliente conoce; el `id` numérico también se devuelve.

**Filtros de las listas** (todos opcionales): `estado` (uno o varios separados por coma), `prioridad`, `sistemaId`, `creadosDesde`, `creadosHasta`, `actualizadosDesde` (ISO 8601), `limite` (por defecto 100, máximo 500; 5000 en CSV) y `cursor`.

**Paginación por cursor** (no por número de página): orden estable por (`actualizadoEn`, `id`) ascendente; `cursor` es un token opaco con el último par devuelto. Así una sincronización larga no salta ni repite registros aunque los datos cambien mientras se pagina.

**Respuesta de lista:** `{ datos: [...], siguienteCursor: <token o null> }`. Para sincronizar: guardar el `actualizadoEn` mayor recibido y usarlo como `actualizadosDesde` la próxima vez.

**Qué mueve `actualizadoEn`:** es el `updated_at` de la fila. Cambia con cualquier edición del registro, también internas que el cliente no ve; el cliente puede recibir de nuevo un registro sin cambios visibles (inofensivo, idempotente). Un cambio de estado siempre lo mueve.

**Campos de ticket:** `id, codigo, asunto, descripcion, estado, prioridad, sistemaId, sistema, creadoEn, actualizadoEn, resueltoEn, cerradoEn, venceRespuesta, venceResolucion, slaEnRiesgo`. En el detalle, además, `historial: [{ tipo, desde, hasta, fecha }]`.
> Decidido por el responsable: **sí se exponen** prioridad y SLA. La lista del portal no los muestra, pero el informe mensual del portal ya le enseña al cliente la prioridad y el veredicto de SLA de cada ticket, así que la API no revela nada nuevo.

**Campos de requerimiento:** los de `PortalRequirementView` (`codigo, titulo, descripcion, estado, prioridad, fechaComprometida, cerradoEn, creadoEn, motivoRechazo, preguntaPendiente, tipo`) más `actualizadoEn`.

**Fechas:** ISO 8601 en UTC. Los nombres de campo, en español y camelCase, como el resto de la API del portal.

**`/resumen`** (parámetros `desde`, `hasta` en `YYYY-MM`; por defecto los últimos 12 meses). Los meses son **meses civiles de Lima** (UTC-5), como el informe mensual del portal. El cumplimiento de SLA **reutiliza el cálculo del informe mensual** (`portal/domain/monthly-report.ts`), para que el cliente vea las mismas cifras en la API y en el informe:

- tickets abiertos por estado y por prioridad;
- tickets creados y cerrados por mes;
- tiempo medio y mediano de resolución por mes (horas);
- % de tickets resueltos dentro del SLA por mes;
- requerimientos por estado y cerrados por mes.

## CSV

Las rutas de lista y `/resumen` aceptan `?formato=csv`:

- UTF-8 con BOM, separador `;` (Excel en español), una fila por registro, mismas columnas que el JSON (sin historial).
- Misma paginación por cursor; el siguiente cursor va en la cabecera `X-Siguiente-Cursor`. Se genera por streaming fila a fila, sin armar todo el archivo en memoria.
- `/resumen` en CSV devuelve una tabla larga: `metrica;dimension;mes;valor`.

## Límites y seguridad

- **Límite de uso:** 60 peticiones por minuto por clave y 120 por minuto por cliente en total (respuesta 429 con `Retry-After`), con el limitador de ventana fija que ya existe (`common/rate-limit`). El backend corre en una sola instancia, así que el contador en memoria basta. Una petición CSV cuenta como una.
- Solo lectura: cualquier método distinto de GET responde 405.
- Una clave revocada o desconocida responde 401, igual en ambos casos.
- Registro de uso: se actualiza `ultimoUso` solo en peticiones autenticadas, como mucho una vez por minuto por clave.
- Cabeceras: si llegan `Authorization` y `X-Api-Key`, manda `Authorization`. La comparación del hash es en tiempo constante.
- La API no acepta el JWT del portal ni del panel: solo claves `kci_`.

## Documentación para el cliente

Una página «API de integración» en el portal (junto a la gestión de claves) con: cómo autenticar, la lista de endpoints y filtros, ejemplos con `curl`, y la receta para Power BI («Obtener datos → Web → Avanzado», cabecera `Authorization`) y para Excel con CSV.

## Datos

Una migración nueva (`040_api_integracion_clientes.sql`, idempotente, registrada en `deploy.yml`, los dos `docker-compose` y `deploy.sh`) con la tabla `client_api_keys`:
`id, client_id, name, key_prefix, key_hash (unique), created_by_user_id NULL, created_by_client_user_id NULL, created_at, last_used_at NULL, revoked_at NULL, revoked_by_user_id NULL, revoked_by_client_user_id NULL`.

## Lo que queda al constructor

- Estructura del módulo (`modules/integration-api` o dentro de `portal`), reutilizando los servicios del portal para la frontera de visibilidad.
- Cómo se calcula cada métrica del resumen a partir de los campos existentes (`resolvedAt`, `slaResolutionDueAt`, etc.).
- Diseño visual de la sección «Integraciones» del portal y de la ficha del cliente en el panel, siguiendo los estilos existentes.
- Pruebas HTTP con el `ValidationPipe` global real (como `test-http-app`), incluida la de aislamiento entre clientes.

## Decisiones tomadas en la revisión (mías, para que las revise el responsable)

- Paginación por cursor en vez de por número de página.
- Meses de Lima y cálculo de SLA reutilizado del informe mensual.
- Límite adicional de 120 peticiones/minuto por cliente.
- Cualquier CLIENT_ADMIN gestiona todas las claves de su empresa; la clave sobrevive a su creador.
- CSV por streaming.

## Decisiones del responsable

- Solo lectura (sin crear ni comentar).
- Enfoques A + B: JSON y CSV.
- Se exponen prioridad, fechas SLA, `slaEnRiesgo` y las métricas de SLA del resumen.

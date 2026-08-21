# Informe mensual descargable por el cliente — Diseño

**Fecha:** 2026-08-07
**Estado:** propuesto
**Alcance:** R2 de tres proyectos relacionados. R1 (requerimientos desde el portal) está terminado. R3 (tickets por correo) tendrá su propia especificación.

## Problema

El cliente no tiene forma de llevarse por escrito lo que su proveedor hizo por él. Ve sus tickets y sus requerimientos vivos en el portal, uno a uno, pero no puede descargar un documento que resuma un mes y sirva como registro del servicio recibido — que es lo que le pide su propio sistema de gestión de calidad cuando le auditan a él.

Se quiere que cualquier usuario de la empresa cliente pueda descargar, de un mes ya terminado, un documento con lo que pidió, lo que se le entregó, y si se cumplieron los plazos comprometidos.

## Decisiones ya tomadas

Acordadas antes de escribir este documento y no se reabren:

1. **Compromiso para requerimientos, SLA para tickets.** Son dos cosas distintas y se miden distinto. Un requerimiento no tiene reloj de respuesta: tiene una fecha comprometida.
2. **En vivo, solo meses cerrados.** El informe se recalcula siempre, pero solo se puede pedir de un mes ya terminado, y el documento lleva impresos el periodo y la fecha y hora de generación.
3. **El cliente elige el alcance**: solo tickets, solo requerimientos, o ambos.
4. **Lo puede descargar cualquier usuario de la empresa**, no solo el administrador. Es el registro del servicio que su empresa recibió; restringirlo no protege nada. *(Crear requerimientos sigue siendo exclusivo del administrador.)*

## Decisiones que se toman aquí

Estas las tomo yo, por ausencia del interlocutor, y quedan registradas para que se puedan revertir:

5. **El código vive en el portal, no en el módulo `reports` existente.** Ese módulo es exclusivo del personal (`StaffOnlyGuard`) y gira alrededor de Jira; enredar ahí una superficie de cliente mezclaría dos fronteras de autorización distintas en un mismo servicio. El cálculo se aísla además en un módulo **puro**, sin base de datos ni inyección, para poder probarlo con filas de entrada y salida esperada.
6. **El informe no lo consume el personal.** La casa ya tiene su propio informe mensual por cliente. Duplicar superficie sin que nadie lo haya pedido es trabajo que hay que mantener. *Coste si me equivoco:* soporte no puede ver exactamente lo mismo que el cliente al atender una consulta sobre el documento.
7. **Sin narrativa generada por IA.** El módulo `reports` sí la tiene para los informes de Jira. Aquí no: un documento que el cliente puede presentar a un auditor no debe contener frases que nadie escribió. Solo datos y sus criterios.

## Fuera de alcance

- **El informe ISO del servicio completo** que insinuaba el prototipo original: tendencia de doce meses, satisfacción por técnico, no conformidades con referencia a norma, versión y aprobador nominal. Eso es un documento **de la casa sobre su servicio**, no del cliente sobre lo suyo, y es otro proyecto.
- **Encuesta de conformidad y CSAT.** No existen en el sistema; sin ellos no hay satisfacción que reportar.
- **Congelar el documento con folio.** Decisión 2: se descarta a propósito. Si un auditor lo exige, es una ampliación acotada (tabla de emisiones y guardar el fichero generado), no un rediseño.

## Qué contiene el informe

### Cabecera, siempre

- Razón social del cliente.
- Periodo, como mes y año.
- Fecha y hora de generación, **en hora de Perú**, con la zona escrita.
- El **criterio de selección**, en texto: qué se contó y desde cuándo. Sin esto el documento no es evidencia de nada, porque dos informes con números distintos no se pueden explicar.

### Bloque de tickets

Se incluyen los tickets **creados dentro del periodo**. Ese es el criterio, y va impreso.

Por cada ticket: código, asunto, categoría, prioridad, estado actual, fecha de alta, fecha de primera respuesta, fecha de resolución, plazo de respuesta comprometido, plazo de resolución comprometido, y dos veredictos — **cumplió respuesta** y **cumplió resolución**.

Totales:
- **Recibidos**: los del periodo.
- **Resueltos**: cuántos de esos están hoy resueltos o cerrados.
- **Pendientes**: los que no.
- **Resueltos dentro del periodo**: los que se resolvieron entre las fechas del mes, **hayan sido creados cuando fueran**. Es una cifra distinta de «resueltos», con su propio criterio impreso, y es la que un auditor pide.
- **Cumplimiento de respuesta** y **cumplimiento de resolución**, cada uno como porcentaje **sobre los tickets que tenían compromiso**, nunca sobre el total.

### El veredicto de cumplimiento, y la trampa que evita

Un ticket cumple la resolución si `resolvedAt <= slaResolutionDueAt`.

`slaResolutionDueAt` **ya absorbe las pausas**: `SlaService` lo desplaza al reanudar un ticket que estuvo en `ESPERA_CLIENTE` (`shifted.resolutionDueAt`). No hay que restar `pausedTotalSeconds` a mano; hacerlo lo descontaría dos veces.

Cada veredicto tiene **tres valores, no dos**: `CUMPLIDO`, `INCUMPLIDO` y **`SIN_COMPROMISO`**.

Un ticket sin política de SLA tiene `slaResolutionDueAt` en nulo. Tratar esa ausencia como incumplimiento acusaría al proveedor de romper un plazo que nunca prometió; tratarla como cumplimiento inflaría el porcentaje con casos que no se midieron. **Ninguna de las dos.** Es el defecto recurrente de este proyecto —decidir por la ausencia de un valor— y aquí la ausencia tiene su propio nombre.

Los `SIN_COMPROMISO` se cuentan aparte y **se excluyen del denominador** del porcentaje. El documento dice cuántos son.

Un ticket todavía sin resolver dentro de un periodo ya cerrado: si su plazo venció, es `INCUMPLIDO`; si no había plazo, `SIN_COMPROMISO`. No existe un estado «pendiente de juicio»: el mes está cerrado.

La respuesta se juzga igual: `firstResponseAt <= slaResponseDueAt` es `CUMPLIDO`; sin primera respuesta y con el plazo vencido, `INCUMPLIDO`; sin plazo, `SIN_COMPROMISO`.

**`resolvedAt` es el campo que se mide, y se puede usar con confianza para los dos estados finales**: la máquina de estados solo admite `CERRADO` viniendo de `RESUELTO` (`assertTransition`), así que todo ticket cerrado pasó antes por resuelto y tiene la marca puesta.

Con una excepción que conviene conocer: **reabrir un ticket borra `resolvedAt`** (`ticket-transitions.service.ts`, «se limpia la marca de resolución pero se conserva el texto»). Ese es el mecanismo concreto —más probable que ningún otro— por el que el informe de un mes ya cerrado puede cambiar entre dos descargas. La fecha de generación impresa es lo que permite explicarlo.

### Bloque de requerimientos

Se incluyen los requerimientos **con `origin = 'PORTAL'` creados dentro del periodo** — los que pidió el propio cliente. El trabajo interno de la casa no aparece, igual que no aparece en su portal.

Por cada uno: código, título, estado actual, fecha de solicitud, fecha comprometida, fecha de entrega real, y un veredicto de **compromiso**.

Totales: **solicitados**, **aceptados**, **entregados**, **rechazados**, y **cumplimiento del compromiso** como porcentaje sobre los que tenían fecha comprometida.

El veredicto usa la misma escala de tres valores. Un requerimiento sin fecha comprometida —porque sigue en `SOLICITADO`, o porque fue `RECHAZADO`— es `SIN_COMPROMISO`, nunca incumplido. Uno entregado es `CUMPLIDO` si `closedAt` cae en la fecha comprometida o antes, comparando **por fecha civil en hora de Perú**, no por instante: la fecha comprometida es un día, no un momento.

## El periodo, y la zona horaria

Las fronteras del mes se calculan **en hora de Perú**, usando `PERU_TIME_ZONE` de `backend/src/common/time-zone.ts`.

No es un detalle: producción corre en UTC. Con las fronteras en UTC, un ticket creado a las 20:00 del último día del mes caería en el mes siguiente, y el cliente vería desaparecer de su informe algo que él vivió dentro del mes. Este proyecto ya se comió esa clase de fallo dos veces —las fechas de los correos y la fecha comprometida—, y esta es la tercera superficie donde aparece.

**Un mes está cerrado** cuando su último instante en hora de Perú ya pasó. Pedir el mes en curso, o uno futuro, responde `400` con `{ code: 'BAD_INPUT', message: 'Solo se puede descargar el informe de un mes que ya terminó.' }`.

## Arquitectura

**Módulo puro** — `backend/src/modules/portal/domain/monthly-report.ts`. Sin base de datos, sin inyección, con el «ahora» por parámetro. Recibe las filas ya leídas y devuelve el informe calculado. Aquí viven los veredictos, los totales y los porcentajes, que es donde están las decisiones que hay que poder probar sin montar nada.

**Servicio** — `backend/src/modules/portal/portal-reports.service.ts`. Valida el alcance de la sesión, comprueba que el mes esté cerrado, calcula las fronteras del periodo, pide las filas al repositorio y delega el cálculo en el módulo puro.

**Ruta** — `GET /portal/informes/mensual?year=&month=&scope=` bajo `ClientJwtGuard`. `scope` es `TICKETS`, `REQUERIMIENTOS` o `AMBOS`. Como todas las del portal, **no acepta `clientId`**: el único que existe es el del token.

**Lectura** — dos consultas acotadas, con el `clientId` en el `WHERE` y no en un filtro posterior. La de requerimientos lleva además `origin = 'PORTAL'`. El bloque que no se pide **no se consulta**.

**Interfaz** — una pantalla en el portal donde se elige mes y alcance, se ve el informe, y se descarga en **PDF** y en **CSV**, reutilizando el patrón que ya funciona en `MonthlyReportPage` (jspdf + jspdf-autotable, y CSV con BOM). El backend calcula; el navegador dibuja.

## Qué ve el cliente

Lista blanca campo a campo, igual que en el resto del portal. Del ticket **no** salen: `assigneeUserId`, `slaPolicyId`, `rootCause`, `correctiveAction`, `resolutionMd`, `priorityOverridden`, `escalationLevel`, `pausedAt`, `pausedTotalSeconds`, `slaAtRisk`, ni la descripción interna.

La causa raíz y la acción correctiva quedan fuera a propósito: son el análisis interno de la casa, y publicarlos en un documento descargable es una decisión de producto que nadie ha tomado.

Los estados se publican con la misma traducción que ya usa el portal, para que el documento y la pantalla digan lo mismo.

## Errores

| Situación | Respuesta |
|---|---|
| Mes en curso o futuro | `400` · «Solo se puede descargar el informe de un mes que ya terminó.» |
| Mes o año fuera de rango | `400` · mensaje en español, sin nombres internos de propiedad |
| `scope` no reconocido | `400` |
| Sesión sin empresa utilizable | `401`, por `assertSessionScope` |
| Periodo sin nada que reportar | `200` con el informe vacío y sus totales en cero. **No es un error**: «no hubo incidencias» es un resultado legítimo, y un mes sin actividad también es evidencia. |

## Pruebas

El cálculo entero es un módulo puro, así que se prueba sin base de datos:

- Un ticket resuelto antes del plazo es `CUMPLIDO`; uno resuelto después, `INCUMPLIDO`.
- **Un ticket sin plazo es `SIN_COMPROMISO`, y no entra en el denominador del porcentaje.** Si el denominador lo incluyera, el porcentaje bajaría; la prueba lo comprueba con números concretos.
- Un ticket sin resolver con el plazo vencido es `INCUMPLIDO`.
- Un requerimiento entregado el mismo día comprometido es `CUMPLIDO` — el límite es inclusivo.
- Un requerimiento en `SOLICITADO` o `RECHAZADO` es `SIN_COMPROMISO`.
- **«Resueltos» y «resueltos dentro del periodo» dan cifras distintas** cuando un ticket de un mes anterior se resuelve en este. La prueba fija ese caso, que es el que confunde a quien lee el documento.
- Un periodo vacío devuelve totales en cero y porcentajes que no son `NaN`. *(Dividir entre cero es el error más probable de este cálculo.)*
- Las fronteras del periodo se calculan en hora de Perú: un ticket creado a las 20:00 del último día del mes pertenece a ese mes, no al siguiente. Prueba estructural, porque el equipo corre en hora de Lima y ningún instante delata el fallo comparando resultados.

Del servicio: el mes en curso se rechaza; una sesión sin empresa utilizable se rechaza; el bloque no pedido no se consulta; y las dos consultas llevan `clientId` —y `origin` la de requerimientos— dentro del `WHERE`, afirmado sobre los argumentos como ya hace `work-items.repository.spec.ts`.

## Riesgos

1. **Números que no cuadran con la percepción del cliente.** «Recibidos» cuenta por fecha de alta, y «resueltos dentro del periodo» por fecha de resolución. Son dos criterios distintos a propósito, y por eso los dos van impresos en el documento. Sin ese texto, el informe genera llamadas en vez de evitarlas.
2. **Datos escasos.** En producción hay 2 tickets y 12 requerimientos, todos internos. Los primeros informes saldrán casi vacíos; no es señal de avería.
3. **El documento lo dibuja el navegador.** Los números salen del backend, que es la única fuente, pero el PDF lo genera el cliente. Dos personas con navegadores distintos obtienen el mismo contenido y distinta tipografía. Aceptable para un registro; no lo sería para un documento con validez legal.
4. **Sin congelar.** Un mes cerrado casi nunca cambia, pero si alguien cierra un ticket viejo, el informe de aquel mes cambia. La fecha de generación impresa es lo que permite explicarlo.

# El sistema como columna del soporte — Diseño

**Fecha:** 2026-10-28
**Estado:** propuesto
**Alcance:** el circuito de soporte (ticket y requerimiento) y el alta de cliente que lo alimenta. **No** el módulo de proyectos, que se queda entero y funcionando — ver «La frontera del alcance».

## Problema

Un cliente escribió un ticket desde el portal y el desplegable «Sistema» le salió vacío: una sola opción, `(sin sistema)`, que no elige nada. No sabe si eso es normal, si falta algo o si la pantalla falla.

Al mirarlo salió lo de fondo. **Hay dos clasificadores que compiten y ninguno manda.**

- **Proyecto** (`projects`) tiene código, estado, configuración de Jira, miembros, reuniones y documentos comerciales. Lo referencian cinco entidades: `meetings`, `commercial_documents`, `project_members`, `work_items` y `tickets`. **Viene de cuando esta aplicación era un CRM de reuniones.**
- **Sistema** (`client_systems`) tiene tres campos —`client_id`, `name`, `is_active`— y **lo referencia una sola entidad: el ticket**.

Y el detalle que lo explica todo: **el ticket guarda los dos a la vez**. `tickets.project_id` y `tickets.system_id`, los dos `nullable`, los dos opcionales en `CreateTicketDto`, ninguno exigido nunca. En el requerimiento (`work_items.project_id`) pasa lo mismo con el proyecto.

**Lo único obligatorio en todas partes es el cliente.** Por eso los dos clasificadores acaban vacíos: el sistema nunca los pidió. El desplegable vacío no es un fallo de pintado, es la primera vez que el agujero del modelo sale a la pantalla de un cliente.

## La decisión ya tomada

El responsable confirmó que **nadie usa proyectos**. No hay que migrar datos ni avisar a nadie.

**El sistema pasa a ser la columna del lado de soporte.** El proyecto sale del circuito de soporte.

Encaja con el negocio: la casa **arrienda software**. «Sistema de Cobranza» es lo que el cliente usa, lo que se le cae y por lo que escribe. Un proyecto es una obra con fecha de fin; un sistema arrendado no termina, y el soporte cuelga de lo que no termina.

### El remate, que es el argumento de fondo y no un adorno

Hay **tres cosas que miden al mismo sujeto y hoy no se pueden cruzar**:

1. El **informe mensual** que el cliente descarga (`PortalReportsService.monthly`). Hoy lista tickets y requerimientos por categoría de servicio y cumplimiento de SLA — **sin una sola mención al sistema**. No puede agrupar por sistema porque el ticket no lo trae garantizado.
2. El **vigilante de disponibilidad** que está proyectado. Lo que vigila es un sistema: está arriba o está caído. No existe «un proyecto caído».
3. El **ticket**, que es lo que el cliente escribe cuando algo de eso se le cae.

Si el ticket cuelga del sistema, los tres hablan del mismo sujeto: *cuántos tickets tuvo este sistema, cuánto estuvo caído, qué se le pidió*. Eso es lo que la casa le vende a un cliente que arrienda software, y hoy no se puede contestar. Mientras el ticket pueda nacer sin sistema, el cruce no existe: un solo ticket sin clasificar convierte cualquier total por sistema en una cifra que no suma.

**Este diseño no construye el informe por sistema ni el vigilante.** Construye la única condición que los hace posibles: que el ticket traiga sistema. Lo demás es la fase siguiente, y queda fuera a propósito (ver «Fuera de alcance»).

## La frontera del alcance, y por qué está ahí

**Dentro:** todo lo que crea o edita un elemento de soporte —el ticket y el requerimiento—, su formulario en el panel, su formulario en el portal, la ingesta de correo que los crea sin que nadie elija, y el alta de cliente que es donde nacen los sistemas.

**Fuera, intacto:** el módulo de proyectos entero. Las pantallas `/projects`, los miembros, las reuniones, las actas, los documentos comerciales, la configuración de Jira del proyecto y el informe de Jira. El menú **no** se toca.

Tres razones, en orden de peso:

1. **El proyecto no es solo del soporte.** De las cinco entidades que lo referencian, tres —`meetings`, `commercial_documents`, `project_members`— son el CRM de reuniones y actas, que sigue en uso y no tiene sustituto. Quitar el proyecto del menú dejaría esas tres sin puerta de entrada mientras sus datos siguen vivos: una funcionalidad rota, no retirada.
2. **Esconder del menú no es una decisión, es aplazarla con disimulo.** Una pantalla a la que no se llega pero que sigue sirviendo peticiones es deuda que nadie vuelve a mirar. O se retira de verdad —y eso exige decidir qué pasa con reuniones y documentos, que es otro proyecto— o se deja como está y se dice que está como está. Se deja como está.
3. **El encargo es el circuito de soporte.** Lo que esta fase tiene que poder afirmar es: *un ticket nuevo trae sistema*. Eso se consigue sin tocar una línea de `modules/projects/`.

**La consecuencia que esto tiene y que hay que mirar de frente:** «Empujar a Jira» desde un ticket (`TicketAIService.pushToJira`) exige `ticket.projectId`, y a partir de aquí **ningún ticket nuevo lo tendrá**. El botón queda inalcanzable en la práctica. Se deja así, por tres motivos: nadie usa proyectos, así que nadie tiene Jira vinculado a uno; el código sigue funcionando para los tickets viejos que sí lo traen; y atar Jira al sistema en vez de al proyecto es una decisión de otra fase, con su propio diseño. Lo que no se hace es borrar el camino: borrarlo sería irreversible, y esta fase entera está escrita para poder revertirse.

## Decisiones

### 1. El desplegable vacío se explica. Es lo único que se arregla pase lo que pase

Si todo lo demás de este documento se parase hoy, esto ya habría arreglado el fallo que lo destapó.

- **En el portal**, cuando `GET /portal/systems` devuelve lista vacía, no se pinta desplegable. Se pinta una línea: *«Tu empresa aún no tiene sistemas registrados. Puedes crear el ticket igualmente; lo clasificaremos nosotros.»* Dice las tres cosas que el cliente necesita: qué pasa, que no es culpa suya, y que puede seguir.
- **En el panel**, con un cliente elegido y sin sistemas activos, tampoco se pinta desplegable: una línea con **el enlace para darlos de alta**, a la pestaña «Sistemas» de la ficha de ese cliente. Quien ve el hueco es quien puede taparlo, y se le lleva al sitio exacto.

Un desplegable con una sola opción muerta es la peor de las tres respuestas posibles: no informa, no deja actuar, y parece un fallo.

### 2. El sistema es obligatorio cuando la empresa tiene alguno, y nunca cuando no

La regla, exacta:

> Al **crear** un ticket, si el ticket tiene cliente y ese cliente tiene **al menos un sistema activo**, hay que elegir uno. Si el cliente no tiene ninguno activo, o el ticket no tiene cliente, el sistema queda opcional.

Tres consecuencias deliberadas:

- **Nunca se bloquea a un cliente por una tarea pendiente de la casa.** Que una empresa no tenga sistemas registrados es un descuido *nuestro*. Cobrárselo cerrándole el formulario es exactamente al revés de como debe doler.
- **La obligación no es retroactiva.** `PATCH /tickets/:id` no la aplica: un ticket viejo sin sistema se puede seguir editando. Un cambio de clasificación no puede convertirse en un peaje para corregir una falta de ortografía en el asunto.
- **Se cuentan los sistemas activos, no todos.** Un cliente cuyo único sistema se desactivó vuelve a estar en el caso «no tiene»: el campo se relaja solo. Es la misma lista que el desplegable ofrece; si exigiéramos elegir entre opciones que el desplegable no muestra, el formulario sería imposible de rellenar.

**La obligación vive en la aplicación, no en la base.** `tickets.system_id` sigue `NULL`able y **no hay migración en esta fase**. Un `NOT NULL` rompería la ingesta de correo (decisión 4), rompería las filas viejas, y haría irreversible una decisión que el encargo pide poder revertir. La regla se aplica donde hay alguien a quien preguntar: el formulario.

### 3. La validación que faltaba: el panel escribía el sistema a ciegas

Hoy `TicketsService.create` valida `clientId` y `projectId` contra la base y **no valida `systemId` en absoluto**. El portal sí lo hace (`PortalTicketsService.resolveSystemId`), pero el panel no: un `POST /tickets` con `systemId` de otra empresa se escribe tal cual.

Al tocar este campo se cierra: un `systemId` que no sea de un sistema **activo del cliente del ticket** se rechaza con 400, en el alta y en la edición. No es alcance que se añade por gusto — es la misma comprobación que la regla nueva necesita hacer de todas formas para saber qué sistemas hay.

Los dos mensajes son distintos a propósito, porque los lectores son distintos:
- Portal: «El sistema indicado no pertenece a tu empresa.» (ya existe, no se toca)
- Panel: «El sistema indicado no es de este cliente o está inactivo.»

### 4. La ingesta de correo: elige sola cuando no hay duda, y jamás rechaza un correo

`InboundEmailService` crea tickets sin que nadie elija nada. Un correo que no se convierte en ticket **es un cliente al que se le perdió la petición**, y eso no puede pasar nunca por una clasificación.

- Si el cliente tiene **exactamente un sistema activo**, el ticket nace con ese. No es una suposición: es el único software que esa empresa nos arrienda, y es lo que anotaría cualquier persona que mirara el correo.
- Si tiene **cero o dos o más**, el ticket nace **sin sistema** y el equipo lo asigna en el triaje. Adivinar entre dos sería inventarse el dato que todo esto existe para tener fiable.

La exención se nombra en el código, no se deduce. `TicketsService.create` recibe un cuarto argumento `SystemRequirement` con dos valores: `'EXIGIDO'` (por defecto) y `'EXENTO_SIN_QUIEN_ELIJA'`, que solo pasa la ingesta. **Por defecto se exige**, así que un camino de escritura nuevo hereda la regla en vez de saltársela por omisión — que es como se pierden las reglas.

No se deduce de `emailOrigin` ni de `origin === 'EMAIL'`, aunque hoy coincidan: eso sería decidir por una consecuencia en vez de por el hecho, el defecto recurrente de este proyecto. Además, `origin` lo puede teclear cualquiera en el formulario del panel, y sería una puerta para esquivar la regla sin querer.

### 5. Un sistema inactivo con tickets antiguos colgando

- **No se puede elegir.** Ni en el panel, ni en el portal, ni mandando la petición a mano: la validación de la decisión 3 exige *activo*.
- **Se sigue viendo.** Un ticket que ya apunta a un sistema desactivado conserva su `system_id`, y la ficha del ticket del panel enseña su nombre con la marca «(inactivo)». Borrar el dato del pasado para que cuadre el presente es falsificar el histórico, y el histórico es justo lo que el informe por sistema va a leer.

  Esto obliga a un añadido que conviene decir en voz alta: **hoy la ficha del ticket no enseña el sistema en absoluto** —enseña cliente, origen, tipo, categoría, asignado, nivel y fechas—, así que el clasificador que pasa a mandar era invisible justo donde se trabaja. Se añade el campo, con la marca de inactivo cuando toque.
- **Desactivar un sistema no toca ningún ticket.** No hay reasignación, ni en cascada ni a mano.
- **No hay que migrar nada al editar.** La obligación no es retroactiva (decisión 2), así que un ticket viejo cuyo sistema quedó inactivo se edita sin que nadie le exija cambiarlo.

### 6. Qué pasa con quien tenía el formulario abierto

Su envío choca con un 400 y el mensaje en español «Elige el sistema afectado.», que los dos diálogos ya pintan en su zona de error. **No se pierde nada de lo escrito**: los dos diálogos conservan el estado cuando el alta falla (`setErrors(...)` y `return`, sin limpiar los campos). Elige el sistema y reenvía.

Esto se cumple aunque el frontend no se despliegue a la vez que el backend, y es la razón de que la regla se implante primero en el servidor: la ventana entre los dos despliegues tiene un comportamiento decidido —un error escrito y legible— en vez de uno descubierto.

Los demás caminos que crean tickets, uno por uno:
- `POST /tickets` (panel): exige.
- `POST /portal/tickets` (portal): exige.
- Ingesta de correo: exenta, decisión 4.
- Ticket sin cliente (`(sin cliente)` en el panel): no hay cliente del que sacar sistemas, no se exige nada.
- No hay ningún otro: `TicketsService.create` solo se llama desde esos tres sitios.

### 7. Los tickets y requerimientos que ya tienen proyecto

Son pocos o ninguno. El comportamiento queda decidido, no descubierto:

- **El dato se queda.** `tickets.project_id` y `work_items.project_id` no se borran, no se vacían y no se migran. La columna sigue en la tabla y en la entidad.
- **Nadie lo puede escribir ya.** `projectId` sale de `CreateTicketDto`, de `UpdateTicketDto` (que hereda del anterior) y de `CreateWorkItemDto`. Con `forbidNonWhitelisted` activo, mandarlo devuelve 400 — una respuesta explícita, no un campo que se ignora en silencio.
- **Nadie lo ve en el circuito de soporte.** El selector «Proyecto» desaparece de los dos diálogos de alta y del panel del requerimiento.
- **Lo que ya lo tiene, lo conserva.** Un ticket viejo con proyecto sigue respondiendo con su `projectId` en la API, y `pushToJira` sigue funcionando para él (ver «La frontera del alcance»).
- **Los filtros por proyecto se retiran** de `GET /tickets` y `GET /work-items`: no hay forma de poner el valor, así que un filtro por él solo puede devolver lo de antes de este cambio. Un mando que ya no manda nada confunde más que lo que ahorra.

Revertir, si hiciera falta, es devolver cuatro campos a tres DTO y dos selectores a dos diálogos. Ningún dato se habrá perdido.

### 8. Dar de alta los sistemas entra en el alta del cliente, sin volverse un trámite

No se puede dar soporte de un software que nadie ha nombrado. Pero meter los sistemas como campo obligatorio del formulario de alta de cliente sería un error: ese formulario también da de alta **prospectos**, que todavía no arriendan nada, y hoy se rellena con una sola línea (razón social). Un campo obligatorio ahí estorba en el caso más común y se rellenaría con basura.

El empuje son dos gestos que no bloquean nada:

1. **Al crear un cliente, la aplicación lleva directamente a su pestaña «Sistemas»** (`/clients/:id?tab=systems`), con el campo de alta a la vista. El momento en que alguien acaba de escribir quién es el cliente es el momento en que sabe qué le arrienda. Si no lo rellena, no pasa nada: ya está en la ficha, que es donde iba a acabar igualmente.
2. **La ficha de un cliente en estado `CLIENT` sin sistemas activos lleva un aviso** con el mismo enlace. Reaparece cada vez que alguien abre la ficha hasta que se resuelve, y dice para qué sirve: sin sistemas, sus tickets no se pueden clasificar ni agrupar en su informe.

Un prospecto **no** recibe el aviso: no arrienda nada todavía, y avisar de una falta que no lo es enseña a ignorar los avisos.

Además, el texto de la pestaña «Sistemas» cuando está vacía pasa a decir lo que de verdad ocurre ahora: los tickets se pueden crear igual **y** se quedan sin clasificar, no solo que «el informe no podrá agruparse».

### 9. Dónde vive la regla: una sola vez, en dominio puro

En `backend/src/modules/tickets/domain/system-requirement.ts`, dos funciones puras —sin base, sin reloj— que `TicketsService` llama con la lista de sistemas activos ya consultada. El portal sigue teniendo **su** primera barrera (`resolveSystemId`), que no se toca: la frontera entre empresas no se delega en una regla compartida que mañana puede cambiar de motivo.

## Zona horaria

Este cambio **no toca ningún reloj**: no añade ni lee marcas de tiempo, no calcula plazos y no formatea fechas. `capturedAt`, el SLA y el informe mensual se quedan exactamente como están. Queda escrito para que no se lea como un descuido: la ausencia de pruebas de zona horaria aquí es una conclusión, no un olvido. Las pruebas que se añaden no dependen de la zona del proceso porque no miran ninguna fecha.

## Esquema

**No hay migración en esta fase.** Nada que crear, nada que alterar, nada que añadir a las tres listas de despliegue. Las columnas `tickets.project_id` y `work_items.project_id` se quedan donde están, con sus datos (decisión 7), y `tickets.system_id` sigue admitiendo vacío (decisión 2).

Dos cosas que *parecen* necesitar migración y no se hacen, con su motivo:
- **Índice en `tickets(system_id)`**: lo pedirá el informe agrupado por sistema, que es la fase siguiente. Hoy el único consumidor es un filtro de bandeja acotado a 500 filas.
- **Clave única en `client_systems(client_id, name)`**: la unicidad se comprueba hoy en el servicio, sin distinguir mayúsculas. Añadirla exige decidir qué hacer con los duplicados que pudiera haber ya, y eso es una migración de datos en una fase que presume de no migrar ninguno.

## Cómo se prueba

- **Dominio puro** (`system-requirement.spec.ts`): la tabla entera de la regla — con sistemas y sin elegir, sin sistemas y sin elegir, elegido ajeno, elegido inactivo, sin cliente, exención de la ingesta.
- **`TicketsService.create`**: que la regla se aplica antes de abrir la transacción y que un alta rechazada **no escribe ni ticket, ni evento, ni mensaje** (el doble de `tickets.service.spec.ts` ya imita el rollback).
- **`PortalTicketsService.create`**: su prueba monta un doble de `TicketsService`, así que la regla no pasa por ahí y no se puede volver a comprobar sin montar un servicio de verdad. Lo que **sí** se afirma, y es lo que importa: que el portal **no** pide la exención — hereda `'EXIGIDO'`. La exención es de la ingesta y de nadie más, y un día que alguien se la pase al portal, esta prueba es lo único que lo delata.
- **`InboundEmailService`**: tres casos — un sistema activo (lo toma), dos (entra sin sistema), cero (entra sin sistema). Y que en ninguno de los tres se descarta el correo.
- **Frontend**: `web/` no tiene ejecutor de pruebas. La verificación de la casa es `npx tsc --noEmit && npm run build`.

## Fuera de alcance

- El **informe mensual agrupado por sistema**. Es la razón de ser de este cambio, no su entrega.
- El **vigilante de disponibilidad**.
- **Retirar el módulo de proyectos**, esconderlo del menú o migrar sus datos.
- **Atar Jira al sistema** en vez de al proyecto.
- Poner `tickets.system_id` **`NOT NULL`**, o cualquier otro cambio de esquema.
- El **sistema en el requerimiento** (`work_items`): el requerimiento pierde el proyecto, pero no gana sistema en esta fase. Lo que el encargo exige es el circuito del ticket; darle a `work_items` una columna nueva es modelo nuevo, con su migración, y aquí no hay ninguna.

## Riesgos

- **Un cliente con sistemas registrados que de verdad quiere abrir un ticket «de otra cosa»** se queda sin salida: la regla le obliga a elegir uno de los que tiene. Se asume. El sistema está en todos los casos conocidos («se me cayó el de cobranza»), y la alternativa —una opción «Otro»— es volver al `(sin sistema)` que esto viene a quitar, con otro nombre.
- **La ventana entre el despliegue del backend y el del frontend**: unos minutos en los que el formulario no marca el campo como obligatorio y el servidor ya lo exige. Decidido en la decisión 6: error escrito, en español, sin perder lo tecleado.
- **La ingesta con dos sistemas activos sigue produciendo tickets sin clasificar.** Es deliberado, y es el hueco que queda abierto: el total por sistema del informe tendrá que contar aparte los no clasificados, o el triaje tendrá que cerrarlos antes. Esa decisión pertenece a la fase del informe.

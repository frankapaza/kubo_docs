# El sistema como columna del soporte — Diseño

**Fecha:** 2026-10-28
**Estado:** propuesto (reescrito el mismo día: ver «La decisión nueva»)
**Alcance:** el circuito de soporte (ticket y requerimiento), el catálogo de sistemas que la casa arrienda, y el alta de cliente que lo alimenta. **No** el módulo de proyectos, que se queda entero y funcionando — ver «La frontera del alcance».

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

**Este diseño no construye el informe por sistema ni el vigilante.** Construye las dos condiciones que los hacen posibles: que el ticket traiga sistema, y que «sistema» signifique lo mismo para todos los clientes. Lo demás es la fase siguiente, y queda fuera a propósito (ver «Fuera de alcance»).

## La decisión nueva: el sistema es un producto del catálogo, no un texto por cliente

Hoy `client_systems` es **texto libre por cliente**. El nombre del sistema se teclea una vez por cada empresa que lo usa. Si el mismo producto se arrienda a ocho clientes, ese nombre se escribe ocho veces, y a la novena alguien escribe «Sistema Cobranzas» donde los otros ocho pusieron «Sistema de Cobranza». A partir de ahí hay **dos productos donde solo hay uno**, y nada lo delata: cada cliente ve su lista correcta, el informe de cada uno cuadra, y lo único que se parte es justo lo que esto existe para poder contestar — *cuántos tickets tuvo este sistema*, sumando los ocho clientes.

El responsable lo zanjó así: *«yo les asigno el sistema que tienen de una lista de sistemas y ellos solo seleccionan»*.

Entonces:

1. **Hay un catálogo de sistemas**, global, con su alta, baja y modificación. Son los productos que la casa arrienda, y **son contados**. Lo mantiene la casa.
2. **A cada cliente se le asignan** sistemas de ese catálogo: un desplegable para elegir y una grilla con los que tiene. **Nadie vuelve a teclear un nombre.**
3. **El catálogo es cerrado.** Confirmado: no hay sistemas a medida de un solo cliente, así que **no existe ninguna salida para dar de alta uno «propio de este cliente»**. Esa salida sería el texto libre de hoy entrando por la puerta de atrás: el primero que la usara volvería a partir el histórico, y esta vez con la coartada de que el formulario se lo permitía.
4. **El desplegable del ticket lista los sistemas asignados a ese cliente**, no el catálogo entero.

### Esto sustituye a la clave única que el diseño anterior aplazaba

La versión anterior de este documento dejaba apuntada, en «Esquema», una **clave única en `client_systems(client_id, name)`** como la forma de detectar nombres duplicados, y la aplazaba por no querer migrar datos. Queda **retirada, no olvidada**, por dos motivos:

- **Ya existe.** La migración 010 creó la tabla con `UNIQUE KEY uq_client_systems (client_id, name)`, y su colación es `utf8mb4_unicode_ci`, que no distingue mayúsculas. La unicidad *dentro de un cliente* estaba puesta desde el principio; el documento anterior se equivocaba al darla por pendiente.
- **No era el duplicado que importa.** Una clave única por cliente no puede ver el problema de verdad, que es **entre clientes**: ocho filas con el mismo nombre en ocho empresas son exactamente lo que esa clave permite, y son precisamente lo que parte el histórico. Con un catálogo, la identidad del producto es **una fila**, y la unicidad sale sola y mejor: no hay dos nombres que comparar porque solo hay un nombre.

## La frontera del alcance, y por qué está ahí

**Dentro:** el catálogo de sistemas; la asignación cliente-sistema; todo lo que crea o edita un elemento de soporte —el ticket y el requerimiento—, su formulario en el panel, su formulario en el portal, la ingesta de correo que los crea sin que nadie elija, y el alta de cliente que es donde se asignan los sistemas.

**Fuera, intacto:** el módulo de proyectos entero. Las pantallas `/projects`, los miembros, las reuniones, las actas, los documentos comerciales, la configuración de Jira del proyecto y el informe de Jira. El menú **no** se toca.

Tres razones, en orden de peso:

1. **El proyecto no es solo del soporte.** De las cinco entidades que lo referencian, tres —`meetings`, `commercial_documents`, `project_members`— son el CRM de reuniones y actas, que sigue en uso y no tiene sustituto. Quitar el proyecto del menú dejaría esas tres sin puerta de entrada mientras sus datos siguen vivos: una funcionalidad rota, no retirada.
2. **Esconder del menú no es una decisión, es aplazarla con disimulo.** Una pantalla a la que no se llega pero que sigue sirviendo peticiones es deuda que nadie vuelve a mirar. O se retira de verdad —y eso exige decidir qué pasa con reuniones y documentos, que es otro proyecto— o se deja como está y se dice que está como está. Se deja como está.
3. **El encargo es el circuito de soporte.** Lo que esta fase tiene que poder afirmar es: *un ticket nuevo trae sistema, y ese sistema es el mismo producto para todos los clientes que lo arriendan*. Eso se consigue sin tocar una línea de `modules/projects/`.

**La consecuencia que esto tiene y que hay que mirar de frente:** «Empujar a Jira» desde un ticket (`TicketAIService.pushToJira`) exige `ticket.projectId`, y a partir de aquí **ningún ticket nuevo lo tendrá**. El botón queda inalcanzable en la práctica. Se deja así, por tres motivos: nadie usa proyectos, así que nadie tiene Jira vinculado a uno; el código sigue funcionando para los tickets viejos que sí lo traen; y atar Jira al sistema en vez de al proyecto es una decisión de otra fase, con su propio diseño. Lo que no se hace es borrar el camino: borrarlo sería irreversible, y esta fase entera está escrita para poder revertirse.

## Decisiones

### 1. El desplegable vacío se explica. Es lo único que se arregla pase lo que pase

Si todo lo demás de este documento se parase hoy, esto ya habría arreglado el fallo que lo destapó. Va primero, y no depende de ninguna otra decisión.

- **En el portal**, cuando `GET /portal/systems` devuelve lista vacía, no se pinta desplegable. Se pinta una línea: *«Tu empresa aún no tiene sistemas registrados. Puedes crear el ticket igualmente; lo clasificaremos nosotros.»* Dice las tres cosas que el cliente necesita: qué pasa, que no es culpa suya, y que puede seguir.
- **En el panel**, con un cliente elegido y sin sistemas asignados activos, tampoco se pinta desplegable. Se pinta una línea, y **cuál de las dos depende de quién mira**:
  - quien puede asignar sistemas (ADMIN, PRODUCT_OWNER — ver decisión 5) ve el aviso **con el enlace** a la pestaña «Sistemas» de la ficha de ese cliente. Quien ve el hueco es quien puede taparlo, y se le lleva al sitio exacto;
  - quien no puede, ve el aviso **sin enlace**, y en su lugar a quién pedírselo. Un enlace que lleva a una grilla de solo lectura es peor que ninguno: promete una salida que no está.

Un desplegable con una sola opción muerta es la peor de las tres respuestas posibles: no informa, no deja actuar, y parece un fallo.

### 2. Qué es del catálogo y qué de la asignación

Son dos tablas porque son dos hechos distintos, y la línea entre ellas es **el producto frente a la relación comercial**.

**El catálogo (`systems`) — lo que la casa arrienda.** Una fila por producto, para todos los clientes.

| Campo | Por qué vive aquí |
|---|---|
| `name` | Es el nombre del producto. Es el campo entero por el que existe el catálogo: escrito una vez, no una vez por cliente. |
| `is_active` | Si la casa **lo sigue ofreciendo**. Un producto retirado deja de poder asignarse a clientes nuevos (decisión 3). |

**La asignación (`client_systems`) — qué le arrienda la casa a quién.** Una fila por pareja cliente-sistema.

| Campo | Por qué vive aquí |
|---|---|
| `client_id`, `system_id` | La pareja. Únicos juntos: un cliente no tiene el mismo producto dos veces. |
| `is_active` | **Si este cliente lo sigue usando.** Es un hecho de la relación, no del producto: que esta empresa dejara el de cobranza no dice nada de las otras siete que lo tienen. |

**¿De cuál de las dos cuelga el ticket? De la asignación.** `tickets.system_id` apunta hoy a `client_systems.id` —compruébese en `PortalTicketsService.systems`, que publica ese `id`, y en `resolveSystemId`, que valida contra él—, y **sigue apuntando ahí**. No se repunta al catálogo, y ningún ticket se toca. Tres motivos, el tercero es el que decide:

1. **No hay nada que migrar.** Repuntarlo exigiría reescribir todas las filas de `tickets`, y las que colgaran de una asignación marcada por la migración (decisión 4) no tendrían a dónde apuntar. Esto es cero riesgo frente a un riesgo que no compra nada.
2. **El `UNIQUE (client_id, system_id)` de la asignación lo hace inequívoco.** Una asignación identifica exactamente una pareja, así que del `system_id` de un ticket se llega al producto con una unión, siempre y sin ambigüedad. El informe agrupado por producto es ese `JOIN`.
3. **Es el sujeto correcto.** Un ticket no es sobre «el Sistema de Cobranza» en abstracto: es sobre **la instalación que tiene esta empresa**. Es el mismo sujeto que vigilará el vigilante de disponibilidad, y por eso su dirección vive en la misma fila. Si el ticket colgara del catálogo, el ticket y la caída que lo causó estarían midiendo cosas distintas.

**Lo que se consideró y se dejó fuera, con su motivo:**

- **Un alias por cliente** («aquí lo llaman "el facturador"»). Es texto libre por cliente con otro nombre: dos clientes llamando distinto al mismo producto es exactamente el estado que esto viene a terminar. Si alguna vez hace falta, es un campo del catálogo —un segundo nombre del producto—, nunca de la pareja.
- **Una versión.** Una versión es de la instalación, no del producto, así que sería de la asignación. Hoy nadie la pide y nada la lee: no se añade.
- **Una descripción del producto.** Son contados y sus nombres se entienden. Un campo que nadie rellena acaba siendo un campo que nadie se cree.

**El hueco que hay que dejar pensado: la dirección que el vigilante comprobará.**

El vigilante de disponibilidad (fuera de alcance, ver «Fuera de alcance») tendrá que pedirle algo a una dirección y mirar si contesta. **Esa dirección es de la pareja cliente-sistema, no del producto**: el mismo «Sistema de Cobranza» corre en ocho instalaciones con ocho direcciones distintas, una por empresa. Ponerla en el catálogo le daría al vigilante una sola dirección para ocho inquilinos y le haría vigilar siempre la misma —la de quien la escribiera primero—, declarando sanos a los otros siete sin haberlos mirado.

**No se construye ahora**: no hay columna, no hay campo en ningún formulario y no hay nada que la lea. Lo que esta decisión sí hace es dejar el sitio preparado: cuando llegue, es **una columna más en `client_systems`** y ningún cambio de forma en ninguna de las dos tablas. El modelo no lo impide, y partir el nombre al catálogo es justo lo que lo permite — mientras el nombre estaba en la pareja, no había dónde poner un dato del producto ni dónde poner uno de la instalación sin que se confundieran.

### 3. Qué pasa cuando se quita una asignación, y cuando se retira un sistema del catálogo

Cuatro gestos distintos, cuatro respuestas decididas. Ninguna borra histórico.

**Desactivar una asignación** (`client_systems.is_active = 0`) — «este cliente dejó de usar este producto»:
- **No toca ningún ticket.** Ni reasigna, ni vacía, ni en cascada.
- **Deja de poder elegirse** en el formulario de ticket de ese cliente, en el panel y en el portal.
- **Se sigue viendo** en la ficha de los tickets que ya lo apuntan, con la marca «(inactivo)».
- Es el gesto normal. Es el que la pantalla ofrece.

**Borrar una asignación** (`DELETE`) — el gesto que la API ya tiene:
- **Se rechaza con 409 si algún ticket de ese cliente apunta a ese sistema**, con el mensaje *«Este cliente tiene tickets de este sistema. Desactívalo en lugar de quitarlo.»*
- Solo se permite cuando no hay ni un ticket detrás: la asignación que alguien puso por error hace cinco minutos.
- El motivo es el de siempre: el histórico es exactamente lo que el informe por sistema va a leer, y una asignación borrada deja tickets apuntando a una fila que ya no existe — un `system_id` que no resuelve a ningún nombre. Hoy esa comprobación **no existe**: `ClientSystemsService.remove` borra sin mirar nada.

**Retirar un sistema del catálogo** (`systems.is_active = 0`):
- **Deja de poder asignarse** a ningún cliente nuevo: desaparece del desplegable de la pestaña «Sistemas».
- **Las asignaciones que ya existen no se tocan, y siguen siendo elegibles en el formulario de ticket.** Esto es deliberado y es la mitad que importa: si la casa deja de vender un producto pero tres clientes lo siguen arrendando, esos tres clientes siguen escribiendo tickets sobre él. Cerrarles el formulario porque la casa dejó de venderlo a terceros es **exactamente el fallo que destapó todo esto**, con otro disfraz.
- Quien quiera además cortárselo a un cliente concreto, desactiva su asignación. Son dos hechos distintos y se dicen por separado.

**Borrar un sistema del catálogo** (`DELETE`):
- **Se rechaza con 409 si existe cualquier asignación que lo apunte**, activa o no, con el mensaje *«Este sistema está asignado a algún cliente. Retíralo del catálogo en lugar de borrarlo.»*
- Un producto con historia no se borra, se retira.

### 4. La migración de lo que ya existe: detectar, no adivinar

Hay filas en `client_systems` hoy, escritas con el modelo de texto libre. Hay que convertirlas en catálogo más asignaciones.

El dato que tenemos: **los dos clientes que se han mirado no tienen ningún sistema registrado**, así que lo más probable es que haya poquísimo o nada que convertir. **El diseño no se apoya en eso**: una migración que solo funcione si la tabla está vacía es una migración que nadie ha escrito.

Y el problema de fondo: **dos filas con el mismo nombre en clientes distintos son probablemente el mismo producto — pero «probablemente» no es una decisión que una migración pueda tomar.** Fusionarlas es irreversible en la práctica (una vez que ocho clientes cuelgan de la misma fila del catálogo, deshacerlo exige saber cuál era cuál), y equivocarse significa juntar en un solo informe los tickets de dos productos distintos que por casualidad se llamaban igual.

**Se calca el patrón de `025_normalizar_email_existente.sql`**, que resolvió exactamente esta forma de problema: *detecta los casos dudosos, no toca ninguno, y los deja anotados en una tabla para que alguien decida.*

1. **Se crea la tabla de constancia** `system_catalog_conflicts` (`client_system_id` único, `client_id`, `nombre`, `motivo`, `detected_at`). Es la caja negra de la migración: sin ella, «a este cliente le falta un sistema» no se podría investigar. Misma razón de ser que `email_normalization_conflicts` para los correos y que `inbound_emails` para el correo entrante.
2. **Se marcan, sin tocar nada**, dos clases de fila:
   - `NOMBRE_EN_VARIOS_CLIENTES`: el nombre normalizado aparece en **más de un `client_id`**. Es el caso dudoso del encargo. No se fusiona, no se duplica, no se toca.
   - `DUPLICADO_EN_EL_MISMO_CLIENTE`: dos filas del mismo cliente que normalizan igual. La clave única de la 010 ya impide casi todos (su colación ignora mayúsculas y espacios finales), pero no los espacios iniciales: `«ERP»` y `« ERP»` conviven hoy y chocarían bajo la clave única nueva. Es la colisión de la 025, misma respuesta: **no se toca ninguna de las dos**.
3. **Todo lo demás se convierte**: su nombre entra al catálogo y la fila recibe su `system_id`. Un nombre que solo aparece en un cliente se convierte sin ambigüedad: se crea su producto y se le asigna a ese único cliente, que es literalmente el estado de hoy escrito con el modelo nuevo. No se pierde nada ni se decide nada.
4. **Las filas marcadas se quedan como están**: con su nombre, con su `is_active`, y con `system_id` vacío.

**Lo que esto cuesta, dicho de frente:** una fila marcada **no clasifica nada** hasta que una persona la resuelva — el código nuevo solo mira asignaciones con `system_id`. Para ese cliente, el formulario de ticket se comporta como el de un cliente sin sistemas: no se bloquea, no se exige nada, y sale el aviso de la decisión 1. Es el único desenlace aceptable: el otro era adivinar.

**Lo que esta migración no puede ver, y es honesto decirlo:** dos nombres que *significan* el mismo producto pero se escriben distinto («Sistema de Cobranza» y «Cobranzas») son indistinguibles para cualquier SQL. No se detectan y se convierten en dos productos del catálogo. Esa es la basura que ya existe, y el sitio donde se limpia es el catálogo, a ojo, por una persona, una sola vez — que es precisamente lo que un catálogo de productos contados hace posible y el texto libre no.

### 5. Quién puede tocar el catálogo y quién las asignaciones

Miradas sus hermanas del panel:

- Las **listas globales de la casa** —proveedores de IA, integraciones, plantillas de aviso, auditoría— llevan todas `@Roles('ADMIN')`.
- El **cliente** lleva `@Roles('ADMIN', 'PRODUCT_OWNER')` para crear y editar, y `@Roles('ADMIN')` para borrar.

De ahí:

- **El catálogo (`/systems`): `@Roles('ADMIN')`.** Es una lista global de la casa, son contados, y una fila mal puesta la heredan todos los clientes. Lectura abierta a todo el personal: la pestaña «Sistemas» de cualquier ficha la necesita para pintar su desplegable.
- **Las asignaciones (`/clients/:clientId/systems`): `@Roles('ADMIN', 'PRODUCT_OWNER')` para escribir**, lectura abierta a todo el personal (el formulario de ticket y la ficha del ticket la necesitan). Asignar un sistema a un cliente es un hecho de la relación comercial, del mismo peso que editar la ficha del cliente, así que lleva la misma guarda que ella.

**Esto aprieta lo de hoy, y es a propósito.** `ClientSystemsController` hoy no lleva `@Roles` ninguno: cualquier miembro del personal autenticado puede crear, renombrar y borrar sistemas de cualquier cliente. Con texto libre eso era un descuido con poco alcance; con un catálogo compartido, una asignación equivocada se ve en el informe del cliente. La consecuencia hay que acompañarla, no solo decretarla: la pestaña «Sistemas» esconde sus controles a quien no puede usarlos, y el aviso del desplegable vacío cambia de texto según quién mira (decisión 1). Un botón que siempre responde 403 enseña a no fiarse de los botones.

### 6. El sistema es obligatorio cuando el cliente tiene alguno, y nunca cuando no

La regla, exacta:

> Al **crear** un ticket, si el ticket tiene cliente y ese cliente tiene **al menos un sistema asignado y activo**, hay que elegir uno. Si el cliente no tiene ninguno, o el ticket no tiene cliente, el sistema queda opcional.

«Asignado y activo» quiere decir las tres cosas a la vez: existe la asignación, la asignación está activa, y apunta a una fila del catálogo (`system_id` informado — ver decisión 4). Es exactamente la lista que el desplegable ofrece; si se exigiera elegir entre opciones que el desplegable no muestra, el formulario sería imposible de rellenar.

Tres consecuencias deliberadas:

- **Nunca se bloquea a un cliente por una tarea pendiente de la casa.** Que una empresa no tenga sistemas asignados es un descuido *nuestro*. Cobrárselo cerrándole el formulario es exactamente al revés de como debe doler.
- **La obligación no es retroactiva.** `PATCH /tickets/:id` no la aplica: un ticket viejo sin sistema se puede seguir editando. Un cambio de clasificación no puede convertirse en un peaje para corregir una falta de ortografía en el asunto.
- **Se cuentan los activos, no todos.** Un cliente cuya única asignación se desactivó vuelve al caso «no tiene»: el campo se relaja solo.

**La obligación vive en la aplicación, no en la base.** `tickets.system_id` sigue `NULL`able. Un `NOT NULL` rompería la ingesta de correo (decisión 8), rompería las filas viejas, y haría irreversible una decisión que el encargo pide poder revertir. La regla se aplica donde hay alguien a quien preguntar: el formulario.

### 7. La validación que faltaba: el panel escribía el sistema a ciegas

Hoy `TicketsService.create` valida `clientId` y `projectId` contra la base y **no valida `systemId` en absoluto**. El portal sí lo hace (`PortalTicketsService.resolveSystemId`), pero el panel no: un `POST /tickets` con `systemId` de otra empresa se escribe tal cual.

Al tocar este campo se cierra: un `systemId` que no corresponda a una **asignación activa del cliente del ticket** se rechaza con 400, en el alta y en la edición. No es alcance que se añade por gusto — es la misma comprobación que la regla nueva necesita hacer de todas formas para saber qué sistemas hay.

Los dos mensajes son distintos a propósito, porque los lectores son distintos:
- Portal: «El sistema indicado no pertenece a tu empresa.» (ya existe, no se toca)
- Panel: «El sistema indicado no es de este cliente o está inactivo.»

### 8. La ingesta de correo: elige sola cuando no hay duda, y jamás rechaza un correo

`InboundEmailService` crea tickets sin que nadie elija nada. Un correo que no se convierte en ticket **es un cliente al que se le perdió la petición**, y eso no puede pasar nunca por una clasificación.

- Si el cliente tiene **exactamente un sistema asignado y activo**, el ticket nace con ese. No es una suposición: es el único software que esa empresa nos arrienda, y es lo que anotaría cualquier persona que mirara el correo.
- Si tiene **cero o dos o más**, el ticket nace **sin sistema** y el equipo lo asigna en el triaje. Adivinar entre dos sería inventarse el dato que todo esto existe para tener fiable.

La exención se nombra en el código, no se deduce. `TicketsService.create` recibe un cuarto argumento `SystemRequirement` con dos valores: `'EXIGIDO'` (por defecto) y `'EXENTO_SIN_QUIEN_ELIJA'`, que solo pasa la ingesta. **Por defecto se exige**, así que un camino de escritura nuevo hereda la regla en vez de saltársela por omisión — que es como se pierden las reglas.

No se deduce de `emailOrigin` ni de `origin === 'EMAIL'`, aunque hoy coincidan: eso sería decidir por una consecuencia en vez de por el hecho, el defecto recurrente de este proyecto. Además, `origin` lo puede teclear cualquiera en el formulario del panel, y sería una puerta para esquivar la regla sin querer.

### 9. Un sistema inactivo con tickets antiguos colgando

- **No se puede elegir.** Ni en el panel, ni en el portal, ni mandando la petición a mano: la validación de la decisión 7 exige una asignación activa.
- **Se sigue viendo.** Un ticket que ya apunta a un sistema desasignado o desactivado conserva su `system_id`, y la ficha del ticket del panel enseña su nombre con la marca «(inactivo)». Borrar el dato del pasado para que cuadre el presente es falsificar el histórico, y el histórico es justo lo que el informe por sistema va a leer.

  Esto obliga a un añadido que conviene decir en voz alta: **hoy la ficha del ticket no enseña el sistema en absoluto** —enseña cliente, origen, tipo, categoría, asignado, nivel y fechas—, así que el clasificador que pasa a mandar era invisible justo donde se trabaja. Se añade el campo, con la marca de inactivo cuando toque.
- **Desactivar no toca ningún ticket.** No hay reasignación, ni en cascada ni a mano.
- **No hay que migrar nada al editar.** La obligación no es retroactiva (decisión 6).

### 10. Qué pasa con quien tenía el formulario abierto

Su envío choca con un 400 y el mensaje en español «Elige el sistema afectado.», que los dos diálogos ya pintan en su zona de error. **No se pierde nada de lo escrito**: los dos diálogos conservan el estado cuando el alta falla (`setErrors(...)` y `return`, sin limpiar los campos). Elige el sistema y reenvía.

Esto se cumple aunque el frontend no se despliegue a la vez que el backend, y es la razón de que la regla se implante primero en el servidor: la ventana entre los dos despliegues tiene un comportamiento decidido —un error escrito y legible— en vez de uno descubierto.

Los demás caminos que crean tickets, uno por uno:
- `POST /tickets` (panel): exige.
- `POST /portal/tickets` (portal): exige.
- Ingesta de correo: exenta, decisión 8.
- Ticket sin cliente (`(sin cliente)` en el panel): no hay cliente del que sacar sistemas, no se exige nada.
- No hay ningún otro: `TicketsService.create` solo se llama desde esos tres sitios.

### 11. Los tickets y requerimientos que ya tienen proyecto

Son pocos o ninguno. El comportamiento queda decidido, no descubierto:

- **El dato se queda.** `tickets.project_id` y `work_items.project_id` no se borran, no se vacían y no se migran. La columna sigue en la tabla y en la entidad.
- **Nadie lo puede escribir ya.** `projectId` sale de `CreateTicketDto`, de `UpdateTicketDto` (que hereda del anterior) y de `CreateWorkItemDto`. Con `forbidNonWhitelisted` activo, mandarlo devuelve 400 — una respuesta explícita, no un campo que se ignora en silencio.
- **Nadie lo ve en el circuito de soporte.** El selector «Proyecto» desaparece de los dos diálogos de alta y del panel del requerimiento.
- **Lo que ya lo tiene, lo conserva.** Un ticket viejo con proyecto sigue respondiendo con su `projectId` en la API, y `pushToJira` sigue funcionando para él (ver «La frontera del alcance»).
- **Los filtros por proyecto se retiran** de `GET /tickets` y `GET /work-items`: no hay forma de poner el valor, así que un filtro por él solo puede devolver lo de antes de este cambio. Un mando que ya no manda nada confunde más que lo que ahorra.

Revertir, si hiciera falta, es devolver cuatro campos a tres DTO y dos selectores a dos diálogos. Ningún dato se habrá perdido.

### 12. Asignar los sistemas entra en el alta del cliente, sin volverse un trámite

No se puede dar soporte de un software que nadie ha nombrado. Pero meter los sistemas como campo obligatorio del formulario de alta de cliente sería un error: ese formulario también da de alta **prospectos**, que todavía no arriendan nada, y hoy se rellena con una sola línea (razón social). Un campo obligatorio ahí estorba en el caso más común y se rellenaría con basura.

El empuje son dos gestos que no bloquean nada:

1. **Al crear un cliente, la aplicación lleva directamente a su pestaña «Sistemas»** (`/clients/:id?tab=systems`), con el desplegable del catálogo a la vista. El momento en que alguien acaba de escribir quién es el cliente es el momento en que sabe qué le arrienda. Si no asigna nada, no pasa nada: ya está en la ficha, que es donde iba a acabar igualmente.
2. **La ficha de un cliente en estado `CLIENT` sin asignaciones activas lleva un aviso** con el mismo enlace. Reaparece cada vez que alguien abre la ficha hasta que se resuelve, y dice para qué sirve: sin sistemas, sus tickets no se pueden clasificar ni agrupar en su informe.

Un prospecto **no** recibe el aviso: no arrienda nada todavía, y avisar de una falta que no lo es enseña a ignorar los avisos.

Con el catálogo, asignar deja de ser escribir: es elegir de una lista y pulsar. Ese es el motivo de que esto deje de ser un trámite de verdad y no solo sobre el papel — tres segundos y ninguna decisión de redacción.

Además, el texto de la pestaña «Sistemas» cuando está vacía pasa a decir lo que de verdad ocurre ahora: los tickets se pueden crear igual **y** se quedan sin clasificar, no solo que «el informe no podrá agruparse».

### 13. Dónde vive la regla: una sola vez, en dominio puro

En `backend/src/modules/tickets/domain/system-requirement.ts`, funciones puras —sin base, sin reloj— que `TicketsService` llama con la lista de sistemas activos ya consultada. El portal sigue teniendo **su** primera barrera (`resolveSystemId`), que no se toca: la frontera entre empresas no se delega en una regla compartida que mañana puede cambiar de motivo.

## Esquema

**Sí hay migración en esta fase**, a diferencia de lo que decía la versión anterior de este documento: el catálogo es una tabla nueva y la asignación es una columna nueva. Es **una sola**, la siguiente libre es la **028**, y tiene que ir en las **tres** listas de despliegue (`.github/workflows/deploy.yml`, `docker-compose.yml`, `docker-compose.dev.yml` —donde además hay que renumerar la siembra—). Olvidar una rompe el arranque en producción.

`028_catalogo_de_sistemas.sql`, idempotente, con el patrón de procedimientos guardados que consultan `information_schema`:

1. `CREATE TABLE IF NOT EXISTS systems` — `id`, `name VARCHAR(120) NOT NULL`, `is_active TINYINT(1) NOT NULL DEFAULT 1`, marcas de tiempo, `UNIQUE KEY uq_systems_name (name)`. Colación `utf8mb4_unicode_ci`: la unicidad del nombre no distingue mayúsculas, como la de la 010.
2. `CREATE TABLE IF NOT EXISTS system_catalog_conflicts` — la caja negra de la decisión 4.
3. `client_systems.system_id BIGINT UNSIGNED NULL` tras `client_id`, guardado por `information_schema.COLUMNS`.
4. `client_systems.name` pasa a admitir vacío, guardado por `IS_NULLABLE` (mismo criterio que la sección 2 de la 027): las asignaciones nuevas no traen nombre.
5. Los tres pasos de datos de la decisión 4: marcar los dos motivos sin tocar nada, sembrar el catálogo desde lo no marcado, y rellenar su `system_id`.
6. `UNIQUE KEY uq_client_systems_system (client_id, system_id)`, al final y guardado por `information_schema.STATISTICS`. Las filas marcadas conservan `system_id` vacío y MySQL admite varios vacíos en una clave única, así que no chocan.

**Lo que la migración NO hace, con su motivo:**
- **No borra `client_systems.name`.** Es la única constancia de qué decía una fila marcada, y de qué nombre dio origen a cada producto del catálogo. Borrarla sería irreversible por nada.
- **No pone `client_systems.system_id` `NOT NULL`.** Las filas marcadas lo tienen vacío a propósito; un `NOT NULL` obligaría a borrarlas o a adivinar, que son las dos cosas que la decisión 4 prohíbe.
- **No quita la clave única vieja** `uq_client_systems (client_id, name)`. Con `name` vacío en las filas nuevas no estorba —MySQL admite varios vacíos—, y quitarla es un paso irreversible sin ganancia.
- **No toca ni una fila de `tickets`.** `system_id` sigue apuntando a `client_systems` (decisión 2) y sigue admitiendo vacío (decisión 6); `project_id` conserva sus datos, igual que `work_items.project_id` (decisión 11).
- **No crea índice en `tickets(system_id)`.** Lo pedirá el informe agrupado por sistema, que es la fase siguiente. Hoy el único consumidor es un filtro de bandeja acotado a 500 filas.

## Zona horaria

Este cambio **no toca ningún reloj**: no añade ni lee marcas de tiempo de negocio, no calcula plazos y no formatea fechas. `capturedAt`, el SLA y el informe mensual se quedan exactamente como están. Las columnas `created_at`/`updated_at` de las tablas nuevas las pone MySQL con `CURRENT_TIMESTAMP`, igual que todas sus hermanas, y nadie las lee desde el código.

Queda escrito para que no se lea como un descuido: la ausencia de pruebas de zona horaria aquí es una conclusión, no un olvido. Las pruebas que se añaden no dependen de la zona del proceso porque no miran ninguna fecha — y eso importa doblemente en esta máquina, donde la zona está forzada a universal desde `jest.config.js` y ejecutar con otra no demostraría nada.

## Cómo se prueba

- **La migración está en las tres listas**: una prueba que lee `backend/sql/migrations/`, toma el número mayor y comprueba que aparece en `deploy.yml` y en los dos `docker-compose`. Mismo patrón que `bulk-users-contrato-web.spec.ts`, que ya lee un fichero del repositorio desde el backend porque es la única punta desde la que se ven las dos listas a la vez. Es el guardián del único fallo de esta fase que rompe el arranque en producción, y el único que ninguna prueba de código detectaría.
- **Dominio puro** (`system-requirement.spec.ts`): la tabla entera de la regla — con sistemas y sin elegir, sin sistemas y sin elegir, elegido ajeno, elegido inactivo, sin cliente, exención de la ingesta, y el caso del `bigint` que llega como cadena.
- **El catálogo** (`systems.service.spec.ts`): nombre repetido rechazado sin distinguir mayúsculas; borrado rechazado con asignaciones detrás; retirar no toca ninguna asignación.
- **La asignación** (`client-systems.service.spec.ts`): asignar dos veces el mismo producto se rechaza; borrar con tickets detrás se rechaza con 409; la lista que devuelve trae el nombre del catálogo y deja fuera las filas sin `system_id`.
- **`TicketsService.create`**: que la regla se aplica antes de abrir la transacción y que un alta rechazada **no escribe ni ticket, ni evento, ni mensaje** (el doble de `tickets.service.spec.ts` ya imita el rollback).
- **`PortalTicketsService.create`**: su prueba monta un doble de `TicketsService`, así que la regla no pasa por ahí. Lo que **sí** se afirma: que el portal **no** pide la exención — hereda `'EXIGIDO'`. Un día que alguien se la pase al portal, esta prueba es lo único que lo delata.
- **`InboundEmailService`**: tres casos — un sistema activo (lo toma), dos (entra sin sistema), cero (entra sin sistema). Y que en ninguno de los tres se descarta el correo.
- **Frontend**: `web/` no tiene ejecutor de pruebas. La verificación de la casa es `npx tsc --noEmit && npm run build`.

## Fuera de alcance

- El **informe mensual agrupado por sistema**. Es la razón de ser de este cambio, no su entrega.
- El **vigilante de disponibilidad** y la dirección que comprobará. La decisión 2 deja el sitio pensado; no crea la columna.
- **Resolver a mano las filas marcadas** por la migración. La migración las detecta y las anota; fusionarlas es una decisión de una persona, y la pantalla para hacerlo —si llega a hacer falta— es otra fase. Con la tabla de constancia y el catálogo, se resuelve con dos gestos en las pantallas que esta fase sí entrega.
- **Retirar el módulo de proyectos**, esconderlo del menú o migrar sus datos.
- **Atar Jira al sistema** en vez de al proyecto.
- Poner `tickets.system_id` **`NOT NULL`**.
- El **sistema en el requerimiento** (`work_items`): el requerimiento pierde el proyecto, pero no gana sistema en esta fase. Lo que el encargo exige es el circuito del ticket.

## Riesgos

- **La tabla de conflictos se llena y nadie la mira.** Es el riesgo propio del patrón de la 025: no tocar nada tiene el precio de que alguien tenga que volver. Se asume con los ojos abiertos, y se mitiga con lo que ya hay: un cliente con filas marcadas se comporta como un cliente sin sistemas, así que **se ve en la pantalla** —el aviso del desplegable vacío, y el aviso de la ficha del cliente— en vez de quedarse callado en una tabla. El dato conocido dice que probablemente estará vacía.
- **Apretar las guardas quita permisos que hoy existen.** Un DEVELOPER que hasta ayer daba de alta sistemas deja de poder. Decidido en la decisión 5, acompañado con pantallas que lo dicen en vez de con un 403.
- **Un cliente con sistemas asignados que de verdad quiere abrir un ticket «de otra cosa»** se queda sin salida: la regla le obliga a elegir uno de los que tiene. Se asume. El sistema está en todos los casos conocidos («se me cayó el de cobranza»), y la alternativa —una opción «Otro»— es volver al `(sin sistema)` que esto viene a quitar, con otro nombre.
- **La ventana entre el despliegue del backend y el del frontend**: unos minutos en los que el formulario no marca el campo como obligatorio y el servidor ya lo exige. Decidido en la decisión 10: error escrito, en español, sin perder lo tecleado.
- **La ingesta con dos sistemas activos sigue produciendo tickets sin clasificar.** Es deliberado, y es el hueco que queda abierto: el total por sistema del informe tendrá que contar aparte los no clasificados, o el triaje tendrá que cerrarlos antes. Esa decisión pertenece a la fase del informe.

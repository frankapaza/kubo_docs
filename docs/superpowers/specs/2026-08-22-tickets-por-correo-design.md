# Tickets por correo — Diseño

**Fecha:** 2026-08-22
**Estado:** propuesto
**Alcance:** R3, el último de tres proyectos relacionados. R1 (requerimientos desde el portal) y R2 (informe mensual descargable) están terminados.

## Problema

Los clientes escriben correos. Hoy ese correo lo lee una persona y, si se acuerda, abre un ticket a mano. El sistema tiene `EMAIL` como origen de ticket desde el primer día y el prototipo original ponía «IMAP conectado» en la barra lateral, pero nunca se construyó: el buzón `ticket@kuboti.com` solo envía.

Se quiere que un correo de un cliente registrado **cree el ticket solo**, que se le responda con el número, y que **cada respuesta suya se pegue al hilo** de ese mismo ticket en vez de abrir uno nuevo.

## Decisiones ya tomadas

Acordadas antes de escribir este documento:

1. **Solo se acepta correo de direcciones registradas** como usuario de cliente.
2. **Un remitente autenticado pero no registrado recibe una respuesta** diciéndoselo, en vez de ser ignorado en silencio.
3. **La correlación va por cabeceras primero** (`In-Reply-To` / `References`), y el número de ticket en el asunto es la **red de seguridad**, no el mecanismo.
4. **Se exige que el correo pase autenticación** antes de aceptarlo. Sin eso, el `From` es texto libre y cualquiera podría inyectar mensajes en el hilo de un cliente.

## Decisiones que se toman aquí

Estas las tomo yo, por ausencia del interlocutor, y quedan registradas para poder revertirse:

5. **La frontera de confianza vive en el servidor de correo, no en este código.**

   *Esta decisión se revisó durante la implementación y cambió. Se deja escrito el porqué, porque es lo más importante del proyecto.*

   La primera versión leía la cabecera `Authentication-Results` que añade nuestro servidor y exigía que SPF o DKIM pasaran. Esa comprobación **se eludió cinco veces** en revisión adversaria, cada vez por un camino distinto: buscar una subcadena; partir por `;` sin tokenizar; aceptar un DKIM auténtico **de otro dominio** (se corrigió exigiendo `dmarc=pass`); un comentario cerrado antes de tiempo por una dirección entrecomillada; y varias cabeceras unidas donde el atacante aporta la suya.

   La quinta reveló el fondo del asunto: **nuestro propio servidor construye esa cabecera concatenando datos del remitente sin escaparlos**. Con un punto y coma sin comillas en un campo que el atacante controla, la cabecera resultante es **indistinguible** de una legítima. La información necesaria para decidir no está en la cadena, así que **ningún análisis puede resolverlo**.

   Por eso: **el servidor de correo debe rechazar, en el momento de la entrega, todo lo que no pase DMARC.** Así lo que llegue al buzón ya viene autenticado y no hay que interpretar nada escrito por el remitente.

   `judgeAuthentication` se conserva como **defensa en profundidad**, no como la puerta. Exige `dmarc=pass`, distingue cinco veredictos —pasa, falla, sin cabecera, sin DMARC, sin servidor propio—, y falla cerrado ante la ausencia. Su limitación residual está documentada en el código y fijada como prueba de caracterización, marcada como conocida.

   *Corrección de la revisión de cierre: un sexto vector, y el más grave.* Los cinco anteriores atacaban el contenido de la cabecera; este ataca una suposición que nadie había comprobado nunca: que "la cabecera `Authentication-Results` más externa" es de verdad la que puso **nuestro** servidor. `buildRawHeaders` (`imap-mailbox.service.ts`) toma la primera aparición confiando en que el MTA de entrada antepuso la suya — si esa entrega no está bien anclada (proveedor mal configurado, cambio de ruteo, entrega directa), "la primera" pasa a ser la que el propio remitente escribió dentro de su mensaje: bien formada, con su propio `dmarc=pass` honesto para su propio dominio, y un `header.from=` fabricado a mano para nombrar a quien quiera suplantar. Ninguna de las cinco capas anteriores lo detecta, porque no hay nada mal formado que detectar. Este sexto vector añade un quinto veredicto (`SIN_SERVIDOR_PROPIO`): la cabecera tiene que empezar exactamente por el identificador de servidor configurado en los ajustes, o se rechaza — sin excepción, y fallando cerrado si el ajuste no está configurado todavía. *Corrección posterior a la tanda de cierre: esta comprobación no cierra el vector — ver el riesgo 1, más abajo, y el docblock de `judgeAuthentication`.*

   *Comprobación bloqueante de la puesta en marcha:* no basta con verificar que la cabecera "llega" — un correo con la cabecera falsificada por el propio remitente la satisface exactamente igual. Hay que verificar dos cosas, las dos en el servidor real: que rechaza en el sobre SMTP todo lo que no pase DMARC, **y** que el identificador de servidor configurado en los ajustes IMAP coincide con el primer segmento que ese servidor escribe de verdad en `Authentication-Results`. Por eso la ingesta nace apagada.
6. **Un técnico que responde desde su Outlook escribe un mensaje público del equipo**, no una nota interna. Un canal en el que uno puede equivocarse de destinatario no debe poder crear notas internas. Si quiere una nota interna, entra a la aplicación.
   *Consecuencia conocida:* si el técnico responde con «responder a todos», el cliente recibirá su correo directo **y** nuestra notificación. Dos mensajes con el mismo contenido. Se acepta; la alternativa —callar la notificación cuando el mensaje llegó por correo— es más lista de lo que conviene y rompe el hilo del portal.
7. **Se guarda el cuerpo entero y se muestra recortado.** Recortar y tirar pierde información que a veces importa; guardar sin recortar repite la conversación completa en cada mensaje. Se almacenan los dos: el texto recortado, que es lo que se ve, y el original, detrás de un «ver mensaje completo».
8. **Solo se lee `text/plain`.** Si el correo solo trae HTML, se convierte a texto. **Nunca se guarda ni se muestra HTML de fuera**: es una superficie de ataque que este sistema no necesita.
9. **Un solo lector, cada 60 segundos**, con la misma disciplina que el despachador de notificaciones: sin reentrada, y con la marca de procesado escrita antes de actuar.

## Fuera de alcance

- **Adjuntos entrantes.** El correo los trae, y el sistema ya tiene reglas de adjuntos con validación por bytes mágicos — pero el correo es exactamente por donde llegan los ficheros hostiles, y mezclarlo con la primera versión de la ingesta multiplica lo que hay que verificar de golpe. Los correos con adjunto **se procesan igual**, y el ticket anota cuántos traía y sus nombres, para que quien atienda sepa que existen y los pida.
- **Crear requerimientos por correo.** Solo tickets.
- **Responder al cliente desde el correo entrante.** Las respuestas del equipo salen por donde ya salen: las plantillas de notificación.

## El recorrido de un correo

1. **Se lee** del buzón por IMAP, sin marcarlo como leído todavía.
2. **Se descarta si ya se procesó**, por su `Message-ID`.
3. **Se descarta si es nuestro**, por venir del propio buzón: si no, cada acuse que enviamos volvería a entrar.
4. **Se descarta si es automático** — vacaciones, listas de correo, respuestas automáticas. Y **nunca se le responde**. Es lo que impide el bucle.
5. **Se comprueba la autenticación.** Si no pasa, se descarta **en silencio**: contestarle a un remitente falsificado significa escribirle a la víctima cuya dirección usaron.
6. **Se busca al remitente** entre los usuarios de cliente y entre el personal.
   - No es ninguno de los dos → se le responde una vez que no está registrado, y se descarta.
   - Es personal → su mensaje va al hilo como mensaje público del equipo.
   - Es usuario de cliente → sigue.
7. **Se correlaciona con un ticket existente**, por cabeceras y, si no, por el número del asunto.
   - Hay ticket → el correo entra como mensaje del cliente en ese hilo.
   - No hay → se crea un ticket nuevo, y se le responde con su número.
8. **Se marca como procesado** y se archiva.

## La correlación, y por qué en ese orden

**Primero `In-Reply-To`, después `References`, y solo entonces el asunto.**

Cada correo que enviamos guarda su `Message-ID`. Cuando el cliente responde, su cliente de correo copia ese identificador en `In-Reply-To` y lo acumula en `References`. Eso lo hacen todos, y no depende de que nadie respete el asunto.

El `[KB-1234]` del asunto se queda como red: sirve cuando alguien reenvía el correo desde otra cuenta, o escribe uno nuevo copiando el asunto. Pero **no se usa solo**: un identificador en el asunto es adivinable, así que cuando la correlación viene únicamente del asunto, se exige además que **el remitente pertenezca a la empresa dueña de ese ticket**. Si no, se trata como un correo nuevo.

Sin esa comprobación, cualquiera con una dirección registrada de la empresa A podría escribir a un ticket de la empresa B poniendo su número en el asunto.

## La frontera entre empresas

Es la misma regla del portal y aquí entra por un canal nuevo:

- Un correo de un usuario de la empresa A **solo puede tocar tickets de la empresa A**. La correlación por cabeceras encuentra el ticket, pero **se descarta si su cliente no es el del remitente**, y entonces se abre uno nuevo.
- El ticket que se crea lleva `clientId` del usuario remitente, nunca del contenido del correo.
- El mensaje se escribe con `authorClientUserId` del remitente y visibilidad **pública**. Un canal externo no puede escribir notas internas — es la misma regla que ya se aplicó al portal, donde un descuido dejó que un cliente escribiera una nota interna.

## Lo que impide los bucles y los abusos

| Riesgo | Freno |
|---|---|
| Nuestro acuse dispara una respuesta automática que dispara otro acuse | No se responde nunca a correo marcado como automático, y nuestros envíos van marcados como automáticos para que otros sistemas hagan lo mismo |
| Nuestro propio correo vuelve a entrar | Se descarta lo que viene de nuestro buzón |
| Un correo se procesa dos veces tras una caída | `Message-ID` único en base de datos |
| Un desconocido insiste y recibe cien respuestas | Una sola respuesta por dirección cada siete días |
| Muchos desconocidos a la vez queman la reputación del dominio | Tope global por hora; superado, se descarta en silencio |
| Un cliente con el correo mal configurado abre mil tickets | Tope de tickets nuevos por dirección y hora; superado, los correos quedan sin procesar y se avisa por el registro |
| Un correo enorme | Tope de tamaño; por encima, se crea el ticket con el asunto y una nota de que el cuerpo se descartó |

## Datos

**Migración `021_correo_entrante.sql`:**

- **`inbound_emails`** — el registro de todo lo que se lee. `message_id` con índice único, remitente, asunto, fecha, resultado del procesamiento (`TICKET_CREADO`, `MENSAJE_AÑADIDO`, `DESCARTADO_NO_AUTENTICADO`, `DESCARTADO_AUTOMATICO`, `DESCARTADO_PROPIO`, `DESCARTADO_DUPLICADO`, `REMITENTE_DESCONOCIDO`, `DESCARTADO_POR_TOPE`, `DESCARTADO_SIN_CONTENIDO`, `ERROR`), el ticket al que fue a parar, y el motivo cuando se descarta.
  Es la caja negra: sin ella, «a mi cliente no le llegó el ticket» no se puede investigar.
- **`ticket_messages.inbound_email_id`** — de qué correo salió un mensaje del hilo.
- **`ticket_messages.body_full`** — el cuerpo sin recortar (decisión 7). Nulo cuando el mensaje no vino por correo.
- **`tickets.email_message_id`** — el `Message-ID` del correo que lo abrió, para correlacionar respuestas.
- **`notification_deliveries.message_id`** — el `Message-ID` de cada correo que enviamos, para que `In-Reply-To` lo encuentre.

## Configuración

En los ajustes del espacio de trabajo, junto a los de SMTP: servidor IMAP, puerto, usuario, contraseña, carpeta, **el identificador del propio servidor de correo** (el ancla contra una cabecera `Authentication-Results` fabricada por el remitente, corrección de la revisión de cierre), y un interruptor para **apagar la ingesta sin desplegar**.

La ingesta **nace apagada**. Se enciende cuando la puesta en marcha confirma, contra el servidor real, dos cosas: que rechaza en el sobre lo que no pase DMARC, y que la cabecera de autenticación la pone de verdad nuestro propio servidor y es la más externa — no basta con comprobar que "llega".

## Errores y qué se ve

Un correo que falla al procesarse **no se pierde ni bloquea la cola**: se anota como `ERROR` con su motivo y se pasa al siguiente. La pantalla de correo entrante los muestra y permite reintentarlos.

Una caída de IMAP se anota y se reintenta al ciclo siguiente. No se avisa a nadie: un buzón que no responde durante un minuto es normal.

## Pruebas

Casi todo el diseño es analizable sin red, y ahí es donde va el peso:

- **Análisis de cabeceras**, con correos reales de ejemplo: `In-Reply-To` con y sin corchetes, `References` con varios identificadores, asuntos con `Re:`, `RE:`, `RV:` y acumulados.
- **La autenticación**: cabecera ausente → rechazado; presente y fallando → rechazado; **una cabecera falsa dentro del cuerpo no cuenta**; solo la más alta decide.
- **La correlación**: por `In-Reply-To`; por `References` cuando falta el anterior; por asunto **solo si el remitente es de la empresa del ticket**; y —la que importa— **un remitente de otra empresa con el número correcto en el asunto abre un ticket nuevo, no toca el ajeno**.
- **Los frenos**: correo automático no recibe respuesta; nuestro propio correo se descarta; el mismo `Message-ID` dos veces se procesa una; el tope por dirección y el global.
- **El recorte del cuerpo**: se guarda el original completo y se muestra recortado; un correo sin cita se guarda igual.
- **Lo que no se puede probar sin buzón** queda explícitamente separado: que el proveedor añada la cabecera, que las respuestas reales de Outlook y Gmail traigan las cabeceras esperadas, y que el acuse llegue a la bandeja y no a spam.

## Riesgos

1. **Si el proveedor no ancla `Authentication-Results` como la cabecera más externa, la realidad es la contraria de "no entra ningún correo": entraría todo, cada uno autenticado por su propio remitente.** La primera versión de este riesgo decía que la ausencia de la cabecera cerraba la ingesta — cierto para el caso feliz de que el proveedor simplemente no la añada en absoluto (`SIN_CABECERA`, `judgeAuthentication` la bloquea), pero no para el caso real y más peligroso: un remitente que escribe su propia cabecera `Authentication-Results` dentro de su propio mensaje, con su propio `dmarc=pass` honesto para su propio dominio. Si nuestro servidor no la ancla en el primer lugar del bloque de cabeceras (un proveedor mal configurado, un cambio de ruteo, entrega directa sin pasar por el MX esperado), esa cabecera fabricada pasa las cinco capas de `judgeAuthentication` sin que nada la distinga de una legítima — y con un `header.from=` también fabricado, el correo se procesa como si lo hubiera escrito la persona suplantada.

   *Corrección posterior a la tanda de cierre: el veredicto `SIN_SERVIDOR_PROPIO` (identificador de servidor, ver "Configuración") NO cierra este vector — lo detecta solo a medias, y el código, el informe y esta misma sección lo decían mal.* El identificador de nuestro servidor es un **nombre público**: está publicado en el DNS/MX del dominio y aparece en la cabecera de cualquier rebote que el servidor haya mandado alguna vez. En el escenario exacto de arriba — nuestro servidor de entrada no antepuso su cabecera, así que la primera es la del atacante —, el atacante solo tiene que escribir ese mismo identificador público como primer segmento de su cabecera fabricada. Verificado: entra igual, con suplantación completa. Lo que este veredicto sí distingue es el correo **mal ruteado** del **bien ruteado**: detecta que el ruteo cambió o que nuestro servidor dejó de anteponer su cabecera, no distingue al atacante del remitente legítimo. Es detección de una condición operativa, no una puerta.

   **Lo único que cierra de verdad este vector es que el servidor de correo rechace en la entrega — en el sobre SMTP, antes de aceptar el mensaje — todo lo que no pase DMARC.** Con esa política activa, el mensaje del atacante no llega al buzón, sin importar si conoce el identificador de nuestro servidor. Por eso la puesta en marcha no puede limitarse a comprobar que la cabecera "llega": tiene que verificar, contra el servidor real, esa política de rechazo en SMTP — es la que cierra el vector — y, aparte, que el identificador de servidor configurado coincide con el que el servidor realmente antepone, que sirve para detectar que el ruteo se rompió, no para sustituir a la política. Y por eso la ingesta nace apagada.
2. **Un solo lector.** Si mañana hay dos instancias del backend, dos lectores procesarían el mismo correo. Es la misma limitación que ya tiene el despachador de notificaciones y el mismo momento en que habrá que resolver las dos.
3. **El recorte de la cita nunca es perfecto.** Por eso se guarda el original.
4. **Reputación del dominio.** Responder a desconocidos es una decisión tomada; los topes son lo que la hacen sostenible. Si el dominio empieza a caer en spam, el interruptor de la ingesta es lo primero que hay que mirar.
5. **DMARC sigue sin publicarse.** Con el buzón abierto en los dos sentidos deja de ser recomendable y pasa a ser necesario.

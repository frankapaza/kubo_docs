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

5. **La autenticación se lee de la cabecera `Authentication-Results` que añade nuestro propio servidor de correo.** No se verifica SPF ni DKIM por nuestra cuenta: SPF necesita la IP de conexión, que ya no existe cuando leemos el buzón. Se confía **solo en la cabecera más alta**, la que añadió nuestro servidor, y se ignoran las demás — cualquiera puede escribir una cabecera con ese nombre en el cuerpo de su mensaje.
   **Si la cabecera no existe, el correo se trata como no autenticado.** El fallo es cerrado.
   *Riesgo asumido, y hay que verificarlo antes de desplegar:* si el proveedor de correo no añade esa cabecera, **no entrará ningún correo**. Es la primera comprobación de la puesta en marcha.
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

- **`inbound_emails`** — el registro de todo lo que se lee. `message_id` con índice único, remitente, asunto, fecha, resultado del procesamiento (`TICKET_CREADO`, `MENSAJE_AÑADIDO`, `DESCARTADO_NO_AUTENTICADO`, `DESCARTADO_AUTOMATICO`, `DESCARTADO_DUPLICADO`, `REMITENTE_DESCONOCIDO`, `ERROR`), el ticket al que fue a parar, y el motivo cuando se descarta.
  Es la caja negra: sin ella, «a mi cliente no le llegó el ticket» no se puede investigar.
- **`ticket_messages.inbound_email_id`** — de qué correo salió un mensaje del hilo.
- **`ticket_messages.body_full`** — el cuerpo sin recortar (decisión 7). Nulo cuando el mensaje no vino por correo.
- **`tickets.email_message_id`** — el `Message-ID` del correo que lo abrió, para correlacionar respuestas.
- **`notification_deliveries.message_id`** — el `Message-ID` de cada correo que enviamos, para que `In-Reply-To` lo encuentre.

## Configuración

En los ajustes del espacio de trabajo, junto a los de SMTP: servidor IMAP, puerto, usuario, contraseña, carpeta, y un interruptor para **apagar la ingesta sin desplegar**.

La ingesta **nace apagada**. Se enciende cuando la primera comprobación de la puesta en marcha confirma que la cabecera de autenticación llega.

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

1. **Si el proveedor no añade `Authentication-Results`, no entra ningún correo.** Es la primera comprobación antes de encender la ingesta, y por eso la ingesta nace apagada.
2. **Un solo lector.** Si mañana hay dos instancias del backend, dos lectores procesarían el mismo correo. Es la misma limitación que ya tiene el despachador de notificaciones y el mismo momento en que habrá que resolver las dos.
3. **El recorte de la cita nunca es perfecto.** Por eso se guarda el original.
4. **Reputación del dominio.** Responder a desconocidos es una decisión tomada; los topes son lo que la hacen sostenible. Si el dominio empieza a caer en spam, el interruptor de la ingesta es lo primero que hay que mirar.
5. **DMARC sigue sin publicarse.** Con el buzón abierto en los dos sentidos deja de ser recomendable y pasa a ser necesario.

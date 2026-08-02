# Notificaciones por correo — Diseño

**Fecha:** 2026-08-02
**Estado:** propuesta, pendiente de aprobación
**Depende de:** el portal de clientes (P1), ya construido en `feat/portal-clientes-p1`

## 1. El problema

Un cliente abre un ticket en el portal y a partir de ahí no sabe nada más. Si quiere enterarse de si alguien lo está viendo, tiene que volver a entrar y mirar. Y al revés: el equipo no se entera de que ha llegado un ticket por el portal salvo que tenga la bandeja abierta.

El SMTP ya está configurado y en uso (`mail.kuboti.com:465`, `ticket@kuboti.com`): lo usan hoy los documentos y las firmas. No hace falta infraestructura nueva de envío.

## 2. La decisión estructural: `ticket_events` es la bandeja de salida

Todo lo que le pasa a un ticket ya se escribe en `ticket_events`, **dentro de la misma transacción** que el cambio. Son nueve puntos de escritura repartidos en cinco servicios: el alta, las transiciones, la asignación, el escalado, el triaje con IA y el vigilante de SLA.

Enganchar el envío en cada uno de esos nueve sitios tiene dos problemas. El primero es que hay que acordarse de engancharlo también en el décimo, el que se escriba dentro de seis meses. El segundo es peor: un correo enviado dentro de una transacción que después se deshace es una mentira que ya no se puede retirar.

Así que el envío no se engancha en ningún sitio. Se añade una columna a `ticket_events` y **un vigilante lee las filas ya confirmadas** que aún no se han notificado. Ventajas concretas:

- Cero cambios en los nueve puntos de escritura, y cero deuda para los futuros.
- Nunca se manda un correo de algo que se deshizo: solo se leen filas confirmadas.
- Si el proceso se cae a mitad, al reiniciar retoma donde estaba. Un evento no notificado sigue en la cola.
- El registro de qué se envió y cuándo queda junto al hecho que lo provocó, no en un log aparte.

Es el patrón de *bandeja de salida transaccional*, y encaja aquí porque la tabla de eventos ya existía y ya era transaccional. No estamos añadiendo una pieza: estamos leyendo la que ya había.

### La trampa que hay que desactivar en la migración

`ticket_events` tiene hoy cientos de filas históricas. Si la columna `notified_at` nace nula, el primer arranque del vigilante mandaría un correo por cada evento que ha ocurrido desde que existe el sistema.

**La migración tiene que sellar todo lo existente como ya notificado.** No es un detalle de implementación: es la diferencia entre estrenar la funcionalidad y enviarle a cada cliente un centenar de correos de cosas de hace meses.

## 3. Qué se envía y a quién

### Al cliente, siempre solo al autor del ticket

Al usuario de cliente que lo creó. Si el ticket lo abrió el equipo por teléfono y no tiene autor de cliente, no sale ningún correo hacia fuera: no hay a quién.

| Cuándo | Por qué |
|---|---|
| Se crea el ticket | Acuse de recibo: existe, tiene código, lo estamos viendo |
| Pasa a `ESPERA_CLIENTE` | Es el único estado que exige que **él** haga algo. Si no se avisa, el ticket se queda parado esperando a alguien que no sabe que le toca |
| Pasa a `RESUELTO` | Hay una solución que revisar |
| Pasa a `CERRADO` | Se acabó |
| Se reabre | Vuelve a estar vivo |

**No se avisa** de cada cambio de estado. Un correo por pasar de `TRIAJE` a `ASIGNADO` no le dice nada útil a quien está esperando que le arreglen algo, y el ruido enseña a ignorar los correos que sí importan.

### Al equipo

| Cuándo | A quién |
|---|---|
| Entra un ticket nuevo con origen `PORTAL` | Al buzón del equipo |
| Un SLA se pone en riesgo | Al responsable asignado; si no hay, al buzón del equipo |

El **buzón del equipo** es una dirección nueva y configurable en los ajustes del área de trabajo, junto a los datos de SMTP. Si está vacía, se cae a la dirección del remitente. No se avisa a todos los ADMIN uno por uno: eso convierte cada alta de un usuario interno en un cambio silencioso de la lista de distribución.

## 4. Las plantillas son editables desde el panel

Tabla `notification_templates`, una fila por aviso, con asunto, cuerpo y un interruptor de activación. La migración las siembra con textos por defecto ya escritos, para que la funcionalidad sirva desde el minuto uno sin que nadie tenga que redactar nada.

Una pantalla de administración permite editarlas, previsualizarlas con datos de ejemplo y enviarse una de prueba a uno mismo.

Desactivar una plantilla apaga ese aviso concreto. Es la forma de decir "de esto no quiero que se avise" sin tocar código.

### El punto delicado: las variables no son las mismas para los dos públicos

Una plantilla dirigida al cliente y una dirigida al equipo **no pueden ofrecer el mismo juego de variables**.

El portal se construyó con la disciplina de proyectar campo por campo justamente para que un cliente no vea la prioridad, el SLA, el técnico asignado ni el motivo de una transición. Si la pantalla de plantillas ofreciera `{{motivo}}` en una plantilla del cliente, cualquiera podría filtrar por correo, sin querer y con toda la buena intención, exactamente lo que el portal se cuida de no enseñar. Y sería peor que en el portal: un correo no se puede retirar.

Por tanto:

- Cada plantilla declara su público, y **el juego de variables disponible depende del público**.
- Las variables de cliente son: código, asunto, estado en español, fecha, razón social y enlace al ticket en el portal.
- Las de equipo añaden: prioridad, plazo de SLA, responsable, motivo y enlace al panel.
- El editor solo ofrece las de su público, y **el sustituidor rechaza una variable que no corresponda** en vez de dejarla pasar en blanco. Que falle a la vista, no en silencio.
- Hay un test que lo fija: una plantilla de cliente que intente usar una variable de equipo no se guarda.

### Contenido del usuario dentro del correo

El asunto de un ticket lo escribe el cliente. Si el cuerpo del correo se compone en HTML, ese texto hay que escaparlo. Un asunto con un `<script>` dentro no es un ataque probable aquí, pero sí lo es uno con un `<` que rompa el resto del correo.

## 5. Fallos, reintentos y lo que no se hace

El envío falla: el servidor no responde, la dirección rebota. Cada fila lleva la cuenta de intentos y el último error.

- Se reintenta con espera creciente, hasta un tope.
- Superado el tope, se marca como fallida y **se deja de reintentar**. Queda el error registrado para poder mirarlo.
- Un evento cuyo tipo no genera aviso se sella igualmente como procesado, para que la cola drene y no crezca sin fin.
- Un fallo de envío **nunca** afecta a la operación que lo originó: el ticket ya está guardado y confirmado antes de que el vigilante lo vea.

Fuera de alcance, y conviene decirlo: no hay correo entrante. Nadie puede responder al correo y que eso se convierta en un comentario del ticket — eso es la ingesta por IMAP, que sigue sin construirse. Los correos deben decirlo explícitamente, porque el instinto de cualquiera al recibir uno es darle a "Responder".

Tampoco hay baja voluntaria: son correos transaccionales del servicio contratado, no comunicaciones comerciales.

## 6. Estructura

**Backend** — módulo nuevo `backend/src/modules/notifications/`:

| Fichero | Responsabilidad |
|---|---|
| `entities/notification-template.entity.ts` | Mapeo de la tabla de plantillas |
| `notification-templates.repository.ts` · `.service.ts` · `.controller.ts` | Lectura y edición desde el panel |
| `domain/template-renderer.ts` | Sustitución de variables, escapado y validación por público. **Puro: sin dependencias ni base, para poder probarlo a fondo** |
| `domain/notification-rules.ts` | Qué evento genera qué aviso y para quién. También puro |
| `notification-dispatcher.service.ts` | Resuelve destinatarios, compone y envía |
| `notification.scheduler.ts` | El vigilante que drena la bandeja |

**Migración 015**: columnas de notificación en `ticket_events` con el sellado de lo histórico, tabla `notification_templates` sembrada, y el buzón del equipo en los ajustes.

**Web**: pantalla de plantillas en el área de administración, con previsualización y envío de prueba.

## 7. Pruebas

Lo que tiene que quedar sujeto por un test, no por una comprobación manual:

- El sustituidor: variables conocidas, desconocidas, escapado de contenido del usuario, y el rechazo de una variable de equipo en una plantilla de cliente.
- Las reglas: qué evento dispara qué, y que un cambio de estado que no está en la lista no dispara nada.
- Que un ticket sin autor de cliente no genera ningún correo hacia fuera.
- Que un evento ya notificado no se vuelve a enviar.
- Que un fallo de envío no deshace nada del ticket ni bloquea el resto de la cola.
- Que el correo al cliente no contiene prioridad, SLA, responsable ni motivo. El mismo test de fuga que tiene el portal, sobre el cuerpo compuesto.

## 8. Lo que no entra

- Ingesta de correo entrante: responder a un aviso no hace nada.
- Notificaciones dentro de la aplicación, ni push, ni resumen diario.
- Adjuntos en los correos.
- Editor visual de plantillas: se editan como texto con variables.
- Correos a los usuarios de cliente que no son el autor del ticket.
- Notificaciones de requerimientos: esto es solo para tickets.

## 9. Riesgos

**El histórico.** Ya está dicho arriba y se repite aquí porque es el único fallo de esta funcionalidad que no tiene vuelta atrás: si la migración no sella los eventos existentes, se envían cientos de correos a clientes reales y no hay forma de recogerlos.

**La fuga por plantilla.** Un correo mal compuesto filtra a un cliente algo que el portal le oculta con cuidado. Mitigación: variables separadas por público, validación al guardar, y el test de fuga sobre el cuerpo compuesto.

**El volumen.** Una operación en masa sobre muchos tickets genera un correo por cada uno. Hoy no existe ninguna operación en masa, así que no se pone límite; pero conviene recordarlo el día que se añada una.

**La reputación del remitente.** Es la primera vez que el sistema envía correo automático a direcciones de fuera con volumen. Si el dominio no tiene SPF y DKIM en regla, los avisos acaban en la carpeta de no deseado y la funcionalidad no sirve para nada aunque el código sea perfecto. **Hay que comprobarlo antes de dar esto por terminado**, y no es una tarea de programación.

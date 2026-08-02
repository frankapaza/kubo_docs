-- =========================================================================
--  Migración 017 — Lo que las plantillas dicen sobre responder al correo
-- =========================================================================
--  Las siete plantillas sembradas por la 015 afirman que el correo «no se
--  puede responder». Es falso: `EmailService` pone `replyTo` con la dirección
--  del remitente SMTP (hoy ticket@kuboti.com), así que el botón Responder
--  funciona, el mensaje sale y llega a un buzón real. Lo que no ocurre es
--  nada de lo que el cliente espera: no se registra en el ticket, no avisa al
--  responsable y no reactiva un ticket en espera. Alguien contesta ahí,
--  se queda tranquilo y su respuesta no llega a ninguna parte del flujo.
--
--  Es el único defecto de la lista que ve el cliente, y prometerle algo falso
--  en un correo transaccional es lo peor que puede hacer un aviso automático.
--  Se arregla por el lado del texto y no quitando el `replyTo`: ese buzón
--  existe y lo lee gente, y dejar los correos sin `replyTo` empeoraría el
--  caso del que responde igualmente (su mensaje se perdería del todo).
--
--  EL PUNTO QUE NO SE PUEDE EQUIVOCAR — no pisar una edición del usuario.
--  Estas siete filas son editables desde el panel y pueden llevar meses
--  reescritas. Cada UPDATE lleva en el WHERE el texto EXACTO que sembró la
--  015: si el cuerpo no es byte a byte el que dejó la migración, la fila no
--  se toca. Eso hace además que reejecutar este fichero sea un no-op — a la
--  segunda pasada ya no coincide ninguno—, que es lo que hace falta bajo
--  docker-entrypoint-initdb.d.
--
--  No se filtra por `updated_by IS NULL`, que sería lo cómodo: el servicio
--  escribe esa columna en CUALQUIER guardado, incluido el que solo activa o
--  desactiva la plantilla. Una fila así nunca tuvo el texto tocado y se
--  quedaría con la mentira dentro. Lo que hay que respetar es la edición del
--  texto, y eso solo lo sabe el propio texto.
--
--  Sin guardas de information_schema y sin procedimiento: aquí no hay DDL.
--  `notification_templates` la crea la 015 sin condiciones, y la 015 va antes
--  que este fichero en los dos compose.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- --- Cliente ---------------------------------------------------------------

UPDATE notification_templates SET body_md = 'Hola,

Recibimos tu solicitud el {{fecha}}. Ya está registrada y la vamos a revisar.

- **Código:** {{codigo}}
- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Empresa:** {{razon_social}}

Puedes seguir el avance desde el portal cuando quieras:
{{enlace_portal}}

Este correo es automático. Si respondes, tu respuesta llega a un buzón que
leemos, pero **no se registra en el ticket ni avisa a nadie automáticamente**.
Para agregar algo, entra al portal y escríbelo ahí: así queda en el ticket y lo
ve todo el equipo.'
WHERE trigger_key = 'TICKET_CREATED' AND audience = 'CLIENT' AND body_md = 'Hola,

Recibimos tu solicitud el {{fecha}}. Ya está registrada y la vamos a revisar.

- **Código:** {{codigo}}
- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Empresa:** {{razon_social}}

Puedes seguir el avance desde el portal cuando quieras:
{{enlace_portal}}

Este correo es automático y **no se puede responder**. Si necesitas agregar
algo, entra al portal y escríbelo ahí: así queda en el ticket y lo ve todo el
equipo.';

UPDATE notification_templates SET body_md = 'Hola,

Tu ticket **{{codigo}}** quedó en espera. Necesitamos algo de tu parte para
poder continuar.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Desde:** {{fecha}}

Entra al portal y déjanos ahí lo que te pedimos:
{{enlace_portal}}

Mientras tanto el ticket queda parado, así que mejor no lo dejes pasar.

Este correo es automático. Si respondes, tu respuesta llega a un buzón que
leemos, pero **no se registra en el ticket ni avisa a nadie automáticamente**:
el ticket seguiría parado. Contéstanos desde el portal, por favor.'
WHERE trigger_key = 'TICKET_WAITING_CLIENT' AND audience = 'CLIENT' AND body_md = 'Hola,

Tu ticket **{{codigo}}** quedó en espera. Necesitamos algo de tu parte para
poder continuar.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Desde:** {{fecha}}

Entra al portal y déjanos ahí lo que te pedimos:
{{enlace_portal}}

Mientras tanto el ticket queda parado, así que mejor no lo dejes pasar.

Este correo es automático y **no se puede responder**. Responde desde el
portal, por favor.';

UPDATE notification_templates SET body_md = 'Hola,

Terminamos de atender tu ticket **{{codigo}}** el {{fecha}}.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}

Revísalo cuando puedas y cuéntanos si quedó bien:
{{enlace_portal}}

Si algo no quedó como esperabas, puedes reabrirlo desde el portal.

Este correo es automático. Si respondes, tu respuesta llega a un buzón que
leemos, pero **no se registra en el ticket ni avisa a nadie automáticamente**.
Usa el portal para comentarnos cualquier cosa.'
WHERE trigger_key = 'TICKET_RESOLVED' AND audience = 'CLIENT' AND body_md = 'Hola,

Terminamos de atender tu ticket **{{codigo}}** el {{fecha}}.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}

Revísalo cuando puedas y cuéntanos si quedó bien:
{{enlace_portal}}

Si algo no quedó como esperabas, puedes reabrirlo desde el portal.

Este correo es automático y **no se puede responder**. Usa el portal para
comentarnos cualquier cosa.';

UPDATE notification_templates SET body_md = 'Hola,

Cerramos tu ticket **{{codigo}}** el {{fecha}}.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Empresa:** {{razon_social}}

Queda todo el historial guardado en el portal, por si lo necesitas después:
{{enlace_portal}}

Gracias por avisarnos. Si vuelve a pasar, abre un ticket nuevo y lo vemos.

Este correo es automático. Si respondes, tu respuesta llega a un buzón que
leemos, pero **no se registra en el ticket ni avisa a nadie automáticamente**.
Para cualquier cosa, entra al portal.'
WHERE trigger_key = 'TICKET_CLOSED' AND audience = 'CLIENT' AND body_md = 'Hola,

Cerramos tu ticket **{{codigo}}** el {{fecha}}.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Empresa:** {{razon_social}}

Queda todo el historial guardado en el portal, por si lo necesitas después:
{{enlace_portal}}

Gracias por avisarnos. Si vuelve a pasar, abre un ticket nuevo y lo vemos.

Este correo es automático y **no se puede responder**.';

UPDATE notification_templates SET body_md = 'Hola,

Tu ticket **{{codigo}}** se reabrió el {{fecha}}. Vuelve a estar en atención.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}

Puedes seguirlo desde el portal:
{{enlace_portal}}

Este correo es automático. Si respondes, tu respuesta llega a un buzón que
leemos, pero **no se registra en el ticket ni avisa a nadie automáticamente**.
Si tienes que agregar detalles, hazlo en el portal.'
WHERE trigger_key = 'TICKET_REOPENED' AND audience = 'CLIENT' AND body_md = 'Hola,

Tu ticket **{{codigo}}** se reabrió el {{fecha}}. Vuelve a estar en atención.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}

Puedes seguirlo desde el portal:
{{enlace_portal}}

Este correo es automático y **no se puede responder**. Si tienes que agregar
detalles, hazlo en el portal.';

-- --- Equipo ----------------------------------------------------------------
--  Mismo criterio para el correo interno: quien responda a un aviso de SLA
--  creyendo que deja constancia en el ticket se equivoca igual que un cliente,
--  y aquí el que se pierde el mensaje es el equipo.

UPDATE notification_templates SET body_md = 'Entró un ticket nuevo por el portal el {{fecha}}.

- **Código:** {{codigo}}
- **Cliente:** {{razon_social}}
- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Prioridad:** {{prioridad}}
- **Vence:** {{sla}}
- **Responsable:** {{responsable}}

Ábrelo en el panel para triarlo y asignarlo:
{{enlace_panel}}

Este correo es automático. Si respondes, tu respuesta llega al buzón del
remitente, pero **no se registra en el ticket ni avisa a nadie
automáticamente**. Todo se gestiona desde el panel.'
WHERE trigger_key = 'TICKET_CREATED_PORTAL' AND audience = 'TEAM' AND body_md = 'Entró un ticket nuevo por el portal el {{fecha}}.

- **Código:** {{codigo}}
- **Cliente:** {{razon_social}}
- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Prioridad:** {{prioridad}}
- **Vence:** {{sla}}
- **Responsable:** {{responsable}}

Ábrelo en el panel para triarlo y asignarlo:
{{enlace_panel}}

Este correo es automático y **no se puede responder**. Todo se gestiona desde
el panel.';

UPDATE notification_templates SET body_md = 'El SLA del ticket **{{codigo}}** está por vencer.

- **Cliente:** {{razon_social}}
- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Prioridad:** {{prioridad}}
- **Vence:** {{sla}}
- **Responsable:** {{responsable}}
- **Detalle:** {{motivo}}

Atiéndelo desde el panel:
{{enlace_panel}}

Este correo es automático. Si respondes, tu respuesta llega al buzón del
remitente, pero **no se registra en el ticket ni avisa a nadie
automáticamente**. El ticket se gestiona desde el panel.'
WHERE trigger_key = 'SLA_AT_RISK' AND audience = 'TEAM' AND body_md = 'El SLA del ticket **{{codigo}}** está por vencer.

- **Cliente:** {{razon_social}}
- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Prioridad:** {{prioridad}}
- **Vence:** {{sla}}
- **Responsable:** {{responsable}}
- **Detalle:** {{motivo}}

Atiéndelo desde el panel:
{{enlace_panel}}

Este correo es automático y **no se puede responder**.';

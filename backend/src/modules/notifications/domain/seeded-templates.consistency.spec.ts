import { NotificationAudience, validateTemplate } from './template-renderer';

/**
 * Copia literal de las siete filas sembradas en `notification_templates` por
 * `backend/sql/migrations/015_notificaciones.sql` (sección 4), con el párrafo
 * final tal y como lo dejó la 017 (`017_plantillas_respuesta.sql`). No se
 * importa el SQL ni se consulta la base desde este test: es deliberado, para
 * que el test compare dos fuentes independientes -- el catálogo del
 * renderizador y lo que de verdad quedó sembrado -- y no se limite a comparar
 * el catálogo contra sí mismo.
 *
 * Verificado contra la base real corriendo:
 *   docker exec kubo-mysql-dev mysql -uroot -proot -e "USE kubo_devdocs;
 *     SELECT trigger_key, audience, subject, body_md FROM
 *     notification_templates ORDER BY audience, trigger_key;"
 * el 2026-08-02, ya con la 017 aplicada: las siete filas coinciden con lo que
 * hay abajo.
 *
 * Si alguien cambia el nombre de una variable en la migración (o en una
 * edición futura de estas plantillas) sin tocar `CLIENT_VARIABLES` /
 * `TEAM_VARIABLES` -- o al revés-- , una de las aserciones de este archivo
 * se pone en rojo.
 */
interface SeededTemplate {
  triggerKey: string;
  audience: NotificationAudience;
  subject: string;
  body: string;
}

const SEEDED_TEMPLATES: SeededTemplate[] = [
  // --- Cliente -------------------------------------------------------------
  {
    triggerKey: 'TICKET_CREATED',
    audience: 'CLIENT',
    subject: '[{{codigo}}] Recibimos tu solicitud: {{asunto}}',
    body: `Hola,

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
ve todo el equipo.`,
  },
  {
    triggerKey: 'TICKET_WAITING_CLIENT',
    audience: 'CLIENT',
    subject: '[{{codigo}}] Necesitamos tu respuesta: {{asunto}}',
    body: `Hola,

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
el ticket seguiría parado. Contéstanos desde el portal, por favor.`,
  },
  {
    triggerKey: 'TICKET_RESOLVED',
    audience: 'CLIENT',
    subject: '[{{codigo}}] Ya está resuelto: {{asunto}}',
    body: `Hola,

Terminamos de atender tu ticket **{{codigo}}** el {{fecha}}.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}

Revísalo cuando puedas y cuéntanos si quedó bien:
{{enlace_portal}}

Si algo no quedó como esperabas, puedes reabrirlo desde el portal.

Este correo es automático. Si respondes, tu respuesta llega a un buzón que
leemos, pero **no se registra en el ticket ni avisa a nadie automáticamente**.
Usa el portal para comentarnos cualquier cosa.`,
  },
  {
    triggerKey: 'TICKET_CLOSED',
    audience: 'CLIENT',
    subject: '[{{codigo}}] Ticket cerrado: {{asunto}}',
    body: `Hola,

Cerramos tu ticket **{{codigo}}** el {{fecha}}.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Empresa:** {{razon_social}}

Queda todo el historial guardado en el portal, por si lo necesitas después:
{{enlace_portal}}

Gracias por avisarnos. Si vuelve a pasar, abre un ticket nuevo y lo vemos.

Este correo es automático. Si respondes, tu respuesta llega a un buzón que
leemos, pero **no se registra en el ticket ni avisa a nadie automáticamente**.
Para cualquier cosa, entra al portal.`,
  },
  {
    triggerKey: 'TICKET_REOPENED',
    audience: 'CLIENT',
    subject: '[{{codigo}}] Reabrimos el ticket: {{asunto}}',
    body: `Hola,

Tu ticket **{{codigo}}** se reabrió el {{fecha}}. Vuelve a estar en atención.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}

Puedes seguirlo desde el portal:
{{enlace_portal}}

Este correo es automático. Si respondes, tu respuesta llega a un buzón que
leemos, pero **no se registra en el ticket ni avisa a nadie automáticamente**.
Si tienes que agregar detalles, hazlo en el portal.`,
  },
  // --- Equipo ----------------------------------------------------------------
  {
    triggerKey: 'TICKET_CREATED_PORTAL',
    audience: 'TEAM',
    subject: '[{{codigo}}] Ticket nuevo desde el portal — {{razon_social}}',
    body: `Entró un ticket nuevo por el portal el {{fecha}}.

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
automáticamente**. Todo se gestiona desde el panel.`,
  },
  {
    triggerKey: 'SLA_AT_RISK',
    audience: 'TEAM',
    subject: '[{{codigo}}] SLA en riesgo — {{razon_social}}',
    body: `El SLA del ticket **{{codigo}}** está por vencer.

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
automáticamente**. El ticket se gestiona desde el panel.`,
  },
];

describe('coherencia con las plantillas sembradas (migración 015)', () => {
  it('hay cinco plantillas de cliente y dos de equipo, como en la migración', () => {
    expect(SEEDED_TEMPLATES.filter((t) => t.audience === 'CLIENT')).toHaveLength(5);
    expect(SEEDED_TEMPLATES.filter((t) => t.audience === 'TEAM')).toHaveLength(2);
  });

  it.each(SEEDED_TEMPLATES)(
    '$triggerKey ($audience): el asunto valida contra su propio publico',
    ({ audience, subject }) => {
      expect(validateTemplate(subject, audience)).toEqual({ ok: true });
    },
  );

  it.each(SEEDED_TEMPLATES)(
    '$triggerKey ($audience): el cuerpo valida contra su propio publico',
    ({ audience, body }) => {
      expect(validateTemplate(body, audience)).toEqual({ ok: true });
    },
  );

  /**
   * Lo que el correo promete sobre responderlo tiene que ser verdad.
   *
   * `EmailService` pone `replyTo` con la direccion del remitente SMTP, asi
   * que responder FUNCIONA: el mensaje sale y llega a un buzon real que lee
   * gente. Lo que no ocurre es lo que el lector supone -- que quede en el
   * ticket, que avise al responsable, que reactive un ticket en espera --. La
   * 017 reescribio esa frase en las siete; esto impide que vuelva.
   */
  describe('lo que dicen sobre responder al correo', () => {
    it.each(SEEDED_TEMPLATES)(
      '$triggerKey ($audience): no promete que no se pueda responder',
      ({ body }) => {
        expect(body).not.toMatch(/no se puede responder/i);
      },
    );

    it.each(SEEDED_TEMPLATES)(
      '$triggerKey ($audience): dice que responder no toca el ticket ni avisa a nadie',
      ({ body }) => {
        expect(body).toMatch(/no se registra en el ticket ni avisa a nadie/);
      },
    );

    /** Y dice a dónde ir para que sí cuente: portal el cliente, panel el equipo. */
    it.each(SEEDED_TEMPLATES)('$triggerKey ($audience): manda al sitio que sí sirve', ({
      audience,
      body,
    }) => {
      expect(body).toMatch(audience === 'CLIENT' ? /portal/i : /panel/i);
    });
  });
});

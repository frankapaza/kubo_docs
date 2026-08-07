import { TICKET_STATUSES, TicketStatus } from '../../tickets/domain/ticket-state-machine';
import { TICKET_EVENT_TYPES } from '../../tickets/entities/ticket-event.entity';
import { TICKET_ORIGINS } from '../../tickets/entities/ticket.entity';
import { TICKET_MESSAGE_VISIBILITIES } from '../../ticket-messages/entities/ticket-message.entity';

import { NotificationActorKind, plansForEvent } from './notification-rules';
import {
  CLIENT_VARIABLES,
  NotificationAudience,
  TEAM_VARIABLES,
  validateTemplate,
} from './template-renderer';

/**
 * Copia literal de las NUEVE filas sembradas en `notification_templates`: las
 * siete de `backend/sql/migrations/015_notificaciones.sql` (sección 4), con el
 * párrafo final tal y como lo dejó la 017 (`017_plantillas_respuesta.sql`), y
 * las dos del hilo de mensajes que sembró la 018
 * (`018_conversacion_adjuntos.sql`). No se importa el SQL ni se consulta la
 * base desde este test: es deliberado, para que el test compare dos fuentes
 * independientes -- el catálogo del renderizador y lo que de verdad quedó
 * sembrado -- y no se limite a comparar el catálogo contra sí mismo.
 *
 * Verificado contra la base real corriendo:
 *   docker exec kubo-mysql-dev mysql -uroot -proot -e "USE kubo_devdocs;
 *     SELECT trigger_key, audience, subject, body_md FROM
 *     notification_templates ORDER BY audience, trigger_key;"
 * el 2026-08-06, ya con la 018 aplicada: las nueve filas coinciden con lo que
 * hay abajo. El mismo recuento de 9 lo comprueba `.github/workflows/deploy.yml`
 * antes de reconstruir.
 *
 * Si alguien cambia el nombre de una variable en la migración (o en una
 * edición futura de estas plantillas) sin tocar `CLIENT_VARIABLES` /
 * `TEAM_VARIABLES` -- o al revés-- , una de las aserciones de este archivo
 * se pone en rojo.
 *
 * Las dos filas de la 018 entran aquí en el mismo cambio que las reglas que las
 * disparan (`notification-rules.ts`), y no antes: las tres pruebas de "las
 * claves cuadran" son bidireccionales, así que una plantilla sembrada sin regla
 * -- o una regla sin plantilla -- pone el archivo en rojo. Es exactamente lo
 * que se quiere.
 *
 * NINGUNA DE LAS DOS DEL HILO LLEVA EL TEXTO DEL MENSAJE, y eso también lo
 * vigila un test de este archivo: ver "el cuerpo del mensaje no viaja en el
 * correo" más abajo.
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
  {
    triggerKey: 'TICKET_MESSAGE_FROM_TEAM',
    audience: 'CLIENT',
    subject: '[{{codigo}}] Te respondimos: {{asunto}}',
    body: `Hola,

Te dejamos una respuesta en tu ticket **{{codigo}}** el {{fecha}}.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Empresa:** {{razon_social}}

Por seguridad no copiamos el mensaje aquí. Ábrelo en el portal para leerlo
completo y seguir la conversación:
{{enlace_portal}}

Este correo es automático. Si respondes, tu respuesta llega a un buzón que
leemos, pero **no se registra en el ticket ni avisa a nadie automáticamente**.
Escríbenos desde el portal: así queda en el ticket y lo ve todo el equipo.`,
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
  {
    triggerKey: 'TICKET_MESSAGE_FROM_CLIENT',
    audience: 'TEAM',
    subject: '[{{codigo}}] El cliente escribió en el ticket — {{razon_social}}',
    body: `{{razon_social}} dejó un mensaje nuevo el {{fecha}}.

- **Código:** {{codigo}}
- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Prioridad:** {{prioridad}}
- **Vence:** {{sla}}
- **Responsable:** {{responsable}}

El mensaje no va en este correo: léelo y contéstalo en el panel, que es donde
queda registrado y donde el cliente lo va a ver.
{{enlace_panel}}

Este correo es automático. Si respondes, tu respuesta llega al buzón del
remitente, pero **no se registra en el ticket ni avisa a nadie
automáticamente**: el cliente no la vería. Contesta desde el panel.`,
  },
];

/**
 * Todos los `triggerKey/audience` que `plansForEvent` puede llegar a emitir,
 * sacados a fuerza bruta de la propia función: cada tipo de evento, cada
 * estado destino posible (y ninguno), cada origen, cada visibilidad de mensaje
 * (y ninguna), cada clase de autor (y ninguna) y las dos combinaciones de
 * autor de cliente y responsable.
 *
 * Las dos dimensiones del final las añadió el hilo de mensajes: un
 * `MESSAGE_POSTED` lo escriben por igual una respuesta pública y una nota
 * interna, así que sin recorrerlas este barrido no encontraría nunca los dos
 * avisos del hilo y las pruebas bidireccionales de abajo dirían, en falso, que
 * hay dos plantillas sembradas que no se pueden disparar.
 *
 * A fuerza bruta y no leyendo constantes exportadas a propósito. Una lista de
 * claves exportada al lado de las reglas puede quedarse corta el día que se
 * añada un aviso y no se acuerde nadie de actualizarla; esto no puede, porque
 * pregunta por el comportamiento. Y no es caro: son unos pocos miles de
 * combinaciones de una función pura.
 */
function avisosQueLasReglasEmiten(): string[] {
  const encontrados = new Set<string>();
  const estados: Array<TicketStatus | null> = [null, ...TICKET_STATUSES];
  const visibilidades = [null, ...TICKET_MESSAGE_VISIBILITIES];
  const autores: Array<NotificationActorKind | null> = [null, 'CLIENT', 'TEAM'];

  for (const type of TICKET_EVENT_TYPES) {
    for (const toStatus of estados) {
      for (const origin of TICKET_ORIGINS) {
        for (const messageVisibility of visibilidades) {
          for (const actorKind of autores) {
            for (const hasClientAuthor of [true, false]) {
              for (const hasAssignee of [true, false]) {
                for (const entry of plansForEvent({
                  type,
                  toStatus,
                  origin,
                  hasClientAuthor,
                  hasAssignee,
                  messageVisibility,
                  actorKind,
                })) {
                  encontrados.add(`${entry.triggerKey}/${entry.audience}`);
                }
              }
            }
          }
        }
      }
    }
  }

  return [...encontrados].sort();
}

const AVISOS_SEMBRADOS = SEEDED_TEMPLATES.map((t) => `${t.triggerKey}/${t.audience}`).sort();

/**
 * La coherencia de las claves de disparo, que es lo que sostiene toda la
 * funcionalidad y no estaba atada por ningún lado.
 *
 * `notification-rules.ts` cita este archivo en su cabecera diciendo que las
 * nueve claves de abajo son las sembradas, y el despachador busca la
 * plantilla por esa clave: si no la encuentra, no manda nada **y no es un
 * error** —desactivar una plantilla es la forma documentada de apagar un
 * aviso—. Una errata en una clave, en cualquiera de los dos lados, apagaría un
 * aviso en silencio con la suite entera en verde.
 *
 * Se comprueba en los dos sentidos, porque las dos erratas existen: una clave
 * que las reglas emiten y nadie sembró es un aviso que no sale; una plantilla
 * sembrada que las reglas no pueden disparar nunca es una plantilla que un
 * ADMIN edita, prueba y no ve llegar jamás.
 */
describe('las claves de disparo cuadran con el módulo de reglas', () => {
  it('las reglas no emiten ningún aviso que no esté sembrado', () => {
    for (const aviso of avisosQueLasReglasEmiten()) {
      expect(AVISOS_SEMBRADOS).toContain(aviso);
    }
  });

  it('no hay plantilla sembrada que las reglas no puedan disparar nunca', () => {
    const emitidos = avisosQueLasReglasEmiten();
    for (const aviso of AVISOS_SEMBRADOS) {
      expect(emitidos).toContain(aviso);
    }
  });

  /** Y son exactamente los mismos nueve, ni uno más por ningún lado. */
  it('son los mismos nueve, uno a uno', () => {
    expect(avisosQueLasReglasEmiten()).toEqual(AVISOS_SEMBRADOS);
  });
});

describe('coherencia con las plantillas sembradas (migraciones 015 y 018)', () => {
  it('hay seis plantillas de cliente y tres de equipo, como en las migraciones', () => {
    expect(SEEDED_TEMPLATES.filter((t) => t.audience === 'CLIENT')).toHaveLength(6);
    expect(SEEDED_TEMPLATES.filter((t) => t.audience === 'TEAM')).toHaveLength(3);
  });

  /**
   * El recuento exacto que `.github/workflows/deploy.yml` comprueba antes de
   * reconstruir. Si alguien siembra una plantilla más y no sube ese número, el
   * despliegue se para en seco con la versión vieja sirviendo; esta aserción es
   * el aviso temprano, en la suite, de que hay que tocar el workflow.
   */
  it('son nueve en total, el número que el despliegue exige', () => {
    expect(SEEDED_TEMPLATES).toHaveLength(9);
  });

  /**
   * LA DECISIÓN SOBRE EL CUERPO DEL MENSAJE, ATADA POR UN TEST.
   *
   * El aviso del hilo dice **que hay un mensaje nuevo**; no lo reproduce. El
   * lector tiene que entrar al portal o al panel para leerlo. Las razones, por
   * orden de peso:
   *
   * 1. Un correo no se puede retirar, y el cuerpo lo escribe una persona que
   *    puede equivocarse. Un técnico que pega en el hilo el error de otro
   *    cliente y se da cuenta al segundo puede borrar el mensaje; no puede
   *    borrar el correo que ya salió de la bandeja del destinatario.
   * 2. El correo llega a una bandeja que no controlamos: se reenvía, se archiva
   *    y se indexa fuera del sistema. El hilo, en cambio, respeta la
   *    pertenencia por empresa y la sesión del portal en cada lectura.
   * 3. Sin copia dentro del correo, un mensaje editado o borrado después no
   *    deja versiones viejas circulando.
   *
   * Lo que se pierde -- leer la respuesta sin entrar -- es real, y por eso el
   * correo lleva el enlace directo al ticket. Se aceptó ese coste.
   *
   * El test lo ata por donde de verdad se rompería: el catálogo de variables no
   * tiene ninguna que traiga el texto del mensaje, así que una plantilla no
   * puede llevarlo aunque alguien lo intente. El día en que se añada una, esto
   * se pone en rojo y obliga a revisar la decisión en vez de heredarla.
   */
  describe('el cuerpo del mensaje no viaja en el correo', () => {
    it('no hay ninguna variable en el catálogo que traiga el texto de un mensaje', () => {
      const todas = [...CLIENT_VARIABLES, ...TEAM_VARIABLES];
      for (const variable of todas) {
        expect(variable).not.toMatch(/mensaje|cuerpo|body|texto|contenido/i);
      }
    });

    it.each(SEEDED_TEMPLATES.filter((t) => t.triggerKey.startsWith('TICKET_MESSAGE_')))(
      '$triggerKey ($audience): manda a leerlo al sitio que sí respeta los permisos',
      ({ audience, body }) => {
        expect(body).toMatch(audience === 'CLIENT' ? /Ábrelo en el portal/ : /en el panel/);
      },
    );

    it('son dos: una por público, y ninguna más', () => {
      const delHilo = SEEDED_TEMPLATES.filter((t) => t.triggerKey.startsWith('TICKET_MESSAGE_'));
      expect(delHilo.map((t) => `${t.triggerKey}/${t.audience}`).sort()).toEqual([
        'TICKET_MESSAGE_FROM_CLIENT/TEAM',
        'TICKET_MESSAGE_FROM_TEAM/CLIENT',
      ]);
    });
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

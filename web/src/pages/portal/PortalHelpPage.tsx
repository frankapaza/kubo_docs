import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import {
  PORTAL_TICKET_DESCRIPTION_MAX_LENGTH,
  PORTAL_TICKET_SUBJECT_MAX_LENGTH,
} from '../../api/portal.api';
import type { PortalTicketEventType, TicketStatus } from '../../api/types';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ArrowLeftIcon, CheckIcon, InfoIcon, XIcon } from '../../components/ui/Icon';
import { STATUS_LABELS } from '../tickets/ticket-ui';
import { STATUS_TONES } from './PortalTicketsListPage';

/**
 * Manual del usuario de cliente. Página de solo lectura: no llama a la API ni
 * guarda estado, así que se puede abrir con la sesión recién iniciada y sin
 * ningún ticket creado todavía.
 *
 * Todo lo que se afirma aquí está sacado del código, no de lo que sería
 * razonable que hiciera una mesa de servicio:
 *  - los estados y sus etiquetas salen de `STATUS_LABELS` (espejo de
 *    `TicketStatus` en el backend), así que renombrar uno actualiza el manual;
 *  - los tipos de evento son los ocho de `PortalTicketEventType`, que refleja
 *    la lista blanca `CLIENT_VISIBLE_EVENT_TYPES` de
 *    `backend/src/modules/portal/portal-tickets.service.ts`;
 *  - los topes de caracteres son las constantes que ya usa el formulario de
 *    alta, que a su vez son las de `CreatePortalTicketDto`.
 *
 * Los tres `Record` de abajo están tipados por la unión completa: si el
 * backend añade un estado o publica un evento nuevo, esto deja de compilar y
 * alguien tiene que escribir su explicación en vez de dejar un hueco.
 */

interface Section {
  id: string;
  title: string;
}

const SECTIONS: Section[] = [
  { id: 'que-es', title: 'Qué es este portal' },
  { id: 'ingresar', title: 'Cómo entrar' },
  { id: 'crear-ticket', title: 'Cómo pedir atención' },
  { id: 'como-escribir', title: 'Cómo describir tu problema' },
  { id: 'estados', title: 'Qué significa cada estado' },
  { id: 'historial', title: 'Qué verás en el historial' },
  { id: 'urgente', title: 'Si el asunto es urgente' },
  { id: 'limites', title: 'Lo que todavía no se puede hacer' },
];

/** Qué significa cada estado para quien pidió la atención, no para nosotros. */
const STATUS_MEANING: Record<TicketStatus, string> = {
  NUEVO: 'Lo recibimos. Está en la cola, todavía nadie lo revisó.',
  TRIAJE: 'Lo estamos leyendo y clasificando para saber a quién le toca.',
  ASIGNADO: 'Ya tiene una persona responsable, pero aún no empieza a trabajarlo.',
  EN_ATENCION: 'Alguien está trabajando en tu caso ahora mismo.',
  ESPERA_CLIENTE:
    'Necesitamos algo de tu lado (un dato, una confirmación, un acceso) y estamos esperándolo. Mientras esté así, el caso está detenido de nuestro lado.',
  DERIVADO: 'Pasó a un equipo más especializado porque no se resolvía en el primer nivel.',
  RESUELTO: 'Lo dimos por solucionado. Si sigue pasando, avísanos.',
  CERRADO: 'El caso terminó. Ya no se mueve más.',
};

/** Los ocho eventos que el portal publica, explicados. */
const EVENT_MEANING: Record<PortalTicketEventType, string> = {
  CREATED: 'El momento exacto en que se registró tu solicitud.',
  TRIAGED: 'Terminamos de leerla y clasificarla.',
  STATUS_CHANGED: 'El caso cambió de estado. Debajo verás de cuál a cuál.',
  TAKEN: 'Un técnico lo tomó y empezó a trabajarlo.',
  ESCALATED: 'Lo pasamos a un equipo más especializado.',
  RESOLVED: 'Lo dimos por solucionado.',
  REOPENED: 'Lo volvimos a abrir porque la solución no fue suficiente.',
  CLOSED: 'El caso se cerró.',
};

/**
 * Mismas etiquetas que pinta `PortalTicketDetailPage` para cada evento. Se
 * repiten aquí en vez de importarse porque allí son un detalle interno de esa
 * página; lo que importa es que digan lo mismo, y el `Record` tipado sobre la
 * unión completa obliga a cubrir cualquier evento nuevo en los dos sitios.
 */
const PORTAL_EVENT_LABELS: Record<PortalTicketEventType, string> = {
  CREATED: 'Ticket creado',
  TRIAGED: 'Triaje realizado',
  STATUS_CHANGED: 'Cambio de estado',
  TAKEN: 'Tomado por soporte',
  ESCALATED: 'Derivado',
  RESOLVED: 'Resuelto',
  REOPENED: 'Reabierto',
  CLOSED: 'Cerrado',
};

/** Orden de lectura del historial: el mismo del ciclo de vida, no el del enum. */
const EVENT_ORDER: PortalTicketEventType[] = [
  'CREATED',
  'TRIAGED',
  'TAKEN',
  'STATUS_CHANGED',
  'ESCALATED',
  'RESOLVED',
  'REOPENED',
  'CLOSED',
];

const STATUS_ORDER: TicketStatus[] = [
  'NUEVO',
  'TRIAJE',
  'ASIGNADO',
  'EN_ATENCION',
  'ESPERA_CLIENTE',
  'DERIVADO',
  'RESUELTO',
  'CERRADO',
];

export default function PortalHelpPage() {
  return (
    <div className="space-y-6">
      <Link
        to="/portal/tickets"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition"
      >
        <ArrowLeftIcon size={14} />
        Volver a mis tickets
      </Link>

      <div>
        <h1 className="text-xl font-bold text-slate-900">Guía de ayuda</h1>
        <p className="text-sm text-slate-500 mt-1">
          Cómo pedir soporte y qué esperar después. Se lee en cinco minutos.
        </p>
      </div>

      {/*
        `nav` a propósito: la hoja de impresión global (web/src/index.css)
        oculta `nav`, `header` y `aside`, así que el índice no ensucia el papel.
      */}
      <nav aria-label="Secciones de la guía">
        <Card>
          <CardBody>
            <ol className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-sm">
              {SECTIONS.map((s, i) => (
                <li key={s.id} className="flex gap-2">
                  <span className="text-slate-400 tabular-nums">{i + 1}.</span>
                  <a
                    href={`#${s.id}`}
                    className="text-kubo-primary hover:text-kubo-primary-dark hover:underline"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </nav>

      <HelpSection id="que-es" title="Qué es este portal">
        <p>
          Es el canal directo para pedirnos soporte sobre los sistemas que tu empresa tiene con
          nosotros. Desde aquí registras tu solicitud y sigues su avance sin tener que llamar ni
          preguntar por dónde va.
        </p>
        <p>
          Cada solicitud se convierte en un <strong>ticket</strong> con un código propio (por
          ejemplo <Code>KB-0042</Code>). Ese código es la referencia para hablar de tu caso: úsalo
          cuando nos escribas por cualquier otro canal.
        </p>
        <p>
          Solo ves los tickets de tu empresa. Los de otras empresas no existen para ti, ni siquiera
          probando con otro número en la dirección.
        </p>
      </HelpSection>

      <HelpSection id="ingresar" title="Cómo entrar">
        <p>
          Entras con tu correo y tu contraseña en <Code>/portal/login</Code>. La cuenta te la
          creamos nosotros.
        </p>

        <Note tone="info" title="No hay registro por tu cuenta">
          En esta pantalla no existe un botón de «Crear cuenta». Si necesitas acceso —tú o alguien
          más de tu equipo—, pídeselo a tu contacto habitual con nosotros: le damos de alta el
          correo y le entregamos una contraseña inicial.
        </Note>

        <Note tone="warning" title="Si olvidaste tu contraseña">
          Tampoco hay un enlace de «Olvidé mi contraseña»: hoy no puedes restablecerla tú. Escríbenos
          y te generamos una nueva. Es el único camino, así que no pierdas tiempo buscando el enlace.
        </Note>

        <p>
          Si el correo o la contraseña no cuadran, el mensaje es siempre el mismo:{' '}
          <em>«Correo o contraseña incorrectos»</em>. No te dice cuál de los dos falló, y es a
          propósito: así nadie puede averiguar desde fuera qué correos tienen cuenta.
        </p>
        <p>
          Después de varios intentos fallidos seguidos, el sistema deja de aceptar intentos desde tu
          conexión durante un rato. Si te pasa, espera un minuto antes de volver a probar en vez de
          insistir.
        </p>
        <p>
          La sesión se renueva sola mientras uses el portal. Si lo dejas abierto muchos días sin
          entrar, te pedirá la contraseña de nuevo.
        </p>
      </HelpSection>

      <HelpSection id="crear-ticket" title="Cómo pedir atención">
        <p>
          En <strong>Mis tickets</strong>, pulsa <strong>Nuevo ticket</strong>. El formulario tiene
          tres campos y nada más:
        </p>

        <dl className="space-y-3">
          <FieldDoc
            name="Asunto"
            required
            hint={`Hasta ${PORTAL_TICKET_SUBJECT_MAX_LENGTH} caracteres`}
          >
            Una línea que resuma el problema. Se lee en la bandeja antes que nada, así que aquí es
            donde ganas o pierdes minutos de atención.
          </FieldDoc>
          <FieldDoc
            name="Descripción"
            required
            hint={`Hasta ${PORTAL_TICKET_DESCRIPTION_MAX_LENGTH.toLocaleString('es-PE')} caracteres`}
          >
            El detalle completo. Tienes espacio de sobra: úsalo.
          </FieldDoc>
          <FieldDoc name="Sistema" hint="Opcional, pero conviene">
            La lista de los sistemas que tu empresa tiene con nosotros. Elegir el correcto hace que
            tu ticket llegue antes a quien conoce ese sistema. Si no lo eliges, alguien tiene que
            deducirlo, y eso demora. Si la lista sale vacía, no pasa nada: crea el ticket igual y
            menciona el sistema en la descripción.
          </FieldDoc>
        </dl>

        <p>
          Al crearlo te lleva directo al detalle del ticket, con su código ya asignado. Desde ese
          momento el caso está en nuestra cola.
        </p>
      </HelpSection>

      <HelpSection id="como-escribir" title="Cómo describir tu problema">
        <p>
          Esta es la parte que más rinde. Quien lee tu ticket no estaba sentado a tu lado: solo tiene
          lo que escribiste. Una descripción completa se atiende hoy; una descripción vaga arranca
          con un ida y vuelta de preguntas que puede costar un día entero.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <ExampleCard tone="bad" title="Poco útil">
            <p className="italic">«El sistema no funciona. Urgente.»</p>
            <p className="mt-3 text-slate-500">
              No sabemos qué sistema, qué pantalla, qué hiciste, qué salió, desde cuándo, ni a
              cuántas personas afecta. Lo primero que recibirás es una pregunta, no una solución.
            </p>
          </ExampleCard>

          <ExampleCard tone="good" title="Útil">
            <p className="italic">
              «Desde hoy 9:15 a. m., al guardar una factura en Facturación → Nueva factura, sale el
              mensaje "Error al registrar el comprobante" y no se graba nada. Pasa con cualquier
              cliente y desde dos computadoras distintas. Ayer funcionaba normal. Ejemplo:
              F001-00234. Somos 4 personas de facturación sin poder emitir; no tenemos forma de
              seguir.»
            </p>
            <p className="mt-3 text-slate-500">
              Con esto se puede reproducir el problema y dimensionarlo sin preguntarte nada.
            </p>
          </ExampleCard>
        </div>

        <p className="font-medium text-slate-900">Antes de enviar, revisa que esté todo esto:</p>
        <ul className="space-y-1.5">
          {[
            'Qué estabas haciendo: el módulo y la pantalla exactos.',
            'Qué esperabas que pasara y qué pasó en su lugar.',
            'El mensaje de error, copiado tal cual (o una captura descrita en palabras).',
            'Desde cuándo ocurre y si antes funcionaba.',
            'Si le pasa a todos o solo a ti, y en cuántas computadoras probaste.',
            'A cuántas personas está frenando y si tienen alguna forma de seguir trabajando.',
            'Un ejemplo concreto: número de documento, código de cliente, fecha del registro.',
          ].map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-0.5 text-emerald-600 flex-shrink-0">
                <CheckIcon size={15} />
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <Note tone="info" title="Un problema, un ticket">
          Si tienes tres cosas distintas, crea tres tickets. Cada uno va a una persona distinta y se
          cierra por separado; los tres juntos en uno solo avanzan al ritmo del más lento.
        </Note>
      </HelpSection>

      <HelpSection id="estados" title="Qué significa cada estado">
        <p>
          El estado te dice en qué punto va tu caso. Lo ves en la lista y arriba del detalle. Estos
          son todos los que existen:
        </p>

        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                <th className="py-2 pr-4">Estado</th>
                <th className="py-2">Qué quiere decir</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {STATUS_ORDER.map((s) => (
                <tr key={s}>
                  <td className="py-3 pr-4 whitespace-nowrap">
                    <Badge tone={STATUS_TONES[s]} dot>
                      {STATUS_LABELS[s]}
                    </Badge>
                  </td>
                  <td className="py-3 text-slate-600">{STATUS_MEANING[s]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Note tone="warning" title="Ojo con «Espera cliente»">
          Ese estado significa que la pelota está de tu lado. Mientras siga así, no estamos
          avanzando: respóndenos por el canal por el que te contactamos y el caso se reactiva.
        </Note>

        <p>
          El orden no siempre es el de la tabla. Un ticket puede volver de <strong>Resuelto</strong>{' '}
          a <strong>En atención</strong> si la solución no alcanzó, y puede cerrarse desde casi
          cualquier punto. <strong>Cerrado</strong> sí es el final: de ahí no se mueve.
        </p>
      </HelpSection>

      <HelpSection id="historial" title="Qué verás en el historial">
        <p>
          En el detalle de cada ticket, debajo de la descripción, está el <strong>Historial</strong>:
          la lista con fecha y hora de todo lo que le fue pasando. Estos son los movimientos que
          aparecen:
        </p>

        <dl className="space-y-2">
          {EVENT_ORDER.map((e) => (
            <div key={e} className="sm:flex sm:gap-3">
              <dt className="font-medium text-slate-900 sm:w-48 sm:flex-shrink-0">
                {PORTAL_EVENT_LABELS[e]}
              </dt>
              <dd className="text-slate-600">{EVENT_MEANING[e]}</dd>
            </div>
          ))}
        </dl>

        <p className="font-medium text-slate-900">Qué no vas a ver ahí, y no es un error:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
          <li>
            <strong>Los motivos internos.</strong> Cuando derivamos o cerramos un caso, quien lo hace
            deja anotado por qué. Esa nota es para el equipo y no se publica aquí.
          </li>
          <li>
            <strong>Quién lo está atendiendo.</strong> El nombre del técnico no se muestra.
          </li>
          <li>
            <strong>Prioridades y plazos.</strong> Clasificamos cada ticket y le ponemos un reloj
            interno, pero eso no aparece en el portal.
          </li>
          <li>
            <strong>Notas y comentarios internos.</strong> Nada de lo que el equipo escribe entre sí
            llega a esta pantalla.
          </li>
        </ul>

        <Note tone="warning" title="El portal no te avisa por correo">
          Hoy no se envía ningún correo ni notificación cuando tu ticket cambia de estado. Para saber
          cómo va, entra al portal y actualiza la página. Si necesitamos algo de ti, te buscamos por
          el canal de siempre.
        </Note>
      </HelpSection>

      <HelpSection id="urgente" title="Si el asunto es urgente">
        <p>
          El formulario no tiene casilla de prioridad, y no es un descuido: la prioridad la decidimos
          nosotros al clasificar el ticket, cruzando cuánto daño hace el problema con qué tan rápido
          hay que resolverlo. Poner «URGENTE» en mayúsculas en el asunto no cambia ese cálculo.
        </p>
        <p className="font-medium text-slate-900">
          Lo que sí lo cambia es que describas el impacto real:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
          <li>
            <strong>A cuánta gente frena.</strong> «No puedo yo» y «no puede toda el área de
            almacén» son casos muy distintos.
          </li>
          <li>
            <strong>Si hay manera de seguir trabajando.</strong> Un problema con salida provisional
            pesa menos que uno que deja todo detenido.
          </li>
          <li>
            <strong>Qué se pierde si espera.</strong> Facturación caída un día de cierre no es lo
            mismo que un reporte que se ve raro.
          </li>
          <li>
            <strong>Si hay una fecha de por medio.</strong> Un vencimiento, una entrega, una
            inspección: dilo con la fecha.
          </li>
        </ul>
        <p>
          Escribe eso en la descripción, en una frase, y quien clasifica el ticket tendrá lo que
          necesita para ponerlo donde corresponde.
        </p>
        <Note tone="info" title="Si algo está caído del todo">
          Crea igual el ticket —es lo que deja constancia y arranca el reloj— y avísanos además por
          el canal directo que tengas con nosotros, mencionando el código del ticket.
        </Note>
      </HelpSection>

      <HelpSection id="limites" title="Lo que todavía no se puede hacer">
        <p>
          Para que no pierdas tiempo buscando un botón que no existe, esto es lo que hoy{' '}
          <strong>no</strong> hace el portal:
        </p>
        <ul className="list-disc pl-5 space-y-1.5 text-slate-600">
          <li>
            <strong>No puedes responder ni comentar</strong> dentro del ticket. Una vez creado, el
            texto no se edita y no hay caja de mensajes. Si tienes que agregar información, escríbenos
            por tu canal habitual con el código del ticket.
          </li>
          <li>
            <strong>No puedes adjuntar archivos ni capturas.</strong> Describe el error con palabras y
            envíanos la captura por el canal de siempre.
          </li>
          <li>
            <strong>No puedes cerrar, cancelar ni reabrir un ticket.</strong> Esas acciones las hace
            el equipo. Si un caso resuelto sigue fallando, pídenos que lo reabramos.
          </li>
          <li>
            <strong>No hay avisos por correo</strong> de ningún cambio.
          </li>
          <li>
            <strong>No hay recuperación de contraseña</strong> por tu cuenta, ni registro de nuevos
            usuarios.
          </li>
          <li>
            <strong>No hay buscador ni filtros</strong> en la lista de tickets: salen todos, del más
            nuevo al más antiguo.
          </li>
        </ul>
        <p>
          Si algo de esto te hace falta a menudo, dínoslo: son cosas que se pueden priorizar para más
          adelante.
        </p>
      </HelpSection>

      <p className="text-xs text-slate-400">
        ¿Algo de esta guía no coincide con lo que ves en pantalla? Avísanos y lo corregimos.
      </p>
    </div>
  );
}

function HelpSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <Card>
        <CardHeader title={title} />
        <CardBody className="space-y-4 text-sm leading-relaxed text-slate-700">{children}</CardBody>
      </Card>
    </section>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
      {children}
    </code>
  );
}

function FieldDoc({
  name,
  required = false,
  hint,
  children,
}: {
  name: string;
  required?: boolean;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-slate-900">{name}</span>
        {required && <span className="text-xs font-medium text-red-600">obligatorio</span>}
        <span className="text-xs text-slate-400">{hint}</span>
      </dt>
      <dd className="mt-0.5 text-slate-600">{children}</dd>
    </div>
  );
}

function Note({
  tone,
  title,
  children,
}: {
  tone: 'info' | 'warning';
  title: string;
  children: ReactNode;
}) {
  const styles =
    tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-sky-200 bg-sky-50 text-sky-900';
  return (
    <div className={`flex gap-3 rounded-lg border px-3.5 py-3 ${styles}`}>
      <span className="mt-0.5 flex-shrink-0" aria-hidden>
        <InfoIcon size={16} />
      </span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 opacity-90">{children}</p>
      </div>
    </div>
  );
}

function ExampleCard({
  tone,
  title,
  children,
}: {
  tone: 'good' | 'bad';
  title: string;
  children: ReactNode;
}) {
  const good = tone === 'good';
  return (
    <div
      className={`rounded-lg border p-4 ${
        good ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'
      }`}
    >
      <p
        className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${
          good ? 'text-emerald-700' : 'text-red-700'
        }`}
      >
        <span aria-hidden>{good ? <CheckIcon size={14} /> : <XIcon size={14} />}</span>
        {title}
      </p>
      <div className="mt-2 text-slate-700">{children}</div>
    </div>
  );
}

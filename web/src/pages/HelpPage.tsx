import type { ReactNode } from 'react';

import type {
  TicketImpact,
  TicketPriority,
  TicketStatus,
  TicketUrgency,
  UserRole,
} from '../api/types';
import { Badge, roleLabels } from '../components/ui/Badge';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { InfoIcon } from '../components/ui/Icon';
import { STATUS_LABELS, TICKET_IMPACTS, TICKET_URGENCIES, previewPriority } from './tickets/ticket-ui';

/**
 * Manual del equipo interno. Página de solo lectura: no llama a la API ni
 * guarda estado.
 *
 * Todo lo que se afirma aquí sale del código de hoy. Donde la fuente es una
 * constante que el frontend ya tiene, se usa esa constante en vez de copiar
 * el valor a mano:
 *  - los estados y sus etiquetas, de `STATUS_LABELS`;
 *  - la matriz de prioridad, de `previewPriority`, que es el espejo declarado
 *    de `domain/ticket-priority.ts#derivePriority`. La tabla de esta página se
 *    calcula llamándolo, así que no puede divergir de lo que el formulario de
 *    alta previsualiza.
 *
 * Lo que sí está transcrito (transiciones, plazos de SLA, umbral de riesgo,
 * roles) vive solo en el backend y no es importable desde aquí; cada bloque
 * apunta al fichero del que salió para poder cotejarlo.
 */

interface Section {
  id: string;
  title: string;
}

const SECTIONS: Section[] = [
  { id: 'que-es', title: 'Qué es la mesa de servicio' },
  { id: 'ciclo', title: 'El recorrido de un ticket' },
  { id: 'transiciones', title: 'Transiciones y motivos' },
  { id: 'prioridad', title: 'Cómo se decide la prioridad' },
  { id: 'sla', title: 'El reloj de SLA' },
  { id: 'triaje', title: 'El triaje con IA' },
  { id: 'primer-ticket', title: 'Tu primer ticket, paso a paso' },
  { id: 'portal', title: 'Qué ve el cliente en su portal' },
  { id: 'roles', title: 'Qué puede hacer cada rol' },
  { id: 'limites', title: 'Límites conocidos' },
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

/**
 * Copia literal de `TRANSITIONS` en
 * backend/src/modules/tickets/domain/ticket-state-machine.ts. El `Record`
 * sobre `TicketStatus` obliga a cubrir los ocho estados.
 */
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NUEVO: ['TRIAJE', 'ASIGNADO', 'CERRADO'],
  TRIAJE: ['ASIGNADO', 'CERRADO'],
  ASIGNADO: ['EN_ATENCION', 'DERIVADO', 'CERRADO'],
  EN_ATENCION: ['ESPERA_CLIENTE', 'DERIVADO', 'RESUELTO', 'CERRADO'],
  ESPERA_CLIENTE: ['EN_ATENCION', 'RESUELTO', 'CERRADO'],
  DERIVADO: ['EN_ATENCION', 'CERRADO'],
  RESUELTO: ['CERRADO', 'EN_ATENCION'],
  CERRADO: [],
};

/**
 * Espejo de `requiresReason(from, to)` del mismo fichero: derivar siempre,
 * cerrar sin haber resuelto (cancelación) y reabrir un resuelto.
 */
function requiresReason(from: TicketStatus, to: TicketStatus): boolean {
  const isCancellation = to === 'CERRADO' && from !== 'RESUELTO';
  const isReopen = from === 'RESUELTO' && to === 'EN_ATENCION';
  return to === 'DERIVADO' || isCancellation || isReopen;
}

/** Matriz de SLA por defecto: DEFAULT_SLA_MATRIX en domain/sla.calculator.ts. */
const SLA_MATRIX: Record<TicketPriority, { response: number; resolution: number }> = {
  P1: { response: 15, resolution: 240 },
  P2: { response: 30, resolution: 360 },
  P3: { response: 60, resolution: 720 },
  P4: { response: 240, resolution: 1440 },
};

const PRIORITY_ORDER: TicketPriority[] = ['P1', 'P2', 'P3', 'P4'];

/** AT_RISK_THRESHOLD = 0.7 en domain/sla.calculator.ts. */
const AT_RISK_PERCENT = 70;

function minutesLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`;
}

export default function HelpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Manual del equipo</h1>
        <p className="text-sm text-slate-500 mt-1">
          Cómo funciona la mesa de servicio por dentro. Con esto deberías poder atender tu primer
          ticket.
        </p>
      </div>

      {/*
        `nav` a propósito: la hoja de impresión global (web/src/index.css)
        oculta `nav`, `header` y `aside`, así que el índice no sale en papel.
      */}
      <nav aria-label="Secciones del manual">
        <Card>
          <CardBody>
            <ol className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3 text-sm">
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

      <HelpSection id="que-es" title="Qué es la mesa de servicio">
        <p>
          Todo lo que un cliente nos pide entra como <strong>ticket</strong>. Lo ves en{' '}
          <strong>Tickets</strong>, en el menú de la izquierda: esa es la bandeja.
        </p>
        <p>
          Un ticket puede nacer de siete sitios (campo <Code>origin</Code>): correo, WhatsApp en
          texto, WhatsApp en audio, dictado en vivo, una reunión, una nota rápida que escribe alguien
          del equipo, o el <strong>portal del cliente</strong>. Los del portal los escribe la persona
          de la empresa cliente y son los únicos que ella puede seguir después.
        </p>
        <p>
          Al crearse, el ticket recibe un código legible <Code>KB-0001</Code>, arranca en el estado{' '}
          <strong>{STATUS_LABELS.NUEVO}</strong> y se le calculan los plazos de SLA. Todo movimiento
          posterior queda escrito en el historial, que es solo de escritura: no se edita ni se borra
          nunca. Es la evidencia auditable del caso.
        </p>
      </HelpSection>

      <HelpSection id="ciclo" title="El recorrido de un ticket">
        <p>
          El camino normal es el de la fila de arriba. Las dos cajas de abajo son desvíos por los que
          se pasa cuando hace falta, y se vuelve.
        </p>

        <StateDiagram />

        <ul className="list-disc pl-5 space-y-1.5 text-slate-600">
          <li>
            <strong>{STATUS_LABELS.ESPERA_CLIENTE}</strong> es el único estado que{' '}
            <strong>detiene el reloj</strong>. Úsalo cuando de verdad estás bloqueado esperando algo
            del cliente, no para «apartar» un ticket incómodo.
          </li>
          <li>
            <strong>{STATUS_LABELS.DERIVADO}</strong> exige motivo y nivel destino. El reloj{' '}
            <strong>no</strong> se reinicia al derivar.
          </li>
          <li>
            <strong>{STATUS_LABELS.RESUELTO}</strong> puede volver a{' '}
            <strong>{STATUS_LABELS.EN_ATENCION}</strong>: eso es una reapertura y también exige
            motivo.
          </li>
          <li>
            <strong>{STATUS_LABELS.CERRADO}</strong> es terminal. Desde ahí no hay ninguna transición
            válida y el ticket tampoco admite modificaciones.
          </li>
        </ul>
      </HelpSection>

      <HelpSection id="transiciones" title="Transiciones y motivos">
        <p>
          Esta es la tabla completa, tal como está en{' '}
          <Code>domain/ticket-state-machine.ts</Code>. Cualquier salto que no aparezca aquí lo
          rechaza el backend con <Code>INVALID_TRANSITION</Code>, aunque la pantalla te dejara
          intentarlo.
        </p>

        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                <th className="py-2 pr-4">Desde</th>
                <th className="py-2">Puede pasar a</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {STATUS_ORDER.map((from) => (
                <tr key={from}>
                  <td className="py-3 pr-4 whitespace-nowrap font-medium text-slate-900">
                    {STATUS_LABELS[from]}
                  </td>
                  <td className="py-3">
                    {TRANSITIONS[from].length === 0 ? (
                      <span className="text-slate-400">
                        Ninguna. Es el estado final del ticket.
                      </span>
                    ) : (
                      <ul className="flex flex-wrap gap-x-4 gap-y-1">
                        {TRANSITIONS[from].map((to) => (
                          <li key={to} className="flex items-center gap-1.5">
                            <span className="text-slate-700">{STATUS_LABELS[to]}</span>
                            {requiresReason(from, to) && (
                              <Badge tone="warning">motivo obligatorio</Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="font-medium text-slate-900">Las tres transiciones que exigen motivo:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
          <li>
            <strong>Cualquiera hacia {STATUS_LABELS.DERIVADO}.</strong> Si no dices por qué derivas,
            quien lo recibe empieza de cero.
          </li>
          <li>
            <strong>Cerrar sin haber resuelto</strong> (desde cualquier estado que no sea{' '}
            {STATUS_LABELS.RESUELTO}). Eso es una cancelación y tiene que quedar constancia. Cerrar
            desde {STATUS_LABELS.RESUELTO} es el cierre normal y no pide motivo.
          </li>
          <li>
            <strong>Reabrir</strong> ({STATUS_LABELS.RESUELTO} → {STATUS_LABELS.EN_ATENCION}).
          </li>
        </ul>

        <Note tone="warning" title="Resolver pide evidencia, no motivo">
          Pasar a {STATUS_LABELS.RESUELTO} exige los tres campos del diálogo{' '}
          <strong>Resolver</strong>: solución aplicada, causa raíz y acción correctiva. Si falta
          alguno, el backend responde 400. Al reabrir, ese texto se conserva —solo se limpia la fecha
          de resolución— para que lo corrijas en vez de reescribirlo.
        </Note>
      </HelpSection>

      <HelpSection id="prioridad" title="Cómo se decide la prioridad">
        <p>
          La prioridad no se elige: se deriva de cruzar <strong>impacto</strong> con{' '}
          <strong>urgencia</strong>. Esta es la matriz exacta:
        </p>

        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full min-w-[26rem] text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="py-2 pr-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Impacto \ Urgencia
                </th>
                {TICKET_URGENCIES.map((u: TicketUrgency) => (
                  <th
                    key={u}
                    className="py-2 px-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider"
                  >
                    {u}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TICKET_IMPACTS.map((i: TicketImpact) => (
                <tr key={i}>
                  <td className="py-2 pr-4 text-xs font-semibold text-slate-500 uppercase tracking-wider border-t border-slate-100">
                    {i}
                  </td>
                  {TICKET_URGENCIES.map((u: TicketUrgency) => (
                    <td key={u} className="py-2 px-3 text-center border-t border-slate-100">
                      <span className="inline-block rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold text-slate-700">
                        {previewPriority(i, u)}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="list-disc pl-5 space-y-1 text-slate-600">
          <li>
            <strong>Impacto</strong>: ALTO si el servicio está caído o afecta a varias sedes o
            usuarios; MEDIO si degrada el trabajo pero hay alternativa; BAJO si es cosmético o
            aislado.
          </li>
          <li>
            <strong>Urgencia</strong>: ALTA si bloquea la operación ahora; MEDIA si aguanta horas;
            BAJA si aguanta días.
          </li>
          <li>
            Si falta impacto o urgencia —el caso de todo ticket recién creado sin triar—, la
            prioridad es <strong>P3</strong> por defecto.
          </li>
        </ul>

        <p>
          Con <strong>Ajustar prioridad</strong> puedes cambiar impacto y urgencia (y la matriz
          recalcula), o fijar la prioridad a mano. Fijarla a mano marca el ticket como{' '}
          <Code>priorityOverridden</Code>: <strong>a partir de ahí la matriz deja de recalcular</strong>,
          y un triaje posterior ya no tocará ni la prioridad ni los plazos de SLA. El motivo es
          obligatorio y queda en el historial.
        </p>
      </HelpSection>

      <HelpSection id="sla" title="El reloj de SLA">
        <p>
          Cada ticket lleva dos vencimientos absolutos calculados al crearse: uno de{' '}
          <strong>primera respuesta</strong> y otro de <strong>resolución</strong>. Salen de la
          política de SLA del cliente; si no tiene una asignada, la marcada por defecto; y si no hay
          ninguna en base de datos, esta matriz embebida:
        </p>

        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                <th className="py-2 pr-4">Prioridad</th>
                <th className="py-2 pr-4">Primera respuesta</th>
                <th className="py-2">Resolución</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {PRIORITY_ORDER.map((p) => (
                <tr key={p}>
                  <td className="py-2.5 pr-4 font-mono font-semibold text-slate-900">{p}</td>
                  <td className="py-2.5 pr-4 text-slate-600">
                    {minutesLabel(SLA_MATRIX[p].response)}
                  </td>
                  <td className="py-2.5 text-slate-600">
                    {minutesLabel(SLA_MATRIX[p].resolution)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="space-y-3">
          <Fact term="Cuándo arranca">
            En el momento en que se crea el ticket, con la prioridad que tenga entonces (P3 si aún no
            hay impacto ni urgencia). El triaje recalcula los dos vencimientos con la prioridad nueva,
            salvo que alguien ya la haya fijado a mano.
          </Fact>
          <Fact term="Qué cuenta como primera respuesta">
            La primera vez que el ticket entra en {STATUS_LABELS.EN_ATENCION}. Ese instante se graba
            en <Code>firstResponseAt</Code> y no se vuelve a tocar.
          </Fact>
          <Fact term="Cuándo se detiene">
            Solo en {STATUS_LABELS.ESPERA_CLIENTE}. Al salir de ahí, los dos vencimientos se{' '}
            <strong>desplazan</strong> por lo que duró la pausa: no se recalculan desde cero, se
            corren hacia adelante. La etiqueta del reloj mientras tanto es «en pausa».
          </Fact>
          <Fact term="Cuándo se considera en riesgo">
            Al consumir el <strong>{AT_RISK_PERCENT}%</strong> del plazo de resolución, descontando el
            tiempo en pausa. Un job que corre <strong>cada 5 minutos</strong> marca el ticket, escribe
            un evento <Code>SLA_AT_RISK</Code> en el historial y lo hace aparecer bajo el filtro «SLA
            en riesgo» de la bandeja. Es idempotente: se marca una sola vez por ticket.
          </Fact>
          <Fact term="Qué pasa al vencer">
            La etiqueta del reloj pasa a «vencido» y la barra se pone en rojo, y eso es todo. No hay
            escalado automático, ni correo, ni evento en el historial: el vencimiento se calcula al
            leer el ticket, no lo dispara nada. Si un ticket vence, alguien tiene que verlo en la
            bandeja.
          </Fact>
          <Fact term="Horario">
            Horas corridas, 24×7. No hay calendario laboral ni horario de cobertura: un ticket P1
            creado un viernes a las 6 de la tarde vence el mismo viernes a las 10 de la noche.
          </Fact>
        </dl>

        <p>
          Las otras etiquetas del reloj que verás: <strong>«sin SLA»</strong> (el ticket no tiene
          fecha de resolución) y <strong>«cumplido»</strong> (ya está {STATUS_LABELS.RESUELTO} o{' '}
          {STATUS_LABELS.CERRADO}).
        </p>
      </HelpSection>

      <HelpSection id="triaje" title="El triaje con IA">
        <p>
          El botón <strong>Triaje IA</strong> del detalle manda el texto crudo del ticket a un modelo
          y usa lo que devuelve para rellenar la ficha. Sirve para no clasificar a mano cincuenta
          correos, no para decidir por ti.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <MiniCard title="Qué rellena" tone="neutral">
            <ul className="list-disc pl-4 space-y-1">
              <li>Tipo de solicitud y categoría de servicio</li>
              <li>Impacto y urgencia</li>
              <li>Módulo, pantalla y flujo</li>
              <li>Asunto y descripción en markdown</li>
              <li>Criterios de aceptación y etiquetas</li>
              <li>Su propia confianza, visible en el historial</li>
            </ul>
          </MiniCard>
          <MiniCard title="Qué NO decide" tone="warning">
            <ul className="list-disc pl-4 space-y-1">
              <li>
                <strong>La prioridad.</strong> Se le pide impacto y urgencia; la prioridad la saca la
                matriz, no el modelo.
              </li>
              <li>
                <strong>A quién se asigna.</strong> El triaje no toca el responsable.
              </li>
              <li>
                <strong>Si se resuelve o se cierra.</strong> Solo mueve{' '}
                {STATUS_LABELS.NUEVO} → {STATUS_LABELS.TRIAJE}, y únicamente si el ticket seguía en{' '}
                {STATUS_LABELS.NUEVO}.
              </li>
            </ul>
          </MiniCard>
        </div>

        <p className="font-medium text-slate-900">Qué tienes que revisar tú, siempre:</p>
        <ul className="list-disc pl-5 space-y-1.5 text-slate-600">
          <li>
            <strong>Impacto y urgencia.</strong> Son lo que fija la prioridad y por lo tanto el reloj.
            Si el modelo se queda corto, corrígelo con <strong>Ajustar prioridad</strong>.
          </li>
          <li>
            <strong>La confianza.</strong> Aparece en el historial, en la entrada «Triaje IA». Por
            debajo de un valor que te resulte fiable, léelo todo con lupa.
          </li>
          <li>
            <strong>El asunto y la descripción.</strong> Ojo con esto:{' '}
            <strong>la descripción generada es lo que el cliente lee en su portal</strong>. Si la IA
            inventa o malinterpreta, el cliente ve esa versión y no la suya. Corrígela.
          </li>
          <li>
            <strong>Que no falle en silencio.</strong> Si el modelo devuelve algo que no encaja, el
            backend rellena con valores por defecto (INCIDENCIA, SOPORTE, impacto MEDIO, urgencia
            MEDIA) en vez de dejarlo vacío. Un ticket «MEDIO / MEDIA» recién triado puede ser una
            clasificación real o el valor de reserva: compruébalo contra el texto.
          </li>
        </ul>
      </HelpSection>

      <HelpSection id="primer-ticket" title="Tu primer ticket, paso a paso">
        <p>
          Abre <strong>Tickets</strong> y filtra por <strong>Abiertos</strong>. Entra en uno. Los
          botones de la columna <strong>Acciones</strong> aparecen según el estado, y solo aparecen
          los que el backend va a aceptar.
        </p>

        <ol className="space-y-3 list-decimal pl-5">
          <li>
            <strong>Triaje IA.</strong> Si el ticket está crudo, empieza por aquí y revisa lo que
            salió.
          </li>
          <li>
            <strong>Asignar</strong> (o <strong>Reasignar</strong>). El diálogo te sugiere el técnico
            activo cuya especialidad cubre la categoría del ticket y que menos tickets abiertos tiene.
            Es una sugerencia: la asignación siempre la confirma una persona. Si el ticket estaba en{' '}
            {STATUS_LABELS.NUEVO} o {STATUS_LABELS.TRIAJE}, asignar lo mueve a{' '}
            {STATUS_LABELS.ASIGNADO}.
          </li>
          <li>
            <strong>Tomar.</strong> Te pone como responsable y mueve el ticket a{' '}
            {STATUS_LABELS.EN_ATENCION}. Esta es la acción que marca la primera respuesta.
          </li>
          <li>
            <strong>Esperar cliente</strong> / <strong>Reanudar.</strong> El único par que para y
            arranca el reloj. «Reanudar» no cambia el responsable.
          </li>
          <li>
            <strong>Derivar.</strong> Pide el motivo por un cuadro del navegador y escala a nivel{' '}
            <strong>N3</strong>. Hoy el botón no deja elegir otro nivel ni otro técnico, aunque la API
            sí los admite.
          </li>
          <li>
            <strong>Resolver.</strong> Abre el diálogo con los tres campos obligatorios. Escríbelos
            pensando en que el documento de cierre puede reutilizarlos.
          </li>
          <li>
            <strong>Cerrar.</strong> Solo se ofrece desde {STATUS_LABELS.RESUELTO}. Es el cierre
            limpio y no pide motivo.
          </li>
        </ol>

        <p>
          Aparte, cuando el ticket ya está triado y tiene proyecto con Jira vinculado, sale{' '}
          <strong>Enviar a Jira</strong>: crea la incidencia allá con el prefijo{' '}
          <Code>[CLIENTE-MODULO]</Code>, las etiquetas automáticas y la solicitud original citada. Se
          hace una sola vez por ticket.
        </p>

        <Note tone="warning" title="La UI ofrece menos de lo que la API permite">
          Cancelar un ticket abierto (cerrarlo sin resolver, con motivo) es una transición válida en
          el backend, pero <strong>no hay botón</strong> para ella: el detalle solo ofrece «Cerrar»
          desde {STATUS_LABELS.RESUELTO}. Lo mismo con reabrir un resuelto, que exige motivo y ningún
          botón lo envía. Si necesitas cualquiera de las dos, hoy es por API.
        </Note>
      </HelpSection>

      <HelpSection id="portal" title="Qué ve el cliente en su portal">
        <p className="font-medium text-slate-900">Cómo se dan de alta los usuarios</p>
        <p>
          En <strong>Administración → Usuarios de clientes</strong>. Eliges la empresa, pulsas{' '}
          <strong>Nuevo usuario</strong> y pones nombre, correo y una contraseña inicial de al menos 8
          caracteres. <strong>No hay autorregistro</strong>: el alta la hace siempre el equipo.
        </p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
          <li>
            Crear y editar usuarios de cliente lo puede hacer solo un <strong>ADMIN</strong>.
          </li>
          <li>
            La contraseña se muestra <strong>una sola vez</strong>, al crear. No se guarda en ningún
            sitio ni se vuelve a mostrar: cópiala y entrégala por un canal seguro.
          </li>
          <li>
            No hay recuperación de contraseña desde el portal. Si el cliente la pierde, entra a{' '}
            <strong>Editar</strong> y restablécela.
          </li>
          <li>
            La empresa del usuario no se puede cambiar después de crearlo.
          </li>
          <li>
            La casilla «Administrador de la empresa» está reservada:{' '}
            <strong>hoy no tiene ningún efecto</strong>.
          </li>
        </ul>

        <p className="font-medium text-slate-900 pt-2">Qué ve y qué no ve</p>
        <div className="grid gap-4 md:grid-cols-2">
          <MiniCard title="Sí ve" tone="success">
            <ul className="list-disc pl-4 space-y-1">
              <li>Código, asunto y fecha de creación</li>
              <li>El estado, con la misma etiqueta que usamos nosotros</li>
              <li>La descripción elaborada, o su propio texto si aún no hay triaje</li>
              <li>Fechas de resolución y cierre</li>
              <li>El historial, con fecha y tipo de cada movimiento</li>
            </ul>
          </MiniCard>
          <MiniCard title="No ve" tone="danger">
            <ul className="list-disc pl-4 space-y-1">
              <li>Prioridad, impacto y urgencia</li>
              <li>Nada del SLA: ni plazos, ni riesgo, ni vencimiento</li>
              <li>Quién tiene asignado el ticket</li>
              <li>Los eventos de asignación, riesgo de SLA y ajuste de prioridad</li>
              <li>Los comentarios internos y el rastro de Jira</li>
              <li>El actor y el motivo de cada transición</li>
            </ul>
          </MiniCard>
        </div>

        <Note tone="warning" title="El motivo de una transición no lo lee el cliente">
          El campo <Code>reason</Code> —el que escribes al derivar, al cancelar o al reabrir— es
          interno y el portal nunca lo publica. Eso cambia cómo se escribe: es una nota para el
          compañero que agarre el ticket después, no un mensaje al cliente. Escribe ahí lo que de
          verdad pasó («el proveedor no responde el webhook desde el martes») sin edulcorarlo. Y al
          revés: <strong>si el cliente tiene que enterarse de algo, el motivo no sirve</strong> —
          escríbele por el canal habitual.
        </Note>

        <Note tone="warning" title="La descripción del triaje sí la lee">
          De todo lo que genera la IA, la descripción es lo único que llega al portal. Es el campo que
          hay que dejar presentable.
        </Note>

        <p>
          El aislamiento entre empresas es duro: un ticket de otra empresa responde{' '}
          <strong>404, no 403</strong>, para que nadie pueda averiguar qué ids existen probando
          números. Y el portal no envía ningún correo al cambiar de estado: si el cliente tiene que
          saber algo, se lo dices tú.
        </p>
      </HelpSection>

      <HelpSection id="roles" title="Qué puede hacer cada rol">
        <p>
          Hay cinco roles internos. Lo importante de entrada: <strong>sobre los tickets no hay
          restricción de rol</strong>. Cualquier persona con sesión interna puede crear, triar,
          asignar, tomar, derivar, resolver, cerrar y ajustar la prioridad de cualquier ticket. Las
          restricciones están en la administración.
        </p>

        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full min-w-[38rem] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                <th className="py-2 pr-4">Rol</th>
                <th className="py-2">Además de los tickets, puede…</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {ROLE_NOTES.map(({ role, note }) => (
                <tr key={role}>
                  <td className="py-3 pr-4 whitespace-nowrap font-medium text-slate-900">
                    {roleLabels[role] ?? role}
                  </td>
                  <td className="py-3 text-slate-600">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-slate-600">
          Los <strong>técnicos de soporte</strong> (los que aparecen en el selector de «Asignar») son
          una lista aparte de los usuarios: se administran en{' '}
          <strong>Usuarios → Técnicos de la mesa</strong>, con su nivel (N1, N2, N3) y sus
          especialidades. Darlos de alta y de baja es cosa de un ADMIN.
        </p>
        <p className="text-slate-600">
          Los <strong>sistemas</strong> que el cliente ve en el selector del portal se administran en
          la ficha del cliente, pestaña <strong>Sistemas</strong>. Solo salen los activos. Si un
          cliente no tiene ninguno, su selector aparece vacío.
        </p>
      </HelpSection>

      <HelpSection id="limites" title="Límites conocidos">
        <p>
          Cosas que hoy no existen y que alguien va a preguntar. Están aquí para que la respuesta sea
          «no está» y no «déjame buscarlo».
        </p>
        <ul className="list-disc pl-5 space-y-1.5 text-slate-600">
          <li>
            <strong>Ninguna notificación automática.</strong> Ni correo al cliente cuando cambia el
            estado, ni aviso al técnico cuando le asignan un ticket, ni alerta cuando un SLA entra en
            riesgo o vence. El correo existe en el producto, pero solo para documentos y firmas.
          </li>
          <li>
            <strong>Nada pasa solo al vencer un SLA.</strong> No hay escalado automático. El único job
            que corre es el de riesgo al {AT_RISK_PERCENT}%, cada 5 minutos.
          </li>
          <li>
            <strong>Solo se vigila el plazo de resolución.</strong> El de primera respuesta se calcula
            y se guarda, pero nada evalúa si se incumplió.
          </li>
          <li>
            <strong>No hay conversación con el cliente dentro del ticket.</strong> Ni él puede
            comentar ni nosotros podemos responderle desde aquí. Los eventos de tipo{' '}
            <Code>COMMENT</Code> los escribe solo la máquina (push a Jira, documento de cierre).
          </li>
          <li>
            <strong>No hay adjuntos</strong> en los tickets del portal.
          </li>
          <li>
            <strong>Sin calendario laboral.</strong> El SLA corre 24×7; el campo <Code>coverage</Code>{' '}
            de la política existe pero no se lee.
          </li>
          <li>
            <strong>La bandeja no pagina.</strong> Devuelve como mucho 500 tickets, los más recientes.
            Con más volumen hay que filtrar.
          </li>
          <li>
            <strong>Borrar un ticket solo se puede</strong> mientras esté en {STATUS_LABELS.NUEVO} o{' '}
            {STATUS_LABELS.TRIAJE}. Después hay que cerrarlo.
          </li>
          <li>
            <strong>El login interno no tiene límite de intentos.</strong> El del portal sí (5 por
            minuto y 20 cada 15 minutos, por IP).
          </li>
          <li>
            <strong>La casilla «Administrador de la empresa»</strong> de los usuarios de cliente está
            reservada y no cambia nada todavía.
          </li>
        </ul>
      </HelpSection>

      <p className="text-xs text-slate-400">
        Si algo de este manual ya no coincide con el código, corrígelo aquí mismo: vive en{' '}
        <Code>web/src/pages/HelpPage.tsx</Code>.
      </p>
    </div>
  );
}

/**
 * Qué añade cada rol sobre lo que ya puede hacer cualquier sesión interna.
 * Transcrito de los `@Roles(...)` de los controladores; ver
 * `common/guards/roles.guard.ts` para la mecánica.
 */
const ROLE_NOTES: { role: UserRole; note: string }[] = [
  {
    role: 'ADMIN',
    note: 'Todo. Es el único que crea y edita usuarios internos y usuarios de clientes, administra técnicos de soporte, proveedores de IA, integraciones, plantillas y datos del emisor, y el único que puede borrar clientes y proyectos.',
  },
  {
    role: 'PRODUCT_OWNER',
    note: 'Crear y editar clientes y proyectos, gestionar los miembros de un proyecto, generar y enviar documentos, y aprobar actas. Ver el listado de usuarios internos.',
  },
  {
    role: 'SCRUM_MASTER',
    note: 'Aprobar actas y ver el listado de usuarios internos.',
  },
  {
    role: 'DEVELOPER',
    note: 'Nada más allá de los tickets, los sistemas del cliente y la lectura del resto del panel. Es el perfil típico de quien atiende la mesa.',
  },
  {
    role: 'STAKEHOLDER',
    note: 'Lo mismo que DEVELOPER: hoy no se distinguen en ningún permiso.',
  },
];

/**
 * Diagrama del ciclo de vida, en HTML y CSS. Nada de imagen: así se puede
 * copiar, buscar en la página, imprimir y leer con lector de pantalla.
 *
 * El camino feliz va en una fila; los dos desvíos, debajo. La tabla completa
 * de transiciones está justo después en la propia página, que es la fuente
 * autoritativa — esto es el mapa de bolsillo.
 */
function StateDiagram() {
  const happyPath: TicketStatus[] = [
    'NUEVO',
    'TRIAJE',
    'ASIGNADO',
    'EN_ATENCION',
    'RESUELTO',
    'CERRADO',
  ];

  return (
    <figure className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4">
      <figcaption className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        Camino habitual
      </figcaption>

      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {happyPath.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            {i > 0 && (
              <span className="text-slate-400" aria-hidden>
                →
              </span>
            )}
            <span className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800">
              {STATUS_LABELS[s]}
            </span>
          </li>
        ))}
      </ol>

      <div className="grid gap-3 sm:grid-cols-2">
        <DetourBox
          title={STATUS_LABELS.ESPERA_CLIENTE}
          from={STATUS_LABELS.EN_ATENCION}
          back={`${STATUS_LABELS.EN_ATENCION} o ${STATUS_LABELS.RESUELTO}`}
          extra="Detiene el reloj de SLA."
        />
        <DetourBox
          title={STATUS_LABELS.DERIVADO}
          from={`${STATUS_LABELS.ASIGNADO} o ${STATUS_LABELS.EN_ATENCION}`}
          back={STATUS_LABELS.EN_ATENCION}
          extra="Exige motivo. El reloj sigue corriendo."
        />
      </div>

      <p className="text-xs text-slate-500">
        Además: {STATUS_LABELS.RESUELTO} → {STATUS_LABELS.EN_ATENCION} es una reapertura (con motivo),
        y casi cualquier estado abierto puede ir directo a {STATUS_LABELS.CERRADO} como cancelación
        (también con motivo).
      </p>
    </figure>
  );
}

function DetourBox({
  title,
  from,
  back,
  extra,
}: {
  title: string;
  from: string;
  back: string;
  extra: string;
}) {
  return (
    <div className="rounded-md border border-slate-300 bg-white px-3 py-2.5">
      <p className="text-xs font-semibold text-slate-800">{title}</p>
      <p className="mt-1 text-xs text-slate-500">
        Se entra desde {from} y se vuelve a {back}.
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{extra}</p>
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

/**
 * `break-words` no es decorativo: los identificadores que se citan aquí
 * (`INVALID_TRANSITION`, rutas de fichero) son palabras sin espacios, y el
 * panel tiene un menú lateral de ancho fijo. En una pantalla estrecha, sin
 * esto, cada uno de esos tokens ensancha la página entera.
 */
function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700 break-words">
      {children}
    </code>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="sm:flex sm:gap-4">
      <dt className="font-medium text-slate-900 sm:w-52 sm:flex-shrink-0">{term}</dt>
      <dd className="text-slate-600">{children}</dd>
    </div>
  );
}

function MiniCard({
  title,
  tone,
  children,
}: {
  title: string;
  tone: 'neutral' | 'success' | 'danger' | 'warning';
  children: ReactNode;
}) {
  const tones: Record<typeof tone, string> = {
    neutral: 'border-slate-200 bg-slate-50',
    success: 'border-emerald-200 bg-emerald-50/50',
    danger: 'border-red-200 bg-red-50/50',
    warning: 'border-amber-200 bg-amber-50/50',
  };
  const titleTones: Record<typeof tone, string> = {
    neutral: 'text-slate-700',
    success: 'text-emerald-700',
    danger: 'text-red-700',
    warning: 'text-amber-700',
  };
  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${titleTones[tone]}`}>{title}</p>
      <div className="mt-2 text-slate-700">{children}</div>
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

import axios from 'axios';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import {
  INBOUND_EMAIL_OUTCOMES,
  INBOUND_EMAIL_OUTCOME_LABELS,
  inboundEmailsApi,
  type InboundEmailOutcome,
} from '../api/inbound-emails.api';
import { Card, CardBody } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { InboxIcon, RefreshIcon } from '../components/ui/Icon';
import { toast } from '../ui/Toast';

/**
 * Tono de cada resultado. Deliberadamente propio de esta pantalla y no
 * importado de `Badge.tsx` (que no exporta su tipo `Tone`): mismo criterio
 * que el resto de mapas de esta pantalla, uno por tipo de dato que necesita
 * color.
 */
type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'purple';

const OUTCOME_TONES: Record<InboundEmailOutcome, BadgeTone> = {
  TICKET_CREADO: 'success',
  MENSAJE_ANADIDO: 'success',
  DESCARTADO_NO_AUTENTICADO: 'neutral',
  DESCARTADO_AUTOMATICO: 'neutral',
  DESCARTADO_PROPIO: 'neutral',
  DESCARTADO_DUPLICADO: 'neutral',
  REMITENTE_DESCONOCIDO: 'warning',
  DESCARTADO_POR_TOPE: 'warning',
  DESCARTADO_SIN_CONTENIDO: 'neutral',
  ERROR: 'danger',
};

/**
 * El fallo de la propia llamada de reintento, en español. Mismo criterio que
 * `describePostError` de `ThreadComposer`: prioriza el `message` que manda el
 * backend (`{code, message}`, ver `HttpExceptionFilter`) sobre un texto
 * genérico.
 */
function describeRetryError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return 'No se pudo contactar con el servidor. Comprueba tu conexión e inténtalo de nuevo.';
    }
    const body: unknown = error.response.data;
    if (body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string') {
      return (body as { message: string }).message;
    }
  }
  return 'No se pudo reencolar este correo. Inténtalo de nuevo.';
}

/** Lo que se sabe del último intento de reintento de una fila, por su id. */
interface RowFeedback {
  /** Falló la llamada que reencola (el `POST /inbound-emails/:id/retry` en sí). */
  requeueError: string | null;
  /** El reencolado SÍ funcionó, pero refrescar la lista después falló. */
  refreshError: string | null;
}

const FEEDBACK_VACIO: RowFeedback = { requeueError: null, refreshError: null };

export default function InboundEmailPage() {
  const [outcomeFilter, setOutcomeFilter] = useState<InboundEmailOutcome | ''>('');

  const {
    data: filas,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['inbound-emails', outcomeFilter],
    queryFn: () => inboundEmailsApi.list(outcomeFilter === '' ? undefined : outcomeFilter),
  });

  /**
   * Guarda **síncrona** contra el doble envío del reintento, un `Set` en un
   * `ref` y no en `useState`: se lee y se escribe en el mismo tick, antes de
   * cualquier `await`, que es justo lo que un estado de React no puede
   * garantizar (`setState` no cambia nada hasta el siguiente render, así que
   * dos clics dentro del mismo tick entrarían los dos). Un `Set` -- no un
   * único booleano -- porque cada fila se reintenta de forma independiente:
   * bloquear solo esta fila, y no todas las demás, mientras su reintento está
   * en vuelo.
   */
  const inFlight = useRef<Set<number>>(new Set());
  const [retryingIds, setRetryingIds] = useState<Set<number>>(new Set());
  const [feedback, setFeedback] = useState<Record<number, RowFeedback>>({});

  const handleRetry = async (id: number) => {
    // La guarda, antes que nada y sin ningún `await` por delante.
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setRetryingIds((prev) => new Set(prev).add(id));
    // Se limpian LOS DOS estados de error de esta fila, no solo uno: un
    // reintento anterior pudo haber fallado por el propio reencolado o por el
    // refresco posterior, y dejar cualquiera de los dos a medias confundiría
    // el resultado de este intento nuevo con el del anterior.
    setFeedback((prev) => ({ ...prev, [id]: FEEDBACK_VACIO }));

    try {
      await inboundEmailsApi.retry(id);
    } catch (error) {
      setFeedback((prev) => ({
        ...prev,
        [id]: { requeueError: describeRetryError(error), refreshError: null },
      }));
      inFlight.current.delete(id);
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }

    try {
      await refetch();
      toast.success('Correo reencolado. Se procesará en el siguiente ciclo del buzón (cada minuto).');
    } catch {
      setFeedback((prev) => ({
        ...prev,
        [id]: {
          requeueError: null,
          refreshError: 'Se reencoló, pero no se pudo refrescar la lista. Recarga la página para comprobarlo.',
        },
      }));
    } finally {
      inFlight.current.delete(id);
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Correo entrante</h1>
        <p className="text-sm text-slate-500 mt-1">
          Todo lo que ha entrado por el buzón de tickets, se haya convertido en algo o no. Es la caja
          negra de la ingesta: si a un cliente no le llegó su ticket, la respuesta está aquí.
        </p>
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <label className="label mb-0" htmlFor="inbound-email-outcome-filter">
            Resultado
          </label>
          <select
            id="inbound-email-outcome-filter"
            className="input max-w-xs"
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value as InboundEmailOutcome | '')}
          >
            <option value="">Todos</option>
            {INBOUND_EMAIL_OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {INBOUND_EMAIL_OUTCOME_LABELS[outcome]}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshIcon size={14} />}
            onClick={() => refetch()}
          >
            Refrescar
          </Button>
        </CardBody>
      </Card>

      <Card>
        {isLoading ? (
          <div className="p-12 flex items-center justify-center text-slate-400">
            <RefreshIcon className="animate-spin" size={20} />
            <span className="ml-2 text-sm">Cargando…</span>
          </div>
        ) : isError ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-red-600">No se pudo cargar el listado.</p>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Reintentar
            </Button>
          </div>
        ) : !filas || filas.length === 0 ? (
          <EmptyState
            icon={<InboxIcon size={22} />}
            title="Sin correos"
            description={
              outcomeFilter === ''
                ? 'Todavía no ha entrado ningún correo por el buzón.'
                : `No hay correos con el resultado "${INBOUND_EMAIL_OUTCOME_LABELS[outcomeFilter]}".`
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                  <th className="px-5 py-3">Recibido</th>
                  <th className="px-5 py-3">De</th>
                  <th className="px-5 py-3">Asunto</th>
                  <th className="px-5 py-3">Resultado</th>
                  <th className="px-5 py-3">Motivo</th>
                  <th className="px-5 py-3">Ticket</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filas.map((fila) => {
                  const fb = feedback[fila.id] ?? FEEDBACK_VACIO;
                  const retrying = retryingIds.has(fila.id);
                  return (
                    <tr key={fila.id} className="text-sm align-top hover:bg-slate-50 transition">
                      <td className="px-5 py-4 text-slate-600 whitespace-nowrap">
                        {fila.receivedAtLabel}
                        {fila.sentAtLabel && fila.sentAtLabel !== fila.receivedAtLabel && (
                          <p className="text-xs text-slate-400 mt-0.5">Enviado: {fila.sentAtLabel}</p>
                        )}
                      </td>
                      <td className="px-5 py-4 text-slate-700">{fila.fromAddress}</td>
                      <td className="px-5 py-4 text-slate-700">
                        {fila.subject ?? <span className="text-slate-400 italic">(sin asunto)</span>}
                        {fila.attachmentCount > 0 && (
                          <p
                            className="text-xs text-slate-400 mt-0.5"
                            title={fila.attachmentNames?.join(', ') ?? undefined}
                          >
                            {fila.attachmentCount === 1 ? '1 adjunto' : `${fila.attachmentCount} adjuntos`}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <Badge tone={OUTCOME_TONES[fila.outcome]} dot>
                          {INBOUND_EMAIL_OUTCOME_LABELS[fila.outcome]}
                        </Badge>
                      </td>
                      <td className="px-5 py-4 text-slate-600 max-w-sm whitespace-pre-wrap">
                        {fila.reason ?? '—'}
                      </td>
                      <td className="px-5 py-4">
                        {fila.ticketId ? (
                          <Link
                            to={`/tickets/${fila.ticketId}`}
                            className="font-medium text-kubo-primary hover:text-kubo-primary-dark transition"
                          >
                            Ver ticket
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {fila.retryable && (
                          <div className="flex flex-col items-end gap-1.5">
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={retrying}
                              disabled={retrying}
                              onClick={() => void handleRetry(fila.id)}
                            >
                              Reintentar
                            </Button>
                            {fb.requeueError && (
                              <p role="alert" className="max-w-[16rem] text-xs text-red-600 text-right">
                                {fb.requeueError}
                              </p>
                            )}
                            {fb.refreshError && (
                              <p role="alert" className="max-w-[16rem] text-xs text-amber-600 text-right">
                                {fb.refreshError}
                              </p>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

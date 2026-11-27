import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { portalApi } from '../../api/portal.api';
import type { PortalRequirement } from '../../api/types';
import { Card, CardBody } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { ArrowLeftIcon } from '../../components/ui/Icon';
import { Button } from '../../components/ui/Button';
import { parseCriteria } from '../requirements/requirement-template';
import { fmtDate, fmtDateTime } from './PortalTicketsListPage';
import { REQUIREMENT_STATUS_TONES, fmtCommittedDate } from './PortalRequirementsListPage';

/** Las tres prioridades que puede traer un requerimiento ya aceptado. */
const PRIORITY_LABELS: Record<'ALTA' | 'MEDIA' | 'BAJA', string> = {
  ALTA: 'Alta',
  MEDIA: 'Media',
  BAJA: 'Baja',
};

export default function PortalRequirementDetailPage() {
  const { requirementId } = useParams();
  const id = Number(requirementId);

  const [requirement, setRequirement] = useState<PortalRequirement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Las dos guardas de siempre (ver `PortalTicketDetailPage`): `alive` corta
   * el camino tardío tras desmontar y `seq` decide quién manda cuando hay
   * varias cargas en vuelo -- navegar rápido entre requerimientos --. Solo la
   * última pedida escribe el estado.
   */
  const alive = useRef(true);
  const seq = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!Number.isFinite(id)) {
      // Id de ruta no numérico (URL manual, enlace obsoleto): sin este corte
      // explícito `loading` se queda en `true` para siempre.
      setLoading(false);
      setError('Requerimiento no encontrado');
      return;
    }
    const current = ++seq.current;
    setLoading(true);
    setError(null);
    portalApi
      .getRequirement(id)
      .then((data) => {
        if (!alive.current || current !== seq.current) return;
        setRequirement(data);
        setError(null);
      })
      .catch((e: any) => {
        if (!alive.current || current !== seq.current) return;
        // El backend contesta lo mismo (404, mensaje genérico) tanto para un
        // id inexistente como para uno de otra empresa -- nunca 403, que
        // delataría que existe pero es ajeno --, así que relaying su mensaje
        // tal cual ya cumple con que ambos casos se vean igual en pantalla.
        setError(e?.response?.data?.message ?? 'No se pudo cargar el requerimiento.');
      })
      .finally(() => {
        if (alive.current && current === seq.current) setLoading(false);
      });
  }, [id]);

  return (
    <div className="space-y-6">
      <Link
        to="/portal/requerimientos"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition"
      >
        <ArrowLeftIcon size={14} />
        Volver a mis requerimientos
      </Link>

      {loading && <div className="p-8 text-center text-sm text-slate-500">Cargando…</div>}

      {!loading && (error || !requirement) && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error ?? 'Requerimiento no encontrado'}
        </div>
      )}

      {!loading && requirement && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm text-slate-500">
              {requirement.code ?? `#${requirement.id}`}
            </span>
            <Badge tone={REQUIREMENT_STATUS_TONES[requirement.status]} dot>
              {requirement.status}
            </Badge>
            {/*
              La prioridad solo se pinta si el backend la mandó: mientras el
              requerimiento no ha sido aceptado no hay compromiso que
              mostrar, y ni un guion ni «sin prioridad» sustituyen a no pintar
              el campo.
            */}
            {requirement.priority && (
              <Badge tone="neutral">Prioridad {PRIORITY_LABELS[requirement.priority]}</Badge>
            )}
            <span className="ml-auto text-xs text-slate-500">
              Creado el {fmtDateTime(requirement.createdAt)}
            </span>
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-slate-500">
            <span>Fecha comprometida: {fmtCommittedDate(requirement.committedDate)}</span>
            {requirement.closedAt && <span>Cerrado el {fmtDate(requirement.closedAt)}</span>}
          </div>

          {requirement.status === 'Rechazado' && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
                Motivo del rechazo
              </p>
              {/*
                Si llegara `null` estando rechazado, se escribe este texto en
                vez de dejar el bloque vacío -- un bloque vacío se lee como un
                fallo de carga, y aquí lo que hay es, sencillamente, que no se
                registró un motivo.
              */}
              <p className="mt-1 text-sm text-red-800">
                {requirement.rejectionReason ?? 'Sin motivo registrado'}
              </p>
            </div>
          )}

          {requirement.status === 'Falta información' && (
            <ProvideDetailCard requirement={requirement} onDone={(r) => setRequirement(r)} />
          )}

          <Card>
            <CardBody>
              <h1 className="text-lg font-semibold text-slate-900">{requirement.title}</h1>
              {requirement.descriptionMd && (
                <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-700">
                  {requirement.descriptionMd}
                </pre>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * La casa pidió más detalle: se muestra la pregunta y un formulario para
 * responder. Lo que se escribe se agrega a la descripción y el requerimiento
 * vuelve a «Solicitado» para que lo evalúen.
 */
function ProvideDetailCard({
  requirement,
  onDone,
}: {
  requirement: PortalRequirement;
  onDone: (r: PortalRequirement) => void;
}) {
  const [detail, setDetail] = useState('');
  const [criteria, setCriteria] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const inFlight = useRef(false);

  const submit = async () => {
    if (inFlight.current || detail.trim().length < 3) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const updated = await portalApi.provideRequirementDetail(requirement.id, {
        detail: detail.trim(),
        acceptanceCriteria: parseCriteria(criteria),
      });
      setSent(true);
      onDone(updated);
    } catch (e: any) {
      setError(
        e?.response?.status === 403
          ? 'Solo el administrador de tu empresa en el portal puede completar el requerimiento.'
          : e?.response?.data?.message ?? 'No se pudo enviar el detalle. Inténtalo de nuevo.',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (sent) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Necesitamos más detalle</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">
          {requirement.pendingQuestion ?? 'Completa el requerimiento con más detalle para poder evaluarlo.'}
        </p>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div>
        <label className="label" htmlFor="rq-detail">Tu respuesta *</label>
        <textarea
          id="rq-detail"
          className="input"
          rows={5}
          value={detail}
          disabled={busy}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Responde a la pregunta con el mayor detalle posible. Si tienes capturas o un documento, menciónalo y te diremos cómo enviarlo."
        />
      </div>
      <div>
        <label className="label" htmlFor="rq-detail-criteria">Cómo sabremos que está bien (opcional, uno por línea)</label>
        <textarea
          id="rq-detail-criteria"
          className="input"
          rows={2}
          value={criteria}
          disabled={busy}
          onChange={(e) => setCriteria(e.target.value)}
        />
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="primary" onClick={submit} disabled={busy || detail.trim().length < 3} loading={busy}>
          {busy ? 'Enviando…' : 'Enviar detalle'}
        </Button>
      </div>
    </div>
  );
}

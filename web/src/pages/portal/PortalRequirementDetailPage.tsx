import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { portalApi } from '../../api/portal.api';
import type { PortalRequirement, PortalRequirementAttachment } from '../../api/types';
import { Card, CardBody } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { ArrowLeftIcon } from '../../components/ui/Icon';
import { Button } from '../../components/ui/Button';
import { parseCriteria } from '../requirements/requirement-template';
import { toast } from '../../ui/Toast';
import RequirementFilePicker, { formatSize, uploadRequirementFiles } from './RequirementFilePicker';
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
  /** Sube al terminar «Enviar detalle», para que la lista de archivos se recargue. */
  const [filesKey, setFilesKey] = useState(0);

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
            <ProvideDetailCard
              requirement={requirement}
              onDone={(r) => {
                setRequirement(r);
                setFilesKey((k) => k + 1);
              }}
            />
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

          <AttachmentsCard requirement={requirement} refreshKey={filesKey} />
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
  const [files, setFiles] = useState<File[]>([]);
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
      const failed = files.length ? await uploadRequirementFiles(requirement.id, files) : [];
      if (failed.length) {
        toast.warning(
          `El detalle se envió, pero no se pudo subir: ${failed.map((x) => `${x.name} (${x.reason})`).join('; ')}.`,
        );
      }
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
          placeholder="Responde a la pregunta con el mayor detalle posible. Las capturas o documentos adjúntalos abajo."
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
      <RequirementFilePicker id="rq-detail-files" files={files} onChange={setFiles} disabled={busy} />
      <div className="flex justify-end">
        <Button type="button" variant="primary" onClick={submit} disabled={busy || detail.trim().length < 3} loading={busy}>
          {busy ? 'Enviando…' : 'Enviar detalle'}
        </Button>
      </div>
    </div>
  );
}

/** Estados en los que ya no se trabaja el requerimiento: no se adjunta más. */
const CLOSED_LABELS = ['Entregado', 'Cancelado', 'Rechazado'];

/**
 * Los archivos que la empresa adjuntó (capturas, Word, PDF), con su descarga.
 * Solo los suyos: los documentos internos del equipo no se muestran aquí.
 */
function AttachmentsCard({ requirement, refreshKey }: { requirement: PortalRequirement; refreshKey: number }) {
  const [items, setItems] = useState<PortalRequirementAttachment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const open = !CLOSED_LABELS.includes(requirement.status);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .listRequirementAttachments(requirement.id)
      .then((list) => {
        if (!cancelled) {
          setItems(list);
          setLoadError(null);
        }
      })
      .catch((e: any) => {
        if (!cancelled) setLoadError(e?.response?.data?.message ?? 'No se pudieron cargar los archivos.');
      });
    return () => {
      cancelled = true;
    };
  }, [requirement.id, refreshKey, reload]);

  const upload = async () => {
    if (!adding.length || busy) return;
    setBusy(true);
    const failed = await uploadRequirementFiles(requirement.id, adding);
    setBusy(false);
    if (failed.length) {
      toast.error(`No se pudo subir: ${failed.map((x) => `${x.name} (${x.reason})`).join('; ')}.`);
    } else {
      toast.success(adding.length === 1 ? 'Archivo adjuntado.' : 'Archivos adjuntados.');
    }
    setAdding([]);
    setReload((k) => k + 1);
  };

  const download = async (att: PortalRequirementAttachment) => {
    try {
      await portalApi.downloadRequirementAttachment(requirement.id, att);
    } catch {
      toast.error('No se pudo descargar el archivo.');
    }
  };

  return (
    <Card>
      <CardBody>
        <h2 className="text-sm font-semibold text-slate-900">Archivos adjuntos</h2>
        <p className="mt-1 text-xs text-slate-500">Capturas de pantalla, Word o PDF que acompañan este pedido.</p>
        {loadError && <p className="mt-3 text-sm text-red-600">{loadError}</p>}
        {items && items.length === 0 && <p className="mt-3 text-sm text-slate-500">Todavía no hay archivos.</p>}
        {items && items.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {items.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate text-slate-700">
                  {a.filename}
                  <span className="ml-2 text-xs text-slate-400">
                    {formatSize(a.sizeBytes)} · {fmtDateTime(a.createdAt)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => download(a)}
                  className="shrink-0 text-xs font-semibold text-kubo-primary hover:underline"
                >
                  Descargar
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && (
          <div className="mt-4 space-y-2">
            <RequirementFilePicker id="rq-more-files" files={adding} onChange={setAdding} disabled={busy} />
            {adding.length > 0 && (
              <div className="flex justify-end">
                <Button type="button" variant="primary" onClick={upload} disabled={busy} loading={busy}>
                  {busy ? 'Subiendo…' : adding.length === 1 ? 'Adjuntar archivo' : `Adjuntar ${adding.length} archivos`}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

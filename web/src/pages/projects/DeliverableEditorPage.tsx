import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { compressPhoto } from '../../api/acta-annexes.api';
import {
  AI_PRESETS,
  AiChange,
  DeliverableDocument,
  DocAttachment,
  DocSection,
  deliverableDocumentApi,
} from '../../api/deliverable-document.api';
import { expedienteApi } from '../../api/expediente.api';
import { useAuth } from '../../auth/AuthContext';
import { canLeadProject } from '../../auth/permissions';
import { MarkdownPreview } from '../../components/MarkdownPreview';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ArrowLeftIcon, DownloadIcon, PlusIcon, SaveIcon, SparklesIcon, TrashIcon } from '../../components/ui/Icon';
import { parseSchedule } from '../../lib/doc-tables';
import { useAuthedImage } from '../../lib/useAuthedImage';
import { ParticipantsTools, RolesTools, ScheduleTools, sectionKind } from './SectionHelpers';
import { askConfirm } from '../../ui/ConfirmDialog';
import { toast } from '../../ui/Toast';

const PENDING = '[Completar]';

type SectionState = 'COMPLETA' | 'EDITADA' | 'PENDIENTE';

const STATE_STYLE: Record<SectionState, { label: string; dot: string }> = {
  COMPLETA: { label: 'Completa', dot: '#1e7a3c' },
  EDITADA: { label: 'Editada', dot: '#053777' },
  PENDIENTE: { label: 'Pendiente', dot: '#a35c00' },
};

function errorText(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  return Array.isArray(m) ? m.join(' ') : m ?? fallback;
}

/** Distinto de lo último guardado (o de la plantilla, si aún no se guardó). */
function isChanged(s: DocSection, saved: Map<string, DocSection>): boolean {
  const before = saved.get(s.key);
  return !before || before.body !== s.body || before.title !== s.title || before.num !== s.num;
}

/** Para el índice: lo editado en esta versión manda; si no, completa o pendiente. */
function stateOf(s: DocSection, saved: Map<string, DocSection>): SectionState {
  if (isChanged(s, saved)) return 'EDITADA';
  const b = s.body.trim();
  return !b || b.includes(PENDING) ? 'PENDIENTE' : 'COMPLETA';
}

/** El número que sigue al de la última sección: 2.4 → 2.5, 3 → 4. */
function nextNum(list: DocSection[]): string {
  const last = list[list.length - 1]?.num ?? '';
  const m = /^(.*?)(\d+)$/.exec(last.trim());
  return m ? `${m[1]}${Number(m[2]) + 1}` : String(list.length + 1);
}

function newKey(): string {
  return `sec-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
}

/** Inserta Markdown alrededor de la selección del textarea. */
function wrapSelection(el: HTMLTextAreaElement, before: string, after = '', placeholder = 'texto'): string {
  const { selectionStart: a, selectionEnd: b, value } = el;
  const sel = value.slice(a, b) || placeholder;
  return value.slice(0, a) + before + sel + after + value.slice(b);
}

export default function DeliverableEditorPage() {
  const projectId = Number(useParams().projectId);
  const deliverableId = Number(useParams().deliverableId);
  const { user } = useAuth();
  const lead = canLeadProject(user);
  const qc = useQueryClient();
  const key = ['deliverable-document', projectId, deliverableId];
  // Sin recarga al volver a la pestaña: el texto en pantalla no se reemplaza solo.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: key,
    queryFn: () => deliverableDocumentApi.get(projectId, deliverableId),
    refetchOnWindowFocus: false,
  });

  const [sections, setSections] = useState<DocSection[]>([]);
  const [saved, setSaved] = useState<Map<string, DocSection>>(new Map());
  const [baseVersion, setBaseVersion] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [note, setNote] = useState('');
  const [proposal, setProposal] = useState<{ changes: AiChange[]; picked: Set<string>; instruction: string; scopeLabel: string } | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  /** Hay una versión más nueva en el servidor y no se cargó porque hay cambios sin guardar. */
  const [newer, setNewer] = useState<DeliverableDocument | null>(null);
  const loadedFor = useRef<string | null>(null);
  const dirtyRef = useRef(false);

  // Carga inicial (y tras guardar): el texto del servidor pasa a ser la base.
  const adopt = (doc: DeliverableDocument) => {
    const clean = doc.sections.map(({ key: k, num, title, body }) => ({ key: k, num, title, body }));
    setSections(clean);
    setSaved(new Map(clean.map((s) => [s.key, s])));
    setNewer(null);
    setBaseVersion(doc.baseVersion);
    setCurrent((c) => (c && clean.some((s) => s.key === c) ? c : clean[0]?.key ?? null));
  };
  useEffect(() => {
    const tag = data ? `${data.deliverable.id}:${data.baseVersion}:${data.saved}` : null;
    if (data && loadedFor.current !== tag) {
      // Con cambios sin guardar no se pisa el texto: se avisa que hay una versión más nueva.
      if (loadedFor.current !== null && dirtyRef.current) {
        setNewer(data);
        return;
      }
      loadedFor.current = tag;
      adopt(data);
    }
  }, [data]);

  const dirty = useMemo(() => {
    if (!data) return false;
    if (sections.length !== saved.size || sections.some((s) => !saved.has(s.key))) return true;
    return sections.some((s) => isChanged(s, saved));
  }, [sections, saved, data]);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (opts: { sections: DocSection[]; note?: string }) =>
      deliverableDocumentApi.save(projectId, deliverableId, { sections: opts.sections, baseVersion, note: opts.note }),
    onSuccess: (doc) => {
      dirtyRef.current = false;
      loadedFor.current = `${doc.deliverable.id}:${doc.baseVersion}:${doc.saved}`;
      qc.setQueryData(key, doc);
      qc.invalidateQueries({ queryKey: ['expediente', projectId] });
      adopt(doc);
      setNote('');
      toast.success(`Guardado como V${doc.deliverable.version}.`);
    },
    onError: (e) => {
      toast.error(errorText(e, 'No se pudo guardar el documento.'));
      // 409: otra persona guardó antes; se trae su versión para ofrecer cargarla (sin pisar lo escrito).
      if ((e as { response?: { status?: number } }).response?.status === 409) void refetch();
    },
  });

  const submit = useMutation({
    mutationFn: () => expedienteApi.submit(projectId, deliverableId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['expediente', projectId] });
      toast.success('Enviado a revisión.');
    },
    onError: (e) => toast.error(errorText(e, 'No se pudo enviar a revisión.')),
  });

  if (isLoading) return <div className="p-6 text-slate-500">Cargando documento…</div>;
  if (error || !data) return <div className="p-6 text-red-600">{errorText(error, 'No se pudo cargar el documento.')}</div>;

  const d = data.deliverable;
  const readOnly = d.status === 'NO_APLICA';
  /** Mientras se guarda o responde la IA no se escribe: lo escrito se perdería o quedaría pisado. */
  const locked = save.isPending || aiRunning;
  const cur = sections.find((s) => s.key === current) ?? sections[0];
  const changed = sections.filter((s) => isChanged(s, saved));

  const update = (k: string, patch: Partial<DocSection>) => setSections((list) => list.map((s) => (s.key === k ? { ...s, ...patch } : s)));

  const acceptProposal = () => {
    if (!proposal) return;
    const skipped: string[] = [];
    const applied = new Set<string>();
    const next = sections.map((s) => {
      const c = proposal.changes.find((x) => x.key === s.key);
      if (!c || !proposal.picked.has(s.key)) return s;
      // Si la sección cambió después de pedir el ajuste, no se pisa.
      if (c.before !== s.body) {
        skipped.push(`${s.num} ${s.title}`);
        return s;
      }
      applied.add(s.key);
      return { ...s, body: c.after };
    });
    setSections(next);
    setProposal(null);
    if (skipped.length) toast.warning(`No se aplicó a ${skipped.join(', ')}: la cambiaste mientras la IA respondía.`);
    if (!applied.size) return;
    // Con otros cambios sin guardar, se aplica y se deja guardar a mano: la nota no los describiría.
    const others = next.some((s) => !applied.has(s.key) && isChanged(s, saved)) || next.length !== saved.size;
    if (others) {
      toast.info('Ajuste aplicado. Guarda la versión para registrarlo junto con tus otros cambios.');
      return;
    }
    const n = applied.size;
    save.mutate({ sections: next, note: `Ajuste con IA: «${proposal.instruction}» (${n} ${n === 1 ? 'sección' : 'secciones'})` });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/projects/${projectId}/expediente`} className="text-sm text-slate-500 hover:underline inline-flex items-center gap-1">
            <ArrowLeftIcon size={14} /> Expediente
          </Link>
          <h1 className="text-2xl font-semibold text-slate-900">{d.name}</h1>
          <div className="text-xs text-slate-500 break-all">
            {d.nomenclature} ·{' '}
            {dirty ? (
              <span className="text-amber-700">cambios sin guardar</span>
            ) : data.saved ? (
              'guardado'
            ) : (
              <span className="text-slate-500">todavía sin guardar: completa y pulsa «Guardar versión»</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge>{d.statusLabel}</Badge>
            <span>
              Formato: {data.template.name}
              {data.template.source === 'CLIENTE' && ' (del cliente)'}
            </span>
            {lead && (
              <Link to={`/admin/plantillas-entregables?type=${d.type}`} className="text-kubo-primary hover:underline">
                Editar plantillas
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={<DownloadIcon size={16} />}
            disabled={!d.documentVersionId}
            title={d.documentVersionId ? '' : 'Guarda el documento para generar el PDF'}
            onClick={() =>
              deliverableDocumentApi.pdf(projectId, deliverableId, `${d.nomenclature}.pdf`).catch(() => toast.error('No se pudo generar el PDF.'))
            }
          >
            PDF
          </Button>
          {!readOnly && (
            <Button
              icon={<SaveIcon size={16} />}
              loading={save.isPending}
              disabled={(!dirty && data.saved) || aiRunning}
              onClick={() => save.mutate({ sections, note: note.trim() || undefined })}
            >
              Guardar versión
            </Button>
          )}
          {d.status === 'BORRADOR' && !dirty && (
            <Button variant="secondary" loading={submit.isPending} onClick={() => submit.mutate()}>
              Enviar a revisión
            </Button>
          )}
        </div>
      </div>

      {readOnly && <Card><div className="p-4 text-sm text-slate-600">Este entregable está marcado como «no aplica»: el documento es de solo lectura.</div></Card>}
      {newer && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center gap-3">
          <span>Otra persona guardó la versión V{newer.deliverable.version}. Tus cambios siguen en pantalla y no se guardaron.</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              const ok = await askConfirm({ message: 'Cargar la versión nueva descarta tus cambios sin guardar. ¿Continuar?', tone: 'warning', confirmText: 'Cargar' });
              if (!ok) return;
              loadedFor.current = `${newer.deliverable.id}:${newer.baseVersion}:${newer.saved}`;
              adopt(newer);
            }}
          >
            Cargar la versión nueva
          </Button>
        </div>
      )}
      {data.saved && d.current === 'FILE' && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          El último archivo subido (V{d.version}) es más reciente que este documento (V{data.documentVersion}). Si guardas aquí, el documento
          pasa a ser lo vigente del entregable y el .zip llevará su PDF en lugar del archivo.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[210px_minmax(0,1fr)_320px] items-start">
        {/* Índice: a la izquierda en pantallas anchas; a la derecha, sobre la IA, en iPad horizontal */}
        <div className="order-1 lg:col-start-2 lg:row-start-1 xl:col-start-1">
        <Card>
          <nav className="p-3 xl:sticky xl:top-4" aria-label="Índice del documento">
            <div className="text-[11px] font-semibold tracking-wide text-slate-400 mb-2">ÍNDICE</div>
            <ul className="flex flex-col gap-0.5">
              {sections.map((s) => {
                const st = stateOf(s, saved);
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      aria-current={s.key === cur?.key ? 'true' : undefined}
                      onClick={() => {
                        setCurrent(s.key);
                        document.getElementById(`sec-${s.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className={`w-full text-left rounded-md px-2 py-1.5 text-sm flex items-start gap-2 border ${
                        s.key === cur?.key ? 'bg-[#eef3fb] border-[#9db4d8] font-semibold' : 'border-transparent hover:bg-slate-50'
                      }`}
                    >
                      <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: STATE_STYLE[st].dot }} aria-hidden />
                      <span className="min-w-0">
                        <span className="text-slate-500 mr-1">{s.num}</span>
                        {s.title}
                        {st !== 'COMPLETA' && <span className="block text-[11px] font-normal text-slate-400">{STATE_STYLE[st].label.toLowerCase()}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex flex-col gap-1 text-[11px] text-slate-500">
              {(Object.keys(STATE_STYLE) as SectionState[]).map((k) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: STATE_STYLE[k].dot }} /> {k === 'EDITADA' ? 'Editada en esta versión' : k === 'PENDIENTE' ? 'Pendiente de completar' : 'Completa'}
                </span>
              ))}
            </div>
          </nav>
        </Card>
        </div>

        {/* Documento o comparación */}
        <div className="order-3 flex flex-col gap-3 min-w-0 lg:col-start-1 lg:row-start-1 lg:row-span-2 xl:col-start-2 xl:row-span-1">
          {proposal ? (
            <ProposalView
              proposal={proposal}
              onToggle={(k) =>
                setProposal((p) => {
                  if (!p) return p;
                  const picked = new Set(p.picked);
                  if (picked.has(k)) picked.delete(k);
                  else picked.add(k);
                  return { ...p, picked };
                })
              }
              onReject={() => setProposal(null)}
              onAccept={acceptProposal}
              nextVersion={nextVersionLabel(baseVersion)}
              saving={save.isPending}
            />
          ) : (
            <>
              <Card>
                <div className="px-4 py-2.5 text-sm text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    <strong>Estás en:</strong> {cur ? `${cur.num} ${cur.title}` : '—'}
                  </span>
                  <span>
                    <strong>Cambios sin guardar:</strong> {changed.length ? changed.map((s) => `${s.num} ${s.title}`).join(' · ') : 'ninguno'}
                  </span>
                  <label className="ml-auto inline-flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Vista previa
                  </label>
                </div>
              </Card>
              {sections.map((s) => (
                <SectionEditor
                  key={s.key}
                  section={s}
                  state={stateOf(s, saved)}
                  selected={s.key === cur?.key}
                  preview={preview || readOnly}
                  readOnly={readOnly || locked}
                  canRemove={sections.length > 1}
                  onFocus={() => setCurrent(s.key)}
                  onChange={(p) => update(s.key, p)}
                  onRemove={async () => {
                    const ok = await askConfirm({ message: `¿Quitar la sección «${s.num} ${s.title}»? Se quita al guardar la versión.`, tone: 'danger', confirmText: 'Quitar' });
                    if (ok) setSections((list) => list.filter((x) => x.key !== s.key));
                  }}
                  attachments={data.attachments}
                  allSections={sections}
                  projectId={projectId}
                  deliverableId={deliverableId}
                  attachmentsEditable={data.attachmentsEditable}
                  onAttachmentsChanged={() => qc.invalidateQueries({ queryKey: key })}
                />
              ))}
              {!readOnly && (
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<PlusIcon size={14} />}
                    onClick={() => {
                      const k = newKey();
                      setSections((list) => [...list, { key: k, num: nextNum(list), title: 'Nueva sección', body: PENDING }]);
                      setCurrent(k);
                    }}
                  >
                    Agregar sección
                  </Button>
                </div>
              )}
              <AnnexList attachments={data.attachments} sections={sections} projectId={projectId} deliverableId={deliverableId} />
              {!readOnly && (
                <label className="text-xs text-slate-600 flex flex-col gap-1">
                  Nota de esta versión (opcional)
                  <input
                    className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                    maxLength={1000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Qué cambió, para el historial de revisiones"
                  />
                </label>
              )}
            </>
          )}
        </div>

        {/* Ajustar con IA */}
        {!readOnly && (
          <div className="order-2 lg:col-start-2 lg:row-start-2 xl:col-start-3 xl:row-start-1">
          <AiPanel
            current={cur}
            busyDisabled={!!proposal}
            onRun={async (scope, instruction) => {
              const r = await deliverableDocumentApi.aiAdjust(projectId, deliverableId, {
                scope,
                sectionKey: scope === 'SECTION' ? cur?.key : undefined,
                instruction,
                sections,
              });
              if (!r.changes.length) {
                toast.info('La IA no propuso cambios para ese pedido.');
                return;
              }
              setProposal({
                changes: r.changes,
                picked: new Set(r.changes.map((c) => c.key)),
                instruction,
                scopeLabel: scope === 'SECTION' && cur ? `${cur.num} ${cur.title}` : 'todo el documento',
              });
            }}
            projectId={projectId}
            deliverableId={deliverableId}
            onRunningChange={setAiRunning}
          />
          </div>
        )}
      </div>
    </div>
  );
}

function nextVersionLabel(v: string | null): string {
  const m = /^(\d+)\.(\d+)$/.exec(v ?? '');
  return m ? `V${m[1]}.${Number(m[2]) + 1}` : 'V0.1';
}

function Toolbar({ target, onChange }: { target: () => HTMLTextAreaElement | null; onChange: (v: string) => void }) {
  const apply = (fn: (el: HTMLTextAreaElement) => string) => {
    const el = target();
    if (el) onChange(fn(el));
  };
  const tools: { label: string; title: string; fn: (el: HTMLTextAreaElement) => string }[] = [
    { label: 'B', title: 'Negrita', fn: (el) => wrapSelection(el, '**', '**') },
    { label: 'I', title: 'Cursiva', fn: (el) => wrapSelection(el, '_', '_') },
    { label: 'Subtítulo', title: 'Subtítulo', fn: (el) => wrapSelection(el, '\n### ', '\n', 'Subtítulo') },
    { label: '• Lista', title: 'Lista', fn: (el) => wrapSelection(el, '\n- ', '\n', 'elemento') },
    {
      label: 'Tabla',
      title: 'Insertar tabla',
      fn: (el) => wrapSelection(el, '\n| Columna 1 | Columna 2 |\n| --- | --- |\n| ', ' | |\n', 'dato'),
    },
  ];
  return (
    <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Formato">
      {tools.map((t) => (
        <button
          key={t.title}
          type="button"
          title={t.title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply(t.fn)}
          className={`px-2 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50 ${t.label === 'B' ? 'font-bold' : ''} ${t.label === 'I' ? 'italic' : ''}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function SectionEditor(props: {
  section: DocSection;
  state: SectionState;
  selected: boolean;
  preview: boolean;
  readOnly: boolean;
  canRemove: boolean;
  onFocus: () => void;
  onChange: (p: Partial<DocSection>) => void;
  onRemove: () => void;
  attachments: DocAttachment[];
  allSections: DocSection[];
  projectId: number;
  deliverableId: number;
  attachmentsEditable: boolean;
  onAttachmentsChanged: () => void;
}) {
  const { section: s, state } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const kind = sectionKind(s.title, s.body);
  const [asText, setAsText] = useState(false);
  const participantsBody = props.allSections.find((x) => sectionKind(x.title, x.body) === 'PARTICIPANTS')?.body ?? null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const mine = props.attachments.filter((a) => a.sectionKey === s.key);
  const numbering = useMemo(() => numberAll(props.allSections, props.attachments), [props.allSections, props.attachments]);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.max(90, el.scrollHeight + 2)}px`;
    }
  }, [s.body, props.preview]);

  return (
    <section
      id={`sec-${s.key}`}
      onFocusCapture={props.onFocus}
      onClick={props.onFocus}
      className={`rounded-xl border bg-white p-4 scroll-mt-4 ${props.selected ? 'border-[#9db4d8] ring-2 ring-[#9db4d8]/40' : 'border-slate-200'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Número de la sección"
          className="w-14 text-sm font-semibold text-slate-500 border border-transparent hover:border-slate-200 rounded px-1 py-0.5"
          value={s.num}
          maxLength={10}
          readOnly={props.readOnly}
          onChange={(e) => props.onChange({ num: e.target.value })}
        />
        <input
          aria-label="Título de la sección"
          className="flex-1 min-w-[160px] text-base font-semibold text-slate-900 border border-transparent hover:border-slate-200 rounded px-1 py-0.5"
          value={s.title}
          maxLength={200}
          readOnly={props.readOnly}
          onChange={(e) => props.onChange({ title: e.target.value })}
        />
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <span className="w-2 h-2 rounded-full" style={{ background: STATE_STYLE[state].dot }} /> {STATE_STYLE[state].label}
        </span>
        {!props.readOnly && props.canRemove && (
          <button type="button" title="Quitar sección" onClick={props.onRemove} className="text-slate-400 hover:text-red-600 p-1">
            <TrashIcon size={15} />
          </button>
        )}
      </div>

      {kind === 'SCHEDULE' && (
        <ScheduleTools
          rows={parseSchedule(s.body) ?? []}
          body={s.body}
          readOnly={props.readOnly || props.preview}
          projectId={props.projectId}
          deliverableId={props.deliverableId}
          onBody={(body) => props.onChange({ body })}
        />
      )}
      {kind === 'PARTICIPANTS' && <ParticipantsTools projectId={props.projectId} readOnly={props.readOnly || props.preview} body={s.body} onBody={(body) => props.onChange({ body })} />}
      {kind === 'ROLES' && (
        <RolesTools participantsBody={participantsBody} readOnly={props.readOnly || props.preview} body={s.body} onBody={(body) => props.onChange({ body })} />
      )}

      {kind === 'SCHEDULE' && !props.preview && (
        <button type="button" className="mt-2 text-[11px] text-slate-500 hover:underline" onClick={() => setAsText((v) => !v)}>
          {asText ? 'Ocultar el texto del cronograma' : 'Editar como texto (notas antes o después de la tabla)'}
        </button>
      )}

      <div className={`mt-2 ${kind === 'SCHEDULE' && !asText && !props.preview ? 'hidden' : ''}`}>
        {props.preview ? (
          <div className="prose-sm text-slate-800">
            <MarkdownPreview source={s.body} />
          </div>
        ) : (
          <>
            {!props.readOnly && <Toolbar target={() => ref.current} onChange={(v) => props.onChange({ body: v })} />}
            <textarea
              ref={ref}
              aria-label={`Contenido de ${s.num} ${s.title}`}
              className={`mt-1.5 w-full border border-slate-200 rounded-md px-3 py-2 text-sm leading-relaxed font-[inherit] ${state === 'PENDIENTE' ? 'text-amber-800' : 'text-slate-800'}`}
              value={s.body}
              maxLength={50000}
              readOnly={props.readOnly}
              onChange={(e) => props.onChange({ body: e.target.value })}
            />
          </>
        )}
      </div>

      {mine.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          {mine.map((a) => (
            <AttachmentItem
              key={a.id}
              a={a}
              label={a.place === 'INLINE' ? `Figura ${numbering.get(a.id)}` : `Anexo ${numbering.get(a.id)}`}
              editable={props.attachmentsEditable}
              projectId={props.projectId}
              deliverableId={props.deliverableId}
              onChanged={props.onAttachmentsChanged}
            />
          ))}
        </div>
      )}

      {props.attachmentsEditable && !props.readOnly && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setUploading(true);
              try {
                const blob = f.type === 'image/png' && f.size < 1_500_000 ? f : await compressPhoto(f);
                await deliverableDocumentApi.addAttachment(props.projectId, props.deliverableId, { file: blob, sectionKey: s.key, place: 'INLINE' });
                props.onAttachmentsChanged();
              } catch (err) {
                toast.error(errorText(err, 'No se pudo adjuntar la imagen.'));
              } finally {
                setUploading(false);
              }
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="mt-3 text-xs text-kubo-primary hover:underline disabled:opacity-50"
          >
            {uploading ? 'Subiendo imagen…' : `+ Adjuntar imagen o evidencia a ${s.num || s.title}`}
          </button>
        </>
      )}
    </section>
  );
}

/** Numeración de figuras y anexos igual que en el PDF: por orden de sección, luego posición. */
function numberAll(sections: DocSection[], attachments: DocAttachment[]): Map<number, number> {
  const order = new Map(sections.map((s, i) => [s.key, i]));
  const sorted = attachments
    .filter((a) => order.has(a.sectionKey))
    .sort((x, y) => order.get(x.sectionKey)! - order.get(y.sectionKey)! || x.position - y.position);
  const out = new Map<number, number>();
  let fig = 0;
  let anx = 0;
  for (const a of sorted) out.set(a.id, a.place === 'INLINE' ? ++fig : ++anx);
  return out;
}

function AttachmentItem({
  a,
  label,
  editable,
  projectId,
  deliverableId,
  onChanged,
}: {
  a: DocAttachment;
  label: string;
  editable: boolean;
  projectId: number;
  deliverableId: number;
  onChanged: () => void;
}) {
  const url = useAuthedImage(a.place === 'INLINE' ? deliverableDocumentApi.imagePath(projectId, deliverableId, a.id) : null);
  const [caption, setCaption] = useState(a.caption ?? '');
  useEffect(() => setCaption(a.caption ?? ''), [a.caption]);
  const patch = async (p: { caption?: string | null; place?: 'INLINE' | 'ANEXO' }) => {
    try {
      await deliverableDocumentApi.updateAttachment(projectId, deliverableId, a.id, p);
      onChanged();
    } catch (e) {
      toast.error(errorText(e, 'No se pudo actualizar la imagen.'));
    }
  };
  if (a.place === 'ANEXO') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm rounded-md bg-slate-50 px-3 py-2">
        <span className="text-slate-600">
          Ver {label} · {a.caption || 'sin leyenda'}
        </span>
        {editable && (
          <button type="button" className="text-xs text-kubo-primary hover:underline" onClick={() => patch({ place: 'INLINE' })}>
            Mostrar aquí
          </button>
        )}
      </div>
    );
  }
  return (
    <figure className="rounded-lg border border-slate-200 p-2">
      {url ? <img src={url} alt={a.caption ?? label} className="max-h-72 mx-auto rounded" /> : <div className="h-32 bg-slate-100 rounded animate-pulse" />}
      <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-slate-600">{label}.</span>
        <input
          className="flex-1 min-w-[160px] border border-slate-200 rounded px-2 py-1"
          value={caption}
          maxLength={500}
          readOnly={!editable}
          placeholder="Escribe aquí qué muestra la imagen"
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => caption !== (a.caption ?? '') && patch({ caption })}
        />
        {editable && (
          <>
            <button type="button" className="text-kubo-primary hover:underline" onClick={() => patch({ place: 'ANEXO' })}>
              Mover a anexos
            </button>
            <button
              type="button"
              className="text-red-600 hover:underline"
              onClick={async () => {
                if (!(await askConfirm({ message: '¿Quitar esta imagen del documento?', tone: 'danger', confirmText: 'Quitar' }))) return;
                try {
                  await deliverableDocumentApi.removeAttachment(projectId, deliverableId, a.id);
                  onChanged();
                } catch (e) {
                  toast.error(errorText(e, 'No se pudo quitar la imagen.'));
                }
              }}
            >
              Quitar
            </button>
          </>
        )}
      </figcaption>
    </figure>
  );
}

function AnnexList({ attachments, sections, projectId, deliverableId }: { attachments: DocAttachment[]; sections: DocSection[]; projectId: number; deliverableId: number }) {
  const numbering = numberAll(sections, attachments);
  const annexes = attachments
    .filter((a) => a.place === 'ANEXO' && numbering.has(a.id))
    .sort((x, y) => numbering.get(x.id)! - numbering.get(y.id)!);
  if (!annexes.length) return null;
  return (
    <Card>
      <div className="p-4">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Anexos</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {annexes.map((a) => {
            const from = sections.find((s) => s.key === a.sectionKey);
            return <AnnexThumb key={a.id} a={a} n={numbering.get(a.id)!} from={from?.num || from?.title || ''} projectId={projectId} deliverableId={deliverableId} />;
          })}
        </div>
      </div>
    </Card>
  );
}

function AnnexThumb({ a, n, from, projectId, deliverableId }: { a: DocAttachment; n: number; from: string; projectId: number; deliverableId: number }) {
  const url = useAuthedImage(deliverableDocumentApi.imagePath(projectId, deliverableId, a.id));
  return (
    <figure className="rounded-lg border border-slate-200 p-2">
      {url ? <img src={url} alt={a.caption ?? `Anexo ${n}`} className="max-h-48 mx-auto rounded" /> : <div className="h-24 bg-slate-100 rounded" />}
      <figcaption className="mt-1 text-xs text-slate-600">
        Anexo {n} (de {from}). {a.caption}
      </figcaption>
    </figure>
  );
}

function AiPanel({
  current,
  busyDisabled,
  onRun,
  projectId,
  deliverableId,
  onRunningChange,
}: {
  current: DocSection | undefined;
  busyDisabled: boolean;
  onRun: (scope: 'SECTION' | 'DOCUMENT', instruction: string) => Promise<void>;
  projectId: number;
  deliverableId: number;
  onRunningChange: (running: boolean) => void;
}) {
  const [scope, setScope] = useState<'SECTION' | 'DOCUMENT'>('SECTION');
  const [instruction, setInstruction] = useState(AI_PRESETS[0]);
  const [running, setRunning] = useState(false);
  const history = useQuery({
    queryKey: ['expediente', projectId, 'history', deliverableId],
    queryFn: () => expedienteApi.history(projectId, deliverableId),
  });
  const run = async () => {
    if (!instruction.trim()) return;
    setRunning(true);
    onRunningChange(true);
    try {
      await onRun(scope, instruction.trim());
    } catch (e) {
      toast.error(errorText(e, 'La IA no respondió. Revisa el proveedor de IA activo e inténtalo de nuevo.'));
    } finally {
      setRunning(false);
      onRunningChange(false);
    }
  };
  const versions = (history.data ?? []).filter((h) => h.action === 'E' || h.action === 'A').slice(-6).reverse();
  return (
    <Card>
      <div className="p-4 flex flex-col gap-3 xl:sticky xl:top-4">
        <div className="flex items-center gap-2 text-slate-900 font-semibold">
          <SparklesIcon size={16} className="text-purple-600" /> Ajustar con IA
        </div>
        <p className="text-xs text-slate-500">Pide un cambio y revisa el antes y después antes de aceptarlo. Nada se guarda sin tu aprobación.</p>
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Aplicar a">
          <div className="text-[11px] font-semibold tracking-wide text-slate-400">APLICAR A</div>
          {(['SECTION', 'DOCUMENT'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={scope === k}
              onClick={() => setScope(k)}
              className={`text-left text-sm rounded-md border px-3 py-2 ${scope === k ? 'bg-[#eef3fb] border-[#9db4d8]' : 'bg-white border-slate-200'}`}
            >
              {k === 'SECTION' ? `Esta sección: ${current ? `${current.num} ${current.title}` : '—'}` : 'Todo el documento'}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {AI_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setInstruction(p)}
              className={`text-xs rounded-full border px-2.5 py-1 ${instruction === p ? 'bg-[#e6edf8] border-[#9db4d8] text-[#012660]' : 'bg-white border-slate-300 text-slate-700'}`}
            >
              {p}
            </button>
          ))}
        </div>
        <label className="text-xs text-slate-600 flex flex-col gap-1">
          O escríbelo
          <textarea
            rows={2}
            maxLength={500}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </label>
        <Button icon={<SparklesIcon size={16} />} loading={running} disabled={busyDisabled || !instruction.trim()} onClick={run}>
          Ver antes y después
        </Button>
        {versions.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold tracking-wide text-slate-400 mb-1">VERSIONES</div>
            <ul className="text-xs text-slate-600 flex flex-col gap-1">
              {versions.map((h) => (
                <li key={h.id}>
                  <span className="font-medium">V{h.version}</span> · {h.note || h.actionLabel} · {h.actorName ?? '—'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function ProposalView({
  proposal,
  onToggle,
  onReject,
  onAccept,
  nextVersion,
  saving,
}: {
  proposal: { changes: AiChange[]; picked: Set<string>; instruction: string; scopeLabel: string };
  onToggle: (key: string) => void;
  onReject: () => void;
  onAccept: () => void;
  nextVersion: string;
  saving: boolean;
}) {
  const n = proposal.picked.size;
  return (
    <Card>
      <div className="p-4 flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Antes y después · {proposal.scopeLabel}</h2>
          <p className="text-sm text-slate-600">Pedido: «{proposal.instruction}»</p>
          <p className="text-xs text-slate-500 mt-1">
            <span className="line-through text-red-700 bg-red-50 px-1">quitado</span> ·{' '}
            <span className="text-emerald-800 bg-emerald-50 px-1">agregado</span>
          </p>
        </div>
        {proposal.changes.map((c) => (
          <div key={c.key} className="rounded-lg border border-slate-200">
            <label className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 text-sm font-medium text-slate-800 cursor-pointer">
              <input type="checkbox" checked={proposal.picked.has(c.key)} onChange={() => onToggle(c.key)} />
              {c.num} {c.title}
            </label>
            <div className="px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
              {c.diff.map((op, i) =>
                op.op === 'eq' ? (
                  <span key={i}>{op.text}</span>
                ) : op.op === 'del' ? (
                  <del key={i} className="text-red-700 bg-red-50">
                    {op.text}
                  </del>
                ) : (
                  <ins key={i} className="no-underline text-emerald-800 bg-emerald-50">
                    {op.text}
                  </ins>
                ),
              )}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="ghost" onClick={onReject} disabled={saving}>
            Rechazar
          </Button>
          <Button onClick={onAccept} loading={saving} disabled={n === 0}>
            {n === proposal.changes.length ? 'Aceptar' : `Aceptar ${n} de ${proposal.changes.length}`} (crea {nextVersion})
          </Button>
        </div>
      </div>
    </Card>
  );
}

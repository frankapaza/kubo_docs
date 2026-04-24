import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientsApi } from '../api/clients.api';
import { documentsApi, templatesApi } from '../api/documents.api';
import {
  COMMERCIAL_DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  type TemplateVariable,
} from '../api/types';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { DocumentSignatoriesCard } from '../components/DocumentSignatoriesCard';
import {
  ArrowLeftIcon,
  CheckIcon,
  DownloadIcon,
  FileTextIcon,
  PenIcon,
  PrinterIcon,
  SaveIcon,
  SendIcon,
  SparklesIcon,
} from '../components/ui/Icon';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';

/**
 * Página dual:
 *  - /documents/new?clientId=X&templateId=Y → crea un documento nuevo
 *  - /documents/:id → edita un documento existente
 */
export default function DocumentEditorPage() {
  const { documentId } = useParams();
  const isNew = documentId === 'new';
  const docIdNum = !isNew && documentId ? Number(documentId) : null;

  if (isNew) return <CreateDocumentFlow />;
  if (docIdNum) return <EditExistingDocument id={docIdNum} />;
  return <Navigate to="/clients" replace />;
}

function CreateDocumentFlow() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const clientIdParam = searchParams.get('clientId');
  const templateIdParam = searchParams.get('templateId');

  const [selectedClientId, setSelectedClientId] = useState<number | ''>(
    clientIdParam ? Number(clientIdParam) : '',
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>(
    templateIdParam ? Number(templateIdParam) : '',
  );
  const [title, setTitle] = useState('');
  const [variables, setVariables] = useState<Record<string, string | number>>({});
  const variablesCardRef = useRef<HTMLDivElement>(null);

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => clientsApi.list(),
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['document-templates'],
    queryFn: () => templatesApi.list(false),
  });

  const selectedTemplate = useMemo(() => {
    if (selectedTemplateId === '') return null;
    // MySQL devuelve BIGINT como string, normalizamos ambos lados
    return templates.find((t) => Number(t.id) === Number(selectedTemplateId)) ?? null;
  }, [templates, selectedTemplateId]);

  // Pre-populate title and default variable values when template changes
  useEffect(() => {
    if (!selectedTemplate) return;
    if (!title.trim()) {
      setTitle(selectedTemplate.name);
    }
    const defaults: Record<string, string | number> = {};
    selectedTemplate.variablesSchema.variables.forEach((v) => {
      if (v.defaultValue !== undefined && v.defaultValue !== null) {
        defaults[v.key] = v.defaultValue;
      }
    });
    setVariables((prev) => ({ ...defaults, ...prev }));
    // Scroll al panel de variables para que el usuario los vea
    setTimeout(() => {
      variablesCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate?.id]);

  const create = useMutation({
    mutationFn: () => {
      const payload = {
        clientId: selectedClientId as number,
        templateId: selectedTemplateId as number,
        title,
        variables,
      };
      console.log('[DocumentEditor] Payload que envío:', payload);
      return documentsApi.create(payload);
    },
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ['client-documents'] });
      navigate(`/documents/${doc.id}`);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo generar el documento'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedClientId || !selectedTemplateId) return;
    create.mutate();
  };

  // Variables visibles (no las auto-rellenadas por el backend desde el cliente)
  const visibleVariables = selectedTemplate
    ? selectedTemplate.variablesSchema.variables.filter(
        (v) => v.source === 'manual' || v.source === 'ai',
      )
    : [];

  const isEmpty = (val: string | number | undefined) =>
    val === undefined || val === null || String(val).trim() === '';

  const requiredManual = visibleVariables.filter((v) => v.required);
  const filledRequired = requiredManual.filter((v) => !isEmpty(variables[v.key]));
  const allRequiredFilled = filledRequired.length === requiredManual.length;

  return (
    <div className="space-y-5">
      <div>
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeftIcon size={14} />
          Volver
        </button>
        <h1 className="text-2xl font-bold text-slate-900 mt-3">Generar documento</h1>
        <p className="text-sm text-slate-500 mt-1">
          Elige cliente, plantilla y completa los datos. Los campos del cliente (razón social,
          RUC, representante) se llenan automáticamente.
        </p>
      </div>

      <form onSubmit={submit}>
        <Card>
          <CardHeader icon={<FileTextIcon size={18} />} title="Datos básicos" />
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Cliente *</label>
                <select
                  className="input"
                  value={selectedClientId}
                  onChange={(e) =>
                    setSelectedClientId(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  required
                >
                  <option value="">Selecciona un cliente…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.razonSocial}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Plantilla *</label>
                <select
                  className="input"
                  value={selectedTemplateId}
                  onChange={(e) =>
                    setSelectedTemplateId(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  required
                >
                  <option value="">Selecciona una plantilla…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {DOCUMENT_TYPE_LABELS[t.type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="label">Título del documento *</label>
                <input
                  className="input"
                  placeholder="Ej: Cotización KUBO - Kubo Soluciones Mar 2026"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>
            </div>
          </CardBody>
        </Card>

        {selectedTemplate && visibleVariables.length > 0 && (
          <div ref={variablesCardRef}>
            <Card className="mt-4 border-2 border-kubo-primary/30">
              <CardHeader
                icon={<SparklesIcon size={18} />}
                title="Variables a completar"
                subtitle="Los datos del cliente se llenan automáticamente. Completa aquí los valores específicos de este documento."
                action={
                  requiredManual.length > 0 ? (
                    <span
                      className={`text-xs font-semibold px-3 py-1 rounded-full ${
                        allRequiredFilled
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {filledRequired.length} / {requiredManual.length} requeridas
                    </span>
                  ) : undefined
                }
              />
              <CardBody>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {visibleVariables.map((v) => {
                    const empty = isEmpty(variables[v.key]);
                    const showError = v.required && empty;
                    return (
                      <VariableInput
                        key={v.key}
                        variable={v}
                        value={variables[v.key] ?? ''}
                        highlight={showError}
                        onChange={(val) => setVariables((prev) => ({ ...prev, [v.key]: val }))}
                      />
                    );
                  })}
                </div>
              </CardBody>
            </Card>
          </div>
        )}

        <div className="flex items-center gap-2 mt-5">
          <Button
            type="submit"
            icon={<SaveIcon size={16} />}
            loading={create.isPending}
            disabled={!selectedClientId || !selectedTemplateId || !allRequiredFilled}
          >
            Generar documento
          </Button>
          <Button variant="ghost" onClick={() => navigate(-1)}>
            Cancelar
          </Button>
          {selectedTemplate && !allRequiredFilled && (
            <span className="text-xs text-amber-700 ml-2">
              Completa las variables requeridas antes de generar.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function EditExistingDocument({ id }: { id: number }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [contentMarkdown, setContentMarkdown] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);

  const { data: doc, isLoading } = useQuery({
    queryKey: ['commercial-document', id],
    queryFn: () => documentsApi.findOne(id),
  });

  const { data: client } = useQuery({
    queryKey: ['client', doc?.clientId],
    queryFn: () => clientsApi.findOne(doc!.clientId),
    enabled: !!doc?.clientId,
  });

  useEffect(() => {
    if (doc?.contentMarkdown) setContentMarkdown(doc.contentMarkdown);
  }, [doc?.contentMarkdown]);

  const save = useMutation({
    mutationFn: () => documentsApi.update(id, { contentMarkdown }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commercial-document', id] });
      qc.invalidateQueries({ queryKey: ['client-documents'] });
      setMode('preview');
    },
  });

  const markSent = useMutation({
    mutationFn: () => documentsApi.update(id, { status: 'SENT' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['commercial-document', id] }),
  });

  const markSigned = useMutation({
    mutationFn: () => documentsApi.update(id, { status: 'SIGNED' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commercial-document', id] });
      toast.success('Documento cerrado y bloqueado.');
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo cerrar el documento.'),
  });

  if (isLoading || !doc) {
    return (
      <Card>
        <div className="p-12 text-center text-sm text-slate-400">Cargando documento…</div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          to={client ? `/clients/${client.id}` : '/clients'}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeftIcon size={14} />
          {client ? `Volver a ${client.razonSocial}` : 'Volver a clientes'}
        </Link>
        <div className="flex items-start justify-between flex-wrap gap-3 mt-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{doc.title}</h1>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge tone="info">{DOCUMENT_TYPE_LABELS[doc.type]}</Badge>
              <StatusBadge status={doc.status} />
              <span className="text-xs text-slate-500">Versión {doc.version}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'preview' ? (
              <Button
                size="sm"
                variant="secondary"
                icon={<PenIcon size={14} />}
                onClick={() => setMode('edit')}
                disabled={doc.status === 'SIGNED'}
              >
                Editar contenido
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  icon={<SaveIcon size={14} />}
                  loading={save.isPending}
                  onClick={() => save.mutate()}
                >
                  Guardar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setContentMarkdown(doc.contentMarkdown);
                    setMode('preview');
                  }}
                >
                  Cancelar
                </Button>
              </>
            )}
            {doc.status === 'DRAFT' && mode === 'preview' && (
              <Button
                size="sm"
                variant="primary"
                icon={<SendIcon size={14} />}
                loading={markSent.isPending}
                onClick={() => markSent.mutate()}
              >
                Marcar como enviado
              </Button>
            )}
            {doc.status === 'SENT' && mode === 'preview' && (
              <Button
                size="sm"
                variant="success"
                icon={<CheckIcon size={14} />}
                loading={markSigned.isPending}
                onClick={async () => {
                  const ok = await askConfirm({
                    title: 'Cerrar documento',
                    message:
                      'El documento quedará bloqueado para edición. Asegúrate de haber registrado la conformidad de todos los firmantes antes de continuar.',
                    confirmText: 'Sí, cerrar',
                    tone: 'warning',
                  });
                  if (ok) markSigned.mutate();
                }}
              >
                Cerrar documento
              </Button>
            )}
            {mode === 'preview' && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<DownloadIcon size={14} />}
                  onClick={() => {
                    const safeTitle = doc.title.replace(/[^a-z0-9áéíóúñ\s-]/gi, '').trim().slice(0, 80) || `documento-${doc.id}`;
                    documentsApi.downloadPdf(doc.id, `${safeTitle}.pdf`);
                    toast.success('Descargando PDF…');
                  }}
                >
                  Descargar PDF
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<SendIcon size={14} />}
                  onClick={() => setEmailOpen(true)}
                >
                  Enviar por correo
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<PrinterIcon size={14} />}
                  onClick={() => window.print()}
                >
                  Imprimir
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardBody className="p-0">
          {mode === 'preview' ? (
            <div className="px-8 py-8">
              <MarkdownPreview source={doc.contentMarkdown} />
            </div>
          ) : (
            <textarea
              className="w-full min-h-[600px] px-6 py-5 font-mono text-sm border-0 focus:outline-none resize-y"
              value={contentMarkdown}
              onChange={(e) => setContentMarkdown(e.target.value)}
            />
          )}
        </CardBody>
      </Card>

      <DocumentSignatoriesCard documentId={id} />

      {emailOpen && (
        <EmailModal
          doc={doc}
          defaultTo={client?.contactEmail ?? ''}
          onClose={() => setEmailOpen(false)}
          onSent={() => {
            setEmailOpen(false);
            qc.invalidateQueries({ queryKey: ['commercial-document', id] });
          }}
        />
      )}


    </div>
  );

}

function EmailModal({
  doc,
  defaultTo,
  onClose,
  onSent,
}: {
  doc: import('../api/types').CommercialDocument;
  defaultTo: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const send = useMutation({
    mutationFn: () =>
      documentsApi.sendEmail(doc.id, {
        to: to.trim(),
        cc: cc.trim() || undefined,
        subject: subject.trim() || undefined,
        message: message.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success(`Correo enviado a ${to}`);
      onSent();
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo enviar el correo'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.trim()) return;
    send.mutate();
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 animate-[fadeIn_.15s_ease-out]">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full animate-[scaleIn_.18s_ease-out]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-kubo-primary-light flex items-center justify-center">
              <SendIcon size={18} className="text-kubo-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Enviar por correo</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                El PDF del documento se adjunta automáticamente.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-3">
          <div>
            <label className="label">Para *</label>
            <input
              type="email"
              className="input"
              placeholder="cliente@empresa.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label">Con copia (opcional)</label>
            <input
              type="email"
              className="input"
              placeholder="colega@empresa.com"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Asunto (opcional)</label>
            <input
              className="input"
              placeholder={`Se generará automáticamente a partir del título`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Mensaje personal (opcional)</label>
            <textarea
              className="input"
              rows={4}
              placeholder="Escribe un mensaje que se incluirá en el cuerpo del correo junto al documento adjunto."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">
              El correo incluye un cuerpo HTML diseñado con el membrete del emisor.
              Este mensaje se agrega como bloque destacado al inicio del cuerpo.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button type="submit" icon={<SendIcon size={14} />} loading={send.isPending}>
              Enviar correo
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}


function StatusBadge({ status }: { status: import('../api/types').CommercialDocumentStatus }) {
  const tone = ({
    DRAFT: 'neutral',
    SENT: 'info',
    SIGNED: 'success',
    EXPIRED: 'warning',
    CANCELLED: 'danger',
  } as const)[status];
  return <Badge tone={tone} dot>{COMMERCIAL_DOCUMENT_STATUS_LABELS[status]}</Badge>;
}

function VariableInput({
  variable,
  value,
  onChange,
  highlight,
}: {
  variable: TemplateVariable;
  value: string | number;
  onChange: (v: string | number) => void;
  highlight?: boolean;
}) {
  const inputClassName = `input ${highlight ? 'border-amber-400 ring-1 ring-amber-200' : ''}`;
  const common = {
    className: inputClassName,
    placeholder: variable.label,
    required: variable.required,
  };

  if (variable.type === 'longtext') {
    const stringValue = value === '' ? '' : String(value);
    return (
      <div className="md:col-span-2">
        <label className="label">
          {variable.label}
          {variable.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Markdown (edición)
            </p>
            <textarea
              {...common}
              className={`${inputClassName} font-mono text-sm`}
              rows={10}
              value={stringValue}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
          <div>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Vista previa
            </p>
            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/60 min-h-[240px] overflow-auto">
              {stringValue.trim() ? (
                <MarkdownPreview source={stringValue} />
              ) : (
                <p className="text-xs text-slate-400 italic">
                  Escribe en el editor para ver cómo se verá el resultado.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="label">
        {variable.label}
        {variable.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        {...common}
        type={variable.type === 'date' ? 'date' : variable.type === 'number' ? 'number' : variable.type === 'email' ? 'email' : 'text'}
        value={value === '' ? '' : String(value)}
        onChange={(e) =>
          onChange(variable.type === 'number' ? Number(e.target.value) : e.target.value)
        }
      />
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { templatesApi, UpsertTemplateBody } from '../api/documents.api';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  type DocumentType,
  type TemplateVariable,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { canManageUsers } from '../auth/permissions';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { MarkdownPreview } from '../components/MarkdownPreview';
import {
  ArrowLeftIcon,
  CheckIcon,
  FileTextIcon,
  PenIcon,
  PlusIcon,
  SaveIcon,
  XIcon,
} from '../components/ui/Icon';
import { toast } from '../ui/Toast';

const EMPTY_TEMPLATE: UpsertTemplateBody = {
  name: '',
  type: 'OTHER',
  description: '',
  contentMarkdown: '# Nueva plantilla\n\nContenido del documento con {{variable_ejemplo}}.',
  variablesSchema: { variables: [] },
  isActive: true,
};

export default function TemplatesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);

  if (!canManageUsers(user)) return <Navigate to="/" replace />;

  const { data: templates = [] } = useQuery({
    queryKey: ['document-templates', 'all'],
    queryFn: () => templatesApi.list(true),
  });

  if (editingId !== null) {
    return (
      <TemplateEditor
        id={editingId === 'new' ? null : editingId}
        onClose={() => {
          setEditingId(null);
          qc.invalidateQueries({ queryKey: ['document-templates'] });
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Plantillas de documentos</h1>
          <p className="text-sm text-slate-500 mt-1">
            Plantillas reutilizables de contratos, cotizaciones, NDAs y otros documentos. Se
            aplican al generar documentos comerciales para un cliente.
          </p>
        </div>
        <Button icon={<PlusIcon size={16} />} onClick={() => setEditingId('new')}>
          Nueva plantilla
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => setEditingId(t.id)}
            className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:shadow-pop hover:border-indigo-200 transition"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <FileTextIcon size={16} className="text-slate-400" />
                <h3 className="font-semibold text-slate-900 line-clamp-1">{t.name}</h3>
              </div>
              <Badge tone={t.isActive ? 'success' : 'neutral'}>
                {t.isActive ? 'Activa' : 'Inactiva'}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-xs mb-2">
              <Badge tone="info">{DOCUMENT_TYPE_LABELS[t.type]}</Badge>
              <span className="text-slate-400">
                {t.variablesSchema.variables.length} variable
                {t.variablesSchema.variables.length !== 1 ? 's' : ''}
              </span>
            </div>
            {t.description && (
              <p className="text-xs text-slate-500 line-clamp-2">{t.description}</p>
            )}
          </button>
        ))}
      </div>

      {templates.length === 0 && (
        <Card>
          <CardBody>
            <div className="py-12 text-center text-sm text-slate-400">
              Aún no hay plantillas. Crea la primera para empezar.
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function TemplateEditor({ id, onClose }: { id: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = id === null;

  const { data: existing } = useQuery({
    queryKey: ['document-template', id],
    queryFn: () => templatesApi.findOne(id as number),
    enabled: !isNew,
  });

  const [form, setForm] = useState<UpsertTemplateBody>(EMPTY_TEMPLATE);
  const [previewMode, setPreviewMode] = useState<'edit' | 'preview'>('edit');

  useEffect(() => {
    if (!isNew && existing) {
      setForm({
        name: existing.name,
        type: existing.type,
        description: existing.description ?? '',
        contentMarkdown: existing.contentMarkdown,
        variablesSchema: existing.variablesSchema,
        isActive: existing.isActive === 1,
      });
    }
  }, [existing, isNew]);

  const save = useMutation({
    mutationFn: () => {
      if (isNew) return templatesApi.create(form);
      return templatesApi.update(id as number, form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] });
      onClose();
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo guardar la plantilla'),
  });

  const addVariable = () => {
    setForm({
      ...form,
      variablesSchema: {
        variables: [
          ...form.variablesSchema.variables,
          {
            key: `variable_${form.variablesSchema.variables.length + 1}`,
            label: 'Nueva variable',
            type: 'text',
            source: 'manual',
            required: false,
          },
        ],
      },
    });
  };

  const updateVariable = (idx: number, patch: Partial<TemplateVariable>) => {
    const vars = [...form.variablesSchema.variables];
    vars[idx] = { ...vars[idx], ...patch };
    setForm({ ...form, variablesSchema: { variables: vars } });
  };

  const removeVariable = (idx: number) => {
    const vars = [...form.variablesSchema.variables];
    vars.splice(idx, 1);
    setForm({ ...form, variablesSchema: { variables: vars } });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Button size="sm" variant="ghost" icon={<ArrowLeftIcon size={14} />} onClick={onClose}>
          Volver a plantillas
        </Button>
        <div className="flex items-center gap-2">
          <Button
            icon={<SaveIcon size={14} />}
            onClick={() => save.mutate()}
            loading={save.isPending}
          >
            {isNew ? 'Crear plantilla' : 'Guardar cambios'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader
          icon={<PenIcon size={18} />}
          title={isNew ? 'Nueva plantilla' : `Editar plantilla: ${form.name}`}
          subtitle="Los placeholders en el contenido usan la forma {{nombre_variable}}"
        />
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_140px] gap-3 mb-4">
            <div>
              <label className="label">Nombre *</label>
              <input
                className="input"
                placeholder="Ej: Cotización KUBO"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Tipo</label>
              <select
                className="input"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as DocumentType })}
              >
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Activa</label>
              <label className="flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-300 bg-white">
                <input
                  type="checkbox"
                  checked={form.isActive !== false}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <span className="text-xs text-slate-600">Visible al crear documentos</span>
              </label>
            </div>
          </div>

          <div className="mb-4">
            <label className="label">Descripción</label>
            <input
              className="input"
              placeholder="Breve descripción del propósito de esta plantilla"
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Variables"
          subtitle="Campos que se rellenan al generar el documento. Úsalos como {{clave}} en el contenido."
          action={
            <Button size="sm" variant="secondary" icon={<PlusIcon size={14} />} onClick={addVariable}>
              Agregar variable
            </Button>
          }
        />
        <CardBody>
          {form.variablesSchema.variables.length === 0 ? (
            <p className="text-sm text-slate-400 italic py-6 text-center">
              Sin variables declaradas. Agrega al menos una si tu plantilla usa placeholders.
            </p>
          ) : (
            <div className="space-y-2">
              {form.variablesSchema.variables.map((v, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_100px_110px_90px_40px] gap-2 items-center border border-slate-200 rounded-lg p-2"
                >
                  <input
                    className="input font-mono text-xs"
                    placeholder="clave_variable"
                    value={v.key}
                    onChange={(e) =>
                      updateVariable(idx, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') })
                    }
                  />
                  <input
                    className="input text-xs"
                    placeholder="Etiqueta legible"
                    value={v.label}
                    onChange={(e) => updateVariable(idx, { label: e.target.value })}
                  />
                  <select
                    className="input text-xs"
                    value={v.type}
                    onChange={(e) =>
                      updateVariable(idx, { type: e.target.value as TemplateVariable['type'] })
                    }
                  >
                    <option value="text">texto</option>
                    <option value="longtext">texto largo</option>
                    <option value="number">número</option>
                    <option value="date">fecha</option>
                    <option value="email">email</option>
                  </select>
                  <select
                    className="input text-xs"
                    value={v.source}
                    onChange={(e) =>
                      updateVariable(idx, { source: e.target.value as TemplateVariable['source'] })
                    }
                  >
                    <option value="manual">manual</option>
                    <option value="client">del cliente</option>
                    <option value="auto">auto</option>
                    <option value="ai">IA</option>
                  </select>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={v.required}
                      onChange={(e) => updateVariable(idx, { required: e.target.checked })}
                    />
                    req.
                  </label>
                  <button
                    onClick={() => removeVariable(idx)}
                    className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                  >
                    <XIcon size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Contenido Markdown"
          subtitle="Usa {{clave_variable}} para insertar valores al generar el documento."
          action={
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
              {(['edit', 'preview'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPreviewMode(m)}
                  className={`px-3 py-1 rounded-md transition ${
                    previewMode === m
                      ? 'bg-kubo-primary-light text-kubo-primary-dark'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {m === 'edit' ? 'Editor' : 'Vista previa'}
                </button>
              ))}
            </div>
          }
        />
        <CardBody className="p-0">
          {previewMode === 'edit' ? (
            <textarea
              className="w-full h-[500px] px-5 py-4 font-mono text-sm border-0 focus:outline-none resize-none bg-transparent"
              value={form.contentMarkdown}
              onChange={(e) => setForm({ ...form, contentMarkdown: e.target.value })}
              placeholder="# Mi plantilla&#10;&#10;Contenido con {{variable_ejemplo}}..."
            />
          ) : (
            <div className="px-6 py-5 h-[500px] overflow-auto">
              <MarkdownPreview source={form.contentMarkdown} />
              <div className="mt-4 text-xs text-slate-400 italic">
                <CheckIcon size={12} className="inline mr-1" />
                Los placeholders {`{{...}}`} se mantienen en la vista previa. Se reemplazan al
                generar un documento.
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

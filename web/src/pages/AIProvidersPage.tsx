import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  aiProvidersApi,
  AIProviderKind,
  CreateAIProviderBody,
} from '../api/ai-providers.api';
import { useAuth } from '../auth/AuthContext';
import { canManageUsers } from '../auth/permissions';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { CheckIcon, PlusIcon, RefreshIcon, XIcon } from '../components/ui/Icon';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';

const PROVIDER_DEFAULTS: Record<
  AIProviderKind,
  { label: string; model: string; baseUrl: string }
> = {
  OPENAI: { label: 'OpenAI', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  DEEPSEEK: { label: 'DeepSeek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' },
  GEMINI: {
    label: 'Gemini',
    model: 'gemini-2.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  GROQ: {
    label: 'Groq',
    model: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
};

const providerTone = (k: AIProviderKind) =>
  k === 'OPENAI'
    ? 'success'
    : k === 'DEEPSEEK'
      ? 'info'
      : k === 'GEMINI'
        ? 'warning'
        : 'purple';

type Mode = { kind: 'create' } | { kind: 'edit'; id: number };

export default function AIProvidersPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode | null>(null);
  const [form, setForm] = useState<CreateAIProviderBody>({
    provider: 'OPENAI',
    label: PROVIDER_DEFAULTS.OPENAI.label,
    model: PROVIDER_DEFAULTS.OPENAI.model,
    apiKey: '',
    baseUrl: PROVIDER_DEFAULTS.OPENAI.baseUrl,
    temperature: 0.3,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: aiProvidersApi.list,
    enabled: canManageUsers(user),
  });

  const create = useMutation({
    mutationFn: aiProvidersApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-providers'] });
      setMode(null);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo crear'),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<CreateAIProviderBody> }) =>
      aiProvidersApi.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-providers'] });
      setMode(null);
    },
  });

  const activate = useMutation({
    mutationFn: aiProvidersApi.activate,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-providers'] }),
  });

  const remove = useMutation({
    mutationFn: aiProvidersApi.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-providers'] }),
  });

  const [testResult, setTestResult] = useState<Record<number, string>>({});
  const test = useMutation({
    mutationFn: aiProvidersApi.test,
    onSuccess: (r, id) =>
      setTestResult((s) => ({ ...s, [id]: `OK — respuesta: "${r.sample.slice(0, 60)}"` })),
    onError: (e: { response?: { data?: { message?: string } } }, id) =>
      setTestResult((s) => ({
        ...s,
        [id]: `Error: ${e.response?.data?.message ?? 'conexión fallida'}`,
      })),
  });

  if (!canManageUsers(user)) return <Navigate to="/projects" replace />;

  const openCreate = () => {
    setForm({
      provider: 'OPENAI',
      label: PROVIDER_DEFAULTS.OPENAI.label,
      model: PROVIDER_DEFAULTS.OPENAI.model,
      apiKey: '',
      baseUrl: PROVIDER_DEFAULTS.OPENAI.baseUrl,
      temperature: 0.3,
    });
    setMode({ kind: 'create' });
  };

  const changeProvider = (p: AIProviderKind) => {
    setForm({ ...form, provider: p, ...PROVIDER_DEFAULTS[p] });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode?.kind === 'create') {
      create.mutate(form);
    } else if (mode?.kind === 'edit') {
      const body: Partial<CreateAIProviderBody> = {
        label: form.label,
        model: form.model,
        baseUrl: form.baseUrl,
        temperature: form.temperature,
      };
      if (form.apiKey) body.apiKey = form.apiKey;
      update.mutate({ id: mode.id, body });
    }
  };

  const startEdit = (id: number) => {
    const p = data?.find((x) => x.id === id);
    if (!p) return;
    setForm({
      provider: p.provider,
      label: p.label,
      model: p.model,
      apiKey: '',
      baseUrl: p.baseUrl ?? '',
      temperature: p.temperature,
    });
    setMode({ kind: 'edit', id });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Configuración IA</h1>
          <p className="text-sm text-slate-500 mt-1">
            Registra las claves de los proveedores (OpenAI, DeepSeek, etc.) y activa el que se
            usará para generar actas.
          </p>
        </div>
        <Button variant="primary" icon={<PlusIcon size={16} />} onClick={openCreate}>
          Agregar proveedor
        </Button>
      </div>

      {mode && (
        <Card>
          <form onSubmit={submit} className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Proveedor</label>
              <select
                className="input"
                value={form.provider}
                onChange={(e) => changeProvider(e.target.value as AIProviderKind)}
                disabled={mode.kind === 'edit'}
              >
                <option value="OPENAI">OpenAI</option>
                <option value="DEEPSEEK">DeepSeek</option>
                <option value="GEMINI">Google Gemini</option>
                <option value="GROQ">Groq</option>
              </select>
            </div>
            <div>
              <label className="label">Etiqueta</label>
              <input
                className="input"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Modelo</label>
              <input
                className="input"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Base URL (opcional)</label>
              <input
                className="input"
                value={form.baseUrl ?? ''}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">
                API Key {mode.kind === 'edit' && '(dejar vacío para mantener la actual)'}
              </label>
              <input
                className="input font-mono"
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                required={mode.kind === 'create'}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="label">Temperatura ({form.temperature})</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                className="w-full"
                value={form.temperature}
                onChange={(e) =>
                  setForm({ ...form, temperature: parseFloat(e.target.value) })
                }
              />
            </div>
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setMode(null)} type="button">
                Cancelar
              </Button>
              <Button
                type="submit"
                loading={create.isPending || update.isPending}
              >
                {mode.kind === 'create' ? 'Crear' : 'Guardar cambios'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        {isLoading ? (
          <div className="p-12 flex items-center justify-center text-slate-400">
            <RefreshIcon className="animate-spin" size={20} />
            <span className="ml-2 text-sm">Cargando…</span>
          </div>
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={<PlusIcon size={24} />}
            title="Sin proveedores configurados"
            description="Agrega un proveedor de IA para poder generar actas automáticamente desde la transcripción."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                  <th className="px-5 py-3">Proveedor</th>
                  <th className="px-5 py-3">Modelo</th>
                  <th className="px-5 py-3">API Key</th>
                  <th className="px-5 py-3">Temp.</th>
                  <th className="px-5 py-3">Estado</th>
                  <th className="px-5 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((p) => (
                  <tr key={p.id} className="text-sm hover:bg-slate-50">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <Badge tone={providerTone(p.provider)}>{p.provider}</Badge>
                        <span className="font-medium text-slate-800">{p.label}</span>
                      </div>
                      {testResult[p.id] && (
                        <p
                          className={`text-xs mt-1 ${
                            testResult[p.id].startsWith('OK')
                              ? 'text-emerald-600'
                              : 'text-red-600'
                          }`}
                        >
                          {testResult[p.id]}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-600">{p.model}</td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-500">
                      {p.apiKeyPreview}
                    </td>
                    <td className="px-5 py-4 text-slate-600">{p.temperature.toFixed(2)}</td>
                    <td className="px-5 py-4">
                      {p.isActive ? (
                        <Badge tone="success" dot>
                          Activo
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Inactivo</Badge>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => test.mutate(p.id)}
                          loading={test.isPending && test.variables === p.id}
                        >
                          Probar
                        </Button>
                        {!p.isActive && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<CheckIcon size={14} />}
                            onClick={() => activate.mutate(p.id)}
                          >
                            Activar
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => startEdit(p.id)}>
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<XIcon size={14} />}
                          onClick={async () => {
                            const ok = await askConfirm({
                              title: 'Eliminar proveedor',
                              message: `¿Eliminar "${p.label}"?`,
                              confirmText: 'Eliminar',
                              tone: 'danger',
                            });
                            if (ok) remove.mutate(p.id);
                          }}
                        >
                          Quitar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

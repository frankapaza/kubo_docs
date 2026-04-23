import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { integrationsApi, CreateIntegrationBody } from '../api/integrations.api';
import { useAuth } from '../auth/AuthContext';
import { canManageUsers } from '../auth/permissions';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, PlusIcon, RefreshIcon, XIcon } from '../components/ui/Icon';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';

const JIRA_LOGO = () => (
  <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
    <rect width="32" height="32" rx="6" fill="#0052CC" />
    <path d="M16.8 8H9.6A1.6 1.6 0 0 0 8 9.6v6.4l3.2 3.2V11.2h8L16.8 8z" fill="url(#ja)" />
    <path d="M20.4 12.8h-7.2l-1.6-1.6 1.6 1.6v7.2l3.2 3.2v-7.2H24l-3.6-3.2z" fill="url(#jb)" />
    <path d="M22.4 16.8H16v6.4a1.6 1.6 0 0 0 1.6 1.6h6.4V18.4L22.4 16.8z" fill="url(#jc)" />
    <defs>
      <linearGradient id="ja" x1="8" y1="13" x2="19.2" y2="13" gradientUnits="userSpaceOnUse">
        <stop stopColor="#0052CC" />
        <stop offset="1" stopColor="#2684FF" />
      </linearGradient>
      <linearGradient id="jb" x1="11.6" y1="17" x2="24" y2="17" gradientUnits="userSpaceOnUse">
        <stop stopColor="#0052CC" />
        <stop offset="1" stopColor="#2684FF" />
      </linearGradient>
      <linearGradient id="jc" x1="16" y1="21" x2="24" y2="21" gradientUnits="userSpaceOnUse">
        <stop stopColor="#0052CC" />
        <stop offset="1" stopColor="#2684FF" />
      </linearGradient>
    </defs>
  </svg>
);

const EMPTY_FORM: CreateIntegrationBody = {
  provider: 'JIRA',
  label: '',
  workspaceUrl: '',
  email: '',
  apiToken: '',
};

const STEPS = [
  {
    n: 1,
    title: 'Inicia sesión en Atlassian',
    description:
      'Ingresa con tu cuenta de Jira en id.atlassian.com. Debes tener permisos de "Create Issues" en al menos un proyecto.',
    link: { href: 'https://id.atlassian.com/', label: 'Abrir id.atlassian.com' },
  },
  {
    n: 2,
    title: 'Genera un API Token',
    description:
      'Security → API Tokens → "Create API token". Ponle un nombre (ej. "Kubo DevDocs") y copia el token completo. Solo se muestra una vez.',
    link: {
      href: 'https://id.atlassian.com/manage-profile/security/api-tokens',
      label: 'Crear API Token →',
    },
  },
  {
    n: 3,
    title: 'Copia la URL del workspace',
    description:
      'La URL base de tu Jira. Tiene la forma https://TU-EMPRESA.atlassian.net (sin barra al final).',
    hint: 'Ejemplo: https://acme.atlassian.net',
  },
  {
    n: 4,
    title: 'Completa los 4 campos',
    description: 'Nombre, Workspace URL, Email de Atlassian y el API Token. Guarda.',
  },
  {
    n: 5,
    title: 'Prueba la conexión',
    description: 'Presiona "Probar" en la tarjeta. Si ves "Conectado como…" está listo.',
  },
];

export default function IntegrationsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);
  const [form, setForm] = useState<CreateIntegrationBody>(EMPTY_FORM);
  const [testResult, setTestResult] = useState<Record<number, string>>({});

  if (!canManageUsers(user)) return <Navigate to="/" replace />;

  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations'],
    queryFn: integrationsApi.list,
  });

  const create = useMutation({
    mutationFn: () => integrationsApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo guardar la integración'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => integrationsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });

  const test = useMutation({
    mutationFn: (id: number) => integrationsApi.test(id),
    onSuccess: (data, id) =>
      setTestResult((prev) => ({ ...prev, [id]: `✓ Conectado como ${data.displayName}` })),
    onError: (e: { response?: { data?: { message?: string } } }, id) =>
      setTestResult((prev) => ({
        ...prev,
        [id]: `✗ ${e.response?.data?.message ?? 'Error de conexión'}`,
      })),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Integraciones</h1>
          <p className="text-sm text-slate-500 mt-1">
            Conecta Kubo con herramientas externas para exportar backlogs automáticamente.
          </p>
        </div>
        <Button
          icon={<PlusIcon size={16} />}
          onClick={() => {
            setShowForm(true);
            setGuideOpen(true);
          }}
        >
          Nueva integración
        </Button>
      </div>

      {/* Form + retractable side guide */}
      {showForm && (
        <div
          className={`grid gap-4 transition-all ${
            guideOpen ? 'grid-cols-1 lg:grid-cols-[1fr_340px]' : 'grid-cols-1 lg:grid-cols-[1fr_44px]'
          }`}
        >
          {/* Form */}
          <Card>
            <CardHeader title="Nueva integración Jira" icon={<JIRA_LOGO />} />
            <CardBody>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Nombre / etiqueta
                  </label>
                  <input
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-kubo-primary"
                    placeholder="Ej: Jira Producción"
                    value={form.label}
                    onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                    required
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Solo para identificarla en la lista si tienes varios workspaces.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Workspace URL <span className="text-red-500">*</span>
                  </label>
                  <input
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-kubo-primary font-mono"
                    placeholder="https://tu-empresa.atlassian.net"
                    value={form.workspaceUrl}
                    onChange={(e) => setForm((f) => ({ ...f, workspaceUrl: e.target.value }))}
                    required
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    <strong>Paso 3:</strong> cópiala de la barra de direcciones cuando estás en Jira. Sin slash al final.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Email de Atlassian <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-kubo-primary"
                    placeholder="tu@empresa.com"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    required
                  />
                  <p className="text-xs text-slate-400 mt-1">El mismo email con el que entras a Jira.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    API Token <span className="text-red-500">*</span>
                    <a
                      href="https://id.atlassian.com/manage-profile/security/api-tokens"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-xs text-[#0052CC] hover:underline font-normal"
                    >
                      Generar token →
                    </a>
                  </label>
                  <input
                    type="password"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-kubo-primary font-mono"
                    placeholder="ATATT3xFfGF0… (pega el token completo)"
                    value={form.apiToken}
                    onChange={(e) => setForm((f) => ({ ...f, apiToken: e.target.value }))}
                    required
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    <strong>Paso 2:</strong> el token que generaste en Atlassian. Se guarda encriptado.
                  </p>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button type="submit" loading={create.isPending}>
                    Guardar integración
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setShowForm(false);
                      setForm(EMPTY_FORM);
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>

          {/* Retractable guide */}
          {guideOpen ? (
            <div className="border-2 border-blue-100 bg-gradient-to-br from-blue-50/60 to-white rounded-xl overflow-hidden self-start">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-blue-100 bg-white/50">
                <JIRA_LOGO />
                <p className="flex-1 font-semibold text-sm text-slate-900">Guía paso a paso</p>
                <button
                  onClick={() => setGuideOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white transition"
                  title="Ocultar guía"
                >
                  <ArrowRightIcon size={14} />
                </button>
              </div>
              <div className="p-4 max-h-[calc(100vh-260px)] overflow-y-auto">
                <ol className="space-y-3">
                  {STEPS.map((step) => (
                    <li key={step.n} className="flex gap-3 items-start">
                      <div className="w-6 h-6 rounded-full bg-[#0052CC] text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                        {step.n}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-xs text-slate-900">{step.title}</p>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">{step.description}</p>
                        {step.hint && (
                          <p className="text-[10px] font-mono text-slate-500 mt-1 bg-white border border-slate-200 px-2 py-1 rounded inline-block">
                            {step.hint}
                          </p>
                        )}
                        {step.link && (
                          <a
                            href={step.link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#0052CC] hover:underline"
                          >
                            {step.link.label}
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="mt-4 flex items-start gap-2 text-[11px] text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2">
                  <span className="text-amber-600">⚠️</span>
                  <span>
                    <strong className="text-slate-700">Importante:</strong> el token tiene los
                    permisos de tu cuenta. Revócalo en Atlassian si se filtra.
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setGuideOpen(true)}
              className="hidden lg:flex flex-col items-center justify-start pt-4 gap-3 border-2 border-blue-100 bg-blue-50/30 rounded-xl hover:bg-blue-50/60 transition group self-start min-h-[200px]"
              title="Mostrar guía paso a paso"
            >
              <ArrowLeftIcon size={14} className="text-[#0052CC]" />
              <span
                className="text-[11px] font-semibold text-[#0052CC] uppercase tracking-wider"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                Guía paso a paso
              </span>
            </button>
          )}
        </div>
      )}

      {/* Lista de integraciones */}
      {integrations.length === 0 && !showForm ? (
        <Card>
          <CardBody>
            <div className="py-12 text-center">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
                <JIRA_LOGO />
              </div>
              <p className="font-medium text-slate-700">Sin integraciones configuradas</p>
              <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
                Haz clic en "Nueva integración" para empezar. Te guiaremos paso a paso.
              </p>
            </div>
          </CardBody>
        </Card>
      ) : integrations.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">
            Integraciones configuradas
          </p>
          <div className="space-y-3">
            {integrations.map((integration) => (
              <Card key={integration.id}>
                <CardBody>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                      <JIRA_LOGO />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900">{integration.label}</p>
                      <p className="text-xs text-slate-500 truncate font-mono">
                        {integration.workspaceUrl} · {integration.email}
                      </p>
                      {testResult[integration.id] && (
                        <p
                          className={`text-xs mt-1 font-medium ${
                            testResult[integration.id].startsWith('✓')
                              ? 'text-emerald-600'
                              : 'text-red-600'
                          }`}
                        >
                          {testResult[integration.id]}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<RefreshIcon size={14} />}
                        loading={test.isPending && test.variables === integration.id}
                        onClick={() => test.mutate(integration.id)}
                      >
                        Probar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<XIcon size={14} />}
                        onClick={async () => {
                          const ok = await askConfirm({
                            title: 'Eliminar integración',
                            message: `¿Eliminar la integración "${integration.label}"?`,
                            confirmText: 'Eliminar',
                            tone: 'danger',
                          });
                          if (ok) remove.mutate(integration.id);
                        }}
                      >
                        Eliminar
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {/* Qué pasa después */}
      {integrations.length > 0 && !showForm && (
        <Card className="border-emerald-100 bg-emerald-50/30">
          <CardBody>
            <div className="flex items-start gap-3">
              <CheckIcon size={18} className="text-emerald-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-slate-700">
                <p className="font-semibold mb-1.5">¿Qué sigue?</p>
                <ol className="space-y-1 text-xs text-slate-600 list-decimal pl-4 leading-relaxed">
                  <li>
                    <strong>Vincula tus proyectos Kubo con sus proyectos Jira:</strong> entra a cada
                    proyecto → Miembros → configura la sección "Integración Jira".
                  </li>
                  <li>
                    <strong>Genera el backlog desde un acta:</strong> abre un acta → botón "Generar
                    Backlog" → clic en "Exportar a Jira".
                  </li>
                  <li>
                    <strong>Revisa en Jira:</strong> las épicas, historias con criterios de aceptación
                    y subtareas se crean automáticamente.
                  </li>
                </ol>
              </div>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

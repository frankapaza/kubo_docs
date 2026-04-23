import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { integrationsApi, type Integration, type JiraProject } from '../api/integrations.api';
import { projectsApi } from '../api/projects.api';
import type { Project } from '../api/types';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { CheckIcon, ZapIcon } from './ui/Icon';
import { toast } from '../ui/Toast';
import { askConfirm } from '../ui/ConfirmDialog';

/**
 * Card reutilizable para vincular un proyecto Kubo con un proyecto Jira.
 * Se usa en la página de miembros y en la lista de reuniones del proyecto.
 */
export function ProjectJiraCard({
  project,
  compact = false,
}: {
  project: Project;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [integrationId, setIntegrationId] = useState<number | ''>(
    project.jiraIntegrationId ?? '',
  );
  const [projectKey, setProjectKey] = useState(project.jiraProjectKey ?? '');
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const integrationsQ = useQuery({
    queryKey: ['integrations'],
    queryFn: integrationsApi.list,
  });

  useEffect(() => {
    if (!integrationId) {
      setProjects([]);
      return;
    }
    setLoadingProjects(true);
    integrationsApi
      .listProjects(integrationId as number)
      .then((list) => setProjects(list))
      .catch(() => setProjects([]))
      .finally(() => setLoadingProjects(false));
  }, [integrationId]);

  const save = useMutation({
    mutationFn: () =>
      projectsApi.updateJiraConfig(project.id, {
        jiraIntegrationId: integrationId === '' ? null : (integrationId as number),
        jiraProjectKey: projectKey === '' ? null : projectKey,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['client-projects'] });
      setSavedMsg('✓ Configuración guardada');
      setTimeout(() => setSavedMsg(null), 2500);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo guardar'),
  });

  const unlink = async () => {
    const ok = await askConfirm({
      title: 'Desvincular Jira',
      message: '¿Seguro que quieres desvincular este proyecto de Jira?',
      confirmText: 'Desvincular',
      tone: 'warning',
    });
    if (!ok) return;
    setIntegrationId('');
    setProjectKey('');
    setTimeout(() => save.mutate(), 0);
  };

  const integrations = integrationsQ.data ?? [];
  const current = project.jiraIntegrationId
    ? integrations.find((i: Integration) => i.id === project.jiraIntegrationId)
    : null;

  return (
    <Card>
      <div className="p-5">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
            <ZapIcon size={18} className="text-[#0052CC]" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-slate-900">Integración Jira</h2>
            {!compact && (
              <p className="text-xs text-slate-500 mt-0.5">
                Vincula este proyecto con Jira para exportar backlogs y generar informes
                mensuales automáticos.
              </p>
            )}
            {current && project.jiraProjectKey && (
              <div className="mt-2 inline-flex items-center gap-2 text-xs bg-blue-50 text-[#0052CC] px-2.5 py-1 rounded-full">
                <CheckIcon size={12} />
                Conectado a <strong>{current.label}</strong> · proyecto{' '}
                <code className="font-mono">{project.jiraProjectKey}</code>
              </div>
            )}
          </div>
        </div>

        {integrations.length === 0 ? (
          <p className="text-sm text-slate-500 italic">
            No hay integraciones Jira configuradas. Un administrador debe agregarla en
            Configuración → Integraciones.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Integración
              </label>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0052CC]"
                value={integrationId}
                onChange={(e) =>
                  setIntegrationId(e.target.value === '' ? '' : Number(e.target.value))
                }
              >
                <option value="">— Sin integración —</option>
                {integrations.map((i: Integration) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">
                Proyecto Jira
              </label>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0052CC] disabled:opacity-50"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value)}
                disabled={!integrationId || loadingProjects}
              >
                <option value="">
                  {!integrationId
                    ? 'Primero selecciona integración'
                    : loadingProjects
                      ? 'Cargando…'
                      : 'Selecciona proyecto…'}
                </option>
                {projects.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} ({p.key})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => save.mutate()} loading={save.isPending}>
                Guardar
              </Button>
              {project.jiraIntegrationId && (
                <Button variant="ghost" onClick={unlink}>
                  Desvincular
                </Button>
              )}
            </div>
          </div>
        )}

        {savedMsg && (
          <p className="text-xs text-emerald-600 font-medium mt-3">{savedMsg}</p>
        )}
      </div>
    </Card>
  );
}

import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { meetingsApi } from '../api/meetings.api';
import { projectsApi } from '../api/projects.api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { MeetingStatusBadge, MeetingTypeBadge } from '../components/ui/Badge';
import { ProjectJiraCard } from '../components/ProjectJiraCard';
import { MeetingTypeGuidePopover } from '../components/MeetingTypeGuide';
import { MEETING_TYPES, MEETING_TYPE_DESCRIPTIONS, MEETING_TYPE_LABELS, type MeetingType } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { canCreateProject } from '../auth/permissions';
import { EmptyState } from '../components/ui/EmptyState';
import {
  ArrowLeftIcon,
  CalendarIcon,
  FileTextIcon,
  LocationIcon,
  MicIcon,
  PlusIcon,
} from '../components/ui/Icon';

function nowLocalDatetime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MeetingsListPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const pid = Number(projectId);
  const { user } = useAuth();
  const canManage = canCreateProject(user);
  const [showJiraConfig, setShowJiraConfig] = useState(false);

  const { data: project } = useQuery({
    queryKey: ['project', pid],
    queryFn: () => projectsApi.findOne(pid),
    enabled: Number.isFinite(pid) && pid > 0,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['meetings', pid],
    queryFn: () => meetingsApi.listByProject(pid),
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<{
    title: string;
    scheduledAt: string;
    location: string;
    meetingType: MeetingType;
  }>(() => ({
    title: '',
    scheduledAt: nowLocalDatetime(),
    location: '',
    meetingType: 'GENERIC',
  }));
  const create = useMutation({
    mutationFn: meetingsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meetings', pid] });
      setForm({
        title: '',
        scheduledAt: nowLocalDatetime(),
        location: '',
        meetingType: 'GENERIC',
      });
      setShowForm(false);
    },
  });

  const openForm = () => {
    setForm((f) => ({ ...f, scheduledAt: nowLocalDatetime() }));
    setShowForm(true);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ projectId: pid, ...form });
  };

  const meetings = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/projects"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition"
        >
          <ArrowLeftIcon size={14} />
          Proyectos
        </Link>
        <div className="flex items-start justify-between flex-wrap gap-4 mt-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {project?.name ?? 'Reuniones'}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {project?.code
                ? `Reuniones del proyecto ${project.code}`
                : 'Reuniones del proyecto'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {canManage && (
              <Button
                variant="secondary"
                onClick={() => setShowJiraConfig((v) => !v)}
                icon={<span className="text-xs">⚡</span>}
              >
                {project?.jiraIntegrationId ? 'Jira vinculado' : 'Vincular Jira'}
              </Button>
            )}
            {project?.jiraIntegrationId && project?.jiraProjectKey && (
              <Link to={`/projects/${pid}/jira-report`}>
                <Button variant="secondary" icon={<FileTextIcon size={16} />}>
                  Informe Jira
                </Button>
              </Link>
            )}
            <Button
              variant="primary"
              icon={<PlusIcon size={16} />}
              onClick={() => (showForm ? setShowForm(false) : openForm())}
            >
              Nueva reunión
            </Button>
          </div>
        </div>
      </div>

      {canManage && showJiraConfig && project && (
        <ProjectJiraCard project={project} compact />
      )}

      {showForm && (
        <Card>
          <form onSubmit={submit} className="p-5 space-y-4">
            <div>
              <label className="label">Tipo de reunión</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {MEETING_TYPES.map((t) => {
                  const selected = form.meetingType === t;
                  return (
                    <div
                      key={t}
                      className={`relative rounded-lg border transition ${
                        selected
                          ? 'border-kubo-primary bg-kubo-primary-light'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, meetingType: t })}
                        className="text-left w-full px-3 py-2.5 pr-8"
                      >
                        <p
                          className={`text-sm font-semibold ${
                            selected ? 'text-kubo-primary-dark' : 'text-slate-800'
                          }`}
                        >
                          {MEETING_TYPE_LABELS[t]}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">
                          {MEETING_TYPE_DESCRIPTIONS[t]}
                        </p>
                      </button>
                      <div className="absolute top-1.5 right-1.5">
                        <MeetingTypeGuidePopover type={t} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-slate-400 mt-2">
                El tipo determina cómo la IA estructura el acta. Puedes cambiarlo luego.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_1fr_auto] gap-3 items-end">
              <div>
                <label className="label">Título</label>
                <input
                  className="input"
                  placeholder="Ej: Kickoff sprint 14"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Fecha y hora</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={form.scheduledAt}
                  onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Ubicación</label>
                <input
                  className="input"
                  placeholder="Sala, Zoom, etc."
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                />
              </div>
              <Button type="submit" loading={create.isPending}>
                Crear
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading ? (
        <Card>
          <div className="p-12 text-center text-sm text-slate-400">Cargando reuniones…</div>
        </Card>
      ) : meetings.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MicIcon size={22} />}
            title="Aún no hay reuniones"
            description="Crea la primera reunión del proyecto y empieza a grabar."
            action={
              <Button
                variant="primary"
                icon={<PlusIcon size={16} />}
                onClick={openForm}
              >
                Nueva reunión
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {meetings.map((m) => {
            const date = new Date(m.scheduledAt);
            return (
              <Link
                key={m.id}
                to={`/meetings/${m.id}`}
                className="group bg-white border border-slate-200 rounded-xl shadow-card p-5 hover:shadow-pop hover:border-indigo-200 transition block"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-slate-900 line-clamp-2 group-hover:text-kubo-primary-dark transition flex-1">
                    {m.title}
                  </h3>
                  <MeetingStatusBadge status={m.status} />
                </div>
                {m.meetingType && m.meetingType !== 'GENERIC' && (
                  <div className="mb-3">
                    <MeetingTypeBadge type={m.meetingType} />
                  </div>
                )}
                <div className="space-y-1.5 text-sm text-slate-500">
                  <div className="flex items-center gap-2">
                    <CalendarIcon size={14} />
                    <span>
                      {date.toLocaleDateString('es', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}{' '}
                      ·{' '}
                      {date.toLocaleTimeString('es', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {m.location && (
                    <div className="flex items-center gap-2">
                      <LocationIcon size={14} />
                      <span className="line-clamp-1">{m.location}</span>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

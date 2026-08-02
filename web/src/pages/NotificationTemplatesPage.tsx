import { ReactNode, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import {
  notificationTemplatesApi,
  triggerKeyLabel,
  type NotificationAudience,
  type NotificationTemplate,
} from '../api/notification-templates.api';
import { useAuth } from '../auth/AuthContext';
import { canManageUsers } from '../auth/permissions';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { BellIcon, RefreshIcon, UsersIcon } from '../components/ui/Icon';
import EditNotificationTemplateDialog from './notification-templates/EditNotificationTemplateDialog';

/**
 * Gate de página: los cuatro endpoints de `NotificationTemplatesController`
 * exigen rol ADMIN, el listado incluido. Esta pantalla no tiene ningún modo
 * "solo lectura" -- ver, editar y probar son la misma vista --, así que
 * gatearla entera coincide exactamente con lo que permite el backend, sin
 * construir una UI de permisos parciales que no existe en ningún otro sitio
 * del panel. Mismo criterio que `ClientUsersPage` y `TemplatesPage`.
 */
export default function NotificationTemplatesPage() {
  const { user } = useAuth();
  const [editingId, setEditingId] = useState<number | null>(null);

  const {
    data: templates,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['notification-templates'],
    queryFn: notificationTemplatesApi.list,
    enabled: canManageUsers(user),
  });

  if (!canManageUsers(user)) return <Navigate to="/" replace />;

  const editing = templates?.find((t) => t.id === editingId) ?? null;

  const byAudience = (audience: NotificationAudience): NotificationTemplate[] =>
    (templates ?? [])
      .filter((t) => t.audience === audience)
      .sort((a, b) => a.triggerKey.localeCompare(b.triggerKey));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Notificaciones por correo</h1>
        <p className="text-sm text-slate-500 mt-1">
          Textos de los avisos automáticos que salen cuando un ticket cambia. Agrupados por a quién
          llegan, porque eso es lo que decide qué variables puede usar cada uno: una plantilla de
          cliente nunca puede mostrar prioridad, SLA, responsable ni motivo internos.
        </p>
      </div>

      {isLoading ? (
        <Card>
          <div className="p-12 flex items-center justify-center text-slate-400">
            <RefreshIcon className="animate-spin" size={20} />
            <span className="ml-2 text-sm">Cargando plantillas…</span>
          </div>
        </Card>
      ) : isError ? (
        // Fallo de refresco, no de escritura: no se tocó ninguna plantilla,
        // solo no se pudo leer la lista.
        <Card>
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-red-600">No se pudo cargar la lista de plantillas.</p>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Reintentar
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {/*
            Los dos subtítulos dicen exactamente a quién escribe el backend, y
            eso es más estrecho de lo que parece: al cliente le escribe el
            autor del ticket y nadie más de su empresa, y de los dos avisos de
            equipo solo el de SLA puede acabar en el responsable. Un texto
            aproximado aquí hace que un ADMIN redacte para un lector que no
            existe.
          */}
          <AudienceSection
            title="Avisos a clientes"
            subtitle="Los recibe quien abrió el ticket desde el portal, y nadie más de su empresa: si lo abrió el equipo por teléfono, no sale ninguno. Solo pueden usar las seis variables que el portal ya deja ver."
            icon={<UsersIcon size={18} />}
            templates={byAudience('CLIENT')}
            onEdit={setEditingId}
          />
          <AudienceSection
            title="Avisos al equipo"
            subtitle="El de SLA en riesgo va al responsable del ticket y, si no tiene o está dado de baja, al buzón del equipo. El de ticket nuevo va siempre al buzón. Se configura en Ajustes del área de trabajo; si está vacío, se usa la dirección del remitente."
            icon={<BellIcon size={18} />}
            templates={byAudience('TEAM')}
            onEdit={setEditingId}
          />
        </>
      )}

      <EditNotificationTemplateDialog
        open={editingId !== null}
        template={editing}
        onCancel={() => setEditingId(null)}
      />
    </div>
  );
}

function AudienceSection({
  title,
  subtitle,
  icon,
  templates,
  onEdit,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  templates: NotificationTemplate[];
  onEdit: (id: number) => void;
}) {
  return (
    <Card>
      <CardHeader icon={icon} title={title} subtitle={subtitle} />
      <CardBody className="p-0">
        {templates.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">
            Sin plantillas sembradas para este público.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onEdit(t.id)}
                className="w-full text-left px-5 py-4 flex items-start justify-between gap-4 hover:bg-slate-50 transition"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-slate-900">{triggerKeyLabel(t.triggerKey)}</p>
                    <Badge tone={t.isActive ? 'success' : 'neutral'} dot>
                      {t.isActive ? 'Activa' : 'Inactiva'}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 truncate">{t.subject}</p>
                </div>
                <span className="text-sm font-medium text-kubo-primary flex-shrink-0">Editar</span>
              </button>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

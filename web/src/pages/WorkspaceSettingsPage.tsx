import { FormEvent, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workspaceApi, type UpdateWorkspaceBody } from '../api/workspace.api';
import { useAuth } from '../auth/AuthContext';
import { canManageUsers } from '../auth/permissions';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import {
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  InboxIcon,
  RefreshIcon,
  SaveIcon,
  SendIcon,
} from '../components/ui/Icon';
import { toast } from '../ui/Toast';

export default function WorkspaceSettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<UpdateWorkspaceBody>({});
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  if (!canManageUsers(user)) return <Navigate to="/" replace />;

  const { data: settings, isLoading } = useQuery({
    queryKey: ['workspace-settings'],
    queryFn: workspaceApi.get,
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      razonSocial: settings.razonSocial,
      ruc: settings.ruc ?? '',
      legalRepName: settings.legalRepName ?? '',
      legalRepDoc: settings.legalRepDoc ?? '',
      address: settings.address ?? '',
      phone: settings.phone ?? '',
      email: settings.email ?? '',
      website: settings.website ?? '',
      logoUrl: settings.logoUrl ?? '',
      sessionTimeoutMinutes: settings.sessionTimeoutMinutes ?? 30,
      smtpHost: settings.smtpHost ?? '',
      smtpPort: settings.smtpPort ?? 587,
      smtpSecure: settings.smtpSecure === 1,
      smtpUser: settings.smtpUser ?? '',
      smtpFrom: settings.smtpFrom ?? '',
      // smtpPass nunca se pre-llena; el usuario lo deja vacío si no quiere cambiarlo
      teamInboxEmail: settings.teamInboxEmail ?? '',
      imapHost: settings.imapHost ?? '',
      imapPort: settings.imapPort ?? 993,
      imapSecure: settings.imapSecure === 1,
      imapUser: settings.imapUser ?? '',
      // imapPass nunca se pre-llena, mismo criterio que smtpPass
      imapFolder: settings.imapFolder ?? '',
      imapEnabled: settings.imapEnabled === 1,
      imapAuthServerId: settings.imapAuthServerId ?? '',
      audioRetentionPolicy: settings.audioRetentionPolicy ?? 'DELETE_AFTER_DAYS',
      audioRetentionDays: settings.audioRetentionDays ?? 7,
    });
  }, [settings]);

  const testSmtp = useMutation({
    mutationFn: () => workspaceApi.testSmtp(),
    onSuccess: (data) => toast.success(`Correo de prueba enviado a ${data.sentTo}`),
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo conectar al SMTP'),
  });

  const smtpConfigured = !!settings?.smtpHost && !!settings?.smtpUser;
  const imapConfigured = !!settings?.imapHost && !!settings?.imapUser;

  const save = useMutation({
    mutationFn: () => workspaceApi.update(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-settings'] });
      setSavedMsg('✓ Datos del emisor guardados');
      setTimeout(() => setSavedMsg(null), 3000);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'No se pudo guardar'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  if (isLoading || !settings) {
    return (
      <Card>
        <div className="p-12 text-center text-sm text-slate-400">Cargando configuración…</div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Datos del emisor (membrete)</h1>
        <p className="text-sm text-slate-500 mt-1">
          Esta información aparece como <strong>membrete</strong> en todos los documentos
          comerciales que generes (cotizaciones, contratos, NDAs). Se inyecta automáticamente
          como variables <code className="text-xs bg-slate-100 px-1 rounded">{`{{emisor_*}}`}</code>.
        </p>
      </div>

      <form onSubmit={submit}>
        <Card>
          <CardHeader icon={<FileTextIcon size={18} />} title="Información legal" />
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="label">Razón social *</label>
                <input
                  className="input"
                  value={form.razonSocial ?? ''}
                  onChange={(e) => setForm({ ...form, razonSocial: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">RUC</label>
                <input
                  className="input font-mono"
                  maxLength={11}
                  value={form.ruc ?? ''}
                  onChange={(e) => setForm({ ...form, ruc: e.target.value.replace(/\D/g, '') })}
                />
              </div>
              <div>
                <label className="label">Sitio web</label>
                <input
                  className="input"
                  placeholder="kuboti.com"
                  value={form.website ?? ''}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Representante legal</label>
                <input
                  className="input"
                  value={form.legalRepName ?? ''}
                  onChange={(e) => setForm({ ...form, legalRepName: e.target.value })}
                />
              </div>
              <div>
                <label className="label">DNI del representante</label>
                <input
                  className="input font-mono"
                  value={form.legalRepDoc ?? ''}
                  onChange={(e) => setForm({ ...form, legalRepDoc: e.target.value })}
                />
              </div>
            </div>
          </CardBody>
        </Card>

        <Card className="mt-4">
          <CardHeader icon={<FileTextIcon size={18} />} title="Contacto" />
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="label">Dirección</label>
                <input
                  className="input"
                  placeholder="Av. Domingo Orué 565, Surquillo — Lima"
                  value={form.address ?? ''}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Teléfono</label>
                <input
                  className="input"
                  placeholder="986 095 857"
                  value={form.phone ?? ''}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Email de contacto</label>
                <input
                  type="email"
                  className="input"
                  placeholder="contacto@empresa.com"
                  value={form.email ?? ''}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </div>
          </CardBody>
        </Card>

        <Card className="mt-4">
          <CardHeader
            icon={<FileTextIcon size={18} />}
            title="Logo (opcional)"
            subtitle="URL pública de una imagen. Aparecerá en el membrete de tus documentos."
          />
          <CardBody>
            <div>
              <label className="label">URL del logo</label>
              <input
                type="url"
                className="input"
                placeholder="https://tuweb.com/logo.png"
                value={form.logoUrl ?? ''}
                onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">
                Recomendado: PNG con fondo transparente, máximo 400 × 100 px.
              </p>
            </div>
            {form.logoUrl && (
              <div className="mt-3 p-3 border border-slate-200 rounded-lg bg-slate-50">
                <p className="text-[11px] text-slate-500 mb-2 uppercase tracking-wider font-semibold">
                  Vista previa del logo
                </p>
                <img
                  src={form.logoUrl}
                  alt="Logo"
                  className="max-h-20"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="mt-4">
          <CardHeader
            icon={<ClockIcon size={18} />}
            title="Sesión"
            subtitle="Tiempo antes de cerrar sesión por inactividad. El temporizador se reinicia cada vez que mueves el mouse, escribes o haces clic."
          />
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Minutos de inactividad para cerrar sesión</label>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  className="input"
                  value={form.sessionTimeoutMinutes ?? 30}
                  onChange={(e) =>
                    setForm({ ...form, sessionTimeoutMinutes: Number(e.target.value) })
                  }
                />
                <p className="text-xs text-slate-400 mt-1">
                  <strong>0</strong> = sesión nunca expira (solo se cierra manualmente).
                  <br />
                  Recomendado: 30 min para uso diario, 5 min para equipos compartidos.
                </p>
              </div>
              <div className="flex items-end">
                <div className="text-xs text-slate-500 leading-relaxed">
                  <strong className="text-slate-700">Cómo funciona:</strong>
                  <br />
                  Si configuras 5 minutos y estás editando un documento, la sesión
                  sigue viva mientras interactúes. Solo se cierra cuando 5 minutos
                  pasan sin ninguna actividad. 30 segundos antes te avisamos.
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card className="mt-4">
          <CardHeader
            icon={<SendIcon size={18} />}
            title="SMTP — Envío de correo"
            subtitle="Configura el servidor de correo para enviar documentos por email (cotizaciones, contratos, informes)."
            action={
              smtpConfigured ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RefreshIcon size={14} />}
                  onClick={() => testSmtp.mutate()}
                  loading={testSmtp.isPending}
                >
                  Probar SMTP
                </Button>
              ) : undefined
            }
          />
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_140px] gap-3">
              <div>
                <label className="label">Host *</label>
                <input
                  className="input font-mono"
                  placeholder="smtp.gmail.com"
                  value={form.smtpHost ?? ''}
                  onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Puerto</label>
                <input
                  type="number"
                  className="input"
                  placeholder="587"
                  value={form.smtpPort ?? ''}
                  onChange={(e) =>
                    setForm({ ...form, smtpPort: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <label className="label">Conexión</label>
                <label className="flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-300 bg-white">
                  <input
                    type="checkbox"
                    checked={form.smtpSecure ?? false}
                    onChange={(e) => setForm({ ...form, smtpSecure: e.target.checked })}
                  />
                  <span className="text-xs text-slate-600">SSL/TLS</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="label">Usuario *</label>
                <input
                  type="email"
                  className="input"
                  placeholder="tucorreo@empresa.com"
                  value={form.smtpUser ?? ''}
                  onChange={(e) => setForm({ ...form, smtpUser: e.target.value })}
                />
              </div>
              <div>
                <label className="label">
                  Contraseña
                  {smtpConfigured && (
                    <span className="ml-2 text-xs text-emerald-600 font-normal">✓ configurada</span>
                  )}
                </label>
                <input
                  type="password"
                  className="input"
                  placeholder={smtpConfigured ? '•••••••• (déjalo vacío si no cambia)' : 'App password o SMTP password'}
                  value={form.smtpPass ?? ''}
                  onChange={(e) => setForm({ ...form, smtpPass: e.target.value })}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="label">"From" (nombre que ven los destinatarios)</label>
              <input
                className="input"
                placeholder='Kubo DevDocs <no-reply@kuboti.com>'
                value={form.smtpFrom ?? ''}
                onChange={(e) => setForm({ ...form, smtpFrom: e.target.value })}
              />
            </div>

            <div className="mt-3">
              <label className="label">Buzón del equipo (avisos internos de tickets)</label>
              <input
                type="email"
                className="input"
                placeholder="soporte@kuboti.com"
                value={form.teamInboxEmail ?? ''}
                onChange={(e) => setForm({ ...form, teamInboxEmail: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">
                Aquí llegan los avisos que no son para un cliente: un ticket nuevo abierto desde el
                portal y un SLA en riesgo sin responsable asignado. <strong>Si lo dejas vacío</strong>,
                esos avisos caen a la dirección del remitente configurada arriba ("From").
              </p>
            </div>

            <details className="mt-4 text-xs text-slate-500">
              <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-800">
                Ejemplos de config comunes
              </summary>
              <div className="mt-2 space-y-2 pl-2">
                <div>
                  <strong className="text-slate-700">Gmail:</strong> host <code className="bg-slate-100 px-1 rounded">smtp.gmail.com</code>, puerto 587, SSL off. Crea un
                  <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-kubo-primary hover:underline ml-1">app password</a> (2FA requerido).
                </div>
                <div>
                  <strong className="text-slate-700">Office365:</strong> host <code className="bg-slate-100 px-1 rounded">smtp.office365.com</code>, puerto 587, SSL off.
                </div>
                <div>
                  <strong className="text-slate-700">SendGrid:</strong> host <code className="bg-slate-100 px-1 rounded">smtp.sendgrid.net</code>, puerto 587, usuario <code className="bg-slate-100 px-1 rounded">apikey</code>, contraseña = tu API key.
                </div>
              </div>
            </details>
          </CardBody>
        </Card>

        <Card className="mt-4">
          <CardHeader
            icon={<InboxIcon size={18} />}
            title="IMAP — Correo entrante"
            subtitle="Configura el buzón desde el que se leen los correos que abren y alimentan tickets."
          />
          <CardBody>
            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div>
                <p className="text-sm font-semibold text-slate-800">Ingesta de correo</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Apagada por omisión. Si el dominio empieza a caer en spam, este interruptor es lo
                  primero que hay que revisar.
                </p>
              </div>
              <label className="flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-300 bg-white flex-shrink-0">
                <input
                  type="checkbox"
                  checked={form.imapEnabled ?? false}
                  onChange={(e) => setForm({ ...form, imapEnabled: e.target.checked })}
                />
                <span className="text-xs text-slate-600">
                  {form.imapEnabled ? 'Encendida' : 'Apagada'}
                </span>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_140px] gap-3">
              <div>
                <label className="label">Host</label>
                <input
                  className="input font-mono"
                  placeholder="imap.gmail.com"
                  value={form.imapHost ?? ''}
                  onChange={(e) => setForm({ ...form, imapHost: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Puerto</label>
                <input
                  type="number"
                  className="input"
                  placeholder="993"
                  value={form.imapPort ?? ''}
                  onChange={(e) =>
                    setForm({ ...form, imapPort: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <label className="label">Conexión</label>
                <label className="flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-300 bg-white">
                  <input
                    type="checkbox"
                    checked={form.imapSecure ?? false}
                    onChange={(e) => setForm({ ...form, imapSecure: e.target.checked })}
                  />
                  <span className="text-xs text-slate-600">SSL/TLS</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="label">Usuario</label>
                <input
                  type="email"
                  className="input"
                  placeholder="ticket@empresa.com"
                  value={form.imapUser ?? ''}
                  onChange={(e) => setForm({ ...form, imapUser: e.target.value })}
                />
              </div>
              <div>
                <label className="label">
                  Contraseña
                  {imapConfigured && (
                    <span className="ml-2 text-xs text-emerald-600 font-normal">✓ configurada</span>
                  )}
                </label>
                <input
                  type="password"
                  className="input"
                  placeholder={imapConfigured ? '•••••••• (déjalo vacío si no cambia)' : 'App password o IMAP password'}
                  value={form.imapPass ?? ''}
                  onChange={(e) => setForm({ ...form, imapPass: e.target.value })}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="label">Carpeta</label>
                <input
                  className="input font-mono"
                  placeholder="INBOX"
                  value={form.imapFolder ?? ''}
                  onChange={(e) => setForm({ ...form, imapFolder: e.target.value })}
                />
                <p className="text-xs text-slate-400 mt-1">Vacío = INBOX.</p>
              </div>
              <div>
                <label className="label">Identificador del servidor</label>
                <input
                  className="input font-mono"
                  placeholder="mx.kuboti.com"
                  value={form.imapAuthServerId ?? ''}
                  onChange={(e) => setForm({ ...form, imapAuthServerId: e.target.value })}
                />
                <p className="text-xs text-slate-400 mt-1">
                  El nombre con el que nuestro propio servidor de correo encabeza la cabecera{' '}
                  <code className="bg-slate-100 px-1 rounded">Authentication-Results</code>. Sin
                  esto, ningún correo autentica: es el ancla contra un remitente que fabrique esa
                  cabecera dentro de su propio mensaje.
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <span className="text-amber-600 mt-0.5">⚠️</span>
              <span>
                <strong className="text-slate-700">Antes de encender la ingesta:</strong> verifica en
                la consola del proveedor de correo que rechaza en el sobre SMTP cualquier mensaje que
                no pase DMARC, y confirma que el identificador de arriba es exactamente el que ese
                servidor escribe como primer segmento de <code className="bg-amber-100 px-1 rounded">Authentication-Results</code>.
              </span>
            </div>
          </CardBody>
        </Card>

        <Card className="mt-4">
          <CardHeader
            icon={<ClockIcon size={18} />}
            title="Retención de audio"
            subtitle="Qué hacer con el archivo de audio después de la transcripción. La transcripción (texto) siempre se conserva."
          />
          <CardBody>
            <div className="space-y-2">
              {(
                [
                  {
                    value: 'KEEP_FOREVER',
                    label: 'Conservar siempre',
                    desc: 'El audio queda guardado indefinidamente. Máximo consumo de storage.',
                  },
                  {
                    value: 'DELETE_AFTER_APPROVAL',
                    label: 'Borrar cuando se apruebe el acta',
                    desc: 'Al aprobar el acta de la reunión, el audio se borra automáticamente.',
                  },
                  {
                    value: 'DELETE_AFTER_DAYS',
                    label: 'Borrar tras N días (recomendado)',
                    desc: 'Un cron diario borra audios con más de N días desde que se subieron.',
                  },
                  {
                    value: 'NEVER_STORE',
                    label: 'Nunca guardar (máxima privacidad)',
                    desc: 'Al terminar la transcripción, el audio se borra inmediatamente. Ideal para reuniones con NDA.',
                  },
                ] as const
              ).map((opt) => {
                const selected = form.audioRetentionPolicy === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                      selected
                        ? 'border-kubo-primary bg-kubo-primary-light'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name="retention"
                      className="mt-0.5"
                      checked={selected}
                      onChange={() =>
                        setForm({ ...form, audioRetentionPolicy: opt.value })
                      }
                    />
                    <div className="flex-1">
                      <p className={`text-sm font-semibold ${selected ? 'text-kubo-primary-dark' : 'text-slate-800'}`}>
                        {opt.label}
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                        {opt.desc}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>

            {form.audioRetentionPolicy === 'DELETE_AFTER_DAYS' && (
              <div className="mt-4 pl-3 border-l-2 border-kubo-primary/30">
                <label className="label">Días antes de borrar</label>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  className="input !w-32"
                  value={form.audioRetentionDays ?? 7}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      audioRetentionDays: Math.max(1, Number(e.target.value) || 7),
                    })
                  }
                />
                <p className="text-xs text-slate-500 mt-1">
                  El cron corre todos los días a las 3 AM. Los audios con más de{' '}
                  <strong>{form.audioRetentionDays ?? 7}</strong> días se borrarán del storage.
                  La fila del archivo se conserva como registro histórico (sin contenido).
                </p>
              </div>
            )}

            <div className="mt-4 flex items-start gap-2 text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <span className="text-amber-600 mt-0.5">⚠️</span>
              <span>
                <strong className="text-slate-700">Importante:</strong> borrar el audio es
                irreversible. La transcripción (texto) y el acta NO se tocan — solo el archivo
                binario original se elimina del storage.
              </span>
            </div>
          </CardBody>
        </Card>

        <Card className="mt-4 border-2 border-indigo-100 bg-indigo-50/30">
          <CardBody>
            <div className="flex items-start gap-3">
              <CheckIcon size={18} className="text-indigo-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-slate-700">
                <p className="font-semibold mb-1.5">Variables disponibles en las plantillas</p>
                <p className="text-xs text-slate-600 mb-2">
                  Estas variables se auto-rellenan en cualquier documento que generes:
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs font-mono text-slate-600">
                  <div>{`{{emisor_razon_social}}`}</div>
                  <div>{`{{emisor_ruc}}`}</div>
                  <div>{`{{emisor_representante}}`}</div>
                  <div>{`{{emisor_dni_representante}}`}</div>
                  <div>{`{{emisor_direccion}}`}</div>
                  <div>{`{{emisor_telefono}}`}</div>
                  <div>{`{{emisor_email}}`}</div>
                  <div>{`{{emisor_website}}`}</div>
                  <div>{`{{emisor_logo_url}}`}</div>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="flex items-center gap-2 mt-5">
          <Button type="submit" icon={<SaveIcon size={16} />} loading={save.isPending}>
            Guardar cambios
          </Button>
          {savedMsg && <span className="text-xs text-emerald-600 font-medium">{savedMsg}</span>}
        </div>
      </form>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { clientsApi } from '../../api/clients.api';
import { ResolvedTemplate, TemplateSection, deliverableTemplatesApi } from '../../api/deliverable-document.api';
import { useAuth } from '../../auth/AuthContext';
import { canLeadProject } from '../../auth/permissions';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PlusIcon, SaveIcon, TrashIcon } from '../../components/ui/Icon';
import { askConfirm } from '../../ui/ConfirmDialog';
import { toast } from '../../ui/Toast';

/** Los 20 tipos del catálogo del expediente (mismo orden que el backend). */
export const CATALOG_TYPES: { type: string; name: string }[] = [
  { type: 'ACT-INI', name: 'Acta de inicio' },
  { type: 'CRO-PRO', name: 'Cronograma del proyecto' },
  { type: 'DOC-ANA', name: 'Documento de análisis' },
  { type: 'HIS-USU', name: 'Historias de usuario' },
  { type: 'ACT-APRO', name: 'Acta de aprobación de prototipos' },
  { type: 'ARQ-TIC', name: 'Arquitectura de TI' },
  { type: 'DOC-SER', name: 'Documento de servicios' },
  { type: 'EVD-PUN', name: 'Evidencia de pruebas unitarias' },
  { type: 'MAN-USU', name: 'Manual de usuario' },
  { type: 'PRU-FUN', name: 'Pruebas funcionales' },
  { type: 'INF-PRU', name: 'Informe de pruebas' },
  { type: 'ACT-USU', name: 'Acta de conformidad de usuario' },
  { type: 'MAN-DES', name: 'Manual de despliegue' },
  { type: 'SOL-PAP', name: 'Solicitud de pase a producción' },
  { type: 'ACT-REU', name: 'Acta de reunión' },
  { type: 'INF-GES', name: 'Informe de gestión' },
  { type: 'SOL-CAM', name: 'Solicitud de cambio' },
  { type: 'ACT-CIE', name: 'Acta de cierre' },
  { type: 'ACT-CAP', name: 'Acta de capacitación' },
  { type: 'ACT-TRA', name: 'Acta de transferencia' },
];

const SOURCE_LABEL: Record<ResolvedTemplate['source'], string> = {
  KUBO: 'Plantilla Kubo (de fábrica)',
  KUBO_EDITADA: 'Plantilla Kubo (editada)',
  CLIENTE: 'Plantilla del cliente',
};

function errorText(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  return Array.isArray(m) ? m.join(' ') : m ?? fallback;
}

export default function DeliverableTemplatesPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const lead = canLeadProject(user);
  const qc = useQueryClient();
  const type = CATALOG_TYPES.some((t) => t.type === params.get('type')) ? params.get('type')! : CATALOG_TYPES[0].type;
  const clientId = Number(params.get('clientId')) || null;
  const clients = useQuery({ queryKey: ['clients', 'all'], queryFn: () => clientsApi.list() });
  const saved = useQuery({ queryKey: ['deliverable-templates'], queryFn: () => deliverableTemplatesApi.list() });
  const tpl = useQuery({ queryKey: ['deliverable-template', type, clientId], queryFn: () => deliverableTemplatesApi.get(type, clientId) });

  const [name, setName] = useState('');
  const [sections, setSections] = useState<TemplateSection[]>([]);
  useEffect(() => {
    if (tpl.data) {
      const forThis = clientId ? tpl.data.source === 'CLIENTE' : tpl.data.source !== 'CLIENTE';
      const clientName = clients.data?.find((c) => c.id === clientId)?.razonSocial;
      setName(forThis ? tpl.data.name : `Formato ${clientName ?? 'del cliente'} · ${CATALOG_TYPES.find((t) => t.type === type)?.name}`);
      setSections(tpl.data.sections.map((s) => ({ ...s })));
    }
  }, [tpl.data, clientId, type, clients.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['deliverable-template', type, clientId] });
    qc.invalidateQueries({ queryKey: ['deliverable-templates'] });
  };
  const save = useMutation({
    mutationFn: () => deliverableTemplatesApi.save(type, { clientId, name: name.trim(), sections }),
    onSuccess: () => {
      refresh();
      toast.success('Plantilla guardada. Se usa en los documentos nuevos.');
    },
    onError: (e) => toast.error(errorText(e, 'No se pudo guardar la plantilla.')),
  });
  const reset = useMutation({
    mutationFn: () => deliverableTemplatesApi.remove(type, clientId),
    onSuccess: () => {
      refresh();
      toast.success(clientId ? 'El cliente vuelve a usar la plantilla Kubo.' : 'Plantilla Kubo restablecida.');
    },
    onError: (e) => toast.error(errorText(e, 'No se pudo restablecer.')),
  });

  const set = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };

  const own = tpl.data && (clientId ? tpl.data.source === 'CLIENTE' : tpl.data.source === 'KUBO_EDITADA');
  const move = (i: number, d: -1 | 1) =>
    setSections((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const copy = [...list];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Plantillas de entregables</h1>
        <p className="text-sm text-slate-600 mt-1">
          La estructura de secciones con la que empieza cada documento del expediente. Un cliente con su propio formato (p. ej. PRODUCE) puede
          tener su plantilla; si no, se usa la de Kubo. Los cambios aplican a los documentos nuevos.
        </p>
      </div>

      <Card>
        <div className="p-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Entregable
            <select className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white" value={type} onChange={(e) => set({ type: e.target.value })}>
              {CATALOG_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.name} ({t.type})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Para
            <select
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
              value={clientId ?? ''}
              onChange={(e) => set({ clientId: e.target.value || null })}
            >
              <option value="">Kubo (todos los clientes)</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.razonSocial}
                </option>
              ))}
            </select>
          </label>
          {tpl.data && (
            <div className="text-xs text-slate-500 pb-2">
              Hoy se usa: <Badge tone={tpl.data.source === 'CLIENTE' ? 'purple' : 'primary'}>{SOURCE_LABEL[tpl.data.source]}</Badge>
              {clientId && tpl.data.source !== 'CLIENTE' && <span className="ml-1">— al guardar se crea la plantilla propia de este cliente.</span>}
            </div>
          )}
        </div>
      </Card>

      {tpl.isLoading ? (
        <div className="text-slate-500">Cargando…</div>
      ) : (
        <Card>
          <div className="p-4 flex flex-col gap-3">
            <label className="text-xs text-slate-600 flex flex-col gap-1">
              Nombre de la plantilla
              <input className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" maxLength={180} value={name} readOnly={!lead} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="text-[11px] font-semibold tracking-wide text-slate-400">SECCIONES</div>
            <ol className="flex flex-col gap-2">
              {sections.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
                  <input
                    aria-label="Número"
                    className="w-16 border border-slate-200 rounded px-2 py-1 text-sm"
                    maxLength={10}
                    value={s.num}
                    readOnly={!lead}
                    onChange={(e) => setSections((l) => l.map((x, k) => (k === i ? { ...x, num: e.target.value } : x)))}
                  />
                  <input
                    aria-label="Título"
                    className="flex-1 min-w-[180px] border border-slate-200 rounded px-2 py-1 text-sm font-medium"
                    maxLength={200}
                    value={s.title}
                    readOnly={!lead}
                    onChange={(e) => setSections((l) => l.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))}
                  />
                  <input
                    aria-label="Guía"
                    className="flex-[2] min-w-[200px] border border-slate-200 rounded px-2 py-1 text-sm text-slate-600"
                    maxLength={300}
                    placeholder="Guía: qué va en la sección (opcional)"
                    value={s.guide ?? ''}
                    readOnly={!lead}
                    onChange={(e) => setSections((l) => l.map((x, k) => (k === i ? { ...x, guide: e.target.value } : x)))}
                  />
                  {lead && (
                    <span className="flex gap-1">
                      <button type="button" title="Subir" className="px-2 text-slate-500 hover:text-slate-900" onClick={() => move(i, -1)}>
                        ↑
                      </button>
                      <button type="button" title="Bajar" className="px-2 text-slate-500 hover:text-slate-900" onClick={() => move(i, 1)}>
                        ↓
                      </button>
                      <button
                        type="button"
                        title="Quitar"
                        className="px-2 text-slate-400 hover:text-red-600"
                        onClick={() => setSections((l) => l.filter((_, k) => k !== i))}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
            {lead && (
              <div className="flex flex-wrap gap-2 justify-between">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<PlusIcon size={14} />}
                  onClick={() => setSections((l) => [...l, { num: String(l.length + 1), title: '' }])}
                >
                  Agregar sección
                </Button>
                <div className="flex gap-2">
                  {own && (
                    <Button
                      variant="ghost"
                      loading={reset.isPending}
                      onClick={async () => {
                        const ok = await askConfirm({
                          message: clientId ? '¿Quitar la plantilla propia de este cliente? Volverá a usar la de Kubo.' : '¿Restablecer la plantilla Kubo de fábrica?',
                          tone: 'warning',
                          confirmText: clientId ? 'Quitar' : 'Restablecer',
                        });
                        if (ok) reset.mutate();
                      }}
                    >
                      {clientId ? 'Quitar plantilla del cliente' : 'Restablecer de fábrica'}
                    </Button>
                  )}
                  <Button icon={<SaveIcon size={16} />} loading={save.isPending} disabled={!name.trim() || !sections.length} onClick={() => save.mutate()}>
                    Guardar plantilla
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {(saved.data?.length ?? 0) > 0 && (
        <Card>
          <div className="p-4">
            <div className="text-[11px] font-semibold tracking-wide text-slate-400 mb-2">PLANTILLAS PERSONALIZADAS</div>
            <ul className="text-sm flex flex-col gap-1">
              {saved.data!.map((t) => (
                <li key={`${t.type}-${t.clientId ?? 0}`}>
                  <button type="button" className="text-kubo-primary hover:underline text-left" onClick={() => set({ type: t.type, clientId: t.clientId ? String(t.clientId) : null })}>
                    {t.name}
                  </button>{' '}
                  <span className="text-slate-500">
                    · {t.type} · {t.clientName ?? 'Kubo'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}

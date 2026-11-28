import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { deliverableDocumentApi } from '../../api/deliverable-document.api';
import { meetingsApi } from '../../api/meetings.api';
import { participantsApi } from '../../api/participants.api';
import { Button } from '../../components/ui/Button';
import { PlusIcon, TrashIcon, UploadIcon } from '../../components/ui/Icon';
import {
  ScheduleRow,
  drawable,
  parseParticipants,
  participantsTable,
  replaceSchedule,
  rolesFromParticipants,
} from '../../lib/doc-tables';
import { askConfirm } from '../../ui/ConfirmDialog';
import { toast } from '../../ui/Toast';

function errorText(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  return Array.isArray(m) ? m.join(' ') : m ?? fallback;
}

export type SectionKind = 'SCHEDULE' | 'PARTICIPANTS' | 'ROLES' | null;

/** Qué ayuda lleva una sección, por su título o por la tabla que ya tiene. */
export function sectionKind(title: string, body: string): SectionKind {
  if (/^\s*\|\s*actividad\s*\|\s*responsable\s*\|\s*inicio\s*\|\s*fin\s*\|/im.test(body) || /cronograma|fases e hitos/i.test(title)) return 'SCHEDULE';
  if (/participantes|asistentes/i.test(title)) return 'PARTICIPANTS';
  if (/roles?\b|responsables/i.test(title)) return 'ROLES';
  return null;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];

/** Gantt simple: una barra por actividad sobre una escala de meses. */
export function Gantt({ rows }: { rows: ScheduleRow[] }) {
  const ok = drawable(rows);
  if (!ok.length) return <p className="text-xs text-slate-400">Completa inicio y fin de las actividades para ver el cronograma.</p>;
  const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86400000;
  const min = Math.min(...ok.map((r) => day(r.start)));
  const max = Math.max(...ok.map((r) => day(r.end))) + 1;
  const span = Math.max(1, max - min);
  const pct = (d: number) => `${((d - min) / span) * 100}%`;
  const ticks: { label: string; at: number }[] = [];
  const first = new Date(min * 86400000);
  const c = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
  while (c.getTime() / 86400000 < max && ticks.length < 36) {
    ticks.push({ label: `${MONTHS[c.getUTCMonth()]} ${String(c.getUTCFullYear()).slice(2)}`, at: Math.max(min, c.getTime() / 86400000) });
    c.setUTCMonth(c.getUTCMonth() + 1);
  }
  return (
    <div className="rounded-lg border border-slate-200 p-3 overflow-x-auto" role="img" aria-label="Cronograma en diagrama de Gantt">
      <div className="min-w-[520px]">
        <div className="grid grid-cols-[minmax(120px,30%)_1fr] gap-2 text-[10px] text-slate-500 mb-1">
          <span />
          <div className="relative h-4">
            {ticks.map((t) => (
              <span key={t.label} className="absolute top-0 border-l border-slate-200 pl-1" style={{ left: pct(t.at) }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
        {ok.map((r, i) => (
          <div key={i} className="grid grid-cols-[minmax(120px,30%)_1fr] gap-2 items-center py-0.5">
            <span className="text-xs text-slate-700 truncate" title={r.activity}>
              {r.activity}
            </span>
            <div className="relative h-4 bg-slate-50 rounded">
              <div
                className="absolute top-0.5 bottom-0.5 rounded bg-[#053777]"
                style={{ left: pct(day(r.start)), width: `max(4px, ${((day(r.end) + 1 - day(r.start)) / span) * 100}%)` }}
                title={`${r.activity}: ${r.start} → ${r.end}${r.owner ? ` · ${r.owner}` : ''}`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Editor visual del cronograma: filas, Gantt e importación desde Excel. Escribe la tabla en la sección. */
export function ScheduleTools(props: {
  rows: ScheduleRow[];
  body: string;
  readOnly: boolean;
  projectId: number;
  deliverableId: number;
  onBody: (body: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const rows = props.rows.filter((r) => !/^\[completar\]/i.test(r.activity) || r.start || r.end);
  const set = (next: ScheduleRow[]) => props.onBody(replaceSchedule(props.body, next));
  const upd = (i: number, patch: Partial<ScheduleRow>) => set(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <div className="mt-2 flex flex-col gap-2">
      {!props.readOnly && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[560px]">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 pr-2 font-medium">Actividad</th>
                <th className="py-1 pr-2 font-medium">Responsable</th>
                <th className="py-1 pr-2 font-medium">Inicio</th>
                <th className="py-1 pr-2 font-medium">Fin</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="pr-2 py-0.5">
                    <input className="w-full border border-slate-200 rounded px-2 py-1" value={r.activity} maxLength={200} onChange={(e) => upd(i, { activity: e.target.value })} />
                  </td>
                  <td className="pr-2 py-0.5">
                    <input className="w-full border border-slate-200 rounded px-2 py-1" value={r.owner} maxLength={120} onChange={(e) => upd(i, { owner: e.target.value })} />
                  </td>
                  <td className="pr-2 py-0.5">
                    <input type="date" className="border border-slate-200 rounded px-1 py-1" value={r.start} onChange={(e) => upd(i, { start: e.target.value })} />
                  </td>
                  <td className="pr-2 py-0.5">
                    <input
                      type="date"
                      className={`border rounded px-1 py-1 ${r.start && r.end && r.end < r.start ? 'border-red-400' : 'border-slate-200'}`}
                      value={r.end}
                      min={r.start || undefined}
                      onChange={(e) => upd(i, { end: e.target.value })}
                    />
                  </td>
                  <td>
                    <button type="button" title="Quitar fila" className="p-1 text-slate-400 hover:text-red-600" onClick={() => set(rows.filter((_, k) => k !== i))}>
                      <TrashIcon size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!props.readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<PlusIcon size={13} />}
            onClick={() => {
              const last = rows[rows.length - 1];
              set([...rows, { activity: '', owner: '', start: last?.end ?? '', end: '' }]);
            }}
          >
            Agregar actividad
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (rows.some((r) => r.activity.trim()) && !(await askConfirm({ message: 'El cronograma importado reemplaza las actividades actuales. ¿Continuar?', confirmText: 'Importar' })))
                return;
              setImporting(true);
              try {
                const r = await deliverableDocumentApi.importSchedule(props.projectId, props.deliverableId, f);
                set(r.rows);
                toast.success(`${r.rows.length} actividades importadas. Revisa y guarda la versión.`);
              } catch (err) {
                toast.error(errorText(err, 'No se pudo leer el archivo.'));
              } finally {
                setImporting(false);
              }
            }}
          />
          <Button size="sm" variant="secondary" icon={<UploadIcon size={13} />} loading={importing} onClick={() => fileRef.current?.click()}>
            Importar desde Excel
          </Button>
          <span className="text-[11px] text-slate-500 self-center">
            Excel o CSV con columnas «Tarea» (o «Actividad»), «Inicio», «Fin» y, si quieres, «Responsable» — como el que exporta MS Project.
          </span>
        </div>
      )}
      <Gantt rows={rows} />
    </div>
  );
}

/** Participantes: traerlos de una reunión del proyecto (nombre, cargo, correo, teléfono, asistencia). */
export function ParticipantsTools(props: { projectId: number; readOnly: boolean; body: string; onBody: (body: string) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const meetings = useQuery({
    queryKey: ['meetings', 'project', props.projectId],
    queryFn: () => meetingsApi.listByProject(props.projectId),
    enabled: open,
  });
  if (props.readOnly) return null;
  const list = meetings.data?.data ?? [];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {!open ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Traer de una reunión
        </Button>
      ) : (
        <>
          <select
            className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white max-w-full"
            defaultValue=""
            disabled={loading || meetings.isLoading}
            onChange={async (e) => {
              const id = Number(e.target.value);
              if (!id) return;
              const hasData = parseParticipants(props.body).length > 0;
              if (hasData && !(await askConfirm({ message: 'Se reemplaza la tabla de participantes por la de la reunión. ¿Continuar?', confirmText: 'Reemplazar' }))) return;
              setLoading(true);
              try {
                const ps = await participantsApi.list(id);
                if (!ps.length) {
                  toast.info('Esa reunión no tiene participantes registrados.');
                  return;
                }
                props.onBody(
                  participantsTable(ps.map((p) => ({ name: p.fullName, role: p.role ?? '', email: p.email ?? '', phone: p.phone ?? '', attended: !!p.attended }))),
                );
                setOpen(false);
                toast.success(`${ps.length} participantes traídos de la reunión.`);
              } catch (err) {
                toast.error(errorText(err, 'No se pudieron traer los participantes.'));
              } finally {
                setLoading(false);
              }
            }}
          >
            <option value="">{meetings.isLoading ? 'Cargando reuniones…' : list.length ? 'Elige la reunión…' : 'Este proyecto no tiene reuniones'}</option>
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {new Date(m.scheduledAt).toLocaleDateString('es-PE')} · {m.title}
              </option>
            ))}
          </select>
          <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setOpen(false)}>
            Cancelar
          </button>
        </>
      )}
      <span className="text-[11px] text-slate-500">Nombre, cargo, correo, teléfono (opcional) y asistencia, como en las actas de reunión.</span>
    </div>
  );
}

/** Roles y responsables: se arman desde la tabla de participantes del mismo documento. */
export function RolesTools(props: { participantsBody: string | null; readOnly: boolean; body: string; onBody: (body: string) => void }) {
  if (props.readOnly) return null;
  const people = props.participantsBody ? parseParticipants(props.participantsBody) : [];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={!people.length}
        title={people.length ? '' : 'Primero completa la tabla de participantes'}
        onClick={async () => {
          if (props.body.trim() && !/\[completar\]/i.test(props.body) && !(await askConfirm({ message: 'Se reemplazan los roles actuales. ¿Continuar?', confirmText: 'Reemplazar' }))) return;
          props.onBody(rolesFromParticipants(people));
        }}
      >
        Completar desde Participantes
      </Button>
      <span className="text-[11px] text-slate-500">
        {people.length ? `${people.length} personas en Participantes; el cargo pasa como rol y luego lo ajustas.` : 'Llena primero la tabla de Participantes.'}
      </span>
    </div>
  );
}

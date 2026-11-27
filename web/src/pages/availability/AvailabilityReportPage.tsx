import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { availabilityApi } from '../../api/availability.api';
import { clientsApi } from '../../api/clients.api';
import { useAuth } from '../../auth/AuthContext';
import { toast } from '../../ui/Toast';
import { apiMessage, apiStatus, btn, btnPrimary, CRITICALITY_LABELS, inputStyle, tableWrap, td, th } from './availability-ui';
import { fmtLima, fmtMinutes, fmtPct, limaMonthNow, monthLabel } from './report-format';

const CAUSE_LABELS = { OFFICE_OUTAGE: 'Corte en la oficina', PROBE_SILENT: 'Sonda en silencio' } as const;
const card: React.CSSProperties = { border: '1px solid #e6e9ea', borderRadius: 8, padding: '12px 14px', background: '#fff' };
const h2: React.CSSProperties = { margin: '8px 0 0', fontSize: 15, fontWeight: 600 };

export default function AvailabilityReportPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState<number | ''>('');
  const [month, setMonth] = useState('');
  const [generating, setGenerating] = useState(false);

  const clients = useQuery({ queryKey: ['availability', 'clients'], queryFn: () => clientsApi.list(), staleTime: 5 * 60_000 });
  const reports = useQuery({
    queryKey: ['availability', 'reports', clientId],
    queryFn: () => availabilityApi.listReports(clientId as number),
    enabled: clientId !== '',
  });

  const currentMonth = limaMonthNow();
  const months = useMemo(() => {
    const set = new Set((reports.data ?? []).map((r) => r.month));
    set.add(currentMonth);
    return [...set].sort().reverse();
  }, [reports.data, currentMonth]);
  const activeMonth = month || currentMonth;

  const report = useQuery({
    queryKey: ['availability', 'report', clientId, activeMonth],
    queryFn: () => availabilityApi.getReport(clientId as number, activeMonth),
    enabled: clientId !== '',
    retry: false,
  });
  const notGenerated = apiStatus(report.error) === 404;
  const r = report.data;

  const generate = async () => {
    if (clientId === '' || generating) return;
    setGenerating(true);
    try {
      const data = await availabilityApi.generateReport(clientId, activeMonth);
      queryClient.setQueryData(['availability', 'report', clientId, activeMonth], data);
      queryClient.invalidateQueries({ queryKey: ['availability', 'reports', clientId] });
      toast.success('Informe generado.');
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo generar el informe.'));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="text-xl font-semibold text-slate-900">Disponibilidad mensual</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isAdmin && (
            <button type="button" style={btnPrimary} onClick={generate} disabled={clientId === '' || generating}>
              {generating ? 'Generando…' : 'Generar / Regenerar'}
            </button>
          )}
          <button type="button" style={btn} onClick={() => window.print()} disabled={!r}>Imprimir</button>
        </div>
      </div>

      <div className="no-print" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select aria-label="Cliente" value={clientId} onChange={(e) => { setClientId(e.target.value ? Number(e.target.value) : ''); setMonth(''); }} style={{ ...inputStyle, width: 'auto' }}>
          <option value="">Elige un cliente…</option>
          {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}
        </select>
        <select aria-label="Mes" value={activeMonth} onChange={(e) => setMonth(e.target.value)} disabled={clientId === ''} style={{ ...inputStyle, width: 'auto' }}>
          {months.map((m) => (
            <option key={m} value={m}>{monthLabel(m)}{m === currentMonth ? ' (mes en curso, parcial)' : ''}</option>
          ))}
        </select>
      </div>

      {clientId === '' && <div style={{ fontSize: 13, color: '#6d7577' }}>Elige un cliente para ver su informe.</div>}
      {report.isLoading && clientId !== '' && <div style={{ fontSize: 13, color: '#6d7577' }}>Cargando…</div>}
      {notGenerated && (
        <div style={{ fontSize: 13, color: '#6d7577' }}>
          El informe de {monthLabel(activeMonth)} todavía no se generó.{isAdmin ? ' Usa «Generar / Regenerar».' : ' Un administrador debe generarlo.'}
        </div>
      )}
      {report.error && !notGenerated && <div role="alert" style={{ fontSize: 13, color: '#b3261e' }}>No se pudo cargar el informe.</div>}

      {r && (
        <article style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{r.clientName} · {monthLabel(r.month)}</div>
            <div style={{ fontSize: 12, color: '#6d7577' }}>Generado el {fmtLima(r.generatedAt)} (hora de Lima)</div>
          </div>

          {r.partial && (
            <div role="status" style={{ fontSize: 13, fontWeight: 600, borderRadius: 6, padding: '8px 10px', color: '#a35c00', background: '#fff4e0', border: '1px solid #f0d9a8' }}>
              Informe parcial al {fmtLima(r.to)}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <Stat label="Disponibilidad" value={fmtPct(r.totals.availabilityPct)} hint="Sin contar caídas del servicio" />
            <Stat label="Acceso desde Perú" value={fmtPct(r.totals.peruAccessPct)} hint="Incluye cortes de ruta" />
            <Stat label="MTTR" value={fmtMinutes(r.totals.mttrMinutes)} hint="Tiempo medio de recuperación" />
            <Stat label="Incidentes" value={String(r.totals.incidents)} hint={`${fmtMinutes(r.totals.downMinutes)} caído · ${fmtMinutes(r.totals.routeMinutes)} sin ruta`} />
          </div>

          <h2 style={h2}>Por servicio</h2>
          <div style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', background: '#f7f8f8', color: '#6d7577', fontSize: 12 }}>
                  {['Servicio', 'Servidor', 'Criticidad', 'Disponib.', 'Acceso Perú', 'Caído', 'Sin ruta', 'Mant.', 'Inc.', 'Latencia p95 oficina / servidor'].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {r.services.map((s) => (
                  <tr key={s.serviceId} style={{ borderTop: '1px solid #eef0f1' }}>
                    <td style={td}><div style={{ fontWeight: 600 }}>{s.serviceName}</div>{s.systemName && <div style={{ fontSize: 12, color: '#6d7577' }}>{s.systemName}</div>}</td>
                    <td style={td}>{s.serverName}</td>
                    <td style={td}>{CRITICALITY_LABELS[s.criticality]}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtPct(s.availabilityPct)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtPct(s.peruAccessPct)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtMinutes(s.downMinutes)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtMinutes(s.routeMinutes)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtMinutes(s.maintenanceMinutes)}</td>
                    <td style={td}>{s.incidents}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{ms(s.latency.office.p95)} / {ms(s.latency.datacenter.p95)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={h2}>Incidentes</h2>
          {r.incidents.length === 0 ? <Empty text="Sin incidentes en el período." /> : (
            <div style={tableWrap}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', background: '#f7f8f8', color: '#6d7577', fontSize: 12 }}>
                    {['Tipo', 'Servidor / servicios', 'Inicio (Lima)', 'Recuperado (Lima)', 'Min. en el mes', 'Ticket', 'Evidencia'].map((h) => <th key={h} style={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {r.incidents.map((i) => (
                    <tr key={i.incidentId} style={{ borderTop: '1px solid #eef0f1', verticalAlign: 'top' }}>
                      <td style={td}>{i.kind === 'DOWN' ? 'Caído' : 'Sin acceso desde Perú'}</td>
                      <td style={td}><div style={{ fontWeight: 600 }}>{i.serverName}</div><div style={{ fontSize: 12, color: '#6d7577' }}>{i.serviceNames.join(', ')}</div></td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtLima(i.firstFailureAt)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{i.recoveredAt ? fmtLima(i.recoveredAt) : 'Sigue abierto'}</td>
                      <td style={td}>{fmtMinutes(i.minutesInMonth)}</td>
                      <td style={td}>
                        {i.ticketId !== null
                          ? <Link to={`/tickets/${i.ticketId}`} className="text-blue-700 hover:underline">{i.ticketCode ?? `Ticket ${i.ticketId}`}</Link>
                          : '—'}
                      </td>
                      <td style={td}>
                        {i.evidence.length === 0 ? '—' : i.evidence.map((e) => (
                          <div key={e.id} style={{ fontSize: 12 }}>{e.fileName} <span style={{ color: '#6d7577' }}>({e.origin}, {fmtLima(e.capturedAt)})</span></div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2 style={h2}>Ventanas sin datos</h2>
          {r.noDataWindows.length === 0 ? <Empty text="Sin ventanas sin datos." /> : (
            <SimpleTable
              head={['Sonda', 'Causa', 'Desde (Lima)', 'Hasta (Lima)', 'Duración']}
              rows={r.noDataWindows.map((w) => [w.probeCode, CAUSE_LABELS[w.cause], fmtLima(w.startedAt), fmtLima(w.endedAt), fmtMinutes(w.minutes)])}
            />
          )}

          <h2 style={h2}>Mantenimientos</h2>
          {r.maintenance.length === 0 ? <Empty text="Sin mantenimientos en el período." /> : (
            <SimpleTable
              head={['Objetivo', 'Desde (Lima)', 'Hasta (Lima)', 'Motivo', 'Min. en el mes']}
              rows={r.maintenance.map((m) => [m.targetLabel, fmtLima(m.startsAt), fmtLima(m.endsAt), m.reason, fmtMinutes(m.minutesInMonth)])}
            />
          )}

          <h2 style={h2}>Recursos del servidor</h2>
          {r.servers.length === 0 ? <Empty text="Sin servidores." /> : (
            <SimpleTable
              head={['Servidor', 'CPU p95', 'RAM p95', 'Discos libres al cierre']}
              rows={r.servers.map((s) => [
                s.serverName,
                s.cpuP95 === null ? '—' : `${s.cpuP95} %`,
                s.ramP95 === null ? '—' : `${s.ramP95} %`,
                s.disksAtClose.length === 0 ? '—' : s.disksAtClose.map((d) => `${d.name} ${d.freePct} %`).join(' · '),
              ])}
            />
          )}

          <section style={{ ...card, marginTop: 8 }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600 }}>Criterio de cálculo</h2>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#4a5254', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {r.criteria.map((c, n) => <li key={n}>{c}</li>)}
            </ul>
          </section>
        </article>
      )}
    </div>
  );
}

const ms = (v: number | null) => (v === null ? '—' : `${v} ms`);

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 12, color: '#6d7577' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 11, color: '#6d7577' }}>{hint}</div>
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <div style={{ fontSize: 13, color: '#6d7577' }}>{text}</div>;

function SimpleTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div style={tableWrap}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', background: '#f7f8f8', color: '#6d7577', fontSize: 12 }}>{head.map((h) => <th key={h} style={th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, n) => (
            <tr key={n} style={{ borderTop: '1px solid #eef0f1' }}>{row.map((c, k) => <td key={k} style={td}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

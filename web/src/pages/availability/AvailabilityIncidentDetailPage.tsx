import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { availabilityApi, CheckRow, EvidenceOrigin, EvidenceView, IncidentEvent } from '../../api/availability.api';
import { useAuth } from '../../auth/AuthContext';
import { askConfirm } from '../../ui/ConfirmDialog';
import { toast } from '../../ui/Toast';
import {
  apiMessage, btn, btnPrimary, EVENT_LABELS, fmtCheck, fmtDateTime, fmtDuration, inputStyle, INCIDENT_KIND_LABELS, labelStyle, STATUS_COLORS,
} from './availability-ui';

const ORIGIN_LABELS: Record<EvidenceOrigin, string> = { OFICINA: 'Oficina', SERVIDOR: 'Servidor', OTRO: 'Otro' };
const EVIDENCE_ACCEPT = '.txt,.html,.htm,.csv,.png,.jpg';
const EVIDENCE_MAX_BYTES = 2 * 1024 * 1024;

const fmtSize = (b: number): string => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

const card: React.CSSProperties = { border: '1px solid #e6e9ea', borderRadius: 8, padding: 14, background: '#fff' };
const h2: React.CSSProperties = { fontSize: 14, fontWeight: 600, margin: '0 0 8px' };

function eventText(e: IncidentEvent): string {
  const label = EVENT_LABELS[e.type] ?? e.type;
  const text = e.detail && typeof e.detail.text === 'string' ? e.detail.text : null;
  return text ? `${label}: ${text}` : label;
}

function CheckList({ title, rows }: { title: string; rows: CheckRow[] }) {
  return (
    <div style={{ ...card, flex: 1, minWidth: 260 }}>
      <h2 style={h2}>{title}</h2>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: '#6d7577' }}>Sin comprobaciones en la ventana.</div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3, fontFamily: 'ui-monospace, Consolas, monospace' }}>
          {rows.map((c) => (
            <li key={c.id} style={{ color: c.ok ? '#1e7a3c' : '#b3261e' }}>{fmtCheck(c)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AvailabilityIncidentDetailPage() {
  const { id } = useParams();
  const incidentId = Number(id);
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [showEvidenceForm, setShowEvidenceForm] = useState(false);
  const [evFile, setEvFile] = useState<File | null>(null);
  const [evOrigin, setEvOrigin] = useState<EvidenceOrigin>('OFICINA');
  const [evNotes, setEvNotes] = useState('');

  const detail = useQuery({
    queryKey: ['availability', 'incident', incidentId],
    queryFn: () => availabilityApi.incidentDetail(incidentId),
    enabled: Number.isInteger(incidentId),
    refetchInterval: 30_000,
  });

  const reload = () => queryClient.invalidateQueries({ queryKey: ['availability'] });

  const ack = async () => {
    setBusy(true);
    try {
      await availabilityApi.acknowledge(incidentId);
      toast.success('Incidente reconocido.');
      reload();
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo reconocer el incidente.'));
    } finally {
      setBusy(false);
    }
  };

  const addNote = async () => {
    const text = note.trim();
    if (!text) return;
    setBusy(true);
    try {
      await availabilityApi.addNote(incidentId, text);
      setNote('');
      reload();
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo guardar la nota.'));
    } finally {
      setBusy(false);
    }
  };

  const uploadEvidence = async () => {
    if (!evFile) return;
    if (evFile.size > EVIDENCE_MAX_BYTES) {
      toast.error('El archivo supera el máximo de 2 MB.');
      return;
    }
    setBusy(true);
    try {
      await availabilityApi.uploadEvidence(incidentId, evFile, { origin: evOrigin, notes: evNotes.trim() || undefined });
      toast.success('Evidencia adjuntada.');
      setEvFile(null);
      setEvNotes('');
      setShowEvidenceForm(false);
      reload();
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo adjuntar la evidencia.'));
    } finally {
      setBusy(false);
    }
  };

  const downloadEvidence = async (ev: EvidenceView) => {
    try {
      await availabilityApi.downloadEvidence(ev);
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo descargar la evidencia.'));
    }
  };

  const deleteEvidence = async (ev: EvidenceView) => {
    const ok = await askConfirm({
      title: 'Eliminar evidencia',
      message: `Se elimina «${ev.fileName}» de este incidente. ¿Continuar?`,
      tone: 'danger',
      confirmText: 'Eliminar',
    });
    if (!ok) return;
    try {
      await availabilityApi.deleteEvidence(ev.id);
      reload();
    } catch (e) {
      toast.error(apiMessage(e, 'No se pudo eliminar la evidencia.'));
    }
  };

  const copyTarget = async (target: string) => {
    try {
      await navigator.clipboard.writeText(target);
      toast.success('Destino copiado.');
    } catch {
      toast.error('No se pudo copiar el destino.');
    }
  };

  if (detail.isLoading) return <div style={{ fontSize: 13, color: '#6d7577' }}>Cargando…</div>;
  if (detail.error || !detail.data) {
    return <div role="alert" style={{ fontSize: 13, color: '#b3261e' }}>No se pudo cargar el incidente.</div>;
  }

  const d = detail.data;
  const inc = d.incident;
  const c = STATUS_COLORS[inc.kind];
  const closed = inc.recoveredAt !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Link to="/monitoreo/incidentes" className="text-sm text-slate-500 hover:underline">← Incidentes</Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {inc.serviceName ?? `Servidor ${inc.serverName}`}
          </h1>
          <div style={{ fontSize: 13, color: '#6d7577', marginTop: 2 }}>
            {inc.clientName} · {inc.serverName}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ background: c.bg, color: c.fg, borderRadius: 4, padding: '3px 9px', fontSize: 12, fontWeight: 600 }}>
            {INCIDENT_KIND_LABELS[inc.kind]}
          </span>
          <button type="button" style={btn} onClick={() => copyTarget(d.winmtrTarget)} disabled={!d.winmtrTarget}>
            Copiar destino WinMTR
          </button>
          <button type="button" style={btn} onClick={() => setShowEvidenceForm((v) => !v)}>
            Adjuntar WinMTR
          </button>
          {inc.acknowledgedAt ? (
            <span style={{ fontSize: 12, color: '#6d7577' }}>Reconocido {fmtDateTime(inc.acknowledgedAt)}</span>
          ) : (
            !closed && <button type="button" style={btnPrimary} onClick={ack} disabled={busy}>Reconocer</button>
          )}
        </div>
      </div>

      <div style={card}>
        <h2 style={h2}>Diagnóstico</h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{d.diagnosis}</p>
        <dl style={{ margin: '12px 0 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 12 }}>
          <div><dt style={{ color: '#6d7577' }}>Primer fallo</dt><dd style={{ margin: 0 }}>{fmtDateTime(inc.firstFailureAt)}</dd></div>
          <div><dt style={{ color: '#6d7577' }}>Confirmado</dt><dd style={{ margin: 0 }}>{fmtDateTime(inc.confirmedAt)}</dd></div>
          <div><dt style={{ color: '#6d7577' }}>{closed ? 'Recuperado' : 'Estado'}</dt><dd style={{ margin: 0 }}>{closed ? fmtDateTime(inc.recoveredAt) : 'Abierto'}</dd></div>
          <div><dt style={{ color: '#6d7577' }}>Duración</dt><dd style={{ margin: 0 }}>{fmtDuration(inc.durationMinutes)}</dd></div>
          {d.winmtrTarget && <div><dt style={{ color: '#6d7577' }}>Destino WinMTR</dt><dd style={{ margin: 0 }}><code>{d.winmtrTarget}</code></dd></div>}
          <div>
            <dt style={{ color: '#6d7577' }}>Ticket</dt>
            <dd style={{ margin: 0 }}>
              {inc.ticketId !== null ? (
                <Link to={`/tickets/${inc.ticketId}`} className="text-blue-700 hover:underline">{inc.ticketCode ?? `#${inc.ticketId}`}</Link>
              ) : '—'}
            </dd>
          </div>
        </dl>
      </div>

      {d.children.length > 0 && (
        <div style={card}>
          <h2 style={h2}>Servicios afectados</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {d.children.map((k) => (
              <li key={k.id}>
                <Link to={`/monitoreo/incidentes/${k.id}`} className="text-blue-700 hover:underline">{k.serviceName}</Link>
                {' · '}{INCIDENT_KIND_LABELS[k.kind]}{k.recoveredAt ? ' · recuperado' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(d.evidence.length > 0 || showEvidenceForm) && (
        <div style={card}>
          <h2 style={h2}>Evidencia WinMTR</h2>
          {showEvidenceForm && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
              <label>
                <span style={labelStyle}>Archivo (máx. 2 MB)</span>
                <input type="file" accept={EVIDENCE_ACCEPT} onChange={(e) => setEvFile(e.target.files?.[0] ?? null)} style={{ fontSize: 12 }} />
              </label>
              <label>
                <span style={labelStyle}>Origen</span>
                <select value={evOrigin} onChange={(e) => setEvOrigin(e.target.value as EvidenceOrigin)} style={inputStyle}>
                  {(Object.keys(ORIGIN_LABELS) as EvidenceOrigin[]).map((o) => <option key={o} value={o}>{ORIGIN_LABELS[o]}</option>)}
                </select>
              </label>
              <label style={{ flex: 1, minWidth: 200 }}>
                <span style={labelStyle}>Notas</span>
                <input value={evNotes} onChange={(e) => setEvNotes(e.target.value)} maxLength={1000} style={inputStyle} />
              </label>
              <button type="button" style={btnPrimary} onClick={uploadEvidence} disabled={busy || !evFile}>Subir</button>
            </div>
          )}
          {d.evidence.length === 0 ? (
            <div style={{ fontSize: 12, color: '#6d7577' }}>Sin evidencia adjunta.</div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              {d.evidence.map((ev) => (
                <li key={ev.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => downloadEvidence(ev)} className="text-blue-700 hover:underline" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13 }}>
                    {ev.fileName}
                  </button>
                  <span style={{ color: '#6d7577', fontSize: 12 }}>
                    {ORIGIN_LABELS[ev.origin]} · {fmtDateTime(ev.capturedAt)} · {fmtSize(ev.sizeBytes)}{ev.createdByName ? ` · ${ev.createdByName}` : ''}
                  </span>
                  {ev.notes && <span style={{ fontSize: 12 }}>{ev.notes}</span>}
                  {isAdmin && <button type="button" style={btn} onClick={() => deleteEvidence(ev)}>Eliminar</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <CheckList title="Lo que vio la sonda de Perú" rows={d.checks.office} />
        <CheckList title="Lo que vio la sonda del servidor" rows={d.checks.datacenter} />
      </div>

      <div style={card}>
        <h2 style={h2}>Cronología y notas</h2>
        {d.events.length === 0 ? (
          <div style={{ fontSize: 12, color: '#6d7577' }}>Sin eventos.</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            {d.events.map((e) => (
              <li key={e.id}>
                <span style={{ color: '#6d7577', fontSize: 12 }}>{fmtDateTime(e.at)}</span>{' '}
                <span style={{ whiteSpace: 'pre-wrap' }}>{eventText(e)}</span>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'flex-start' }}>
          <textarea
            aria-label="Nueva nota"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="Añadir una nota…"
            style={{ ...inputStyle, resize: 'vertical' }}
          />
          <button type="button" style={btnPrimary} onClick={addNote} disabled={busy || note.trim() === ''}>Añadir</button>
        </div>
      </div>
    </div>
  );
}

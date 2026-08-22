import { useEffect, useMemo, useRef, useState } from 'react';

import { portalApi } from '../../api/portal.api';
import type {
  Compliance,
  MonthlyReportRequirementsBlock,
  MonthlyReportTicketsBlock,
  PortalMonthlyReport,
  ReportScope,
} from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { DownloadIcon, FileTextIcon, RefreshIcon } from '../../components/ui/Icon';
import { fmtDate } from './PortalTicketsListPage';
import {
  COMPLIANCE_LABELS,
  exportMonthlyReportCsv,
  exportMonthlyReportPdf,
  fmtDueDate,
  fmtPercent,
  monthLabel,
} from './monthly-report-download';

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'purple';

const COMPLIANCE_TONES: Record<Compliance, BadgeTone> = {
  CUMPLIDO: 'success',
  INCUMPLIDO: 'danger',
  SIN_COMPROMISO: 'neutral',
};

const SCOPE_OPTIONS: { value: ReportScope; label: string }[] = [
  { value: 'AMBOS', label: 'Tickets y requerimientos' },
  { value: 'TICKETS', label: 'Solo tickets' },
  { value: 'REQUERIMIENTOS', label: 'Solo requerimientos' },
];

/** Año y mes de "hoy" en hora de Perú -- nunca con `toISOString()`, que daría la fecha en UTC. */
function peruYearMonthNow(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((p) => p.type === 'year')!.value),
    month: Number(parts.find((p) => p.type === 'month')!.value),
  };
}

/**
 * Último mes ya cerrado, como `YYYY-MM` para el `<input type="month">`. El
 * backend rechaza el mes en curso y cualquiera futuro (`isPeruMonthClosed`,
 * en `backend/src/common/peru-month.ts`); este límite se calcula en hora de
 * Perú para que el selector nunca ofrezca un mes que el servidor va a
 * rechazar igual -- ofrecerlo sería ofrecer un error seguro.
 */
function lastClosedMonth(): string {
  const { year, month } = peruYearMonthNow();
  const prevMonth = month - 1;
  return prevMonth === 0 ? `${year - 1}-12` : `${year}-${String(prevMonth).padStart(2, '0')}`;
}

export default function PortalMonthlyReportPage() {
  // Se calcula una sola vez al montar: esta pantalla no queda abierta el
  // tiempo suficiente para que cambie el mes ya cerrado más reciente.
  const maxMonth = useMemo(lastClosedMonth, []);

  const [yearMonth, setYearMonth] = useState(maxMonth);
  const [scope, setScope] = useState<ReportScope>('AMBOS');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PortalMonthlyReport | null>(null);

  /**
   * Corta el camino tardío tras desmontar: entre pedir el informe y su
   * respuesta el cliente puede haber navegado a otra pantalla. Mismo motivo
   * que en `NewPortalRequirementDialog`.
   */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Freno síncrono al doble envío: un `ref`, marcado antes de cualquier
   * `await` y nunca desde un `useState` ni un `useEffect`. Un segundo clic
   * que pasa antes de que `busy` (estado asíncrono, se aplica en el
   * siguiente render) llegue a deshabilitar el botón dispararía una segunda
   * petición idéntica -- este defecto ya se coló dos veces en este mismo
   * proyecto (ver `NewPortalRequirementDialog` y `NewPortalTicketDialog`).
   */
  const inFlight = useRef(false);

  // Guarda de vida: sin mes o sin alcance elegidos no hay nada que pedir.
  const canSubmit = yearMonth.trim().length > 0 && !!scope;

  const generate = async () => {
    // La guarda, antes que nada y sin ningún `await` por delante: entre esta
    // línea y la siguiente no puede colarse otro clic.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await doGenerate();
    } finally {
      inFlight.current = false;
    }
  };

  const doGenerate = async () => {
    if (!canSubmit) return;
    const [yearStr, monthStr] = yearMonth.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return;

    setBusy(true);
    // Limpia TODOS los estados de error del intento anterior (aquí solo hay
    // uno, pero se limpia igual antes de disparar, no solo en el catch): un
    // reintento con éxito que deje a la vista el mensaje de la vez pasada
    // hace creer al cliente que volvió a fallar.
    setError(null);
    setReport(null);

    try {
      const data = await portalApi.getMonthlyReport(year, month, scope);
      if (!alive.current) return;
      setReport(data);
      setBusy(false);
    } catch (e: any) {
      if (alive.current) {
        setError(e?.response?.data?.message ?? 'No se pudo generar el informe.');
        setBusy(false);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Informe mensual</h1>
        <p className="text-sm text-slate-500 mt-1">
          Descarga el informe del servicio recibido en un mes ya cerrado, con el detalle de tickets y
          requerimientos y sus plazos de cumplimiento.
        </p>
      </div>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="label" htmlFor="report-month">
                Mes
              </label>
              <input
                id="report-month"
                type="month"
                className="input w-44"
                value={yearMonth}
                max={maxMonth}
                disabled={busy}
                onChange={(e) => setYearMonth(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="report-scope">
                Alcance
              </label>
              <select
                id="report-scope"
                className="input w-56"
                value={scope}
                disabled={busy}
                onChange={(e) => setScope(e.target.value as ReportScope)}
              >
                {SCOPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="primary"
              icon={<RefreshIcon size={15} />}
              loading={busy}
              disabled={!canSubmit || busy}
              onClick={generate}
            >
              Generar informe
            </Button>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Solo se puede generar el informe de un mes que ya terminó; el mes en curso todavía no está
            disponible.
          </p>
        </CardBody>
      </Card>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {report && (
        <>
          <Card>
            <CardBody className="space-y-2">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    {monthLabel(report.period.year, report.period.month)}
                  </h2>
                  <p className="text-sm text-slate-500">{report.clientName ?? 'Cliente'}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    icon={<FileTextIcon size={15} />}
                    onClick={() => exportMonthlyReportCsv(report)}
                  >
                    Descargar Excel (.csv)
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<DownloadIcon size={15} />}
                    onClick={() => exportMonthlyReportPdf(report)}
                  >
                    Descargar PDF
                  </Button>
                </div>
              </div>
              {/*
                `generatedAtLabel` se pinta tal cual llega del backend: ya
                está en español, en hora de Perú y con la zona escrita. No se
                reformatea ni se deriva de `generatedAt` (el ISO) aquí -- de
                unos veinte formateadores de fecha de este frontend, casi
                ninguno pasa la zona horaria, y por ahí es por donde este
                proyecto ya se ha equivocado antes.
              */}
              <p className="text-xs text-slate-500">Generado: {report.generatedAtLabel}</p>
              {/*
                El criterio, literal: es lo que hace explicable que dos
                descargas del mismo mes puedan traer números distintos. Sin
                él, el informe genera llamadas en vez de evitarlas.
              */}
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                {report.criteria}
              </p>
            </CardBody>
          </Card>

          {/*
            Un bloque `null` no se pinta (no se pidió); uno presente sí,
            aunque venga con la lista vacía y los totales en cero -- «no lo
            pediste» y «no hubo nada» son cosas distintas.
          */}
          {report.tickets && <TicketsBlockCard tickets={report.tickets} />}
          {report.requirements && <RequirementsBlockCard requirements={report.requirements} />}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-slate-800">{value}</p>
      {note && <p className="text-[11px] text-slate-400 mt-0.5">{note}</p>}
    </div>
  );
}

function ComplianceBadge({ value }: { value: Compliance }) {
  return <Badge tone={COMPLIANCE_TONES[value]}>{COMPLIANCE_LABELS[value]}</Badge>;
}

/** «sin compromisos que medir»: la nota que acompaña al «—» de un porcentaje `null`, nunca un 0 %. */
function percentNote(p: number | null): string | undefined {
  return p === null ? 'sin compromisos que medir' : undefined;
}

function TicketsBlockCard({ tickets }: { tickets: MonthlyReportTicketsBlock }) {
  const t = tickets.totals;
  return (
    <Card>
      <CardHeader
        icon={<FileTextIcon size={18} />}
        title="Tickets"
        subtitle={`${t.received} recibidos · ${t.resolved} resueltos · ${t.pending} pendientes`}
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Kpi label="Recibidos" value={t.received} />
          <Kpi label="Resueltos" value={t.resolved} />
          <Kpi label="Pendientes" value={t.pending} />
          <Kpi label="Resueltos en el periodo" value={t.resolvedInPeriod} />
          <Kpi
            label="% cumplimiento respuesta"
            value={fmtPercent(t.responseCompliancePercent)}
            note={percentNote(t.responseCompliancePercent)}
          />
          <Kpi
            label="% cumplimiento resolución"
            value={fmtPercent(t.resolutionCompliancePercent)}
            note={percentNote(t.resolutionCompliancePercent)}
          />
          <Kpi label="Sin compromiso de resolución" value={t.withoutCommitment} />
          <Kpi label="Aún no vence" value={t.notYetDue} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="text-left px-3 py-2 font-medium">#</th>
                <th className="text-left px-3 py-2 font-medium">Código</th>
                <th className="text-left px-3 py-2 font-medium">Asunto</th>
                <th className="text-left px-3 py-2 font-medium">Estado</th>
                <th className="text-left px-3 py-2 font-medium">Captura</th>
                <th className="text-left px-3 py-2 font-medium">1ª respuesta</th>
                <th className="text-left px-3 py-2 font-medium">Resuelto</th>
                <th className="text-left px-3 py-2 font-medium">Cumpl. respuesta</th>
                <th className="text-left px-3 py-2 font-medium">Cumpl. resolución</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tickets.rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                    Ningún ticket en este periodo.
                  </td>
                </tr>
              ) : (
                tickets.rows.map((r, i) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-xs text-slate-400">{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.code ?? `#${r.id}`}</td>
                    <td className="px-3 py-2 text-slate-800">{r.subject ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{r.status}</td>
                    {/*
                      `...Label`, nunca el ISO reformateado aquí: ya viene en
                      hora de Perú, con la hora y la zona escritas -- lo que
                      hace verificable el veredicto de las dos columnas de al
                      lado. Ver el JSDoc de `MonthlyReportTicketRow`.
                    */}
                    <td className="px-3 py-2 text-xs text-slate-500">{r.capturedAtLabel}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{r.firstResponseAtLabel ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{r.resolvedAtLabel ?? '—'}</td>
                    <td className="px-3 py-2">
                      <ComplianceBadge value={r.responseCompliance} />
                    </td>
                    <td className="px-3 py-2">
                      <ComplianceBadge value={r.resolutionCompliance} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function RequirementsBlockCard({ requirements }: { requirements: MonthlyReportRequirementsBlock }) {
  const rq = requirements.totals;
  return (
    <Card>
      <CardHeader
        icon={<FileTextIcon size={18} />}
        title="Requerimientos"
        subtitle={`${rq.requested} solicitados · ${rq.delivered} entregados`}
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Kpi label="Solicitados" value={rq.requested} />
          <Kpi label="Aceptados" value={rq.accepted} />
          <Kpi label="Entregados" value={rq.delivered} />
          <Kpi label="Rechazados" value={rq.rejected} />
          <Kpi
            label="% cumplimiento de compromiso"
            value={fmtPercent(rq.commitmentCompliancePercent)}
            note={percentNote(rq.commitmentCompliancePercent)}
          />
        </div>

        {/*
          Este bloque sale vacío con los datos actuales de producción: solo
          lista los requerimientos pedidos desde el portal
          (`listPortalRequirementsInPeriod`, en el backend). No es un fallo.
        */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="text-left px-3 py-2 font-medium">#</th>
                <th className="text-left px-3 py-2 font-medium">Código</th>
                <th className="text-left px-3 py-2 font-medium">Título</th>
                <th className="text-left px-3 py-2 font-medium">Estado</th>
                <th className="text-left px-3 py-2 font-medium">Creado</th>
                <th className="text-left px-3 py-2 font-medium">Fecha comprometida</th>
                <th className="text-left px-3 py-2 font-medium">Cumplimiento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {requirements.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    Ningún requerimiento pedido desde el portal en este periodo.
                  </td>
                </tr>
              ) : (
                requirements.rows.map((r, i) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-xs text-slate-400">{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.code ?? `#${r.id}`}</td>
                    <td className="px-3 py-2 text-slate-800">{r.title}</td>
                    <td className="px-3 py-2 text-slate-700">{r.status}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{fmtDate(r.createdAt)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{fmtDueDate(r.dueDate)}</td>
                    <td className="px-3 py-2">
                      <ComplianceBadge value={r.commitment} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

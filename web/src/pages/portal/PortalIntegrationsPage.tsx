import { Navigate } from 'react-router-dom';

import { INTEGRATION_API_BASE, portalApiKeys } from '../../api/integration-keys.api';
import { usePortalAuth } from '../../auth/PortalAuthContext';
import ApiKeysManager from '../../components/ApiKeysManager';
import { Card } from '../../components/ui/Card';

const code = 'block whitespace-pre overflow-x-auto rounded-md bg-slate-900 text-slate-100 text-xs p-3';

const ROUTES: Array<[string, string]> = [
  ['GET /tickets', 'Lista de tickets (paginada)'],
  ['GET /tickets/{codigo}', 'Detalle de un ticket, con su historial de estados'],
  ['GET /requerimientos', 'Lista de requerimientos (paginada)'],
  ['GET /requerimientos/{codigo}', 'Detalle de un requerimiento'],
  ['GET /resumen', 'Métricas por mes para dashboards (desde, hasta en YYYY-MM)'],
  ['GET /sistemas', 'Tus sistemas, para traducir sistemaId'],
];

const FILTERS: Array<[string, string]> = [
  ['estado', 'Uno o varios separados por coma. Tickets: NUEVO, TRIAJE, ASIGNADO, EN_ATENCION, ESPERA_CLIENTE, DERIVADO, RESUELTO, CERRADO. Requerimientos: el valor de estadoCodigo.'],
  ['prioridad', 'Tickets: P1 a P4. Requerimientos: ALTA, MEDIA, BAJA.'],
  ['sistemaId', 'Un sistema de /sistemas.'],
  ['creadosDesde, creadosHasta', 'Fecha ISO 8601. Sin hora (2026-11-01) es un día de Lima: creadosHasta=2026-11-30 incluye todo el 30. Con hora, indica la zona (2026-11-01T00:00:00Z).'],
  ['actualizadosDesde', 'Solo lo que cambió desde esa fecha: guarda el actualizadoEn mayor que recibiste y úsalo la próxima vez.'],
  ['limite', 'Registros por página: 100 por defecto, hasta 500 (5000 en CSV).'],
  ['cursor', 'El siguienteCursor de la respuesta anterior, para pedir la página siguiente.'],
  ['formato', 'json (por defecto) o csv. En CSV el cursor llega en la cabecera X-Siguiente-Cursor.'],
];

/**
 * Integraciones del cliente: sus claves de la API y cómo usarla. Solo para el
 * administrador de la empresa; la defensa real es `ClientAdminGuard`.
 */
export default function PortalIntegrationsPage() {
  const { clientUser } = usePortalAuth();
  if (clientUser && !clientUser.isAdmin) return <Navigate to="/portal/tickets" replace />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Integraciones</h1>
        <p className="mt-1 text-sm text-slate-600">
          Consulta tus tickets y requerimientos desde tus propios sistemas (Power BI, Excel, tu intranet) con una clave de API de solo lectura.
          Cada clave ve únicamente los datos de tu empresa.
        </p>
      </div>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Claves de API</h2>
        <ApiKeysManager backend={portalApiKeys} queryKey={['portal', 'api-keys']} />
      </Card>

      <Card className="p-5 space-y-4 text-sm text-slate-700">
        <h2 className="text-sm font-semibold text-slate-900">Cómo usar la API</h2>
        <p>
          Dirección base: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{INTEGRATION_API_BASE}</code>. Envía la clave en la cabecera{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">Authorization: Bearer kci_…</code> (o en <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">X-Api-Key</code>). Nunca la pongas en la URL.
          Límite: 60 peticiones por minuto por clave.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {ROUTES.map(([r, d]) => (
                <tr key={r} className="border-t border-slate-100">
                  <td className="py-1.5 pr-4 font-mono text-xs whitespace-nowrap">{r}</td>
                  <td className="py-1.5 text-slate-600">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filtros de las listas</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {FILTERS.map(([f, d]) => (
                <tr key={f} className="border-t border-slate-100">
                  <td className="py-1.5 pr-4 font-mono text-xs whitespace-nowrap align-top">{f}</td>
                  <td className="py-1.5 text-slate-600">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ejemplos</h3>
        <code className={code}>{`# Tickets que cambiaron desde el 1 de noviembre
curl -H "Authorization: Bearer kci_TU_CLAVE" \\
  "${INTEGRATION_API_BASE}/tickets?actualizadosDesde=2026-11-01"

# Lo mismo en CSV para Excel
curl -H "Authorization: Bearer kci_TU_CLAVE" \\
  "${INTEGRATION_API_BASE}/tickets?formato=csv&limite=5000" -o tickets.csv

# Resumen de los últimos 12 meses
curl -H "Authorization: Bearer kci_TU_CLAVE" "${INTEGRATION_API_BASE}/resumen"`}</code>

        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Power BI</h3>
        <ol className="list-decimal space-y-1 pl-5 text-slate-600">
          <li>Obtener datos → Web → Avanzado.</li>
          <li>En «Elementos de la URL» pega, por ejemplo, <code className="rounded bg-slate-100 px-1 text-xs">{INTEGRATION_API_BASE}/tickets?limite=500</code>.</li>
          <li>En «Parámetros del encabezado de solicitud HTTP» añade <code className="rounded bg-slate-100 px-1 text-xs">Authorization</code> con el valor <code className="rounded bg-slate-100 px-1 text-xs">Bearer kci_TU_CLAVE</code>.</li>
          <li>Acepta, elige acceso «Anónimo» y expande la columna <code className="rounded bg-slate-100 px-1 text-xs">datos</code>.</li>
        </ol>
        <p role="note" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
          <strong>Cada llamada trae como máximo 500 registros</strong> (5000 en CSV). Si la respuesta trae un <code className="rounded bg-white px-1 text-xs">siguienteCursor</code> distinto de null, hay más:
          pídelos añadiendo <code className="rounded bg-white px-1 text-xs">&amp;cursor=…</code> con ese valor. Para un dashboard con todo el histórico usa el CSV con <code className="rounded bg-white px-1 text-xs">limite=5000</code>,
          o <code className="rounded bg-white px-1 text-xs">/resumen</code> si solo necesitas cifras por mes.
        </p>
        <p className="text-slate-600">
          En Excel: Datos → Obtener datos → Desde la web, con la misma URL y cabecera, o abre directamente el CSV descargado.
        </p>
      </Card>
    </div>
  );
}

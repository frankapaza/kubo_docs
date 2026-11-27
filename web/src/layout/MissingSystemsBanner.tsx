import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { ticketsApi } from '../api/tickets.api';

/**
 * Franja del panel: tickets abiertos sin sistema de clientes que sí tienen
 * sistemas. Sin sistema no se pueden trabajar y el conector MCP no los ve
 * (spec 2026-11-27-sistema-obligatorio). Solo aparece si hay alguno.
 */
export default function MissingSystemsBanner() {
  const location = useLocation();
  const summary = useQuery({
    queryKey: ['tickets', 'sin-sistema'],
    queryFn: ticketsApi.withoutSystemSummary,
    refetchInterval: 5 * 60_000,
    staleTime: 30_000,
    // Un fallo aquí no debe molestar: el aviso es de apoyo.
    retry: false,
  });
  const { refetch } = summary;
  // Al cambiar de página se vuelve a mirar (p. ej. tras asignar el sistema en un ticket).
  useEffect(() => {
    void refetch();
  }, [location.pathname, refetch]);

  const data = summary.data;
  if (!data || data.total === 0) return null;
  const detalle = data.porCliente.slice(0, 3).map((c) => `${c.cliente}: ${c.total}`).join(', ');
  const resto = data.porCliente.length > 3 ? ` y ${data.porCliente.length - 3} cliente(s) más` : '';
  return (
    <div
      role="status"
      className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-2.5 text-sm"
      style={{ borderColor: '#f0d9a8', background: '#fff4e0', color: '#7a4a00' }}
    >
      <span className="font-semibold">
        ⚠ {data.total} ticket{data.total === 1 ? '' : 's'} sin sistema asignado
      </span>
      <span>({detalle}{resto}). No se pueden trabajar ni llegan al conector de Claude.</span>
      <Link to="/tickets?sinSistema=1" className="ml-auto font-semibold underline underline-offset-2" style={{ color: '#7a4a00' }}>
        Revisar
      </Link>
    </div>
  );
}

import { usePortalAuth } from '../../auth/PortalAuthContext';

/**
 * PLACEHOLDER — Tarea 10.
 *
 * Esta página existe solo para que la Tarea 9 pueda verificar la navegación
 * de extremo a extremo del portal (login -> layout -> ruta protegida). La
 * Tarea 10 la reemplaza por la lista real de tickets (`portalApi.listTickets`)
 * con su navegación al detalle de cada uno.
 */
export default function PortalTicketsListPage() {
  const { clientUser } = usePortalAuth();

  return (
    <div className="bg-white rounded-2xl shadow-pop border border-slate-100 p-8">
      <h1 className="text-lg font-semibold text-slate-900">Mis tickets</h1>
      <p className="text-sm text-slate-500 mt-2">
        Hola, {clientUser?.fullName ?? 'cliente'}. La lista de tus tickets de soporte se
        implementará en la próxima entrega.
      </p>
    </div>
  );
}

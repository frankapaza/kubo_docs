import { useAuth } from '../auth/AuthContext';
import LatencyAlertSettingsCard from './availability/LatencyAlertSettingsCard';

/**
 * Configuración → Alertas de monitoreo. Lo que se configura una vez para las
 * alertas de Monitoreo; hoy, los destinatarios de la alerta de latencia.
 */
export default function MonitoringAlertsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Alertas de monitoreo</h1>
        <p className="text-sm text-slate-500 mt-1">
          A quién avisan las alertas de Monitoreo y cuándo.
          {!isAdmin && ' Solo un administrador puede cambiarlas.'}
        </p>
      </div>
      <LatencyAlertSettingsCard isAdmin={isAdmin} />
    </div>
  );
}

import type { HealthRows } from '../../shared/health';

/** Salud del monitor: versión del motor, central, último sync, pendientes y rechazo. */
export function Health({ rows }: { rows: HealthRows }) {
  return (
    <section className="panel health" aria-label="Salud del monitor">
      <header>
        <strong>Salud del monitor</strong>
        <button type="button" onClick={() => window.kubo.closeHealth()}>Cerrar</button>
      </header>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </section>
  );
}

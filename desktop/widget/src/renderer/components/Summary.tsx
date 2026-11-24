import type { LoginSummary } from '../../shared/login-summary';

/** Lo ocurrido mientras no había sesión; queda hasta que el usuario lo cierra. */
export function Summary({ summary }: { summary: LoginSummary }) {
  return (
    <section className="panel summary" aria-label="Resumen desde la última sesión">
      <header>
        <strong>Mientras no estabas</strong>
        <button type="button" onClick={() => window.kubo.dismissSummary()}>Entendido</button>
      </header>
      <ul>
        {summary.lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
    </section>
  );
}

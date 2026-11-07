import { buildErrorTicketText } from './error-ticket-text';

const g = {
  id: 42,
  title: 'NullReferenceException en Facturar',
  aplicativo: 'Facturador',
  logger: 'Acme.Facturacion.Servicio',
  servers: ['SRV-01', 'SRV-02'],
  firstSeenAt: new Date('2026-11-07T03:30:00.000Z'),
  lastSeenAt: new Date('2026-11-07T15:00:00.000Z'),
  occurrencesTotal: 1234,
};
const last = { message: 'Objeto no establecido', exception: 'System.NullReferenceException: boom\n  at X.Y()' };

describe('buildErrorTicketText', () => {
  it('incluye cada dato y el enlace al error', () => {
    const { subject, rawText } = buildErrorTicketText(g, last, 'https://app.kubo.test');
    expect(subject).toBe(g.title);
    for (const s of ['Facturador', 'SRV-01, SRV-02', '1234', 'Acme.Facturacion.Servicio', 'Objeto no establecido', 'System.NullReferenceException: boom', 'https://app.kubo.test/monitoreo/errores/42']) {
      expect(rawText).toContain(s);
    }
  });

  it('muestra las fechas en hora de Perú sin depender de la zona del proceso', () => {
    // 03:30 UTC es 10:30 p. m. del día anterior en Lima (UTC-5).
    const { rawText } = buildErrorTicketText(g, last, 'https://x');
    expect(rawText).toMatch(/10:30/);
    expect(rawText).toContain('hora de Perú');
    expect(rawText).toMatch(/6 nov/);
  });

  it('el asunto se recorta a 240 y funciona sin última ocurrencia', () => {
    const { subject, rawText } = buildErrorTicketText({ ...g, title: 'x'.repeat(300) }, null, 'https://x');
    expect(subject).toHaveLength(240);
    expect(rawText).toContain('/monitoreo/errores/42');
  });

  it('una traza enorme deja el texto en 60000 caracteres', () => {
    const { rawText } = buildErrorTicketText(g, { message: 'm', exception: 'a'.repeat(100_000) }, 'https://x');
    expect(rawText).toHaveLength(60_000);
  });
});

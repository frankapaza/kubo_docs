import { buildIncidentTicket } from './ticket-text';

const base = {
  serverName: 'srv-app-01',
  // 15:00 UTC = 10:00 en Lima (UTC-5)
  firstFailureAt: new Date('2026-11-23T15:00:00Z'),
  confirmedAt: new Date('2026-11-23T15:02:00Z'),
  diagnosis: 'El puerto 443 no responde.',
};

describe('buildIncidentTicket', () => {
  it('DOWN de un servicio', () => {
    const t = buildIncidentTicket({ ...base, kind: 'DOWN', serviceNames: ['API'] });
    expect(t.subject).toBe('Caída: API (srv-app-01)');
    expect(t.rawText).toContain('El puerto 443 no responde.');
    expect(t.rawText).toContain('10:00');
    expect(t.rawText).not.toContain('15:00');
  });

  it('ROUTE de un servicio', () => {
    const t = buildIncidentTicket({ ...base, kind: 'ROUTE', serviceNames: ['Web'] });
    expect(t.subject).toBe('Sin acceso desde Perú: Web (srv-app-01)');
  });

  it('servidor con 3 servicios', () => {
    const t = buildIncidentTicket({ ...base, kind: 'DOWN', serviceNames: ['A', 'B', 'C'] });
    expect(t.subject).toBe('Caída del servidor srv-app-01 (3 servicios)');
    expect(t.rawText).toContain('A, B, C');
  });
});

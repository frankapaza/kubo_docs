import { ticketIsVisible } from './actor-scope';

const ticket = (origin: string, clientId: number | string = 7) => ({ clientId, origin }) as any;

describe('ticketIsVisible -- tickets internos', () => {
  const cliente = { restricted: true, clientId: 7 } as const;

  it('un ticket MONITOREO del mismo clientId es invisible con alcance restringido', () => {
    expect(ticketIsVisible(ticket('MONITOREO'), cliente)).toBe(false);
  });

  it('un ticket MONITOREO es visible para el equipo (sin restringir)', () => {
    expect(ticketIsVisible(ticket('MONITOREO'), { restricted: false })).toBe(true);
  });

  it('un ticket PORTAL del mismo cliente sigue visible, aunque el clientId llegue como cadena', () => {
    expect(ticketIsVisible(ticket('PORTAL', '7'), cliente)).toBe(true);
  });

  it('un ticket PORTAL de otro cliente sigue invisible', () => {
    expect(ticketIsVisible(ticket('PORTAL', 8), cliente)).toBe(false);
  });
});

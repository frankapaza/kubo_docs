import { ConflictException } from '@nestjs/common';
import {
  GroupState,
  assertCanCreateTicket,
  assertCanReopen,
  assertCanResolve,
  decideOnOccurrence,
} from './error-group-state';

const d = (s: string) => new Date(s);
const ocurre = d('2026-11-07T12:00:00Z');
const antes = d('2026-11-07T08:00:00Z');
const despues = d('2026-11-07T15:00:00Z');

const grupo = (extra: Partial<GroupState>): GroupState => ({
  status: 'NUEVO',
  resolvedAt: null,
  ticketId: null,
  ticket: null,
  ...extra,
});
const ticket = (extra = {}) => ({
  code: 'KB-0012',
  status: 'EN_ATENCION' as const,
  resolvedAt: null,
  closedAt: null,
  ...extra,
});

describe('decideOnOccurrence', () => {
  it('sin grupo: NUEVO, notifica', () => {
    expect(decideOnOccurrence(null, ocurre)).toEqual({
      status: 'NUEVO',
      notify: true,
      reopened: false,
      reason: null,
    });
  });
  it('NUEVO sigue sin notificar', () => {
    expect(decideOnOccurrence(grupo({}), ocurre)).toEqual({
      status: 'NUEVO',
      notify: false,
      reopened: false,
      reason: null,
    });
  });
  it('RESUELTO y reaparece después: reabre', () => {
    expect(decideOnOccurrence(grupo({ status: 'RESUELTO', resolvedAt: antes }), ocurre)).toEqual({
      status: 'NUEVO',
      notify: true,
      reopened: true,
      reason: 'Reapareció después de marcarse como resuelto',
    });
  });
  it('RESUELTO y la ocurrencia es anterior a resolvedAt: sigue resuelto', () => {
    expect(decideOnOccurrence(grupo({ status: 'RESUELTO', resolvedAt: despues }), ocurre)).toEqual({
      status: 'RESUELTO',
      notify: false,
      reopened: false,
      reason: null,
    });
  });
  it('CON_TICKET sin ticket y con reserva reciente: alta en curso, no reabre', () => {
    const now = d('2026-11-07T12:04:00Z');
    const g = grupo({ status: 'CON_TICKET', ticketId: null, ticketLinkedAt: d('2026-11-07T12:00:30Z') });
    expect(decideOnOccurrence(g, ocurre, now)).toEqual({ status: 'CON_TICKET', notify: false, reopened: false, reason: null });
  });
  it('CON_TICKET sin ticket y con reserva vieja: alta fallida, reabre', () => {
    const now = d('2026-11-07T12:06:00Z');
    const g = grupo({ status: 'CON_TICKET', ticketId: null, ticketLinkedAt: d('2026-11-07T12:00:00Z') });
    expect(decideOnOccurrence(g, ocurre, now)).toMatchObject({ status: 'NUEVO', reopened: true, reason: 'Reapareció y su ticket ya no existe' });
  });
  it('CON_TICKET con ticket en atención: igual', () => {
    expect(
      decideOnOccurrence(grupo({ status: 'CON_TICKET', ticketId: 1, ticket: ticket() }), ocurre),
    ).toEqual({ status: 'CON_TICKET', notify: false, reopened: false, reason: null });
  });
  it('CON_TICKET con ticket resuelto antes: reabre', () => {
    expect(
      decideOnOccurrence(
        grupo({
          status: 'CON_TICKET',
          ticketId: 1,
          ticket: ticket({ status: 'RESUELTO', resolvedAt: antes }),
        }),
        ocurre,
      ),
    ).toEqual({
      status: 'NUEVO',
      notify: true,
      reopened: true,
      reason: 'Reapareció tras el ticket KB-0012',
    });
  });
  it('ticket CERRADO sin resolvedAt usa closedAt', () => {
    const g = (closedAt: Date) =>
      grupo({
        status: 'CON_TICKET',
        ticketId: 1,
        ticket: ticket({ status: 'CERRADO', closedAt }),
      });
    expect(decideOnOccurrence(g(antes), ocurre).reopened).toBe(true);
    expect(decideOnOccurrence(g(despues), ocurre).reopened).toBe(false);
  });
  it('ticket resuelto después de la ocurrencia: sigue CON_TICKET', () => {
    const r = decideOnOccurrence(
      grupo({
        status: 'CON_TICKET',
        ticketId: 1,
        ticket: ticket({ status: 'RESUELTO', resolvedAt: despues }),
      }),
      ocurre,
    );
    expect(r).toEqual({ status: 'CON_TICKET', notify: false, reopened: false, reason: null });
  });
  it('ticketId con ticket borrado: reabre', () => {
    expect(
      decideOnOccurrence(grupo({ status: 'CON_TICKET', ticketId: 9, ticket: null }), ocurre),
    ).toEqual({
      status: 'NUEVO',
      notify: true,
      reopened: true,
      reason: 'Reapareció y su ticket ya no existe',
    });
  });
});

describe('guardas de transición', () => {
  const cuerpo = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      return (e as ConflictException).getResponse() as { code: string };
    }
    throw new Error('no lanzó');
  };
  it('crear ticket sobre CON_TICKET -> 409', () => {
    expect(cuerpo(() => assertCanCreateTicket('CON_TICKET')).code).toBe('CONFLICT');
    expect(() => assertCanCreateTicket('NUEVO')).not.toThrow();
  });
  it('resolver RESUELTO -> 409', () => {
    expect(cuerpo(() => assertCanResolve('RESUELTO')).code).toBe('CONFLICT');
    expect(() => assertCanResolve('NUEVO')).not.toThrow();
  });
  it('reabrir NUEVO -> 409', () => {
    expect(cuerpo(() => assertCanReopen('NUEVO')).code).toBe('CONFLICT');
    expect(() => assertCanReopen('RESUELTO')).not.toThrow();
  });
});

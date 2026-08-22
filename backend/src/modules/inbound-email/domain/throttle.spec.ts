import {
  NEW_TICKETS_MAX_PER_ADDRESS_PER_HOUR,
  UNKNOWN_REPLY_MAX_PER_HOUR,
  hasReachedNewTicketCap,
  shouldReplyToUnknown,
} from './throttle';

describe('shouldReplyToUnknown', () => {
  it('sin respuestas previas a esa dirección y sin tope global agotado, se responde', () => {
    expect(
      shouldReplyToUnknown({ repliesToAddressInCooldown: 0, repliesGlobalLastHour: 0 }),
    ).toBe(true);
  });

  /**
   * "Ya recibió respuesta hace 2 días" se traduce, en la consulta que hace
   * `InboundEmailService`, a un conteo mayor que cero dentro de la ventana de
   * enfriamiento -- esta función pura no ve la fecha, solo el conteo ya
   * acotado a esa ventana.
   */
  it('con una respuesta ya mandada a esa dirección dentro del enfriamiento, NO se responde', () => {
    expect(
      shouldReplyToUnknown({ repliesToAddressInCooldown: 1, repliesGlobalLastHour: 0 }),
    ).toBe(false);
  });

  /**
   * "La recibió hace 8 días" cae fuera de la ventana de enfriamiento (7
   * días): la consulta de `InboundEmailService` no la habría contado, así
   * que aquí llega como cero -- y con cero, el enfriamiento ya no bloquea.
   */
  it('con el conteo de esa dirección en cero (la última respuesta cayó fuera del enfriamiento), sí se responde', () => {
    expect(
      shouldReplyToUnknown({ repliesToAddressInCooldown: 0, repliesGlobalLastHour: 0 }),
    ).toBe(true);
  });

  it('superado el tope global, no se responde a nadie más aunque esta dirección no tenga historial', () => {
    expect(
      shouldReplyToUnknown({
        repliesToAddressInCooldown: 0,
        repliesGlobalLastHour: UNKNOWN_REPLY_MAX_PER_HOUR,
      }),
    ).toBe(false);
  });

  it('justo por debajo del tope global, todavía se responde', () => {
    expect(
      shouldReplyToUnknown({
        repliesToAddressInCooldown: 0,
        repliesGlobalLastHour: UNKNOWN_REPLY_MAX_PER_HOUR - 1,
      }),
    ).toBe(true);
  });

  it('con los dos topes agotados a la vez, sigue sin responderse', () => {
    expect(
      shouldReplyToUnknown({
        repliesToAddressInCooldown: 3,
        repliesGlobalLastHour: UNKNOWN_REPLY_MAX_PER_HOUR + 5,
      }),
    ).toBe(false);
  });
});

describe('hasReachedNewTicketCap', () => {
  it('por debajo del tope, no se ha alcanzado', () => {
    expect(hasReachedNewTicketCap(NEW_TICKETS_MAX_PER_ADDRESS_PER_HOUR - 1)).toBe(false);
  });

  it('justo en el tope, ya se considera alcanzado -- no hace falta superarlo', () => {
    expect(hasReachedNewTicketCap(NEW_TICKETS_MAX_PER_ADDRESS_PER_HOUR)).toBe(true);
  });

  it('por encima del tope, sigue alcanzado', () => {
    expect(hasReachedNewTicketCap(NEW_TICKETS_MAX_PER_ADDRESS_PER_HOUR + 1)).toBe(true);
  });

  it('sin ningún ticket nuevo, no se ha alcanzado', () => {
    expect(hasReachedNewTicketCap(0)).toBe(false);
  });
});

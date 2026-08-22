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

  /**
   * Ronda de correcciones 1: un conteo ausente no puede colarse como "no hay
   * historial". Sin la guarda de `isUsableCount`, `null > 0` es `false` --
   * el mismo efecto que un cero de verdad -- y `null < UNKNOWN_REPLY_MAX_PER_HOUR`
   * también es `false`... salvo que aquí el sentido de esa segunda
   * comparación es el que SÍ debería dar `true` para permitir la respuesta;
   * la combinación de las dos coincidencias de `null` con `<`/`>` es
   * exactamente el defecto que este test fija en rojo si alguien quita la
   * guarda.
   */
  it.each([
    ['ambos conteos ausentes (null)', null, null],
    ['el conteo por dirección ausente', null, 0],
    ['el conteo global ausente', 0, null],
    ['el conteo por dirección es NaN', NaN, 0],
    ['el conteo global es NaN', 0, NaN],
    ['el conteo global es Infinity', 0, Infinity],
  ])('con %s, no se responde -- fallo cerrado', (_nombre, repliesToAddressInCooldown, repliesGlobalLastHour) => {
    expect(
      shouldReplyToUnknown({
        repliesToAddressInCooldown: repliesToAddressInCooldown as unknown as number,
        repliesGlobalLastHour: repliesGlobalLastHour as unknown as number,
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

  /**
   * Ronda de correcciones 1: la asimetría accidental que delataba la falta
   * de guarda -- aquí la comparación es `>=`, así que un conteo ausente
   * (`null >= 10` es `false`) habría fallado ABIERTO, al revés que en
   * `shouldReplyToUnknown` de arriba. Los dos topes deben fallar cerrado
   * pase lo que pase con el sentido de su comparación.
   */
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
  ])('con un conteo no usable (%s), se trata como tope YA alcanzado -- fallo cerrado', (_nombre, valor) => {
    expect(hasReachedNewTicketCap(valor as unknown as number)).toBe(true);
  });
});

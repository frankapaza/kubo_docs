import { MESSAGE_ID_COLUMN_MAX_LENGTH, appendRequeuedReason, buildRequeuedMessageId } from './retry';

const UN_INSTANTE = new Date('2026-08-22T15:30:00Z');

describe('buildRequeuedMessageId', () => {
  it('añade el sufijo con el id de la fila y el instante, detrás del original', () => {
    const resultado = buildRequeuedMessageId('<falla@empresa.com>', 42, UN_INSTANTE);

    expect(resultado).toBe(`<falla@empresa.com>#reintento-42-${UN_INSTANTE.getTime()}`);
  });

  /**
   * Dos filas distintas reencoladas en el mismo instante no pueden acabar con
   * el mismo `message_id` -- chocarían contra la clave única que este propio
   * mecanismo existe para esquivar. El id de la fila es lo que las distingue
   * cuando el reloj no alcanza a hacerlo.
   */
  it('dos filas distintas reencoladas en el mismo instante producen valores distintos', () => {
    const uno = buildRequeuedMessageId('<mismo@empresa.com>', 1, UN_INSTANTE);
    const otro = buildRequeuedMessageId('<mismo@empresa.com>', 2, UN_INSTANTE);

    expect(uno).not.toBe(otro);
  });

  it('el mismo reintento repetido dos veces (instantes distintos) tampoco colisiona', () => {
    const primero = buildRequeuedMessageId('<mismo@empresa.com>', 1, new Date('2026-08-22T15:30:00Z'));
    const segundo = buildRequeuedMessageId('<mismo@empresa.com>', 1, new Date('2026-08-22T15:30:01Z'));

    expect(primero).not.toBe(segundo);
  });

  /**
   * La columna tiene un límite (998, RFC 5322 §2.1.1). Un original ya en ese
   * límite no puede crecer con el sufijo sin que la base rechace el `UPDATE`
   * -- así que se recorta el ORIGINAL, nunca el sufijo: el sufijo es lo que
   * hace visible que la fila ya se reencoló.
   */
  it('recorta el original si el resultado excedería el límite de la columna, sin tocar el sufijo', () => {
    const original = 'x'.repeat(MESSAGE_ID_COLUMN_MAX_LENGTH);

    const resultado = buildRequeuedMessageId(original, 7, UN_INSTANTE);

    expect(resultado.length).toBeLessThanOrEqual(MESSAGE_ID_COLUMN_MAX_LENGTH);
    expect(resultado.endsWith(`#reintento-7-${UN_INSTANTE.getTime()}`)).toBe(true);
  });

  it('un original muy por debajo del límite no se toca en absoluto', () => {
    const resultado = buildRequeuedMessageId('<corto@x.com>', 1, UN_INSTANTE);

    expect(resultado.startsWith('<corto@x.com>')).toBe(true);
  });
});

describe('appendRequeuedReason', () => {
  it('con un motivo original, lo conserva y añade la nota del reintento debajo', () => {
    const resultado = appendRequeuedReason(
      'Fallo de red al escribir el ticket.',
      'tecnico@kuboti.com',
      UN_INSTANTE,
    );

    expect(resultado).toContain('Fallo de red al escribir el ticket.');
    expect(resultado).toContain('tecnico@kuboti.com');
    expect(resultado).toContain('Reencolado el');
  });

  /**
   * El texto lo lee una persona en la pantalla de correo entrante -- este
   * proyecto lleva cinco fallos de zona horaria, y la fecha del reintento no
   * queda exenta de esa regla por ser "solo un motivo interno".
   */
  it('escribe la fecha en hora de Perú, con la zona nombrada', () => {
    const resultado = appendRequeuedReason(null, 'tecnico@kuboti.com', UN_INSTANTE);

    // 2026-08-22T15:30:00Z son las 10:30 a. m. en Lima (UTC-5).
    expect(resultado).toContain('hora de Perú');
    expect(resultado).toMatch(/10:30/);
  });

  it('sin motivo original (null), el resultado es solo la nota del reintento', () => {
    const resultado = appendRequeuedReason(null, 'tecnico@kuboti.com', UN_INSTANTE);

    expect(resultado.startsWith('Reencolado el')).toBe(true);
  });

  it('con un motivo original en blanco, se trata igual que ausente', () => {
    const resultado = appendRequeuedReason('   ', 'tecnico@kuboti.com', UN_INSTANTE);

    expect(resultado.startsWith('Reencolado el')).toBe(true);
  });
});

import { correlate } from './correlation';

const BASE = { inReplyTo: null, references: null, subject: null, byMessageId: [], byCode: null, senderClientId: 7 };

describe('correlate', () => {
  it('sin ninguna referencia, es un ticket nuevo', () => {
    expect(correlate(BASE)).toEqual({ kind: 'NUEVO', reason: 'SIN_REFERENCIA' });
  });

  it('con la cabecera apuntando a un ticket propio, va al hilo', () => {
    expect(correlate({ ...BASE, inReplyTo: '<a@x>', byMessageId: [{ ticketId: 5, clientId: 7 }] }))
      .toEqual({ kind: 'HILO', ticketId: 5, via: 'CABECERA' });
  });

  // La frontera, por el camino de las cabeceras.
  it('una cabecera que apunta a un ticket de OTRA empresa abre uno nuevo', () => {
    expect(correlate({ ...BASE, inReplyTo: '<a@x>', byMessageId: [{ ticketId: 5, clientId: 99 }] }))
      .toEqual({ kind: 'NUEVO', reason: 'REFERENCIA_DE_OTRA_EMPRESA' });
  });

  it('con el codigo en el asunto y el ticket es propio, va al hilo', () => {
    expect(correlate({ ...BASE, subject: 'Re: [KB-5] Algo', byCode: { ticketId: 5, clientId: 7 } }))
      .toEqual({ kind: 'HILO', ticketId: 5, via: 'ASUNTO' });
  });

  // LA PRUEBA MAS IMPORTANTE DEL PROYECTO. Un identificador en el asunto es
  // adivinable: sin esta regla, cualquiera con una direccion registrada
  // escribiria en el hilo de cualquier otra empresa poniendo su numero.
  it('el codigo en el asunto de un ticket AJENO abre uno nuevo, no toca el ajeno', () => {
    expect(correlate({ ...BASE, subject: 'Re: [KB-5] Algo', byCode: { ticketId: 5, clientId: 99 } }))
      .toEqual({ kind: 'NUEVO', reason: 'REFERENCIA_DE_OTRA_EMPRESA' });
  });

  it('la cabecera manda sobre el asunto cuando las dos apuntan a sitios distintos', () => {
    expect(correlate({
      ...BASE, inReplyTo: '<a@x>', subject: 'Re: [KB-9] Algo',
      byMessageId: [{ ticketId: 5, clientId: 7 }], byCode: { ticketId: 9, clientId: 7 },
    })).toEqual({ kind: 'HILO', ticketId: 5, via: 'CABECERA' });
  });

  it('si la cabecera es de otra empresa NO cae al asunto: abre uno nuevo', () => {
    expect(correlate({
      ...BASE, inReplyTo: '<a@x>', subject: 'Re: [KB-9] Algo',
      byMessageId: [{ ticketId: 5, clientId: 99 }], byCode: { ticketId: 9, clientId: 7 },
    })).toEqual({ kind: 'NUEVO', reason: 'REFERENCIA_DE_OTRA_EMPRESA' });
  });

  it('usa References cuando no hay In-Reply-To', () => {
    expect(correlate({ ...BASE, references: '<a@x> <b@x>', byMessageId: [{ ticketId: 5, clientId: 7 }] }))
      .toEqual({ kind: 'HILO', ticketId: 5, via: 'CABECERA' });
  });
});

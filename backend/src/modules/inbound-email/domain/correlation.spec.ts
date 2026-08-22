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

  // Mata el mutante `sameId` -> `===`: con esa comparacion, un `clientId`
  // hidratado como cadena por TypeORM nunca igualaria a un `senderClientId`
  // numerico, y el dueño legitimo de un ticket recibiria "de otra empresa"
  // en cada respuesta -- una alarma de seguridad falsa en masa.
  it('un clientId que llega como cadena sigue siendo la misma empresa que un senderClientId numerico', () => {
    expect(correlate({ ...BASE, inReplyTo: '<a@x>', byMessageId: [{ ticketId: 5, clientId: '7' }] }))
      .toEqual({ kind: 'HILO', ticketId: 5, via: 'CABECERA' });
  });

  // Mata el mutante `sameId` -> `==`: con esa comparacion, `null == undefined`
  // es cierto, asi que un ticket sin empresa se emparejaria con un remitente
  // sin empresa resuelta. `sameId` falla cerrado: sin id en las dos puntas,
  // no hay coincidencia posible.
  it('un ticket sin empresa no coincide con un remitente sin empresa resuelta', () => {
    expect(correlate({
      ...BASE, inReplyTo: '<a@x>', senderClientId: null,
      byMessageId: [{ ticketId: 5, clientId: null }],
    })).toEqual({ kind: 'NUEVO', reason: 'REFERENCIA_DE_OTRA_EMPRESA' });
  });

  // El ticketId sale siempre como `number`, aunque el repositorio lo haya
  // hidratado como cadena (misma mentira de TypeORM que `clientId`).
  it('normaliza el ticketId a number aunque llegue como cadena', () => {
    expect(correlate({ ...BASE, inReplyTo: '<a@x>', byMessageId: [{ ticketId: '5', clientId: 7 }] }))
      .toEqual({ kind: 'HILO', ticketId: 5, via: 'CABECERA' });
  });

  // Dos coincidencias por cabecera con ticketId distinto son una ambiguedad,
  // no una eleccion: la misma politica que `extractTicketCode` ante dos
  // codigos en el asunto. Elegir "la primera de la lista" dependeria del
  // orden en que el repositorio devuelva las filas, que nadie promete.
  it('dos coincidencias propias distintas por cabecera no eligen ninguna: abre uno nuevo', () => {
    expect(correlate({
      ...BASE, inReplyTo: '<a@x>',
      byMessageId: [{ ticketId: 5, clientId: 7 }, { ticketId: 6, clientId: 7 }],
    })).toEqual({ kind: 'NUEVO', reason: 'REFERENCIA_NO_RESUELTA' });
  });

  // La misma ambiguedad aunque una de las dos coincidencias sea ajena: no se
  // "gana por descarte" quedandose con la propia, porque la ambiguedad en si
  // misma ya es una señal de que la cabecera no identifica un hilo unico.
  it('una coincidencia propia y otra ajena por cabecera tampoco se resuelven solas: abre uno nuevo', () => {
    expect(correlate({
      ...BASE, inReplyTo: '<a@x>',
      byMessageId: [{ ticketId: 5, clientId: 7 }, { ticketId: 6, clientId: 99 }],
    })).toEqual({ kind: 'NUEVO', reason: 'REFERENCIA_NO_RESUELTA' });
  });

  // Habia cabecera (un In-Reply-To de verdad) pero ningun ticket la
  // reconocio -- el ticket se borro, o el id no existe. Eso no es lo mismo
  // que no haber traido ninguna referencia: confundirlos esconde justo la
  // señal de alguien sondeando identificadores ajenos.
  it('la cabecera trae un identificador pero no encuentra ningun ticket: no es SIN_REFERENCIA', () => {
    expect(correlate({ ...BASE, inReplyTo: '<a@x>', byMessageId: [] }))
      .toEqual({ kind: 'NUEVO', reason: 'REFERENCIA_NO_RESUELTA' });
  });

  // Lo mismo por el lado de References: si no se leyera de verdad este
  // campo (y no solo `byMessageId`), este caso seria indistinguible de
  // "sin ninguna referencia".
  it('References sin match tambien es referencia no resuelta, no ausencia', () => {
    expect(correlate({ ...BASE, references: '<a@x> <b@x>', byMessageId: [] }))
      .toEqual({ kind: 'NUEVO', reason: 'REFERENCIA_NO_RESUELTA' });
  });

  // El asunto traia un codigo, pero ningun ticket tiene ese codigo.
  it('el asunto trae un codigo pero no hay ningun ticket con ese codigo: tampoco es SIN_REFERENCIA', () => {
    expect(correlate({ ...BASE, subject: 'Re: [KB-9] Algo', byCode: null }))
      .toEqual({ kind: 'NUEVO', reason: 'REFERENCIA_NO_RESUELTA' });
  });
});

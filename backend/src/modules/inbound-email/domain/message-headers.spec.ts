import { extractTicketCode, isAutomaticMessage, parseMessageIds, stripSubjectPrefixes } from './message-headers';

describe('parseMessageIds', () => {
  it('extrae un identificador con corchetes', () => {
    expect(parseMessageIds('<abc@kuboti.com>')).toEqual(['<abc@kuboti.com>']);
  });

  it('extrae varios de un References, en orden', () => {
    expect(parseMessageIds('<a@x> <b@x>\r\n <c@x>')).toEqual(['<a@x>', '<b@x>', '<c@x>']);
  });

  // Un cliente de correo que omite los corchetes existe, y su respuesta no
  // debe perderse por eso.
  it('acepta un identificador sin corchetes y lo normaliza', () => {
    expect(parseMessageIds('abc@kuboti.com')).toEqual(['<abc@kuboti.com>']);
  });

  it('devuelve vacio con nulo, indefinido o cadena vacia', () => {
    expect(parseMessageIds(null)).toEqual([]);
    expect(parseMessageIds(undefined)).toEqual([]);
    expect(parseMessageIds('   ')).toEqual([]);
  });
});

describe('stripSubjectPrefixes', () => {
  it.each([
    ['Re: Algo falla', 'Algo falla'],
    ['RE: RE: Algo falla', 'Algo falla'],
    ['RV: Algo falla', 'Algo falla'],
    ['Fwd: Re: Algo falla', 'Algo falla'],
    ['  re : Algo falla', 'Algo falla'],
  ])('%s -> %s', (entrada, esperado) => {
    expect(stripSubjectPrefixes(entrada)).toBe(esperado);
  });

  it('no toca un asunto que empieza por una palabra parecida', () => {
    expect(stripSubjectPrefixes('Revision del contrato')).toBe('Revision del contrato');
  });
});

describe('extractTicketCode', () => {
  it('saca el codigo de un asunto con acuse', () => {
    expect(extractTicketCode('Re: [KB-1234] Algo falla')).toBe('KB-1234');
  });

  it('lo encuentra aunque no este al principio', () => {
    expect(extractTicketCode('Algo falla [KB-0007]')).toBe('KB-0007');
  });

  it('devuelve null si no hay ninguno', () => {
    expect(extractTicketCode('Algo falla')).toBeNull();
  });

  // Si hay dos, no adivinamos: es un reenvio de una conversacion mezclada y
  // acertar por casualidad es peor que abrir un ticket nuevo.
  it('devuelve null si hay mas de uno', () => {
    expect(extractTicketCode('[KB-1] y [KB-2]')).toBeNull();
  });
});

describe('isAutomaticMessage', () => {
  it.each([
    { 'auto-submitted': 'auto-replied' },
    { 'auto-submitted': 'auto-generated' },
    { precedence: 'bulk' },
    { precedence: 'list' },
    { 'x-auto-response-suppress': 'All' },
    { 'list-id': '<lista.ejemplo.com>' },
  ])('reconoce %o', (cabeceras) => {
    expect(isAutomaticMessage(cabeceras as any)).toBe(true);
  });

  it('un correo normal no es automatico', () => {
    expect(isAutomaticMessage({ from: 'a@x.com', subject: 'Hola' })).toBe(false);
  });

  // `Auto-Submitted: no` es el valor que la norma define para el correo
  // escrito por una persona. Tratarlo como automatico silenciaria respuestas
  // legitimas de clientes cuyos servidores lo anaden.
  it('Auto-Submitted: no NO es automatico', () => {
    expect(isAutomaticMessage({ 'auto-submitted': 'no' })).toBe(false);
  });
});

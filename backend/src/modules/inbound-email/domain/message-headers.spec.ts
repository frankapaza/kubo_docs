import {
  extractSenderAddress,
  extractTicketCode,
  isAutomaticMessage,
  parseMessageIds,
  stripSubjectPrefixes,
} from './message-headers';

describe('extractSenderAddress', () => {
  it('desenvuelve un From con nombre para mostrar', () => {
    expect(extractSenderAddress('"Ana Quispe" <ana@empresa.com>')).toBe('ana@empresa.com');
  });

  it('desenvuelve un nombre sin comillas', () => {
    expect(extractSenderAddress('Ana Quispe <ana@empresa.com>')).toBe('ana@empresa.com');
  });

  it('deja igual una direccion ya desnuda', () => {
    expect(extractSenderAddress('ana@empresa.com')).toBe('ana@empresa.com');
  });

  it('normaliza mayusculas y espacios en los dos casos', () => {
    expect(extractSenderAddress('  Ana Quispe <Ana@Empresa.COM>  ')).toBe('ana@empresa.com');
    expect(extractSenderAddress('  Ana@Empresa.COM  ')).toBe('ana@empresa.com');
  });

  // Es la misma comparacion que ya usa `isOwnMailbox`: exacta y no "contiene",
  // para que un dominio que solo se parezca no cuente como el mismo.
  it('no se equivoca con un dominio parecido, solo desenvuelve el <>', () => {
    expect(extractSenderAddress('Alguien <ticket@kuboti.com.atacante.net>')).toBe(
      'ticket@kuboti.com.atacante.net',
    );
  });
});

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

  // References separado por comas existe en la practica (algunos clientes lo
  // escriben asi). Si se tratara la coma como parte del identificador, la
  // correlacion posterior por igualdad de cadena nunca encontraria pareja y
  // el hilo se romperia.
  it('extrae varios identificadores con corchetes separados por comas', () => {
    expect(parseMessageIds('<a@x>,<b@x>')).toEqual(['<a@x>', '<b@x>']);
  });

  // La rama de respaldo (sin corchetes) tenia el mismo problema: partia solo
  // por espacios, asi que una coma sin espacio alrededor se quedaba pegada
  // al identificador y ya no volvia a coincidir con nada al comparar.
  it('separa tambien por comas cuando no hay corchetes', () => {
    expect(parseMessageIds('a@x,b@x')).toEqual(['<a@x>', '<b@x>']);
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

  // Si hay dos codigos DISTINTOS, no adivinamos: es un reenvio de una
  // conversacion mezclada y acertar por casualidad es peor que abrir un
  // ticket nuevo.
  it('devuelve null si hay mas de uno', () => {
    expect(extractTicketCode('[KB-1] y [KB-2]')).toBeNull();
  });

  // El mismo codigo repetido no es una mezcla de conversaciones: es un
  // asunto acumulado por reenvios sucesivos ("Fwd: [KB-1234] Fwd:
  // [KB-1234] ..."), algo corriente. Contar apariciones en vez de codigos
  // unicos forzaria un ticket nuevo justo en el caso que este modulo existe
  // para evitar: la respuesta de un cliente a su propio ticket.
  it('no cuenta como ambiguo el mismo codigo repetido', () => {
    expect(extractTicketCode('Re: [KB-1234] Fwd: [KB-1234] Algo falla')).toBe('KB-1234');
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

  // `precedence: normal` y `precedence: first-class` son los valores que la
  // cabecera define para correo escrito por una persona -- lo mismo que
  // `Auto-Submitted: no`, pero para `Precedence`. Decidir por la sola
  // presencia de la clave (en vez de por el valor que trae) silenciaria sin
  // aviso a cualquier cliente cuyo servidor la anada con uno de estos dos
  // valores: su respuesta se descartaria como automatica y nunca se le
  // contestaria.
  it.each([{ precedence: 'normal' }, { precedence: 'first-class' }])(
    'precedence con valor de persona no es automatico: %o',
    (cabeceras) => {
      expect(isAutomaticMessage(cabeceras)).toBe(false);
    },
  );

  // Lo mismo para las cabeceras que si decidimos por presencia: la cabecera
  // tiene que estar de verdad, no solo la clave con un valor vacio (que en
  // la practica es como si no estuviera).
  it.each(['x-auto-response-suppress', 'list-id'] as const)(
    '%s con valor en blanco no es automatico',
    (clave) => {
      expect(isAutomaticMessage({ [clave]: '   ' })).toBe(false);
    },
  );

  // La misma regla de "valor no vacio" tiene que aplicarse a las cuatro
  // cabeceras por igual. `auto-submitted` quedaba fuera: un valor en blanco
  // no es ninguno de los valores que la norma define (ni "no" ni un tipo de
  // automatizacion), asi que no es evidencia de nada -- igual que un
  // `list-id` en blanco no lo es.
  it('auto-submitted con valor en blanco no es automatico', () => {
    expect(isAutomaticMessage({ 'auto-submitted': '   ' })).toBe(false);
  });
});

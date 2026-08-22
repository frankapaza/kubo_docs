import { stripQuotedText } from './quoted-text';

describe('stripQuotedText', () => {
  it('corta en la linea de atribucion de Gmail', () => {
    const cuerpo = 'Gracias, ya funciona.\n\nEl mar, 5 ago 2026 a las 10:03, Soporte <ticket@kuboti.com> escribio:\n> Hola, hemos...';
    expect(stripQuotedText(cuerpo)).toBe('Gracias, ya funciona.');
  });

  it('corta en el separador de Outlook', () => {
    const cuerpo = 'Confirmado.\n\n-----Mensaje original-----\nDe: Soporte\n...';
    expect(stripQuotedText(cuerpo)).toBe('Confirmado.');
  });

  it('corta en un bloque de lineas con >', () => {
    expect(stripQuotedText('Vale.\n\n> lo anterior\n> mas de lo anterior')).toBe('Vale.');
  });

  it('deja intacto un correo sin cita', () => {
    expect(stripQuotedText('Buenos dias, tengo un problema.')).toBe('Buenos dias, tengo un problema.');
  });

  // Lo que NO debe hacer: si el recorte se comiera todo, el mensaje quedaria
  // vacio en el hilo y el cliente veria una burbuja en blanco. Ante la duda,
  // se devuelve el original: por eso ademas se guarda el cuerpo completo.
  it('devuelve el original si el recorte lo dejaria vacio', () => {
    const soloCita = '> solo cita\n> nada mas';
    expect(stripQuotedText(soloCita)).toBe(soloCita);
  });

  it('no se traga una linea que empieza por > en medio de una frase util', () => {
    const cuerpo = 'El error dice:\n> Timeout\ny pasa siempre.';
    expect(stripQuotedText(cuerpo)).toBe(cuerpo);
  });

  // El falso positivo real: cualquier parrafo en espanol que termine en
  // "escribio:" (p. ej. describiendo lo que alguien anoto en un informe) no
  // es una atribucion de cita si despues sigue contenido normal, no una
  // cita. Decapitar el mensaje del cliente por esto es peor que no recortar
  // nada -- la regla de "todo desde ahi hasta el final debe ser cita o
  // marcador" es la que evita justamente este caso.
  it('no decapita un parrafo real que termina en "escribio:" seguido de texto normal', () => {
    const cuerpo =
      'Hola,\n\nEl tecnico que vino ayer escribio:\nque el disco estaba lleno, pero sigue igual.\n\nGracias.';
    expect(stripQuotedText(cuerpo)).toBe(cuerpo);
  });

  // Gmail pliega (envuelve) la linea de atribucion cuando es larga: el texto
  // que menciona la fecha y el remitente puede terminar en una linea propia,
  // y "escribio:" quedar solo en la siguiente. Esa segunda linea no esta
  // precedida por una linea en blanco (la precede el resto de la propia
  // atribucion envuelta), asi que una regla que exigiera "justo despues de
  // una linea en blanco" nunca dispararia aqui -- exactamente el caso real
  // que el diseño anterior (basado en linea en blanco) se perdia.
  it('corta en una atribucion de Gmail envuelta en dos lineas', () => {
    const cuerpo =
      'Gracias, ya funciona.\n\nEl mar, 5 ago 2026 a las 10:03, Soporte <ticket@kuboti.com>\nescribio:\n> Hola, hemos...';
    expect(stripQuotedText(cuerpo)).toBe('Gracias, ya funciona.');
  });

  // Outlook moderno no siempre escribe "-----Mensaje original-----": la
  // conversion de HTML a texto plano suele dejar una raya larga de guiones
  // bajos en vez de esas palabras.
  it('corta en la raya de guiones bajos de Outlook moderno', () => {
    const cuerpo = 'Confirmado, gracias.\n\n________________________________\nDe: Soporte\nAsunto: Ticket';
    expect(stripQuotedText(cuerpo)).toBe('Confirmado, gracias.');
  });
});

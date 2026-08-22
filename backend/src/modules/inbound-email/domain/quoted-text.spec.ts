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
});

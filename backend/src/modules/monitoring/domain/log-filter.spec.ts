import { parseLogFilter } from './log-filter';

describe('parseLogFilter', () => {
  it('devuelve vacío ante basura', () => {
    expect(parseLogFilter(null)).toEqual({});
    expect(parseLogFilter('x')).toEqual({});
  });

  it('acepta valores válidos, incluso numéricos como cadena (query string)', () => {
    expect(
      parseLogFilter({
        instalacionId: '4',
        cliente: '7',
        sistemaId: 2,
        aplicativo: 'GCC',
        servidor: 'SRV',
        nivelMinimo: 'warn',
        texto: 'timeout',
      }),
    ).toEqual({
      instalacionId: 4,
      cliente: 7,
      sistemaId: 2,
      aplicativo: 'GCC',
      servidor: 'SRV',
      nivelMinimo: 'WARN',
      texto: 'timeout',
    });
  });

  it('cliente admite "interno"', () => {
    expect(parseLogFilter({ cliente: 'interno' }).cliente).toBe('interno');
  });

  it('descarta lo inválido', () => {
    expect(
      parseLogFilter({
        instalacionId: 'abc',
        cliente: -1,
        sistemaId: 0,
        aplicativo: '',
        servidor: 5,
        nivelMinimo: 'raro',
        texto: '   ',
      }),
    ).toEqual({});
  });

  it('recorta texto a 200', () => {
    expect(parseLogFilter({ texto: 'a'.repeat(300) }).texto).toHaveLength(200);
  });
});

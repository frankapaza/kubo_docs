import { extractCodes } from './code-refs';

describe('extractCodes', () => {
  it('saca los códigos de una rama, un commit o un PR, sin repetir y en mayúsculas', () => {
    expect(extractCodes('fix/KB-0210-filtro-fecha')).toEqual(['KB-0210']);
    expect(extractCodes('kb-0210 fix: filtro (ver KB-0210 y RQ-0045)')).toEqual(['KB-0210', 'RQ-0045']);
  });

  it('ignora lo que no es un código completo', () => {
    expect(extractCodes('KB-12 y XKB-0001 y KB-0001X')).toEqual([]);
    expect(extractCodes(null)).toEqual([]);
    expect(extractCodes(undefined)).toEqual([]);
  });
});

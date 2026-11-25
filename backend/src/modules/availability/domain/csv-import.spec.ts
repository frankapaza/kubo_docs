import { normalizeKey, parseCsv } from './csv-import';

describe('parseCsv', () => {
  it('CSV de Excel: BOM, ";", celda con "a;b", fila vacía final y CRLF', () => {
    const text = '\uFEFFcliente;servidor;host\r\n"ACME";"srv ""1""";10.0.0.1\r\nBeta;"a;b";h2\r\n;;\r\n\r\n';
    const r = parseCsv(text);
    expect(r.header).toEqual(['cliente', 'servidor', 'host']);
    expect(r.rows).toEqual([
      { line: 2, cells: ['ACME', 'srv "1"', '10.0.0.1'] },
      { line: 3, cells: ['Beta', 'a;b', 'h2'] },
    ]);
  });

  it('detecta "," y cuenta saltos de línea dentro de comillas', () => {
    const r = parseCsv('a,b\n"x\ny",2\n3,4');
    expect(r.rows).toEqual([
      { line: 2, cells: ['x\ny', '2'] },
      { line: 4, cells: ['3', '4'] },
    ]);
  });

  it('texto vacío -> sin cabecera ni filas', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] });
  });
});

describe('normalizeKey', () => {
  it('quita tildes y mayúsculas', () => {
    expect(normalizeKey(' Región ')).toBe('region');
  });
});

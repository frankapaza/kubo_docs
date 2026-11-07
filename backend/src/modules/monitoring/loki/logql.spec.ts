import { buildLogQuery, escapeLogqlString, escapeRegex } from './logql';

describe('logql', () => {
  it('sin filtros selecciona toda instalación', () => {
    expect(buildLogQuery({})).toBe('{instalacion=~".+"}');
  });

  it('combina cliente, sistema y aplicativo', () => {
    expect(buildLogQuery({ cliente: 'interno', sistemaId: 4, aplicativo: 'GCC.WEB' })).toBe(
      '{instalacion=~".+",cliente="interno",sistema="4",aplicativo="GCC.WEB"}',
    );
  });

  it('filtra por instalación y servidor', () => {
    expect(buildLogQuery({ instalacionId: 7, servidor: 'SRV1', cliente: 3 })).toBe(
      '{instalacion="7",cliente="3",servidor="SRV1"}',
    );
  });

  it('nivel mínimo expande a los niveles iguales o superiores', () => {
    expect(buildLogQuery({ nivelMinimo: 'WARN' })).toBe(
      '{instalacion=~".+",nivel=~"WARN|ERROR|FATAL"}',
    );
  });

  it('el texto va como regex insensible, con LogQL y regex escapados', () => {
    // texto: a"b\c.*  ->  regex (?i)a"b\\c\.\*  ->  cadena LogQL con cada " y \ escapados
    expect(buildLogQuery({ texto: 'a"b\\c.*' })).toBe(
      '{instalacion=~".+"} |~ "(?i)a\\"b\\\\\\\\c\\\\.\\\\*"',
    );
  });

  it('un aplicativo malicioso no puede cerrar el selector', () => {
    const q = buildLogQuery({ aplicativo: '"} or {x="' });
    expect(q).toBe('{instalacion=~".+",aplicativo="\\"} or {x=\\""}');
    // Quitando los pares barra+carácter escapados quedan solo las 4 comillas
    // legítimas (dos matchers): la del valor malicioso no cierra nada.
    expect((q.replace(/\\./g, '').match(/"/g) ?? []).length).toBe(4);
  });

  it('escapa barras, comillas y saltos de línea', () => {
    expect(escapeLogqlString('a\\b\n"c')).toBe('a\\\\b\\n\\"c');
  });

  it('escapeRegex neutraliza metacaracteres', () => {
    expect(escapeRegex('a.b*c(d)[e]|f')).toBe('a\\.b\\*c\\(d\\)\\[e\\]\\|f');
  });
});

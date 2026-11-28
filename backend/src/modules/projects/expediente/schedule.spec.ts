import { buildZip } from '../../../common/zip/zip-writer';
import { csvRows, drawableRows, parseDate, parseScheduleTable, scheduleFromSheet, scheduleTable, xlsxRows } from './schedule';

function xlsx(sheetXml: string, shared: string[] = []): Buffer {
  const sst = `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`;
  return buildZip([
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
    { name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') },
    { name: 'xl/sharedStrings.xml', data: Buffer.from(sst) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(`<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`) },
  ]);
}

describe('cronograma en Markdown', () => {
  it('ida y vuelta: filas → tabla → filas', () => {
    const rows = [
      { activity: 'Análisis', owner: 'Ana', start: '2026-12-01', end: '2026-12-10' },
      { activity: 'Desarrollo | fase 1', owner: '', start: '2026-12-11', end: '2027-01-15' },
    ];
    const md = scheduleTable(rows);
    expect(md.split('\n')[0]).toBe('| Actividad | Responsable | Inicio | Fin |');
    expect(parseScheduleTable(`Texto antes\n\n${md}\n\nTexto después`)).toEqual([
      rows[0],
      { activity: 'Desarrollo fase 1', owner: '', start: '2026-12-11', end: '2027-01-15' },
    ]);
  });

  it('sin la tabla no hay cronograma; solo se dibujan fechas válidas', () => {
    expect(parseScheduleTable('| Rol | Responsable |\n| --- | --- |')).toBeNull();
    expect(
      drawableRows([
        { activity: 'a', owner: '', start: '2026-12-01', end: '2026-11-01' },
        { activity: 'b', owner: '', start: '2026-02-30', end: '2026-03-01' },
        { activity: 'c', owner: '', start: '2026-12-01', end: '2026-12-01' },
      ]).map((r) => r.activity),
    ).toEqual(['c']);
  });
});

describe('fechas de Excel y MS Project', () => {
  it.each([
    ['46357', '2026-12-01'],
    ['2026-12-01', '2026-12-01'],
    ['01/12/2026', '2026-12-01'],
    ['lun 01/12/26', '2026-12-01'],
    ['1 dic 2026', '2026-12-01'],
    ['15 de enero de 2027', '2027-01-15'],
  ])('%s → %s', (raw, iso) => expect(parseDate(raw)).toBe(iso));

  it('rechaza lo que no es fecha', () => {
    expect(parseDate('pronto')).toBeNull();
    expect(parseDate('31/02/2026')).toBeNull();
  });
});

describe('Excel genérico (como el que exporta MS Project)', () => {
  it('encuentra los encabezados aunque no estén en la primera fila', () => {
    const buf = xlsx(
      '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c><c r="D2" t="s"><v>4</v></c></row>' +
        '<row r="3"><c r="A3" t="s"><v>5</v></c><c r="B3"><v>46357</v></c><c r="C3" t="s"><v>6</v></c><c r="D3" t="inlineStr"><is><t>Ana &amp; Luis</t></is></c></row>' +
        '<row r="4"><c r="A4" t="s"><v>7</v></c><c r="B4"><v>46367</v></c><c r="C4"><v>46360</v></c></row>' +
        '<row r="5"><c r="A5" t="s"><v>8</v></c><c r="B5" t="s"><v>9</v></c></row>',
      ['Cronograma COB', 'Nombre de tarea', 'Comienzo', 'Fin', 'Nombres de los recursos', 'Análisis', 'lun 14/12/26', 'Diseño', 'Sin fechas', 'n/a'],
    );
    const rows = scheduleFromSheet(xlsxRows(buf));
    expect(rows).toEqual([
      { activity: 'Análisis', owner: 'Ana & Luis', start: '2026-12-01', end: '2026-12-14' },
      // fin antes del inicio: se corrige al inicio
      { activity: 'Diseño', owner: '', start: '2026-12-11', end: '2026-12-11' },
    ]);
  });

  it('mensajes claros si no es Excel o faltan columnas', () => {
    expect(() => xlsxRows(Buffer.from('no'))).toThrow(/no es un Excel/);
    expect(() => scheduleFromSheet([['Columna A', 'Columna B']])).toThrow(/Tarea.*Inicio.*Fin/);
  });

  it('también lee un CSV con punto y coma', () => {
    const rows = scheduleFromSheet(csvRows('﻿Actividad;Inicio;Fin;Responsable\nPruebas;01/02/2027;10/02/2027;QA'));
    expect(rows).toEqual([{ activity: 'Pruebas', owner: 'QA', start: '2027-02-01', end: '2027-02-10' }]);
  });
});

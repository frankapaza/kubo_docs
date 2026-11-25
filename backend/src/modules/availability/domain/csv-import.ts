/** Lector de CSV (Excel es-PE guarda con `;`; también acepta `,`). */
export interface ParsedCsv {
  header: string[];
  rows: Array<{ line: number; cells: string[] }>;
}

/** Minúsculas y sin tildes: así se comparan las cabeceras. */
export const normalizeKey = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

export function parseCsv(input: string): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const firstLineEnd = text.search(/\r?\n/);
  const headLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const sep = (headLine.match(/;/g) ?? []).length >= (headLine.match(/,/g) ?? []).length && headLine.includes(';') ? ';' : ',';

  const records: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let startLine = 1;
  let touched = false;

  const endRecord = () => {
    cells.push(cell);
    records.push({ line: startLine, cells });
    cells = [];
    cell = '';
    touched = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      touched = true;
    } else if (ch === sep) {
      cells.push(cell);
      cell = '';
      touched = true;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (touched || cell !== '' || cells.length) endRecord();
      line++;
      startLine = line;
    } else {
      cell += ch;
      touched = true;
    }
  }
  if (touched || cell !== '' || cells.length) endRecord();

  const nonEmpty = records.filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (!nonEmpty.length) return { header: [], rows: [] };
  const [head, ...rows] = nonEmpty;
  return { header: head.cells.map((c) => c.trim()), rows: rows.map((r) => ({ line: r.line, cells: r.cells })) };
}

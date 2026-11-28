import { CATALOG } from './deliverable-catalog';
import {
  DEFAULT_TEMPLATES,
  parseAiSections,
  parseStoredSections,
  sectionStatus,
  sectionsFromTemplate,
  validateSections,
  validateTemplate,
  wordDiff,
} from './deliverable-document';

describe('plantillas', () => {
  it('hay una plantilla Kubo para cada tipo del catálogo', () => {
    for (const e of CATALOG) expect(DEFAULT_TEMPLATES[e.type]?.length).toBeGreaterThan(2);
  });

  it('un documento nuevo trae cada sección con su guía por completar', () => {
    const s = sectionsFromTemplate(DEFAULT_TEMPLATES['DOC-ANA']);
    expect(s[1]).toEqual({ key: 'sec-2', num: '1.2', title: 'Alcance', body: '[Completar] módulos incluidos y excluidos.' });
    expect(s.every((x) => sectionStatus(x.body) === 'PENDIENTE')).toBe(true);
  });

  it('valida la plantilla', () => {
    expect(validateTemplate([{ num: '1', title: ' Objetivo ', guide: '' }])).toEqual([{ num: '1', title: 'Objetivo' }]);
    expect(() => validateTemplate([])).toThrow(/al menos una sección/);
    expect(() => validateTemplate([{ num: '1', title: '' }])).toThrow(/título/);
  });
});

describe('secciones', () => {
  it('pendiente si está vacía o tiene [Completar]', () => {
    expect(sectionStatus('  ')).toBe('PENDIENTE');
    expect(sectionStatus('Fechas: [Completar]')).toBe('PENDIENTE');
    expect(sectionStatus('Entrega en tres iteraciones.')).toBe('COMPLETA');
  });

  it('valida lo que llega del editor', () => {
    const ok = validateSections([{ key: 'sec-1', num: '1', title: 'Objetivo', body: 'x' }]);
    expect(ok).toEqual([{ key: 'sec-1', num: '1', title: 'Objetivo', body: 'x' }]);
    expect(() => validateSections([])).toThrow(/al menos una sección/);
    expect(() => validateSections([{ key: '../x', title: 'a' }])).toThrow(/identificador inválido/);
    expect(() => validateSections([{ key: 'a', title: 'x' }, { key: 'a', title: 'y' }])).toThrow(/dos secciones/);
    expect(() => validateSections([{ key: 'a', title: '' }])).toThrow(/no tiene título/);
    expect(() => validateSections([{ key: 'a', title: 'x', body: 'b'.repeat(50_001) }])).toThrow(/supera/);
    const many = Array.from({ length: 5 }, (_, i) => ({ key: `s${i}`, title: 't', body: 'b'.repeat(45_000) }));
    expect(() => validateSections(many)).toThrow(/El documento supera/);
  });

  it('lee el JSON guardado y descarta uno roto', () => {
    expect(parseStoredSections('{"sections":[{"key":"a","num":"1","title":"t","body":"b"}]}')).toHaveLength(1);
    expect(parseStoredSections('no')).toBeNull();
    expect(parseStoredSections(null)).toBeNull();
  });
});

describe('antes y después por palabras', () => {
  it('marca lo quitado y lo agregado, conservando lo común', () => {
    const d = wordDiff('Módulos de cartera, y lo de la central.', 'Módulos de cartera, con integración a la central.');
    expect(d.filter((x) => x.op === 'del').map((x) => x.text.trim())).toEqual(['y lo de']);
    expect(d.filter((x) => x.op === 'ins').map((x) => x.text.trim())).toEqual(['con integración a']);
    expect(d.filter((x) => x.op !== 'ins').map((x) => x.text).join('')).toBe('Módulos de cartera, y lo de la central.');
    expect(d.filter((x) => x.op !== 'del').map((x) => x.text).join('')).toBe('Módulos de cartera, con integración a la central.');
  });

  it('iguales, vacíos y textos enormes', () => {
    expect(wordDiff('igual', 'igual')).toEqual([{ op: 'eq', text: 'igual' }]);
    expect(wordDiff('', 'nuevo')).toEqual([{ op: 'ins', text: 'nuevo' }]);
    const big = 'a '.repeat(3000);
    expect(wordDiff(big, big + 'b')).toEqual([{ op: 'del', text: big }, { op: 'ins', text: big + 'b' }]);
  });
});

describe('respuesta de la IA', () => {
  it('toma solo las secciones del alcance, aun con texto o bloque de código alrededor', () => {
    const raw = '```json\n{"sections":[{"key":"sec-2","body":"Nuevo alcance"},{"key":"sec-9","body":"no pedido"}]}\n```';
    expect([...parseAiSections(raw, ['sec-2'])]).toEqual([['sec-2', 'Nuevo alcance']]);
    const chatty = 'Aquí tienes: {"sections":[{"key":"sec-1","body":"ok"}]} ¡Listo!';
    expect(parseAiSections(chatty, ['sec-1']).get('sec-1')).toBe('ok');
  });

  it('sin una sección válida, 502 con un mensaje claro', () => {
    expect(() => parseAiSections('no sé', ['sec-1'])).toThrow(/no devolvió una propuesta válida/);
    expect(() => parseAiSections('{"sections":[{"key":"sec-1","body":5}]}', ['sec-1'])).toThrow();
  });
});

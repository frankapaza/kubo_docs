import { buildConformityMarkdown } from './conformity-act';

const BASE = {
  codigo: 'RQ-0045',
  titulo: 'Exportar pagos a Excel',
  cliente: 'Gestora Fidelity',
  sistema: 'Modulo de Cobranza',
  fechaComprometida: '2026-12-01',
  fechaEntrega: new Date('2026-11-24T15:00:00Z'),
  criterios: ['Exporta los pagos del mes', 'Respeta los filtros'],
  evidencia: [{ tipo: 'PR', ref: '12', titulo: 'Exportar a Excel', url: 'https://github.com/x/y/pull/12' }],
  documentos: ['RQ-0045 - Manual de usuario.pdf'],
  firmante: { nombre: 'Ana Pérez', cargo: 'Jefa de Cobranza' },
};

describe('buildConformityMarkdown', () => {
  it('incluye los datos del requerimiento y cada criterio como cumplido', () => {
    const md = buildConformityMarkdown(BASE);
    expect(md).toContain('RQ-0045');
    expect(md).toContain('Gestora Fidelity');
    expect(md).toContain('Modulo de Cobranza');
    expect(md).toContain('| 1 | Exporta los pagos del mes | Cumplido |');
    expect(md).toContain('PR 12');
    expect(md).toContain('RQ-0045 - Manual de usuario.pdf');
    expect(md).toContain('Ana Pérez');
    expect(md).toMatch(/declara su conformidad/i);
  });

  it('sin criterios ni evidencia lo dice en vez de dejar la sección vacía', () => {
    const md = buildConformityMarkdown({ ...BASE, criterios: [], evidencia: [], documentos: [] });
    expect(md).toMatch(/Sin criterios de aceptación registrados/);
    expect(md).toMatch(/Sin código vinculado/);
  });

  it('las observaciones aparecen si se dan', () => {
    expect(buildConformityMarkdown({ ...BASE, observaciones: 'Falta el logo' })).toContain('Falta el logo');
    expect(buildConformityMarkdown(BASE)).toContain('Ninguna');
  });

  it('un texto del cliente con | o {{ }} no rompe la tabla ni la plantilla', () => {
    const md = buildConformityMarkdown({ ...BASE, criterios: ['A | B {{emisor_ruc}}'] });
    expect(md).toContain('A / B { {emisor_ruc} }');
  });
});

/**
 * El texto (Markdown) del Acta de conformidad de un requerimiento. Puro: todo
 * entra por parámetro. Lo firma el cliente por enlace (firmantes de documentos)
 * y su PDF queda en los documentos del requerimiento.
 */
export interface ConformityActInput {
  codigo: string;
  titulo: string;
  cliente: string;
  sistema: string | null;
  fechaComprometida: string | null;
  fechaEntrega: Date;
  criterios: string[];
  evidencia: Array<{ tipo: string; ref: string; titulo: string | null; url: string | null }>;
  documentos: string[];
  firmante: { nombre: string; cargo?: string | null };
  observaciones?: string | null;
}

const FECHA = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Lima' });

function fecha(d: Date | string | null): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(`${d.slice(0, 10)}T12:00:00Z`) : d;
  return FECHA.format(date);
}

/**
 * Texto del cliente o del equipo dentro de una celda: sin `|` (rompería la
 * tabla), sin saltos de línea y sin `{{ }}` (el documento pasa luego por el
 * motor de plantillas, que sustituiría las variables).
 */
function celda(s: string): string {
  return s.replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ').replace(/\{\{/g, '{ {').replace(/\}\}/g, '} }').trim();
}

export function buildConformityMarkdown(i: ConformityActInput): string {
  const criterios = i.criterios.length
    ? ['| # | Criterio de aceptación | Resultado |', '|---|---|---|', ...i.criterios.map((c, n) => `| ${n + 1} | ${celda(c)} | Cumplido |`)]
    : ['Sin criterios de aceptación registrados: la conformidad se da sobre el alcance descrito en la Especificación.'];

  const evidencia = i.evidencia.length
    ? i.evidencia.map((e) => `- ${e.tipo} ${celda(e.ref)}${e.titulo ? `: ${celda(e.titulo)}` : ''}${e.url ? ` (${e.url})` : ''}`)
    : ['- Sin código vinculado.'];

  const documentos = i.documentos.length ? i.documentos.map((d) => `- ${celda(d)}`) : ['- Ninguno adjunto.'];

  return [
    `# Acta de conformidad · ${celda(i.codigo)}`,
    '',
    '## Datos del requerimiento',
    '',
    '| Campo | Detalle |',
    '|---|---|',
    `| Código | ${celda(i.codigo)} |`,
    `| Requerimiento | ${celda(i.titulo)} |`,
    `| Cliente | ${celda(i.cliente)} |`,
    `| Sistema | ${celda(i.sistema ?? '—')} |`,
    `| Fecha comprometida | ${fecha(i.fechaComprometida)} |`,
    `| Fecha de entrega | ${fecha(i.fechaEntrega)} |`,
    '',
    '## Criterios de aceptación',
    '',
    ...criterios,
    '',
    '## Evidencia de la entrega',
    '',
    ...evidencia,
    '',
    '## Documentos entregados',
    '',
    ...documentos,
    '',
    '## Observaciones',
    '',
    i.observaciones?.trim() ? celda(i.observaciones) : 'Ninguna.',
    '',
    '## Declaración de conformidad',
    '',
    `${celda(i.firmante.nombre)}${i.firmante.cargo ? `, ${celda(i.firmante.cargo)}` : ''}, en representación de ${celda(i.cliente)}, ` +
      `declara su conformidad con el requerimiento ${celda(i.codigo)}: lo revisó en el ambiente de pruebas y cumple ` +
      'los criterios de aceptación indicados. Con esta firma el requerimiento se da por cerrado.',
    '',
  ].join('\n');
}

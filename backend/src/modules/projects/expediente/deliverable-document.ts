import { BadGatewayException, BadRequestException } from '@nestjs/common';

/**
 * El documento en línea de un entregable: una lista de secciones (número,
 * título y cuerpo en Markdown), las plantillas que les dan estructura, el
 * estado de cada sección y el antes/después de un ajuste con IA. Sin base de
 * datos: lo usan el servicio, el PDF y las pruebas.
 */

export interface DocSection {
  /** Identificador estable de la sección (no cambia al renumerar). */
  key: string;
  num: string;
  title: string;
  body: string;
}

export interface TemplateSection {
  num: string;
  title: string;
  /** Qué va en la sección: se muestra como «[Completar] …» en un documento nuevo. */
  guide?: string;
  /** Contenido inicial (p. ej. una tabla vacía); si está, reemplaza a la guía. */
  starter?: string;
}

/** Tabla de participantes, igual que en las actas de reunión. */
export const PARTICIPANTS_STARTER =
  '| Nombre | Cargo | Correo | Teléfono | Asistencia |\n| --- | --- | --- | --- | --- |\n| [Completar] | | | | |';

/** Roles: se completa desde la tabla de participantes en el editor. */
export const ROLES_STARTER =
  '| Rol | Responsable | Correo |\n| --- | --- | --- |\n| Jefe de proyecto (Kubo) | [Completar] | |\n| Responsable del cliente | [Completar] | |';

/** Cronograma: el editor lo muestra como Gantt y el PDF lo dibuja. */
export const SCHEDULE_STARTER =
  '| Actividad | Responsable | Inicio | Fin |\n| --- | --- | --- | --- |\n| [Completar] fase o iteración | — | | |';

const p = (num: string, title: string, starter: string): TemplateSection => ({ num, title, starter });

export type SectionStatus = 'COMPLETA' | 'PENDIENTE';

export const MAX_SECTIONS = 60;
export const MAX_SECTION_BODY = 50_000;
export const MAX_DOCUMENT_CHARS = 200_000;
export const MAX_INSTRUCTION = 500;
export const PENDING_MARK = '[Completar]';

const KEY_RE = /^[a-z0-9-]{1,40}$/;

const t = (num: string, title: string, guide?: string): TemplateSection => ({ num, title, guide });

/** La estructura Kubo de cada tipo de entregable (NTP-ISO/IEC 12207, con marca Kubo). */
export const DEFAULT_TEMPLATES: Record<string, TemplateSection[]> = {
  'ACT-INI': [
    t('1', 'Datos de la reunión', 'fecha, lugar o enlace, duración'),
    p('2', 'Participantes', PARTICIPANTS_STARTER),
    t('3', 'Objetivo del proyecto'),
    t('4', 'Alcance', 'qué incluye y qué no incluye'),
    p('5', 'Cronograma de alto nivel', SCHEDULE_STARTER),
    p('6', 'Roles y responsables', ROLES_STARTER),
    t('7', 'Acuerdos'),
  ],
  'CRO-PRO': [
    t('1', 'Introducción'),
    p('2', 'Fases e hitos', SCHEDULE_STARTER),
    t('3', 'Actividades y responsables'),
    t('4', 'Fechas clave'),
    t('5', 'Supuestos y dependencias'),
  ],
  'DOC-ANA': [
    t('1.1', 'Objetivo'),
    t('1.2', 'Alcance', 'módulos incluidos y excluidos'),
    t('2.1', 'Descripción de la solución'),
    t('2.2', 'Mínimo producto viable'),
    t('2.3', 'Requerimientos funcionales'),
    t('2.4', 'Restricciones', 'fechas y presupuesto acordados con el cliente'),
    t('2.5', 'Requerimientos no funcionales', 'seguridad, rendimiento, disponibilidad'),
    t('3', 'Glosario'),
  ],
  'HIS-USU': [
    t('1', 'Introducción'),
    t('2', 'Roles de usuario'),
    t('3', 'Historias de usuario', '«Como [rol] quiero [acción] para [beneficio]»'),
    t('4', 'Criterios de aceptación'),
    t('5', 'Priorización'),
  ],
  'ACT-APRO': [
    t('1', 'Datos de la sesión'),
    t('2', 'Prototipos revisados'),
    t('3', 'Observaciones'),
    t('4', 'Conformidad'),
  ],
  'ARQ-TIC': [
    t('1', 'Introducción'),
    t('2', 'Vista general'),
    t('3', 'Componentes'),
    t('4', 'Infraestructura y despliegue'),
    t('5', 'Integraciones'),
    t('6', 'Seguridad'),
  ],
  'DOC-SER': [
    t('1', 'Introducción'),
    t('2', 'Servicios expuestos', 'método, ruta, entrada y salida'),
    t('3', 'Autenticación'),
    t('4', 'Mensajes y códigos de error'),
    t('5', 'Ejemplos'),
  ],
  'EVD-PUN': [
    t('1', 'Alcance'),
    t('2', 'Herramientas'),
    t('3', 'Resultados'),
    t('4', 'Cobertura'),
  ],
  'MAN-USU': [
    t('1', 'Introducción'),
    t('2', 'Acceso al sistema'),
    t('3', 'Funcionalidades', 'paso a paso con capturas'),
    t('4', 'Preguntas frecuentes'),
    t('5', 'Soporte'),
  ],
  'PRU-FUN': [
    t('1', 'Alcance'),
    t('2', 'Ambiente de pruebas'),
    t('3', 'Casos de prueba', 'tabla: caso, pasos, resultado esperado, resultado obtenido'),
    t('4', 'Resultados'),
    t('5', 'Observaciones'),
  ],
  'INF-PRU': [
    t('1', 'Resumen'),
    t('2', 'Alcance'),
    t('3', 'Resultados por módulo'),
    t('4', 'Defectos encontrados'),
    t('5', 'Conclusiones y recomendaciones'),
  ],
  'ACT-USU': [
    t('1', 'Datos'),
    t('2', 'Entregables recibidos'),
    t('3', 'Conformidad del usuario'),
    t('4', 'Observaciones'),
  ],
  'MAN-DES': [
    t('1', 'Introducción'),
    t('2', 'Requisitos del servidor'),
    t('3', 'Variables de entorno', 'nombres y para qué sirven; nunca valores secretos'),
    t('4', 'Pasos de despliegue'),
    t('5', 'Verificación'),
    t('6', 'Reversión'),
  ],
  'SOL-PAP': [
    t('1', 'Datos de la solicitud'),
    t('2', 'Cambios incluidos'),
    t('3', 'Pruebas realizadas'),
    t('4', 'Plan de despliegue y reversión'),
    t('5', 'Aprobaciones'),
  ],
  'ACT-REU': [
    t('1', 'Datos de la reunión'),
    p('2', 'Participantes', PARTICIPANTS_STARTER),
    t('3', 'Temas tratados'),
    t('4', 'Acuerdos'),
    t('5', 'Compromisos', 'responsable y fecha'),
  ],
  'INF-GES': [
    t('1', 'Resumen del periodo'),
    t('2', 'Avance'),
    t('3', 'Riesgos e incidencias'),
    t('4', 'Próximos pasos'),
  ],
  'SOL-CAM': [
    t('1', 'Datos de la solicitud'),
    t('2', 'Descripción del cambio'),
    t('3', 'Justificación'),
    t('4', 'Impacto', 'alcance, tiempo y costo'),
    t('5', 'Decisión'),
  ],
  'ACT-CIE': [
    t('1', 'Datos del proyecto'),
    t('2', 'Entregables aceptados'),
    t('3', 'Pendientes y garantía'),
    t('4', 'Lecciones aprendidas'),
  ],
  'ACT-CAP': [
    t('1', 'Datos de la capacitación'),
    p('2', 'Participantes', PARTICIPANTS_STARTER),
    t('3', 'Temas'),
    t('4', 'Evaluación'),
  ],
  'ACT-TRA': [
    t('1', 'Datos'),
    t('2', 'Componentes transferidos'),
    t('3', 'Accesos entregados', 'qué accesos y a quién; nunca escribir contraseñas'),
    t('4', 'Conformidad'),
  ],
};

export function defaultTemplate(type: string): TemplateSection[] {
  return DEFAULT_TEMPLATES[type] ?? [t('1', 'Introducción'), t('2', 'Desarrollo'), t('3', 'Conclusiones')];
}

/** Un documento nuevo a partir de una plantilla: cada sección con su guía por completar. */
export function sectionsFromTemplate(tpl: TemplateSection[]): DocSection[] {
  return tpl.map((s, i) => ({
    key: `sec-${i + 1}`,
    num: s.num,
    title: s.title,
    body: s.starter ?? (s.guide ? `${PENDING_MARK} ${s.guide}.` : PENDING_MARK),
  }));
}

export function sectionStatus(body: string): SectionStatus {
  const b = body.trim();
  return !b || b.includes(PENDING_MARK) ? 'PENDIENTE' : 'COMPLETA';
}

function bad(message: string): never {
  throw new BadRequestException({ code: 'BAD_INPUT', message });
}

/** Valida y normaliza lo que llega del editor. */
export function validateSections(input: unknown): DocSection[] {
  if (!Array.isArray(input) || input.length === 0) bad('El documento necesita al menos una sección.');
  if (input.length > MAX_SECTIONS) bad(`El documento admite hasta ${MAX_SECTIONS} secciones.`);
  const keys = new Set<string>();
  let total = 0;
  const out = input.map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const key = String(s.key ?? '');
    if (!KEY_RE.test(key)) bad(`La sección ${i + 1} tiene un identificador inválido.`);
    if (keys.has(key)) bad(`Hay dos secciones con el identificador «${key}».`);
    keys.add(key);
    const num = String(s.num ?? '').trim().slice(0, 10);
    const title = String(s.title ?? '').trim();
    if (!title) bad(`La sección ${i + 1} no tiene título.`);
    if (title.length > 200) bad(`El título de la sección ${num || i + 1} es demasiado largo.`);
    const body = String(s.body ?? '');
    if (body.length > MAX_SECTION_BODY) bad(`La sección ${num || i + 1} supera los ${MAX_SECTION_BODY} caracteres.`);
    total += body.length + title.length;
    return { key, num, title, body };
  });
  if (total > MAX_DOCUMENT_CHARS) bad(`El documento supera los ${MAX_DOCUMENT_CHARS} caracteres.`);
  return out;
}

export function validateTemplate(input: unknown): TemplateSection[] {
  if (!Array.isArray(input) || input.length === 0) bad('La plantilla necesita al menos una sección.');
  if (input.length > MAX_SECTIONS) bad(`La plantilla admite hasta ${MAX_SECTIONS} secciones.`);
  return input.map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const title = String(s.title ?? '').trim();
    if (!title || title.length > 200) bad(`La sección ${i + 1} de la plantilla necesita un título (hasta 200 caracteres).`);
    const guide = String(s.guide ?? '').trim();
    if (guide.length > 300) bad(`La guía de la sección ${i + 1} es demasiado larga.`);
    const starter = String(s.starter ?? '');
    if (starter.length > 4000) bad(`El contenido inicial de la sección ${i + 1} es demasiado largo.`);
    return {
      num: String(s.num ?? '').trim().slice(0, 10),
      title,
      ...(guide ? { guide } : {}),
      ...(starter.trim() ? { starter } : {}),
    };
  });
}

/** Lee el JSON guardado de una versión; null si no es un documento válido. */
export function parseStoredSections(json: string | null): DocSection[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as { sections?: unknown };
    return Array.isArray(v.sections) ? (v.sections as DocSection[]) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- diff

export type DiffOp = { op: 'eq' | 'del' | 'ins'; text: string };

/** Por encima de esto (palabras × palabras) se muestra «quitado todo / agregado todo». */
const MAX_DIFF_CELLS = 4_000_000;

/** Antes y después por palabras (los espacios se conservan), con LCS. */
export function wordDiff(before: string, after: string): DiffOp[] {
  if (before === after) return before ? [{ op: 'eq', text: before }] : [];
  const a = before.split(/(\s+)/).filter((x) => x !== '');
  const b = after.split(/(\s+)/).filter((x) => x !== '');
  if (a.length * b.length > MAX_DIFF_CELLS) {
    return [
      ...(before ? [{ op: 'del' as const, text: before }] : []),
      ...(after ? [{ op: 'ins' as const, text: after }] : []),
    ];
  }
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = largo de la subsecuencia común de a[i..] y b[j..], en un arreglo plano.
  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] =
        a[i] === b[j] ? lcs[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
    }
  }
  const out: DiffOp[] = [];
  const push = (op: DiffOp['op'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('eq', a[i]);
      i++;
      j++;
    } else if (lcs[(i + 1) * (m + 1) + j] >= lcs[i * (m + 1) + j + 1]) {
      push('del', a[i++]);
    } else {
      push('ins', b[j++]);
    }
  }
  while (i < n) push('del', a[i++]);
  while (j < m) push('ins', b[j++]);
  return joinChanges(out);
}

/**
 * Un espacio común entre dos cambios parte «~~y lo de~~» en tres tachados
 * sueltos. Se absorbe en el cambio: se lee «~~y lo de~~ **con integración a**».
 */
function joinChanges(ops: DiffOp[]): DiffOp[] {
  const out: DiffOp[] = [];
  let del = '';
  let ins = '';
  const flush = () => {
    if (del) out.push({ op: 'del', text: del });
    if (ins) out.push({ op: 'ins', text: ins });
    del = '';
    ins = '';
  };
  ops.forEach((o, k) => {
    if (o.op === 'del') del += o.text;
    else if (o.op === 'ins') ins += o.text;
    else if ((del || ins) && /^\s+$/.test(o.text) && ops[k + 1] && ops[k + 1].op !== 'eq') {
      del += o.text;
      ins += o.text;
    } else {
      flush();
      out.push({ ...o });
    }
  });
  flush();
  return out;
}

// ---------------------------------------------------------------- IA

export const AI_PRESETS = [
  'Más formal',
  'Más breve',
  'Completar lo pendiente',
  'Ajustar al formato del cliente',
  'Corregir ortografía',
] as const;

export function aiSystemPrompt(): string {
  return [
    'Eres redactor técnico de Kubo, una empresa peruana de software. Ajustas secciones de un documento de proyecto',
    '(metodología NTP-ISO/IEC 12207) según el pedido de la persona.',
    'Reglas:',
    '- Responde SOLO con JSON, sin texto alrededor ni bloques de código: {"sections":[{"key":"...","body":"..."}]}',
    '- Devuelve únicamente las secciones que se te entregan para ajustar, con la misma "key". No cambies títulos ni números.',
    '- "body" es Markdown en español neutro y profesional (listas, tablas y negritas permitidas; sin títulos de nivel 1).',
    `- No inventes datos (fechas, montos, nombres, cifras). Si falta información, deja "${PENDING_MARK}" con lo que falta.`,
    '- Conserva los datos concretos que ya están escritos.',
    '- Nunca escribas contraseñas ni claves.',
  ].join('\n');
}

export function aiUserPrompt(ctx: {
  project: string;
  client: string | null;
  deliverable: string;
  instruction: string;
  target: DocSection[];
  outline: DocSection[];
}): string {
  const outline = ctx.outline.map((s) => `${s.num} ${s.title}`).join('\n');
  return [
    `Proyecto: ${ctx.project}${ctx.client ? ` (cliente: ${ctx.client})` : ''}`,
    `Documento: ${ctx.deliverable}`,
    `Índice del documento:\n${outline}`,
    `Pedido: ${ctx.instruction}`,
    'Secciones a ajustar (JSON):',
    JSON.stringify({ sections: ctx.target.map((s) => ({ key: s.key, num: s.num, title: s.title, body: s.body })) }),
  ].join('\n\n');
}

/**
 * La respuesta de la IA: solo cuentan las secciones del alcance; las demás
 * se ignoran y un cuerpo fuera de rango se descarta.
 */
export function parseAiSections(raw: string, allowedKeys: string[]): Map<string, string> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    try {
      parsed = start >= 0 && end > start ? JSON.parse(trimmed.slice(start, end + 1)) : null;
    } catch {
      parsed = null;
    }
  }
  const list = (parsed as { sections?: unknown } | null)?.sections;
  const out = new Map<string, string>();
  if (Array.isArray(list)) {
    for (const item of list) {
      const key = String((item as { key?: unknown })?.key ?? '');
      const body = (item as { body?: unknown })?.body;
      if (allowedKeys.includes(key) && typeof body === 'string' && body.length <= MAX_SECTION_BODY) out.set(key, body);
    }
  }
  if (out.size === 0) {
    throw new BadGatewayException({
      code: 'LLM_ERROR',
      message: 'La IA no devolvió una propuesta válida. Inténtalo de nuevo o reformula el pedido.',
    });
  }
  return out;
}

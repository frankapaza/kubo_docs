import type { WorkItemRequestType } from '../../api/types';

/**
 * Plantillas del formulario guiado de requerimientos (portal y DevDocs).
 * Cada sección se guarda como `## Título` dentro de la descripción, así el
 * equipo, la IA y Claude la leen ordenada. Los criterios de aceptación van
 * aparte, una línea por criterio.
 */
export interface TemplateSection {
  key: string;
  title: string;
  hint: string;
  placeholder: string;
  required: boolean;
  rows?: number;
}

export interface RequestTemplate {
  type: WorkItemRequestType;
  label: string;
  description: string;
  sections: TemplateSection[];
}

export const REQUEST_TEMPLATES: Record<WorkItemRequestType, RequestTemplate> = {
  CAMBIO: {
    type: 'CAMBIO',
    label: 'Cambio a un sistema existente',
    description: 'Un ajuste, una mejora o algo nuevo dentro de un sistema que ya usan.',
    sections: [
      {
        key: 'actual', title: 'Situación actual', required: true, rows: 3,
        hint: '¿Cómo funciona hoy y qué problema causa?',
        placeholder: 'Ej.: En el reporte de compromisos no aparece el monto prometido; el supervisor lo busca a mano gestión por gestión.',
      },
      {
        key: 'necesita', title: 'Qué se necesita', required: true, rows: 4,
        hint: 'Describe el resultado esperado, paso a paso si hace falta.',
        placeholder: 'Ej.: Agregar la columna «Monto del compromiso» al reporte de compromisos, al lado de la fecha de pago.',
      },
      {
        key: 'donde', title: 'Dónde (pantallas o reportes)', required: true, rows: 2,
        hint: 'Módulo, pantalla, reporte o perfil de usuario afectado.',
        placeholder: 'Ej.: Módulo Cobranza → Reportes → Compromisos. Perfil Jefatura y Supervisor.',
      },
      {
        key: 'reglas', title: 'Reglas de negocio', required: false, rows: 3,
        hint: 'Condiciones, cálculos, validaciones o permisos.',
        placeholder: 'Ej.: Solo compromisos vigentes. El monto en soles con dos decimales.',
      },
      {
        key: 'ejemplo', title: 'Ejemplo', required: false, rows: 3,
        hint: 'Un caso real (sin datos sensibles) o una captura adjunta después.',
        placeholder: 'Ej.: Cliente con DNI 4xxxxx: compromiso del 25/11 por S/ 350.00 → debe verse S/ 350.00.',
      },
    ],
  },
  PROYECTO: {
    type: 'PROYECTO',
    label: 'Proyecto nuevo o prototipo',
    description: 'Un sistema, módulo o pantalla que no existe todavía.',
    sections: [
      {
        key: 'idea', title: 'Idea', required: true, rows: 2,
        hint: '¿Qué es, en una o dos frases?',
        placeholder: 'Ej.: Dashboard web para supervisores de cobranza.',
      },
      {
        key: 'objetivo', title: 'Objetivo', required: true, rows: 3,
        hint: '¿Para qué sirve y quién lo usa?',
        placeholder: 'Ej.: Que el supervisor monitoree en tiempo real la productividad de sus asesores y el recupero.',
      },
      {
        key: 'contenido', title: 'Contenido', required: true, rows: 3,
        hint: 'Datos, indicadores o funciones que debe tener.',
        placeholder: 'Ej.: Contacto efectivo, no contacto, compromisos de pago, monto recuperado, ranking de asesores.',
      },
      {
        key: 'layout', title: 'Layout', required: false, rows: 2,
        hint: 'Cómo imaginas la pantalla.',
        placeholder: 'Ej.: Menú lateral, barra de filtros arriba, tarjetas de indicadores, gráficos y tabla por asesor.',
      },
      {
        key: 'tema', title: 'Tema', required: false, rows: 2,
        hint: 'Estilo visual.',
        placeholder: 'Ej.: Profesional, corporativo, alta densidad de información.',
      },
      {
        key: 'referencias', title: 'Referencias', required: false, rows: 2,
        hint: 'Sistemas o pantallas que te gustan.',
        placeholder: 'Ej.: Salesforce, Genesys, Wolkvox.',
      },
      {
        key: 'restricciones', title: 'Restricciones', required: false, rows: 2,
        hint: 'Idioma, moneda, horario, integraciones, lo que se debe evitar.',
        placeholder: 'Ej.: Español, soles, hora de Lima (UTC-5).',
      },
    ],
  },
};

export type TemplateAnswers = Record<string, string>;

/** Las secciones con texto, como Markdown `## Título` + texto. */
export function composeDescription(type: WorkItemRequestType, answers: TemplateAnswers): string {
  return REQUEST_TEMPLATES[type].sections
    .map((s) => ({ s, v: (answers[s.key] ?? '').trim() }))
    .filter(({ v }) => v.length > 0)
    .map(({ s, v }) => `## ${s.title}\n${v}`)
    .join('\n\n');
}

/** Las secciones obligatorias que faltan (títulos), en orden. */
export function missingSections(type: WorkItemRequestType, answers: TemplateAnswers): string[] {
  return REQUEST_TEMPLATES[type].sections
    .filter((s) => s.required && (answers[s.key] ?? '').trim().length < 3)
    .map((s) => s.title);
}

/** Una línea por criterio, sin vacías. */
export function parseCriteria(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

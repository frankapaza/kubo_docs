/**
 * Renderizador de plantillas de notificación. Dominio puro: sin inyección de
 * dependencias, sin base de datos, sin `Date.now()`. Todo entra por parámetro.
 *
 * El juego de variables depende del público al que se dirige la plantilla.
 * El portal de clientes se construyó ocultando campo por campo la prioridad,
 * los plazos de SLA, el técnico asignado y el motivo de una transición: un
 * cliente nunca los ve. Si una plantilla de cliente pudiera usar `{{motivo}}`
 * o `{{prioridad}}`, cualquier edición del panel filtraría por correo justo
 * lo que el portal se cuida de ocultar -- y un correo no se puede retirar
 * como se retira un cambio en el portal.
 *
 * Los nombres de variable están fijados por la migración 015
 * (`backend/sql/migrations/015_notificaciones.sql`, sección 4) y sembrados en
 * `notification_templates`. Si este catálogo diverge de lo sembrado, las
 * plantillas existentes quedan rotas en silencio o el validador las rechaza;
 * `seeded-templates.consistency.spec.ts` vigila justamente eso.
 */

export type NotificationAudience = 'CLIENT' | 'TEAM';

/** Variables visibles para el cliente: nada de prioridad, SLA, responsable ni motivo. */
export const CLIENT_VARIABLES = [
  'codigo',
  'asunto',
  'estado',
  'fecha',
  'razon_social',
  'enlace_portal',
] as const;

/** El equipo ve además la información operativa que el cliente no debe ver. */
export const TEAM_VARIABLES = [
  ...CLIENT_VARIABLES,
  'prioridad',
  'sla',
  'responsable',
  'motivo',
  'enlace_panel',
] as const;

export type ClientVariable = (typeof CLIENT_VARIABLES)[number];
export type TeamVariable = (typeof TEAM_VARIABLES)[number];

/** Texto legible para un valor ausente. Nunca `undefined`, nunca la llave cruda. */
const MISSING_VALUE_TEXT = '(no disponible)';

/**
 * Coincide con `{{variable}}`, tolerando espacios dentro de las llaves:
 * `{{ codigo }}` y `{{codigo}}` son la misma variable. Una llave suelta que no
 * respeta esta forma (sin cerrar, vacía, con caracteres raros) simplemente no
 * coincide y queda como texto literal: no revienta el renderizado.
 */
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function variablesFor(audience: NotificationAudience): readonly string[] {
  return audience === 'CLIENT' ? CLIENT_VARIABLES : TEAM_VARIABLES;
}

const ALL_VARIABLES = new Set<string>([...CLIENT_VARIABLES, ...TEAM_VARIABLES]);

export type TemplateValidationResult =
  | { ok: true }
  | {
      ok: false;
      /** Variables que no existen en ningún público: probablemente un error de tipeo. */
      unknown: string[];
      /**
       * Variables que existen, pero son del otro público. Es el error que
       * sostiene la regla de fuga: una plantilla de CLIENT no puede usar
       * `{{motivo}}` aunque `{{motivo}}` sea una variable real de TEAM.
       */
      wrongAudience: string[];
    };

/**
 * Valida que `text` solo use variables del público indicado. Distingue dos
 * errores porque el editor del panel debe explicarlos distinto: una variable
 * "del otro público" es una fuga de datos; una variable "que no existe en
 * ningún público" es, casi siempre, una errata.
 */
export function validateTemplate(
  text: string,
  audience: NotificationAudience,
): TemplateValidationResult {
  const allowed = new Set(variablesFor(audience));
  const unknown = new Set<string>();
  const wrongAudience = new Set<string>();

  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (allowed.has(name)) continue;
    if (ALL_VARIABLES.has(name)) {
      wrongAudience.add(name);
    } else {
      unknown.add(name);
    }
  }

  if (unknown.size === 0 && wrongAudience.size === 0) return { ok: true };
  return { ok: false, unknown: [...unknown], wrongAudience: [...wrongAudience] };
}

/** Valores a sustituir, indexados por nombre de variable (sin llaves ni espacios). */
export type TemplateValues = Record<string, string | number | null | undefined>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sustituye las variables de `text` por los valores de `values`, escapando
 * cada valor sustituido (el asunto de un ticket lo escribe el cliente: un `<`
 * suelto no puede romper el correo).
 *
 * Solo se sustituyen las variables del público indicado -- defensa en
 * profundidad: aunque `values` traiga por error una variable del otro
 * público (p. ej. `motivo` al renderizar para CLIENT), no se imprime; queda
 * la llave literal en el texto. La regla de fuga la sostiene sobre todo
 * `validateTemplate` al guardar la plantilla, pero `render` no depende de
 * que esa validación se haya ejecutado antes.
 */
export function render(
  text: string,
  audience: NotificationAudience,
  values: TemplateValues,
): string {
  const allowed = new Set(variablesFor(audience));

  return text.replace(VARIABLE_PATTERN, (match, name: string) => {
    if (!allowed.has(name)) return match;

    const value = values[name];
    if (value === null || value === undefined) return escapeHtml(MISSING_VALUE_TEXT);

    return escapeHtml(String(value));
  });
}

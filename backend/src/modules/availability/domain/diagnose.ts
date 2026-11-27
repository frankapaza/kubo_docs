/** Textos del diagnóstico: viajan al ticket (`ctx.diagnosis`) y a la cronología. */
export const DIAGNOSIS_LABELS = {
  DOWN: 'Sin respuesta confirmada',
  ROUTE: 'Sin acceso desde Perú',
  ROUTE_PENDING: 'Sin acceso desde Perú (sin comprobación cruzada del servidor en 2 minutos)',
  NONE: 'Problema de la sonda del servidor',
} as const;

export type Diagnosis = { kind: 'DOWN' | 'ROUTE'; label: string } | { kind: 'NONE'; label: string };

export interface DiagnoseInput {
  /** Sonda que confirmó el fallo. */
  reporter: 'OFFICE' | 'DATACENTER';
  /** Resultado de la comprobación cruzada de la otra sonda; null = no llegó en 2 min. */
  crossOk: boolean | null;
  /** Caída de la conexión de la oficina abierta. */
  officeOutage: boolean;
}

/**
 * Tabla «Cruce de sondas» de la spec. Un `CONFIRMED_FAILURE` de la oficina
 * durante una caída de oficina no llega aquí: se descarta antes.
 */
export function diagnose(input: DiagnoseInput): Diagnosis {
  if (input.reporter === 'OFFICE') {
    if (input.crossOk === false) return { kind: 'DOWN', label: DIAGNOSIS_LABELS.DOWN };
    if (input.crossOk === true) return { kind: 'ROUTE', label: DIAGNOSIS_LABELS.ROUTE };
    // Con la información disponible: se reclasifica a DOWN si después falla desde el servidor.
    return { kind: 'ROUTE', label: DIAGNOSIS_LABELS.ROUTE_PENDING };
  }
  // DATACENTER: sin datos de la oficina (caída o cruce que no llegó) decide sola.
  if (input.officeOutage || input.crossOk !== true) return { kind: 'DOWN', label: DIAGNOSIS_LABELS.DOWN };
  return { kind: 'NONE', label: DIAGNOSIS_LABELS.NONE };
}

/** Texto por defecto de un tipo de incidente (reintentos de ticket sin la señal a mano). */
export function labelForKind(kind: 'DOWN' | 'ROUTE'): string {
  return kind === 'DOWN' ? DIAGNOSIS_LABELS.DOWN : DIAGNOSIS_LABELS.ROUTE;
}

/**
 * Diagnóstico guardado de un incidente: el del último evento OPENED/REOPENED/
 * UPGRADED_TO_DOWN, solo si sigue valiendo para el tipo actual (tras un cambio
 * de tipo, o sin evento, se usa el texto del tipo).
 */
export function diagnosisFromEvent(
  incidentKind: 'DOWN' | 'ROUTE' | 'DEGRADED',
  last: { detail: Record<string, unknown> | null } | null | undefined,
): string {
  const kind = incidentKind === 'ROUTE' ? 'ROUTE' : 'DOWN';
  const detail = last?.detail as { kind?: unknown; diagnosis?: unknown } | null | undefined;
  if (detail && detail.kind === kind && typeof detail.diagnosis === 'string') return detail.diagnosis;
  return labelForKind(kind);
}

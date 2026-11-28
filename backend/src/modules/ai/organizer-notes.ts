/** Nota tomada durante la grabación (spec 2026-11-28-metodologia-ia-hoja-de-ruta, entrega 2). */
export interface OrganizerNote {
  offsetSec: number;
  kind: 'NOTA' | 'ACUERDO' | 'TAREA';
  text: string;
}

const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Líneas para el prompt del acta: las notas del organizador son hechos confirmados;
 * los acuerdos y tareas marcados deben aparecer como tales. El texto se aplana a una
 * línea y sin comillas triples para que no pueda cerrar el bloque de la transcripción.
 */
export function formatOrganizerNotes(notes: OrganizerNote[] | undefined): string[] {
  if (!notes?.length) return [];
  const clean = (t: string) => t.replace(/"""/g, '”').replace(/\s*\n\s*/g, ' ').trim();
  return [
    'Notas del organizador tomadas durante la reunión (son hechos confirmados: las de tipo ACUERDO deben aparecer como acuerdos y las de tipo TAREA como compromisos):',
    '',
    ...notes
      .slice()
      .sort((a, b) => a.offsetSec - b.offsetSec)
      .map((n) => `- [${mmss(n.offsetSec)}] ${n.kind}: ${clean(n.text)}`),
  ];
}

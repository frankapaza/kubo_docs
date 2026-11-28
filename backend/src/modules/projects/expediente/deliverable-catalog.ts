import { BadRequestException, ConflictException } from '@nestjs/common';

/**
 * El expediente del proyecto: qué entregables lleva según el tipo de trabajo,
 * cómo se numeran sus versiones y cómo se nombran sus archivos. Sin base de
 * datos: lo usan el servicio, el .zip y las pruebas.
 *
 * El catálogo sale de la metodología de proyectos (estructura NTP-ISO/IEC 12207):
 * la columna de obligatoriedad es [tradicional, ágil, correctivo].
 */

export const WORK_TYPES = ['TRADICIONAL', 'AGIL', 'CORRECTIVO'] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  TRADICIONAL: 'Desarrollo tradicional',
  AGIL: 'Desarrollo ágil',
  CORRECTIVO: 'Mantenimiento correctivo',
};

/** O = obligatorio, OP = opcional, NA = no aplica. */
export type Requirement = 'O' | 'OP' | 'NA';

export const PHASES = ['INICIO', 'PLANIFICACION', 'EJECUCION', 'MONITOREO', 'CIERRE'] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABELS: Record<Phase, string> = {
  INICIO: 'Inicio',
  PLANIFICACION: 'Planificación',
  EJECUCION: 'Ejecución',
  MONITOREO: 'Monitoreo y control',
  CIERRE: 'Cierre',
};

export const DELIVERABLE_STATUSES = ['PENDIENTE', 'BORRADOR', 'EN_REVISION', 'APROBADO', 'FIRMADO', 'NO_APLICA'] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

export interface CatalogEntry {
  type: string;
  name: string;
  phase: Phase;
  /** [tradicional, ágil, correctivo] */
  req: [Requirement, Requirement, Requirement];
}

export const CATALOG: readonly CatalogEntry[] = [
  { type: 'ACT-INI', name: 'Acta de inicio', phase: 'INICIO', req: ['O', 'O', 'NA'] },
  { type: 'CRO-PRO', name: 'Cronograma del proyecto', phase: 'PLANIFICACION', req: ['O', 'NA', 'NA'] },
  { type: 'DOC-ANA', name: 'Documento de análisis', phase: 'PLANIFICACION', req: ['O', 'OP', 'NA'] },
  { type: 'HIS-USU', name: 'Historias de usuario', phase: 'PLANIFICACION', req: ['O', 'O', 'NA'] },
  { type: 'ACT-APRO', name: 'Acta de aprobación de prototipos', phase: 'PLANIFICACION', req: ['O', 'OP', 'NA'] },
  { type: 'ARQ-TIC', name: 'Arquitectura de TI', phase: 'PLANIFICACION', req: ['OP', 'OP', 'NA'] },
  { type: 'DOC-SER', name: 'Documento de servicios', phase: 'PLANIFICACION', req: ['OP', 'OP', 'NA'] },
  { type: 'EVD-PUN', name: 'Evidencia de pruebas unitarias', phase: 'EJECUCION', req: ['OP', 'OP', 'OP'] },
  { type: 'MAN-USU', name: 'Manual de usuario', phase: 'EJECUCION', req: ['O', 'O', 'NA'] },
  { type: 'PRU-FUN', name: 'Pruebas funcionales', phase: 'EJECUCION', req: ['O', 'O', 'OP'] },
  { type: 'INF-PRU', name: 'Informe de pruebas', phase: 'EJECUCION', req: ['O', 'O', 'OP'] },
  { type: 'ACT-USU', name: 'Acta de conformidad de usuario', phase: 'EJECUCION', req: ['O', 'O', 'OP'] },
  { type: 'MAN-DES', name: 'Manual de despliegue', phase: 'EJECUCION', req: ['O', 'O', 'O'] },
  { type: 'SOL-PAP', name: 'Solicitud de pase a producción', phase: 'EJECUCION', req: ['O', 'O', 'O'] },
  { type: 'ACT-REU', name: 'Acta de reunión', phase: 'MONITOREO', req: ['OP', 'OP', 'NA'] },
  { type: 'INF-GES', name: 'Informe de gestión', phase: 'MONITOREO', req: ['OP', 'OP', 'NA'] },
  { type: 'SOL-CAM', name: 'Solicitud de cambio', phase: 'MONITOREO', req: ['OP', 'OP', 'NA'] },
  { type: 'ACT-CIE', name: 'Acta de cierre', phase: 'CIERRE', req: ['O', 'O', 'NA'] },
  { type: 'ACT-CAP', name: 'Acta de capacitación', phase: 'CIERRE', req: ['OP', 'OP', 'NA'] },
  { type: 'ACT-TRA', name: 'Acta de transferencia', phase: 'CIERRE', req: ['OP', 'OP', 'NA'] },
];

export function catalogEntry(type: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.type === type);
}

export function isWorkType(v: unknown): v is WorkType {
  return typeof v === 'string' && (WORK_TYPES as readonly string[]).includes(v);
}

export function requirementFor(entry: CatalogEntry, workType: WorkType): Requirement {
  return entry.req[WORK_TYPES.indexOf(workType)];
}

export function autoNaReason(workType: WorkType): string {
  return `No aplica a un proyecto de ${WORK_TYPE_LABELS[workType].toLowerCase()}.`;
}

export interface Version {
  major: number;
  minor: number;
}

/** «0.3», o null si todavía no hay ninguna versión (0.0). */
export function versionLabel(v: Version): string | null {
  if (v.major === 0 && v.minor === 0) return null;
  return `${v.major}.${v.minor}`;
}

/** Subir una versión de trabajo suma 0.1: 0.2 → 0.3; tras aprobar, 1.0 → 1.1. */
export function nextWorkingVersion(v: Version): Version {
  return { major: v.major, minor: v.minor + 1 };
}

/** Aprobar sube a la siguiente entera: 0.3 → 1.0, 1.2 → 2.0. */
export function approvedVersion(v: Version): Version {
  return { major: v.major + 1, minor: 0 };
}

/** El código del proyecto como va en un nombre de archivo: mayúsculas, letras, números y guiones. */
export function projectCodeSlug(code: string): string {
  const s = code
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  return s || 'PROY';
}

/** `KUBO-COB-0007-DOC-ANA V0.2`; sin versión todavía, `Vx.y`. */
export function nomenclature(projectCode: string, correlative: number, type: string, v: Version): string {
  const nnnn = String(correlative).padStart(4, '0');
  return `KUBO-${projectCodeSlug(projectCode)}-${nnnn}-${type} V${versionLabel(v) ?? 'x.y'}`;
}

/**
 * Lo que se puede hacer con un entregable. Cada acción deja una fila en el
 * historial: UPLOAD → E, SUBMIT/OBSERVE → R, APPROVE → A, SIGN → F,
 * NOT_APPLICABLE → N, REOPEN → P.
 */
export type DeliverableAction = 'UPLOAD' | 'SUBMIT' | 'OBSERVE' | 'APPROVE' | 'SIGN' | 'NOT_APPLICABLE' | 'REOPEN';

const ALLOWED: Record<DeliverableAction, readonly DeliverableStatus[]> = {
  // Una versión nueva después de aprobar o firmar abre otro ciclo (1.0 → 1.1).
  UPLOAD: ['PENDIENTE', 'BORRADOR', 'EN_REVISION', 'APROBADO', 'FIRMADO'],
  SUBMIT: ['BORRADOR'],
  OBSERVE: ['EN_REVISION'],
  APPROVE: ['BORRADOR', 'EN_REVISION'],
  SIGN: ['APROBADO'],
  NOT_APPLICABLE: ['PENDIENTE'],
  REOPEN: ['NO_APLICA'],
};

const ACTION_LABELS: Record<DeliverableAction, string> = {
  UPLOAD: 'subir una versión',
  SUBMIT: 'enviar a revisión',
  OBSERVE: 'observar',
  APPROVE: 'aprobar',
  SIGN: 'marcar como firmado',
  NOT_APPLICABLE: 'marcar como «no aplica»',
  REOPEN: 'reabrir',
};

export const STATUS_LABELS: Record<DeliverableStatus, string> = {
  PENDIENTE: 'Pendiente',
  BORRADOR: 'Borrador',
  EN_REVISION: 'En revisión',
  APROBADO: 'Aprobado',
  FIRMADO: 'Firmado',
  NO_APLICA: 'No aplica',
};

export function assertTransition(from: DeliverableStatus, action: DeliverableAction): void {
  if (!ALLOWED[action].includes(from)) {
    throw new ConflictException({
      code: 'INVALID_STATE',
      message: `No se puede ${ACTION_LABELS[action]} un entregable en estado «${STATUS_LABELS[from]}».`,
    });
  }
}

export function assertWorkType(v: unknown): WorkType {
  if (!isWorkType(v)) {
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: `Tipo de trabajo desconocido. Usa uno de: ${WORK_TYPES.join(', ')}.`,
    });
  }
  return v;
}

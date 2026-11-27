/**
 * Reglas puras del conector: qué es un código, qué puede mover un agente y en
 * qué orden se listan los pendientes. Sin base ni Nest, para probarlas solas.
 */

export type ItemKind = 'KB' | 'RQ';

const CODE = /^(KB|RQ)-\d{4,}$/;

/** ` kb-0210 ` → `KB-0210`. Cualquier otra cosa → null (y la API responde 404). */
export function normalizeCode(raw: string): { kind: ItemKind; code: string } | null {
  const code = String(raw ?? '').trim().toUpperCase();
  if (!CODE.test(code)) return null;
  return { kind: code.slice(0, 2) as ItemKind, code };
}

/**
 * La lista blanca de la spec (§4.1). Lo que no está aquí lo hace una persona en
 * DevDocs, o la hace una herramienta propia que exige evidencia: resolver un
 * ticket (resolver_ticket) y entregar un RQ a Pruebas (entregar_requerimiento).
 */
const ALLOWED: Record<ItemKind, ReadonlyArray<readonly [string, string]>> = {
  KB: [
    ['ASIGNADO', 'EN_ATENCION'],
    ['ESPERA_CLIENTE', 'EN_ATENCION'],
    // Con confirmación de la persona en el MCP (spec 2026-11-27-mcp-acciones-confirmadas).
    ['EN_ATENCION', 'ESPERA_CLIENTE'],
    ['EN_ATENCION', 'DERIVADO'],
  ],
  RQ: [
    ['PENDIENTE', 'EN_PROCESO'],
  ],
};

export function canAgentTransition(kind: ItemKind, from: string, to: string): boolean {
  return ALLOWED[kind].some(([f, t]) => f === from && t === to);
}

/** Los estados a los que el agente puede pedir ir, por tipo (para mensajes de error). */
export function agentTargets(kind: ItemKind): string[] {
  return [...new Set(ALLOWED[kind].map(([, t]) => t))];
}

/**
 * Tickets (P1–P4) y requerimientos (ALTA/MEDIA/BAJA) en una sola escala para
 * ordenar la lista: ALTA va justo detrás de un P1, MEDIA con P3, BAJA con P4.
 */
const RANK: Record<string, number> = { P1: 1, ALTA: 2, P2: 2, P3: 3, MEDIA: 3, P4: 4, BAJA: 4 };

export function priorityRank(priority: string): number {
  return RANK[priority] ?? 5;
}

/** Pasar a Espera del cliente o Derivado exige un motivo: queda en el historial. */
export function transitionNeedsReason(to: string): boolean {
  return to === 'ESPERA_CLIENTE' || to === 'DERIVADO';
}

export interface StaffRef {
  id: number;
  email: string;
  fullName: string;
}

export type StaffMatch =
  | { ok: true; user: StaffRef }
  | { ok: false; reason: 'AMBIGUO' | 'NO_EXISTE'; candidatos: StaffRef[] };

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * La persona a quien asignar, entre el personal activo: por correo exacto o
 * por nombre (sin tildes ni mayúsculas) si solo hay una coincidencia.
 */
export function matchStaff(staff: StaffRef[], persona: string): StaffMatch {
  const q = fold(String(persona ?? ''));
  if (!q) return { ok: false, reason: 'NO_EXISTE', candidatos: staff };
  const byEmail = staff.filter((u) => fold(u.email) === q);
  if (byEmail.length === 1) return { ok: true, user: byEmail[0] };
  const byName = staff.filter((u) => fold(u.fullName).includes(q));
  if (byName.length === 1) return { ok: true, user: byName[0] };
  if (byName.length > 1) return { ok: false, reason: 'AMBIGUO', candidatos: byName };
  return { ok: false, reason: 'NO_EXISTE', candidatos: staff };
}

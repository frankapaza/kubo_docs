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

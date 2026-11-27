import { IntegrationQueryService } from './integration-query.service';

/** QueryBuilder que registra las condiciones para comprobar la consulta que se arma. */
function recordingQb() {
  const where: Array<{ sql: string; params?: Record<string, unknown> }> = [];
  const qb: any = {
    where: (sql: string, params?: any) => (where.push({ sql, params }), qb),
    andWhere: (sql: any, params?: any) => (where.push({ sql: typeof sql === 'string' ? sql : '<brackets>', params }), qb),
    orderBy: () => qb, addOrderBy: () => qb, take: () => qb,
    getMany: async () => [],
  };
  return { qb, where };
}

describe('IntegrationQueryService.requerimientos', () => {
  it('filtrar por prioridad excluye los requerimientos aún no aceptados (su prioridad no se publica)', async () => {
    const { qb, where } = recordingQb();
    const svc = new IntegrationQueryService({} as any, { createQueryBuilder: () => qb } as any, {} as any, {} as any, {} as any);
    await svc.requerimientos(1, { prioridades: ['ALTA'], limite: 10 });
    const pre = where.find((w) => /status NOT IN/.test(w.sql));
    expect(pre?.params?.preBoard).toEqual(['SOLICITADO', 'RECHAZADO', 'FALTA_INFO']);
  });

  it('sin filtro de prioridad no se excluye nada por estado', async () => {
    const { qb, where } = recordingQb();
    const svc = new IntegrationQueryService({} as any, { createQueryBuilder: () => qb } as any, {} as any, {} as any, {} as any);
    await svc.requerimientos(1, { limite: 10 });
    expect(where.some((w) => /status NOT IN/.test(w.sql))).toBe(false);
  });
});

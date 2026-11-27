import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ProbeTokenGuard } from './probe-token.guard';

const TOKEN = 'kmp_abcDEF123';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

const setup = (rows: any[]) => {
  const repo = { findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.tokenHash === where.tokenHash) ?? null) };
  const guard = new ProbeTokenGuard(repo as any);
  const run = (authorization?: string) => {
    const req: any = { headers: authorization === undefined ? {} : { authorization } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    return { req, result: guard.canActivate(ctx) };
  };
  return { repo, run };
};

describe('ProbeTokenGuard', () => {
  it('token válido -> deja req.probe', async () => {
    const probe = { id: 1, code: 'oficina-01', tokenHash: hash(TOKEN) };
    const { run } = setup([probe]);
    const { req, result } = run(`Bearer ${TOKEN}`);
    await expect(result).resolves.toBe(true);
    expect(req.probe).toBe(probe);
  });
  it('token desconocido -> 401', async () => {
    const { run } = setup([{ id: 1, tokenHash: hash(TOKEN) }]);
    await expect(run('Bearer kmp_otro').result).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('sin cabecera -> 401 sin consultar la base', async () => {
    const { run, repo } = setup([]);
    await expect(run().result).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.findOne).not.toHaveBeenCalled();
  });
  it('esquema distinto de Bearer -> 401', async () => {
    const { run } = setup([{ id: 1, tokenHash: hash(TOKEN) }]);
    await expect(run(`Basic ${TOKEN}`).result).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('sonda con token revocado (token_hash null) -> 401', async () => {
    const { run } = setup([{ id: 1, code: 'oficina-01', tokenHash: null }]);
    await expect(run(`Bearer ${TOKEN}`).result).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

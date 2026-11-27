import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AgentTokenGuard } from './agent-token.guard';

const TOKEN = 'kma_' + 'b'.repeat(43);
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

const setup = (rows: any[]) => {
  const repo = { findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.agentTokenHash === where.agentTokenHash) ?? null) };
  const guard = new AgentTokenGuard(repo as any);
  const run = (authorization?: string) => {
    const req: any = { headers: authorization === undefined ? {} : { authorization } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    return { req, result: guard.canActivate(ctx) };
  };
  return { repo, run };
};

describe('AgentTokenGuard', () => {
  it('token kma_ válido -> deja req.server', async () => {
    const server = { id: 10, name: 'srv', agentTokenHash: hash(TOKEN) };
    const { req, result } = setup([server]).run(`Bearer ${TOKEN}`);
    await expect(result).resolves.toBe(true);
    expect(req.server).toBe(server);
  });

  it('un token de sonda (kmp_) -> 401 sin consultar la base', async () => {
    const probeToken = 'kmp_' + 'b'.repeat(43);
    const { run, repo } = setup([{ id: 10, agentTokenHash: hash(probeToken) }]);
    await expect(run(`Bearer ${probeToken}`).result).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('kma_ revocado (ya no está en ningún servidor) -> 401', async () => {
    const { run } = setup([{ id: 10, agentTokenHash: null }]);
    await expect(run(`Bearer ${TOKEN}`).result).rejects.toMatchObject({ response: { code: 'UNAUTHORIZED' } });
  });

  it('sin cabecera -> 401', async () => {
    await expect(setup([]).run().result).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

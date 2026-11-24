import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';

import { encryptSecret } from '../../common/crypto/aes-gcm.util';
import { GithubWebhookService } from './github-webhook.service';

const SECRET = 'c'.repeat(64);
const REPO = { id: 3, clientSystemId: 11, githubFullName: 'cobrosseguros/cobranza', isActive: 1 };

const sign = (raw: Buffer) => 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');

function build() {
  const data = {
    findRepoByFullName: jest.fn().mockResolvedValue(REPO),
    findWebhookSecretEnc: jest.fn().mockResolvedValue(encryptSecret(SECRET)),
    findTicketByCode: jest.fn().mockImplementation(async (code: string) =>
      code === 'KB-0210' ? { id: 100, code, systemId: 11 } : code === 'KB-0999' ? { id: 999, code, systemId: 77 } : null,
    ),
    findWorkItemByCode: jest.fn().mockImplementation(async (code: string) =>
      code === 'RQ-0045' ? { id: 200, code, clientSystemId: 11 } : null,
    ),
    upsertLink: jest.fn().mockResolvedValue(undefined),
  };
  const realtime = { notifyChanged: jest.fn() };
  return { service: new GithubWebhookService(data as never, realtime as never), data, realtime };
}

const call = (service: GithubWebhookService, event: string, body: object, signature?: string) => {
  const raw = Buffer.from(JSON.stringify(body));
  return service.handle(event, raw, signature ?? sign(raw), body);
};

const push = {
  ref: 'refs/heads/fix/KB-0210-filtro-fecha',
  repository: { full_name: 'CobrosSeguros/Cobranza', html_url: 'https://github.com/cobrosseguros/cobranza' },
  commits: [
    { id: 'aaa111', message: 'KB-0210 fix: filtro\n\ndetalle', url: 'https://github.com/x/commit/aaa111', timestamp: '2026-11-24T10:00:00-05:00', author: { username: 'ana' } },
    { id: 'bbb222', message: 'kb-0210 y KB-0210 otra vez; ver KB-0999', url: 'https://github.com/x/commit/bbb222', timestamp: '2026-11-24T10:05:00-05:00', author: { name: 'Ana' } },
  ],
};

describe('GithubWebhookService', () => {
  it('firma inválida → 401 sin escribir', async () => {
    const { service, data } = build();
    await expect(call(service, 'push', push, 'sha256=' + '0'.repeat(64))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(data.upsertLink).not.toHaveBeenCalled();
  });

  it('repo no registrado → 401', async () => {
    const { service, data } = build();
    data.findRepoByFullName.mockResolvedValueOnce(null);
    await expect(call(service, 'push', push)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('busca el repo en minúsculas', async () => {
    const { service, data } = build();
    await call(service, 'push', push);
    expect(data.findRepoByFullName).toHaveBeenCalledWith('cobrosseguros/cobranza');
  });

  it('push: no duplica, enlaza la rama y cada commit una vez, e ignora códigos de otra asignación', async () => {
    const { service, data, realtime } = build();
    const out = await call(service, 'push', push);
    const calls = data.upsertLink.mock.calls.map((c) => c[0]);
    expect(calls.filter((c) => c.ticketId === 999)).toHaveLength(0);
    expect(calls.map((c) => `${c.kind}:${c.ref}:${c.ticketId}`).sort()).toEqual([
      'BRANCH:fix/KB-0210-filtro-fecha:100',
      'COMMIT:aaa111:100',
      'COMMIT:bbb222:100',
    ]);
    expect(calls.find((c) => c.ref === 'aaa111')).toMatchObject({ title: 'KB-0210 fix: filtro', authorLogin: 'ana', source: 'WEBHOOK' });
    expect(out.linked).toBe(3);
    expect(realtime.notifyChanged).toHaveBeenCalledTimes(1);
  });

  it('pull_request cerrado y fusionado queda como merged', async () => {
    const { service, data } = build();
    await call(service, 'pull_request', {
      action: 'closed',
      repository: { full_name: 'cobrosseguros/cobranza' },
      pull_request: {
        number: 12, title: 'RQ-0045 exportar', html_url: 'https://github.com/x/pull/12', state: 'closed',
        merged: true, head: { ref: 'feat/RQ-0045' }, user: { login: 'ana' }, updated_at: '2026-11-24T12:00:00Z',
      },
    });
    expect(data.upsertLink).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'PR', ref: '12', workItemId: 200, ticketId: null, state: 'merged' }),
    );
  });

  it('create de una rama la enlaza', async () => {
    const { service, data } = build();
    await call(service, 'create', { ref: 'feat/RQ-0045-excel', ref_type: 'branch', repository: { full_name: 'cobrosseguros/cobranza' } });
    expect(data.upsertLink).toHaveBeenCalledWith(expect.objectContaining({ kind: 'BRANCH', ref: 'feat/RQ-0045-excel', workItemId: 200 }));
  });

  it('otros eventos (issues, ping) no escriben nada', async () => {
    const { service, data } = build();
    const out = await call(service, 'issues', { repository: { full_name: 'cobrosseguros/cobranza' } });
    expect(out).toEqual({ linked: 0, ignored: true });
    expect(data.upsertLink).not.toHaveBeenCalled();
  });

  it('un push que borra la rama no enlaza nada', async () => {
    const { service, data } = build();
    await call(service, 'push', { ...push, deleted: true, commits: [] });
    expect(data.upsertLink).not.toHaveBeenCalled();
  });
});

describe('commits traídos por un merge', () => {
  it('un commit no nuevo (distinct=false) solo se enlaza si su mensaje nombra el código', async () => {
    const { service, data } = build();
    await call(service, 'push', {
      ...push,
      commits: [
        { id: 'ccc333', distinct: false, message: 'cambio de main sin código', url: 'u', timestamp: '2026-11-24T10:00:00Z', author: {} },
        { id: 'ddd444', distinct: true, message: 'merge main en la rama', url: 'u', timestamp: '2026-11-24T10:01:00Z', author: {} },
        { id: 'eee555', distinct: false, message: 'KB-0210 viejo pero nombrado', url: 'u', timestamp: '2026-11-24T10:02:00Z', author: {} },
      ],
    });
    const refs = data.upsertLink.mock.calls.map((c) => c[0].ref).sort();
    expect(refs).toEqual(['ddd444', 'eee555', 'fix/KB-0210-filtro-fecha']);
  });
});

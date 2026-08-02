import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { Repository } from 'typeorm';
import { AuditLog } from '../../modules/audit/entities/audit-log.entity';
import { AuditInterceptor } from './audit.interceptor';

/**
 * El interceptor es global: la misma clase escribe el asiento de una accion
 * del personal (req.user = { id, email, role }) y el de una accion del portal
 * (req.user = AuthClientUser, que NO tiene `id`). Estos tests fijan que las
 * tres procedencias -- personal, cliente y sistema -- queden distinguibles.
 */
const makeInterceptor = () => {
  const saved: Array<Partial<AuditLog>> = [];
  const repo = {
    create: jest.fn((data: Partial<AuditLog>) => data),
    save: jest.fn((data: Partial<AuditLog>) => {
      saved.push(data);
      return Promise.resolve(data);
    }),
  };
  return { interceptor: new AuditInterceptor(repo as unknown as Repository<AuditLog>), repo, saved };
};

const ctxWith = (user: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        url: '/api/v1/portal/tickets',
        route: { path: '/api/v1/portal/tickets' },
        body: { subject: 'x' },
        headers: {},
        ip: '10.0.0.1',
        user,
      }),
    }),
  }) as unknown as ExecutionContext;

const next: CallHandler = { handle: () => of({ id: 42 }) };

const run = async (user: unknown) => {
  const { interceptor, saved } = makeInterceptor();
  await firstValueFrom(interceptor.intercept(ctxWith(user), next));
  return saved[0];
};

describe('AuditInterceptor: a quien se atribuye la accion', () => {
  it('una accion del personal va en user_id y deja client_user_id nulo', async () => {
    const entry = await run({ id: 5, email: 'admin@kubo.pe', role: 'ADMIN' });
    expect(entry.userId).toBe(5);
    expect(entry.clientUserId).toBeNull();
  });

  it('una accion del portal va en client_user_id y deja user_id nulo', async () => {
    const entry = await run({ clientUserId: 11, email: 'p@c.pe', clientId: 7, isClientAdmin: false });
    expect(entry.userId).toBeNull();
    expect(entry.clientUserId).toBe(11);
  });

  it('nunca mete el clientUserId en user_id: se confundiria con un id de users', async () => {
    const entry = await run({ clientUserId: 5, email: 'p@c.pe', clientId: 7, isClientAdmin: false });
    // El mismo numero como id de personal seria un asiento atribuido a otra
    // persona, ademas de romper la FK audit_log.user_id -> users(id).
    expect(entry.userId).not.toBe(5);
    expect(entry.userId).toBeNull();
  });

  it('una accion sin sesion queda con las dos columnas nulas (sistema)', async () => {
    const entry = await run(undefined);
    expect(entry.userId).toBeNull();
    expect(entry.clientUserId).toBeNull();
  });

  it('los tres asientos son distinguibles entre si', async () => {
    const personal = await run({ id: 5 });
    const cliente = await run({ clientUserId: 5, clientId: 7 });
    const sistema = await run(undefined);
    const huella = (e: Partial<AuditLog>) => `${e.userId ?? '-'}/${e.clientUserId ?? '-'}`;
    expect(new Set([huella(personal), huella(cliente), huella(sistema)]).size).toBe(3);
  });
});

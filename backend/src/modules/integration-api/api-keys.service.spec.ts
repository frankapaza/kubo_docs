import { ApiKeysService, MAX_ACTIVE_KEYS } from './api-keys.service';
import { fingerprintApiKey } from './domain/api-key';
import { ClientApiKey } from './entities/client-api-key.entity';

/** Repositorio en memoria con lo que usa el servicio (find/findOne/count/save/create/update). */
function fakeKeys() {
  const rows: ClientApiKey[] = [];
  let seq = 0;
  const match = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]: [string, any]) =>
      v && typeof v === 'object' && v._type === 'isNull' ? r[k] === null || r[k] === undefined : r[k] === v,
    );
  return {
    rows,
    create: (o: Partial<ClientApiKey>) => ({ ...o }) as ClientApiKey,
    save: async (o: ClientApiKey) => {
      if (!o.id) {
        o.id = ++seq;
        o.createdAt = new Date('2026-11-27T10:00:00Z');
        rows.push(o);
      }
      return o;
    },
    find: async ({ where }: any) => rows.filter((r) => match(r, where)),
    findOne: async ({ where }: any) => rows.find((r) => match(r, where)) ?? null,
    count: async ({ where }: any) => rows.filter((r) => match(r, where)).length,
    update: async (id: number, patch: Partial<ClientApiKey>) => {
      Object.assign(rows.find((r) => r.id === id)!, patch);
    },
  };
}

function make(clientStatus: Record<number, string> = { 1: 'CLIENT', 2: 'CLIENT', 3: 'FORMER_CLIENT' }) {
  const keys = fakeKeys();
  const clients = {
    findOne: async ({ where }: any) => (clientStatus[where.id] ? { id: where.id, status: clientStatus[where.id] } : null),
  };
  return { svc: new ApiKeysService(keys as any, clients as any), keys };
}

describe('ApiKeysService', () => {
  it('issue guarda solo huella y prefijo, y la clave devuelta resuelve a su cliente', async () => {
    const { svc, keys } = make();
    const { key, secret } = await svc.issue(1, '  Power BI gerencia ', { clientUserId: 7 });
    expect(key).toMatchObject({ nombre: 'Power BI gerencia', prefijo: secret.slice(0, 8), estado: 'ACTIVA' });
    expect(keys.rows[0].keyHash).toBe(fingerprintApiKey(secret));
    expect(JSON.stringify(keys.rows[0])).not.toContain(secret);
    expect(keys.rows[0].createdByClientUserId).toBe(7);
    await expect(svc.resolve(fingerprintApiKey(secret))).resolves.toEqual({ keyId: key.id, clientId: 1 });
  });

  it(`con ${MAX_ACTIVE_KEYS} claves activas, la siguiente da 409 LIMITE_CLAVES; una revocada libera el cupo`, async () => {
    const { svc } = make();
    const ids: number[] = [];
    for (let i = 0; i < MAX_ACTIVE_KEYS; i++) ids.push((await svc.issue(1, `k${i}`, { userId: 1 })).key.id);
    await expect(svc.issue(1, 'otra', { userId: 1 })).rejects.toMatchObject({ response: { code: 'LIMITE_CLAVES' } });
    await svc.revoke(1, ids[0], { userId: 1 });
    await expect(svc.issue(1, 'otra', { userId: 1 })).resolves.toBeTruthy();
  });

  it('revocar una clave de otro cliente da 404; revocada ya no resuelve', async () => {
    const { svc } = make();
    const { key, secret } = await svc.issue(1, 'a', { userId: 1 });
    await expect(svc.revoke(2, key.id, { userId: 1 })).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
    const v = await svc.revoke(1, key.id, { clientUserId: 9 });
    expect(v.estado).toBe('REVOCADA');
    await expect(svc.resolve(fingerprintApiKey(secret))).resolves.toBeNull();
  });

  it('la clave de un cliente que ya no es cliente (FORMER_CLIENT) no resuelve', async () => {
    const { svc } = make();
    const { secret } = await svc.issue(3, 'a', { userId: 1 });
    await expect(svc.resolve(fingerprintApiKey(secret))).resolves.toBeNull();
  });

  it('marca el último uso si pasó 1 minuto, no si pasaron 30 s', async () => {
    const { svc, keys } = make();
    const { secret } = await svc.issue(1, 'a', { userId: 1 });
    const t0 = new Date('2026-11-27T12:00:00Z');
    await svc.resolve(fingerprintApiKey(secret), t0);
    expect(keys.rows[0].lastUsedAt).toEqual(t0);
    await svc.resolve(fingerprintApiKey(secret), new Date(t0.getTime() + 30_000));
    expect(keys.rows[0].lastUsedAt).toEqual(t0);
    const t2 = new Date(t0.getTime() + 60_000);
    await svc.resolve(fingerprintApiKey(secret), t2);
    expect(keys.rows[0].lastUsedAt).toEqual(t2);
  });

  it('nombre vacío o de más de 80 caracteres -> 400', async () => {
    const { svc } = make();
    await expect(svc.issue(1, '   ', { userId: 1 })).rejects.toMatchObject({ response: { code: 'BAD_INPUT' } });
    await expect(svc.issue(1, 'x'.repeat(81), { userId: 1 })).rejects.toMatchObject({ response: { code: 'BAD_INPUT' } });
  });
});

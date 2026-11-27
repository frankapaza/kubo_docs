import { ApiClientRateLimiter, ApiKeyGuard, ApiKeyRateLimiter, API_MAX_PER_CLIENT, API_MAX_PER_KEY } from './api-key.guard';
import { fingerprintApiKey, generateApiKey } from './domain/api-key';

const ctx = (headers: Record<string, string>) => {
  const req: any = { headers };
  const res: any = { headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; } };
  return { req, res, context: { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as any };
};

function make(valid: Record<string, { keyId: number; clientId: number }>) {
  const resolve = jest.fn(async (fp: string) => valid[fp] ?? null);
  const guard = new ApiKeyGuard({ resolve } as any, new ApiKeyRateLimiter(), new ApiClientRateLimiter());
  return { guard, resolve };
}

describe('ApiKeyGuard', () => {
  const k1 = generateApiKey();
  const k2 = generateApiKey();
  const valid = { [fingerprintApiKey(k1)]: { keyId: 1, clientId: 10 }, [fingerprintApiKey(k2)]: { keyId: 2, clientId: 10 } };

  it('sin cabecera -> 401', async () => {
    const { guard } = make(valid);
    await expect(guard.canActivate(ctx({}).context)).rejects.toMatchObject({ status: 401 });
  });

  it('una clave de otro tipo (kdev_) -> 401 sin consultar la base', async () => {
    const { guard, resolve } = make(valid);
    await expect(guard.canActivate(ctx({ authorization: `Bearer kdev_${'a'.repeat(43)}` }).context)).rejects.toMatchObject({ status: 401 });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('clave válida por X-Api-Key -> pasa y deja el principal en la petición', async () => {
    const { guard } = make(valid);
    const c = ctx({ 'x-api-key': k1 });
    await expect(guard.canActivate(c.context)).resolves.toBe(true);
    expect(c.req.integration).toEqual({ keyId: 1, clientId: 10 });
  });

  it('si llegan las dos, manda Authorization', async () => {
    const { guard } = make(valid);
    await expect(guard.canActivate(ctx({ authorization: `Bearer ${k1}`, 'x-api-key': 'basura' }).context)).resolves.toBe(true);
    await expect(guard.canActivate(ctx({ authorization: 'Basic xyz', 'x-api-key': k1 }).context)).rejects.toMatchObject({ status: 401 });
  });

  it('clave desconocida o revocada -> 401', async () => {
    const { guard } = make(valid);
    await expect(guard.canActivate(ctx({ authorization: `Bearer ${generateApiKey()}` }).context)).rejects.toMatchObject({ status: 401 });
  });

  it(`la petición ${API_MAX_PER_KEY + 1} de la misma clave en la ventana -> 429 con Retry-After`, async () => {
    const { guard } = make(valid);
    for (let i = 0; i < API_MAX_PER_KEY; i++) await guard.canActivate(ctx({ authorization: `Bearer ${k1}` }).context);
    const c = ctx({ authorization: `Bearer ${k1}` });
    await expect(guard.canActivate(c.context)).rejects.toMatchObject({ status: 429, response: { code: 'RATE_LIMITED' } });
    expect(Number(c.res.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it(`dos claves del mismo cliente: la petición ${API_MAX_PER_CLIENT + 1} del cliente -> 429`, async () => {
    const { guard } = make(valid);
    for (let i = 0; i < API_MAX_PER_KEY; i++) await guard.canActivate(ctx({ authorization: `Bearer ${k1}` }).context);
    for (let i = 0; i < API_MAX_PER_CLIENT - API_MAX_PER_KEY; i++) await guard.canActivate(ctx({ 'x-api-key': k2 }).context);
    await expect(guard.canActivate(ctx({ 'x-api-key': k2 }).context)).rejects.toMatchObject({ status: 429 });
  });
});

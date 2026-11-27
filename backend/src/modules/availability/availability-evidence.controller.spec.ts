import { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Readable } from 'stream';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { AvailabilityEvidenceController } from './availability-evidence.controller';
import { AvailabilityEvidenceService } from './availability-evidence.service';

describe('AvailabilityEvidenceController (HTTP)', () => {
  let app: TestHttpApp;
  const service = {
    upload: jest.fn(async () => ({ id: 1 })),
    openFile: jest.fn(async () => ({ fileName: 'señal.txt', mimeType: 'text/plain', sizeBytes: 2, stream: Readable.from(['hi']) })),
    remove: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      controllers: [AvailabilityEvidenceController],
      providers: [{ provide: AvailabilityEvidenceService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: (c: ExecutionContext) => ((c.switchToHttp().getRequest().user = { id: 3, role: 'ADMIN' }), true) })
      .compile();
    app = await startTestHttpApp(ref);
  });
  afterAll(() => app.close());

  const form = (bytes: number) => {
    const fd = new FormData();
    fd.append('origin', 'OFICINA');
    fd.append('file', new Blob([new Uint8Array(bytes)]), 'a.txt');
    return fd;
  };

  it('sube un archivo pequeño y pasa el usuario', async () => {
    const res = await app.raw('/availability/incidents/5/evidence', { method: 'POST', body: form(100) });
    expect(res.status).toBe(201);
    expect(service.upload).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ originalname: 'a.txt', size: 100 }),
      expect.objectContaining({ origin: 'OFICINA' }),
      3,
    );
  });

  it('más de 2 MB da 413 con code PAYLOAD_TOO_LARGE', async () => {
    const res = await app.raw('/availability/incidents/5/evidence', { method: 'POST', body: form(2 * 1024 * 1024 + 1) });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('origen inválido da 400', async () => {
    const fd = form(10);
    fd.set('origin', 'LUNA');
    expect((await app.raw('/availability/incidents/5/evidence', { method: 'POST', body: fd })).status).toBe(400);
  });

  it('la descarga es attachment con nombre saneado', async () => {
    const res = await app.raw('/availability/evidence/1/file', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain("attachment; filename=\"se_al.txt\"; filename*=UTF-8''se%C3%B1al.txt");
    expect(await res.text()).toBe('hi');
  });

  it('borrar exige ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AvailabilityEvidenceController.prototype.remove)).toEqual(['ADMIN']);
  });
});

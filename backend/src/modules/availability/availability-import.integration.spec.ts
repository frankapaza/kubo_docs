import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StaffOnlyGuard } from '../../common/guards/staff-only.guard';
import { startTestHttpApp, TestHttpApp } from '../../test-utils/test-http-app';
import { AvailabilityAgentService } from './availability-agent.service';
import { AvailabilityImportService } from './availability-import.service';
import { AvailabilityInventoryController } from './availability-inventory.controller';
import { AvailabilityInventoryService } from './availability-inventory.service';

describe('POST /availability/import/preview (integración HTTP)', () => {
  let app: TestHttpApp;
  const preview = jest.fn(async () => ({ rows: [], summary: { new: 0, duplicate: 0, invalid: 0 } }));
  const allow = { canActivate: () => true };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AvailabilityInventoryController],
      providers: [
        { provide: AvailabilityInventoryService, useValue: {} },
        { provide: AvailabilityAgentService, useValue: {} },
        { provide: AvailabilityImportService, useValue: { preview } },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(allow)
      .overrideGuard(StaffOnlyGuard).useValue(allow)
      .overrideGuard(RolesGuard).useValue(allow)
      .compile();
    app = await startTestHttpApp(moduleRef);
  });
  afterAll(async () => app?.close());

  it('un CSV de 200 KB (mayor que el límite global de 100 KB) llega al servicio', async () => {
    const res = await app.post('/availability/import/preview', { body: { csv: 'a'.repeat(200 * 1024) } });
    expect(res.status).toBe(200);
    expect(preview).toHaveBeenCalled();
  });

  it('más de 256 KB -> 413', async () => {
    const res = await app.post('/availability/import/preview', { body: { csv: 'a'.repeat(257 * 1024) } });
    expect(res.status).toBe(413);
  });
});

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AvailabilityLatencyController } from './availability-latency.controller';
import { LatencyAlertSettingsDto } from './dto/latency.dto';

describe('AvailabilityLatencyController', () => {
  const workspace = { getLatencyAlertEmails: jest.fn(async () => ['frankapazac@kuboti.com']), setLatencyAlertEmails: jest.fn(async (l: string[]) => l) };
  const hours = { find: jest.fn(async () => [{ serviceId: 3, hourStart: new Date('2026-11-28T18:00:00Z'), total: 60, slow: 2, avgMs: 120, p95Ms: 130, maxMs: 140, thresholdMs: 250, isSlow: false }]) };
  const services = { find: jest.fn(async () => [{ id: 3, serverId: 2, protocol: 'ICMP', name: 'Ping (red)', target: '147.93.146.92', latencyThresholdMs: 250 }]) };
  const c = new AvailabilityLatencyController(workspace as any, hours as any, services as any);

  it('lee y guarda los destinatarios', async () => {
    expect(await c.getSettings()).toEqual({ emails: ['frankapazac@kuboti.com'] });
    expect(await c.putSettings({ emails: ['a@x.pe'] })).toEqual({ emails: ['a@x.pe'] });
    expect(workspace.setLatencyAlertEmails).toHaveBeenCalledWith(['a@x.pe']);
  });

  it('latencia por hora del ping del servidor', async () => {
    const out = await c.serverLatency(2, 7);
    expect(out.service).toMatchObject({ id: 3, target: '147.93.146.92', latencyThresholdMs: 250 });
    expect(out.hours[0]).toMatchObject({ total: 60, slow: 2, avgMs: 120 });
  });

  it('sin ping en el servidor devuelve vacío', async () => {
    services.find.mockResolvedValueOnce([]);
    expect(await c.serverLatency(9, 7)).toEqual({ service: null, hours: [] });
  });

  it('guardar destinatarios exige ADMIN; leer y el gráfico quedan para el personal', () => {
    const proto = AvailabilityLatencyController.prototype as any;
    expect(Reflect.getMetadata(ROLES_KEY, proto.putSettings)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(ROLES_KEY, proto.serverLatency)).toBeUndefined();
  });

  it('el DTO solo acepta correos válidos (máx. 20)', async () => {
    const errs = async (o: object) => (await validate(plainToInstance(LatencyAlertSettingsDto, o))).length;
    expect(await errs({ emails: ['a@x.pe'] })).toBe(0);
    expect(await errs({ emails: [] })).toBe(0);
    expect(await errs({ emails: ['no-es'] })).toBeGreaterThan(0);
    expect(await errs({ emails: Array.from({ length: 21 }, (_, i) => `u${i}@x.pe`) })).toBeGreaterThan(0);
  });
});

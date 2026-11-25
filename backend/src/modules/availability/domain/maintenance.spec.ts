import { activeWindowFor, maintenanceIntervalsFor, MaintenanceWindow } from './maintenance';

const at = (hhmm: string) => new Date(`2026-11-24T${hhmm}:00.000Z`);
const win = (over: Partial<MaintenanceWindow>): MaintenanceWindow => ({
  id: 1,
  serverId: null,
  serviceId: null,
  startsAt: at('10:00'),
  endsAt: at('11:00'),
  reason: 'Parche mensual',
  ...over,
});

describe('activeWindowFor', () => {
  it('una ventana de servidor cubre a un servicio de ese servidor', () => {
    const w = win({ serverId: 10 });
    expect(activeWindowFor({ serviceId: 100, serverId: 10 }, at('10:30'), [w])).toBe(w);
  });

  it('una ventana de servidor no cubre a un servicio de otro servidor', () => {
    expect(activeWindowFor({ serviceId: 100, serverId: 11 }, at('10:30'), [win({ serverId: 10 })])).toBeNull();
  });

  it('una ventana de servicio no cubre a otro servicio', () => {
    expect(activeWindowFor({ serviceId: 101, serverId: 10 }, at('10:30'), [win({ serviceId: 100 })])).toBeNull();
    const w = win({ serviceId: 100 });
    expect(activeWindowFor({ serviceId: 100, serverId: 10 }, at('10:30'), [w])).toBe(w);
  });

  it('incidente de servidor (serviceId nulo): solo cuentan las ventanas del servidor', () => {
    expect(activeWindowFor({ serviceId: null, serverId: 10 }, at('10:30'), [win({ serviceId: 100 })])).toBeNull();
    const w = win({ serverId: 10 });
    expect(activeWindowFor({ serviceId: null, serverId: 10 }, at('10:30'), [w])).toBe(w);
  });

  it('intervalo semiabierto: en startsAt está activa, en endsAt exacto devuelve null', () => {
    const w = win({ serverId: 10 });
    expect(activeWindowFor({ serviceId: 100, serverId: 10 }, at('10:00'), [w])).toBe(w);
    expect(activeWindowFor({ serviceId: 100, serverId: 10 }, at('11:00'), [w])).toBeNull();
    expect(activeWindowFor({ serviceId: 100, serverId: 10 }, at('09:59'), [w])).toBeNull();
  });
});

describe('maintenanceIntervalsFor', () => {
  it('une [10:00,11:00) y [10:30,12:00) en [10:00,12:00) y recorta al rango', () => {
    const windows = [
      win({ id: 1, serverId: 10, startsAt: at('10:00'), endsAt: at('11:00') }),
      win({ id: 2, serviceId: 100, startsAt: at('10:30'), endsAt: at('12:00') }),
    ];
    expect(maintenanceIntervalsFor(100, 10, windows, at('00:00'), at('23:00'))).toEqual([[at('10:00'), at('12:00')]]);
    expect(maintenanceIntervalsFor(100, 10, windows, at('10:15'), at('11:30'))).toEqual([[at('10:15'), at('11:30')]]);
  });

  it('ignora ventanas de otros servicios o servidores y las que caen fuera del rango; ordena las separadas', () => {
    const windows = [
      win({ id: 1, serverId: 10, startsAt: at('15:00'), endsAt: at('16:00') }),
      win({ id: 2, serviceId: 101, startsAt: at('10:00'), endsAt: at('12:00') }),
      win({ id: 3, serverId: 11, startsAt: at('10:00'), endsAt: at('12:00') }),
      win({ id: 4, serviceId: 100, startsAt: at('08:00'), endsAt: at('09:00') }),
      win({ id: 5, serviceId: 100, startsAt: at('01:00'), endsAt: at('02:00') }),
    ];
    expect(maintenanceIntervalsFor(100, 10, windows, at('03:00'), at('23:00'))).toEqual([
      [at('08:00'), at('09:00')],
      [at('15:00'), at('16:00')],
    ]);
  });
});

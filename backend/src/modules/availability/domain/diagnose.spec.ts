import { diagnose, DIAGNOSIS_LABELS } from './diagnose';

describe('diagnose (tabla «Cruce de sondas»)', () => {
  it('oficina confirma y el cruce del servidor falla -> DOWN «Sin respuesta confirmada»', () => {
    expect(diagnose({ reporter: 'OFFICE', crossOk: false, officeOutage: false })).toEqual({
      kind: 'DOWN',
      label: 'Sin respuesta confirmada',
    });
  });

  it('oficina confirma y el cruce del servidor responde -> ROUTE «Sin acceso desde Perú»', () => {
    expect(diagnose({ reporter: 'OFFICE', crossOk: true, officeOutage: false })).toEqual({
      kind: 'ROUTE',
      label: 'Sin acceso desde Perú',
    });
  });

  it('oficina confirma y el cruce no llegó en 2 min -> ROUTE (se reclasifica al llegar)', () => {
    const d = diagnose({ reporter: 'OFFICE', crossOk: null, officeOutage: false });
    expect(d.kind).toBe('ROUTE');
    expect(d.label).toBe(DIAGNOSIS_LABELS.ROUTE_PENDING);
  });

  it('servidor confirma y la oficina falla -> DOWN', () => {
    expect(diagnose({ reporter: 'DATACENTER', crossOk: false, officeOutage: false })).toEqual({
      kind: 'DOWN',
      label: 'Sin respuesta confirmada',
    });
  });

  it('servidor confirma y la oficina responde -> NONE «Problema de la sonda del servidor»', () => {
    expect(diagnose({ reporter: 'DATACENTER', crossOk: true, officeOutage: false })).toEqual({
      kind: 'NONE',
      label: 'Problema de la sonda del servidor',
    });
  });

  it('servidor confirma y la oficina no contestó -> DOWN', () => {
    expect(diagnose({ reporter: 'DATACENTER', crossOk: null, officeOutage: false }).kind).toBe('DOWN');
  });

  it('servidor confirma con caída de oficina -> DOWN aunque el cruce diga que responde', () => {
    expect(diagnose({ reporter: 'DATACENTER', crossOk: true, officeOutage: true }).kind).toBe('DOWN');
    expect(diagnose({ reporter: 'DATACENTER', crossOk: null, officeOutage: true }).kind).toBe('DOWN');
  });
});

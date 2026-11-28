import {
  CATALOG,
  approvedVersion,
  assertTransition,
  assertWorkType,
  catalogEntry,
  nextWorkingVersion,
  nomenclature,
  projectCodeSlug,
  requirementFor,
  versionLabel,
} from './deliverable-catalog';

describe('catálogo del expediente', () => {
  it('trae los 20 entregables, sin códigos repetidos', () => {
    expect(CATALOG).toHaveLength(20);
    expect(new Set(CATALOG.map((e) => e.type)).size).toBe(20);
  });

  it('la obligatoriedad depende del tipo de trabajo', () => {
    const cro = catalogEntry('CRO-PRO')!;
    expect(requirementFor(cro, 'TRADICIONAL')).toBe('O');
    expect(requirementFor(cro, 'AGIL')).toBe('NA');
    const des = catalogEntry('MAN-DES')!;
    expect(requirementFor(des, 'CORRECTIVO')).toBe('O');
    expect(requirementFor(catalogEntry('PRU-FUN')!, 'CORRECTIVO')).toBe('OP');
  });

  it('un correctivo solo pide manual de despliegue y pase a producción', () => {
    const obligatorios = CATALOG.filter((e) => requirementFor(e, 'CORRECTIVO') === 'O').map((e) => e.type);
    expect(obligatorios).toEqual(['MAN-DES', 'SOL-PAP']);
  });

  it('rechaza un tipo de trabajo desconocido', () => {
    expect(() => assertWorkType('SCRUM')).toThrow(/Tipo de trabajo desconocido/);
    expect(assertWorkType('AGIL')).toBe('AGIL');
  });
});

describe('versiones', () => {
  it('una versión de trabajo suma 0.1 y aprobar sube a la siguiente entera', () => {
    expect(nextWorkingVersion({ major: 0, minor: 0 })).toEqual({ major: 0, minor: 1 });
    expect(nextWorkingVersion({ major: 0, minor: 9 })).toEqual({ major: 0, minor: 10 });
    expect(approvedVersion({ major: 0, minor: 3 })).toEqual({ major: 1, minor: 0 });
    expect(approvedVersion({ major: 1, minor: 2 })).toEqual({ major: 2, minor: 0 });
    expect(nextWorkingVersion({ major: 1, minor: 0 })).toEqual({ major: 1, minor: 1 });
  });

  it('sin versión no hay etiqueta', () => {
    expect(versionLabel({ major: 0, minor: 0 })).toBeNull();
    expect(versionLabel({ major: 0, minor: 10 })).toBe('0.10');
  });
});

describe('nomenclatura', () => {
  it('KUBO-{CÓDIGO}-{NNNN}-{TIPO} V{x.y}', () => {
    expect(nomenclature('COB', 7, 'DOC-ANA', { major: 0, minor: 2 })).toBe('KUBO-COB-0007-DOC-ANA V0.2');
    expect(nomenclature('COB', 1, 'ACT-INI', { major: 0, minor: 0 })).toBe('KUBO-COB-0001-ACT-INI Vx.y');
  });

  it('limpia el código del proyecto para que sirva de nombre de archivo', () => {
    expect(projectCodeSlug('cob/añó 2026')).toBe('COB-ANO-2026');
    expect(projectCodeSlug('../..')).toBe('PROY');
    expect(projectCodeSlug('x'.repeat(40))).toHaveLength(20);
  });
});

describe('transiciones', () => {
  it('permite el ciclo borrador → revisión → aprobado → firmado', () => {
    expect(() => assertTransition('PENDIENTE', 'UPLOAD')).not.toThrow();
    expect(() => assertTransition('BORRADOR', 'SUBMIT')).not.toThrow();
    expect(() => assertTransition('EN_REVISION', 'OBSERVE')).not.toThrow();
    expect(() => assertTransition('EN_REVISION', 'APPROVE')).not.toThrow();
    expect(() => assertTransition('APROBADO', 'SIGN')).not.toThrow();
    expect(() => assertTransition('FIRMADO', 'UPLOAD')).not.toThrow();
  });

  it('rechaza saltos que no tienen sentido', () => {
    expect(() => assertTransition('PENDIENTE', 'APPROVE')).toThrow(/No se puede aprobar un entregable en estado «Pendiente»/);
    expect(() => assertTransition('BORRADOR', 'SIGN')).toThrow();
    expect(() => assertTransition('NO_APLICA', 'UPLOAD')).toThrow();
    expect(() => assertTransition('BORRADOR', 'NOT_APPLICABLE')).toThrow();
    expect(() => assertTransition('PENDIENTE', 'REOPEN')).toThrow();
  });
});

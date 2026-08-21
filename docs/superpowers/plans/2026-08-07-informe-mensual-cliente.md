# Informe mensual descargable por el cliente — Plan de implementación

> **Para trabajadores agénticos:** SUB-HABILIDAD REQUERIDA: usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Goal:** Que cualquier usuario de una empresa cliente pueda descargar, de un mes ya terminado, un documento con sus tickets y sus requerimientos, y si se cumplieron los plazos comprometidos.

**Architecture:** Todo el cálculo vive en un módulo **puro** sin base de datos ni inyección, que recibe filas y devuelve el informe. Un servicio del portal valida la sesión y el periodo, lee las filas con consultas acotadas por empresa, y delega. El navegador dibuja el PDF y el CSV a partir del JSON, reutilizando el patrón que ya funciona en `MonthlyReportPage`.

**Tech Stack:** NestJS 10 · TypeORM 0.3 (`synchronize: false`) · MySQL 8 · Jest 29 · React 18 + Vite + TypeScript + Tailwind · jspdf + jspdf-autotable

**Spec:** `docs/superpowers/specs/2026-08-07-informe-mensual-cliente-design.md`

## Global Constraints

- **Nunca decidir por la ausencia de un valor** en lugar de por el hecho que lo determina. Es el defecto que más veces ha reaparecido en este proyecto. Aquí se materializa en el veredicto de **tres** valores: `CUMPLIDO`, `INCUMPLIDO`, `SIN_COMPROMISO`.
- **Los `SIN_COMPROMISO` se excluyen del denominador** de todo porcentaje de cumplimiento.
- **404, nunca 403**, para recursos de otra empresa, con cuerpo idéntico al de uno inexistente.
- **Proyección campo a campo** para todo lo que ve un cliente. Nunca *spread* menos claves.
- **Escrituras transaccionales** con `runInTransaction` — no aplica aquí: este proyecto **solo lee**.
- TypeORM devuelve las columnas `bigint` **como cadenas**. Nunca comparar identificadores con `===`; usar `sameId` de `backend/src/common/ids.ts`.
- **Ninguna ruta del portal acepta `clientId`**: el único que existe es el del token verificado.
- Cuerpos de error con la forma `{ code, message }`, mensaje en español dirigido a una persona, **sin nombres internos de propiedad** (`portal-validation.integration.spec.ts` lo vigila con dos listas negras).
- **Las fronteras del periodo se calculan en hora de Perú**, nunca en la del proceso. Producción corre en UTC.
- Comentarios en español, que expliquen el porqué y no el qué.
- Ninguna prueba debe consagrar un comportamiento equivocado.

## Estructura de ficheros

**Backend — se crean:**
- `backend/src/common/peru-month.ts` — fronteras del mes en hora de Perú, y si un mes ya cerró. Puro.
- `backend/src/common/peru-month.spec.ts`
- `backend/src/modules/portal/domain/monthly-report.ts` — veredictos, totales y porcentajes. Puro.
- `backend/src/modules/portal/domain/monthly-report.spec.ts`
- `backend/src/modules/portal/portal-reports.service.ts`
- `backend/src/modules/portal/portal-reports.service.spec.ts`
- `backend/src/modules/portal/portal-reports.controller.ts`
- `backend/src/modules/portal/dto/monthly-report.dto.ts` — la petición y la vista publicada.

**Backend — se modifican:**
- `backend/src/modules/tickets/tickets.repository.ts` — dos consultas nuevas, acotadas.
- `backend/src/modules/tickets/tickets.repository.spec.ts` — **crear si no existe**, con el patrón de `work-items.repository.spec.ts`.
- `backend/src/modules/work-items/work-items.repository.ts` — una consulta nueva.
- `backend/src/modules/work-items/work-items.repository.spec.ts`
- `backend/src/modules/portal/portal.module.ts`

**Web — se crean:**
- `web/src/pages/portal/PortalMonthlyReportPage.tsx`
- `web/src/pages/portal/monthly-report-download.ts` — PDF y CSV, aparte de la pantalla.

**Web — se modifican:**
- `web/src/api/portal.api.ts`, `web/src/api/types.ts`, `web/src/App.tsx`, `web/src/layout/PortalLayout.tsx`

---

### Task 1: El mes, en hora de Perú

**Files:**
- Create: `backend/src/common/peru-month.ts`
- Test: `backend/src/common/peru-month.spec.ts`

**Interfaces:**
- Consumes: `PERU_TIME_ZONE` de `backend/src/common/time-zone.ts`.
- Produces:
  - `export const PERU_UTC_OFFSET_MINUTES = -300`
  - `export function peruMonthBounds(year: number, month: number): { from: Date; to: Date }` — `month` va de 1 a 12. `from` es el instante UTC de la medianoche civil del día 1; `to` es el de la medianoche civil del día 1 del mes siguiente. El intervalo es **`[from, to)`**: cerrado por abajo, abierto por arriba.
  - `export function isPeruMonthClosed(year: number, month: number, now: Date): boolean`

Contexto: Perú (`America/Lima`) es **UTC−5 fijo y sin horario de verano** desde 1994. El código se apoya en ese hecho para no arrastrar una librería de zonas horarias, y una prueba lo verifica contra los datos reales del sistema: si algún día deja de ser cierto, esa prueba falla en voz alta en vez de desplazar el informe en silencio.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
import { peruMonthBounds, isPeruMonthClosed, PERU_UTC_OFFSET_MINUTES } from './peru-month';
import { PERU_TIME_ZONE } from './time-zone';

describe('peruMonthBounds', () => {
  it('empieza a medianoche civil de Lima, que son las 05:00 UTC', () => {
    const { from, to } = peruMonthBounds(2026, 8);
    expect(from.toISOString()).toBe('2026-08-01T05:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-01T05:00:00.000Z');
  });

  it('cruza bien el fin de año', () => {
    const { from, to } = peruMonthBounds(2026, 12);
    expect(from.toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(to.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });

  // La razón de ser de este módulo: en UTC, las 20:00 del último día del mes
  // en Lima ya son el día 1 del mes siguiente. Sin esto, al cliente le
  // desaparecería del informe algo que él vivió dentro del mes.
  it('las 20:00 del ultimo dia en Lima pertenecen a ese mes', () => {
    const { from, to } = peruMonthBounds(2026, 8);
    const ultimoDiaTarde = new Date('2026-09-01T01:00:00.000Z'); // 31/08 20:00 en Lima
    expect(ultimoDiaTarde >= from && ultimoDiaTarde < to).toBe(true);
  });

  it('rechaza un mes fuera de rango', () => {
    expect(() => peruMonthBounds(2026, 0)).toThrow();
    expect(() => peruMonthBounds(2026, 13)).toThrow();
  });
});

describe('isPeruMonthClosed', () => {
  it('un mes anterior esta cerrado', () => {
    expect(isPeruMonthClosed(2026, 7, new Date('2026-08-07T12:00:00Z'))).toBe(true);
  });

  it('el mes en curso no esta cerrado', () => {
    expect(isPeruMonthClosed(2026, 8, new Date('2026-08-07T12:00:00Z'))).toBe(false);
  });

  it('un mes futuro no esta cerrado', () => {
    expect(isPeruMonthClosed(2026, 12, new Date('2026-08-07T12:00:00Z'))).toBe(false);
  });

  // El instante exacto del cambio: 00:00 del dia 1 en Lima = 05:00 UTC.
  it('agosto cierra a las 05:00 UTC del 1 de septiembre, ni un minuto antes', () => {
    expect(isPeruMonthClosed(2026, 8, new Date('2026-09-01T04:59:59Z'))).toBe(false);
    expect(isPeruMonthClosed(2026, 8, new Date('2026-09-01T05:00:00Z'))).toBe(true);
  });
});

describe('el supuesto de que Peru no cambia la hora', () => {
  // Esta prueba no comprueba nuestro codigo: comprueba el HECHO en el que se
  // apoya. Si Peru adoptara horario de verano, o si cambiaran los datos de
  // zonas del sistema, `peruMonthBounds` empezaria a desplazar los informes
  // en silencio. Preferimos que falle aqui, en voz alta.
  it.each([1, 4, 7, 10])('el desfase es de -300 minutos tambien en el mes %i', (mes) => {
    const instante = new Date(Date.UTC(2026, mes - 1, 15, 12, 0, 0));
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: PERU_TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(instante);
    const v = (t: string) => Number(partes.find((p) => p.type === t)!.value);
    const comoSiFueraUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
    expect((comoSiFueraUtc - instante.getTime()) / 60000).toBe(PERU_UTC_OFFSET_MINUTES);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `cd backend && npx jest src/common/peru-month.spec.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```ts
import { BadRequestException } from '@nestjs/common';

/**
 * Desfase fijo de Perú respecto a UTC, en minutos.
 *
 * Perú no aplica horario de verano desde 1994, así que el desfase es
 * constante y se puede escribir. Es lo que permite calcular las fronteras de
 * un mes con aritmética simple, sin arrastrar una librería de zonas.
 *
 * El supuesto no se da por bueno a ciegas: `peru-month.spec.ts` lo verifica
 * contra los datos de zonas del sistema en cuatro meses del año. Si el día de
 * mañana dejara de ser cierto, esa prueba se pone roja — que es infinitamente
 * mejor que un informe desplazado cinco horas que nadie nota.
 */
export const PERU_UTC_OFFSET_MINUTES = -300;

const MINUTO = 60_000;

/**
 * Instante UTC en el que empieza y termina un mes **civil peruano**.
 *
 * Intervalo `[from, to)`: incluye el primer instante del mes y excluye el
 * primero del siguiente. Media noche pertenece al día que empieza, no al que
 * acaba, y así ningún registro cae en dos meses ni en ninguno.
 *
 * Producción corre en UTC, así que hacer esto con `new Date(year, month, 1)`
 * —que usa la zona del proceso— metería en septiembre todo lo ocurrido en
 * Lima después de las 19:00 del 31 de agosto.
 */
export function peruMonthBounds(year: number, month: number): { from: Date; to: Date } {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: 'El mes debe estar entre 1 y 12.',
    });
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: 'El año del informe no es válido.',
    });
  }

  // `Date.UTC` con el mes 12 rueda solo al enero siguiente, así que el cambio
  // de año no necesita un caso aparte.
  const inicioCivil = Date.UTC(year, month - 1, 1);
  const siguienteCivil = Date.UTC(year, month, 1);

  // Restar el desfase convierte la medianoche civil de Lima en su instante UTC:
  // 00:00 en Lima (UTC-5) son las 05:00 UTC.
  return {
    from: new Date(inicioCivil - PERU_UTC_OFFSET_MINUTES * MINUTO),
    to: new Date(siguienteCivil - PERU_UTC_OFFSET_MINUTES * MINUTO),
  };
}

/**
 * Si el mes ya terminó del todo en hora de Perú.
 *
 * Se compara contra el final del intervalo, no contra el mes en curso del
 * calendario: así el mes en curso y cualquiera futuro dan lo mismo —falso— sin
 * necesitar dos comprobaciones distintas.
 */
export function isPeruMonthClosed(year: number, month: number, now: Date): boolean {
  return now.getTime() >= peruMonthBounds(year, month).to.getTime();
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `cd backend && npx jest src/common/peru-month.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/common/peru-month.ts backend/src/common/peru-month.spec.ts
git commit -m "feat(informe): fronteras del mes en hora de Peru"
```

---

### Task 2: Los veredictos de cumplimiento

**Files:**
- Create: `backend/src/modules/portal/domain/monthly-report.ts`
- Test: `backend/src/modules/portal/domain/monthly-report.spec.ts`

**Interfaces:**
- Consumes: nada. Módulo puro.
- Produces:
  - `export type Compliance = 'CUMPLIDO' | 'INCUMPLIDO' | 'SIN_COMPROMISO'`
  - `export function judgeDeadline(dueAt: Date | null, doneAt: Date | null, periodEnd: Date): Compliance`
  - `export function judgeCommitment(committedDate: string | null, deliveredAt: Date | null, periodEnd: Date): Compliance`
  - `export function compliancePercent(items: Compliance[]): number | null`

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
import { judgeDeadline, judgeCommitment, compliancePercent } from './monthly-report';

const FIN = new Date('2026-09-01T05:00:00Z'); // fin de agosto en hora de Perú

describe('judgeDeadline', () => {
  it('hecho antes del plazo es CUMPLIDO', () => {
    expect(judgeDeadline(new Date('2026-08-10T12:00:00Z'), new Date('2026-08-10T11:00:00Z'), FIN))
      .toBe('CUMPLIDO');
  });

  it('hecho justo en el plazo es CUMPLIDO: el limite es inclusivo', () => {
    const t = new Date('2026-08-10T12:00:00Z');
    expect(judgeDeadline(t, t, FIN)).toBe('CUMPLIDO');
  });

  it('hecho despues del plazo es INCUMPLIDO', () => {
    expect(judgeDeadline(new Date('2026-08-10T12:00:00Z'), new Date('2026-08-10T13:00:00Z'), FIN))
      .toBe('INCUMPLIDO');
  });

  it('sin hacer y con el plazo vencido dentro del periodo es INCUMPLIDO', () => {
    expect(judgeDeadline(new Date('2026-08-10T12:00:00Z'), null, FIN)).toBe('INCUMPLIDO');
  });

  // El corazon de este modulo. Sin plazo no hubo promesa: contarlo como
  // incumplido acusaria de romper algo que nunca se prometio, y como cumplido
  // inflaria el porcentaje con casos que nadie midio.
  it('sin plazo es SIN_COMPROMISO, este hecho o no', () => {
    expect(judgeDeadline(null, null, FIN)).toBe('SIN_COMPROMISO');
    expect(judgeDeadline(null, new Date('2026-08-10T12:00:00Z'), FIN)).toBe('SIN_COMPROMISO');
  });
});

describe('judgeCommitment', () => {
  it('entregado antes de la fecha comprometida es CUMPLIDO', () => {
    expect(judgeCommitment('2026-08-20', new Date('2026-08-18T15:00:00Z'), FIN)).toBe('CUMPLIDO');
  });

  // Se compara por fecha civil, no por instante: la fecha comprometida es un
  // dia entero, no un momento. Entregar a las 22:00 de ese dia cumple.
  it('entregado el mismo dia comprometido es CUMPLIDO, a cualquier hora', () => {
    expect(judgeCommitment('2026-08-20', new Date('2026-08-21T02:00:00Z'), FIN)).toBe('CUMPLIDO');
  });

  it('entregado al dia siguiente es INCUMPLIDO', () => {
    expect(judgeCommitment('2026-08-20', new Date('2026-08-22T02:00:00Z'), FIN)).toBe('INCUMPLIDO');
  });

  it('sin entregar y con la fecha ya pasada es INCUMPLIDO', () => {
    expect(judgeCommitment('2026-08-20', null, FIN)).toBe('INCUMPLIDO');
  });

  it('sin fecha comprometida es SIN_COMPROMISO', () => {
    expect(judgeCommitment(null, null, FIN)).toBe('SIN_COMPROMISO');
    expect(judgeCommitment(null, new Date('2026-08-18T15:00:00Z'), FIN)).toBe('SIN_COMPROMISO');
  });
});

describe('compliancePercent', () => {
  // La regla que hace honesto el numero: los sin compromiso no cuentan abajo.
  it('excluye los SIN_COMPROMISO del denominador', () => {
    expect(compliancePercent(['CUMPLIDO', 'INCUMPLIDO', 'SIN_COMPROMISO', 'SIN_COMPROMISO']))
      .toBe(50);
  });

  it('redondea a entero', () => {
    expect(compliancePercent(['CUMPLIDO', 'CUMPLIDO', 'INCUMPLIDO'])).toBe(67);
  });

  // Dividir entre cero es el error mas probable de este calculo, y un NaN en
  // un PDF que ve un cliente es peor que un hueco.
  it('devuelve null si no hubo ningun compromiso que medir', () => {
    expect(compliancePercent([])).toBeNull();
    expect(compliancePercent(['SIN_COMPROMISO', 'SIN_COMPROMISO'])).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `cd backend && npx jest src/modules/portal/domain/monthly-report.spec.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```ts
import { PERU_TIME_ZONE } from '../../../common/time-zone';

/**
 * Tres valores, no dos.
 *
 * `SIN_COMPROMISO` no es un adorno: es la diferencia entre «no cumplimos» y
 * «no habíamos prometido nada». Colapsarlo en cualquiera de los otros dos
 * miente, y es la forma que toma en este informe el defecto que más veces ha
 * reaparecido en el proyecto: decidir por la ausencia de un valor en lugar de
 * por el hecho que lo determina.
 */
export type Compliance = 'CUMPLIDO' | 'INCUMPLIDO' | 'SIN_COMPROMISO';

/**
 * Veredicto sobre un plazo con hora — los dos del SLA de un ticket.
 *
 * `dueAt` ya viene con las pausas absorbidas: `SlaService` desplaza el
 * vencimiento al reanudar un ticket que estuvo en espera del cliente. Restar
 * aquí el tiempo en pausa lo descontaría dos veces.
 *
 * `periodEnd` existe para juzgar lo que quedó sin hacer: en un mes ya cerrado
 * no hay «pendiente de juicio». Si el plazo venció y nadie lo atendió, es
 * incumplido, y da igual que se atienda mañana.
 */
export function judgeDeadline(
  dueAt: Date | null,
  doneAt: Date | null,
  periodEnd: Date,
): Compliance {
  if (!dueAt) return 'SIN_COMPROMISO';
  if (doneAt) return doneAt.getTime() <= dueAt.getTime() ? 'CUMPLIDO' : 'INCUMPLIDO';
  return dueAt.getTime() < periodEnd.getTime() ? 'INCUMPLIDO' : 'SIN_COMPROMISO';
}

/** Fecha civil `YYYY-MM-DD` de un instante, en hora de Perú. */
function peruCivilDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PERU_TIME_ZONE }).format(instant);
}

/**
 * Veredicto sobre una fecha comprometida — la de un requerimiento.
 *
 * Se compara **por fecha civil y no por instante**, porque lo que se le
 * prometió al cliente fue un día entero: entregar a las 22:00 de ese día
 * cumple. Comparar instantes convertiría la promesa en «antes de medianoche
 * UTC», que son las 19:00 en Lima y nadie prometió eso.
 */
export function judgeCommitment(
  committedDate: string | null,
  deliveredAt: Date | null,
  periodEnd: Date,
): Compliance {
  if (!committedDate) return 'SIN_COMPROMISO';
  if (deliveredAt) {
    return peruCivilDate(deliveredAt) <= committedDate ? 'CUMPLIDO' : 'INCUMPLIDO';
  }
  return committedDate < peruCivilDate(periodEnd) ? 'INCUMPLIDO' : 'SIN_COMPROMISO';
}

/**
 * Porcentaje de cumplimiento, o `null` si no hubo nada que medir.
 *
 * Los `SIN_COMPROMISO` **se excluyen del denominador**. Meterlos abajo
 * castigaría al proveedor por trabajo sobre el que nunca se pactó un plazo, y
 * el número dejaría de significar lo que su etiqueta dice.
 *
 * Devuelve `null` y no `0` cuando no hay denominador: un cero se lee como «no
 * cumplieron nada», y lo cierto es «no había nada que cumplir». Quien pinte
 * esto debe escribir un guion, no un número.
 */
export function compliancePercent(items: Compliance[]): number | null {
  const medibles = items.filter((c) => c !== 'SIN_COMPROMISO');
  if (medibles.length === 0) return null;
  const cumplidos = medibles.filter((c) => c === 'CUMPLIDO').length;
  return Math.round((cumplidos / medibles.length) * 100);
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `cd backend && npx jest src/modules/portal/domain/monthly-report.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/portal/domain/
git commit -m "feat(informe): veredictos de cumplimiento con tres valores"
```

---

### Task 3: El informe completo, calculado

**Files:**
- Modify: `backend/src/modules/portal/domain/monthly-report.ts`
- Test: `backend/src/modules/portal/domain/monthly-report.spec.ts`

**Interfaces:**
- Consumes: `judgeDeadline`, `judgeCommitment`, `compliancePercent` de la tarea 2.
- Produces:

```ts
export interface ReportTicketRow {
  id: number; code: string | null; subject: string | null;
  category: string | null; priority: string; status: string;
  capturedAt: Date; firstResponseAt: Date | null; resolvedAt: Date | null;
  slaResponseDueAt: Date | null; slaResolutionDueAt: Date | null;
}
export interface ReportRequirementRow {
  id: number; code: string | null; title: string; status: string;
  createdAt: Date; dueDate: string | null; closedAt: Date | null;
}
export interface BuildReportInput {
  periodStart: Date; periodEnd: Date;
  tickets: ReportTicketRow[] | null;          // null = no se pidió el bloque
  ticketsResolvedInPeriod: number | null;
  requirements: ReportRequirementRow[] | null;
}
export function buildMonthlyReport(input: BuildReportInput): MonthlyReportBody
```

`MonthlyReportBody` tiene `tickets: TicketsBlock | null` y `requirements: RequirementsBlock | null`, cada bloque con `rows` y `totals`. Un bloque que no se pidió es `null`, **no un bloque vacío**: la diferencia entre «no lo pediste» y «no hubo nada» debe sobrevivir hasta el documento.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
import { buildMonthlyReport, ReportTicketRow } from './monthly-report';

const INICIO = new Date('2026-08-01T05:00:00Z');
const FIN = new Date('2026-09-01T05:00:00Z');

function ticket(p: Partial<ReportTicketRow> = {}): ReportTicketRow {
  return {
    id: 1, code: 'TK-0001', subject: 'Algo falla', category: 'SOPORTE',
    priority: 'P3', status: 'RESUELTO',
    capturedAt: new Date('2026-08-05T14:00:00Z'),
    firstResponseAt: new Date('2026-08-05T14:30:00Z'),
    resolvedAt: new Date('2026-08-05T18:00:00Z'),
    slaResponseDueAt: new Date('2026-08-05T15:00:00Z'),
    slaResolutionDueAt: new Date('2026-08-06T14:00:00Z'),
    ...p,
  };
}

describe('buildMonthlyReport', () => {
  it('un bloque no pedido queda en null, no en un bloque vacio', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN,
      tickets: [ticket()], ticketsResolvedInPeriod: 1, requirements: null,
    });
    expect(r.requirements).toBeNull();
    expect(r.tickets).not.toBeNull();
  });

  it('cuenta recibidos, resueltos y pendientes de los del periodo', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN,
      tickets: [
        ticket({ id: 1, status: 'RESUELTO' }),
        ticket({ id: 2, status: 'CERRADO' }),
        ticket({ id: 3, status: 'EN_ATENCION', resolvedAt: null }),
      ],
      ticketsResolvedInPeriod: 5, requirements: null,
    });
    expect(r.tickets!.totals.received).toBe(3);
    expect(r.tickets!.totals.resolved).toBe(2);
    expect(r.tickets!.totals.pending).toBe(1);
  });

  // La cifra que mas confunde a quien lee el documento, y por eso lleva su
  // propio criterio impreso: son conjuntos distintos, no la misma cuenta.
  it('«resueltos dentro del periodo» es una cifra aparte de «resueltos»', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN,
      tickets: [ticket({ id: 1 })], ticketsResolvedInPeriod: 7, requirements: null,
    });
    expect(r.tickets!.totals.resolved).toBe(1);
    expect(r.tickets!.totals.resolvedInPeriod).toBe(7);
  });

  it('los tickets sin SLA no bajan el porcentaje', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN,
      tickets: [
        ticket({ id: 1 }),                                            // cumple los dos
        ticket({ id: 2, slaResponseDueAt: null, slaResolutionDueAt: null }),
      ],
      ticketsResolvedInPeriod: 2, requirements: null,
    });
    expect(r.tickets!.totals.responseCompliancePercent).toBe(100);
    expect(r.tickets!.totals.resolutionCompliancePercent).toBe(100);
    expect(r.tickets!.totals.withoutCommitment).toBe(1);
  });

  it('un periodo vacio da ceros y porcentajes nulos, nunca NaN', () => {
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN,
      tickets: [], ticketsResolvedInPeriod: 0, requirements: [],
    });
    expect(r.tickets!.totals.received).toBe(0);
    expect(r.tickets!.totals.responseCompliancePercent).toBeNull();
    expect(r.requirements!.totals.commitmentCompliancePercent).toBeNull();
    expect(Number.isNaN(r.tickets!.totals.responseCompliancePercent as number)).toBe(false);
  });

  it('cuenta los requerimientos por estado', () => {
    const base = { createdAt: new Date('2026-08-03T12:00:00Z'), dueDate: null, closedAt: null };
    const r = buildMonthlyReport({
      periodStart: INICIO, periodEnd: FIN, tickets: null, ticketsResolvedInPeriod: null,
      requirements: [
        { id: 1, code: 'RQ-0001', title: 'a', status: 'SOLICITADO', ...base },
        { id: 2, code: 'RQ-0002', title: 'b', status: 'PENDIENTE', ...base, dueDate: '2026-09-30' },
        { id: 3, code: 'RQ-0003', title: 'c', status: 'CERRADO', ...base,
          dueDate: '2026-08-20', closedAt: new Date('2026-08-19T12:00:00Z') },
        { id: 4, code: 'RQ-0004', title: 'd', status: 'RECHAZADO', ...base },
      ],
    });
    expect(r.requirements!.totals.requested).toBe(4);
    expect(r.requirements!.totals.accepted).toBe(2);   // PENDIENTE y CERRADO
    expect(r.requirements!.totals.delivered).toBe(1);
    expect(r.requirements!.totals.rejected).toBe(1);
    expect(r.requirements!.totals.commitmentCompliancePercent).toBe(100); // solo el entregado mide
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `cd backend && npx jest src/modules/portal/domain/monthly-report.spec.ts`
Expected: FAIL — `buildMonthlyReport` no existe.

- [ ] **Step 3: Implementar**

Añade al mismo fichero los tipos del bloque de interfaces y la función. Puntos que debe respetar:

```ts
/** Estados que cuentan como resuelto en el modelo de tickets. */
const TICKET_RESUELTO = new Set(['RESUELTO', 'CERRADO']);

/** Un requerimiento aceptado es el que ya salió de SOLICITADO sin ser rechazado. */
const REQ_NO_ACEPTADO = new Set(['SOLICITADO', 'RECHAZADO']);

export function buildMonthlyReport(input: BuildReportInput): MonthlyReportBody {
  return {
    // `null` y no un bloque vacío: «no lo pediste» y «no hubo nada» son cosas
    // distintas, y quien dibuje el documento tiene que poder distinguirlas.
    tickets: input.tickets === null ? null : buildTicketsBlock(input),
    requirements: input.requirements === null ? null : buildRequirementsBlock(input),
  };
}
```

`buildTicketsBlock` calcula por cada fila `responseCompliance = judgeDeadline(slaResponseDueAt, firstResponseAt, periodEnd)` y `resolutionCompliance = judgeDeadline(slaResolutionDueAt, resolvedAt, periodEnd)`, y los totales:
- `received` = número de filas
- `resolved` = filas con `TICKET_RESUELTO.has(status)`
- `pending` = `received - resolved`
- `resolvedInPeriod` = `input.ticketsResolvedInPeriod ?? 0`
- `responseCompliancePercent` y `resolutionCompliancePercent` con `compliancePercent`
- `withoutCommitment` = filas cuyo `resolutionCompliance` es `SIN_COMPROMISO`

`buildRequirementsBlock` calcula por fila `commitment = judgeCommitment(dueDate, closedAt, periodEnd)` y:
- `requested` = número de filas
- `accepted` = filas con `!REQ_NO_ACEPTADO.has(status)`
- `delivered` = filas con `status === 'CERRADO'`
- `rejected` = filas con `status === 'RECHAZADO'`
- `commitmentCompliancePercent` con `compliancePercent`

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `cd backend && npx jest src/modules/portal/domain/monthly-report.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/portal/domain/
git commit -m "feat(informe): calculo del informe mensual, con los dos bloques"
```

---

### Task 4: Las tres consultas, acotadas por empresa

**Files:**
- Modify: `backend/src/modules/tickets/tickets.repository.ts`
- Create: `backend/src/modules/tickets/tickets.repository.spec.ts`
- Modify: `backend/src/modules/work-items/work-items.repository.ts`
- Modify: `backend/src/modules/work-items/work-items.repository.spec.ts`

**Interfaces:**
- Produces:
  - `TicketsRepository.listForClientPeriod(clientId: number, from: Date, to: Date): Promise<Ticket[]>`
  - `TicketsRepository.countResolvedInPeriod(clientId: number, from: Date, to: Date): Promise<number>`
  - `WorkItemsRepository.listPortalRequirementsInPeriod(clientId: number, from: Date, to: Date): Promise<WorkItem[]>`

Contexto crítico: `TicketsRepository.list` monta el filtro de empresa con `if (filters.clientId)`, así que un valor falsy **hace desaparecer el `WHERE`** y devuelve tickets de todas las empresas. Ese repositorio lo comparte el panel interno, donde «sin filtro» es legítimo. **No lo reutilices**: escribe métodos nuevos con `where` fijo, como ya se hizo en `WorkItemsRepository` para el portal.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `tickets.repository.spec.ts` con el patrón de `work-items.repository.spec.ts`: instancia el repositorio real con dobles del `Repository` de TypeORM y afirma sobre los argumentos.

```ts
it('listForClientPeriod acota por empresa y por el intervalo [from, to)', async () => {
  const { repo, typeormRepo } = make();
  const from = new Date('2026-08-01T05:00:00Z');
  const to = new Date('2026-09-01T05:00:00Z');
  await repo.listForClientPeriod(7, from, to);
  expect(typeormRepo.find).toHaveBeenCalledWith({
    where: { clientId: 7, capturedAt: expect.anything() },
    order: { capturedAt: 'ASC', id: 'ASC' },
  });
  // El operador de rango se comprueba aparte, por su forma:
  const arg = typeormRepo.find.mock.calls[0][0];
  expect(String(arg.where.capturedAt)).toContain('2026-08-01T05:00:00');
  expect(String(arg.where.capturedAt)).toContain('2026-09-01T05:00:00');
});

it('countResolvedInPeriod cuenta por fecha de resolucion, no de alta', async () => {
  const { repo, typeormRepo } = make();
  await repo.countResolvedInPeriod(7, new Date('2026-08-01T05:00:00Z'), new Date('2026-09-01T05:00:00Z'));
  const arg = typeormRepo.count.mock.calls[0][0];
  expect(arg.where.clientId).toBe(7);
  expect(arg.where.resolvedAt).toBeDefined();
  expect(arg.where.capturedAt).toBeUndefined();
});
```

Y en `work-items.repository.spec.ts`, junto a las que ya hay:

```ts
it('listPortalRequirementsInPeriod lleva empresa, origen y rango', async () => {
  const { repo, typeormRepo } = make();
  await repo.listPortalRequirementsInPeriod(7, new Date('2026-08-01T05:00:00Z'), new Date('2026-09-01T05:00:00Z'));
  const arg = typeormRepo.find.mock.calls[0][0];
  expect(arg.where.clientId).toBe(7);
  expect(arg.where.origin).toBe('PORTAL');
  expect(arg.where.createdAt).toBeDefined();
});
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `cd backend && npx jest src/modules/tickets/tickets.repository.spec.ts src/modules/work-items/work-items.repository.spec.ts`
Expected: FAIL — los métodos no existen.

- [ ] **Step 3: Implementar**

Usa `Between` de TypeORM para el rango. **Cuidado**: `Between` es inclusivo por los dos extremos y el intervalo debe ser `[from, to)`. Usa en su lugar `And(MoreThanOrEqual(from), LessThan(to))` — `And` existe en TypeORM 0.3. Si no estuviera disponible, usa `Raw` con los dos operadores; lo que **no** vale es `Between`, porque metería en agosto lo ocurrido en el primer instante de septiembre y ese registro aparecería en dos informes.

```ts
/**
 * Los tickets que esa empresa abrió dentro del periodo.
 *
 * Método propio y no `list(filters)`: aquel monta el filtro de empresa con
 * `if (filters.clientId)`, así que un valor falsy haría desaparecer el WHERE y
 * devolvería tickets de todas las empresas. Aquí el `where` es fijo.
 *
 * Intervalo `[from, to)`, abierto por arriba: con `Between`, un ticket creado
 * en el primer instante de septiembre saldría en el informe de agosto **y** en
 * el de septiembre.
 */
listForClientPeriod(clientId: number, from: Date, to: Date): Promise<Ticket[]> {
  return this.repo.find({
    where: { clientId, capturedAt: And(MoreThanOrEqual(from), LessThan(to)) },
    order: { capturedAt: 'ASC', id: 'ASC' },
  });
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `cd backend && npx jest src/modules/tickets src/modules/work-items`
Expected: PASS, sin romper nada de lo que ya había.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tickets/ backend/src/modules/work-items/
git commit -m "feat(informe): consultas del periodo acotadas por empresa"
```

---

### Task 5: El servicio del portal

**Files:**
- Create: `backend/src/modules/portal/portal-reports.service.ts`
- Create: `backend/src/modules/portal/dto/monthly-report.dto.ts`
- Test: `backend/src/modules/portal/portal-reports.service.spec.ts`

**Interfaces:**
- Consumes: `peruMonthBounds`, `isPeruMonthClosed` (tarea 1), `buildMonthlyReport` (tarea 3), los tres métodos de repositorio (tarea 4), `assertSessionScope` de `../session-scope`.
- Produces: `PortalReportsService.monthly(clientId: number, dto: MonthlyReportQueryDto): Promise<MonthlyReportView>`

- [ ] **Step 1: Escribir el DTO de petición**

```ts
import { IsIn, IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const REPORT_SCOPES = ['TICKETS', 'REQUERIMIENTOS', 'AMBOS'] as const;
export type ReportScope = (typeof REPORT_SCOPES)[number];

export class MonthlyReportQueryDto {
  @Type(() => Number)
  @IsInt({ message: 'El año del informe no es válido.' })
  @Min(2000, { message: 'El año del informe no es válido.' })
  @Max(2100, { message: 'El año del informe no es válido.' })
  year!: number;

  @Type(() => Number)
  @IsInt({ message: 'El mes debe estar entre 1 y 12.' })
  @Min(1, { message: 'El mes debe estar entre 1 y 12.' })
  @Max(12, { message: 'El mes debe estar entre 1 y 12.' })
  month!: number;

  @IsIn(REPORT_SCOPES, { message: 'El alcance debe ser tickets, requerimientos o ambos.' })
  scope!: ReportScope;
}
```

Los mensajes van en español y sin nombres internos de propiedad, porque `portal-validation.integration.spec.ts` lo vigila.

- [ ] **Step 2: Escribir las pruebas que fallan**

```ts
describe('PortalReportsService.monthly', () => {
  it('rechaza el mes en curso', async () => {
    const { service } = make({ ahora: new Date('2026-08-07T12:00:00Z') });
    await expect(service.monthly(7, { year: 2026, month: 8, scope: 'AMBOS' }))
      .rejects.toThrow(/ya termin/i);
  });

  it('rechaza una sesion sin empresa utilizable', async () => {
    const { service } = make({});
    await expect(service.monthly(0, { year: 2026, month: 7, scope: 'AMBOS' }))
      .rejects.toThrow(/no identifica a ninguna empresa/i);
  });

  // Que el bloque no pedido no se consulte no es una optimizacion: es que el
  // informe no debe leer datos que nadie pidio.
  it('no consulta los requerimientos si el alcance es TICKETS', async () => {
    const { service, ticketsRepo, workItemsRepo } = make({});
    await service.monthly(7, { year: 2026, month: 7, scope: 'TICKETS' });
    expect(ticketsRepo.listForClientPeriod).toHaveBeenCalled();
    expect(workItemsRepo.listPortalRequirementsInPeriod).not.toHaveBeenCalled();
  });

  it('no consulta los tickets si el alcance es REQUERIMIENTOS', async () => {
    const { service, ticketsRepo, workItemsRepo } = make({});
    await service.monthly(7, { year: 2026, month: 7, scope: 'REQUERIMIENTOS' });
    expect(ticketsRepo.listForClientPeriod).not.toHaveBeenCalled();
    expect(ticketsRepo.countResolvedInPeriod).not.toHaveBeenCalled();
    expect(workItemsRepo.listPortalRequirementsInPeriod).toHaveBeenCalled();
  });

  it('pasa a las consultas el clientId de la sesion y las fronteras en hora de Peru', async () => {
    const { service, ticketsRepo } = make({});
    await service.monthly(7, { year: 2026, month: 7, scope: 'TICKETS' });
    const [clientId, from, to] = ticketsRepo.listForClientPeriod.mock.calls[0];
    expect(clientId).toBe(7);
    expect(from.toISOString()).toBe('2026-07-01T05:00:00.000Z');
    expect(to.toISOString()).toBe('2026-08-01T05:00:00.000Z');
  });

  it('la cabecera lleva periodo, generacion y el criterio impreso', async () => {
    const { service } = make({});
    const v = await service.monthly(7, { year: 2026, month: 7, scope: 'AMBOS' });
    expect(v.period).toEqual({ year: 2026, month: 7 });
    expect(v.generatedAt).toBeTruthy();
    expect(v.criteria).toMatch(/creados/i);
  });
});
```

- [ ] **Step 3: Ejecutar y comprobar que falla**

Run: `cd backend && npx jest src/modules/portal/portal-reports.service.spec.ts`
Expected: FAIL — el servicio no existe.

- [ ] **Step 4: Implementar**

```ts
async monthly(clientId: number, dto: MonthlyReportQueryDto): Promise<MonthlyReportView> {
  assertSessionScope(clientId, 'clientId', PortalReportsService.name);

  const ahora = new Date();
  if (!isPeruMonthClosed(dto.year, dto.month, ahora)) {
    throw new BadRequestException({
      code: 'BAD_INPUT',
      message: 'Solo se puede descargar el informe de un mes que ya terminó.',
    });
  }

  const { from, to } = peruMonthBounds(dto.year, dto.month);
  const quiereTickets = dto.scope === 'TICKETS' || dto.scope === 'AMBOS';
  const quiereReqs = dto.scope === 'REQUERIMIENTOS' || dto.scope === 'AMBOS';

  // El bloque que no se pidió ni se consulta. `null` viaja hasta el documento
  // para que «no lo pediste» no se confunda con «no hubo nada».
  const tickets = quiereTickets ? await this.tickets.listForClientPeriod(clientId, from, to) : null;
  const resueltosEnPeriodo = quiereTickets
    ? await this.tickets.countResolvedInPeriod(clientId, from, to)
    : null;
  const reqs = quiereReqs
    ? await this.workItems.listPortalRequirementsInPeriod(clientId, from, to)
    : null;

  const body = buildMonthlyReport({
    periodStart: from, periodEnd: to,
    tickets: tickets && tickets.map(toReportTicketRow),
    ticketsResolvedInPeriod: resueltosEnPeriodo,
    requirements: reqs && reqs.map(toReportRequirementRow),
  });

  return { ...this.header(clientId, dto, ahora), ...body };
}
```

`toReportTicketRow` y `toReportRequirementRow` son **listas blancas campo a campo**: mapean solo lo que el módulo de cálculo necesita. Nunca *spread* de la entidad — por ahí saldrían `rootCause`, `correctiveAction`, `resolutionMd` y `assigneeUserId`.

**Los estados salen ya traducidos, en los dos bloques.** Este documento acaba en un PDF que lee una persona ajena a la casa, y un `EN_ATENCION` en mayúsculas con guion bajo no es algo que se le enseñe a un cliente. Las dos fuentes de traducción ya existen y no se duplican:

- Tickets: `TICKET_STATUS_LABELS` de `backend/src/modules/tickets/domain/ticket-state-machine.ts`.
- Requerimientos: el mismo mapa `STATUS_LABELS` que ya usa `portal-requirements.service.ts` — **extráelo a un sitio compartido dentro del portal** para que el informe y el detalle no puedan divergir, en vez de copiarlo.

Los dos son `Record` completos sobre su tipo de estado, así que si mañana aparece un estado nuevo, deja de compilar hasta que alguien decida cómo se llama de cara al cliente.

La cabecera lleva `clientName` (razón social, resuelta como ya hace `portal-auth.service.ts`), `period`, `scope`, `generatedAt` en hora de Perú, y `criteria`: un texto que diga literalmente qué se contó — «Tickets y requerimientos **creados** entre el 1 y el 31 de julio de 2026, hora de Perú. "Resueltos dentro del periodo" cuenta los resueltos en esas fechas, se hayan creado cuando fuera.»

- [ ] **Step 5: Ejecutar y comprobar que pasa**

Run: `cd backend && npx jest src/modules/portal`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/portal/
git commit -m "feat(informe): servicio del portal, solo meses cerrados"
```

---

### Task 6: La ruta

**Files:**
- Create: `backend/src/modules/portal/portal-reports.controller.ts`
- Modify: `backend/src/modules/portal/portal.module.ts`
- Modify: `backend/src/modules/portal/portal-validation.integration.spec.ts`

**Interfaces:**
- Produces: `GET /portal/informes/mensual?year=&month=&scope=`

- [ ] **Step 1: Escribir el controlador**

```ts
/**
 * No acepta `clientId` por ningún lado: el único que existe es el del token
 * que `ClientJwtGuard` acaba de verificar. Mismo criterio que el resto del
 * portal.
 *
 * Sin `ClientAdminGuard`: descargarlo puede cualquier usuario de la empresa.
 * Es el registro del servicio que su compañía recibió, y esconderlo no
 * protege nada.
 */
@Controller('portal/informes')
@UseGuards(ClientJwtGuard)
export class PortalReportsController {
  constructor(private readonly service: PortalReportsService) {}

  @Get('mensual')
  monthly(
    @CurrentClientUser() user: AuthClientUser,
    @Query() dto: MonthlyReportQueryDto,
  ): Promise<MonthlyReportView> {
    return this.service.monthly(user.clientId, dto);
  }
}
```

Registra controlador y servicio en `portal.module.ts`, y añade `TicketsModule` a sus `imports`. **`TicketsModule` ya exporta `TicketsRepository`**, así que no hay que tocarlo. `WorkItemsModule` ya está importado desde R1.

- [ ] **Step 2: Cubrirlo en la prueba de validación del portal**

En `portal-validation.integration.spec.ts`, siguiendo el patrón que ya usa para tickets y requerimientos, añade el bloque de esta ruta: un `scope` inválido, un mes fuera de rango y un parámetro no declarado deben responder en español y sin nombres internos de propiedad.

- [ ] **Step 3: Comprobar que el backend arranca y que las rutas responden como deben**

Run: `cd backend && npx tsc --noEmit && npx jest src/modules/portal`
Expected: compila y pasa.

Comprueba además, **si y solo si el puerto está libre** (si está ocupado, no arranques nada y dilo en el informe):
- sin token → `401`
- con token de cliente y un mes ya cerrado → `200`
- con el mes en curso → `400` con «Solo se puede descargar el informe de un mes que ya terminó.»

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/portal/
git commit -m "feat(informe): ruta del portal para el informe mensual"
```

---

### Task 7: La pantalla y las descargas

**Files:**
- Create: `web/src/pages/portal/PortalMonthlyReportPage.tsx`
- Create: `web/src/pages/portal/monthly-report-download.ts`
- Modify: `web/src/api/portal.api.ts`, `web/src/api/types.ts`, `web/src/App.tsx`, `web/src/layout/PortalLayout.tsx`

**Interfaces:**
- Consumes: `GET /portal/informes/mensual` (tarea 6).
- Produces: la ruta `/portal/informes`.

Contexto: **`web/` no tiene pruebas y puede que no puedas verificar nada en el navegador.** Las tres trampas que ya han mordido en este proyecto y que la revisión buscará: el **freno síncrono al doble envío** con un `ref` antes del `await`; **limpiar todos los estados de error** al reintentar; y la **guarda de vida** en los controles.

- [ ] **Step 1: Tipos y llamada**

Copia los nombres del backend **literalmente** en `types.ts`. Añade a `portalApi` (dentro del objeto, que es la convención de los 22 módulos de `web/src/api/`):

```ts
getMonthlyReport: (year: number, month: number, scope: ReportScope) =>
  portalApiClient
    .get<PortalMonthlyReport>('/portal/informes/mensual', { params: { year, month, scope } })
    .then((r) => r.data),
```

- [ ] **Step 2: La pantalla**

Selector de **mes** (solo meses ya cerrados — el mes en curso no debe poder elegirse) y de **alcance** (tickets / requerimientos / ambos). Botón de generar, y al recibir el informe se pinta en pantalla con sus dos bloques y sus totales.

Reglas de presentación, que la revisión comprobará:
- Un porcentaje que llega `null` se pinta como **«—»** con la nota «sin compromisos que medir», **nunca como 0 %**. Un cero se lee como «no cumplieron nada» y lo cierto es «no había nada que cumplir».
- Un veredicto `SIN_COMPROMISO` se pinta como **«Sin compromiso»**, no como un hueco ni como un guion.
- Un bloque que llega `null` **no se pinta**; uno que llega vacío se pinta con su tabla vacía y sus ceros. Son cosas distintas.
- Las fechas sin hora usan `fmtDateOnly` (existe ya en el portal); las que llevan hora, `fmtDate`. Confundirlas desplaza un día.
- La cabecera del informe en pantalla muestra el `criteria` que manda el backend, tal cual. Es lo que hace explicable el documento.

- [ ] **Step 3: Las descargas**

En `monthly-report-download.ts`, aparte de la pantalla para poder leerlo:
- **PDF** con `jspdf` + `jspdf-autotable`, siguiendo el patrón de `MonthlyReportPage.tsx`.
- **CSV** con BOM (`﻿`) y separador de coma, como el que ya existe, para que Excel en español lo abra bien.

Los dos documentos llevan en cabecera: razón social, periodo, fecha y hora de generación, y el texto de `criteria`. Sin eso no son evidencia de nada.

- [ ] **Step 4: Ruta y navegación**

En `App.tsx`, dentro del bloque protegido del portal: `<Route path="/portal/informes" element={<PortalMonthlyReportPage />} />`. En `PortalLayout.tsx`, un `NavLink` con la etiqueta «Informes», junto a los de Tickets y Requerimientos.

- [ ] **Step 5: Compilar**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: limpio.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(portal): pantalla y descarga del informe mensual"
```

---

## Comprobación final antes de fusionar

- [ ] `cd backend && npm test` y `npx tsc --noEmit` — limpios.
- [ ] `cd web && npx tsc --noEmit && npm run build` — limpios.
- [ ] `SELECT COUNT(*) FROM ticket_events WHERE notified_at IS NULL;` sigue en `0`. Este plan **solo lee**; si ese número no es cero, algo escribió donde no debía.
- [ ] Pedir el informe de un mes cerrado con las tres opciones de alcance y comprobar que el bloque no pedido no aparece.
- [ ] Pedir el mes en curso y comprobar que responde con el mensaje en español.

# El sistema como columna del soporte — Plan de implementación

> **Para trabajadores agénticos:** SUB-HABILIDAD REQUERIDA: usa superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans para implementar este plan tarea a tarea. Los pasos usan casillas (`- [ ]`) para poder marcarlos.

**Goal:** Que el sistema (`client_systems`) sea el clasificador del soporte —explicado cuando no hay ninguno, obligatorio cuando los hay, elegido solo por la ingesta cuando no hay a quién preguntar— y que el proyecto salga del ticket y del requerimiento sin borrar un solo dato.

**Architecture:** La regla vive una sola vez, en una función pura (`domain/system-requirement.ts`) que `TicketsService` llama con la lista de sistemas activos ya consultada. La obligación se aplica **en la aplicación, no en la base**: `tickets.system_id` sigue admitiendo vacío y **no hay ninguna migración**. La ingesta de correo se exime con un valor nombrado (`'EXENTO_SIN_QUIEN_ELIJA'`), nunca deduciéndolo del `origin` ni de la presencia de `emailOrigin`. El proyecto desaparece de los DTO, de los filtros y de los dos diálogos de alta; las columnas y sus datos se quedan.

**Tech Stack:** NestJS 10 · TypeORM 0.3 (`synchronize: false`) · MySQL 8 · Jest 29 (con `TZ=UTC` forzado desde `jest.config.js`) · React 18 + Vite + TypeScript + Tailwind

**Spec:** `docs/superpowers/specs/2026-10-28-el-sistema-como-columna-design.md`

## Global Constraints

Todas las tareas de este plan las incluyen implícitamente. Van copiadas al pie de la letra.

- **`synchronize: false`**: todo cambio de esquema es una migración SQL escrita a mano, idempotente, con el patrón de procedimientos guardados que consultan `information_schema` que usan las anteriores. **Si hace falta migración, mira cuál es el número siguiente libre y tiene que ir en las TRES listas de despliegue** (`.github/workflows/deploy.yml`, `docker-compose.yml`, `docker-compose.dev.yml`, donde además hay que renumerar la siembra). Olvidar una rompe el arranque en producción.
- **TypeORM devuelve `bigint` como cadena.** Nunca `===` entre identificadores; usa `sameId` de `backend/src/common/ids.ts`.
- **Transacciones:** `runInTransaction` + `manager.getRepository(...)`, jamás el repositorio inyectado.
- **Proyección campo a campo con lista blanca**; nunca la entidad cruda.
- **404, no 403**, para recursos de otra empresa; y en el portal, **la empresa sale siempre de la sesión**, jamás del cuerpo de la petición.
- **Producción corre en UTC y el desarrollo en América/Lima.** Ha habido **siete** fallos de zona horaria en esta serie. Y **las pruebas fuerzan la zona a universal**, así que ejecutar con otra zona no demuestra nada en esta máquina: razona y fija el comportamiento con pruebas que no dependan de la zona del proceso.
- **Los mensajes de validación y los textos van en español.**
- Al final de cada tarea: `cd backend && npx jest && npx tsc --noEmit`, y si toca frontend `cd web && npx tsc --noEmit && npm run build`.

**Sobre la primera restricción, en concreto:** este plan **no trae ninguna migración**, por decisión del diseño («Esquema»). Ninguna tarea toca `backend/sql/migrations/`, ni `deploy.yml`, ni los dos `docker-compose`. Si alguna tarea acaba necesitando una, para y vuelve al diseño: la obligación del sistema está decidida en la aplicación a propósito, y un `NOT NULL` rompería la ingesta de correo, las filas viejas y la reversibilidad.

## Review Focus

Las cinco entradas que la spec implica y que, sin esto escrito, ninguna tarea probaría. Cada línea tiene su prueba añadida a la tarea que posee el código, en el estilo de pasos de esa tarea.

1. **Un `systemId` de otra empresa enviado a `POST /tickets` desde el panel.** Hoy se escribe sin comprobar nada. Tiene que responder 400 y no escribir ni el ticket. → Tarea 2.
2. **Un `systemId` de un sistema *inactivo*.** El desplegable solo ofrece activos, pero la petición no pasa por el desplegable. Mismo 400. → Tarea 2.
3. **Un ticket sin cliente** (`(sin cliente)` en el panel): no hay de dónde sacar sistemas, así que no se puede exigir nada y el alta tiene que seguir funcionando. → Tarea 2.
4. **La ingesta de correo de un cliente con dos o más sistemas activos**: el ticket entra **sin sistema** y el correo **no se descarta** ni se cuenta como error. Un correo perdido es una petición de cliente perdida. → Tarea 3.
5. **`PATCH /tickets/:id` sobre un ticket viejo sin sistema, tocando solo el asunto**: no puede fallar. La obligación no es retroactiva. → Tarea 2.

---

## Estructura de ficheros

**Backend — se crean:**
- `backend/src/modules/tickets/domain/system-requirement.ts` — la regla entera, **pura**: sin base, sin reloj, sin Nest más allá de las excepciones HTTP (mismo patrón que `domain/ticket-state-machine.ts`, que ya lanza `BadRequestException`).
- `backend/src/modules/tickets/domain/system-requirement.spec.ts`

**Backend — se modifican:**
- `backend/src/modules/tickets/client-systems.repository.ts` — `listActiveByClient`.
- `backend/src/modules/tickets/tickets.service.ts` (+ `tickets.service.spec.ts`) — aplica la regla en `create`, comprueba pertenencia en `update`, pierde `ProjectsService`.
- `backend/src/modules/tickets/dto/create-ticket.dto.ts` — sin `projectId`.
- `backend/src/modules/tickets/tickets.controller.ts`, `tickets.repository.ts` — sin filtro por proyecto.
- `backend/src/modules/inbound-email/inbound-email.service.ts` (+ spec) — la exención nombrada y el sistema único.
- `backend/src/modules/work-items/dto/create-work-item.dto.ts`, `work-items.service.ts` (+ spec), `work-items.controller.ts`, `work-items.repository.ts` — el proyecto sale del requerimiento.

**Web — se crea:**
- `web/src/pages/tickets/system-field.ts` — los textos del campo «Sistema» y el estado en que está, compartidos por el diálogo del panel y el del portal.

**Web — se modifican:**
- `web/src/pages/tickets/NewTicketDialog.tsx`
- `web/src/pages/portal/NewPortalTicketDialog.tsx`
- `web/src/pages/TicketDetailPage.tsx` — la ficha del ticket pasa a enseñar el sistema.
- `web/src/pages/ClientDetailPage.tsx` — enlace profundo `?tab=systems` y aviso de cliente sin sistemas.
- `web/src/pages/ClientsListPage.tsx` — al crear un cliente, se va a su pestaña «Sistemas».
- `web/src/pages/tickets/ClientSystemsTab.tsx` — el texto de la lista vacía.
- `web/src/pages/work-items/NewWorkItemDialog.tsx`, `web/src/pages/work-items/WorkItemPanel.tsx`
- `web/src/api/tickets.api.ts`, `web/src/api/work-items.api.ts`

**No se tocan, y es una decisión:** `backend/src/modules/projects/` entero, `TicketAIService` (sigue leyendo `ticket.projectId` para los tickets viejos), `web/src/pages/ProjectsPage.tsx` y el menú.

---

### Task 1: El desplegable vacío se explica — portal y panel

Es la tarea que se hace **pase lo que pase con el resto**: si el plan se parase aquí, el fallo que destapó todo esto ya estaría arreglado.

**Files:**
- Create: `web/src/pages/tickets/system-field.ts`
- Modify: `web/src/pages/portal/NewPortalTicketDialog.tsx`
- Modify: `web/src/pages/tickets/NewTicketDialog.tsx`
- Modify: `web/src/pages/ClientDetailPage.tsx`

**Interfaces:**
- Consume: nada (primera tarea).
- Produce, en `web/src/pages/tickets/system-field.ts`:
  - `type SystemFieldState = 'SIN_CLIENTE' | 'CARGANDO' | 'SIN_SISTEMAS' | 'ELEGIBLE'`
  - `function systemFieldState(params: { hasClient: boolean; loaded: boolean; count: number }): SystemFieldState`
  - `const SIN_SISTEMAS_PORTAL: string`, `const SIN_SISTEMAS_PANEL: string`, `const SIN_SISTEMAS_PANEL_ENLACE: string`
  - `function clientSystemsHref(clientId: number): string`
- Produce, en `ClientDetailPage`: la pestaña inicial sale de `?tab=`, así que `clientSystemsHref(id)` abre la ficha ya en «Sistemas».

**`web/` no tiene ejecutor de pruebas** (`package.json` no trae jest ni vitest; la verificación de la casa es `tsc --noEmit && npm run build`). Así que aquí **la comprobación que falla primero es el compilador**, y el paso 1 la provoca a propósito: se escribe el consumo antes que el módulo. No es un sustituto de una prueba unitaria y no se pretende que lo sea; es la comprobación que este proyecto tiene, ejecutada en el orden correcto.

- [ ] **Step 1: Escribir el consumo, y ver que el compilador falla**

En `web/src/pages/portal/NewPortalTicketDialog.tsx`, junto a los demás imports:

```tsx
import { SIN_SISTEMAS_PORTAL, systemFieldState } from '../tickets/system-field';
```

Run: `cd web && npx tsc --noEmit`
Expected: FAIL — `Cannot find module '../tickets/system-field'`.

- [ ] **Step 2: Crear `web/src/pages/tickets/system-field.ts`**

```ts
/**
 * El campo «Sistema» de los dos formularios de alta de ticket —el del panel y
 * el del portal—, en un solo sitio.
 *
 * Los textos viven juntos a propósito: son dos mensajes distintos para dos
 * lectores distintos (el cliente, que no puede dar de alta nada; el equipo, que
 * sí) y la única forma de revisar que siguen diciendo lo mismo es verlos en la
 * misma pantalla.
 */

/** En qué estado está el campo. El desplegable solo se pinta en `ELEGIBLE`. */
export type SystemFieldState = 'SIN_CLIENTE' | 'CARGANDO' | 'SIN_SISTEMAS' | 'ELEGIBLE';

/**
 * `hasClient` es siempre `true` en el portal: la empresa sale de la sesión y no
 * se elige. `loaded` distingue «todavía no sé» de «sé que no hay ninguno»: sin
 * esa distinción, el aviso de «no tiene sistemas» parpadea en cada apertura
 * mientras la lista viaja, y un aviso que aparece y se va es ruido.
 */
export function systemFieldState(params: {
  hasClient: boolean;
  loaded: boolean;
  count: number;
}): SystemFieldState {
  if (!params.hasClient) return 'SIN_CLIENTE';
  if (!params.loaded) return 'CARGANDO';
  return params.count === 0 ? 'SIN_SISTEMAS' : 'ELEGIBLE';
}

/**
 * Dice las tres cosas que el cliente necesita: qué pasa, que no es culpa suya,
 * y que puede seguir. Un desplegable con una sola opción muerta no decía
 * ninguna de las tres.
 */
export const SIN_SISTEMAS_PORTAL =
  'Tu empresa aún no tiene sistemas registrados. Puedes crear el ticket igualmente; lo clasificaremos nosotros.';

/** Para el equipo: quien ve el hueco es quien puede taparlo. */
export const SIN_SISTEMAS_PANEL =
  'Este cliente no tiene sistemas registrados. El ticket se puede crear igual, pero queda sin clasificar.';

export const SIN_SISTEMAS_PANEL_ENLACE = 'Dar de alta el primero';

/** La pestaña «Sistemas» de la ficha del cliente, directa. */
export function clientSystemsHref(clientId: number): string {
  return `/clients/${clientId}?tab=systems`;
}
```

- [ ] **Step 3: Que el enlace del panel aterrice en la pestaña correcta**

En `web/src/pages/ClientDetailPage.tsx`, la pestaña inicial deja de ser siempre `'summary'`: sale de `?tab=` cuando ese valor es una pestaña válida.

```tsx
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
```

```tsx
  const [searchParams] = useSearchParams();
  // Sin lista blanca, un `?tab=` cualquiera dejaría la ficha sin ninguna
  // pestaña pintada: `tab === t.key` sería falso para las cuatro.
  const requestedTab = searchParams.get('tab');
  const initialTab: Tab =
    requestedTab === 'projects' || requestedTab === 'documents' || requestedTab === 'systems'
      ? requestedTab
      : 'summary';
  const [tab, setTab] = useState<Tab>(initialTab);
```

- [ ] **Step 4: El portal pinta el aviso en vez del desplegable**

En `NewPortalTicketDialog.tsx`: un estado nuevo `const [systemsLoaded, setSystemsLoaded] = useState(false);`, puesto a `false` en el reset de apertura y a `true` tanto en el `.then` como en el `.catch` del `listSystems` (un fallo de carga es «no hay lista», y el alta sigue siendo posible: eso ya está decidido en el comentario que hay sobre ese efecto).

El bloque del campo pasa a:

```tsx
          <div>
            <label className="label" htmlFor="portal-ticket-system">
              Sistema (opcional)
            </label>
            {systemFieldState({ hasClient: true, loaded: systemsLoaded, count: systems.length }) ===
            'SIN_SISTEMAS' ? (
              <p className="text-sm text-slate-500">{SIN_SISTEMAS_PORTAL}</p>
            ) : (
              <select
                id="portal-ticket-system"
                className="input"
                value={systemId}
                onChange={(e) => setSystemId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">(sin sistema)</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
```

- [ ] **Step 5: El panel pinta el aviso con el enlace de alta**

En `NewTicketDialog.tsx`: mismo estado `systemsLoaded` (a `false` en el reset y cuando cambia el cliente elegido, a `true` en el `.then` y en el `.catch`), el import de `Link` de `react-router-dom`, y el `<label>` del sistema pasa a decidir entre tres cosas con `systemFieldState({ hasClient: Boolean(clientId), loaded: systemsLoaded, count: systems.length })`:

- `'SIN_SISTEMAS'` → el aviso y el enlace, en vez del `<select>`:

```tsx
            <span style={{ display: 'block', fontSize: 12, color: '#6d7577' }}>
              {SIN_SISTEMAS_PANEL}{' '}
              <Link to={clientSystemsHref(Number(clientId))} style={{ color: '#15191a', fontWeight: 600 }}>
                {SIN_SISTEMAS_PANEL_ENLACE}
              </Link>
            </span>
```

- `'SIN_CLIENTE'` y `'CARGANDO'` → el `<select>` deshabilitado que ya existe, con su texto «Elige un cliente primero».
- `'ELEGIBLE'` → el `<select>` de siempre.

- [ ] **Step 6: Comprobar que compila y que el paquete se construye**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: PASS, sin errores.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/tickets/system-field.ts web/src/pages/portal/NewPortalTicketDialog.tsx web/src/pages/tickets/NewTicketDialog.tsx web/src/pages/ClientDetailPage.tsx
git commit -m "fix(tickets): el desplegable de sistemas vacio se explica, y el panel enlaza al alta"
```

---

### Task 2: El sistema, exigido donde hay a quien preguntar

**Files:**
- Create: `backend/src/modules/tickets/domain/system-requirement.ts`
- Create: `backend/src/modules/tickets/domain/system-requirement.spec.ts`
- Modify: `backend/src/modules/tickets/client-systems.repository.ts`
- Modify: `backend/src/modules/tickets/tickets.service.ts`
- Modify: `backend/src/modules/tickets/tickets.service.spec.ts`
- Modify: `backend/src/modules/inbound-email/inbound-email.service.ts` (una línea: la exención)
- Modify: `backend/src/modules/inbound-email/inbound-email.service.spec.ts`
- Modify: `backend/src/modules/portal/portal-tickets.service.spec.ts`

**Interfaces:**
- Consume: nada del plan; `sameId` de `backend/src/common/ids.ts`.
- Produce, en `domain/system-requirement.ts`:
  - `type SystemRequirement = 'EXIGIDO' | 'EXENTO_SIN_QUIEN_ELIJA'`
  - `interface ActiveSystem { id: number }`
  - `function resolveTicketSystem(params: { requirement: SystemRequirement; clientId: number | null | undefined; systemId: number | null | undefined; activeSystems: ActiveSystem[] }): number | null`
  - `function assertSystemBelongsToClient(params: { systemId: number | null | undefined; activeSystems: ActiveSystem[] }): void`
- Produce, en `ClientSystemsRepository`: `listActiveByClient(clientId: number): Promise<ClientSystem[]>`
- Produce, en `TicketsService`: `create(actor, dto, emailOrigin?, requirement: SystemRequirement = 'EXIGIDO')`. El constructor pasa a recibir `ClientSystemsRepository` como **sexto** parámetro, detrás de `ProjectsService`.

- [ ] **Step 1: Escribir la prueba que falla, sobre la regla pura**

Crea `backend/src/modules/tickets/domain/system-requirement.spec.ts`:

```ts
import { resolveTicketSystem, assertSystemBelongsToClient } from './system-requirement';

const ACTIVOS = [{ id: 5 }, { id: 6 }];

describe('resolveTicketSystem', () => {
  it('con sistemas activos y sin elegir, no deja crear', () => {
    expect(() =>
      resolveTicketSystem({
        requirement: 'EXIGIDO',
        clientId: 7,
        systemId: undefined,
        activeSystems: ACTIVOS,
      }),
    ).toThrow('Elige el sistema afectado.');
  });

  it('sin ningun sistema activo, el campo es opcional y el alta sigue', () => {
    expect(
      resolveTicketSystem({
        requirement: 'EXIGIDO',
        clientId: 7,
        systemId: undefined,
        activeSystems: [],
      }),
    ).toBeNull();
  });

  it('sin cliente no hay de donde sacar sistemas, asi que no se exige nada', () => {
    expect(
      resolveTicketSystem({
        requirement: 'EXIGIDO',
        clientId: null,
        systemId: undefined,
        activeSystems: [],
      }),
    ).toBeNull();
  });

  it('la ingesta esta exenta: entra sin sistema aunque el cliente tenga varios', () => {
    expect(
      resolveTicketSystem({
        requirement: 'EXENTO_SIN_QUIEN_ELIJA',
        clientId: 7,
        systemId: undefined,
        activeSystems: ACTIVOS,
      }),
    ).toBeNull();
  });

  it('un sistema que no esta entre los activos del cliente se rechaza', () => {
    expect(() =>
      resolveTicketSystem({
        requirement: 'EXIGIDO',
        clientId: 7,
        systemId: 99,
        activeSystems: ACTIVOS,
      }),
    ).toThrow('El sistema indicado no es de este cliente o está inactivo.');
  });

  it('la exencion de la ingesta NO exime de que el sistema elegido sea valido', () => {
    expect(() =>
      resolveTicketSystem({
        requirement: 'EXENTO_SIN_QUIEN_ELIJA',
        clientId: 7,
        systemId: 99,
        activeSystems: ACTIVOS,
      }),
    ).toThrow('El sistema indicado no es de este cliente o está inactivo.');
  });

  // TypeORM hidrata todo `bigint` como cadena: el id que llega de la base es
  // "5", y con `===` el dueno legitimo se comeria un 400.
  it('compara por valor: el id de la base llega como cadena', () => {
    expect(
      resolveTicketSystem({
        requirement: 'EXIGIDO',
        clientId: 7,
        systemId: 5,
        activeSystems: [{ id: '5' } as unknown as { id: number }],
      }),
    ).toBe(5);
  });
});

describe('assertSystemBelongsToClient', () => {
  it('no dice nada cuando no se toca el sistema', () => {
    expect(() =>
      assertSystemBelongsToClient({ systemId: undefined, activeSystems: [] }),
    ).not.toThrow();
  });

  it('rechaza un sistema inactivo o de otra empresa', () => {
    expect(() => assertSystemBelongsToClient({ systemId: 99, activeSystems: ACTIVOS })).toThrow(
      'El sistema indicado no es de este cliente o está inactivo.',
    );
  });
});
```

- [ ] **Step 2: Ver que falla**

Run: `cd backend && npx jest src/modules/tickets/domain/system-requirement.spec.ts`
Expected: FAIL — `Cannot find module './system-requirement'`.

- [ ] **Step 3: Escribir `backend/src/modules/tickets/domain/system-requirement.ts`**

Dos funciones exportadas, con las firmas del bloque **Interfaces**. Lanza `BadRequestException({ code: 'BAD_INPUT', message })` —mismo patrón que `domain/ticket-state-machine.ts`, que ya lanza excepciones de Nest desde dominio— con estos dos mensajes exactos y ningún otro:

- falta elegir: `'Elige el sistema afectado.'`
- elegido imposible: `'El sistema indicado no es de este cliente o está inactivo.'`

El orden de las comprobaciones es parte de la regla: **primero** se valida el sistema elegido (y eso no lo exime la ingesta: un id imposible es un error venga de donde venga), y **solo si no se eligió ninguno** se decide si hacía falta. La pertenencia se comprueba con `sameId` de `common/ids.ts`, nunca con `===`. Documenta en el docblock por qué la exención es un valor nombrado y no `origin === 'EMAIL'` ni la presencia de `emailOrigin`: decidir por una consecuencia en vez de por el hecho es el defecto recurrente de este proyecto, y `origin` lo teclea cualquiera en el formulario del panel.

- [ ] **Step 4: Ver que pasa**

Run: `cd backend && npx jest src/modules/tickets/domain/system-requirement.spec.ts`
Expected: PASS, 9 pruebas.

- [ ] **Step 5: Escribir la prueba que falla en el servicio**

En `backend/src/modules/tickets/tickets.service.spec.ts`, dentro de `makeService`, añade el doble del repositorio de sistemas junto a los de `clients` y `projects`:

```ts
  const systems = { listActiveByClient: jest.fn().mockResolvedValue([{ id: 5 }]) };
```

y pásalo al constructor, detrás de `projects`:

```ts
    service: new TicketsService(
      repo as any, events as any, sla as any, clients as any, projects as any, systems as any,
    ),
```

(añade `systems` también al objeto que `makeService` devuelve). Y las pruebas nuevas, en un `describe` propio:

```ts
describe('el sistema del ticket', () => {
  it('un cliente con sistemas y un alta sin elegir no escribe nada', async () => {
    const { service, repo } = makeService();
    await expect(
      service.create({ kind: 'STAFF', userId: 5 }, { rawText: 'algo', clientId: 7 } as any),
    ).rejects.toThrow('Elige el sistema afectado.');
    // Antes de abrir la transaccion: ni ticket, ni evento, ni mensaje.
    expect(repo.runInTransaction).not.toHaveBeenCalled();
    expect(repo.savedTickets).toHaveLength(0);
    expect(repo.savedEvents).toHaveLength(0);
    expect(repo.savedMessages).toHaveLength(0);
  });

  it('un systemId que no es del cliente se rechaza sin escribir nada', async () => {
    const { service, repo } = makeService();
    await expect(
      service.create(
        { kind: 'STAFF', userId: 5 },
        { rawText: 'algo', clientId: 7, systemId: 99 } as any,
      ),
    ).rejects.toThrow('El sistema indicado no es de este cliente o está inactivo.');
    expect(repo.savedTickets).toHaveLength(0);
  });

  it('un systemId de un sistema inactivo se rechaza igual', async () => {
    const { service, systems, repo } = makeService();
    // El 6 existe en el catalogo del cliente, pero esta desactivado: no sale
    // de `listActiveByClient`, asi que para el alta es inelegible.
    systems.listActiveByClient.mockResolvedValue([{ id: 5 }]);
    await expect(
      service.create(
        { kind: 'STAFF', userId: 5 },
        { rawText: 'algo', clientId: 7, systemId: 6 } as any,
      ),
    ).rejects.toThrow('El sistema indicado no es de este cliente o está inactivo.');
    expect(repo.savedTickets).toHaveLength(0);
  });

  it('un cliente sin sistemas activos crea el ticket sin sistema', async () => {
    const { service, repo, systems } = makeService();
    systems.listActiveByClient.mockResolvedValue([]);
    await service.create({ kind: 'STAFF', userId: 5 }, { rawText: 'algo', clientId: 7 } as any);
    expect(repo.savedTickets[0].systemId).toBeNull();
  });

  it('un ticket sin cliente no exige sistema y ni siquiera consulta el catalogo', async () => {
    const { service, repo, systems } = makeService();
    await service.create({ kind: 'STAFF', userId: 5 }, { rawText: 'algo' } as any);
    expect(systems.listActiveByClient).not.toHaveBeenCalled();
    expect(repo.savedTickets[0].systemId).toBeNull();
  });

  it('la ingesta esta exenta: crea el ticket aunque el cliente tenga sistemas', async () => {
    const { service, repo } = makeService();
    await service.create(
      { kind: 'CLIENT', clientUserId: 11 },
      { rawText: 'algo', clientId: 7, origin: 'EMAIL' } as any,
      { emailMessageId: '<a@b>', bodyFull: 'algo' },
      'EXENTO_SIN_QUIEN_ELIJA',
    );
    expect(repo.savedTickets[0].systemId).toBeNull();
  });

  it('la obligacion no es retroactiva: editar un ticket viejo sin tocar el sistema no falla', async () => {
    const { service, repo, systems } = makeService();
    repo.findById = jest.fn().mockResolvedValue({ id: 1, clientId: 7, status: 'NUEVO', systemId: null });
    repo.update = jest.fn().mockResolvedValue({ id: 1 });
    await service.update(1, { subject: 'otro asunto' } as any);
    expect(systems.listActiveByClient).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Ver que falla**

Run: `cd backend && npx jest src/modules/tickets/tickets.service.spec.ts`
Expected: FAIL — el alta sin sistema no lanza nada y escribe el ticket.

- [ ] **Step 7: `listActiveByClient` en el repositorio**

En `backend/src/modules/tickets/client-systems.repository.ts`:

```ts
  /**
   * Solo los activos, ordenados por nombre: es exactamente la lista que el
   * desplegable ofrece. Exigir elegir entre opciones que el desplegable no
   * muestra haria el formulario imposible de rellenar.
   */
  listActiveByClient(clientId: number): Promise<ClientSystem[]> {
    return this.repo.find({ where: { clientId, isActive: 1 }, order: { name: 'ASC' } });
  }
```

- [ ] **Step 8: Aplicar la regla en `TicketsService`**

Inyecta `ClientSystemsRepository` como sexto parámetro del constructor. En `create`, **antes** de `runInTransaction` y justo detrás de la comprobación de `clientId`:

```ts
    // El catalogo solo se consulta si hay cliente: sin cliente no hay sistemas
    // de los que elegir, y una consulta con `undefined` traeria los de todos.
    const activeSystems = dto.clientId
      ? await this.systems.listActiveByClient(dto.clientId)
      : [];
    const systemId = resolveTicketSystem({
      requirement,
      clientId: dto.clientId ?? null,
      systemId: dto.systemId,
      activeSystems,
    });
```

y el `ticketRepo.create({...})` escribe `systemId,` en lugar de `systemId: dto.systemId ?? null`. En `update`, detrás de la comprobación de `clientId`:

```ts
    // Solo si se toca. La obligacion de elegir no es retroactiva (decision 2
    // del diseno): un ticket viejo sin sistema se sigue editando.
    if (dto.systemId !== undefined) {
      const clientId = dto.clientId ?? current.clientId;
      assertSystemBelongsToClient({
        systemId: dto.systemId,
        activeSystems: clientId ? await this.systems.listActiveByClient(Number(clientId)) : [],
      });
    }
```

- [ ] **Step 9: La exención, en su único sitio**

En `backend/src/modules/inbound-email/inbound-email.service.ts`, la llamada de `handleClientSender` pasa el cuarto argumento:

```ts
      const created = await this.tickets.create(
        { kind: 'CLIENT', clientUserId },
        dto,
        emailOrigin,
        'EXENTO_SIN_QUIEN_ELIJA',
      );
```

Y en `backend/src/modules/inbound-email/inbound-email.service.spec.ts`, dentro del `describe` de «un correo de un cliente registrado sin referencia»:

```ts
    it('la ingesta pide explicitamente la exencion de sistema', async () => {
      const { service, tickets } = montar({ clientUser: CLIENT_USER });
      await service.drain();
      const [, , , requirement] = tickets.create.mock.calls[0];
      expect(requirement).toBe('EXENTO_SIN_QUIEN_ELIJA');
    });
```

Y en `backend/src/modules/portal/portal-tickets.service.spec.ts`, la otra mitad de la misma afirmación —que la exención es de la ingesta y de nadie más—, dentro del `describe` del alta:

```ts
  it('el alta del portal no se exime de la regla del sistema', async () => {
    const { service, tickets } = makeService();
    await service.create(11, 7, { subject: 'No carga', description: 'Detalle' } as any);
    // Sin cuarto argumento: hereda 'EXIGIDO' por defecto. Si alguien le pasara
    // aqui la exencion, un cliente con sistemas podria volver a abrir tickets
    // sin clasificar y nada mas lo delataria.
    expect(tickets.create.mock.calls[0]).toHaveLength(2);
  });
```

- [ ] **Step 10: Ver que pasa todo**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add backend/src/modules/tickets backend/src/modules/inbound-email
git commit -m "feat(tickets): el sistema es obligatorio cuando la empresa tiene alguno, y se valida siempre"
```

---

### Task 3: La ingesta de correo elige cuando no hay duda

**Files:**
- Modify: `backend/src/modules/tickets/domain/system-requirement.ts`
- Modify: `backend/src/modules/tickets/domain/system-requirement.spec.ts`
- Modify: `backend/src/modules/inbound-email/inbound-email.service.ts`
- Modify: `backend/src/modules/inbound-email/inbound-email.service.spec.ts`

**Interfaces:**
- Consume: `ClientSystemsRepository.listActiveByClient` (tarea 2) y `SystemRequirement` (tarea 2). `InboundEmailModule` ya importa `TicketsModule`, que **ya exporta** `ClientSystemsRepository`: no hay que tocar ningún módulo.
- Produce, en `domain/system-requirement.ts`: `function soleActiveSystemId(activeSystems: ActiveSystem[]): number | null`.
- Produce, en `InboundEmailService`: el constructor recibe `ClientSystemsRepository` como **décimo** parámetro, detrás de `WorkspaceService`.

- [ ] **Step 1: Escribir la prueba que falla, sobre la decisión pura**

En `backend/src/modules/tickets/domain/system-requirement.spec.ts`, añade el import de `soleActiveSystemId` y:

```ts
describe('soleActiveSystemId', () => {
  it('con un solo sistema activo, ese es', () => {
    expect(soleActiveSystemId([{ id: 5 }])).toBe(5);
  });

  it('con dos, no se adivina', () => {
    expect(soleActiveSystemId([{ id: 5 }, { id: 6 }])).toBeNull();
  });

  it('sin ninguno, no hay nada que elegir', () => {
    expect(soleActiveSystemId([])).toBeNull();
  });

  it('el id de la base llega como cadena y sale como numero', () => {
    expect(soleActiveSystemId([{ id: '5' } as unknown as { id: number }])).toBe(5);
  });
});
```

- [ ] **Step 2: Ver que falla**

Run: `cd backend && npx jest src/modules/tickets/domain/system-requirement.spec.ts`
Expected: FAIL — `soleActiveSystemId is not a function`.

- [ ] **Step 3: Escribirla**

`soleActiveSystemId` devuelve `Number(activeSystems[0].id)` cuando la lista tiene exactamente un elemento, y `null` en cualquier otro caso. En el docblock: con uno solo no es una suposición, es el único software que esa empresa nos arrienda; con dos, adivinar sería inventarse justo el dato que todo esto existe para tener fiable.

- [ ] **Step 4: Escribir la prueba que falla en la ingesta**

En `backend/src/modules/inbound-email/inbound-email.service.spec.ts`, añade a `Opciones` y a `montar` el doble del catálogo:

```ts
  /** Los sistemas activos del cliente del remitente. Ninguno, por omision. */
  sistemasActivos?: { id: number }[];
```

```ts
  const clientSystems = {
    listActiveByClient: jest.fn().mockResolvedValue(sistemasActivos),
  };
```

pasado como décimo argumento a `new InboundEmailService(...)` y devuelto por `montar`. Y las tres pruebas, en el `describe` de «un correo de un cliente registrado sin referencia»:

```ts
    it('con un unico sistema activo, el ticket nace con ese sistema', async () => {
      const { service, tickets, clientSystems } = montar({
        clientUser: CLIENT_USER,
        sistemasActivos: [{ id: 5 }],
      });
      const resumen = await service.drain();
      expect(clientSystems.listActiveByClient).toHaveBeenCalledWith(7);
      const [, dto] = tickets.create.mock.calls[0];
      expect(dto.systemId).toBe(5);
      expect(resumen.ticketsCreated).toBe(1);
    });

    it('con dos sistemas activos no se adivina: entra sin sistema y el correo NO se descarta', async () => {
      const { service, tickets } = montar({
        clientUser: CLIENT_USER,
        sistemasActivos: [{ id: 5 }, { id: 6 }],
      });
      const resumen = await service.drain();
      const [, dto] = tickets.create.mock.calls[0];
      expect(dto.systemId).toBeUndefined();
      expect(resumen.ticketsCreated).toBe(1);
      expect(resumen.discarded).toBe(0);
      expect(resumen.errors).toBe(0);
    });

    it('sin ningun sistema activo, entra sin sistema y el correo tampoco se pierde', async () => {
      const { service, tickets } = montar({ clientUser: CLIENT_USER, sistemasActivos: [] });
      const resumen = await service.drain();
      const [, dto] = tickets.create.mock.calls[0];
      expect(dto.systemId).toBeUndefined();
      expect(resumen.ticketsCreated).toBe(1);
      expect(resumen.discarded).toBe(0);
    });
```

- [ ] **Step 5: Ver que falla**

Run: `cd backend && npx jest src/modules/inbound-email/inbound-email.service.spec.ts`
Expected: FAIL — el constructor recibe un argumento de más y `dto.systemId` es siempre `undefined`.

- [ ] **Step 6: Resolver el sistema antes de crear el ticket**

Inyecta `ClientSystemsRepository` en `InboundEmailService` (décimo parámetro). En `handleClientSender`, justo antes de construir el `dto`:

```ts
    // El unico sistema activo del cliente, si solo hay uno. Aqui no hay nadie
    // a quien preguntar -- por eso el alta va con `'EXENTO_SIN_QUIEN_ELIJA'` --,
    // pero cuando la empresa arrienda un solo sistema no hay nada que preguntar.
    const systemId = soleActiveSystemId(await this.clientSystems.listActiveByClient(senderClientId));
```

y el `dto` lleva `systemId: systemId ?? undefined,`.

- [ ] **Step 7: Ver que pasa todo**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/tickets/domain backend/src/modules/inbound-email
git commit -m "feat(correo): un ticket por correo toma el sistema cuando el cliente solo tiene uno"
```

---

### Task 4: El proyecto sale del ticket

Backend y panel **en el mismo commit**, a propósito: en cuanto `projectId` sale del DTO, el `ValidationPipe` global (`forbidNonWhitelisted`) responde 400 a quien lo mande, y el diálogo del panel lo manda. Separar las dos mitades dejaría un commit con el alta de tickets rota.

**Files:**
- Modify: `backend/src/modules/tickets/dto/create-ticket.dto.ts`
- Modify: `backend/src/modules/tickets/tickets.service.ts`
- Modify: `backend/src/modules/tickets/tickets.service.spec.ts`
- Modify: `backend/src/modules/tickets/tickets.controller.ts`
- Modify: `backend/src/modules/tickets/tickets.repository.ts`
- Modify: `web/src/api/tickets.api.ts`
- Modify: `web/src/pages/tickets/NewTicketDialog.tsx`

**Interfaces:**
- Consume: `TicketsService.create` tal como la dejó la tarea 2.
- Produce: `CreateTicketDto` ya **no** tiene `projectId` (y `UpdateTicketDto`, que deriva de él, tampoco). `TicketListFilters` pierde `projectId`. `TicketsService` deja de depender de `ProjectsService` — el constructor pasa a ser `(repo, events, sla, clients, systems)`, con `systems` quinto.
- **No cambian:** `Ticket.projectId` en la entidad y en `web/src/api/types.ts`, ni `TicketAIService`, que sigue leyendo `ticket.projectId` de los tickets viejos.

- [ ] **Step 1: Escribir la prueba que falla**

En `backend/src/modules/tickets/tickets.service.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTicketDto } from './dto/create-ticket.dto';

describe('el proyecto sale del ticket', () => {
  it('el alta ya no escribe proyecto, aunque lo manden', async () => {
    const { service, repo } = makeService();
    await service.create(
      { kind: 'STAFF', userId: 5 },
      { rawText: 'algo', clientId: 7, systemId: 5, projectId: 42 } as any,
    );
    expect(repo.savedTickets[0].projectId).toBeUndefined();
  });

  // La misma configuracion que `createGlobalValidationPipe()`: es la que
  // convierte "el DTO no lo declara" en un 400 de verdad.
  it('el DTO rechaza un projectId con la lista blanca global', async () => {
    const dto = plainToInstance(CreateTicketDto, { rawText: 'algo', projectId: 42 });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map((e) => e.property)).toContain('projectId');
  });
});
```

- [ ] **Step 2: Ver que falla**

Run: `cd backend && npx jest src/modules/tickets/tickets.service.spec.ts`
Expected: FAIL — se escribe `projectId: 42` y el DTO lo acepta.

- [ ] **Step 3: Sacarlo del DTO, del servicio, del controlador y del repositorio**

- `dto/create-ticket.dto.ts`: borra la línea `@IsOptional() @IsInt() @Min(1) projectId?: number;`.
- `tickets.service.ts`: borra el `import { ProjectsService }`, el parámetro `projects` del constructor, las dos líneas `if (dto.projectId ...) await this.projects.findById(...)` de `create` y de `update`, y `projectId: dto.projectId ?? null,` del `ticketRepo.create({...})`.
- `tickets.controller.ts`: borra el `@Query('projectId')` de `list` y su entrada en el objeto que pasa al servicio.
- `tickets.repository.ts`: borra `projectId?: number;` de `TicketListFilters` y su `andWhere`.
- `tickets.service.spec.ts`: borra el doble `projects` y su argumento del constructor (el `systems` de la tarea 2 pasa a ser el quinto).

Deja escrito en el docblock de `CreateTicketDto` por qué la columna sigue en la entidad: el dato de los tickets viejos se conserva y `pushToJira` sigue funcionando para ellos (decisión 7 del diseño).

- [ ] **Step 4: Sacarlo del panel**

- `web/src/api/tickets.api.ts`: borra `projectId?: number;` de `CreateTicketBody` y de `TicketListParams`.
- `web/src/pages/tickets/NewTicketDialog.tsx`: borra el import de `projectsApi` y el del tipo `Project`, el estado `projectId` y `projects`, el `useEffect` que carga proyectos, el `projectId` del cuerpo de `ticketsApi.create`, el `setProjectId('')` de los dos sitios donde se resetea, y el `<label>` entero del selector de proyecto. El `grid` de tres columnas que quedaba con Cliente / Proyecto / Sistema pasa a `gridTemplateColumns: '1fr 1fr'` con Cliente y Sistema.

- [ ] **Step 5: Ver que pasa todo**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS.

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/tickets web/src/api/tickets.api.ts web/src/pages/tickets/NewTicketDialog.tsx
git commit -m "refactor(tickets): el proyecto sale del ticket; la columna y sus datos se quedan"
```

---

### Task 5: El proyecto sale del requerimiento

Mismo movimiento que la tarea 4, en `work_items`, y por el mismo motivo las dos mitades van juntas.

**Files:**
- Modify: `backend/src/modules/work-items/dto/create-work-item.dto.ts`
- Modify: `backend/src/modules/work-items/work-items.service.ts`
- Modify: `backend/src/modules/work-items/work-items.service.spec.ts`
- Modify: `backend/src/modules/work-items/work-items.controller.ts`
- Modify: `backend/src/modules/work-items/work-items.repository.ts`
- Modify: `web/src/api/work-items.api.ts`
- Modify: `web/src/pages/work-items/NewWorkItemDialog.tsx`
- Modify: `web/src/pages/work-items/WorkItemPanel.tsx`

**Interfaces:**
- Consume: nada de las tareas anteriores.
- Produce: `CreateWorkItemDto` sin `projectId` (y `UpdateWorkItemDto`, que deriva de él, tampoco). `WorkItemListFilters` sin `projectId`. `WorkItemsService` deja de depender de `ProjectsService`: el constructor pasa a ser `(repo, events, clients)`.
- **No cambia:** `WorkItem.projectId` en la entidad ni en `web/src/api/types.ts`.

- [ ] **Step 1: Escribir la prueba que falla**

En `backend/src/modules/work-items/work-items.service.spec.ts`, `makeService` expone una llave más junto a `itemRepoFind`, porque la fila que se escribe se arma en `create` y hoy no hay forma de mirarla:

```ts
    itemRepoCreate: itemRepoStub.create,
```

y el `describe` nuevo:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateWorkItemDto } from './dto/create-work-item.dto';

describe('el proyecto sale del requerimiento', () => {
  it('el alta ya no escribe proyecto, aunque lo manden', async () => {
    const { service, itemRepoCreate } = makeService();
    await service.create(1, { clientId: 7, title: 'Algo', projectId: 42 } as any);
    expect(itemRepoCreate.mock.calls[0][0]).not.toHaveProperty('projectId');
  });

  it('el DTO rechaza un projectId con la lista blanca global', async () => {
    const dto = plainToInstance(CreateWorkItemDto, { clientId: 7, title: 'Algo', projectId: 42 });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map((e) => e.property)).toContain('projectId');
  });
});
```

- [ ] **Step 2: Ver que falla**

Run: `cd backend && npx jest src/modules/work-items/work-items.service.spec.ts`
Expected: FAIL — se escribe `projectId: 42` y el DTO lo acepta.

- [ ] **Step 3: Sacarlo del backend**

- `dto/create-work-item.dto.ts`: borra `@IsOptional() @IsInt() @Min(1) projectId?: number;`.
- `work-items.service.ts`: borra el import y el parámetro `projects`, las dos líneas `if (dto.projectId !== undefined) await this.projects.findById(dto.projectId);` (en `create` y en `update`) y `projectId: dto.projectId ?? null,` del `itemRepo.create({...})`.
- `work-items.controller.ts` y `work-items.repository.ts`: fuera el filtro por proyecto, igual que en la tarea 4.
- `work-items.service.spec.ts`: fuera el doble `projects`, su argumento del constructor y la prueba que ya existe, `'valida el proyecto solo si viene'` — comprueba una validación que a partir de aquí no existe.

- [ ] **Step 4: Sacarlo del panel**

- `web/src/api/work-items.api.ts`: borra `projectId?: number;` de `WorkItemListParams` y de `CreateWorkItemBody`.
- `web/src/pages/work-items/NewWorkItemDialog.tsx`: borra el estado `projectId`, la carga de proyectos, el `projectId` del cuerpo del alta y el `<label>` del selector.
- `web/src/pages/work-items/WorkItemPanel.tsx`: borra el `const projectId = detail?.workItem.projectId ?? null;`, el efecto que resuelve el nombre del proyecto y la fila «Proyecto» de la ficha.

- [ ] **Step 5: Ver que pasa todo**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS.

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/work-items web/src/api/work-items.api.ts web/src/pages/work-items
git commit -m "refactor(requerimientos): el proyecto sale del requerimiento; la columna y sus datos se quedan"
```

---

### Task 6: El sistema en pantalla — se pide primero, se exige, y se ve en la ficha

La mitad de pantalla de la regla que la tarea 2 ya hace cumplir en el servidor. Entre los dos despliegues el comportamiento ya era correcto —un 400 con mensaje en español, sin perder lo escrito—; esto es lo que lo convierte en un formulario que se entiende antes de enviarlo. Y cierra el único sitio donde el nuevo clasificador no se veía: la ficha del ticket, que hoy enseña el cliente y **no enseña el sistema**.

**Files:**
- Modify: `web/src/pages/tickets/system-field.ts`
- Modify: `web/src/pages/portal/NewPortalTicketDialog.tsx`
- Modify: `web/src/pages/tickets/NewTicketDialog.tsx`
- Modify: `web/src/pages/TicketDetailPage.tsx`

**Interfaces:**
- Consume: `systemFieldState`, `SIN_SISTEMAS_PORTAL`, `SIN_SISTEMAS_PANEL`, `SIN_SISTEMAS_PANEL_ENLACE`, `clientSystemsHref` (tarea 1); el mensaje del servidor `'Elige el sistema afectado.'` (tarea 2).
- Produce, en `system-field.ts`: `const ELIGE_SISTEMA: string` (mismo literal, carácter a carácter, que lanza `resolveTicketSystem`), `const ELIGE_SISTEMA_OPCION: string` para el texto del `<option>` vacío, y `function systemLabel(system: { name: string; isActive: number } | undefined, systemId: number | null): string`.

- [ ] **Step 1: Escribir el consumo, y ver que el compilador falla**

En `web/src/pages/portal/NewPortalTicketDialog.tsx`, amplía el import:

```tsx
import { ELIGE_SISTEMA, ELIGE_SISTEMA_OPCION, SIN_SISTEMAS_PORTAL, systemFieldState } from '../tickets/system-field';
```

Run: `cd web && npx tsc --noEmit`
Expected: FAIL — `has no exported member 'ELIGE_SISTEMA'`.

- [ ] **Step 2: Los dos textos nuevos**

En `web/src/pages/tickets/system-field.ts`:

```ts
/**
 * El mismo literal que lanza `resolveTicketSystem` en el backend
 * (`modules/tickets/domain/system-requirement.ts`). Se repite aqui, y no se
 * pide al servidor, porque esta guarda existe para que la peticion **no** salga:
 * si los dos textos divergen alguna vez, el usuario lee dos redacciones del
 * mismo rechazo, que es peor que leer una sola.
 */
export const ELIGE_SISTEMA = 'Elige el sistema afectado.';

/** El `<option>` vacio cuando hay sistemas: no es una eleccion, es un hueco. */
export const ELIGE_SISTEMA_OPCION = '(elige un sistema)';

/**
 * Como se nombra el sistema de un ticket ya creado.
 *
 * Un sistema desactivado **se sigue viendo**, con la marca: el ticket viejo
 * conserva su `system_id` y borrar el dato del pasado para que cuadre el
 * presente es falsificar el historico. Si el catalogo no trae ese id --porque
 * la lista no cargo--, se cae al numero antes que a un guion: un guion diria
 * "este ticket no tiene sistema", que es otra cosa.
 */
export function systemLabel(
  system: { name: string; isActive: number } | undefined,
  systemId: number | null,
): string {
  if (systemId === null) return '—';
  if (!system) return String(systemId);
  return system.isActive === 1 ? system.name : `${system.name} (inactivo)`;
}
```

- [ ] **Step 3: El portal: el sistema sube, se marca y se preselecciona**

En `NewPortalTicketDialog.tsx`:

- El bloque del campo «Sistema» se **mueve** por encima del de «Asunto».
- La etiqueta es `Sistema *` cuando el estado es `'ELEGIBLE'`, y `Sistema (opcional)` cuando es `'SIN_SISTEMAS'`.
- El `<option>` vacío pasa de `(sin sistema)` a `{ELIGE_SISTEMA_OPCION}`.
- En el `.then` de `listSystems`, cuando la lista tiene **exactamente uno**, queda elegido: `if (list.length === 1) setSystemId(list[0].id);`. Es el caso más común —una empresa, un sistema arrendado— y convertirlo en un clic obligatorio sería cobrarle al cliente una ceremonia sin información.
- `canSubmit` gana la condición: `&& (systems.length === 0 || systemId !== '')`.
- En `create`, junto a la comprobación de asunto y descripción:

```tsx
    if (systems.length > 0 && systemId === '') {
      setErrors([ELIGE_SISTEMA]);
      return;
    }
```

- [ ] **Step 4: El panel: lo mismo, con el cliente delante**

En `NewTicketDialog.tsx`:

- El bloque de Cliente + Sistema se **mueve** por encima de «Texto de la solicitud»: el cliente decide qué sistemas hay, así que es lo primero que se contesta.
- La etiqueta es `Sistema *` cuando el estado es `'ELEGIBLE'`.
- Preselección del único: el `.then` de `clientSystemsApi.list` ya calcula la lista de activos para `setSystems`; dale nombre (`const activos = list.filter((s) => s.isActive === 1);`) y, detrás del `setSystems(activos)`, `if (activos.length === 1) setSystemId(activos[0].id);`.
- El `<option>` vacío con cliente y sistemas pasa a `{ELIGE_SISTEMA_OPCION}`.
- La guarda de `create`, con el mismo texto:

```tsx
    if (systems.length > 0 && systemId === '') {
      setError(ELIGE_SISTEMA);
      return;
    }
```

- El `disabled` del botón «Crear ticket» añade `|| (systems.length > 0 && systemId === '')`.

- [ ] **Step 5: La ficha del ticket enseña el sistema**

En `web/src/pages/TicketDetailPage.tsx`, junto al efecto que ya resuelve el nombre del cliente y con la misma forma (bandera `cancelled`, fallo a consola y no a la pantalla, porque es un dato de apoyo y no la razón de la página):

```tsx
  const [systems, setSystems] = useState<ClientSystem[]>([]);
  useEffect(() => {
    if (!clientId) {
      setSystems([]);
      return;
    }
    let cancelled = false;
    clientSystemsApi
      .list(clientId)
      .then((list) => {
        if (!cancelled) setSystems(list);
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn('[TicketDetailPage] No se pudieron cargar los sistemas del cliente.', e);
          setSystems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);
```

y, en la «Ficha», **justo debajo** de `<Field label="Cliente" …>` porque el sistema cuelga del cliente:

```tsx
              <Field
                label="Sistema"
                value={systemLabel(
                  systems.find((s) => Number(s.id) === Number(ticket.systemId)),
                  ticket.systemId,
                )}
              />
```

Importa `clientSystemsApi` de `../api/tickets.api`, el tipo `ClientSystem` de `../api/types` y `systemLabel` de `./tickets/system-field`. La comparación va por valor (`Number(...)`) y no con `===` por lo de siempre: los `bigint` llegan como cadena.

- [ ] **Step 6: Comprobar que compila y que el paquete se construye**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/tickets/system-field.ts web/src/pages/portal/NewPortalTicketDialog.tsx web/src/pages/tickets/NewTicketDialog.tsx web/src/pages/TicketDetailPage.tsx
git commit -m "feat(tickets): el sistema abre el formulario, es obligatorio y se ve en la ficha"
```

---

### Task 7: Dar de alta los sistemas entra en el alta del cliente

**Files:**
- Modify: `web/src/pages/ClientsListPage.tsx`
- Modify: `web/src/pages/ClientDetailPage.tsx`
- Modify: `web/src/pages/tickets/ClientSystemsTab.tsx`

**Interfaces:**
- Consume: `clientSystemsHref` y `SIN_SISTEMAS_PANEL` (tarea 1); `clientSystemsApi.list` (ya existe).
- Produce: nada que otra tarea consuma. Es la última.

- [ ] **Step 1: Escribir el consumo, y ver que el compilador falla**

En `web/src/pages/ClientsListPage.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { clientSystemsHref } from './tickets/system-field';
```

Run: `cd web && npx tsc --noEmit`
Expected: FAIL — `'useNavigate' is declared but its value is never read` y lo mismo de `clientSystemsHref`. (`web/tsconfig.json` tiene `noUnusedLocals: true`, así que un import sin usar ya es un error.)

- [ ] **Step 2: Al crear un cliente, se va a su pestaña «Sistemas»**

En `ClientsListPage.tsx`, `const navigate = useNavigate();` junto a los demás hooks del componente, y el `onSuccess` de la mutación recibe el cliente creado y navega:

```tsx
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      setForm(EMPTY_FORM);
      setShowForm(false);
      // El momento en que alguien acaba de escribir quien es el cliente es el
      // momento en que sabe que le arrienda. No se bloquea nada: si no rellena
      // nada, ya esta en la ficha, que es donde iba a acabar igualmente.
      navigate(clientSystemsHref(created.id));
    },
```

- [ ] **Step 3: La ficha avisa cuando un cliente no tiene sistemas**

En `ClientDetailPage.tsx`, con `clientSystemsApi` importado de `../api/tickets.api` y `SIN_SISTEMAS_PANEL` de `./tickets/system-field`, una consulta más junto a las que ya hay:

```tsx
  const { data: systems = [] } = useQuery({
    queryKey: ['client-systems', id],
    queryFn: () => clientSystemsApi.list(id),
  });
```

y, justo debajo de las pestañas, el aviso — **solo** para un cliente en estado `CLIENT` y sin ningún sistema activo. Un prospecto no lo recibe: no arrienda nada todavía, y avisar de una falta que no lo es enseña a ignorar los avisos.

```tsx
      {client.status === 'CLIENT' && systems.filter((s) => s.isActive === 1).length === 0 && (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-600">
              {SIN_SISTEMAS_PANEL}{' '}
              <button
                type="button"
                onClick={() => setTab('systems')}
                className="font-semibold text-kubo-primary-dark underline"
              >
                Dar de alta el primero
              </button>
            </p>
          </CardBody>
        </Card>
      )}
```

- [ ] **Step 4: El texto de la pestaña vacía deja de prometer de menos**

En `ClientSystemsTab.tsx`, el mensaje de lista vacía pasa a decir lo que ocurre de verdad desde la tarea 2:

```tsx
          Este cliente no tiene sistemas registrados. Sus tickets se podrán crear igualmente, pero
          quedarán sin clasificar: no se podrán agrupar por sistema ni en la bandeja ni en su
          informe mensual.
```

- [ ] **Step 5: Comprobar que compila y que el paquete se construye**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 6: La comprobación completa, por última vez**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/ClientsListPage.tsx web/src/pages/ClientDetailPage.tsx web/src/pages/tickets/ClientSystemsTab.tsx
git commit -m "feat(clientes): dar de alta los sistemas entra en el alta del cliente"
```

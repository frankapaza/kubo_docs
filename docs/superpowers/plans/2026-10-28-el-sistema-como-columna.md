# El sistema como columna del soporte — Plan de implementación

> **Para trabajadores agénticos:** SUB-HABILIDAD REQUERIDA: usa superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans para implementar este plan tarea a tarea. Los pasos usan casillas (`- [ ]`) para poder marcarlos.

**Goal:** Que el sistema sea el clasificador del soporte y que «sistema» signifique lo mismo para todos los clientes: un catálogo global de productos que la casa arrienda, asignados a cada cliente de una lista, exigidos en el ticket cuando el cliente tiene alguno, elegidos solos por la ingesta cuando no hay a quién preguntar — y el proyecto fuera del ticket y del requerimiento sin borrar un solo dato.

**Architecture:** El nombre del sistema sube a una tabla nueva, `systems` (el producto), y `client_systems` se queda con la pareja cliente-producto (la relación comercial), ganando `system_id` y perdiendo la obligación de traer nombre. **`tickets.system_id` sigue apuntando a `client_systems`** —que es donde apunta hoy— y ninguna fila de `tickets` se toca: del ticket se llega al producto con una unión. La migración 028 convierte lo que ya existe **solo donde no hay duda** y anota lo dudoso en `system_catalog_conflicts` sin tocarlo, calcando la 025. La regla del ticket vive una sola vez, en funciones puras de `domain/system-requirement.ts` que `TicketsService` llama con la lista de asignaciones activas ya consultada; la obligación se aplica **en la aplicación, no en la base** (`tickets.system_id` sigue admitiendo vacío). La ingesta se exime con un valor nombrado, nunca deduciéndolo del `origin`. El proyecto desaparece de los DTO, de los filtros y de los diálogos; las columnas y sus datos se quedan.

**Tech Stack:** NestJS 10 · TypeORM 0.3 (`synchronize: false`) · MySQL 8 · Jest 29 (con `TZ=UTC` forzado desde `jest.config.js`) · React 18 + Vite + TypeScript + Tailwind

**Spec:** `docs/superpowers/specs/2026-10-28-el-sistema-como-columna-design.md`

## Global Constraints

Todas las tareas de este plan las incluyen implícitamente. Van copiadas al pie de la letra.

- **`synchronize: false`**: toda migración es SQL a mano, **idempotente**, con el patrón de procedimientos guardados que consultan `information_schema` de las anteriores. **Mira cuál es el número libre siguiente y tiene que ir en las TRES listas de despliegue** (`.github/workflows/deploy.yml`, `docker-compose.yml`, `docker-compose.dev.yml`, donde además hay que renumerar la siembra). Olvidar una **rompe el arranque en producción**.
- **TypeORM devuelve `bigint` como cadena.** Nunca `===` entre identificadores; usa `sameId` de `backend/src/common/ids.ts`.
- **Transacciones:** `runInTransaction` + `manager.getRepository(...)`, jamás el repositorio inyectado.
- **Proyección campo a campo con lista blanca**; nunca la entidad cruda.
- **404, no 403**, para recursos de otra empresa; y en el portal **la empresa sale siempre de la sesión**, jamás del cuerpo.
- **Producción y el CI corren Node 20**; esta máquina tiene Node 24. **Nada puede depender de la versión**, y lo que se mida hay que medirlo en Node 20.
- **Producción corre en UTC y el desarrollo en América/Lima.** Ha habido **siete** fallos de zona horaria en esta serie. Las pruebas fuerzan la zona a universal, así que ejecutar con otra **no demuestra nada**: razona y fija el comportamiento con pruebas que no dependan de la zona del proceso.
- **Los textos van en español.**
- Al final de cada tarea: `cd backend && npx jest && npx tsc --noEmit`, y si toca frontend `cd web && npx tsc --noEmit && npm run build`.

**Sobre la primera restricción, en concreto:** este plan trae **una sola** migración, la **028**, y vive entera en la tarea 2. El número libre siguiente es el 028 (la última es `027_carga_masiva_usuarios.sql`). En `docker-compose.dev.yml` hay que **renumerar la siembra**: `037_seed_templates.sql` pasa a `038_seed_templates.sql` para que la migración entre como `037_mig_028.sql` y siga corriendo antes que el seed. Ninguna otra tarea toca `backend/sql/`, `deploy.yml` ni los dos `docker-compose`.

## Review Focus

Las cinco entradas que la spec implica y que, sin esto escrito, ninguna tarea probaría. Cada línea tiene su prueba añadida a la tarea que posee el código, en el estilo de pasos de esa tarea.

1. **`DELETE` de una asignación que tiene tickets colgando.** Hoy `ClientSystemsService.remove` borra sin mirar nada, y a partir de aquí eso deja tickets apuntando a una fila que ya no existe: el informe por sistema leería un `system_id` que no resuelve a ningún nombre. Tiene que responder 409 y no borrar. → Tarea 4.
2. **Un `systemId` de otra empresa enviado a `POST /tickets` desde el panel.** Hoy se escribe sin comprobar nada. Tiene que responder 400 y no escribir ni el ticket. → Tarea 7.
3. **Una asignación que la migración marcó** (su `system_id` quedó vacío porque el nombre estaba en varios clientes). No tiene nombre de catálogo que enseñar: no puede aparecer en el desplegable, no puede elegirse y no puede hacer que se exija nada. El cliente se comporta como uno sin sistemas. → Tarea 4.
4. **La ingesta de correo de un cliente con dos o más sistemas activos**: el ticket entra **sin sistema** y el correo **no se descarta** ni se cuenta como error. Un correo perdido es una petición de cliente perdida. → Tarea 8.
5. **`PATCH /tickets/:id` sobre un ticket viejo sin sistema, tocando solo el asunto**: no puede fallar. La obligación no es retroactiva. → Tarea 7.

---

## Estructura de ficheros

**Dónde vive el catálogo, y por qué no en un módulo propio.** Todo lo nuevo del backend entra en `backend/src/modules/tickets/`, junto a `client-systems.*` y a la entidad que ya está ahí. Un `modules/systems/` sería más limpio sobre el papel, pero el borrado del catálogo necesita preguntarle a `ClientSystemsRepository` si alguien lo tiene asignado, y eso cruzaría los dos módulos en las dos direcciones. Los ficheros que cambian juntos viven juntos.

**Backend — se crean:**
- `backend/src/common/migraciones-desplegadas.spec.ts` — el guardián de las tres listas de despliegue.
- `backend/src/modules/tickets/entities/system.entity.ts` — el catálogo.
- `backend/src/modules/tickets/systems.repository.ts`, `systems.service.ts` (+ spec), `systems.controller.ts`, `dto/system.dto.ts`.
- `backend/src/modules/tickets/client-systems.service.spec.ts` — la asignación no tenía pruebas.
- `backend/src/modules/tickets/domain/system-requirement.ts` (+ spec) — la regla entera, **pura**: sin base, sin reloj, sin Nest más allá de las excepciones HTTP (mismo patrón que `domain/ticket-state-machine.ts`, que ya lanza `BadRequestException`).
- `backend/sql/migrations/028_catalogo_de_sistemas.sql`.

**Backend — se modifican:**
- `backend/src/modules/tickets/entities/client-system.entity.ts` — gana `systemId`, `name` pasa a admitir vacío.
- `backend/src/modules/tickets/client-systems.repository.ts` — la lista pasa a venir unida al catálogo; `listActiveByClient`, `countBySystem`.
- `backend/src/modules/tickets/client-systems.service.ts`, `client-systems.controller.ts`, `dto/client-system.dto.ts` — se asigna del catálogo, ya no se teclea; guardas de rol.
- `backend/src/modules/tickets/tickets.repository.ts` — `countByClientAndSystem`; fuera el filtro por proyecto.
- `backend/src/modules/tickets/tickets.module.ts` — la entidad y las piezas del catálogo.
- `backend/src/modules/tickets/tickets.service.ts` (+ spec) — aplica la regla en `create`, comprueba pertenencia en `update`, pierde `ProjectsService`.
- `backend/src/modules/tickets/dto/create-ticket.dto.ts`, `tickets.controller.ts` — sin `projectId`.
- `backend/src/modules/inbound-email/inbound-email.service.ts` (+ spec) — la exención nombrada y el sistema único.
- `backend/src/modules/portal/portal-tickets.service.ts` (+ spec) — su lista sale de las asignaciones con catálogo.
- `backend/src/modules/work-items/dto/create-work-item.dto.ts`, `work-items.service.ts` (+ spec), `work-items.controller.ts`, `work-items.repository.ts`.
- `.github/workflows/deploy.yml`, `docker-compose.yml`, `docker-compose.dev.yml`.

**Web — se crean:**
- `web/src/pages/tickets/system-field.ts` — los textos del campo «Sistema» y el estado en que está, compartidos por el diálogo del panel y el del portal.
- `web/src/pages/SystemCatalogPage.tsx` — el alta, baja y modificación del catálogo.

**Web — se modifican:**
- `web/src/auth/permissions.ts` — quién asigna y quién mantiene el catálogo.
- `web/src/api/tickets.api.ts` (`systemsApi`, `clientSystemsApi`), `web/src/api/types.ts`, `web/src/api/work-items.api.ts`.
- `web/src/pages/tickets/ClientSystemsTab.tsx` — de teclear a asignar.
- `web/src/pages/tickets/NewTicketDialog.tsx`, `web/src/pages/portal/NewPortalTicketDialog.tsx`.
- `web/src/pages/TicketDetailPage.tsx` — la ficha del ticket pasa a enseñar el sistema.
- `web/src/pages/ClientDetailPage.tsx`, `web/src/pages/ClientsListPage.tsx`.
- `web/src/pages/work-items/NewWorkItemDialog.tsx`, `WorkItemPanel.tsx`.
- `web/src/App.tsx`, `web/src/layout/AppLayout.tsx`.

**No se tocan, y es una decisión:** `backend/src/modules/projects/` entero, `TicketAIService` (sigue leyendo `ticket.projectId` para los tickets viejos), `web/src/pages/ProjectsPage.tsx` y el menú principal.

---

### Task 1: El desplegable vacío se explica — portal y panel

Es la tarea que se hace **pase lo que pase con el resto**: si el plan se parase aquí, el fallo que destapó todo esto ya estaría arreglado. No depende del catálogo ni de la migración.

**Files:**
- Create: `web/src/pages/tickets/system-field.ts`
- Modify: `web/src/auth/permissions.ts`
- Modify: `web/src/pages/portal/NewPortalTicketDialog.tsx`
- Modify: `web/src/pages/tickets/NewTicketDialog.tsx`
- Modify: `web/src/pages/ClientDetailPage.tsx`

**Interfaces:**
- Consume: nada (primera tarea).
- Produce, en `web/src/pages/tickets/system-field.ts`:
  - `type SystemFieldState = 'SIN_CLIENTE' | 'CARGANDO' | 'SIN_SISTEMAS' | 'ELEGIBLE'`
  - `function systemFieldState(params: { hasClient: boolean; loaded: boolean; count: number }): SystemFieldState`
  - `const SIN_SISTEMAS_PORTAL: string`, `const SIN_SISTEMAS_PANEL: string`, `const SIN_SISTEMAS_PANEL_ENLACE: string`, `const SIN_SISTEMAS_PANEL_SIN_PERMISO: string`
  - `function clientSystemsHref(clientId: number): string`
- Produce, en `web/src/auth/permissions.ts`: `const canManageClientSystems: (user: User | null) => boolean` — `ADMIN` o `PRODUCT_OWNER`, la misma regla que `canCreateProject`.
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

Exporta lo del bloque **Interfaces**. `systemFieldState` devuelve `'SIN_CLIENTE'` sin cliente, `'CARGANDO'` si todavía no cargó, `'SIN_SISTEMAS'` con `count === 0` y `'ELEGIBLE'` en otro caso. `clientSystemsHref(id)` devuelve `` `/clients/${id}?tab=systems` ``.

Los cuatro textos, carácter a carácter:

```ts
export const SIN_SISTEMAS_PORTAL =
  'Tu empresa aún no tiene sistemas registrados. Puedes crear el ticket igualmente; lo clasificaremos nosotros.';
export const SIN_SISTEMAS_PANEL =
  'Este cliente no tiene sistemas asignados. El ticket se puede crear igual, pero queda sin clasificar.';
export const SIN_SISTEMAS_PANEL_ENLACE = 'Asignarle el primero';
export const SIN_SISTEMAS_PANEL_SIN_PERMISO =
  'Pídele a un administrador que le asigne sus sistemas.';
```

En el docblock del módulo: los textos viven juntos a propósito, porque son mensajes distintos para lectores distintos —el cliente, que no puede asignar nada; el equipo, que a veces sí— y la única forma de revisar que siguen diciendo lo mismo es verlos en la misma pantalla. En el de `systemFieldState`, por qué `loaded` existe: sin él, el aviso de «no tiene sistemas» parpadea en cada apertura mientras la lista viaja, y un aviso que aparece y se va es ruido.

- [ ] **Step 3: `canManageClientSystems` en `web/src/auth/permissions.ts`**

Junto a `canCreateProject`, con su misma forma. En el comentario: asignar un sistema a un cliente es un hecho de la relación comercial, del mismo peso que editar su ficha, así que lleva la misma guarda (decisión 5 del diseño).

- [ ] **Step 4: Que el enlace del panel aterrice en la pestaña correcta**

En `web/src/pages/ClientDetailPage.tsx`, la pestaña inicial deja de ser siempre `'summary'`: sale de `?tab=` (`useSearchParams`) cuando ese valor está en la lista blanca `'projects' | 'documents' | 'systems'`, y es `'summary'` en cualquier otro caso. **La lista blanca no es defensiva:** sin ella, un `?tab=` cualquiera dejaría la ficha sin ninguna pestaña pintada, porque `tab === t.key` sería falso para las cuatro.

- [ ] **Step 5: El portal pinta el aviso en vez del desplegable**

En `NewPortalTicketDialog.tsx`: un estado nuevo `const [systemsLoaded, setSystemsLoaded] = useState(false);`, puesto a `false` en el reset de apertura y a `true` tanto en el `.then` como en el `.catch` del `listSystems` (un fallo de carga es «no hay lista», y el alta sigue siendo posible: eso ya está decidido en el comentario que hay sobre ese efecto).

El bloque del campo pasa a decidir con `systemFieldState({ hasClient: true, loaded: systemsLoaded, count: systems.length })`: con `'SIN_SISTEMAS'` se pinta `<p>{SIN_SISTEMAS_PORTAL}</p>` en lugar del `<select>`; en cualquier otro caso, el `<select>` de siempre.

- [ ] **Step 6: El panel pinta el aviso, con enlace o sin él según quién mire**

En `NewTicketDialog.tsx`: el mismo estado `systemsLoaded` (a `false` en el reset y cuando cambia el cliente elegido, a `true` en el `.then` y en el `.catch`), y el `<label>` del sistema decide con `systemFieldState({ hasClient: Boolean(clientId), loaded: systemsLoaded, count: systems.length })`:

- `'SIN_SISTEMAS'` → el aviso en vez del `<select>`. Con `canManageClientSystems(user)` cierto, `{SIN_SISTEMAS_PANEL}` seguido de un `<Link to={clientSystemsHref(Number(clientId))}>{SIN_SISTEMAS_PANEL_ENLACE}</Link>`; con falso, `{SIN_SISTEMAS_PANEL}` seguido de `{SIN_SISTEMAS_PANEL_SIN_PERMISO}` y **sin enlace**. Un enlace que lleva a una grilla de solo lectura promete una salida que no está.
- `'SIN_CLIENTE'` y `'CARGANDO'` → el `<select>` deshabilitado que ya existe, con su texto «Elige un cliente primero».
- `'ELEGIBLE'` → el `<select>` de siempre.

- [ ] **Step 7: Comprobar que compila y que el paquete se construye**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: PASS, sin errores.

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/tickets/system-field.ts web/src/auth/permissions.ts web/src/pages/portal/NewPortalTicketDialog.tsx web/src/pages/tickets/NewTicketDialog.tsx web/src/pages/ClientDetailPage.tsx
git commit -m "fix(tickets): el desplegable de sistemas vacio se explica, y lleva al alta a quien puede hacerla"
```

---

### Task 2: La migración 028 — el catálogo, la asignación, y lo dudoso anotado sin tocar

**Files:**
- Create: `backend/src/common/migraciones-desplegadas.spec.ts`
- Create: `backend/sql/migrations/028_catalogo_de_sistemas.sql`
- Create: `backend/src/modules/tickets/entities/system.entity.ts`
- Modify: `backend/src/modules/tickets/entities/client-system.entity.ts`
- Modify: `backend/src/modules/tickets/tickets.module.ts`
- Modify: `.github/workflows/deploy.yml`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`

**Interfaces:**
- Consume: nada.
- Produce, en `entities/system.entity.ts`: `class System` sobre `@Entity('systems')` con `id!: number`, `name!: string`, `isActive!: number` (`is_active`, `tinyint`), `createdAt`, `updatedAt`.
- Produce, en `entities/client-system.entity.ts`: `systemId!: number | null` (`system_id`, `bigint unsigned`, nullable) y `name!: string | null`.
- Produce: la tabla `systems` (`UNIQUE KEY uq_systems_name`), la columna `client_systems.system_id` (`UNIQUE KEY uq_client_systems_system (client_id, system_id)`) y la tabla `system_catalog_conflicts`.

- [ ] **Step 1: Escribir el guardián de las tres listas**

Crea `backend/src/common/migraciones-desplegadas.spec.ts`:

```ts
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/** `backend/src/common` → la raíz del repositorio. */
const RAIZ = join(__dirname, '..', '..', '..');
const MIGRACIONES = join(RAIZ, 'backend', 'sql', 'migrations');

const LISTAS_DE_DESPLIEGUE = [
  join(RAIZ, '.github', 'workflows', 'deploy.yml'),
  join(RAIZ, 'docker-compose.yml'),
  join(RAIZ, 'docker-compose.dev.yml'),
];

/** La de número más alto: la que se acaba de escribir. */
function ultimaMigracion(): string {
  const nombres = readdirSync(MIGRACIONES)
    .filter((n) => /^\d{3}_.+\.sql$/.test(n))
    .sort();
  if (nombres.length === 0) throw new Error('No hay ninguna migración en backend/sql/migrations.');
  return nombres[nombres.length - 1].replace(/\.sql$/, '');
}

describe('la última migración está en las tres listas de despliegue', () => {
  it.each(LISTAS_DE_DESPLIEGUE)('%s la nombra', (lista) => {
    expect(readFileSync(lista, 'utf8')).toContain(ultimaMigracion());
  });
});

describe('la migración del catálogo no borra ni una fila', () => {
  const sql = () =>
    readFileSync(join(MIGRACIONES, '028_catalogo_de_sistemas.sql'), 'utf8').toUpperCase();

  it.each(['DROP TABLE', 'TRUNCATE', 'DELETE FROM'])('no contiene «%s»', (prohibido) => {
    expect(sql()).not.toContain(prohibido);
  });

  it('anota los dudosos en su propia tabla en vez de decidir por ellos', () => {
    expect(sql()).toContain('SYSTEM_CATALOG_CONFLICTS');
  });
});
```

En el docblock del fichero, por qué existe: es el único fallo de esta fase que **rompe el arranque en producción** y que ninguna prueba de código detectaría — el backend compila, las pruebas pasan, y la tabla no está. Mismo recurso que `bulk-users-contrato-web.spec.ts`, que ya lee un fichero del repositorio desde el backend porque es la única punta desde la que se ven las dos listas a la vez.

- [ ] **Step 2: Ver que el guardián funciona antes de fiarse de él**

Run: `cd backend && npx jest src/common/migraciones-desplegadas.spec.ts`
Expected: el primer `describe` PASA (la 027 sí está en las tres listas: eso prueba que el guardián lee los ficheros correctos y no tres rutas inexistentes). El segundo FALLA con `ENOENT ... 028_catalogo_de_sistemas.sql`.

Un guardián que nunca se ha visto en verde no distingue «falta la migración» de «la ruta está mal».

- [ ] **Step 3: Escribir `backend/sql/migrations/028_catalogo_de_sistemas.sql`**

Idempotente, con el patrón de procedimientos guardados que consultan `information_schema` de la 027 (`kubo_add_column_027`, `kubo_relax_column_027`, `kubo_add_check_027`) y el patrón de detección sin tocar de la 025 (`kubo_normalize_emails_025`). Siete secciones, en este orden:

1. `CREATE TABLE IF NOT EXISTS systems` — `id BIGINT UNSIGNED AUTO_INCREMENT PK`, `name VARCHAR(120) NOT NULL`, `is_active TINYINT(1) NOT NULL DEFAULT 1`, `created_at`/`updated_at` como sus hermanas, `UNIQUE KEY uq_systems_name (name)`, `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`.
2. `CREATE TABLE IF NOT EXISTS system_catalog_conflicts` — `id`, `client_system_id BIGINT UNSIGNED NOT NULL`, `client_id BIGINT UNSIGNED NOT NULL`, `nombre VARCHAR(120) NOT NULL`, `motivo VARCHAR(32) NOT NULL COMMENT 'NOMBRE_EN_VARIOS_CLIENTES o DUPLICADO_EN_EL_MISMO_CLIENTE'`, `detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`, `UNIQUE KEY uq_system_catalog_conflict (client_system_id)`. La clave única es lo que hace idempotentes los `INSERT ... ON DUPLICATE KEY UPDATE` de la sección 5, igual que en la 025.
3. `client_systems.system_id BIGINT UNSIGNED NULL AFTER client_id`, guardado por `information_schema.COLUMNS`.
4. `client_systems.name` pasa a `VARCHAR(120) NULL`, guardado por `IS_NULLABLE = 'NO'` (mismo criterio que la sección 2 de la 027: un `MODIFY` sobre una columna que ya admite vacío no da error, pero reescribe la tabla entera en cada pasada).
5. **Los dudosos, marcados y sin tocar.** Dos `INSERT ... ON DUPLICATE KEY UPDATE motivo = VALUES(motivo)`:
   - `NOMBRE_EN_VARIOS_CLIENTES`: las filas cuyo `LOWER(TRIM(name))` aparece con **más de un `client_id` distinto** (`GROUP BY LOWER(TRIM(name)) HAVING COUNT(DISTINCT client_id) > 1`).
   - `DUPLICADO_EN_EL_MISMO_CLIENTE`: dos o más filas del **mismo** `client_id` cuyo `LOWER(TRIM(name))` coincide. La clave única de la 010 impide casi todos —su colación ignora mayúsculas y espacios finales— pero no los iniciales: `«ERP»` y `« ERP»` conviven hoy y chocarían bajo `uq_client_systems_system`.
6. **Lo que no está marcado, convertido.** `INSERT INTO systems (name) SELECT DISTINCT TRIM(cs.name) FROM client_systems cs WHERE NOT EXISTS (<está marcada>) ON DUPLICATE KEY UPDATE name = VALUES(name)`, y después el `UPDATE client_systems cs JOIN systems s ON s.name = TRIM(cs.name) SET cs.system_id = s.id WHERE cs.system_id IS NULL AND NOT EXISTS (<está marcada>)`. Las dos sentencias solo tocan filas no marcadas y solo cuando hay algo que cambiar, así que una segunda pasada no hace nada.
7. `UNIQUE KEY uq_client_systems_system (client_id, system_id)`, guardado por `information_schema.STATISTICS`. **Va después** de la conversión: antes, dos filas marcadas del mismo cliente con `system_id` vacío ya lo cumplirían (MySQL admite varios vacíos en una clave única), pero poner el índice al final deja el orden del fichero contando la historia en el orden en que ocurre.

En la cabecera, lo que la 025 pone en la suya: qué problema resuelve, **qué filas NO se tocan y por qué**, y que lo dudoso lo decide una persona y no una migración. Y lo que esta migración no puede ver: dos nombres que significan el mismo producto pero se escriben distinto son indistinguibles para cualquier SQL, se convierten en dos productos, y el sitio donde eso se limpia es el catálogo, a ojo, una vez.

**Cuidado al redactar esos comentarios:** el guardián del paso 1 lee el fichero entero, comentarios incluidos, así que escribir «no hay ningún `DELETE FROM`» lo pondría en rojo. Di lo que la migración hace, no lo que no escribe.

- [ ] **Step 4: Ver que falla por lo que tiene que fallar**

Run: `cd backend && npx jest src/common/migraciones-desplegadas.spec.ts`
Expected: el segundo `describe` PASA; el primero **FALLA en las tres**, nombrando `028_catalogo_de_sistemas`.

- [ ] **Step 5: Las tres listas**

- `.github/workflows/deploy.yml`: `028_catalogo_de_sistemas` al final del bucle `for m in ...` (línea ~183, detrás de `027_carga_masiva_usuarios`).
- `docker-compose.yml`: un volumen más, `./backend/sql/migrations/028_catalogo_de_sistemas.sql:/docker-entrypoint-initdb.d/028_catalogo_de_sistemas.sql:ro`, con su comentario de dos o tres líneas como los de la 025, 026 y 027.
- `docker-compose.dev.yml`: `./backend/sql/migrations/028_catalogo_de_sistemas.sql:/docker-entrypoint-initdb.d/037_mig_028.sql:ro`, y **la siembra se renumera**: `037_seed_templates.sql` pasa a `038_seed_templates.sql`. Los seeds van detrás de todas las migraciones; dejar el seed en 037 lo haría correr antes que la migración nueva.

El contador de plantillas de `deploy.yml` (`tienen que ser 9`) **no cambia**: esta migración no siembra ninguna plantilla de aviso.

- [ ] **Step 6: Ver que pasa**

Run: `cd backend && npx jest src/common/migraciones-desplegadas.spec.ts`
Expected: PASS.

- [ ] **Step 7: Las dos entidades, con la forma que la migración acaba de crear**

- Crea `backend/src/modules/tickets/entities/system.entity.ts` con la forma del bloque **Interfaces**, calcando el estilo de `client-system.entity.ts`.
- En `client-system.entity.ts`: `systemId` nueva, y `name` pasa a `string | null` (`@Column({ type: 'varchar', length: 120, nullable: true })`). En el docblock de la clase: esta tabla dejó de ser el catálogo y pasó a ser la pareja cliente-producto; `name` se conserva —no se borra— como la única constancia de qué decía una fila que la migración marcó, y de qué nombre dio origen a cada producto.
- En `tickets.module.ts`: `System` entra en `TypeOrmModule.forFeature([...])`.

- [ ] **Step 8: La comprobación completa**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/common/migraciones-desplegadas.spec.ts backend/sql/migrations/028_catalogo_de_sistemas.sql backend/src/modules/tickets/entities backend/src/modules/tickets/tickets.module.ts .github/workflows/deploy.yml docker-compose.yml docker-compose.dev.yml
git commit -m "feat(sistemas): el catalogo y la asignacion en la base, con lo dudoso anotado y sin tocar"
```

---

### Task 3: El catálogo de sistemas — alta, baja y modificación

**Files:**
- Create: `backend/src/modules/tickets/systems.repository.ts`
- Create: `backend/src/modules/tickets/systems.service.ts`
- Create: `backend/src/modules/tickets/systems.service.spec.ts`
- Create: `backend/src/modules/tickets/systems.controller.ts`
- Create: `backend/src/modules/tickets/dto/system.dto.ts`
- Modify: `backend/src/modules/tickets/client-systems.repository.ts`
- Create: `backend/src/modules/tickets/client-systems.repository.spec.ts`
- Modify: `backend/src/modules/tickets/tickets.module.ts`

**Interfaces:**
- Consume: la entidad `System` (tarea 2).
- Produce, en `SystemsRepository`: `list(): Promise<System[]>` (orden por `name`), `listActive(): Promise<System[]>`, `findById(id: number): Promise<System | null>`, `findByName(name: string): Promise<System | null>`, `create(data: Partial<System>): Promise<System>`, `update(id: number, data: Partial<System>): Promise<System | null>`, `remove(id: number): Promise<void>`.
- Produce, en `ClientSystemsRepository`: `countBySystem(systemId: number): Promise<number>`.
- Produce, en `SystemsService`: `list()`, `create(dto: CreateSystemDto): Promise<System>`, `update(id: number, dto: UpdateSystemDto): Promise<System>`, `remove(id: number): Promise<void>`.
- Produce, en `dto/system.dto.ts`: `CreateSystemDto { name: string }` y `UpdateSystemDto { name?: string; isActive?: boolean }`, con los mismos decoradores que `client-system.dto.ts` tiene hoy.
- Produce: `GET/POST/PATCH/DELETE /systems`.

- [ ] **Step 1: Escribir la prueba que falla**

Crea `backend/src/modules/tickets/systems.service.spec.ts`:

```ts
import { SystemsService } from './systems.service';

const makeService = () => {
  const repo = {
    list: jest.fn().mockResolvedValue([]),
    listActive: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue({ id: 3, name: 'ERP Core', isActive: 1 }),
    findByName: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((d) => Promise.resolve({ id: 9, ...d })),
    update: jest.fn().mockImplementation((id, d) => Promise.resolve({ id, ...d })),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const assignments = { countBySystem: jest.fn().mockResolvedValue(0) };
  return { service: new SystemsService(repo as any, assignments as any), repo, assignments };
};

describe('el catalogo de sistemas', () => {
  it('recorta el nombre al darlo de alta', async () => {
    const { service, repo } = makeService();
    await service.create({ name: '  ERP Core  ' } as any);
    expect(repo.create).toHaveBeenCalledWith({ name: 'ERP Core', isActive: 1 });
  });

  it('un nombre repetido se rechaza, y no distingue mayusculas', async () => {
    const { service, repo } = makeService();
    repo.findByName.mockResolvedValue({ id: 3, name: 'ERP Core' });
    await expect(service.create({ name: 'erp core' } as any)).rejects.toThrow(
      'Ya existe un sistema llamado «erp core» en el catálogo.',
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('renombrarse a si mismo no es un duplicado', async () => {
    const { service, repo } = makeService();
    // `findByName` devuelve el mismo id que se esta editando: no hay choque.
    repo.findByName.mockResolvedValue({ id: 3, name: 'ERP Core' });
    await expect(service.update(3, { name: 'ERP CORE' } as any)).resolves.toBeDefined();
  });

  // Por `sameId` y no por `===`: el id que viene de la base es la cadena "3".
  it('el duplicado se compara por valor aunque la base devuelva el id como cadena', async () => {
    const { service, repo } = makeService();
    repo.findByName.mockResolvedValue({ id: '3', name: 'ERP Core' });
    await expect(service.update(3, { name: 'ERP Core' } as any)).resolves.toBeDefined();
  });

  it('retirar del catalogo no toca ninguna asignacion', async () => {
    const { service, repo, assignments } = makeService();
    assignments.countBySystem.mockResolvedValue(4);
    await service.update(3, { isActive: false } as any);
    expect(repo.update).toHaveBeenCalledWith(3, { isActive: 0 });
    // Un producto retirado deja de poder asignarse, pero los cuatro clientes
    // que ya lo tienen siguen abriendo tickets sobre el (decision 3).
    expect(assignments.countBySystem).not.toHaveBeenCalled();
  });

  it('borrar un sistema asignado a alguien se rechaza y no borra nada', async () => {
    const { service, repo, assignments } = makeService();
    assignments.countBySystem.mockResolvedValue(1);
    await expect(service.remove(3)).rejects.toThrow(
      'Este sistema está asignado a algún cliente. Retíralo del catálogo en lugar de borrarlo.',
    );
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('borrar un sistema que nadie tiene si se permite', async () => {
    const { service, repo } = makeService();
    await service.remove(3);
    expect(repo.remove).toHaveBeenCalledWith(3);
  });

  it('un sistema que no existe da 404 al editarlo', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(null);
    await expect(service.update(99, { name: 'X' } as any)).rejects.toThrow('Sistema no encontrado');
  });
});
```

Y crea `backend/src/modules/tickets/client-systems.repository.spec.ts`, para pinchar **dónde** cuenta `countBySystem`: los dobles del servicio no ejecutan la consulta, así que ninguna prueba suya lo detectaría (mismo razonamiento que el docblock de `tickets.repository.spec.ts`).

```ts
import { ClientSystemsRepository } from './client-systems.repository';

const makeRepo = () => {
  const typeormRepo = {
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    findOne: jest.fn().mockResolvedValue(null),
  };
  return { repo: new ClientSystemsRepository(typeormRepo as any), typeormRepo };
};

describe('ClientSystemsRepository', () => {
  it('countBySystem cuenta las asignaciones activas Y las inactivas', async () => {
    const { repo, typeormRepo } = makeRepo();
    await repo.countBySystem(3);
    // Sin `isActive` en el `where`: un producto con historia no se borra, se
    // retira (decision 3 del diseno).
    expect(typeormRepo.count).toHaveBeenCalledWith({ where: { systemId: 3 } });
  });
});
```

- [ ] **Step 2: Ver que fallan**

Run: `cd backend && npx jest src/modules/tickets/systems.service.spec.ts src/modules/tickets/client-systems.repository.spec.ts`
Expected: FAIL las dos — `Cannot find module './systems.service'`, y `repo.countBySystem is not a function`.

- [ ] **Step 3: El repositorio y el conteo de asignaciones**

- `systems.repository.ts`: las siete firmas del bloque **Interfaces**, calcando `client-systems.repository.ts`. `findByName` busca por `name` tal cual: la colación `utf8mb4_unicode_ci` de la tabla ya no distingue mayúsculas, así que no hace falta `LOWER(...)` y añadirlo impediría usar `uq_systems_name`.
- `client-systems.repository.ts`: `countBySystem(systemId)` con `this.repo.count({ where: { systemId } })`. **Cuenta las asignaciones activas y las inactivas**: un producto con historia no se borra, se retira (decisión 3).

- [ ] **Step 4: El servicio**

`SystemsService` con las firmas del bloque **Interfaces**. Dos excepciones y ningún otro texto:

- nombre repetido: `ConflictException({ code: 'CONFLICT', message: `Ya existe un sistema llamado «${name}» en el catálogo.` })`
- borrado con asignaciones: `ConflictException({ code: 'CONFLICT', message: 'Este sistema está asignado a algún cliente. Retíralo del catálogo en lugar de borrarlo.' })`
- no existe: `NotFoundException({ code: 'NOT_FOUND', message: 'Sistema no encontrado' })`

El nombre se recorta una vez y es el que se compara y el que se guarda. La comparación de «es él mismo» en `update` va con `sameId` de `common/ids.ts`, nunca con `===`.

- [ ] **Step 5: El DTO y el controlador**

- `dto/system.dto.ts`: igual que `client-system.dto.ts`, con `@IsString() @MinLength(1) @MaxLength(120)` para el nombre y `@IsOptional() @IsBoolean()` para `isActive`.
- `systems.controller.ts`: `@Controller('systems')`, `@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)` en la clase. `@Get()` **sin** `@Roles`: lo necesita todo el personal para pintar el desplegable de la pestaña «Sistemas». `@Post`, `@Patch(':id')` y `@Delete(':id')` con `@Roles('ADMIN')`. En el docblock de la clase, el motivo: es una lista global de la casa —como proveedores de IA, integraciones y plantillas de aviso, que llevan todas `@Roles('ADMIN')`— y una fila mal puesta la heredan todos los clientes.
- `tickets.module.ts`: `SystemsRepository` y `SystemsService` a `providers` y a `exports`; `SystemsController` a `controllers`.

- [ ] **Step 6: Ver que pasa todo**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/tickets
git commit -m "feat(sistemas): el catalogo de productos que la casa arrienda, con su alta, baja y modificacion"
```

---

### Task 4: Asignar sistemas a un cliente — backend y la pestaña, en el mismo commit

Backend y panel **juntos, a propósito**: `POST /clients/:id/systems` pasa de recibir `{ name }` a recibir `{ systemId }`, y la pestaña «Sistemas» del panel manda `{ name }`. Separar las dos mitades dejaría un commit en el que el botón «Añadir» de esa pestaña responde 400 a todo el mundo.

**Files:**
- Modify: `backend/src/modules/tickets/client-systems.repository.ts`
- Modify: `backend/src/modules/tickets/client-systems.repository.spec.ts`
- Modify: `backend/src/modules/tickets/client-systems.service.ts`
- Create: `backend/src/modules/tickets/client-systems.service.spec.ts`
- Modify: `backend/src/modules/tickets/client-systems.controller.ts`
- Modify: `backend/src/modules/tickets/dto/client-system.dto.ts`
- Modify: `backend/src/modules/tickets/tickets.repository.ts`
- Modify: `backend/src/modules/portal/portal-tickets.service.ts`
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/tickets.api.ts`
- Modify: `web/src/pages/tickets/ClientSystemsTab.tsx`

**Interfaces:**
- Consume: `SystemsRepository` (tarea 3); `canManageClientSystems` (tarea 1).
- Produce, en `ClientSystemsRepository`:
  - `interface ClientSystemView { id: number; clientId: number; systemId: number; name: string; isActive: number }` — **`id` es el de la asignación, y es lo que el ticket guarda en `tickets.system_id`** (decisión 2 del diseño: no se repunta nada). `systemId` es el producto del catálogo, para quien quiera agrupar por producto.
  - `listByClient(clientId: number): Promise<ClientSystemView[]>` — `client_systems` unida a `systems`, **solo** las filas con `system_id` informado, ordenadas por `s.name`.
  - `listActiveByClient(clientId: number): Promise<ClientSystemView[]>` — lo mismo, y además `cs.is_active = 1`.
  - `findByClientAndSystem(clientId: number, systemId: number): Promise<ClientSystem | null>`
- Produce, en `TicketsRepository`: `countByClientSystem(clientSystemId: number): Promise<number>` — cuenta los tickets cuyo `system_id` es esa asignación.
- Produce, en `ClientSystemsService`: `listByClient(clientId)`, `create(clientId: number, dto: AssignClientSystemDto)`, `update(id: number, dto: UpdateClientSystemDto)`, `remove(id: number)`.
- Produce, en `dto/client-system.dto.ts`: `AssignClientSystemDto { systemId: number }` (sustituye a `CreateClientSystemDto`) y `UpdateClientSystemDto { isActive?: boolean }` (**pierde `name`**).
- Produce, en `web/src/api/types.ts`: `interface System { id: number; name: string; isActive: number }`, y `ClientSystem` gana `systemId: number`. `name` **sigue siendo obligatorio**: viene del catálogo por la unión, así que ningún consumidor de hoy cambia.
- Produce, en `web/src/api/tickets.api.ts`: `systemsApi` (`list`, `create`, `update`, `remove` contra `/systems`) y `clientSystemsApi.create(clientId, { systemId })`; `clientSystemsApi.update` pierde `name`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `backend/src/modules/tickets/client-systems.service.spec.ts`:

```ts
import { ClientSystemsService } from './client-systems.service';

const ASIGNACION = { id: 50, clientId: 7, systemId: 3, isActive: 1 };

const makeService = () => {
  const repo = {
    listByClient: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(ASIGNACION),
    findByClientAndSystem: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((d) => Promise.resolve({ id: 51, ...d })),
    update: jest.fn().mockImplementation((id, d) => Promise.resolve({ id, ...d })),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const clients = { findByIdOrFail: jest.fn().mockResolvedValue({ id: 7 }) };
  const systems = { findById: jest.fn().mockResolvedValue({ id: 3, name: 'ERP Core', isActive: 1 }) };
  const tickets = { countByClientSystem: jest.fn().mockResolvedValue(0) };
  return {
    service: new ClientSystemsService(repo as any, clients as any, systems as any, tickets as any),
    repo,
    clients,
    systems,
    tickets,
  };
};

describe('asignar un sistema a un cliente', () => {
  it('escribe la pareja y nada mas: ningun nombre', async () => {
    const { service, repo } = makeService();
    await service.create(7, { systemId: 3 } as any);
    expect(repo.create).toHaveBeenCalledWith({ clientId: 7, systemId: 3, isActive: 1 });
  });

  it('un sistema que no esta en el catalogo da 404', async () => {
    const { service, systems, repo } = makeService();
    systems.findById.mockResolvedValue(null);
    await expect(service.create(7, { systemId: 99 } as any)).rejects.toThrow(
      'Sistema no encontrado',
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('un sistema retirado del catalogo no se puede asignar a nadie mas', async () => {
    const { service, systems, repo } = makeService();
    systems.findById.mockResolvedValue({ id: 3, name: 'ERP Core', isActive: 0 });
    await expect(service.create(7, { systemId: 3 } as any)).rejects.toThrow(
      'Este sistema está retirado del catálogo y ya no se puede asignar.',
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('asignar dos veces el mismo producto se rechaza', async () => {
    const { service, repo } = makeService();
    repo.findByClientAndSystem.mockResolvedValue(ASIGNACION);
    await expect(service.create(7, { systemId: 3 } as any)).rejects.toThrow(
      'Este cliente ya tiene asignado «ERP Core».',
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('desactivar una asignacion no toca ningun ticket', async () => {
    const { service, repo, tickets } = makeService();
    tickets.countByClientSystem.mockResolvedValue(12);
    await service.update(50, { isActive: false } as any);
    expect(repo.update).toHaveBeenCalledWith(50, { isActive: 0 });
    expect(tickets.countByClientSystem).not.toHaveBeenCalled();
  });

  it('quitar una asignacion con tickets detras se rechaza y no borra nada', async () => {
    const { service, repo, tickets } = makeService();
    tickets.countByClientSystem.mockResolvedValue(1);
    await expect(service.remove(50)).rejects.toThrow(
      'Este cliente tiene tickets de este sistema. Desactívalo en lugar de quitarlo.',
    );
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('quitar una asignacion recien puesta, sin tickets, si se permite', async () => {
    const { service, repo, tickets } = makeService();
    await service.remove(50);
    // Por el id de la ASIGNACION, que es lo que el ticket guarda en su
    // `system_id`, no por el del producto del catalogo.
    expect(tickets.countByClientSystem).toHaveBeenCalledWith(50);
    expect(repo.remove).toHaveBeenCalledWith(50);
  });
});
```

Y en `backend/src/modules/tickets/client-systems.repository.spec.ts` (tarea 3), lo que es **la única punta desde la que se puede afirmar que una fila marcada por la migración no sale**: los dobles del servicio no ejecutan la consulta. `makeRepo` gana el constructor de consultas y se añade un `describe`:

```ts
/**
 * El doble devuelve `qb` en cada eslabon y **solo declara los metodos que
 * estas consultas deben usar**. Eso es deliberado: si alguien cambia el
 * `innerJoin` por un `leftJoin`, la prueba revienta con «qb.leftJoin is not a
 * function» en vez de pasar en verde -- y ese cambio es exactamente la
 * regresion que importa, porque un LEFT JOIN deja entrar las filas que la
 * migracion 028 marco, sin nombre de catalogo que ensenar.
 */
const makeQueryBuilder = () => {
  const qb: any = {};
  for (const m of ['innerJoin', 'select', 'addSelect', 'where', 'andWhere', 'orderBy']) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  return qb;
};

/** Todas las condiciones de la consulta, en una sola cadena. */
const condiciones = (qb: any) =>
  [...qb.where.mock.calls, ...qb.andWhere.mock.calls].map((c) => String(c[0])).join(' ');

describe('la lista de asignaciones viene unida al catalogo', () => {
  it('listByClient se une por dentro y acota por cliente', async () => {
    const { repo, qb } = makeRepo();
    await repo.listByClient(7);
    expect(qb.innerJoin).toHaveBeenCalled();
    expect(condiciones(qb)).toContain('client_id');
  });

  it('listActiveByClient ademas exige que la asignacion este activa', async () => {
    const { repo, qb } = makeRepo();
    await repo.listActiveByClient(7);
    expect(qb.innerJoin).toHaveBeenCalled();
    expect(condiciones(qb)).toContain('is_active');
  });
});
```

(`makeRepo` pasa a crear el `qb` con `makeQueryBuilder()`, a dárselo al doble de TypeORM en `createQueryBuilder` y a devolverlo junto a `repo` y `typeormRepo`.)

- [ ] **Step 2: Ver que fallan**

Run: `cd backend && npx jest src/modules/tickets/client-systems`
Expected: FAIL las dos — el servicio, porque su constructor recibe dos argumentos y `create` espera `{ name }`; el repositorio, porque `listByClient` todavía usa `find(...)` y `qb.innerJoin` nunca se llama.

- [ ] **Step 3: El repositorio: la lista viene unida al catálogo**

En `client-systems.repository.ts`, `listByClient` y `listActiveByClient` pasan a `createQueryBuilder('cs')` con `.innerJoin('systems', 's', 's.id = cs.system_id')`, proyección campo a campo con `select`/`addSelect` a `ClientSystemView` (`id`, `clientId`, `systemId`, `name` desde `s.name`, `isActive` desde `cs.is_active`), `.orderBy('s.name', 'ASC')` y `.getRawMany()`. El `INNER JOIN` es lo que deja fuera las filas marcadas por la migración, sin ninguna condición extra que haya que acordarse de escribir en cada consulta.

En `tickets.repository.ts`, `countByClientSystem(clientSystemId)` con `this.repo.count({ where: { systemId: clientSystemId } })`. El nombre dice de qué id habla: `tickets.system_id` apunta a `client_systems`, no al catálogo (decisión 2 del diseño), y confundirlos aquí dejaría borrar una asignación con tickets detrás.

- [ ] **Step 4: El servicio y el DTO**

- `dto/client-system.dto.ts`: `AssignClientSystemDto` con `@IsInt() @Min(1) systemId!: number;`; `UpdateClientSystemDto` se queda solo con `isActive`. En el docblock: el nombre ya no se teclea nunca, y quitar `name` de aquí es lo que cierra la puerta de atrás del texto libre — con `forbidNonWhitelisted`, mandarlo devuelve 400 en vez de ignorarse en silencio.
- `client-systems.service.ts`: constructor `(repo, clients, systems, tickets)`. `create` comprueba cliente, catálogo (existe y activo) y que no esté ya asignado; `update` solo mueve `isActive`; `remove` cuenta tickets antes de borrar. Los cuatro mensajes son los literales de la prueba del paso 1 y ningún otro.

- [ ] **Step 5: El controlador y el portal**

- `client-systems.controller.ts`: `RolesGuard` se suma a los dos guardas de la clase, y el `@Body()` del `@Post` pasa de `CreateClientSystemDto` a `AssignClientSystemDto`. `@Get()` sin `@Roles` (lo necesitan el formulario de ticket y la ficha del ticket); `@Post`, `@Patch(':id')` y `@Delete(':id')` con `@Roles('ADMIN', 'PRODUCT_OWNER')`, la misma guarda que lleva editar la ficha del cliente. En el docblock, por qué se aprieta: con texto libre era un descuido de poco alcance; con un catálogo compartido, una asignación equivocada se ve en el informe del cliente.
- `portal-tickets.service.ts`: `systems()` deja de filtrar `is_active` a mano y llama a `listActiveByClient`. La proyección campo a campo a `PortalClientSystemView` no cambia, y `resolveSystemId` tampoco: el portal conserva su propia barrera.

- [ ] **Step 6: Ver que pasa el backend**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: El panel: de teclear a asignar**

- `web/src/api/types.ts`: `System` nuevo; `ClientSystem` gana `systemId: number`.
- `web/src/api/tickets.api.ts`: `systemsApi` contra `/systems`; `clientSystemsApi.create(clientId, body: { systemId: number })` y `clientSystemsApi.update(clientId, id, body: { isActive: boolean })`.
- `web/src/pages/tickets/ClientSystemsTab.tsx`: el `<input>` de nombre se sustituye por un `<select>` con los sistemas **activos del catálogo que este cliente todavía no tiene** y un botón «Asignar». La grilla gana un botón «Quitar» junto a «Desactivar»/«Activar». Con `canManageClientSystems(user)` falso, no se pinta ni el selector ni ninguno de los botones: la grilla queda de solo lectura. El manejo de errores que ya hay —`e?.response?.data?.message` y el aviso aparte de `safeReload`— no cambia: es el que enseña los 409 del paso 4 tal cual.
- El texto de la lista vacía pasa a decir lo que ocurre de verdad desde la tarea 7:

```tsx
          Este cliente no tiene sistemas asignados. Sus tickets se podrán crear igualmente, pero
          quedarán sin clasificar: no se podrán agrupar por sistema ni en la bandeja ni en su
          informe mensual.
```

- [ ] **Step 8: Comprobar que compila y que el paquete se construye**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/tickets backend/src/modules/portal/portal-tickets.service.ts web/src/api/types.ts web/src/api/tickets.api.ts web/src/pages/tickets/ClientSystemsTab.tsx
git commit -m "feat(sistemas): a un cliente se le asignan sistemas del catalogo, ya no se le teclean"
```

---

### Task 5: La pantalla del catálogo

**Files:**
- Create: `web/src/pages/SystemCatalogPage.tsx`
- Modify: `web/src/auth/permissions.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/layout/AppLayout.tsx`

**Interfaces:**
- Consume: `systemsApi` (tarea 4).
- Produce, en `web/src/auth/permissions.ts`: `const canManageSystemCatalog: (user: User | null) => boolean` — solo `ADMIN`, la misma regla que `canManageUsers`.
- Produce: la ruta `/admin/sistemas` y su entrada en el menú de configuración.

- [ ] **Step 1: Escribir el consumo, y ver que el compilador falla**

En `web/src/App.tsx`, junto a las demás páginas de administración:

```tsx
import SystemCatalogPage from './pages/SystemCatalogPage';
```

Run: `cd web && npx tsc --noEmit`
Expected: FAIL — `Cannot find module './pages/SystemCatalogPage'`.

- [ ] **Step 2: `canManageSystemCatalog`**

En `web/src/auth/permissions.ts`, junto a `canManageUsers`. En el comentario: el catálogo es la lista de productos de la casa; una fila mal puesta la heredan todos los clientes.

- [ ] **Step 3: La página**

`web/src/pages/SystemCatalogPage.tsx`, con la forma de `AIProvidersPage.tsx` (`useQuery` + `useMutation` de `@tanstack/react-query`, `Card`/`CardBody`, `Button`, `toast`): la lista del catálogo, un campo de alta, renombrar, «Retirar»/«Reactivar» y «Borrar». Con `canManageSystemCatalog(user)` falso, la lista queda de solo lectura —sin campo de alta y sin botones—, igual que hace la pestaña «Sistemas» del cliente: la guarda del servidor es la que manda, y la pantalla no ofrece botones que siempre responden 403. Los 409 del backend se enseñan tal cual (`e?.response?.data?.message`): ya vienen escritos en español y dicen qué hacer en su lugar.

En un párrafo arriba de la lista, lo que esta pantalla es y lo que no: *«Estos son los sistemas que la casa arrienda. Se asignan a cada cliente desde su ficha; aquí solo se mantiene la lista.»* Sin eso, la pantalla se confunde con la de asignar y alguien da de alta aquí un producto que solo quería para un cliente.

- [ ] **Step 4: La ruta y el menú**

- `App.tsx`: `<Route path="/admin/sistemas" element={<SystemCatalogPage />} />` junto a las demás de `/admin/`.
- `AppLayout.tsx`: una entrada más en el desplegable de configuración —el que ya lleva a Proveedores IA, Integraciones y Plantillas—, con el texto «Catálogo de sistemas». Va ahí y no en el menú principal: es mantenimiento de una lista que se toca cada varios meses, no una pantalla de trabajo diario. El desplegable entero ya está detrás de `canManageUsers(user)`, que es la misma condición que `canManageSystemCatalog`.

- [ ] **Step 5: Comprobar que compila y que el paquete se construye**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/SystemCatalogPage.tsx web/src/auth/permissions.ts web/src/App.tsx web/src/layout/AppLayout.tsx
git commit -m "feat(sistemas): la pantalla del catalogo, en configuracion y solo para administradores"
```

---

### Task 6: Asignar los sistemas entra en el alta del cliente

**Files:**
- Modify: `web/src/pages/ClientsListPage.tsx`
- Modify: `web/src/pages/ClientDetailPage.tsx`

**Interfaces:**
- Consume: `clientSystemsHref` y `SIN_SISTEMAS_PANEL` (tarea 1), `canManageClientSystems` (tarea 1), `clientSystemsApi.list` (tarea 4).
- Produce: nada que otra tarea consuma.

- [ ] **Step 1: Escribir el consumo, y ver que el compilador falla**

En `web/src/pages/ClientsListPage.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { clientSystemsHref } from './tickets/system-field';
```

Run: `cd web && npx tsc --noEmit`
Expected: FAIL — `'useNavigate' is declared but its value is never read`, y lo mismo de `clientSystemsHref`. (`web/tsconfig.json` tiene `noUnusedLocals: true`, así que un import sin usar ya es un error.)

- [ ] **Step 2: Al crear un cliente, se va a su pestaña «Sistemas»**

En `ClientsListPage.tsx`, `const navigate = useNavigate();` junto a los demás hooks, y el `onSuccess` de la mutación recibe el cliente creado y navega a `clientSystemsHref(created.id)` después de invalidar la consulta y cerrar el formulario. En el comentario: el momento en que alguien acaba de escribir quién es el cliente es el momento en que sabe qué le arrienda; y no se bloquea nada, porque si no asigna nada ya está en la ficha, que es donde iba a acabar igualmente.

- [ ] **Step 3: La ficha avisa cuando un cliente no tiene sistemas**

En `ClientDetailPage.tsx`, una consulta más (`queryKey: ['client-systems', id]`, `queryFn: () => clientSystemsApi.list(id)`) y, justo debajo de las pestañas, un aviso — **solo** cuando se cumplen las dos cosas: `client.status === 'CLIENT'` y ninguna asignación con `isActive === 1`. Dice `SIN_SISTEMAS_PANEL` y, con `canManageClientSystems(user)` cierto, un botón que hace `setTab('systems')`.

Un prospecto **no** lo recibe: no arrienda nada todavía, y avisar de una falta que no lo es enseña a ignorar los avisos.

- [ ] **Step 4: Comprobar que compila y que el paquete se construye**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/ClientsListPage.tsx web/src/pages/ClientDetailPage.tsx
git commit -m "feat(clientes): asignar los sistemas entra en el alta del cliente, sin bloquearla"
```

---

### Task 7: El sistema, exigido donde hay a quien preguntar

**Files:**
- Create: `backend/src/modules/tickets/domain/system-requirement.ts`
- Create: `backend/src/modules/tickets/domain/system-requirement.spec.ts`
- Modify: `backend/src/modules/tickets/tickets.service.ts`
- Modify: `backend/src/modules/tickets/tickets.service.spec.ts`
- Modify: `backend/src/modules/inbound-email/inbound-email.service.ts` (una línea: la exención)
- Modify: `backend/src/modules/inbound-email/inbound-email.service.spec.ts`
- Modify: `backend/src/modules/portal/portal-tickets.service.spec.ts`

**Interfaces:**
- Consume: `ClientSystemsRepository.listActiveByClient` (tarea 4); `sameId` de `backend/src/common/ids.ts`.
- Produce, en `domain/system-requirement.ts`:
  - `type SystemRequirement = 'EXIGIDO' | 'EXENTO_SIN_QUIEN_ELIJA'`
  - `interface ActiveSystem { id: number }`
  - `function resolveTicketSystem(params: { requirement: SystemRequirement; clientId: number | null | undefined; systemId: number | null | undefined; activeSystems: ActiveSystem[] }): number | null`
  - `function assertSystemBelongsToClient(params: { systemId: number | null | undefined; activeSystems: ActiveSystem[] }): void`
- Produce, en `TicketsService`: `create(actor, dto, emailOrigin?, requirement: SystemRequirement = 'EXIGIDO')`. El constructor pasa a recibir `ClientSystemsRepository` como **sexto** parámetro, detrás de `ProjectsService`.

**`ActiveSystem.id` es el de la ASIGNACIÓN, no el del producto del catálogo.** `tickets.system_id` apunta a `client_systems` y sigue apuntando ahí (decisión 2 del diseño), es lo que los dos desplegables mandan hoy, y es contra lo que `PortalTicketsService.resolveSystemId` ya valida. Comparar aquí contra `ClientSystemView.systemId` rechazaría tickets legítimos y aceptaría ajenos — y ninguna prueba del panel lo vería, porque los dos ids son enteros.

- [ ] **Step 1: Escribir la prueba que falla, sobre la regla pura**

Crea `backend/src/modules/tickets/domain/system-requirement.spec.ts`:

```ts
import { resolveTicketSystem, assertSystemBelongsToClient } from './system-requirement';

const ACTIVOS = [{ id: 5 }, { id: 6 }];

describe('resolveTicketSystem', () => {
  it('con sistemas asignados y sin elegir, no deja crear', () => {
    expect(() =>
      resolveTicketSystem({
        requirement: 'EXIGIDO',
        clientId: 7,
        systemId: undefined,
        activeSystems: ACTIVOS,
      }),
    ).toThrow('Elige el sistema afectado.');
  });

  it('sin ninguna asignacion activa, el campo es opcional y el alta sigue', () => {
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

  it('un sistema que no esta entre los asignados activos se rechaza', () => {
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

Las dos funciones del bloque **Interfaces**. Lanza `BadRequestException({ code: 'BAD_INPUT', message })` —mismo patrón que `domain/ticket-state-machine.ts`, que ya lanza excepciones de Nest desde dominio— con estos dos mensajes exactos y ningún otro:

- falta elegir: `'Elige el sistema afectado.'`
- elegido imposible: `'El sistema indicado no es de este cliente o está inactivo.'`

El orden de las comprobaciones es parte de la regla: **primero** se valida el sistema elegido (y eso no lo exime la ingesta: un id imposible es un error venga de donde venga), y **solo si no se eligió ninguno** se decide si hacía falta. La pertenencia se comprueba con `sameId` de `common/ids.ts`, nunca con `===`.

Documenta en el docblock por qué la exención es un valor nombrado y no `origin === 'EMAIL'` ni la presencia de `emailOrigin`: decidir por una consecuencia en vez de por el hecho es el defecto recurrente de este proyecto, y `origin` lo teclea cualquiera en el formulario del panel.

- [ ] **Step 4: Ver que pasa**

Run: `cd backend && npx jest src/modules/tickets/domain/system-requirement.spec.ts`
Expected: PASS, 9 pruebas.

- [ ] **Step 5: Escribir la prueba que falla en el servicio**

En `backend/src/modules/tickets/tickets.service.spec.ts`, dentro de `makeService`, añade el doble del repositorio de asignaciones junto a los de `clients` y `projects`:

```ts
  const systems = { listActiveByClient: jest.fn().mockResolvedValue([{ id: 5 }]) };
```

y pásalo al constructor, detrás de `projects` (añadiéndolo también al objeto que `makeService` devuelve):

```ts
    service: new TicketsService(
      repo as any, events as any, sla as any, clients as any, projects as any, systems as any,
    ),
```

Y las pruebas nuevas, en un `describe` propio:

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

  it('un systemId de una asignacion inactiva se rechaza igual', async () => {
    const { service, systems, repo } = makeService();
    // El 6 esta asignado a este cliente, pero desactivado: no sale de
    // `listActiveByClient`, asi que para el alta es inelegible.
    systems.listActiveByClient.mockResolvedValue([{ id: 5 }]);
    await expect(
      service.create(
        { kind: 'STAFF', userId: 5 },
        { rawText: 'algo', clientId: 7, systemId: 6 } as any,
      ),
    ).rejects.toThrow('El sistema indicado no es de este cliente o está inactivo.');
    expect(repo.savedTickets).toHaveLength(0);
  });

  it('un cliente sin asignaciones activas crea el ticket sin sistema', async () => {
    const { service, repo, systems } = makeService();
    systems.listActiveByClient.mockResolvedValue([]);
    await service.create({ kind: 'STAFF', userId: 5 }, { rawText: 'algo', clientId: 7 } as any);
    expect(repo.savedTickets[0].systemId).toBeNull();
  });

  it('un ticket sin cliente no exige sistema y ni siquiera consulta las asignaciones', async () => {
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

- [ ] **Step 7: Aplicar la regla en `TicketsService`**

Inyecta `ClientSystemsRepository` como sexto parámetro del constructor. En `create`, **antes** de `runInTransaction` y justo detrás de la comprobación de `clientId`:

```ts
    // Las asignaciones solo se consultan si hay cliente: sin cliente no hay
    // sistemas de los que elegir, y una consulta con `undefined` traeria los
    // de todos.
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
    // Solo si se toca. La obligacion de elegir no es retroactiva (decision 6
    // del diseno): un ticket viejo sin sistema se sigue editando.
    if (dto.systemId !== undefined) {
      const clientId = dto.clientId ?? current.clientId;
      assertSystemBelongsToClient({
        systemId: dto.systemId,
        activeSystems: clientId ? await this.systems.listActiveByClient(Number(clientId)) : [],
      });
    }
```

- [ ] **Step 8: La exención, en su único sitio**

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

- [ ] **Step 9: Ver que pasa todo**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/tickets backend/src/modules/inbound-email backend/src/modules/portal/portal-tickets.service.spec.ts
git commit -m "feat(tickets): el sistema es obligatorio cuando el cliente tiene alguno, y se valida siempre"
```

---

### Task 8: La ingesta de correo elige cuando no hay duda

**Files:**
- Modify: `backend/src/modules/tickets/domain/system-requirement.ts`
- Modify: `backend/src/modules/tickets/domain/system-requirement.spec.ts`
- Modify: `backend/src/modules/inbound-email/inbound-email.service.ts`
- Modify: `backend/src/modules/inbound-email/inbound-email.service.spec.ts`

**Interfaces:**
- Consume: `ClientSystemsRepository.listActiveByClient` (tarea 4) y `ActiveSystem` (tarea 7). `InboundEmailModule` ya importa `TicketsModule`, que **ya exporta** `ClientSystemsRepository`: no hay que tocar ningún módulo.
- Produce, en `domain/system-requirement.ts`: `function soleActiveSystemId(activeSystems: ActiveSystem[]): number | null`.
- Produce, en `InboundEmailService`: el constructor recibe `ClientSystemsRepository` como **décimo** parámetro, detrás de `WorkspaceService`.

- [ ] **Step 1: Escribir la prueba que falla, sobre la decisión pura**

En `backend/src/modules/tickets/domain/system-requirement.spec.ts`, añade el import de `soleActiveSystemId` y:

```ts
describe('soleActiveSystemId', () => {
  it('con un solo sistema asignado y activo, ese es', () => {
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

En `backend/src/modules/inbound-email/inbound-email.service.spec.ts`, añade a `Opciones` y a `montar` el doble de las asignaciones:

```ts
  /** Los sistemas asignados y activos del cliente del remitente. Ninguno, por omision. */
  sistemasActivos?: { id: number }[];
```

```ts
  const clientSystems = {
    listActiveByClient: jest.fn().mockResolvedValue(sistemasActivos),
  };
```

pasado como décimo argumento a `new InboundEmailService(...)` y devuelto por `montar`. Y las tres pruebas, en el `describe` de «un correo de un cliente registrado sin referencia»:

```ts
    it('con un unico sistema asignado, el ticket nace con ese sistema', async () => {
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

    it('con dos sistemas no se adivina: entra sin sistema y el correo NO se descarta', async () => {
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

    it('sin ningun sistema asignado, entra sin sistema y el correo tampoco se pierde', async () => {
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
    // El unico sistema asignado al cliente, si solo hay uno. Aqui no hay nadie
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

### Task 9: El sistema en pantalla — se pide primero, se exige, y se ve en la ficha

La mitad de pantalla de la regla que la tarea 7 ya hace cumplir en el servidor. Entre los dos despliegues el comportamiento ya era correcto —un 400 con mensaje en español, sin perder lo escrito—; esto es lo que lo convierte en un formulario que se entiende antes de enviarlo. Y cierra el único sitio donde el clasificador nuevo no se veía: la ficha del ticket, que hoy enseña el cliente y **no enseña el sistema**.

**Files:**
- Modify: `web/src/pages/tickets/system-field.ts`
- Modify: `web/src/pages/portal/NewPortalTicketDialog.tsx`
- Modify: `web/src/pages/tickets/NewTicketDialog.tsx`
- Modify: `web/src/pages/TicketDetailPage.tsx`

**Interfaces:**
- Consume: `systemFieldState`, `SIN_SISTEMAS_PORTAL`, `SIN_SISTEMAS_PANEL` (tarea 1); `clientSystemsApi.list` y el tipo `ClientSystem` con su `name` del catálogo (tarea 4); el mensaje del servidor `'Elige el sistema afectado.'` (tarea 7).
- Produce, en `system-field.ts`: `const ELIGE_SISTEMA: string` (mismo literal, carácter a carácter, que lanza `resolveTicketSystem`), `const ELIGE_SISTEMA_OPCION: string` para el texto del `<option>` vacío, y `function systemLabel(system: { name: string; isActive: number } | undefined, systemId: number | null): string`.

- [ ] **Step 1: Escribir el consumo, y ver que el compilador falla**

En `web/src/pages/portal/NewPortalTicketDialog.tsx`, amplía el import:

```tsx
import { ELIGE_SISTEMA, ELIGE_SISTEMA_OPCION, SIN_SISTEMAS_PORTAL, systemFieldState } from '../tickets/system-field';
```

Run: `cd web && npx tsc --noEmit`
Expected: FAIL — `has no exported member 'ELIGE_SISTEMA'`.

- [ ] **Step 2: Los dos textos nuevos y la etiqueta de la ficha**

En `web/src/pages/tickets/system-field.ts`:

```ts
export const ELIGE_SISTEMA = 'Elige el sistema afectado.';

/** El `<option>` vacio cuando hay sistemas: no es una eleccion, es un hueco. */
export const ELIGE_SISTEMA_OPCION = '(elige un sistema)';

export function systemLabel(
  system: { name: string; isActive: number } | undefined,
  systemId: number | null,
): string {
  if (systemId === null) return '—';
  if (!system) return String(systemId);
  return system.isActive === 1 ? system.name : `${system.name} (inactivo)`;
}
```

En el docblock de `ELIGE_SISTEMA`: es el mismo literal que lanza `resolveTicketSystem` en el backend (`modules/tickets/domain/system-requirement.ts`), repetido aquí y no pedido al servidor porque esta guarda existe para que la petición **no** salga; si los dos textos divergieran, el usuario leería dos redacciones del mismo rechazo, que es peor que leer una sola.

En el de `systemLabel`: un sistema desasignado o desactivado **se sigue viendo**, con la marca, porque el ticket viejo conserva su `system_id` y borrar el dato del pasado para que cuadre el presente es falsificar el histórico. Si la lista no trae ese id —porque no cargó, o porque la asignación se quitó— se cae al número antes que a un guion: un guion diría «este ticket no tiene sistema», que es otra cosa.

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
- El `<option>` vacío con cliente y sistemas pasa a `{ELIGE_SISTEMA_OPCION}`, y **el `value` de cada opción es `s.systemId`**, no `s.id`: lo que el ticket guarda es el sistema del catálogo, no el identificador de la asignación.
- La guarda de `create`, con el mismo texto:

```tsx
    if (systems.length > 0 && systemId === '') {
      setError(ELIGE_SISTEMA);
      return;
    }
```

- El `disabled` del botón «Crear ticket» añade `|| (systems.length > 0 && systemId === '')`.

- [ ] **Step 5: La ficha del ticket enseña el sistema**

En `web/src/pages/TicketDetailPage.tsx`, un efecto junto al que ya resuelve el nombre del cliente y con la misma forma (bandera `cancelled`, fallo a consola y no a la pantalla, porque es un dato de apoyo y no la razón de la página) que carga `clientSystemsApi.list(clientId)` en un estado `systems`, vaciándolo cuando no hay cliente.

Y, en la «Ficha», **justo debajo** de `<Field label="Cliente" …>` porque el sistema cuelga del cliente:

```tsx
              <Field
                label="Sistema"
                value={systemLabel(
                  systems.find((s) => Number(s.id) === Number(ticket.systemId)),
                  ticket.systemId,
                )}
              />
```

La comparación va por valor (`Number(...)`) y no con `===` por lo de siempre: los `bigint` llegan como cadena.

- [ ] **Step 6: Comprobar que compila y que el paquete se construye**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/tickets/system-field.ts web/src/pages/portal/NewPortalTicketDialog.tsx web/src/pages/tickets/NewTicketDialog.tsx web/src/pages/TicketDetailPage.tsx
git commit -m "feat(tickets): el sistema abre el formulario, es obligatorio y se ve en la ficha"
```

---

### Task 10: El proyecto sale del ticket

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
- Consume: `TicketsService.create` tal como la dejó la tarea 7.
- Produce: `CreateTicketDto` ya **no** tiene `projectId` (y `UpdateTicketDto`, que deriva de él, tampoco). `TicketListFilters` pierde `projectId`. `TicketsService` deja de depender de `ProjectsService` — el constructor pasa a ser `(repo, events, sla, clients, systems)`, con `systems` **quinto**.
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
- `tickets.service.spec.ts`: borra el doble `projects` y su argumento del constructor (el `systems` de la tarea 7 pasa a ser el quinto).

Deja escrito en el docblock de `CreateTicketDto` por qué la columna sigue en la entidad: el dato de los tickets viejos se conserva y `pushToJira` sigue funcionando para ellos (decisión 11 del diseño).

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

### Task 11: El proyecto sale del requerimiento

Mismo movimiento que la tarea 10, en `work_items`, y por el mismo motivo las dos mitades van juntas.

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
- `work-items.controller.ts` y `work-items.repository.ts`: fuera el filtro por proyecto, igual que en la tarea 10.
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

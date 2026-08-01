# Portal de clientes (P1) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la frontera de cliente y el portal mínimo encima: un usuario de una empresa cliente entra, ve los tickets de su empresa y abre uno nuevo, sin poder ver nada de ninguna otra.

**Architecture:** Los usuarios de cliente viven en una tabla propia, `client_users`, con su propio flujo de autenticación y **secretos JWT distintos** de los del personal, de modo que la separación sea criptográfica y no dependa de que un guard inspeccione el token. Los endpoints del portal viven bajo `/portal/*`, toman el `clientId` siempre del token y devuelven una proyección explícita en lugar de la entidad.

**Tech Stack:** NestJS 10 · Passport + JWT (dos estrategias nombradas) · TypeORM 0.3 · MySQL 8 · Jest 29 · React 18 + Vite + axios.

## Global Constraints

- **Spec de referencia:** `docs/superpowers/specs/2026-08-01-portal-clientes-p1-design.md`. Ante cualquier duda, la spec manda.
- **Rama:** crear `feat/portal-clientes-p1` desde `feat/work-items-r1`. No trabajar sobre `master` ni `main`.
- **Base de datos:** MySQL en `kubo-mysql-dev`, esquema `kubo_devdocs`, `root`/`root`.
  - Consultar: `docker exec kubo-mysql-dev mysql -uroot -proot -e "USE kubo_devdocs; SHOW COLUMNS FROM client_users;"`
  - Ejecutar fichero: `docker exec -i kubo-mysql-dev mysql -uroot -proot < backend/sql/migrations/013_portal_clientes.sql`
  - El aviso de contraseña en stderr es normal. **No arrancar, parar ni recrear contenedores.**
- **Servidores:** hay un backend en el puerto 3003 y Vite en 5173, ya levantados y en uso. Usarlos; no matarlos, no reiniciarlos, **no levantar duplicados en otros puertos**.
- **API:** `http://localhost:3003/api/v1`. Login de personal: `admin@kubo.pe` / `Admin123*`.
- **Migraciones:** `backend/sql/migrations/NNN_nombre.sql`, correlativas, empezando con `USE kubo_devdocs;`. La última es `012_work_items.sql`, así que esta es la **013**. Los `ALTER TABLE` van guardados con `information_schema` — uno sin guardar rompe el `initdb` al reejecutarse. **Montarla en los dos `docker-compose`.**
- **TypeORM** con `synchronize: false`: el esquema solo cambia por SQL. Un `@Column({ name })` equivocado falla al ejecutar, no al compilar.
- **Idioma:** identificadores en inglés; enums de dominio, mensajes de usuario y comentarios en español.
- **Errores:** `{ code, message }` con `message` en español. Códigos en uso: `NOT_FOUND`, `BAD_INPUT`, `CONFLICT`, `INVALID_TRANSITION`.
- **Disciplina de escritura** (siete hallazgos en las funcionalidades anteriores): toda mutación que cambie una entidad **y** escriba su evento va en una sola transacción, vía `manager.getRepository(...)`. Nada se escapa por el repositorio inyectado dentro del callback. Referencia: `TicketsService.create()`.
- **Tests:** `npm test` desde `backend/`. Hay 120 tests que deben seguir en verde.
- **Cada tarea termina con el build en verde**, backend y web.
- **Commits autocontenidos:** pasar `npm ci && npm run build` en un clon limpio.

### Reglas de seguridad, que gobiernan todo el plan

1. **El `clientId` sale siempre del token.** Nunca del cuerpo, nunca de la URL, nunca de un parámetro. Un endpoint del portal que acepte un `clientId` de fuera es un fallo de seguridad.
2. **El portal nunca devuelve la entidad.** Devuelve una proyección explícita, campo por campo. Ocultar en el frontend no sirve: el dato ya viajó.
3. **404, no 403**, cuando alguien pide algo que no es de su cliente. Un 403 confirma que existe.
4. **Un ticket del portal no ve** prioridad, política ni vencimientos de SLA, `assigneeUserId`, `slaAtRisk`, ni el `reason` ni el actor de los eventos del timeline.

---

## Estructura de archivos

**Backend** — módulo nuevo `backend/src/modules/portal/`:

| Archivo | Responsabilidad |
|---|---|
| `entities/client-user.entity.ts` | Mapeo de `client_users` |
| `client-users.repository.ts` | Acceso a datos |
| `client-users.service.ts` · `client-users.controller.ts` | Alta y gestión **desde el panel interno** |
| `strategies/client-jwt.strategy.ts` | Estrategia passport `'client-jwt'`, secreto propio |
| `guards/client-jwt.guard.ts` | `AuthGuard('client-jwt')` |
| `decorators/current-client-user.decorator.ts` | `@CurrentClientUser` |
| `portal-auth.service.ts` · `portal-auth.controller.ts` | Login y refresh del portal |
| `portal-tickets.service.ts` · `portal-tickets.controller.ts` | Consultas acotadas y la proyección |
| `dto/` | DTOs de entrada y la proyección de salida |

**Común** — `backend/src/common/guards/staff-only.guard.ts`, aplicado a todos los controladores internos.

**Web** — zona separada, con su propio layout y su propio almacenamiento de token:

| Archivo | Responsabilidad |
|---|---|
| `api/portal.api.ts` | Cliente HTTP del portal, token propio |
| `layout/PortalLayout.tsx` | Cabecera mínima, sin el menú lateral interno |
| `pages/portal/PortalLoginPage.tsx` | Entrada |
| `pages/portal/PortalTicketsPage.tsx` | Lista de los tickets de su empresa |
| `pages/portal/PortalTicketDetailPage.tsx` | Detalle con avance y timeline |
| `pages/portal/NewPortalTicketDialog.tsx` | Alta de ticket |

---

## Orden de ejecución

| # | Tarea | Depende de |
|---|---|---|
| 1 | Migración 013 y montaje en compose | — |
| 2 | Entidad, repositorio y módulo | 1 |
| 3 | **La frontera**: estrategia, guards y `StaffOnlyGuard` en todo lo interno | 2 |
| 4 | Autenticación del portal: login y refresh | 3 |
| 5 | El actor de cliente en la escritura de tickets | 2 |
| 6 | Endpoints del portal con la proyección | 3, 4, 5 |
| 7 | Gestión de usuarios de cliente desde el panel | 2 |
| 8 | Web: tipos y cliente API del portal | 6 |
| 9 | Web: layout, login y separación de rutas | 8 |
| 10 | Web: lista, detalle y alta | 9 |
| 11 | Verificación de extremo a extremo | 10 |

La tarea 3 es el corazón de todo. Si algo de este plan merece una revisión lenta, es esa.

---

### Task 1: Migración 013 y montaje en compose

**Files:**
- Create: `backend/sql/migrations/013_portal_clientes.sql`
- Modify: `docker-compose.dev.yml` · `docker-compose.yml`

**Interfaces:**
- Consumes: tablas `clients`, `users`, `tickets`, `ticket_events`, `work_items`, `work_item_events`.
- Produces: tabla `client_users`; columnas `created_by_client_user_id` en `tickets` y `work_items`; `actor_client_user_id` en `ticket_events` y `work_item_events`; `tickets.created_by` y `work_items.created_by` pasan a nullable.

- [ ] **Step 1: Escribir la migración**

`backend/sql/migrations/013_portal_clientes.sql`:

```sql
-- =========================================================================
--  Migración 013 — Portal de clientes (P1)
-- =========================================================================
--  · client_users: los usuarios de las empresas cliente, en tabla propia.
--    Separados de `users` a propósito: así es imposible que aparezcan en
--    una consulta de personal.
--  · Columnas hermanas del actor: cinco columnas del sistema asumían que
--    quien actúa pertenece al equipo. Ahora `created_by` puede ser nulo y
--    en su lugar va `created_by_client_user_id`.
--
--  Los ALTER van guardados con information_schema: uno sin guardar rompe
--  el initdb al reejecutarse y detiene toda la cadena.
-- =========================================================================

USE kubo_devdocs;

-- -------------------------------------------------------------------------
-- 1) Usuarios de las empresas cliente
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_users (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id      BIGINT UNSIGNED NOT NULL COMMENT 'a que empresa pertenece',
  email          VARCHAR(180)    NOT NULL,
  password_hash  VARCHAR(255)    NOT NULL,
  full_name      VARCHAR(180)    NOT NULL,
  is_admin       TINYINT(1)      NOT NULL DEFAULT 0
                 COMMENT 'reservado para P3: administracion delegada',
  is_active      TINYINT(1)      NOT NULL DEFAULT 1,
  last_login_at  DATETIME        NULL,
  created_by     BIGINT UNSIGNED NOT NULL COMMENT 'quien del equipo lo dio de alta',
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                 ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_client_users_email (email),
  INDEX idx_cu_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 2) Columnas hermanas del actor, guardadas para ser idempotentes
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_column_013;
DELIMITER //
CREATE PROCEDURE kubo_add_column_013(
  IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_ddl VARCHAR(512))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'kubo_devdocs'
      AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE ', p_table, ' ADD COLUMN ', p_ddl);
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

CALL kubo_add_column_013('tickets', 'created_by_client_user_id',
  'created_by_client_user_id BIGINT UNSIGNED NULL AFTER created_by');
CALL kubo_add_column_013('ticket_events', 'actor_client_user_id',
  'actor_client_user_id BIGINT UNSIGNED NULL AFTER actor_user_id');
CALL kubo_add_column_013('work_items', 'created_by_client_user_id',
  'created_by_client_user_id BIGINT UNSIGNED NULL AFTER created_by');
CALL kubo_add_column_013('work_item_events', 'actor_client_user_id',
  'actor_client_user_id BIGINT UNSIGNED NULL AFTER actor_user_id');

DROP PROCEDURE IF EXISTS kubo_add_column_013;

-- -------------------------------------------------------------------------
-- 3) created_by pasa a nullable: un ticket del portal no tiene autor interno
-- -------------------------------------------------------------------------
ALTER TABLE tickets    MODIFY created_by BIGINT UNSIGNED NULL;
ALTER TABLE work_items MODIFY created_by BIGINT UNSIGNED NULL;
```

`MODIFY` es idempotente por naturaleza: reejecutarlo deja la columna igual, sin error.

- [ ] **Step 2: Montar en los dos compose**

En `docker-compose.dev.yml` y en `docker-compose.yml`, añadir la 013 en la lista de volúmenes del servicio `mysql`, después de la 012, siguiendo el esquema de prefijos que use cada fichero — **son distintos, leerlos antes**. En el `.dev.yml` hay que comprobar que el prefijo elegido no choque con el del seed, que ya se tuvo que renumerar una vez.

- [ ] **Step 3: Ejecutar y verificar**

```bash
docker exec -i kubo-mysql-dev mysql -uroot -proot < backend/sql/migrations/013_portal_clientes.sql
```

```sql
USE kubo_devdocs;
SHOW CREATE TABLE client_users\G
SHOW COLUMNS FROM tickets LIKE '%client_user%';
SHOW COLUMNS FROM ticket_events LIKE '%client_user%';
SHOW COLUMNS FROM work_items LIKE '%client_user%';
SHOW COLUMNS FROM work_item_events LIKE '%client_user%';
SHOW COLUMNS FROM tickets LIKE 'created_by';
```

Expected: la tabla existe con su único sobre `email`; las cuatro columnas nuevas existen; `tickets.created_by` figura como `YES` en la columna `Null`.

- [ ] **Step 4: Verificar idempotencia**

Volver a ejecutar el Step 3.
Expected: sin errores. Confirmar con `SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='kubo_devdocs' AND TABLE_NAME='tickets' AND COLUMN_NAME='created_by_client_user_id';` que sigue habiendo exactamente 1.

- [ ] **Step 5: Commit**

```bash
git add backend/sql/migrations/013_portal_clientes.sql docker-compose.dev.yml docker-compose.yml
git commit -m "feat(db): migracion 013 — usuarios de cliente y actor del portal"
```

---

### Task 2: Entidad, repositorio y módulo

**Files:**
- Create: `backend/src/modules/portal/entities/client-user.entity.ts`
- Create: `backend/src/modules/portal/client-users.repository.ts`
- Create: `backend/src/modules/portal/portal.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces: entidad `ClientUser`; `ClientUsersRepository` con `findByEmail(email)`, `findById(id)`, `listByClient(clientId)`, `create(data)`, `update(id, data)`, `touchLastLogin(id)`.

- [ ] **Step 1: La entidad**

`backend/src/modules/portal/entities/client-user.entity.ts`:

```ts
import {
  Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';

/** Usuario de una empresa cliente. Deliberadamente fuera de `users`. */
@Entity('client_users')
@Index('idx_cu_client', ['clientId'])
export class ClientUser {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number;

  @Column({ name: 'client_id', type: 'bigint', unsigned: true })
  clientId!: number;

  @Column({ type: 'varchar', length: 180 })
  email!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 180 })
  fullName!: string;

  /** Reservado para P3. En P1 no gobierna ningún permiso. */
  @Column({ name: 'is_admin', type: 'tinyint', default: 0 })
  isAdmin!: number;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive!: number;

  @Column({ name: 'last_login_at', type: 'datetime', nullable: true })
  lastLoginAt!: Date | null;

  @Column({ name: 'created_by', type: 'bigint', unsigned: true })
  createdBy!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

- [ ] **Step 2: El repositorio**

`backend/src/modules/portal/client-users.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientUser } from './entities/client-user.entity';

@Injectable()
export class ClientUsersRepository {
  constructor(@InjectRepository(ClientUser) private readonly repo: Repository<ClientUser>) {}

  findByEmail(email: string): Promise<ClientUser | null> {
    return this.repo.findOne({ where: { email: email.trim().toLowerCase() } });
  }

  findById(id: number): Promise<ClientUser | null> {
    return this.repo.findOne({ where: { id } });
  }

  listByClient(clientId: number): Promise<ClientUser[]> {
    return this.repo.find({ where: { clientId }, order: { fullName: 'ASC' } });
  }

  create(data: Partial<ClientUser>): Promise<ClientUser> {
    return this.repo.save(this.repo.create(data));
  }

  async update(id: number, data: Partial<ClientUser>): Promise<ClientUser | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async touchLastLogin(id: number): Promise<void> {
    await this.repo.update(id, { lastLoginAt: new Date() });
  }
}
```

El correo se normaliza a minúsculas en la búsqueda porque el único de MySQL con `utf8mb4_unicode_ci` ya es insensible a mayúsculas: normalizar también al escribir evita que la aplicación y la base discrepen.

- [ ] **Step 3: El módulo**

`backend/src/modules/portal/portal.module.ts` con `TypeOrmModule.forFeature([ClientUser])`, `ClientUsersRepository` en `providers` y `exports`. Registrar `PortalModule` en `app.module.ts`, junto a `WorkItemsModule`.

- [ ] **Step 4: Verificar**

Run: `cd backend && npm run build` — sin errores.
Run: `cd backend && npm run start:dev` — Nest arranca sin errores de mapeo. Detener.
Run: `cd backend && npm test` — los 120 siguen en verde.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/portal backend/src/app.module.ts
git commit -m "feat(portal): entidad y repositorio de usuarios de cliente"
```

---

### Task 3: La frontera

**Files:**
- Create: `backend/src/modules/portal/strategies/client-jwt.strategy.ts`
- Create: `backend/src/modules/portal/guards/client-jwt.guard.ts`
- Create: `backend/src/modules/portal/decorators/current-client-user.decorator.ts`
- Create: `backend/src/common/guards/staff-only.guard.ts`
- Test: `backend/src/common/guards/staff-only.guard.spec.ts`
- Modify: `backend/src/modules/portal/portal.module.ts`
- Modify: **todos** los controladores internos que hoy usan `JwtAuthGuard`
- Modify: `.env.production.example` y el `.env` local

**Interfaces:**
- Produces: `ClientJwtPayload` (`{ sub, email, clientId, isClientAdmin }`), `ClientJwtStrategy` (nombre passport `'client-jwt'`), `ClientJwtGuard`, `CurrentClientUser` que expone `AuthClientUser` (`{ clientUserId, clientId, isClientAdmin, email }`), y `StaffOnlyGuard`.

**Esta es la tarea crítica del plan.** Todo lo demás depende de que la separación sea real.

- [ ] **Step 1: Añadir los secretos**

En `.env.production.example` y en el `.env` local, junto a los existentes:

```
JWT_CLIENT_ACCESS_SECRET=cambiar-por-un-secreto-distinto-al-del-personal
JWT_CLIENT_REFRESH_SECRET=cambiar-por-otro-secreto-distinto
```

Deben ser **distintos** de `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET`. Ahí está la garantía: un token de cliente firmado con otro secreto no valida contra la estrategia del personal, ni por error ni por descuido.

- [ ] **Step 2: La estrategia de cliente**

`backend/src/modules/portal/strategies/client-jwt.strategy.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface ClientJwtPayload {
  sub: number;
  email: string;
  clientId: number;
  isClientAdmin: boolean;
}

export interface AuthClientUser {
  clientUserId: number;
  email: string;
  clientId: number;
  isClientAdmin: boolean;
}

/**
 * Estrategia propia del portal, con secreto propio. Un token de cliente NO
 * valida contra la estrategia 'jwt' del personal, y viceversa: la frontera
 * es criptográfica, no una comprobación sobre el contenido del token.
 */
@Injectable()
export class ClientJwtStrategy extends PassportStrategy(Strategy, 'client-jwt') {
  constructor(cfg: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.get<string>('JWT_CLIENT_ACCESS_SECRET', 'change-me-client'),
    });
  }

  validate(payload: ClientJwtPayload): AuthClientUser {
    return {
      clientUserId: payload.sub,
      email: payload.email,
      clientId: payload.clientId,
      isClientAdmin: payload.isClientAdmin,
    };
  }
}
```

- [ ] **Step 3: El guard y el decorador**

`guards/client-jwt.guard.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class ClientJwtGuard extends AuthGuard('client-jwt') {}
```

`decorators/current-client-user.decorator.ts`:

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthClientUser } from '../strategies/client-jwt.strategy';

export const CurrentClientUser = createParamDecorator(
  (data: keyof AuthClientUser | undefined, ctx: ExecutionContext): AuthClientUser | unknown => {
    const req = ctx.switchToHttp().getRequest();
    return data ? req.user?.[data] : req.user;
  },
);
```

- [ ] **Step 4: Escribir el test del `StaffOnlyGuard` que falla**

`backend/src/common/guards/staff-only.guard.spec.ts`:

```ts
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { StaffOnlyGuard } from './staff-only.guard';

const ctxWith = (user: unknown): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as ExecutionContext;

describe('StaffOnlyGuard', () => {
  const guard = new StaffOnlyGuard();

  it('deja pasar a un usuario del equipo', () => {
    expect(guard.canActivate(ctxWith({ id: 1, email: 'a@kubo.pe', role: 'ADMIN' }))).toBe(true);
  });

  it('rechaza a un usuario de cliente', () => {
    expect(() =>
      guard.canActivate(ctxWith({ clientUserId: 5, clientId: 7, email: 'x@cli.com' })),
    ).toThrow(ForbiddenException);
  });

  it('rechaza cualquier cosa que traiga clientId, aunque tambien traiga role', () => {
    expect(() =>
      guard.canActivate(ctxWith({ id: 1, role: 'ADMIN', clientId: 7 })),
    ).toThrow(ForbiddenException);
  });

  it('rechaza si no hay usuario en la peticion', () => {
    expect(() => guard.canActivate(ctxWith(undefined))).toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 5: Ejecutar y ver el RED**

Run: `cd backend && npm test -- staff-only`
Expected: FAIL — `Cannot find module './staff-only.guard'`.

- [ ] **Step 6: Implementar el guard**

`backend/src/common/guards/staff-only.guard.ts`:

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Segunda barrera. Con secretos JWT distintos un token de cliente ya no valida
 * contra la estrategia del personal, así que esto no debería dispararse nunca
 * — y va igualmente, porque una sola barrera en algo así es una barrera menos.
 *
 * Rechaza cualquier petición cuyo usuario traiga `clientId`, aunque además
 * traiga un `role` que parezca de personal.
 */
@Injectable()
export class StaffOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user || user.clientId !== undefined || user.clientUserId !== undefined) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Esta sección es solo para el equipo interno.',
      });
    }
    return true;
  }
}
```

- [ ] **Step 7: Ejecutar y ver el GREEN**

Run: `cd backend && npm test -- staff-only`
Expected: PASS — 4 tests.

- [ ] **Step 8: Aplicar `StaffOnlyGuard` a todos los controladores internos**

Buscar cada controlador que use `JwtAuthGuard` y añadirlo:

```bash
grep -rln "JwtAuthGuard" backend/src/modules --include=*.controller.ts
```

En cada uno, `@UseGuards(JwtAuthGuard)` pasa a `@UseGuards(JwtAuthGuard, StaffOnlyGuard)`, y donde ya hay `RolesGuard`, el orden es `JwtAuthGuard, StaffOnlyGuard, RolesGuard`.

**No aplicarlo** a los controladores del portal ni a `auth.controller.ts` (el login del personal no tiene usuario todavía).

Contar los controladores antes y después y dejar el número en el informe: es la forma de demostrar que no se saltó ninguno.

- [ ] **Step 9: Registrar en el módulo**

En `portal.module.ts`: importar `PassportModule`, `ConfigModule` y `JwtModule.register({})`; añadir `ClientJwtStrategy` a `providers`; exportar lo que las tareas siguientes necesiten.

- [ ] **Step 10: Verificar**

Run: `cd backend && npm run build` — sin errores.
Run: `cd backend && npm test` — 120 + 4 en verde.

Con el backend levantado, comprobar que el personal sigue entrando igual:

```bash
curl -s $API/tickets -H "Authorization: Bearer $TOKEN_STAFF" -o /dev/null -w "%{http_code}\n"
```

Expected: 200. Si sale 403, el guard está rechazando al personal y algo está mal en la condición.

- [ ] **Step 11: Commit**

```bash
git add backend/src backend/.env.production.example
git commit -m "feat(portal): frontera de cliente — estrategia propia, guards y solo-personal"
```

---

### Task 4: Autenticación del portal

**Files:**
- Create: `backend/src/modules/portal/portal-auth.service.ts` · `portal-auth.controller.ts` · `dto/portal-login.dto.ts`
- Test: `backend/src/modules/portal/portal-auth.service.spec.ts`
- Modify: `portal.module.ts`

**Interfaces:**
- Consumes: `ClientUsersRepository`, `ClientJwtPayload`, `JwtService`, `ConfigService`, `bcrypt`.
- Produces: `PortalAuthService.login(email, password)` y `.refresh(refreshToken)`, ambos devolviendo `{ accessToken, refreshToken, clientUser: { id, email, fullName, clientId } }`.

- [ ] **Step 1: Escribir el test que falla**

`backend/src/modules/portal/portal-auth.service.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PortalAuthService } from './portal-auth.service';

const makeService = (user: unknown) => {
  const repo = {
    findByEmail: jest.fn().mockResolvedValue(user),
    findById: jest.fn().mockResolvedValue(user),
    touchLastLogin: jest.fn().mockResolvedValue(undefined),
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('tok'), verifyAsync: jest.fn() };
  const cfg = { get: jest.fn().mockReturnValue('secreto') };
  return { service: new PortalAuthService(repo as any, jwt as any, cfg as any), repo, jwt };
};

describe('login', () => {
  it('rechaza un correo que no existe', async () => {
    const { service } = makeService(null);
    await expect(service.login('nadie@x.com', 'x')).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza una contrasena incorrecta', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service } = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 });
    await expect(service.login('a@x.com', 'incorrecta')).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza a un usuario desactivado aunque la contrasena sea correcta', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service } = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 0, isAdmin: 0 });
    await expect(service.login('a@x.com', 'correcta')).rejects.toThrow(UnauthorizedException);
  });

  it('devuelve el mismo error para correo inexistente y contrasena mala', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const a = makeService(null);
    const b = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 });
    const errA = await a.service.login('nadie@x.com', 'x').catch((e) => e.message);
    const errB = await b.service.login('a@x.com', 'mala').catch((e) => e.message);
    expect(errA).toBe(errB);
  });

  it('firma el token con el clientId del usuario, no con uno de fuera', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service, jwt } = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 });
    await service.login('a@x.com', 'correcta');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 1, clientId: 7, isClientAdmin: false }),
      expect.anything(),
    );
  });

  it('sella last_login_at al entrar', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    const { service, repo } = makeService({ id: 1, clientId: 7, email: 'a@x.com', passwordHash: hash, isActive: 1, isAdmin: 0 });
    await service.login('a@x.com', 'correcta');
    expect(repo.touchLastLogin).toHaveBeenCalledWith(1);
  });
});
```

El cuarto test es el que importa de verdad: **el mensaje de error debe ser idéntico** tanto si el correo no existe como si la contraseña es mala. Distinguirlos permite averiguar qué direcciones están dadas de alta.

- [ ] **Step 2: RED**

Run: `cd backend && npm test -- portal-auth`
Expected: FAIL — `Cannot find module './portal-auth.service'`.

- [ ] **Step 3: Implementar**

`portal-auth.service.ts`: `login` busca por correo, verifica con `bcrypt.compare`, rechaza si `isActive` es 0, sella `lastLoginAt`, y firma los dos tokens con `JWT_CLIENT_ACCESS_SECRET` y `JWT_CLIENT_REFRESH_SECRET`. Ante cualquier fallo lanza siempre:

```ts
throw new UnauthorizedException({
  code: 'UNAUTHORIZED',
  message: 'Correo o contraseña incorrectos.',
});
```

`refresh` verifica el token con el secreto de refresco, recarga el usuario, comprueba que sigue activo, y reemite. Seguir la forma de `AuthService` del personal, que ya hace exactamente esto.

`portal-auth.controller.ts` en la ruta `portal/auth`, con `POST login` y `POST refresh`. **Sin guards** — es la puerta de entrada.

`dto/portal-login.dto.ts` con `@IsEmail()` y `@IsString() @MinLength(1)`.

- [ ] **Step 4: GREEN y verificación**

Run: `cd backend && npm test -- portal-auth` — 6 tests.
Run: `cd backend && npm test` y `npm run build` — todo en verde.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/portal
git commit -m "feat(portal): login y refresco de usuarios de cliente"
```

---

### Task 5: El actor de cliente en la escritura de tickets

**Files:**
- Modify: `backend/src/modules/tickets/entities/ticket.entity.ts` · `entities/ticket-event.entity.ts`
- Modify: `backend/src/modules/tickets/tickets.service.ts`
- Test: `backend/src/modules/tickets/tickets.service.spec.ts` (ampliar)

**Interfaces:**
- Produces: `Ticket.createdByClientUserId`, `TicketEvent.actorClientUserId`; `TicketsService.create(actor, dto)` donde `actor` es `{ kind: 'STAFF'; userId: number } | { kind: 'CLIENT'; clientUserId: number }`.

Cambiar la firma de `create` en lugar de añadir un método paralelo evita dos caminos de escritura que puedan divergir — que es exactamente el problema que costó siete hallazgos en las funcionalidades anteriores.

- [ ] **Step 1: Añadir las columnas a las entidades**

En `ticket.entity.ts`, `createdBy` pasa a `number | null` y se añade:

```ts
  @Column({ name: 'created_by_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  createdByClientUserId!: number | null;
```

En `ticket-event.entity.ts`:

```ts
  @Column({ name: 'actor_client_user_id', type: 'bigint', unsigned: true, nullable: true })
  actorClientUserId!: number | null;
```

- [ ] **Step 2: Escribir los tests que fallan**

Añadir a `tickets.service.spec.ts`:

```ts
describe('create con actor', () => {
  it('un ticket del equipo pone created_by y deja nulo el de cliente', async () => {
    const { service, repo } = makeService();
    await service.create({ kind: 'STAFF', userId: 5 }, { rawText: 'algo' });
    const saved = repo.savedTickets[0];
    expect(saved.createdBy).toBe(5);
    expect(saved.createdByClientUserId).toBeNull();
  });

  it('un ticket del portal pone el de cliente y deja nulo created_by', async () => {
    const { service, repo } = makeService();
    await service.create({ kind: 'CLIENT', clientUserId: 11 }, { rawText: 'algo', clientId: 1 });
    const saved = repo.savedTickets[0];
    expect(saved.createdBy).toBeNull();
    expect(saved.createdByClientUserId).toBe(11);
  });

  it('el evento CREATED lleva el actor que corresponda', async () => {
    const { service, repo } = makeService();
    await service.create({ kind: 'CLIENT', clientUserId: 11 }, { rawText: 'algo', clientId: 1 });
    const ev = repo.savedEvents[0];
    expect(ev.actorUserId).toBeNull();
    expect(ev.actorClientUserId).toBe(11);
  });
});
```

Adaptar `makeService` para exponer `savedTickets` y `savedEvents` desde los stubs por entidad del manager, como ya hace la spec de work items.

- [ ] **Step 3: RED, luego implementar**

`create(actor, dto)` traduce el actor a las dos columnas y al evento. Las dos columnas nunca se ponen a la vez: es una u otra, decidido por `actor.kind`.

Actualizar la llamada en `tickets.controller.ts` a `create({ kind: 'STAFF', userId: user.id }, dto)`.

- [ ] **Step 4: Verificar**

Run: `cd backend && npm test` — los 130 acumulados más los 3 nuevos.
Run: `cd backend && npm run build` — limpio.

Comprobar que crear un ticket desde el panel interno sigue funcionando, con un `curl` a `POST /tickets`, y que la fila tiene `created_by` puesto y `created_by_client_user_id` nulo.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tickets
git commit -m "feat(tickets): distinguir el actor del equipo del actor de cliente"
```

---

### Task 6: Endpoints del portal

**Files:**
- Create: `backend/src/modules/portal/portal-tickets.service.ts` · `portal-tickets.controller.ts`
- Create: `backend/src/modules/portal/dto/portal-ticket.dto.ts` · `dto/create-portal-ticket.dto.ts`
- Test: `backend/src/modules/portal/portal-tickets.service.spec.ts`
- Modify: `portal.module.ts`

**Interfaces:**
- Consumes: `TicketsRepository`, `TicketEventsService`, `TicketsService.create`, `ClientSystemsRepository`, `ClientJwtGuard`, `CurrentClientUser`.
- Produces: `PortalTicketsService.list(clientId)`, `.detail(clientId, ticketId)`, `.create(clientUserId, clientId, dto)`, `.systems(clientId)`; y el tipo `PortalTicketView`.

- [ ] **Step 1: Escribir los tests que fallan**

`portal-tickets.service.spec.ts` — los tres que demuestran la frontera:

```ts
describe('la frontera', () => {
  it('la consulta siempre filtra por el clientId recibido', async () => {
    const { service, repo } = makeService();
    await service.list(7);
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ clientId: 7 }));
  });

  it('el detalle de un ticket de otro cliente devuelve NOT_FOUND, no el ticket', async () => {
    const { service } = makeService({ id: 3, clientId: 99 });
    await expect(service.detail(7, 3)).rejects.toThrow(NotFoundException);
  });

  it('crear ignora cualquier clientId que venga en el cuerpo', async () => {
    const { service, tickets } = makeService();
    await service.create(11, 7, { subject: 'x', description: 'y', clientId: 99 } as any);
    expect(tickets.create).toHaveBeenCalledWith(
      { kind: 'CLIENT', clientUserId: 11 },
      expect.objectContaining({ clientId: 7 }),
    );
  });
});

describe('la proyeccion', () => {
  it('no expone prioridad, SLA ni asignado', async () => {
    const { service } = makeService();
    const [view] = await service.list(7);
    expect(view).not.toHaveProperty('priority');
    expect(view).not.toHaveProperty('slaResolutionDueAt');
    expect(view).not.toHaveProperty('slaAtRisk');
    expect(view).not.toHaveProperty('assigneeUserId');
  });

  it('los eventos del timeline no llevan reason ni actor', async () => {
    const { service } = makeService();
    const view = await service.detail(7, 1);
    view.timeline.forEach((e) => {
      expect(e).not.toHaveProperty('reason');
      expect(e).not.toHaveProperty('actorUserId');
      expect(e).not.toHaveProperty('actorClientUserId');
    });
  });
});
```

- [ ] **Step 2: RED, luego implementar**

`PortalTicketsService`:

- `list(clientId)` llama a `TicketsRepository.list({ clientId })` y mapea cada fila con `toPortalView`.
- `detail(clientId, ticketId)` carga el ticket, y **si `ticket.clientId !== clientId` lanza `NotFoundException`** con el mismo mensaje que si no existiera.
- `create(clientUserId, clientId, dto)` llama a `TicketsService.create({ kind: 'CLIENT', clientUserId }, { clientId, systemId: dto.systemId, subject: dto.subject, rawText: dto.description, origin: 'PORTAL' })`. El `clientId` que se pasa es **el del argumento**, nunca el del dto.
- `systems(clientId)` devuelve los `client_systems` activos de ese cliente.

La proyección, en `dto/portal-ticket.dto.ts`:

```ts
export interface PortalTicketEventView {
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
}

export interface PortalTicketView {
  id: number;
  code: string | null;
  subject: string | null;
  descriptionMd: string | null;
  status: string;
  systemId: number | null;
  createdAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  timeline?: PortalTicketEventView[];
}
```

Construirla **campo por campo**, nunca con un *spread* del ticket menos unas claves: un `delete` olvidado tras añadir una columna nueva es cómo se filtra un dato.

`CreatePortalTicketDto`: `subject` obligatorio (máx 240), `description` obligatorio, `systemId` opcional. **No lleva `clientId`** — y el `ValidationPipe` global con `forbidNonWhitelisted` hace que enviarlo devuelva 400.

`portal-tickets.controller.ts` en la ruta `portal`, con `@UseGuards(ClientJwtGuard)` y el `clientId` tomado de `@CurrentClientUser`.

- [ ] **Step 3: Verificar de extremo a extremo**

Run: `cd backend && npm test -- portal-tickets` y luego la suite completa.

Con el backend levantado: crear un usuario de cliente a mano en la base (Task 7 le dará interfaz), entrar por `POST /portal/auth/login`, y comprobar con `curl`:

- `GET /portal/tickets` devuelve solo los de su cliente, y la respuesta **no contiene** las cadenas `priority`, `slaResolutionDueAt` ni `assigneeUserId`
- `GET /portal/tickets/<id de otro cliente>` devuelve **404**
- `POST /portal/tickets` con un `clientId` de otra empresa en el cuerpo devuelve **400** y no crea nada
- El ticket creado tiene `origin: PORTAL`, `created_by` nulo y `created_by_client_user_id` puesto

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/portal
git commit -m "feat(portal): endpoints de tickets acotados por cliente"
```

---

### Task 7: Gestión de usuarios de cliente desde el panel

**Files:**
- Create: `backend/src/modules/portal/client-users.service.ts` · `client-users.controller.ts` · `dto/client-user.dto.ts`
- Modify: `portal.module.ts`

**Interfaces:**
- Produces: `ClientUsersService.listByClient`, `.create(staffUserId, dto)`, `.update(id, dto)`; rutas `GET|POST /client-users` y `PATCH /client-users/:id`.

- [ ] **Step 1: Implementar**

`create` hashea con `bcrypt` (10 rondas, como `UsersService`), normaliza el correo a minúsculas, valida que el cliente exista con `ClientsService.findByIdOrFail`, y devuelve **sin** el `passwordHash`. Un correo repetido devuelve `409 CONFLICT` con un mensaje legible.

`update` permite cambiar `fullName`, `isActive`, `isAdmin` y la contraseña. **Nunca** el `clientId`: mover un usuario de empresa es cambiar de quién es, y eso se hace borrando y creando.

El controlador va en `client-users`, con `@UseGuards(JwtAuthGuard, StaffOnlyGuard, RolesGuard)` y `@Roles('ADMIN')` en las mutaciones — dar de alta a alguien que verá los tickets de un cliente es una acción de administración.

- [ ] **Step 2: Verificar**

`npm run build` y `npm test` limpios. Con `curl`: crear un usuario, comprobar que la respuesta **no trae** `passwordHash`, y que repetir el correo devuelve 409.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/portal
git commit -m "feat(portal): alta y gestion de usuarios de cliente desde el panel"
```

---

### Task 8: Web — tipos y cliente API del portal

**Files:**
- Create: `web/src/api/portal.api.ts`
- Modify: `web/src/api/types.ts`

**Interfaces:**
- Produces: tipos `PortalTicket`, `PortalTicketEvent`, `PortalTicketDetail`, `PortalSession`; y `portalApi` con `login`, `refresh`, `listTickets`, `getTicket`, `createTicket`, `listSystems`.

- [ ] **Step 1: Crear el cliente con su propio almacenamiento**

`portal.api.ts` crea **su propia instancia de axios**, no reutiliza la de `client.ts`. El token se guarda bajo una clave distinta —`kubo_portal_token`— para que un cliente y un miembro del equipo puedan tener sesión abierta en el mismo navegador sin pisarse.

El interceptor de 401 redirige a `/portal/login`, no al login interno.

Verificar cada ruta y cada forma de cuerpo contra `portal-tickets.controller.ts` y `portal-auth.controller.ts`: **el backend es la autoridad**.

- [ ] **Step 2: Verificar y commitear**

`cd web && npm run build` limpio. Es aditivo: nada se borra.

```bash
git add web/src/api
git commit -m "feat(web): tipos y cliente API del portal"
```

---

### Task 9: Web — layout, login y separación de rutas

**Files:**
- Create: `web/src/layout/PortalLayout.tsx` · `web/src/pages/portal/PortalLoginPage.tsx`
- Create: `web/src/auth/PortalAuthContext.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Produces: rutas `/portal/login` y `/portal/*`; `usePortalAuth()`.

`PortalLayout` es una cabecera mínima con el nombre de la empresa y un botón de salir. **Sin el menú lateral interno** — un cliente no debe ver siquiera los nombres de las secciones internas.

El contexto de sesión del portal es independiente del interno: dos contextos, dos almacenamientos, sin que uno pueda leer el del otro.

Las rutas `/portal/*` quedan fuera del `AppLayout` y de su guard de sesión interna.

- [ ] **Verificar:** `npm run build` limpio, y en el navegador que `/portal/login` se pinta sin menú lateral y que entrar con un usuario de cliente lleva al portal. Commitear.

---

### Task 10: Web — lista, detalle y alta

**Files:**
- Create: `pages/portal/PortalTicketsPage.tsx` · `PortalTicketDetailPage.tsx` · `NewPortalTicketDialog.tsx`
- Modify: `App.tsx`

Seguir las convenciones que las revisiones de las funcionalidades anteriores dejaron asentadas, **todas ellas salidas de hallazgos reales**: guardas `cancelled` en los efectos asíncronos; controles reales, nunca un `<div>` pinchable; los diálogos cierran con Escape y con clic en el backdrop, con `stopPropagation` dentro; ningún fallo se traga en silencio, y un fallo de escritura se lee distinto de un fallo de refresco.

Leer `web/src/pages/tickets/TicketsListPage.tsx` y `NewTicketDialog.tsx` antes de empezar: son el patrón.

La lista muestra código, asunto, estado y fecha. **No** muestra prioridad ni SLA: el endpoint ni siquiera los manda.

- [ ] **Verificar** en el navegador: la lista sale, el detalle sale con su timeline, y crear un ticket lo hace aparecer. Commitear.

---

### Task 11: Verificación de extremo a extremo

**Files:** ninguno, salvo lo que la verificación destape.

El entregable es la evidencia. Con dos usuarios de dos empresas distintas dados de alta desde el panel:

- [ ] Entrar como usuario de la empresa A. Ver solo los tickets de A.
- [ ] Abrir un ticket desde el portal. Comprobar en la base que tiene `origin: PORTAL`, `created_by` nulo y `created_by_client_user_id` puesto, y que su evento `CREATED` lleva `actor_client_user_id`.
- [ ] Desde el panel interno, mover ese ticket a `EN_ATENCION`. Refrescar el portal y ver el cambio reflejado.
- [ ] Con el token de A, pedir por `curl` el detalle de un ticket de la empresa B: **404**.
- [ ] Con el token de A, llamar a un endpoint interno como `GET /tickets`: **401 o 403**, nunca 200.
- [ ] Con un token de personal, llamar a `GET /portal/tickets`: **401**.
- [ ] Inspeccionar el cuerpo crudo de `GET /portal/tickets` y confirmar que no aparecen las cadenas `priority`, `sla`, `assignee` ni `reason`.

Los tres últimos son la razón de ser de esta fase. Dejar la salida real de cada uno en el informe.

- [ ] `cd backend && npm test`, `npm run build`, y `cd web && npm run build` — los tres limpios.

---

## Verificación de cobertura de la spec

| Sección de la spec | Tareas |
|---|---|
| §2 `client_users` | 1, 2 |
| §3 columnas hermanas del actor | 1, 5 |
| §3 invariante de un solo actor | 5 |
| §4 dos secretos JWT | 3 |
| §4 `ClientJwtGuard` y `@CurrentClientUser` | 3 |
| §4 `StaffOnlyGuard` en todo lo interno | 3 |
| §4 el `clientId` sale del token | 6 (test), 11 (verificación) |
| §5 ver todos los tickets de su empresa | 6, 10 |
| §5 abrir un ticket, `origin: PORTAL` | 5, 6, 10 |
| §5 la proyección, sin SLA ni actor | 6 (test), 11 (verificación) |
| §5 404 y no 403 | 6 (test), 11 (verificación) |
| §5 altas desde el panel | 7 |
| §6 estructura de código | 2–10 |
| §7 pruebas | 3, 4, 5, 6, 11 |

**Fuera de P1 por decisión de la spec §8**, sin tarea: requerimientos en el portal y conformidad (P2) · administración delegada e invitaciones (P3) · restablecimiento de contraseña · notificaciones (P4) · ingesta de correo · adjuntos · multi-inquilino.

## Nota sobre el detalle de las tareas de web

Las tareas 1 a 7 llevan el código completo o las reglas exactas. Las 8 a 10 están especificadas a nivel de estructura, convenciones y verificación, apuntando a las páginas existentes como referencia. Es el mismo desnivel que tuvo el plan anterior, y allí funcionó porque las convenciones ya están asentadas — pero es donde más probable es que haga falta una ronda extra de corrección.

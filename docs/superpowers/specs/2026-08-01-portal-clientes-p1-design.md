# Portal de clientes — P1: frontera y portal mínimo

**Fecha:** 2026-08-01
**Estado:** pendiente de revisión del usuario
**Contexto previo:** [mesa de servicio T1](2026-07-31-mesa-de-servicio-t1-design.md) · [work items R1](2026-07-31-work-items-kanban-r1-design.md)

---

## 1. Contexto y decisiones de partida

Kuboti desarrolla sistemas y los arrienda a empresas. Esas empresas necesitan
reportar incidencias sobre los sistemas que tienen contratados, y hoy no tienen
por dónde: la mesa de servicio construida en T1 solo la opera el equipo interno.

### Una sola instalación

**Kubo no se vende como producto.** Es la herramienta con la que Kuboti opera su
negocio de arrendamiento. Crecer significa añadir filas a `clients`, no desplegar
instalaciones nuevas.

Esto se verificó antes de decidir: `workspace_settings` tiene exactamente una
fila —esa fila *es* Kuboti— y en las 27 tablas del esquema no existe ningún
`tenant_id`, `organization_id` ni `workspace_id`. El sistema es de un solo
inquilino por construcción, y eso es correcto para este modelo de negocio.

En consecuencia **no hay multi-inquilino y no hace falta**. Hay una sola frontera
que construir: la de cliente.

### El modelo de datos ya encaja

Lo construido en T1 y R1 corresponde uno a uno con el negocio:

```
Cliente                     → la empresa que arrienda
  └─ Sistemas bajo soporte  → los sistemas que tiene contratados
       └─ Tickets           → lo que reporta sobre ellos
  └─ Requerimientos         → los cambios que pide
```

`client_systems` es el catálogo de lo que cada empresa tiene contigo, y
`sla_policies` por cliente es el nivel de servicio de su contrato.

### Lo que falta

**Una frontera de cliente.** Hoy cualquiera con sesión ve los tickets de todas
las empresas, porque hasta ahora solo entraba el equipo interno. Los proyectos sí
filtran por pertenencia (`ProjectMembersService.isMember`), pero tickets, work
items y clientes no filtran nada.

### Descomposición

| Fase | Contenido | Por qué en ese orden |
|---|---|---|
| **P1** (esta spec) | Frontera + portal mínimo: entrar, ver los tickets de mi empresa, abrir uno | Una frontera sin nada que la atraviese no se puede validar. Con el portal encima sí: se usa y se puede romper en pruebas |
| **P2** | Requerimientos en el portal y conformidad al cerrar | Necesita P1 en marcha y trae sus propias decisiones de producto |
| **P3** | Administración delegada: el admin del cliente invita a los suyos, y restablecimiento de contraseña | Encima de una frontera ya probada en producción |
| **P4** | Notificaciones por correo en cada cambio de estado | Barata y sin riesgo de bucle, porque no se lee correo. Puede adelantarse si urge |

**Ingesta de correo entrante: descartada por ahora.** Con un portal donde los
clientes tienen cuenta, el correo deja de ser la vía principal. Se reconsidera si
tras unos meses se comprueba que los clientes siguen escribiendo a
`ticket@kuboti.com` igualmente — entonces se sabrá que hace falta, en vez de
suponerlo. Las credenciales IMAP quedan anotadas en `SECRETS.local.txt`.

---

## 2. Dos poblaciones, dos tablas

Los usuarios de cliente viven en una tabla propia, **no** en `users`.

La alternativa era una columna `client_id` nullable en `users` más dos roles
nuevos, reutilizando el login existente. Se descartó a favor de la separación
total: con dos tablas es **estructuralmente imposible** que un usuario de cliente
aparezca en una consulta de personal. Se paga duplicar el flujo de
autenticación a cambio de una garantía que no depende de que nadie se olvide de
un `WHERE`.

### `client_users`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | bigint unsigned PK | |
| `client_id` | bigint **NOT NULL** → `clients` | a qué empresa pertenece |
| `email` | varchar(180) | **unique** en toda la tabla |
| `password_hash` | varchar(255) | bcrypt, igual que `users` |
| `full_name` | varchar(180) | |
| `is_admin` | tinyint default 0 | reservado para P3; en P1 no gobierna nada |
| `is_active` | tinyint default 1 | |
| `last_login_at` | datetime nullable | |
| `created_by` | bigint → `users` | quién del equipo lo dio de alta |
| `created_at`, `updated_at` | timestamp | |

Índices: `client_id`, y único sobre `email`.

`is_admin` se crea en P1 aunque no haga nada todavía: es una columna, y P3 la
necesita. La distinción admin/usuario **sí** entra en el modelo desde el
principio porque cambiarla después obligaría a migrar filas.

---

## 3. El problema del actor

Cinco columnas del sistema asumen hoy que quien actúa pertenece al equipo:

```
tickets.created_by              NOT NULL  → users.id
tickets.assignee_user_id                  → users.id
ticket_events.actor_user_id               → users.id
work_items.created_by           NOT NULL  → users.id
work_item_events.actor_user_id            → users.id
```

Con una tabla aparte, un ticket abierto desde el portal no tiene un `users.id`
que poner ahí, y su evento `CREATED` tampoco.

**Solución: columnas hermanas, con exactamente una puesta.**

| Columna | Cambio |
|---|---|
| `tickets.created_by` | pasa a **nullable** |
| `tickets.created_by_client_user_id` | nueva, nullable |
| `ticket_events.actor_client_user_id` | nueva, nullable |
| `work_items.created_by` | pasa a **nullable** |
| `work_items.created_by_client_user_id` | nueva, nullable |
| `work_item_events.actor_client_user_id` | nueva, nullable |

`ticket_events.actor_user_id` y `work_item_events.actor_user_id` ya son nullable
—`NULL` significa «lo hizo el sistema», como el cron de SLA en riesgo—. Con la
columna hermana, la lectura pasa a ser: ambas nulas = el sistema; una puesta = esa
persona.

`assignee_user_id` **no cambia**: sigue apuntando solo a `users`. Un cliente nunca
es responsable de resolver su propio ticket, así que la restricción es correcta.

Se descartó un actor polimórfico (`actor_type` + `actor_id`): más elegante sobre
el papel, peor de consultar, y sin ventaja real con solo dos poblaciones.

### Invariante

En cada fila, `created_by` y `created_by_client_user_id` no pueden estar ambas
puestas. Se valida en el servicio, no con un `CHECK` — el esquema no usa
restricciones declarativas en ningún sitio y no se va a empezar aquí.

### Migración

Todo lo anterior —la tabla `client_users`, las cuatro columnas hermanas y los dos
`created_by` que pasan a nullable— va en `013_portal_clientes.sql`. La última
migración existente es `012_work_items.sql`.

Los `ALTER TABLE` deben ir guardados con `information_schema`, como se corrigió en
la 010: un `ALTER` sin guardar rompe el `initdb` al reejecutarse y detiene toda la
cadena. Y hay que montarla en **ambos** `docker-compose`, que es el paso que se
olvidó en T1 y dejó un entorno nuevo sin tablas.

---

## 4. La frontera

### Dos secretos, no uno

Los tokens de cliente se firman con **secretos propios**
(`JWT_CLIENT_ACCESS_SECRET`, `JWT_CLIENT_REFRESH_SECRET`), distintos de los del
personal.

Es el mismo razonamiento que llevó a separar las tablas: con secretos distintos,
un token de cliente **no valida** contra la estrategia del personal, ni por error
ni por descuido. La frontera deja de depender de que un guard inspeccione el
contenido del token y pasa a ser criptográfica.

Payload del token de cliente:

```
{ sub: clientUserId, email, clientId, isClientAdmin }
```

### Dos guards

- **`ClientJwtGuard`** — valida el token de cliente y expone
  `{ clientUserId, clientId, isClientAdmin }` mediante un decorador
  `@CurrentClientUser`, hermano del `@CurrentUser` existente.
- **`StaffOnlyGuard`** — se aplica a **todo lo existente**.

Lo segundo es el punto más delicado de todo el diseño. Hoy `JwtAuthGuard` acepta
cualquier token que valide. Con secretos separados un token de cliente ya no
valida ahí, así que `StaffOnlyGuard` es la segunda barrera, no la primera — pero
va igualmente, porque una sola barrera en algo así es una barrera de menos.

### Reglas de las consultas del portal

1. Los endpoints del portal viven bajo `/portal/*` y **no reutilizan** los
   internos.
2. **El `clientId` sale siempre del token.** Nunca del cuerpo, nunca de la URL,
   nunca de un parámetro. Un endpoint del portal que acepte un `clientId` del
   cliente es un fallo de seguridad, no un descuido.
3. Cada consulta filtra por ese `clientId` antes de devolver nada.

---

## 5. Qué hace P1

Un usuario de cliente entra en `/portal` y:

- **Ve todos los tickets de su empresa**, no solo los que abrió él. Si el
  contacto habitual se va de vacaciones, su compañero tiene que poder seguir el
  caso.
- **Abre un ticket nuevo**: elige uno de los sistemas que su empresa tiene bajo
  soporte, pone asunto y descripción. Nace con `origin: PORTAL` —valor que ya
  existe en el enum desde T1— y `status: NUEVO`.
- **Ve el detalle** de un ticket con su estado, su avance y su timeline.

El usuario **no** ve: la prioridad interna ni el reloj de SLA, quién de tu equipo
lo atiende, ni los tickets de ninguna otra empresa.

Las altas de usuarios las hace el equipo interno a mano, desde el panel. La
invitación y la administración delegada son P3.

### Endpoints

```
POST   /portal/auth/login          { email, password } → tokens de cliente
POST   /portal/auth/refresh
GET    /portal/tickets             los del clientId del token
GET    /portal/tickets/:id         404 si no es de su cliente, nunca 403
POST   /portal/tickets             { systemId?, subject, description }
GET    /portal/systems             los sistemas activos de su cliente

GET    /client-users               (interno, staff) listar y dar de alta
POST   /client-users
PATCH  /client-users/:id
```

**404 y no 403 en el detalle ajeno**: un 403 confirma que ese ticket existe. El
404 no filtra nada.

### La respuesta del portal es un DTO propio, no la entidad

`TicketsRepository` devuelve la entidad completa: prioridad, política de SLA,
vencimientos, `assigneeUserId`, `slaAtRisk`. Devolver eso al portal filtraría
exactamente lo que §5 dice que el cliente no debe ver, y hacerlo desde el
frontend no sirve de nada: el dato ya viajó.

El portal expone una proyección explícita, campo por campo:

```ts
{
  id, code, subject, descriptionMd,
  status,                 // el estado, sí: es lo que viene a consultar
  systemId, systemName,
  createdAt, resolvedAt, closedAt,
  timeline: [ { type, fromStatus, toStatus, createdAt } ]   // sin reason ni actor
}
```

El `reason` de un evento se omite a propósito: puede contener notas internas
(«derivado por saturación del pool»). El actor también: el cliente no necesita
saber qué técnico movió qué.

### El texto del formulario

`tickets.raw_text` es `NOT NULL` y guarda el texto tal como llegó. El campo
`description` del formulario **es** ese texto: se escribe en `raw_text`, y
`subject` en `subject`. `description_md` queda nulo hasta que alguien del equipo
estructure el ticket, con IA o a mano — igual que un ticket que entra por
cualquier otro origen.

---

## 6. Estructura de código

**Backend** — `backend/src/modules/portal/`, siguiendo el patrón de los módulos
existentes:

```
portal-auth.service.ts        login y refresh de cliente
portal-auth.controller.ts
client-jwt.strategy.ts        estrategia passport con el secreto de cliente
guards/client-jwt.guard.ts
guards/staff-only.guard.ts    se aplica a los controladores internos
decorators/current-client-user.decorator.ts
portal-tickets.controller.ts  las consultas acotadas
portal.service.ts
entities/client-user.entity.ts
client-users.repository.ts
client-users.service.ts       alta y gestión desde el panel interno
client-users.controller.ts
```

El módulo reutiliza `TicketsRepository` con un filtro obligatorio de cliente, en
lugar de duplicar el acceso a datos.

**Web** — el portal es una zona separada de la aplicación, con su propio layout
sin el menú lateral interno:

```
pages/portal/PortalLoginPage.tsx
pages/portal/PortalTicketsPage.tsx
pages/portal/PortalTicketDetailPage.tsx
pages/portal/NewPortalTicketDialog.tsx
api/portal.api.ts             cliente con su propio almacenamiento de token
layout/PortalLayout.tsx
```

El token de cliente se guarda por separado del de personal, para que las dos
sesiones puedan coexistir en el mismo navegador sin pisarse.

---

## 7. Pruebas

Con tests unitarios:

- **El filtro de cliente**: la consulta de tickets del portal siempre incluye el
  `clientId`, y un `clientId` en el cuerpo de la petición se ignora.
- **El detalle ajeno** devuelve 404, no 403 ni el ticket.
- **La invariante del actor**: crear con ambas columnas puestas se rechaza.

Con tests de integración:

- Un token de cliente **no valida** contra la estrategia del personal.
- Un token de personal **no valida** contra la del portal.
- `StaffOnlyGuard` rechaza un token de cliente en un endpoint interno.

Ese último bloque es el que justifica la fase: son las pruebas que demuestran que
la frontera existe de verdad.

---

## 8. Fuera de alcance en P1

Requerimientos en el portal y conformidad al cerrar (P2) · administración
delegada e invitaciones (P3) · restablecimiento de contraseña, que va con P3
porque necesita el flujo de invitación · notificaciones por correo (P4) · ingesta
de correo entrante · adjuntos en los tickets del portal · multi-inquilino.

---

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Un endpoint interno alcanzable con un token de cliente | Secretos JWT distintos (barrera criptográfica) más `StaffOnlyGuard` (barrera explícita). Test de integración que lo demuestra |
| Un endpoint del portal que acepte `clientId` de fuera del token | Regla escrita en la spec y test unitario que envía un `clientId` en el cuerpo y comprueba que se ignora |
| Hacer nullable `created_by` debilita una restricción existente | La invariante se valida en el servicio. Los tickets creados por el equipo siguen exigiendo `created_by` |
| Superficie de autenticación pública nueva | Login del portal con limitación de intentos. El sistema hoy no expone nada sin sesión, así que es un cambio real de exposición |
| El portal muestra datos de más | El usuario no ve prioridad, SLA ni asignado. Revisar campo por campo lo que devuelve el endpoint, no solo lo que pinta la interfaz |

# Sistema obligatorio + acciones confirmadas del MCP — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** que ningún ticket de un cliente con sistemas se trabaje sin sistema (con avisos de los pendientes y de clientes sin sistemas), y que el MCP pueda cambiar a Espera/Derivado, asignar y responder al cliente previa confirmación de la persona.

**Specs:** `docs/superpowers/specs/2026-11-27-sistema-obligatorio-design.md`, `docs/superpowers/specs/2026-11-27-mcp-acciones-confirmadas-design.md`

## Global Constraints
- Error de sistema faltante: **409 `{ code: 'SISTEMA_REQUERIDO', message: 'Asigna el sistema del ticket antes de <acción>.' }`**.
- La regla aplica solo a **acciones de personas** (controlador de tickets y conector): las transiciones automáticas (respuesta del cliente, monitoreo) no se bloquean.
- Exentos: origen interno (`isInternalTicketOrigin`), ticket sin cliente, cliente sin sistemas activos.
- «Sin sistema» pendiente = no archivado, estado ∉ {RESUELTO, CERRADO}, origen no interno, `system_id IS NULL`, cliente con ≥1 sistema activo.
- MCP: las tres acciones nuevas solo llaman a DevDocs tras `elicitInput` con `action === 'accept'` y confirmación explícita; sin soporte de elicitación → no ejecuta.

## Review Focus
1. Cliente responde por correo a un ticket en ESPERA_CLIENTE sin sistema → la transición automática a EN_ATENCION sigue funcionando (T1).
2. Ticket de MONITOREO sin sistema → se puede tomar y mover (T1).
3. Cliente sin ningún sistema → sus tickets se trabajan sin bloqueo y el cliente aparece en «sin sistemas» si tiene tickets o usuarios (T1, T3).
4. MCP: la persona rechaza o cancela el cuadro → no se llama a DevDocs (T6).
5. `responder` del conector sobre un ticket ajeno → 409 sin enviar nada al cliente (T5).

---

### Task 1: Regla «sistema antes de trabajar»
**Files:** Create `backend/src/modules/tickets/ticket-system-guard.service.ts` (+ spec). Modify `tickets.controller.ts`, `tickets.module.ts`.
**Produces:** `TicketSystemGuard.assertCanWork(ticketId: number, accion: string): Promise<void>`.
- [ ] Tests: sin sistema + cliente con sistemas → 409 SISTEMA_REQUERIDO; con sistema → ok; MONITOREO → ok; cliente sin sistemas → ok; sin cliente → ok.
- [ ] Llamarlo en el controlador antes de `assign`, `take`, `escalate`, `conclude` y `transition` (solo si `toStatus` ∉ {NUEVO, TRIAJE}).
- [ ] Commit.

### Task 2: Portal — sistema obligatorio al crear si la empresa tiene sistemas
**Files:** Modify `portal/portal-tickets.service.ts` (+ spec).
- [ ] Test: cliente con sistemas y sin `systemId` → 400 `BAD_INPUT` «Elige el sistema…»; cliente sin sistemas → se crea sin sistema.
- [ ] Commit.

### Task 3: Conteos y filtros
**Files:** Modify `tickets.repository.ts`, `tickets.controller.ts`, `clients` (controller/service).
**Produces:** `GET /tickets/sin-sistema/resumen` → `{ total, porCliente: [{ clientId, cliente, total }] }`; filtro `sinSistema=1` en `GET /tickets`; `GET /clients/sin-sistemas` → `[{ id, razonSocial, tickets, usuariosPortal }]`.
- [ ] Tests de las rutas con servicios simulados y verificación SQL en MySQL local.
- [ ] Commit.

### Task 4: Web
- [ ] Franja global en `AppLayout` (personal) con el resumen; enlace a `/tickets?sinSistema=1`; la Mesa de servicio respeta ese parámetro.
- [ ] Detalle del ticket: aviso ámbar con selector de sistema cuando falta y el cliente tiene sistemas; errores `SISTEMA_REQUERIDO` muestran su mensaje.
- [ ] Portal: el selector de sistema es obligatorio si hay sistemas.
- [ ] Clientes: etiqueta «Sin sistemas» + nota; aviso en la ficha con enlace a la pestaña Sistemas.
- [ ] Build + capturas. Commit.

### Task 5: Conector — estados, asignar y responder
**Files:** Modify `dev-connector/dev-api.service.ts`, `dev-api.controller.ts`, DTOs (+ specs).
**Produces:** `POST /dev/items/:code/estado` admite ticket propio EN_ATENCION → ESPERA_CLIENTE | DERIVADO con `motivo` obligatorio; `POST /dev/items/:code/asignar { persona }` (correo o nombre de personal activo); `POST /dev/items/:code/responder { texto }` (mensaje público del dueño de la clave, `via: 'claude'`).
- [ ] Tests: reglas 409 (ajeno / estado no permitido / cerrado), 400 persona inexistente o ambigua, responder crea mensaje público por el servicio normal.
- [ ] Commit.

### Task 6: MCP (`kubo-devdocs-mcp`)
- [ ] `cambiar_estado` ampliada, `asignar_ticket`, `responder_cliente`, cada una con `elicitInput` (resumen exacto); sin soporte o rechazo → no ejecuta.
- [ ] Tests con cliente simulado (acepta / rechaza / sin elicitación). README y guía del conector. Commit.

### Task 7: Verificación, revisión y publicación
- [ ] Suites completas, build, revisión independiente, PR + merge + despliegue de DevDocs; push del MCP a su `main`.

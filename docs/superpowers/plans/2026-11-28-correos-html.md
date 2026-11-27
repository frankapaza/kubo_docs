# Correos con diseño Kubo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo correo de DevDocs sale dentro de un marco HTML con el logo KUBO incrustado y los colores de kuboti.com.

**Architecture:** Un módulo puro `email-layout.ts` arma el marco y los botones; `EmailService.send` envuelve todo `html` y adjunta el logo inline (`cid:`). Los correos que hoy traen documento completo pasan a devolver solo su contenido. La previsualización del panel usa el mismo marco con el logo como `data:` URI.

**Tech Stack:** NestJS 10, nodemailer, Jest.

**Spec:** docs/superpowers/specs/2026-11-28-correos-html-design.md

## Global Constraints

- Azul de marca `#053777`, azul oscuro `#012660`; logo `https://kuboti.com/wp-content/uploads/2023/01/kubo.png` (506×153) incrustado en base64, nunca enlazado.
- Pie exacto: «Kubo Soluciones Tecnológicas · kuboti.com · Este correo es automático.»
- Solo tablas y estilos en línea; ancho máximo 600px.
- La parte `text` de cada correo no cambia.
- No usar imágenes de personas.
- Botón: etiqueta y `href` escapados; solo `http(s)://`.

## Review Focus

- Un HTML que ya trae el marco (reenvío, prueba) no se envuelve dos veces → test en Task 1.
- `attachments` propios del llamador (PDF de documentos) se conservan junto al logo → test en Task 1.
- Una línea de plantilla con URL más texto no se vuelve botón (solo la línea que es únicamente URL) → test en Task 2.
- Una URL `javascript:` nunca llega a un botón → test en Task 1.
- La previsualización no usa `cid:` (el iframe no lo resuelve) → test en Task 2.

---

### Task 1: Marco común y envío con logo

**Files:**
- Create: `backend/src/modules/email/kubo-logo.ts`, `backend/src/modules/email/email-layout.ts`, `backend/src/modules/email/email-layout.spec.ts`
- Modify: `backend/src/modules/email/email.service.ts`, `backend/src/modules/email/email.service.spec.ts`

**Interfaces — Produces:**
- `KUBO_LOGO_PNG_BASE64: string`, `KUBO_LOGO_CID = 'kubo-logo@kuboti.com'`
- `wrapEmailLayout(contentHtml: string, opts: { logoSrc: string }): string` — documento completo con marcador `<!--kubo-layout-->`; idempotente.
- `emailButton(href: string, label: string): string` — `''` si `href` no es http(s).
- `kuboLogoDataUri(): string`
- `EmailAttachment.cid?: string`

- [ ] Tests (`email-layout.spec.ts`): envuelve con logo `cid:`, `#053777` y el pie exacto; segunda llamada devuelve lo mismo; `emailButton('javascript:alert(1)','x') === ''`; `emailButton` escapa `"` y `<`.
- [ ] Tests (`email.service.spec.ts`): `sendMail` recibe `html` envuelto y `attachments` = los del llamador + `{ cid: KUBO_LOGO_CID, contentType: 'image/png' }`.
- [ ] Ver fallar, implementar, ver pasar, commit.

### Task 2: Plantillas del panel

**Files:** Modify `backend/src/modules/notifications/domain/email-compose.ts`, `notification-templates.service.ts` (+ specs).

- [ ] Test: párrafo cuyo único contenido es una URL → `emailButton(url, url incluye '/portal/' ? 'Ver en el portal' : 'Abrir enlace')`; párrafo «Mira https://x.pe hoy» sigue como enlace normal.
- [ ] Test: `preview()` devuelve `html` envuelto con `data:image/png;base64,` y sin `cid:`.
- [ ] Ver fallar, implementar, ver pasar, commit.

### Task 3: Correos armados a mano

**Files:** Modify `portal/invitation-email.ts`, `requirement-detail/requirement-detail.service.ts`, `document-signatories/document-signatories.service.ts`, `documents/documents.service.ts`, `availability/agent-silence.watch.ts`, `availability/probe-silence.watch.ts` (+ specs que comprueban el HTML).

- [ ] Botones: «Elegir mi contraseña», «Completar en el portal», «Revisar y firmar documento», «Ver servidores», «Ver sondas»; documentos según su enlace actual.
- [ ] Firma y documentos devuelven solo el contenido (sin `<!DOCTYPE>`), sin morado (`#4F46E5`, `#6366F1`), conservando el nombre del emisor.
- [ ] Ajustar specs existentes; suite completa verde; commit.

### Verificación final

- [ ] Renderizar cada correo de ejemplo a un HTML local y mirarlo en el navegador (ancho escritorio y 375px).
- [ ] Revisión final de toda la rama, arreglos, publicar (PR, CI, merge, despliegue).

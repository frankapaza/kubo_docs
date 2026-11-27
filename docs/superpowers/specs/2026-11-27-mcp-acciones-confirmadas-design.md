# MCP kubo-devdocs: acciones nuevas con confirmación del usuario — Diseño corto

## Para qué
Hoy el conector solo toma, resuelve, deja notas internas, guarda borradores de respuesta y mueve unos pocos estados. El responsable quiere que Claude también pueda:
1. pasar sus tickets a **Espera del cliente** y **derivarlos**;
2. **asignar** un ticket a otra persona del equipo;
3. **responder al cliente** directamente, sin borrador.

Condición del responsable: estas tres acciones solo se ejecutan **después de que la persona lo confirme**.

## Cómo se confirma
- **Elicitación MCP** (`elicitInput`):
  - Antes de llamar a DevDocs, el servidor MCP pide la confirmación al cliente MCP.
  - Claude Code muestra un cuadro a la persona con el resumen exacto de la acción: ticket, estado o persona destino, y el texto completo de la respuesta.
  - Solo con «Confirmar» se envía la petición. El modelo no puede contestar por la persona.
- **Sin soporte de elicitación o si la persona rechaza:**
  - Un cliente MCP que no soporte elicitación hace que la herramienta **no ejecute nada** y lo explique.
  - Rechazar o cancelar el cuadro tampoco ejecuta nada.
- **Límite conocido:** quien llame a la API del conector directamente con la clave, sin el MCP, no ve ningún cuadro. La clave es personal del desarrollador, igual que hoy.

## Herramientas nuevas (repo `kubo-devdocs-mcp`)
| Herramienta | Qué hace | Endpoint |
|---|---|---|
| `cambiar_estado` (ampliada) | Además de lo actual: ticket propio de *En atención* a **Espera del cliente** (con motivo) o **Derivado** (con motivo). | `POST /dev/items/:code/estado` |
| `asignar_ticket(codigo, persona)` | Asigna el ticket a otra persona activa del equipo, por correo o nombre. | `POST /dev/items/:code/asignar` (nuevo) |
| `responder_cliente(codigo, texto)` | Envía una respuesta pública al cliente como el dueño de la clave, con el mismo efecto que responder desde DevDocs (correo o portal y avisos). Queda marcada `via = 'claude'`. | `POST /dev/items/:code/responder` (nuevo) |

## Reglas en DevDocs (backend)
- **Pasan por los servicios existentes:** transiciones, asignación y mensajes. Así eventos, SLA, avisos y tiempo real funcionan igual que desde la web.
- **Cada acción, con su condición:**
  - Cambiar estado y responder: solo sobre tickets **asignados al dueño de la clave**; si no, 409 «tómalo primero».
  - Asignar: sobre cualquier ticket del sistema de la clave, salvo resuelto o cerrado. La persona destino debe ser del personal activo; si no, 400 con la lista de válidos.
- **Sistema obligatorio** (diseño aparte, 2026-11-27-sistema-obligatorio): todas estas acciones exigen que el ticket tenga sistema, cosa que el conector ya garantiza porque solo ve tickets de su sistema.

## Lo que queda al constructor
- **Texto del cuadro de confirmación:** claro, con el texto completo de la respuesta.
- **Pruebas:**
  - confirmar ejecuta y rechazar no;
  - un cliente sin elicitación no ejecuta;
  - las reglas 409/400 del backend.
- **Documentación:** actualizar la guía del conector.

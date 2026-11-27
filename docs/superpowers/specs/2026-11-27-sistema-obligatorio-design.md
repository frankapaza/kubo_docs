# Sistema obligatorio en tickets — Diseño corto

## Para qué
Un ticket sin *Sistema* es invisible para el conector MCP (cada clave está atada a un sistema) y queda fuera de los filtros por sistema. Pasó con GrupoVyV: KB-0020..KB-0027 sin sistema, ninguna conexión los veía.

## Por qué no se exige al crear
Los tickets entran por correo, WhatsApp, notas, reuniones, portal y monitoreo. En varias vías el sistema no se conoce al crear; exigirlo ahí perdería tickets. Se exige **antes de trabajar el ticket** y se hace **visible** lo pendiente.

## Enfoques
| | Enfoque | Resultado |
|---|---|---|
| 1 | Obligatorio antes de trabajar el ticket (y en el portal al crear) | Elegido |
| 2 | Aviso al entrar al panel con los tickets sin sistema | Elegido |
| 3 | Aviso de clientes sin sistemas configurados | Elegido |
| — | Exigir el sistema al crear en todas las vías | Descartado: correo/WhatsApp no lo traen |

## 1. Obligatorio antes de trabajar
- **Regla:** si el cliente del ticket tiene al menos un sistema activo y el ticket no tiene sistema, el backend rechaza con **409 `SISTEMA_REQUERIDO`** («Asigna el sistema del ticket antes de…»):
  - `assign`, `take`, `escalate`;
  - `transition` a cualquier estado distinto de `NUEVO`/`TRIAJE`, también `conclude`.
- **Excepciones:** tickets de origen interno (`MONITOREO`) y tickets de clientes sin sistemas activos (no hay nada que elegir; lo cubre el punto 3). Editar, archivar, comentar y cambiar de cliente siguen libres.
- **Panel (detalle del ticket):** si falta el sistema y el cliente tiene sistemas, un aviso ámbar con el selector de sistema justo ahí: «Asigna el sistema para poder tomar o mover este ticket». Si una acción devuelve `SISTEMA_REQUERIDO`, se muestra ese mensaje.
- **Portal:** al crear un ticket, el sistema es obligatorio cuando la empresa tiene sistemas (formulario y backend → 400 si falta).

## 2. Aviso de tickets sin sistema
- **Endpoint (personal):** `GET /tickets/sin-sistema/resumen` → `{ total, porCliente: [{ clientId, cliente, total }] }`. Cuenta los tickets que cumplen todo esto:
  - no archivados;
  - en estado distinto de `RESUELTO`/`CERRADO`;
  - de origen no interno;
  - sin sistema;
  - de un cliente con sistemas activos.
- **Filtro** en la lista de tickets: `sinSistema=1`, con las mismas condiciones.
- **Franja** ámbar arriba del contenido del panel (todas las páginas), visible para el personal y solo si `total > 0`: «⚠ N tickets sin sistema asignado (Cliente A: n, …) · Revisar», que abre la Mesa de servicio filtrada. Se refresca cada 5 minutos y al cambiar de página.

## 3. Clientes sin sistemas
- **Endpoint (personal):** `GET /clients/sin-sistemas` → clientes sin ningún sistema activo que **sí** tienen tickets o usuarios del portal (los demás aún no operan).
- **En Clientes:** etiqueta «Sin sistemas» en esos clientes y una nota arriba de la lista: «N clientes sin sistemas: sus tickets no pueden clasificarse ni llegar al MCP».
- **En la ficha del cliente:** el mismo aviso con enlace a la pestaña «Sistemas».

## Lo que queda al constructor
Dónde vive cada consulta (repositorios existentes), el diseño visual con los estilos actuales y las pruebas (reglas del 409 por acción, conteos con y sin sistemas, portal obligatorio solo con sistemas).

-- =========================================================================
--  Migración 015 — Notificaciones por correo
-- =========================================================================
--  · `ticket_events` pasa a ser la bandeja de salida transaccional: se le
--    añaden las columnas de notificación y un vigilante leerá las filas ya
--    confirmadas que aún no se hayan procesado.
--  · `notification_templates`: una fila por aviso, editable desde el panel,
--    sembrada con textos por defecto para que la funcionalidad sirva desde
--    el minuto uno.
--  · `workspace_settings.team_inbox_email`: el buzón del equipo.
--
--  EL PUNTO QUE NO SE PUEDE EQUIVOCAR — el sellado del histórico.
--  `ticket_events` tiene cientos de filas de meses atrás. Si `notified_at`
--  nace nula, el primer arranque del vigilante manda un correo por cada
--  evento histórico a clientes reales, y eso no se puede recoger. Por eso el
--  UPDATE que sella lo existente va DENTRO del mismo IF que crea la columna
--  (ver `kubo_seal_notified_015` más abajo), nunca suelto al final: el
--  ADD COLUMN está guardado y se salta en la segunda pasada, pero un UPDATE
--  suelto se ejecutaría siempre y sellaría como notificados los eventos que
--  estaban legítimamente pendientes, apagando en silencio los avisos que
--  faltaban por mandar. Es un fallo que no da ningún error: solo se nota
--  porque los correos dejan de llegar.
--
--  Los ALTER van guardados con information_schema: uno sin guardar rompe
--  el initdb al reejecutarse y detiene toda la cadena.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- -------------------------------------------------------------------------
-- 0) Ayudante guardado para las columnas que no llevan sellado
-- -------------------------------------------------------------------------
--  Guarda por TABLA y por COLUMNA, en ese orden. Comprobar solo la columna no
--  basta: si la tabla no existe, la consulta a COLUMNS no devuelve filas, el
--  IF sale verdadero y el ALTER revienta con ER_NO_SUCH_TABLE. Bajo
--  docker-entrypoint-initdb.d eso detiene la cadena entera de migraciones,
--  que es justo lo que advierte la cabecera.
--
--  Y no es hipotético aquí: `workspace_settings` nace en los
--  `add_workspace_*.sql`, que solo monta `docker-compose.dev.yml`. En el
--  inventario de `docker-compose.yml` esa tabla no existe, y con
--  `synchronize: false` nadie la crea después. Sin la guarda de tabla, el CALL
--  sobre `workspace_settings` falla ahí. Con ella, se salta en silencio: la
--  columna llegará el día que la tabla llegue.
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_column_015;
DELIMITER //
CREATE PROCEDURE kubo_add_column_015(
  IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_ddl VARCHAR(512))
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE ', p_table, ' ADD COLUMN ', p_ddl);
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

-- -------------------------------------------------------------------------
-- 1) `notified_at` y el sellado del histórico, en el mismo IF
-- -------------------------------------------------------------------------
--  El UPDATE está aquí dentro a propósito. Solo corre la vez que se crea la
--  columna. En cualquier reejecución el IF es falso, no se toca ni una fila,
--  y los eventos que estén pendientes de notificar siguen pendientes.
--
--  Aquí no hace falta la guarda de tabla que sí lleva `kubo_add_column_015`:
--  `ticket_events` la crea la 010, que está montada en los dos compose. Y si
--  algún día no lo estuviera, esto debe reventar y no seguir en silencio: sin
--  la bandeja de salida la migración no significa nada.
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_seal_notified_015;
DELIMITER //
CREATE PROCEDURE kubo_seal_notified_015()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ticket_events' AND COLUMN_NAME = 'notified_at'
  ) THEN
    SET @sql = CONCAT(
      'ALTER TABLE ticket_events ADD COLUMN notified_at DATETIME NULL ',
      'COMMENT ''cuando se proceso la fila; NULL = pendiente'' ',
      'AFTER created_at');
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

    -- Sella TODO lo existente como ya notificado. Sin esto, el primer
    -- arranque del vigilante envía un correo por cada evento histórico.
    SET @sql = 'UPDATE ticket_events SET notified_at = created_at';
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

CALL kubo_seal_notified_015();

DROP PROCEDURE IF EXISTS kubo_seal_notified_015;

-- -------------------------------------------------------------------------
-- 2) El resto de columnas de notificación en `ticket_events`
-- -------------------------------------------------------------------------
CALL kubo_add_column_015('ticket_events', 'notify_attempts',
  'notify_attempts INT NOT NULL DEFAULT 0 '
  'COMMENT ''intentos de envio; se reintenta con espera creciente hasta un tope'' '
  'AFTER notified_at');
CALL kubo_add_column_015('ticket_events', 'notify_last_error',
  'notify_last_error VARCHAR(500) NULL '
  'COMMENT ''ultimo error de envio, para poder mirarlo despues'' '
  'AFTER notify_attempts');

-- Índice de la cola: el vigilante pide las pendientes por orden de llegada.
-- Sin él recorre la tabla entera en cada pasada.
DROP PROCEDURE IF EXISTS kubo_add_index_015;
DELIMITER //
CREATE PROCEDURE kubo_add_index_015()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ticket_events' AND INDEX_NAME = 'idx_ticket_events_notify'
  ) THEN
    ALTER TABLE ticket_events ADD INDEX idx_ticket_events_notify (notified_at, id);
  END IF;
END //
DELIMITER ;

CALL kubo_add_index_015();

DROP PROCEDURE IF EXISTS kubo_add_index_015;

-- -------------------------------------------------------------------------
-- 3) Plantillas de los avisos
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_templates (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  trigger_key  VARCHAR(60)     NOT NULL COMMENT 'que aviso es',
  audience     ENUM('CLIENT','TEAM') NOT NULL
               COMMENT 'de que publico son las variables que puede usar',
  subject      VARCHAR(300)    NOT NULL,
  body_md      TEXT            NOT NULL,
  is_active    TINYINT(1)      NOT NULL DEFAULT 1
               COMMENT 'apagarla desactiva ese aviso concreto, sin tocar codigo',
  updated_by   BIGINT UNSIGNED NULL COMMENT 'quien del equipo la edito por ultima vez',
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_notification_templates (trigger_key, audience)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 4) Siembra de los textos por defecto
-- -------------------------------------------------------------------------
--  `ON DUPLICATE KEY UPDATE id = id` hace que reejecutar la migración sea un
--  no-op: no se pisa lo que el usuario haya editado desde el panel.
--
--  Variables por público (spec §4). Una plantilla de CLIENT solo puede usar
--  las de cliente: meter una de equipo filtraría por correo justo lo que el
--  portal se cuida de ocultar, y un correo no se puede retirar.
--
--    CLIENT: {{codigo}} {{asunto}} {{estado}} {{fecha}} {{razon_social}}
--            {{enlace_portal}}
--    TEAM  : las de CLIENT y además {{prioridad}} {{sla}} {{responsable}}
--            {{motivo}} {{enlace_panel}}
--
--  Todos los textos dicen que no se puede responder: no hay ingesta de correo
--  entrante y el instinto de cualquiera es darle a Responder.
-- -------------------------------------------------------------------------
INSERT INTO notification_templates (trigger_key, audience, subject, body_md) VALUES

-- --- Cliente -------------------------------------------------------------
('TICKET_CREATED', 'CLIENT',
 '[{{codigo}}] Recibimos tu solicitud: {{asunto}}',
 'Hola,

Recibimos tu solicitud el {{fecha}}. Ya está registrada y la vamos a revisar.

- **Código:** {{codigo}}
- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Empresa:** {{razon_social}}

Puedes seguir el avance desde el portal cuando quieras:
{{enlace_portal}}

Este correo es automático y **no se puede responder**. Si necesitas agregar
algo, entra al portal y escríbelo ahí: así queda en el ticket y lo ve todo el
equipo.'),

('TICKET_WAITING_CLIENT', 'CLIENT',
 '[{{codigo}}] Necesitamos tu respuesta: {{asunto}}',
 'Hola,

Tu ticket **{{codigo}}** quedó en espera. Necesitamos algo de tu parte para
poder continuar.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Desde:** {{fecha}}

Entra al portal y déjanos ahí lo que te pedimos:
{{enlace_portal}}

Mientras tanto el ticket queda parado, así que mejor no lo dejes pasar.

Este correo es automático y **no se puede responder**. Responde desde el
portal, por favor.'),

('TICKET_RESOLVED', 'CLIENT',
 '[{{codigo}}] Ya está resuelto: {{asunto}}',
 'Hola,

Terminamos de atender tu ticket **{{codigo}}** el {{fecha}}.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}

Revísalo cuando puedas y cuéntanos si quedó bien:
{{enlace_portal}}

Si algo no quedó como esperabas, puedes reabrirlo desde el portal.

Este correo es automático y **no se puede responder**. Usa el portal para
comentarnos cualquier cosa.'),

('TICKET_CLOSED', 'CLIENT',
 '[{{codigo}}] Ticket cerrado: {{asunto}}',
 'Hola,

Cerramos tu ticket **{{codigo}}** el {{fecha}}.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Empresa:** {{razon_social}}

Queda todo el historial guardado en el portal, por si lo necesitas después:
{{enlace_portal}}

Gracias por avisarnos. Si vuelve a pasar, abre un ticket nuevo y lo vemos.

Este correo es automático y **no se puede responder**.'),

('TICKET_REOPENED', 'CLIENT',
 '[{{codigo}}] Reabrimos el ticket: {{asunto}}',
 'Hola,

Tu ticket **{{codigo}}** se reabrió el {{fecha}}. Vuelve a estar en atención.

- **Asunto:** {{asunto}}
- **Estado:** {{estado}}

Puedes seguirlo desde el portal:
{{enlace_portal}}

Este correo es automático y **no se puede responder**. Si tienes que agregar
detalles, hazlo en el portal.'),

-- --- Equipo --------------------------------------------------------------
('TICKET_CREATED_PORTAL', 'TEAM',
 '[{{codigo}}] Ticket nuevo desde el portal — {{razon_social}}',
 'Entró un ticket nuevo por el portal el {{fecha}}.

- **Código:** {{codigo}}
- **Cliente:** {{razon_social}}
- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Prioridad:** {{prioridad}}
- **Vence:** {{sla}}
- **Responsable:** {{responsable}}

Ábrelo en el panel para triarlo y asignarlo:
{{enlace_panel}}

Este correo es automático y **no se puede responder**. Todo se gestiona desde
el panel.'),

('SLA_AT_RISK', 'TEAM',
 '[{{codigo}}] SLA en riesgo — {{razon_social}}',
 'El SLA del ticket **{{codigo}}** está por vencer.

- **Cliente:** {{razon_social}}
- **Asunto:** {{asunto}}
- **Estado:** {{estado}}
- **Prioridad:** {{prioridad}}
- **Vence:** {{sla}}
- **Responsable:** {{responsable}}
- **Detalle:** {{motivo}}

Atiéndelo desde el panel:
{{enlace_panel}}

Este correo es automático y **no se puede responder**.')

ON DUPLICATE KEY UPDATE id = id;

-- -------------------------------------------------------------------------
-- 5) El buzón del equipo, en los ajustes del área de trabajo
-- -------------------------------------------------------------------------
--  Si queda vacío se cae a la dirección del remitente (smtp_from). No se
--  avisa a todos los ADMIN uno por uno: eso convertiría cada alta de un
--  usuario interno en un cambio silencioso de la lista de distribución.
-- -------------------------------------------------------------------------
CALL kubo_add_column_015('workspace_settings', 'team_inbox_email',
  'team_inbox_email VARCHAR(180) NULL '
  'COMMENT ''buzon del equipo; si esta vacio se usa smtp_from'' '
  'AFTER smtp_from');

DROP PROCEDURE IF EXISTS kubo_add_column_015;

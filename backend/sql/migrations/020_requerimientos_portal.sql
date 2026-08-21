-- ---------------------------------------------------------------------------
-- 020: requerimientos pedidos desde el portal de clientes.
--
-- Idempotente, como las anteriores: se puede volver a pasar sin romper nada.
--
-- Las columnas de autoría (work_items.created_by_client_user_id,
-- work_item_events.actor_client_user_id) NO se crean aquí: ya las creó la 013,
-- y `PortalSchemaValidator` las exige desde entonces. Lo único que faltaba era
-- que las entidades las mapearan, que es trabajo de código y no de esquema.
-- ---------------------------------------------------------------------------

USE kubo_devdocs;

-- 1) origin: el hecho que decide si el cliente puede ver el requerimiento.
--
-- Se guarda aparte de created_by_client_user_id a propósito. Quién creó algo y
-- si el cliente puede verlo son dos hechos distintos; colgar el segundo del
-- primero obliga a falsear el autor el día que se quiera compartir con el
-- cliente algo que nació dentro de casa.
--
-- Todas las filas existentes quedan en 'INTERNO' por el DEFAULT: ningún
-- requerimiento ya creado se destapa en el portal al desplegar.
DROP PROCEDURE IF EXISTS kubo_add_column_020;
DELIMITER //
CREATE PROCEDURE kubo_add_column_020(
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

CALL kubo_add_column_020('work_items', 'origin',
  "origin ENUM('INTERNO','PORTAL') NOT NULL DEFAULT 'INTERNO' AFTER client_id");

DROP PROCEDURE IF EXISTS kubo_add_column_020;

-- 2) Estados nuevos.
--
-- MODIFY sobre un ENUM reescribe la tabla. Es idempotente en el sentido que
-- importa: volver a pasarlo deja la columna igual. Los valores existentes se
-- conservan porque el enum nuevo los contiene a todos.
ALTER TABLE work_items
  MODIFY status ENUM(
    'PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO','BLOQUEADO','CANCELADO',
    'SOLICITADO','RECHAZADO'
  ) NOT NULL DEFAULT 'PENDIENTE';

ALTER TABLE work_item_events
  MODIFY from_status ENUM(
    'PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO','BLOQUEADO','CANCELADO',
    'SOLICITADO','RECHAZADO'
  ) NULL;

ALTER TABLE work_item_events
  MODIFY to_status ENUM(
    'PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO','BLOQUEADO','CANCELADO',
    'SOLICITADO','RECHAZADO'
  ) NULL;

-- 3) Tipos de evento nuevos.
ALTER TABLE work_item_events
  MODIFY type ENUM(
    'CREATED','MOVED','ASSIGNED','COMMENT','BLOCKED','UNBLOCKED',
    'CLOSED','REOPENED','CANCELLED','PRIORITY_CHANGED',
    'REQUESTED','ACCEPTED','REJECTED'
  ) NOT NULL;

-- 4) El listado del portal filtra siempre por los dos campos a la vez.
CREATE INDEX idx_wi_client_origin ON work_items (client_id, origin);

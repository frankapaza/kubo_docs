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

-- 2) Estados nuevos y tipos de evento nuevos.
--
-- MODIFY sobre un ENUM reescribe la tabla entera, tenga o no tenga ya el
-- valor nuevo. work_items y work_item_events tienen filas reales, así que
-- reejecutar esto sin guarda no sería gratis: cada pasada manual repetiría
-- la reescritura completa para no cambiar nada. Mismo motivo y mismo patrón
-- que la 018 con `ticket_events.type` (`kubo_add_event_type_018`): mirar
-- `COLUMN_TYPE` por la etiqueta nueva entre comillas antes de tocar la
-- columna. La lista de valores de cada CALL lleva TODOS los que tiene que
-- tener la columna al terminar, viejos y nuevos: un MODIFY que omita uno
-- existente no da error, lo borra en silencio.
DROP PROCEDURE IF EXISTS kubo_modify_enum_020;
DELIMITER //
CREATE PROCEDURE kubo_modify_enum_020(
  IN p_table VARCHAR(64), IN p_column VARCHAR(64),
  IN p_marker VARCHAR(64), IN p_ddl VARCHAR(1024))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'kubo_devdocs'
      AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
      AND COLUMN_TYPE LIKE CONCAT('%''', p_marker, '''%')
  ) THEN
    SET @sql = CONCAT('ALTER TABLE ', p_table, ' MODIFY COLUMN ', p_ddl);
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

-- Los DDL van partidos en literales adyacentes (sin operador entre ellos):
-- MySQL los concatena solo con estar separados por un salto de línea, igual
-- que ya hace la 015 con notify_attempts. Un `||` aquí sería OR lógico, no
-- concatenación: ese operador solo concatena con PIPES_AS_CONCAT activado, y
-- este proyecto no lo activa.
CALL kubo_modify_enum_020('work_items', 'status', 'SOLICITADO',
  "status ENUM('PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO','BLOQUEADO','CANCELADO',"
  "'SOLICITADO','RECHAZADO') NOT NULL DEFAULT 'PENDIENTE'");
CALL kubo_modify_enum_020('work_item_events', 'from_status', 'SOLICITADO',
  "from_status ENUM('PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO','BLOQUEADO','CANCELADO',"
  "'SOLICITADO','RECHAZADO') NULL");
CALL kubo_modify_enum_020('work_item_events', 'to_status', 'SOLICITADO',
  "to_status ENUM('PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO','BLOQUEADO','CANCELADO',"
  "'SOLICITADO','RECHAZADO') NULL");
CALL kubo_modify_enum_020('work_item_events', 'type', 'REQUESTED',
  "type ENUM('CREATED','MOVED','ASSIGNED','COMMENT','BLOCKED','UNBLOCKED','CLOSED','REOPENED',"
  "'CANCELLED','PRIORITY_CHANGED','REQUESTED','ACCEPTED','REJECTED') NOT NULL");

DROP PROCEDURE IF EXISTS kubo_modify_enum_020;

-- 3) El listado del portal filtra siempre por los dos campos a la vez.
--
-- `CREATE INDEX` no admite guarda por sí solo en MySQL 8 (no hay
-- `IF NOT EXISTS`), así que va detrás del mismo patrón de procedimiento que
-- usan `idx_audit_client_user` (014) e `idx_ticket_events_notify` (015):
-- comprobar `information_schema.STATISTICS` antes de crear el índice.
DROP PROCEDURE IF EXISTS kubo_add_index_020;
DELIMITER //
CREATE PROCEDURE kubo_add_index_020()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = 'kubo_devdocs'
      AND TABLE_NAME = 'work_items' AND INDEX_NAME = 'idx_wi_client_origin'
  ) THEN
    ALTER TABLE work_items ADD INDEX idx_wi_client_origin (client_id, origin);
  END IF;
END //
DELIMITER ;

CALL kubo_add_index_020();

DROP PROCEDURE IF EXISTS kubo_add_index_020;

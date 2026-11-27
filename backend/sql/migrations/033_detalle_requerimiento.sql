-- ============================================================================
-- 033 · Requerimientos más detallados
-- ============================================================================
--  · Estado FALTA_INFO: la casa pidió más detalle y espera al cliente. Como
--    SOLICITADO, es anterior al tablero (no se arrastra).
--  · Eventos DETAIL_REQUESTED (la casa pregunta) y DETAIL_PROVIDED (el
--    cliente completa).
--  · `request_type`: CAMBIO (a un sistema existente) o PROYECTO (nuevo /
--    prototipo). Decide la plantilla del formulario y el brief de prototipo.
--
--  Mismo patrón que la 020: cada MODIFY lleva TODOS los valores y solo se
--  ejecuta si el valor nuevo aún no está. Reejecutable.
-- ============================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS kubo_modify_enum_033;
DELIMITER //
CREATE PROCEDURE kubo_modify_enum_033(
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

CALL kubo_modify_enum_033('work_items', 'status', 'FALTA_INFO',
  "status ENUM('PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO','BLOQUEADO','CANCELADO',"
  "'SOLICITADO','RECHAZADO','FALTA_INFO') NOT NULL DEFAULT 'PENDIENTE'");
CALL kubo_modify_enum_033('work_item_events', 'from_status', 'FALTA_INFO',
  "from_status ENUM('PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO','BLOQUEADO','CANCELADO',"
  "'SOLICITADO','RECHAZADO','FALTA_INFO') NULL");
CALL kubo_modify_enum_033('work_item_events', 'to_status', 'FALTA_INFO',
  "to_status ENUM('PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO','BLOQUEADO','CANCELADO',"
  "'SOLICITADO','RECHAZADO','FALTA_INFO') NULL");
CALL kubo_modify_enum_033('work_item_events', 'type', 'DETAIL_REQUESTED',
  "type ENUM('CREATED','MOVED','ASSIGNED','COMMENT','BLOCKED','UNBLOCKED','CLOSED','REOPENED',"
  "'CANCELLED','PRIORITY_CHANGED','REQUESTED','ACCEPTED','REJECTED',"
  "'DETAIL_REQUESTED','DETAIL_PROVIDED') NOT NULL");

DROP PROCEDURE IF EXISTS kubo_modify_enum_033;

DROP PROCEDURE IF EXISTS kubo_add_column_033;
DELIMITER //
CREATE PROCEDURE kubo_add_column_033()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = 'kubo_devdocs' AND TABLE_NAME = 'work_items'
                    AND COLUMN_NAME = 'request_type') THEN
    ALTER TABLE work_items
      ADD COLUMN request_type ENUM('CAMBIO','PROYECTO') NULL AFTER origin;
  END IF;
END //
DELIMITER ;
CALL kubo_add_column_033();
DROP PROCEDURE IF EXISTS kubo_add_column_033;

-- ============================================================================
-- 034 · Archivos que el cliente adjunta a su requerimiento
-- ============================================================================
--  · `work_item_attachments.source` suma CLIENTE: lo subió el cliente desde el
--    portal (al pedir el requerimiento o al responder «Pedir más detalle»).
--  · `uploaded_by_client_user_id`: quién de la empresa lo subió. Va aparte de
--    `uploaded_by_user_id` porque son dos tablas de usuarios distintas
--    (`users` y `client_users`), igual que en los adjuntos de tickets.
--
--  Reejecutable: el MODIFY lleva TODOS los valores y solo corre si CLIENTE
--  aún no está; la columna solo se agrega si falta.
-- ============================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS kubo_migracion_034;
DELIMITER //
CREATE PROCEDURE kubo_migracion_034()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = 'kubo_devdocs' AND TABLE_NAME = 'work_item_attachments'
                    AND COLUMN_NAME = 'source' AND COLUMN_TYPE LIKE '%''CLIENTE''%') THEN
    ALTER TABLE work_item_attachments MODIFY COLUMN source
      ENUM('WEB','CLAUDE','CLIENTE') NOT NULL DEFAULT 'WEB';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = 'kubo_devdocs' AND TABLE_NAME = 'work_item_attachments'
                    AND COLUMN_NAME = 'uploaded_by_client_user_id') THEN
    ALTER TABLE work_item_attachments ADD COLUMN uploaded_by_client_user_id BIGINT UNSIGNED NULL
      COMMENT 'usuario del portal que lo subió (source = CLIENTE)' AFTER uploaded_by_user_id;
  END IF;
END //
DELIMITER ;

CALL kubo_migracion_034();

DROP PROCEDURE IF EXISTS kubo_migracion_034;

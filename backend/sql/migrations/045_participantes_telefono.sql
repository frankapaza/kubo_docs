-- =========================================================================
--  Migración 045 — Teléfono de los participantes de una reunión
-- =========================================================================
--  participants.phone: opcional, para la tabla de participantes del acta
--  (nombre, cargo, correo, teléfono, asistencia) y del editor de entregables.
--
--  Idempotente: columna guardada con information_schema (patrón de la 038).
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS kubo_add_column_045;
DELIMITER //
CREATE PROCEDURE kubo_add_column_045(
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

CALL kubo_add_column_045('participants', 'phone',
  "phone VARCHAR(30) NULL COMMENT 'teléfono opcional del participante' AFTER email");

DROP PROCEDURE IF EXISTS kubo_add_column_045;

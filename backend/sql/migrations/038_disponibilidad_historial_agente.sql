-- =========================================================================
--  Migración 038 — Disponibilidad: historial del agente por día
-- =========================================================================
--  El resumen diario del agente guarda además la media y el máximo de CPU y
--  RAM y la suma de errores del Visor de eventos. Las muestras se purgan a
--  los 30 días; con estas columnas la vista de historial del servidor puede
--  mostrar meses y años. Filas anteriores: NULL / 0 hasta que se recalcule
--  el día.
--
--  Idempotente: guardada con information_schema (patrón de la 036).
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS kubo_add_column_038;
DELIMITER //
CREATE PROCEDURE kubo_add_column_038(
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

CALL kubo_add_column_038('monitor_agent_daily_rollups', 'cpu_avg',
  "cpu_avg DECIMAL(5,2) NULL COMMENT 'media de CPU del dia' AFTER disks_close");
CALL kubo_add_column_038('monitor_agent_daily_rollups', 'cpu_max',
  "cpu_max DECIMAL(5,2) NULL COMMENT 'maximo de CPU del dia' AFTER cpu_avg");
CALL kubo_add_column_038('monitor_agent_daily_rollups', 'ram_avg',
  "ram_avg DECIMAL(5,2) NULL COMMENT 'media de RAM del dia' AFTER cpu_max");
CALL kubo_add_column_038('monitor_agent_daily_rollups', 'ram_max',
  "ram_max DECIMAL(5,2) NULL COMMENT 'maximo de RAM del dia' AFTER ram_avg");
CALL kubo_add_column_038('monitor_agent_daily_rollups', 'event_errors',
  "event_errors INT NOT NULL DEFAULT 0 COMMENT 'errores del Visor de eventos del dia' AFTER ram_max");

DROP PROCEDURE IF EXISTS kubo_add_column_038;

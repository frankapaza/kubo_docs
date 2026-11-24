-- =========================================================================
--  Migración 032 — Disponibilidad: aviso cuando una sonda deja de reportar
-- =========================================================================
--  `silence_alerted_at` guarda cuándo la central avisó por correo de que una
--  sonda llevaba 10 minutos sin reportar. NULL = sin aviso pendiente. Se
--  limpia al avisar de que la sonda volvió, y su valor sirve de guarda para
--  no repetir el aviso en el minuto siguiente.
--
--  Idempotente: guardada con information_schema (patrón de la 028).
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS kubo_add_column_032;
DELIMITER //
CREATE PROCEDURE kubo_add_column_032(
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

CALL kubo_add_column_032('monitor_probes', 'silence_alerted_at',
  "silence_alerted_at DATETIME(3) NULL "
  "COMMENT 'cuando se aviso que la sonda dejo de reportar; NULL = sin aviso' "
  "AFTER clock_skew_ms");

DROP PROCEDURE IF EXISTS kubo_add_column_032;

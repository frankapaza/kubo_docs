-- =========================================================================
--  Migración 028 — Archivar tickets
-- =========================================================================
--  Archivar saca un ticket de la bandeja sin tocar su estado ni su SLA: es
--  una decisión de orden de la mesa ("ya no quiero verlo"), no un paso del
--  ciclo de vida. Por eso son columnas aparte y no un estado más de la
--  máquina de estados: un ticket CERRADO archivado sigue siendo CERRADO, y
--  al desarchivarlo vuelve a la bandeja exactamente como estaba.
--
--  Se puede archivar en cualquier estado (decisión de negocio). Los KPI y el
--  job de riesgo siguen contando por estado: archivar no es cerrar.
--
--  `archived_at` NULL = no archivado. `archived_by` apunta a `users` (solo
--  el personal archiva) y se limpia al desarchivar; el rastro de quién
--  archivó y desarchivó queda en `ticket_events` (ARCHIVED / UNARCHIVED).
--
--  Mismo patrón que la 018 y la 021: procedimientos idempotentes guardados
--  con information_schema, que se crean, se usan y se tiran aquí mismo.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- -------------------------------------------------------------------------
-- 1) Columnas de archivo en `tickets`
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_column_028;
DELIMITER //
CREATE PROCEDURE kubo_add_column_028(
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

CALL kubo_add_column_028('tickets', 'archived_at',
  "archived_at DATETIME NULL "
  "COMMENT 'cuando se archivo; NULL = visible en la bandeja' "
  "AFTER email_message_id");

CALL kubo_add_column_028('tickets', 'archived_by',
  "archived_by BIGINT UNSIGNED NULL "
  "COMMENT 'usuario del personal que lo archivo' "
  "AFTER archived_at");

DROP PROCEDURE IF EXISTS kubo_add_column_028;

-- -------------------------------------------------------------------------
-- 2) Índice: la bandeja filtra por `archived_at IS NULL` en cada carga
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_index_028;
DELIMITER //
CREATE PROCEDURE kubo_add_index_028(
  IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_ddl VARCHAR(512))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = 'kubo_devdocs'
      AND TABLE_NAME = p_table AND INDEX_NAME = p_index
  ) THEN
    SET @sql = CONCAT('ALTER TABLE ', p_table, ' ADD INDEX ', p_ddl);
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

CALL kubo_add_index_028('tickets', 'idx_tickets_archived', 'idx_tickets_archived (archived_at)');

DROP PROCEDURE IF EXISTS kubo_add_index_028;

-- -------------------------------------------------------------------------
-- 3) Tipos de evento nuevos: ARCHIVED y UNARCHIVED
-- -------------------------------------------------------------------------
--  Misma regla que la 018: la lista conserva el orden existente (el orden
--  de un ENUM es su valor interno) y los valores nuevos van al final. La
--  lista de partida es la que dejó la 018, la última que tocó esta columna.
--  La guarda busca la etiqueta entrecomillada para no confundirla con un
--  prefijo o sufijo de otra.
DROP PROCEDURE IF EXISTS kubo_add_event_type_028;
DELIMITER //
CREATE PROCEDURE kubo_add_event_type_028()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket_events'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ticket_events'
      AND COLUMN_NAME = 'type'
      AND COLUMN_TYPE LIKE '%''UNARCHIVED''%'
  ) THEN
    ALTER TABLE ticket_events MODIFY COLUMN type
      ENUM('CREATED','TRIAGED','ASSIGNED','TAKEN','STATUS_CHANGED','ESCALATED',
           'COMMENT','RESOLVED','CLOSED','REOPENED','SLA_AT_RISK',
           'PRIORITY_OVERRIDDEN','MESSAGE_POSTED','ARCHIVED','UNARCHIVED') NOT NULL;
  END IF;
END //
DELIMITER ;

CALL kubo_add_event_type_028();

DROP PROCEDURE IF EXISTS kubo_add_event_type_028;

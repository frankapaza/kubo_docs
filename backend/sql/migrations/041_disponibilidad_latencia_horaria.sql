-- =========================================================================
--  Migración 041 — Disponibilidad: latencia por hora y alerta de lentitud
-- =========================================================================
--  Cada hora la central resume los pings (ICMP) medidos desde la oficina:
--  total, cuántos superan el umbral, promedio, p95 y máximo. Con ≥ 20 % de
--  pings lentos la hora es lenta y se abre un episodio; el primero normal lo
--  cierra. Se avisa por correo al abrir y al cerrar (spec
--  2026-11-28-alerta-latencia). Los destinatarios son administrables en
--  workspace_settings.latency_alert_emails (vacío = administradores activos).
--
--  Idempotente: CREATE TABLE IF NOT EXISTS y columna guardada con
--  information_schema (patrón de la 038). No borra ni vacía nada.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS monitor_latency_hours (
  service_id   BIGINT UNSIGNED NOT NULL,
  hour_start   DATETIME        NOT NULL COMMENT 'inicio de la hora (UTC)',
  total        INT UNSIGNED    NOT NULL,
  slow         INT UNSIGNED    NOT NULL COMMENT 'pings sobre el umbral o fallidos',
  avg_ms       INT UNSIGNED    NULL,
  p95_ms       INT UNSIGNED    NULL,
  max_ms       INT UNSIGNED    NULL,
  threshold_ms INT UNSIGNED    NOT NULL,
  is_slow      TINYINT(1)      NOT NULL DEFAULT 0,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (service_id, hour_start),
  KEY idx_monitor_latency_hours_hour (hour_start),
  CONSTRAINT fk_monitor_latency_hours_service FOREIGN KEY (service_id) REFERENCES monitor_services (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitor_latency_episodes (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  service_id    BIGINT UNSIGNED NOT NULL,
  started_hour  DATETIME        NOT NULL COMMENT 'primera hora lenta (UTC)',
  ended_hour    DATETIME        NULL     COMMENT 'primera hora normal (UTC); NULL = abierto',
  office_wide   TINYINT(1)      NOT NULL DEFAULT 0 COMMENT 'todos los pings lentos a la vez: probable internet de la oficina',
  closed_reason VARCHAR(20)     NULL     COMMENT 'NORMAL | SERVICE_INACTIVE',
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_monitor_latency_episodes_open (service_id, ended_hour),
  CONSTRAINT fk_monitor_latency_episodes_service FOREIGN KEY (service_id) REFERENCES monitor_services (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS kubo_add_column_041;
DELIMITER //
CREATE PROCEDURE kubo_add_column_041(
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

CALL kubo_add_column_041('workspace_settings', 'latency_alert_emails',
  "latency_alert_emails VARCHAR(1000) NULL COMMENT 'correos de la alerta de latencia, separados por coma; NULL = administradores activos'");

DROP PROCEDURE IF EXISTS kubo_add_column_041;

-- =========================================================================
--  Migración 037 — Disponibilidad: informe mensual, evidencias, mantenimiento
--  y agente de servidor
-- =========================================================================
--    · monitor_maintenance          ventanas de mantenimiento (de un servidor
--                                   o de un servicio, exactamente uno).
--    · monitor_evidence             evidencias adjuntas a un incidente.
--    · monitor_daily_rollups        resumen diario por servicio y sonda.
--    · monitor_rollup_days          días ya resumidos.
--    · monitor_probe_gaps           huecos de una sonda (sin datos).
--    · monitor_agent_samples        muestras del agente de servidor.
--    · monitor_agent_daily_rollups  resumen diario del agente.
--    · monitor_monthly_reports      informe mensual congelado por cliente.
--  Además: columnas del agente en monitor_servers e índice
--  idx_monitor_checks_probe_started en monitor_checks (cálculo de huecos).
--
--  Todos los instantes son DATETIME(3) en UTC.
--  Idempotente: CREATE TABLE IF NOT EXISTS y altas guardadas con
--  information_schema (patrón de la 036). No borra ni vacía nada.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- -------------------------------------------------------------------------
-- 1) Tablas nuevas
-- -------------------------------------------------------------------------
--  El CHECK usa server_id y service_id, que llevan clave foránea: por eso las
--  claves foráneas van SIN acción referencial (MySQL no admite CHECK sobre
--  columnas con ON DELETE/ON UPDATE).
CREATE TABLE IF NOT EXISTS monitor_maintenance (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  server_id   BIGINT UNSIGNED NULL,
  service_id  BIGINT UNSIGNED NULL,
  starts_at   DATETIME(3)     NOT NULL,
  ends_at     DATETIME(3)     NOT NULL,
  reason      VARCHAR(255)    NOT NULL,
  created_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_monitor_maintenance_range (starts_at, ends_at),
  CONSTRAINT fk_monitor_maintenance_server FOREIGN KEY (server_id)
    REFERENCES monitor_servers (id),
  CONSTRAINT fk_monitor_maintenance_service FOREIGN KEY (service_id)
    REFERENCES monitor_services (id),
  CONSTRAINT ck_monitor_maintenance_target CHECK (
    (server_id IS NOT NULL AND service_id IS NULL)
    OR (server_id IS NULL AND service_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitor_evidence (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  incident_id  BIGINT UNSIGNED NOT NULL,
  captured_at  DATETIME(3)     NOT NULL,
  origin       ENUM('OFICINA','SERVIDOR','OTRO') NOT NULL,
  notes        VARCHAR(1000)   NULL,
  storage_key  VARCHAR(255)    NOT NULL,
  file_name    VARCHAR(255)    NOT NULL,
  mime_type    VARCHAR(100)    NOT NULL,
  size_bytes   INT             NOT NULL,
  created_by   BIGINT UNSIGNED NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_monitor_evidence_incident (incident_id),
  CONSTRAINT fk_monitor_evidence_incident FOREIGN KEY (incident_id)
    REFERENCES monitor_incidents (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--  Sin clave foránea a servicios ni sondas: tablas de resumen que no deben
--  bloquear el archivado.
CREATE TABLE IF NOT EXISTS monitor_daily_rollups (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  service_id       BIGINT UNSIGNED NOT NULL,
  probe_id         BIGINT UNSIGNED NOT NULL,
  date             DATE            NOT NULL,
  expected         INT             NOT NULL DEFAULT 0,
  executed         INT             NOT NULL DEFAULT 0,
  succeeded        INT             NOT NULL DEFAULT 0,
  p50_ms           INT             NULL,
  p95_ms           INT             NULL,
  latency_hist     JSON            NOT NULL,
  down_minutes     DECIMAL(8,2)    NOT NULL DEFAULT 0,
  route_minutes    DECIMAL(8,2)    NOT NULL DEFAULT 0,
  no_data_minutes  DECIMAL(8,2)    NOT NULL DEFAULT 0,
  UNIQUE KEY uq_monitor_daily_rollup (service_id, probe_id, date),
  KEY idx_monitor_daily_rollups_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitor_rollup_days (
  date         DATE        NOT NULL PRIMARY KEY,
  computed_at  DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitor_probe_gaps (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  probe_id    BIGINT UNSIGNED NOT NULL,
  started_at  DATETIME(3)     NOT NULL,
  ended_at    DATETIME(3)     NOT NULL,
  cause       ENUM('OFFICE_OUTAGE','PROBE_SILENT') NOT NULL,
  date        DATE            NOT NULL,
  KEY idx_monitor_probe_gaps_probe (probe_id, started_at),
  KEY idx_monitor_probe_gaps_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitor_agent_samples (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  server_id      BIGINT UNSIGNED NOT NULL,
  at             DATETIME(3)     NOT NULL,
  cpu_pct        DECIMAL(5,2)    NOT NULL,
  ram_pct        DECIMAL(5,2)    NOT NULL,
  disks          JSON            NOT NULL,
  iis            JSON            NOT NULL,
  services       JSON            NOT NULL,
  event_errors   INT             NOT NULL DEFAULT 0,
  agent_version  VARCHAR(40)     NOT NULL,
  KEY idx_monitor_agent_samples (server_id, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitor_agent_daily_rollups (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  server_id    BIGINT UNSIGNED NOT NULL,
  date         DATE            NOT NULL,
  samples      INT             NOT NULL DEFAULT 0,
  cpu_hist     JSON            NOT NULL,
  ram_hist     JSON            NOT NULL,
  disks_close  JSON            NOT NULL,
  UNIQUE KEY uq_monitor_agent_daily_rollup (server_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitor_monthly_reports (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id     BIGINT UNSIGNED NOT NULL,
  month         CHAR(7)         NOT NULL COMMENT 'YYYY-MM',
  partial       TINYINT(1)      NOT NULL DEFAULT 0,
  generated_at  DATETIME(3)     NOT NULL,
  generated_by  BIGINT UNSIGNED NULL,
  data          JSON            NOT NULL,
  UNIQUE KEY uq_monitor_monthly_report (client_id, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 2) Columnas e índice nuevos en tablas existentes (guardados)
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_column_037;
DROP PROCEDURE IF EXISTS kubo_add_index_037;
DELIMITER //
CREATE PROCEDURE kubo_add_column_037(
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
CREATE PROCEDURE kubo_add_index_037(
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

CALL kubo_add_column_037('monitor_servers', 'agent_watch_services',
  "agent_watch_services JSON NULL "
  "COMMENT 'servicios de Windows que el agente debe vigilar' "
  "AFTER agent_last_seen_at");
CALL kubo_add_column_037('monitor_servers', 'agent_token_created_at',
  "agent_token_created_at DATETIME(3) NULL AFTER agent_watch_services");
CALL kubo_add_column_037('monitor_servers', 'agent_silence_alerted_at',
  "agent_silence_alerted_at DATETIME(3) NULL "
  "COMMENT 'cuando se aviso que el agente dejo de reportar; NULL = sin aviso' "
  "AFTER agent_token_created_at");
CALL kubo_add_column_037('monitor_servers', 'agent_version',
  "agent_version VARCHAR(40) NULL AFTER agent_silence_alerted_at");

CALL kubo_add_index_037('monitor_checks', 'idx_monitor_checks_probe_started',
  "idx_monitor_checks_probe_started (probe_id, started_at)");

DROP PROCEDURE IF EXISTS kubo_add_column_037;
DROP PROCEDURE IF EXISTS kubo_add_index_037;

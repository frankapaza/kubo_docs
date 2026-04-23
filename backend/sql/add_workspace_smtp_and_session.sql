-- Amplía workspace_settings con SMTP config + sesión configurable
SET NAMES utf8mb4;

ALTER TABLE workspace_settings
  ADD COLUMN session_timeout_minutes INT NOT NULL DEFAULT 30 AFTER logo_url,
  ADD COLUMN smtp_host VARCHAR(255) NULL AFTER session_timeout_minutes,
  ADD COLUMN smtp_port INT NULL DEFAULT 587 AFTER smtp_host,
  ADD COLUMN smtp_secure TINYINT(1) NOT NULL DEFAULT 0 AFTER smtp_port,
  ADD COLUMN smtp_user VARCHAR(255) NULL AFTER smtp_secure,
  ADD COLUMN smtp_pass_encrypted TEXT NULL AFTER smtp_user,
  ADD COLUMN smtp_from VARCHAR(255) NULL AFTER smtp_pass_encrypted;

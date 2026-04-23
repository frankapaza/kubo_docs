-- Política de retención del audio. Default: borrar después de 7 días.
SET NAMES utf8mb4;

ALTER TABLE workspace_settings
  ADD COLUMN audio_retention_policy ENUM(
    'KEEP_FOREVER',
    'DELETE_AFTER_APPROVAL',
    'DELETE_AFTER_DAYS',
    'NEVER_STORE'
  ) NOT NULL DEFAULT 'DELETE_AFTER_DAYS' AFTER smtp_from,
  ADD COLUMN audio_retention_days INT NOT NULL DEFAULT 7 AFTER audio_retention_policy,
  ADD COLUMN audio_deleted_at DATETIME NULL;

-- Nota: audio_deleted_at lo ponemos a nivel workspace solo por completitud.
-- El que importa es el audio_files.deleted_at que agregamos aparte.

ALTER TABLE audio_files
  ADD COLUMN deleted_at DATETIME NULL COMMENT 'Fecha en que se borró el archivo por política de retención',
  ADD COLUMN deleted_reason VARCHAR(50) NULL;

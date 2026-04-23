-- =========================================================================
--  Migración 004 — Client requests (inbox de solicitudes de cliente)
-- =========================================================================
--  1) jira_code en clients  (ej. "CE" = Contacto Eficaz)
--  2) jira_code en projects (ej. "VTA" = Venta, usado como código de módulo)
--  3) client_requests: inbox de solicitudes, captura rápida + estructurada.
-- =========================================================================

USE kubo_devdocs;

-- 1) Código corto de cliente para prefijo en títulos de Jira
ALTER TABLE clients
  ADD COLUMN jira_code VARCHAR(10) NULL AFTER ruc,
  ADD INDEX idx_clients_jira_code (jira_code);

-- 2) Código corto de proyecto / módulo (opcional)
ALTER TABLE projects
  ADD COLUMN jira_code VARCHAR(10) NULL AFTER code;

-- 3) Tabla principal de solicitudes
CREATE TABLE IF NOT EXISTS client_requests (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,

  -- Relaciones (todas opcionales: el inbox acepta capturas sin contexto)
  client_id           BIGINT UNSIGNED NULL,
  project_id          BIGINT UNSIGNED NULL,
  meeting_id          BIGINT UNSIGNED NULL COMMENT 'si nació desde un acta',
  parent_request_id   BIGINT UNSIGNED NULL COMMENT 'si es hija de un split',

  -- Captura cruda
  source              ENUM('WHATSAPP_TEXT','WHATSAPP_AUDIO','VOICE_LIVE',
                           'NOTE','MEETING','OTHER')
                      NOT NULL DEFAULT 'NOTE',
  raw_text            TEXT NOT NULL COMMENT 'texto original (o transcripción)',
  raw_audio_filename  VARCHAR(255) NULL COMMENT 'nombre del archivo si vino como audio',
  captured_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Estructura (la IA o el usuario la llenan antes de enviar a Jira)
  status              ENUM('INBOX','STRUCTURED','SENT','ARCHIVED')
                      NOT NULL DEFAULT 'INBOX',
  request_type        ENUM('MEJORA','FEATURE','AJUSTE','BUG') NULL,
  priority            ENUM('LOW','MEDIUM','HIGH') NULL,
  module_name         VARCHAR(80) NULL COMMENT 'ej. Venta',
  screen_name         VARCHAR(120) NULL COMMENT 'ej. Progresivo',
  flow_context        VARCHAR(200) NULL COMMENT 'ej. Llamada entrante del marcado',
  title               VARCHAR(240) NULL COMMENT 'título ya con prefijo [CE-VTA]',
  description_md      TEXT NULL COMMENT 'markdown estructurado para Jira',
  acceptance_criteria JSON NULL COMMENT 'array de strings',
  labels              JSON NULL COMMENT 'array de strings',
  assignee_user_id    BIGINT UNSIGNED NULL,

  -- Resultado tras push a Jira
  jira_integration_id BIGINT UNSIGNED NULL,
  jira_project_key    VARCHAR(20) NULL,
  jira_issue_key      VARCHAR(30) NULL,
  jira_issue_url      VARCHAR(500) NULL,
  sent_at             DATETIME NULL,

  -- Auditoría
  created_by          BIGINT UNSIGNED NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_cr_client   (client_id),
  INDEX idx_cr_project  (project_id),
  INDEX idx_cr_status   (status),
  INDEX idx_cr_meeting  (meeting_id),
  INDEX idx_cr_created  (created_at),
  INDEX idx_cr_assignee (assignee_user_id),

  CONSTRAINT fk_cr_client   FOREIGN KEY (client_id)         REFERENCES clients(id)        ON DELETE SET NULL,
  CONSTRAINT fk_cr_project  FOREIGN KEY (project_id)        REFERENCES projects(id)       ON DELETE SET NULL,
  CONSTRAINT fk_cr_meeting  FOREIGN KEY (meeting_id)        REFERENCES meetings(id)       ON DELETE SET NULL,
  CONSTRAINT fk_cr_parent   FOREIGN KEY (parent_request_id) REFERENCES client_requests(id) ON DELETE SET NULL,
  CONSTRAINT fk_cr_jira     FOREIGN KEY (jira_integration_id) REFERENCES integrations(id) ON DELETE SET NULL,
  CONSTRAINT fk_cr_assignee FOREIGN KEY (assignee_user_id)  REFERENCES users(id)          ON DELETE SET NULL,
  CONSTRAINT fk_cr_creator  FOREIGN KEY (created_by)        REFERENCES users(id)
) ENGINE=InnoDB;

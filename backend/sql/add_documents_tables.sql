-- Fase 5.B: Documentos inteligentes
-- Tablas para plantillas reutilizables y documentos generados.

-- 1) Plantillas de documentos
CREATE TABLE IF NOT EXISTS document_templates (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(200) NOT NULL,
  type              ENUM('CONTRACT','QUOTE','NDA','SOW','TDR','ADDENDUM','OTHER')
                    NOT NULL DEFAULT 'OTHER',
  description       TEXT NULL,
  content_markdown  MEDIUMTEXT NOT NULL,
  variables_schema  JSON NOT NULL,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  created_by        BIGINT UNSIGNED NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_document_templates_type (type)
) ENGINE=InnoDB;

-- 2) Documentos comerciales generados
CREATE TABLE IF NOT EXISTS commercial_documents (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id         BIGINT UNSIGNED NOT NULL,
  template_id       BIGINT UNSIGNED NULL,
  meeting_id        BIGINT UNSIGNED NULL,
  project_id        BIGINT UNSIGNED NULL,
  title             VARCHAR(250) NOT NULL,
  type              ENUM('CONTRACT','QUOTE','NDA','SOW','TDR','ADDENDUM','OTHER')
                    NOT NULL DEFAULT 'OTHER',
  status            ENUM('DRAFT','SENT','SIGNED','EXPIRED','CANCELLED')
                    NOT NULL DEFAULT 'DRAFT',
  content_markdown  MEDIUMTEXT NOT NULL,
  variables_values  JSON NULL,
  pdf_key           VARCHAR(255) NULL,
  version           INT UNSIGNED NOT NULL DEFAULT 1,
  created_by        BIGINT UNSIGNED NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_commercial_documents_client (client_id),
  INDEX idx_commercial_documents_meeting (meeting_id),
  INDEX idx_commercial_documents_status (status)
) ENGINE=InnoDB;

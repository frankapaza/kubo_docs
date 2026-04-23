-- =========================================================================
--  Migración 006 — Firmantes / conformidad en documentos comerciales
-- =========================================================================

USE kubo_devdocs;

CREATE TABLE IF NOT EXISTS document_signatories (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  document_id       BIGINT UNSIGNED NOT NULL,
  user_id           BIGINT UNSIGNED NULL COMMENT 'si es miembro interno vinculado al sistema',

  kind              ENUM('INTERNAL','EXTERNAL') NOT NULL DEFAULT 'EXTERNAL',
  full_name         VARCHAR(180) NOT NULL,
  document_number   VARCHAR(40)  NULL,
  email             VARCHAR(180) NULL,
  role              VARCHAR(80)  NULL COMMENT 'cargo o rol en el contexto del documento',

  conformity_status ENUM('PENDING','SIGNED','REFUSED','ABSENT_EARLY','ABSENT')
                    NOT NULL DEFAULT 'PENDING',
  notes             VARCHAR(300) NULL COMMENT 'observaciones de conformidad',

  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_ds_document (document_id),
  INDEX idx_ds_user     (user_id),

  CONSTRAINT fk_ds_document FOREIGN KEY (document_id)
    REFERENCES commercial_documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_ds_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

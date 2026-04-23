-- =========================================================================
--  Migración 005 — Estado COMPLETED + documento de cierre en solicitudes
-- =========================================================================

USE kubo_devdocs;

ALTER TABLE client_requests
  MODIFY COLUMN status
    ENUM('INBOX','STRUCTURED','SENT','ARCHIVED','COMPLETED')
    NOT NULL DEFAULT 'INBOX',
  ADD COLUMN completed_at      DATETIME NULL AFTER sent_at,
  ADD COLUMN closure_document_id BIGINT UNSIGNED NULL AFTER completed_at,
  ADD CONSTRAINT fk_cr_closure_doc
    FOREIGN KEY (closure_document_id) REFERENCES commercial_documents(id)
    ON DELETE SET NULL;

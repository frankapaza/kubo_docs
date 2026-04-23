-- =========================================================================
--  Migración 007 — Tokens de firma electrónica en document_signatories
-- =========================================================================

USE kubo_devdocs;

ALTER TABLE document_signatories
  ADD COLUMN signature_token  VARCHAR(100) NULL   AFTER notes,
  ADD COLUMN token_expires_at DATETIME     NULL   AFTER signature_token,
  ADD COLUMN signed_at        DATETIME     NULL   AFTER token_expires_at,
  ADD COLUMN signed_ip        VARCHAR(45)  NULL   AFTER signed_at,
  ADD UNIQUE INDEX idx_ds_token (signature_token);

-- =========================================================================
--  Migración 003 — IA para generación de acta + Firmas digitales
-- =========================================================================
--  1) ai_providers: catálogo de proveedores LLM (OpenAI, DeepSeek, ...).
--  2) actas: nuevo campo `content_json` (estructura agenda/acuerdos/tareas).
--  3) acta_signatures: firmas digitales de participantes sobre un acta.
-- =========================================================================

USE kubo_devdocs;

-- 1) Proveedores de IA
CREATE TABLE IF NOT EXISTS ai_providers (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  provider            ENUM('OPENAI','DEEPSEEK','GEMINI','GROQ') NOT NULL,
  label               VARCHAR(100)  NOT NULL,
  model               VARCHAR(100)  NOT NULL,
  api_key_encrypted   TEXT          NOT NULL,
  base_url            VARCHAR(255)  NULL,
  temperature         DECIMAL(3,2)  NOT NULL DEFAULT 0.30,
  is_active           TINYINT(1)    NOT NULL DEFAULT 0,
  created_by          BIGINT UNSIGNED NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_aiprov_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 2) Contenido estructurado del acta (opcional, sirve para re-renderizar)
ALTER TABLE actas
  ADD COLUMN content_json JSON NULL AFTER content_markdown,
  ADD COLUMN ai_provider_id BIGINT UNSIGNED NULL AFTER generated_from_transcription;

-- 3) Firmas digitales
CREATE TABLE IF NOT EXISTS acta_signatures (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  acta_id         BIGINT UNSIGNED NOT NULL,
  participant_id  BIGINT UNSIGNED NOT NULL,
  signed_by_user  BIGINT UNSIGNED NULL,
  signer_name     VARCHAR(180)    NOT NULL,
  signer_document VARCHAR(40)     NULL,
  signer_role     VARCHAR(80)     NULL,
  signature_hash  VARCHAR(128)    NOT NULL,
  signed_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address      VARCHAR(64)     NULL,
  UNIQUE KEY uq_acta_participant (acta_id, participant_id),
  CONSTRAINT fk_sig_acta        FOREIGN KEY (acta_id)        REFERENCES actas(id)        ON DELETE CASCADE,
  CONSTRAINT fk_sig_participant FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  CONSTRAINT fk_sig_user        FOREIGN KEY (signed_by_user) REFERENCES users(id)        ON DELETE SET NULL
) ENGINE=InnoDB;

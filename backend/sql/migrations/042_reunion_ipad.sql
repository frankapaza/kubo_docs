-- =========================================================================
--  Migración 042 — Reunión en iPad: firma en pantalla, notas y anexos
-- =========================================================================
--  - acta_signatures: trazo manuscrito (PNG) y cómo se firmó (USER = con su
--    usuario; IN_PERSON = en el iPad, con nombre y DNI escritos en el momento).
--  - meeting_notes: notas tomadas durante la grabación (minuto, tipo y texto);
--    la generación del acta las usa como insumo.
--  - acta_annexes: evidencias (foto y/o texto) que van como «Anexos» al final
--    del PDF, solo si hay alguna.
--  Spec: docs/superpowers/specs/2026-11-28-metodologia-ia-hoja-de-ruta-design.md
--
--  Idempotente: CREATE TABLE IF NOT EXISTS y columnas guardadas con
--  information_schema (patrón de la 038). No borra ni vacía nada.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS kubo_add_column_042;
DELIMITER //
CREATE PROCEDURE kubo_add_column_042(
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

CALL kubo_add_column_042('acta_signatures', 'method',
  "method VARCHAR(12) NOT NULL DEFAULT 'USER' COMMENT 'USER | IN_PERSON' AFTER signature_hash");
CALL kubo_add_column_042('acta_signatures', 'signature_png',
  "signature_png MEDIUMBLOB NULL COMMENT 'trazo manuscrito (PNG) firmado en pantalla' AFTER method");

DROP PROCEDURE IF EXISTS kubo_add_column_042;

CREATE TABLE IF NOT EXISTS meeting_notes (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  meeting_id          BIGINT UNSIGNED NOT NULL,
  offset_sec          INT UNSIGNED    NOT NULL COMMENT 'segundo de la grabación en que se anotó',
  kind                VARCHAR(10)     NOT NULL COMMENT 'NOTA | ACUERDO | TAREA',
  text                VARCHAR(2000)   NOT NULL,
  created_by_user_id  BIGINT UNSIGNED NULL,
  created_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_meeting_notes_meeting (meeting_id, offset_sec),
  CONSTRAINT fk_meeting_notes_meeting FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE CASCADE,
  CONSTRAINT fk_meeting_notes_user FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS acta_annexes (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  acta_id             BIGINT UNSIGNED NOT NULL,
  position            INT UNSIGNED    NOT NULL DEFAULT 0,
  section             VARCHAR(40)     NULL COMMENT 'sección del documento a la que pertenece; NULL = anexo general',
  place               VARCHAR(10)     NOT NULL DEFAULT 'ANEXO' COMMENT 'ANEXO (al final) | INLINE (en su sección)',
  caption             TEXT            NULL COMMENT 'texto de la evidencia',
  image               MEDIUMBLOB      NULL COMMENT 'foto (JPEG/PNG), opcional',
  image_mime          VARCHAR(40)     NULL,
  created_by_user_id  BIGINT UNSIGNED NULL,
  created_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_acta_annexes_acta (acta_id, position),
  CONSTRAINT fk_acta_annexes_acta FOREIGN KEY (acta_id) REFERENCES actas (id) ON DELETE CASCADE,
  CONSTRAINT fk_acta_annexes_user FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

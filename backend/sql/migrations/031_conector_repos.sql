-- ============================================================================
-- 031 · Conector de tickets para Claude (repos de desarrollo ↔ DevDocs)
-- ============================================================================
--  Spec: docs/superpowers/specs/2026-11-24-conector-tickets-claude-design.md
--
--  · `dev_repos`  un repo de GitHub registrado y la asignación cliente-sistema
--                 (`client_systems`) que define su alcance.
--  · `dev_keys`   claves `kdev_` por desarrollador y repo. Solo la huella
--                 SHA-256: la clave en claro se muestra una vez y no se guarda.
--  · `dev_links`  ramas, commits y PR asociados a un ticket o requerimiento.
--  · `work_items.client_system_id`  el sistema del requerimiento; sin él un
--                 `RQ-` no lo ve ningún repo.
--
--  Idempotente: tablas con IF NOT EXISTS y columna/índice con guarda.
--  No borra ni una fila.
-- ============================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS dev_repos (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_system_id    BIGINT UNSIGNED NOT NULL
                      COMMENT 'asignacion cliente-sistema: el alcance del repo',
  github_full_name    VARCHAR(140)    NOT NULL
                      COMMENT 'owner/repo en minusculas',
  webhook_secret_enc  TEXT            NULL
                      COMMENT 'secreto HMAC del webhook, cifrado (aes-gcm.util)',
  is_active           TINYINT(1)      NOT NULL DEFAULT 1,
  created_by          BIGINT UNSIGNED NULL,
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                      ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dev_repos_full_name (github_full_name),
  INDEX idx_dev_repos_client_system (client_system_id),
  CONSTRAINT fk_dev_repos_client_system FOREIGN KEY (client_system_id)
    REFERENCES client_systems (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dev_keys (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dev_repo_id      BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL
                   COMMENT 'dueno: autor de notas y cambios de estado',
  key_fingerprint  CHAR(64) CHARACTER SET ascii NOT NULL
                   COMMENT 'SHA-256 de la clave; la clave en claro no se guarda',
  key_prefix       VARCHAR(12)     NOT NULL,
  last_used_at     DATETIME(3)     NULL,
  revoked_at       DATETIME        NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dev_keys_fingerprint (key_fingerprint),
  INDEX idx_dev_keys_user (user_id),
  INDEX idx_dev_keys_repo (dev_repo_id),
  CONSTRAINT fk_dev_keys_repo FOREIGN KEY (dev_repo_id) REFERENCES dev_repos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--  `ticket_key`/`work_item_key` existen solo para el índice único: MySQL
--  admite varios NULL en una clave única, así que con las columnas nulas el
--  webhook y el MCP podrían duplicar el mismo vínculo.
CREATE TABLE IF NOT EXISTS dev_links (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dev_repo_id    BIGINT UNSIGNED NOT NULL,
  ticket_id      BIGINT UNSIGNED NULL,
  work_item_id   BIGINT UNSIGNED NULL,
  ticket_key     BIGINT UNSIGNED AS (IFNULL(ticket_id, 0)) STORED,
  work_item_key  BIGINT UNSIGNED AS (IFNULL(work_item_id, 0)) STORED,
  kind           ENUM('BRANCH','COMMIT','PR') NOT NULL,
  ref            VARCHAR(255)    NOT NULL
                 COMMENT 'nombre de rama, SHA completo o numero de PR',
  title          VARCHAR(255)    NULL,
  url            VARCHAR(500)    NULL,
  author_login   VARCHAR(100)    NULL,
  state          VARCHAR(20)     NULL COMMENT 'PR: open/merged/closed',
  source         ENUM('WEBHOOK','MCP') NOT NULL,
  occurred_at    DATETIME        NOT NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dev_links (dev_repo_id, kind, ref, ticket_key, work_item_key),
  INDEX idx_dev_links_ticket (ticket_id, occurred_at),
  INDEX idx_dev_links_work_item (work_item_id, occurred_at),
  CONSTRAINT chk_dev_links_objetivo CHECK (
    (ticket_id IS NOT NULL AND work_item_id IS NULL)
    OR (ticket_id IS NULL AND work_item_id IS NOT NULL)
  ),
  CONSTRAINT fk_dev_links_repo FOREIGN KEY (dev_repo_id) REFERENCES dev_repos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS kubo_add_column_031;
DELIMITER //
CREATE PROCEDURE kubo_add_column_031(
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

CALL kubo_add_column_031('work_items', 'client_system_id',
  "client_system_id BIGINT UNSIGNED NULL COMMENT 'sistema del requerimiento; NULL = ningun repo lo ve' AFTER client_id");

DROP PROCEDURE IF EXISTS kubo_add_column_031;

DROP PROCEDURE IF EXISTS kubo_add_index_031;
DELIMITER //
CREATE PROCEDURE kubo_add_index_031()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = 'kubo_devdocs'
      AND TABLE_NAME = 'work_items' AND INDEX_NAME = 'idx_wi_client_system'
  ) THEN
    ALTER TABLE work_items ADD INDEX idx_wi_client_system (client_system_id, status);
  END IF;
END //
DELIMITER ;

CALL kubo_add_index_031();

DROP PROCEDURE IF EXISTS kubo_add_index_031;

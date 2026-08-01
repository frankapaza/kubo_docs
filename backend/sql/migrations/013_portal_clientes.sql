-- =========================================================================
--  Migración 013 — Portal de clientes (P1)
-- =========================================================================
--  · client_users: los usuarios de las empresas cliente, en tabla propia.
--    Separados de `users` a propósito: así es imposible que aparezcan en
--    una consulta de personal.
--  · Columnas hermanas del actor: cinco columnas del sistema asumían que
--    quien actúa pertenece al equipo. Ahora `created_by` puede ser nulo y
--    en su lugar va `created_by_client_user_id`.
--
--  Los ALTER van guardados con information_schema: uno sin guardar rompe
--  el initdb al reejecutarse y detiene toda la cadena.
-- =========================================================================

USE kubo_devdocs;

-- -------------------------------------------------------------------------
-- 1) Usuarios de las empresas cliente
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_users (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id      BIGINT UNSIGNED NOT NULL COMMENT 'a que empresa pertenece',
  email          VARCHAR(180)    NOT NULL,
  password_hash  VARCHAR(255)    NOT NULL,
  full_name      VARCHAR(180)    NOT NULL,
  is_admin       TINYINT(1)      NOT NULL DEFAULT 0
                 COMMENT 'reservado para P3: administracion delegada',
  is_active      TINYINT(1)      NOT NULL DEFAULT 1,
  last_login_at  DATETIME        NULL,
  created_by     BIGINT UNSIGNED NOT NULL COMMENT 'quien del equipo lo dio de alta',
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                 ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_client_users_email (email),
  INDEX idx_cu_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 2) Columnas hermanas del actor, guardadas para ser idempotentes
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_column_013;
DELIMITER //
CREATE PROCEDURE kubo_add_column_013(
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

CALL kubo_add_column_013('tickets', 'created_by_client_user_id',
  'created_by_client_user_id BIGINT UNSIGNED NULL AFTER created_by');
CALL kubo_add_column_013('ticket_events', 'actor_client_user_id',
  'actor_client_user_id BIGINT UNSIGNED NULL AFTER actor_user_id');
CALL kubo_add_column_013('work_items', 'created_by_client_user_id',
  'created_by_client_user_id BIGINT UNSIGNED NULL AFTER created_by');
CALL kubo_add_column_013('work_item_events', 'actor_client_user_id',
  'actor_client_user_id BIGINT UNSIGNED NULL AFTER actor_user_id');

DROP PROCEDURE IF EXISTS kubo_add_column_013;

-- -------------------------------------------------------------------------
-- 3) created_by pasa a nullable: un ticket del portal no tiene autor interno
-- -------------------------------------------------------------------------
ALTER TABLE tickets    MODIFY created_by BIGINT UNSIGNED NULL;
ALTER TABLE work_items MODIFY created_by BIGINT UNSIGNED NULL;

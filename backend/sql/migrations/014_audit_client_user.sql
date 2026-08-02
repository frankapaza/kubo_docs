-- =========================================================================
--  Migración 014 — Autoría de cliente en la auditoría
-- =========================================================================
--  `AuditInterceptor` es global y escribe un asiento por cada mutación,
--  también las que llegan del portal. Ahí `req.user` es un `AuthClientUser`
--  (`clientUserId`, no `id`), así que todas esas acciones se guardaban con
--  `user_id = NULL`: indistinguibles de una acción del sistema.
--
--  `user_id` no sirve para guardarlas. Además de que el número se confundiría
--  con un identificador de `users`, la columna tiene la FK
--  `fk_audit_user -> users(id)`: un `client_users.id` ahí ni siquiera entra,
--  el INSERT falla y el asiento se pierde entero.
--
--  Por eso la columna hermana, misma forma que las cuatro que añadió la 013 a
--  tickets, ticket_events, work_items y work_item_events. Sin FK, igual que
--  ellas: `audit_log` es un registro append-only que debe sobrevivir al
--  borrado del usuario de cliente que lo originó.
--
--  Las dos columnas nunca se rellenan a la vez, así que la procedencia del
--  asiento queda legible: `user_id` → personal, `client_user_id` → portal,
--  las dos nulas → sistema.
--
--  Los ALTER van guardados con information_schema: uno sin guardar rompe
--  el initdb al reejecutarse y detiene toda la cadena.
-- =========================================================================

USE kubo_devdocs;

-- -------------------------------------------------------------------------
-- 1) Columna hermana del actor en audit_log
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_column_014;
DELIMITER //
CREATE PROCEDURE kubo_add_column_014(
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

CALL kubo_add_column_014('audit_log', 'client_user_id',
  'client_user_id BIGINT UNSIGNED NULL AFTER user_id');

DROP PROCEDURE IF EXISTS kubo_add_column_014;

-- -------------------------------------------------------------------------
-- 2) Índice gemelo de idx_audit_user, para poder consultar la actividad de un
--    usuario de cliente igual que la de uno del personal. También guardado.
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_index_014;
DELIMITER //
CREATE PROCEDURE kubo_add_index_014()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = 'kubo_devdocs'
      AND TABLE_NAME = 'audit_log' AND INDEX_NAME = 'idx_audit_client_user'
  ) THEN
    ALTER TABLE audit_log ADD INDEX idx_audit_client_user (client_user_id, created_at);
  END IF;
END //
DELIMITER ;

CALL kubo_add_index_014();

DROP PROCEDURE IF EXISTS kubo_add_index_014;

-- =========================================================================
--  Migración 023 — El buzón IMAP real: configuración y su interruptor
-- =========================================================================
--  Las migraciones 021/022 dieron a la ingesta de correo su base de datos
--  (`inbound_emails`) y sus desenlaces. Lo único que faltaba era de dónde iba
--  a leer los correos de verdad: esta migración añade esa configuración a
--  `workspace_settings`, junto a la de SMTP que ya vive ahí (ver
--  `add_workspace_smtp_and_session.sql`) -- mismo sitio, mismo criterio: un
--  servidor, un puerto, un usuario, una contraseña cifrada con la misma
--  `aes-gcm.util.ts` que ya protege `smtp_pass_encrypted`.
--
--  `imap_enabled` es el interruptor de encendido que el Task 8 exige apagado
--  por defecto (`DEFAULT 0`): la ingesta nace apagada, y solo el equipo la
--  enciende a mano una vez que ha verificado -- fuera de este proyecto, en la
--  consola del proveedor de correo -- que el servidor de entrada rechaza en
--  el sobre cualquier mensaje que no pase DMARC (ver el docblock de
--  `judgeAuthentication`, `domain/intake-rules.ts`, sobre por qué esa
--  política es la frontera de confianza real y no esta función).
--
--  `imap_folder` no tiene un default de fila (columna NULL): el propio
--  código (`WorkspaceService.getImapConfig`) decide qué carpeta usar cuando
--  no se configuró ninguna, no esta migración -- es la misma razón por la
--  que `message_id_raw` (021) tampoco lleva un DEFAULT de cadena vacía: un
--  valor ausente en la base y un valor elegido por el código son dos hechos
--  distintos, y confundirlos aquí escondería que nadie configuró la carpeta.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS kubo_add_column_023;
DELIMITER //
CREATE PROCEDURE kubo_add_column_023(
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

CALL kubo_add_column_023('workspace_settings', 'imap_host',
  'imap_host VARCHAR(255) NULL AFTER team_inbox_email');

CALL kubo_add_column_023('workspace_settings', 'imap_port',
  'imap_port INT NULL DEFAULT 993 AFTER imap_host');

-- `DEFAULT 1`: al contrario que `smtp_secure` (STARTTLS sobre 587 es lo
-- habitual en el envío), IMAP entrante casi siempre se sirve por TLS
-- implícito en el 993 -- el mismo puerto por defecto de arriba.
CALL kubo_add_column_023('workspace_settings', 'imap_secure',
  'imap_secure TINYINT(1) NOT NULL DEFAULT 1 AFTER imap_port');

CALL kubo_add_column_023('workspace_settings', 'imap_user',
  'imap_user VARCHAR(255) NULL AFTER imap_secure');

CALL kubo_add_column_023('workspace_settings', 'imap_pass_encrypted',
  'imap_pass_encrypted TEXT NULL AFTER imap_user');

CALL kubo_add_column_023('workspace_settings', 'imap_folder',
  'imap_folder VARCHAR(255) NULL AFTER imap_pass_encrypted');

-- El interruptor. Task 8: "la ingesta nace apagada" -- `DEFAULT 0` es lo que
-- lo hace cierto también para una base que ya tenía la fila de ajustes antes
-- de esta migración (el ALTER la deja en 0 para la fila existente, no NULL).
CALL kubo_add_column_023('workspace_settings', 'imap_enabled',
  'imap_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER imap_folder');

DROP PROCEDURE IF EXISTS kubo_add_column_023;

-- =========================================================================
--  Migración 024 — El ancla que faltaba: el identificador del propio servidor
-- =========================================================================
--  Tanda de cierre del proyecto de ingesta de correo (revisión final). El
--  evaluador de `Authentication-Results` (`judgeAuthentication`,
--  `domain/intake-rules.ts`) descartaba el primer segmento de la cabecera --
--  el `authserv-id` de RFC 8601 §2.2 -- sin comprobar nunca cuál era. Ese
--  segmento es exactamente lo que un remitente puede fabricar sin ninguna
--  dificultad si escribe su propia cabecera `Authentication-Results` dentro
--  de su propio mensaje (y `buildRawHeaders`, `imap-mailbox.service.ts`, toma
--  la primera aparición, confiando en que el MTA de entrada antepuso la
--  suya): sin este ancla, un correo mal ruteado o un proveedor mal
--  configurado deja pasar una suplantación completa. Ver "El ancla que
--  faltaba" en el docblock de `judgeAuthentication` para el escenario
--  completo.
--
--  `imap_auth_server_id` va junto a los demás ajustes IMAP (migración 023):
--  mismo criterio, columna nula hasta que alguien la configura a mano. A
--  propósito **no lleva DEFAULT**: un valor ausente tiene que fallar cerrado
--  (`SIN_SERVIDOR_PROPIO` para todo correo, ver `evaluateDmarc`), nunca
--  adivinarse -- adivinar aquí es exactamente el hueco que esta migración
--  cierra.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS kubo_add_column_024;
DELIMITER //
CREATE PROCEDURE kubo_add_column_024(
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

CALL kubo_add_column_024('workspace_settings', 'imap_auth_server_id',
  'imap_auth_server_id VARCHAR(255) NULL AFTER imap_enabled');

DROP PROCEDURE IF EXISTS kubo_add_column_024;

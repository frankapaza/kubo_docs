-- =========================================================================
--  Migración 027 — Carga masiva de usuarios de cliente
-- =========================================================================
--  Una invitación puede nacer de dos sitios distintos, y hay que poder
--  saber de cuál sin inventarse nada.
--
--  Hasta aquí solo nacía en el portal, así que `invited_by_client_user_id`
--  era NOT NULL y apuntaba a `client_users`. La carga masiva la lanza
--  personal de la casa sobre una empresa que NO TIENE NINGÚN USUARIO -ese
--  es exactamente el problema que resuelve-, así que no hay ningún usuario
--  de cliente al que apuntar.
--
--  Se hace lo mismo que la 026 hizo con `client_users.created_by`: columna
--  aparte para el autor nuevo, y la vieja pasa a admitir vacío. NO un
--  `invited_by` polimórfico con discriminador: `users` y `client_users` son
--  tablas distintas a propósito (ver la 013) y un mismo entero no puede
--  significar una fila de una o de otra según el viento.
--
--  El CHECK es lo que impide la tercera posibilidad -las dos vacías, o las
--  dos puestas-, que no significa nada y que el código tendría que decidir
--  cómo interpretar. Se valida contra las filas existentes al crearse: hoy
--  todas tienen `invited_by_client_user_id` y la columna nueva vacía, así
--  que la cumplen. Si alguna no la cumpliera, esta migración FALLA, y esa
--  es la dirección correcta del fallo.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- -------------------------------------------------------------------------
-- 1) El autor de personal
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_column_027;
DELIMITER //
CREATE PROCEDURE kubo_add_column_027(
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

CALL kubo_add_column_027('client_user_invitations', 'invited_by_user_id',
  'invited_by_user_id BIGINT UNSIGNED NULL '
  "COMMENT 'el miembro del personal que lanzo la carga masiva; NULL si invito un administrador de cliente' "
  'AFTER invited_by_client_user_id');

DROP PROCEDURE IF EXISTS kubo_add_column_027;

-- -------------------------------------------------------------------------
-- 2) El autor de cliente deja de ser obligatorio
-- -------------------------------------------------------------------------
--  Guardado por IS_NULLABLE y no por presencia de columna: la columna ya
--  existe desde la 026, así que el ayudante de arriba no serviría. Mismo
--  criterio que la sección 3 de la 026.
--
--  Un MODIFY sobre una columna que ya admite nulo no daría error, pero
--  reescribiría la tabla entera en cada pasada.
DROP PROCEDURE IF EXISTS kubo_relax_column_027;
DELIMITER //
CREATE PROCEDURE kubo_relax_column_027()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'kubo_devdocs'
      AND TABLE_NAME = 'client_user_invitations'
      AND COLUMN_NAME = 'invited_by_client_user_id'
      AND IS_NULLABLE = 'NO'
  ) THEN
    ALTER TABLE client_user_invitations
      MODIFY COLUMN invited_by_client_user_id BIGINT UNSIGNED NULL
      COMMENT 'el administrador de cliente que invito; NULL si la invitacion la creo el personal';
  END IF;
END //
DELIMITER ;

CALL kubo_relax_column_027();
DROP PROCEDURE IF EXISTS kubo_relax_column_027;

-- -------------------------------------------------------------------------
-- 3) Exactamente uno de los dos autores
-- -------------------------------------------------------------------------
--  Requiere MySQL 8.0.16+, que es lo que corre. Guardado por presencia de
--  la restricción, no por try/catch: repetir el ALTER daría error de
--  duplicado y pararía el arranque.
DROP PROCEDURE IF EXISTS kubo_add_check_027;
DELIMITER //
CREATE PROCEDURE kubo_add_check_027()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = 'kubo_devdocs'
      AND TABLE_NAME = 'client_user_invitations'
      AND CONSTRAINT_NAME = 'chk_cui_un_solo_autor'
  ) THEN
    ALTER TABLE client_user_invitations
      ADD CONSTRAINT chk_cui_un_solo_autor CHECK (
        (invited_by_client_user_id IS NULL) <> (invited_by_user_id IS NULL)
      );
  END IF;
END //
DELIMITER ;

CALL kubo_add_check_027();
DROP PROCEDURE IF EXISTS kubo_add_check_027;

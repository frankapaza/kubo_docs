-- =========================================================================
--  Migración 026 — Invitaciones a usuarios del portal
-- =========================================================================
--  El administrador de una empresa cliente da de alta a su gente sin que
--  nadie teclee una contraseña por otro: se manda una invitación y la
--  persona elige la suya.
--
--  EN LA BASE SOLO VIVE LA HUELLA DEL SECRETO. Un enlace cifrado se podría
--  descifrar con la clave de la aplicación; una huella no se deshace. Quien
--  lea la base -un respaldo filtrado, una consulta de más- no obtiene
--  ningún enlace utilizable. Por eso la columna se llama
--  `secret_fingerprint` y no `token`: el nombre tiene que delatar a quien
--  intente guardar ahí el valor en claro.
--
--  `created_by` PASA A ADMITIR VACÍO Y NO SE PIERDE NADA. Hoy es
--  `NOT NULL` y apunta a `users` (el personal de la casa). Cuando quien da
--  el alta es un administrador de cliente no hay ningún miembro del
--  personal a quien apuntar, y rellenarlo con "el primer administrador que
--  haya" sería decidir por la ausencia de un valor en vez de por el hecho
--  que lo determina -el defecto recurrente de este proyecto-. El MODIFY
--  solo relaja la nulabilidad: las filas existentes conservan su valor.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- -------------------------------------------------------------------------
-- 1) Las invitaciones
-- -------------------------------------------------------------------------
--  `secret_fingerprint` es un SHA-256 en hexadecimal: 64 caracteres, todos
--  [0-9a-f]. `CHARACTER SET ascii` porque nunca puede ser otra cosa, y así
--  la clave única pesa 64 bytes en vez de 256.
--
--  LA CLAVE ÚNICA SOBRE LA HUELLA ES LA QUE SOSTIENE LA BÚSQUEDA AL
--  ACEPTAR: se busca por huella, jamás por el secreto, y una huella
--  repetida no puede existir.
--
--  `used_at` y `revoked_at` son dos hechos distintos y por eso son dos
--  columnas: "alguien la usó" y "se reemplazó por otra". Un solo `estado`
--  obligaría a inventar un valor para el caso en que las dos fueran
--  ciertas.
--
--  `send_error` guarda por qué falló el correo, si falló. La invitación
--  queda creada igual (no hay cola ni reintento automático: el reenvío es
--  el reintento, y es visible), y esta columna es lo que permite explicar
--  en la pantalla por qué sigue pendiente.
CREATE TABLE IF NOT EXISTS client_user_invitations (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id                 BIGINT UNSIGNED NOT NULL COMMENT 'la empresa, tomada de la sesion de quien invita',
  email                     VARCHAR(180)    NOT NULL COMMENT 'ya normalizado: minusculas, recortado, dominio codificado',
  full_name                 VARCHAR(180)    NOT NULL,
  secret_fingerprint        CHAR(64) CHARACTER SET ascii NOT NULL
                            COMMENT 'SHA-256 hex del secreto; el secreto EN CLARO NO SE GUARDA NUNCA',
  invited_by_client_user_id BIGINT UNSIGNED NOT NULL COMMENT 'el administrador de cliente que invito',
  expires_at                DATETIME        NOT NULL COMMENT 'instante absoluto UTC; se compara contra el reloj, nunca contra una fecha civil',
  used_at                   DATETIME        NULL     COMMENT 'NULL = sin usar; se marca en la misma transaccion que crea el usuario',
  accepted_client_user_id   BIGINT UNSIGNED NULL     COMMENT 'el usuario que salio de aceptarla',
  revoked_at                DATETIME        NULL     COMMENT 'NULL = viva; se marca al reemplazarla por otra invitacion al mismo correo',
  last_sent_at              DATETIME        NULL     COMMENT 'ultimo intento de envio; NULL = nunca se llego a intentar',
  send_error                VARCHAR(500)    NULL     COMMENT 'por que fallo el ultimo envio; NULL = fue bien o no hubo',
  created_at                DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_cui_fingerprint (secret_fingerprint),
  KEY idx_cui_client_pendientes (client_id, used_at, revoked_at),
  KEY idx_cui_email_vivas (email, used_at, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 2) La autoría honesta en client_users
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_column_026;
DELIMITER //
CREATE PROCEDURE kubo_add_column_026(
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

CALL kubo_add_column_026('client_users', 'created_by_client_user_id',
  'created_by_client_user_id BIGINT UNSIGNED NULL '
  "COMMENT 'el administrador de cliente que invito; NULL si el alta la hizo el personal' "
  'AFTER created_by');

DROP PROCEDURE IF EXISTS kubo_add_column_026;

-- -------------------------------------------------------------------------
-- 3) `created_by` deja de ser obligatorio
-- -------------------------------------------------------------------------
--  Guardado por IS_NULLABLE y no por presencia de columna: la columna ya
--  existe desde la 013, así que el ayudante de arriba no serviría. Mismo
--  criterio que la sección 2.0b de la 021, que corrige una nulabilidad con
--  esta misma consulta.
--
--  Un `MODIFY` sobre una columna que ya admite nulo no daría error, pero
--  reescribiría la tabla entera en cada pasada. `client_users` tiene filas
--  reales; la guarda no es cosmética.
DROP PROCEDURE IF EXISTS kubo_relax_column_026;
DELIMITER //
CREATE PROCEDURE kubo_relax_column_026()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'kubo_devdocs'
      AND TABLE_NAME = 'client_users' AND COLUMN_NAME = 'created_by'
      AND IS_NULLABLE = 'NO'
  ) THEN
    ALTER TABLE client_users
      MODIFY COLUMN created_by BIGINT UNSIGNED NULL
      COMMENT 'quien del equipo lo dio de alta; NULL si lo invito un administrador de cliente';
  END IF;
END //
DELIMITER ;

CALL kubo_relax_column_026();

DROP PROCEDURE IF EXISTS kubo_relax_column_026;

-- =========================================================================
--  Migración 025 — El alta también tiene que normalizar el correo
-- =========================================================================
--  Corrección posterior a la tanda de cierre. `UsersRepository.findByEmail` y
--  `ClientUsersRepository.findByEmail` normalizan el correo (minúsculas,
--  recorte, dominio a su forma codificada) antes de buscar -- pero solo
--  `ClientUsersRepository.create`/`update` normalizaban también al escribir.
--  `UsersRepository.create`/`update` (el alta de personal) guardaba el correo
--  tal cual. Un miembro del personal dado de alta con mayúsculas, espacios, o
--  un dominio internacionalizado quedaba guardado así, y su siguiente inicio
--  de sesión -- que sí normaliza para buscar -- nunca volvía a encontrarlo:
--  fallaba siempre, sin ningún error que lo explicara. El código ya se
--  corrigió (`UsersRepository`, mismo patrón que `ClientUsersRepository`);
--  esta migración arregla las filas que ya existían en las dos tablas, de
--  antes de esa corrección.
--
--  Solo se normaliza aquí minúsculas + recorte (`LOWER(TRIM(email))`). El
--  dominio a su forma codificada (punycode) es responsabilidad del código de
--  escritura desde ahora -- codificar un IDN de verdad exige el algoritmo de
--  Punycode completo, que no tiene sentido reimplementar en SQL puro para una
--  migración de una sola vez. Por eso el paso 2 de más abajo detecta y NO
--  toca ninguna fila cuyo dominio ya sea internacionalizado: se deja
--  constancia en `email_normalization_conflicts` en vez de adivinar.
--
--  CUIDADO CON LAS COLISIONES. Dos filas que difieran solo en mayúsculas o en
--  espacios (`Ana@Kuboti.com` y `ana@kuboti.com `) normalizan a la MISMA
--  cadena. `email` tiene `UNIQUE KEY` en las dos tablas: normalizar la
--  segunda cuando la primera ya ocupa ese valor rompería el UPDATE entero a
--  mitad de camino (o, peor, lo haría depender del orden de las filas). Por
--  eso el paso 1 detecta primero TODOS los grupos que colisionarían y los dos
--  pasos siguientes los excluyen explícitamente: si dos filas colisionan, NO
--  SE TOCA NINGUNA DE LAS DOS, y quedan anotadas en
--  `email_normalization_conflicts` para resolverlas a mano (encontrar cuál de
--  las dos cuentas sigue viva y fusionar o borrar la otra no es una decisión
--  que una migración deba tomar sola).
--
--  Idempotente sin necesidad de guardar con information_schema, a diferencia
--  de los ALTER de otras migraciones: el UPDATE final solo toca una fila
--  cuando `email <> LOWER(TRIM(email))`, así que una fila ya normalizada dej
--  a de cumplir esa condición en la segunda pasada, y los INSERT de
--  diagnóstico usan `ON DUPLICATE KEY UPDATE` sobre la clave única
--  (table_name, row_id) -- volver a correr esta migración no inserta
--  duplicados ni vuelve a tocar nada que ya se resolvió o se dejó marcado.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- -------------------------------------------------------------------------
-- 0) La caja negra de esta migración: qué filas NO se tocaron y por qué.
--    Sin esto, "a este usuario no le entra el login" no se podría investigar
--    -- misma razón de ser que `inbound_emails` para el correo entrante.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_normalization_conflicts (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  table_name        VARCHAR(32)     NOT NULL COMMENT '''users'' o ''client_users''',
  row_id            BIGINT UNSIGNED NOT NULL,
  email_actual      VARCHAR(180)    NOT NULL COMMENT 'tal como esta guardado, sin tocar',
  email_normalizado VARCHAR(180)    NOT NULL COMMENT 'a lo que normalizaria, o con quien colisiona',
  motivo            VARCHAR(32)     NOT NULL COMMENT 'COLISION o DOMINIO_NO_ASCII',
  detected_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_email_conflict (table_name, row_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 1) El procedimiento: mismo cuerpo para `users` y `client_users`, las dos
--    tablas tienen `id` y `email` con la misma forma. `p_table` nunca viene
--    de fuera -- son los dos literales del CALL de más abajo, igual que
--    todos los `kubo_add_column_*` de migraciones anteriores interpolan el
--    nombre de tabla en SQL dinámico.
-- -------------------------------------------------------------------------
-- Todo el SQL dinamico de abajo se construye con literales entre COMILLAS
-- DOBLES a proposito -- igual que ya hace `022_correo_sin_contenido.sql`
-- (`kubo_modify_enum_022`): con `ANSI_QUOTES` apagado (el modo por defecto,
-- y el que usa este proyecto) una comilla simple dentro de una cadena entre
-- comillas dobles es un caracter normal, sin necesitar duplicarla. Evita
-- por completo el error, facil de cometer y dificil de ver, de contar mal
-- cuantas comillas simples seguidas hacen falta para escapar otra comilla
-- simple dentro de una cadena delimitada tambien por comillas simples.
DROP PROCEDURE IF EXISTS kubo_normalize_emails_025;
DELIMITER //
CREATE PROCEDURE kubo_normalize_emails_025(IN p_table VARCHAR(64))
BEGIN
  -- 1a) Marca -- sin tocar nada todavia -- todo grupo de dos o mas filas
  --     cuyo email, ya en minusculas y recortado, coincide. Si un grupo tiene
  --     mas de una fila hoy, es porque el UNIQUE KEY ya las distinguia por
  --     mayusculas o espacios; normalizar cualquiera de ellas la haria chocar
  --     con las demas.
  SET @sql = CONCAT(
    "INSERT INTO email_normalization_conflicts ",
    "(table_name, row_id, email_actual, email_normalizado, motivo) ",
    "SELECT '", p_table, "', t.id, t.email, n.normalizado, 'COLISION' ",
    "FROM ", p_table, " t ",
    "JOIN (SELECT LOWER(TRIM(email)) AS normalizado FROM ", p_table, " ",
    "GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1) n ",
    "ON LOWER(TRIM(t.email)) = n.normalizado ",
    "ON DUPLICATE KEY UPDATE email_normalizado = VALUES(email_normalizado), motivo = VALUES(motivo)");
  PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

  -- 1b) Marca -- sin tocar nada -- cualquier fila cuyo email contenga un
  --     caracter fuera de ASCII: esta migracion no reimplementa Punycode en
  --     SQL puro (ver cabecera). `LENGTH` cuenta bytes y `CHAR_LENGTH` cuenta
  --     caracteres sobre esta columna utf8mb4; difieren en cuanto aparece
  --     cualquier caracter multibyte, sin depender de expresiones regulares
  --     ni de como MySQL escapa `\` dentro de una cadena preparada.
  SET @sql = CONCAT(
    "INSERT INTO email_normalization_conflicts ",
    "(table_name, row_id, email_actual, email_normalizado, motivo) ",
    "SELECT '", p_table, "', id, email, LOWER(TRIM(email)), 'DOMINIO_NO_ASCII' ",
    "FROM ", p_table, " ",
    "WHERE LENGTH(email) <> CHAR_LENGTH(email) ",
    "ON DUPLICATE KEY UPDATE email_normalizado = VALUES(email_normalizado), motivo = VALUES(motivo)");
  PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

  -- 2) Normaliza todo lo demas: minusculas y recorte, y solo lo que de
  --    verdad cambia. Las filas marcadas arriba (colision o dominio no
  --    ASCII) quedan fuera por el NOT EXISTS -- no se toca ninguna.
  SET @sql = CONCAT(
    "UPDATE ", p_table, " t ",
    "SET t.email = LOWER(TRIM(t.email)) ",
    "WHERE t.email <> LOWER(TRIM(t.email)) ",
    "AND NOT EXISTS (SELECT 1 FROM email_normalization_conflicts c ",
    "WHERE c.table_name = '", p_table, "' AND c.row_id = t.id)");
  PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
END //
DELIMITER ;

CALL kubo_normalize_emails_025('users');
CALL kubo_normalize_emails_025('client_users');

DROP PROCEDURE IF EXISTS kubo_normalize_emails_025;

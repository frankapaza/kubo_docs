-- =========================================================================
--  Migración 021 — Correo entrante
-- =========================================================================
--  Hasta ahora el correo solo sale (015): el cliente recibe avisos pero no
--  puede contestarlos. Esta migración pone la base de datos de lo contrario:
--  que una respuesta por correo se correlacione con el ticket y lo alimente.
--
--    · `inbound_emails`               un registro por cada correo recibido,
--      se procese como se procese; también los que se descartan. Lleva DOS
--      columnas de identificador (`message_id` y `message_id_raw`): ver la
--      sección 1 para por qué no sobra ninguna.
--    · `tickets.email_message_id`     el Message-ID del correo que abrió el
--      ticket (si nació de uno), para casar las respuestas que le lleguen.
--    · `ticket_messages.inbound_email_id`  de qué correo salió este mensaje,
--      cuando salió de uno.
--    · `ticket_messages.body_full`    el cuerpo completo del correo, sin la
--      cola de citas que arrastra cada respuesta; `body_md` sigue siendo el
--      texto ya recortado que se enseña en el hilo.
--    · el `Message-ID` de cada aviso saliente, en la misma tabla que ya hace
--      de bandeja de salida (`ticket_events`, ver 015): sin él, `In-Reply-To`
--      no tiene contra qué correlacionar y una respuesta no sabe a qué ticket
--      volver.
--
--  Igual que la 020: procedimientos idempotentes guardados con
--  information_schema, que se crean, se usan y se tiran en el mismo fichero.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- -------------------------------------------------------------------------
-- 1) Un registro por cada correo entrante, se procese como se procese
-- -------------------------------------------------------------------------
--  `message_id` a 998 caracteres porque ese es el máximo de una línea de
--  cabecera de correo (RFC 5322 §2.1.1). Va en `CHARACTER SET ascii` porque
--  en la práctica abrumadora un Message-ID es US-ASCII (RFC 5322 §3.6.4); con
--  utf8mb4 cada carácter pesa hasta 4 bytes y 998 de ellos superan los 3072
--  bytes que InnoDB admite en el prefijo de un índice, mientras que `ascii`
--  pesa 1 byte por carácter y deja sitio de sobra sin recortar la longitud
--  útil.
--
--  PERO NO ES SIEMPRE ASCII, y la excepción no es un caso corrupto. El correo
--  internacionalizado (RFC 6532, la extensión que acompaña a SMTPUTF8) amplía
--  la gramática `atext` para admitir UTF-8 no-ASCII, y esa es la misma
--  gramática sobre la que se construye el identificador: un Message-ID con
--  caracteres no-ASCII es válido por norma, y encima hay remitentes mal
--  implementados que los emiten igual sin serlo. Bajo el modo estricto de
--  MySQL 8 (el de por defecto), insertar ese valor en una columna `ascii` no
--  lo trunca en silencio: rechaza el INSERT entero, y como la columna es
--  NOT NULL no hay otro valor que poner. Justo el correo raro que esta tabla
--  existe para poder diagnosticar sería el único que no se podría registrar.
--
--  Por eso hay DOS columnas de identificador, y no conviene fusionarlas:
--    · `message_id`      ascii, indexada, la que sostiene la correlación
--                        (una comparación de igualdad). Cuando el valor
--                        crudo trae algo no-ASCII, la ingesta guardará aquí
--                        un sustituto determinista -un hash del valor crudo-
--                        para que la deduplicación siga funcionando y la
--                        fila se pueda registrar igual. Esa sustitución es
--                        lógica de una tarea posterior; aquí solo se le deja
--                        sitio a la columna.
--    · `message_id_raw`  utf8mb4, sin indexar, el valor tal cual llegó, sin
--                        ninguna transformación. Es lo que permite entender
--                        qué pasó cuando `message_id` lleva un hash en vez
--                        del original.
--
--  LA CLAVE ÚNICA SOBRE `message_id` ES LO QUE HACE LA INGESTA IDEMPOTENTE:
--  si el proceso cae a medio procesar un correo y al reiniciar el buzón se
--  lee de nuevo desde el principio, el INSERT del mismo Message-ID (o de su
--  mismo hash, para los no-ASCII) falla y ese correo se salta en vez de crear
--  un ticket o un mensaje duplicado.
--
--  `outcome` no es solo para los que sí generan ticket o mensaje: registra
--  también por qué se descartó cada correo (no autenticado, automático,
--  propio, duplicado, remitente desconocido, tope de mensajes, error), que es
--  la única forma de diagnosticar después "por qué no entró éste".
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inbound_emails (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  message_id        VARCHAR(998) CHARACTER SET ascii NOT NULL
                    COMMENT 'identificador para correlacionar; hash del valor crudo si este no era ascii',
  message_id_raw    VARCHAR(998) NOT NULL DEFAULT ''
                    COMMENT 'Message-ID tal cual llego, sin transformar; ver cabecera de la migracion',
  from_address      VARCHAR(320)    NOT NULL,
  subject           VARCHAR(998)    NULL,
  sent_at           DATETIME        NULL,
  received_at       DATETIME        NOT NULL,
  outcome ENUM(
    'TICKET_CREADO','MENSAJE_ANADIDO','DESCARTADO_NO_AUTENTICADO',
    'DESCARTADO_AUTOMATICO','DESCARTADO_PROPIO','DESCARTADO_DUPLICADO',
    'REMITENTE_DESCONOCIDO','DESCARTADO_POR_TOPE','ERROR'
  )                 NOT NULL,
  reason            TEXT            NULL,
  ticket_id         BIGINT UNSIGNED NULL,
  client_user_id    BIGINT UNSIGNED NULL,
  attachment_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  attachment_names  JSON            NULL,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_inbound_message_id (message_id),
  KEY idx_inbound_outcome (outcome, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 2) Ayudante guardado para añadir columnas, igual que el de la 020
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_column_021;
DELIMITER //
CREATE PROCEDURE kubo_add_column_021(
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

-- 2.0) `message_id_raw` también va detrás de este ayudante, y no solo dentro
-- del CREATE TABLE de arriba: esta migración se revisó y se corrigió después
-- de aplicarse una primera vez sin esta columna, así que en cualquier base
-- donde ya se hubiera pasado esa primera versión la tabla existe sin ella, y
-- CREATE TABLE IF NOT EXISTS no la habría añadido. Queda en los dos sitios
-- -en el CREATE TABLE para una instalación nueva, aquí para una que ya tenía
-- la tabla-; este CALL es un no-op en el primer caso porque la columna ya
-- existe.
CALL kubo_add_column_021('inbound_emails', 'message_id_raw',
  "message_id_raw VARCHAR(998) NOT NULL DEFAULT '' "
  "COMMENT 'Message-ID tal cual llego, sin transformar; ver cabecera de la migracion' "
  "AFTER message_id");

-- 2.1) El Message-ID del correo que abrió el ticket, cuando nació de uno.
-- Un ticket creado desde el panel o el portal se queda con esta columna en
-- NULL, y una respuesta a ese ticket no tiene correo original con el que
-- correlacionar por este lado (solo queda el hilo de mensajes).
--
-- `CHARACTER SET ascii`, mismo motivo que `inbound_emails.message_id`: sin
-- eso, el índice de abajo (idx_tickets_email_message_id) supera los 3072
-- bytes que admite InnoDB en un prefijo con utf8mb4.
CALL kubo_add_column_021('tickets', 'email_message_id',
  "email_message_id VARCHAR(998) CHARACTER SET ascii NULL "
  "COMMENT 'Message-ID del correo que abrio el ticket, si nacio de uno' "
  "AFTER created_by_client_user_id");

-- 2.2) De qué correo entrante salió este mensaje del hilo.
CALL kubo_add_column_021('ticket_messages', 'inbound_email_id',
  "inbound_email_id BIGINT UNSIGNED NULL "
  "COMMENT 'correo entrante del que salio este mensaje, si vino de uno' "
  "AFTER author_client_user_id");

-- 2.3) El cuerpo completo del correo, aparte del `body_md` ya recortado.
--
-- `body_md` sigue siendo lo que se enseña en el hilo (el texto nuevo, sin la
-- cita de la conversación anterior que arrastra cada respuesta). `body_full`
-- guarda el correo tal cual llegó, por si hace falta revisar qué se recortó.
-- MEDIUMTEXT porque un hilo de correo citado varias veces puede superar
-- sobradamente los 64 KB de TEXT.
CALL kubo_add_column_021('ticket_messages', 'body_full',
  'body_full MEDIUMTEXT NULL '
  "COMMENT 'cuerpo completo del correo entrante, sin recortar' "
  'AFTER body_md');

-- 2.4) El Message-ID de cada aviso saliente, en la bandeja de salida.
--
-- `ticket_events` es la tabla que registra los envíos de notificación desde
-- la 015 (ver su cabecera: "pasa a ser la bandeja de salida transaccional").
-- Sin esta columna, el `In-Reply-To` de una respuesta del cliente no tiene
-- contra qué buscar: no hay forma de saber a qué evento -y por tanto a qué
-- ticket- responde ese correo, que es el punto entero de esta migración.
--
-- `CHARACTER SET ascii`, mismo motivo que las dos anteriores: el índice de
-- abajo (idx_ticket_events_sent_message_id) también toparía con el límite de
-- 3072 bytes de InnoDB si el charset fuera utf8mb4.
CALL kubo_add_column_021('ticket_events', 'sent_message_id',
  'sent_message_id VARCHAR(998) CHARACTER SET ascii NULL '
  "COMMENT 'Message-ID con el que se envio este aviso, para correlacionar respuestas' "
  'AFTER notify_next_attempt_at');

DROP PROCEDURE IF EXISTS kubo_add_column_021;

-- -------------------------------------------------------------------------
-- 3) Índices que sostienen la correlación
-- -------------------------------------------------------------------------
--  Cada respuesta que llega busca por uno de estos dos valores. Sin el
--  índice, esa búsqueda recorre la tabla entera en cada correo que entra.
--
--  `CREATE INDEX` no admite guarda por sí solo en MySQL 8 (no hay
--  `IF NOT EXISTS`), así que va con el mismo patrón de procedimiento que la
--  020: comprobar `information_schema.STATISTICS` antes de crear el índice.
-- -------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS kubo_add_index_021;
DELIMITER //
CREATE PROCEDURE kubo_add_index_021(
  IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_ddl VARCHAR(512))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = 'kubo_devdocs'
      AND TABLE_NAME = p_table AND INDEX_NAME = p_index
  ) THEN
    SET @sql = CONCAT('ALTER TABLE ', p_table, ' ADD INDEX ', p_ddl);
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

CALL kubo_add_index_021('tickets', 'idx_tickets_email_message_id',
  'idx_tickets_email_message_id (email_message_id)');
CALL kubo_add_index_021('ticket_events', 'idx_ticket_events_sent_message_id',
  'idx_ticket_events_sent_message_id (sent_message_id)');

DROP PROCEDURE IF EXISTS kubo_add_index_021;

-- =========================================================================
--  Migración 019 — El COMMENT de `ticket_attachments.message_id`
-- =========================================================================
--  NO CAMBIA NINGÚN DATO NI NINGÚN TIPO. Corrige un texto, y aun así hace
--  falta una migración: el `COMMENT` de una columna se queda grabado en el
--  esquema de producción, y ahí decía una premisa que se retiró antes de
--  terminar la funcionalidad.
--
--  LO QUE DECÍA Y POR QUÉ IMPORTA
--  La 018 creó la columna con `COMMENT 'NULL si se subio al crear el ticket'`.
--  Eso describía un camino real **entonces**: el alta del ticket subía
--  archivos antes de que existiera ningún mensaje. Ya no existe. Hoy el alta
--  crea el ticket **con su primer mensaje** y `TicketAttachmentsService.upload`
--  exige `message_id`, así que no queda ninguna forma de escribir una fila sin
--  él.
--
--  El texto viejo no es solo inexacto: **está escrito como contrato**. Es la
--  misma premisa de la que salió la condición
--  `att.message_id IS NULL OR msg.visibility = 'PUBLICA'`, que dejaba pasar
--  *siempre* al adjunto huérfano a la lista del cliente --y luego le daba 404
--  al descargarlo, porque la otra puerta ya había cerrado esa rama. La
--  condición se arregló; la frase que la justificaba seguía en el esquema,
--  y una frase así desactiva la sospecha del siguiente que la lea: quien mire
--  la columna en producción y vea «NULL si se subió al crear el ticket»
--  concluirá que el huérfano es normal y volverá a escribir la misma rama.
--
--  POR QUÉ LA COLUMNA SIGUE SIENDO NULL-ABLE
--  Por las filas anteriores a la decisión. Ponerla `NOT NULL` obligaría a
--  inventarles un mensaje o a borrarlas, y las dos cosas son peores que
--  dejarlas visibles como lo que son: una anomalía que el equipo tiene que
--  poder ver. Para quien no es del equipo esa fila ya no existe --`INNER JOIN`
--  en `listAttachments`, 404 en la descarga--, que es la garantía que de
--  verdad hace falta. El `COMMENT` pasa a decir eso mismo.
--
--  POR QUÉ NO SE REESCRIBIÓ LA 018 EN SU SITIO
--  Porque la 018 ya corrió. Cambiarle el DDL dejaría el fichero afirmando
--  algo que nunca se aplicó con ese texto, y una base migrada y una recién
--  creada dejarían de poder compararse leyendo los ficheros. El registro del
--  cambio es esta migración.
--
--  GUARDADA E IDEMPOTENTE, como la 015, la 016 y la 018: un ALTER sin guardar
--  rompe el initdb al reejecutarse y detiene la cadena entera que hay detrás.
--  La guarda comprueba el `COLUMN_COMMENT` actual, así que la segunda pasada
--  no reescribe la definición de una columna para nada.
--
--  EL ALTER REPITE LA DEFINICIÓN ENTERA, y no puede ser de otra forma:
--  `MODIFY COLUMN` sustituye la definición completa, así que omitir el tipo o
--  la nulabilidad los cambiaría en silencio. `BIGINT UNSIGNED NULL` es
--  exactamente lo que puso la 018, leído de la base y no de memoria:
--
--    docker exec kubo-mysql-dev mysql -uroot -proot kubo_devdocs \
--      -e "SHOW COLUMNS FROM ticket_attachments LIKE 'message_id'\G"
--
--  El índice `idx_ticket_attachments_message` no se toca: `MODIFY COLUMN` no
--  lo afecta.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- Sin tildes ni eñes en el literal del COMMENT, igual que los de la 018: el
-- texto viaja por clientes de consola con codificaciones que no controlamos.
DROP PROCEDURE IF EXISTS kubo_fix_attachment_message_comment_019;
DELIMITER //
CREATE PROCEDURE kubo_fix_attachment_message_comment_019()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ticket_attachments'
      AND COLUMN_NAME = 'message_id'
      AND COLUMN_COMMENT <> 'mensaje del que cuelga; un NULL es una anomalia, no un adjunto suelto'
  ) THEN
    ALTER TABLE ticket_attachments MODIFY COLUMN message_id
      BIGINT UNSIGNED NULL
      COMMENT 'mensaje del que cuelga; un NULL es una anomalia, no un adjunto suelto';
  END IF;
END //
DELIMITER ;

CALL kubo_fix_attachment_message_comment_019();

DROP PROCEDURE IF EXISTS kubo_fix_attachment_message_comment_019;

-- =========================================================================
--  Migración 022 — un desenlace para "no había nada que hacer con esto"
-- =========================================================================
--  Ronda de correcciones 1 de la Task 6 encontró dos caminos que la Task 6
--  hacía pasar por `ERROR` sin serlo:
--
--    · un correo del personal que no referencia ningún ticket -- ni por
--      cabecera, ni por código en el asunto -- y el personal no abre tickets
--      por correo (para eso está el panel);
--    · una respuesta cuyo cuerpo, tras recortar la cita del hilo anterior,
--      queda vacío y sin ningún adjunto del que dejar constancia.
--
--  Los dos son correos legítimos y autenticados que, simplemente, no dejan
--  nada que escribir en ningún ticket. Contarlos como `ERROR` ensucia el
--  contador que sirve para detectar problemas de verdad, y la pantalla de
--  reintento (Task 9) los reintentaría para siempre -- un reintento no cambia
--  nada en un correo que seguirá sin tener ticket o sin tener texto.
--
--  `outcome` es un ENUM, así que un valor nuevo pide migración -- no se puede
--  colar por código. Mismo patrón idempotente que la 020
--  (`kubo_modify_enum_020`): MODIFY reescribe la tabla entera, así que se
--  guarda contra volver a pagar esa reescritura en cada pasada manual.
-- =========================================================================

USE kubo_devdocs;

DROP PROCEDURE IF EXISTS kubo_modify_enum_022;
DELIMITER //
CREATE PROCEDURE kubo_modify_enum_022(
  IN p_table VARCHAR(64), IN p_column VARCHAR(64),
  IN p_marker VARCHAR(64), IN p_ddl VARCHAR(1024))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'kubo_devdocs'
      AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
      AND COLUMN_TYPE LIKE CONCAT('%''', p_marker, '''%')
  ) THEN
    SET @sql = CONCAT('ALTER TABLE ', p_table, ' MODIFY COLUMN ', p_ddl);
    PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

-- La lista lleva TODOS los valores que la columna tiene que tener al
-- terminar, los ocho viejos y el nuevo: un MODIFY que omita uno existente no
-- da error, lo borra en silencio (mismo aviso que deja escrito la 020).
CALL kubo_modify_enum_022('inbound_emails', 'outcome', 'DESCARTADO_SIN_CONTENIDO',
  "outcome ENUM("
  "'TICKET_CREADO','MENSAJE_ANADIDO','DESCARTADO_NO_AUTENTICADO',"
  "'DESCARTADO_AUTOMATICO','DESCARTADO_PROPIO','DESCARTADO_DUPLICADO',"
  "'REMITENTE_DESCONOCIDO','DESCARTADO_POR_TOPE','DESCARTADO_SIN_CONTENIDO','ERROR'"
  ") NOT NULL");

DROP PROCEDURE IF EXISTS kubo_modify_enum_022;

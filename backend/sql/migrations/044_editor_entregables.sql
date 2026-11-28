-- =========================================================================
--  Migración 044 — Editor de entregables con ajuste IA y plantillas
-- =========================================================================
--  - project_deliverable_versions.content_json: el documento en línea de
--    esa versión (secciones número/título/cuerpo Markdown), cuando se
--    redactó en la plataforma en vez de subir un archivo.
--  - deliverable_templates: estructura de secciones por tipo de entregable.
--    client_id = 0 es la plantilla Kubo editada; otro valor, la de ese
--    cliente. Sin fila, rige la plantilla Kubo del código.
--  - deliverable_attachments: imágenes por sección (figura en la sección o
--    anexo al final), con su leyenda.
--  Spec: docs/superpowers/specs/2026-11-28-metodologia-ia-hoja-de-ruta-design.md
--
--  Idempotente: CREATE TABLE IF NOT EXISTS y columna guardada con
--  information_schema (patrón de la 038). No borra ni vacía nada.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS kubo_add_column_044;
DELIMITER //
CREATE PROCEDURE kubo_add_column_044(
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

CALL kubo_add_column_044('project_deliverable_versions', 'content_json',
  "content_json MEDIUMTEXT NULL COMMENT 'documento en línea de esta versión (JSON de secciones)' AFTER size_bytes");

DROP PROCEDURE IF EXISTS kubo_add_column_044;

CREATE TABLE IF NOT EXISTS deliverable_templates (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  type           VARCHAR(10)     NOT NULL COMMENT 'código del catálogo: ACT-INI, DOC-ANA...',
  client_id      BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 = plantilla Kubo editada',
  name           VARCHAR(180)    NOT NULL,
  sections_json  TEXT            NOT NULL COMMENT 'JSON: [{num, title, guide}]',
  updated_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_deliverable_templates_type_client (type, client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deliverable_attachments (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  deliverable_id      BIGINT UNSIGNED NOT NULL,
  section_key         VARCHAR(40)     NOT NULL,
  place               VARCHAR(6)      NOT NULL DEFAULT 'INLINE' COMMENT 'INLINE | ANEXO',
  caption             VARCHAR(500)    NULL,
  position            INT UNSIGNED    NOT NULL,
  image               MEDIUMBLOB      NOT NULL,
  image_mime          VARCHAR(20)     NOT NULL,
  size_bytes          INT UNSIGNED    NOT NULL DEFAULT 0,
  created_by_user_id  BIGINT UNSIGNED NULL,
  created_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_deliverable_attachments_deliverable (deliverable_id, position),
  CONSTRAINT fk_deliverable_attachments_deliverable FOREIGN KEY (deliverable_id)
    REFERENCES project_deliverables (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

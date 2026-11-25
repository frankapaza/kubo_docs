-- ============================================================================
-- 032 · Documentos de un requerimiento
-- ============================================================================
--  Especificación (al aceptar), Manual de usuario (al entregar) y Acta de
--  conformidad (al cerrar), más cualquier otro anexo.
--
--  · `status`  BORRADOR = lo dejó Claude y nadie lo aprobó; VIGENTE = subido o
--              aprobado por una persona.
--  · `source`  WEB o CLAUDE (conector de repositorios).
--
--  Idempotente: CREATE TABLE IF NOT EXISTS. No toca ninguna tabla existente.
-- ============================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS work_item_attachments (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  work_item_id         BIGINT UNSIGNED NOT NULL,
  kind                 ENUM('ESPECIFICACION','MANUAL_USUARIO','ACTA_CONFORMIDAD','OTRO')
                       NOT NULL DEFAULT 'OTRO',
  status               ENUM('BORRADOR','VIGENTE') NOT NULL DEFAULT 'VIGENTE',
  source               ENUM('WEB','CLAUDE') NOT NULL DEFAULT 'WEB',
  filename             VARCHAR(255)    NOT NULL COMMENT 'nombre para mostrar, ya saneado',
  storage_key          VARCHAR(255)    NOT NULL COMMENT 'clave generada por el servidor',
  mime_type            VARCHAR(120)    NOT NULL COMMENT 'tipo detectado por los bytes',
  size_bytes           INT UNSIGNED    NOT NULL,
  uploaded_by_user_id  BIGINT UNSIGNED NULL,
  approved_by_user_id  BIGINT UNSIGNED NULL,
  approved_at          DATETIME        NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_work_item_attachments_key (storage_key),
  INDEX idx_work_item_attachments_item (work_item_id, created_at),
  CONSTRAINT fk_work_item_attachments_item FOREIGN KEY (work_item_id)
    REFERENCES work_items (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
--  Acta de conformidad: es un documento comercial (tipo ACTA_CONFORMIDAD) que
--  el cliente firma por enlace; `work_items.conformity_document_id` lo enlaza.
--  Ampliar un ENUM agregando un valor al final no toca las filas existentes.
--  Las guardas permiten volver a ejecutar el archivo sin error.
-- ----------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS kubo_migracion_032;
DELIMITER //
CREATE PROCEDURE kubo_migracion_032()
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = 'kubo_devdocs' AND TABLE_NAME = 'commercial_documents') THEN
    ALTER TABLE commercial_documents MODIFY COLUMN type
      ENUM('CONTRACT','QUOTE','NDA','SOW','TDR','ADDENDUM','OTHER','ACTA_CONFORMIDAD') NOT NULL DEFAULT 'OTHER';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = 'kubo_devdocs' AND TABLE_NAME = 'document_templates') THEN
    ALTER TABLE document_templates MODIFY COLUMN type
      ENUM('CONTRACT','QUOTE','NDA','SOW','TDR','ADDENDUM','OTHER','ACTA_CONFORMIDAD') NOT NULL DEFAULT 'OTHER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = 'kubo_devdocs' AND TABLE_NAME = 'work_items'
                    AND COLUMN_NAME = 'conformity_document_id') THEN
    ALTER TABLE work_items ADD COLUMN conformity_document_id BIGINT UNSIGNED NULL
      COMMENT 'acta de conformidad (commercial_documents) enviada a firma';
  END IF;
END //
DELIMITER ;

CALL kubo_migracion_032();

DROP PROCEDURE IF EXISTS kubo_migracion_032;

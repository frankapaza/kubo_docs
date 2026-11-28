-- =========================================================================
--  Migración 043 — Expediente del proyecto
-- =========================================================================
--  - projects.work_type: TRADICIONAL | AGIL | CORRECTIVO. NULL = el
--    expediente aún no se inició (al elegir el tipo se crea con el catálogo).
--  - project_deliverables: los entregables del expediente (Acta de inicio,
--    Cronograma, Manual de usuario...), su obligatoriedad según el tipo de
--    trabajo, su estado y la versión vigente (x.y).
--  - project_deliverable_versions: el historial de revisiones (E elaborado,
--    R revisado, A aprobado, F firmado, N no aplica, P reabierto), con el
--    archivo de cada versión en el almacenamiento existente.
--  Spec: docs/superpowers/specs/2026-11-28-metodologia-ia-hoja-de-ruta-design.md
--
--  Idempotente: CREATE TABLE IF NOT EXISTS y columna guardada con
--  information_schema (patrón de la 038). No borra ni vacía nada.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS kubo_add_column_043;
DELIMITER //
CREATE PROCEDURE kubo_add_column_043(
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

CALL kubo_add_column_043('projects', 'work_type',
  "work_type VARCHAR(12) NULL COMMENT 'TRADICIONAL | AGIL | CORRECTIVO; NULL = expediente sin iniciar' AFTER status");

DROP PROCEDURE IF EXISTS kubo_add_column_043;

CREATE TABLE IF NOT EXISTS project_deliverables (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id     BIGINT UNSIGNED NOT NULL,
  correlative    INT UNSIGNED    NOT NULL COMMENT 'NNNN de la nomenclatura, correlativo por proyecto',
  type           VARCHAR(10)     NOT NULL COMMENT 'código del catálogo: ACT-INI, CRO-PRO, MAN-USU...',
  name           VARCHAR(180)    NOT NULL,
  phase          VARCHAR(16)     NOT NULL COMMENT 'INICIO | PLANIFICACION | EJECUCION | MONITOREO | CIERRE',
  requirement    VARCHAR(2)      NOT NULL COMMENT 'O obligatorio | OP opcional | NA no aplica',
  status         VARCHAR(12)     NOT NULL DEFAULT 'PENDIENTE'
                 COMMENT 'PENDIENTE | BORRADOR | EN_REVISION | APROBADO | FIRMADO | NO_APLICA',
  na_reason      VARCHAR(300)    NULL,
  auto_na        TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1 = no aplica por el tipo de trabajo (se recalcula al cambiarlo)',
  from_catalog   TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '0 = agregado a mano (otra acta de reunión, otra solicitud de cambio)',
  version_major  INT UNSIGNED    NOT NULL DEFAULT 0,
  version_minor  INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_project_deliverables_correlative (project_id, correlative),
  KEY ix_project_deliverables_project (project_id, phase),
  CONSTRAINT fk_project_deliverables_project FOREIGN KEY (project_id)
    REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_deliverable_versions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  deliverable_id  BIGINT UNSIGNED NOT NULL,
  action          VARCHAR(2)      NOT NULL COMMENT 'E elaborado | R revisado | A aprobado | F firmado | N no aplica | P reabierto',
  version_major   INT UNSIGNED    NOT NULL,
  version_minor   INT UNSIGNED    NOT NULL,
  note            VARCHAR(1000)   NULL,
  storage_key     VARCHAR(255)    NULL COMMENT 'archivo de esta versión; NULL si la acción no subió archivo',
  filename        VARCHAR(255)    NULL,
  mime_type       VARCHAR(120)    NULL,
  size_bytes      INT UNSIGNED    NULL,
  actor_user_id   BIGINT UNSIGNED NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_deliverable_versions_deliverable (deliverable_id, id),
  CONSTRAINT fk_deliverable_versions_deliverable FOREIGN KEY (deliverable_id)
    REFERENCES project_deliverables (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

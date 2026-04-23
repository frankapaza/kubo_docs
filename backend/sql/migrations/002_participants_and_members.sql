-- =========================================================================
--  Migración 002 — Invitados externos y auto-asignación de miembros
-- =========================================================================
-- Cambios:
--  1) participants: agregar document_number para invitados externos.
--  2) project_members: crear la tabla si aún no existe (schema.sql ya la
--     declara, pero bases desplegadas antes de este feature no la tienen).
--  3) Asegurar que el admin esté asignado como OWNER a los proyectos
--     existentes que haya creado, para no perder visibilidad tras activar
--     el filtrado por membresía.
-- =========================================================================

USE kubo_devdocs;

-- 1) participants.document_number
ALTER TABLE participants
  ADD COLUMN document_number VARCHAR(40) NULL AFTER full_name;

-- 2) project_members (idempotente)
CREATE TABLE IF NOT EXISTS project_members (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id      BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  role_in_project ENUM('OWNER','EDITOR','VIEWER') NOT NULL DEFAULT 'VIEWER',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_project_members (project_id, user_id),
  CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
) ENGINE=InnoDB;

-- 3) Sembrar los OWNER de los proyectos ya existentes con quien los creó.
INSERT IGNORE INTO project_members (project_id, user_id, role_in_project)
SELECT p.id, p.created_by, 'OWNER'
FROM projects p;

-- Verificación sugerida:
--   SELECT * FROM project_members;
--   DESCRIBE participants;

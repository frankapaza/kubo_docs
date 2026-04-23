-- =========================================================================
--  Migración 001 — Adoptar roles Scrum
--  Antes:  ENUM('ADMIN','PM','MEMBER')
--  Después: ENUM('ADMIN','PRODUCT_OWNER','SCRUM_MASTER','DEVELOPER','STAKEHOLDER')
--  Mapeo de datos existentes:
--    PM     -> PRODUCT_OWNER
--    MEMBER -> DEVELOPER
--  Ejecutar sobre la base kubo_devdocs ya poblada.
-- =========================================================================

USE kubo_devdocs;

-- 1) Ampliar el enum para convivir con ambos sets durante la migración.
ALTER TABLE users
  MODIFY COLUMN role
    ENUM('ADMIN','PM','MEMBER','PRODUCT_OWNER','SCRUM_MASTER','DEVELOPER','STAKEHOLDER')
    NOT NULL
    DEFAULT 'MEMBER';

-- 2) Migrar los datos existentes.
UPDATE users SET role = 'PRODUCT_OWNER' WHERE role = 'PM';
UPDATE users SET role = 'DEVELOPER'     WHERE role = 'MEMBER';

-- 3) Reducir el enum al set final y cambiar el default.
ALTER TABLE users
  MODIFY COLUMN role
    ENUM('ADMIN','PRODUCT_OWNER','SCRUM_MASTER','DEVELOPER','STAKEHOLDER')
    NOT NULL
    DEFAULT 'DEVELOPER';

-- Verificación manual sugerida:
--   SELECT role, COUNT(*) FROM users GROUP BY role;

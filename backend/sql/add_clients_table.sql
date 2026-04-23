-- Fase 5.A: Clientes como entidad raíz
-- Crea la tabla clients y vincula projects con su cliente dueño.

-- 1) Tabla clients (sin COLLATE explícito para heredar el default de la BD)
CREATE TABLE IF NOT EXISTS clients (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  razon_social      VARCHAR(200) NOT NULL,
  ruc               VARCHAR(15) NULL,
  legal_rep_name    VARCHAR(180) NULL,
  legal_rep_doc     VARCHAR(20) NULL,
  address           VARCHAR(255) NULL,
  phone             VARCHAR(30) NULL,
  contact_email     VARCHAR(180) NULL,
  status            ENUM('PROSPECT','CLIENT','FORMER_CLIENT') NOT NULL DEFAULT 'PROSPECT',
  notes             TEXT NULL,
  created_by        BIGINT UNSIGNED NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_clients_ruc (ruc),
  INDEX idx_clients_status (status)
) ENGINE=InnoDB;

-- 2) Vincular projects con clients (nullable para migrar sin romper)
ALTER TABLE projects
  ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER code,
  ADD INDEX idx_projects_client (client_id);

-- 3) Migración: crear un cliente implícito por cada proyecto existente
INSERT INTO clients (razon_social, status, created_by, created_at)
SELECT DISTINCT p.name, 'CLIENT', p.created_by, p.created_at
FROM projects p
WHERE NOT EXISTS (
  SELECT 1 FROM clients c WHERE c.razon_social = p.name
);

-- 4) Linkear cada proyecto a su cliente recién creado
UPDATE projects p
INNER JOIN clients c ON c.razon_social = p.name
SET p.client_id = c.id
WHERE p.client_id IS NULL;

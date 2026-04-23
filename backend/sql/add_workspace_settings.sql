-- Fase 5.B — Configuración del emisor (membrete de documentos)
-- Tabla singleton: siempre hay una sola fila con id=1.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS workspace_settings (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  razon_social      VARCHAR(200) NOT NULL,
  ruc               VARCHAR(15) NULL,
  legal_rep_name    VARCHAR(180) NULL,
  legal_rep_doc     VARCHAR(20) NULL,
  address           VARCHAR(255) NULL,
  phone             VARCHAR(30) NULL,
  email             VARCHAR(180) NULL,
  website           VARCHAR(180) NULL,
  logo_url          VARCHAR(500) NULL,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Semilla con los datos reales de KUBO (editables desde la UI después)
INSERT INTO workspace_settings
  (id, razon_social, ruc, legal_rep_name, legal_rep_doc, address, phone, email, website)
VALUES
  (1,
   'KUBO Soluciones en Tecnología de Información S.A.C.',
   '20605498745',
   'Aldo Frank Apaza Colque',
   '43713193',
   'Av. Domingo Orué 565, Surquillo — Lima',
   '986 095 857',
   'frankapazac@kuboti.com',
   'kuboti.com')
ON DUPLICATE KEY UPDATE
  razon_social = VALUES(razon_social);

-- =========================================================================
--  Migración 040 — API de integración para clientes: claves kci_
-- =========================================================================
--  Claves de solo lectura con las que un cliente consulta sus tickets y
--  requerimientos desde sus sistemas (dashboards). Se guarda la huella
--  SHA-256 y un prefijo visible; la clave en claro nunca toca la base.
--
--  Idempotente: CREATE TABLE IF NOT EXISTS. No borra ni vacía nada.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS client_api_keys (
  id                         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id                  BIGINT UNSIGNED NOT NULL,
  name                       VARCHAR(80)     NOT NULL,
  key_prefix                 CHAR(8)         NOT NULL,
  key_hash                   CHAR(64)        NOT NULL,
  created_by_user_id         BIGINT UNSIGNED NULL,
  created_by_client_user_id  BIGINT UNSIGNED NULL,
  created_at                 DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at               DATETIME(3)     NULL,
  revoked_at                 DATETIME(3)     NULL,
  revoked_by_user_id         BIGINT UNSIGNED NULL,
  revoked_by_client_user_id  BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_client_api_keys_hash (key_hash),
  KEY idx_client_api_keys_client (client_id, revoked_at),
  CONSTRAINT fk_client_api_keys_client FOREIGN KEY (client_id) REFERENCES clients (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

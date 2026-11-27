-- =========================================================================
--  Migración 039 — Disponibilidad: protocolo HTTP (sin cifrar)
-- =========================================================================
--  Añade 'HTTP' al ENUM de monitor_services.protocol para vigilar
--  aplicaciones que solo publican http:// (p. ej. un IIS interno en el
--  puerto 8080). Ampliar un ENUM añadiendo un valor al final no reescribe
--  filas ni cambia las existentes.
--
--  Idempotente: MODIFY deja la misma definición si ya se aplicó.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

ALTER TABLE monitor_services
  MODIFY COLUMN protocol ENUM('TCP','HTTPS','ICMP','HTTP') NOT NULL;

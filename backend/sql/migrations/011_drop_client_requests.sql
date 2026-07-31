-- =========================================================================
--  Migración 011 — Eliminar client_requests
-- =========================================================================
--  El módulo client-requests queda reemplazado por `tickets` (migración 010).
--  Nunca se usó en producción, por lo que no hay migración de datos.
--  Ejecutar SOLO después de verificar: SELECT COUNT(*) FROM client_requests;
-- =========================================================================

USE kubo_devdocs;

DROP TABLE IF EXISTS client_requests;

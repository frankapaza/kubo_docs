-- =========================================================================
--  Limpieza de datos operacionales
--  Conserva: workspace_settings, users, ai_providers, integrations,
--             document_templates
--  Limpia:   todo lo demás (clientes, proyectos, reuniones, documentos, etc.)
-- =========================================================================

USE kubo_devdocs;

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE audit_log;
TRUNCATE TABLE acta_signatures;
TRUNCATE TABLE agreements;
TRUNCATE TABLE commitments;
TRUNCATE TABLE agenda_items;
TRUNCATE TABLE participants;
TRUNCATE TABLE actas;
TRUNCATE TABLE transcriptions;
TRUNCATE TABLE audio_files;
TRUNCATE TABLE meetings;
TRUNCATE TABLE project_members;
TRUNCATE TABLE document_signatories;
TRUNCATE TABLE commercial_documents;
TRUNCATE TABLE client_requests;
TRUNCATE TABLE projects;
TRUNCATE TABLE clients;

SET FOREIGN_KEY_CHECKS = 1;

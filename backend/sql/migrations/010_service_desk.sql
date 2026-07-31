-- =========================================================================
--  Migración 010 — Mesa de servicio (T1)
-- =========================================================================
--  Crea el núcleo de la mesa de servicio:
--    · sla_policies    matriz de tiempos por prioridad
--    · client_systems  catálogo de sistemas bajo soporte por cliente
--    · support_agents  técnicos con nivel y especialidades
--    · tickets         entidad principal, con ciclo de vida y reloj de SLA
--    · ticket_events   timeline append-only (evidencia auditable)
--
--  NO elimina client_requests: eso ocurre en 011_drop_client_requests.sql,
--  una vez que el módulo nuevo esté completo.
-- =========================================================================

USE kubo_devdocs;

-- -------------------------------------------------------------------------
-- 1) Políticas de SLA
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sla_policies (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name                   VARCHAR(80)     NOT NULL,
  is_default             TINYINT(1)      NOT NULL DEFAULT 0,

  p1_response_minutes    INT UNSIGNED    NOT NULL,
  p1_resolution_minutes  INT UNSIGNED    NOT NULL,
  p2_response_minutes    INT UNSIGNED    NOT NULL,
  p2_resolution_minutes  INT UNSIGNED    NOT NULL,
  p3_response_minutes    INT UNSIGNED    NOT NULL,
  p3_resolution_minutes  INT UNSIGNED    NOT NULL,
  p4_response_minutes    INT UNSIGNED    NOT NULL,
  p4_resolution_minutes  INT UNSIGNED    NOT NULL,

  -- Reservado: en T1 el reloj corre 24x7 y esta columna no se lee.
  coverage               VARCHAR(40)     NULL COMMENT 'reservado, sin uso en T1',

  created_at             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                         ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sla_policies_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO sla_policies
  (name, is_default,
   p1_response_minutes, p1_resolution_minutes,
   p2_response_minutes, p2_resolution_minutes,
   p3_response_minutes, p3_resolution_minutes,
   p4_response_minutes, p4_resolution_minutes)
SELECT 'Estándar', 1, 15, 240, 30, 360, 60, 720, 240, 1440
WHERE NOT EXISTS (SELECT 1 FROM sla_policies WHERE name = 'Estándar');

-- Política de SLA por cliente (NULL => se usa la marcada is_default).
-- MySQL 8.0 no tiene ADD COLUMN/INDEX IF NOT EXISTS: se guarda con el patrón
-- estándar de sentencia condicional armada desde information_schema y
-- ejecutada con prepared statement, para que una segunda corrida de esta
-- migración sea un no-op en vez de un `Duplicate column name` que aborte el
-- resto del fichero (ver 002_participants_and_members.sql:16 para el mismo
-- defecto sin guardar).
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'clients'
    AND COLUMN_NAME = 'sla_policy_id'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE clients ADD COLUMN sla_policy_id BIGINT UNSIGNED NULL AFTER jira_code',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'clients'
    AND INDEX_NAME = 'idx_clients_sla_policy'
);
SET @sql = IF(
  @idx_exists = 0,
  'ALTER TABLE clients ADD INDEX idx_clients_sla_policy (sla_policy_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- -------------------------------------------------------------------------
-- 2) Sistemas bajo soporte
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_systems (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id   BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(120)    NOT NULL,
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_client_systems (client_id, name),
  INDEX idx_client_systems_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 3) Técnicos de la mesa
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_agents (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  level        ENUM('N1','N2','N3') NOT NULL DEFAULT 'N1',
  specialties  JSON            NULL COMMENT 'array de ServiceCategory',
  is_active    TINYINT(1)      NOT NULL DEFAULT 1,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_support_agents_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 4) Tickets
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code                  VARCHAR(20)     NULL COMMENT 'KB-0001, se asigna tras el insert',

  client_id             BIGINT UNSIGNED NULL,
  project_id            BIGINT UNSIGNED NULL,
  system_id             BIGINT UNSIGNED NULL,
  meeting_id            BIGINT UNSIGNED NULL,

  origin                ENUM('EMAIL','WHATSAPP_TEXT','WHATSAPP_AUDIO','VOICE_LIVE',
                             'MEETING','NOTE','PORTAL') NOT NULL DEFAULT 'NOTE',
  request_type          ENUM('INCIDENCIA','BUG','MEJORA','FEATURE','AJUSTE') NULL,
  service_category      ENUM('SOFTWARE','SOPORTE','CAPACITACION','CONSULTA',
                             'ASESORIA','VISITA_SITIO','OTRO') NULL,

  subject               VARCHAR(240)    NULL,
  raw_text              TEXT            NOT NULL,
  raw_audio_filename    VARCHAR(255)    NULL,
  description_md        TEXT            NULL,
  acceptance_criteria   JSON            NULL,
  labels                JSON            NULL,
  module_name           VARCHAR(80)     NULL,
  screen_name           VARCHAR(120)    NULL,
  flow_context          VARCHAR(200)    NULL,

  impact                ENUM('ALTO','MEDIO','BAJO') NULL,
  urgency               ENUM('ALTA','MEDIA','BAJA') NULL,
  priority              ENUM('P1','P2','P3','P4') NOT NULL DEFAULT 'P3',
  priority_overridden   TINYINT(1)      NOT NULL DEFAULT 0,

  status                ENUM('NUEVO','TRIAJE','ASIGNADO','EN_ATENCION',
                             'ESPERA_CLIENTE','DERIVADO','RESUELTO','CERRADO')
                        NOT NULL DEFAULT 'NUEVO',

  assignee_user_id      BIGINT UNSIGNED NULL,
  escalation_level      ENUM('N1','N2','N3') NULL,

  sla_policy_id         BIGINT UNSIGNED NULL COMMENT 'snapshot al crear',
  sla_response_due_at   DATETIME        NULL,
  sla_resolution_due_at DATETIME        NULL,
  first_response_at     DATETIME        NULL,
  paused_at             DATETIME        NULL COMMENT 'no nulo mientras espera al cliente',
  paused_total_seconds  INT UNSIGNED    NOT NULL DEFAULT 0,
  sla_at_risk           TINYINT(1)      NOT NULL DEFAULT 0,

  captured_at           DATETIME        NOT NULL,
  attended_at           DATETIME        NULL,
  resolved_at           DATETIME        NULL,
  closed_at             DATETIME        NULL,

  resolution_md         TEXT            NULL,
  root_cause            TEXT            NULL,
  corrective_action     TEXT            NULL,

  scheduled_at          DATETIME        NULL,
  duration_minutes      INT UNSIGNED    NULL,

  jira_integration_id   BIGINT UNSIGNED NULL,
  jira_project_key      VARCHAR(20)     NULL,
  jira_issue_key        VARCHAR(30)     NULL,
  jira_issue_url        VARCHAR(500)    NULL,
  sent_at               DATETIME        NULL,
  closure_document_id   BIGINT UNSIGNED NULL,

  created_by            BIGINT UNSIGNED NOT NULL,
  created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_tickets_code (code),
  INDEX idx_tickets_client (client_id),
  INDEX idx_tickets_project (project_id),
  INDEX idx_tickets_system (system_id),
  INDEX idx_tickets_status (status),
  INDEX idx_tickets_priority (priority),
  INDEX idx_tickets_assignee (assignee_user_id),
  INDEX idx_tickets_created (created_at),
  INDEX idx_tickets_resolution_due (sla_resolution_due_at),
  INDEX idx_tickets_category (service_category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 5) Timeline — append-only
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id      BIGINT UNSIGNED NOT NULL,
  type           ENUM('CREATED','TRIAGED','ASSIGNED','TAKEN','STATUS_CHANGED',
                      'ESCALATED','COMMENT','RESOLVED','CLOSED','REOPENED',
                      'SLA_AT_RISK','PRIORITY_OVERRIDDEN') NOT NULL,
  from_status    ENUM('NUEVO','TRIAJE','ASIGNADO','EN_ATENCION',
                      'ESPERA_CLIENTE','DERIVADO','RESUELTO','CERRADO') NULL,
  to_status      ENUM('NUEVO','TRIAJE','ASIGNADO','EN_ATENCION',
                      'ESPERA_CLIENTE','DERIVADO','RESUELTO','CERRADO') NULL,
  actor_user_id  BIGINT UNSIGNED NULL COMMENT 'NULL cuando el actor es el sistema',
  reason         TEXT            NULL,
  payload        JSON            NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_ticket_events_ticket (ticket_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

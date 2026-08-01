-- =========================================================================
--  Migración 012 — Work items y tablero Kanban (R1)
-- =========================================================================
--  La pieza intermedia entre un ticket de mesa de servicio y un proyecto:
--  el requerimiento. Sustituye el uso que se le daba a Jira.
--
--  Sin sprint_id (llega en R3) ni origin_ticket_id (R2): cada uno con su
--  migración cuando toque.
-- =========================================================================

USE kubo_devdocs;

CREATE TABLE IF NOT EXISTS work_items (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code                 VARCHAR(20)     NULL COMMENT 'RQ-0001, se asigna tras el insert',

  client_id            BIGINT UNSIGNED NOT NULL COMMENT 'todo trabajo es para alguien',
  project_id           BIGINT UNSIGNED NULL COMMENT 'NULL = requerimiento suelto',

  title                VARCHAR(240)    NOT NULL,
  description_md       TEXT            NULL,
  acceptance_criteria  JSON            NULL,
  labels               JSON            NULL,

  status               ENUM('PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO',
                            'BLOQUEADO','CANCELADO') NOT NULL DEFAULT 'PENDIENTE',
  priority             ENUM('ALTA','MEDIA','BAJA') NOT NULL DEFAULT 'MEDIA',
  assignee_user_id     BIGINT UNSIGNED NULL,
  board_order          INT UNSIGNED    NOT NULL DEFAULT 0
                       COMMENT 'posición dentro de su columna',

  due_date             DATE            NULL
                       COMMENT 'objetivo del equipo, NO un SLA: sin reloj ni cron',
  closed_at            DATETIME        NULL,

  created_by           BIGINT UNSIGNED NOT NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_work_items_code (code),
  INDEX idx_wi_client (client_id),
  INDEX idx_wi_project (project_id),
  INDEX idx_wi_status (status),
  INDEX idx_wi_assignee (assignee_user_id),
  INDEX idx_wi_due (due_date),
  INDEX idx_wi_board (status, board_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_item_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  work_item_id   BIGINT UNSIGNED NOT NULL,
  type           ENUM('CREATED','MOVED','ASSIGNED','COMMENT','BLOCKED','UNBLOCKED',
                      'CLOSED','REOPENED','CANCELLED','PRIORITY_CHANGED') NOT NULL,
  from_status    ENUM('PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO',
                      'BLOQUEADO','CANCELADO') NULL,
  to_status      ENUM('PENDIENTE','EN_PROCESO','PRUEBAS','CERRADO',
                      'BLOQUEADO','CANCELADO') NULL,
  actor_user_id  BIGINT UNSIGNED NULL COMMENT 'NULL cuando el actor es el sistema',
  reason         TEXT            NULL,
  payload        JSON            NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_wie_item (work_item_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

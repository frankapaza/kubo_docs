-- =========================================================================
--  Migración 031 — Disponibilidad: núcleo del monitoreo de servidores y
--  servicios de los clientes
-- =========================================================================
--  Las sondas (una en la oficina, otra en el centro de datos) comprueban
--  cada servicio con TCP, HTTPS o ICMP, y mandan a la central las
--  comprobaciones y las señales de cambio de estado. La central decide los
--  incidentes. Qué se guarda dónde:
--
--    · monitor_servers / monitor_services   qué se vigila. Un servicio puede
--                               colgar de un sistema del cliente
--                               (client_systems) para saber a qué producto
--                               afecta una caída.
--    · monitor_probes           las sondas. Se siembran `oficina-01` y
--                               `kubo-01`; el token de cada una (solo su
--                               huella SHA-256) se genera después desde el
--                               panel.
--    · monitor_checks           una fila por comprobación. PK (probe_id, id):
--                               el UUID lo genera la sonda, y la pareja hace
--                               idempotente el reenvío de un lote.
--    · monitor_probe_signals    cola de señales por procesar. (probe_id, uuid)
--                               único: la central deduplica por él.
--    · monitor_probe_orders     órdenes de la central a las sondas
--                               (comprobación manual o cruzada).
--    · monitor_probe_states     último estado de cada servicio visto por cada
--                               sonda.
--    · monitor_incidents        incidentes. Dos columnas generadas con índice
--                               único garantizan en la base un solo incidente
--                               abierto por servicio y un solo incidente de
--                               servidor abierto por servidor: si dos
--                               procesos intentan abrirlo a la vez, el
--                               segundo falla en vez de duplicar.
--    · monitor_incident_events  línea de tiempo del incidente.
--    · monitor_office_outages   caídas de la conexión de la oficina.
--
--  Todos los instantes son DATETIME(3) en UTC.
--
--  También crea el usuario de sistema `monitoreo@sistema.kubo` (inactivo,
--  sin contraseña utilizable) que firma los tickets automáticos: el módulo
--  de tickets solo admite como autor a personal o a un usuario de cliente.
--
--  Idempotente: CREATE TABLE IF NOT EXISTS, siembras con INSERT ... WHERE NOT
--  EXISTS / INSERT IGNORE. No borra ni vacía nada.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- -------------------------------------------------------------------------
-- 1) Qué se vigila
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monitor_servers (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id           BIGINT UNSIGNED NOT NULL,
  name                VARCHAR(150)    NOT NULL,
  host                VARCHAR(255)    NOT NULL,
  role                VARCHAR(80)     NULL,
  provider            VARCHAR(80)     NULL,
  region              VARCHAR(80)     NULL,
  status              ENUM('ACTIVE','PAUSED','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  agent_token_hash    CHAR(64) CHARACTER SET ascii NULL
                      COMMENT 'SHA-256 del token del agente; el token en claro no se guarda',
  agent_last_seen_at  DATETIME(3)     NULL,
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                      ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_monitor_servers_client (client_id),
  CONSTRAINT fk_monitor_servers_client FOREIGN KEY (client_id)
    REFERENCES clients (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitor_services (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  server_id             BIGINT UNSIGNED NOT NULL,
  system_id             BIGINT UNSIGNED NULL
                        COMMENT 'client_systems.id al que sirve, si aplica',
  name                  VARCHAR(150)    NOT NULL,
  protocol              ENUM('TCP','HTTPS','ICMP') NOT NULL,
  target                VARCHAR(255)    NOT NULL,
  port                  INT UNSIGNED    NULL,
  latency_threshold_ms  INT             NOT NULL DEFAULT 1500,
  criticality           ENUM('HIGH','MEDIUM','LOW') NOT NULL DEFAULT 'MEDIUM',
  schedule_override     JSON            NULL,
  status                ENUM('ACTIVE','PAUSED','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  last_manual_check_at  DATETIME(3)     NULL,
  created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                        ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_monitor_services_server (server_id),
  KEY idx_monitor_services_system (system_id),
  CONSTRAINT fk_monitor_services_server FOREIGN KEY (server_id)
    REFERENCES monitor_servers (id),
  CONSTRAINT fk_monitor_services_system FOREIGN KEY (system_id)
    REFERENCES client_systems (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 2) Sondas
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monitor_probes (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code              VARCHAR(60)     NOT NULL,
  kind              ENUM('OFFICE','DATACENTER') NOT NULL,
  token_hash        CHAR(64) CHARACTER SET ascii NULL
                    COMMENT 'SHA-256 del token de la sonda; el token en claro no se guarda',
  token_created_at  DATETIME(3)     NULL,
  last_seen_at      DATETIME(3)     NULL,
  version           VARCHAR(40)     NULL,
  clock_skew_ms     INT             NULL
                    COMMENT 'desfase de reloj de la sonda respecto a la central',
  UNIQUE KEY uq_monitor_probes_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO monitor_probes (code, kind) VALUES
  ('oficina-01', 'OFFICE'),
  ('kubo-01', 'DATACENTER');

-- -------------------------------------------------------------------------
-- 3) Comprobaciones y señales
-- -------------------------------------------------------------------------
--  Sin clave foránea a monitor_services: son tablas de volumen que se podan
--  por antigüedad y no deben bloquear el archivado de un servicio.
CREATE TABLE IF NOT EXISTS monitor_checks (
  id           CHAR(36) CHARACTER SET ascii NOT NULL,
  probe_id     BIGINT UNSIGNED NOT NULL,
  service_id   BIGINT UNSIGNED NOT NULL,
  kind         ENUM('REGULAR','RETRY','MANUAL','CROSS') NOT NULL,
  cycle_at     DATETIME(3)     NOT NULL,
  started_at   DATETIME(3)     NOT NULL,
  duration_ms  INT UNSIGNED    NOT NULL,
  ok           TINYINT(1)      NOT NULL,
  error_code   VARCHAR(20)     NULL,
  http_status  INT UNSIGNED    NULL,
  order_id     BIGINT UNSIGNED NULL,
  received_at  DATETIME(3)     NOT NULL,
  PRIMARY KEY (probe_id, id),
  KEY idx_monitor_checks_service (service_id, probe_id, started_at),
  KEY idx_monitor_checks_started_at (started_at),
  CONSTRAINT fk_monitor_checks_probe FOREIGN KEY (probe_id)
    REFERENCES monitor_probes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Índice de la purga diaria (started_at < corte). Si la tabla ya existía en una
-- base de desarrollo, el CREATE TABLE IF NOT EXISTS de arriba no lo añade.
DROP PROCEDURE IF EXISTS kubo_add_index_031;
DELIMITER //
CREATE PROCEDURE kubo_add_index_031()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'monitor_checks' AND INDEX_NAME = 'idx_monitor_checks_started_at'
  ) THEN
    ALTER TABLE monitor_checks ADD INDEX idx_monitor_checks_started_at (started_at);
  END IF;
END //
DELIMITER ;
CALL kubo_add_index_031();
DROP PROCEDURE IF EXISTS kubo_add_index_031;

CREATE TABLE IF NOT EXISTS monitor_probe_signals (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  uuid                  CHAR(36) CHARACTER SET ascii NOT NULL,
  probe_id              BIGINT UNSIGNED NOT NULL,
  service_id            BIGINT UNSIGNED NULL
                        COMMENT 'NULL en las señales de la oficina (no son de un servicio)',
  type                  ENUM('VERIFYING','CONFIRMED_FAILURE','TRANSIENT_FAILURE','RECOVERED',
                             'DEGRADED','DEGRADATION_CLEARED',
                             'OFFICE_OUTAGE_START','OFFICE_OUTAGE_END') NOT NULL,
  at                    DATETIME(3)     NOT NULL,
  first_failure_at      DATETIME(3)     NULL,
  received_at           DATETIME(3)     NOT NULL,
  processed_at          DATETIME(3)     NULL,
  awaiting_cross_until  DATETIME(3)     NULL,
  cross_order_id        BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_monitor_signal_probe_uuid (probe_id, uuid),
  KEY idx_monitor_signal_pending (processed_at, id),
  CONSTRAINT fk_monitor_signals_probe FOREIGN KEY (probe_id)
    REFERENCES monitor_probes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitor_probe_orders (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  probe_id    BIGINT UNSIGNED NOT NULL,
  service_id  BIGINT UNSIGNED NOT NULL,
  kind        ENUM('MANUAL','CROSS') NOT NULL,
  created_at  DATETIME(3)     NOT NULL,
  taken_at    DATETIME(3)     NULL,
  done_at     DATETIME(3)     NULL,
  KEY idx_monitor_orders_pending (probe_id, taken_at),
  CONSTRAINT fk_monitor_orders_probe FOREIGN KEY (probe_id)
    REFERENCES monitor_probes (id),
  CONSTRAINT fk_monitor_orders_service FOREIGN KEY (service_id)
    REFERENCES monitor_services (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitor_probe_states (
  service_id       BIGINT UNSIGNED NOT NULL,
  probe_id         BIGINT UNSIGNED NOT NULL,
  state            ENUM('OK','VERIFYING','FAILED','DEGRADED') NOT NULL,
  last_check_at    DATETIME(3)     NULL,
  last_ok          TINYINT(1)      NULL,
  last_latency_ms  INT UNSIGNED    NULL,
  updated_at       DATETIME(3)     NOT NULL,
  PRIMARY KEY (service_id, probe_id),
  CONSTRAINT fk_monitor_states_service FOREIGN KEY (service_id)
    REFERENCES monitor_services (id),
  CONSTRAINT fk_monitor_states_probe FOREIGN KEY (probe_id)
    REFERENCES monitor_probes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 4) Incidentes
-- -------------------------------------------------------------------------
--  open_service_id vale service_id mientras el incidente está abierto y NULL
--  al cerrarse; open_server_parent vale server_id solo para el incidente de
--  servidor (service_id NULL) abierto. Como MySQL admite varios NULL en una
--  clave única, el índice impide dos incidentes abiertos del mismo servicio
--  (o dos de servidor del mismo servidor) y no limita los cerrados.
CREATE TABLE IF NOT EXISTS monitor_incidents (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  service_id          BIGINT UNSIGNED NULL,
  server_id           BIGINT UNSIGNED NOT NULL,
  parent_id           BIGINT UNSIGNED NULL,
  kind                ENUM('DOWN','ROUTE','DEGRADED') NOT NULL,
  first_failure_at    DATETIME(3)     NOT NULL,
  confirmed_at        DATETIME(3)     NOT NULL,
  recovered_at        DATETIME(3)     NULL,
  close_reason        ENUM('RECOVERED','SERVICE_PAUSED') NULL,
  ticket_id           BIGINT UNSIGNED NULL,
  acknowledged_by     BIGINT UNSIGNED NULL,
  acknowledged_at     DATETIME(3)     NULL,
  open_service_id     BIGINT UNSIGNED
                      GENERATED ALWAYS AS (
                        IF(recovered_at IS NULL AND service_id IS NOT NULL, service_id, NULL)
                      ) VIRTUAL,
  open_server_parent  BIGINT UNSIGNED
                      GENERATED ALWAYS AS (
                        IF(recovered_at IS NULL AND service_id IS NULL, server_id, NULL)
                      ) VIRTUAL,
  UNIQUE KEY uq_monitor_incident_open_service (open_service_id),
  UNIQUE KEY uq_monitor_incident_open_server (open_server_parent),
  KEY idx_monitor_incidents_server (server_id, confirmed_at),
  KEY idx_monitor_incidents_parent (parent_id),
  KEY idx_monitor_incidents_ticket (ticket_id),
  CONSTRAINT fk_monitor_incidents_service FOREIGN KEY (service_id)
    REFERENCES monitor_services (id),
  CONSTRAINT fk_monitor_incidents_server FOREIGN KEY (server_id)
    REFERENCES monitor_servers (id),
  CONSTRAINT fk_monitor_incidents_parent FOREIGN KEY (parent_id)
    REFERENCES monitor_incidents (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitor_incident_events (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  incident_id     BIGINT UNSIGNED NOT NULL,
  at              DATETIME(3)     NOT NULL,
  type            VARCHAR(40)     NOT NULL,
  detail          JSON            NULL,
  author_user_id  BIGINT UNSIGNED NULL,
  KEY idx_monitor_incident_events (incident_id, at),
  CONSTRAINT fk_monitor_incident_events_incident FOREIGN KEY (incident_id)
    REFERENCES monitor_incidents (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitor_office_outages (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  probe_id           BIGINT UNSIGNED NOT NULL,
  started_at         DATETIME(3)     NOT NULL,
  ended_at           DATETIME(3)     NULL,
  affected_services  INT UNSIGNED    NOT NULL,
  KEY idx_monitor_office_outages (probe_id, started_at),
  CONSTRAINT fk_monitor_office_outages_probe FOREIGN KEY (probe_id)
    REFERENCES monitor_probes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 5) Usuario de sistema que firma los tickets automáticos
-- -------------------------------------------------------------------------
--  is_active = 0 y password_hash = '!' (no es un hash válido): no puede
--  iniciar sesión por ninguna vía.
INSERT INTO users (email, password_hash, full_name, role, is_active)
SELECT 'monitoreo@sistema.kubo', '!', 'Monitoreo KUBO', 'STAKEHOLDER', 0
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'monitoreo@sistema.kubo');

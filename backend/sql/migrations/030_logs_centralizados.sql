-- =========================================================================
--  Migración 030 — Logs centralizados: instalaciones, grupos de error y el
--  origen MONITOREO de los tickets
-- =========================================================================
--  Los aplicativos de la casa (y los que viven en servidores de clientes)
--  mandan sus logs a este backend con un appender log4net. Qué se guarda
--  dónde, y por qué:
--
--    · LOS LOGS EN SÍ NO VAN A MYSQL. Son volumen (miles de líneas por
--      minuto, de las que casi todas se leen una vez o ninguna) y una base
--      transaccional es el sitio equivocado: engordaría sin parar y
--      competiría con los tickets. Van a Loki, con 30 días de retención.
--      MySQL guarda solo lo que hay que consultar con integridad y durante
--      más tiempo: quién envía y qué errores se repiten.
--
--    · log_installations        una instalación = una identidad que envía
--                               (una clave). CLIENTE es la instalación de
--                               una asignación cliente-sistema (la 029);
--                               INTERNA es un aplicativo propio de la casa,
--                               sin cliente. De la clave solo se guarda su
--                               huella SHA-256 (como las invitaciones): la
--                               clave en claro se muestra una única vez.
--    · log_installation_sources los pares aplicativo+servidor que de hecho
--                               han enviado bajo una instalación. Una misma
--                               clave la usan varios aplicativos y
--                               servidores del cliente; esto es el
--                               inventario de «quién me habla».
--    · error_groups             un grupo por huella del error (mismo tipo
--                               de excepción y mismo sitio). Es lo que ve
--                               la mesa: no mil líneas iguales sino un
--                               error con su conteo, su ticket y su
--                               estado. Se conserva mientras tenga ticket o
--                               se haya visto en los últimos 180 días.
--    · error_occurrences        las últimas muestras de cada grupo (50), con
--                               mensaje y excepción completos, para
--                               diagnosticar sin ir a Loki. 180 días.
--    · error_group_daily        conteo por grupo y día: la gráfica de
--                               tendencia sin tener que contar ocurrencias,
--                               que se podan. 180 días.
--
--  tickets.origin gana el valor MONITOREO: los tickets que nacen de un
--  grupo de error no vienen de ningún canal humano, y la bandeja necesita
--  distinguirlos (no tienen remitente a quien responder).
--
--  Los ids de usuario, cliente y ticket (created_by, client_id, ticket_id,
--  ...) son columnas sin clave foránea a propósito: el monitoreo no debe
--  poder bloquear el borrado ni la migración de las tablas del portal, y un
--  grupo que sobrevive a su ticket es un caso normal. Solo hay clave foránea
--  donde la fila hija carece de sentido sin la madre.
--
--  Idempotente: las tablas van con CREATE TABLE IF NOT EXISTS y el cambio del
--  ENUM de tickets.origin con un procedimiento guardado por
--  information_schema, como la sección 3 de la 028. No borra ni vacía nada.
-- =========================================================================

USE kubo_devdocs;

SET NAMES utf8mb4;

-- -------------------------------------------------------------------------
-- 1) Instalaciones: quién envía logs
-- -------------------------------------------------------------------------
--  El CHECK impone en la base lo que el servicio ya valida: una instalación
--  de cliente se identifica por su asignación y una interna por su nombre.
--  uq_log_inst_client_system garantiza una sola instalación por asignación
--  (MySQL admite varios NULL en una clave única: las internas no chocan).
--  system_id solo se usa en las internas; en las de cliente el sistema se
--  lee de la asignación para no tener dos fuentes de verdad.
CREATE TABLE IF NOT EXISTS log_installations (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind              ENUM('CLIENTE','INTERNA') NOT NULL,
  client_system_id  BIGINT UNSIGNED NULL
                    COMMENT 'asignacion cliente-sistema; solo CLIENTE',
  name              VARCHAR(120)    NULL
                    COMMENT 'nombre del aplicativo propio; solo INTERNA',
  system_id         BIGINT UNSIGNED NULL
                    COMMENT 'producto del catalogo; opcional en INTERNA (en CLIENTE sale de la asignacion)',
  min_level         ENUM('DEBUG','INFO','WARN','ERROR','FATAL') NOT NULL DEFAULT 'INFO'
                    COMMENT 'por debajo de este nivel el backend descarta el evento',
  key_fingerprint   CHAR(64) CHARACTER SET ascii NULL
                    COMMENT 'SHA-256 de la clave; la clave en claro no se guarda',
  key_prefix        VARCHAR(12)     NULL
                    COMMENT 'primeros caracteres de la clave, para reconocerla en pantalla',
  key_created_at    DATETIME        NULL,
  key_revoked_at    DATETIME        NULL,
  last_seen_at      DATETIME(3)     NULL
                    COMMENT 'ultimo lote recibido',
  created_by        BIGINT UNSIGNED NULL,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_log_inst_fingerprint (key_fingerprint),
  UNIQUE KEY uq_log_inst_client_system (client_system_id),
  CONSTRAINT chk_log_inst_identidad CHECK (
    (kind = 'CLIENTE' AND client_system_id IS NOT NULL)
    OR (kind = 'INTERNA' AND name IS NOT NULL)
  ),
  CONSTRAINT fk_log_inst_client_system FOREIGN KEY (client_system_id)
    REFERENCES client_systems (id),
  CONSTRAINT fk_log_inst_system FOREIGN KEY (system_id)
    REFERENCES systems (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 2) Fuentes: pares aplicativo+servidor vistos bajo cada instalación
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS log_installation_sources (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  installation_id   BIGINT UNSIGNED NOT NULL,
  aplicativo        VARCHAR(100)    NOT NULL,
  servidor          VARCHAR(100)    NOT NULL,
  appender_version  VARCHAR(20)     NULL,
  first_seen_at     DATETIME(3)     NOT NULL,
  last_seen_at      DATETIME(3)     NOT NULL,
  UNIQUE KEY uq_log_source (installation_id, aplicativo, servidor),
  CONSTRAINT fk_log_source_installation FOREIGN KEY (installation_id)
    REFERENCES log_installations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 3) Grupos de error: un error que se repite, una fila
-- -------------------------------------------------------------------------
--  fingerprint es único en toda la tabla: la huella ya incluye la
--  instalación, así que dos clientes con el mismo bug tienen dos grupos.
--  servers es la lista de servidores donde se ha visto (JSON).
--  reopened_at/reopen_reason anotan por qué un grupo RESUELTO volvió a
--  NUEVO (el error reapareció).
CREATE TABLE IF NOT EXISTS error_groups (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fingerprint        CHAR(64) CHARACTER SET ascii NOT NULL,
  installation_id    BIGINT UNSIGNED NOT NULL,
  client_id          BIGINT UNSIGNED NULL
                     COMMENT 'NULL en instalaciones internas',
  system_id          BIGINT UNSIGNED NULL
                     COMMENT 'producto del catalogo (systems.id)',
  aplicativo         VARCHAR(100)    NOT NULL,
  exception_type     VARCHAR(255)    NULL,
  title              VARCHAR(300)    NOT NULL,
  logger             VARCHAR(255)    NOT NULL,
  first_seen_at      DATETIME(3)     NOT NULL,
  last_seen_at       DATETIME(3)     NOT NULL,
  occurrences_total  INT UNSIGNED    NOT NULL DEFAULT 0,
  servers            JSON            NOT NULL,
  status             ENUM('NUEVO','CON_TICKET','RESUELTO') NOT NULL DEFAULT 'NUEVO',
  reopened_at        DATETIME        NULL,
  reopen_reason      VARCHAR(200)    NULL,
  ticket_id          BIGINT UNSIGNED NULL,
  ticket_linked_by   BIGINT UNSIGNED NULL,
  ticket_linked_at   DATETIME        NULL,
  resolved_by        BIGINT UNSIGNED NULL,
  resolved_at        DATETIME(3)     NULL,
  resolution_note    TEXT            NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_error_group_fingerprint (fingerprint),
  KEY idx_error_group_status_seen (status, last_seen_at),
  KEY idx_error_group_client_seen (client_id, last_seen_at),
  KEY idx_error_group_ticket (ticket_id),
  KEY idx_error_group_seen (last_seen_at),
  CONSTRAINT fk_error_group_installation FOREIGN KEY (installation_id)
    REFERENCES log_installations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 4) Ocurrencias: las muestras con detalle de cada grupo
-- -------------------------------------------------------------------------
--  Sin ON DELETE CASCADE: la poda de 180 días borra ocurrencias y grupos en
--  ese orden, a propósito y por código, no por efecto colateral.
CREATE TABLE IF NOT EXISTS error_occurrences (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id     BIGINT UNSIGNED NOT NULL,
  occurred_at  DATETIME(3)     NOT NULL,
  servidor     VARCHAR(100)    NOT NULL,
  hilo         VARCHAR(100)    NULL,
  logger       VARCHAR(255)    NOT NULL,
  message      TEXT            NOT NULL,
  exception    TEXT            NULL,
  properties   JSON            NULL,
  received_at  DATETIME(3)     NOT NULL,
  KEY idx_error_occ_group_time (group_id, occurred_at),
  KEY idx_error_occ_time (occurred_at),
  CONSTRAINT fk_error_occ_group FOREIGN KEY (group_id)
    REFERENCES error_groups (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 5) Conteo diario por grupo
-- -------------------------------------------------------------------------
--  Sobrevive a la poda de muestras: es lo que alimenta la tendencia.
CREATE TABLE IF NOT EXISTS error_group_daily (
  group_id  BIGINT UNSIGNED NOT NULL,
  day       DATE            NOT NULL,
  count     INT UNSIGNED    NOT NULL,
  PRIMARY KEY (group_id, day),
  KEY idx_error_daily_day (day),
  CONSTRAINT fk_error_daily_group FOREIGN KEY (group_id)
    REFERENCES error_groups (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------------------------
-- 6) Origen de ticket nuevo: MONITOREO
-- -------------------------------------------------------------------------
--  Misma regla que la 018 y la 028: la lista conserva el orden existente (el
--  orden de un ENUM es su valor interno) y el valor nuevo va al final. La
--  lista de partida es la de la 010, la última que tocó esta columna. La
--  guarda busca la etiqueta entrecomillada para no confundirla con otra.
DROP PROCEDURE IF EXISTS kubo_add_origin_030;
DELIMITER //
CREATE PROCEDURE kubo_add_origin_030()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tickets'
      AND COLUMN_NAME = 'origin'
      AND COLUMN_TYPE LIKE '%''MONITOREO''%'
  ) THEN
    ALTER TABLE tickets MODIFY COLUMN origin
      ENUM('EMAIL','WHATSAPP_TEXT','WHATSAPP_AUDIO','VOICE_LIVE','MEETING',
           'NOTE','PORTAL','MONITOREO') NOT NULL DEFAULT 'NOTE';
  END IF;
END //
DELIMITER ;

CALL kubo_add_origin_030();

DROP PROCEDURE IF EXISTS kubo_add_origin_030;

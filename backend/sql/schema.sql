-- =========================================================================
--  Kubo DevDocs CRM — Esquema MVP
--  MySQL 8.x / InnoDB / utf8mb4
-- =========================================================================

CREATE DATABASE IF NOT EXISTS kubo_devdocs
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE kubo_devdocs;

-- ---------------------------------------------------------
-- users
-- ---------------------------------------------------------
CREATE TABLE users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(180) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(180) NOT NULL,
  role          ENUM('ADMIN','PRODUCT_OWNER','SCRUM_MASTER','DEVELOPER','STAKEHOLDER') NOT NULL DEFAULT 'DEVELOPER',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- projects
-- ---------------------------------------------------------
CREATE TABLE projects (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(30)  NOT NULL,
  name        VARCHAR(180) NOT NULL,
  description TEXT NULL,
  status      ENUM('ACTIVE','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  created_by  BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_projects_code (code),
  CONSTRAINT fk_projects_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- project_members
-- ---------------------------------------------------------
CREATE TABLE project_members (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id      BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  role_in_project ENUM('OWNER','EDITOR','VIEWER') NOT NULL DEFAULT 'VIEWER',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_project_members (project_id, user_id),
  CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- meetings
-- ---------------------------------------------------------
CREATE TABLE meetings (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id    BIGINT UNSIGNED NOT NULL,
  title         VARCHAR(200) NOT NULL,
  description   TEXT NULL,
  scheduled_at  DATETIME NOT NULL,
  started_at    DATETIME NULL,
  ended_at      DATETIME NULL,
  location      VARCHAR(180) NULL,
  status        ENUM('SCHEDULED','IN_PROGRESS','RECORDED','TRANSCRIBING',
                     'TRANSCRIBED','ACTA_DRAFT','ACTA_APPROVED','CLOSED')
                NOT NULL DEFAULT 'SCHEDULED',
  created_by    BIGINT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_meetings_project    (project_id),
  KEY idx_meetings_status     (status),
  KEY idx_meetings_scheduled  (scheduled_at),
  CONSTRAINT fk_meetings_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_meetings_user    FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- participants
-- ---------------------------------------------------------
CREATE TABLE participants (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  meeting_id      BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NULL,
  full_name       VARCHAR(180) NOT NULL,
  document_number VARCHAR(40)  NULL,
  email           VARCHAR(180) NULL,
  role            VARCHAR(80)  NULL,
  attended        TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_participants_meeting (meeting_id),
  CONSTRAINT fk_participants_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  CONSTRAINT fk_participants_user    FOREIGN KEY (user_id)    REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- agenda_items
-- ---------------------------------------------------------
CREATE TABLE agenda_items (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  meeting_id        BIGINT UNSIGNED NOT NULL,
  order_index       INT NOT NULL DEFAULT 0,
  title             VARCHAR(200) NOT NULL,
  description       TEXT NULL,
  duration_minutes  INT NULL,
  KEY idx_agenda_meeting (meeting_id, order_index),
  CONSTRAINT fk_agenda_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- audio_files
-- ---------------------------------------------------------
CREATE TABLE audio_files (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  meeting_id         BIGINT UNSIGNED NOT NULL,
  uploaded_by        BIGINT UNSIGNED NOT NULL,
  storage_key        VARCHAR(500) NOT NULL,
  original_filename  VARCHAR(255) NOT NULL,
  mime_type          VARCHAR(80)  NOT NULL,
  size_bytes         BIGINT UNSIGNED NOT NULL,
  duration_seconds   INT NULL,
  checksum_sha256    CHAR(64) NULL,
  source             ENUM('WEB','MOBILE') NOT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audio_meeting (meeting_id),
  CONSTRAINT fk_audio_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  CONSTRAINT fk_audio_user    FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- transcriptions
-- ---------------------------------------------------------
CREATE TABLE transcriptions (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  audio_file_id           BIGINT UNSIGNED NOT NULL,
  status                  ENUM('PENDING','PROCESSING','COMPLETED','FAILED')
                          NOT NULL DEFAULT 'PENDING',
  provider                VARCHAR(50) NOT NULL DEFAULT 'whisper-api',
  language                VARCHAR(10) NULL,
  content_text            LONGTEXT NULL,
  content_segments_json   JSON NULL,
  error_message           TEXT NULL,
  started_at              DATETIME NULL,
  finished_at             DATETIME NULL,
  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_transcription_audio (audio_file_id),
  CONSTRAINT fk_transcription_audio FOREIGN KEY (audio_file_id) REFERENCES audio_files(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- actas
-- ---------------------------------------------------------
CREATE TABLE actas (
  id                            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  meeting_id                    BIGINT UNSIGNED NOT NULL,
  status                        ENUM('DRAFT','IN_REVIEW','APPROVED','EXPORTED')
                                NOT NULL DEFAULT 'DRAFT',
  content_markdown              LONGTEXT NOT NULL,
  generated_from_transcription  TINYINT(1) NOT NULL DEFAULT 0,
  approved_by                   BIGINT UNSIGNED NULL,
  approved_at                   DATETIME NULL,
  exported_pdf_key              VARCHAR(500) NULL,
  version                       INT NOT NULL DEFAULT 1,
  created_at                    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_actas_meeting (meeting_id),
  CONSTRAINT fk_actas_meeting  FOREIGN KEY (meeting_id)  REFERENCES meetings(id) ON DELETE CASCADE,
  CONSTRAINT fk_actas_approver FOREIGN KEY (approved_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- agreements
-- ---------------------------------------------------------
CREATE TABLE agreements (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  acta_id     BIGINT UNSIGNED NOT NULL,
  description TEXT NOT NULL,
  order_index INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_agreements_acta (acta_id, order_index),
  CONSTRAINT fk_agreements_acta FOREIGN KEY (acta_id) REFERENCES actas(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- commitments
-- ---------------------------------------------------------
CREATE TABLE commitments (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  acta_id           BIGINT UNSIGNED NOT NULL,
  description       TEXT NOT NULL,
  assignee_user_id  BIGINT UNSIGNED NULL,
  assignee_name     VARCHAR(180) NULL,
  due_date          DATE NULL,
  status            ENUM('OPEN','DONE','CANCELLED') NOT NULL DEFAULT 'OPEN',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_commitments_acta   (acta_id),
  KEY idx_commitments_status (status),
  CONSTRAINT fk_commitments_acta FOREIGN KEY (acta_id) REFERENCES actas(id) ON DELETE CASCADE,
  CONSTRAINT fk_commitments_user FOREIGN KEY (assignee_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------
CREATE TABLE audit_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NULL,
  action        VARCHAR(80) NOT NULL,
  entity_type   VARCHAR(60) NOT NULL,
  entity_id     VARCHAR(60) NULL,
  payload_json  JSON NULL,
  ip_address    VARCHAR(45) NULL,
  user_agent    VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_entity (entity_type, entity_id),
  KEY idx_audit_user   (user_id, created_at),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- Seed admin (password: Admin123* — reemplazar en prod)
-- Hash bcrypt generado con cost 12.
-- ---------------------------------------------------------
INSERT INTO users (email, password_hash, full_name, role)
VALUES (
  'admin@kubo.pe',
  '$2b$12$hX7vPyvfOyK4JxVeVRO6tOEm13O/Lh8qIqPCKyUsYnYMPwf4zW0Zm',
  'Administrador Kubo',
  'ADMIN'
);

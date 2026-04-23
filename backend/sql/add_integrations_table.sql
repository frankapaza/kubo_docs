-- Tabla de integraciones externas (Jira, etc.)
CREATE TABLE IF NOT EXISTS integrations (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider        ENUM('JIRA') NOT NULL DEFAULT 'JIRA',
  label           VARCHAR(100) NOT NULL,
  workspace_url   VARCHAR(255) NOT NULL COMMENT 'https://company.atlassian.net',
  email           VARCHAR(255) NOT NULL,
  api_token_encrypted TEXT NOT NULL,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

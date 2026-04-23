-- Mapeo opcional por proyecto Kubo -> proyecto Jira
ALTER TABLE projects
  ADD COLUMN jira_integration_id BIGINT UNSIGNED NULL AFTER status,
  ADD COLUMN jira_project_key VARCHAR(20) NULL AFTER jira_integration_id;

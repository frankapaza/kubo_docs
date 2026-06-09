USE kubo_devdocs;
ALTER TABLE client_requests ADD COLUMN attended_at DATETIME NULL AFTER completed_at;

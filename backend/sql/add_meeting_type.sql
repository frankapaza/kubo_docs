-- Tipificación de reuniones (Fase 1 del roadmap)
ALTER TABLE meetings
  ADD COLUMN meeting_type ENUM(
    'GENERIC',
    'DAILY',
    'RETROSPECTIVE',
    'SPRINT_PLANNING',
    'SPRINT_REVIEW',
    'POSTMORTEM',
    'DISCOVERY'
  ) NOT NULL DEFAULT 'GENERIC' AFTER status;

-- =========================================================================
--  Migración 008 — Categorías de servicio en tickets de atención
-- =========================================================================
--  Agrega service_category, scheduled_at y duration_minutes a
--  client_requests para clasificar atenciones por tipo de servicio
--  (Software, Soporte, Capacitación, Consulta, Asesoría, Visita en sitio).
-- =========================================================================

USE kubo_devdocs;

ALTER TABLE client_requests
  ADD COLUMN service_category ENUM(
    'SOFTWARE',
    'SOPORTE',
    'CAPACITACION',
    'CONSULTA',
    'ASESORIA',
    'VISITA_SITIO',
    'OTRO'
  ) NULL AFTER request_type,

  -- Fecha/hora pactada (aplica a CAPACITACION y VISITA_SITIO)
  ADD COLUMN scheduled_at DATETIME NULL AFTER service_category,

  -- Minutos invertidos (se registra al completar el ticket)
  ADD COLUMN duration_minutes INT UNSIGNED NULL AFTER scheduled_at,

  ADD INDEX idx_cr_category (service_category);

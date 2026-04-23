# Roadmap técnico por sprints

Sprints de 2 semanas. MVP apunta a **Sprint 4**.

## Sprint 0 — Preparación (1 semana)
- [x] Definir stack.
- [x] Estructura de carpetas + docs.
- [x] Esquema SQL inicial.
- [ ] Docker compose (MySQL + Redis) local.
- [ ] CI lint + build (GitHub Actions).

## Sprint 1 — Núcleo backend + Auth
**Objetivo:** API arranca, login funciona, CRUD de proyectos y reuniones.
- [ ] Módulo `auth` (login, refresh, JWT strategy, guards).
- [ ] Módulo `users` (seed admin).
- [ ] Módulo `projects` (CRUD + miembros).
- [ ] Módulo `meetings` (CRUD + transiciones `start` / `end`).
- [ ] `AuditInterceptor` + tabla `audit_log`.
- [ ] Validación global, filtros de error, envelope uniforme.
- [ ] Tests unitarios servicios críticos.

## Sprint 2 — Participantes, agenda y audio
- [ ] Módulo `participants`.
- [ ] Módulo `agenda`.
- [ ] Módulo `audio` con `IStorageService` (impl local).
- [ ] Validación MIME + tamaño.
- [ ] Registro `audio_file` + checksum.
- [ ] Encolar job `transcription:transcribe` tras upload.
- [ ] Worker stub que marca `COMPLETED` con texto dummy — **TODO: integración real Whisper**.

## Sprint 3 — Transcripción y acta
- [ ] Adapter `WhisperTranscriptionProvider` (OpenAI API).
- [ ] Guardado de segmentos con timestamps.
- [ ] Edición manual de transcripción.
- [ ] Generación borrador de acta desde transcripción (template Markdown).
- [ ] Módulo `agreements` + `commitments`.
- [ ] Flujo aprobación acta.
- [ ] Generación PDF (job async `acta:render-pdf`).

## Sprint 4 — Web + Móvil MVP
**Web**
- [ ] Login, layout protegido.
- [ ] Listado proyectos, detalle.
- [ ] Listado reuniones con filtros.
- [ ] Detalle reunión (participantes, agenda, audio, transcripción, acta).
- [ ] Editor de acta (Markdown + acuerdos + compromisos).
- [ ] Aprobación + descarga PDF.

**Móvil**
- [ ] Login + almacenamiento seguro token.
- [ ] Lista de reuniones.
- [ ] Crear reunión rápida.
- [ ] Pantalla de grabación (pause/resume/stop + cronómetro).
- [ ] Reproducir antes de enviar.
- [ ] Upload multipart con progreso.
- [ ] Consulta estado de transcripción (polling).
- [ ] Ver transcripción read-only.

## Sprint 5 — Endurecimiento
- [ ] Rate limiting en `/auth/*`.
- [ ] Migrar storage a S3/MinIO detrás de `IStorageService`.
- [ ] WebSockets para notificaciones de transcripción finalizada.
- [ ] Métricas Prometheus + dashboard Grafana.
- [ ] Hardening: helmet, CSP, cookies SameSite.
- [ ] E2E suite (Playwright web + integration tests backend).

## Deuda técnica conocida (TODOs del código)
- `WhisperTranscriptionProvider` devuelve texto dummy — integrar Whisper real.
- `LocalStorageService` no escala horizontalmente — cambiar a S3/MinIO.
- `PdfRenderer` es un placeholder — estilizar plantilla corporativa Kubo.
- Refresh token sin revocación persistida — agregar tabla `refresh_tokens`.
- Notificaciones push móvil — FCM en sprint 5+.

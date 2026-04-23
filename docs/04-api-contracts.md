# Contratos API — Web y Móvil

Base URL: `/api/v1`. Todo JSON salvo uploads (`multipart/form-data`).
Autenticación: `Authorization: Bearer <accessToken>`.

## Envelope de respuesta

Éxito → el recurso directo.
Error → `{ "statusCode": 400, "code": "VALIDATION_ERROR", "message": "...", "details": [...] }`

## Auth

### POST `/auth/login`
Request:
```json
{ "email": "user@kubo.pe", "password": "secret" }
```
Response 200:
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": { "id": 1, "email": "user@kubo.pe", "fullName": "Juan", "role": "PM" }
}
```

### POST `/auth/refresh`
```json
{ "refreshToken": "..." }
```

### POST `/auth/logout`
`204 No Content`.

## Projects

- `GET /projects?status=ACTIVE&page=1&pageSize=20`
- `POST /projects` → `{ code, name, description? }`
- `GET /projects/:id`
- `PATCH /projects/:id`
- `DELETE /projects/:id` (solo ADMIN)

## Meetings

- `GET /meetings?projectId=&status=&from=&to=&page=&pageSize=`
- `POST /meetings`:
```json
{
  "projectId": 1,
  "title": "Kickoff Sprint 3",
  "description": "...",
  "scheduledAt": "2026-04-20T15:00:00-05:00",
  "location": "Sala A / Meet"
}
```
- `GET /meetings/:id` → incluye participantes, agenda, audio más reciente, estado transcripción y acta.
- `PATCH /meetings/:id`
- `POST /meetings/:id/start` — setea `started_at`, estado `IN_PROGRESS`.
- `POST /meetings/:id/end` — setea `ended_at`.
- `DELETE /meetings/:id`

### Participants
- `GET /meetings/:id/participants`
- `POST /meetings/:id/participants`
- `PATCH /participants/:id`
- `DELETE /participants/:id`

### Agenda
- `GET /meetings/:id/agenda`
- `POST /meetings/:id/agenda` (bulk) — reemplaza el set y respeta `orderIndex`.
- `PATCH /agenda/:id`
- `DELETE /agenda/:id`

## Audio

### POST `/meetings/:id/audio` — multipart/form-data
Campos:
- `file`: binario (audio/mpeg, audio/mp4, audio/wav, audio/webm, audio/ogg)
- `source`: `WEB` | `MOBILE`
- `durationSeconds` (opcional, móvil)
- `checksumSha256` (opcional)

Response 201:
```json
{
  "id": 42,
  "meetingId": 10,
  "storageKey": "meetings/10/42_rec.m4a",
  "mimeType": "audio/mp4",
  "sizeBytes": 1928374,
  "source": "MOBILE",
  "transcription": { "id": 55, "status": "PENDING" }
}
```

> Al crearse un `audio_file` se encola automáticamente un job de transcripción (`transcription:transcribe`).

### GET `/audio/:id` — metadatos
### GET `/audio/:id/stream` — descarga/stream (para reproducción en web)

## Transcriptions

- `GET /transcriptions/:id` → estado + contenido si `COMPLETED`.
- `GET /meetings/:id/transcription` → atajo desde la reunión.
- `PATCH /transcriptions/:id` — edición manual del texto (`contentText`).
- `POST /transcriptions/:id/retry` — reencola en estado `FAILED`.

## Actas

- `POST /meetings/:id/acta/generate` — genera borrador desde la transcripción. Idempotente: si ya existe `DRAFT`, devuelve el existente.
- `GET /actas/:id`
- `PATCH /actas/:id` — edita `contentMarkdown`, acuerdos y compromisos inline (bulk).
- `POST /actas/:id/submit-review` → `IN_REVIEW`
- `POST /actas/:id/approve` → `APPROVED` (permiso PM/ADMIN). Dispara generación de PDF async.
- `GET /actas/:id/pdf` — descarga el PDF si `exportedPdfKey` está disponible.

### Acuerdos / compromisos (inline o endpoints)
- `POST /actas/:id/agreements`
- `PATCH /agreements/:id`
- `DELETE /agreements/:id`
- `POST /actas/:id/commitments`
- `PATCH /commitments/:id`
- `DELETE /commitments/:id`

## Audit
- `GET /audit?entityType=&entityId=&userId=&from=&to=` (solo ADMIN)

## Códigos de error estándar

| code | HTTP | descripción |
|------|------|-------------|
| `VALIDATION_ERROR` | 400 | DTO inválido |
| `UNAUTHORIZED` | 401 | token ausente / expirado |
| `FORBIDDEN` | 403 | permisos insuficientes |
| `NOT_FOUND` | 404 | recurso inexistente |
| `CONFLICT` | 409 | estado inválido (p.ej. aprobar un acta ya aprobada) |
| `PAYLOAD_TOO_LARGE` | 413 | audio supera límite |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | MIME de audio no soportado |
| `INTERNAL_ERROR` | 500 | error no controlado |

## Diferencias web vs móvil

Móvil consume el mismo API. Diferencias:
- Usa `source: "MOBILE"` al subir.
- Polling a `GET /meetings/:id/transcription` cada 5-10 s hasta `COMPLETED`. _En fase 2 → WebSockets_.
- Refresh token guardado en secure storage (`flutter_secure_storage`).

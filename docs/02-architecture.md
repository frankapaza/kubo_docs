# Arquitectura

## Visión general

```
┌────────────┐       ┌────────────┐       ┌─────────────────┐
│  Web SPA   │──────▶│            │──────▶│  MySQL 8        │
│  (React)   │       │            │       └─────────────────┘
└────────────┘       │  API REST  │       ┌─────────────────┐
┌────────────┐       │  NestJS    │──────▶│  Redis + BullMQ │
│  Mobile    │──────▶│            │       └────────┬────────┘
│  (Flutter) │       │            │                │
└────────────┘       └──────┬─────┘                ▼
                            │              ┌────────────────┐
                            │              │ Transcription  │
                            ▼              │ Worker         │
                     ┌────────────┐        │ (Whisper API)  │
                     │  Storage   │◀───────┤                │
                     │  (FS/S3)   │        └────────────────┘
                     └────────────┘
```

## Capas del backend

```
src/
├── main.ts                    # Bootstrap HTTP + filters globales
├── app.module.ts              # Módulo raíz
├── config/                    # Configuración tipada (DB, JWT, storage, queue)
├── common/                    # Cross-cutting: guards, interceptors, decorators, filters
│   ├── decorators/
│   ├── guards/                # JwtAuthGuard, RolesGuard
│   ├── interceptors/          # AuditInterceptor
│   ├── filters/               # HttpExceptionFilter
│   └── interfaces/
├── modules/
│   ├── auth/                  # Login, refresh, estrategia JWT
│   ├── users/
│   ├── projects/
│   ├── meetings/
│   ├── participants/
│   ├── agenda/
│   ├── audio/                 # Upload multipart + metadatos
│   ├── transcriptions/        # Estado + contenido + job dispatch
│   ├── actas/                 # Borrador + aprobación + PDF
│   ├── agreements/            # Acuerdos y compromisos
│   └── audit/
└── queues/
    ├── transcription.queue.ts
    └── transcription.processor.ts
```

## Capas dentro de cada módulo

```
module-x/
├── entities/x.entity.ts       # Entidad TypeORM — capa de persistencia
├── dto/                       # DTOs de entrada/salida — capa de transporte
├── x.repository.ts            # Acceso a datos — capa de infraestructura
├── x.service.ts               # Lógica de negocio — capa de aplicación
├── x.controller.ts            # Endpoints REST — capa de presentación
├── interfaces/                # Contratos entre capas (IStorageService, ITranscriptionProvider)
└── x.module.ts
```

## Principios

1. **Separación de responsabilidades.** Controllers sólo orquestan; toda regla de negocio vive en services.
2. **Dependencia por interfaz.** `IStorageService`, `ITranscriptionProvider`, `IPdfRenderer` → implementaciones intercambiables.
3. **DTOs siempre validados.** `ValidationPipe` global con whitelist + transform.
4. **Auditoría transversal.** `AuditInterceptor` registra mutaciones en `audit_log` sin tocar los services.
5. **Jobs asíncronos para trabajo lento.** Transcripción y generación PDF por BullMQ.
6. **Errores tipados.** `DomainException` → `HttpExceptionFilter` → respuesta uniforme `{ code, message, details }`.

## Seguridad

- Bcrypt cost 12 para contraseñas.
- JWT: HS256 access token 15 min + refresh token 7d rotado.
- CORS whitelist por entorno.
- Rate limiting `@nestjs/throttler` en `/auth/*`.
- Tamaño máximo upload audio: 100 MB (configurable por env).
- Header `X-Request-Id` propagado para trazabilidad.
- Validación estricta MIME del audio: `audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/webm`, `audio/ogg`.

## Estados clave

### Reunión (`meeting.status`)
`SCHEDULED → IN_PROGRESS → RECORDED → TRANSCRIBING → TRANSCRIBED → ACTA_DRAFT → ACTA_APPROVED → CLOSED`

### Transcripción (`transcription.status`)
`PENDING → PROCESSING → COMPLETED | FAILED`

### Acta (`acta.status`)
`DRAFT → IN_REVIEW → APPROVED → EXPORTED`

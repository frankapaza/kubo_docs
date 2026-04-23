# Stack tecnológico

## Decisión

| Capa | Tecnología | Versión |
|------|------------|---------|
| Backend | NestJS (Node.js + TypeScript) | 10.x |
| ORM | TypeORM | 0.3.x |
| DB | MySQL | 8.x |
| Cache / Queue | Redis + BullMQ | 7.x / 5.x |
| Auth | JWT (access 15m, refresh 7d) + bcrypt | — |
| Web | React + Vite + TypeScript + TailwindCSS | 18 / 5 / 5 / 3 |
| HTTP web | Axios + React Query | — |
| Router web | React Router | 6.x |
| Móvil | Flutter | 3.x (Dart 3) |
| HTTP móvil | Dio | 5.x |
| Grabación móvil | `record` + `just_audio` | — |
| Storage audio | FS local → abstracción `IStorageService` | migrable S3/MinIO |
| Transcripción | Whisper API (OpenAI) vía adapter | — |
| PDF | pdfkit | — |

## Por qué NestJS y no Laravel

- Un solo lenguaje en todo el stack backend/web → DTOs compartibles.
- Primer nivel de soporte para **colas BullMQ** y **WebSockets** nativos.
- Arquitectura modular ya definida: módulos, controllers, services, repositories, guards.
- Validación declarativa con DTOs + `class-validator`.

## Por qué React + Vite y no Blade/Vue

- Misma base TS que el backend.
- Tipos compartidos vía paquete `@kubo/contracts` (fase 2).
- SPA ligera suficiente para el MVP.

## Por qué Flutter

- Una sola base iOS + Android.
- Grabación, pausa/reanudar, reproducción: soporte maduro (`record` 5.x).
- Envío multipart nativo con `dio`.

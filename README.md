# Kubo DevDocs CRM — MVP

Sistema de gestión de **Actas de Reunión** con app móvil de grabación y transcripción.

## Estructura del monorepo

```
kubo_documentacion/
├── backend/          # API REST — NestJS + TypeORM + MySQL + BullMQ
├── web/              # Frontend web — React + Vite + TypeScript
├── mobile/           # App móvil — Flutter 3
├── docs/             # Arquitectura, modelo de datos, contratos API, roadmap
└── README.md
```

## Flujo funcional del MVP

```
Crear reunión
   └─ Registrar participantes y agenda
        └─ Grabar (móvil) o subir audio (web)
             └─ Encolar transcripción (Whisper)
                  └─ Ver / editar transcripción
                       └─ Generar borrador de acta
                            └─ Registrar acuerdos y compromisos
                                 └─ Aprobar acta
                                      └─ Exportar PDF
```

## Documentación

- [docs/01-stack.md](docs/01-stack.md) — Stack tecnológico y justificación
- [docs/02-architecture.md](docs/02-architecture.md) — Arquitectura por capas
- [docs/03-data-model.md](docs/03-data-model.md) — Modelo de datos + SQL
- [docs/04-api-contracts.md](docs/04-api-contracts.md) — Contratos API web/móvil
- [docs/05-roadmap.md](docs/05-roadmap.md) — Roadmap por sprints

## Versión de Node

El proyecto exige **Node 20** (`.nvmrc` y `engines` de `backend/` y `web/`): es lo que corre en CI y en producción (`node:20-alpine` en los Dockerfile). Con otra versión, `npm install` avisa. No es un capricho: algunas APIs de Node cambian según la versión (p. ej. `TextDecoder('windows-1252')` no hace nada en Node 20 y sí en Node 24), y lo que se verifica en otra versión no vale. Si cambias de versión, cámbiala a la vez en `.nvmrc`, `engines` y los Dockerfile; el CI lee `.nvmrc`.

## Arranque rápido

### Backend
```bash
cd backend
cp .env.example .env
npm install
npm run migration:run
npm run start:dev
```

### Web
```bash
cd web
cp .env.example .env
npm install
npm run dev
```

### Móvil
```bash
cd mobile
flutter pub get
flutter run
```

## Monitoreo de disponibilidad

Además del backend, el stack levanta el contenedor `monitor-worker` (`node dist/monitoring-worker.js`, mismo código y mismas variables de base de datos que `backend`, sin puertos). Es una sonda: ejecuta las pruebas del centro de datos `kubo-01` y recoge sus órdenes (manuales y de cruce); solo necesita MySQL. La evaluación de incidentes (tick cada 5 s) y la purga diaria de las 03:00 (Lima, checks y señales de más de 90 días) corren en el `backend`, no en el worker. Requiere las migraciones `032_disponibilidad_nucleo.sql` y `033_disponibilidad_escritorio.sql` (la `031` es la del conector): en una base con datos hay que aplicarlas a mano antes del deploy (ver `deploy.sh`); sin ella el worker aborta al arrancar. En desarrollo el worker va en el perfil `monitoreo` (un `up -d` normal no lo levanta): `docker compose -f docker-compose.dev.yml --profile monitoreo up -d --build`.

## Estado del MVP

> Ver [docs/05-roadmap.md](docs/05-roadmap.md). Los `// TODO:` en el código marcan puntos de integración real pendientes (Whisper, almacenamiento cloud, notificaciones push).

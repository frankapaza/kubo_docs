# Alerta de latencia por hora — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Pings cada minuto desde la oficina, estadística por hora, correo al empezar/terminar un episodio de lentitud y gráfico por hora.

**Architecture:** `intervalMin` opcional por servicio en `@kubo/monitoring-core` (runner); la central lo envía para ICMP. Un cron horario en la central agrega `monitor_checks` de la sonda OFFICE en `monitor_latency_hours`, abre/cierra `monitor_latency_episodes` y envía el correo con el marco Kubo. Endpoint e UI para destinatarios y para el gráfico.

**Spec:** docs/superpowers/specs/2026-11-28-alerta-latencia-design.md

## Global Constraints

- Hora lenta: `slow/total >= 0.2` y `total >= 10`; lento = `durationMs > latencyThresholdMs` u `ok = false`.
- Solo checks `REGULAR` de la sonda `OFFICE` y servicios `ICMP` activos.
- Horas en hora de Lima (UTC-5) en correos y gráfico.
- Migración 041 registrada en deploy.yml, docker-compose.yml, docker-compose.dev.yml, deploy.sh y `migraciones-desplegadas.spec.ts`.

## Review Focus

- Episodio abierto y el servicio se archiva/pausa → se cierra sin correo de «fin» falso (test Task 3).
- Cron que corre dos veces la misma hora → no duplica filas ni correos (test Task 3).
- Hora sin pings (motor apagado) → no cuenta como normal ni lenta: no cierra ni abre (test Task 3).
- Todos los pings lentos a la vez → correo con aviso «internet de la oficina» (test Task 3).
- Motor antiguo sin `intervalMin` sigue funcionando (test Task 1).

### Task 1: intervalo por servicio en el núcleo
- `ServiceTarget.intervalMin?: number` (divide 1440); `nextCycleAt` usa `{ dayIntervalMin: m, nightIntervalMin: m }` si viene.
- Tests en `packages/monitoring-core/test`: un servicio con `intervalMin: 1` programa franjas de 1 min de día; sin él, 5 min.
- Central (`availability-ingest.service.ts`): ICMP → `intervalMin: 1`, incluido en `canonicalTarget`.

### Task 2: migración 041 y entidades
- `monitor_latency_hours (service_id, hour_start, total, slow, avg_ms, p95_ms, max_ms, PK(service_id,hour_start))`.
- `monitor_latency_episodes (id, service_id, started_hour, ended_hour NULL, office_wide, alerted_at, cleared_at)`.
- `workspace_settings.latency_alert_emails VARCHAR(1000) NULL`.

### Task 3: evaluación horaria y correo (`latency-alert.service.ts`)
- `@Cron('5 * * * *')` → `evaluateHour(hourStart)`; puro `domain/latency-hour.ts`: `summarize(durations, oks, threshold)` y `isSlowHour`.
- Correos «inicio» y «fin» con tabla por hora; aviso oficina si todos los activos (≥2) lentos.

### Task 4: destinatarios y gráfico
- `GET/PUT /availability/latency-alert-settings` (ADMIN) ↔ `latency_alert_emails`; card en Sondas.
- `GET /availability/servers/:id/latency?days=7` → horas del ping del servidor; gráfico en el historial.

### Task 5: publicar y actualizar el motor de la oficina

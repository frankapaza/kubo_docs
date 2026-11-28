#!/bin/bash
set -e
# -----------------------------------------------------------------------------
# OJO: este script NO aplica migraciones SQL.
#
# Los .sql de backend/sql/migrations/ solo los ejecuta MySQL a traves de
# docker-entrypoint-initdb.d, y solo cuando arranca sobre un directorio de
# datos vacio. El volumen mysql_data sobrevive a este deploy, asi que en
# cualquier base que YA TENGA DATOS las migraciones nuevas hay que aplicarlas
# a mano ANTES de levantar el backend:
#
#   docker compose exec -T mysql \
#     sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" kubo_devdocs' \
#     < backend/sql/migrations/013_portal_clientes.sql
#
# El sh -c con comillas simples hace falta: la contrasena vive dentro del
# contenedor. Sin el la expande el shell del host, donde no existe, y MySQL
# responde "Access denied (using password: NO)".
#
# Si se olvida, el backend aborta al arrancar (PortalSchemaValidator) diciendo
# que migracion falta. Procedimiento completo en COMANDOS.txt, "PASO 3-bis".
# -----------------------------------------------------------------------------
#
# Migraciones 035 y 036 (monitoreo de disponibilidad; la 031 es la del
# conector y 032-034 las de requerimientos): aplicarlas a mano, en orden, ANTES de este deploy en una base
# con datos, igual que las anteriores. La 035 crea la sonda
# 'kubo-01' que busca el servicio monitor-worker; sin ella el worker aborta
# al arrancar ("aplicar la migracion 035"). La 036 anade
# monitor_probes.silence_alerted_at (aviso por silencio de una sonda). El worker solo mide; la
# evaluacion de incidentes y la purga corren en el backend.
# Migracion 037 (037_disponibilidad_informe): tablas del informe mensual,
# evidencias, mantenimientos y agente de servidor; aplicarla igual, a mano.
# Migracion 038 (038_disponibilidad_historial_agente): media, maximo y errores
# del resumen diario del agente para el historial; aplicarla igual, a mano.
# Migracion 039 (039_disponibilidad_protocolo_http): protocolo HTTP en
# monitor_services; aplicarla igual, a mano.
# Migracion 040 (040_api_integracion_clientes): tabla client_api_keys de la
# API de integracion de clientes; aplicarla igual, a mano.
# Migracion 041 (041_disponibilidad_latencia_horaria): latencia por hora y
# alerta de lentitud de los pings; aplicarla igual, a mano.
cd /home/kubo/kubo
git pull
docker compose build backend monitor-worker web
docker compose up -d
echo "Deploy completado"

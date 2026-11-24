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
# Migracion 031 (monitoreo de disponibilidad): aplicarla a mano ANTES de este
# deploy en una base con datos, igual que las anteriores. Crea la sonda
# 'kubo-01' que busca el servicio monitor-worker; sin ella el worker aborta
# al arrancar ("aplicar la migracion 031").
cd /home/kubo/kubo
git pull
docker compose build backend monitor-worker web
docker compose up -d
echo "Deploy completado"

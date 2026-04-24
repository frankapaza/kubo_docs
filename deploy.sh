#!/bin/bash
set -e
cd /home/kubo/kubo
git pull
docker compose build backend web
docker compose up -d
echo "Deploy completado"

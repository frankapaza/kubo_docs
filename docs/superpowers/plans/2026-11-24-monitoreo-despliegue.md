# Monitoreo de disponibilidad · Lista de despliegue a producción

Para el responsable. Cubre la Entrega 1 (núcleo: central, sonda `kubo-01`, motor de la oficina) y la Entrega 2 (widget de escritorio y aviso por silencio de una sonda), ya integradas con `main` (conector de tickets).

**Migraciones implicadas, en este orden:**

| Nº | Fichero | De quién | Qué hace |
|----|---------|----------|----------|
| 031 | `backend/sql/migrations/031_conector_repos.sql` | conector (ya en `main`) | tablas `dev_repos`, `dev_keys`, `dev_links`; `work_items.client_system_id` |
| 032 | `backend/sql/migrations/032_disponibilidad_nucleo.sql` | monitoreo (antes 031) | tablas `monitor_*`, sondas `kubo-01` y `oficina-01`, usuario de sistema `monitoreo@sistema.kubo` (inactivo, sin contraseña válida) |
| 033 | `backend/sql/migrations/033_disponibilidad_escritorio.sql` | monitoreo (antes 032) | columna `monitor_probes.silence_alerted_at` |

Las tres son aditivas e idempotentes (guardadas con `information_schema`, `CREATE TABLE IF NOT EXISTS`, `INSERT ... WHERE NOT EXISTS` / `INSERT IGNORE`): volver a aplicarlas no hace nada. Ninguna siembra plantillas de aviso, así que el control «Plantillas de aviso: 9» de `deploy.yml` no cambia. La 033 necesita la 032 (altera `monitor_probes`).

---

## 0. Antes de empezar

- [ ] La rama está integrada en `main` y el **CI de `main` está en verde** (incluye los trabajos «Monitoreo — núcleo» y el del motor de la oficina). `deploy.yml` solo se dispara tras un CI correcto (`workflow_run`) o a mano (`workflow_dispatch`).
- [ ] Tiene a mano: acceso SSH al VPS (`/home/kubo/kubo`), una cuenta ADMIN de la web, y acceso de administrador a la PC de la oficina.

## 1. Respaldo de la base

`deploy.yml` lo hace solo (paso 2): `mysqldump --single-transaction --routines` a `$HOME/respaldo-pre-deploy-<fecha>.sql`, aborta si pesa menos de 10 000 bytes y conserva los diez últimos.

- [ ] Si despliega a mano, haga usted el respaldo primero:

  ```bash
  cd /home/kubo/kubo
  docker compose exec -T mysql \
    sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines "$MYSQL_DATABASE"' \
    > $HOME/respaldo-pre-monitoreo-$(date +%F-%H%M%S).sql
  ls -l $HOME/respaldo-pre-monitoreo-*.sql   # que no pese casi nada = no siga
  ```

## 2. Migraciones 031 (conector), 032 y 033

**Camino normal: `deploy.yml`.** En su paso 4 aplica, en orden, `010 … 030`, `031_conector_repos`, `032_disponibilidad_nucleo`, `033_disponibilidad_escritorio` (la 011 no: sigue siendo manual). Con `set -e`, cualquier fallo corta el despliegue **antes** de reconstruir: la versión vieja sigue sirviendo.

- [ ] Revise en el log de la acción que aparecen `--- 031_conector_repos`, `--- 032_disponibilidad_nucleo` y `--- 033_disponibilidad_escritorio` sin error, y que el paso 5 dice «Eventos pendientes de notificar: 0» y «Plantillas de aviso: 9».

**Camino manual** (si se despliega con `deploy.sh`, que **no** aplica migraciones):

```bash
cd /home/kubo/kubo
git pull
for m in 031_conector_repos 032_disponibilidad_nucleo 033_disponibilidad_escritorio; do
  echo "--- $m"
  docker compose exec -T mysql \
    sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
    < backend/sql/migrations/$m.sql || break
done
```

(Las comillas simples del `sh -c` hacen falta: la contraseña vive dentro del contenedor.)

- [ ] Compruebe:

  ```bash
  docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N "$MYSQL_DATABASE"' <<'SQL'
  SELECT code FROM monitor_probes;                                   -- kubo-01, oficina-01
  SELECT email, is_active FROM users WHERE email='monitoreo@sistema.kubo';  -- 1 fila, is_active 0
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='monitor_probes' AND COLUMN_NAME='silence_alerted_at';  -- 1
  SQL
  ```

## 3. Construir y levantar `backend` y `monitor-worker`

`deploy.yml` (paso 6) hace `docker compose build backend monitor-worker web` y `docker compose up -d`. Con `deploy.sh` es lo mismo (`git pull`, `build backend monitor-worker web`, `up -d`), pero las migraciones del paso 2 tienen que ir **antes**.

- [ ] `docker compose ps` muestra `backend`, `monitor-worker` y `web` en marcha.

## 4. Comprobar el arranque

- [ ] Backend: en `docker compose logs backend`, «Nest application successfully started». Ojo: si faltara la 032 el backend arranca igual; el fallo llega al crear el primer ticket automático («Falta el usuario de monitoreo: aplicar la migración 032») y lo delata antes el worker (punto siguiente).
- [ ] Sonda del centro de datos: en `docker compose logs monitor-worker`, la línea **«Sonda kubo-01 iniciada»**. `deploy.yml` la espera (paso 7b, hasta 30 × 5 s) y, si no aparece, marca el despliegue como fallido aunque el backend esté en pie. Sin la 032 el worker aborta con «No existe la sonda 'kubo-01' en monitor_probes: aplicar la migración 032.».

## 5. Revisar la web

- [ ] Entre como ADMIN en `https://docs.kuboti.com/monitoreo/estado`: la página carga (sin servicios todavía, o con los que haya en Inventario).
- [ ] `/monitoreo/sondas` lista `kubo-01` (con último contacto reciente) y `oficina-01` (sin contacto aún).

## 6. Emitir el token de la oficina

- [ ] **Monitoreo → Sondas → oficina-01 → Emitir token** (solo ADMIN; `POST /api/v1/availability/probes/:id/token`). El token `kmp_…` se muestra **una sola vez**; emitir otro revoca el anterior. Cópielo solo hasta el paso 7.

## 7. Instalar el motor (servicio de Windows) en la PC de la oficina

Instrucciones completas en `desktop/engine/README.md` («Compilar» e «Instalar (como administrador)»). Resumen:

- [ ] **Node 20 LTS de 64 bits instalado para todo el equipo** con el instalador oficial (`C:\Program Files\nodejs\node.exe`). No vale un Node por usuario (nvm, scoop, fnm, uno bajo `C:\Users\…`): el instalador se niega.
- [ ] Compile con Node 20: `packages\monitoring-core` (`npm install; npm run build`) y luego `desktop\engine` (`npm install; npm run build`). Copie la carpeta del motor compilada (con `node_modules` y `dist`) a, p. ej., `C:\Program Files\KUBO\engine`.
- [ ] En PowerShell como administrador:

  ```powershell
  cd "C:\Program Files\KUBO\engine"
  Read-Host "Token kmp_" | node dist\service\install.js --user OFICINA\<usuario> --central https://docs.kuboti.com --token-stdin
  ```

  (`--user`: el usuario de escritorio que usará el widget; `--dry-run` para ver lo que haría.)
- [ ] Compruebe: el servicio arranca solo con Windows; `/monitoreo/sondas` muestra a `oficina-01` con contacto reciente; y la API local responde:
  `curl.exe -H "X-Kubo-Secret: $(Get-Content $env:ProgramData\KUBO\Monitor\local-api.secret)" http://127.0.0.1:47800/v1/status`.

## 8. Instalar el widget

Instrucciones en `desktop/widget/README.md` («Empaquetado»).

- [ ] En una máquina de compilación: `cd desktop\widget; npm install; npm run dist` → instalador NSIS por usuario (sin elevación) en `desktop\widget\dist\`.
- [ ] Ejecútelo **con la sesión del usuario indicado en `--user`** en la PC de la oficina. Queda registrado para arrancar con la sesión; una sola instancia.
- [ ] Compruebe: barra «KUBO · Todo operativo · hh:mm», icono en la bandeja, y «Probar notificación» desde el menú de la bandeja muestra un aviso de Windows.

## 9. Cargar `VMI2571371` en Inventario

Solo con su visto bueno tras leer `2026-11-23-monitoreo-entrega-1-aceptacion.md` («Cambios respecto al plan», «Limitaciones conocidas») y `2026-11-24-monitoreo-entrega-2-aceptacion.md`, y con los pendientes que allí bloquean la carga ya hechos (servicio de Windows en la oficina y la prueba de corte de internet).

- [ ] **Monitoreo → Inventario** (`/monitoreo/inventario`): alta del servidor `VMI2571371` y sus servicios.
- [ ] En `/monitoreo/estado` aparecen y pasan a «operativo» en unos minutos; el widget de la oficina los muestra.

---

## Si algo falla (vuelta atrás)

**Falla una migración (paso 2).**
- Con `deploy.yml`: el `set -e` corta antes de reconstruir; la versión anterior sigue sirviendo. Lea el error en el log de la acción, corríjalo y vuelva a lanzar (`workflow_dispatch`): las migraciones ya aplicadas no hacen nada la segunda vez.
- A mano: el bucle se detiene en la que falla (`|| break`); no levante el backend nuevo. Las ya aplicadas no estorban a la versión vieja (solo añaden tablas y columnas nulables).
- Si una ejecución se cortó a medias puede quedar un procedimiento auxiliar (`kubo_add_column_031`, `kubo_add_index_031`, `kubo_upgrade_032`, `kubo_add_column_033`): cada migración hace `DROP PROCEDURE IF EXISTS` al empezar, así que basta con reaplicarla.
- La 033 depende de la 032: no la aplique sola.
- Restaurar el respaldo solo hace falta si algo tocó datos existentes, que no es el caso de estas migraciones. Si aun así se decide:

  ```bash
  docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < $HOME/respaldo-pre-deploy-<fecha>.sql
  ```

**El backend no arranca (paso 4).** `deploy.yml` imprime el log y el nombre del respaldo. Las migraciones son aditivas: la versión anterior vuelve con `git checkout <commit-anterior> && docker compose up -d --build`. La versión anterior no tiene el servicio `monitor-worker` en el compose: añada `--remove-orphans` (o `docker compose stop monitor-worker`) para no dejarlo corriendo suelto.

**El backend arranca pero `monitor-worker` no («Sonda kubo-01 iniciada» no aparece).** El despliegue se marca fallido, pero la web funciona. Mire `docker compose logs --tail 120 monitor-worker`: lo habitual es que falte la 032 (no existe `kubo-01`) o que no conecte a MySQL. Aplique la 032 y `docker compose up -d monitor-worker`. Mientras tanto solo falta la medición desde el centro de datos.

**El motor de la oficina no se instala o no reporta.** No afecta a la central. Desinstalar: `node dist\service\uninstall.js` (conserva los datos; `--purge` los borra). Si el token se filtró o se perdió, emita otro en Sondas (revoca el anterior) y reinstale con `--token-stdin`. A los 10 minutos sin contacto la central avisa por correo a los administradores (una vez por silencio).

**Quitar el monitoreo del todo** no requiere borrar tablas: basta con parar `monitor-worker` y no cargar servicios. No borre las tablas `monitor_*` sin un respaldo.

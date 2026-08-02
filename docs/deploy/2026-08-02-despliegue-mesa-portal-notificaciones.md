# Despliegue: mesa de servicio + requerimientos + portal + notificaciones

130 commits. Cuatro funcionalidades encadenadas, ya fusionadas en `master` y
publicadas en la rama `release/mesa-portal-notificaciones`.

**Lee esto entero antes de empezar.** Hay un paso destructivo y va al final a
propósito, y hay un orden que permite hacer casi todo sin cortar el servicio.

---

## Lo que hay que entender antes de tocar nada

**Empujar a `main` despliega solo.** `.github/workflows/deploy.yml` hace
`git pull`, reconstruye y levanta. **No aplica migraciones.**

Y esta versión no arranca si la base no está preparada: `PortalSchemaValidator`
comprueba el esquema al arrancar y **aborta** si falta algo, y
`JwtSecretsValidator` hace lo mismo si faltan los secretos del portal. Eso es
deliberado —vale más no servir que servir roto— pero significa que **si
empujas antes de preparar la base, docs.kuboti.com se cae** hasta que entres a
arreglarlo.

Por eso el orden es: **preparar la base y el entorno primero, empujar después.**

La buena noticia: casi todas las migraciones son aditivas y están guardadas, así
que se pueden aplicar **con la versión vieja corriendo**, sin cortar nada. La
única excepción es la 011, que borra una tabla que la versión vieja todavía usa
— esa va al final, después del despliegue.

---

## Paso 0 — Conectarse y respaldar

```bash
ssh -i ~/.ssh/id_ed25519 kubo@194.238.24.82
cd ~/kubo
```

**El respaldo no es opcional.** Es lo único que te devuelve atrás si algo sale
mal:

```bash
docker compose exec -T mysql \
  sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines "$MYSQL_DATABASE"' \
  > ~/respaldo-antes-de-tickets-$(date +%F-%H%M).sql
ls -lh ~/respaldo-antes-de-tickets-*.sql
```

Si el fichero pesa unos pocos kilobytes o está vacío, **para**: el volcado
falló y no tienes red de seguridad.

## Paso 1 — Mirar antes de tocar

Cuatro cosas que cambian el plan según lo que digan. Apúntalas y pásamelas.

**a) La zona horaria del contenedor.** De esto depende que haya o no una
migración de datos:

```bash
docker compose exec -T backend date
```

- Si dice **UTC** → no hay nada que migrar, sigue.
- Si dice **-05** o `PET` → **para y avísame**: las fechas ya guardadas
  necesitan un desplazamiento y hay que prepararlo antes.

**b) El nombre de la base.** Las migraciones empiezan con `USE kubo_devdocs;`:

```bash
grep '^DB_NAME=' .env.production
```

Si **no** dice `kubo_devdocs`, **para y avísame**: las migraciones apuntarían a
otra base.

**c) Qué existe ya:**

```bash
docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "
  SELECT TABLE_NAME FROM information_schema.TABLES
  WHERE TABLE_SCHEMA=\"kubo_devdocs\"
    AND TABLE_NAME IN (\"workspace_settings\",\"tickets\",\"client_requests\",
                       \"client_users\",\"notification_templates\",\"work_items\");"'
```

Anota cuáles salen. Importa sobre todo **`workspace_settings`**: si no está, el
paso 2b es obligatorio.

**d) Cuántos datos hay en juego:**

```bash
docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" kubo_devdocs -e "
  SELECT \"users\" t, COUNT(*) n FROM users
  UNION ALL SELECT \"clients\", COUNT(*) FROM clients
  UNION ALL SELECT \"meetings\", COUNT(*) FROM meetings
  UNION ALL SELECT \"actas\", COUNT(*) FROM actas;"'
```

## Paso 2 — Traer el código sin desplegarlo

El repositorio del VPS necesita los ficheros de migración, pero **todavía no
queremos reconstruir**. Traemos la rama de release sin cambiar lo que corre:

```bash
git fetch origin
git checkout release/mesa-portal-notificaciones -- backend/sql/
ls backend/sql/migrations/
```

Deben aparecer de la 010 a la 017. Los contenedores siguen con el código viejo:
solo hemos copiado ficheros `.sql` al disco.

### 2b — Solo si `workspace_settings` NO existe

```bash
for f in add_workspace_settings add_workspace_smtp_and_session add_workspace_audio_retention; do
  echo "--- $f"
  docker compose exec -T mysql \
    sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" kubo_devdocs' < backend/sql/$f.sql || break
done
```

**El orden importa** y el `|| break` está para que se pare en el primero que
falle en vez de dejar la tabla a medias.

## Paso 3 — Aplicar las migraciones aditivas

Todas están guardadas con `information_schema` y son idempotentes: reejecutar
una ya aplicada no hace nada. **La 011 no está en la lista, y es a propósito.**

```bash
for m in 010_service_desk 012_work_items 013_portal_clientes \
         014_audit_client_user 015_notificaciones \
         016_notify_next_attempt 017_plantillas_respuesta; do
  echo "===== $m"
  docker compose exec -T mysql \
    sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" kubo_devdocs' \
    < backend/sql/migrations/$m.sql || { echo "FALLO EN $m — PARA AQUI"; break; }
done
```

El aviso de contraseña por stderr es normal. Lo que no es normal es un `ERROR`.

### La comprobación que no te puedes saltar

```bash
docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" kubo_devdocs -e "
  SELECT COUNT(*) AS eventos_pendientes_de_notificar FROM ticket_events WHERE notified_at IS NULL;
  SELECT COUNT(*) AS plantillas FROM notification_templates;"'
```

- **`eventos_pendientes_de_notificar` tiene que ser 0.** Si no lo es, el
  sellado del histórico de la 015 no funcionó y en cuanto arranque el vigilante
  mandará un correo por cada evento antiguo, a clientes reales, y eso no se
  recoge. Si sale distinto de 0, **para y avísame.**
- `plantillas` tiene que ser **7**.

## Paso 4 — Los secretos y variables nuevas

```bash
grep -c '^JWT_CLIENT_ACCESS_SECRET=' .env.production || true
```

Si no están, se generan. Tienen que ser **distintos entre sí y distintos de los
del personal** — el validador aborta el arranque si dos coinciden:

```bash
cp .env.production ~/env-produccion-respaldo-$(date +%F-%H%M)

cat >> .env.production <<EOF

# Portal de clientes: secretos propios, distintos de los del personal.
JWT_CLIENT_ACCESS_SECRET=$(openssl rand -base64 48)
JWT_CLIENT_REFRESH_SECRET=$(openssl rand -base64 48)

# Base de los enlaces de los correos. Sin esto, los avisos salen apuntando
# a localhost y el cliente no puede abrir su ticket.
FRONTEND_URL=https://docs.kuboti.com
EOF

grep -E '^(JWT_CLIENT|FRONTEND_URL)' .env.production
```

Comprueba a ojo que los dos secretos son distintos y que ninguno coincide con
`JWT_ACCESS_SECRET` ni con `JWT_REFRESH_SECRET`.

El SMTP no hace falta ponerlo aquí: se configura por el panel, en Ajustes del
área de trabajo → Datos del emisor. Las credenciales del buzón están en
`SECRETS.local.txt`.

## Paso 5 — Desplegar

Ahora sí. **Avísame y lo empujo yo**, o hazlo tú desde GitHub fusionando
`release/mesa-portal-notificaciones` en `main`. Empujar a `main` dispara el
despliegue automático.

Mientras corre, con los logs abiertos:

```bash
docker compose logs -f backend
```

Lo que debes ver:

- `Esquema del portal de clientes verificado: las migraciones … están aplicadas`
- `Secretos JWT verificados`
- `Nest application successfully started`

Si en vez de eso ves un aborto, **el mensaje te dice qué falta y cómo
aplicarlo**. Está escrito para eso.

## Paso 6 — Comprobar que funciona

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://docs.kuboti.com/api/v1/health || \
curl -s -o /dev/null -w "%{http_code}\n" https://docs.kuboti.com/
```

Y en el navegador: entra al panel, mira que la bandeja de tickets carga, y que
aparecen las secciones nuevas —Tickets, Requerimientos, Usuarios de cliente,
Notificaciones, Manual del equipo—.

## Paso 7 — La limpieza destructiva, al final

La 011 borra `client_requests`, la tabla del módulo viejo que esta versión ya
no usa. **Se aplica solo cuando el paso 6 haya salido bien**, porque hasta ese
momento la versión vieja podría tener que volver.

```bash
docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" kubo_devdocs -e "
  SELECT COUNT(*) AS filas_que_se_van_a_perder FROM client_requests;"'
```

Míralo antes de borrar. Si tiene filas que te importan, exporta la tabla:

```bash
docker compose exec -T mysql \
  sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" kubo_devdocs client_requests' \
  > ~/client_requests-antes-de-borrar.sql
```

Y entonces:

```bash
docker compose exec -T mysql \
  sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" kubo_devdocs' \
  < backend/sql/migrations/011_drop_client_requests.sql
```

---

## Si algo sale mal

**El backend no arranca.** Lee el mensaje del aborto: dice qué falta y qué
fichero aplicar. Aplícalo y `docker compose restart backend`.

**Volver a la versión anterior.** El código:

```bash
cd ~/kubo && git checkout <commit-anterior> && docker compose build backend web && docker compose up -d
```

Las migraciones aditivas **no hay que deshacerlas**: las columnas nuevas son
nulables y la versión vieja las ignora. Solo la 011 es irreversible, y por eso
va la última.

**Restaurar la base entera**, último recurso:

```bash
docker compose exec -T mysql \
  sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" kubo_devdocs' \
  < ~/respaldo-antes-de-tickets-FECHA.sql
```

---

## Después del despliegue

1. **Rotar la clave de DeepSeek y la contraseña de `ticket@kuboti.com`.** Las
   dos se pegaron en un chat y hay que darlas por expuestas.
2. **Publicar el registro DMARC del dominio.** SPF y DKIM están en regla,
   DMARC no existe, y es la causa más probable de que los avisos de correo
   caigan en no deseado. Sin eso, las notificaciones no sirven de nada por bien
   que estén programadas.
3. **Configurar el SMTP por el panel** si no estaba, y el buzón del equipo en
   la misma pantalla.
4. **Dar de alta el primer usuario de cliente** en Administración → Usuarios de
   cliente, y probar el portal de punta a punta con un cliente real.
5. La cadena de arranque desde cero de `docker-compose.yml` sigue rota
   (`004_client_requests.sql` falla porque ese compose nunca montó la tabla
   `clients`, y faltan las migraciones 001, 002 y 005–008). No afecta a este
   despliegue, que va sobre una base con datos, pero un servidor nuevo no se
   levanta entero. Merece un trabajo aparte.

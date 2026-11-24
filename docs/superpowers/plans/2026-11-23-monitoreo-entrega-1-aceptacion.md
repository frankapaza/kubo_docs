# Aceptación de la Entrega 1 (Núcleo) — Monitoreo de disponibilidad

Fecha de las comprobaciones: **2026-11-24** (pruebas automáticas repetidas tras la ronda final de correcciones, ver «Cambios» punto 6). Rama: `feat/monitoreo-nucleo` (sin publicar, sin fusionar).
Criterios: sección «Cuándo el piloto está listo» de `docs/superpowers/specs/2026-11-23-monitoreo-disponibilidad-design.md`.

## Resumen para el responsable

- Todas las pruebas automáticas pasan y todo compila.
- Se montó un entorno de prueba local desechable (base de datos, backend, sonda del servidor y motor de la oficina) y se reprodujeron los escenarios principales. Todos dieron el resultado esperado.
- **No se cargó nada en producción** (`VMI2571371` sigue sin tocar) y **no se instaló el servicio de Windows** en ninguna PC.
- Quedan pendientes cuatro comprobaciones que solo usted puede hacer, con los pasos exactos en la sección 5:
  - **Bloquean la carga en producción** de `VMI2571371`: **A** (servicio de Windows en la PC de la oficina) y **C** (corte del cable de internet).
  - **Se hacen con el piloto ya corriendo y bloquean sumar más IP o activar el portal**: **D** (prueba de carga) y **E** (revisión de siete días).
  - Además: **B** (cambio real de las 07:00 y las 22:00) se confirma dentro de E; **F** es opcional; **G** es su visto bueno.
- Antes de cargar `VMI2571371` en producción: léase «Cambios respecto al plan» y «Limitaciones conocidas», y dé su visto bueno.

Estados usados:

- **VERIFICADO**: se comprobó en el entorno local el 2026-11-24, con la evidencia indicada.
- **CUBIERTO POR PRUEBAS**: lo demuestra una prueba automática (no se reprodujo a mano).
- **PENDIENTE DEL USUARIO**: requiere la PC de la oficina o infraestructura real.
- **FUERA DE ESTA ENTREGA**: la spec lo asigna a una entrega posterior.

## 1. Pruebas automáticas (2026-11-24)

| Comprobación | Resultado |
|---|---|
| `packages/monitoring-core`: `npm ci` y `npx jest` | 5 suites, **64/64** pruebas OK |
| `packages/monitoring-core`: `MONITORING_CORE_KEEP_TZ=1 TZ=America/Lima npx jest` | 5 suites, **64/64** OK (el núcleo no depende de la zona horaria de la máquina) |
| `backend`: `npx jest` | 134 suites, **2673/2673** OK |
| `backend`: `node scripts/sync-monitoring-core.mjs --check` | código de salida 0 («Copia al día con la fuente») |
| `backend`: `npm run build` | OK |
| `desktop/engine`: `npx jest` | 5 suites, 43 OK y 1 omitida a propósito (solo corre fuera de Windows) |
| `desktop/engine`: `npm run build` | OK |
| `web`: `npm run build` | OK (solo el aviso habitual de tamaño de paquete) |

## 2. Criterios de aceptación

| # | Criterio de la spec | Estado | Evidencia |
|---|---|---|---|
| 1 | Tras reiniciar la PC y antes de iniciar sesión, la central recibe mediciones nuevas de la oficina; cerrar sesión no detiene el motor | **PENDIENTE DEL USUARIO** | Requiere instalar el servicio de Windows en la PC de la oficina (no se instaló). Lo que sí se verificó: el motor, ejecutado en primer plano, mide y envía a la central (llegaron filas de `oficina-01` a `monitor_checks`). Que `last_seen_at` avance se comprueba en el punto A. Pasos en la sección 5, punto A |
| 2 | El cambio de las 07:00 y las 22:00 cambia la frecuencia sin pruebas duplicadas | **CUBIERTO POR PRUEBAS** | `packages/monitoring-core/test/schedule.spec.ts`: «de día cada 5 min, de noche cada 1 min», «al cruzar las 22:00 pasa a la franja de 1 min sin saltarse la de las 22:00», «al cruzar las 07:00 pasa a la franja de 5 min». Sin duplicados al cambiar el horario: `desktop/engine/test/engine.spec.ts` («al sustituir el runner (cambia el horario) las pruebas de un servicio no se solapan entre el viejo y el nuevo»). En el entorno local se observó la franja diurna (cada 5 min, hora de Lima 08:xx) y que no hubo ninguna fila duplicada en `monitor_checks` (consulta de duplicados por sonda, servicio, tipo e inicio: 0). La frontera real de las 22:00 se verá sola en producción; ver punto E |
| 3a | Un fallo aislado queda en el historial sin incidente | **VERIFICADO** | Servicio «svc transitorio» (TCP). Se cerró su puerto unos 15 s desde las 13:15:20 UTC, cubriendo su prueba programada. Historial: la prueba `REGULAR` falló (`REFUSED`) en las dos sondas y el primer reintento (`RETRY`, unos 30 s después, hacia las 13:15:58) fue correcto en las dos. Señal `TRANSIENT_FAILURE` en ambas sondas. `monitor_incidents` para ese servicio: **0 filas**; no se creó ticket |
| 3b | Tres intentos fallidos abren un incidente y crean un ticket | **VERIFICADO** | Servicio «svc ctl» (criticidad ALTA): fallo a las 13:15:37, reintentos a las 13:16:07 y 13:16:37 → incidente 2 (tipo DOWN) confirmado a las 13:16:37 y **un** ticket `KB-0002`: origen `MONITOREO`, escalación `N1`, sin asignar (`assignee_user_id` NULL), prioridad **P1** (criticidad ALTA). El servicio de criticidad MEDIA («svc web https») dio prioridad **P2** |
| 3c | Una sola notificación al abrir | **CUBIERTO POR PRUEBAS** / parte de la Entrega 2 | En esta entrega, al abrir hay **un solo evento `CREATED` en el ticket** (verificado: 1 evento por ticket); **el aviso de Windows es de la Entrega 2** (widget) y aquí no se comprueba. El evento del ticket quedó con `notify_last_error: «El evento no genera ningún aviso»`: no se avisa al cliente por correo |
| 3d | La recuperación cierra el mismo incidente y emite un solo aviso | **VERIFICADO** (cierre y comentario; el aviso de Windows es de la Entrega 2) | Se reabrió el puerto de «svc ctl». Con dos pruebas correctas seguidas (13:20:37 y 13:25:37) se cerró el **mismo** incidente 2: `close_reason = RECOVERED`, `recovered_at = 13:25:39`, duración 10 min. En el ticket `KB-0002` apareció **un solo comentario** (evento `COMMENT`; el aviso de Windows es de la Entrega 2): «Servicio recuperado el 24 nov. 2026, 8:25 a. m. (hora de Perú). Duración de la caída: 10 min.». No se creó ticket nuevo (siguen 2 tickets) |
| 4a | Escenario: HTTPS caído con TCP operativo | **VERIFICADO** | «svc web https» (HTTPS a `https://127.0.0.1:34002`) y «svc tcp 34002» (TCP al mismo puerto), con un servidor que acepta TCP pero no habla TLS. Resultado: solo el servicio HTTPS tuvo incidente (id 1, DOWN, ticket `KB-0001`); el servicio TCP quedó `OK` en las dos sondas y sin incidente |
| 4b | Escenario: falla solo desde Perú (ROUTE) | **CUBIERTO POR PRUEBAS** + confirmación real pendiente | No se pudo reproducir en local: haría falta un destino alcanzable desde la sonda del servidor y no desde la oficina. Pruebas: `availability-evaluator.service.spec.ts` («ROUTE: la oficina confirma y el servidor responde; luego el servidor confirma → mismo incidente pasa a DOWN, sin ticket nuevo» y «cruce que no llega: a los 2 min se abre ROUTE con la información disponible») y `domain/diagnose.spec.ts` («oficina confirma y el cruce del servidor responde → ROUTE «Sin acceso desde Perú»»). Confirmación real: punto F |
| 4c | Escenario: caída del internet de la oficina (un aviso, sin tickets) | **CUBIERTO POR PRUEBAS** + cable pendiente | Detección: `packages/monitoring-core/test/office-outage.spec.ts` (cuatro casos). Registro en `monitor_office_outages` y ausencia de tickets: `availability-evaluator.service.spec.ts` (aviso con `affectedServices: 5`, cierre a los 10 min, sin tickets). El corte real con el cable no se hizo: punto C |
| 4d | Escenario: central detenida (la cola se vacía al volver) | **VERIFICADO** | Con el motor corriendo se detuvo el backend a las 13:29:31 UTC y se reinició a las 13:31:00. API local del motor durante el corte: `central.reachable: false`, `consecutiveFailures` 12 → 17, `pending` 2 → 4 (la cola crece). Registro del motor: `ERROR Sondeo fallido (3 seguidos): sync: fetch failed — la central no responde.` y, al volver, `INFO La central vuelve a responder.` (13:31:06). Un minuto después: `reachable: true`, `pending: 0`. `monitor_checks` de la oficina: 23 filas antes, 27 después, y 27 combinaciones distintas (sonda, servicio, tipo, inicio): **sin duplicados**. El widget como tal es de la Entrega 2; aquí se comprobó el estado que consumirá |
| 4e | Escenario: reinicio del backend con un incidente abierto | **VERIFICADO** | El mismo reinicio del punto 4d se hizo con el incidente 1 abierto: antes y después hay **2 incidentes, 2 tickets y 1 comentario**; el incidente 1 sigue abierto y con su ticket `KB-0001`. Además se reinició el **worker** (sonda del servidor) con el incidente 1 abierto: la sonda volvió a confirmar el fallo (señal `CONFIRMED_FAILURE` id 16 a las 13:41:14) y el sistema no creó incidente ni ticket nuevos (siguen 2 y 2) |
| 4f | Escenario: informe de un mes en que el worker no corrió el día 1 | **FUERA DE ESTA ENTREGA** | El informe de disponibilidad mensual es de la Entrega 3. En esta entrega solo se guarda el dato base (`monitor_checks`) |
| 5a | Un ticket automático no aparece en la lista ni en el detalle del portal del cliente | **VERIFICADO** (consulta) + **CUBIERTO POR PRUEBAS** | No se probó con un usuario de cliente real (no hay acceso al portal en este entorno de prueba). Consulta equivalente a la del portal (`WHERE client_id = 1 AND origin NOT IN ('MONITOREO')`): personal ve **2** tickets del cliente, el portal **0**. El portal pide `excludeInternal: true` (`portal-tickets.service.ts`). Pruebas: `portal-tickets.service.spec.ts` («el listado pide excluir los tickets internos» y «el detalle de un ticket MONITOREO del propio cliente responde NOT_FOUND»), `ticket-messages/actor-scope.spec.ts` (invisible para el cliente, visible para el personal), `tickets.repository.spec.ts` |
| 5b | No cuenta en el SLA de su informe; el personal sí lo ve | **CUBIERTO POR PRUEBAS** | `tickets.repository.ts`: las consultas del informe del cliente (`listForClientPeriod` y la de resueltos) excluyen `INTERNAL_TICKET_ORIGINS`. Prueba: `tickets.repository.spec.ts`. El informe en sí es de la Entrega 3. El personal sí ve ambos tickets (ver 5a) |
| 5c | Sin avisos al cliente por ese ticket | **CUBIERTO POR PRUEBAS** | `notification-rules.spec.ts`: «un ticket MONITOREO nunca produce aviso al cliente, con cualquier tipo, estado o autor». Observado: evento `CREATED` con «El evento no genera ningún aviso» |
| 6 | Con dos clientes, cada informe contiene solo lo del cliente seleccionado | **FUERA DE ESTA ENTREGA** | Informe: Entrega 3. En esta entrega las pantallas del personal filtran por cliente (`GET /availability/state`, `/incidents`) y están cubiertas por `availability-state.service.spec.ts` |
| 7 | Prueba de carga: 50 servicios con las dos sondas cumplen 1 min sin retraso cuando 10 destinos dejan de responder a la vez | **PENDIENTE DEL USUARIO** | Requiere infraestructura real. Punto D |
| 8 | Siete días de datos reales: revisar juntos falsos avisos, latencia habitual, carga y formato del informe antes de sumar más IP y antes de activar el portal | **PENDIENTE DEL USUARIO** | Solo se puede hacer con el piloto corriendo una semana. Punto E |

## 3. Cambios respecto al plan

1. **La evaluación y la limpieza se movieron al backend; el worker solo mide.**
   - Plan original: el worker evaluaba las señales, abría incidentes y tickets y purgaba datos antiguos.
   - Ahora: el backend (proceso único, con protección contra ejecuciones solapadas) evalúa y purga. El worker `kubo-01` solo mide y envía; las comprobaciones cruzadas de `kubo-01` también pasan por órdenes en la base de datos (`monitor_probe_orders`, tipo `CROSS`), igual que la oficina.
   - Por qué: si el worker cargaba el módulo de tickets pasaba a ser un segundo consumidor de la cola de transcripciones (sin la carpeta de audios ni Whisper, con riesgo de transcripciones que fallan al azar) y un segundo ejecutor de las tareas programadas de retención de audio y riesgo de SLA. Además, evaluando en el backend los tickets automáticos generan sus notificaciones en vivo.
   - Costo: durante un despliegue del backend la evaluación se detiene unos segundos. Las mediciones no se pierden: el worker y el motor siguen midiendo y las señales esperan en la base de datos hasta que el backend vuelve (se vio en la prueba 4d/4e).
2. **Los tickets automáticos son siempre internos** (decisión del 2026-11-23). Usan el origen `MONITOREO`, que `main` ya trata como interno: nunca salen en el portal, en el hilo, en el informe del cliente ni generan avisos al cliente. No se modificó esa regla.
3. **Migración 031** (`backend/sql/migrations/031_disponibilidad_nucleo.sql`): crea las tablas `monitor_*` (sondas, servidores, servicios, mediciones, señales, órdenes, incidentes, eventos, cortes de oficina). Incluye un índice sobre `monitor_checks.started_at` para que la limpieza de 90 días sea rápida y otro sobre `(probe_id, order_id)` para encontrar el resultado de un cruce. Si una base ya tenía una versión anterior de la 031, volver a aplicarla añade lo que falte (índices, el valor `STATE_SYNC` y la columna `monitor_probe_states.state_changed_at`) sin tocar datos. **Debe aplicarse antes de desplegar.** El flujo de despliegue ya la lista.
4. **Nombres definitivos.**
   - Módulo del backend: `backend/src/modules/availability` (no `monitoring`, que ya existía para los errores de la aplicación).
   - Ingesta (sondas): `POST /api/v1/ingest/probe/batch` y `GET /api/v1/ingest/probe/sync`, con token de sonda `kmp_…`.
   - API del personal: `/api/v1/availability/…` (`servers`, `services`, `services/test`, `probes`, `probes/:id/token`, `state`, `state.csv`, `services/:id/check-now`, `incidents`, `incidents/:id`, `incidents/:id/ack`, `incidents/:id/notes`).
   - Pantallas web: `web/src/pages/availability`.
   - Worker: `backend/src/monitoring-worker.ts` (`node dist/monitoring-worker.js`), servicio `monitor-worker` en los compose.
   - Motor de la oficina: `desktop/engine`.
5. **Comportamiento observado que conviene conocer** (según el diseño, no es un fallo): de día (07:00 a 22:00, hora de Lima) cada servicio se prueba cada **5 min**; de noche, cada 1 min. Un servicio caído se da por recuperado tras **dos** pruebas correctas seguidas, es decir unos 10 min de día y 2 min de noche. El incidente de «svc ctl» duró 10 min por eso.
6. **Ronda final de correcciones (revisión de toda la rama).**
   - **Reinicios de sonda.** Antes, si una sonda (la oficina o `kubo-01`, que se reinicia en cada despliegue) se reiniciaba con un servicio caído, degradado o en verificación, o con una caída de oficina abierta, y la situación se resolvía mientras estaba parada, la central nunca se enteraba: el incidente y su ticket, la degradación o la caída de oficina quedaban abiertos para siempre (y con la caída abierta se ignoraban todos los fallos de la oficina). Ahora: (a) la sonda recién arrancada se resincroniza — por cada servicio sano envía la señal `STATE_SYNC` tras dos pruebas correctas seguidas, y la primera franja juzgada envía siempre «caída de oficina sí/no»; vale también cuando el motor cambia de horario; (b) como red de seguridad, la central reconcilia cada 5 s: un estado de sonda FAILED/VERIFYING/DEGRADED sin señales pendientes cuyas dos pruebas más recientes, recibidas después, son correctas pasa a OK y se cierra lo que corresponda; una caída de oficina se cierra cuando las pruebas posteriores ya no cumplen la regla de caída.
   - Una señal que falla 5 veces seguidas al procesarse (por ejemplo, de un servicio que ya no existe) se descarta con un error en el registro en vez de bloquear las siguientes de su servicio.
   - Si el sistema de tickets falla (no por un dato inválido), el reintento espera cada vez más (10 s, 20 s, 40 s… hasta 10 min) en vez de intentarlo cada 5 s.
   - Los lotes de las sondas ya no se guardan en `audit_log`. El token solo se puede emitir para `oficina-01`. Los servidores ya no devuelven la huella del token del agente. El motor exige `https` para la central (`http` solo hacia la propia máquina).
   - CI prueba y compila también el núcleo y el motor; el despliegue falla si `monitor-worker` no arranca («Sonda kubo-01 iniciada»). En desarrollo el worker va en el perfil `monitoreo`.

## 4. Limitaciones conocidas

Las que afectan al uso del piloto:

- **Evaluación en pausa durante despliegues del backend.** Ver «Cambios» punto 1.
- **Después de un corte largo, el estado puede parecer «actual» con datos viejos.** Cuando el motor de la oficina vuelve tras un corte y vacía su cola, la central muestra resultados pasados como si fueran presentes, y el desfase de reloj (`clock_skew_ms`) refleja la antigüedad de la cola, hasta el primer lote fresco más un intervalo. No se arregló (requeriría marcar los lotes atrasados). El desfase mostrado incluye hasta unos 15 s del sondeo; en la pantalla de Sondas debe leerse «aprox.».
- **Mensajes del motor rechazados por la central** (formato incompatible) se guardan solo en una tabla local (`dead_letter`) y en el registro; nada los reporta a la central ni al widget todavía. Si la central rechaza todo, el motor abre un corte de seguridad tras 3 elementos; ese contador está solo en memoria (un reinicio lo rearma).
- **El widget (Entrega 2) debe leer `central.rejecting` además de `central.reachable`** para distinguir «central caída» de «central rechaza mis datos».
- **Servicio de Windows sin probar en la PC real.** La cuenta `LocalService`, los permisos de la carpeta, el arranque sin iniciar sesión y la parada con WinSW solo se pueden comprobar en la oficina (punto A). El tamaño de los registros de WinSW tampoco está comprobado.
- **El motor exige Node 20 LTS de 64 bits instalado para todo el equipo.** El desarrollo y estas pruebas usaron Node 24 local; la imagen del backend usa Node 20.
- **Un ROUTE que ocurre justo antes de un corte de internet de la oficina puede perderse** (el aviso mira 5 min hacia atrás).
- **Diagnóstico «problema de la sonda del servidor»** solo se escribe en el registro, no en una tabla; llegará con la «Vigilancia de sondas» (Entrega 2).
- **Pantalla de Servicios:** el puerto no se puede borrar al editar (solo cambiar), los campos opcionales (rol, proveedor, región) tampoco se pueden vaciar y no hay «desarchivar».
- **`monitor_probe_orders` no se purga** (crece muy despacio). Tras reiniciar el worker, las órdenes de cruce pendientes de menos de 2 min se ejecutan de golpe; las más viejas se descartan sin medir.
- **Cualquier proceso que cargue el backend completo contra la misma base de datos** (por ejemplo un entorno de desarrollo apuntando a producción) ejecuta también el evaluador. No apuntar entornos de desarrollo a la base de producción.
- **Tras una desconexión larga de la oficina, puede abrirse un ROUTE breve con ticket.** Cuando la cola atrasada llega, un fallo confirmado de entonces pide el cruce a `kubo-01` ahora, no en su momento; si el servicio estuvo caído y ya volvió, el cruce responde bien y la central lo diagnostica como ROUTE («Sin acceso desde Perú»), que se cierra enseguida con la recuperación que viene detrás en la misma cola. No se corrigió en esta entrega.
- **ICMP desde el worker**: la imagen del backend es Alpine y el worker no corre como root; hay que comprobar una vez en producción que un servicio ICMP responde desde `kubo-01` (si no, usar TCP para ese destino).
- **Un ADMIN puede dar de alta como destino un nombre interno de Docker** (por ejemplo `mysql` o `backend`): el worker lo alcanzaría desde dentro de la red de los contenedores. No hay filtro todavía; solo el personal ADMIN puede dar de alta servicios.
- **El `README` del motor** hace escribir el token con `Read-Host` y el token se ve en pantalla al pegarlo. Hacerlo en una consola que nadie más vea.

## 5. Pendiente del usuario (pasos exactos)

Mientras no se hagan **A y C**, no se debe cargar `VMI2571371` en producción. **D y E** se hacen con el piloto ya corriendo y deben estar hechos antes de sumar más IP o activar el portal. **B** se confirma dentro de E, **F** es opcional y **G** es su visto bueno.

### A. Servicio de Windows en la PC de la oficina y reinicio sin iniciar sesión (criterio 1)

Conviene hacerlo **con un desarrollador al lado** (o por llamada): hay que compilar, copiar carpetas y ejecutar un instalador como administrador, y si algo falla hay que leer los registros.

1. Instale **Node 20 LTS de 64 bits para todo el equipo** (instalador oficial; debe quedar `C:\Program Files\nodejs\node.exe`). No sirve nvm ni un Node dentro de `C:\Users\…`.
2. Compile con Node 20 (`cd packages\monitoring-core; npm install; npm run build`, luego `cd ..\..\desktop\engine; npm install; npm run build`) y copie la carpeta `desktop\engine` ya compilada (con `node_modules` y `dist`) a `C:\Program Files\KUBO\engine`.
3. En la web, entre como ADMIN a **Monitoreo → Sondas → oficina-01 → Emitir token**. Copie el token `kmp_…` (se muestra una sola vez; emitir otro revoca el anterior).
4. Abra PowerShell **como administrador** y ejecute (cambie `OFICINA\ana` por el usuario de escritorio de la PC):

   ```powershell
   cd "C:\Program Files\KUBO\engine"
   Read-Host "Token kmp_" | node dist\service\install.js --user OFICINA\ana --central https://docs.kuboti.com --token-stdin
   ```

   Antes, si quiere ver qué haría sin tocar nada, añada `--dry-run`.
5. Compruebe que el servicio `KuboMonitorEngine` existe, está en inicio **Automático** y corre como `NT AUTHORITY\LocalService` (`services.msc`).
6. **Reinicie la PC y NO inicie sesión.** Espere 2 a 3 minutos.
7. Desde otra computadora, entre a la web y revise **Monitoreo → Sondas → oficina-01**: la columna «Última conexión» (`last_seen_at`) debe ser de hace menos de 1 minuto. También puede ejecutar en la base de datos: `SELECT code, last_seen_at, version FROM monitor_probes WHERE code='oficina-01';`
8. Inicie sesión, ciérrela y vuelva a mirar `last_seen_at`: debe seguir avanzando (cerrar sesión no detiene el motor).
9. Si algo falla, los registros están en `C:\ProgramData\KUBO\Monitor\logs\`.

### B. 07:00 y 22:00 reales (criterio 2)

Con el piloto corriendo, después de las 22:00 y de las 07:00 (hora de Lima) ejecute en la base de datos estas consultas. Las fechas de `monitor_checks` están en UTC y Lima es UTC-5: las 22:00 de Lima del 25 de noviembre son las **03:00 UTC del 26**, y las 07:00 de Lima del 26 son las **12:00 UTC del 26**. El ejemplo usa el servicio con id **1** y esas fechas; cámbielos por los reales.

```sql
-- Cambio de las 22:00 (Lima) del 25/11: de 5 min a 1 min
SELECT probe_id, service_id, kind, started_at FROM monitor_checks
WHERE service_id = 1 AND kind = 'REGULAR'
  AND started_at BETWEEN '2026-11-26 02:40:00' AND '2026-11-26 03:10:00'
ORDER BY probe_id, started_at;

-- Cambio de las 07:00 (Lima) del 26/11: de 1 min a 5 min
SELECT probe_id, service_id, kind, started_at FROM monitor_checks
WHERE service_id = 1 AND kind = 'REGULAR'
  AND started_at BETWEEN '2026-11-26 11:50:00' AND '2026-11-26 12:20:00'
ORDER BY probe_id, started_at;
```

En la primera, por cada sonda (`probe_id`): una fila cada 5 min hasta las 03:00 UTC y una por minuto desde las 03:00 UTC, sin dos filas en el mismo minuto. En la segunda, al revés: una por minuto hasta las 12:00 UTC y una cada 5 min desde las 12:00 UTC. Si el servicio falló en ese rato verá además filas `RETRY` (por eso se filtra `kind = 'REGULAR'`).

### C. Corte de internet de la oficina (criterio 4c)

1. Con el motor funcionando y varios servicios en estado OK, **desconecte el cable de internet de la PC de la oficina** (o el del router) durante unos 5 a 10 minutos.
2. Vuelva a conectarlo.
3. Compruebe en la base de datos: `SELECT * FROM monitor_office_outages ORDER BY id DESC LIMIT 3;` debe haber **una** fila nueva, con `started_at` y `ended_at`, y `affected_services` mayor que 0.
4. Compruebe que **no se creó ningún ticket nuevo** de monitoreo: `SELECT id, code, subject, created_at FROM tickets WHERE origin='MONITOREO' ORDER BY id DESC LIMIT 5;`.
5. Compruebe que el motor vació su cola al volver (`pending` en 0 en la API local) y que no hay filas duplicadas en `monitor_checks`.

### D. Prueba de carga con infraestructura real (criterio 7)

1. En un entorno de pruebas (no producción), dé de alta 50 servicios con las dos sondas activas. Hágalo **de noche (entre las 22:00 y las 07:00 de Lima)**: es cuando cada servicio se prueba **cada minuto** (de día es cada 5 min y la prueba no exigiría nada).
2. Haga que 10 de esos destinos dejen de responder a la vez (por ejemplo, con una regla de firewall que los bloquee).
3. Deje pasar **15 minutos** y ejecute:

   ```sql
   SELECT probe_id, service_id, COUNT(DISTINCT cycle_at) AS franjas
   FROM monitor_checks
   WHERE started_at > UTC_TIMESTAMP() - INTERVAL 15 MINUTE AND kind IN ('REGULAR', 'RETRY')
   GROUP BY probe_id, service_id
   ORDER BY franjas;
   ```

   Cada fila (servicio y sonda) debe dar **unas 15 franjas** (una por minuto; 14 si la ventana corta una). Se cuentan también los `RETRY` porque en los 10 destinos caídos un reintento puede ocupar el lugar de la prueba regular de ese minuto. Ninguna fila debe quedar claramente por debajo, y la columna de desfase de la pantalla de Sondas no debe ir creciendo.

### E. Revisión de siete días (criterio 8)

Con el piloto corriendo una semana, revisar juntos: falsos avisos (incidentes cerrados en menos de 5 min), latencia habitual por servicio, carga (CPU y memoria del backend, del worker y del motor) y, cuando exista, el formato del informe. Solo después sumar más IP y activar el portal para un cliente. Esta semana incluye una noche y una mañana reales, así que también sirve para confirmar el punto B.

### F. ROUTE real (criterio 4b), opcional pero recomendable

En la PC de la oficina cree una regla de firewall de **salida** que bloquee un destino de prueba que la sonda del servidor sí alcanza. En 3 a 5 minutos debe abrirse un incidente de tipo ROUTE («Sin acceso desde Perú»). Quite la regla: debe cerrarse solo.

### G. Visto bueno antes de producción

La carga de `VMI2571371` en producción solo debe hacerse con su visto bueno, después de revisar este documento. Recuerde aplicar la migración 031 y desplegar tanto el backend como el nuevo servicio `monitor-worker`.

## 6. Cómo se hizo la prueba local (para repetirla)

- Contenedores desechables `kubo-mon-t14-mysql` (puerto 33071, MySQL 8.0 con el esquema, las migraciones 001 a 031 y las semillas) y `kubo-mon-t14-redis` (63801). Ambos detenidos al terminar. No se tocó ningún otro contenedor.
- Backend `node dist/main.js` (puerto 3921), worker `node dist/monitoring-worker.js` y motor `node dist/main.js` en primer plano (carpeta de datos temporal con `KUBO_MONITOR_HOME`). Variables de entorno solo en la consola, sin archivos `.env`. El hash del token de la sonda de oficina se escribió por SQL.
- Datos: un cliente, un servidor y cuatro servicios hacia puertos locales controlables (TCP `34001`, HTTPS `34002`, TCP `34002`, TCP `34003`).
- Todos los procesos y contenedores se detuvieron al terminar.

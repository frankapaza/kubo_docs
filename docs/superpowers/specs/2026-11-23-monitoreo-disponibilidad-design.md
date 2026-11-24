# Monitoreo de disponibilidad — Diseño

**Fecha:** 2026-11-23
**Estado:** aprobado (2026-11-23)
**Alcance:** piloto con Contacto Eficaz. Es el «vigilante de disponibilidad» que `2026-10-28-el-sistema-como-columna-design.md` dejó fuera de alcance a propósito.
**Prototipo de referencia:** [`prototipos/2026-11-23-monitoreo-v2.html`](prototipos/2026-11-23-monitoreo-v2.html) (pantallas, widget y notificaciones; datos de ejemplo). Se abre directo en el navegador.

## Problema

La casa arrienda software que corre en VPS de sus clientes (Contabo, Windows con IIS). Hoy se entera de una caída cuando el cliente escribe un ticket. No hay forma de saber:

- si un servicio dejó de responder **antes** de que el cliente lo note;
- si el problema es **el servidor**, **la ruta desde Perú** (proveedor de internet, tránsito internacional, borde de Cloudflare) o **el internet de la oficina** desde donde se mide;
- cuánto estuvo caído un sistema en el mes, con evidencia que soporte el informe al cliente;
- si un servidor se está quedando sin disco o sin memoria antes de que eso lo tumbe.

Se quiere vigilar los servicios de cada cliente desde dos puntos, abrir el ticket de soporte solo cuando una caída se confirma, avisar en la PC de la oficina únicamente de lo crítico y producir un informe mensual de disponibilidad por cliente que más adelante el cliente pueda ver en el portal.

## Decisiones ya tomadas

Acordadas con el responsable antes de escribir este documento; no se reabren.

1. **La central vive en kubo_documentacion**, en el VPS de KUBO en Contabo (`docs.kuboti.com`). No es una aplicación aparte.
2. **La sonda de Perú es una PC de la oficina encendida siempre.** No habrá VPS en Perú.
3. **Dos sondas por servicio:** la de la oficina (lo que vive un usuario en Perú) y la del servidor de KUBO (si el servicio está vivo). El diagnóstico sale de cruzarlas.
4. **En la PC de la oficina hay un widget de escritorio** pequeño y siempre visible que informa continuamente, y **notificaciones nativas de Windows solo para lo crítico**.
5. **Un agente en cada servidor vigilado** reporta disco, CPU, memoria, IIS, servicios de Windows y errores del Visor de eventos. Los VPS de Contacto Eficaz son del cliente: instalar el agente requiere su autorización por escrito.
6. **El portal del cliente muestra la disponibilidad solo después de validar los datos.** Durante el piloto la ve únicamente el personal. **Lo mismo vale para los tickets automáticos:** mientras el cliente no tenga activada la disponibilidad, los tickets que crea el monitoreo no aparecen en su portal ni cuentan en el SLA de su informe mensual (cómo se aplica: decisión 21).
7. **Piloto con Contacto Eficaz.** Primero `VMI2571371`; `VMI2429301` queda pendiente hasta tener su IP.
8. **Valores iniciales configurables**, tomados del documento de requisitos original:
   - cada 5 min de 07:00 a 22:00 y cada 1 min de 22:00 a 07:00, hora de Lima;
   - reintentos a +30 s y +60 s del primer intento; los tres fallidos confirman;
   - 3 ciclos regulares lentos seguidos = degradación; 2 comprobaciones correctas seguidas = recuperación;
   - 90 días de comprobaciones detalladas, 12 meses de resúmenes e informes.

## Decisiones que se toman aquí

Las tomo yo y quedan registradas para poder revertirlas.

9. **Node/TypeScript para la sonda de oficina y el worker**, con el **mismo código de pruebas** en un paquete compartido (`monitoring-core`, ver «Estructura del código»). Que las dos sondas ejecuten exactamente la misma prueba TCP/HTTPS es lo que hace comparables sus resultados. *Coste si me equivoco:* el servicio de Windows en Node es menos «nativo» que uno en .NET (se instala con un envoltorio de servicio).
10. **El widget es Electron** (TypeScript + React), con los mismos colores y estilos que la web. *Coste:* ~100–150 MB de memoria en una sola PC.
11. **El agente de servidor es .NET 8, un único ejecutable autocontenido.** Lee contadores de rendimiento, IIS (`Microsoft.Web.Administration`) y el Visor de eventos de forma nativa y no obliga a instalar Node en servidores del cliente. *Coste:* un segundo lenguaje, limitado a una pieza pequeña.
12. **Las pruebas de la central corren en un contenedor aparte, `monitor-worker`**: mismo código del backend, otro punto de entrada. Un despliegue o una caída del backend (límite de 1 GB) no detiene el monitoreo.
13. **El servicio vigilado cuelga del sistema.** `monitor_services.system_id` apunta a `client_systems`; el servidor cuelga del cliente. Así el ticket automático nace con `system_id` y el informe puede agrupar por sistema, como pide «el sistema como columna». Si el servicio no tiene sistema asignado, el ticket nace sin sistema (no se inventa uno).
14. **Ticket automático para toda caída confirmada.** Abre un ticket `INCIDENCIA` con origen `MONITOREO` (valor nuevo del enum `origin`, con su migración) y prioridad por criticidad (Alta → P1, Media → P2, Baja → P3). Se crea con `escalation_level = 'N1'` y **sin asignado**: la asignación la confirma siempre una persona («Regla 01» de `TicketAssignmentService`), y el monitoreo no la salta. La recuperación agrega un evento al ticket **pero no lo cierra**: el agente documenta la causa. Las degradaciones **no** abren ticket. *Coste:* si hay muchos servicios inestables, la mesa recibe muchos tickets; lo mitigan las decisiones 15 y 19.
15. **Un servicio que vuelve a caer antes de 30 min de recuperado reabre el mismo incidente** y el mismo ticket, en vez de crear otros. Evita la ráfaga de tickets cuando un servicio parpadea. Si el agente ya pasó el ticket a `RESUELTO`, el monitoreo lo reabre **por la máquina de estados** (evento de reapertura), nunca escribiendo el estado a mano. Si ya está `CERRADO` (o la transición no está permitida), se crea un ticket nuevo que menciona el anterior.
16. **La sonda de oficina empuja, nunca recibe conexiones.** Envía sus resultados por HTTPS saliente a la central, pide su configuración y sus órdenes («probar ahora», «comprobación cruzada») en cada sondeo, y guarda en un SQLite local lo que no pudo enviar.
17. **El widget habla solo con el motor local**, por `127.0.0.1`. El motor junta lo que mide la oficina con el estado que trae de la central. Así el widget sigue funcionando cuando la central no responde.
18. **La disponibilidad se calcula a partir de los incidentes**, no del porcentaje de comprobaciones exitosas. La fórmula está en «Disponibilidad mensual».
19. **Una caída de servidor es un solo ticket y una sola notificación.** Si dos o más servicios del mismo servidor confirman fallo dentro de una ventana de 3 minutos, se agrupan en un **incidente de servidor** (`monitor_incidents.parent_id` apunta a él; los incidentes de cada servicio cuelgan de él y conservan su propia cronología y duración para el informe). El ticket y la notificación se emiten sobre el incidente de servidor, con la prioridad del servicio más crítico afectado. El widget muestra una fila por servidor que se despliega en sus servicios. Un servicio que cae después de abierto el incidente de servidor se suma a él. *Coste:* dos fallos independientes casi simultáneos en el mismo servidor quedan en un mismo ticket; el agente puede separarlos.
20. **El ticket no gobierna el incidente.** Si el agente resuelve el ticket mientras el servicio sigue sin responder, el incidente sigue abierto: el incidente es un hecho medido y solo lo cierran las comprobaciones. Al recuperarse, se agrega el evento al ticket aunque esté resuelto.
21. **Los tickets automáticos quedan ocultos al cliente hasta activar el portal** (aplica la decisión 6). La regla es una sola y vive en un único lugar del módulo de tickets: un ticket con `origin = 'MONITOREO'` es visible para el cliente solo si `monitor_client_settings.portal_availability_visible` es verdadero para su cliente. La aplican:
    - la lista del portal (`PortalTicketsService.list`);
    - el detalle del portal (`PortalTicketsService.detail`): un ticket oculto responde igual que uno inexistente (404), sin revelar que existe;
    - el informe mensual del portal (`PortalReportsService.monthly`): ni la lista de tickets (`listForClientPeriod`) ni el conteo de resueltos (`countResolvedInPeriod`) lo incluyen, así que no cuenta para el SLA del cliente;
    - cualquier otra lectura de tickets hecha con identidad de cliente que exista al construir (el constructor la busca y la cubre).

    El personal ve siempre todos los tickets; su vista y sus informes no cambian. El cliente tampoco recibe correo por estos tickets: `plansForEvent` solo avisa al cliente cuando el autor es un usuario del cliente, y el monitoreo no lo es (se confirma con una prueba). Al activar el portal pasan a verse los tickets automáticos, **también los anteriores a la activación**; si se prefiere que solo cuenten desde la fecha de activación, es un cambio pequeño posterior. Cada punto lleva su prueba: con el portal desactivado el cliente no ve el ticket ni le cuenta en el SLA; activado, sí; el personal, siempre. *Coste:* se toca el módulo de tickets existente y sus pruebas.

## Fuera de alcance

- **Alertas al celular** (WhatsApp, Telegram, push). Fase posterior.
- **Una tercera sonda en Perú fuera de la oficina.** Descartada por la decisión 2.
- **Aviso de vencimiento de certificados HTTPS.** Se puede derivar después de la prueba HTTPS existente.
- **Mantenimientos recurrentes.** En el piloto cada ventana se crea a mano.
- **Agente para servidores Linux.** Los servidores vigilados son Windows.
- **Acciones automáticas sobre el servidor** (reiniciar IIS, liberar disco). Solo se observa.
- **El informe agrupado por sistema** del portal. Este diseño deja el dato preparado (decisión 13); la agrupación en el informe es otro cambio.

## Arquitectura

```
 PC oficina (Lima)                         VPS KUBO · Contabo · docs.kuboti.com
┌───────────────────────────┐   HTTPS    ┌─────────────────────────────────────────┐
│ Motor (servicio Windows)  │──────────▶ │ backend (NestJS) · módulo monitoring    │
│  · pruebas TCP/HTTPS/ICMP │  saliente  │  · ingesta de sonda y de agente          │
│  · reintentos 30/60 s     │ ◀───────── │  · estado combinado, incidentes, tickets │
│  · SQLite: cola de envío  │  config,   │  · informes, UI del personal y portal    │
│  · API local 127.0.0.1    │  órdenes,  ├─────────────────────────────────────────┤
├───────────────────────────┤  estado    │ monitor-worker (mismo código)           │
│ Widget (Electron)         │            │  · pruebas desde el servidor            │
│  · siempre visible        │            │  · evaluación, purga, resúmenes diarios │
│  · notificaciones Windows │            ├─────────────────────────────────────────┤
└───────────────────────────┘            │ MySQL · Redis                           │
                                         └─────────────────────────────────────────┘
                                                     ▲ HTTPS saliente
 Servidores del cliente (Windows + IIS)              │
┌───────────────────────────┐                        │
│ Agente .NET (servicio)    │────────────────────────┘
│  · CPU, RAM, discos, IIS  │
└───────────────────────────┘
```

Todas las conexiones son salientes desde la oficina y desde los servidores del cliente. No se abre ningún puerto en la oficina ni en el firewall del cliente.

## Estructura del código

- `backend/src/modules/monitoring/`: entidades, API del personal, ingesta, evaluación, informe.
- `backend/src/monitoring-worker.ts`: punto de entrada del contenedor `monitor-worker` (contexto de aplicación Nest sin HTTP).
- `packages/monitoring-core/`: las pruebas (TCP, HTTPS, ICMP), el planificador de ciclos en hora de Lima y la lógica pura de confirmación y degradación. Sin base de datos ni red propia, probado con entradas y salidas. Lo usan el worker y el motor de oficina.
- `desktop/engine/`: el motor de la oficina (Node, servicio de Windows).
- `desktop/widget/`: el widget (Electron).
- `agent/`: el agente .NET.
- `web/src/pages/monitoring/`: las pantallas del personal, en una sección «Monitoreo» de la barra lateral.

Cómo se empaqueta `monitoring-core` para que lo consuman el backend y el motor (workspace de npm o copia en el build) queda al constructor.

## Modelo de datos

Migraciones numeradas desde `029_`, con el mismo cuidado que las anteriores: índices protegidos con el chequeo contra `information_schema.STATISTICS` y aplicación manual antes del despliegue (ver `deploy.sh`). Todos los instantes se guardan en UTC.

| Tabla | Para qué | Campos clave |
|---|---|---|
| `monitor_servers` | Servidor vigilado | `client_id`, `name`, `host` (IP o nombre), `role`, `provider`, `region`, `status` (`ACTIVE`/`PAUSED`/`ARCHIVED`), `agent_token_hash`, `agent_last_seen_at` |
| `monitor_services` | Lo que se prueba | `server_id`, `system_id` (nulo permitido), `name`, `protocol` (`TCP`/`HTTPS`/`ICMP`), `target`, `port`, `latency_threshold_ms`, `criticality` (`HIGH`/`MEDIUM`/`LOW`), `schedule_override` (nulo = hereda), `status` |
| `monitor_probes` | Puntos de medición | `code` (`oficina-01`, `kubo-01`), `kind` (`OFFICE`/`DATACENTER`), `token_hash`, `last_seen_at`, `version` |
| `monitor_checks` | Cada intento | `id` (UUID generado por la sonda), `service_id`, `probe_id`, `kind` (`REGULAR`/`RETRY`/`MANUAL`/`CROSS`), `cycle_at` (franja programada), `started_at`, `duration_ms`, `ok`, `error_code`, `http_status`. Único por `(probe_id, id)` para que los reenvíos sean idempotentes |
| `monitor_incidents` | Caídas y degradaciones | `service_id` (nulo en el incidente de servidor), `server_id`, `parent_id` (decisión 19), `kind` (`DOWN`/`ROUTE`/`DEGRADED`), `first_failure_at`, `confirmed_at`, `recovered_at`, `ticket_id`, `acknowledged_by/at` |
| `monitor_incident_events` | Cronología | `incident_id`, `at`, `type`, `detail` |
| `monitor_office_outages` | Internet de oficina caído | `probe_id`, `started_at`, `ended_at`, `affected_services` |
| `monitor_maintenance` | Ventanas programadas | `server_id` o `service_id`, `starts_at`, `ends_at`, `reason`, `created_by` |
| `monitor_evidence` | Trazas WinMTR | `incident_id`, `captured_at`, `origin`, `notes`, archivo vía el módulo de almacenamiento existente |
| `monitor_daily_rollups` | Resúmenes para el informe | `service_id`, `probe_id`, `date` (Lima), `expected`, `executed`, `succeeded`, `p50_ms`, `p95_ms`, `down_minutes`, `route_minutes`, `no_data_minutes` |
| `monitor_agent_samples` | Recursos del servidor | `server_id`, `at`, `cpu_pct`, `ram_pct`, `disks` (JSON), `iis` (JSON), `services` (JSON), `event_errors` |
| `monitor_client_settings` | Opciones por cliente | `client_id`, `portal_availability_visible` (por defecto `false`) |

Retención: `monitor_checks` 90 días; `monitor_agent_samples` 30 días; `monitor_daily_rollups`, incidentes e informes 12 meses. La purga corre de noche en el worker, por lotes.

Volumen esperado: 50 servicios × 2 sondas × hasta 1 prueba/min ≈ 100 mil filas al día en `monitor_checks`, unos 9 millones en 90 días. Índice principal `(service_id, probe_id, started_at)`.

## Cómo se mide

### Planificación

- El ciclo de cada servicio depende de la hora de Lima: franjas de 5 min de día y de 1 min de noche. Al cruzar las 07:00 o las 22:00 se pasa a la franja nueva sin repetir la prueba en curso. Se usan los utilitarios `common/time-zone.ts` y `common/peru-*`.
- Cada servicio tiene un desfase fijo dentro de la franja (derivado de su id) para que no salgan todas las pruebas a la vez.
- Un solo ciclo activo por servicio y sonda. Si un reintento coincide con la franja siguiente, la prueba regular de esa franja se omite y el reintento queda marcado como tal: **nunca hay dos pruebas simultáneas del mismo servicio desde la misma sonda**.
- Concurrencia máxima configurable (16 por defecto) y tiempos de espera por protocolo (TCP 5 s, HTTPS 10 s).

### Las pruebas

- **TCP:** abre la conexión al puerto y la cierra. Éxito si acepta.
- **HTTPS:** `GET` liviano a la URL configurada, **con validación TLS**. Éxito si responde 2xx o 3xx dentro del tiempo de espera. Se guarda el código HTTP.
- **ICMP:** opcional, solo diagnóstico. Nunca abre incidente por sí solo.
- **Referencias de la oficina:** en cada ciclo el motor prueba dos destinos externos (por defecto 1.1.1.1 y 8.8.8.8) para saber si la oficina tiene internet.

### Confirmación (en cada sonda)

1. Falla la prueba regular → el servicio pasa a **Verificando** en esa sonda.
2. Reintentos a +30 s y +60 s del primer intento.
3. Si los tres fallan, la sonda informa un **fallo confirmado** con la hora del primer fallo y la de confirmación.
4. Si un reintento responde, queda como **fallo transitorio**: se guarda en el historial, sin incidente ni aviso.

### Cruce de sondas (en la central)

Cuando una sonda confirma un fallo, la central pide de inmediato una **comprobación cruzada** a la otra:

- al worker, directamente;
- a la oficina, como orden que el motor recoge en su próximo sondeo (cada 15 s).

| Oficina | Servidor KUBO | Resultado |
|---|---|---|
| fallo confirmado | falla | Incidente **DOWN** («Sin respuesta confirmada») |
| fallo confirmado | responde | Incidente **ROUTE** («Sin acceso desde Perú») |
| sin datos (oficina sin internet) | fallo confirmado | Incidente **DOWN** |
| responde | fallo confirmado | **No es incidente.** Se registra como problema de la sonda del servidor |
| internet de oficina caído | — | **Caída de oficina**, sin incidentes por servicio |

- Un incidente **ROUTE** que después falla también desde el servidor **se convierte en DOWN**: mismo incidente, mismo ticket, con un evento en la cronología.
- Si la comprobación cruzada no llega en 2 minutos, el incidente se abre con la información disponible y se reclasifica cuando llegue.

### Caída del internet de la oficina

Si en un mismo ciclo fallan **las dos referencias externas** y al menos la mitad de los destinos, el motor lo declara caída de oficina:

- no se abren incidentes por servicio;
- se abre un `monitor_office_outage`;
- el widget emite **un solo aviso**.

Los resultados de cada destino se guardan igual. Durante la caída, la sonda del servidor sigue decidiendo sola.

### Degradación

- La sonda de oficina mide 3 ciclos regulares seguidos por encima del umbral de latencia del servicio → incidente **DEGRADED**.
- Se cierra con 2 comprobaciones seguidas bajo el umbral.
- No abre ticket ni genera notificación de Windows.

### Recuperación

Un incidente DOWN o ROUTE se cierra cuando la sonda que lo detectó (o las dos, si es DOWN) responde bien en dos comprobaciones seguidas. Al cerrarse:

- se registra `recovered_at`;
- se agrega un evento al ticket;
- se emite **un solo** aviso de recuperación.

### Mantenimiento

Durante una ventana programada se sigue midiendo y guardando, pero no se abren tickets ni se notifica. Los minutos de mantenimiento se descuentan del informe y aparecen listados en él.

### Vigilancia de las propias sondas

- **La central vigila a la oficina:** si no recibe resultados de `oficina-01` durante 10 minutos, notifica por correo al personal, con el módulo de notificaciones existente.
- **La oficina vigila a la central:** si el motor no puede hablar con la central en 3 sondeos seguidos, el widget muestra «La central no responde» y emite una notificación de Windows. El motor sigue midiendo y acumulando.
- **El widget vigila al motor:** si la API local no responde, el widget se pone gris y emite una notificación de Windows.

## El motor de la oficina

- Servicio de Windows que arranca con el sistema, **sin necesidad de iniciar sesión**, con una cuenta de mínimos privilegios y reinicio automático si falla.
- Se identifica ante la central con el token de la sonda (guardado protegido con DPAPI).
- **Sondeo cada 15 s:**
  - envía los resultados pendientes en lotes;
  - recibe la configuración (servicios, horarios, umbrales, mantenimientos) si cambió;
  - recibe órdenes (probar ahora, comprobación cruzada);
  - recibe el estado combinado de todos los servicios para el widget.
- **SQLite local:** cola de envío y la última configuración conocida, para seguir midiendo aunque la central esté caída. Cada resultado lleva un UUID: reenviarlo no lo duplica.
- **API local en `127.0.0.1`** para el widget, con un secreto compartido en un archivo que solo pueden leer el usuario y el servicio.
- **Registro de diagnóstico** en `%ProgramData%\KUBO\Monitor\logs`, con rotación.

## El widget

Pantallas de referencia en el prototipo (`prototipos/2026-11-23-monitoreo-v2.html`), vista «PC de oficina».

- Ventana sin marco, **siempre encima** y fijable en cualquier esquina. Plegada es una barra «KUBO · Todo operativo · hora».
- Ante un problema se pone **rojo** (caída o sin acceso), **ámbar** (verificando, degradado, disco bajo, central caída) o **gris** (motor caído), y se despliega solo con una fila por problema. Cada fila indica qué ve cada sonda («Perú ✕ · Servidor ✓ · TCK-1042»).
- Un clic en una fila abre el incidente en la web. «Abrir tablero» abre la sección Monitoreo.
- Arranca con la sesión del usuario, sin elevación. Tiene icono en la bandeja con: mostrar widget, abrir tablero, ver incidentes, probar notificación y ver salud del monitor.
- **Al iniciar sesión** muestra un resumen de lo ocurrido mientras no había sesión y destaca lo que sigue activo.

### Notificaciones de Windows

| Evento | Notificación de Windows | Widget | Ticket |
|---|---|---|---|
| Caída confirmada (DOWN), criticidad Alta | sí | sí | sí, P1 |
| Sin acceso desde Perú (ROUTE), criticidad Alta | sí | sí | sí, P1 |
| Recuperación de los dos anteriores (un aviso) | sí | sí | evento en el ticket |
| Caída o sin acceso, criticidad Media o Baja | no | sí | sí, P2/P3 |
| Degradación sostenida | no | sí | no |
| Internet de oficina caído (un aviso agrupado) | sí | sí | no |
| La central no responde | sí | sí | no |
| El motor no responde | sí | sí | no |
| Disco con menos del 10 % libre (agente) | sí | sí | no |
| Fallo transitorio | no | no | no |

Cada notificación abre el incidente correspondiente. Todo queda en el historial aunque Windows haya silenciado la notificación.

## El agente de servidor

- Servicio de Windows en .NET 8, un único `.exe`. Se instala con un instalador generado desde la web, que incluye el token único del servidor.
- **Cada 60 s envía:** CPU, memoria, espacio por unidad, estado de los grupos de aplicaciones de IIS, estado de una lista configurable de servicios de Windows y la cantidad de errores nuevos del Visor de eventos (Sistema y Aplicación).
- Solo envía datos (HTTPS saliente). No recibe órdenes ni ejecuta nada.
- **En la central:**
  - tendencia de disco y días estimados hasta llenarse;
  - aviso con menos del 10 % libre;
  - aviso si el agente deja de reportar 10 minutos.

## Pantallas del personal

Sección **Monitoreo** en la barra lateral, solo para el personal (`StaffOnlyGuard`). Referencia: el prototipo, vista «Central».

- **Estado:**
  - cada servicio con dos columnas, «Desde Perú» y «Desde servidor», el estado combinado y la tendencia;
  - filtros por cliente, estado y servidor;
  - «Probar ahora» limitado a una vez cada 15 s por servicio;
  - exportar a CSV.
- **Incidentes:** lista y detalle con lo que vio cada sonda, el diagnóstico, el ticket vinculado, la cronología, las notas, «Copiar destino WinMTR» y «Adjuntar WinMTR».
- **Servidores:** los datos del agente por servidor.
- **Inventario:**
  - alta, edición, pausa y archivo de servidores y servicios, colgando de los clientes y sistemas existentes;
  - importación CSV con vista previa de filas inválidas y duplicadas;
  - «Probar configuración».
- **Disponibilidad:** el informe mensual.
- **Sondas y alertas:**
  - salud de las dos sondas;
  - umbrales y horarios;
  - mantenimientos;
  - tokens de sonda y agente (crear y revocar).

## Disponibilidad mensual

Se genera el **día 1 a las 08:00 de Lima** para el mes anterior, por cliente. Si el worker no corrió a esa hora, se genera al arrancar. Se identifica por `(cliente, mes)`: regenerarlo reemplaza la versión anterior.

Por cada servicio, con `T` = minutos del mes menos los minutos de mantenimiento:

- **Disponibilidad del servicio** = 1 − (minutos de incidentes **DOWN**) ÷ T.
- **Acceso desde Perú** = 1 − (minutos de incidentes **DOWN** + **ROUTE**) ÷ T.
- **Duración de un incidente:** desde `first_failure_at` hasta `recovered_at`, recortada a los límites del mes y descontando el mantenimiento que se superponga.
- **Cobertura de cada sonda** = comprobaciones regulares ejecutadas ÷ esperadas.
- **Tiempo medio de recuperación** = promedio de las duraciones de los incidentes DOWN y ROUTE del mes.

Los minutos en que la oficina no tenía datos **no cuentan como caída**: durante ese tiempo decide la sonda del servidor, y se listan como «ventanas sin datos».

**Contenido del informe:**
- las dos cifras;
- tabla por servicio (disponibilidad, acceso desde Perú, minutos caído, incidentes, latencia P50/P95 desde Perú y desde el servidor);
- incidentes con su ticket;
- ventanas sin datos;
- mantenimientos;
- recursos del servidor (CPU y RAM P95, disco al cierre);
- el criterio de cálculo escrito en el propio documento.

**En el portal:** cuando `portal_availability_visible` es verdadero para el cliente, su informe mensual existente (`PortalReportsService.monthly`) gana una sección de disponibilidad. El cliente ve las dos cifras, la tabla sin la columna «desde el servidor», los incidentes y el tiempo medio de recuperación. **Nunca ve IP, la sonda del servidor ni la cobertura interna.** El cálculo vive en un módulo puro, igual que `portal/domain/monthly-report.ts`.

## Seguridad

- **Tokens:**
  - un token por sonda y uno por servidor con agente;
  - se guardan solo como hash;
  - revocables desde la web.
- **Endpoints de ingesta:**
  - bajo `/api/v1/monitoring/ingest/*` (el prefijo global del backend), separados de la autenticación del personal y del portal;
  - con límite de frecuencia y límite de tamaño del cuerpo.
- Solo se prueban destinos cargados en el inventario. «Probar ahora» no acepta destinos libres.
- La validación TLS nunca se desactiva.
- El agente no ejecuta órdenes remotas.

## Entregas del piloto

1. **Núcleo:**
   - `monitoring-core`;
   - inventario;
   - worker con la sonda del servidor;
   - ingesta;
   - motor de oficina;
   - estado combinado;
   - incidentes con ticket automático, **ya ocultos al cliente** (decisión 21: el primer ticket automático no puede nacer visible en el portal);
   - pantalla de Estado e Incidentes.
2. **Escritorio:** widget, notificaciones de Windows, bandeja, resumen al iniciar sesión, vigilancia cruzada de sondas.
3. **Informe y agente:**
   - resúmenes diarios;
   - informe de disponibilidad del personal;
   - agente .NET y pantalla de Servidores;
   - WinMTR;
   - mantenimientos.
4. **Portal:** se activa por cliente tras la validación (decisión 6).

## Cuándo el piloto está listo

- Tras reiniciar la PC y antes de iniciar sesión, la central recibe mediciones nuevas de la oficina. Cerrar la sesión no detiene el motor.
- El cambio de las 07:00 y las 22:00 cambia la frecuencia sin pruebas duplicadas.
- Un fallo aislado queda en el historial sin incidente. Tres intentos fallidos abren un incidente, crean un ticket y muestran una sola notificación. La recuperación cierra el mismo incidente y emite un solo aviso.
- Se reproducen estos escenarios:
  - HTTPS caído con TCP operativo;
  - falla solo desde Perú (se diagnostica ROUTE);
  - caída del internet de la oficina (un aviso, sin tickets);
  - central detenida (el widget sigue y la cola se vacía al volver);
  - reinicio del backend con un incidente abierto (sin duplicar incidente ni ticket);
  - informe de un mes en que el worker no corrió el día 1.
- Con el portal desactivado, un ticket automático no aparece en la lista ni en el detalle del portal del cliente, ni cuenta en el SLA de su informe; el personal sí lo ve. Al activar el portal, aparece.
- Con dos clientes, cada informe contiene solo los servicios, incidentes y evidencia del cliente seleccionado.
- **Prueba de carga:** 50 servicios con las dos sondas cumplen el intervalo de 1 min sin acumular retraso cuando 10 destinos dejan de responder a la vez.
- Con siete días de datos reales se revisan juntos los falsos avisos, la latencia habitual, la carga y el formato del informe antes de sumar más IP y antes de activar el portal.

## Lo que queda al constructor

- La librería para registrar el motor como servicio de Windows y cómo se empaqueta el instalador del motor y el widget.
- El empaquetado de `monitoring-core` (workspace o copia en el build).
- Si la prueba ICMP usa el `ping` del sistema o un socket propio.
- El orden interno de tareas dentro de cada entrega.
- La forma exacta de la API local entre el motor y el widget.

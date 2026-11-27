# Aceptación de la Entrega 3 (Informe y agente) — Monitoreo de disponibilidad

Fecha de las comprobaciones: **2026-11-24**. Rama: `feat/monitoreo-informe` (sin publicar, sin fusionar), a partir de `feat/monitoreo-escritorio`.
Criterios: sección «Cuándo el piloto está listo» y entrega 3 («Informe y agente») de `docs/superpowers/specs/2026-11-23-monitoreo-disponibilidad-design.md`.

## Resumen para el responsable

- Todas las pruebas automáticas pasan y todo compila (sección 1).
- **No se levantó un entorno sembrado**: no hay capturas de las pantallas nuevas (Disponibilidad, Servidores, Mantenimientos, Agentes). La revisión visual queda **PENDIENTE DEL USUARIO** (sección 6).
- **El agente no se instaló en ningún servidor** ni se contactó producción ni servidores de clientes. El instalador y el servicio de Windows del agente solo están probados con pruebas unitarias y por lectura.
- Instalar el agente en `VMI2571371` (o cualquier servidor del cliente) requiere la **autorización escrita de Contacto Eficaz**. Primero se prueba en un servidor de prueba.
- Los pasos E1 a E9 de la sección 4 son los que solo usted puede hacer.

Estados usados:

- **VERIFICADO**: se comprobó en el entorno local con la evidencia indicada.
- **CUBIERTO POR PRUEBAS**: lo demuestra una prueba automática (no se reprodujo a mano).
- **PENDIENTE DEL USUARIO**: requiere un servidor, la PC de la oficina o infraestructura real.
- **FUERA DE ESTA ENTREGA**: la spec lo asigna a otra entrega.

## 1. Pruebas automáticas (2026-11-24)

| Comprobación | Resultado |
|---|---|
| `packages/monitoring-core`: `npx jest` | 5 suites, **65/65** OK |
| `backend`: `node scripts/sync-monitoring-core.mjs --check` | código de salida 0 («Copia al día con la fuente») |
| `backend`: `npx jest` | 169 suites, **3019/3019** OK |
| `web`: `npm run build` | OK (comprobación de tipos y paquete; solo el aviso habitual de tamaño de chunks) |
| `desktop/engine`: `npx jest` | 7 suites, 113 OK y 1 omitida a propósito (solo corre fuera de Windows) |
| `desktop/widget`: `npx jest` | 8 suites, **87/87** OK |
| `agent`: `dotnet test` | **58/58** OK, 0 omitidas |

La web no tiene ejecutor de pruebas: las pantallas se cubren con la compilación y con las pruebas del backend que alimentan sus datos.

## 2. Criterios de aceptación

### 2.1 «Cuándo el piloto está listo» (lo que toca a la Entrega 3)

| # | Requisito de la spec | Estado | Evidencia |
|---|---|---|---|
| P1 | Informe de un mes en que el worker no corrió el día 1 | **CUBIERTO POR PRUEBAS** | `AvailabilityReportService.catchUp` se lanza al arrancar el backend: si ya pasó el día 1 a las 08:00 de Lima, genera el informe del mes anterior de los clientes que no tienen uno **cerrado**. Una fila parcial (`partial = true`, p. ej. generada a mano el día 20) **se rehace** y queda con `partial = false` y `data.to` en el inicio del mes siguiente (`availability-report.service.spec.ts`: «catchUp con un informe existente no lo regenera y genera solo el que falta» y «una fila parcial de octubre se regenera»). El upsert por `(client_id, month)` se comprobó una vez con un `DataSource` real contra MySQL desechable: una sola fila. Los días sin resumen se calculan al vuelo con `ensureRange` (se saltan los ya marcados). No se reprodujo apagando el worker un día 1 real |
| P2 | Con dos clientes, cada informe contiene solo los servicios, incidentes y evidencia del cliente seleccionado | **CUBIERTO POR PRUEBAS** | `availability-report.spec.ts` (función pura: filtra por los servidores y servicios del cliente aunque la entrada traiga datos de más; prueba de «nada del B») y `availability-report.service.spec.ts` (consultas por cliente: incidentes, evidencia y huecos de sonda). Los totales y los incidentes de un servidor padre también están cubiertos |
| P3 | Un ticket automático no cuenta en el SLA de su informe | **VERIFICADO POR LECTURA** (sin prueba propia) | El informe sale de checks e incidentes de monitoreo, no de tickets; el ticket solo se enlaza (`ticketId`, `ticketCode`) como dato del incidente. El portal sigue sin mostrar tickets automáticos (Entrega 1) |
| P4 | Mantenimiento: sin ticket ni aviso durante la ventana | **CUBIERTO POR PRUEBAS** | `availability-evaluator.service.spec.ts`: un DOWN confirmado durante una ventana activa **no** crea ticket; el estado combinado marca `maintenance`; el motor y el widget no muestran fila ni aviso (`diff-states` con `maskMaintenance`, `widget-model.spec.ts`). Las ventanas son semiabiertas `[inicio, fin)`; una de servidor cubre a sus servicios |
| P5 | Mantenimiento: al salir de la ventana se crea o reabre el ticket | **CUBIERTO POR PRUEBAS** | Evaluador: el barrido tras `endsAt` crea el ticket del incidente que sigue abierto o reabre el del incidente recuperado en la ventana; la reapertura diferida sobrevive a `UPGRADED_TO_DOWN` y `PARENT_CREATED` (corregido en la revisión). Motor: INCIDENT_OPENED con aviso al salir si no había aviso previo |
| P6 | Mantenimiento: el tiempo de ventana no cuenta como caída en el informe | **CUBIERTO POR PRUEBAS** | `maintenanceIntervalsFor` + `computeAvailabilityReport` (los intervalos de mantenimiento se restan del tiempo medido y se listan aparte en el informe) |
| P7 | Evidencia WinMTR adjunta a un incidente | **CUBIERTO POR PRUEBAS** | `availability-evidence.service.spec.ts`: solo `.txt`, `.html`, `.htm`, `.csv`, `.png` y `.jpg` hasta 2 MB (413/400), descarga con `Content-Disposition: attachment` y `nosniff`, archivo ausente da 404, borrado solo ADMIN (primero la fila, luego el archivo). El detalle del incidente lleva la lista. El botón y la descarga en la web: ver E9 |
| P8 | Importación CSV del inventario | **CUBIERTO POR PRUEBAS** | `csv-import.spec.ts` (BOM, `;` o `,`, comillas, saltos de línea, CRLF) y `availability-import.service.spec.ts` (vista previa por fila, cliente por nombre exacto, sistema del cliente, duplicados en la base o en el archivo, alta en una sola transacción que revalida). El límite de 256 KB por ruta se prueba por HTTP (200 KB pasa, 257 KB da 413). La pantalla de vista previa: ver E9 |
| P9 | Agente .NET: envía CPU, RAM, discos, IIS, servicios y errores del Visor de eventos | **CUBIERTO POR PRUEBAS** + PENDIENTE DEL USUARIO | `agent/tests` (58): `SampleBuilder` con el JSON exacto (incluido `iisPools: null` sin IIS, primera muestra de errores en 0), `CentralClient` con manejador falso (Bearer, ruta, 200, 401 sin lanzar, 429/400/5xx, sin cola), configuración con DPAPI. **No se probó en un servidor real**: ver E1 a E4 |
| P10 | Agente: ingesta en la central y pantalla de Servidores | **CUBIERTO POR PRUEBAS** + PENDIENTE DEL USUARIO | Backend: `availability-agent.integration.spec.ts` y `agent-token.guard.spec.ts` (token `kma_`, sha256, 401 con token inválido o revocado, 400 `BAD_INPUT`, 413 sobre 64 KB, 429 antes de 20 s), `availability-agent.service.spec.ts` (`agentView`: discos con `freePct` y `daysToFull`, series 24 h). La pantalla: ver E5 y la sección 6 |
| P11 | Alerta de disco con menos del 10 % libre: aviso de Windows | **CUBIERTO POR PRUEBAS** + PENDIENTE DEL USUARIO | `server-alerts.spec.ts` (`DISK_LOW` cuando `libre/total < 0,10`; no se evalúa con el agente mudo), `SyncResponse.serverAlerts`, `diffServerAlerts` y `notify-policy.spec.ts` (aviso «Disco con poco espacio · servidor · C: 9 % libre», clic a `/monitoreo/servidores?serverId=`; la recuperación nunca avisa). Ver E6 |
| P12 | Agente en silencio: correo al personal a los 10 minutos | **CUBIERTO POR PRUEBAS** + PENDIENTE DEL USUARIO | `agent-silence.watch.spec.ts` (mismo patrón que el de las sondas: a los 10 min, un solo correo, aviso de recuperación, 2 min de gracia al arrancar, sin administradores activos) y `server-alerts.spec.ts` (`AGENT_SILENT` en el widget). Correo real: ver E7 |
| P13 | Resúmenes diarios: histogramas de latencia y huecos de sonda | **CUBIERTO POR PRUEBAS** | `availability-rollup.service.spec.ts`, `latency-histogram.spec.ts` y `probe-gaps.spec.ts` (18 cubetas de latencia, cubetas de CPU/RAM, discos al cierre, borrar-e-insertar por día en una transacción, recálculo de los últimos 2 días cada noche, purga a 30 días de muestras y 12 meses de resúmenes) |
| P14 | Informe de disponibilidad del personal (pantalla, impresión) | **CUBIERTO POR PRUEBAS** + PENDIENTE DEL USUARIO | Cálculo y API cubiertos (P1 a P3, P6). La pantalla `/monitoreo/disponibilidad` compila; su aspecto y la impresión (la barra lateral y los controles se ocultan con `@media print`) **no se vieron**: ver sección 6 y E8 |
| P15 | Motor y widget: avisos de servidor y mantenimiento | **CUBIERTO POR PRUEBAS** | `desktop/engine/test` (113) y `desktop/widget/test` (87): `maskMaintenance`, `diffServerAlerts`, `SERVER_ALERT_STARTED/CLEARED` (solo `DISK_LOW` avisa), filas ámbar del widget, resumen «N avisos de servidor», IPC `widget:open-server` con identificador validado |
| P16 | Prueba de carga: 50 servicios con dos sondas, 10 destinos caídos a la vez | **FUERA DE ESTA ENTREGA** | No forma parte de esta entrega; sigue pendiente como criterio del piloto (la Entrega 1 dejó la estructura de franjas) |
| P17 | Siete días de datos reales: falsos avisos, latencia habitual, carga y **formato del informe** | **PENDIENTE DEL USUARIO** | Ver E8 |
| P18 | Portal del cliente | **FUERA DE ESTA ENTREGA** | Entrega 4 |

## 3. Decisiones y cambios respecto al plan

1. **Migración `037_disponibilidad_informe.sql`**: 8 tablas, 4 columnas del agente en `monitor_servers` e índice `idx_monitor_checks_probe_started`. Es aditiva e idempotente (guardada con `information_schema`; probada dos veces en MySQL 8 desechable). Tiene un CHECK «exactamente uno de `server_id` / `service_id`» en mantenimientos. `deploy.yml`, `docker-compose.yml` y `docker-compose.dev.yml` la incluyen; la guarda `migraciones-desplegadas.spec.ts` exige que las listas coincidan y detecta un `\n` literal.
2. **Cubetas de latencia:** 18 límites inferiores en ms; la última cubeta es `[10000, +∞)`. El plan decía «+∞, 19 cubetas», un desliz de notación (un límite inferior infinito no se puede llenar ni serializar en JSON).
3. **Resúmenes diarios:** no se crean filas para una sonda antes de su primer check; el informe trata un par (servicio, sonda) sin filas como cobertura nula. Cada noche se recalculan siempre **ayer y anteayer**, para absorber lo que la cola de la oficina sube tarde tras un corte.
4. **Mantenimiento:** poner un comentario o subir la prioridad de un ticket que ya existe sigue permitido durante la ventana (los tickets son internos); lo que se bloquea es **abrir** ticket y avisar.
5. **Agente sin reportar:** un agente que nunca reportó muestra la fila ámbar «Agente sin datos» en el widget (contando desde la emisión del token) pero **no envía correo**, igual que las sondas (decisión 11). Una instalación fallida solo se ve como fila ámbar.
6. **Token del agente:** `kma_` + 32 bytes en base64url; se guarda solo su sha256. Emitir uno nuevo revoca el anterior y reinicia `agentLastSeenAt` y `agentSilenceAlertedAt` (para no disparar el silencio con la muestra del agente anterior).
7. **`agent_watch_services`:** hasta 50 nombres de 1 a 256 caracteres con `^[A-Za-z0-9_.$\- ]+$` (admite instancias con nombre como `MSSQL$SQLEXPRESS`; el agente solo recorta espacios y largo). Un servicio con nombre exótico se rechaza.
8. **Umbral «Reportando»:** 10 minutos (el mismo de la alerta y del correo), no 3.
9. **Columna `iis`:** se guarda como `{ pools: [...] | null }` porque la columna es JSON NOT NULL.
10. **Casos en los que el widget no vuelve a avisar tras una ventana:** una caída previa a la ventana que se recupera y reabre otro incidente dentro de ella se anuncia al salir como INCIDENT_OPENED **sin** aviso (el personal ya la había visto caída y nunca la vio recuperada).
11. **Agente:** `net10.0-windows` (no `net10.0`, por las API de Windows), un solo ejecutable autocontenido `win-x64`. No se autoextrae: corre directamente desde `kubo-agent.exe`, sin descomprimir nada en carpetas temporales. El instalador de la central genera el PowerShell con la URL de `FRONTEND_URL` y el token entre comillas simples.
12. **Residual aceptado:** `%ProgramData%\KUBO` lo comparte el motor; un usuario local sin privilegios que lo hubiera creado antes podría leer el token del agente. Se acepta mientras el servidor solo tenga personal de confianza.

## 4. Pendiente del usuario (pasos exactos y seguros)

> **Autorización del cliente.** Instalar el agente en un servidor de Contacto Eficaz (por ejemplo `VMI2571371`) exige **autorización por escrito** del cliente antes de empezar. Sin ella, solo se prueba en un servidor de prueba propio.
>
> **Los pasos que llenan un disco o detienen el agente actúan sobre un servidor real.** Hágalos solo en el servidor de prueba, no en uno de cliente.

- **E1. Construir el agente.** En una PC con el SDK de .NET 10: `cd agent` y `powershell -ExecutionPolicy Bypass -File .\build.ps1`. Resultado: `agent\publish\kubo-agent.exe` y su SHA-256 impreso. No se instala nada en esa PC. El agente **no está en CI ni lo despliega `deploy.yml`**.
- **E2. Instalar en un servidor de prueba (primero).** En la web: Monitoreo → Sondas → Agentes, elija un servidor de prueba y genere el token (se muestra una vez; se descarga `install-kubo-agent.ps1`). Copie al servidor, en la misma carpeta, `install-kubo-agent.ps1` y `kubo-agent.exe`. Desbloquee el script (`Unblock-File .\install-kubo-agent.ps1`), abra PowerShell **como administrador** y ejecute `powershell -ExecutionPolicy Bypass -File .\install-kubo-agent.ps1`. **Borre el script** al terminar: contiene el token en claro.
- **E3. Ver la primera muestra.** En 1 o 2 minutos el servidor debe aparecer con datos (CPU, RAM, discos, servicios) en Monitoreo → Servidores y su estado en Sondas → Agentes debe decir «Reportando». El servicio `KuboAgent` debe figurar en `services.msc` con inicio automático.
- **E4. Revocar y desinstalar.** Revoque el token en la web: el agente debe registrar «token inválido o revocado» (código 401) en el Visor de eventos del servidor y seguir intentando cada intervalo. Luego desinstale con `uninstall-kubo-agent.ps1` y compruebe que el servicio y `C:\Program Files\KUBO\Agent` desaparecen.
- **E5. Servidores y servicios vigilados.** Reinstale con un token nuevo, indique en el servidor (edición) algunos servicios a vigilar y compruebe que aparecen con su estado y que uno inexistente sale como `NotFound`.
- **E6. Aviso de disco.** En el servidor **de prueba**, llene un disco de prueba hasta pasar el 90 % de uso (menos del 10 % libre; por ejemplo un archivo grande con `fsutil file createnew C:\relleno.bin <bytes>`). En unos minutos el widget debe mostrar la fila ámbar «Disco con poco espacio» y mostrar **un** aviso de Windows cuyo clic abre Servidores. Borre el archivo: la fila desaparece, sin aviso.
- **E7. Silencio del agente.** Detenga el servicio `KuboAgent` del servidor de prueba durante **10 minutos**: el personal debe recibir **un** correo («El agente de … no reporta») y el widget una fila ámbar «Agente sin datos». Inícielo de nuevo: llega el correo de «volvió a reportar». Si hay administradores reales, avíseles antes (el correo es real).
- **E8. Informe parcial y revisión de 7 días.** Con datos reales (el piloto ya corriendo), en Monitoreo → Disponibilidad genere el informe **del mes en curso** (sale como «parcial») e imprímalo o expórtelo a PDF. Durante los siete días de revisión revise con el desarrollador: falsos avisos, latencia habitual, carga y el formato del informe, antes de sumar más IP y antes de activar el portal.
- **E9. Mantenimiento y evidencia.** Cree una ventana de mantenimiento para un servicio de prueba, provoque su caída durante la ventana (no debe haber ticket, aviso ni fila roja) y compruebe que, al terminar la ventana, se crea el ticket si sigue caído. Adjunte un WinMTR de prueba (`.txt`) a un incidente y descárguelo. Importe un CSV pequeño de inventario con la plantilla descargable y revise la vista previa antes de confirmar.
- **E10. Instalar en `VMI2571371`.** Solo con la **autorización escrita de Contacto Eficaz** y con E2 a E7 aprobadas en el servidor de prueba. Mismos pasos que E2 y E3, de preferencia en una ventana tranquila y con una ventana de mantenimiento si se prevé reiniciar algo.
- **E11. Visto bueno de la entrega.** Criterios: E3, E4, E6 y E7 cumplidos en el servidor de prueba; E8 con el informe revisado; E9 sin ticket ni aviso durante la ventana. E5 deseable.

## 5. Limitaciones conocidas

- La **recuperación dentro de una ventana de mantenimiento** se anuncia al terminar la ventana, no en el momento. Una re-caída dentro de la ventana de algo que ya estaba caído antes tampoco se vuelve a avisar.
- Un **servicio creado a mitad de mes cuenta el mes completo** en el informe (la disponibilidad se calcula sobre todo el mes, no desde su alta). Un servicio en pausa o nuevo cuenta las 720 comprobaciones esperadas por día.
- Un **agente que nunca reportó** solo muestra la fila ámbar en el widget; no genera correo (decisión 11).
- Tras **reemitir un token** el aviso `DISK_LOW` del agente anterior puede mostrarse un instante hasta la primera muestra nueva.
- El **agente no está en CI**: `dotnet test` solo corre en Windows (usa DPAPI) y se ejecuta a mano. El ejecutable lo compila y copia el personal; **no lo despliega `deploy.yml`**. No está firmado: SmartScreen puede avisar.
- El agente **no se probó en un servidor real**, ni con IIS, ni como servicio LocalSystem. El script de instalación tampoco se ejecutó en Windows real.
- El **token del agente aparece un instante en la línea de comandos** de `kubo-agent.exe configure --token …` durante la instalación: si el servidor tiene activa la auditoría de creación de procesos (evento 4688 con línea de comandos), queda registrado allí. Por eso, además de **borrar el script de instalación** al terminar, conviene revisar o limpiar ese registro si la auditoría está activa, y reemitir el token si se sospecha una fuga.
- Un **mantenimiento de servidor también calla los avisos del agente**: no hay correo de «agente sin datos» ni fila o notificación de disco mientras dure la ventana. Si al terminarla el disco sigue con menos del 10 % libre o el agente sigue sin reportar, el aviso sale en ese momento. Si el correo de silencio ya se había enviado antes de la ventana, el de «volvió a reportar» puede llegar durante ella.
- El tope de 64 KB por muestra puede superarse en un caso patológico (200 grupos de IIS con nombres largos más 50 servicios): daría 413. Con datos reales sobra margen.
- La ingesta hace una consulta por servidor con agente en cada sincronización de la oficina; con muchos servidores convendría una sola consulta.
- Al límite de 20 s del agente le corresponde un turno que se gasta antes de guardar: un fallo 500 del guardado seguido de un reintento inmediato da 429.
- La importación CSV: un archivo con la primera línea en blanco puede detectar mal el separador; el límite JSON de 256 KB puede quedarse corto para un CSV cercano a ese tamaño (se acepta hasta 256 K caracteres); validar y escribir no comparten transacción (una carrera extrema puede fallar al escribir, nunca duplicar). La exportación antepone `'` a celdas que parecen fórmulas y la importación no lo quita.
- Una recuperación de hermano oculta tras la fila congelada de un padre en mantenimiento se ve al terminar la ventana.
- Residuales menores de la Entrega 3 (ver `progress.md` del plan): sin índice en `agent_token_hash` (poca cantidad de servidores), comillas tipográficas en el script de instalación, un hueco de sonda de menos de 10 minutos tras restar una caída, y silencios que cruzan la medianoche no se parten.
- Las migraciones `003` a `010` no son idempotentes (preexistente; las de monitoreo, 035 a 037, sí).
- Quedan avisos de `npm audit` sin atender en el widget.

## 6. Capturas

**No se tomaron.** No había un entorno sembrado (base de datos, backend y datos de clientes) y levantarlo no era rápido; la Entrega 3 se cerró sin ejecutar el backend. La comprobación visual de las pantallas queda **PENDIENTE DEL USUARIO**:

| Pantalla | Qué mirar | Estado |
|---|---|---|
| Disponibilidad (`/monitoreo/disponibilidad`) | selector de cliente y mes (incluye «mes en curso, parcial»), aviso «Informe parcial al …», totales, tabla por servicio, incidentes con enlace al ticket y evidencia, ventanas sin datos y de mantenimiento, recursos de servidores, «Criterio de cálculo», y que al imprimir se oculten barra lateral y controles | **PENDIENTE DEL USUARIO** |
| Servidores (`/monitoreo/servidores`) | tarjetas con «Reportando / Sin datos desde / Sin agente», CPU, RAM, barras de disco (ámbar bajo 10 %, «≈ N días para llenarse»), grupos de IIS, servicios vigilados, errores 24 h, gráficas CPU/RAM; `?serverId=` resalta y desplaza | **PENDIENTE DEL USUARIO** |
| Mantenimientos (pestaña de Monitoreo) | tabla activas / programadas / terminadas, formulario por servidor o servicio con hora de Lima, «Terminar ahora» y «Eliminar» (solo ADMIN), error 409 | **PENDIENTE DEL USUARIO** |
| Agentes (Sondas → Agentes) | emitir y revocar token, diálogo de una sola vez con el texto de aviso (token en claro, borrar el script, `Unblock-File` o `-ExecutionPolicy Bypass`, `kubo-agent.exe` en la misma carpeta) y descarga de `install-kubo-agent.ps1` | **PENDIENTE DEL USUARIO** |
| Importar CSV (Inventario) y detalle de incidente con evidencia | vista previa por fila, plantilla; adjuntar, descargar y borrar WinMTR | **PENDIENTE DEL USUARIO** |

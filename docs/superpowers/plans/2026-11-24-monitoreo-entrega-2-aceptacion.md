# Aceptación de la Entrega 2 (Escritorio) — Monitoreo de disponibilidad

Fecha de las comprobaciones: **2026-11-24**. Rama: `feat/monitoreo-escritorio` (sin publicar, sin fusionar).
Criterios: secciones «El widget», «Notificaciones de Windows» y «Vigilancia de las propias sondas» de `docs/superpowers/specs/2026-11-23-monitoreo-disponibilidad-design.md`.

## Resumen para el responsable

- Todas las pruebas automáticas pasan y todo compila.
- Se hizo una prueba de humo local y desechable (base de datos, backend, motor y widget en modo desarrollo). Se vio el widget plegado y desplegado, los avisos de Windows de caída y de recuperación, y el resumen al iniciar sesión.
- **No se instaló el widget con el instalador, no se tocó producción y no se registró ningún inicio automático** en esta PC.
- Quedan pendientes comprobaciones que solo usted puede hacer (sección 4): sobre todo instalar con el instalador por usuario, ver que arranca con la sesión, que Windows no silencia los avisos y que el clic en un aviso abre el incidente.

Estados usados:

- **VERIFICADO**: se comprobó en el entorno local el 2026-11-24, con la evidencia indicada.
- **CUBIERTO POR PRUEBAS**: lo demuestra una prueba automática (no se reprodujo a mano).
- **PENDIENTE DEL USUARIO**: requiere la PC de la oficina, el instalador o infraestructura real.
- **FUERA DE ESTA ENTREGA**: la spec lo asigna a otra entrega.

## 1. Pruebas automáticas (2026-11-24)

| Comprobación | Resultado |
|---|---|
| `packages/monitoring-core`: `npx jest` | 5 suites, **64/64** OK |
| `backend`: `node scripts/sync-monitoring-core.mjs --check` | código de salida 0 («Copia al día con la fuente») |
| `backend`: `npx jest` | 137 suites, **2703/2703** OK |
| `backend`: `npm run build` | OK |
| `desktop/engine`: `npx jest` | 7 suites, 79 OK y 1 omitida a propósito (solo corre fuera de Windows) |
| `desktop/engine`: `npm run build` | OK |
| `desktop/widget`: `npx jest` | 8 suites, **66/66** OK |
| `desktop/widget`: `npm run build` | OK (comprobación de tipos, compilación y paquete de la interfaz) |

El paquete sin instalador (`npx electron-builder --win --dir`, `dist/win-unpacked/KUBO Monitor.exe`) se generó durante la implementación; el instalador NSIS **no** se construyó ni se ejecutó.

## 2. Criterios de aceptación

### 2.1 El widget

| # | Requisito de la spec | Estado | Evidencia |
|---|---|---|---|
| W1 | Ventana sin marco, siempre encima | **VERIFICADO** (ventana) | Se vio la ventana sin marco sobre el escritorio en la prueba de humo (capturas 01 a 05). Las opciones (`frame: false`, `alwaysOnTop` nivel `screen-saver`, sin barra de tareas) están en `desktop/widget/src/main/window.ts`. Que quede encima de otras aplicaciones no se probó a mano: ver D3 |
| W2 | Fijable en cualquier esquina | **CUBIERTO POR PRUEBAS** + manual pendiente | `window-position.spec.ts`: `positionFor` en las cuatro esquinas con margen 12 y `nearestCorner`. Arrastrar y soltar no se ejercitó con el ratón: ver D5 |
| W3 | Plegada es una barra «KUBO · Todo operativo · hora» | **VERIFICADO** | Captura `01-plegada-todo-operativo.png` (barra verde «KUBO · Todo operativo · 10:56») |
| W4 | Rojo ante caída o sin acceso | **VERIFICADO** | Captura `02-desplegada-fila-roja.png`: fila roja «API Humo · Perú ✕ · Servidor ✕ · KB-0001», icono de bandeja rojo. Tonos y colores: `widget-model.spec.ts` |
| W5 | Ámbar (verificando, degradado, disco bajo, central caída) | **VERIFICADO** (verificando) / **CUBIERTO POR PRUEBAS** (resto) | En el humo el widget pasó a ámbar «KUBO · 1 problema» mientras se verificaba (10:46). Degradado y central caída: `widget-model.spec.ts`. Disco bajo viene del agente de servidor: **FUERA DE ESTA ENTREGA** |
| W6 | Gris con el motor caído | **CUBIERTO POR PRUEBAS** + manual pendiente | `widget-model.spec.ts` y `engine-client.spec.ts` (sin respuesta, 401/403, 2 min de gracia al arrancar). Apagar el servicio y verlo: ver D7 |
| W7 | Se despliega solo, una fila por problema | **VERIFICADO** | Capturas 01 y 02: de barra plegada a una fila al aparecer el problema. Altura según filas (hasta 6, luego desplazamiento): `window-position.spec.ts` |
| W8 | Cada fila indica qué ve cada sonda («Perú ✕ · Servidor ✓ · TCK») | **VERIFICADO** | Captura 02. Combinaciones de marcas: `widget-model.spec.ts` |
| W9 | Fila de servidor se despliega en sus servicios | **CUBIERTO POR PRUEBAS** + manual pendiente | `window-position.spec.ts` (fila de servidor con 3 servicios: 1 fila plegada, 4 desplegada; `sanitizeUnfolded`) y `widget-model.spec.ts`. El clic en el triángulo no se probó a mano: ver D4 |
| W10 | Un clic en una fila abre el incidente en la web | **CUBIERTO POR PRUEBAS** + manual pendiente | `notify-policy.spec.ts` (`isAllowedUrl`: solo el mismo origen de la central y rutas bajo `/monitoreo/`) y validación del identificador en `main.ts`. El clic real y la apertura del navegador no se probaron: ver D6 |
| W11 | «Abrir tablero» abre la sección Monitoreo | **CUBIERTO POR PRUEBAS** + manual pendiente | Misma lista de URL permitidas. Ver D8 |
| W12 | Arranca con la sesión del usuario, sin elevación | **PENDIENTE DEL USUARIO** | Instalador NSIS por usuario, sin elevación (`electron-builder.yml`: `perMachine: false`, `allowElevation: false`); el inicio automático se registra solo con la aplicación empaquetada y una vez. No se instaló. Ver D1, D2 |
| W13 | Icono en la bandeja con: mostrar widget, abrir tablero, ver incidentes, probar notificación, ver salud del monitor | **CUBIERTO POR PRUEBAS** + PENDIENTE DEL USUARIO | La bandeja se vio por su icono de color en el humo, pero el menú no se abrió con el ratón. Lógica de «Salud del monitor»: `health.spec.ts`. Ver D8 |
| W14 | Al iniciar sesión muestra un resumen de lo ocurrido y destaca lo que sigue activo | **VERIFICADO** | Captura `05-resumen-al-iniciar-sesion.png`: «Mientras no estabas: 2 incidentes abiertos: API Humo · 1 recuperado: API Humo · Sigue activo: API Humo» con «Entendido» y la fila roja debajo; los eventos viejos no se vuelven a avisar. Reglas de conteo: `login-summary.spec.ts`. El inicio de sesión real de Windows: ver D2 |

### 2.2 Notificaciones de Windows

| # | Evento (spec) | Estado | Evidencia |
|---|---|---|---|
| N1 | Caída confirmada, criticidad Alta: aviso, widget, ticket P1 | **VERIFICADO** | Captura `03-aviso-caida.png` («Caída: API Humo … KB-0001»), fila roja y ticket `KB-0001`. Se vio sobre el escritorio en modo desarrollo (los avisos salen como «Electron»); con el instalador: ver D6 |
| N2 | Sin acceso desde Perú (ROUTE), Alta: aviso, widget, ticket P1 | **CUBIERTO POR PRUEBAS** | `desktop/engine/test` (diario de eventos: `notify` verdadero para ROUTE de criticidad Alta) y `notify-policy.spec.ts` (títulos por tipo). No se reprodujo en local, igual que en la Entrega 1 |
| N3 | Recuperación de los dos anteriores: un aviso | **VERIFICADO** | Captura `04-aviso-recuperado.png` («Recuperado: API Humo … KB-0001 · 10:55»); el widget volvió a verde. Un solo aviso por recuperación y recuperación parcial con solo los servicios recuperados: pruebas del motor |
| N4 | Caída o sin acceso, criticidad Media o Baja: sin aviso (sí widget y ticket) | **CUBIERTO POR PRUEBAS** | Pruebas del diario del motor (`notify` falso) y `notify-policy.spec.ts` («ignores events with notify false») |
| N5 | Degradación sostenida: sin aviso | **CUBIERTO POR PRUEBAS** | Pruebas del motor; el resumen al iniciar sesión también la ignora (`login-summary.spec.ts`) |
| N6 | Internet de oficina caído: un aviso agrupado | **CUBIERTO POR PRUEBAS** + cable pendiente | `notify-policy.spec.ts` («OFFICE_OUTAGE_STARTED gives one grouped toast pointing to the board») y pruebas del motor. Corte real: ver D9 |
| N7 | La central no responde: aviso | **CUBIERTO POR PRUEBAS** | El motor registra `CENTRAL_UNREACHABLE` con aviso al llegar a 3 sondeos seguidos fallidos (pruebas del diario del motor). El corte de la central con el motor real se reprodujo en la Entrega 1 (4d) |
| N8 | El motor no responde: aviso | **CUBIERTO POR PRUEBAS** + manual pendiente | `notify-policy.spec.ts` (`EngineDownTracker`: un aviso al pasar de «ok» a «caído», no desde «conectando», se rearma al volver) y `poller.spec.ts`. Ver D7 |
| N9 | Disco con menos del 10 % libre (agente) | **FUERA DE ESTA ENTREGA** | Depende del agente de servidor |
| N10 | Fallo transitorio: ni aviso ni widget | **CUBIERTO POR PRUEBAS** | No genera eventos de aviso (pruebas del motor); verificado en datos en la Entrega 1 (3a) |
| N11 | Cada notificación abre el incidente correspondiente | **CUBIERTO POR PRUEBAS** + PENDIENTE DEL USUARIO | La URL del incidente se calcula y valida (`notify-policy.spec.ts`). Que Windows entregue el clic: ver D6 |
| N12 | Todo queda en el historial aunque Windows silencie el aviso | **CUBIERTO POR PRUEBAS** | El diario de eventos del motor es independiente de los avisos; el widget lee el diario y el historial de la central es el de la Entrega 1 |

### 2.3 Vigilancia de las propias sondas

| # | Requisito de la spec | Estado | Evidencia |
|---|---|---|---|
| V1 | La central avisa por correo al personal si `oficina-01` calla 10 minutos | **CUBIERTO POR PRUEBAS** + PENDIENTE DEL USUARIO | `probe-silence.spec.ts` y `probe-silence.watch.spec.ts` (alerta a los 10 min, un solo correo, aviso de recuperación, escape de HTML, 2 min de gracia al arrancar el backend, sin administradores activos). Migración 032 aplicada dos veces en una base desechable. Correo real: ver D10 |
| V2 | La vigilancia cubre ambas sondas | **CUBIERTO POR PRUEBAS** | Las mismas pruebas recorren todas las sondas con token, no solo la de la oficina |
| V3 | La oficina vigila a la central: 3 sondeos seguidos fallidos muestran «La central no responde» y un aviso; el motor sigue midiendo | **CUBIERTO POR PRUEBAS** | Motor (`CENTRAL_UNREACHABLE` a los 3 fallos, `consecutiveFailures`), `widget-model.spec.ts` (ámbar «La central no responde»). El corte real de la central con el motor corriendo, cola creciente y vaciado al volver se verificó en la Entrega 1 (4d) |
| V4 | El widget vigila al motor: sin respuesta de la API local, gris y aviso | **CUBIERTO POR PRUEBAS** + PENDIENTE DEL USUARIO | Ver N8 y W6. Ver D7 |

## 3. Decisiones y cambios respecto al plan

1. **Diario de eventos del motor.** El motor guarda un diario de eventos (con límite de 5000) y lo expone en `/v1/events`; el widget lo lee cada 5 s y decide los avisos. Así los avisos no dependen de que el widget estuviera abierto.
2. **Reglas de aviso:**
   - Un aviso por cada caída de servidor (incidente de servidor), no uno por servicio.
   - Un fallo nuevo de criticidad Alta siempre avisa, salvo que forme parte de una caída que ya se avisó.
   - La recuperación parcial nombra solo los servicios que se recuperaron.
   - Un mismo incidente no se avisa dos veces en 2 minutos.
3. **Arranque del motor.** El motor parte del último estado guardado, de modo que lo ocurrido mientras estuvo apagado (aperturas y recuperaciones) también queda en el diario y en el resumen. Riesgo asumido: una caída justo entre el diario y el guardado podría repetir una transición.
4. **«Sincronizar ahora» trae el código del ticket** mediante un servicio de sincronización aparte (`AvailabilitySyncService`), para que el trabajador de mediciones no dependa de tickets.
5. **Se vigilan las dos sondas** en la central (no solo la de la oficina), con 2 minutos de gracia tras arrancar el backend para no alertar por reinicios.
6. **El widget no calcula antigüedad de datos:** muestra el estado tal como llega; solo pone «–» si no hay dato. La frescura la decide el motor y la central.
7. **Inicio con la sesión solo si está empaquetado**, y una sola vez (`loginItemConfigured`): en desarrollo no se registra nada en la PC y quien lo desactive en el Administrador de tareas no se ve contradicho.
8. **Colores iguales a la web** (tarjeta clara con la paleta de `availability-ui.ts`), en lugar del vidrio oscuro del prototipo.
9. **Extras no previstos:** el puente expone `onHealth`/`closeHealth` para el panel «Salud del monitor»; la ventana es de una sola instancia; salida de compilación en `out/` (para no chocar con `dist/` del instalador).
10. **Endurecimiento:** vista de la interfaz con aislamiento y sandbox, política de contenido estricta, navegación y ventanas nuevas bloqueadas, solo se abren URL de la central bajo `/monitoreo/`, y `runAsNode` desactivado en el ejecutable empaquetado.

## 4. Pendiente del usuario (pasos exactos y seguros)

Ninguno de estos pasos modifica producción ni exige credenciales. Los pasos D1 y D2 deben hacerse con un desarrollador.

- **D1. Construir el instalador.** En `desktop/widget`: `npm ci` y `npm run dist`. Resultado: instalador NSIS en `desktop/widget/dist/`. Si en esa terminal existe la variable `ELECTRON_RUN_AS_NODE`, quítela antes (el README lo explica). No está firmado: SmartScreen avisará; es esperado.
- **D2. Instalar por usuario y comprobar el arranque.** Ejecute el instalador con la cuenta de uso diario (no pedirá elevación). Confirme que aparece el widget y el icono en la bandeja. Cierre sesión y vuelva a entrar (o reinicie): el widget debe arrancar solo. Compruebe que se muestra el resumen «Mientras no estabas» si hubo novedades.
- **D3. Siempre encima.** Abra otra aplicación maximizada: el widget debe seguir visible.
- **D4. Desplegar una fila de servidor.** Con un servidor con varios servicios en problema, pulse el triángulo de su fila: se ven sus servicios y la ventana crece; vuelva a pulsar para plegar.
- **D5. Arrastrar y fijar.** Arrastre la barra hacia cada esquina y suelte: debe pegarse a la más cercana y recordarla tras reiniciar. Pruebe también los cuatro botones de esquina de la barra.
- **D6. Avisos y clic.** Configuración > Sistema > Notificaciones: compruebe que «KUBO Monitor» está activado y que no está activo «No molestar» ni la asistencia de concentración. Desde la bandeja use «Probar notificación» y luego un incidente real de prueba (o espere uno): al hacer clic en el aviso debe abrirse en el navegador el incidente en la central.
- **D7. Motor apagado.** En `services.msc` detenga el servicio del motor. En unos segundos el widget debe ponerse gris, con aviso «El motor no responde» (una sola vez). Vuelva a iniciar el servicio: debe volver al estado normal.
- **D8. Menú de la bandeja.** Clic derecho en el icono: «Mostrar widget», «Abrir tablero» (abre Monitoreo), «Ver incidentes», «Probar notificación», «Salud del monitor» (muestra versión del motor, alcance de la central, última sincronización y cola) y «Salir».
- **D9. Cable de la oficina.** Desconecte el cable de internet de la PC de la oficina unos 10 minutos: debe aparecer **un solo** aviso de internet de la oficina caído (sin tickets). Al reconectar, vuelve a la normalidad.
- **D10. Silencio de 10 minutos.** Con personal administrador activo en la central, detenga el servicio del motor más de 10 minutos: la central debe enviar un correo al personal avisando del silencio de `oficina-01`, y otro al recuperarse. Vuelva a iniciar el servicio al terminar.
- **D11. Visto bueno** de la entrega.

## 5. Limitaciones conocidas

- Los avisos con el instalador (identificador `com.kubo.monitor.widget`) no se probaron; en modo desarrollo salen como «Electron». Con solo el paquete sin instalador pueden no mostrarse.
- El instalador no está firmado (SmartScreen avisará).
- Si el motor ya está caído antes de que el widget reciba su primer estado, no hay aviso de «El motor no responde» (la barra gris sí lo muestra).
- Al cerrar sesión se puede perder hasta 1 minuto de la marca «última vez visto» usada por el resumen.
- Los paneles de resumen y de salud tienen altura fija; resúmenes cortos dejan espacio en blanco.
- Las herramientas de la barra están siempre visibles (atenuadas), no solo al pasar el ratón.
- Un segundo servicio de criticidad Alta que se suma a una caída de servidor ya avisada no genera otro aviso (se ve en la fila del widget).
- Una caída que empeora (de «sin acceso» a «caída») avisa de nuevo si es de criticidad Alta.
- La poda del diario usa el reloj de la PC; un reloj mal puesto la afecta.
- La alerta de silencio de la central supone una sola instancia del backend; una sonda de centro de datos con token que nunca reportó no alerta.
- Si no hay administradores activos, la central lo registra como advertencia y no envía el correo. Si falla el envío, se reintenta cada minuto.
- Quedan avisos de `npm audit` sin atender en el widget.

## 6. Capturas de la prueba de humo

Carpeta `docs/superpowers/plans/2026-11-24-monitoreo-entrega-2-aceptacion/`:

- `01-plegada-todo-operativo.png`: barra plegada verde.
- `02-desplegada-fila-roja.png`: fila roja con marcas de cada sonda y ticket.
- `03-aviso-caida.png`: aviso de Windows de la caída.
- `04-aviso-recuperado.png`: aviso de Windows de la recuperación.
- `05-resumen-al-iniciar-sesion.png`: resumen «Mientras no estabas» y fila activa.

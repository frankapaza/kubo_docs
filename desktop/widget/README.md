# KUBO Monitor — widget

Widget de escritorio (Electron + React) que habla solo con el motor local por `127.0.0.1`
(`/v1/status`, `/v1/events`) con la cabecera `X-Kubo-Secret` leída de
`%ProgramData%\KUBO\Monitor\local-api.secret` (`KUBO_MONITOR_HOME` la sustituye).

## Qué hace

- **Ventana** sin marco, siempre encima (nivel `screen-saver`), fuera de la barra de tareas,
  320 px de ancho. Plegada es la barra de 40 px «KUBO · Todo operativo · hh:mm» (hora de Lima);
  con problemas se despliega sola, 56 px por fila (máx. 6 a la vista, el resto con scroll).
  Una caída de servidor es una fila que se despliega en sus servicios (▸). Clic en una fila →
  `<central>/monitoreo/incidentes/<id>` en el navegador.
- Se **arrastra por la barra**; al soltarla se acopla a la esquina más cercana del monitor donde
  quedó. Los botones ◸◹◺◿ de la barra la fijan en una esquina; ↗ abre el tablero. La esquina se
  guarda.
- **Bandeja**: icono verde/rojo/ámbar/gris según el tono; menú «Mostrar widget», «Abrir
  tablero», «Ver incidentes», «Probar notificación», «Salud del monitor» (versión del motor,
  central alcanzable, último sync, pendientes, rechazo) y «Salir». Alt+F4 solo oculta la ventana.
- **Bucle de 5 s**: `status` → modelo de pantalla y bandeja; `events` desde el cursor → avisos
  de Windows (solo lo que el motor marca `notify`, con deduplicación de 2 min) y aviso «El motor
  no responde» al pasar de activo a caído.
- **Resumen al iniciar sesión**: al arrancar lee el diario del motor (hasta 5000 eventos) y
  resume lo ocurrido desde la última vez que corrió el widget (`lastSeenAt`, que avanza cada
  minuto y al salir) y lo que sigue activo. Se queda hasta pulsar «Entendido». En el primer
  arranque no hay resumen.
- **Arranque con la sesión**: la app empaquetada se registra una sola vez con
  `app.setLoginItemSettings({ openAtLogin: true })` (por usuario, sin elevación). En desarrollo
  nunca. Una sola instancia: abrir otra muestra la existente.

Seguridad del renderer: `contextIsolation`, `sandbox`, sin `nodeIntegration`, CSP estricta en
`index.html`, sin navegación ni ventanas nuevas. El preload expone solo `window.kubo`
(`src/shared/ipc.ts`); el proceso principal valida cada mensaje (id entero positivo, esquina
válida) y solo abre URLs de la central bajo `/monitoreo/`.

## Archivos

- `src/shared/`: lógica pura y probada — `widget-model.ts` (`deriveModel`), `notify-policy.ts`
  (avisos), `login-summary.ts` (`summarize`), `window-position.ts` (`positionFor`, tamaños),
  `health.ts`, `ipc.ts` (contrato del preload), `types.ts` (copiados del motor).
- `src/main/`: `main.ts` (arranque, IPC, resumen), `poller.ts` (paso del bucle), `window.ts`,
  `tray.ts`, `notifier.ts`, `engine-client.ts`, `engine-port.ts`, `store.ts`.
- `src/preload/preload.ts`, `src/renderer/` (React; colores copiados de
  `web/src/pages/availability/availability-ui.ts` en `palette.ts`).
- `assets/`: iconos de bandeja (`tray-<tono>.png` y `@2x`) e `icon.png` (256 px) de la app.

Estado del widget: `widget-state.json` en `%APPDATA%\KUBO Monitor\` (cursor, esquina,
`lastSeenAt`, si ya se registró el arranque con la sesión).

## Desarrollo

```powershell
npm install
npx jest              # pruebas
npm run build         # tipos + main/preload (tsc → out/) + renderer (vite → out/renderer)
npm run dev           # compila y abre Electron (sin registrar el arranque con la sesión)
```

Variables útiles en desarrollo: `KUBO_MONITOR_HOME` (carpeta del motor), `KUBO_MONITOR_PORT`
(puerto de la API local; si no, `localPort` de `engine.json` si es legible, o 47800),
`KUBO_WIDGET_DATA_DIR` (carpeta de `widget-state.json`), `KUBO_WIDGET_DEVTOOLS=1`.
Si la terminal hereda `ELECTRON_RUN_AS_NODE=1` (p. ej. la integrada de algunos editores),
quítela antes de `npm run dev` o Electron arrancará como Node.

En desarrollo los avisos usan como AppUserModelID la ruta de `electron.exe` (Windows los
atribuye a «Electron»); empaquetado usa `com.kubo.monitor.widget`, el del acceso directo que
crea el instalador.

## Empaquetado

```powershell
npm run pack          # = build + electron-builder --win --dir → dist\win-unpacked\KUBO Monitor.exe
npm run dist          # instalador NSIS por usuario (sin elevación) en dist\
```

`electron-builder.yml`: `appId: com.kubo.monitor.widget`, «KUBO Monitor», NSIS `oneClick`,
`perMachine: false`, sin elevación. Sin firma de código.

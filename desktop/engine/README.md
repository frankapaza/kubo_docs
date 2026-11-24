# Motor de la oficina (`desktop/engine`)

Servicio de Windows **«KUBO Monitor Engine»**: la sonda `oficina-01`. Mide los servicios del
inventario desde la oficina (TCP/HTTPS/ICMP con `@kubo/monitoring-core`), guarda cada resultado
en una cola SQLite local y cada 15 s:

1. envía la cola a la central en lotes (≤ 500 checks / 200 señales, en orden de inserción);
2. pide `sync`: aplica la configuración nueva, ejecuta las órdenes («probar ahora», cruzada) y
   guarda el estado combinado para el widget.

Si la central no responde sigue midiendo y acumulando; tras 3 sondeos fallidos seguidos la API
local informa `central.reachable: false`. Al arrancar sin red usa la última configuración y el
último estado guardados.

El `sync` se hace en cada sondeo aunque el envío falle. Si la central rechaza un lote por su
contenido (400 o 413), el motor lo parte por la mitad (siempre un prefijo, sin alterar el orden)
hasta que lo acepte; un único check o señal que siga rechazado sale de la cola a la tabla
`dead_letter` de `engine.db` (con el estado HTTP y un extracto de la respuesta) y queda en el
registro como ERROR. Para revisarlos:
`sqlite3 engine.db "select kind,id,status,error,at from dead_letter"`.

## Compilar

Orden: primero el paquete compartido, luego el motor.

```powershell
cd packages\monitoring-core; npm install; npm run build   # genera dist/, que consume el motor
cd ..\..\desktop\engine;    npm install; npm run build
npx jest                                                    # pruebas del motor
```

`@kubo/monitoring-core` se instala como `file:../../packages/monitoring-core` (enlace al
paquete): si cambia el núcleo hay que volver a compilarlo.

Requisitos de la PC de la oficina: **Node 20 LTS de 64 bits instalado para todo el equipo** con
el instalador oficial (`C:\Program Files\nodejs\node.exe`). **No** sirve un Node por usuario
(nvm, nvm-windows, scoop, fnm, uno dentro de `C:\Users\…`): el servicio corre como
`NT AUTHORITY\LocalService` y ejecuta el mismo `node.exe` con el que se lanzó el instalador
(`process.execPath`), que debe ser legible por esa cuenta. El instalador se niega si no es
Node 20 o si el `node.exe` está bajo un perfil de usuario (`package.json`: `engines.node`
`>=20 <21`). Compile también con Node 20 (`npm install` baja el binario de `better-sqlite3` de la
versión de Node con que se ejecuta; 12.x trae binarios precompilados para Windows x64: no hace
falta Visual Studio ni Python).

## Instalar (como administrador)

1. Instale Node 20 LTS para todo el equipo (ver Requisitos). Copie la carpeta del motor ya compilada (con `node_modules` y `dist`) a una ruta legible por
   la cuenta del servicio, p. ej. `C:\Program Files\KUBO\engine`.
2. Emita el token de la sonda en la web: **Monitoreo → Sondas → oficina-01 → Emitir token**
   (llama a `POST /api/v1/availability/probes/:id/token`, solo ADMIN). El token `kmp_…` se
   muestra una sola vez; emitir otro revoca el anterior.
3. Instale, pasando el token por la entrada estándar (no queda en la línea de órdenes):

   ```powershell
   cd "C:\Program Files\KUBO\engine"
   Read-Host "Token kmp_" | node dist\service\install.js --user OFICINA\ana --central https://docs.kuboti.com --token-stdin
   ```

   - `--user`: el usuario de escritorio que ejecutará el widget (podrá leer el secreto local).
   - `--central`: origen de la central (sin `/api/v1`).
   - `--port`: puerto de la API local (por defecto 47800).
   - `--dry-run`: muestra lo que haría sin tocar nada.

   Volver a ejecutarlo actualiza la configuración (conserva el secreto local y, sin
   `--token-stdin`, el token).

El instalador:

- registra el servicio con WinSW (el `winsw.exe` que trae `node-windows`, en `service\`), que
  arranca `node dist\main.js`;
- con `sc.exe`: **inicio automático** (arranca con Windows, sin iniciar sesión), cuenta
  **`NT AUTHORITY\LocalService`** (mínimos privilegios) y **reinicio ante fallo** (5 s, 30 s,
  60 s; el contador se reinicia a diario);
- crea `%ProgramData%\KUBO\Monitor\` **sin herencia**: SYSTEM y Administradores control total,
  LocalService modificar, y el usuario de escritorio solo puede atravesar la carpeta y leer
  `local-api.secret`.

Desinstalar: `node dist\service\uninstall.js` (conserva los datos; `--purge` los borra).

## Dónde está cada cosa

Todo en `%ProgramData%\KUBO\Monitor\` (o en `KUBO_MONITOR_HOME`, si está definida):

| Archivo | Qué es |
|---|---|
| `engine.json` | `{ centralUrl, probeCode: "oficina-01", localPort: 47800, syncIntervalMs: 15000 }` |
| `token.dat` | token de la sonda cifrado con **DPAPI, ámbito máquina** |
| `local-api.secret` | secreto compartido con el widget (cabecera `X-Kubo-Secret`) |
| `engine.db` | SQLite: cola de envío, `dead_letter`, última configuración y último estado combinado |
| `logs\engine-AAAA-MM-DD.log` | registro del motor (rota a diario y a los 10 MB; 14 días) |
| `logs\KuboMonitorEngine.*.log` | salida capturada por WinSW |

**DPAPI:** se usa `System.Security.Cryptography.ProtectedData` mediante una llamada corta a
Windows PowerShell 5.1 (viene con Windows), así no hay módulo nativo que compilar. El ámbito es
máquina (lo necesita la cuenta del servicio), así que la protección del archivo la da la ACL de
la carpeta. Fuera de Windows (solo pruebas) se acepta un archivo en claro únicamente con
`KUBO_MONITOR_INSECURE_PLAIN_TOKEN=1`.

## API local (para el widget)

Escucha solo en `127.0.0.1:{localPort}`. Toda petición exige `X-Kubo-Secret`.

```powershell
curl.exe -H "X-Kubo-Secret: $(Get-Content $env:ProgramData\KUBO\Monitor\local-api.secret)" http://127.0.0.1:47800/v1/status
```

`GET /v1/status` →

```ts
{ engine: { version, startedAt },
  central: { reachable, lastSyncAt, consecutiveFailures },
  officeOutage, pending,
  services: CombinedStateRow[] }   // con la central caída, la columna office es el estado local
```

Sin secreto o con uno incorrecto: 401. Cualquier otra ruta: 404.

## Ejecutar en primer plano (desarrollo)

```powershell
$env:KUBO_MONITOR_HOME = "C:\temp\kubo-monitor"   # con engine.json, token.dat y local-api.secret
node dist\main.js
```

Para crear `token.dat` en esa carpeta sin el instalador:
`node -e "require('./dist/config').saveProbeToken(process.argv[1])" kmp_…` (con `KUBO_MONITOR_HOME` definido).

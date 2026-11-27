# Agente de servidor de KUBO Monitoreo

Servicio de Windows (`KuboAgent`) que envía cada minuto los recursos del servidor a la central de KUBO Monitoreo. Es un único ejecutable autocontenido (`kubo-agent.exe`, .NET 10, win-x64): el servidor no necesita tener .NET instalado.

> **Autorización del cliente.** Instalar el agente en un servidor del cliente (por ejemplo, los VPS de Contacto Eficaz) requiere su **autorización por escrito** antes de empezar. Sin ella no se instala.

## Qué envía

Cada 60 s (o el intervalo que indique la central, entre 30 y 600 s) hace un `POST https://<central>/api/v1/ingest/probe/agent/samples` con `Authorization: Bearer kma_…` y este JSON:

```json
{
  "agentVersion": "1.0.0",
  "cpuPct": 12.5,
  "ramPct": 61.2,
  "disks": [{ "name": "C:", "totalBytes": 107374182400, "freeBytes": 9663676416 }],
  "iisPools": [{ "name": "DefaultAppPool", "state": "Started" }],
  "services": [{ "name": "W3SVC", "status": "Running" }],
  "eventErrors": { "system": 0, "application": 3 }
}
```

- **CPU:** contador `Processor / % Processor Time / _Total`, promedio desde la muestra anterior.
- **RAM:** memoria física en uso (`GlobalMemoryStatusEx`).
- **Discos:** unidades fijas listas, con su tamaño y espacio libre.
- **IIS:** estado de cada grupo de aplicaciones. `null` si el servidor no tiene IIS.
- **Servicios:** estado de los servicios de Windows que la central pide vigilar (se configuran en la web y llegan en cada respuesta). Uno que no existe aparece como `NotFound`.
- **Visor de eventos:** cantidad de eventos de error y críticos nuevos en Sistema y Aplicación desde la muestra anterior (la primera muestra siempre envía 0).

El agente **solo envía datos** por HTTPS saliente, con la validación TLS normal de Windows (nunca se desactiva). No abre puertos, no recibe órdenes ni ejecuta nada: de la respuesta de la central solo lee la lista de servicios a vigilar y el intervalo. Si un envío falla, esa muestra se descarta (no hay cola) y queda registrada.

## Compilar

Requiere el SDK de .NET 10.

```powershell
cd agent
dotnet test                                                # pruebas (solo Windows: usan DPAPI)
powershell -ExecutionPolicy Bypass -File .\build.ps1      # genera agent\publish\kubo-agent.exe
```

`build.ps1` ejecuta `dotnet publish src/KuboAgent -c Release -o publish` e imprime el SHA-256 del ejecutable. No instala nada en la PC donde se compila. `agent/publish/` no se versiona.

## Instalar en un servidor

1. Confirme que existe la autorización escrita del cliente.
2. En la web: **Monitoreo → Sondas → Agentes**, elija el servidor y genere su token. Se descarga `install-kubo-agent.ps1`, que ya lleva la URL de la central y el token (se muestra una sola vez).
3. Copie al servidor, **en la misma carpeta**, `install-kubo-agent.ps1` y `kubo-agent.exe` (de `agent\publish\`).
4. Como el script viene de internet, desbloquéelo con `Unblock-File .\install-kubo-agent.ps1`, o ejecútelo con `-ExecutionPolicy Bypass`.
5. Abra PowerShell **como administrador** en esa carpeta y ejecute:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-kubo-agent.ps1
   ```

   El script copia el ejecutable a `C:\Program Files\KUBO\Agent\`, ejecuta `kubo-agent.exe configure --central <url> --token <token>` (guarda `%ProgramData%\KUBO\Agent\agent.json` con el token protegido con DPAPI, dueño Administradores y acceso solo para SYSTEM y Administradores; si la carpeta o alguna de sus carpetas padre es una unión o un enlace simbólico, se niega a escribir) y crea el servicio `KuboAgent` como LocalSystem, con inicio automático y reinicio ante fallos (también si el proceso termina con un código de salida distinto de cero: `sc.exe failureflag KuboAgent 1`). Si el servicio ya existía, lo actualiza.
6. **Borre `install-kubo-agent.ps1`** del servidor (y de donde lo haya descargado): contiene el token en claro.
7. En la web, el servidor debe aparecer con datos en **Monitoreo → Servidores** en uno o dos minutos.

Para cambiar el token (por ejemplo, si se filtró): revóquelo en la web, genere uno nuevo y vuelva a ejecutar el instalador nuevo. Con un token revocado el agente registra «token inválido o revocado» y sigue intentando cada intervalo.

## Desinstalar

Copie `agent\uninstall-kubo-agent.ps1` al servidor y ejecútelo como administrador:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-kubo-agent.ps1
```

Detiene y elimina el servicio `KuboAgent` y borra `C:\Program Files\KUBO\Agent` y `%ProgramData%\KUBO\Agent`. Con `-QuitarOrigenEventos` también elimina el origen `KuboAgent` del Visor de eventos. Después, revoque el token del servidor en **Monitoreo → Sondas → Agentes**.

## Diagnóstico

- **`kubo-agent.exe once`** toma una muestra del equipo y la imprime en JSON, sin enviar nada. Sirve para comprobar qué leería el agente. Se pueden agregar nombres de servicios para ver su estado: `kubo-agent.exe once W3SVC MSSQLSERVER`. Para ver los grupos de IIS hay que ejecutarlo como administrador (sin elevar, `iisPools` sale `null`).
- **Visor de eventos → Registros de Windows → Aplicación**, origen **`KuboAgent`**: arranque del servicio, primera muestra aceptada, errores de envío (401 token inválido o revocado, 400, 413, sin conexión) y su recuperación. Un mismo fallo repetido se vuelve a registrar una vez por hora, no en cada muestra.
- `Get-Service KuboAgent` muestra si el servicio está en marcha. Si no arranca, revise en el Visor de eventos el mensaje sobre `agent.json` (falta configurar o la configuración no es válida).
- `kubo-agent.exe --version` imprime la versión.

El origen `KuboAgent` lo crea el propio servicio la primera vez (corre como LocalSystem). Si el ejecutable corre sin permisos para crearlo, sigue funcionando sin registrar en el Visor de eventos.

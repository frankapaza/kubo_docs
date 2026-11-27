#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Desinstala el agente de KUBO Monitoreo de este servidor.

.DESCRIPTION
  Detiene y elimina el servicio KuboAgent, borra C:\Program Files\KUBO\Agent y la configuración
  (%ProgramData%\KUBO\Agent, que guarda el token protegido). El origen KuboAgent del Visor de
  eventos se conserva para que los eventos ya registrados se sigan leyendo; con -QuitarOrigenEventos
  también se elimina.

  Después, revoque el token del servidor en Monitoreo → Sondas → Agentes.

  Uso (como administrador):  powershell -ExecutionPolicy Bypass -File .\uninstall-kubo-agent.ps1
#>
param(
  [switch]$QuitarOrigenEventos
)
$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Este script debe ejecutarse como administrador.'
}

$programa = 'C:\Program Files\KUBO\Agent'
$datos = Join-Path $env:ProgramData 'KUBO\Agent'
$exe = Join-Path $programa 'kubo-agent.exe'

$servicio = Get-Service -Name KuboAgent -ErrorAction SilentlyContinue
if ($servicio) {
  if ($servicio.Status -ne 'Stopped') {
    try {
      Stop-Service -Name KuboAgent -Force -ErrorAction Stop
      $servicio.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    } catch {
      # Si no se detiene a tiempo se sigue igual: sc.exe delete lo marca para borrar y abajo se espera el proceso.
      Write-Warning "El servicio KuboAgent no se detuvo a tiempo: $($_.Exception.Message)"
    }
  }
  $p = Start-Process -FilePath 'sc.exe' -ArgumentList 'delete KuboAgent' -Wait -NoNewWindow -PassThru
  if ($p.ExitCode -ne 0) { throw "sc.exe delete KuboAgent terminó con código $($p.ExitCode)" }
  Write-Host 'Servicio KuboAgent eliminado.'
} else {
  Write-Host 'El servicio KuboAgent no estaba instalado.'
}

# El proceso puede tardar en salir después de detener el servicio: se espera hasta 30 s y, si sigue,
# se termina. Solo el ejecutable instalado (no un "kubo-agent once" lanzado desde otra carpeta).
$procesos = @(Get-Process -Name 'kubo-agent' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
foreach ($proceso in $procesos) {
  if (-not $proceso.WaitForExit(30000)) { Stop-Process -Id $proceso.Id -Force -ErrorAction SilentlyContinue }
}

# Borrado con reintentos: justo después de terminar el proceso, Windows puede tardar en soltar el .exe.
function Remove-ConReintentos([string]$ruta) {
  for ($intento = 1; $intento -le 5; $intento++) {
    try {
      Remove-Item -LiteralPath $ruta -Recurse -Force -ErrorAction Stop
      return
    } catch {
      if ($intento -eq 5) { throw "No se pudo borrar ${ruta}: $($_.Exception.Message)" }
      Start-Sleep -Seconds 2
    }
  }
}

foreach ($carpeta in $programa, $datos) {
  if (Test-Path -LiteralPath $carpeta) {
    Remove-ConReintentos $carpeta
    Write-Host "Eliminado: $carpeta"
  }
}
# Las carpetas KUBO padre se quitan solo si quedaron vacías.
foreach ($padre in 'C:\Program Files\KUBO', (Join-Path $env:ProgramData 'KUBO')) {
  if ((Test-Path -LiteralPath $padre) -and -not (Get-ChildItem -LiteralPath $padre -Force)) {
    Remove-Item -LiteralPath $padre -Force
  }
}

if ($QuitarOrigenEventos -and [System.Diagnostics.EventLog]::SourceExists('KuboAgent')) {
  [System.Diagnostics.EventLog]::DeleteEventSource('KuboAgent')
  Write-Host 'Origen KuboAgent del Visor de eventos eliminado.'
}

Write-Host 'Agente de KUBO desinstalado. Revoque su token en Monitoreo → Sondas → Agentes.'

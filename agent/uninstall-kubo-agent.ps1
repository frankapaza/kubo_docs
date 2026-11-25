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

$servicio = Get-Service -Name KuboAgent -ErrorAction SilentlyContinue
if ($servicio) {
  if ($servicio.Status -ne 'Stopped') {
    Stop-Service -Name KuboAgent -Force
    $servicio.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
  }
  $p = Start-Process -FilePath 'sc.exe' -ArgumentList 'delete KuboAgent' -Wait -NoNewWindow -PassThru
  if ($p.ExitCode -ne 0) { throw "sc.exe delete KuboAgent terminó con código $($p.ExitCode)" }
  Write-Host 'Servicio KuboAgent eliminado.'
} else {
  Write-Host 'El servicio KuboAgent no estaba instalado.'
}

foreach ($carpeta in $programa, $datos) {
  if (Test-Path -LiteralPath $carpeta) {
    Remove-Item -LiteralPath $carpeta -Recurse -Force
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

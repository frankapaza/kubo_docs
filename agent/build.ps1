<#
.SYNOPSIS
  Publica el agente de KUBO Monitoreo: agent/publish/kubo-agent.exe.

.DESCRIPTION
  Un único ejecutable autocontenido (win-x64, .NET 10): el servidor no necesita tener .NET instalado.
  Ese kubo-agent.exe es el que se copia junto a install-kubo-agent.ps1 (se descarga desde
  Monitoreo → Sondas → Agentes). Este script no instala nada en esta PC.

  Compatible con Windows PowerShell 5.1 y PowerShell 7. Requiere el SDK de .NET 10 en el PATH.

  Uso:  powershell -ExecutionPolicy Bypass -File agent/build.ps1
#>
$ErrorActionPreference = 'Stop'

$agente = $PSScriptRoot
$salida = Join-Path $agente 'publish'

Push-Location $agente
try {
  if (Test-Path $salida) { Remove-Item -Recurse -Force $salida }
  & dotnet publish src/KuboAgent -c Release -o publish
  # dotnet no lanza excepción al fallar: se comprueba el código de salida a mano.
  if ($LASTEXITCODE -ne 0) { throw "Falló dotnet publish (código $LASTEXITCODE)" }
} finally { Pop-Location }

$exe = Join-Path $salida 'kubo-agent.exe'
if (-not (Test-Path $exe)) { throw "No se generó $exe" }

$tamano = [math]::Round((Get-Item $exe).Length / 1MB, 1)
$sha = (Get-FileHash -Algorithm SHA256 $exe).Hash.ToLowerInvariant()
Write-Host "Listo: $exe ($tamano MB)"
Write-Host "SHA-256: $sha"

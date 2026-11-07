<#
.SYNOPSIS
  Prueba, compila y empaqueta el appender de log4net para que DevDocs lo sirva.

.DESCRIPTION
  Por qué se compila aquí y no en Docker: la imagen del backend no tiene el SDK de .NET (y no debe
  tenerlo: pesaría cientos de MB para un artefacto que cambia rara vez). El paquete se arma en la
  máquina del equipo y se VERSIONA en backend/assets/kubo-log-appender/; el backend solo lo lee y lo
  sirve. La prueba backend/src/modules/monitoring/appender-assets.spec.ts avisa si se cambia el
  appender sin volver a correr este script.

  Compatible con Windows PowerShell 5.1. Requiere: dotnet SDK y Node (npx) en el PATH.

  Uso:  powershell -ExecutionPolicy Bypass -File tools/kubo-log-appender/build.ps1
#>
$ErrorActionPreference = 'Stop'

$raiz      = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$appender  = $PSScriptRoot
$assets    = Join-Path $raiz 'backend\assets\kubo-log-appender'
$utf8SinBom = New-Object System.Text.UTF8Encoding($false)

function Ejecutar([string]$que, [scriptblock]$bloque) {
  # Los ejecutables nativos no lanzan excepción al fallar: se comprueba el código de salida a mano.
  & $bloque
  if ($LASTEXITCODE -ne 0) { throw "Falló: $que (código $LASTEXITCODE)" }
}

# 1) Versión: la única fuente es Directory.Build.props (la prueba del backend la compara con el manifest).
[xml]$props = Get-Content -Raw -Encoding UTF8 (Join-Path $appender 'Directory.Build.props')
$version = ($props.Project.PropertyGroup | Where-Object { $_.Version } | Select-Object -First 1).Version
if (-not $version) { throw 'No se encontró <Version> en Directory.Build.props.' }
Write-Host "Versión del appender: $version"

# 2) Pruebas y compilación Release de las tres variantes (net45, net462, netstandard2.0).
Push-Location $appender
try {
  Ejecutar 'dotnet test' { dotnet test Kubo.Log4Net.sln -c Release }
  Ejecutar 'dotnet build' { dotnet build src/Kubo.Log4Net -c Release }
} finally { Pop-Location }

# 3) Diseño del paquete: un directorio raíz con la versión, como espera quien descomprime.
$nombre   = "kubo-log-appender-$version"
$salida   = Join-Path $appender 'out'
$paquete  = Join-Path $salida $nombre
if (Test-Path $salida) { Remove-Item -Recurse -Force $salida }
New-Item -ItemType Directory -Force -Path $paquete | Out-Null

# Cada variante de log4net en su carpeta: la persona que implementa elige según su versión.
$variantes = @(
  @{ tfm = 'net45';         destino = 'log4net-2.x/net45' },
  @{ tfm = 'net462';        destino = 'log4net-3.x/net462' },
  @{ tfm = 'netstandard2.0'; destino = 'log4net-3.x/netstandard2.0' }
)
foreach ($v in $variantes) {
  $dll = Join-Path $appender "src\Kubo.Log4Net\bin\Release\$($v.tfm)\Kubo.Log4Net.dll"
  if (-not (Test-Path $dll)) { throw "No se compiló $($v.tfm): falta $dll" }
  $dir = Join-Path $paquete ($v.destino -replace '/', '\')
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Copy-Item $dll $dir
}
# Se normaliza a LF: con core.autocrlf, un clon en Windows trae estos textos con CRLF y el zip (y su
# SHA-256) saldría distinto en cada máquina aunque el contenido sea el mismo.
foreach ($txt in 'MANUAL.md', 'ejemplo-log4net.config') {
  $contenido = [IO.File]::ReadAllText((Join-Path $appender $txt), $utf8SinBom).Replace("`r`n", "`n")
  [IO.File]::WriteAllText((Join-Path $paquete $txt), $contenido, $utf8SinBom)
}

# 4) MANUAL.html: marked (solo herramienta de compilación, no es dependencia del appender) convierte el
#    Markdown y el resultado se inserta en la plantilla, que lleva el CSS en línea (sin recursos externos).
#    Se usa -o y no la salida estándar: PowerShell 5.1 decodifica el stdout con la página OEM y rompería las tildes.
$cuerpoTmp = Join-Path $salida 'cuerpo.html'
Push-Location $appender
try {
  Ejecutar 'marked' { npx --yes marked@12.0.2 -i MANUAL.md -o $cuerpoTmp }
} finally { Pop-Location }
$cuerpo   = [IO.File]::ReadAllText($cuerpoTmp, $utf8SinBom).Replace("`r`n", "`n")
$plantilla = [IO.File]::ReadAllText((Join-Path $appender 'manual-template.html'), $utf8SinBom).Replace("`r`n", "`n")
if (-not $plantilla.Contains('<!--CONTENIDO-->')) { throw 'manual-template.html no tiene el marcador <!--CONTENIDO-->.' }
# Replace(string,string) es literal: el HTML generado puede traer "$" que Regex.Replace interpretaría.
$html = $plantilla.Replace('<!--CONTENIDO-->', $cuerpo)
[IO.File]::WriteAllText((Join-Path $paquete 'MANUAL.html'), $html, $utf8SinBom)
Remove-Item $cuerpoTmp

# 5) Zip con System.IO.Compression y no con Compress-Archive: en PowerShell 5.1 este último escribe las
#    entradas con "\" y el zip no se extrae bien en Linux (donde corre el backend) ni en algunas herramientas.
#    Además se ordenan las entradas y se fija la fecha de todas a una constante: así, sin cambios en el
#    código, el zip sale byte a byte igual y "git status" no muestra diferencias en backend/assets/.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = Join-Path $salida "$nombre.zip"
$fechaFija = New-Object System.DateTimeOffset (2026, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
$fs = [IO.File]::Open($zipPath, [IO.FileMode]::Create)
try {
  $zip = New-Object System.IO.Compression.ZipArchive ($fs, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    $base = (Get-Item $salida).FullName.TrimEnd('\') + '\'
    $archivos = Get-ChildItem -Recurse -File $paquete | Sort-Object { $_.FullName.Substring($base.Length).Replace('\', '/') }
    foreach ($f in $archivos) {
      $entrada = $f.FullName.Substring($base.Length).Replace('\', '/')
      $e = $zip.CreateEntry($entrada, [System.IO.Compression.CompressionLevel]::Optimal)
      $e.LastWriteTime = $fechaFija
      $origen = [IO.File]::OpenRead($f.FullName)
      $destino = $e.Open()
      try { $origen.CopyTo($destino) } finally { $destino.Dispose(); $origen.Dispose() }
    }
  } finally { $zip.Dispose() }
} finally { $fs.Dispose() }

# 6) Al directorio versionado del backend: se borran los zip anteriores para que no se acumulen versiones.
New-Item -ItemType Directory -Force -Path $assets | Out-Null
Get-ChildItem $assets -Filter 'kubo-log-appender-*.zip' | Remove-Item -Force
Copy-Item $zipPath $assets
Copy-Item (Join-Path $paquete 'MANUAL.md') $assets
Copy-Item (Join-Path $paquete 'MANUAL.html') $assets

$sha = (Get-FileHash -Algorithm SHA256 (Join-Path $assets "$nombre.zip")).Hash.ToLowerInvariant()

# generatedAt: si el zip no cambió (mismo SHA-256), se conserva la fecha del manifest anterior; si no, cada
# corrida inventaría una hora nueva y "git status" mostraría cambios sin que haya cambiado nada.
$manifestPath = Join-Path $assets 'manifest.json'
$generatedAt = $null
if (Test-Path $manifestPath) {
  try {
    $previo = [IO.File]::ReadAllText($manifestPath, $utf8SinBom) | ConvertFrom-Json
    if ($previo.sha256 -eq $sha -and $previo.version -eq $version) { $generatedAt = $previo.generatedAt }
  } catch { }
}
if (-not $generatedAt) { $generatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }

# JSON a mano: orden de campos fijo y fin de línea LF, para que no dependa de la versión de PowerShell.
$manifest = @(
  '{',
  "  `"version`": `"$version`",",
  "  `"zip`": `"$nombre.zip`",",
  "  `"sha256`": `"$sha`",",
  '  "manualMd": "MANUAL.md",',
  '  "manualHtml": "MANUAL.html",',
  "  `"generatedAt`": `"$generatedAt`"",
  '}'
) -join "`n"
[IO.File]::WriteAllText($manifestPath, $manifest + "`n", $utf8SinBom)

Write-Host "Listo: $assets"
Get-ChildItem $assets | Select-Object Name, Length | Format-Table -AutoSize

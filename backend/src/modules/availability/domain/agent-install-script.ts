/** Literal de PowerShell entre comillas simples: la única secuencia especial es `'`, que se duplica. */
export function psSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Script `install-kubo-agent.ps1` (decisión 2): se copia junto a
 * `kubo-agent.exe` y se ejecuta como administrador en el servidor. Copia el
 * ejecutable a Program Files, lo configura con la central y el token, y crea
 * (o actualiza) el servicio `KuboAgent` como LocalSystem (decisión 4), con
 * reinicio automático ante fallos. La URL y el token van como literales entre
 * comillas simples: nada se interpola.
 *
 * `sc.exe` se llama con `Start-Process` y la línea de argumentos completa: así
 * las comillas de `binPath=` (ruta con espacios) llegan igual en Windows
 * PowerShell 5.1 y en PowerShell 7.
 */
export function buildInstallScript(centralUrl: string, token: string): string {
  const lines = [
    '#Requires -RunAsAdministrator',
    '# Instalador del agente de KUBO Monitoreo. Ejecutar como administrador, junto a kubo-agent.exe.',
    `$ErrorActionPreference = 'Stop'`,
    '',
    '$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())',
    'if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {',
    `  throw 'Este script debe ejecutarse como administrador.'`,
    '}',
    '',
    `$central = ${psSingleQuoted(centralUrl)}`,
    `$token = ${psSingleQuoted(token)}`,
    `$origen = Join-Path $PSScriptRoot 'kubo-agent.exe'`,
    `$destino = 'C:\\Program Files\\KUBO\\Agent'`,
    `$exe = Join-Path $destino 'kubo-agent.exe'`,
    '',
    'if (-not (Test-Path -LiteralPath $origen)) {',
    `  throw 'No se encontró kubo-agent.exe en la carpeta de este script.'`,
    '}',
    '',
    'function Invoke-Sc([string]$argumentos) {',
    `  $p = Start-Process -FilePath 'sc.exe' -ArgumentList $argumentos -Wait -NoNewWindow -PassThru`,
    '  if ($p.ExitCode -ne 0) { throw "sc.exe $argumentos terminó con código $($p.ExitCode)" }',
    '}',
    '',
    '# Si ya estaba instalado, se detiene para poder reemplazar el ejecutable.',
    '$servicio = Get-Service -Name KuboAgent -ErrorAction SilentlyContinue',
    `if ($servicio -and $servicio.Status -ne 'Stopped') { Stop-Service -Name KuboAgent -Force }`,
    '',
    'New-Item -ItemType Directory -Force -Path $destino | Out-Null',
    'Copy-Item -LiteralPath $origen -Destination $exe -Force',
    '',
    '& $exe configure --central $central --token $token',
    'if ($LASTEXITCODE -ne 0) { throw "kubo-agent.exe configure terminó con código $LASTEXITCODE" }',
    '',
    '# binPath= "\\"C:\\Program Files\\...\\kubo-agent.exe\\"": la ruta queda entre comillas en el servicio.',
    `$binPath = 'binPath= "\\"' + $exe + '\\""'`,
    'if ($servicio) {',
    '  Invoke-Sc "config KuboAgent $binPath start= auto obj= LocalSystem"',
    '} else {',
    '  Invoke-Sc "create KuboAgent $binPath start= auto obj= LocalSystem DisplayName= `"KUBO Agent`""',
    '}',
    `Invoke-Sc 'failure KuboAgent reset= 86400 actions= restart/60000/restart/60000/restart/60000'`,
    `Invoke-Sc 'failureflag KuboAgent 1'`,
    '',
    'Start-Service -Name KuboAgent',
    `Write-Host 'Agente de KUBO instalado y en marcha.'`,
    '',
  ];
  return lines.join('\r\n');
}

# Descarga las canciones originales del sitio a musica\.
# Uso:  powershell -ExecutionPolicy Bypass -File descargar-musica.ps1
# (No son código: son ~56 MB de MP3. El juego funciona igual sin ellas,
#  solo que no suena la música.)

$ErrorActionPreference = 'Stop'
$base = 'https://chaula.et20.edu.ar/'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$lista = Get-Content (Join-Path $raiz 'api\musica.json') -Raw | ConvertFrom-Json

$urls = @($lista.menu) + @($lista.partido) | Sort-Object -Unique

foreach ($ruta in $urls) {
    $relativa = [System.Uri]::UnescapeDataString($ruta.TrimStart('/')).Replace('/', '\')
    $destino = Join-Path $raiz $relativa
    New-Item -ItemType Directory -Force -Path (Split-Path $destino) | Out-Null
    if (Test-Path $destino) { "Ya existe: $relativa"; continue }
    "Bajando: $relativa"
    Invoke-WebRequest -Uri ($base + $ruta.TrimStart('/')) -OutFile $destino -UseBasicParsing
}

"Listo."

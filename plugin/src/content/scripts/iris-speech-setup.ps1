param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Set-SetupStage([string]$Stage) {
  $stagePath = Join-Path $Root 'setup-progress.json'
  [IO.File]::WriteAllText(($stagePath + '.tmp'), ('{"stage":"' + $Stage + '"}'))
  Move-Item -LiteralPath ($stagePath + '.tmp') -Destination $stagePath -Force
}
try {
  New-Item -ItemType Directory -Path $Root -Force | Out-Null
  Set-SetupStage 'components'
  $uvPath = Join-Path $Root 'uv.exe'
  if (-not (Test-Path -LiteralPath $uvPath)) {
    $asset = 'uv-x86_64-pc-windows-msvc.zip'
    $base = 'https://github.com/astral-sh/uv/releases/download/0.11.30/'
    $zip = Join-Path $Root $asset
    Invoke-WebRequest -UseBasicParsing -Uri ($base + $asset) -OutFile $zip -TimeoutSec 300
    $checksumPath = Join-Path $Root ($asset + '.sha256')
    Invoke-WebRequest -UseBasicParsing -Uri ($base + $asset + '.sha256') -OutFile $checksumPath -TimeoutSec 120
    $checksum = (Get-Content -LiteralPath $checksumPath -Raw).Trim().Split(' ')[0]
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $checksum) { throw 'uv download checksum mismatch' }
    Expand-Archive -LiteralPath $zip -DestinationPath $Root -Force
  }
  $env:UV_PYTHON_INSTALL_DIR = Join-Path $Root 'python'
  $env:UV_CACHE_DIR = Join-Path $Root 'cache'
  $env:UV_HTTP_TIMEOUT = '60'
  $env:UV_HTTP_RETRIES = '2'
  $venv = Join-Path $Root 'venv'
  $python = Join-Path $venv 'Scripts\python.exe'
  Set-SetupStage 'python'
  if (-not (Test-Path -LiteralPath $python)) {
    & $uvPath venv --python 3.12 --managed-python $venv
    if ($LASTEXITCODE -ne 0) { throw 'Local Python installation failed' }
  }
  Set-SetupStage 'engine'
  & $uvPath pip install --python $python 'faster-whisper==1.2.1' 'sounddevice==0.5.3' 'huggingface-hub==1.30.0'
  if ($LASTEXITCODE -ne 0) { throw 'Speech engine installation failed' }
  Set-SetupStage 'model'
  & $python (Join-Path $Root 'iris-speech.py') setup --root $Root
  if ($LASTEXITCODE -ne 0) {
    $detailPath = Join-Path $Root 'setup-error.txt'
    $detail = if (Test-Path -LiteralPath $detailPath) { [IO.File]::ReadAllText($detailPath) } else { '' }
    throw ('Speech model download or validation failed. ' + $detail)
  }
  exit 0
} catch {
  [IO.File]::WriteAllText((Join-Path $Root 'setup-error.txt'), $_.Exception.Message)
  exit 1
}

param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  New-Item -ItemType Directory -Path $Root -Force | Out-Null
  $uvPath = Join-Path $Root 'uv.exe'
  if (-not (Test-Path -LiteralPath $uvPath)) {
    $asset = 'uv-x86_64-pc-windows-msvc.zip'
    $base = 'https://github.com/astral-sh/uv/releases/download/0.11.30/'
    $zip = Join-Path $Root $asset
    Invoke-WebRequest -UseBasicParsing -Uri ($base + $asset) -OutFile $zip
    $checksumPath = Join-Path $Root ($asset + '.sha256')
    Invoke-WebRequest -UseBasicParsing -Uri ($base + $asset + '.sha256') -OutFile $checksumPath
    $checksum = (Get-Content -LiteralPath $checksumPath -Raw).Trim().Split(' ')[0]
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $checksum) { throw 'uv download checksum mismatch' }
    Expand-Archive -LiteralPath $zip -DestinationPath $Root -Force
  }
  $env:UV_PYTHON_INSTALL_DIR = Join-Path $Root 'python'
  $env:UV_CACHE_DIR = Join-Path $Root 'cache'
  $venv = Join-Path $Root 'venv'
  $python = Join-Path $venv 'Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $python)) {
    & $uvPath venv --python 3.12 --managed-python $venv
    if ($LASTEXITCODE -ne 0) { throw 'Local Python installation failed' }
  }
  & $uvPath pip install --python $python 'faster-whisper==1.2.1' 'sounddevice==0.5.3'
  if ($LASTEXITCODE -ne 0) { throw 'Speech engine installation failed' }
  & $python (Join-Path $Root 'iris-speech.py') setup --root $Root
  if ($LASTEXITCODE -ne 0) { throw 'Speech model download or validation failed' }
  exit 0
} catch {
  [IO.File]::WriteAllText((Join-Path $Root 'setup-error.txt'), $_.Exception.Message)
  exit 1
}

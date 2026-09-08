#!/bin/sh
set -eu
root=$1
mkdir -p "$root"
exec 2>"$root/setup-error.txt"
case "$(uname -sm)" in
  'Darwin arm64') asset=uv-aarch64-apple-darwin ;;
  'Darwin x86_64') asset=uv-x86_64-apple-darwin ;;
  *) echo 'Automatic offline speech installation supports Windows and macOS.' >&2; exit 1 ;;
esac
if [ ! -x "$root/$asset/uv" ]; then
  base=https://github.com/astral-sh/uv/releases/download/0.11.30
  curl --fail --location "$base/$asset.tar.gz" -o "$root/$asset.tar.gz"
  curl --fail --location "$base/$asset.tar.gz.sha256" -o "$root/$asset.tar.gz.sha256"
  expected=$(cut -d ' ' -f 1 "$root/$asset.tar.gz.sha256")
  actual=$(shasum -a 256 "$root/$asset.tar.gz" | cut -d ' ' -f 1)
  [ "$actual" = "$expected" ] || { echo 'uv download checksum mismatch' >&2; exit 1; }
  tar -xzf "$root/$asset.tar.gz" -C "$root"
fi
export UV_PYTHON_INSTALL_DIR="$root/python"
export UV_CACHE_DIR="$root/cache"
uv="$root/$asset/uv"
if [ ! -x "$root/venv/bin/python" ]; then
  "$uv" venv --python 3.12 --managed-python "$root/venv"
fi
"$uv" pip install --python "$root/venv/bin/python" 'faster-whisper==1.2.1' 'sounddevice==0.5.3'
"$root/venv/bin/python" "$root/iris-speech.py" setup --root "$root"

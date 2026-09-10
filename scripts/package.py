"""Build reproducible Zotero assets from an explicit source-only allowlist."""
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent.parent
config = json.loads((ROOT / 'release.json').read_text(encoding='utf-8'))
version = config['version']
if not re.fullmatch(r'\d+\.\d+\.\d+(?:\.\d+)?', version):
    raise ValueError('Only stable numeric versions are supported')
source = ROOT / 'plugin' / 'src'
manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
assert manifest['version'] == version, 'Run npm run build first'
assert (source / 'content/scripts/aidea.js').is_file(), 'Generated bundle is missing'
assert manifest['applications']['zotero']['id'] == 'aidea@visterainer'
assert manifest['applications']['zotero']['update_url'] == f"https://github.com/{config['repository']}/releases/latest/download/updates.json"
assert (source / 'content/scripts/iris-voice-macos/IrisVoice.zip').is_file(), 'Run sh scripts/build-macos-voice.sh on macOS first'
output = ROOT / 'dist'
output.mkdir(exist_ok=True)
name = f'Iris-{version}.xpi'
files = []
for path in source.rglob('*'):
    if not path.is_file():
        continue
    relative = path.relative_to(source)
    if 'iris-voice-macos' in relative.parts and path.name != 'IrisVoice.zip':
        continue
    if '__pycache__' in relative.parts or path.suffix in ('.pyc', '.log'):
        continue
    if relative.parts[0] not in ('content', 'locale', 'scripts') and str(relative) not in ('bootstrap.js', 'manifest.json', 'prefs.js'):
        raise ValueError(f'Unexpected package file: {relative}')
    if 'OpenAISans' in path.name or path.suffix.lower() in ('.sqlite', '.pdf', '.wav', '.mp3'):
        raise ValueError(f'Non-distributable file: {relative}')
    files.append((relative.as_posix(), path))
files.extend([('LICENSE', ROOT/'LICENSE'), ('THIRD_PARTY_NOTICES.md', ROOT/'THIRD_PARTY_NOTICES.md'), ('IRIS-NOTICES.md', ROOT/'docs/PROVENANCE.md')])
with zipfile.ZipFile(output/name, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for arcname, path in sorted(files):
        info = zipfile.ZipInfo(arcname, date_time=(2026, 1, 1, 0, 0, 0))
        info.create_system = 3  # Stable archive metadata on Windows and Linux.
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, path.read_bytes())
digest = hashlib.sha256((output/name).read_bytes()).hexdigest()
updates = {'addons': {manifest['applications']['zotero']['id']: {'updates': [{
    'version': version,
    'update_link': f"https://github.com/{config['repository']}/releases/download/v{version}/{name}",
    'update_hash': f'sha256:{digest}',
    'applications': {'zotero': {key: manifest['applications']['zotero'][key] for key in ('strict_min_version','strict_max_version')}}
}]}}}
(output/'updates.json').write_text(json.dumps(updates, indent=2)+'\n', encoding='utf-8')
(output/'SHA256SUMS.txt').write_text(f'{digest}  {name}\n', encoding='utf-8')
with zipfile.ZipFile(output/name) as archive:
    assert archive.testzip() is None
    assert json.loads(archive.read('manifest.json')) == manifest
print(f'{name}: {len(files)} files; SHA-256 {digest}')

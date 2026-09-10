"""Iris offline multilingual dictation. Only the explicit setup command uses a network."""
import argparse
import json
import os
from pathlib import Path
import sys
import time
import threading

VERSION = 1


def write_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    temporary.replace(path)


def disable_network():
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['DO_NOT_TRACK'] = '1'
    # Fail closed even if a future dependency attempts an HTTP request.
    def audit(event, args):
        if event in ('socket.connect', 'socket.connect_ex', 'socket.getaddrinfo', 'socket.sendto'):
            raise RuntimeError('Network access is disabled during Iris dictation')
    sys.addaudithook(audit)


def load_model(root):
    from faster_whisper import WhisperModel
    return WhisperModel(str(root / 'model'), device='cpu', compute_type='int8',
                        cpu_threads=min(8, os.cpu_count() or 4), local_files_only=True)


def model_progress_class(root, base, total_bytes):
    """Observe Hub's reconstructed bytes, including resumed bytes, not file sizes.

    The pinned Hub version supplies separate network and reconstruction bars.
    Count only the latter to avoid counting each byte twice. A metadata dry run
    provides the fixed total; the bar's evolving partial total is never used.
    """
    lock = threading.RLock()
    last_write = [0.0]

    class ModelProgress(base):
        enabled = True
        def __init__(self, *args, **kwargs):
            self.report_model = kwargs.get('unit') == 'B' and kwargs.get('desc', '').startswith('Reconstructing')
            kwargs['disable'] = False
            super().__init__(*args, **kwargs)

        def display(self, *args, **kwargs):
            pass  # No terminal output; the Zotero composer owns the progress UI.

        def update(self, n=1):
            with lock:
                result = super().update(n)
                if self.report_model and time.monotonic() - last_write[0] >= 0.25:
                    self.report()
                return result

        def report(self):
            if not self.enabled:
                return
            count = max(0, int(self.n))
            # If metadata changed or a retry reports extra bytes, stay truthful:
            # show bytes without a percentage instead of clamping a fake 100%.
            total = total_bytes if total_bytes and count <= total_bytes else None
            write_json(root / 'setup-progress.json', {
                'stage': 'model', 'downloadedBytes': count, 'totalBytes': total})
            last_write[0] = time.monotonic()

        def close(self):
            with lock:
                if self.report_model and hasattr(self, 'n'):
                    self.report()
                super().close()

    return ModelProgress


def setup(root):
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
    from huggingface_hub import snapshot_download
    from tqdm.auto import tqdm
    write_json(root / 'setup-progress.json', {'stage': 'model'})
    options = dict(repo_id='Systran/faster-whisper-small', local_dir=str(root / 'model'),
                   token=False, allow_patterns=['config.json', 'preprocessor_config.json',
                                                'model.bin', 'tokenizer.json', 'vocabulary.*'])
    class SilentProgress(tqdm):
        def display(self, *args, **kwargs):
            pass
    metadata = snapshot_download(**options, dry_run=True, tqdm_class=SilentProgress)
    # Pin both passes to the same snapshot, even if upstream changes mid-setup.
    if metadata:
        options['revision'] = metadata[0].commit_hash
    pending = [entry.file_size for entry in metadata if entry.will_download]
    total = sum(pending) if pending and all(isinstance(size, int) and size > 0 for size in pending) else None
    write_json(root / 'setup-progress.json', {'stage': 'model', 'downloadedBytes': 0, 'totalBytes': total})
    progress = model_progress_class(root, tqdm, total)
    try:
        snapshot_download(**options, tqdm_class=progress)
    finally:
        progress.enabled = False
    write_json(root / 'setup-progress.json', {'stage': 'verify'})
    disable_network()
    load_model(root)
    import sounddevice
    files = {name: (root / 'model' / name).stat().st_size
             for name in ('model.bin', 'config.json', 'tokenizer.json')}
    write_json(root / 'ready.json', {'version': VERSION, 'model': 'small', 'offline': True, 'files': files})
    print('Local multilingual speech model ready', flush=True)


def transcribe(model, audio):
    segments, info = model.transcribe(
        audio, task='transcribe', language=None, multilingual=True,
        beam_size=3, best_of=1, temperature=0.0,
        condition_on_previous_text=False, vad_filter=True,
        vad_parameters={'min_silence_duration_ms': 500},
        initial_prompt='简体中文与 English 混合口述，保留英文专业术语。',
    )
    text = ''.join(segment.text for segment in segments).strip()
    return text, info.language


def run_job(root, job_path):
    disable_network()
    job = json.loads(Path(job_path).read_text(encoding='utf-8-sig'))
    status_path, done_path = Path(job['status']), Path(job['done'])
    stop_path, cancel_path = Path(job['stop']), Path(job['cancel'])
    started = time.monotonic()
    try:
        import numpy as np
        if cancel_path.exists():
            write_json(done_path, {'ok': False, 'cancelled': True})
            return
        if job.get('audio'):
            audio = job['audio']
        else:
            import sounddevice as sd
            chunks = []
            def on_audio(indata, frames, timing, status):
                chunks.append(indata.copy())
            device = sd.query_devices(kind='input')
            rate = int(device['default_samplerate'])
            with sd.InputStream(samplerate=rate, channels=1, dtype='float32', callback=on_audio):
                write_json(status_path, {'stage': 'listening'})
                deadline = time.monotonic() + min(120, max(1, job.get('maxSeconds', 60)))
                while time.monotonic() < deadline and not stop_path.exists() and not cancel_path.exists():
                    time.sleep(0.05)
            if cancel_path.exists():
                write_json(done_path, {'ok': False, 'cancelled': True})
                return
            if not chunks:
                raise RuntimeError('No audio was captured')
            audio = np.concatenate(chunks).reshape(-1)
            # Whisper expects 16 kHz mono. The device's native rate avoids
            # rejecting microphones that do not support a 16 kHz input stream.
            if rate != 16000:
                import av
                frame = av.AudioFrame.from_ndarray(audio.reshape(1, -1), format='flt', layout='mono')
                frame.sample_rate = rate
                resampler = av.AudioResampler(format='flt', layout='mono', rate=16000)
                frames = resampler.resample(frame) + resampler.resample(None)
                audio = np.concatenate([frame.to_ndarray().reshape(-1) for frame in frames])
        write_json(status_path, {'stage': 'transcribing'})
        model = load_model(root)
        if cancel_path.exists():
            write_json(done_path, {'ok': False, 'cancelled': True})
            return
        text, language = transcribe(model, audio)
        if cancel_path.exists():
            write_json(done_path, {'ok': False, 'cancelled': True})
        else:
            write_json(done_path, {'ok': bool(text), 'text': text, 'language': language,
                                  'error': '' if text else 'No speech detected',
                                  'seconds': round(time.monotonic() - started, 2), 'offline': True})
    except Exception as error:
        write_json(done_path, {'ok': False, 'error': str(error)})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['setup', 'run', 'probe'])
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--job')
    args = parser.parse_args()
    args.root.mkdir(parents=True, exist_ok=True)
    if args.command == 'setup':
        try:
            setup(args.root)
        except Exception as error:
            (args.root / 'setup-error.txt').write_text(str(error), encoding='utf-8')
            raise
    elif args.command == 'probe':
        disable_network()
        model = load_model(args.root)
        import numpy as np
        text, _ = transcribe(model, np.zeros(16000, dtype=np.float32))
        assert not text, 'Silence should not produce a transcript'
        import sounddevice as sd
        devices = [device['name'] for device in sd.query_devices() if device['max_input_channels']]
        print(json.dumps({'offline': True, 'silenceTest': 'passed', 'inputDevices': devices}, ensure_ascii=False))
    else:
        if not args.job:
            parser.error('--job is required for run')
        run_job(args.root, args.job)


if __name__ == '__main__':
    main()

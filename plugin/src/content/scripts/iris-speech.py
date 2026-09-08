"""Iris offline multilingual dictation. Only the explicit setup command uses a network."""
import argparse
import json
import os
from pathlib import Path
import sys
import time

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


def setup(root):
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
    from faster_whisper.utils import download_model
    download_model('small', output_dir=str(root / 'model'))
    disable_network()
    load_model(root)
    import sounddevice
    write_json(root / 'ready.json', {'version': VERSION, 'model': 'small', 'offline': True})
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
        setup(args.root)
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

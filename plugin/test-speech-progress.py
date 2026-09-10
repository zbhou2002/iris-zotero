"""Offline tests: no microphone, model download, or third-party dependencies."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('iris_speech', Path(__file__).parent / 'src/content/scripts/iris-speech.py')
speech = importlib.util.module_from_spec(spec)
spec.loader.exec_module(speech)


class ProgressBase:
    def __init__(self, *args, **kwargs):
        self.n = kwargs.get('initial', 0)

    def update(self, n=1):
        self.n += n

    def close(self):
        pass


class ProgressTests(unittest.TestCase):
    def test_byte_progress_excludes_transfer_and_file_count_bars(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            progress = speech.model_progress_class(root, ProgressBase, 1000)
            transfer = progress(unit='B', desc='Downloading bytes')
            transfer.update(250)
            files = progress(unit='it', desc='Fetching 5 files')
            files.update(1)
            self.assertFalse((root / 'setup-progress.json').exists())
            model = progress(unit='B', desc='Reconstructing (incomplete total...)', initial=100)
            model.update(150)
            state = json.loads((root / 'setup-progress.json').read_text())
            self.assertEqual(state, {'stage': 'model', 'downloadedBytes': 250, 'totalBytes': 1000})
            # Final close flushes even if the 250ms throttle has not elapsed.
            model.update(750)
            model.close()
            self.assertEqual(json.loads((root / 'setup-progress.json').read_text())['downloadedBytes'], 1000)
            progress.enabled = False
            speech.write_json(root / 'setup-progress.json', {'stage': 'verify'})
            model.close()
            self.assertEqual(json.loads((root / 'setup-progress.json').read_text()), {'stage': 'verify'})

    def test_unknown_total_and_retries_do_not_invent_percentages(self):
        for total in (None, 100):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                model = speech.model_progress_class(root, ProgressBase, total)(unit='B', desc='Reconstructing')
                model.update(150)
                state = json.loads((root / 'setup-progress.json').read_text())
                self.assertEqual(state['downloadedBytes'], 150)
                self.assertIsNone(state['totalBytes'])

    def test_progress_writes_are_throttled(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = speech.model_progress_class(root, ProgressBase, 1000)(unit='B', desc='Reconstructing')
            with patch.object(speech.time, 'monotonic', return_value=10), patch.object(speech, 'write_json') as write:
                for _ in range(100):
                    model.update(1)
                self.assertEqual(write.call_count, 1)
                model.close()
                self.assertEqual(write.call_args.args[1]['downloadedBytes'], 100)


if __name__ == '__main__':
    unittest.main()

// One installation per Zotero session, shared by every composer. Checking is
// read-only and never downloads anything or opens an audio device.
function createIrisSpeechRuntime({ io, join, python, timers, now = () => Date.now(), timeoutMs = 30 * 60 * 1000 }) {
  let state = { phase: 'checking', stage: '', seconds: 0, error: '', downloadedBytes: 0, totalBytes: null };
  let checking = null, installing = null;
  const listeners = new Set();
  const publish = patch => {
    state = { ...state, ...patch };
    for (const entry of listeners) {
      if (entry.owner.isConnected) entry.wasConnected = true;
      else if (entry.wasConnected) { listeners.delete(entry); continue; }
      try { entry.fn(state); } catch { /* One closed composer cannot stop setup. */ }
    }
  };
  const present = async () => {
    try {
      const marker = JSON.parse(await io.readUTF8(join('ready.json')));
      if (marker.version !== 1 || marker.model !== 'small' || marker.offline !== true) return false;
      const executable = await io.stat(python);
      if (executable.type !== 'regular' || executable.size <= 0) return false;
      for (const name of ['model.bin', 'config.json', 'tokenizer.json']) {
        const info = await io.stat(join('model', name));
        if (info.type !== 'regular' || info.size <= 0) return false;
        if (marker.files && marker.files[name] !== info.size) return false;
      }
      return true;
    } catch { return false; }
  };
  const runtime = {
    snapshot: () => ({ ...state }),
    subscribe(fn, owner) {
      const entry = { fn, owner, wasConnected: owner.isConnected }; listeners.add(entry); fn(state);
      return () => listeners.delete(entry);
    },
    check() {
      if (installing) return Promise.resolve(false);
      if (checking) return checking;
      publish({ phase: 'checking', error: '' });
      checking = (async () => {
        let ready = false;
        try { ready = await present(); } catch { /* Missing or incomplete install. */ }
        if (!installing) publish({ phase: ready ? 'ready' : 'missing', stage: '', seconds: 0 });
        return ready;
      })().finally(() => { checking = null; });
      return checking;
    },
    install(env) {
      if (installing) return installing;
      // Set synchronously: even programmatic double clicks cannot queue a job.
      publish({ phase: 'installing', stage: 'components', seconds: 0, error: '', downloadedBytes: 0, totalBytes: null });
      installing = (async () => {
        let timer, timeout, child;
        const started = now();
        const poll = async () => {
          if (state.phase !== 'installing') return;
          let stage = state.stage;
          let downloadedBytes = state.downloadedBytes, totalBytes = state.totalBytes;
          try {
            const progress = JSON.parse(await io.readUTF8(join('setup-progress.json')));
            if (['components', 'python', 'engine', 'model', 'verify'].includes(progress.stage)) stage = progress.stage;
            downloadedBytes = Number.isSafeInteger(progress.downloadedBytes) && progress.downloadedBytes >= 0 ? progress.downloadedBytes : 0;
            totalBytes = Number.isSafeInteger(progress.totalBytes) && progress.totalBytes > 0 ? progress.totalBytes : null;
            if (totalBytes && downloadedBytes > totalBytes) totalBytes = null;
          } catch { /* Atomic progress file may not exist yet. */ }
          if (state.phase !== 'installing') return;
          publish({ stage, downloadedBytes, totalBytes, seconds: Math.max(0, Math.floor((now() - started) / 1000)) });
          timer = timers.setTimeout(() => void poll(), 1000);
        };
        try {
          // A startup check may still be finishing when install() is called by
          // another view. Do not let its late result overwrite installation UI.
          if (checking) await checking;
          publish({ phase: 'installing', stage: 'components', error: '' });
          await env.prepare();
          // Hub metadata may otherwise reuse an existing truncated file. Remove
          // only core files demonstrably invalid against the validated marker.
          let previous = null;
          try { previous = JSON.parse(await io.readUTF8(join('ready.json'))); } catch {}
          for (const name of ['model.bin', 'config.json', 'tokenizer.json']) {
            let info;
            try { info = await io.stat(join('model', name)); } catch { continue; }
            if (info.type === 'regular' && (info.size === 0 || (previous?.files && previous.files[name] !== info.size))) {
              await io.remove(join('model', name), { ignoreAbsent: true });
            }
          }
          await io.remove(join('ready.json'), { ignoreAbsent: true });
          await io.writeUTF8(join('setup-progress.json'), JSON.stringify({ stage: 'components' }));
          await io.writeUTF8(join('setup-error.txt'), '');
          child = env.launch();
          void poll();
          const exit = await Promise.race([child.finished, new Promise((_, reject) => {
            timeout = timers.setTimeout(async () => {
              try { await env.stop(child); } catch {}
              reject(new Error('Installation timed out after 30 minutes. Check your connection and retry.'));
            }, timeoutMs);
          })]);
          if (exit !== 0) {
            let detail = '';
            try {
              const info = await io.stat(join('setup-error.txt'));
              if (info.size < 128 * 1024) detail = (await io.readUTF8(join('setup-error.txt'))).trim().slice(-800);
            } catch {}
            throw new Error(detail || 'Speech installation failed. Check the download connection and retry.');
          }
          publish({ stage: 'verify' });
          if (!await present()) throw new Error('Installation is incomplete: the Python runtime or Whisper model files are missing.');
          publish({ phase: 'ready', stage: '', seconds: 0, error: '' });
          return true;
        } catch (error) {
          publish({ phase: 'error', error: String(error.message || error), stage: '' });
          return false;
        } finally {
          timers.clearTimeout(timer); timers.clearTimeout(timeout);
        }
      })().finally(() => { installing = null; });
      return installing;
    }
  };
  return runtime;
}

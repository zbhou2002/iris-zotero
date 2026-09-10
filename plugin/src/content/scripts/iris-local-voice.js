// Inlined by build.mjs into the UI closure, with explicit host dependencies.
function installIrisLocalVoice({ doc, inputBox, inputSection, voiceBtn, voiceCancelBtn,
  announce, isChinese, root, io, paths, components, zotero }) {
  const win = doc.defaultView;
  const join = (...parts) => paths.join(...parts);
  const python = zotero.isWin ? join(root, 'venv', 'Scripts', 'python.exe') : join(root, 'venv', 'bin', 'python');
  const helper = join(root, 'iris-speech.py');
  const isMac = Boolean(zotero.isMac);
  const macApp = join(root, 'Iris Voice.app');
  let active = null;
  let recordingStage = null;
  let recordingError = '';
  const runtime = zotero.__irisSpeechRuntimeV2 || (zotero.__irisSpeechRuntimeV2 = createIrisSpeechRuntime({
    io, join: (...parts) => join(root, ...parts), python,
    timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) }
  }));
  const message = (zh, en) => isChinese() ? zh : en;
  const notice = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  notice.className = 'iris-voice-install-status';
  notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  inputSection.appendChild(notice);
  const runtimeLabel = state => {
    if (state.phase === 'checking') return message('正在检查本地语音模型…', 'Checking local speech model…');
    if (state.phase === 'missing') return message('未安装本地语音，点击下载模型（约 700 MB）', 'Install local voice input (about 700 MB)');
    if (state.phase === 'error') return message('安装失败，点击麦克风重试：', 'Setup failed. Click the mic to retry: ') + state.error;
    if (state.phase === 'installing') {
      const stages = {
        components: message('正在下载语音组件', 'Downloading speech components'),
        python: message('正在安装本地 Python', 'Installing local Python'),
        engine: message('正在安装语音识别引擎', 'Installing speech engine'),
        model: message('正在下载 Whisper 模型', 'Downloading Whisper model'),
        verify: message('正在验证本地模型', 'Verifying local model')
      };
      if (state.stage === 'model' && (state.totalBytes || state.downloadedBytes)) {
        const mb = bytes => (bytes / 1000000).toFixed(1) + ' MB';
        const progress = state.totalBytes
          ? `${Math.floor(state.downloadedBytes / state.totalBytes * 100)}% · ${mb(state.downloadedBytes)} / ${mb(state.totalBytes)}`
          : mb(state.downloadedBytes);
        return `${stages.model} · ${progress}`;
      }
      return `${stages[state.stage] || stages.components} · ${state.seconds}s`;
    }
    return message('语音输入', 'Voice input');
  };
  const renderRuntime = () => {
    const state = runtime.snapshot();
    voiceBtn.dataset.voiceRuntime = state.phase;
    voiceBtn.disabled = ['checking', 'installing'].includes(state.phase) || ['preparing', 'permission', 'transcribing'].includes(recordingStage);
    voiceBtn.setAttribute('aria-busy', String(state.phase === 'installing' || Boolean(recordingStage && recordingStage !== 'listening')));
    voiceBtn.title = runtimeLabel(state);
    voiceBtn.setAttribute('aria-label', voiceBtn.title);
    notice.hidden = !recordingError && recordingStage !== 'permission' && !['installing', 'error'].includes(state.phase);
    notice.dataset.phase = state.phase;
    notice.textContent = recordingError || (recordingStage === 'permission'
      ? message('请在 macOS 弹窗中允许 Iris Voice 使用麦克风。', 'Allow Iris Voice to use the microphone in the macOS prompt.')
      : notice.hidden ? '' : runtimeLabel(state));
    notice.title = notice.textContent;
  };
  const emitInput = () => inputBox.dispatchEvent(new win.Event('input', { bubbles: true }));
  const render = (stage) => {
    recordingStage = stage;
    voiceBtn.classList.toggle('is-listening', stage === 'listening');
    voiceBtn.classList.toggle('is-processing', ['preparing', 'permission', 'transcribing'].includes(stage));
    voiceCancelBtn.classList.toggle('is-visible', Boolean(stage));
    if (voiceCancelBtn.parentElement) voiceCancelBtn.parentElement.style.display = stage ? '' : 'none';
    renderRuntime();
  };
  const launch = (executable, args) => {
    const file = components.classes['@mozilla.org/file/local;1'].createInstance(components.interfaces.nsIFile);
    file.initWithPath(executable);
    const proc = components.classes['@mozilla.org/process/util;1'].createInstance(components.interfaces.nsIProcess);
    proc.init(file);
    try { proc.startHidden = true; proc.noShell = true; } catch {}
    const finished = new Promise((resolve, reject) => {
      const observer = { observe(_subject, topic) {
        if (topic === 'process-finished') resolve(proc.exitValue);
        else if (topic === 'process-failed') reject(new Error('Speech process could not start'));
      } };
      const run = proc.runwAsync || proc.runAsync;
      run.call(proc, args, args.length, observer);
    });
    return { proc, finished };
  };
  const copyResource = async (name) => {
    const response = await win.fetch(`chrome://aidea/content/scripts/${name}`);
    if (!response.ok) throw new Error(`Could not load ${name}`);
    const text = await response.text();
    if (!text.trim() || text.includes('\0')) throw new Error(`Invalid speech helper: ${name}`);
    await io.writeUTF8(join(root, name), text.replace(/\r\n/g, '\n'));
  };
  const prepareMacApp = async () => {
    const marker = join(root, 'mac-helper-version.txt');
    try {
      if (await io.readUTF8(marker) === '1' && await io.exists(join(macApp, 'Contents', 'MacOS', 'IrisVoice'))) return;
    } catch {}
    const response = await win.fetch('chrome://aidea/content/scripts/iris-voice-macos/IrisVoice.zip');
    if (!response.ok) throw new Error('Could not load the Mac microphone helper');
    const archive = join(root, 'IrisVoice.zip');
    await io.write(archive, new Uint8Array(await response.arrayBuffer()));
    const extracted = await launch('/usr/bin/ditto', ['-x', '-k', archive, root]).finished;
    await io.remove(archive, { ignoreAbsent: true });
    if (extracted !== 0) throw new Error('Could not install the Mac microphone helper');
    const verified = await launch('/usr/bin/codesign', ['--verify', '--deep', '--strict', macApp]).finished;
    if (verified !== 0) throw new Error('The Mac microphone helper signature is invalid. Reinstall Iris.');
    await io.writeUTF8(marker, '1');
  };
  const stopProcess = async job => {
    if (!job.process) return;
    if (isMac) {
      // Killing `open -W` alone leaves the app (and microphone) running.
      // The app watches cancellation and exits only after stopping its child.
      try { await io.writeUTF8(job.files.cancel, 'cancel'); } catch {}
      let timer;
      await Promise.race([job.process.finished.catch(() => {}), new Promise(resolve => {
        timer = win.setTimeout(resolve, 5000);
      })]);
      win.clearTimeout(timer);
    }
    try { if (job.process.proc.isRunning) job.process.proc.kill(); } catch {}
    await job.process.finished.catch(() => {});
  };
  const installRuntime = () => {
    const script = zotero.isWin ? 'iris-speech-setup.ps1' : 'iris-speech-setup.sh';
    return runtime.install({
      prepare: async () => {
        await io.makeDirectory(root, { ignoreExisting: true });
        await copyResource('iris-speech.py'); await copyResource(script);
      },
      launch: () => zotero.isWin
        ? launch('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
          ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', join(root, script), '-Root', root])
        : launch('/bin/sh', [join(root, script), root]),
      stop: async child => {
        // Stop the installer's download child before terminating the launcher.
        const pid = child.proc.pid;
        if (Number.isInteger(pid) && pid > 0) {
          const killer = zotero.isWin
            ? launch('C:\\Windows\\System32\\taskkill.exe', ['/PID', String(pid), '/T', '/F'])
            : launch('/usr/bin/pkill', ['-TERM', '-P', String(pid)]);
          await killer.finished.catch(() => {});
          try { if (child.proc.isRunning) child.proc.kill(); } catch {}
        } else { try { child.proc.kill(); } catch {} }
      }
    });
  };
  const beginInstallation = async () => {
    const ok = await installRuntime();
    if (ok && inputSection.isConnected) announce(message('本地语音已就绪，点击麦克风开始录音', 'Local voice is ready. Click the mic to record.'));
    return ok;
  };
  const clean = async (job) => {
    for (const file of Object.values(job.files || {})) {
      try { await io.remove(file, { ignoreAbsent: true }); } catch {}
      try { await io.remove(file + '.tmp', { ignoreAbsent: true }); } catch {}
    }
  };
  const finish = async (job, result) => {
    if (job.finished) return;
    job.finished = true;
    win.clearTimeout(job.timer);
    await stopProcess(job);
    if (active === job) {
      const text = String(result?.text || '').trim();
      const success = Boolean(result?.ok && text && !job.cancelled);
      if (success) {
        // Preserve any text typed during recording; insert at the current caret.
        const start = inputBox.selectionStart ?? inputBox.value.length;
        const end = inputBox.selectionEnd ?? start;
        const before = inputBox.value.slice(0, start);
        inputBox.setRangeText((before && !/\s$/.test(before) ? ' ' : '') + text, start, end, 'end');
        emitInput();
        announce(message('本地语音识别完成', 'Local voice recognition complete'));
      } else if (!job.cancelled && !result?.cancelled) {
        const error = result?.code === 'microphone_denied'
          ? message('麦克风权限未开启：请在系统设置 → 隐私与安全性 → 麦克风中允许 Iris Voice，然后重试。', 'Allow Iris Voice in System Settings → Privacy & Security → Microphone, then retry.')
          : result?.error || 'No speech detected';
        recordingError = error;
        announce(message('本地语音识别未完成：', 'Local recognition did not complete: ') + error, 'error');
      }
      active = null;
      render(null);
      job.resolve(success);
    }
    await clean(job);
  };
  const poll = async (job) => {
    if (job.finished) return;
    if (!inputSection.isConnected || Date.now() > job.deadline) {
      await finish(job, { error: 'Speech recording or recognition timed out' });
      return;
    }
    try {
      if (await io.exists(job.files.done)) {
        const result = JSON.parse(await io.readUTF8(job.files.done));
        await job.process.finished.catch(() => {});
        await finish(job, result);
        return;
      }
      if (await io.exists(job.files.status)) {
        const { stage } = JSON.parse(await io.readUTF8(job.files.status));
        if (stage !== job.stage && !job.stopRequested) {
          job.stage = stage;
          render(stage);
          announce(stage === 'listening'
            ? message('正在听…点麦克风完成，点发送识别并发送，点 × 取消', 'Listening…mic to finish, send to transcribe and send, × to cancel')
            : stage === 'permission'
              ? message('请允许 Iris Voice 使用麦克风', 'Please allow Iris Voice to use the microphone')
              : message('正在本地识别中英文…', 'Recognizing speech locally…'));
        }
      }
    } catch (error) {
      await finish(job, { error: String(error.message || error) });
      return;
    }
    if (!job.finished) job.timer = win.setTimeout(() => void poll(job), 150);
  };
  const start = async () => {
    const job = { cancelled: false, finished: false, stopRequested: false, files: null, process: null };
    job.completion = new Promise(resolve => { job.resolve = resolve; });
    active = job;
    recordingError = '';
    render('preparing');
    announce(message('正在准备本地语音…', 'Preparing local voice input…'));
    try {
      if (!await runtime.check()) {
        const cancelled = job.cancelled || !inputSection.isConnected;
        await finish(job, { cancelled: true });
        if (!cancelled) await beginInstallation();
        return;
      }
      await copyResource('iris-speech.py');
      if (isMac) await prepareMacApp();
      if (job.cancelled || job.stopRequested || !inputSection.isConnected) {
        await finish(job, { error: 'Recording was not started' });
        return;
      }
      const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      job.files = Object.fromEntries(['job', 'status', 'done', 'stop', 'cancel'].map(key => [key, join(root, `voice-${token}.${key}.json`)]));
      await io.writeUTF8(job.files.job, JSON.stringify({ ...job.files, maxSeconds: 60 }));
      if (job.cancelled) { await clean(job); return; }
      job.deadline = Date.now() + 240000;
      job.process = isMac
        ? launch('/usr/bin/open', ['-n', '-g', '-W', macApp, '--args', root, job.files.job])
        : launch(python, [helper, 'run', '--root', root, '--job', job.files.job]);
      job.process.finished.then(async () => {
        if (!job.finished && !await io.exists(job.files.done)) await finish(job, { error: 'Local speech process exited unexpectedly' });
      }, error => void finish(job, { error: String(error) }));
      void poll(job);
    } catch (error) { await finish(job, { error: String(error.message || error) }); }
  };
  const stopAndWait = async () => {
    const job = active;
    if (!job) return false;
    if (job.stopRequested) return job.completion;
    if (!job.files) { await cancel(); return false; }
    job.stopRequested = true;
    render('transcribing');
    announce(message('正在本地识别中英文…', 'Recognizing speech locally…'));
    if (job.files) {
      try { await io.writeUTF8(job.files.stop, 'stop'); }
      catch (error) { await finish(job, { error: String(error) }); }
    }
    return job.completion;
  };
  const cancel = async () => {
    const job = active;
    if (!job) return;
    job.cancelled = true;
    if (job.files) {
      try { await io.writeUTF8(job.files.cancel, 'cancel'); } catch {}
    }
    await finish(job, { cancelled: true });
    announce(message('已取消本次语音输入', 'Voice input cancelled'));
  };
  const unsubscribe = runtime.subscribe(renderRuntime, inputSection);
  voiceBtn.addEventListener('click', () => {
    if (voiceBtn.disabled) return;
    if (active) { void stopAndWait(); return; }
    if (runtime.snapshot().phase !== 'ready') {
      void beginInstallation();
      return;
    }
    void start();
  });
  voiceCancelBtn.addEventListener('click', () => { void cancel(); });
  win.addEventListener('unload', () => { unsubscribe(); void cancel(); }, { once: true });
  inputSection.__irisVoiceController = { isActive: () => Boolean(active), stopAndWait, cancel, runtimeState: runtime.snapshot, refreshLanguage: renderRuntime };
  if (typeof getIrisLanguage === 'function') getIrisLanguage().subscribe(renderRuntime, inputSection);
  if (runtime.snapshot().phase !== 'installing') void runtime.check();
}

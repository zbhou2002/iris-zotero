// Inlined by build.mjs into the UI closure, with explicit host dependencies.
function installIrisLocalVoice({ doc, inputBox, inputSection, voiceBtn, voiceCancelBtn,
  announce, isChinese, root, io, paths, components, zotero }) {
  const win = doc.defaultView;
  const join = (...parts) => paths.join(...parts);
  const python = zotero.isWin ? join(root, 'venv', 'Scripts', 'python.exe') : join(root, 'venv', 'bin', 'python');
  const helper = join(root, 'iris-speech.py');
  let active = null;
  const message = (zh, en) => isChinese() ? zh : en;
  const emitInput = () => inputBox.dispatchEvent(new win.Event('input', { bubbles: true }));
  const render = (stage) => {
    voiceBtn.classList.toggle('is-listening', stage === 'listening');
    voiceBtn.classList.toggle('is-processing', ['preparing', 'transcribing'].includes(stage));
    voiceCancelBtn.classList.toggle('is-visible', Boolean(stage));
    if (voiceCancelBtn.parentElement) voiceCancelBtn.parentElement.style.display = stage ? '' : 'none';
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
    await io.writeUTF8(join(root, name), text);
  };
  const ensureRuntime = async () => {
    if (!zotero.__irisSpeechSetup) {
      zotero.__irisSpeechSetup = (async () => {
        await io.makeDirectory(root, { ignoreExisting: true });
        await copyResource('iris-speech.py');
        if (await io.exists(python) && await io.exists(join(root, 'ready.json'))) return;
        announce(message('首次准备本地语音模型：正在下载组件，约 700 MB…', 'First-time setup: downloading local speech components, about 700 MB…'));
        const script = zotero.isWin ? 'iris-speech-setup.ps1' : 'iris-speech-setup.sh';
        await copyResource(script);
        const process = zotero.isWin
          ? launch('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
            ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', join(root, script), '-Root', root])
          : launch('/bin/sh', [join(root, script), root]);
        let timer;
        try {
          const exit = await Promise.race([process.finished, new Promise((_, reject) => {
            timer = win.setTimeout(() => {
              try { process.proc.kill(); } catch {}
              reject(new Error('Local speech setup timed out'));
            }, 15 * 60 * 1000);
          })]);
          if (exit !== 0 || !await io.exists(join(root, 'ready.json'))) {
            throw new Error('Local speech installation failed; check the model download connection');
          }
        } finally { win.clearTimeout(timer); }
      })().catch((error) => { zotero.__irisSpeechSetup = null; throw error; });
    }
    return zotero.__irisSpeechSetup;
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
    try {
      if (job.process?.proc.isRunning) job.process.proc.kill();
    } catch {}
    if (job.process) await job.process.finished.catch(() => {});
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
      } else if (!job.cancelled) {
        const error = result?.error || 'No speech detected';
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
      try { job.process?.proc.kill(); } catch {}
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
    render('preparing');
    announce(message('正在准备本地语音…', 'Preparing local voice input…'));
    try {
      await ensureRuntime();
      if (job.cancelled || job.stopRequested || !inputSection.isConnected) {
        await finish(job, { error: 'Recording was not started' });
        return;
      }
      const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      job.files = Object.fromEntries(['job', 'status', 'done', 'stop', 'cancel'].map(key => [key, join(root, `voice-${token}.${key}.json`)]));
      await io.writeUTF8(job.files.job, JSON.stringify({ ...job.files, maxSeconds: 60 }));
      if (job.cancelled) { await clean(job); return; }
      job.deadline = Date.now() + 240000;
      job.process = launch(python, [helper, 'run', '--root', root, '--job', job.files.job]);
      job.process.finished.then(async () => {
        if (!job.finished && !await io.exists(job.files.done)) await finish(job, { error: 'Local speech process exited unexpectedly' });
      }, error => void finish(job, { error: String(error) }));
      void poll(job);
    } catch (error) { await finish(job, { error: String(error.message || error) }); }
  };
  const stopAndWait = async () => {
    const job = active;
    if (!job) return false;
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
    try { job.process?.proc.kill(); } catch {}
    if (job.process) await job.process.finished.catch(() => {});
    await finish(job, { cancelled: true });
    announce(message('已取消本次语音输入', 'Voice input cancelled'));
  };
  voiceBtn.addEventListener('click', () => { void (active ? stopAndWait() : start()); });
  voiceCancelBtn.addEventListener('click', () => { void cancel(); });
  win.addEventListener('unload', () => { void cancel(); }, { once: true });
  inputSection.__irisVoiceController = { isActive: () => Boolean(active), stopAndWait, cancel };
}

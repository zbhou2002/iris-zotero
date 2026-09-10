import fs from 'node:fs';
import vm from 'node:vm';
export const tick = () => new Promise(resolve => setTimeout(resolve, 20));
export function voiceHarness({ installed = true, isWin = true, isMac = !isWin, shared, files: sharedFiles } = {}) {
  const files = sharedFiles || new Map();
  const installFiles = () => {
    files.set(isWin ? '/speech/venv/Scripts/python.exe' : '/speech/venv/bin/python', 'python');
    files.set('/speech/ready.json', JSON.stringify({ version: 1, model: 'small', offline: true }));
    for (const name of ['model.bin', 'config.json', 'tokenizer.json']) files.set('/speech/model/' + name, 'model');
  };
  if (installed && !sharedFiles) installFiles();
  const classList = () => ({ values: new Set(), toggle(name, yes) { yes ? this.values.add(name) : this.values.delete(name); } });
  const element = () => ({ classList: classList(), dataset: {}, attrs: {}, parentElement: { style: {} }, children: [],
    listeners: {}, setAttribute(k, v) { this.attrs[k] = v; }, appendChild(n) { this.children.push(n); },
    addEventListener(name, fn) { this.listeners[name] = fn; } });
  const voiceBtn = element(), voiceCancelBtn = element();
  const inputBox = { value: 'draft', selectionStart: 5, selectionEnd: 5, dispatchEvent() {},
    setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); } };
  const inputSection = { ...element(), isConnected: true };
  const statuses = [], processes = [], installers = [], fetches = [];
  const win = { Event: class {}, setTimeout(fn, delay) { return setTimeout(fn, Math.min(delay, 2)); },
    clearTimeout, addEventListener() {}, fetch: async url => { fetches.push(url); return { ok: true, text: async () => '# offline helper\r\n', arrayBuffer: async () => new ArrayBuffer(8) }; } };
  const components = { interfaces: {}, classes: {
    '@mozilla.org/file/local;1': { createInstance: () => ({ initWithPath(path) { this.path = path; } }) },
    '@mozilla.org/process/util;1': { createInstance: () => ({
      init(file) { this.path = file.path; }, exitValue: 0, isRunning: false,
      runwAsync(args, length, observer) {
        this.isRunning = true; this.observer = observer; this.args = args;
        if (this.path === '/usr/bin/ditto' || this.path === '/usr/bin/codesign') { this.exit(); return; }
        if (args.some(arg => /iris-speech-setup\.(sh|ps1)$/.test(arg))) { installers.push(this); return; }
        this.job = JSON.parse(files.get(args.at(-1)));
        files.set(this.job.status, JSON.stringify({ stage: 'listening' })); processes.push(this);
      },
      complete(text) {
        files.set(this.job.done, JSON.stringify({ ok: true, text })); this.exit();
      },
      exit(code = 0) { this.exitValue = code; this.isRunning = false; this.observer.observe(null, 'process-finished'); },
      kill() { this.killed = true; this.exit(1); }
    }) }
  } };
  const context = vm.createContext({ setTimeout, clearTimeout });
  for (const name of ['iris-speech-runtime.js', 'iris-local-voice.js']) {
    vm.runInContext(fs.readFileSync(new URL('../src/content/scripts/' + name, import.meta.url), 'utf8'), context);
  }
  const io = { exists: async p => files.has(p), write: async (p, data) => { files.set(p, data); }, writeUTF8: async (p, data) => { files.set(p, data);
    if (isMac && p.endsWith('.cancel.json')) {
      const proc = processes.find(proc => proc.job.cancel === p && proc.isRunning);
      if (proc) { files.set(proc.job.done, JSON.stringify({ cancelled: true })); proc.exit(); }
    }
  },
    stat: async p => { if (!files.has(p)) throw Error('missing'); return { type: 'regular', size: files.get(p).length }; },
    readUTF8: async p => { if (!files.has(p)) throw Error('missing'); return files.get(p); },
    makeDirectory: async () => {}, remove: async p => { files.delete(p); } };
  const zotero = shared || { isWin, isMac };
  context.installIrisLocalVoice({ doc: { defaultView: win, createElementNS: element }, inputBox, inputSection, voiceBtn, voiceCancelBtn,
    announce: text => statuses.push(text), isChinese: () => true, root: '/speech', io,
    paths: { join: (...p) => p.join('/') }, components, zotero });
  return { inputBox, inputSection, voiceBtn, voiceCancelBtn, files, statuses, processes, installers, fetches, io, zotero, context, installFiles,
    start: async () => { await tick(); voiceBtn.listeners.click(); await tick(); },
    controller: inputSection.__irisVoiceController };
}

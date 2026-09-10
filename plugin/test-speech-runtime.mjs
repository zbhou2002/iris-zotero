import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { voiceHarness, tick } from './fixtures/voice-harness.mjs';

test('startup checks files without fetching resources, downloading or recording', async () => {
  const h = voiceHarness({ installed: false });
  assert.equal(h.voiceBtn.disabled, true);
  await tick();
  assert.equal(h.controller.runtimeState().phase, 'missing');
  assert.equal(h.voiceBtn.disabled, false); assert.match(h.voiceBtn.title, /下载/);
  assert.equal(h.fetches.length, 0); assert.equal(h.files.size, 0);
  assert.equal(h.controller.isActive(), false);
});

test('first click installs; double click and send never masquerade as recording', async () => {
  const h = voiceHarness({ installed: false }); await h.start();
  assert.equal(h.installers.length, 1); assert.equal(h.voiceBtn.disabled, true);
  assert.equal(h.controller.isActive(), false); assert.equal(await h.controller.stopAndWait(), false);
  for (let i = 0; i < 5; i++) h.voiceBtn.listeners.click();
  await tick(); assert.equal(h.installers.length, 1); assert.equal(h.processes.length, 0);
  assert.equal(h.statuses.some(s => s.includes('正在本地识别')), false);
  assert.equal(h.inputBox.value, 'draft');
  h.installFiles(); h.installers[0].exit(); await tick();
  assert.equal(h.voiceBtn.disabled, false); assert.equal(h.controller.runtimeState().phase, 'ready');
  assert.equal(h.processes.length, 0, 'finishing setup must not activate the microphone');
  await h.start(); assert.equal(h.processes.length, 1); await h.controller.cancel();
});

test('Mac uses the shell installer and a POSIX Python path; helper line endings are normalized', async () => {
  const h = voiceHarness({ installed: false, isWin: false }); await h.start();
  assert.equal(h.installers[0].path, '/bin/sh');
  assert.equal(h.installers[0].args[0], '/speech/iris-speech-setup.sh');
  assert.equal(h.files.get('/speech/iris-speech-setup.sh').includes('\r'), false);
  h.installFiles(); h.installers[0].exit(); await tick(); await h.start();
  assert.equal(h.processes[0].path, '/speech/venv/bin/python'); await h.controller.cancel();
});

test('each missing or empty model file blocks readiness even with a ready marker', async () => {
  for (const path of ['/speech/model/model.bin', '/speech/model/config.json', '/speech/model/tokenizer.json', '/speech/venv/Scripts/python.exe']) {
    const h = voiceHarness(); await tick(); h.files.set(path, '');
    assert.equal(await h.zotero.__irisSpeechRuntimeV2.check(), false);
    assert.equal(h.controller.runtimeState().phase, 'missing');
  }
});

test('missing model after startup automatically falls back to installation on the next click', async () => {
  const h = voiceHarness(); await tick(); h.files.delete('/speech/model/model.bin');
  await h.start(); assert.equal(h.installers.length, 1); assert.equal(h.processes.length, 0);
  assert.equal(h.voiceBtn.disabled, true); assert.equal(h.controller.isActive(), false);
  h.installFiles(); h.installers[0].exit(); await tick(); assert.equal(h.controller.runtimeState().phase, 'ready');
});
test('model size mismatch against a validated manifest requires repair', async () => {
  const h = voiceHarness(); await tick();
  h.files.set('/speech/ready.json', JSON.stringify({ version: 1, model: 'small', offline: true,
    files: { 'model.bin': 500, 'config.json': 5, 'tokenizer.json': 5 } }));
  assert.equal(await h.zotero.__irisSpeechRuntimeV2.check(), false);
  await h.start();
  assert.equal(h.files.has('/speech/model/model.bin'), false, 'invalid cached file must not be reused by Hub');
  assert.equal(h.files.get('/speech/model/config.json'), 'model', 'valid files are preserved');
  h.installFiles(); h.installers[0].exit(); await tick();
});

test('an incomplete successful installer does not unlock recording', async () => {
  const h = voiceHarness({ installed: false }); await h.start(); h.installers[0].exit(); await tick();
  assert.equal(h.controller.runtimeState().phase, 'error'); assert.match(h.voiceBtn.title, /incomplete/);
  assert.equal(h.processes.length, 0); assert.equal(h.voiceBtn.disabled, false, 'failure permits a deliberate retry');
});

test('installation errors are visible and a new click can retry', async () => {
  const h = voiceHarness({ installed: false }); await h.start();
  h.files.set('/speech/setup-error.txt', 'Connection timed out downloading model'); h.installers[0].exit(1); await tick();
  assert.equal(h.controller.runtimeState().phase, 'error'); assert.match(h.voiceBtn.title, /Connection timed out/);
  assert.equal(h.inputSection.children[0].hidden, false);
  await h.start(); assert.equal(h.installers.length, 2);
  h.installFiles(); h.installers[1].exit(); await tick(); assert.equal(h.controller.runtimeState().phase, 'ready');
});

test('all panels share one installation; leaving the first panel does not cancel setup', async () => {
  const a = voiceHarness({ installed: false }); await a.start();
  const b = voiceHarness({ shared: a.zotero, files: a.files }); await tick();
  assert.equal(b.voiceBtn.disabled, true); b.voiceBtn.listeners.click();
  assert.equal(b.installers.length, 0); assert.equal(a.installers.length, 1);
  a.inputSection.isConnected = false; await a.controller.cancel();
  a.installFiles(); a.installers[0].exit(); await tick();
  assert.equal(b.controller.runtimeState().phase, 'ready'); assert.equal(b.voiceBtn.disabled, false);
});

test('cancel during recheck cannot unexpectedly start installation', async () => {
  const h = voiceHarness(); await tick(); h.files.delete('/speech/model/model.bin');
  h.voiceBtn.listeners.click(); await h.controller.cancel(); await tick();
  assert.equal(h.installers.length, 0); assert.equal(h.processes.length, 0); assert.equal(h.controller.isActive(), false);
});

test('installation does not block ordinary typed-message sending', async () => {
  const h = voiceHarness({ installed: false }); await h.start();
  const bundle = fs.readFileSync(new URL('src/content/scripts/aidea.js', import.meta.url), 'utf8');
  const start = bundle.indexOf('    let voiceSendPending = false;');
  let sends = 0;
  const context = vm.createContext({ inputSection: h.inputSection, sendBtn: { disabled: false }, commitCurrentInput: () => sends++ });
  vm.runInContext(bundle.slice(start, bundle.indexOf('    sendBtn.addEventListener("click",', start)) + '\nthis.send=handleSendIntent;', context);
  await context.send(); assert.equal(sends, 1);
  h.installers[0].exit(1); await tick();
});

test('setup timeout unlocks retry only after stopping the install process', async () => {
  const h = voiceHarness({ installed: false }); await tick(); let stopped = 0, releaseStop;
  const runtime = h.context.createIrisSpeechRuntime({ io: h.io, join: (...p) => ['/speech', ...p].join('/'), python: '/speech/venv/bin/python',
    timers: { setTimeout, clearTimeout }, timeoutMs: 5 });
  const task = runtime.install({ prepare: async () => {}, launch: () => ({ finished: new Promise(() => {}) }),
    stop: () => { stopped++; return new Promise(resolve => { releaseStop = resolve; }); } });
  await tick(); assert.equal(stopped, 1); assert.equal(runtime.snapshot().phase, 'installing');
  releaseStop(); assert.equal(await task, false); assert.equal(runtime.snapshot().phase, 'error');
  assert.match(runtime.snapshot().error, /timed out/);
});

test('progress reports truthful stage and elapsed time, not an invented percentage', async () => {
  const h = voiceHarness({ installed: false }); await tick(); const scheduled = [];
  const runtime = h.context.createIrisSpeechRuntime({ io: h.io, join: (...p) => ['/speech', ...p].join('/'), python: '/speech/venv/Scripts/python.exe',
    timers: { setTimeout: (fn, ms) => { scheduled.push({ fn, ms }); return fn; }, clearTimeout() {} } });
  let resolve; const task = runtime.install({ prepare: async () => {}, launch: () => ({ finished: new Promise(r => { resolve = r; }) }) });
  await tick(); h.files.set('/speech/setup-progress.json', '{"stage":"model"}');
  scheduled.find(s => s.ms === 1000).fn(); await tick(); assert.equal(runtime.snapshot().stage, 'model');
  assert.equal(runtime.snapshot().totalBytes, null);
  h.files.set('/speech/setup-progress.json', JSON.stringify({ stage: 'model', downloadedBytes: 120000000, totalBytes: 480000000 }));
  scheduled.at(-1).fn(); await tick();
  assert.equal(runtime.snapshot().downloadedBytes, 120000000); assert.equal(runtime.snapshot().totalBytes, 480000000);
  h.files.set('/speech/setup-progress.json', JSON.stringify({ stage: 'model', downloadedBytes: 500, totalBytes: 400 }));
  scheduled.at(-1).fn(); await tick(); assert.equal(runtime.snapshot().totalBytes, null);
  h.files.set('/speech/setup-progress.json', JSON.stringify({ stage: 'model', downloadedBytes: -4, totalBytes: 'NaN' }));
  scheduled.at(-1).fn(); await tick(); assert.equal(runtime.snapshot().downloadedBytes, 0); assert.equal(runtime.snapshot().totalBytes, null);
  h.installFiles(); resolve(0); assert.equal(await task, true);
});

test('a composer built off-DOM receives startup updates before it is attached', async () => {
  const h = voiceHarness({ installed: false }); await tick();
  const runtime = h.zotero.__irisSpeechRuntimeV2;
  const owner = { isConnected: false }, states = [];
  runtime.subscribe(state => states.push(state.phase), owner);
  await runtime.check(); assert.equal(states.at(-1), 'missing');
  owner.isConnected = true; h.installFiles(); await runtime.check(); assert.equal(states.at(-1), 'ready');
  owner.isConnected = false; const count = states.length; await runtime.check(); assert.equal(states.length, count);
});

test('model progress is displayed as real bytes and percent, with unknown-total fallback', async () => {
  let state = { phase: 'installing', stage: 'model', seconds: 8, downloadedBytes: 120000000, totalBytes: 480000000 };
  const h = voiceHarness({ shared: { isWin: true, __irisSpeechRuntimeV2: { snapshot: () => state, subscribe: fn => fn(state) } } });
  assert.match(h.voiceBtn.title, /25% · 120.0 MB \/ 480.0 MB/);
  state = { ...state, totalBytes: null }; h.controller.refreshLanguage();
  assert.match(h.voiceBtn.title, /120.0 MB/); assert.equal(h.voiceBtn.title.includes('%'), false);
});

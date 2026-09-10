import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { voiceHarness } from './fixtures/voice-harness.mjs';
const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 20));

test('send: double activation waits once; preserves the sending button state', async () => {
  const bundle = read('src/content/scripts/aidea.js');
  const a = bundle.indexOf('    let voiceSendPending = false;');
  const b = bundle.indexOf('    sendBtn.addEventListener("click",', a);
  let resolveVoice, sends = 0, stops = 0;
  const wait = new Promise(resolve => { resolveVoice = resolve; });
  const sendBtn = { disabled: false };
  const context = vm.createContext({ sendBtn,
    inputSection: { __irisVoiceController: { isActive: () => true, stopAndWait: () => { stops++; return wait; } } },
    commitCurrentInput: () => { sends++; sendBtn.disabled = true; } });
  vm.runInContext(bundle.slice(a, b) + '\nthis.send = handleSendIntent;', context);
  const first = context.send();
  await context.send();
  assert.equal(stops, 1);
  assert.equal(sends, 0);
  resolveVoice(true);
  await first;
  assert.equal(sends, 1);
  assert.equal(sendBtn.disabled, true);
});

test('voice: stop-and-send waits for local text; subsequent sessions work', async () => {
  const h = voiceHarness();
  await h.start();
  assert.equal(h.processes.length, 1);
  assert(h.voiceBtn.classList.values.has('is-listening'));
  const waiting = h.controller.stopAndWait();
  await tick();
  assert.equal(h.inputBox.value, 'draft');
  assert(h.files.has(h.processes[0].job.stop));
  h.processes[0].complete('本地 API test');
  assert.equal(await waiting, true);
  assert.equal(h.inputBox.value, 'draft 本地 API test');
  assert.equal(h.controller.isActive(), false);
  await h.start();
  assert.equal(h.processes.length, 2);
  await h.controller.cancel();
  assert.equal([...h.files.keys()].filter(key => key.includes('/voice-')).length, 0);
});

test('voice: cancel recognition drops its result and preserves typed draft', async () => {
  const h = voiceHarness();
  await h.start();
  const waiting = h.controller.stopAndWait();
  h.inputBox.value = 'new draft while dictating';
  await h.controller.cancel();
  assert.equal(await waiting, false);
  assert.equal(h.inputBox.value, 'new draft while dictating');
  assert.equal(h.voiceCancelBtn.parentElement.style.display, 'none');
  assert.equal(h.controller.isActive(), false);
});

test('voice: second mic click ends recording without sending', async () => {
  const h = voiceHarness();
  await h.start();
  h.voiceBtn.listeners.click();
  await tick();
  h.processes[0].complete('speech');
  await tick();
  assert.equal(h.inputBox.value, 'draft speech');
  assert.equal(h.controller.isActive(), false);
});

test('voice: cancel during startup never launches the recorder', async () => {
  const h = voiceHarness();
  await tick();
  h.voiceBtn.listeners.click();
  await h.controller.cancel();
  await tick();
  assert.equal(h.processes.length, 0);
  assert.equal(h.inputBox.value, 'draft');
});

test('voice: crashed process exits busy state and allows retry', async () => {
  const h = voiceHarness();
  await h.start();
  h.processes[0].kill();
  await tick();
  assert.equal(h.controller.isActive(), false);
  await h.start();
  assert.equal(h.processes.length, 2);
  await h.controller.cancel();
});

test('translation: one streaming call, no PDF extraction; cached repeat and model change', async () => {
  let calls = 0, model = 'model-a';
  const deltas = [], stages = [];
  const context = vm.createContext({
    getSelectionTranslatePrefs: () => ({ enabled: true, sourceLang: 'auto', targetLang: 'zh-CN' }),
    normalizeSelectedTextForTranslation: value => value,
    resolveSelectionTranslateModel: () => ({ model, apiBase: 'test://local' }),
    getDocumentMetadata: () => ({ title: 'Example', abstractNote: 'Abstract' }),
    buildSelectionTranslatePrompt: params => params.selectedText,
    callLLMStream: async (params, delta) => { calls++; await tick(); delta('译文'); return '译文'; },
    ensureDocumentContext: () => { throw new Error('Must not extract PDF'); }
  });
  vm.runInContext(read('selection-translate.js'), context);
  const params = { item: { id: 1 }, selectedText: 'Example text',
    callbacks: { onDelta: value => deltas.push(value), onStage: stage => stages.push(stage) } };
  const [a, b] = await Promise.all([context.translateSelectedTextForReader(params), context.translateSelectedTextForReader(params)]);
  assert.equal(calls, 1);
  assert.equal(a.translation, b.translation);
  await context.translateSelectedTextForReader(params);
  assert.equal(calls, 1);
  model = 'model-b';
  await context.translateSelectedTextForReader(params);
  assert.equal(calls, 2);
  assert(stages.every(stage => stage === 'translate'));
  assert(deltas.length >= 3);
});

test('translation: failed request is evicted so retry succeeds', async () => {
  let calls = 0;
  const context = vm.createContext({
    getSelectionTranslatePrefs: () => ({ enabled: true }), normalizeSelectedTextForTranslation: x => x,
    resolveSelectionTranslateModel: () => ({ model: 'test' }), getDocumentMetadata: () => ({}),
    buildSelectionTranslatePrompt: () => '', callLLMStream: async () => {
      if (++calls === 1) throw new Error('Temporary failure'); return 'OK';
    }
  });
  vm.runInContext(read('selection-translate.js'), context);
  const params = { item: { id: 1 }, selectedText: 'text' };
  await assert.rejects(context.translateSelectedTextForReader(params));
  assert.equal((await context.translateSelectedTextForReader(params)).translation, 'OK');
});

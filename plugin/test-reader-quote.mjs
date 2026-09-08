import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('src/content/scripts/iris-reader-quote.js', import.meta.url), 'utf8');
const bundle = fs.readFileSync(new URL('src/content/scripts/aidea.js', import.meta.url), 'utf8');
function fixture() {
  const ctx = vm.createContext({}); vm.runInContext(source, ctx);
  const bridge = ctx.createIrisReaderQuoteBridge(), store = new Map(), ownerDoc = {};
  let refreshes = 0, key = 10;
  const client = { root: { isConnected: true }, target: () => ({ key, ownerDoc, libraryID: 1, attachmentId: 2, paperId: 3 }),
    read: key => store.get(key) || [], write: (key, value) => store.set(key, value), refresh: () => refreshes++, limit: 20 };
  bridge.register(client);
  const selection = (text, overrides = {}) => ({ text, ownerDoc, libraryID: 1, attachmentId: 2, paperId: 3,
    paperContext: { itemId: 3, contextItemId: 2, title: 'Example paper' }, ...overrides });
  const publish = (text, overrides) => bridge.publish(selection(text, overrides));
  return { bridge, client, store, publish, selection, ctx, refreshes: () => refreshes, switch: value => { key = value; } };
}
test('selection attaches once and a new passage replaces the pending auto quote', () => {
  const h = fixture(); h.publish('First'); h.publish('First');
  assert.equal(h.refreshes(), 1); assert.equal(h.store.get(10)[0].text, 'First');
  h.publish('Second'); assert.equal(h.store.get(10).length, 1); assert.equal(h.store.get(10)[0].text, 'Second');
});
test('removal/send is respected when the reader rerenders the same popup', () => {
  const h = fixture(); h.publish('First'); h.store.delete(10); h.publish('First');
  assert.equal(h.store.has(10), false);
  h.publish(''); h.publish('First'); assert.equal(h.store.get(10)[0].text, 'First');
});
test('manual/model contexts are preserved and duplicate contexts are not appended', () => {
  const h = fixture(); const manual = { text: 'Prior answer', source: 'model' };
  h.store.set(10, [manual]); h.publish('First'); h.publish('Second');
  assert.equal(h.store.get(10).length, 2); assert.equal(h.store.get(10)[0], manual);
  const manualPDF = { text: 'Manual', source: 'pdf', paperContext: { itemId: 3, contextItemId: 2 } };
  h.store.get(10).push(manualPDF); h.publish('Manual');
  assert.equal(h.store.get(10).length, 2); assert.equal(h.store.get(10)[1], manualPDF);
});
test('after the old popup closes, deliberately selecting the same passage works again', () => {
  const h = fixture(); h.publish('First'); h.store.delete(10);
  h.bridge.endSelection(h.selection('First')); h.publish('First');
  assert.equal(h.store.get(10)[0].text, 'First');
  h.publish('Second'); h.store.delete(10);
  h.bridge.endSelection(h.selection('First')); h.publish('Second');
  assert.equal(h.store.has(10), false, 'late dismissal of an older popup must not reset a newer selection');
});
test('routing isolates papers, windows, libraries and disconnected panels', () => {
  const h = fixture();
  h.publish('Wrong paper', { attachmentId: 8, paperId: 9 });
  h.publish('Wrong window', { ownerDoc: {} }); h.publish('Wrong library', { libraryID: 7 });
  assert.equal(h.store.size, 0);
  h.client.root.isConnected = false; h.publish('Closed'); assert.equal(h.store.size, 0);
});
test('switching conversation does not replace an old conversation draft', () => {
  const h = fixture(); h.publish('First'); h.switch(11); h.publish('Second');
  assert.equal(h.store.get(10)[0].text, 'First'); assert.equal(h.store.get(11)[0].text, 'Second');
});
test('multiple views of one conversation share one write and all refresh', () => {
  const h = fixture(); let second = 0;
  h.bridge.register({ ...h.client, root: { isConnected: true }, refresh: () => second++ });
  h.publish('First'); assert.equal(h.store.get(10).length, 1); assert.equal(second, 1); assert.equal(h.refreshes(), 1);
});
test('context cap preserves existing attachments', () => {
  const h = fixture(); h.client.limit = 1; h.store.set(10, [{ text: 'Manual', source: 'model' }]);
  h.publish('First'); assert.equal(h.store.get(10)[0].text, 'Manual');
});
test('card renders literal untrusted text, accessible controls and live translated chrome', () => {
  const h = fixture();
  const doc = { createElementNS: (_ns, tag) => ({ tag, dataset: {}, children: [], attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; }, append(...nodes) { this.children.push(...nodes); } }) };
  const list = { ownerDocument: doc, children: [], style: {}, replaceChildren() { this.children = []; }, append(node) { this.children.push(node); } };
  const text = '<script>do not execute</script> English 中文';
  for (const chinese of [false, true]) {
    h.ctx.renderIrisQuoteCards({ list, entries: [{ text, source: 'pdf' }], expandedIndex: -1, chinese });
    const card = list.children[0]; assert.equal(card.children[1].textContent, text);
    assert.equal(card.children[0].children[0].textContent, chinese ? '引用文段' : 'Quoted passage');
    assert.equal(card.children[0].children[1].attrs['aria-label'], chinese ? '移除引用' : 'Remove quote');
    assert.equal(card.children[0].children[0].attrs['aria-expanded'], 'false');
  }
});
test('send flow carries the quote separately from displayed question and keeps the paper item', async () => {
  const ctx = vm.createContext({ getPanelI18n: () => ({}), MAX_SELECTED_IMAGES: 5 });
  vm.runInContext(bundle.slice(bundle.indexOf('  function createSendFlowController(deps) {'), bundle.indexOf('\n  var init_sendFlow', bundle.indexOf('  function createSendFlowController(deps) {'))), ctx);
  const start = bundle.indexOf('  function buildQuestionWithSelectedText(selectedText, userPrompt) {');
  vm.runInContext(bundle.slice(start, bundle.indexOf('  function buildQuestionWithSelectedTextContexts', start)), ctx);
  let entries = [{ text: 'Specific finding', source: 'pdf', paperContext: { itemId: 3, contextItemId: 2 } }], sent;
  const paper = { id: 3 }, inputBox = { value: 'Why does this matter?' }, noop = () => {};
  const deps = { body: {}, inputBox, isPanelGenerating: () => false, getItem: () => paper, getConversationKey: () => 10,
    closeSlashMenu: noop, closePaperPicker: noop, getSelectedTextContextEntries: () => entries,
    getSelectedPaperContexts: () => [], getSelectedFiles: () => [], resolvePromptText: text => text,
    buildQuestionWithSelectedTextContexts: (texts, _sources, prompt) => ctx.buildQuestionWithSelectedText(texts[0], prompt),
    buildModelPromptWithFileContext: text => text, isGlobalMode: () => false, normalizeConversationTitleSeed: text => text,
    touchPaperConversationTitle: async () => {}, getSelectedProfile: () => ({ model: 'test' }), getCurrentModelName: () => 'test',
    getSelectedImages: () => [], isScreenshotUnsupportedModel: () => false, getActiveEditSession: () => null,
    clearSelectedImageState: noop, updateImagePreviewPreservingScroll: noop, clearSelectedTextState: () => { entries = []; },
    updateSelectedTextPreviewPreservingScroll: noop, refreshGlobalHistoryHeader: noop,
    sendQuestion: async (...args) => { sent = args; } };
  await ctx.createSendFlowController(deps).doSend();
  assert.equal(sent[1], paper); assert.match(sent[2], /Specific finding/); assert.match(sent[2], /rest of the paper/);
  assert.equal(sent[8], 'Why does this matter?'); assert.equal(sent[9][0], 'Specific finding');
  assert.equal(entries.length, 0); assert.equal(inputBox.value, '');
  const send = bundle.slice(bundle.indexOf('  async function sendQuestion('), bundle.indexOf('  async function sendQuestion(') + 16000);
  assert.match(send, /await buildCombinedContextForRequest\(\{\s*item,\s*question,/);
  assert.match(send, /prompt: question,\s*context: combinedContext,/);
});
test('quoted questions still read and include the base paper text as background', async () => {
  let extracted = 0;
  const item = { id: 3, isAttachment: () => true, getField: () => 'Example', attachmentContentType: 'application/pdf' };
  const ctx = vm.createContext({ conversationContextPool: new Map(), pdfTextCache: new Map(), chatHistory: new Map(),
    throwIfRequestAborted: () => {}, resolveMemoryLibraryID: () => null, ztoolkit: { log() {} },
    resolveContextSourceItem: () => ({ contextItem: item, statusText: '' }), resolveReaderDocument: () => ({ item, kind: 'pdf' }),
    ensureDocumentContext: async () => { extracted++; return { chunks: [], fullLength: 45 }; },
    isDocumentContextQueryDependent: () => false, buildReaderDocumentContext: async () => 'Full paper: introduction, methods, results and conclusion.',
    sanitizeText: text => text, getPanelI18n: () => ({ usingCachedDocumentContext: '' }) });
  const start = bundle.indexOf('  async function buildCombinedContextForRequest(params) {');
  vm.runInContext(bundle.slice(start, bundle.indexOf('  function buildContextRefsSnapshot(', start)), ctx);
  const params = { item, conversationKey: 10, question: 'Quoted passage: Specific finding. Why?', paperContexts: [], imageCount: 0, setStatusSafely() {} };
  const first = await ctx.buildCombinedContextForRequest(params);
  assert.match(first, /introduction, methods, results and conclusion/); assert.equal(extracted, 1);
  assert.equal(await ctx.buildCombinedContextForRequest({ ...params, question: 'Another quote' }), first);
  assert.equal(extracted, 1, 'quote changes do not unnecessarily reread cached full paper');
});

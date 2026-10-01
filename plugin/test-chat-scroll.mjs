import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const bundle = fs.readFileSync(new URL('src/content/scripts/aidea.js', import.meta.url), 'utf8');

function scrollHarness({ conversationKey = 7, questionId = 101, questionTop = 1000 } = {}) {
  const wrappers = new Map();
  const box = {
    dataset: { conversationKey: String(conversationKey) },
    clientHeight: 400,
    scrollHeight: 1200,
    scrollTop: 0,
    getClientRects: () => [1],
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll: () => [...wrappers.values()]
  };
  const addQuestion = (messageId, contentTop) => {
    wrappers.set(messageId, {
      getAttribute: name => name === 'data-message-id' ? String(messageId) : null,
      getBoundingClientRect: () => ({ top: contentTop - box.scrollTop }),
      offsetTop: contentTop
    });
  };
  addQuestion(questionId, questionTop);
  const context = vm.createContext({
    AUTO_SCROLL_BOTTOM_THRESHOLD: 64,
    chatScrollSnapshots: new Map(),
    followBottomStabilizers: new Map(),
    questionScrollAnchors: new WeakMap(),
    _scrollUpdatesSuspended: false,
    activePaperConversationByItem: new Map()
  });
  const start = bundle.indexOf('  function getMaxScrollTop(chatBox) {');
  const end = bundle.indexOf('  var chatScrollSnapshots, followBottomStabilizers', start);
  assert.ok(start > 0 && end > start, 'chat scroll source is extractable');
  vm.runInContext(bundle.slice(start, end) + `
    this.api = {
      beginQuestionScrollAnchor,
      applyQuestionScrollAnchor,
      handleQuestionAnchorUserScroll,
      releaseQuestionScrollAnchor,
      applyChatScrollSnapshot,
      withScrollGuard,
      scheduleFollowBottomStabilization,
      isQuestionScrollManual
    };`, context);
  context.api.beginQuestionScrollAnchor(conversationKey, box, questionId);
  return { ...context.api, box, addQuestion, conversationKey, questionId, context };
}

test('long streaming response follows growth only until the current question reaches the top', () => {
  const h = scrollHarness();
  assert.equal(h.applyQuestionScrollAnchor(h.conversationKey, h.box), true);
  assert.equal(h.box.scrollTop, 800, 'short content still follows the bottom');
  h.handleQuestionAnchorUserScroll(h.conversationKey, h.box); // matching programmatic event

  h.box.scrollHeight = 1600;
  h.applyQuestionScrollAnchor(h.conversationKey, h.box);
  assert.equal(h.box.scrollTop, 1000, 'question reaches viewport top');
  h.handleQuestionAnchorUserScroll(h.conversationKey, h.box);

  h.box.scrollHeight = 2600;
  h.applyQuestionScrollAnchor(h.conversationKey, h.box);
  assert.equal(h.box.scrollTop, 1000, 'later tokens do not push the question away');
});

test('manual reading cancels automatic movement even near the bottom and through completion', () => {
  const h = scrollHarness({ questionTop: 700 });
  h.box.scrollHeight = 1100;
  h.applyQuestionScrollAnchor(h.conversationKey, h.box);
  h.handleQuestionAnchorUserScroll(h.conversationKey, h.box); // programmatic event
  h.box.scrollTop = 650; // only 50 px from the bottom, inside the legacy threshold
  assert.equal(h.handleQuestionAnchorUserScroll(h.conversationKey, h.box), true);
  assert.equal(h.isQuestionScrollManual(h.conversationKey, h.box), true);

  h.withScrollGuard(h.box, h.conversationKey, () => { h.box.scrollHeight = 2000; });
  assert.equal(h.box.scrollTop, 650, 'completion/re-render preserves manual reading position');
  assert.equal(h.applyQuestionScrollAnchor(h.conversationKey, h.box), false);
});

test('completion snapshots keep the anchored question and answer beginning in view', () => {
  const h = scrollHarness();
  h.box.scrollHeight = 1600;
  h.applyQuestionScrollAnchor(h.conversationKey, h.box);
  assert.equal(h.box.scrollTop, 1000);
  h.handleQuestionAnchorUserScroll(h.conversationKey, h.box); // programmatic event

  h.withScrollGuard(h.box, h.conversationKey, () => { h.box.scrollHeight = 3000; });
  assert.equal(h.box.scrollTop, 1000, 'completion re-render remains at the reading start');
  h.applyChatScrollSnapshot(h.box, { mode: 'followBottom', scrollTop: 2600 }, h.conversationKey);
  assert.equal(h.box.scrollTop, 1000, 'a bottom snapshot cannot override the active question anchor');
});

test('short responses finish at the bottom without overscrolling the question', () => {
  const h = scrollHarness({ questionTop: 1000 });
  h.applyQuestionScrollAnchor(h.conversationKey, h.box);
  assert.equal(h.box.scrollTop, 800);
  h.withScrollGuard(h.box, h.conversationKey, () => { h.box.scrollHeight = 1250; });
  assert.equal(h.box.scrollTop, 850);
});

test('a new turn replaces the old anchor and keeps an oversized question at its beginning', () => {
  const h = scrollHarness();
  h.addQuestion(202, 1800);
  h.box.scrollHeight = 2500;
  h.box.scrollTop = 200;
  h.beginQuestionScrollAnchor(h.conversationKey, h.box, 202);
  h.applyQuestionScrollAnchor(h.conversationKey, h.box);
  assert.equal(h.box.scrollTop, 1800);
});

test('history switches and stale callbacks cannot move another displayed conversation', () => {
  const h = scrollHarness();
  h.box.dataset.conversationKey = '8';
  h.box.scrollTop = 321;
  assert.equal(h.applyQuestionScrollAnchor(7, h.box), false);
  h.applyChatScrollSnapshot(h.box, { mode: 'manual', scrollTop: 123 }, 8);
  assert.equal(h.box.scrollTop, 123, 'new conversation restores its own snapshot');

  const callbacks = [];
  const body = { ownerDocument: { defaultView: {
    requestAnimationFrame: fn => (callbacks.push(fn), callbacks.length),
    setTimeout: fn => (callbacks.push(fn), callbacks.length),
    cancelAnimationFrame() {}, clearTimeout() {}
  } } };
  h.context.chatScrollSnapshots.set(7, { mode: 'followBottom', scrollTop: 0 });
  h.scheduleFollowBottomStabilization(body, 7, h.box);
  h.box.scrollTop = 222;
  callbacks.forEach(fn => fn());
  assert.equal(h.box.scrollTop, 222, 'old stabilization ignores the newly displayed chat');
});

test('two views of one conversation keep independent anchor and manual state', () => {
  const h = scrollHarness();
  const secondQuestion = {
    getAttribute: name => name === 'data-message-id' ? String(h.questionId) : null,
    getBoundingClientRect: () => ({ top: 1000 - secondBox.scrollTop }),
    offsetTop: 1000
  };
  const secondBox = {
    dataset: { conversationKey: String(h.conversationKey) },
    clientHeight: 400,
    scrollHeight: 1600,
    scrollTop: 0,
    getClientRects: () => [1],
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll: () => [secondQuestion]
  };
  h.beginQuestionScrollAnchor(h.conversationKey, secondBox, h.questionId);
  h.box.scrollHeight = 1600;
  h.applyQuestionScrollAnchor(h.conversationKey, h.box);
  h.applyQuestionScrollAnchor(h.conversationKey, secondBox);
  assert.equal(h.box.scrollTop, 1000);
  assert.equal(secondBox.scrollTop, 1000);

  h.handleQuestionAnchorUserScroll(h.conversationKey, h.box); // programmatic event
  h.box.scrollTop = 700;
  h.handleQuestionAnchorUserScroll(h.conversationKey, h.box);
  assert.equal(h.isQuestionScrollManual(h.conversationKey, h.box), true);
  assert.equal(h.isQuestionScrollManual(h.conversationKey, secondBox), false);
  secondBox.scrollHeight = 2400;
  h.applyQuestionScrollAnchor(h.conversationKey, secondBox);
  assert.equal(secondBox.scrollTop, 1000, 'the second view remains independently anchored');
});

test('explicit scroll-to-bottom intent releases the question anchor', () => {
  const h = scrollHarness();
  h.releaseQuestionScrollAnchor(h.conversationKey, h.box);
  assert.equal(h.isQuestionScrollManual(h.conversationKey, h.box), true);
  h.box.scrollHeight = 2200;
  assert.equal(h.applyQuestionScrollAnchor(h.conversationKey, h.box), false);
});

test('all completion and resize paths are gated by the question-scroll state', () => {
  assert.match(bundle, /applyChatScrollSnapshot\(chatBox, baselineSnapshot, conversationKey\)/);
  assert.match(bundle, /if \(applyQuestionScrollAnchor\(conversationKey, chatBox\)\) \{/);
  assert.match(bundle, /if \(isQuestionScrollManual\(conversationKey, chatBox\)\) \{\s+chatBoxViewportState = current;/);
  assert.match(bundle, /releaseQuestionScrollAnchor\(getConversationKey\(item\), chatBox\);\s+chatBox\.scrollTo/);
});

test('wheel intent releases the anchor before a deferred native scroll event or streaming render', () => {
  const h = scrollHarness();
  const start = bundle.indexOf('      chatBox.addEventListener("wheel", (event) => {');
  const end = bundle.indexOf('      }, { passive: true });', start);
  assert(start > 0 && end > start);
  let wheel;
  h.context.chatBox = h.box;
  h.context.item = {};
  h.context.getConversationKey = () => h.conversationKey;
  h.box.addEventListener = (name, handler) => { assert.equal(name, 'wheel'); wheel = handler; };
  vm.runInContext(bundle.slice(start, end + '      }, { passive: true });'.length), h.context);
  h.box.scrollHeight = 1600;
  h.applyQuestionScrollAnchor(h.conversationKey, h.box);
  wheel({ deltaY: 0 });
  wheel({ deltaY: 100, ctrlKey: true });
  assert.equal(h.isQuestionScrollManual(h.conversationKey, h.box), false, 'horizontal/zoom gestures do not release the anchor');
  wheel({ deltaY: 100, ctrlKey: false });
  h.box.scrollTop = 1024;
  h.withScrollGuard(h.box, h.conversationKey, () => { h.box.scrollHeight += 800; });
  assert.equal(h.box.scrollTop, 1024, 'streaming cannot restore the old anchor before the native scroll event');
  assert.equal(h.isQuestionScrollManual(h.conversationKey, h.box), true);
});

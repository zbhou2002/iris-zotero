import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const source = fs.readFileSync(new URL('src/content/scripts/iris-codex-models.js', import.meta.url), 'utf8');
const bundle = fs.readFileSync(new URL('src/content/scripts/aidea.js', import.meta.url), 'utf8');
const context = vm.createContext({ setTimeout, clearTimeout });
vm.runInContext(source, context);
const plain = value => JSON.parse(JSON.stringify(value));

function rpc({ pages = [{ data: [{ model: 'future-model', displayName: 'Future model', isDefault: true }], nextCursor: null }], account = { type: 'chatgpt' }, failure, eof = false } = {}) {
  let queue = [], page = 0, kills = 0, closes = 0;
  const sent = [];
  const process = {
    stdin: { async write(line) {
      const message = JSON.parse(line); sent.push(message);
      if (message.id === undefined) return;
      let result = {};
      if (message.method === 'account/read') result = { account };
      if (message.method === 'model/list') result = pages[page++];
      const response = message.method === failure ? { id: message.id, error: { code: -1 } } : { id: message.id, result };
      const text = JSON.stringify({ method: 'notification', params: {} }) + '\n' + JSON.stringify(response) + '\n';
      queue.push(text.slice(0, 7), text.slice(7));
    }, async close() { closes++; } },
    stdout: { async readString() { return eof ? '' : queue.shift() || ''; } },
    stderr: { async readString() { return ''; } },
    async kill() { kills++; }
  };
  return { process, sent, get kills() { return kills; }, get closes() { return closes; } };
}

test('Codex catalog uses server names/order/defaults and filters hidden entries, without model-name assumptions', () => {
  const rows = context.normalizeIrisCodexModels([
    { model: 'new-b', displayName: 'B', isDefault: true }, { model: 'old-a' },
    { model: 'hidden', hidden: true }, { slug: 'internal', visibility: 'hide' },
    { slug: 'visible', visibility: 'list', display_name: 'Visible' }, { model: 'new-b' }, {}, null
  ]);
  assert.deepEqual(plain(rows.map(row => row.id)), ['new-b', 'old-a', 'visible']);
  assert.equal(rows[0].isDefault, true);
  assert.equal(rows[2].label, 'Visible');
});

test('model discovery initializes, checks login, follows pagination and closes the process without inference', async () => {
  const h = rpc({ pages: [{data: [{model: 'a'}], nextCursor: 'next'}, {data: [{model: 'b'}], nextCursor: null}] });
  const result = await context.readIrisCodexCatalog({ launch: async () => h.process });
  assert.deepEqual(plain(result.map(row => row.id)), ['a', 'b']);
  assert.deepEqual(h.sent.map(m => m.method), ['initialize', 'initialized', 'account/read', 'model/list', 'model/list']);
  assert.equal(h.sent.at(-1).params.cursor, 'next');
  assert.equal(h.sent.at(-1).params.includeHidden, false);
  assert.equal(h.kills, 1); assert.equal(h.closes, 1);
});

test('signed-out and API-key accounts are not presented as Codex subscription models', async () => {
  for (const account of [null, {type: 'apiKey'}]) {
    const h = rpc({account});
    await assert.rejects(context.readIrisCodexCatalog({ launch: async () => h.process }), /signin/);
    assert(!h.sent.some(m => m.method === 'model/list')); assert.equal(h.kills, 1);
  }
});

test('RPC failure, empty catalog, repeated pagination and process exit are bounded failures with cleanup', async () => {
  for (const options of [{failure:'model/list'}, {pages:[{data:[],nextCursor:null}]},
    {pages:[{data:[{model:'a'}],nextCursor:'same'}, {data:[{model:'b'}],nextCursor:'same'}]}, {eof:true}]) {
    const h = rpc(options);
    await assert.rejects(context.readIrisCodexCatalog({launch:async () => h.process}));
    assert.equal(h.kills, 1);
  }
});

test('hung discovery times out and kills only its own child', async () => {
  const h = rpc(); h.process.stdout.readString = () => new Promise(() => {});
  await assert.rejects(context.readIrisCodexCatalog({launch:async () => h.process, timeout:10}), /timeout/);
  assert.equal(h.kills, 1);
});

test('a late process launch after timeout is still cleaned up', async () => {
  const h = rpc(); let resolve;
  await assert.rejects(context.readIrisCodexCatalog({ launch: () => new Promise(r => {resolve = r;}), timeout:10 }), /timeout/);
  resolve(h.process); await new Promise(r => setTimeout(r, 0));
  assert.equal(h.kills, 1);
});

test('simultaneous menus share one refresh; success replaces old models and forced refresh discovers additions/removals', async () => {
  let cache = [{id:'old'}], calls = 0, resolve;
  const states = [];
  const service = context.createIrisCodexCatalog({read: () => {calls++; return new Promise(r => {resolve=r;});},
    readCache: () => cache, writeCache: rows => {cache=rows;}, notify: state => states.push(state.phase)});
  const first = service.refresh(), second = service.refresh({force:true});
  assert.equal(first, second); await Promise.resolve(); assert.equal(calls, 1);
  resolve([{id:'new'}]); await first;
  assert.deepEqual(cache, [{id:'new'}]); assert.deepEqual(states, ['loading','ready']);
  await service.refresh(); assert.equal(calls, 1);
  const next = service.refresh({force:true}); await Promise.resolve(); resolve([{id:'next'}]); await next;
  assert.equal(calls, 2); assert.deepEqual(cache, [{id:'next'}]);
});

test('offline discovery retains only previously fetched rows, reports failure and permits retry; sign-out clears rows', async () => {
  let cache = [{id:'last-good'}], error = 'timeout';
  const service = context.createIrisCodexCatalog({read: async () => {throw Error(error);},
    readCache: () => cache, writeCache: rows => {cache=rows;}});
  await service.refresh(); assert.equal(service.snapshot().error, 'timeout'); assert.equal(cache[0].id, 'last-good');
  error = 'signin'; await service.refresh(); assert.equal(service.snapshot().error, 'signin'); assert.equal(cache.length, 0);
});

test('addon shutdown does not allow a late result to overwrite preferences', async () => {
  let cache = [], resolve;
  const service = context.createIrisCodexCatalog({read: () => new Promise(r => {resolve=r;}), readCache: () => cache, writeCache: rows => {cache=rows;}});
  const pending = service.refresh(); await Promise.resolve(); service.dispose(); resolve([{id:'late'}]); await pending;
  assert.equal(cache.length, 0);
});

test('Windows desktop bundle is preferred; macOS application paths and standalone fallback are supported', async () => {
  for (const platform of ['windows', 'macos', 'linux']) {
    const exists = new Set(platform === 'windows' ? ['C:/local/OpenAI/Codex/bin/new/codex.exe'] : platform === 'macos' ? ['/Applications/Codex.app/Contents/Resources/codex'] : ['/usr/bin/codex']);
    const host = vm.createContext({setTimeout, clearTimeout, currentPlatform:()=>platform, homeDir:()=>'/users/test',
      getEnv:()=> 'C:/local', joinPath2:(...parts)=>parts.filter(p=>p!==platform).join('/'),
      resolveProviderCliExecutablePath:async()=>'/usr/bin/codex', resolveExecutablePath:()=>'/usr/bin/codex', pathExists2:p=>exists.has(p),
      IOUtils:{getChildren:async()=>['C:/local/OpenAI/Codex/bin/new'], stat:async()=>({type:'regular',lastModified:1})}});
    vm.runInContext(source, host);
    assert.equal(await host.resolveIrisCodexExecutable(), [...exists][0]);
  }
});

test('production wiring refreshes startup and both pickers, removes static Codex fallback and keeps custom readiness intact', () => {
  assert(!bundle.includes('CODEX_KNOWN_MODELS'));
  assert(!bundle.includes('codex/models?client_version=1.0.0'));
  assert.match(bundle, /const openModelMenu = \(\) => \{[\s\S]{0,160}getIrisCodexCatalog\(\).refresh\(\{ force: true \}\)/);
  assert.match(bundle, /selectionTranslateModelDropdown\?\.querySelector[\s\S]{0,160}getIrisCodexCatalog\(\).refresh/);
  assert.match(bundle, /addon.data.initialized = true;\s+void getIrisCodexCatalog\(\).refresh\(\)/);
  assert.match(bundle, /if \(detail.irisCodexCatalog\) return;/);
});

// Model discovery only: never start a thread, run inference, or copy OAuth tokens.
function normalizeIrisCodexModels(rows) {
  if (!Array.isArray(rows)) throw new Error('catalog');
  const seen = new Set();
  return rows.filter(row => row && row.hidden !== true && (!row.visibility || row.visibility === 'list'))
    .map(row => ({ id: String(row.model || row.slug || row.id || '').trim(),
      label: String(row.displayName || row.display_name || row.model || row.slug || row.id || '').trim(),
      isDefault: row.isDefault === true,
      supportedReasoningEfforts: row.supportedReasoningEfforts || [],
      defaultReasoningEffort: row.defaultReasoningEffort || '' }))
    .filter(row => row.id && !seen.has(row.id) && seen.add(row.id));
}

async function readIrisCodexCatalog({ launch, timers = { setTimeout, clearTimeout }, timeout = 15000 }) {
  let process, expired = false, timer;
  const work = async () => {
    process = await launch();
    if (expired) { process.kill(); throw new Error('timeout'); }
    // Drain diagnostics without retaining or logging potentially private details.
    const drain = async () => { try { while (await process.stderr?.readString()) {} } catch {} };
    void drain();
    let buffer = '', sequence = 0;
    const send = value => process.stdin.write(JSON.stringify(value) + '\n');
    const request = async (method, params) => {
      const id = ++sequence;
      await send({ id, method, params });
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) {
          const chunk = await process.stdout.readString();
          if (!chunk) throw new Error('closed');
          buffer += chunk;
          if (buffer.length > 4 * 1024 * 1024) throw new Error('catalog');
          continue;
        }
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        // Refuse unexpected server requests; discovery never grants approvals.
        if (message.method && message.id !== undefined) {
          await send({ id: message.id, error: { code: -32601, message: 'Model discovery only' } });
          continue;
        }
        if (message.id !== id) continue;
        if (message.error) throw new Error('catalog');
        return message.result;
      }
    };
    await request('initialize', { clientInfo: { name: 'iris_model_catalog', version: '1.0.0' }, capabilities: { experimentalApi: false } });
    await send({ method: 'initialized', params: {} });
    const auth = await request('account/read', { refreshToken: false });
    if (auth?.account?.type !== 'chatgpt') throw new Error('signin');
    const rows = [], cursors = new Set();
    let cursor = null;
    do {
      const page = await request('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(page?.data)) throw new Error('catalog');
      rows.push(...page.data);
      cursor = page.nextCursor;
      if (cursor && (cursors.has(cursor) || cursors.size >= 50)) throw new Error('catalog');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    const models = normalizeIrisCodexModels(rows);
    if (!models.length) throw new Error('empty');
    return models;
  };
  try {
    return await Promise.race([work(), new Promise((_, reject) => {
      timer = timers.setTimeout(() => { expired = true; reject(new Error('timeout')); }, timeout);
    })]);
  } finally {
    expired = true;
    timers.clearTimeout(timer);
    try { await process?.stdin.close(); } catch {}
    try { await process?.kill(); } catch {}
  }
}

function createIrisCodexCatalog({ read, readCache, writeCache, notify = () => {}, now = Date.now }) {
  let pending = null, disposed = false;
  let state = { phase: 'idle', error: '', updatedAt: 0 };
  const snapshot = () => ({ ...state });
  const emit = () => { if (!disposed) notify(snapshot()); };
  return {
    snapshot,
    dispose() { disposed = true; },
    refresh({ force = false } = {}) {
      if (pending) return pending;
      if (!force && state.phase === 'ready' && now() - state.updatedAt < 60000) return Promise.resolve(readCache());
      state = { ...state, phase: 'loading', error: '' }; emit();
      pending = Promise.resolve().then(read).then(models => {
        if (!disposed) { writeCache(models); state = { phase: 'ready', error: '', updatedAt: now() }; emit(); }
        return models;
      }).catch(error => {
        if (!disposed) {
          const code = ['missing', 'signin', 'timeout', 'empty'].includes(error?.message) ? error.message : 'unavailable';
          if (code === 'signin') writeCache([]);
          state = { ...state, phase: 'error', error: code }; emit();
        }
        return readCache();
      }).finally(() => { pending = null; });
      return pending;
    }
  };
}

async function resolveIrisCodexExecutable() {
  const platform = currentPlatform(), home = homeDir();
  const candidates = [];
  const io = globalThis.IOUtils;
  if (platform === 'windows') {
    const local = getEnv('LOCALAPPDATA') || joinPath2(home, 'AppData', 'Local', platform);
    const bin = joinPath2(local, 'OpenAI', 'Codex', 'bin', platform);
    const installed = [];
    try {
      for (const directory of await io.getChildren(bin)) {
        const executable = joinPath2(directory, 'codex.exe', platform);
        try { const stat = await io.stat(executable); if (stat.type === 'regular') installed.push({ executable, modified: stat.lastModified }); } catch {}
      }
    } catch {}
    installed.sort((a, b) => b.modified - a.modified);
    candidates.push(...installed.map(row => row.executable));
  } else if (platform === 'macos') {
    candidates.push('/Applications/Codex.app/Contents/Resources/codex',
      joinPath2(home, 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex', platform));
  }
  // Desktop bundle first, then the official standalone/PATH installation.
  candidates.push(await resolveProviderCliExecutablePath('openai-codex'), resolveExecutablePath('codex'));
  return candidates.find(candidate => candidate && pathExists2(candidate) && !/\.(cmd|bat|ps1)$/i.test(candidate)) || null;
}

var irisCodexCatalog;
function getIrisCodexCatalog() {
  if (irisCodexCatalog) return irisCodexCatalog;
  const key = 'extensions.zotero.aidea.oauthModelListCache';
  const metaKey = 'extensions.zotero.aidea.iris.codexCatalogVersion';
  const readAll = () => {
    try {
      const value = JSON.parse(Zotero.Prefs.get(key, true) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  };
  const write = models => { const cache = readAll(); cache['openai-codex'] = models; Zotero.Prefs.set(key, JSON.stringify(cache), true); };
  // Migrate only the old Codex list, never custom endpoints or other providers.
  if (Zotero.Prefs.get(metaKey, true) !== 1) { write([]); Zotero.Prefs.set(metaKey, 1, true); }
  irisCodexCatalog = createIrisCodexCatalog({
    readCache: () => readAll()['openai-codex'] || [], writeCache: write,
    read: async () => {
      const executable = await resolveIrisCodexExecutable();
      if (!executable) throw new Error('missing');
      let Subprocess;
      try { ({ Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs')); }
      catch { ({ Subprocess } = ChromeUtils.import('resource://gre/modules/Subprocess.jsm')); }
      return readIrisCodexCatalog({ launch: () => Subprocess.call({ command: executable,
        arguments: ['app-server', '--listen', 'stdio://'], workdir: homeDir(), stderr: 'pipe' }) });
    },
    notify: () => {
      const docs = new Set((Zotero.getMainWindows?.() || []).map(win => win.document));
      try { for (const reader of Zotero.Reader?._readers || []) if (reader._window?.document) docs.add(reader._window.document); } catch {}
      for (const doc of docs) {
        try { doc.dispatchEvent(new doc.defaultView.CustomEvent('llm-models-changed', { detail: { irisCodexCatalog: true } })); } catch {}
      }
    }
  });
  return irisCodexCatalog;
}

function appendIrisCodexCatalogStatus(menu, chinese) {
  const catalog = getIrisCodexCatalog(), state = catalog.snapshot();
  const doc = menu.ownerDocument;
  const line = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  line.className = 'llm-model-menu-hint iris-codex-catalog-status';
  line.setAttribute('role', 'status');
  const text = (zh, en) => chinese ? zh : en;
  const errors = {
    missing: text('未找到本机 Codex，请安装或更新 Codex。', 'Local Codex not found. Install or update Codex.'),
    signin: text('请先在 Codex 中登录 ChatGPT 账号。', 'Sign in to ChatGPT in Codex first.'),
    timeout: text('读取 Codex 模型超时。', 'Codex model discovery timed out.'),
    empty: text('Codex 未返回可显示的模型。', 'Codex returned no visible models.'),
    unavailable: text('暂时无法刷新 Codex 模型。', 'Could not refresh Codex models.')
  };
  line.textContent = state.phase === 'loading' ? text('正在从本机 Codex 刷新模型…', 'Refreshing models from local Codex…')
    : state.phase === 'error' ? (errors[state.error] || errors.unavailable) + (state.error === 'signin' ? '' : text(' 如有旧列表，暂时保留。', ' Any previous list is retained.'))
    : text('模型来自本机 Codex', 'Models from local Codex');
  const retry = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button');
  retry.type = 'button'; retry.className = 'llm-response-menu-item iris-codex-refresh';
  retry.textContent = text('刷新', 'Refresh'); retry.disabled = state.phase === 'loading';
  retry.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void catalog.refresh({ force: true }); });
  line.appendChild(retry); menu.appendChild(line);
}

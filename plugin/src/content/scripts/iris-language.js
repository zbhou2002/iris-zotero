/* Live language changes update UI chrome in place, never reconstruct panels. */
function createIrisLanguage({ prefs, systemLocales, appLocale, report = () => {} }) {
  const key = 'extensions.zotero.aidea.iris.uiLanguage';
  function choice() {
    try {
      const value = prefs.get(key, true);
      return ['en-US', 'zh-CN'].includes(value) ? value : 'auto';
    } catch { return 'auto'; }
  }
  function detect() {
    let locale;
    try { locale = systemLocales()?.[0]; } catch {}
    if (!locale) { try { locale = appLocale(); } catch {} }
    return /^zh(?:[-_]|$)/i.test(String(locale || '')) ? 'zh-CN' : 'en-US';
  }
  let effective = choice() === 'auto' ? detect() : choice();
  const listeners = new Set();
  return {
    choice,
    current: () => effective,
    subscribe(callback, owner) {
      const entry = { callback, owner }; listeners.add(entry);
      return () => listeners.delete(entry);
    },
    set(value) {
      if (!['auto', 'en-US', 'zh-CN'].includes(value)) throw new Error('Unsupported UI language');
      prefs.set(key, value, true);
      effective = value === 'auto' ? detect() : value;
      for (const entry of [...listeners]) {
        if (entry.owner && !entry.owner.isConnected) { listeners.delete(entry); continue; }
        try { entry.callback(effective); } catch (error) { report(error); }
      }
    },
    attach({ doc, host }) {
      let zh = effective === 'zh-CN';
      const el = tag => doc.createElementNS('http://www.w3.org/1999/xhtml', tag);
      const card = el('div'); card.className = 'iris-settings-section iris-language-settings';
      const label = el('label');
      const labelText = el('span'); labelText.textContent = zh ? '界面语言' : 'Interface language';
      label.append(labelText);
      const select = el('select'); select.className = 'llm-set-select iris-language-select';
      select.setAttribute('aria-label', labelText.textContent);
      for (const [value, name] of [['auto', zh ? '跟随系统' : 'Follow system'], ['en-US', 'English'], ['zh-CN', '简体中文']]) {
        const option = el('option'); option.value = value; option.textContent = name; select.append(option);
      }
      select.value = choice();
      const hint = el('p'); hint.className = 'iris-settings-description'; hint.setAttribute('role', 'status');
      const refresh = () => {
        zh = effective === 'zh-CN';
        labelText.textContent = zh ? '界面语言' : 'Interface language';
        select.setAttribute('aria-label', labelText.textContent);
        select.options[0].textContent = zh ? '跟随系统' : 'Follow system';
        select.value = choice();
        hint.textContent = zh ? '立即生效；不会改变翻译目标语言或聊天内容。' : 'Applies immediately. Translation language and conversations are unchanged.';
      };
      refresh(); this.subscribe(refresh, card);
      select.addEventListener('change', () => {
        try {
          this.set(select.value);
        } catch {
          select.value = choice();
          hint.textContent = zh ? '语言设置未能保存，请重试。' : 'Could not save the language. Please try again.';
        }
      });
      label.append(select); card.append(label, hint); host.append(card);
      return card;
    }
  };
}

/* Exact UI-label translations only. Never visit message content, editable values,
 * model/provider names, attachment names, saved prompts, or conversation history. */
function refreshIrisChrome(root, language, pairs) {
  const translations = new Map();
  for (const [en, zh] of pairs) {
    if (typeof en !== 'string' || typeof zh !== 'string' || !en || !zh) continue;
    translations.set(en, language === 'zh-CN' ? zh : en);
    translations.set(zh, language === 'zh-CN' ? zh : en);
  }
  const excluded = '#llm-chat-box,option,[contenteditable],[data-iris-user-label="true"],.llm-context-previews,.llm-file-context-list,.llm-set-table,.llm-set-provider-title,#llm-title-paper,#llm-paper-picker,#llm-model-menu,#llm-model-toggle,#llm-retry-model-menu,#llm-history-menu,#aidea-selection-translate-model';
  function translated(value) {
    const trimmed = value.trim();
    if (translations.has(trimmed)) return value.replace(trimmed, translations.get(trimmed));
    const decorated = trimmed.match(/^([\p{S}\p{P}]\s+)(.+)$/u);
    return decorated && translations.has(decorated[2])
      ? value.replace(trimmed, decorated[1] + translations.get(decorated[2])) : value;
  }
  function visit(node) {
    if (node.nodeType === 3) {
      const next = translated(node.nodeValue || '');
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== 1 || node.matches(excluded)) return;
    for (const attr of ['title', 'aria-label', 'placeholder', 'data-label', 'data-default-label']) {
      const value = node.getAttribute(attr);
      if (value) { const next = translated(value); if (next !== value) node.setAttribute(attr, next); }
    }
    if (['input', 'textarea'].includes(node.localName)) return;
    for (const child of node.childNodes) visit(child);
  }
  visit(root);
  root.lang = language === 'zh-CN' ? 'zh-CN' : 'en-US'; root.dir = 'ltr';
}
var irisLanguageController;
function getIrisLanguage() {
  return irisLanguageController || (irisLanguageController = createIrisLanguage({
    prefs: Zotero.Prefs,
    systemLocales: () => Components.classes['@mozilla.org/intl/ospreferences;1']
      .getService(Components.interfaces.mozIOSPreferences).systemLocales,
    appLocale: () => Zotero.locale,
    report: error => Zotero.logError(error)
  }));
}

/* One language for the entire addon session. A change takes effect on restart,
 * so changing settings never destroys a draft or interrupts an active reply. */
function createIrisLanguage({ prefs, systemLocales, appLocale }) {
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
  const effective = choice() === 'auto' ? detect() : choice();
  return {
    choice,
    current: () => effective,
    set(value) {
      if (!['auto', 'en-US', 'zh-CN'].includes(value)) throw new Error('Unsupported UI language');
      prefs.set(key, value, true);
    },
    attach({ doc, host }) {
      const zh = effective === 'zh-CN';
      const el = tag => doc.createElementNS('http://www.w3.org/1999/xhtml', tag);
      const card = el('div'); card.className = 'iris-settings-section iris-language-settings';
      const label = el('label'); label.textContent = zh ? '界面语言' : 'Interface language';
      const select = el('select'); select.className = 'llm-set-select iris-language-select';
      select.setAttribute('aria-label', label.textContent);
      for (const [value, name] of [['auto', zh ? '跟随系统' : 'Follow system'], ['en-US', 'English'], ['zh-CN', '简体中文']]) {
        const option = el('option'); option.value = value; option.textContent = name; select.append(option);
      }
      select.value = choice();
      const hint = el('p'); hint.className = 'iris-settings-description'; hint.setAttribute('role', 'status');
      hint.textContent = zh ? '重启 Zotero 后生效；不会改变翻译目标语言。' : 'Applies after restarting Zotero. Translation language is unchanged.';
      select.addEventListener('change', () => {
        try {
          this.set(select.value);
          hint.textContent = zh ? '已保存。重启 Zotero 后统一切换界面语言。' : 'Saved. Restart Zotero to apply the language throughout Iris.';
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
var irisLanguageController;
function getIrisLanguage() {
  return irisLanguageController || (irisLanguageController = createIrisLanguage({
    prefs: Zotero.Prefs,
    systemLocales: () => Services.locale.systemLocales,
    appLocale: () => Zotero.locale
  }));
}

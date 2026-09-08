import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const release = JSON.parse(fs.readFileSync(path.join(root, '../release.json'), 'utf8'));
const source = path.join(root, 'src/content/scripts/aidea.js');
let text = fs.readFileSync(path.join(root, 'baseline-aidea.js'), 'utf8');
if (text.includes('\0')) throw new Error('Corrupt baseline');
function replaceRange(start, end, replacement) {
  const a = text.indexOf(start), b = text.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`Missing build anchor: ${start}`);
  text = text.slice(0, a) + replacement + text.slice(b);
}
function replaceOnce(anchor, replacement) {
  if (text.split(anchor).length !== 2) throw new Error(`Expected one build anchor: ${anchor}`);
  text = text.replace(anchor, replacement);
}
const language = fs.readFileSync(path.join(root, 'src/content/scripts/iris-language.js'), 'utf8');
replaceRange('  function getUiLang() {', '  function copyToClipboard(text2) {', language + '\n  function getUiLang() { return getIrisLanguage().current(); }\n');
replaceRange('  function getPanelLang() {', '  function getPanelI18n() {', '  function getPanelLang() { return getIrisLanguage().current(); }\n');
replaceRange('  function getLang() {', '  function applyPanelLanguageAttributes(doc, lang) {', '  function getLang() { return getIrisLanguage().current(); }\n');
// The gear is now a toggle, not a dedicated settings tab. The old draggable
// height synchronizer still treated every gear click as "enter settings" and
// later resize broadcasts could hide an already-restored chat composer.
replaceRange('    const existingHeightSync = panelRoot.__llmHeightSync;',
  '    const isGlobalMode = () => Boolean(item && isGlobalPortalItem(item));', `    panelRoot.__llmHeightSync?.dispose?.();
    panelRoot.__llmHeightSync = null;
    for (const wrapper of [contentWrapper, bottomWrapper]) {
      wrapper?.style.removeProperty('height');
      wrapper?.style.removeProperty('flex');
    }
    panelRoot.__irisRestoreView?.();
    for (const id of ['#llm-tab-btn-setting', '#llm-tab-btn-discussion']) {
      panelRoot.querySelector(id)?.addEventListener('click', () => {
        if (panelRoot.dataset.activeTab === 'discussion') refreshChatReadinessForLanguage();
      });
    }
`);
replaceOnce('    const applyActiveView = (tab) => {', `    const applyActiveView = (tab, { restore = false } = {}) => {
      tab = tab === 'setting' ? 'setting' : 'discussion';`);
replaceOnce('      persistActiveTab(body, tab);', '      if (!restore) persistActiveTab(body, tab);');
replaceOnce('      if (isDiscussion) {\n        doc.defaultView?.requestAnimationFrame',
  '      if (isDiscussion && !restore) {\n        doc.defaultView?.requestAnimationFrame');
replaceOnce('    for (const btn of tabBtns) {', `    // Restore presentation only: never reload a conversation, clear a draft,
    // scroll the chat or steal keyboard focus when the host becomes visible.
    container.__irisRestoreView = () => applyActiveView(container.dataset.activeTab, { restore: true });
    container.__irisRestoreView();
    for (const btn of tabBtns) {`);
replaceOnce('    const runResponsiveResizeLayout = () => {', `    const runResponsiveResizeLayout = () => {
      panelRoot?.__irisRestoreView?.();`);
replaceOnce('    if (state.hasBootstrapped) return;\n    let resolveBootstrap', `    if (state.hasBootstrapped) {
      host.querySelector('.llm-panel')?.__irisRestoreView?.();
      return;
    }
    let resolveBootstrap`);
replaceOnce('    host.style.display = "flex";\n    return { win, host };', `    host.style.display = "flex";
    host.querySelector('.llm-panel')?.__irisRestoreView?.();
    return { win, host };`);
replaceOnce('    if (enabled) {\n      paneParent.scrollTop = pane.offsetTop;', `    if (enabled) {
      pane.querySelector('.llm-panel')?.__irisRestoreView?.();
      paneParent.scrollTop = pane.offsetTop;`);
replaceOnce('        paneParent.scrollTop = pane.offsetTop;', `        if (!pane.isConnected || !pane.classList.contains('llm-reader-focus-pane')) return;
        pane.querySelector('.llm-panel')?.__irisRestoreView?.();
        paneParent.scrollTop = pane.offsetTop;`);
const voice = fs.readFileSync(path.join(root, 'src/content/scripts/iris-local-voice.js'), 'utf8');
replaceRange('    const launchWindowsDictation = () => {', '    const sendSlot = createElement',
  voice + `\n    installIrisLocalVoice({ doc, inputBox, inputSection, voiceBtn, voiceCancelBtn,
      announce: announceVoiceStatus, isChinese: () => getPanelLang().startsWith('zh'),
      root: PathUtils.join(getBaseWritableDir(), 'iris-speech'), io: IOUtils,
      paths: PathUtils, components: Components, zotero: Zotero });\n`);
replaceRange('  async function translateSelectedTextForReader(params) {', '  async function warmSelectionTranslateColdStartForReader(params) {',
  fs.readFileSync(path.join(root, 'selection-translate.js'), 'utf8'));
// Eliminate automatic model warmup too, including when a previous version left
// the automatic-translation preference enabled.
replaceRange('  async function warmSelectionTranslateColdStartForReader(params) {', '  var DEFAULT_SOURCE_LANG,',
  '  async function warmSelectionTranslateColdStartForReader() { return false; }\n');
const sendStart = text.indexOf('    const handleSendIntent = async () => {');
if (sendStart < 0) throw new Error('Missing send handler');
replaceRange('    const handleSendIntent = async () => {', '    sendBtn.addEventListener("click",', `    let voiceSendPending = false;
    const handleSendIntent = async () => {
      if (voiceSendPending) return;
      const voiceController = inputSection?.__irisVoiceController;
      if (voiceController?.isActive?.()) {
        voiceSendPending = true;
        sendBtn.disabled = true;
        let transcribed = false;
        try {
          transcribed = await voiceController.stopAndWait();
        } finally {
          voiceSendPending = false;
          sendBtn.disabled = false;
        }
        if (transcribed) commitCurrentInput();
        return;
      }
      commitCurrentInput();
    };
`);
const essence = fs.readFileSync(path.join(root, 'src/content/scripts/iris-essence.js'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'src/content/scripts/iris-settings.js'), 'utf8');
const externalLinks = fs.readFileSync(path.join(root, 'src/content/scripts/iris-external-links.js'), 'utf8');
text = text.replace('  function buildUI(body, item) {', externalLinks + '\n' + settings + '\n' + essence + '\n  function buildUI(body, item) {');
replaceOnce('    container.appendChild(statusLine);', `    container.appendChild(statusLine);
    installIrisExternalLinks({ root: container, launch: url => Zotero.launchURL(url), report: reason => {
      const zh = getPanelLang().startsWith('zh');
      const message = reason === 'invalid'
        ? (zh ? '此链接不是有效的 HTTP/HTTPS 网页地址。' : 'This is not a valid HTTP/HTTPS web address.')
        : (zh ? '无法打开链接，请检查系统默认浏览器。' : 'Could not open the link. Check your default browser.');
      setStatus(statusLine, message, 'error'); statusLine.title = message;
    } });`);
const essenceAnchor = '    discussionBottom.append(shortcutsRow, inputSection);';
if (!text.includes(essenceAnchor)) throw new Error('Missing essence toolbar anchor');
text = text.replace(essenceAnchor, `
    try { createIrisEssence({ Zotero, callModel: callLLM,
      getProfile: () => getSelectedProfileForItem(item?.id), resolveDocument: resolveReaderDocument,
      chinese: () => getPanelLang().startsWith('zh'), log: (...args) => ztoolkit.log(...args)
    }).attach({ doc, host: headerInfo, item, onStatus: (message) => {
      setStatus(statusLine, message, 'ready'); statusLine.title = message;
    } }); }
    catch (error) { ztoolkit.log('Iris essence toolbar', error); }
    discussionBottom.append(shortcutsRow, inputSection);`);
new vm.Script(text);
const promptSettingsAnchor = '    root.appendChild(selectionTranslateGroup);';
if (!text.includes(promptSettingsAnchor)) throw new Error('Missing essence settings anchor');
text = text.replace(promptSettingsAnchor, promptSettingsAnchor + `
    createIrisEssence({ Zotero, chinese: () => getLang().startsWith('zh') })
      .attachSettings({ doc, host: root });
    enhanceIrisSettings({ doc, root, chinese: () => getLang().startsWith('zh'),
      connectionModeBox, connectionModeTitle, connectionModeBody,
      selectionTranslateGroup, selectionTranslateTitle, selectionTranslateBody,
      oauthTabBtn, customTabBtn, oauthPanel, customPanel, authCards });
    getIrisLanguage().attach({ doc, host: root });`);
new vm.Script(text);
for (const removed of ['getVoiceApiKey', 'api.openai.com/v1/audio/transcriptions', 'SpeechRecognition ||']) {
  if (text.includes(removed)) throw new Error(`Cloud voice path remains: ${removed}`);
}
fs.writeFileSync(source, text);
const manifestPath = path.join(root, 'src/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.version = release.version;
manifest.homepage_url = `https://github.com/${release.repository}#readme`;
manifest.author = 'zbhou2002 (Iris); zhile and upstream contributors (AIdea)';
manifest.applications.zotero.update_url = `https://github.com/${release.repository}/releases/latest/download/updates.json`;
manifest.applications.zotero.strict_min_version = '7.0';
manifest.applications.zotero.strict_max_version = '9.0.*';
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Built Iris ${manifest.version}: ${Buffer.byteLength(text)} bytes, syntax valid`);

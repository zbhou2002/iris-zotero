import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('src/content/scripts/iris-language.js', import.meta.url), 'utf8');
function setup(value, locale = 'en-US', app = 'zh-CN') {
  const context = vm.createContext({}); vm.runInContext(source, context);
  const data = new Map([['extensions.zotero.aidea.iris.uiLanguage', value], ['extensions.zotero.aidea.uiLanguage', 'zh-CN']]);
  let writes = 0;
  const args = { prefs: { get: k => data.get(k), set: (k,v) => { data.set(k,v); writes++; } }, systemLocales: () => [locale], appLocale: () => app };
  return { controller: context.createIrisLanguage(args), restart: () => context.createIrisLanguage(args), writes: () => writes };
}
test('default follows OS, not a stale Chinese preference or Zotero app override', () => {
  const h = setup(undefined); assert.equal(h.controller.current(), 'en-US'); assert.equal(h.controller.choice(), 'auto'); assert.equal(h.writes(), 0);
});
test('Chinese locales map to the available Simplified Chinese interface', () => {
  for (const code of ['zh-CN','zh_TW','zh-Hans','zh-HK']) assert.equal(setup('auto',code).controller.current(),'zh-CN');
});
test('explicit language overrides OS; unsupported OS languages fall back to English', () => {
  assert.equal(setup('en-US','zh-CN').controller.current(),'en-US');
  assert.equal(setup('zh-CN','en-US').controller.current(),'zh-CN');
  assert.equal(setup('auto','de-DE').controller.current(),'en-US');
  assert.equal(setup('bad','fr-FR').controller.choice(),'auto');
});
test('setting persists but keeps all open panels in one language until restart', () => {
  const h=setup('auto'); h.controller.set('zh-CN'); assert.equal(h.controller.current(),'en-US');
  assert.equal(h.controller.choice(),'zh-CN'); assert.equal(h.restart().current(),'zh-CN');
  h.controller.set('auto'); assert.equal(h.restart().current(),'en-US');
  assert.throws(()=>h.controller.set('nonsense')); assert.equal(h.writes(),2);
});
test('Zotero locale is a fallback if the system locale is unavailable', () => {
  assert.equal(setup('auto',undefined,'zh-CN').controller.current(),'en-US');
  assert.equal(setup('auto','','zh-CN').controller.current(),'zh-CN');
});
test('production language entry points all use the session controller', () => {
  const bundle=fs.readFileSync(new URL('src/content/scripts/aidea.js',import.meta.url),'utf8');
  for(const name of ['getLang','getPanelLang','getUiLang']) assert.ok(bundle.includes(`function ${name}() { return getIrisLanguage().current(); }`));
  assert.ok(bundle.includes('getIrisLanguage().attach({ doc, host: root })'));
});

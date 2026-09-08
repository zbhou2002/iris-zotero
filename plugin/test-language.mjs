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
test('setting persists and takes effect immediately without restart', () => {
  const h=setup('auto'); h.controller.set('zh-CN'); assert.equal(h.controller.current(),'zh-CN');
  assert.equal(h.controller.choice(),'zh-CN'); assert.equal(h.restart().current(),'zh-CN');
  h.controller.set('auto'); assert.equal(h.restart().current(),'en-US');
  assert.throws(()=>h.controller.set('nonsense')); assert.equal(h.writes(),2);
});
test('live listeners update multiple panels, skip removed panels and isolate failures', () => {
  const h=setup('auto'), seen=[];
  h.controller.subscribe(()=>{throw Error('closed window');});
  h.controller.subscribe(lang=>seen.push(lang), {isConnected:true});
  h.controller.subscribe(()=>assert.fail('disconnected callback'), {isConnected:false});
  const off=h.controller.subscribe(lang=>seen.push('second:'+lang), {isConnected:true});
  h.controller.set('zh-CN'); off(); h.controller.set('en-US');
  assert.deepEqual(seen,['zh-CN','second:zh-CN','en-US']);
});
test('failed preference writes do not change language or announce success', () => {
  const context=vm.createContext({});vm.runInContext(source,context);
  const c=context.createIrisLanguage({prefs:{get:()=> 'en-US',set:()=>{throw Error('disk');}},systemLocales:()=>['en-US']});
  c.subscribe(()=>assert.fail('must not notify'));assert.throws(()=>c.set('zh-CN'));assert.equal(c.current(),'en-US');
});
test('chrome refresh changes text/accessible labels in place and excludes user content', () => {
  const context=vm.createContext({});vm.runInContext(source,context);
  const text=value=>({nodeType:3,nodeValue:value});
  const element=(tag,children=[],attrs={},protectedNode=false)=>({nodeType:1,localName:tag,childNodes:children,
    matches:()=>protectedNode,getAttribute:k=>attrs[k]??null,setAttribute:(k,v)=>{attrs[k]=v;},attrs});
  const title=text('Settings'), message=text('Settings'), prompt=text('Save'), decorated=text('❞ Save');
  const button=element('button',[],{'aria-label':'Save',title:'Save'});button.disabled=true;
  const draft=element('textarea',[prompt],{placeholder:'Settings'});draft.value='Settings';draft.selectionStart=3;
  const root=element('div',[title,button,draft,element('div',[message],{},true),decorated]);root.scrollTop=70;
  context.refreshIrisChrome(root,'zh-CN',[['Settings','设置'],['Save','保存']]);
  assert.equal(title.nodeValue,'设置');assert.equal(button.attrs.title,'保存');assert.equal(button.disabled,true);
  assert.equal(draft.value,'Settings');assert.equal(draft.selectionStart,3);assert.equal(prompt.nodeValue,'Save');
  assert.equal(message.nodeValue,'Settings');assert.equal(root.scrollTop,70);assert.equal(root.childNodes[1],button);
  assert.equal(decorated.nodeValue,'❞ 保存');
  context.refreshIrisChrome(root,'en-US',[['Settings','设置'],['Save','保存']]);assert.equal(title.nodeValue,'Settings');
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

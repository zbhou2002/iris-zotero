import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const bundle=fs.readFileSync(new URL('src/content/scripts/aidea.js',import.meta.url),'utf8');
function harness(tab='discussion') {
  const node=(tab)=>({dataset:{tab},classList:{values:new Set(),toggle(k,v){v?this.values.add(k):this.values.delete(k);}},style:{values:{},setProperty(k,v){this.values[k]=v;}},scrollTop:12,scrollHeight:999});
  const container={dataset:{activeTab:tab}},discussionPanel=node('discussion'),settingPanel=node('setting'),discussionBottom=node('discussion'),settingBottom=node('setting'),bottomWrapper=node();
  const ctx={container,discussionPanel,settingPanel,discussionBottom,settingBottom,bottomWrapper,
    tabBtns:[node('discussion'),node('setting')],tabPanels:[discussionPanel,settingPanel],tabBottoms:[discussionBottom,settingBottom],
    headerIcon:{},TAB_ICON_MAP:{discussion:'chat',setting:'settings'},body:{},persist:0,focus:0,
    persistActiveTab(){ctx.persist++;},inputBox:{value:'unfinished draft',focus(){ctx.focus++;}},doc:{defaultView:{requestAnimationFrame(fn){fn();}}}};
  vm.createContext(ctx);
  const a=bundle.indexOf('    const applyActiveView = '),b=bundle.indexOf('    for (const btn of tabBtns)',a);
  assert.ok(a>0&&b>a);
  vm.runInContext(bundle.slice(a,b)+'\nthis.activate=applyActiveView;',ctx);
  return ctx;
}
test('initial view is explicitly rendered without focusing, scrolling or writing preferences',()=>{
  const c=harness();assert.equal(c.discussionPanel.style.values.display,'flex');
  assert.equal(c.settingPanel.style.values.display,'none');assert.equal(c.bottomWrapper.style.values.display,'flex');
  assert.equal(c.focus,0);assert.equal(c.persist,0);assert.equal(c.discussionPanel.scrollTop,12);
});
test('reveal repairs hidden chat and composer without losing a draft or changing mode',()=>{
  const c=harness();c.discussionPanel.style.values.display='none';c.discussionPanel.classList.values.clear();
  c.bottomWrapper.style.values.display='none';c.discussionBottom.style.values.display='none';
  c.container.__irisRestoreView();
  assert.equal(c.discussionPanel.style.values.display,'flex');assert.ok(c.discussionPanel.classList.values.has('visible'));
  assert.equal(c.bottomWrapper.style.values.display,'flex');assert.equal(c.discussionBottom.style.values.display,'flex');
  assert.equal(c.inputBox.value,'unfinished draft');assert.equal(c.focus,0);assert.equal(c.persist,0);
});
test('reveal preserves settings; returning to chat and restoring again keeps the composer',()=>{
  const c=harness('setting');assert.equal(c.settingPanel.style.values.display,'flex');assert.equal(c.bottomWrapper.style.values.display,'none');
  c.container.__irisRestoreView();assert.equal(c.container.dataset.activeTab,'setting');
  c.activate('discussion');c.container.__irisRestoreView();
  assert.equal(c.bottomWrapper.style.values.display,'flex');assert.equal(c.focus,1);assert.equal(c.persist,1);
});
test('fixed composer no longer registers the obsolete cross-panel height synchronizer',()=>{
  const a=bundle.indexOf('    panelRoot.__llmHeightSync?.dispose?.();'),b=bundle.indexOf('    const isGlobalMode = () =>',a);
  assert.ok(a>0&&b>a);assert.doesNotMatch(bundle.slice(a,b),/createHeightSync|switchToSetting|setPanelContentHeight/);
  assert.match(bundle.slice(a,b),/panelRoot\.__irisRestoreView\?\.\(\)/);
  assert.match(bundle,/const runResponsiveResizeLayout = \(\) => \{\s+panelRoot\?\.__irisRestoreView\?\.\(\)/);
});

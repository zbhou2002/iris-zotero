import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const script=fs.readFileSync(new URL('src/content/scripts/iris-external-links.js',import.meta.url),'utf8');
function harness(launch) {
  const calls=[],errors=[],listeners=new Map();
  const root={contains:n=>n.inside!==false,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);}};
  const ctx=vm.createContext({URL,Promise});vm.runInContext(script,ctx);
  const install=()=>ctx.installIrisExternalLinks({root,launch:launch||((url)=>calls.push(url)),report:e=>errors.push(e)});
  install();
  const click=(href,{type='click',button=0,assistant=true,inside=true,defaultPrevented=false,text=false}={})=>{
    const anchor={inside,getAttribute:()=>href,closest:()=>assistant?{}:null};
    const child={closest:()=>anchor};
    const event={type,button,defaultPrevented,target:text?{nodeType:3,parentElement:child}:child,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};
    listeners.get(type)?.(event);return event;
  };
  return {calls,errors,listeners,root,install,click};
}
test('external response links launch once, including nested text, modifiers and middle click',()=>{
  const h=harness();assert.ok(h.click('https://example.com/p?a=1&b=2#s',{text:true}).defaultPrevented);
  h.click('http://example.org');h.click('//example.net/a',{type:'auxclick',button:1});
  h.click('https://ignored.test',{button:1});h.click('https://ignored.test',{type:'auxclick',button:2});
  assert.deepEqual(h.calls,['https://example.com/p?a=1&b=2#s','http://example.org/','https://example.net/a']);
});
test('delegation works for later links and reinstall does not duplicate listeners',()=>{
  const h=harness();h.install();h.click('https://example.com/stream');h.click('https://example.com/history');
  assert.equal(h.listeners.size,2);assert.equal(h.calls.length,2);h.root.__irisExternalLinksDispose();assert.equal(h.listeners.size,0);
});
test('local files, executable protocols and malformed URLs never reach the launcher',()=>{
  const h=harness();for(const href of ['javascript:alert(1)','data:text/html,x','file:///C:/test.exe','chrome://x','ms-settings:','https://','not a URL','https:\n//example.com'])assert.ok(h.click(href).defaultPrevented);
  assert.equal(h.calls.length,0);assert.equal(h.errors.length,8);
});
test('internal navigation and links outside assistant responses are left untouched',()=>{
  const h=harness();for(const href of ['#section','zotero://open-pdf/library/items/EXAMPLE',''])assert.equal(h.click(href).defaultPrevented,false);
  assert.equal(h.click('https://example.com',{assistant:false}).defaultPrevented,false);
  assert.equal(h.click('https://example.com',{inside:false}).defaultPrevented,false);
  h.click('https://example.com',{defaultPrevented:true});assert.equal(h.calls.length,0);
});
test('launcher failures produce feedback instead of silently swallowing the click',async()=>{
  const a=harness(()=>{throw new Error('No browser');});a.click('https://example.com');assert.deepEqual(a.errors,['failed']);
  const b=harness(()=>Promise.reject(new Error('Failed')));b.click('https://example.com');await Promise.resolve();assert.deepEqual(b.errors,['failed']);
});

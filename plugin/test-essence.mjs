import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
function create(deps = {}) {
  const scope = vm.createContext({});
  vm.runInContext(fs.readFileSync(new URL('src/content/scripts/iris-essence.js', import.meta.url), 'utf8'), scope);
  return scope.createIrisEssence({ Zotero: {}, chinese: () => true, ...deps });
}
function pageFor(text) {
  let x = 10, y = 700;
  return { viewBox: [0, 0, 612, 792], chars: Array.from(text, c => {
    const char = { c: c === '\n' ? '' : c, inlineRect: [x, y, x + 5, y + 10], lineBreakAfter: c === '\n' };
    if (c === '\n') { x = 10; y -= 14; } else x += 5;
    return char;
  }) };
}
test('coordinates preserve multiline original quote and reject altered numbers', () => {
  const api = create();
  const page = pageFor('Our method reduces memory by 42 percent\nand improves accuracy on held-out data.');
  const [block] = api.blocksFromPage(page, 0);
  const match = api.locate(block, 'Our method reduces memory by 42 percent and improves accuracy on held-out data.', page);
  assert(match);
  assert.equal(match.position.rects.length, 2);
  assert.equal(match.position.pageIndex, 0);
  assert.equal(match.position.rects[0][1], 700);
  assert.equal(match.position.rects[1][1], 686);
  assert.equal(api.locate(block, 'Our method reduces memory by 99 percent', page), null);
});
test('ligature expansion maps the highlight to original PDF characters', () => {
  const api = create(), page = pageFor('This efﬁcient algorithm improves memory efficiency.');
  const [block] = api.blocksFromPage(page, 2);
  const match = api.locate(block, 'This efficient algorithm improves memory efficiency.', page);
  assert(match);
  assert(match.text.includes('efﬁcient'));
  assert.equal(match.last, page.chars.length - 1);
  assert.equal(match.position.pageIndex, 2);
});
test('ambiguous repeated excerpt and invalid coordinates are skipped', () => {
  const api = create();
  const quote = 'The same result is repeated here.';
  const page = pageFor(quote + ' ' + quote);
  assert.equal(api.locate(api.blocksFromPage(page, 0)[0], quote, page), null);
  const bad = pageFor(quote);
  bad.chars[5].inlineRect[0] = NaN;
  assert.equal(api.locate(api.blocksFromPage(bad, 0)[0], quote, bad), null);
});
test('overlap is page-specific and does not cover neighboring lines', () => {
  const api = create();
  const a = { pageIndex: 0, rects: [[10, 20, 100, 30]] };
  assert(api.overlap(a, { pageIndex: 0, rects: [[50, 20, 95, 30]] }));
  assert(!api.overlap(a, { pageIndex: 1, rects: a.rects }));
  assert(!api.overlap(a, { pageIndex: 0, rects: [[10, 40, 100, 50]] }));
});
test('malformed model output fails; metadata is not accepted as instructions', () => {
  const api = create();
  assert.throws(() => api.parse('Not valid JSON'));
  const parsed = api.parse('```json\n{"highlights":[{"id":"p1b1","quote":"Exact source","reason":"Evidence","position":{"rects":[0,0,1,1]}}]}\n```');
  assert.equal(parsed.length, 1);
});
test('multi-batch global selection rejects newly invented or altered quotes', async () => {
  let calls = 0;
  const quote = 'A specific original result with 42 percent improvement.';
  const api = create({ callModel: async ({ prompt }) => {
    calls++;
    if (calls <= 2) return JSON.stringify({ highlights: [{ id: `p${calls}b1`, quote, reason: 'Evidence' }] });
    assert(prompt.includes('Rank the candidates globally'));
    return JSON.stringify({ highlights: [
      { id: 'p1b1', quote, reason: 'Evidence' },
      { id: 'p2b1', quote: quote.replace('42', '99'), reason: 'Invented result' }
    ] });
  } });
  const blocks = [1, 2].map(n => ({ id: `p${n}b1`, pageIndex: n - 1, text: quote + ' '.repeat(30000) }));
  const results = await api.choose(blocks, {}, { aborted: false }, () => {});
  assert.equal(calls, 3);
  assert.equal(results.length, 1);
  assert.equal(results[0].quote, quote);
});
test('abort stops before any model request', async () => {
  const api = create({ callModel: () => { throw new Error('Model must not be called'); } });
  await assert.rejects(api.choose([{ id: 'p1b1', text: 'text' }], {}, { aborted: true }, () => {}), /Cancelled/);
});

const candidate = (id, contribution, roles) => ({ id, quote: `An exact original passage numbered ${id}.`, reason: 'Evidence', contribution, roles });
test('free-text contribution labels never delete a matched selection', () => {
  const api = create();
  const items = [candidate('a','new method',['contribution']), candidate('b','new method',['evidence']),
    candidate('c','unproven claim',['contribution']), candidate('d','small sample',['boundary'])];
  assert.deepEqual(Array.from(api.readingSet(items), c => c.id), ['a','b','c','d']);
  assert.equal(api.readingSet([candidate('x','a caveat',['boundary'])]).length,1);
});
test('a result sentence may stand alone; negative findings are not excluded', () => {
  const api = create(), c = candidate('a','Counterexample to the previous theory',['contribution','evidence']);
  assert.equal(api.readingSet([c]).length, 1);
  assert.equal(api.readingSet([]).length, 0);
});
test('no count, group or role quotas discard model-selected passages', () => {
  const api = create();
  const items = ['A','B','C','D'].flatMap(g => [candidate(g+'c',g,['contribution']), candidate(g+'e',g,['evidence']), candidate(g+'b',g,['boundary'])]);
  const results = api.readingSet(items);
  assert.equal(results.length,12);
  assert.equal(results.filter(c => c.roles.includes('boundary')).length,4);
  for (const group of new Set(results.map(c => c.contribution))) {
    assert(results.some(c => c.contribution === group && c.roles.includes('contribution')));
    assert(results.some(c => c.contribution === group && c.roles.includes('evidence')));
  }
});
test('custom prompt persists and replaces rather than appends the default; reset restores it', async () => {
  const prefs = new Map(), Z = {Prefs: {get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v)}};
  let prompt;
  const api = create({Zotero:Z, callModel:async p => {prompt=p.prompt;return '{"highlights":[]}';}});
  assert(api.getPrompt().usesDefault);
  assert(api.defaultPrompt.includes('没有固定上限、最低数量'));
  api.savePrompt('只标出实验设置中需要复现的关键参数。');
  const fresh = create({Zotero:Z});
  assert.equal(fresh.getPrompt().text, '只标出实验设置中需要复现的关键参数。');
  assert.equal(fresh.getPrompt().usesDefault, false);
  await api.choose([{id:'p1b1',text:'Fixture text'}],{}, {aborted:false},()=>{});
  assert(prompt.includes('需要复现的关键参数'));
  assert(!prompt.includes('最多六处'));
  assert(!prompt.includes('The default policy is active'));
  assert(prompt.includes('Each source ID already maps to exact PDF characters'));
  assert.throws(()=>api.savePrompt('a'.repeat(16001)),/16000/);
  api.savePrompt('');
  assert.equal(api.getPrompt().text, api.defaultPrompt);
});

test('line-end hyphen repair preserves numbers and ordinary hyphens', () => {
  const api=create(), page=pageFor('This improves inter-\nnational cooperation by 42 percent.');
  const block=api.blocksFromPage(page,0)[0];
  assert(api.locate(block,'This improves international cooperation by 42 percent.',page));
  assert.equal(api.locate(block,'This improves international cooperation by 99 percent.',page),null);
  const normal=pageFor('The well-known method improves accuracy substantially.');
  assert.equal(api.locate(api.blocksFromPage(normal,0)[0],'The wellknown method improves accuracy substantially.',normal),null);
});
test('ignorable zero-area glyph does not reject a whole original sentence', () => {
  const api=create(), text='This original sentence contains a hidden character.', page=pageFor(text);
  page.chars.splice(10,0,{c:'',ignorable:true,inlineRect:[0,0,0,0]});
  assert.equal(api.locate(api.blocksFromPage(page,0)[0],text,page).text,text);
});
test('seven same-group candidates keep all seven despite differently worded labels', () => {
  const api=create(), items=Array.from({length:7},(_,i)=>candidate(String(i),'same',['evidence']));
  items[0].roles=['contribution'];
  assert.equal(api.readingSet(items).length,7);
  items[1].contribution='a different label for the same thing';
  assert.equal(api.readingSet(items).length,7);
});
test('sentence IDs locate repeated text without requiring a quote or trusting model coordinates', async () => {
  const text='The same result is repeated here. The same result is repeated here.';
  const page=pageFor(text), api=create({callModel:async()=>JSON.stringify({highlights:[{ids:['p1b1s2'],quote:'Invented rewrite',position:{pageIndex:999},reason:'Second occurrence'}]})});
  const blocks=api.blocksFromPage(page,0), units=api.sentenceUnits(blocks);
  assert.equal(units.length,2);
  const results=await api.choose(blocks,{}, {aborted:false},()=>{});
  const u=results[0].sourceUnits[0];
  const match=api.locateRange(page,u.from,u.last,u.pageIndex);
  assert.equal(match.text,'The same result is repeated here.');
  assert(match.from>0);
  assert.equal(match.position.pageIndex,0);
  assert.equal(results[0].quote,undefined);
});
test('invalid and nonadjacent IDs are counted separately; adjacent IDs keep exact spans', async () => {
  const page=pageFor('The first sentence is original. The second sentence is original. The third sentence is original.');
  const api=create({callModel:async()=>JSON.stringify({highlights:[
    {ids:['p1b1s1','p1b1s2'],reason:'Adjacent'},
    {ids:['p1b1s1','p1b1s3'],reason:'Disjoint'},
    {ids:['invented'],reason:'Unknown'},null
  ]})});
  const blocks=api.blocksFromPage(page,0);
  const selected=await api.choose(blocks,{}, {aborted:false},()=>{});
  assert.equal(selected.length,1);
  assert.equal(selected.diagnostics.invalidReference,3);
  assert.equal(selected[0].sourceUnits.length,2);
});
test('global reranking returns candidate references without recopying text', async () => {
  let calls=0;
  const api=create({callModel:async({prompt})=>{
    calls++;
    if(calls<3) return JSON.stringify({highlights:[{ids:[`p${calls}b1s1`],reason:'Candidate'}]});
    assert(prompt.includes('candidateID'));
    return JSON.stringify({highlights:[{candidateID:'h2',reason:'Chosen'},{candidateID:'not-real'}]});
  }});
  const selected=await api.choose([1,2].map(i=>({id:`p${i}b1`,pageIndex:i-1,text:'An exact original sentence. '+' '.repeat(30000)})),{}, {aborted:false},()=>{});
  assert.equal(selected.length,1);
  assert.equal(selected[0].ids[0],'p2b1s1');
  assert.equal(selected.diagnostics.invalidReference,1);
});
test('diagnostic labels distinguish filtering from source and coordinate failures', () => {
  const api=create();
  const text=api.diagnosticText({invalidReference:2,unmatchedText:1,invalidGeometry:3,existingOverlap:4,duplicate:5});
  for(const label of ['无效原句编号 2','旧格式引文未匹配 1','文字坐标无效 3','已有标注覆盖 4','重复候选 5']) assert(text.includes(label));
});
test('more than sixteen valid IDs survive parsing and selection', async () => {
  const page=pageFor(Array.from({length:24},(_,i)=>`Sentence number ${i} contains an important distinct observation.`).join(' '));
  const api=create({callModel:async()=>JSON.stringify({highlights:Array.from({length:24},(_,i)=>({ids:[`p1b1s${i+1}`]}))})});
  // Keep a single source block to exercise protocol count limits independently.
  const text=page.chars.map(c=>c.c).join('');
  const blocks=[{id:'p1b1',pageIndex:0,text,indices:page.chars.map((_,i)=>i)}];
  const selected=await api.choose(blocks,{}, {aborted:false},()=>{});
  assert.equal(selected.length,24);
  assert.equal(selected.diagnostics.invalidReference,0);
});
test('one shared line does not discard an entire passage; full coverage is deduplicated', () => {
  const api=create(), passage={pageIndex:0,rects:[[10,10,100,20],[10,30,100,40]]};
  assert(!api.covered(passage,[{pageIndex:0,rects:[passage.rects[0]]}]));
  assert(api.covered(passage,[passage]));
  assert(!api.covered(passage,[{pageIndex:1,rects:passage.rects}]));
  assert(!api.covered(passage,[{pageIndex:0,rects:[[10,10,55,20],[10,10,55,20],[10,30,55,40],[10,30,55,40]]}]));
});
test('one run keeps its initial prompt if settings change between chunks', async () => {
  const prefs = new Map(), Z = {Prefs: {get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v)}};
  const prompts=[];
  const api=create({Zotero:Z,callModel:async ({prompt})=>{prompts.push(prompt);api.savePrompt('New instructions');return '{"highlights":[]}';}});
  api.savePrompt('Original instructions');
  await api.choose([1,2].map(i=>({id:`p${i}b1`,text:'a'.repeat(30000)})),{}, {aborted:false},()=>{});
  assert.equal(prompts.length,2);
  assert(prompts.every(p=>p.startsWith('Original instructions')));
});

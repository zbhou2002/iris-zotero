import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const bundle = read('src/content/scripts/aidea.js');

test('release metadata covers Zotero 10 patch releases and preserves the update identity', () => {
  const manifest = JSON.parse(read('src/manifest.json'));
  const release = JSON.parse(read('../release.json'));
  assert.equal(manifest.version, release.version);
  assert.equal(JSON.parse(read('../package.json')).version, release.version);
  assert.equal(manifest.applications.zotero.id, 'aidea@visterainer');
  assert.equal(manifest.applications.zotero.strict_min_version, '7.0');
  assert.equal(manifest.applications.zotero.strict_max_version, '10.0.*');
  assert.equal(manifest.applications.zotero.update_url,
    `https://github.com/${release.repository}/releases/latest/download/updates.json`);
});

function libraryResolver(pane) {
  const start = bundle.indexOf('  function getSingleLibraryID(values) {');
  const end = bundle.indexOf('  function createGlobalPortalItem(', start);
  assert(start >= 0 && end > start, 'Library scope functions must be present');
  const context = vm.createContext({
    Zotero: { getActiveZoteroPane: () => pane, Libraries: { userLibraryID: 1 } },
    normalizePositiveInt: value => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null,
  });
  return vm.runInContext(bundle.slice(start, end) + '\nresolveActiveLibraryID();', context);
}

test('Zotero 10 library scope uses the plural API without touching the throwing singular API', () => {
  let legacyCalls = 0;
  const libraryID = libraryResolver({
    getSelectedLibraryIDs: () => [42, 42],
    getSelectedLibraryID() { legacyCalls++; throw new Error('Removed in Zotero 10'); },
  });
  assert.equal(libraryID, 42);
  assert.equal(legacyCalls, 0);
});

test('Zotero 10 multi-library selection falls back to selected items or the user library', () => {
  assert.equal(libraryResolver({ getSelectedLibraryIDs: () => [2, 3], getSelectedItems: () => [{ libraryID: 3 }] }), 3);
  assert.equal(libraryResolver({ getSelectedLibraryIDs: () => [2, 3], getSelectedItems: () => [{ libraryID: 2 }, { libraryID: 3 }] }), 1);
  assert.equal(libraryResolver({ getSelectedLibraryIDs: () => [] }), 1);
});

test('older Zotero library selection remains supported', () => {
  assert.equal(libraryResolver({ getSelectedLibraryID: () => 7 }), 7);
  assert.equal(libraryResolver(null), 1);
});

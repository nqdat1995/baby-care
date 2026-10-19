// Integration tests for the IndexedDB repository (fake-indexeddb polyfill).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

// Storage module must load AFTER the polyfill sets globalThis.indexedDB.
const store = await import('../js/storage.js');

test('CRUD: add, list, update, delete diaper — survives "reload" (new query)', async () => {
  const rec = await store.addDiaper({ type: 'wet', ts: Date.now(), note: 'test' });
  assert.ok(rec.id);

  let events = await store.listEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'diaper');

  await store.updateDiaper(rec.id, { type: 'dirty' });
  events = await store.listEvents();
  assert.equal(events[0].type, 'dirty');
  assert.ok(events[0].updatedAt >= rec.updatedAt);

  await store.deleteDiaper(rec.id);
  events = await store.listEvents();
  assert.equal(events.length, 0);
});

test('CRUD: feeding round trip keeps all fields', async () => {
  const rec = await store.addFeeding({ type: 'bottle', milkType: 'formula', ml: 120, ts: Date.now(), note: 'x' });
  const events = await store.listEvents();
  const found = events.find((e) => e.id === rec.id);
  assert.equal(found.kind, 'feeding');
  assert.equal(found.ml, 120);
  assert.equal(found.milkType, 'formula');
  await store.deleteFeeding(rec.id);
});

test('listEvents: sorted newest first, mixed kinds', async () => {
  const base = Date.now();
  const d = await store.addDiaper({ type: 'wet', ts: base - 2000, note: '' });
  const f = await store.addFeeding({ type: 'breast', side: 'left', ts: base, note: '' });
  const events = await store.listEvents();
  const ids = events.map((e) => e.id);
  assert.ok(ids.indexOf(f.id) < ids.indexOf(d.id), 'feeding (newer) must come before diaper');
  await store.deleteDiaper(d.id);
  await store.deleteFeeding(f.id);
});

test('update non-existent record throws a clear error', async () => {
  await assert.rejects(() => store.updateDiaper('nope', { type: 'wet' }), /Không tìm thấy/);
  await assert.rejects(() => store.updateFeeding('nope', { type: 'breast' }), /Không tìm thấy/);
});

test('export/import: merge skips duplicate ids, adds new ones', async () => {
  const keep = await store.addDiaper({ type: 'wet', ts: Date.now(), note: 'keep' });
  const backup = await store.exportAll();
  assert.ok(backup.diapers.length >= 1);

  // add an extra record AFTER backup, then import the backup in merge mode
  const extra = await store.addDiaper({ type: 'dirty', ts: Date.now(), note: 'extra' });
  const result = await store.importAll(JSON.stringify(backup), 'merge');
  assert.equal(result.skipped, 1); // the shared `keep` id
  const events = await store.listEvents();
  assert.ok(events.some((e) => e.id === keep.id));
  assert.ok(events.some((e) => e.id === extra.id), 'merge must not delete records added after backup');
});

test('importAll: rejects invalid file WITHOUT writing anything (no partial import)', async () => {
  const before = await store.listEvents();
  const bad = JSON.stringify({
    version: 1,
    babies: [],
    diapers: [{ id: 'x', type: 'wet', ts: Date.now() }, { id: 'y', type: 'BAD', ts: Date.now() }],
    feedings: [],
  });
  await assert.rejects(() => store.importAll(bad, 'merge'), /không hợp lệ/);
  const after = await store.listEvents();
  assert.equal(after.length, before.length, 'failed import must add nothing');
});

test('importAll: replace wipes existing data first', async () => {
  await store.addDiaper({ type: 'wet', ts: Date.now(), note: 'old' });
  const backup = {
    app: 'baby-care',
    version: 1,
    exportedAt: new Date().toISOString(),
    babies: [{ id: 'main', name: 'An', birthDate: '' }],
    diapers: [{ id: 'new-1', type: 'both', ts: Date.now(), note: '' }],
    feedings: [],
  };
  const result = await store.importAll(JSON.stringify(backup), 'replace');
  assert.equal(result.added, 2); // baby + diaper
  const events = await store.listEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'new-1');
});

test('baby profile: save and get', async () => {
  await store.saveBaby({ id: 'main', name: 'Bé An', birthDate: '2026-01-15' });
  const baby = await store.getBaby();
  assert.equal(baby.name, 'Bé An');
  assert.equal(baby.birthDate, '2026-01-15');
});

test('clearAll: wipes every store', async () => {
  await store.addDiaper({ type: 'wet', ts: Date.now(), note: '' });
  await store.saveBaby({ id: 'main', name: 'X', birthDate: '' });
  await store.clearAll();
  assert.equal((await store.listEvents()).length, 0);
  assert.equal(await store.getBaby(), null);
});

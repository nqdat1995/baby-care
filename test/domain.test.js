import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDiaper,
  validateFeeding,
  parseBackup,
  computeDayStats,
  groupByDay,
  toLocalInputValue,
  fromLocalInputValue,
  dayKey,
  newId,
} from '../js/domain.js';

const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);

// ---------- validateDiaper ----------

test('validateDiaper: valid wet diaper', () => {
  const r = validateDiaper({ type: 'wet', ts: NOW, note: '' }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.value.type, 'wet');
});

test('validateDiaper: accepts both type', () => {
  const r = validateDiaper({ type: 'both', ts: NOW }, NOW);
  assert.equal(r.ok, true);
});

test('validateDiaper: rejects invalid type', () => {
  const r = validateDiaper({ type: 'purple', ts: NOW }, NOW);
  assert.equal(r.ok, false);
  assert.ok(r.errors.type);
});

test('validateDiaper: rejects future timestamp beyond skew', () => {
  const r = validateDiaper({ type: 'wet', ts: NOW + 10 * 60 * 1000 }, NOW);
  assert.equal(r.ok, false);
  assert.ok(r.errors.ts);
});

test('validateDiaper: accepts small clock skew (4 min)', () => {
  const r = validateDiaper({ type: 'wet', ts: NOW + 4 * 60 * 1000 }, NOW);
  assert.equal(r.ok, true);
});

test('validateDiaper: rejects missing ts', () => {
  const r = validateDiaper({ type: 'wet' }, NOW);
  assert.equal(r.ok, false);
  assert.ok(r.errors.ts);
});

test('validateDiaper: rejects note over 200 chars', () => {
  const r = validateDiaper({ type: 'wet', ts: NOW, note: 'x'.repeat(201) }, NOW);
  assert.equal(r.ok, false);
  assert.ok(r.errors.note);
});

// ---------- validateFeeding ----------

test('validateFeeding: breast with side and duration', () => {
  const r = validateFeeding({ type: 'breast', side: 'left', ts: NOW, durationMin: 15 }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.value.side, 'left');
  assert.equal(r.value.durationMin, 15);
});

test('validateFeeding: breast without side fails', () => {
  const r = validateFeeding({ type: 'breast', ts: NOW }, NOW);
  assert.equal(r.ok, false);
  assert.ok(r.errors.side);
});

test('validateFeeding: breast duration absent (not zero)', () => {
  const r = validateFeeding({ type: 'breast', side: 'right', ts: NOW }, NOW);
  assert.equal(r.ok, true);
  assert.equal('durationMin' in r.value, false);
});

test('validateFeeding: bottle requires ml and milkType', () => {
  const r = validateFeeding({ type: 'bottle', ts: NOW }, NOW);
  assert.equal(r.ok, false);
  assert.ok(r.errors.ml);
  assert.ok(r.errors.milkType);
});

test('validateFeeding: valid bottle', () => {
  const r = validateFeeding({ type: 'bottle', milkType: 'formula', ml: 120, ts: NOW }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.value.ml, 120);
});

test('validateFeeding: rejects ml = 0 or > 999 or fractional', () => {
  assert.equal(validateFeeding({ type: 'bottle', milkType: 'formula', ml: 0, ts: NOW }, NOW).ok, false);
  assert.equal(validateFeeding({ type: 'bottle', milkType: 'formula', ml: 1000, ts: NOW }, NOW).ok, false);
  assert.equal(validateFeeding({ type: 'bottle', milkType: 'formula', ml: 50.5, ts: NOW }, NOW).ok, false);
});

test('validateFeeding: rejects out-of-range duration', () => {
  const r = validateFeeding({ type: 'breast', side: 'left', ts: NOW, durationMin: 0 }, NOW);
  assert.equal(r.ok, false);
  const r2 = validateFeeding({ type: 'breast', side: 'left', ts: NOW, durationMin: 301 }, NOW);
  assert.equal(r2.ok, false);
});

// ---------- computeDayStats ----------

test('computeDayStats: both counts in wet AND dirty but once in total', () => {
  const s = computeDayStats(
    [
      { type: 'both' },
      { type: 'wet' },
      { type: 'dirty' },
    ],
    []
  );
  assert.equal(s.diapersTotal, 3);
  assert.equal(s.wet, 2);
  assert.equal(s.dirty, 2);
});

test('computeDayStats: ml only from bottle, minutes only from breast', () => {
  const s = computeDayStats([], [
    { type: 'bottle', ml: 120 },
    { type: 'bottle', ml: 90 },
    { type: 'breast', side: 'left', durationMin: 15 },
    { type: 'breast', side: 'right' }, // duration not recorded
  ]);
  assert.equal(s.mlTotal, 210);
  assert.equal(s.breastMinutesTotal, 15); // never defaults to 0 for missing
  assert.equal(s.feedingsTotal, 4);
});

// ---------- day grouping / midnight boundary ----------

test('dayKey uses LOCAL calendar day', () => {
  // 23:59 local vs 00:01 local next day — construct in local time
  const late = new Date(2026, 5, 1, 23, 59).getTime();
  const early = new Date(2026, 5, 2, 0, 1).getTime();
  assert.notEqual(dayKey(late), dayKey(early));
});

test('groupByDay: newest first ordering preserved within groups', () => {
  const t1 = new Date(2026, 5, 1, 10, 0).getTime();
  const t2 = new Date(2026, 5, 1, 11, 0).getTime();
  const t3 = new Date(2026, 5, 2, 9, 0).getTime();
  const groups = groupByDay([{ ts: t3 }, { ts: t2 }, { ts: t1 }]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].events.length, 1);
  assert.equal(groups[1].events.length, 2);
  assert.equal(groups[1].events[0].ts, t2);
});

// ---------- datetime-local round trip ----------

test('datetime-local round trip preserves the minute (local tz)', () => {
  const ts = new Date(2026, 5, 1, 14, 35).getTime();
  const v = toLocalInputValue(ts);
  assert.equal(fromLocalInputValue(v), ts);
});

test('fromLocalInputValue: garbage returns null', () => {
  assert.equal(fromLocalInputValue('not-a-date'), null);
});

// ---------- parseBackup ----------

test('parseBackup: rejects invalid JSON string', () => {
  const r = parseBackup('{oops', NOW);
  assert.equal(r.ok, false);
});

test('parseBackup: rejects wrong version', () => {
  const r = parseBackup(JSON.stringify({ version: 99, babies: [], diapers: [], feedings: [] }), NOW);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Phiên bản/);
});

test('parseBackup: rejects file with one bad record (no partial import)', () => {
  const r = parseBackup(JSON.stringify({
    version: 1,
    babies: [],
    diapers: [
      { id: 'a', type: 'wet', ts: NOW },
      { id: 'b', type: 'bad-type', ts: NOW },
    ],
    feedings: [],
  }), NOW);
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].includes('diapers[1]'));
});

test('parseBackup: valid file returns normalized data', () => {
  const r = parseBackup(JSON.stringify({
    version: 1,
    babies: [{ id: 'main', name: 'An', birthDate: '2026-01-01' }],
    diapers: [{ id: 'd1', type: 'wet', ts: NOW, note: 'ok' }],
    feedings: [{ id: 'f1', type: 'bottle', milkType: 'formula', ml: 100, ts: NOW }],
  }), NOW);
  assert.equal(r.ok, true);
  assert.equal(r.data.diapers.length, 1);
  assert.equal(r.data.feedings[0].ml, 100);
});

// ---------- misc ----------

test('newId returns unique ids', () => {
  const ids = new Set(Array.from({ length: 100 }, () => newId()));
  assert.equal(ids.size, 100);
});

// Persistence layer: IndexedDB repository. All reads/writes go through here,
// so storage can be swapped later without touching UI or domain logic.

import { parseBackup, newId, BACKUP_VERSION } from './domain.js';

const DB_NAME = 'baby-care';
const DB_VERSION = 1;
const STORE_BABIES = 'babies';
const STORE_DIAPERS = 'diapers';
const STORE_FEEDINGS = 'feedings';
const STORE_SETTINGS = 'settings';
const DEFAULT_BABY_ID = 'main';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BABIES)) {
        db.createObjectStore(STORE_BABIES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_DIAPERS)) {
        const s = db.createObjectStore(STORE_DIAPERS, { keyPath: 'id' });
        s.createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains(STORE_FEEDINGS)) {
        const s = db.createObjectStore(STORE_FEEDINGS, { keyPath: 'id' });
        s.createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB bị chặn (một tab khác đang mở phiên bản cũ?)'));
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Run fn(tx) inside a transaction over one or more stores.
 * fn receives the transaction (use tx.objectStore(name)); the tx commits
 * only after fn's synchronous + awaited work completes.
 */
async function withStore(names, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let result;
    try {
      result = fn(tx);
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction bị hủy'));
  });
}

// ---- Babies ----

export async function getBaby(id = DEFAULT_BABY_ID) {
  const db = await openDb();
  const tx = db.transaction(STORE_BABIES, 'readonly');
  const baby = await promisify(tx.objectStore(STORE_BABIES).get(id));
  return baby ?? null;
}

export async function saveBaby({ id = DEFAULT_BABY_ID, name = '', birthDate = '', createdAt = Date.now() }) {
  return withStore(STORE_BABIES, 'readwrite', (tx) => tx.objectStore(STORE_BABIES).put({ id, name, birthDate, createdAt }));
}

// ---- Diapers ----

export async function addDiaper(value) {
  const now = Date.now();
  const record = { id: newId(), babyId: DEFAULT_BABY_ID, ...value, createdAt: now, updatedAt: now };
  await withStore(STORE_DIAPERS, 'readwrite', (tx) => tx.objectStore(STORE_DIAPERS).put(record));
  return record;
}

export async function updateDiaper(id, value) {
  const db = await openDb();
  const tx = db.transaction(STORE_DIAPERS, 'readwrite');
  const store = tx.objectStore(STORE_DIAPERS);
  const existing = await promisify(store.get(id));
  if (!existing) throw new Error('Không tìm thấy bản ghi để sửa');
  const record = { ...existing, ...value, updatedAt: Date.now() };
  store.put(record);
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  return record;
}

export async function deleteDiaper(id) {
  return withStore(STORE_DIAPERS, 'readwrite', (tx) => tx.objectStore(STORE_DIAPERS).delete(id));
}

// ---- Feedings ----

export async function addFeeding(value) {
  const now = Date.now();
  const record = { id: newId(), babyId: DEFAULT_BABY_ID, ...value, createdAt: now, updatedAt: now };
  await withStore(STORE_FEEDINGS, 'readwrite', (tx) => tx.objectStore(STORE_FEEDINGS).put(record));
  return record;
}

export async function updateFeeding(id, value) {
  const db = await openDb();
  const tx = db.transaction(STORE_FEEDINGS, 'readwrite');
  const store = tx.objectStore(STORE_FEEDINGS);
  const existing = await promisify(store.get(id));
  if (!existing) throw new Error('Không tìm thấy bản ghi để sửa');
  const record = { ...existing, ...value, updatedAt: Date.now() };
  store.put(record);
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  return record;
}

export async function deleteFeeding(id) {
  return withStore(STORE_FEEDINGS, 'readwrite', (tx) => tx.objectStore(STORE_FEEDINGS).delete(id));
}

// ---- Queries ----

/** All events merged and sorted newest first (MVP scale: in-memory sort is fine). */
export async function listEvents() {
  const db = await openDb();
  const tx = db.transaction([STORE_DIAPERS, STORE_FEEDINGS], 'readonly');
  const [diapers, feedings] = await Promise.all([
    promisify(tx.objectStore(STORE_DIAPERS).getAll()),
    promisify(tx.objectStore(STORE_FEEDINGS).getAll()),
  ]);
  const merged = [
    ...diapers.map((d) => ({ ...d, kind: 'diaper' })),
    ...feedings.map((f) => ({ ...f, kind: 'feeding' })),
  ];
  merged.sort((a, b) => b.ts - a.ts);
  return merged;
}

// ---- Export / Import / Clear ----

export async function exportAll() {
  const db = await openDb();
  const tx = db.transaction([STORE_BABIES, STORE_DIAPERS, STORE_FEEDINGS], 'readonly');
  const [babies, diapers, feedings] = await Promise.all([
    promisify(tx.objectStore(STORE_BABIES).getAll()),
    promisify(tx.objectStore(STORE_DIAPERS).getAll()),
    promisify(tx.objectStore(STORE_FEEDINGS).getAll()),
  ]);
  return {
    app: 'baby-care',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    babies,
    diapers,
    feedings,
  };
}

/**
 * Import a parsed JSON string. The WHOLE file is validated first (parseBackup);
 * only then a single readwrite transaction writes everything — no partial import.
 * mode: 'merge' (skip duplicate ids) | 'replace' (wipe first).
 * Returns { added, skipped }.
 */
export async function importAll(jsonString, mode = 'merge') {
  const parsed = parseBackup(jsonString);
  if (!parsed.ok) {
    const err = new Error('Tệp sao lưu không hợp lệ: ' + parsed.errors.join(' | '));
    err.validationErrors = parsed.errors;
    throw err;
  }
  const { babies, diapers, feedings } = parsed.data;
  const db = await openDb();
  const tx = db.transaction([STORE_BABIES, STORE_DIAPERS, STORE_FEEDINGS], 'readwrite');
  const babyStore = tx.objectStore(STORE_BABIES);
  const diaperStore = tx.objectStore(STORE_DIAPERS);
  const feedingStore = tx.objectStore(STORE_FEEDINGS);

  if (mode === 'replace') {
    babyStore.clear();
    diaperStore.clear();
    feedingStore.clear();
  }

  let added = 0;
  let skipped = 0;

  const putNew = async (store, record) => {
    const existing = await promisify(store.get(record.id));
    if (existing && mode === 'merge') {
      skipped += 1;
      return;
    }
    store.put(record);
    added += 1;
  };

  const jobs = [
    ...babies.map((b) => putNew(babyStore, b)),
    ...diapers.map((d) => putNew(diaperStore, d)),
    ...feedings.map((f) => putNew(feedingStore, f)),
  ];
  await Promise.all(jobs);

  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error('Import bị hủy giữa chừng — không có dữ liệu nào được ghi'));
  });
  return { added, skipped };
}

export async function clearAll() {
  return withStore(
    [STORE_BABIES, STORE_DIAPERS, STORE_FEEDINGS, STORE_SETTINGS],
    'readwrite',
    (tx) => {
      for (const name of [STORE_BABIES, STORE_DIAPERS, STORE_FEEDINGS, STORE_SETTINGS]) {
        tx.objectStore(name).clear();
      }
    }
  );
}

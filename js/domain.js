// Domain layer: validation, normalization, stats — pure functions, no DOM/IndexedDB.

export const DIAPER_TYPES = ['wet', 'dirty', 'both'];
export const FEEDING_TYPES = ['breast', 'bottle'];
export const BREAST_SIDES = ['left', 'right'];
export const MILK_TYPES = ['breastmilk', 'formula'];

const MAX_NOTE_LENGTH = 200;
const MAX_FUTURE_MS = 5 * 60 * 1000; // allow small device clock skew
const MIN_TS = Date.UTC(2020, 0, 1);
const MAX_DURATION_MIN = 300;
const MAX_ML = 999;
export const BACKUP_VERSION = 1;

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // Fallback for very old browsers
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Epoch ms -> value for <input type="datetime-local"> in LOCAL time. */
export function toLocalInputValue(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** datetime-local value (local time) -> epoch ms, or null when unparseable. */
export function fromLocalInputValue(v) {
  const ts = new Date(v).getTime();
  return Number.isNaN(ts) ? null : ts;
}

/** Local calendar day key "YYYY-MM-DD" for grouping/stats. */
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function checkCommon(input, now, errors) {
  const ts = Number(input?.ts);
  if (!Number.isFinite(ts) || ts < MIN_TS) {
    errors.ts = 'Thời điểm không hợp lệ';
  } else if (ts > now + MAX_FUTURE_MS) {
    errors.ts = 'Thời điểm không được ở tương lai';
  }
  const note = String(input?.note ?? '').trim();
  if (note.length > MAX_NOTE_LENGTH) {
    errors.note = `Ghi chú tối đa ${MAX_NOTE_LENGTH} ký tự`;
  }
  return { ts: Math.round(ts), note };
}

/**
 * @returns {{ok: true, errors: {}, value: object} | {ok: false, errors: object}}
 */
export function validateDiaper(input, now = Date.now()) {
  const errors = {};
  const type = String(input?.type ?? '');
  if (!DIAPER_TYPES.includes(type)) errors.type = 'Chưa chọn loại tã';
  const { ts, note } = checkCommon(input, now, errors);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, errors: {}, value: { type, ts, note } };
}

/**
 * @returns {{ok: true, errors: {}, value: object} | {ok: false, errors: object}}
 */
export function validateFeeding(input, now = Date.now()) {
  const errors = {};
  const type = String(input?.type ?? '');
  if (!FEEDING_TYPES.includes(type)) errors.type = 'Chưa chọn loại bú';
  const { ts, note } = checkCommon(input, now, errors);

  let side, durationMin, milkType, ml;
  if (type === 'breast') {
    side = String(input?.side ?? '');
    if (!BREAST_SIDES.includes(side)) errors.side = 'Chưa chọn bên bú';
    if (input?.durationMin !== undefined && input.durationMin !== '' && input.durationMin !== null) {
      durationMin = Number(input.durationMin);
      if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > MAX_DURATION_MIN) {
        errors.durationMin = `Thời lượng phải là số nguyên 1–${MAX_DURATION_MIN} phút`;
      }
    }
  } else if (type === 'bottle') {
    milkType = String(input?.milkType ?? '');
    if (!MILK_TYPES.includes(milkType)) errors.milkType = 'Chưa chọn loại sữa';
    ml = Number(input?.ml);
    if (!Number.isInteger(ml) || ml < 1 || ml > MAX_ML) {
      errors.ml = `Lượng sữa phải là số nguyên 1–${MAX_ML} ml`;
    }
    if (input?.durationMin !== undefined && input.durationMin !== '' && input.durationMin !== null) {
      durationMin = Number(input.durationMin);
      if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > MAX_DURATION_MIN) {
        errors.durationMin = `Thời lượng phải là số nguyên 1–${MAX_DURATION_MIN} phút`;
      }
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const value = { type, ts, note };
  if (type === 'breast') {
    value.side = side;
    if (durationMin !== undefined) value.durationMin = durationMin;
  } else {
    value.milkType = milkType;
    value.ml = ml;
    if (durationMin !== undefined) value.durationMin = durationMin;
  }
  return { ok: true, errors: {}, value };
}

/**
 * Validate a full backup object BEFORE any write (no partial import).
 * Accepts a JSON string or a parsed object. Returns normalized data on success.
 */
export function parseBackup(raw, now = Date.now()) {
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ok: false, errors: ['Tệp không phải JSON hợp lệ'] };
    }
  }
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['Cấu trúc sao lưu không hợp lệ'] };
  }
  if (obj.version !== BACKUP_VERSION) {
    return { ok: false, errors: [`Phiên bản sao lưu không được hỗ trợ (tìm thấy ${obj.version}, cần ${BACKUP_VERSION})`] };
  }
  for (const key of ['babies', 'diapers', 'feedings']) {
    if (!Array.isArray(obj[key])) errors.push(`Thiếu mảng "${key}"`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const babies = [];
  obj.babies.forEach((b, i) => {
    if (!b || typeof b !== 'object' || typeof b.id !== 'string' || b.id === '') {
      errors.push(` babies[${i}]: thiếu id`);
      return;
    }
    babies.push({
      id: b.id,
      name: typeof b.name === 'string' ? b.name : '',
      birthDate: typeof b.birthDate === 'string' ? b.birthDate : '',
      createdAt: Number.isFinite(b.createdAt) ? b.createdAt : now,
    });
  });

  const diapers = [];
  obj.diapers.forEach((d, i) => {
    const res = validateDiaper(d, now);
    if (!res.ok) {
      errors.push(`diapers[${i}]: ${Object.values(res.errors).join('; ')}`);
      return;
    }
    diapers.push({
      id: typeof d.id === 'string' && d.id ? d.id : newId(),
      babyId: typeof d.babyId === 'string' ? d.babyId : 'main',
      ...res.value,
      createdAt: Number.isFinite(d.createdAt) ? d.createdAt : now,
      updatedAt: Number.isFinite(d.updatedAt) ? d.updatedAt : Number.isFinite(d.createdAt) ? d.createdAt : now,
    });
  });

  const feedings = [];
  obj.feedings.forEach((f, i) => {
    const res = validateFeeding(f, now);
    if (!res.ok) {
      errors.push(`feedings[${i}]: ${Object.values(res.errors).join('; ')}`);
      return;
    }
    feedings.push({
      id: typeof f.id === 'string' && f.id ? f.id : newId(),
      babyId: typeof f.babyId === 'string' ? f.babyId : 'main',
      ...res.value,
      createdAt: Number.isFinite(f.createdAt) ? f.createdAt : now,
      updatedAt: Number.isFinite(f.updatedAt) ? f.updatedAt : Number.isFinite(f.createdAt) ? f.createdAt : now,
    });
  });

  if (errors.length > 0) {
    const shown = errors.slice(0, 5);
    if (errors.length > 5) shown.push(`… và ${errors.length - 5} lỗi khác`);
    return { ok: false, errors: shown };
  }
  return { ok: true, errors: [], data: { version: BACKUP_VERSION, babies, diapers, feedings } };
}

/**
 * Daily stats. `both` diapers count in BOTH wet and dirty but only once in total.
 * ml comes only from bottle events with a recorded value; breast minutes only
 * from recorded durations — never defaulted to 0 and never mixed.
 */
export function computeDayStats(diapers = [], feedings = []) {
  const stats = {
    diapersTotal: diapers.length,
    wet: 0,
    dirty: 0,
    feedingsTotal: feedings.length,
    mlTotal: 0,
    breastMinutesTotal: 0,
  };
  for (const d of diapers) {
    if (d.type === 'wet' || d.type === 'both') stats.wet += 1;
    if (d.type === 'dirty' || d.type === 'both') stats.dirty += 1;
  }
  for (const f of feedings) {
    if (f.type === 'bottle' && Number.isFinite(f.ml)) stats.mlTotal += f.ml;
    if (f.type === 'breast' && Number.isFinite(f.durationMin)) stats.breastMinutesTotal += f.durationMin;
  }
  return stats;
}

/** Split merged events into day groups, newest first. */
export function groupByDay(events) {
  const groups = [];
  let current = null;
  for (const ev of events) {
    const key = dayKey(ev.ts);
    if (!current || current.key !== key) {
      current = { key, events: [] };
      groups.push(current);
    }
    current.events.push(ev);
  }
  return groups;
}

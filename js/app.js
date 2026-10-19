// UI layer: renders state, wires user actions to domain + storage.
// No business rules here beyond display formatting.

import {
  validateDiaper,
  validateFeeding,
  computeDayStats,
  groupByDay,
  dayKey,
  toLocalInputValue,
  fromLocalInputValue,
} from './domain.js';
import * as store from './storage.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  lastEvent: $('#last-event'),
  statsDate: $('#stats-date'),
  statTotal: $('#stat-total'),
  statWet: $('#stat-wet'),
  statDirty: $('#stat-dirty'),
  statFeedings: $('#stat-feedings'),
  statMl: $('#stat-ml'),
  history: $('#history'),
  filterBar: $('#filter-bar'),
  diaperDialog: $('#diaper-dialog'),
  feedingDialog: $('#feeding-dialog'),
  settingsDialog: $('#settings-dialog'),
  diaperForm: $('#diaper-form'),
  feedingForm: $('#feeding-form'),
  settingsForm: $('#settings-form'),
  toast: $('#toast'),
  babyName: $('#baby-name'),
};

const state = {
  events: [],
  filter: 'all', // 'all' | 'diaper' | 'feeding'
  editing: null, // { kind: 'diaper'|'feeding', id } | null
  saving: false,
};

// ---------- helpers ----------

const fmtTime = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' });
const fmtDate = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

function toast(msg, isError = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('error', isError);
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function diaperLabel(type) {
  return { wet: 'Tã ướt', dirty: 'Tã bẩn', both: 'Tã ướt + bẩn' }[type] ?? type;
}

function feedingLabel(ev) {
  if (ev.type === 'breast') {
    const side = ev.side === 'left' ? 'Trái' : 'Phải';
    const dur = Number.isFinite(ev.durationMin) ? ` · ${ev.durationMin} phút` : '';
    return `Bú mẹ (${side})${dur}`;
  }
  const milk = ev.milkType === 'breastmilk' ? 'Sữa mẹ vắt' : 'Sữa công thức';
  return `${ev.ml} ml · ${milk}`;
}

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ---------- rendering ----------

function renderLastEvent() {
  const ev = state.events[0];
  if (!ev) {
    els.lastEvent.textContent = 'Chưa có dữ liệu';
    return;
  }
  const label = ev.kind === 'diaper' ? diaperLabel(ev.type) : feedingLabel(ev);
  els.lastEvent.textContent = `${fmtTime.format(new Date(ev.ts))} — ${label}`;
}

function renderStats() {
  const today = dayKey(Date.now());
  const diapers = state.events.filter((e) => e.kind === 'diaper' && dayKey(e.ts) === today);
  const feedings = state.events.filter((e) => e.kind === 'feeding' && dayKey(e.ts) === today);
  const s = computeDayStats(diapers, feedings);
  els.statsDate.textContent = fmtDate.format(new Date());
  els.statTotal.textContent = s.diapersTotal;
  els.statWet.textContent = s.wet;
  els.statDirty.textContent = s.dirty;
  els.statFeedings.textContent = s.feedingsTotal;
  els.statMl.textContent = s.mlTotal;
}

function renderHistory() {
  const filtered = state.events.filter((e) => state.filter === 'all' || e.kind === state.filter);
  if (filtered.length === 0) {
    els.history.innerHTML = '<p class="empty">Chưa có sự kiện nào. Nhấn nút bên trên để ghi nhận.</p>';
    return;
  }
  const groups = groupByDay(filtered);
  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 86400000);
  els.history.innerHTML = groups
    .map((g) => {
      const title = g.key === today ? 'Hôm nay' : g.key === yesterday ? 'Hôm qua' : fmtDate.format(new Date(g.events[0].ts));
      const rows = g.events
        .map((ev) => {
          const label = ev.kind === 'diaper' ? diaperLabel(ev.type) : feedingLabel(ev);
          const note = ev.note ? `<span class="note">${esc(ev.note)}</span>` : '';
          const icon = ev.kind === 'diaper' ? '🧷' : '🍼';
          return `<li class="event" data-kind="${ev.kind}" data-id="${esc(ev.id)}">
            <span class="event-icon" aria-hidden="true">${icon}</span>
            <span class="event-time">${fmtTime.format(new Date(ev.ts))}</span>
            <span class="event-label">${esc(label)}${note}</span>
            <span class="event-actions">
              <button type="button" class="btn-icon" data-action="edit" aria-label="Sửa">✏️</button>
              <button type="button" class="btn-icon" data-action="delete" aria-label="Xóa">🗑️</button>
            </span>
          </li>`;
        })
        .join('');
      return `<section class="day-group"><h3>${esc(title)}</h3><ul>${rows}</ul></section>`;
    })
    .join('');
}

function renderAll() {
  renderLastEvent();
  renderStats();
  renderHistory();
}

// ---------- dialogs ----------

function openDiaperDialog(ev = null) {
  state.editing = ev ? { kind: 'diaper', id: ev.id } : null;
  els.diaperForm.reset();
  $('#diaper-ts').value = toLocalInputValue(ev ? ev.ts : Date.now());
  $('#diaper-note').value = ev?.note ?? '';
  const type = ev?.type ?? 'wet';
  const radio = els.diaperForm.querySelector(`input[name="diaper-type"][value="${type}"]`);
  if (radio) radio.checked = true;
  $('#diaper-title').textContent = ev ? 'Sửa tã' : 'Ghi nhận tã';
  $('#diaper-delete').hidden = !ev;
  clearErrors(els.diaperForm);
  els.diaperDialog.showModal();
}

function openFeedingDialog(ev = null) {
  state.editing = ev ? { kind: 'feeding', id: ev.id } : null;
  els.feedingForm.reset();
  $('#feeding-ts').value = toLocalInputValue(ev ? ev.ts : Date.now());
  $('#feeding-note').value = ev?.note ?? '';
  const type = ev?.type ?? 'breast';
  const radio = els.feedingForm.querySelector(`input[name="feeding-type"][value="${type}"]`);
  if (radio) radio.checked = true;
  if (ev?.side) {
    const sideRadio = els.feedingForm.querySelector(`input[name="feeding-side"][value="${ev.side}"]`);
    if (sideRadio) sideRadio.checked = true;
  }
  if (ev?.milkType) {
    const milkRadio = els.feedingForm.querySelector(`input[name="milk-type"][value="${ev.milkType}"]`);
    if (milkRadio) milkRadio.checked = true;
  }
  $('#feeding-duration').value = ev?.durationMin ?? '';
  $('#feeding-ml').value = ev?.ml ?? '';
  $('#feeding-title').textContent = ev ? 'Sửa cữ bú' : 'Ghi nhận cữ bú';
  $('#feeding-delete').hidden = !ev;
  toggleFeedingFields();
  clearErrors(els.feedingForm);
  els.feedingDialog.showModal();
}

function toggleFeedingFields() {
  const type = els.feedingForm.querySelector('input[name="feeding-type"]:checked')?.value;
  $('#breast-fields').hidden = type !== 'breast';
  $('#bottle-fields').hidden = type !== 'bottle';
}

function clearErrors(form) {
  form.querySelectorAll('.field-error').forEach((e) => {
    e.textContent = '';
  });
}

function showErrors(form, errors) {
  clearErrors(form);
  for (const [field, msg] of Object.entries(errors)) {
    const el = form.querySelector(`[data-error-for="${field}"]`);
    if (el) el.textContent = msg;
  }
}

// ---------- actions ----------

async function withSaving(form, fn) {
  if (state.saving) return; // double-tap lock
  state.saving = true;
  const btn = form.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    console.error(err);
    toast('Lỗi lưu dữ liệu: ' + (err.message ?? err), true);
  } finally {
    state.saving = false;
    if (btn) btn.disabled = false;
  }
}

function wireDiaperForm() {
  els.diaperForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = {
      type: els.diaperForm.querySelector('input[name="diaper-type"]:checked')?.value,
      ts: fromLocalInputValue($('#diaper-ts').value),
      note: $('#diaper-note').value,
    };
    const res = validateDiaper(input);
    if (!res.ok) {
      showErrors(els.diaperForm, res.errors);
      return;
    }
    withSaving(els.diaperForm, async () => {
      if (state.editing) {
        await store.updateDiaper(state.editing.id, res.value);
      } else {
        await store.addDiaper(res.value);
      }
      els.diaperDialog.close();
      await refresh();
      toast('Đã lưu ✓');
    });
  });

  $('#diaper-delete').addEventListener('click', async () => {
    if (!state.editing) return;
    if (!confirm('Xóa bản ghi này?')) return;
    await store.deleteDiaper(state.editing.id);
    els.diaperDialog.close();
    await refresh();
    toast('Đã xóa');
  });
}

function wireFeedingForm() {
  els.feedingForm.querySelectorAll('input[name="feeding-type"]').forEach((r) => {
    r.addEventListener('change', toggleFeedingFields);
  });

  els.feedingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = els.feedingForm.querySelector('input[name="feeding-type"]:checked')?.value;
    const input = {
      type,
      ts: fromLocalInputValue($('#feeding-ts').value),
      note: $('#feeding-note').value,
    };
    if (type === 'breast') {
      input.side = els.feedingForm.querySelector('input[name="feeding-side"]:checked')?.value;
      input.durationMin = $('#feeding-duration').value === '' ? undefined : Number($('#feeding-duration').value);
    } else {
      input.milkType = els.feedingForm.querySelector('input[name="milk-type"]:checked')?.value;
      input.ml = Number($('#feeding-ml').value);
      input.durationMin = $('#feeding-duration-bottle').value === '' ? undefined : Number($('#feeding-duration-bottle').value);
    }
    const res = validateFeeding(input);
    if (!res.ok) {
      // Bottle mode: route duration error to the visible bottle slot
      if (type === 'bottle' && res.errors.durationMin) {
        res.errors.durationMinBottle = res.errors.durationMin;
        delete res.errors.durationMin;
      }
      showErrors(els.feedingForm, res.errors);
      return;
    }
    withSaving(els.feedingForm, async () => {
      if (state.editing) {
        await store.updateFeeding(state.editing.id, res.value);
      } else {
        await store.addFeeding(res.value);
      }
      els.feedingDialog.close();
      await refresh();
      toast('Đã lưu ✓');
    });
  });

  $('#feeding-delete').addEventListener('click', async () => {
    if (!state.editing) return;
    if (!confirm('Xóa bản ghi này?')) return;
    await store.deleteFeeding(state.editing.id);
    els.feedingDialog.close();
    await refresh();
    toast('Đã xóa');
  });
}

function wireHistory() {
  els.history.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const li = btn.closest('.event');
    const { kind, id } = li.dataset;
    const ev = state.events.find((x) => x.id === id);
    if (!ev) return;
    if (btn.dataset.action === 'edit') {
      if (kind === 'diaper') openDiaperDialog(ev);
      else openFeedingDialog(ev);
    } else if (btn.dataset.action === 'delete') {
      if (!confirm('Xóa bản ghi này?')) return;
      if (kind === 'diaper') await store.deleteDiaper(id);
      else await store.deleteFeeding(id);
      await refresh();
      toast('Đã xóa');
    }
  });
}

function wireFilters() {
  els.filterBar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    els.filterBar.querySelectorAll('button').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    renderHistory();
  });
}

function wireSettings() {
  $('#btn-settings').addEventListener('click', async () => {
    const baby = await store.getBaby();
    $('#settings-name').value = baby?.name ?? '';
    $('#settings-birth').value = baby?.birthDate ?? '';
    els.settingsDialog.showModal();
  });

  els.settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await store.saveBaby({
      name: $('#settings-name').value.trim(),
      birthDate: $('#settings-birth').value,
    });
    updateBabyName();
    els.settingsDialog.close();
    toast('Đã lưu cài đặt ✓');
  });

  $('#btn-export').addEventListener('click', async () => {
    const data = await store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `baby-care-backup-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Đã xuất tệp sao lưu');
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    let mode = 'merge';
    if (state.events.length > 0) {
      const choice = confirm('Đã có dữ liệu trên máy.\n\nOK = GHÉP bản sao lưu vào dữ liệu hiện tại (bỏ qua bản ghi trùng ID)\nHủy = THAY THẾ toàn bộ dữ liệu bằng bản sao lưu');
      if (choice) mode = 'merge';
      else {
        if (!confirm('CẢNH BÁO: Thay thế sẽ XÓA toàn bộ dữ liệu hiện tại trước khi nhập. Tiếp tục?')) return;
        mode = 'replace';
      }
    }
    try {
      const result = await store.importAll(text, mode);
      await refresh();
      toast(`Nhập xong: ${result.added} bản ghi mới, bỏ qua ${result.skipped} trùng`);
    } catch (err) {
      console.error(err);
      toast(err.message ?? 'Tệp sao lưu không hợp lệ', true);
    }
  });

  $('#btn-clear').addEventListener('click', async () => {
    if (!confirm('XÓA TOÀN BỘ dữ liệu (tã, cữ bú, hồ sơ)? Hành động này không thể hoàn tác.')) return;
    if (!confirm('Xác nhận lần cuối: xóa hết phải không?')) return;
    await store.clearAll();
    await refresh();
    toast('Đã xóa toàn bộ dữ liệu');
  });
}

async function updateBabyName() {
  const baby = await store.getBaby();
  els.babyName.textContent = baby?.name ? `Bé ${baby.name}` : 'Em bé';
}

// ---------- boot ----------

async function refresh() {
  state.events = await store.listEvents();
  renderAll();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          const bar = $('#update-bar');
          bar.hidden = false;
          $('#btn-reload').onclick = () => {
            reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
          };
        }
      });
    });
  }).catch((err) => console.warn('SW registration failed:', err));

  let refreshed = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshed) return;
    refreshed = true;
    window.location.reload();
  });
}

async function boot() {
  wireDiaperForm();
  wireFeedingForm();
  wireHistory();
  wireFilters();
  wireSettings();

  $('#btn-add-diaper').addEventListener('click', () => openDiaperDialog());
  $('#btn-add-feeding').addEventListener('click', () => openFeedingDialog());
  $('#btn-dismiss-update').addEventListener('click', () => {
    $('#update-bar').hidden = true;
  });

  await refresh();
  await updateBabyName();
  registerServiceWorker();
}

boot().catch((err) => {
  console.error(err);
  toast('Không khởi tạo được ứng dụng: ' + err.message, true);
});

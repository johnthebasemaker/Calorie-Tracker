/* ------------------------------------------------------------------
   Macros — offline calorie, macro and water tracker
   Single user, no backend. Everything lives in localStorage.
   ------------------------------------------------------------------ */
'use strict';

const KEY = {
  set:   'ct.settings.v1',
  foods: 'ct.foods.v1',
  log:   'ct.entries.v1',
  water: 'ct.water.v1',
  names: 'ct.names.v1',     // barcode -> the English name you gave it
  ai:    'ct.ai.v1',        // { key, model } — device-only, never exported
};

/* OpenRouter is OpenAI-compatible and returns access-control-allow-origin: *,
   so the browser can call it directly from the Pages origin with no proxy. */
const AI_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const AI_DEFAULT_MODEL = 'openai/gpt-oss-20b:free';

const DEFAULT_TARGETS = { kcal: 2900, p: 130, c: 390, f: 90, water: 3500 };

/* Extra nutrients, in display order. Stored per 100 g on the food, and
   snapshotted onto each log entry so history never shifts. A missing key
   means "not known" and renders as "—" — never as zero. */
const MICROS = [
  { k: 'fb', label: 'Fibre',       unit: 'g',  dp: 1 },
  { k: 'sg', label: 'Sugar',       unit: 'g',  dp: 1 },
  { k: 'na', label: 'Sodium',      unit: 'mg', dp: 0 },
  { k: 'ch', label: 'Cholesterol', unit: 'mg', dp: 0 },
  { k: 'ca', label: 'Calcium',     unit: 'mg', dp: 0 },
  { k: 'fe', label: 'Iron',        unit: 'mg', dp: 1 },
];

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ------------------------------- state ------------------------------- */

const state = {
  targets: DEFAULT_TARGETS,
  custom:  [],          // user-created foods + overrides of seed foods (same id)
  entries: [],          // food log rows
  water:   [],          // water log rows
  names:   {},          // barcode -> English name
  ai:      { key: '', model: AI_DEFAULT_MODEL },
  date:    todayStr(),
};

function readJSON(k, fallback) {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function writeJSON(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); }
  catch (e) { toast('Storage full — export a backup and clear old data.'); }
}

function load() {
  state.targets = Object.assign({}, DEFAULT_TARGETS, readJSON(KEY.set, {}));
  state.custom  = readJSON(KEY.foods, []);
  state.entries = readJSON(KEY.log, []);
  state.water   = readJSON(KEY.water, []);
  state.names   = readJSON(KEY.names, {});
  state.ai      = Object.assign({ key: '', model: AI_DEFAULT_MODEL }, readJSON(KEY.ai, {}));
}
const saveFoods   = () => writeJSON(KEY.foods, state.custom);
const saveEntries = () => writeJSON(KEY.log, state.entries);
const saveWater   = () => writeJSON(KEY.water, state.water);
const saveNames   = () => writeJSON(KEY.names, state.names);
const saveAi      = () => writeJSON(KEY.ai, state.ai);
const saveTargets = () => writeJSON(KEY.set, state.targets);

/* ------------------------------- helpers ------------------------------- */

function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftDate(str, days) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return todayStr(dt);
}
function prettyDate(str) {
  if (str === todayStr()) return 'Today';
  if (str === shiftDate(todayStr(), -1)) return 'Yesterday';
  if (str === shiftDate(todayStr(), 1)) return 'Tomorrow';
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
const uid  = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || uid();
const r0   = n => Math.round(n);
const r1   = n => Math.round(n * 10) / 10;
const gfmt = n => (n >= 100 ? r0(n) : r1(n));
const clampPct = n => Math.max(0, Math.min(100, n));

/* Blank stays blank: an empty field means unknown, not zero. */
const numOrUndef = v => {
  if (v === '' || v == null) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const microFmt = (v, m) => (typeof v === 'number' ? (m.dp ? r1(v) : r0(v)).toLocaleString() : '—');

/* Merge seed foods with user foods. A user record with a seed id overrides it. */
function allFoods() {
  const map = new Map();
  SEED_FOODS.forEach(f => map.set(f.id, f));
  state.custom.forEach(f => map.set(f.id, Object.assign({}, map.get(f.id) || {}, f)));
  return Array.from(map.values());
}
const foodById = id => allFoods().find(f => f.id === id);

/* ------------------------------- search ------------------------------- */

function searchFoods(q, limit = 25) {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const words = t.split(/\s+/);
  const scored = [];

  for (const f of allFoods()) {
    const name = f.n.toLowerCase();
    const hay  = name + ' ' + (f.a || '').toLowerCase() + ' ' + (f.g || '').toLowerCase();
    let score = 0;

    if (name === t) score = 1000;
    else if (name.startsWith(t)) score = 800;
    else if (new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(name)) score = 600;
    else if (name.includes(t)) score = 400;
    else if (hay.includes(t)) score = 250;
    else if (words.length > 1 && words.every(w => hay.includes(w))) score = 180;

    if (!score) continue;
    if (f.src === 'user') score += 40;                 // my own foods rank first
    score -= Math.min(name.length, 30) * 0.4;          // prefer shorter names
    scored.push({ f, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.f);
}

/* Foods I actually log, most-used first. */
function usageStats() {
  const stats = new Map();
  for (const e of state.entries) {
    const cur = stats.get(e.fid) || { fid: e.fid, n: e.n, count: 0, lastG: e.g, lastTs: 0 };
    cur.count++;
    if (e.ts > cur.lastTs) { cur.lastTs = e.ts; cur.lastG = e.g; cur.n = e.n; }
    stats.set(e.fid, cur);
  }
  return Array.from(stats.values());
}

/* ------------------------------- totals ------------------------------- */

const entriesFor = d => state.entries.filter(e => e.d === d).sort((a, b) => a.ts - b.ts);

function macrosOf(e) {
  const k = e.g / 100;
  return { kcal: e.k100 * k, p: e.p100 * k, c: e.c100 * k, f: e.f100 * k };
}
function totalsFor(d) {
  return entriesFor(d).reduce((t, e) => {
    const m = macrosOf(e);
    t.kcal += m.kcal; t.p += m.p; t.c += m.c; t.f += m.f;
    return t;
  }, { kcal: 0, p: 0, c: 0, f: 0 });
}

/* Micro totals, plus how many of the day's foods actually reported each
   one — a sodium total from 2 of 7 foods should not look authoritative. */
function microTotalsFor(d) {
  const rows = entriesFor(d);
  const out = {};
  MICROS.forEach(m => {
    let sum = 0, have = 0;
    rows.forEach(e => {
      const v = e.m && e.m[m.k];
      if (typeof v === 'number') { sum += v * e.g / 100; have++; }
    });
    out[m.k] = { sum, have, total: rows.length };
  });
  return out;
}

/* ------------------------------- water ------------------------------- */

const waterFor  = d => state.water.filter(w => w.d === d).sort((a, b) => a.ts - b.ts);
const waterTotal = d => waterFor(d).reduce((s, w) => s + w.ml, 0);

function addWater(ml) {
  const v = Math.round(Number(ml));
  if (!(v > 0)) { toast('Enter an amount in ml'); return null; }
  if (v > 5000) { toast('That looks too big for one go — add it in smaller amounts'); return null; }
  const rec = { id: uid(), d: state.date, ml: v, ts: Date.now() };
  state.water.push(rec);
  saveWater();
  renderWater();
  return rec;
}
function removeWater(id) {
  const rec = state.water.find(w => w.id === id);
  state.water = state.water.filter(w => w.id !== id);
  saveWater();
  renderWater();
  if (rec) toast(`${rec.ml} ml removed`, 'Undo', () => {
    state.water.push(rec); saveWater(); renderWater();
  });
}

/* =====================================================================
   RENDER
   ===================================================================== */

let totalsOpen = false, psMicroOpen = false;

function renderAll() {
  renderDate();
  renderSummary();
  renderWater();
  renderQuick();
  renderEntries();
}

function renderDate() {
  $('#dateLabel').textContent = prettyDate(state.date);
  $('#datePicker').value = state.date;
  $('#nextDay').style.visibility = state.date >= todayStr() ? 'hidden' : 'visible';
}

function renderSummary() {
  const t = totalsFor(state.date), g = state.targets;

  $('#sumKcal').textContent = r0(t.kcal);
  const left = g.kcal - t.kcal;
  const sub = $('#kcalRemain');
  sub.textContent = left >= 0 ? `${r0(left)} left of ${g.kcal}` : `${r0(-left)} over ${g.kcal}`;
  sub.classList.toggle('over', left < 0);

  const pct = g.kcal ? (t.kcal / g.kcal) * 100 : 0;
  const CIRC = 2 * Math.PI * 19;
  const ring = $('#ringKcal');
  ring.style.strokeDashoffset = CIRC * (1 - clampPct(pct) / 100);
  ring.style.opacity = pct < 0.5 ? 0 : 1;   // hide the round cap dot at zero
  ring.classList.toggle('over', pct > 100);
  $('#ringPct').textContent = r0(pct) + '%';

  [['P', 'p'], ['C', 'c'], ['F', 'f']].forEach(([id, k]) => {
    const val = t[k], tgt = g[k];
    $('#lbl' + id).textContent = `${gfmt(val)} / ${tgt} g`;
    const bar = $('#bar' + id);
    bar.style.width = clampPct(tgt ? (val / tgt) * 100 : 0) + '%';
    bar.classList.toggle('over', tgt && val > tgt);
  });

  renderTotalsMicros();
}

function renderTotalsMicros() {
  const totals = microTotalsFor(state.date);
  const grid = $('#totalsMicroGrid');
  grid.innerHTML = '';
  let partial = false;

  MICROS.forEach(m => {
    const s = totals[m.k];
    const known = s.have > 0;
    const isPartial = known && s.have < s.total;
    if (isPartial) partial = true;

    const cell = document.createElement('div');
    cell.innerHTML = `
      <b class="${known ? '' : 'none'}">${known ? microFmt(s.sum, m) : '—'}${known ? ` <small>${m.unit}</small>` : ''}</b>
      <span>${m.label}${isPartial ? ` (${s.have}/${s.total})` : ''}</span>`;
    grid.appendChild(cell);
  });

  const note = $('#totalsMicroNote');
  if (!entriesFor(state.date).length) {
    note.textContent = 'Log some food to see the full breakdown.';
  } else if (partial) {
    note.textContent = 'A count like (3/6) means only 3 of the 6 foods logged reported that nutrient, '
      + 'so the real total is higher. Fill gaps in the Foods tab.';
  } else {
    note.textContent = 'Every food logged today reported all six.';
  }
}

function renderWater() {
  const total = waterTotal(state.date), tgt = state.targets.water || 0;

  $('#waterSum').textContent = `${total.toLocaleString()} ml`;
  const left = tgt - total;
  $('#waterTargetLbl').textContent = left > 0
    ? `${left.toLocaleString()} ml to go`
    : `target ${tgt.toLocaleString()} ml met`;

  const bar = $('#barW');
  bar.style.width = clampPct(tgt ? (total / tgt) * 100 : 0) + '%';

  const log = $('#waterLog');
  log.innerHTML = '';
  waterFor(state.date).forEach(w => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `<b>${w.ml} ml</b><i>&times;</i>`;
    b.setAttribute('aria-label', `Remove ${w.ml} ml`);
    b.onclick = () => removeWater(w.id);
    log.appendChild(b);
  });
}

function renderQuick() {
  const top = usageStats().sort((a, b) => b.count - a.count || b.lastTs - a.lastTs).slice(0, 8);
  const wrap = $('#quickWrap'), box = $('#quickChips');
  wrap.classList.toggle('hidden', top.length === 0);
  box.innerHTML = '';

  top.forEach(s => {
    const f = foodById(s.fid);
    if (!f) return;
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `${escapeHtml(f.n)}<small>${r0(s.lastG)} g</small>`;
    b.onclick = () => {
      addEntry(f, s.lastG);
      toast(`${f.n} · ${r0(s.lastG)} g added`, 'Undo', undoLastAdd);
    };
    box.appendChild(b);
  });
}

function renderEntries() {
  const list = $('#entryList'), rows = entriesFor(state.date);
  list.innerHTML = '';
  $('#entryEmpty').classList.toggle('hidden', rows.length > 0);

  rows.forEach(e => {
    const m = macrosOf(e);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'row';
    btn.innerHTML = `
      <div class="info">
        <div class="nm">${escapeHtml(e.n)}</div>
        <div class="sub">${r0(e.g)} g · P ${gfmt(m.p)} · C ${gfmt(m.c)} · F ${gfmt(m.f)}</div>
      </div>
      <div class="kc"><b>${r0(m.kcal)}</b><span>kcal</span></div>`;
    btn.onclick = () => openPortion({ mode: 'edit', entry: e });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/* =====================================================================
   LOG ENTRIES
   ===================================================================== */

let lastAddedId = null;

function addEntry(food, grams) {
  const micro = {};
  MICROS.forEach(m => { if (typeof food[m.k] === 'number') micro[m.k] = food[m.k]; });

  const e = {
    id: uid(), d: state.date, fid: food.id, n: food.n, g: Number(grams),
    k100: Number(food.kcal), p100: Number(food.p), c100: Number(food.c), f100: Number(food.f),
    m: micro,
    ts: Date.now(),
  };
  state.entries.push(e);
  lastAddedId = e.id;
  saveEntries();
  renderAll();
  return e;
}
function undoLastAdd() {
  if (!lastAddedId) return;
  state.entries = state.entries.filter(e => e.id !== lastAddedId);
  lastAddedId = null;
  saveEntries();
  renderAll();
}

/* =====================================================================
   PORTION SHEET
   ===================================================================== */

let ps = { food: null, entry: null, mode: 'add' };

function openPortion({ mode, food, entry, grams }) {
  ps.mode = mode;
  ps.entry = entry || null;
  ps.food = food || (entry ? foodById(entry.fid) : null);

  /* Entry for a food that was later deleted — rebuild from the snapshot. */
  if (!ps.food && entry) {
    ps.food = { id: entry.fid, n: entry.n, kcal: entry.k100, p: entry.p100, c: entry.c100, f: entry.f100 };
    Object.assign(ps.food, entry.m || {});
  }
  const f = ps.food;

  $('#psName').textContent = f.n;
  $('#psMeta').textContent =
    `Per 100 g: ${r0(f.kcal)} kcal · P ${gfmt(f.p)} · C ${gfmt(f.c)} · F ${gfmt(f.f)}`;

  /* Renaming is only meaningful for barcode products, which is also the
     only place Arabic-only names come from. */
  const code = barcodeOf(f.id);
  $('#psRename').classList.toggle('hidden', !code);
  $('#psArabicNote').classList.toggle('hidden', !(code && hasArabic(f.n)));
  hideRenameRow();

  const start = grams != null ? grams
    : entry ? entry.g
    : (f.u && f.u[0] ? f.u[0].g : (f.serve || 100));
  $('#psGrams').value = r0(start);

  /* Household-portion chips */
  const units = $('#psUnits');
  units.innerHTML = '';
  const opts = (f.u && f.u.length) ? f.u.slice()
    : (f.serve ? [{ l: f.sl || '1 serving', g: f.serve }] : []);
  [50, 100, 200].forEach(g => { if (!opts.some(o => o.g === g)) opts.push({ l: g + ' g', g }); });
  opts.forEach(o => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.g = o.g;
    b.textContent = o.l === `${o.g} g` ? o.l : `${o.l} · ${o.g} g`;
    b.onclick = () => { $('#psGrams').value = o.g; previewPortion(); };
    units.appendChild(b);
  });

  $('#psSave').textContent = mode === 'edit' ? 'Save changes' : 'Add to log';
  $('#psDelete').classList.toggle('hidden', mode !== 'edit');
  setExpanded($('#psMoreBtn'), $('#psMicroWrap'), psMicroOpen);
  previewPortion();
  showSheet('#portionSheet');
}

function previewPortion() {
  const grams = parseFloat($('#psGrams').value) || 0;
  const f = ps.food, k = grams / 100;

  $('#pvK').textContent = r0(f.kcal * k);
  $('#pvP').textContent = gfmt(f.p * k);
  $('#pvC').textContent = gfmt(f.c * k);
  $('#pvF').textContent = gfmt(f.f * k);

  const pct = state.targets.kcal ? (f.kcal * k / state.targets.kcal) * 100 : 0;
  $('#psDay').textContent = grams > 0
    ? `${r0(pct)}% of your ${state.targets.kcal} kcal day`
    : 'Enter how many grams you ate';

  $$('#psUnits .chip').forEach(c => c.classList.toggle('on', +c.dataset.g === grams));

  /* extra nutrients for this portion */
  const grid = $('#psMicroGrid');
  grid.innerHTML = '';
  let unknown = 0;
  MICROS.forEach(m => {
    const per100 = f[m.k];
    const known = typeof per100 === 'number';
    if (!known) unknown++;
    const cell = document.createElement('div');
    cell.innerHTML = `
      <b class="${known ? '' : 'none'}">${known ? microFmt(per100 * k, m) : '—'}${known ? ` <small>${m.unit}</small>` : ''}</b>
      <span>${m.label}</span>`;
    grid.appendChild(cell);
  });
  $('#psMicroNote').textContent = unknown === 0
    ? `For ${r0(grams)} g.`
    : unknown === MICROS.length
      ? 'No extra nutrition on file for this food. Add it in the Foods tab and it sticks.'
      : `For ${r0(grams)} g. “—” means the value isn’t on file — add it in the Foods tab.`;
}

function commitPortion() {
  const grams = parseFloat($('#psGrams').value);
  if (!(grams > 0)) { toast('Enter grams first'); return; }

  if (ps.mode === 'edit' && ps.entry) {
    ps.entry.g = grams;
    /* Entries logged before this version have no micro snapshot. Adopt the
       food's current values now that you're editing it anyway, so the day's
       breakdown stops counting it as unknown. */
    if (!ps.entry.m) {
      const micro = {};
      MICROS.forEach(m => { if (typeof ps.food[m.k] === 'number') micro[m.k] = ps.food[m.k]; });
      ps.entry.m = micro;
    }
    saveEntries();
    toast('Updated');
  } else {
    addEntry(ps.food, grams);
    toast(`${ps.food.n} added`, 'Undo', undoLastAdd);
  }
  closeSheets();
  renderAll();
}

function deleteEntry() {
  const e = ps.entry;
  if (!e) return;
  state.entries = state.entries.filter(x => x.id !== e.id);
  saveEntries();
  closeSheets();
  renderAll();
  toast('Entry deleted', 'Undo', () => {
    state.entries.push(e); saveEntries(); renderAll();
  });
}

/* ---------------------- renaming a barcode product ---------------------- */

/* Arabic block, Arabic Supplement, and the two presentation-forms ranges.
   Built from a string so the source file stays plain ASCII. */
const ARABIC_RE = new RegExp('[\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF]');
const hasArabic = s => ARABIC_RE.test(String(s));
const barcodeOf = id => (String(id).startsWith('off:') ? String(id).slice(4) : null);

function showRenameRow() {
  $('#psRenameRow').classList.remove('hidden');
  $('#psRenameInput').value = ps.food.n;
  $('#psRenameInput').focus();
  $('#psRenameInput').select();
}
function hideRenameRow() { $('#psRenameRow').classList.add('hidden'); }

function saveRename() {
  const name = $('#psRenameInput').value.trim();
  if (!name) { toast('Give it a name first'); return; }

  const code = barcodeOf(ps.food.id);
  if (code) { state.names[code] = name; saveNames(); }

  ps.food.n = name;
  const i = state.custom.findIndex(x => x.id === ps.food.id);
  if (i >= 0) { state.custom[i].n = name; saveFoods(); }

  $('#psName').textContent = name;
  $('#psArabicNote').classList.add('hidden');
  hideRenameRow();
  renderLibrary();
  toast(code ? 'Saved — future scans of this barcode use your name' : 'Renamed');
}

/* =====================================================================
   FOOD EDITOR SHEET
   ===================================================================== */

let fsEditingId = null, fsForceId = null, fsAi = null;
const FS_MICRO_IDS = { fb: '#fFb', sg: '#fSg', na: '#fNa', ch: '#fCh', ca: '#fCa', fe: '#fFe' };

/* `food`  -> editing something already in the library
   `opts.prefill` -> a new food with values filled in for review (the AI path)
   `opts.ai`      -> render as the estimate confirm screen
   `opts.forceId` -> save under this id (a barcode) instead of a fresh one */
function openFoodEditor(food, presetName, opts = {}) {
  const src = food || opts.prefill || null;
  fsEditingId = food ? food.id : null;
  fsForceId   = opts.forceId || null;
  fsAi        = opts.ai || null;

  const isSeedOverride = food && SEED_FOODS.some(s => s.id === food.id);

  $('#fsTitle').textContent = food ? 'Edit food' : fsAi ? 'Check the estimate' : 'New food';
  $('#fName').value  = src ? (src.n || presetName || '') : (presetName || '');
  $('#fKcal').value  = src && src.kcal != null ? src.kcal : '';
  $('#fP').value     = src && src.p != null ? src.p : '';
  $('#fC').value     = src && src.c != null ? src.c : '';
  $('#fF').value     = src && src.f != null ? src.f : '';
  $('#fServe').value = src ? (src.serve || (src.u && src.u[0] ? src.u[0].g : '')) : '';
  $('#fServeLabel').value = src ? (src.sl || (src.u && src.u[0] ? src.u[0].l : '')) : '';

  MICROS.forEach(m => {
    $(FS_MICRO_IDS[m.k]).value = src && typeof src[m.k] === 'number' ? src[m.k] : '';
  });

  /* AI results always open expanded — the whole point is that you check them. */
  const anyMicro = src && MICROS.some(m => typeof src[m.k] === 'number');
  setExpanded($('#fsMoreBtn'), $('#fsMicros'), !!(anyMicro || fsAi));

  const banner = $('#fsAiBanner');
  banner.classList.toggle('hidden', !fsAi);
  if (fsAi) {
    const bits = [];
    if (fsAi.confidence) bits.push(`${fsAi.confidence} confidence`);
    if (fsAi.model) bits.push(fsAi.model);
    $('#fsAiMeta').textContent =
      `Estimated from “${fsAi.desc}” — these are typical values, not measured. `
      + `Adjust anything that looks wrong.${bits.length ? ' (' + bits.join(' · ') + ')' : ''}`;
  }
  $('#fsIntro').classList.toggle('hidden', !!fsAi);
  $('#fsSave').textContent = fsAi ? 'Confirm & Save' : 'Save food';

  const del = $('#fsDelete');
  del.classList.toggle('hidden', !food);
  del.textContent = isSeedOverride ? 'Reset to built-in values' : 'Delete food';
  checkFoodMath();
  showSheet('#foodSheet');
}

function checkFoodMath() {
  const k = +$('#fKcal').value, p = +$('#fP').value, c = +$('#fC').value, f = +$('#fF').value;
  const el = $('#fsCheck');
  if (!k || (!p && !c && !f)) { el.textContent = ''; return; }
  const derived = p * 4 + c * 4 + f * 9;
  const off = Math.abs(derived - k) / k;
  el.textContent = off > 0.2
    ? `Heads up: your macros work out to about ${r0(derived)} kcal, not ${r0(k)}. Worth a re-check.`
    : `Macros check out (≈${r0(derived)} kcal).`;
}

function saveFoodFromEditor() {
  const name = $('#fName').value.trim();
  const kcal = parseFloat($('#fKcal').value);
  if (!name)        { toast('Name it first'); return; }
  if (!(kcal >= 0)) { toast('Calories per 100 g are required'); return; }

  /* Keyed to the barcode when there is one, otherwise to the name for AI
     foods, so re-estimating the same thing updates it instead of duplicating. */
  const id = fsEditingId || fsForceId
    || (fsAi ? 'usr:' + slugify(name) : 'usr:' + uid());

  const rec = {
    id,
    n: name,
    kcal,
    p: parseFloat($('#fP').value) || 0,
    c: parseFloat($('#fC').value) || 0,
    f: parseFloat($('#fF').value) || 0,
    src: 'user',
    g: 'My foods',
  };
  const serve = parseFloat($('#fServe').value);
  if (serve > 0) {
    rec.serve = serve;
    const label = $('#fServeLabel').value.trim();
    if (label) rec.sl = label;
  }
  if (fsAi) { rec.ai = 1; if (fsAi.confidence) rec.aiConf = fsAi.confidence; }

  /* Micros: a filled field is stored as a number. A field cleared by hand
     is stored as null, which reads as "unknown" everywhere and is the only
     way to drop a built-in seed value. A field that was blank all along is
     omitted, so it can still inherit from the seed food. */
  const inherited = fsEditingId ? (foodById(fsEditingId) || {}) : {};
  MICROS.forEach(m => {
    const v = numOrUndef($(FS_MICRO_IDS[m.k]).value);
    if (v !== undefined) rec[m.k] = v;
    else if (typeof inherited[m.k] === 'number') rec[m.k] = null;
  });

  const i = state.custom.findIndex(x => x.id === rec.id);
  if (i >= 0) state.custom[i] = Object.assign({}, state.custom[i], rec);
  else state.custom.push(rec);
  saveFoods();

  const wasAi = !!fsAi;
  closeSheets();
  renderLibrary();
  toast(wasAi ? `${name} saved — estimate accepted` : `${name} saved to your library`);

  /* Straight into logging it — that's why you added it. */
  if (i < 0 || wasAi) openPortion({ mode: 'add', food: foodById(rec.id) });
}

function deleteFoodFromEditor() {
  if (!fsEditingId) return;
  const isSeed = SEED_FOODS.some(s => s.id === fsEditingId);
  const label = isSeed ? 'Reset this food to its built-in values?' : 'Delete this food from your library?';
  if (!confirm(label + '\n\nEntries already logged keep their numbers.')) return;

  state.custom = state.custom.filter(x => x.id !== fsEditingId);
  saveFoods();
  closeSheets();
  renderLibrary();
  toast(isSeed ? 'Reset to built-in values' : 'Food deleted');
}

/* =====================================================================
   SEARCH / ADD TAB
   ===================================================================== */

let offAbort = null, searchTimer = null;
const OFF_MIN_CHARS = 3;

function runSearch(q) {
  const idle = !q.trim();
  $('#addIdle').classList.toggle('hidden', !idle);
  $('#addResults').classList.toggle('hidden', idle);
  $('#searchClear').classList.toggle('hidden', idle);
  if (idle) { renderRecent(); return; }

  $('#createTerm').textContent = q.trim();
  $('#aiTerm').textContent = q.trim();

  const local = searchFoods(q);
  const list = $('#localResults');
  list.innerHTML = '';
  $('#localEmpty').classList.toggle('hidden', local.length > 0);
  local.forEach(f => list.appendChild(foodRow(f, () => openPortion({ mode: 'add', food: f }))));

  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => searchOFF(q), 600);
}

function foodRow(f, onClick, subOverride) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.className = 'row';
  const tag = (f.ai ? '<span class="tag ai">AI</span>' : '')
            + (f.src === 'user' ? '<span class="tag mine">mine</span>'
             : f.src === 'off'  ? '<span class="tag off">packaged</span>' : '');
  b.innerHTML = `
    <div class="info">
      <div class="nm">${escapeHtml(f.n)}${tag}</div>
      <div class="sub">${subOverride || `${escapeHtml(f.g || '')} · P ${gfmt(f.p)} · C ${gfmt(f.c)} · F ${gfmt(f.f)} per 100 g`}</div>
    </div>
    <div class="kc"><b>${r0(f.kcal)}</b><span>kcal/100g</span></div>`;
  b.onclick = onClick;
  li.appendChild(b);
  return li;
}

/* -------- Open Food Facts (packaged/branded items, no key needed) --------
   OFF rate-limits search hard (a few calls a minute per IP) and returns those
   429s without CORS headers, so they land here as plain network failures.
   Hence: a minimum query length, a long debounce, and a session cache. */
const offCache = new Map();
const OFF_FIELDS = 'code,product_name,product_name_en,generic_name,generic_name_en,brands,quantity,nutriments';

/* Prefer an English name, and remember any name I typed for this barcode. */
function pickEnglishName(p) {
  const mine = state.names[p.code];
  if (mine) return { name: mine, needsRename: false };

  const candidates = [p.product_name_en, p.generic_name_en, p.product_name, p.generic_name];
  const english = candidates.find(n => n && n.trim() && !hasArabic(n));
  if (english) return { name: english.trim(), needsRename: false };

  const any = candidates.find(n => n && n.trim());
  if (any) return { name: any.trim(), needsRename: true };

  return { name: (p.brands || 'Unknown product') + ' ' + p.code, needsRename: true };
}

/* OFF reports these per 100 g in grams; we keep mg for the mineral-type
   ones. Implausible values (bad crowd data) are dropped rather than shown. */
function offMicros(nu) {
  const m = {};
  const put = (k, v, max) => {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max) m[k] = r1(v);
  };
  const mg = v => (typeof v === 'number' ? v * 1000 : undefined);

  put('fb', nu.fiber_100g, 100);
  put('sg', nu.sugars_100g, 100);
  put('na', nu.sodium_100g != null ? nu.sodium_100g * 1000
          : nu.salt_100g != null ? nu.salt_100g * 400 : undefined, 20000);
  put('ch', mg(nu.cholesterol_100g), 5000);
  put('ca', mg(nu.calcium_100g), 5000);
  put('fe', mg(nu.iron_100g), 200);
  return m;
}

function offToFood(p) {
  const nu = p.nutriments || {};
  const kcal = nu['energy-kcal_100g'] ?? (nu['energy_100g'] ? nu['energy_100g'] / 4.184 : null);
  if (kcal == null) return null;

  const { name, needsRename } = pickEnglishName(p);
  return Object.assign({
    id: 'off:' + p.code,
    n: name,
    g: [p.brands, p.quantity].filter(Boolean).join(' · ') || 'Packaged',
    kcal: r1(kcal),
    p: r1(nu.proteins_100g || 0),
    c: r1(nu.carbohydrates_100g || 0),
    f: r1(nu.fat_100g || 0),
    src: 'off',
    needsRename,
  }, offMicros(nu));
}

async function searchOFF(q) {
  const term = q.trim();
  const status = $('#offStatus'), list = $('#offResults');
  const empty = $('#offEmpty'), retry = $('#offRetry');

  list.innerHTML = '';
  empty.classList.add('hidden');
  retry.classList.add('hidden');

  if (term.length < OFF_MIN_CHARS) {
    status.textContent = `type ${OFF_MIN_CHARS}+ letters`;
    return;
  }
  if (offCache.has(term.toLowerCase())) {
    paintOFF(offCache.get(term.toLowerCase()));
    return;
  }

  status.textContent = 'searching…';
  if (offAbort) offAbort.abort();
  offAbort = new AbortController();

  const barcode = /^\d{8,14}$/.test(term);
  const urls = barcode
    ? [`https://world.openfoodfacts.org/api/v2/product/${term}.json?fields=${OFF_FIELDS}`]
    : [
        'https://world.openfoodfacts.org/cgi/search.pl'
          + `?search_simple=1&action=process&json=1&page_size=12&fields=${OFF_FIELDS}`
          + '&search_terms=' + encodeURIComponent(term),
        /* Second door: the two search endpoints fail independently. */
        'https://world.openfoodfacts.org/api/v2/search'
          + `?page_size=12&fields=${OFF_FIELDS}`
          + '&search_terms=' + encodeURIComponent(term),
      ];

  try {
    let data = null, lastErr = null;
    for (const u of urls) {
      try {
        const res = await fetch(u, { signal: offAbort.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        data = await res.json();
        break;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastErr = e;
      }
    }
    if (!data) throw lastErr || new Error('no response');

    const raw = barcode ? (data.product ? [data.product] : []) : (data.products || []);
    const items = raw.map(offToFood).filter(Boolean).slice(0, 8);

    offCache.set(term.toLowerCase(), items);
    paintOFF(items);
  } catch (err) {
    if (err.name === 'AbortError') return;
    status.textContent = 'unavailable';
    empty.textContent = 'Open Food Facts did not answer (offline, or too many searches in a minute). Your library and manual entry still work.';
    empty.classList.remove('hidden');
    retry.classList.remove('hidden');
    retry.onclick = () => searchOFF(term);
  }
}

function paintOFF(items) {
  const list = $('#offResults'), empty = $('#offEmpty');
  list.innerHTML = '';
  $('#offStatus').textContent = 'Open Food Facts';
  empty.textContent = 'No packaged match — use manual entry below.';
  empty.classList.toggle('hidden', items.length > 0);

  items.forEach(f => list.appendChild(foodRow(f, () => {
    rememberOffFood(f);
    openPortion({ mode: 'add', food: f });
  })));
}

/* Keep it, so the second time it is a local hit. */
function rememberOffFood(f) {
  const rec = Object.assign({}, f);
  delete rec.needsRename;
  const i = state.custom.findIndex(x => x.id === rec.id);
  if (i >= 0) state.custom[i] = Object.assign({}, state.custom[i], rec);
  else state.custom.push(rec);
  saveFoods();
}

function renderRecent() {
  const recent = usageStats().sort((a, b) => b.lastTs - a.lastTs).slice(0, 12);
  const list = $('#recentList');
  list.innerHTML = '';
  $('#recentEmpty').classList.toggle('hidden', recent.length > 0);
  recent.forEach(s => {
    const f = foodById(s.fid);
    if (!f) return;
    list.appendChild(foodRow(f, () => openPortion({ mode: 'add', food: f, grams: s.lastG }),
      `Last time: ${r0(s.lastG)} g · logged ${s.count}×`));
  });
}

/* =====================================================================
   BARCODE SCANNER
   ===================================================================== */

let scanner = null, scanLibPromise = null, scanBusy = false;

function loadScanLib() {
  if (window.__Html5QrcodeLibrary__) return Promise.resolve();
  if (scanLibPromise) return scanLibPromise;
  scanLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/html5-qrcode.min.js';
    s.onload = () => resolve();
    s.onerror = () => { scanLibPromise = null; reject(new Error('lib')); };
    document.head.appendChild(s);
  });
  return scanLibPromise;
}

function scanFail(title, body, showManual = true) {
  const box = $('#scanError');
  box.innerHTML = `<b>${escapeHtml(title)}</b>${escapeHtml(body)}`;
  box.classList.remove('hidden');
  $('#scanHint').classList.add('hidden');
  $('#reader').classList.add('hidden');
  if (showManual) revealManualBarcode();
}

function revealManualBarcode() {
  $('#scanManualRow').classList.remove('hidden');
  $('#scanManual').classList.add('hidden');
  setTimeout(() => $('#scanManualInput').focus(), 80);
}

async function openScanner() {
  $('#scanError').classList.add('hidden');
  $('#scanHint').classList.remove('hidden');
  $('#reader').classList.remove('hidden');
  $('#scanManualRow').classList.add('hidden');
  $('#scanManual').classList.remove('hidden');
  $('#scanManualInput').value = '';
  showSheet('#scanSheet');

  if (!window.isSecureContext) {
    scanFail('Camera needs a secure connection. ',
      'Open the app over https (the GitHub Pages link) rather than a plain http address, then try again.');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    scanFail('This browser will not share the camera. ',
      'On iPhone the camera only works in Safari or a Home Screen app — not inside another app’s in-app browser.');
    return;
  }

  try {
    await loadScanLib();
  } catch {
    scanFail('Scanner could not load. ', 'Type the barcode number from the packet instead.');
    return;
  }

  const lib = window.__Html5QrcodeLibrary__;
  const F = lib.Html5QrcodeSupportedFormats;
  try {
    scanner = new lib.Html5Qrcode('reader', {
      verbose: false,
      formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF],
    });
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 260, height: 140 }, aspectRatio: 1.4 },
      onBarcode,
      () => {}                     // per-frame misses are normal; ignore
    );
  } catch (err) {
    /* html5-qrcode rejects with a plain string like
       "Error getting userMedia, error = NotAllowedError: Permission denied",
       so the DOMException name only exists inside the text. */
    const name = typeof err === 'string' ? err
      : [err && err.name, err && err.message, String(err)].filter(Boolean).join(' ');

    if (/NotAllowed|Permission|denied/i.test(name)) {
      scanFail('Camera permission was denied. ',
        'On iPhone: Settings → Safari → Camera → Allow, or tap the “aA” icon in the address bar → Website Settings. Then reopen the scanner. You can type the number in the meantime.');
    } else if (/NotFound|Devices|OverConstrained/i.test(name)) {
      scanFail('No usable camera found. ', 'Type the barcode number from the packet instead.');
    } else {
      scanFail('Could not start the camera. ', 'Type the barcode number from the packet instead.');
    }
  }
}

async function stopScanner() {
  if (!scanner) return;
  const s = scanner;
  scanner = null;
  try { if (s.isScanning) await s.stop(); } catch {}
  try { s.clear(); } catch {}
}

function onBarcode(text) {
  if (scanBusy) return;
  scanBusy = true;
  if (navigator.vibrate) navigator.vibrate(40);
  stopScanner().then(() => lookupBarcode(String(text).trim()));
}

async function lookupBarcode(code) {
  closeSheets();
  toast(`Looking up ${code}…`);

  /* Already in the library — skip the network entirely. */
  const known = foodById('off:' + code);
  if (known) {
    scanBusy = false;
    openPortion({ mode: 'add', food: known });
    return;
  }

  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const food = data.product ? offToFood(data.product) : null;

    if (!food) {
      openNotFound({ code });
      return;
    }
    rememberOffFood(food);
    openPortion({ mode: 'add', food });
    if (food.needsRename) toast('No English name on file — tap Rename');
  } catch {
    toast('Could not reach Open Food Facts');
    openNotFound({ code });
  } finally {
    scanBusy = false;
  }
}

/* =====================================================================
   AI ESTIMATION  (OpenRouter, browser-direct — no proxy, no backend)
   ===================================================================== */

const AI_SYSTEM = [
  'You are a nutrition reference. Given a short food description, return typical values',
  'for an average, commonly prepared version of that food.',
  '',
  'Rules:',
  '- Every nutrient value is PER 100 g of the food as eaten (per 100 ml if it is a drink).',
  '- kcal is kilocalories. protein_g, carbs_g, fat_g, fiber_g, sugar_g are grams.',
  '  sodium_mg, cholesterol_mg, calcium_mg, iron_mg are milligrams.',
  '- Keep it internally consistent: protein_g*4 + carbs_g*4 + fat_g*9 must be close to kcal.',
  '- portion_label and portion_g describe ONE typical serving as sold or served,',
  '  e.g. portion_label "1 wrap" with portion_g 250.',
  '- name: a clean English name in title case, no packaging text, no marketing words.',
  '- confidence: "high" for standard well-known foods, "medium", or "low" if the',
  '  description is vague or the food varies enormously.',
  '- Use null for a single value only if it genuinely cannot be estimated.',
  '- Reply with JSON only. No prose, no markdown fences.',
  '',
  'JSON shape:',
  '{"name":string,"kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,',
  ' "fiber_g":number,"sugar_g":number,"sodium_mg":number,"cholesterol_mg":number,',
  ' "calcium_mg":number,"iron_mg":number,"portion_label":string,"portion_g":number,',
  ' "confidence":"high"|"medium"|"low"}',
].join('\n');

/* Field aliases, because a small model will not always use our exact keys.
   Keys are compared after lowercasing and stripping non-alphanumerics. */
const AI_FIELDS = [
  { to: 'kcal', min: 0, max: 900,   aliases: ['kcal', 'calories', 'energykcal', 'energy', 'caloriesper100g', 'kcalper100g'] },
  { to: 'p',    min: 0, max: 100,   aliases: ['proteing', 'protein', 'proteins'] },
  { to: 'c',    min: 0, max: 100,   aliases: ['carbsg', 'carbs', 'carbohydratesg', 'carbohydrates', 'carbohydrate', 'totalcarbohydrate'] },
  { to: 'f',    min: 0, max: 100,   aliases: ['fatg', 'fat', 'fats', 'totalfat'] },
  { to: 'fb',   min: 0, max: 100,   aliases: ['fiberg', 'fiber', 'fibreg', 'fibre', 'dietaryfiber', 'dietaryfibre'] },
  { to: 'sg',   min: 0, max: 100,   aliases: ['sugarg', 'sugar', 'sugarsg', 'sugars', 'totalsugars'] },
  { to: 'na',   min: 0, max: 20000, aliases: ['sodiummg', 'sodium'] },
  { to: 'ch',   min: 0, max: 5000,  aliases: ['cholesterolmg', 'cholesterol'] },
  { to: 'ca',   min: 0, max: 5000,  aliases: ['calciummg', 'calcium'] },
  { to: 'fe',   min: 0, max: 200,   aliases: ['ironmg', 'iron'] },
];

const normKey = k => String(k).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/per100(g|ml)$/, '');

/* Models wrap JSON in fences or prose often enough that this has to be lenient. */
function extractJson(text) {
  if (!text) return null;
  const attempts = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) attempts.push(fenced[1]);
  const first = text.indexOf('{'), last = text.lastIndexOf('}');
  if (first >= 0 && last > first) attempts.push(text.slice(first, last + 1));

  for (const a of attempts) {
    try {
      const v = JSON.parse(String(a).trim());
      if (v && typeof v === 'object') return v;
    } catch { /* next */ }
  }
  return null;
}

function coerceEstimate(raw) {
  if (!raw || typeof raw !== 'object') return null;

  /* Flatten one level, so {"nutrition":{...}} or {"per_100g":{...}} still works. */
  const flat = {};
  const absorb = obj => {
    Object.keys(obj).forEach(k => {
      const v = obj[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) absorb(v);
      else if (!(normKey(k) in flat)) flat[normKey(k)] = v;
    });
  };
  absorb(raw);

  const num = v => {
    if (v === null || v === undefined || v === '') return undefined;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  };

  const values = {};
  AI_FIELDS.forEach(fld => {
    for (const a of fld.aliases) {
      if (a in flat) {
        const n = num(flat[a]);
        if (n !== undefined && n >= fld.min && n <= fld.max) { values[fld.to] = r1(n); return; }
      }
    }
  });

  /* Calories are the one field we cannot proceed without. */
  if (values.kcal === undefined) return null;

  const pick = (...keys) => { for (const k of keys) if (flat[k] != null && flat[k] !== '') return flat[k]; };
  const conf = String(pick('confidence', 'certainty') || '').toLowerCase();

  return {
    name:       String(pick('name', 'foodname', 'productname', 'title') || '').trim(),
    values,
    portionLabel: String(pick('portionlabel', 'servinglabel', 'servingname', 'portionname') || '').trim(),
    portionG:   num(pick('portiong', 'portiongrams', 'servingg', 'servingsizeg', 'servingsize', 'portionsize')),
    confidence: ['high', 'medium', 'low'].includes(conf) ? conf : '',
  };
}

/* ------------------------------ the call ------------------------------ */

async function aiRequest(description, { timeout = 30000 } = {}) {
  const key = (state.ai.key || '').trim();
  if (!key) { const e = new Error('nokey'); e.code = 'nokey'; throw e; }
  const model = (state.ai.model || '').trim() || AI_DEFAULT_MODEL;

  const body = {
    model,
    messages: [
      { role: 'system', content: AI_SYSTEM },
      { role: 'user', content: 'Food: ' + description },
    ],
    temperature: 0.2,
    max_tokens: 700,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  const send = async withFormat => {
    const payload = withFormat
      ? Object.assign({}, body, { response_format: { type: 'json_object' } })
      : body;
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
        'HTTP-Referer': location.origin,
        'X-Title': 'Macros',
      },
      body: JSON.stringify(payload),
    });
    return res;
  };

  try {
    /* Not every model on OpenRouter accepts response_format, so fall back
       to plain prompting rather than failing the whole estimate. */
    let res = await send(true);
    if (res.status === 400 || res.status === 422) res = await send(false);

    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = (j.error && (j.error.message || j.error.code)) || ''; } catch {}
      const e = new Error(detail || ('HTTP ' + res.status));
      e.code = res.status === 401 || res.status === 403 ? 'auth'
             : res.status === 402 ? 'credits'
             : res.status === 429 ? 'rate'
             : 'http';
      e.status = res.status;
      throw e;
    }

    const data = await res.json();
    const text = data && data.choices && data.choices[0]
      && data.choices[0].message && data.choices[0].message.content;
    const est = coerceEstimate(extractJson(text));
    if (!est) { const e = new Error('unparsable'); e.code = 'parse'; e.raw = text; throw e; }
    est.model = (data.model || model);
    return est;
  } catch (err) {
    if (err.name === 'AbortError') { const e = new Error('timeout'); e.code = 'timeout'; throw e; }
    if (!err.code) err.code = /Failed to fetch|NetworkError|Load failed/i.test(err.message || '') ? 'network' : 'unknown';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function aiErrorText(err) {
  switch (err && err.code) {
    case 'nokey':   return 'No API key yet. Settings → AI estimation → paste your OpenRouter key.';
    case 'auth':    return 'OpenRouter rejected the key. Check it in Settings, or generate a new one.';
    case 'credits': return 'That key is out of credit. Add credit on openrouter.ai, or switch to a “:free” model in Settings.';
    case 'rate':    return 'Rate limited — free OpenRouter models allow only a few calls a minute. Wait a moment and try again.';
    case 'timeout': return 'The model took too long. Try again, or pick a faster model in Settings.';
    case 'network': return 'Could not reach OpenRouter. Check your connection.';
    case 'parse':   return 'The model replied with something unreadable. Try again, or use a different model in Settings.';
    default:        return 'Estimate failed: ' + ((err && err.message) || 'unknown error') + '.';
  }
}

/* ------------------------------ the flow ------------------------------ */

let aiCtx = { code: null, term: '' };   // what we are estimating for
let aiInFlight = false;

/* Barcode or search miss: offer manual entry and AI side by side. */
function openNotFound({ code, term }) {
  aiCtx = { code: code || null, term: term || '' };
  $('#nfBody').textContent = code
    ? `Barcode ${code} isn’t in Open Food Facts.`
    : `Nothing found for “${term}”.`;
  showSheet('#nfSheet');
}

function openAiDescribe({ code, term }) {
  aiCtx = { code: code || aiCtx.code, term: term || aiCtx.term };
  $('#aiDesc').value = aiCtx.term || '';
  $('#aiError').classList.add('hidden');
  $('#aiLoading').classList.add('hidden');
  $('#aiGo').disabled = false;

  const model = (state.ai.model || AI_DEFAULT_MODEL);
  $('#aiSheetNote').textContent = state.ai.key
    ? (aiCtx.code ? `Will be saved against barcode ${aiCtx.code}. Model: ${model}` : `Model: ${model}`)
    : 'No API key saved yet — add one in Settings → AI estimation first.';

  showSheet('#aiSheet');
  setTimeout(() => $('#aiDesc').focus(), 80);
}

async function runAiEstimate() {
  if (aiInFlight) return;
  const desc = $('#aiDesc').value.trim();
  if (desc.length < 3) { toast('Describe the food in a few words first'); return; }

  aiInFlight = true;
  $('#aiGo').disabled = true;
  $('#aiError').classList.add('hidden');
  $('#aiLoading').classList.remove('hidden');
  $('#aiLoadingMsg').textContent = 'Asking the model…';

  try {
    const est = await aiRequest(desc);
    closeSheets();
    openEstimateConfirm(est, desc);
  } catch (err) {
    $('#aiLoading').classList.add('hidden');
    const box = $('#aiError');
    box.innerHTML = '<b>Could not estimate</b>' + escapeHtml(aiErrorText(err));
    box.classList.remove('hidden');
    $('#aiGo').disabled = false;
  } finally {
    aiInFlight = false;
  }
}

/* Nothing is saved until Confirm & Save on this screen. */
function openEstimateConfirm(est, desc) {
  const name = est.name || desc;
  const prefill = Object.assign({ n: name }, est.values);
  if (est.portionG > 0) {
    prefill.serve = Math.round(est.portionG);
    prefill.sl = est.portionLabel || '1 serving';
  }
  openFoodEditor(null, name, {
    prefill,
    forceId: aiCtx.code ? 'off:' + aiCtx.code : null,
    ai: { confidence: est.confidence, model: est.model, desc },
  });
}

/* =====================================================================
   FOODS TAB
   ===================================================================== */

function renderLibrary() {
  const q = $('#libSearch').value.trim();
  const foods = q ? searchFoods(q, 200)
    : allFoods().sort((a, b) =>
        (a.src === 'user' ? 0 : 1) - (b.src === 'user' ? 0 : 1) ||
        (a.g || '').localeCompare(b.g || '') || a.n.localeCompare(b.n));

  const list = $('#libList');
  list.innerHTML = '';
  foods.forEach(f => list.appendChild(foodRow(f, () => openFoodEditor(f))));
}

/* =====================================================================
   SETTINGS
   ===================================================================== */

function renderSettings() {
  $('#tKcal').value = state.targets.kcal;
  $('#tP').value = state.targets.p;
  $('#tC').value = state.targets.c;
  $('#tF').value = state.targets.f;
  $('#tW').value = state.targets.water;
  $('#aiKey').value = state.ai.key || '';
  $('#aiModel').value = state.ai.model || AI_DEFAULT_MODEL;
  renderAiStatus();
  checkTargetMath();
}

function renderAiStatus(msg) {
  const el = $('#aiStatus');
  if (msg) { el.textContent = msg; return; }
  const k = (state.ai.key || '').trim();
  el.textContent = k
    ? `Key saved on this device (…${k.slice(-4)}). Test it to be sure it works.`
    : 'No key saved — “Estimate with AI” will tell you to come back here.';
}

async function testAiKey() {
  if (!(state.ai.key || '').trim()) { renderAiStatus('Paste a key and tap Save first.'); return; }
  renderAiStatus('Testing…');
  $('#aiTest').disabled = true;
  try {
    const est = await aiRequest('plain boiled white rice', { timeout: 30000 });
    renderAiStatus(`Working. Test estimate for boiled rice: ${r0(est.values.kcal)} kcal/100 g `
      + `(a sane answer is roughly 120–140). Model: ${est.model}`);
  } catch (err) {
    renderAiStatus(aiErrorText(err));
  } finally {
    $('#aiTest').disabled = false;
  }
}

function checkTargetMath() {
  const k = +$('#tKcal').value, p = +$('#tP').value, c = +$('#tC').value, f = +$('#tF').value;
  const derived = p * 4 + c * 4 + f * 9;
  const diff = derived - k;
  $('#macroCheck').textContent = Math.abs(diff) < 60
    ? `Macros add up to ${r0(derived)} kcal — matches your calorie target.`
    : `Macros add up to ${r0(derived)} kcal, ${diff > 0 ? r0(diff) + ' above' : r0(-diff) + ' below'} your calorie target.`;
}

function persistTargets() {
  state.targets = {
    kcal:  Math.max(0, +$('#tKcal').value || 0),
    p:     Math.max(0, +$('#tP').value || 0),
    c:     Math.max(0, +$('#tC').value || 0),
    f:     Math.max(0, +$('#tF').value || 0),
    water: Math.max(0, +$('#tW').value || 0),
  };
  saveTargets();
  renderSummary();
  renderWater();
  toast('Targets saved');
}

function exportBackup() {
  /* The API key is deliberately left out — a backup file often gets emailed
     or synced, and a leaked key is someone else spending your credit. */
  const payload = {
    app: 'macros', version: 3, exported: new Date().toISOString(),
    targets: state.targets, foods: state.custom, entries: state.entries,
    water: state.water, names: state.names,
    ai: { model: state.ai.model },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `macros-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

function importBackup(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      if (!d || d.app !== 'macros') throw new Error('not a Macros backup');
      if (!confirm('Merge this backup into your current data?\n\nEntries and foods with the same id are replaced.')) return;

      const byId = (arr, add) => {
        const m = new Map(arr.map(x => [x.id, x]));
        (add || []).forEach(x => m.set(x.id, x));
        return Array.from(m.values());
      };
      state.custom  = byId(state.custom, d.foods);
      state.entries = byId(state.entries, d.entries);
      state.water   = byId(state.water, d.water);
      state.names   = Object.assign({}, state.names, d.names || {});
      if (d.targets) state.targets = Object.assign({}, DEFAULT_TARGETS, d.targets);
      /* Model preference travels; the key never does, so keep the local one. */
      if (d.ai && d.ai.model) state.ai.model = d.ai.model;

      saveFoods(); saveEntries(); saveWater(); saveNames(); saveTargets(); saveAi();
      renderAll(); renderLibrary(); renderSettings();
      toast('Backup imported');
    } catch (e) {
      alert('Could not read that file: ' + e.message);
    }
  };
  rd.readAsText(file);
}

/* =====================================================================
   SHEETS, TOAST, NAV
   ===================================================================== */

function setExpanded(btn, panel, open) {
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  panel.classList.toggle('hidden', !open);
}

function showSheet(sel) {
  $('#scrim').classList.remove('hidden');
  $(sel).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeSheets() {
  stopScanner();
  scanBusy = false;
  $('#scrim').classList.add('hidden');
  $('#portionSheet').classList.add('hidden');
  $('#foodSheet').classList.add('hidden');
  $('#scanSheet').classList.add('hidden');
  $('#nfSheet').classList.add('hidden');
  $('#aiSheet').classList.add('hidden');
  document.body.style.overflow = '';
}

let toastTimer = null;
function toast(msg, actionLabel, action) {
  const el = $('#toast'), btn = $('#toastAction');
  $('#toastMsg').textContent = msg;
  el.classList.remove('hidden');

  if (actionLabel) {
    btn.textContent = actionLabel;
    btn.classList.remove('hidden');
    btn.onclick = () => { action && action(); el.classList.add('hidden'); };
  } else {
    btn.classList.add('hidden');
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

function showView(name) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  window.scrollTo(0, 0);

  if (name === 'foods') renderLibrary();
  if (name === 'settings') renderSettings();
  if (name === 'add') { renderRecent(); setTimeout(() => $('#searchInput').focus(), 60); }
}

/* =====================================================================
   WIRE UP
   ===================================================================== */

function init() {
  load();
  renderAll();

  $$('.tab').forEach(t => t.onclick = () => showView(t.dataset.view));

  /* date nav */
  $('#prevDay').onclick = () => { state.date = shiftDate(state.date, -1); renderAll(); };
  $('#nextDay').onclick = () => { state.date = shiftDate(state.date, 1); renderAll(); };
  $('#datePicker').onchange = e => { if (e.target.value) { state.date = e.target.value; renderAll(); } };
  $('.datewrap').onclick = () => { const d = $('#datePicker'); d.showPicker ? d.showPicker() : d.click(); };

  /* full breakdown */
  $('#toggleTotals').onclick = () => {
    totalsOpen = !totalsOpen;
    setExpanded($('#toggleTotals'), $('#totalsMicros'), totalsOpen);
  };

  /* water */
  $$('.waterquick .chip').forEach(b => b.onclick = () => {
    const rec = addWater(+b.dataset.ml);
    if (rec) toast(`${rec.ml} ml logged`, 'Undo', () => removeWaterSilent(rec.id));
  });
  $('#waterAdd').onclick = () => {
    const rec = addWater($('#waterInput').value);
    if (rec) { $('#waterInput').value = ''; $('#waterInput').blur(); toast(`${rec.ml} ml logged`); }
  };
  $('#waterInput').onkeydown = e => { if (e.key === 'Enter') $('#waterAdd').click(); };

  /* search */
  const si = $('#searchInput');
  si.oninput = () => runSearch(si.value);
  si.onkeydown = e => { if (e.key === 'Enter') si.blur(); };
  $('#searchClear').onclick = () => { si.value = ''; runSearch(''); si.focus(); };
  $('#createFromSearch').onclick = () => openFoodEditor(null, si.value.trim());
  $('#aiFromSearch').onclick = () => openAiDescribe({ code: null, term: si.value.trim() });

  /* not-found choice + AI describe */
  $('#nfAi').onclick = () => openAiDescribe({});
  $('#nfManual').onclick = () => openFoodEditor(null, aiCtx.term || '',
    { forceId: aiCtx.code ? 'off:' + aiCtx.code : null });
  $('#nfCancel').onclick = closeSheets;
  $('#aiGo').onclick = runAiEstimate;
  $('#aiDesc').onkeydown = e => { if (e.key === 'Enter') runAiEstimate(); };
  $('#aiManualInstead').onclick = () => openFoodEditor(null, $('#aiDesc').value.trim() || aiCtx.term || '',
    { forceId: aiCtx.code ? 'off:' + aiCtx.code : null });
  $('#aiCancel').onclick = closeSheets;

  /* scanner */
  $('#scanBtn').onclick = openScanner;
  $('#scanManual').onclick = revealManualBarcode;
  $('#scanManualGo').onclick = () => {
    const code = $('#scanManualInput').value.trim();
    if (!/^\d{6,14}$/.test(code)) { toast('Enter the digits under the barcode'); return; }
    stopScanner().then(() => lookupBarcode(code));
  };
  $('#scanManualInput').onkeydown = e => { if (e.key === 'Enter') $('#scanManualGo').click(); };
  $('#scanCancel').onclick = closeSheets;

  /* portion sheet */
  $('#psGrams').oninput = previewPortion;
  $('#psMinus').onclick = () => { const i = $('#psGrams'); i.value = Math.max(0, (+i.value || 0) - 10); previewPortion(); };
  $('#psPlus').onclick  = () => { const i = $('#psGrams'); i.value = (+i.value || 0) + 10; previewPortion(); };
  $('#psMoreBtn').onclick = () => {
    psMicroOpen = !psMicroOpen;
    setExpanded($('#psMoreBtn'), $('#psMicroWrap'), psMicroOpen);
  };
  $('#psRename').onclick = showRenameRow;
  $('#psRenameSave').onclick = saveRename;
  $('#psRenameInput').onkeydown = e => { if (e.key === 'Enter') saveRename(); };
  $('#psSave').onclick = commitPortion;
  $('#psDelete').onclick = deleteEntry;
  $('#psCancel').onclick = closeSheets;
  $('#scrim').onclick = closeSheets;

  /* food editor */
  $('#newFoodBtn').onclick = () => openFoodEditor(null, $('#libSearch').value.trim());
  $('#libSearch').oninput = renderLibrary;
  ['#fKcal', '#fP', '#fC', '#fF'].forEach(s => $(s).oninput = checkFoodMath);
  $('#fsMoreBtn').onclick = () => {
    const open = $('#fsMoreBtn').getAttribute('aria-expanded') !== 'true';
    setExpanded($('#fsMoreBtn'), $('#fsMicros'), open);
  };
  $('#fsSave').onclick = saveFoodFromEditor;
  $('#fsDelete').onclick = deleteFoodFromEditor;
  $('#fsCancel').onclick = closeSheets;

  /* settings */
  ['#tKcal', '#tP', '#tC', '#tF'].forEach(s => $(s).oninput = checkTargetMath);
  $('#saveTargets').onclick = persistTargets;
  $('#resetTargets').onclick = () => { state.targets = Object.assign({}, DEFAULT_TARGETS); saveTargets(); renderSettings(); renderSummary(); renderWater(); toast('Targets reset'); };
  $('#aiSaveKey').onclick = () => {
    state.ai.key = $('#aiKey').value.trim();
    state.ai.model = $('#aiModel').value.trim() || AI_DEFAULT_MODEL;
    $('#aiModel').value = state.ai.model;
    saveAi();
    renderAiStatus(state.ai.key ? 'Saved. Tap “Test connection” to confirm it works.' : 'Key cleared.');
  };
  $('#aiTest').onclick = testAiKey;
  $('#aiClearKey').onclick = () => {
    if (!confirm('Remove the API key from this device?')) return;
    state.ai.key = '';
    saveAi();
    $('#aiKey').value = '';
    renderAiStatus('Key removed from this device.');
  };
  $('#exportBtn').onclick = exportBackup;
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; };
  $('#wipeBtn').onclick = () => {
    if (!confirm('Erase every log entry, custom food, water record and target on this device?')) return;
    if (!confirm('Really erase everything? Export a backup first if you want to keep it.')) return;
    Object.values(KEY).forEach(k => localStorage.removeItem(k));
    load(); state.date = todayStr();
    renderAll(); renderLibrary(); renderSettings();
    toast('All data erased');
  };

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });

  /* Roll the log over to the real today if the app sat open overnight. */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopScanner(); return; }
    if (state.date < todayStr()) { state.date = todayStr(); renderAll(); }
  });

  /* Offline support on the real host only. On localhost the cache-first
     worker would keep serving a stale build while editing, so skip it. */
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !isLocal) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* Undo for a water quick-add: drop it without the second confirming toast. */
function removeWaterSilent(id) {
  state.water = state.water.filter(w => w.id !== id);
  saveWater();
  renderWater();
}

init();

/* ------------------------------------------------------------------
   Macros — offline calorie/macro tracker
   Single user, no backend. Everything lives in localStorage.
   ------------------------------------------------------------------ */
'use strict';

const KEY = { set: 'ct.settings.v1', foods: 'ct.foods.v1', log: 'ct.entries.v1' };

const DEFAULT_TARGETS = { kcal: 2900, p: 130, c: 390, f: 90 };

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ------------------------------- state ------------------------------- */

const state = {
  targets: DEFAULT_TARGETS,
  custom:  [],          // user-created foods + overrides of seed foods (same id)
  entries: [],          // log rows
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
}
const saveFoods   = () => writeJSON(KEY.foods, state.custom);
const saveEntries = () => writeJSON(KEY.log, state.entries);
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
const r0   = n => Math.round(n);
const r1   = n => Math.round(n * 10) / 10;
const gfmt = n => (n >= 100 ? r0(n) : r1(n));
const clampPct = n => Math.max(0, Math.min(100, n));

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

/* =====================================================================
   RENDER
   ===================================================================== */

function renderAll() {
  renderDate();
  renderSummary();
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
  const e = {
    id: uid(), d: state.date, fid: food.id, n: food.n, g: Number(grams),
    k100: Number(food.kcal), p100: Number(food.p), c100: Number(food.c), f100: Number(food.f),
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
  }
  const f = ps.food;

  $('#psName').textContent = f.n;
  $('#psMeta').textContent =
    `Per 100 g: ${r0(f.kcal)} kcal · P ${gfmt(f.p)} · C ${gfmt(f.c)} · F ${gfmt(f.f)}`;

  const start = grams != null ? grams
    : entry ? entry.g
    : (f.u && f.u[0] ? f.u[0].g : (f.serve || 100));
  $('#psGrams').value = r0(start);

  /* Household-portion chips */
  const units = $('#psUnits');
  units.innerHTML = '';
  const opts = (f.u && f.u.length) ? f.u.slice()
    : (f.serve ? [{ l: '1 serving', g: f.serve }] : []);
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
}

function commitPortion() {
  const grams = parseFloat($('#psGrams').value);
  if (!(grams > 0)) { toast('Enter grams first'); return; }

  if (ps.mode === 'edit' && ps.entry) {
    ps.entry.g = grams;
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

/* =====================================================================
   FOOD EDITOR SHEET
   ===================================================================== */

let fsEditingId = null;

function openFoodEditor(food, presetName) {
  fsEditingId = food ? food.id : null;
  const isSeedOverride = food && SEED_FOODS.some(s => s.id === food.id);

  $('#fsTitle').textContent = food ? 'Edit food' : 'New food';
  $('#fName').value  = food ? food.n : (presetName || '');
  $('#fKcal').value  = food ? food.kcal : '';
  $('#fP').value     = food ? food.p : '';
  $('#fC').value     = food ? food.c : '';
  $('#fF').value     = food ? food.f : '';
  $('#fServe').value = food ? (food.serve || (food.u && food.u[0] ? food.u[0].g : '')) : '';

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

  const rec = {
    id: fsEditingId || 'usr:' + uid(),
    n: name,
    kcal,
    p: parseFloat($('#fP').value) || 0,
    c: parseFloat($('#fC').value) || 0,
    f: parseFloat($('#fF').value) || 0,
    src: 'user',
    g: 'My foods',
  };
  const serve = parseFloat($('#fServe').value);
  if (serve > 0) rec.serve = serve;

  const i = state.custom.findIndex(x => x.id === rec.id);
  if (i >= 0) state.custom[i] = Object.assign({}, state.custom[i], rec);
  else state.custom.push(rec);
  saveFoods();

  closeSheets();
  renderLibrary();
  toast(`${name} saved to your library`);

  /* Straight into logging it — that's why you added it. */
  if (i < 0) openPortion({ mode: 'add', food: foodById(rec.id) });
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
  const tag = f.src === 'user' ? '<span class="tag mine">mine</span>'
            : f.src === 'off'  ? '<span class="tag off">packaged</span>' : '';
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

  /* A pure number is a barcode — the product endpoint is far more reliable
     than free-text search, so type or paste the number off the packet. */
  const barcode = /^\d{8,14}$/.test(term);
  const FIELDS = 'code,product_name,brands,quantity,nutriments';
  const urls = barcode
    ? [`https://world.openfoodfacts.org/api/v2/product/${term}.json?fields=${FIELDS}`]
    : [
        'https://world.openfoodfacts.org/cgi/search.pl'
          + `?search_simple=1&action=process&json=1&page_size=12&fields=${FIELDS}`
          + '&search_terms=' + encodeURIComponent(term),
        /* Second door: the two search endpoints fail independently. */
        'https://world.openfoodfacts.org/api/v2/search'
          + `?page_size=12&fields=${FIELDS}`
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
    const items = raw.map(p => {
      const nu = p.nutriments || {};
      const kcal = nu['energy-kcal_100g'] ?? (nu['energy_100g'] ? nu['energy_100g'] / 4.184 : null);
      if (kcal == null || !p.product_name) return null;
      return {
        id: 'off:' + p.code,
        n: p.product_name.trim(),
        g: [p.brands, p.quantity].filter(Boolean).join(' · ') || 'Packaged',
        kcal: r1(kcal),
        p: r1(nu.proteins_100g || 0),
        c: r1(nu.carbohydrates_100g || 0),
        f: r1(nu.fat_100g || 0),
        src: 'off',
      };
    }).filter(Boolean).slice(0, 8);

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
    /* Keep it, so the second time it is a local hit. */
    if (!state.custom.some(x => x.id === f.id)) { state.custom.push(f); saveFoods(); }
    openPortion({ mode: 'add', food: f });
  })));
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
  checkTargetMath();
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
  const t = {
    kcal: Math.max(0, +$('#tKcal').value || 0),
    p: Math.max(0, +$('#tP').value || 0),
    c: Math.max(0, +$('#tC').value || 0),
    f: Math.max(0, +$('#tF').value || 0),
  };
  state.targets = t;
  saveTargets();
  renderSummary();
  toast('Targets saved');
}

function exportBackup() {
  const payload = {
    app: 'macros', version: 1, exported: new Date().toISOString(),
    targets: state.targets, foods: state.custom, entries: state.entries,
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
      if (d.targets) state.targets = Object.assign({}, DEFAULT_TARGETS, d.targets);

      saveFoods(); saveEntries(); saveTargets();
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

function showSheet(sel) {
  $('#scrim').classList.remove('hidden');
  $(sel).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeSheets() {
  $('#scrim').classList.add('hidden');
  $('#portionSheet').classList.add('hidden');
  $('#foodSheet').classList.add('hidden');
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

  /* search */
  const si = $('#searchInput');
  si.oninput = () => runSearch(si.value);
  si.onkeydown = e => { if (e.key === 'Enter') si.blur(); };
  $('#searchClear').onclick = () => { si.value = ''; runSearch(''); si.focus(); };
  $('#createFromSearch').onclick = () => openFoodEditor(null, si.value.trim());

  /* portion sheet */
  $('#psGrams').oninput = previewPortion;
  $('#psMinus').onclick = () => { const i = $('#psGrams'); i.value = Math.max(0, (+i.value || 0) - 10); previewPortion(); };
  $('#psPlus').onclick  = () => { const i = $('#psGrams'); i.value = (+i.value || 0) + 10; previewPortion(); };
  $('#psSave').onclick = commitPortion;
  $('#psDelete').onclick = deleteEntry;
  $('#psCancel').onclick = closeSheets;
  $('#scrim').onclick = closeSheets;

  /* food editor */
  $('#newFoodBtn').onclick = () => openFoodEditor(null, $('#libSearch').value.trim());
  $('#libSearch').oninput = renderLibrary;
  ['#fKcal', '#fP', '#fC', '#fF'].forEach(s => $(s).oninput = checkFoodMath);
  $('#fsSave').onclick = saveFoodFromEditor;
  $('#fsDelete').onclick = deleteFoodFromEditor;
  $('#fsCancel').onclick = closeSheets;

  /* settings */
  ['#tKcal', '#tP', '#tC', '#tF'].forEach(s => $(s).oninput = checkTargetMath);
  $('#saveTargets').onclick = persistTargets;
  $('#resetTargets').onclick = () => { state.targets = Object.assign({}, DEFAULT_TARGETS); saveTargets(); renderSettings(); renderSummary(); toast('Targets reset'); };
  $('#exportBtn').onclick = exportBackup;
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; };
  $('#wipeBtn').onclick = () => {
    if (!confirm('Erase every log entry, custom food and target on this device?')) return;
    if (!confirm('Really erase everything? Export a backup first if you want to keep it.')) return;
    [KEY.set, KEY.foods, KEY.log].forEach(k => localStorage.removeItem(k));
    load(); state.date = todayStr();
    renderAll(); renderLibrary(); renderSettings();
    toast('All data erased');
  };

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });

  /* Roll the log over to the real today if the app sat open overnight. */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.date < todayStr()) { state.date = todayStr(); renderAll(); }
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();

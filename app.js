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
  burn:  'ct.burn.v1',      // cumulative Apple Health readings per checkpoint
  advice:'ct.advice.v1',    // cached AI suggestion per date+reading
  feat:  'ct.features.v1',  // { burn, ai } — both off for a fresh browser
};

/* Off by default, so a shared link opens as a plain food + water tracker.
   Switching one off only hides its UI; the data stays and comes back. */
const DEFAULT_FEATURES = { burn: false, ai: false };
let features = { ...DEFAULT_FEATURES };

/* Fixed daily check-in points, matching the meal rhythm. At each one you type
   the CUMULATIVE burn Apple Health is showing; segments are derived by
   subtraction. Apple Health resets at midnight, so the 8am reading IS the
   midnight-to-8am segment with nothing to subtract. */
const CHECKPOINTS = [
  { k: 'c0800', min: 8 * 60,       label: '8:00 AM',   short: '8am' },
  { k: 'c1200', min: 12 * 60,      label: '12:00 PM',  short: '12pm' },
  { k: 'c1700', min: 17 * 60,      label: '5:00 PM',   short: '5pm' },
  { k: 'c2230', min: 22 * 60 + 30, label: '10:30 PM',  short: '10:30pm' },
];

/* Names for the four standard windows. A merged window (skipped check-in)
   falls through to a plain time range instead of a misleading name. */
const SEG_NAMES = {
  '0-480':     'Night → Morning',
  '480-720':   'Morning → Midday',
  '720-1020':  'Midday → Evening',
  '1020-1350': 'Evening → Night',
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
  burn:    [],          // { id, d, cp, cum, ts }
  advice:  {},          // "YYYY-MM-DD:cpKey" -> { text, model, ts }
  date:    todayStr(),
  weekStart: mondayOf(todayStr()),
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
  state.burn    = readJSON(KEY.burn, []);
  state.advice  = readJSON(KEY.advice, {});

  /* Must come after burn and ai are read — it decides from them.
     A browser that already has readings or a key was using these before the
     toggles existed, so keep them on rather than hiding their data. */
  const stored = readJSON(KEY.feat, null);
  features = stored
    ? Object.assign({}, DEFAULT_FEATURES, stored)
    : { burn: state.burn.length > 0, ai: !!(state.ai.key || '').trim() };
  if (!stored) saveFeatures();
}
const saveFoods   = () => writeJSON(KEY.foods, state.custom);
const saveEntries = () => writeJSON(KEY.log, state.entries);
const saveWater   = () => writeJSON(KEY.water, state.water);
const saveNames   = () => writeJSON(KEY.names, state.names);
const saveAi      = () => writeJSON(KEY.ai, state.ai);
const saveFeatures= () => writeJSON(KEY.feat, features);
const saveBurn    = () => writeJSON(KEY.burn, state.burn);
const saveAdvice  = () => writeJSON(KEY.advice, state.advice);
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
function mondayOf(str) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return shiftDate(str, -((dt.getDay() + 6) % 7));   // getDay: 0=Sun
}
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/* Minutes past midnight for a log entry. Older entries have no `tm`, so it is
   derived from when they were saved — close enough, and editable from then on. */
function entryMin(e) {
  if (typeof e.tm === 'number') return e.tm;
  const d = new Date(e.ts);
  return d.getHours() * 60 + d.getMinutes();
}
const minToHHMM = m =>
  `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
function minToPretty(m) {
  if (m <= 0) return 'Midnight';
  const h24 = Math.floor(m / 60), mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}
/* Compact clock label for tight table cells: 7:12am, 1:05pm, 12am. */
function minToShort(m) {
  if (m <= 0) return '12am';
  if (m >= 1440) return 'midnight';
  const h24 = Math.floor(m / 60), mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${h24 < 12 ? 'am' : 'pm'}`;
}
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(r0(n)).toLocaleString();

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

/* Ordered by when the food was eaten, not when it was typed in. */
const entriesFor = d => state.entries.filter(e => e.d === d)
  .sort((a, b) => entryMin(a) - entryMin(b) || a.ts - b.ts);

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

/* =====================================================================
   BURN CHECK-INS AND SEGMENTS
   ===================================================================== */

const burnFor = d => state.burn.filter(b => b.d === d);

/* Readings are free-form: one per real clock time, as many as you like.
   The four CHECKPOINTS are only reminder triggers now, not slots to fill.
   Older records were keyed to a nominal slot but already carried `min`,
   so they slot straight into this ordering. */
function readingsFor(d) {
  return burnFor(d)
    .map(b => ({ ...b, min: typeof b.min === 'number' ? b.min : 0 }))
    .sort((a, b) => a.min - b.min || a.ts - b.ts);
}

/* Cumulative, so the day's burn is simply the latest reading. */
function burnDayTotal(d) {
  const r = readingsFor(d);
  if (!r.length) return null;
  /* Highest, not last: protects the day total if a stray reading is low. */
  return Math.max(...r.map(x => x.cum));
}
const finalReadingFor = d => readingsFor(d).find(r => r.final);

/* Build the day's segments from the real times you logged at.
   A gap between readings merges into one wider window — because readings are
   cumulative, subtracting across the gap is exact, not an estimate. */
function segmentsFor(d) {
  const readings = readingsFor(d);
  const rows = entriesFor(d);
  const segs = [];
  let prevMin = 0, prevCum = 0;

  readings.forEach(r => {
    /* Which nominal reminders fell inside this window — shown so a wide
       segment explains itself. */
    const skipped = CHECKPOINTS.filter(c => c.min > prevMin && c.min < r.min);
    /* Cumulative readings only go up. The entry forms enforce that, but an
       imported backup could still carry a pair out of order — flag it rather
       than rendering a negative burn as if it were real. */
    const raw = r.cum - prevCum;
    segs.push({
      bad: raw < 0,
      from: prevMin,
      to: r.min,
      label: r.final && r.min >= 1440
        ? `${minToShort(prevMin)} – end of day`
        : `${minToShort(prevMin)} – ${minToShort(r.min)}`,
      burned: raw < 0 ? null : raw,
      missed: skipped.map(c => c.short),
      readingId: r.id,
      at: minToPretty(r.min),
      final: !!r.final,
    });
    prevMin = r.min;
    prevCum = r.cum;
  });

  /* Food eaten after the last reading has no burn figure to sit against —
     until the next reading, or yesterday's final total, fills it in. */
  const tail = rows.filter(e => entryMin(e) >= prevMin);
  if (prevMin < 1440 && tail.length) {
    segs.push({
      from: prevMin,
      to: 1441,
      label: prevMin === 0 ? 'Not yet checked in' : `After ${minToShort(prevMin)}`,
      burned: null,
      missed: [],
      tail: true,
    });
  }

  segs.forEach(sg => {
    const inSeg = rows.filter(e => { const m = entryMin(e); return m >= sg.from && m < sg.to; });
    const t = inSeg.reduce((acc, e) => {
      const mm = macrosOf(e);
      acc.kcal += mm.kcal; acc.p += mm.p;
      return acc;
    }, { kcal: 0, p: 0 });
    sg.eaten = t.kcal;
    sg.protein = t.p;
    sg.count = inSeg.length;
    sg.balance = sg.burned == null ? null : sg.eaten - sg.burned;
  });

  return segs;
}

/* One prompt, not a stack of them: if any reminder time has passed since the
   last reading, you are simply due to log your current total. */
function checkinDue(d = todayStr()) {
  if (d !== todayStr()) return null;
  const now = nowMinutes();
  const readings = readingsFor(d);
  const lastMin = readings.length ? readings[readings.length - 1].min : -1;
  const passed = CHECKPOINTS.filter(c => c.min <= now && c.min > lastMin);
  if (!passed.length) return null;
  return { since: passed[0], count: passed.length, lastMin };
}

/* Days that have readings but were never closed off with a final total. */
function daysNeedingFinal(limit = 14) {
  const out = [];
  const today = todayStr();
  for (let i = 1; i <= limit; i++) {
    const d = shiftDate(today, -i);
    const r = readingsFor(d);
    if (r.length && !r.some(x => x.final)) out.push(d);
  }
  return out;
}

function saveReading(d, min, cum, { final = false, id = null } = {}) {
  const existing = id ? state.burn.find(b => b.id === id) : null;
  if (existing) {
    existing.cum = cum;
    existing.min = min;
    existing.final = final;
    existing.ts = Date.now();
  } else {
    state.burn.push({ id: uid(), d, min, cum, ts: Date.now(), final });
  }
  saveBurn();
}
function deleteReading(id) {
  state.burn = state.burn.filter(b => b.id !== id);
  saveBurn();
}

/* A cumulative figure cannot dip below an earlier one or exceed a later one —
   that is a typo, not a reading, and it would produce negative burn. */
function readingConflict(d, min, cum, excludeId) {
  for (const r of readingsFor(d)) {
    if (r.id === excludeId) continue;
    if (r.min < min && cum < r.cum) {
      return `Lower than your ${minToPretty(r.min)} reading of ${r.cum.toLocaleString()} kcal. Cumulative totals only go up.`;
    }
    if (r.min > min && cum > r.cum) {
      return `Higher than your ${minToPretty(r.min)} reading of ${r.cum.toLocaleString()} kcal. Cumulative totals only go up.`;
    }
    if (r.min === min && !r.final) {
      return `You already have a reading at ${minToPretty(min)}. Tap it in the table to edit it.`;
    }
  }
  return null;
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

let totalsOpen = false, psMicroOpen = false, currentView = 'today';
let bannerDismissed = false;          // per session, so the nudge returns next launch
const finalDismissed = new Set();     // days skipped this session
let finalTarget = null;
let finalPending = null;   // a past day being closed off from the Week view

/* Hide or show whole features. Purely visual — nothing is deleted. */
function applyFeatures() {
  $('#burnWrap').classList.toggle('hidden', !features.burn);
  $('#aiSettingsWrap').classList.toggle('hidden', !features.ai);
  $('#aiFromSearch').classList.toggle('hidden', !features.ai);
  $('#nfAi').classList.toggle('hidden', !features.ai);
  $('#featBurn').checked = !!features.burn;
  $('#featAi').checked = !!features.ai;
  document.body.classList.toggle('no-burn', !features.burn);
  if (!features.burn) {
    $('#cpBanner').classList.add('hidden');
    $('#finalBanner').classList.add('hidden');
  }
}

function renderAll() {
  applyFeatures();
  renderDate();
  renderBanner();
  renderSummary();
  renderWater();
  renderBurn();
  renderQuick();
  renderEntries();
  renderFinalBanner();
  if (currentView === 'week') renderWeek();
}

/* The topbar arrows drive whichever view is showing: days on Today,
   whole weeks on Week. */
function renderDate() {
  const btn = $('#jumpToday');
  if (currentView === 'week') {
    const end = shiftDate(state.weekStart, 6);
    const f = str => { const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
    $('#dateLabel').textContent = `${f(state.weekStart)} \u2013 ${f(end)}`;
    btn.textContent = 'This week';
    btn.disabled = state.weekStart === mondayOf(todayStr());
    return;
  }
  $('#dateLabel').textContent = prettyDate(state.date);
  btn.textContent = 'Today';
  btn.disabled = state.date === todayStr();
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

/* --------------------------- burn & balance --------------------------- */

function renderBurn() {
  const d = state.date;
  const segs = segmentsFor(d);
  const burned = burnDayTotal(d);
  const eaten = totalsFor(d).kcal;

  const bd = $('#burnDay');
  bd.textContent = burned == null ? '—' : r0(burned).toLocaleString();
  bd.classList.toggle('none', burned == null);
  $('#eatDay').textContent = r0(eaten).toLocaleString();

  const bal = $('#balDay');
  if (burned == null) {
    bal.textContent = '—';
    bal.className = 'none';
  } else {
    const diff = eaten - burned;
    bal.textContent = signed(diff);
    /* Bulking: a surplus is the goal, a shortfall is the thing to flag. */
    bal.className = diff > 0 ? 'good' : diff < 0 ? 'warn' : '';
  }

  const body = $('#segBody');
  body.innerHTML = '';
  segs.forEach(s => {
    const tr = document.createElement('tr');
    const missed = s.bad
      ? '<span class="sm warn">reading lower than the one before it</span>'
      : s.missed.length ? `<span class="sm">${s.missed.join(' + ')} missed — merged</span>` : '';
    const balCell = s.balance == null
      ? '<span class="none">—</span>'
      : `<span class="${s.balance > 0 ? 'good' : s.balance < 0 ? 'warn' : ''}">${signed(s.balance)}</span>`;
    tr.innerHTML = `
      <td>${escapeHtml(s.label)}${missed}</td>
      <td>${s.burned == null ? '<span class="none">—</span>' : r0(s.burned).toLocaleString()}</td>
      <td>${r0(s.eaten).toLocaleString()}</td>
      <td>${balCell}</td>`;
    body.appendChild(tr);
  });

  const note = $('#burnNote');
  if (segs.some(x => x.bad)) {
    note.textContent = 'Two readings are out of order — a later one is lower than an earlier one, which cannot happen with a cumulative total. Tap the readings below and correct the wrong figure.';
  } else if (!segs.length) {
    note.textContent = 'No readings yet. Tap the button below and enter the cumulative total your fitness app is showing.';
  } else if (segs.some(s => s.tail)) {
    note.textContent = 'Food logged after your last reading has no burn figure against it yet — the next reading, or the day\u2019s final total, fills it in.';
  } else if (segs.some(s => s.missed.length)) {
    note.textContent = 'A long gap between readings shows as one wider window. Because readings are cumulative, that figure is exact, not estimated.';
  } else {
    note.textContent = 'Balance is eaten minus burned. A surplus (green) is what builds weight on a bulk; a shortfall (amber) means you ate less than you burned.';
  }

  /* One chip per reading actually taken, at its real time. */
  const chips = $('#cpChips');
  chips.innerHTML = '';
  readingsFor(d).forEach(r => {
    const b = document.createElement('button');
    b.className = 'chip done' + (r.final ? ' final' : '');
    b.innerHTML = `${r.final ? 'Final' : minToPretty(r.min)}<small>${r0(r.cum).toLocaleString()} kcal</small>`;
    b.onclick = () => openCheckin(d, r.id);
    chips.appendChild(b);
  });

  renderAdvice();
}

function renderBanner() {
  const banner = $('#cpBanner');
  const due = features.burn && state.date === todayStr() && !bannerDismissed
    ? checkinDue() : null;

  if (!due) { banner.classList.add('hidden'); return; }

  /* One prompt however many reminder times have slipped by — the reading is
     "what the app says right now", not a slot to backfill. */
  $('#bannerTitle').textContent = due.count > 1
    ? `It\u2019s past ${due.since.label} \u2014 log your current burned total`
    : `It\u2019s past ${due.since.label} \u2014 log burned calories?`;
  $('#bannerHint').innerHTML = due.count > 1
    ? `${due.count} reminder times have passed since your last reading. Just enter the <b>cumulative</b> total showing now \u2014 no need to backfill each one.`
    : 'Enter the <b>cumulative</b> total your fitness app shows right now \u2014 not the difference.';

  if (!$('#bannerCum').value) $('#bannerTime').value = minToHHMM(nowMinutes());
  $('#bannerErr').classList.add('hidden');
  banner.classList.remove('hidden');
}

function commitBannerCheckin() {
  const v = parseFloat($('#bannerCum').value);
  const err = $('#bannerErr');
  const fail = msg => { err.textContent = msg; err.classList.remove('hidden'); };

  if (!(v >= 0)) return fail('Enter the cumulative total your fitness app is showing.');
  if (v > 20000)  return fail('That looks too high for one day — check the figure.');

  const min = parseTimeInput($('#bannerTime').value);
  if (min == null) return fail('Enter the time this reading was taken.');

  const conflict = readingConflict(todayStr(), min, v, null);
  if (conflict) return fail(conflict);

  saveReading(todayStr(), min, v);
  $('#bannerCum').value = '';
  err.classList.add('hidden');
  renderAll();
  toast(`Reading at ${minToPretty(min)} saved`);
  requestAdvice(todayStr(), min);
}

/* ------------------------- yesterday's final total ------------------------- */

function renderFinalBanner() {
  const banner = $('#finalBanner');
  const pending = features.burn ? daysNeedingFinal().filter(d => !finalDismissed.has(d)) : [];

  if (!pending.length || state.date !== todayStr()) { banner.classList.add('hidden'); return; }

  finalTarget = pending[0];
  const last = readingsFor(finalTarget).slice(-1)[0];
  $('#finalTitle').textContent = `Finish ${prettyDate(finalTarget).toLowerCase()}`;
  $('#finalHint').innerHTML = `Your last reading that day was <b>${r0(last.cum).toLocaleString()} kcal</b> at ${minToPretty(last.min)}. `
    + 'Enter the final total your fitness app shows for that day and the rest of the evening fills in.';
  $('#finalErr').classList.add('hidden');
  banner.classList.remove('hidden');
}

function commitFinal() {
  const v = parseFloat($('#finalCum').value);
  const err = $('#finalErr');
  const fail = msg => { err.textContent = msg; err.classList.remove('hidden'); };
  if (!finalTarget) return;
  if (!(v >= 0)) return fail('Enter the final total for that day.');
  if (v > 20000)  return fail('That looks too high for one day — check the figure.');

  const last = readingsFor(finalTarget).slice(-1)[0];
  if (last && v < last.cum) {
    return fail(`Lower than your ${minToPretty(last.min)} reading of ${last.cum.toLocaleString()} kcal. Cumulative totals only go up.`);
  }

  /* Sits at end-of-day so the stretch from the last check-in to midnight
     stops reading "—" and gets its real burn. */
  saveReading(finalTarget, 1440, v, { final: true });
  const done = finalTarget;
  finalDismissed.add(done);
  $('#finalCum').value = '';
  finalTarget = null;
  renderAll();
  renderFinalBanner();
  toast(`${prettyDate(done)} closed off at ${r0(v).toLocaleString()} kcal`);
}

/* --------------------------------- week --------------------------------- */

function weekDays() {
  return Array.from({ length: 7 }, (_, i) => shiftDate(state.weekStart, i));
}

function renderWeek() {
  const days = weekDays();
  const body = $('#weekBody');
  const showBurn = features.burn;
  body.innerHTML = '';

  /* With burn off the table is just day / eaten / protein — the weekly food
     view is useful on its own, so the tab stays. */
  document.querySelectorAll('#view-week .burncol').forEach(el => el.classList.toggle('hidden', !showBurn));
  $('#view-week .weektop').classList.toggle('burnoff', !showBurn);
  $('#wkBurnCell').classList.toggle('hidden', !showBurn);
  $('#wkBalCell').classList.toggle('hidden', !showBurn);

  let sumB = 0, nB = 0, sumE = 0, nE = 0, sumP = 0;
  const today = todayStr();
  let needFinal = 0;

  days.forEach(d => {
    const burned = burnDayTotal(d);
    const t = totalsFor(d);
    const hasFood = entriesFor(d).length > 0;
    const open = showBurn && d < today && readingsFor(d).length && !finalReadingFor(d);
    if (open) needFinal++;
    if (burned != null) { sumB += burned; nB++; }
    if (hasFood) { sumE += t.kcal; sumP += t.p; nE++; }

    const [, , dd] = d.split('-');
    const dt = new Date(...d.split('-').map((v, i) => (i === 1 ? +v - 1 : +v)));
    const bal = burned == null ? null : t.kcal - burned;

    const tr = document.createElement('tr');
    if (d === today) tr.className = 'today';
    tr.innerHTML = `
      <td>${dt.toLocaleDateString(undefined, { weekday: 'short' })} ${+dd}${
        open ? `<button class="finishbtn" data-day="${d}">finish</button>` : ''}</td>
      <td class="burncol${showBurn ? '' : ' hidden'}">${burned == null ? '<span class="none">—</span>' : r0(burned).toLocaleString()}</td>
      <td>${hasFood ? r0(t.kcal).toLocaleString() : '<span class="none">—</span>'}</td>
      <td class="burncol${showBurn ? '' : ' hidden'}">${bal == null ? '<span class="none">—</span>'
            : `<span class="${bal > 0 ? 'good' : bal < 0 ? 'warn' : ''}">${signed(bal)}</span>`}</td>
      <td>${hasFood ? r0(t.p) + '<span class="sm">of ' + state.targets.p + '</span>'
                    : '<span class="none">—</span>'}</td>`;
    body.appendChild(tr);
  });

  /* "Complete yesterday" lives here too, so a skipped prompt is recoverable
     whenever you next check your Health app. */
  body.querySelectorAll('.finishbtn').forEach(b => {
    b.onclick = ev => {
      ev.stopPropagation();
      openCheckin(b.dataset.day, null);
      finalPending = b.dataset.day;
    };
  });

  const avgB = nB ? sumB / nB : null;
  const avgE = nE ? sumE / nE : null;
  const avgP = nE ? sumP / nE : null;
  const avgBal = (avgB != null && avgE != null) ? avgE - avgB : null;

  const tr = document.createElement('tr');
  tr.className = 'avg';
  tr.innerHTML = `
    <td>Average</td>
    <td class="burncol${showBurn ? '' : ' hidden'}">${avgB == null ? '<span class="none">—</span>' : r0(avgB).toLocaleString()}</td>
    <td>${avgE == null ? '<span class="none">—</span>' : r0(avgE).toLocaleString()}</td>
    <td class="burncol${showBurn ? '' : ' hidden'}">${avgBal == null ? '<span class="none">—</span>'
          : `<span class="${avgBal > 0 ? 'good' : 'warn'}">${signed(avgBal)}</span>`}</td>
    <td>${avgP == null ? '<span class="none">—</span>' : r0(avgP)}</td>`;
  body.appendChild(tr);

  const setTop = (id, v, cls) => {
    const el = $(id);
    el.textContent = v == null ? '—' : (cls ? signed(v) : r0(v).toLocaleString());
    el.className = v == null ? 'none' : (cls ? (v > 0 ? 'good' : v < 0 ? 'warn' : '') : '');
  };
  setTop('#wkBurn', avgB, false);
  setTop('#wkEat', avgE, false);
  setTop('#wkBal', avgBal, true);

  const note = $('#weekNote');
  if (nB === 0 && nE === 0) {
    note.textContent = 'Nothing logged this week yet.';
  } else if (needFinal) {
    note.textContent = `${needFinal} day${needFinal === 1 ? '' : 's'} still open — tap “finish” next to a day to enter its final burned total. `
      + `Averages cover the days with data; days with no entry are left out rather than counted as zero.`;
  } else {
    note.textContent = showBurn
      ? `Averages cover the days with data — ${nB} day${nB === 1 ? '' : 's'} of burn, ${nE} of food. Days with no entry are left out rather than counted as zero.`
      : `Averages cover the ${nE} day${nE === 1 ? '' : 's'} with food logged. Days with no entry are left out rather than counted as zero.`;
  }
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
        <div class="sub">${minToHHMM(entryMin(e))} · ${r0(e.g)} g · P ${gfmt(m.p)} · C ${gfmt(m.c)} · F ${gfmt(m.f)}</div>
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
    tm: nowMinutes(),        // when it was eaten; editable in the portion sheet
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

  $('#psTime').value = minToHHMM(entry ? entryMin(entry) : nowMinutes());

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

/* "HH:MM" -> minutes past midnight, or null if the field is unusable. */
function parseTimeInput(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function commitPortion() {
  const grams = parseFloat($('#psGrams').value);
  if (!(grams > 0)) { toast('Enter grams first'); return; }
  const tm = parseTimeInput($('#psTime').value);

  if (ps.mode === 'edit' && ps.entry) {
    ps.entry.g = grams;
    if (tm != null) ps.entry.tm = tm;
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
    const e = addEntry(ps.food, grams);
    if (tm != null && tm !== e.tm) { e.tm = tm; saveEntries(); }
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

/* Shared transport for both AI features: nutrition estimates and meal
   suggestions. Returns the raw assistant text plus the model that answered. */
async function aiChat(system, user, { timeout = 30000, json = false, maxTokens = 700,
                                      temperature = 0.2, reasoningEffort = null } = {}) {
  const key = (state.ai.key || '').trim();
  if (!key) { const e = new Error('nokey'); e.code = 'nokey'; throw e; }
  const model = (state.ai.model || '').trim() || AI_DEFAULT_MODEL;

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  /* gpt-oss and friends are reasoning models: they spend tokens thinking
     before they write a word of the answer. Capping effort keeps that spend
     small so the answer actually fits inside max_tokens. */
  if (reasoningEffort) body.reasoning = { effort: reasoningEffort };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  const send = withFormat => fetch(AI_ENDPOINT, {
    method: 'POST',
    signal: ctrl.signal,
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'HTTP-Referer': location.origin,
      'X-Title': 'Macros',
    },
    body: JSON.stringify(withFormat
      ? Object.assign({}, body, { response_format: { type: 'json_object' } })
      : body),
  });

  try {
    /* Not every model on OpenRouter accepts response_format, so fall back
       to plain prompting rather than failing the whole request. */
    let res = await send(json);
    if (json && (res.status === 400 || res.status === 422)) res = await send(false);

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
    aiChat.lastRaw = data;
    aiChat.lastModel = data.model || model;
    aiChat.lastFromReasoning = false;

    const choice = (data.choices && data.choices[0]) || {};
    const msg = choice.message || {};
    let text = msg.content;

    /* A reasoning model that runs out of budget mid-thought returns an empty
       content string with finish_reason "length". Falling back to the
       reasoning trace salvages an answer that would otherwise be lost. */
    if (!String(text || '').trim() && String(msg.reasoning || '').trim()) {
      text = msg.reasoning;
      aiChat.lastFromReasoning = true;
    }

    if (!String(text || '').trim()) {
      const truncated = choice.finish_reason === 'length';
      const e = new Error(truncated ? 'reply truncated before any answer' : 'empty reply');
      e.code = truncated ? 'truncated' : 'parse';
      e.raw = JSON.stringify(data, null, 2);
      e.finish = choice.finish_reason || '';
      throw e;
    }
    return text;
  } catch (err) {
    if (err.name === 'AbortError') { const e = new Error('timeout'); e.code = 'timeout'; throw e; }
    if (!err.code) err.code = /Failed to fetch|NetworkError|Load failed/i.test(err.message || '') ? 'network' : 'unknown';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function aiRequest(description, { timeout = 30000 } = {}) {
  const text = await aiChat(AI_SYSTEM, 'Food: ' + description, { timeout, json: true, maxTokens: 700 });
  const est = coerceEstimate(extractJson(text));
  if (!est) {
    const e = new Error('unparsable');
    e.code = 'parse';
    e.raw = typeof text === 'string' ? text : JSON.stringify(aiChat.lastRaw, null, 2);
    throw e;
  }
  est.model = aiChat.lastModel;
  return est;
}

function aiErrorText(err) {
  switch (err && err.code) {
    case 'nokey':   return 'No API key yet. Settings → AI estimation → paste your OpenRouter key.';
    case 'auth':    return 'OpenRouter rejected the key. Check it in Settings, or generate a new one.';
    case 'credits': return 'That key is out of credit. Add credit on openrouter.ai, or switch to a “:free” model in Settings.';
    case 'rate':    return 'Rate limited — free OpenRouter models allow only a few calls a minute. Wait a moment and try again.';
    case 'truncated': return 'The model used its whole token budget thinking and never wrote an answer. Raising the limit or lowering reasoning effort usually fixes it — try again, or pick a different model in Settings.';
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
   BURN CHECK-IN SHEET
   ===================================================================== */

let bs = { d: null, id: null };

function openCheckin(d, readingId = null) {
  const rec = readingId ? state.burn.find(b => b.id === readingId) : null;
  bs = { d, id: rec ? rec.id : null };

  $('#bsTitle').textContent = rec
    ? (rec.final ? 'Final total for the day' : `Reading at ${minToPretty(rec.min)}`)
    : 'Log a burned-calorie reading';
  $('#bsCum').value = rec ? rec.cum : '';
  $('#bsTime').value = minToHHMM(rec ? Math.min(rec.min, 1439) : nowMinutes());
  $('#bsTime').disabled = !!(rec && rec.final);
  $('#bsTimeLabel').textContent = rec && rec.final ? 'Covers through' : 'Reading taken at';
  $('#bsWarn').classList.add('hidden');
  $('#bsDelete').classList.toggle('hidden', !rec);

  /* Show what the figure will mean, so a wrong number is obvious. */
  const before = readingsFor(d).filter(r => r.id !== bs.id && r.min < (rec ? rec.min : nowMinutes())).pop();
  $('#bsContext').textContent = before
    ? `Your ${minToPretty(before.min)} reading was ${before.cum.toLocaleString()} kcal — this segment is the difference.`
    : 'No earlier reading that day, so this covers the whole stretch since midnight.';

  if (finalPending === d && !rec) {
    $('#bsTitle').textContent = `Final total for ${prettyDate(d).toLowerCase()}`;
    $('#bsTime').value = '23:59';
    $('#bsTimeLabel').textContent = 'Covers through';
    $('#bsTime').disabled = true;
  }

  showSheet('#burnSheet');
  setTimeout(() => $('#bsCum').focus(), 80);
}

function commitCheckin() {
  const v = parseFloat($('#bsCum').value);
  const warn = msg => {
    const w = $('#bsWarn');
    w.innerHTML = '<b>Check that number</b>' + escapeHtml(msg);
    w.classList.remove('hidden');
  };
  if (!(v >= 0)) { toast('Enter the cumulative total from your fitness app'); return; }
  if (v > 20000) { toast('That looks too high — check the figure'); return; }

  const rec = bs.id ? state.burn.find(b => b.id === bs.id) : null;
  const isFinal = !!(rec && rec.final) || finalPending === bs.d;
  const min = isFinal ? 1440 : parseTimeInput($('#bsTime').value);
  if (min == null) { toast('Enter the time this reading was taken'); return; }

  const conflict = readingConflict(bs.d, min, v, bs.id);
  if (conflict) { warn(conflict); return; }

  saveReading(bs.d, min, v, { final: isFinal, id: bs.id });
  if (finalPending) { finalDismissed.add(finalPending); finalPending = null; }
  closeSheets();
  renderAll();
  toast(isFinal ? 'Final total saved' : `Reading at ${minToPretty(min)} saved`);
  if (!isFinal) requestAdvice(bs.d, min);
}

function deleteCheckin() {
  const rec = bs.id ? state.burn.find(b => b.id === bs.id) : null;
  if (!rec) return;
  if (!confirm('Delete this reading?\n\nThe surrounding segments will merge.')) return;
  deleteReading(rec.id);
  closeSheets();
  renderAll();
  toast('Reading deleted', 'Undo', () => {
    state.burn.push(rec); saveBurn(); renderAll();
  });
}

/* =====================================================================
   AI MEAL SUGGESTION  (fires after a check-in, cached per checkpoint)
   ===================================================================== */

const ADVICE_SYSTEM = [
  'You are a practical nutrition coach for one person who is bulking: gaining weight and',
  'muscle on a calorie surplus. They eat South Indian and Saudi/Gulf food, halal, and work',
  '12-hour shifts.',
  '',
  'You will be given their targets, what they have eaten today, their calories burned, and',
  'a list of foods from their personal library with per-100 g values.',
  '',
  'Reply with ONE piece of advice, 1 to 2 short sentences, maximum 45 words.',
  'Rules:',
  '- Name specific foods FROM THE PROVIDED LIBRARY ONLY, with a realistic gram amount',
  '  or household portion. Never invent a food that is not on the list.',
  '- Lead with the gap that matters most: remaining protein first, then remaining calories.',
  '- If they are already over both targets, say so plainly and suggest stopping or something light.',
  '- Plain sentences. No preamble, no bullet points, no markdown, no emoji, no sign-off.',
].join('\n');

/* A compact library the model can actually ground on: my own foods first,
   then whatever I log most, then the rest — capped to keep the prompt small. */
function libraryForPrompt(limit = 55) {
  const counts = new Map(usageStats().map(s => [s.fid, s.count]));
  const scored = allFoods().map(f => ({
    f,
    rank: (f.src === 'user' ? 2000 : 0) + (counts.get(f.id) || 0) * 100 + (f.p || 0),
  }));
  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, limit)
    .map(({ f }) => `${f.n}: ${r0(f.kcal)} kcal, ${gfmt(f.p)} g protein per 100 g`)
    .join('\n');
}

function advicePrompt(d, slotMin) {
  const t = totalsFor(d);
  const burned = burnDayTotal(d);
  const rows = entriesFor(d);

  const eatenList = rows.length
    ? rows.map(e => `- ${e.n}, ${r0(e.g)} g (${r0(macrosOf(e).kcal)} kcal, ${gfmt(macrosOf(e).p)} g protein) at ${minToHHMM(entryMin(e))}`).join('\n')
    : '- nothing logged yet';

  return [
    `Time now: ${minToPretty(slotMin != null ? slotMin : nowMinutes())}.`,
    `Daily targets: ${state.targets.kcal} kcal, ${state.targets.p} g protein.`,
    `Eaten so far: ${r0(t.kcal)} kcal, ${gfmt(t.p)} g protein.`,
    `Remaining: ${r0(state.targets.kcal - t.kcal)} kcal, ${gfmt(state.targets.p - t.p)} g protein.`,
    burned != null
      ? `Burned so far (Apple Health): ${r0(burned)} kcal. Balance eaten minus burned: ${signed(t.kcal - burned)} kcal.`
      : 'Burned so far: not recorded yet.',
    '',
    'Eaten today:',
    eatenList,
    '',
    'Food library (per 100 g):',
    libraryForPrompt(),
  ].join('\n');
}

/* Keys a model might wrap prose in when it decides to answer with JSON
   despite being told not to. */
const ADVICE_KEYS = ['advice', 'suggestion', 'recommendation', 'text', 'message',
                     'answer', 'response', 'result', 'output', 'summary'];

/* Salvage a usable sentence from whatever came back: fenced blocks,
   prose-wrapped JSON, markdown bullets, stray quotes. */
function cleanAdvice(raw) {
  let t = String(raw || '').trim();
  if (!t) return '';

  const fence = t.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fence && fence[1].trim()) t = fence[1].trim();

  const obj = extractJson(t);
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const lower = {};
    Object.keys(obj).forEach(k => { lower[k.toLowerCase()] = obj[k]; });
    let picked = '';
    for (const k of ADVICE_KEYS) {
      if (typeof lower[k] === 'string' && lower[k].trim()) { picked = lower[k]; break; }
    }
    if (!picked) {
      const v = Object.values(obj).find(x => typeof x === 'string' && x.trim().length > 15);
      if (v) picked = v;
    }
    if (picked) t = picked;
  }

  return t
    .replace(/\*\*(.*?)\*\*/g, '$1')          // bold first, or the bullet
    .replace(/\*(.*?)\*/g, '$1')              // strip below eats its markers
    .replace(/^\s*(?:[#>\-\u2022]+|\d+[.)])\s*/gm, '')
    .replace(/^\s*(?:suggestion|advice|answer)\s*:\s*/i, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim()
    .slice(0, 400);
}

const adviceKey = (d, cpKey) => `${d}:${cpKey}`;
let adviceInFlight = null;

/* Auto-fires on save, but only once per checkpoint — a cached suggestion is
   reused on re-render so re-opening the app never re-bills a call. */
async function requestAdvice(d, cpKey, { force = false } = {}) {
  if (!features.ai) return;
  const key = adviceKey(d, cpKey);
  if (!force && state.advice[key]) { renderAdvice(); return; }
  if (!(state.ai.key || '').trim()) { renderAdvice(); return; }
  if (adviceInFlight === key) return;

  adviceInFlight = key;
  adviceLoading = true;
  adviceError = '';
  adviceErrorFor = key;
  renderAdvice();

  try {
    /* 160 tokens was the bug: this model reasons first, so the budget was
       gone before it wrote anything. Give it room and cap the thinking. */
    const text = await aiChat(ADVICE_SYSTEM, advicePrompt(d, cpKey), {
      maxTokens: 700, temperature: 0.4, reasoningEffort: 'low',
    });
    adviceRawText = typeof text === 'string' ? text : '';
    console.info('[Macros] advice raw response:', text, aiChat.lastRaw);

    const clean = cleanAdvice(text);
    if (!clean) {
      throw Object.assign(new Error('nothing usable in reply'),
        { code: 'parse', raw: JSON.stringify(aiChat.lastRaw, null, 2) });
    }
    state.advice[key] = {
      text: clean,
      model: aiChat.lastModel || state.ai.model,
      ts: Date.now(),
      cp: cpKey,
      fromReasoning: !!aiChat.lastFromReasoning,
    };
    saveAdvice();
    adviceError = '';
  } catch (err) {
    adviceError = aiErrorText(err);
    adviceRawText = err.raw || (aiChat.lastRaw ? JSON.stringify(aiChat.lastRaw, null, 2) : '');
    console.warn('[Macros] advice failed:', err.code, err.message, '\nraw:', adviceRawText);
  } finally {
    adviceLoading = false;
    adviceInFlight = null;
    renderAdvice();
  }
}

let adviceLoading = false, adviceError = '', adviceErrorFor = '', adviceRawText = '';

/* Show the suggestion tied to the most recent reading of the shown day.
   Keyed by clock time, so it survives edits to other readings. */
function currentAdviceSlot(d) {
  const r = readingsFor(d).filter(x => !x.final);
  return r.length ? r[r.length - 1].min : null;
}

function renderAdvice() {
  const box = $('#adviceBox');
  if (!features.ai) { box.classList.add('hidden'); return; }
  const d = state.date;
  const slot = currentAdviceSlot(d);

  if (slot == null) { box.classList.add('hidden'); return; }

  const cached = state.advice[adviceKey(d, slot)];
  const err = adviceErrorFor === adviceKey(d, slot) ? adviceError : '';
  box.classList.remove('hidden');
  box.classList.toggle('working', adviceLoading);

  const rawBtn = $('#adviceRawBtn'), rawBox = $('#adviceRaw');
  rawBtn.classList.add('hidden');
  rawBox.classList.add('hidden');

  if (adviceLoading) {
    $('#adviceText').textContent = 'Working out what to eat next…';
    $('#adviceMeta').textContent = '';
    $('#adviceAgain').classList.add('hidden');
    return;
  }
  $('#adviceAgain').classList.remove('hidden');

  /* Whenever there is a raw reply worth inspecting, offer it — that is the
     only way to report what actually came back if this misbehaves again. */
  if (adviceRawText && (err || (cached && cached.fromReasoning))) {
    rawBtn.classList.remove('hidden');
    rawBox.textContent = adviceRawText;
  }

  if (cached) {
    $('#adviceText').textContent = cached.text;
    /* A failed retry keeps the old suggestion, but must say the retry failed —
       otherwise the button looks like it did nothing. */
    $('#adviceMeta').textContent = err
      ? 'Retry failed — ' + err
      : `after ${minToPretty(slot)} · ${cached.model || ''}`
        + (cached.fromReasoning ? ' · recovered from the reasoning trace' : '');
  } else if (err) {
    $('#adviceText').textContent = err;
    $('#adviceMeta').textContent = adviceRawText ? 'The raw reply is below.' : '';
    if (adviceRawText) { rawBox.classList.remove('hidden'); rawBtn.textContent = 'Hide raw model response'; }
  } else if (!(state.ai.key || '').trim()) {
    $('#adviceText').textContent = 'Add an OpenRouter key in Settings and suggestions will appear here after each check-in.';
    $('#adviceMeta').textContent = '';
    $('#adviceAgain').classList.add('hidden');
  } else {
    $('#adviceText').textContent = 'No suggestion for this check-in yet.';
    $('#adviceMeta').textContent = '';
  }
  $('#adviceAgain').textContent = cached ? 'Suggest again' : 'Suggest';
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
    app: 'macros', version: 4, exported: new Date().toISOString(),
    targets: state.targets, foods: state.custom, entries: state.entries,
    water: state.water, names: state.names,
    burn: state.burn, advice: state.advice, features,
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
      state.burn    = byId(state.burn, d.burn);
      state.names   = Object.assign({}, state.names, d.names || {});
      if (Array.isArray(d.burn))  state.burn   = byId(state.burn, d.burn);
      if (d.advice) state.advice = Object.assign({}, state.advice, d.advice);
      if (d.features) { features = Object.assign({}, DEFAULT_FEATURES, d.features); saveFeatures(); }
      state.advice  = Object.assign({}, state.advice, d.advice || {});
      if (d.targets) state.targets = Object.assign({}, DEFAULT_TARGETS, d.targets);
      /* Model preference travels; the key never does, so keep the local one. */
      if (d.ai && d.ai.model) state.ai.model = d.ai.model;

      saveFoods(); saveEntries(); saveWater(); saveBurn(); saveNames(); saveAdvice(); saveTargets(); saveAi();
      renderAll(); renderLibrary(); renderSettings();
      toast('Backup imported');
    } catch (e) {
      alert('Could not read that file: ' + e.message);
    }
  };
  rd.readAsText(file);
}

/* =====================================================================
   CALENDAR
   ===================================================================== */

let calMonth = null;   // 'YYYY-MM' of the month on screen

/* Which days have food logged — the dot under a date. */
function daysWithData() {
  const set = new Set();
  state.entries.forEach(e => set.add(e.d));
  return set;
}

function openCalendar() {
  calMonth = state.date.slice(0, 7);
  renderCalendar();
  showSheet('#calSheet');
}

function renderCalendar() {
  const [y, m] = calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7;          // Monday-first
  const marked = daysWithData();
  const today = todayStr();

  $('#calTitle').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('#calNext').disabled = calMonth >= today.slice(0, 7);

  const dow = $('#calDow');
  dow.innerHTML = '';
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    .forEach(l => { const sp = document.createElement('span'); sp.textContent = l; dow.appendChild(sp); });

  const grid = $('#calGrid');
  grid.innerHTML = '';
  for (let i = 0; i < lead; i++) {
    const b = document.createElement('div');
    b.className = 'calcell blank';
    grid.appendChild(b);
  }
  for (let day = 1; day <= days; day++) {
    const ds = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const b = document.createElement('button');
    b.className = 'calcell'
      + (ds === state.date ? ' sel' : '')
      + (ds === today ? ' today' : '')
      + (ds > today ? ' future' : '');
    b.innerHTML = `<span>${day}</span>` + (marked.has(ds) ? '<i class="dot"></i>' : '');
    b.setAttribute('aria-label', ds + (marked.has(ds) ? ' — has entries' : ''));
    b.onclick = () => {
      state.date = ds;
      state.weekStart = mondayOf(ds);
      closeSheets();
      renderAll();
      if (currentView === 'week') renderWeek();
      toast(prettyDate(ds));
    };
    grid.appendChild(b);
  }
}

function shiftCalMonth(delta) {
  const [y, m] = calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  renderCalendar();
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
  $('#calSheet').classList.add('hidden');
  finalPending = null;
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
  currentView = name;
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  window.scrollTo(0, 0);

  renderDate();
  if (name === 'week') renderWeek();
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

  /* Date nav: a calendar for any date, and one tap back to today. No
     step arrows — a stray tap on those was how entries landed on the
     wrong day. */
  $('#openCal').onclick = openCalendar;
  $('.datewrap').onclick = openCalendar;
  $('#calPrev').onclick = () => shiftCalMonth(-1);
  $('#calNext').onclick = () => shiftCalMonth(1);
  $('#calCancel').onclick = closeSheets;
  $('#calToday').onclick = () => {
    state.date = todayStr();
    state.weekStart = mondayOf(state.date);
    closeSheets();
    renderAll();
    if (currentView === 'week') renderWeek();
  };
  $('#jumpToday').onclick = () => {
    if (currentView === 'week') { state.weekStart = mondayOf(todayStr()); renderDate(); renderWeek(); }
    else { state.date = todayStr(); renderAll(); }
  };

  /* full breakdown */
  $('#toggleTotals').onclick = () => {
    totalsOpen = !totalsOpen;
    setExpanded($('#toggleTotals'), $('#totalsMicros'), totalsOpen);
  };

  /* burn check-ins */
  $('#bsSave').onclick = commitCheckin;
  $('#bsDelete').onclick = deleteCheckin;
  $('#bsCancel').onclick = closeSheets;
  $('#bsCum').oninput = () => $('#bsWarn').classList.add('hidden');
  $('#bsCum').onkeydown = e => { if (e.key === 'Enter') commitCheckin(); };
  $('#addCheckin').onclick = () => openCheckin(state.date, null);
  $('#bannerSave').onclick = commitBannerCheckin;
  $('#bannerCum').onkeydown = e => { if (e.key === 'Enter') commitBannerCheckin(); };
  $('#bannerDismiss').onclick = () => { bannerDismissed = true; renderBanner(); };
  $('#finalSave').onclick = commitFinal;
  $('#finalCum').onkeydown = e => { if (e.key === 'Enter') commitFinal(); };
  $('#finalDismiss').onclick = () => {
    if (finalTarget) finalDismissed.add(finalTarget);
    renderFinalBanner();
  };
  $('#adviceRawBtn').onclick = () => {
    const box = $('#adviceRaw'), open = box.classList.toggle('hidden');
    $('#adviceRawBtn').textContent = open ? 'Show raw model response' : 'Hide raw model response';
  };

  /* feature toggles */
  $('#featBurn').onchange = e => {
    features.burn = e.target.checked;
    saveFeatures();
    renderAll();
    if (currentView === 'week') renderWeek();
    toast(features.burn ? 'Burn tracking on' : 'Burn tracking hidden — nothing deleted');
  };
  $('#featAi').onchange = e => {
    features.ai = e.target.checked;
    saveFeatures();
    applyFeatures();
    renderAdvice();
    toast(features.ai ? 'AI features on' : 'AI features hidden — your key is kept');
  };
  $('#adviceAgain').onclick = () => {
    const slot = currentAdviceSlot(state.date);
    if (slot) requestAdvice(state.date, slot, { force: true });
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
    if (!confirm('Erase every log entry, custom food, water record, burn check-in and target on this device?')) return;
    if (!confirm('Really erase everything? Export a backup first if you want to keep it.')) return;
    Object.values(KEY).forEach(k => localStorage.removeItem(k));
    load(); state.date = todayStr(); state.weekStart = mondayOf(state.date);
    renderAll(); renderLibrary(); renderSettings();
    toast('All data erased');
  };

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });

  /* Roll the log over to the real today if the app sat open overnight. */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopScanner(); return; }
    /* Coming back to the app is the moment to re-check the checkpoints. */
    if (state.date < todayStr()) {
      state.date = todayStr();
      state.weekStart = mondayOf(state.date);
      bannerDismissed = false;
    }
    renderAll();
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

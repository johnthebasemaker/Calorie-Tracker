/* ------------------------------------------------------------------
   Macros — offline calorie, macro and water tracker
   Single user, no backend. Everything lives in localStorage.
   ------------------------------------------------------------------ */
'use strict';

const KEY = {
  set:   'ct.settings.v1',
  prof:  'ct.profile.v1',   // body stats, goal and focus areas — all optional
  cust:  'ct.custom.v1',    // target keys edited by hand; recalculation asks first
  wx:    'ct.weather.v1',   // last good forecast, so a flight or a dead link still works
  work:  'ct.workout.v1',   // focus, custom times, and which exercises got done when
  regs:  'ct.regions.v1',   // which region libraries are switched on
  seen:  'ct.seen.v1',      // one-time nudges that have been dismissed for good
  cps:   'ct.checkins.v1',  // your own burn check-in reminder times
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
/* The times these fire at were hardcoded when check-ins were fixed slots.
   They are yours to set now — as many or as few as suit the shift you are
   actually working. These four are only what a fresh install starts with. */
const DEFAULT_CHECKPOINTS = [8 * 60, 12 * 60, 17 * 60, 22 * 60 + 30];

/* Everything downstream reads this rather than a constant: the banner, the
   alerts hub, and the "reminders you passed inside this window" labels on
   the segment table. */
function checkpoints() {
  return (state.checkins || [])
    .filter(t => typeof t.min === 'number')
    .slice()
    .sort((a, b) => a.min - b.min)
    .map(t => ({ k: t.id, min: t.min, label: minToPretty(t.min), short: minToShort(t.min) }));
}

/* OpenRouter is OpenAI-compatible and returns access-control-allow-origin: *,
   so the browser can call it directly from the Pages origin with no proxy. */
const AI_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/* OpenRouter's own free-model router. Individual ":free" slugs get pulled
   without notice — openai/gpt-oss-20b:free was the default here until it
   returned 404 "unavailable for free" and vanished from the model list.
   openrouter/free picks a currently-available free model per request based
   on the features asked for, so nothing here needs editing when one rotates
   out. It advertises response_format and structured_outputs, and the field
   in Settings still accepts any slug for pinning a specific model. */
const AI_DEFAULT_MODEL = 'openrouter/free';

/* Defaults that earlier versions shipped. A saved value matching one of
   these is a default the user never chose, so it is safe to move forward
   silently; anything else was typed deliberately and is left alone. */
const AI_RETIRED_DEFAULTS = ['openai/gpt-oss-20b:free'];

/* General reference values for a healthy adult male, not personal ones —
   Phase 3 is where these get tailored. Iron is 8 mg because that is the
   adult male RDA; 18 mg is the figure for menstruating women and would be
   the wrong bar here. Sugar is deliberately the added-sugar guideline even
   though the app can only measure total sugars — see MICROS below. */
const DEFAULT_TARGETS = {
  kcal: 2900, p: 130, c: 390, f: 90, water: 3500,
  /* sg has no target now that the split exists — total sugars is the raw
     figure the other two are worked out from, not something to hit. */
  fb: 30, sg: 0, as: 36, ns: 100, na: 2300, ch: 300, ca: 1000, fe: 8,
};

/* Extra nutrients, in display order. Stored per 100 g on the food, and
   snapshotted onto each log entry so history never shifts. A missing key
   means "not known" and renders as "—" — never as zero.

   `dir` is which way the target runs: 'max' for something to stay under,
   'min' for something to reach. `note` explains a target that needs it. */
/* `span` is the window the target is judged over. Sugar and sodium act
   acutely — blood glucose, blood pressure — so a daily figure is the useful
   one. Iron works through stores, calcium through bone turnover and dietary
   cholesterol through chronic intake, so those three are judged on a 7-day
   rolling average and a single heavy day is not a failure. */
const MICROS = [
  { k: 'fb', label: 'Fibre',        unit: 'g',  dp: 1, dir: 'min', span: 'day' },

  /* Three sugar rows, because one number was doing two jobs badly.
     `sg` is total sugars — the only figure every source reports, so it is
     what old entries hold and what a food falls back to.
     `as` is added sugar, the one that is actually worth limiting.
     `ns` is natural sugar, DERIVED as total minus added and only where both
     are known for a food; a partial day shows what it can and says so. */
  { k: 'sg', label: 'Total sugar',  unit: 'g',  dp: 1, dir: null,  span: 'day' },
  { k: 'as', label: 'Added sugar',  unit: 'g',  dp: 1, dir: 'max', span: 'day' },
  { k: 'ns', label: 'Natural sugar', unit: 'g', dp: 1, dir: 'max', span: 'day',
    tone: 'info', derived: true,
    note: 'lactose and fruit sugar — a ceiling for reference, not a limit' },

  { k: 'na', label: 'Sodium',       unit: 'mg', dp: 0, dir: 'max', span: 'day' },
  { k: 'ch', label: 'Cholesterol',  unit: 'mg', dp: 0, dir: 'max', span: 'week' },
  { k: 'ca', label: 'Calcium',      unit: 'mg', dp: 0, dir: 'min', span: 'week' },
  { k: 'fe', label: 'Iron',         unit: 'mg', dp: 1, dir: 'min', span: 'week' },
];

/* Stored on foods and snapshotted onto entries. `ns` is absent because it is
   worked out, never recorded. */
const MICRO_STORED = MICROS.filter(m => !m.derived);

/* Mean intake per day across the 7 days ending on `d`, counting only days
   with food logged. Counting empty days as zero would report a holiday as
   an iron deficiency. */
function microWeekAvg(k, d) {
  let sum = 0, days = 0, reported = 0;
  for (let i = 0; i < 7; i++) {
    const day = shiftDate(d, -i);
    if (!entriesFor(day).length) continue;
    days++;
    const t = microTotalsFor(day)[k];
    if (t.have > 0) { sum += t.sum; reported++; }
  }
  return { avg: days ? sum / days : 0, days, reported };
}

/* Where a day's figure sits against its target. Only ever called with a
   known total — an unreported nutrient has no state at all, because "no
   data" and "under the minimum" are different things. */
function microState(m, value) {
  const target = state.targets[m.k];
  if (!m.dir || !(target > 0)) return { cls: '', label: '' };

  /* An informational ceiling reports where you are without ever alarming.
     There is no health guideline saying to eat less fruit or drink less
     milk, so natural sugar never gets the treatment a real limit gets. */
  if (m.tone === 'info') {
    return value > target ? { cls: 'info', label: 'high' } : { cls: '', label: '' };
  }

  if (m.dir === 'max') {
    if (value > target) return { cls: 'over',  label: 'over' };
    if (value >= target * 0.8) return { cls: 'near', label: 'close' };
    return { cls: 'ok', label: '' };
  }
  if (value >= target) return { cls: 'ok', label: 'met' };
  if (value >= target * 0.7) return { cls: 'near', label: 'low' };
  return { cls: 'under', label: 'under' };
}

/* =====================================================================
   PERSONAL NUTRITION ENGINE

   Everything here is optional. With no profile the app keeps the generic
   adult defaults it shipped with; a profile only replaces those numbers.

   Sources, so the arithmetic can be checked rather than trusted:
   - BMR: Mifflin MD, St Jeor ST et al., Am J Clin Nutr 1990. Preferred over
     Harris-Benedict by the Academy of Nutrition and Dietetics for accuracy
     in non-obese and obese adults alike.
   - Activity multipliers: the conventional 1.2 / 1.375 / 1.55 / 1.725 / 1.9
     ladder. Only used when there is no measured burn to use instead.
   - Rate of gain: 0.25-0.5 % of bodyweight per week. Faster is mostly fat
     (Garthe et al. 2013; Slater & Phillips 2011).
   - Rate of loss: 0.5-1 % of bodyweight per week, and never below BMR.
   - Energy per kg of tissue: 7700 kcal, the standard planning figure.
   - Protein: 1.6 g/kg is where gains plateau for resistance training
     (Morton et al., Br J Sports Med 2018). 2.0-2.4 g/kg preserves lean mass
     in a deficit (Helms et al. 2014). ISSN position stand 1.4-2.0 g/kg.
   - Fat: >= 20 % of energy for endocrine function; 0.8 g/kg floor.
   - Fibre: 14 g per 1000 kcal (IOM DRI 2005).
   - Added sugar: <= 36 g/day for men (AHA 2016), and <= 10 % energy (WHO).
   - Sodium: 2300 mg CDRR (NASEM 2019), with an allowance for sweat losses.
   - Cholesterol 300 mg (legacy NCEP), calcium 1000 mg and iron 8 mg are the
     adult male RDAs (IOM). Iron is 8, not 18 — 18 is for menstruating women.
   - Water: 35 ml/kg is the usual clinical estimate, plus sweat and heat.
   ===================================================================== */

const ACTIVITY_LEVELS = [
  { k: 'sed',   mult: 1.2,   label: 'Desk work, little walking' },
  { k: 'light', mult: 1.375, label: 'On my feet some of the day' },
  { k: 'mod',   mult: 1.55,  label: 'On my feet most of the shift' },
  { k: 'high',  mult: 1.725, label: 'Physical work plus training' },
  { k: 'vhigh', mult: 1.9,   label: 'Heavy labour, training daily' },
];

/* Chips, plus the nutrition emphasis each one implies. `protein` and `kcal`
   are multipliers; the rest are absolute overrides applied as a maximum, so
   two focuses that both raise iron do not stack into a silly number. */
const FOCUS_AREAS = [
  { k: 'hair',    label: 'Hair growth',
    protein: 1.1, fe: 11, note: 'protein and iron — low ferritin is the most common dietary factor in hair shedding' },
  { k: 'skin',    label: 'Skin care',
    protein: 1.05, fb: 34, note: 'protein for collagen turnover, and fibre for gut-skin balance' },
  { k: 'healthy', label: 'General healthy body',
    fb: 34, as: 30, note: 'more fibre, less added sugar' },
  { k: 'bulk',    label: 'Full body weight gain',
    protein: 1.1, kcal: 1.0, note: 'protein raised alongside the surplus' },
  { k: 'muscle',  label: 'Specific muscle gain',
    protein: 1.25, note: 'protein toward the top of the evidence-based range' },
  { k: 'belly',   label: 'Belly fat loss',
    protein: 1.15, fb: 38, as: 25, na: 2000,
    note: 'protein and fibre for satiety, tighter sugar and sodium' },
  { k: 'fatloss', label: 'Full body fat loss',
    protein: 1.2, fb: 38, as: 25, note: 'protein high to protect muscle in a deficit' },
];

const DEFAULT_PROFILE = {
  h: null, w: null, age: null, sex: 'male',
  focusRead: '',           // the text last sent to the model, so it is not re-sent
  activity: 'mod',
  goal: 'maintain',        // gain | lose | maintain
  goalKg: null, goalWeeks: null,
  focus: [], focusText: '',
  city: '', lat: null, lon: null, cityLabel: '',
  aiFocus: null,           // what the model made of focusText
  updated: null,
};

const hasProfile = () => !!(state.profile && state.profile.h && state.profile.w && state.profile.age);

/* Mifflin-St Jeor. Sex changes the constant only; it is asked for because
   leaving it out costs about 160 kcal of accuracy, not for any other reason. */
function bmrOf(p) {
  const base = 10 * p.w + 6.25 * p.h - 5 * p.age;
  return p.sex === 'female' ? base - 161 : base + 5;
}

/* Real burn beats a guessed multiplier every time. Apple Health's figure is
   ACTIVE energy — it already excludes resting — so it adds to BMR rather
   than multiplying it. The 1.1 covers the thermic effect of food, roughly
   10 % of intake. */
function tdeeOf(p, measuredActive) {
  const bmr = bmrOf(p);
  if (measuredActive != null && measuredActive > 0) {
    return { tdee: Math.round(bmr * 1.1 + measuredActive), basis: 'measured', bmr, active: Math.round(measuredActive) };
  }
  const lvl = ACTIVITY_LEVELS.find(l => l.k === p.activity) || ACTIVITY_LEVELS[2];
  return { tdee: Math.round(bmr * lvl.mult), basis: 'estimated', bmr, active: null };
}

/* Mean active burn per day over the days that actually have a day total.
   Days with no reading are left out rather than counted as zero, which would
   drag the average down every time a check-in is missed. */
function recentActiveBurn(days = 14) {
  const vals = [];
  for (let i = 1; i <= days; i++) {
    const t = burnDayTotal(shiftDate(todayStr(), -i));
    if (t != null && t > 0) vals.push(t);
  }
  if (vals.length < 3) return null;      // too few days to mean anything
  return { avg: vals.reduce((a, b) => a + b, 0) / vals.length, days: vals.length };
}

/* Cap the ambition, then say what the honest timeline is. A surplus beyond
   ~0.5 % of bodyweight a week is mostly fat; a deficit beyond 1 % costs
   muscle, which is the opposite of the point on a gaining phase. */
function goalPlan(p) {
  if (p.goal === 'maintain' || !p.goalKg || !p.goalWeeks) {
    return { kcalDelta: 0, capped: false, weeks: null, ratePerWeek: 0 };
  }
  const wanted = Math.abs(p.goalKg) / p.goalWeeks;             // kg per week
  const maxRate = p.goal === 'gain'
    ? Math.min(0.5, p.w * 0.005)
    : Math.min(1.0, p.w * 0.010);
  const rate = Math.min(wanted, maxRate);
  const capped = wanted > maxRate + 1e-9;
  const kcal = Math.round((rate * 7700) / 7);
  return {
    kcalDelta: p.goal === 'gain' ? kcal : -kcal,
    capped, ratePerWeek: rate,
    weeks: Math.ceil(Math.abs(p.goalKg) / rate),
    wantedRate: wanted, maxRate,
  };
}

/* Merge the selected focus chips plus anything the model made of the free
   text. Multipliers compound; absolute values take the strongest single
   claim rather than stacking. */
/* Chips and free text combine — both are things you asked for. Where they
   set the same nutrient differently, the chip wins: you tapped it on purpose,
   the text was read by a model. So the model's areas are applied first and
   the chips are applied over the top. */
function focusEffects(p) {
  const chips = (p.focus || []).slice();
  const fromAi = (p.aiFocus && Array.isArray(p.aiFocus.areas) ? p.aiFocus.areas : [])
    .filter(k => !chips.includes(k));

  const eff = { protein: 1, kcal: 1, notes: [], fromText: [] };
  const MICRO_KEYS = ['fb', 'as', 'ns', 'na', 'ch', 'ca', 'fe'];
  const raises = m => m === 'fb' || m === 'ca' || m === 'fe';   // minimums go up

  /* Chips compound with each other, and so does free text with itself — two
     goals genuinely stacking is not a conflict. A conflict is a chip and the
     text both speaking to the same thing, and there the chip wins outright:
     the multiplier it sets replaces the text's rather than multiplying with
     it, and the value it sets replaces the text's value. */
  const gather = keys => {
    const g = { protein: 1, kcal: 1, micro: {}, labels: [] };
    keys.forEach(k => {
      const f = FOCUS_AREAS.find(x => x.k === k);
      if (!f) return;
      g.protein *= f.protein || 1;
      g.kcal *= f.kcal || 1;
      MICRO_KEYS.forEach(m => {
        if (f[m] == null) return;
        g.micro[m] = g.micro[m] == null ? f[m]
          : (raises(m) ? Math.max(g.micro[m], f[m]) : Math.min(g.micro[m], f[m]));
      });
      if (f.note) eff.notes.push(f.label + ': ' + f.note);
      g.labels.push(f.label);
    });
    return g;
  };

  const text = gather(fromAi);
  const chip = gather(chips);

  eff.protein = chip.protein !== 1 ? chip.protein : text.protein;
  eff.kcal    = chip.kcal    !== 1 ? chip.kcal    : text.kcal;
  MICRO_KEYS.forEach(m => {
    if (chip.micro[m] != null) eff[m] = chip.micro[m];
    else if (text.micro[m] != null) eff[m] = text.micro[m];
  });
  eff.fromText = text.labels;

  eff.protein = Math.min(eff.protein, 1.35);   // keep compounding sane
  return eff;
}

/* The whole calculation, returned with its own explanation so the numbers
   are inspectable rather than magic. */
function computeTargets(p, opts = {}) {
  const burn = opts.burn !== undefined ? opts.burn : recentActiveBurn();
  const { tdee, basis, bmr, active } = tdeeOf(p, burn && burn.avg);
  const plan = goalPlan(p);
  const eff = focusEffects(p);

  let kcal = Math.round((tdee + plan.kcalDelta) * eff.kcal);
  /* Never prescribe below resting metabolism. */
  const floor = Math.round(bmr);
  const hitFloor = kcal < floor;
  if (hitFloor) kcal = floor;

  const gPerKg = p.goal === 'lose' ? 2.2 : p.goal === 'gain' ? 1.8 : 1.6;
  const protein = Math.round(Math.min(p.w * gPerKg * eff.protein, p.w * 2.5));

  /* Fat: 25 % of energy, never under 0.8 g/kg and never under 20 % of energy. */
  const fatFloor = Math.max(p.w * 0.8, (kcal * 0.20) / 9);
  const fat = Math.round(Math.max((kcal * 0.25) / 9, fatFloor));

  /* Carbs take what is left; on any sane input this stays comfortably
     positive, but clamp at zero rather than print a negative target. */
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));

  const micro = {
    fb: Math.round(Math.min(40, Math.max(25, (kcal / 1000) * 14))),
    /* Total sugar carries no target: it is the raw figure the split is
       worked out from, not something to aim at. */
    sg: 0,
    /* Added sugar is the WHO free-sugars bar — 5 % of energy, capped at the
       AHA figure for men. Now that lactose and fruit sugar are counted
       separately this applies cleanly instead of flagging a glass of milk. */
    as: Math.round(Math.min(36, (kcal * 0.05) / 4)),
    /* Natural sugar scales loosely with intake. Informational only. */
    ns: Math.round(Math.min(130, Math.max(80, (kcal / 2900) * 100))),
    na: 2300,
    ch: 300,
    ca: 1000,
    fe: p.sex === 'female' && p.age < 51 ? 18 : 8,
  };
  /* Sweat costs sodium. A hard 2300 mg flags a shift in Gulf heat as "over"
     when the salt was simply being replaced. */
  const hot = (state.weather && state.weather.maxC >= 32) || false;
  if ((active && active > 600) || hot) micro.na = 2600;

  ['fb', 'as', 'ns', 'na', 'ch', 'ca', 'fe'].forEach(k => { if (eff[k] != null) micro[k] = eff[k]; });

  return Object.assign({
    kcal, p: protein, c: carbs, f: fat,
    water: waterTarget(p, active),
  }, micro, {
    meta: { bmr: Math.round(bmr), tdee, basis, active, burnDays: burn && burn.days,
            plan, hitFloor, gPerKg, notes: eff.notes },
  });
}

/* --------------------------- water and weather ---------------------------
   35 ml/kg is the usual clinical starting point (EFSA lands in the same
   region for men). Sweat is added from measured burn where there is any,
   then heat on top. Open-Meteo needs no key and no account and answers with
   access-control-allow-origin: *, so it works browser-direct from Pages.
   Everything is cached, and a stale forecast beats no target at all. */

const WATER_BASELINE_ML_PER_KG = 35;
const WARM_CLIMATE_FALLBACK = 4000;   // used when there is no profile at all

function waterTarget(p, activeKcal) {
  if (!p || !p.w) return WARM_CLIMATE_FALLBACK;

  let ml = p.w * WATER_BASELINE_ML_PER_KG;
  /* Roughly 600 ml per 1000 kcal of activity — sweat rates vary hugely, so
     this is a starting point, not a measurement. */
  if (activeKcal > 0) ml += (activeKcal / 1000) * 600;

  const maxC = state.weather && typeof state.weather.maxC === 'number' ? state.weather.maxC : null;
  if (maxC != null && maxC > 27) {
    /* +4 % per degree above 27 °C, capped at +50 %. A 42 °C day in Riyadh
       lands at the cap, which is the intent. */
    ml *= 1 + Math.min(0.5, (maxC - 27) * 0.04);
  } else if (maxC == null) {
    ml *= 1.15;   // no forecast: assume warm rather than temperate
  }
  return Math.round(Math.min(6000, Math.max(2500, ml)) / 50) * 50;
}

/* City in, coordinates out. Kept as a separate step from the forecast so the
   lookup happens once and the coordinates are stored on the profile. */
async function geocodeCity(name) {
  const url = 'https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&format=json&name='
    + encodeURIComponent(name.trim());
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return (data.results || []).map(r => ({
    label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude, lon: r.longitude,
  }));
}

/* One call a day is plenty for a daily maximum. The cached reading is used
   whenever the network is unavailable, which is the offline story: a target
   from yesterday's weather rather than a failure. */
async function refreshWeather({ force = false } = {}) {
  const p = state.profile;
  if (!p || p.lat == null || p.lon == null) return null;

  const today = todayStr();
  if (!force && state.weather && state.weather.d === today) return state.weather;

  try {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${p.lat}&longitude=${p.lon}`
      + '&current=temperature_2m,relative_humidity_2m&daily=temperature_2m_max'
      + '&forecast_days=1&timezone=auto';
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const w = await res.json();

    state.weather = {
      d: today,
      maxC: (w.daily && w.daily.temperature_2m_max && w.daily.temperature_2m_max[0]) ?? null,
      nowC: (w.current && w.current.temperature_2m) ?? null,
      rh:   (w.current && w.current.relative_humidity_2m) ?? null,
      place: p.cityLabel || '',
      ts: Date.now(),
    };
    saveWeather();
    return state.weather;
  } catch (err) {
    console.warn('[Macros] weather unavailable:', err.message);
    /* Keep whatever was last known. Age is shown rather than hidden. */
    return state.weather || null;
  }
}

function weatherNote() {
  if (cityPending) return 'Pick which city you meant above, and the water target will follow its forecast.';
  const w = state.weather;
  if (!w || typeof w.maxC !== 'number') {
    return hasProfile() && state.profile.lat != null
      ? 'No forecast yet — using a warm-climate assumption until one loads.'
      : 'Add your city below and the water target will follow the forecast.';
  }
  const stale = w.d !== todayStr();
  return `${w.place || 'Your city'}: ${Math.round(w.maxC)} °C high`
    + (typeof w.nowC === 'number' ? `, ${Math.round(w.nowC)} °C now` : '')
    + (stale ? ` (from ${prettyDate(w.d).toLowerCase()} — no connection since)` : '')
    + '.';
}

/* =====================================================================
   WORKOUT

   Bodyweight only, no equipment, built for 15-20 minutes between shifts.
   Circuit style: one round of every exercise, then repeat, with short rests
   — that is what keeps a session inside the time budget while still giving
   three sets of each movement.

   Durations are worked out rather than typed in, so editing a set count
   cannot leave a stale "18 min" behind: sets x reps x ~3 s per rep, plus
   the rest between sets, plus a minute to warm up.
   ===================================================================== */

const WORKOUT_FOCUS = [
  { k: 'upper',  label: 'Upper body',  blocks: ['push', 'pull'] },
  { k: 'lower',  label: 'Lower body',  blocks: ['legs'] },
  { k: 'full',   label: 'Full body',   blocks: ['push', 'legs', 'pull'] },
  { k: 'cardio', label: 'Aerobic',     blocks: ['cond'] },
  { k: 'muscle', label: 'Muscle gain', blocks: ['push', 'legs', 'pull'] },
  { k: 'loss',   label: 'Weight loss', blocks: ['cond', 'legs'] },
];

/* `hold` marks a timed exercise, where "reps" are seconds. */
const WORKOUT_BLOCKS = {
  push: { label: 'Push — chest, shoulders, triceps', ex: [
    { id: 'pushup',   name: 'Push-ups',                    sets: 3, reps: 12 },
    { id: 'pike',     name: 'Pike push-ups',               sets: 3, reps: 8 },
    { id: 'diamond',  name: 'Diamond push-ups',            sets: 3, reps: 8 },
    { id: 'decline',  name: 'Decline push-ups (feet up)',  sets: 3, reps: 10 },
  ]},
  legs: { label: 'Legs', ex: [
    { id: 'squat',    name: 'Bodyweight squats',           sets: 3, reps: 20 },
    { id: 'lunge',    name: 'Walking lunges',              sets: 3, reps: 12, note: 'each leg' },
    { id: 'bulgar',   name: 'Bulgarian split squat',       sets: 3, reps: 10, note: 'each leg' },
    { id: 'calf',     name: 'Calf raises',                 sets: 3, reps: 20 },
  ]},
  pull: { label: 'Pull — back, biceps', ex: [
    { id: 'superman', name: 'Superman hold',               sets: 3, reps: 30, hold: true },
    { id: 'snowangel',name: 'Reverse snow angels',         sets: 3, reps: 15 },
    { id: 'bagcurl',  name: 'Backpack curls',              sets: 3, reps: 12, note: 'books or bottles for weight' },
    { id: 'ytw',      name: 'Prone Y-T-W raises',          sets: 3, reps: 8,  note: 'each letter' },
  ]},
  cond: { label: 'Conditioning', ex: [
    { id: 'burpee',   name: 'Burpees',                     sets: 3, reps: 10 },
    { id: 'jumpsquat',name: 'Jump squats',                 sets: 3, reps: 15 },
    { id: 'mtclimb',  name: 'Mountain climbers',           sets: 3, reps: 30, note: 'total, alternating' },
    { id: 'plankpush',name: 'Plank-to-push-up',            sets: 3, reps: 10 },
  ]},
  core: { label: 'Core finisher', ex: [
    { id: 'plank',    name: 'Plank hold',                  sets: 3, reps: 45, hold: true },
    { id: 'legraise', name: 'Leg raises',                  sets: 3, reps: 12 },
    { id: 'bicycle',  name: 'Bicycle crunches',            sets: 3, reps: 20 },
    { id: 'twist',    name: 'Russian twists',              sets: 3, reps: 20 },
  ]},
};

const DEFAULT_WORKOUT = {
  focus: null,                    // null means "follow the profile goal"
  times: [{ id: 'w1', min: 6 * 60 }],
  log: {},                        // 'YYYY-MM-DD' -> { focus, done: [exerciseId], ts }
};

/* Phase 3's goal picks the opening focus, but only as a starting point —
   an explicit choice always wins and is remembered. */
function suggestedFocus() {
  const p = state.profile || {};
  if ((p.focus || []).includes('muscle')) return 'muscle';
  if ((p.focus || []).some(f => f === 'belly' || f === 'fatloss')) return 'loss';
  if (p.goal === 'gain') return 'muscle';
  if (p.goal === 'lose') return 'loss';
  return 'full';
}
const activeFocus = () => state.workout.focus || suggestedFocus();

/* A session is the focus blocks plus the core finisher, which runs whatever
   the focus. How many exercises come from each block is set by how many
   blocks there are, so the total stays inside the time budget: a single-block
   day can afford the full four, a three-block day cannot. */
const BLOCK_TAKE = { 1: 4, 2: 3, 3: 2, 4: 2 };
const CORE_TAKE  = { 1: 2, 2: 1, 3: 1, 4: 1 };

const SESSION_MAX_MINUTES = 20;
const SESSION_MIN_EXERCISES = 5;

function sessionFor(focusKey) {
  const f = WORKOUT_FOCUS.find(x => x.k === focusKey) || WORKOUT_FOCUS[2];
  const n = f.blocks.length;
  const blocks = f.blocks.map(bk => {
    const b = WORKOUT_BLOCKS[bk];
    return { key: bk, label: b.label, ex: b.ex.slice(0, BLOCK_TAKE[n] || 2) };
  });
  blocks.push({ key: 'core', label: WORKOUT_BLOCKS.core.label,
                ex: WORKOUT_BLOCKS.core.ex.slice(0, CORE_TAKE[n] || 1) });

  /* The counts above are a starting point, not a guarantee: a block of
     high-rep work (mountain climbers, 20-rep squats) still ran to 23 minutes.
     Trim the longest block until it fits, so changing a rep count later
     cannot quietly push a session past the time it promises. */
  let guard = 20;
  while (sessionMinutes(blocks) > SESSION_MAX_MINUTES
         && blocks.reduce((a, b) => a + b.ex.length, 0) > SESSION_MIN_EXERCISES
         && guard-- > 0) {
    const biggest = blocks
      .filter(b => b.ex.length > 1)
      .sort((a, b) => exerciseSeconds(b.ex) - exerciseSeconds(a.ex))[0];
    if (!biggest) break;
    biggest.ex.pop();
  }

  return { focus: f, blocks, minutes: sessionMinutes(blocks) };
}

const exerciseSeconds = ex => ex.reduce((sec, e) =>
  sec + (e.hold ? e.reps : e.reps * SECONDS_PER_REP) + TRANSITION_SECONDS, 0);

/* Circuit timing, which is what makes 3 sets of everything fit in the time
   available. One round of every exercise, then repeat — so the rest is a
   short transition between exercises plus a proper breather between rounds,
   not a full rest after every single set. Charging 30 s per set instead put
   every session at 23-32 minutes, well past the 15-20 this is built for. */
const ROUNDS = 3;
const TRANSITION_SECONDS = 15;   // moving between exercises
const ROUND_REST_SECONDS = 60;   // breather between rounds
const SECONDS_PER_REP = 2.5;
const WARMUP_SECONDS = 60;

function sessionMinutes(blocks) {
  const perRound = exerciseSeconds(blocks.reduce((a, b) => a.concat(b.ex), []));
  const total = WARMUP_SECONDS + perRound * ROUNDS + ROUND_REST_SECONDS * (ROUNDS - 1);
  return Math.round(total / 60);
}

const allExerciseIds = sess => sess.blocks.reduce((a, b) => a.concat(b.ex.map(e => e.id)), []);

function workoutFor(d) {
  return state.workout.log[d] || null;
}

function toggleExercise(d, id) {
  const sess = sessionFor(activeFocus());
  const rec = state.workout.log[d] || { focus: activeFocus(), done: [], ts: Date.now() };
  /* The focus is stamped on first tick and then left alone — changing focus
     mid-session should not silently rewrite what a past day says you did. */
  const i = rec.done.indexOf(id);
  if (i >= 0) rec.done.splice(i, 1); else rec.done.push(id);
  rec.ts = Date.now();

  if (!rec.done.length) delete state.workout.log[d];
  else state.workout.log[d] = rec;
  saveWorkout();
  return rec.done.length;
}

/* Done means every exercise in that day's session was ticked. */
function workoutComplete(d) {
  const rec = workoutFor(d);
  if (!rec) return false;
  const ids = allExerciseIds(sessionFor(rec.focus || activeFocus()));
  return ids.length > 0 && ids.every(id => rec.done.includes(id));
}

/* Consecutive days ending today (or yesterday, so an unfinished today does
   not read as a broken streak before the day is over). */
function workoutStreak() {
  let n = 0;
  const start = workoutComplete(todayStr()) ? 0 : 1;
  for (let i = start; i < 400; i++) {
    if (!workoutComplete(shiftDate(todayStr(), -i))) break;
    n++;
  }
  return n;
}

function workoutWeekCount() {
  let n = 0;
  for (let i = 0; i < 7; i++) if (workoutComplete(shiftDate(todayStr(), -i))) n++;
  return n;
}

/* Same pattern as the burn check-in nudge: no server, so the reminder is
   whatever the clock says next time the app is opened. */
let workoutBannerDismissed = false;

/* The 6am default time is a sensible starting point, not a commitment. A
   brand-new install should not open on "workout not done" and a badge of 1
   for a schedule nobody chose — so the reminder waits until there is some
   sign the feature is wanted: a workout ticked, or the times edited. */
function workoutEngaged() {
  return Object.keys(state.workout.log || {}).length > 0 || seenKey('workoutTimes');
}

function workoutDue() {
  if (!workoutEngaged()) return null;
  const times = (state.workout.times || []).filter(t => typeof t.min === 'number');
  if (!times.length) return null;
  if (workoutFor(todayStr())) return null;          // something already ticked today
  const now = nowMinutes();
  const passed = times.filter(t => t.min <= now).sort((a, b) => b.min - a.min);
  return passed.length ? passed[0] : null;
}

/* =====================================================================
   REGION LIBRARIES

   Five curated cuisines, independently toggleable — someone here might eat
   South Indian, Gulf and Filipino food in the same week, so these stack
   rather than being one exclusive mode.

   South Indian and Saudi/Gulf ship inside foods.js because they were the
   original library. The other three live in regions/*.json and are fetched
   the first time they are switched on, then kept in localStorage — after
   that, toggling is instant and needs no network.

   Measured, so the tradeoff is on the record: the three files together are
   7 KB gzipped, against 367 KB for the barcode scanner that already ships.
   Lazy loading is not what makes this app fast today; it is what stops the
   tenth region from being the thing that slows it down.

   Basics that belong to no cuisine — oils, drinks, protein staples — are
   never hidden by a toggle. */

const REGIONS = [
  { k: 'si',   label: 'South Indian', sub: 'Tamil Nadu and Kerala',
    builtin: true, groups: ['South Indian', 'Indian Non-Veg'] },
  { k: 'gulf', label: 'Saudi / Gulf', sub: 'kabsa, mandi, shawarma',
    builtin: true, groups: ['Saudi / Gulf'] },
  { k: 'ni',   label: 'North Indian', sub: 'dal makhani, paneer, naan',
    file: 'regions/north-indian.json' },
  { k: 'pk',   label: 'Pakistani',    sub: 'nihari, haleem, karahi',
    file: 'regions/pakistani.json' },
  { k: 'ph',   label: 'Filipino',     sub: 'adobo, sinigang, pancit',
    file: 'regions/filipino.json' },
];

const DEFAULT_REGIONS = { si: true, gulf: true, ni: false, pk: false, ph: false };

const regionCacheKey = k => 'ct.region.' + k + '.v1';
const regionOn = k => !!(state.regions && state.regions[k]);
const regionByKey = k => REGIONS.find(r => r.k === k);

/* Which toggle a built-in seed food answers to. Anything outside the mapped
   groups is a shared basic and is always shown. */
function regionOfSeed(f) {
  for (const r of REGIONS) {
    if (r.builtin && r.groups.includes(f.g)) return r.k;
  }
  return null;
}

/* Loaded region foods, keyed by region. Filled from cache or network. */
const regionFoods = {};

function regionFoodsFrom(key, payload) {
  const list = (payload && Array.isArray(payload.foods)) ? payload.foods : [];
  return list.map(f => Object.assign({}, f, {
    id: 'r:' + key + ':' + slugify(f.n),
    src: 'region',
    region: key,
  }));
}

/* Cache first, network only when there is nothing cached. A region fetched
   once works offline forever, which is the whole point of caching it. */
async function loadRegion(key) {
  if (regionFoods[key]) return regionFoods[key];

  const cached = readJSON(regionCacheKey(key), null);
  if (cached && Array.isArray(cached.foods) && cached.foods.length) {
    regionFoods[key] = regionFoodsFrom(key, cached);
    return regionFoods[key];
  }

  const meta = regionByKey(key);
  if (!meta || !meta.file) return [];

  const res = await fetch(meta.file, { cache: 'no-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const payload = await res.json();
  if (!payload || !Array.isArray(payload.foods) || !payload.foods.length) {
    throw new Error('empty region file');
  }
  writeJSON(regionCacheKey(key), payload);
  regionFoods[key] = regionFoodsFrom(key, payload);
  return regionFoods[key];
}

const regionCached = k => !!(regionFoods[k] || readJSON(regionCacheKey(k), null));

/* Warm whatever is already switched on, without blocking first paint. */
function loadEnabledRegions() {
  return Promise.all(REGIONS.filter(r => r.file && regionOn(r.k))
    .map(r => loadRegion(r.k).catch(err => {
      console.warn('[Macros] region', r.k, 'failed to load:', err.message);
    })));
}

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
  profile: { ...DEFAULT_PROFILE },
  customTargets: [],    // target keys edited by hand
  weather: null,
  burn:    [],          // { id, d, cp, cum, ts }
  advice:  {},          // "YYYY-MM-DD:cpKey" -> { text, model, ts }
  workout: { focus: null, times: [], log: {} },
  regions: { ...DEFAULT_REGIONS },
  checkins: [],
  seen:    {},
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
  migrateRetiredModel();
  state.burn    = readJSON(KEY.burn, []);
  state.advice  = readJSON(KEY.advice, {});
  /* Deep copy, not Object.assign. A shallow one leaves state.workout.log
     pointing AT the object inside DEFAULT_WORKOUT, so every tick writes into
     the default — and a data wipe, which reloads from the same default, hands
     the old history straight back. Same trap for the times array. */
  const savedWork = readJSON(KEY.work, {}) || {};
  state.regions = Object.assign({}, DEFAULT_REGIONS, readJSON(KEY.regs, {}) || {});
  state.seen    = readJSON(KEY.seen, {}) || {};

  /* Deep-copied rather than shared with the default array — the workout log
     taught that lesson the hard way. An empty saved list is respected: no
     times means no nudges, which is a legitimate choice. */
  const savedCps = readJSON(KEY.cps, null);
  state.checkins = Array.isArray(savedCps)
    ? savedCps.filter(t => t && typeof t.min === 'number').map(t => ({ id: t.id || uid(), min: t.min }))
    : DEFAULT_CHECKPOINTS.map(min => ({ id: uid(), min }));

  state.workout = {
    focus: savedWork.focus || null,
    times: Array.isArray(savedWork.times) && savedWork.times.length
      ? savedWork.times.map(t => ({ id: t.id || uid(), min: t.min }))
      : DEFAULT_WORKOUT.times.map(t => ({ ...t })),
    log: (savedWork.log && typeof savedWork.log === 'object')
      ? JSON.parse(JSON.stringify(savedWork.log)) : {},
  };
  /* focus is an array on DEFAULT_PROFILE, so a shallow merge would share it
     between the default and the live profile — same trap as the workout log. */
  const savedProf = readJSON(KEY.prof, {}) || {};
  state.profile = Object.assign({}, DEFAULT_PROFILE, savedProf, {
    focus: Array.isArray(savedProf.focus) ? savedProf.focus.slice() : [],
  });
  state.customTargets = readJSON(KEY.cust, []);
  state.weather = readJSON(KEY.wx, null);

  /* Must come after burn and ai are read — it decides from them.
     A browser that already has readings or a key was using these before the
     toggles existed, so keep them on rather than hiding their data. */
  const stored = readJSON(KEY.feat, null);
  features = stored
    ? Object.assign({}, DEFAULT_FEATURES, stored)
    : { burn: state.burn.length > 0, ai: !!(state.ai.key || '').trim() };
  if (!stored) saveFeatures();
}
/* Set when a retired default is moved forward, so the user is told once
   rather than silently having their model changed under them. */
let modelMigratedFrom = '';

function migrateRetiredModel() {
  const cur = (state.ai.model || '').trim();
  if (!cur || !AI_RETIRED_DEFAULTS.includes(cur)) return;
  state.ai.model = AI_DEFAULT_MODEL;
  modelMigratedFrom = cur;
  saveAi();
}

const saveProfile = () => writeJSON(KEY.prof, state.profile);
const saveCustomTargets = () => writeJSON(KEY.cust, state.customTargets);
const saveWeather = () => writeJSON(KEY.wx, state.weather);

const saveWorkout = () => writeJSON(KEY.work, state.workout);
const saveRegions = () => writeJSON(KEY.regs, state.regions);
const saveCheckins = () => writeJSON(KEY.cps, state.checkins);
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

  SEED_FOODS.forEach(f => {
    const r = regionOfSeed(f);
    if (r === null || regionOn(r)) map.set(f.id, f);
  });

  Object.keys(regionFoods).forEach(k => {
    if (!regionOn(k)) return;
    regionFoods[k].forEach(f => map.set(f.id, f));
  });

  /* A custom record for a food whose region is off is an override of
     something hidden, so it stays hidden too — otherwise switching a region
     off would leave behind exactly the foods you had bothered to correct.
     Your own foods (usr:) and barcode saves (off:) are never region-bound. */
  state.custom.forEach(f => {
    const owner = String(f.id).startsWith('r:') ? String(f.id).split(':')[1] : null;
    if (owner && !regionOn(owner)) return;
    map.set(f.id, Object.assign({}, map.get(f.id) || {}, f));
  });

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
  MICRO_STORED.forEach(m => {
    let sum = 0, have = 0;
    rows.forEach(e => {
      const v = e.m && e.m[m.k];
      if (typeof v === 'number') { sum += v * e.g / 100; have++; }
    });
    out[m.k] = { sum, have, total: rows.length };
  });

  /* Natural sugar only counts a food where BOTH its total and its added
     sugar are on record. Subtracting an unknown added figure would invent a
     number, and the whole point of the split is not to do that. */
  let nsSum = 0, nsHave = 0;
  rows.forEach(e => {
    const tot = e.m && e.m.sg, add = e.m && e.m.as;
    if (typeof tot !== 'number' || typeof add !== 'number') return;
    nsSum += Math.max(0, tot - add) * e.g / 100;
    nsHave++;
  });
  out.ns = { sum: nsSum, have: nsHave, total: rows.length };

  return out;
}

/* =====================================================================
   BURN CHECK-INS AND SEGMENTS
   ===================================================================== */

const burnFor = d => state.burn.filter(b => b.d === d);

/* Readings are free-form: one per real clock time, as many as you like.
   The check-in times are only reminder triggers, not slots to fill.
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
    const skipped = checkpoints().filter(c => c.min > prevMin && c.min < r.min);
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
  const passed = checkpoints().filter(c => c.min <= now && c.min > lastMin);
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
  const cpWrap = $('#cpSettingsWrap');
  if (cpWrap) cpWrap.classList.toggle('hidden', !features.burn);
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
  renderBell();
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

/* One verdict per nutrient for a day. Extracted so the Full breakdown grid
   and the alerts hub read the same numbers — recomputing the rule in two
   places is how the two ends up disagreeing with the other. */
function microVerdicts(d) {
  const totals = microTotalsFor(d);
  return MICROS.map(m => {
    const s = totals[m.k];
    const weekly = m.span === 'week';
    /* A weekly nutrient shows its 7-day average, because that is the figure
       being judged — showing today's number next to a weekly verdict would
       invite exactly the wrong arithmetic. */
    const wk = weekly ? microWeekAvg(m.k, d) : null;
    const value = weekly ? wk.avg : s.sum;
    const known = weekly ? wk.reported > 0 : s.have > 0;

    /* Any nutrient not reported by every food is a gap — including one no
       food reported at all, which an earlier check missed because it only
       looked at nutrients that had some data. That left the card showing
       "—" for calcium while the note claimed all six were reported. */
    const isPartial = !weekly && s.total > 0 && s.have < s.total;

    /* No state without data. An unreported sodium is not a low sodium, and
       colouring it green would be a lie the rest of this card avoids.

       With data missing from some foods the rule tightens: a limit can still
       be called OVER, because what is already counted exceeds it and the
       unknowns can only add more — but it can never be called fine, since a
       food that has not reported could be the one that blows it. */
    let st = known ? microState(m, value) : { cls: '', label: '' };
    if (known && isPartial && m.dir === 'max' && st.cls !== 'over') st = { cls: '', label: '' };
    if (known && isPartial && m.dir === 'min' && st.cls !== 'ok') st = { cls: '', label: '' };

    return { m, s, wk, weekly, value, known, isPartial, st, target: state.targets[m.k] };
  });
}

/* Just the ones worth telling someone about. */
const microFlags = d => microVerdicts(d)
  .filter(v => v.known && (v.st.cls === 'over' || v.st.cls === 'under'));

function renderTotalsMicros() {
  const grid = $('#totalsMicroGrid');
  grid.innerHTML = '';
  let partial = false, flagged = [];
  const totals = microTotalsFor(state.date);

  microVerdicts(state.date).forEach(v => {
    const { m, s, weekly, value, known, isPartial, st, target } = v;
    if (isPartial) partial = true;
    if (known && (st.cls === 'over' || st.cls === 'under')) flagged.push(m);

    const cell = document.createElement('div');
    cell.className = st.cls ? 'micro-' + st.cls : '';
    cell.innerHTML = `
      <b class="${known ? '' : 'none'}">${known ? microFmt(value, m) : '—'}${known ? ` <small>${m.unit}</small>` : ''}</b>
      <span>${m.label}${weekly ? ' <u>7-day</u>' : ''}${isPartial && known ? ` (${s.have}/${s.total})` : ''}</span>
      ${target > 0 ? `<em>${m.dir === 'max' ? 'max' : 'aim'} ${microFmt(target, m)}${
        weekly ? '/day' : ''}</em>` : ''}
      ${st.label ? `<i>${st.label}</i>` : ''}`;
    grid.appendChild(cell);
  });

  const note = $('#totalsMicroNote');
  const bits = [];

  if (!entriesFor(state.date).length) {
    bits.push('Log some food to see the full breakdown.');
  } else {
    if (flagged.length) {
      const over  = flagged.filter(m => m.dir === 'max').map(m => m.label.toLowerCase());
      const under = flagged.filter(m => m.dir === 'min').map(m => m.label.toLowerCase());
      if (over.length)  bits.push(`Over on ${listWords(over)}.`);
      if (under.length) bits.push(`Still short on ${listWords(under)}.`);
    }
    if (partial) {
      bits.push('A count like (3/6) means only 3 of the 6 foods logged reported that nutrient, and '
        + '"—" means none did. Where a nutrient is incomplete it is only flagged when what is '
        + 'already counted breaks the limit on its own — otherwise no verdict is given, because '
        + 'the missing foods could go either way.');
    } else {
      bits.push('Every food logged today reported every nutrient.');
    }

    /* Natural sugar is total minus added, so it needs BOTH on every food.
       Saying which foods are holding it up beats a bare dash. */
    const ns = totals.ns;
    if (ns.total > 0 && ns.have < ns.total) {
      const missing = entriesFor(state.date)
        .filter(e => !(e.m && typeof e.m.sg === 'number' && typeof e.m.as === 'number'))
        .map(e => e.n);
      bits.push(ns.have === 0
        ? 'The natural/added split needs both figures on a food, and nothing logged today has both — '
          + `so only total sugar is shown. Fill in added sugar for ${listWords(missing.slice(0, 3))}`
          + `${missing.length > 3 ? ' and others' : ''} in the Foods tab.`
        : `The natural/added split covers ${ns.have} of ${ns.total} foods today — `
          + `${listWords(missing.slice(0, 3))}${missing.length > 3 ? ' and others' : ''} `
          + 'have no added-sugar figure, so the split is partial and total sugar is the complete number.');
    }
    /* The sugar bar is an added-sugar guideline but the only data available
       is total sugars, so milk, dates and fruit all count against it. Saying
       so beats an unexplained red box on an otherwise sensible day. */
    const weeklyNames = MICROS.filter(m => m.span === 'week').map(m => m.label.toLowerCase());
    bits.push(`${listWords(weeklyNames.map(cap1))} are averaged over 7 days, not judged on one day — `
      + 'they act on the body over weeks, so a single heavy or light day is not a miss.');
    bits.push('Natural sugar has no health guideline behind it — the ceiling is there for reference, '
      + 'so it never turns red the way a real limit does.');
    bits.push(hasProfile()
      ? 'Targets are calculated from your profile.'
      : 'Targets are general adult reference values — set up My Profile in Settings for figures based on '
        + 'your own body and goal.');
  }
  note.textContent = bits.join(' ');
}

const cap1 = w => w.charAt(0).toUpperCase() + w.slice(1);
const listWords = a => a.length <= 1 ? (a[0] || '')
  : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

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
  /* Same list the bell reads. The banner adds two conditions of its own —
     it only shows on today's screen, and it honours this session's dismiss. */
  const item = state.date === todayStr() ? pendingByKey('checkin') : null;
  const due = item && !item.dismissed ? checkinDue() : null;

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
  /* Same producer; the banner shows the oldest outstanding day, the hub
     lists them all. */
  const pending = pendingItems()
    .filter(i => i.key.startsWith('final:') && !i.dismissed)
    .map(i => i.key.slice(6));

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
  MICRO_STORED.forEach(m => { if (typeof food[m.k] === 'number') micro[m.k] = food[m.k]; });

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
  $('#psArabicNote').classList.toggle('hidden', !(code && hasNonLatin(f.n)));
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
  MICRO_STORED.forEach(m => {
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
      MICRO_STORED.forEach(m => { if (typeof ps.food[m.k] === 'number') micro[m.k] = ps.food[m.k]; });
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

/* Arabic was the only script that mattered while this was barcode-only in a
   Gulf shop. Text search reaches the whole database, so a Cyrillic, Chinese,
   Thai or Hebrew name turns up just as easily and is just as unreadable here.

   Script is detectable; language is not. "Lait fermenté" and "leche
   fermentada" are Latin script and sail through this check — there is no
   honest way to spot those in a few lines of client code, so they are left
   to the Rename button rather than guessed at. */
const NON_LATIN_RE = new RegExp('[' + [
  '\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF',  // Arabic
  '\u0590-\u05FF',                                              // Hebrew
  '\u0400-\u04FF',                                              // Cyrillic
  '\u0370-\u03FF',                                              // Greek
  '\u0900-\u097F',                                              // Devanagari
  '\u0980-\u09FF',                                              // Bengali
  '\u0B80-\u0BFF',                                              // Tamil
  '\u0E00-\u0E7F',                                              // Thai
  '\u4E00-\u9FFF\u3400-\u4DBF',                               // CJK
  '\u3040-\u30FF',                                              // Kana
  '\uAC00-\uD7AF',                                              // Hangul
].join('') + ']');

const hasNonLatin = s => NON_LATIN_RE.test(String(s));
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
const FS_MICRO_IDS = { fb: '#fFb', sg: '#fSg', as: '#fAs', na: '#fNa', ch: '#fCh', ca: '#fCa', fe: '#fFe' };

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

  MICRO_STORED.forEach(m => {
    $(FS_MICRO_IDS[m.k]).value = src && typeof src[m.k] === 'number' ? src[m.k] : '';
  });

  /* AI results always open expanded — the whole point is that you check them. */
  const anyMicro = src && MICRO_STORED.some(m => typeof src[m.k] === 'number');
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

  /* Same-named food already on file: show both numbers and let you judge. */
  const xref = $('#fsXref');
  const like = opts.lookalike;
  const estKcal = src && src.kcal;
  if (fsAi && like && typeof estKcal === 'number') {
    const off = like.kcal > 0 ? Math.abs(estKcal - like.kcal) / like.kcal : 0;
    xref.textContent = `Your library already has ${like.n} at ${r0(like.kcal)} kcal per 100 g`
      + (off > 0.25 ? ` — the estimate is ${estKcal > like.kcal ? 'higher' : 'lower'}. Worth a second look.`
                    : '. The estimate is in the same range.');
    xref.classList.toggle('warnnote', off > 0.25);
    xref.classList.remove('hidden');
  } else {
    xref.classList.add('hidden');
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
  MICRO_STORED.forEach(m => {
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
            + (f.est ? '<span class="tag est" title="Estimated from a standard recipe, not a published table">EST</span>' : '')
            + (f.needsRename ? '<span class="tag rename">rename</span>' : '')
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

  /* The _en fields are crowd-entered and regularly hold Arabic anyway, so
     every candidate is script-checked rather than trusted by its field name. */
  const candidates = [p.product_name_en, p.generic_name_en, p.product_name, p.generic_name];
  const english = candidates.find(n => n && n.trim() && !hasNonLatin(n));
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

  /* OFF's added-sugars field is crowd-entered and unvalidated — there are
     live products listing 10 g added against 9.4 g total, which cannot be
     true. Anything above the total is a data error, not a number to import,
     so it is dropped and added sugar stays unknown for that food. */
  const addedRaw = nu['added-sugars_100g'];
  if (typeof addedRaw === 'number' && Number.isFinite(addedRaw) && addedRaw >= 0 && addedRaw <= 100) {
    const total = m.sg;
    if (typeof total !== 'number' || addedRaw <= total + 0.51) m.as = r1(Math.min(addedRaw, total == null ? addedRaw : total));
  }
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

  try {
    const data = await offFetchJson(offSearchUrls(term, barcode), offAbort.signal);

    const raw = barcode ? (data.product ? [data.product] : []) : (data.products || data.hits || []);
    /* Ask for far more than we show: a good half of a beverage search is
       crowd entries with no energy value at all, and offToFood drops those.
       Filtering before the slice is what stops "mirinda" coming back empty. */
    const items = raw.map(offToFood).filter(Boolean).slice(0, 8);

    offCache.set(term.toLowerCase(), items);
    paintOFF(items);
  } catch (err) {
    if (err.name === 'AbortError') return;
    status.textContent = 'unavailable';
    /* Their server being down is a different problem from the food not
       existing, and the wording has to say which — otherwise a 503 reads as
       "this drink isn't in the database". */
    empty.textContent = 'Open Food Facts did not answer — their search server is intermittently down, '
      + 'and it is nothing to do with your connection. Retry below, or use manual entry or an AI estimate.';
    empty.classList.remove('hidden');
    retry.classList.remove('hidden');
    retry.onclick = () => { offCache.delete(term.toLowerCase()); searchOFF(term); };
  }
}

/* The search endpoints on world.openfoodfacts.org share one backend, so a
   "second door" to the same host is not really a fallback — measured, they
   503 together. What does work is trying again: the failures are per-request,
   not sticky. Hence the same URL twice, spaced out. */
function offSearchUrls(term, barcode) {
  const q = encodeURIComponent(term);
  if (barcode) {
    return [{ url: `https://world.openfoodfacts.org/api/v2/product/${term}.json?fields=${OFF_FIELDS}` },
            { url: `https://world.openfoodfacts.org/api/v2/product/${term}.json?fields=${OFF_FIELDS}`, waitFirst: 800 }];
  }
  const cgi = 'https://world.openfoodfacts.org/cgi/search.pl'
    + `?search_simple=1&action=process&json=1&page_size=24&fields=${OFF_FIELDS}`
    + '&search_terms=' + q;
  return [
    /* Popularity ranking matters more than it looks: unsorted, "mountain dew"
       leads with obscure regional entries carrying no nutrition data, and the
       actual bottle never makes the visible eight. */
    { url: cgi + '&sort_by=unique_scans_n' },
    { url: `https://world.openfoodfacts.org/api/v2/search?page_size=24&fields=${OFF_FIELDS}&search_terms=${q}` },
    { url: cgi + '&sort_by=unique_scans_n', waitFirst: 900 },
  ];
}

async function offFetchJson(attempts, signal) {
  let lastErr = null;
  for (const a of attempts) {
    if (a.waitFirst) {
      await new Promise(r => setTimeout(r, a.waitFirst));
      if (signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    }
    try {
      const res = await fetch(a.url, { signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error('no response');
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
    /* The barcode path has always said this; a text search hits exactly the
       same products and deserves the same prompt. */
    if (f.needsRename) toast('No English name on file — tap Rename');
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
    const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`;
    const res = await fetch(url);

    /* 404 is the honest answer "no such barcode", not a failure — reporting
       it as "could not reach Open Food Facts" sent me hunting a network
       problem that was not there. */
    if (res.status === 404) { openNotFound({ code }); return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const data = await res.json();
    const food = data.status === 0 || !data.product ? null : offToFood(data.product);

    if (!food) {
      openNotFound({ code });
      return;
    }
    rememberOffFood(food);
    openPortion({ mode: 'add', food });
    if (food.needsRename) toast('No English name on file — tap Rename');
  } catch (err) {
    toast(err && /HTTP 5/.test(err.message || '')
      ? 'Open Food Facts is down right now'
      : 'Could not reach Open Food Facts');
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
  '- kcal is kilocalories. protein_g, carbs_g, fat_g, fiber_g are grams.',
  '  sodium_mg, cholesterol_mg, calcium_mg, iron_mg are milligrams.',
  '- total_sugar_g is ALL sugars including the lactose in dairy and the fructose in fruit.',
  '- added_sugar_g is only sugar added during making or processing: table sugar, jaggery,',
  '  honey, syrup, concentrated juice. Plain milk, plain curd, plain fruit and plain rice',
  '  are 0. Never let added_sugar_g exceed total_sugar_g.',
  '- If a food varies so much that added sugar genuinely cannot be estimated, use null for',
  '  added_sugar_g rather than guessing. null is better than a wrong number here.',
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
  ' "fiber_g":number,"total_sugar_g":number,"added_sugar_g":number|null,',
  ' "sodium_mg":number,"cholesterol_mg":number,',
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
  { to: 'sg',   min: 0, max: 100,   aliases: ['totalsugarg', 'totalsugar', 'totalsugars', 'totalsugarsg', 'sugarg', 'sugar', 'sugarsg', 'sugars'] },
  { to: 'as',   min: 0, max: 100,   aliases: ['addedsugarg', 'addedsugar', 'addedsugars', 'addedsugarsg', 'freesugars', 'freesugar'] },
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

  /* Added sugar cannot exceed total sugar. A model that says otherwise has
     contradicted itself, so the added figure is dropped rather than shown
     for confirmation as though it were a real reading. */
  if (values.as !== undefined && values.sg !== undefined && values.as > values.sg + 0.51) delete values.as;

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

/* Read the body as text first: OpenRouter's edge sometimes answers with an
   HTML page rather than JSON, and res.json() would throw that away along
   with the only clue about what went wrong. */
async function readErrorBody(res) {
  let body = '', detail = '';
  try { body = await res.text(); } catch {}
  try {
    const j = JSON.parse(body);
    detail = (j.error && (j.error.message || j.error.code)) || j.message || '';
  } catch {}
  return { body, detail };
}

function shouldRetryWithoutFormat(status, detail) {
  if (status === 400 || status === 422) return true;
  /* openrouter/free routes per request, so "no free model supports structured
     outputs right now" is a 404 rather than a 400. Same remedy: ask in prose. */
  return status === 404
    && /structured|response_format|json.?schema|no endpoints/i.test(String(detail || ''));
}

/* OpenRouter's wording when a free slug is pulled, as reported from the live
   app: "This model is unavailable for free. The paid version is available
   now - use this slug instead: openai/gpt-oss-20b."
   Not reproducible here — OpenRouter checks the key before the model slug,
   so without a valid key every request 401s first. Matched loosely on the
   distinctive phrases rather than the exact sentence. */
function retiredModelInfo(status, detail) {
  if (status !== 404) return null;
  const text = String(detail || '');
  if (!/unavailable for free|no longer free|use this slug instead/i.test(text)) return null;
  const m = text.match(/use this slug instead:\s*([A-Za-z0-9._\/:-]+)/i);
  return { paidSlug: m ? m[1].replace(/[.,]+$/, '') : '' };
}

/* Put the setting back on the router that cannot be retired. Returns whether
   anything actually changed, so the message can say so. */
function healRetiredModel(failed) {
  if ((state.ai.model || '').trim() === AI_DEFAULT_MODEL) return false;
  state.ai.model = AI_DEFAULT_MODEL;
  saveAi();
  syncModelField();
  console.warn('[Macros] model', failed, 'is no longer free — switched to', AI_DEFAULT_MODEL);
  return true;
}

/* Only the model row, not the whole settings form — the user may be part-way
   through editing a target when this fires. */
function syncModelField() {
  const el = $('#aiModel');
  if (el) el.value = state.ai.model;
}

/* Shared transport for both AI features: nutrition estimates and meal
   suggestions. Returns the raw assistant text plus the model that answered. */
/* One automatic retry on timeout. Under openrouter/free a timeout usually
   means the router landed on a slow model, and the retry is a fresh roll
   rather than the same model being asked to hurry — so retrying beats
   raising the limit and making every real failure take twice as long. */
async function aiChat(system, user, opts = {}) {
  if (!opts.noRetry) aiChat.retriedAfterTimeout = false;
  try {
    return await aiChatOnce(system, user, opts);
  } catch (err) {
    if (err.code !== 'timeout' || opts.noRetry) throw err;
    console.warn('[Macros] timed out after %ds — retrying once', err.seconds);
    aiChat.retriedAfterTimeout = true;
    return aiChatOnce(system, user, Object.assign({}, opts, { noRetry: true }));
  }
}

async function aiChatOnce(system, user, { timeout = 30000, json = false, maxTokens = 700,
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

  aiChat.lastDroppedFormat = false;

  try {
    let res = await send(json);
    let info = res.ok ? null : await readErrorBody(res);

    /* Not every model accepts response_format, and openrouter/free can route
       to one that does not — drop the strict format and ask in plain prose,
       which the lenient parsers downstream are built to handle. */
    if (info && json && shouldRetryWithoutFormat(res.status, info.detail)) {
      res = await send(false);
      info = res.ok ? null : await readErrorBody(res);
      aiChat.lastDroppedFormat = true;
    }

    if (info) {
      const { body, detail } = info;
      const retired = retiredModelInfo(res.status, detail);

      const e = new Error(detail || ('HTTP ' + res.status));
      if (retired) {
        /* A free slug that has been pulled. Move the setting forward rather
           than leaving the user to work out what a 404 means. */
        e.code = 'retired';
        e.retiredModel = model;
        e.paidSlug = retired.paidSlug;
        e.switched = healRetiredModel(model);
      } else {
        e.code = res.status === 401 || res.status === 403 ? 'auth'
               : res.status === 402 ? 'credits'
               : res.status === 429 ? 'rate'
               : res.status === 400 || res.status === 404 ? 'badreq'
               : res.status >= 500 ? 'upstream'
               : 'http';
      }
      e.status = res.status;
      e.detail = detail;
      e.retryAfter = res.headers.get('retry-after') || '';
      e.raw = `HTTP ${res.status} ${res.statusText}\n\n` + (body || '(empty body)').slice(0, 3000);
      throw e;
    }

    const data = await res.json();
    aiChat.lastRaw = data;
    aiChat.lastModel = data.model || model;

    const choice = (data.choices && data.choices[0]) || {};
    const msg = choice.message || {};
    const text = msg.content;

    /* `reasoning` is the model's internal monologue and is NEVER an answer.
       An earlier version fell back to it when content came back empty, which
       was defensible while one specific reasoning model was pinned. Under
       openrouter/free, where a different model answers each call, it meant
       "We need to give ONE piece of advice... Current Status: Time: 5:36 PM"
       being shown as the suggestion. Kept on the object for the debug view
       only. */
    aiChat.lastReasoning = String(msg.reasoning || '');

    if (!String(text || '').trim()) {
      const truncated = choice.finish_reason === 'length';
      const e = new Error(truncated
        ? (aiChat.lastReasoning ? 'model spent the whole budget thinking' : 'reply truncated before any answer')
        : 'empty reply');
      e.code = truncated ? 'truncated' : 'parse';
      e.raw = JSON.stringify(data, null, 2);
      e.finish = choice.finish_reason || '';
      throw e;
    }
    return text;
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('timeout');
      e.code = 'timeout';
      e.seconds = Math.max(1, Math.round(timeout / 1000));
      throw e;
    }
    if (!err.code) {
      err.code = /Failed to fetch|NetworkError|Load failed/i.test(err.message || '')
        ? await classifyNetworkFailure() : 'unknown';
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* A fetch that never completes throws the identical "Failed to fetch" whether
   the phone is offline, a blocker ate the request, or OpenRouter answered
   without CORS headers (which is how their edge rate-limiter shows up in a
   browser). Probing a public CORS-enabled endpoint separates those, so the
   message can say what actually happened instead of blaming the connection. */
async function classifyNetworkFailure() {
  if (navigator.onLine === false) return 'offline';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models?limit=1',
      { signal: ctrl.signal, cache: 'no-store' });
    /* Any answer at all means the host is up and CORS is fine from here, so
       the failed call was refused rather than unreachable. */
    return r ? 'blocked' : 'network';
  } catch {
    return 'network';
  } finally {
    clearTimeout(t);
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

/* Say what actually failed. Every branch that has one carries the HTTP status
   and OpenRouter's own words, because "check your connection" sent me looking
   at the wrong thing for a rate limit. */
function aiErrorText(err) {
  const code = err && err.code;
  const said = err && err.detail ? ' OpenRouter said: “' + err.detail + '”.' : '';
  const status = err && err.status ? ' (HTTP ' + err.status + ')' : '';

  switch (code) {
    case 'nokey':
      return 'No API key yet. Settings → AI estimation → paste your OpenRouter key.';
    case 'auth':
      return 'OpenRouter rejected the key' + status + '.' + said
        + ' Check it in Settings, or generate a new one.';
    case 'credits':
      return 'That key is out of credit' + status + '.' + said
        + ' Add credit on openrouter.ai, or switch to a “:free” model in Settings.';
    case 'rate':
      return 'Rate limited by OpenRouter' + status + '.'
        + (err.retryAfter ? ' Try again in ' + err.retryAfter + ' seconds.'
                          : ' Free models allow only a few calls a minute, and a limited number a day.')
        + said;
    case 'retired':
      return 'Your selected model, ' + (err.retiredModel || 'the saved one') + ', is no longer free'
        + (err.switched ? ' — switched to ' + AI_DEFAULT_MODEL + '. Try again.'
                        : '. Set the model in Settings to ' + AI_DEFAULT_MODEL + '.')
        + (err.paidSlug ? ' (A paid version, ' + err.paidSlug + ', is still available if you add credit.)' : '');
    case 'badreq':
      return 'OpenRouter refused the request' + status + '.' + said
        + ' The model id in Settings is the usual cause — check it is spelled exactly as on openrouter.ai.';
    case 'upstream':
      return 'OpenRouter or the model provider had a server error' + status + '.' + said
        + ' Not your key or your connection — wait a moment and try again.';
    case 'http':
      return 'OpenRouter returned an unexpected response' + status + '.' + said;

    case 'offline':
      return 'This device is offline — the request never left the phone. Reconnect and try again.';
    case 'blocked':
      return 'openrouter.ai is reachable from here, but this request came back with nothing. '
        + 'That is almost always the free-tier rate limit, or a VPN / content blocker filtering the API. '
        + 'Wait a minute and try again.';
    case 'network':
      return 'Could not reach openrouter.ai at all — the server never answered. '
        + 'Check your connection, VPN, or any content blocker.';

    case 'timeout': {
      const secs = (err && err.seconds) || 30;
      return 'Timed out twice — ' + secs + (secs === 1 ? ' second' : ' seconds')
        + ' each, once on a retry. openrouter/free is routing to a slow model right now; '
        + 'try again in a moment, or pin a faster model in Settings.';
    }
    case 'truncated':
      return 'The model spent its whole token budget thinking and never wrote an answer. '
        + 'openrouter/free picks a different model each time, so trying again usually lands on one that answers.';
    case 'messy':
      return 'Couldn’t get a clean suggestion that round — tap Suggest to retry.';
    case 'parse':
      return 'The model replied with something unreadable. Try again, or use a different model in Settings.';
    default:
      return 'Failed: ' + ((err && err.message) || 'unknown error') + '.';
  }
}

/* ------------------------------ the flow ------------------------------ */

let aiCtx = { code: null, term: '' };   // what we are estimating for
let aiInFlight = false;
/* Bumped by every dismiss. A request that comes back after its sheet was
   cancelled compares generations and drops its result instead of yanking a
   sheet back open under the user. */
let aiGen = 0;
let aiRawText = '';                     // last failed reply, for the debug view

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
  resetRawToggle('#aiRawBtn', '#aiRaw');
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

  const gen = ++aiGen;
  const ctx = { code: aiCtx.code, term: aiCtx.term };
  aiInFlight = true;
  $('#aiGo').disabled = true;
  $('#aiError').classList.add('hidden');
  resetRawToggle('#aiRawBtn', '#aiRaw');
  $('#aiLoading').classList.remove('hidden');
  $('#aiLoadingMsg').textContent = 'Asking the model…';

  try {
    const est = await aiRequest(desc);
    if (gen !== aiGen) return;          // cancelled while the model was thinking
    aiCtx = ctx;
    openEstimateConfirm(est, desc);
  } catch (err) {
    if (gen !== aiGen) return;
    $('#aiLoading').classList.add('hidden');
    const box = $('#aiError');
    box.innerHTML = '<b>Could not estimate</b>' + escapeHtml(aiErrorText(err));
    box.classList.remove('hidden');
    aiRawText = err.raw || (aiChat.lastRaw ? JSON.stringify(aiChat.lastRaw, null, 2) : '');
    console.warn('[Macros] estimate failed:', err.code, err.message, '\nraw:', aiRawText);
    if (aiRawText) {
      $('#aiRaw').textContent = aiRawText;
      $('#aiRawBtn').classList.remove('hidden');   // collapsed until asked for
    }
    $('#aiGo').disabled = false;
  } finally {
    if (gen === aiGen) aiInFlight = false;
  }
}

/* A narrow cross-check: only an all-but-exact name match counts.

   Fuzzy matching was the tempting version and the wrong one — "mutton
   biryani" against "chicken biryani" is a genuinely different dish that can
   differ by 100 kcal, so a warning there is noise. What this catches is the
   case that actually bites: estimating something already in the library and
   getting a number nowhere near what is on file.

   It is shown as context, never as a block. The estimate may well be the
   better number; the point is that you get to see both. */
function libraryLookalike(name) {
  const key = slugify(String(name || ''));
  if (key.length < 4) return null;
  return allFoods().find(f => slugify(f.n) === key
    || slugify(f.n).replace(/-/g, '') === key.replace(/-/g, '')) || null;
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
    lookalike: libraryLookalike(name),
    /* No closeSheets() first: showSheet swaps the sheet over, and closing
       here would clear the state openFoodEditor is about to read. */
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
  '- Strongly prefer the foods marked as ones they actually eat. Advice built from what is',
  '  already in their rotation gets followed; advice naming something they have never eaten',
  '  usually does not. Only reach past that list if nothing in it fits the gap.',
  '- Lead with the gap that matters most: remaining protein first, then remaining calories.',
  '- You are also given fibre, sugar, sodium, cholesterol, calcium and iron for the day. If one is',
  '  clearly OVER a limit or well under a minimum, work it into the same sentence by choosing a food',
  '  that helps — dal or vegetables for fibre, curd or milk for calcium. Do not list them or add a',
  '  second piece of advice about them.',
  '- Sugar is split. ADDED sugar is the one to limit. NATURAL sugar is the lactose in milk and',
  '  the sugar in fruit and dates; it has no health limit, so never discourage milk, curd, fruit',
  '  or dates on account of it, and never mention total sugar as a problem.',
  '- A nutrient marked "not reported" is missing data, not a deficiency. Never tell them they are low',
  '  on something no food reported.',
  '- If they are already over both targets, say so plainly and suggest stopping or something light.',
  '- Plain sentences. No preamble, no bullet points, no markdown, no emoji, no sign-off.',
  '- Do not think out loud, restate the question, or explain your reasoning. Output the advice only.',
].join('\n');

/* Worth a second roll of the router's dice; anything else is a real fault. */
const ADVICE_RETRYABLE = ['truncated', 'parse', 'upstream'];

/* Said only on the retry, when the first answer came back as monologue. */
const ADVICE_RETRY_NUDGE = [
  '',
  'IMPORTANT: your previous answer was rejected for being too long or for showing your',
  'working. Reply with the final advice sentence and nothing else — no analysis, no labels,',
  'no preamble, under 45 words.',
].join('\n');

/* A compact library the model can actually ground on: my own foods first,
   then whatever I log most, then the rest — capped to keep the prompt small. */
/* What the model is allowed to name.

   allFoods() is already filtered by the region toggles, so a suggestion can
   never reach for a Filipino dish while that region is switched off — the
   grounding falls out of Phase 5 rather than being bolted on.

   Two lists rather than one, because "add 150 g chicken biryani" from
   something eaten twice a week lands very differently from the same sentence
   about a seed food never once logged. Foods with real history are named as
   such so the model can prefer them. */
function libraryForPrompt(limit = 55) {
  const stats = usageStats();
  const counts = new Map(stats.map(s => [s.fid, s.count]));
  const lastAte = new Map(stats.map(s => [s.fid, s.lastTs]));

  const line = f => `${f.n}: ${r0(f.kcal)} kcal, ${gfmt(f.p)} g protein per 100 g`;

  const foods = allFoods();
  const eaten = foods
    .filter(f => counts.get(f.id))
    .sort((a, b) => (counts.get(b.id) - counts.get(a.id))
                 || (lastAte.get(b.id) - lastAte.get(a.id)));

  const rest = foods
    .filter(f => !counts.get(f.id))
    .map(f => ({ f, rank: (f.src === 'user' ? 2000 : 0) + (f.p || 0) }))
    .sort((a, b) => b.rank - a.rank)
    .map(x => x.f);

  /* Usuals get most of the budget, but never the whole of it — a day already
     over on everything needs a food that is not on the usual rotation. */
  const usuals = eaten.slice(0, Math.min(eaten.length, Math.round(limit * 0.6)));
  const others = rest.slice(0, limit - usuals.length);

  const parts = [];
  if (usuals.length) {
    parts.push('Foods they actually eat, most often first — PREFER THESE:');
    parts.push(usuals.map(f => '- ' + line(f)).join('\n'));
    parts.push('');
  }
  parts.push(usuals.length
    ? 'Also in their library (regions they have switched on), if nothing above fits:'
    : 'Their library (regions they have switched on):');
  parts.push(others.map(f => '- ' + line(f)).join('\n'));
  return parts.join('\n');
}

function advicePrompt(d, slotMin) {
  const t = totalsFor(d);
  const burned = burnDayTotal(d);
  const rows = entriesFor(d);

  const eatenList = rows.length
    ? rows.map(e => `- ${e.n}, ${r0(e.g)} g (${r0(macrosOf(e).kcal)} kcal, ${gfmt(macrosOf(e).p)} g protein) at ${minToHHMM(entryMin(e))}`).join('\n')
    : '- nothing logged yet';

  /* The model does better when it knows who it is advising and why the
     targets are what they are — "gaining, muscle focus" changes what a
     sensible 300 remaining calories looks like. */
  const p = state.profile;
  const who = hasProfile()
    ? `About them: ${p.age}, ${p.sex}, ${p.h} cm, ${p.w} kg. Goal: ${
        p.goal === 'gain' ? 'gaining weight' : p.goal === 'lose' ? 'losing weight' : 'maintaining'}.`
      + (p.focus && p.focus.length
          ? ` Focus areas: ${p.focus.map(k => (FOCUS_AREAS.find(f => f.k === k) || {}).label).filter(Boolean).join(', ')}.`
          : '')
    : '';

  return [
    who,
    `Time now: ${minToPretty(slotMin != null ? slotMin : nowMinutes())}.`,
    `Daily targets: ${state.targets.kcal} kcal, ${state.targets.p} g protein.`,
    `Eaten so far: ${r0(t.kcal)} kcal, ${gfmt(t.p)} g protein.`,
    `Remaining: ${r0(state.targets.kcal - t.kcal)} kcal, ${gfmt(state.targets.p - t.p)} g protein.`,
    burned != null
      ? `Burned so far (Apple Health): ${r0(burned)} kcal. Balance eaten minus burned: ${signed(t.kcal - burned)} kcal.`
      : 'Burned so far: not recorded yet.',
    '',
    hasProfile()
      ? 'Other nutrients so far today (against targets calculated for them):'
      : 'Other nutrients so far today (against general adult targets):',
    microLinesForPrompt(d),
    '',
    'Eaten today:',
    eatenList,
    '',
    'Food library (per 100 g):',
    libraryForPrompt(),
  ].join('\n');
}

/* One line per nutrient, spelling out the direction and the state so the
   model does not have to infer whether 2600 mg of sodium is good or bad.
   Nutrients nothing reported are said to be unknown rather than shown as
   zero, otherwise the model reads a quiet day as a deficiency. */
function microLinesForPrompt(d) {
  const totals = microTotalsFor(d);
  return MICROS.map(m => {
    const s = totals[m.k], target = state.targets[m.k];
    const weekly = m.span === 'week';
    const wk = weekly ? microWeekAvg(m.k, d) : null;
    const value = weekly ? wk.avg : s.sum;
    const known = weekly ? wk.reported > 0 : s.have > 0;

    const aim = target > 0
      ? ` (${m.dir === 'max' ? 'stay under' : 'aim for at least'} ${microFmt(target, m)} ${m.unit}${
          weekly ? ' a day, judged on a 7-day average' : ''})`
      : '';
    if (!known) return `- ${m.label}: not reported by any food logged${aim}`;

    const st = microState(m, value);
    const verdict = !target ? ''
      : st.cls === 'over'  ? ' — OVER the limit'
      : st.cls === 'under' ? ' — well under the minimum'
      : st.cls === 'near'  ? (m.dir === 'max' ? ' — close to the limit' : ' — a little short')
      : m.dir === 'max' ? ' — fine' : ' — target met';
    const partial = !weekly && s.have < s.total
      ? `, from only ${s.have} of ${s.total} foods so the real figure is higher` : '';
    const label = weekly ? `${m.label} (7-day average)` : m.label;
    return `- ${label}: ${microFmt(value, m)} ${m.unit}${aim}${verdict}${partial}`;
  }).join('\n');
}

/* ------------------ keeping the monologue off the screen ------------------

   openrouter/free routes to a different model each call, and several of them
   think out loud. Three shapes turn up:

     a) a separate `reasoning` field   — dropped in aiChat, never gets here
     b) <think>…</think> around it     — cut out below
     c) no separation at all, just the monologue then the answer

   (c) is the one that leaked. There is no marker to split on, so the text is
   read line by line and the tell-tale lines are dropped: restating the task,
   narrating a plan, and the "Label: value" scratchpad these models write. */

const THINK_BLOCKS = [
  /<think>[\s\S]*?<\/think>/gi,
  /<thinking>[\s\S]*?<\/thinking>/gi,
  /<reasoning>[\s\S]*?<\/reasoning>/gi,
  /<scratchpad>[\s\S]*?<\/scratchpad>/gi,
];

/* gpt-oss "harmony" wire format:
     <|channel|>analysis<|message|>THOUGHT<|end|>…<|channel|>final<|message|>ANSWER
   The final channel is the answer, so take what follows the last one. With no
   final channel the whole thing is analysis and the analysis span is cut. */
const HARMONY_FINAL = /<\|channel\|>final<\|message\|>/gi;
const HARMONY_ANALYSIS = /<\|channel\|>analysis<\|message\|>[\s\S]*?(?=<\||$)/gi;
const HARMONY_TOKEN = /<\|[^|>]*\|>/g;

function stripHarmony(t) {
  if (!/<\|/.test(t)) return t;
  let last = null, m;
  HARMONY_FINAL.lastIndex = 0;
  while ((m = HARMONY_FINAL.exec(t)) !== null) last = m.index + m[0].length;
  if (last != null) t = t.slice(last);
  else t = t.replace(HARMONY_ANALYSIS, ' ');
  return t.replace(HARMONY_TOKEN, ' ');
}

/* An unclosed opening tag means the model was cut off mid-thought: everything
   from the tag on is monologue, so drop the tail rather than show it. */
const THINK_OPEN = /<(?:think|thinking|reasoning|scratchpad)>[\s\S]*$/i;

/* Lines that are the model talking to itself, not to the user. */
const MONOLOGUE_LINE = new RegExp([
  '^(?:we|i)\\s+(?:need|should|must|have|will|can|could)\\b',
  '^(?:let\'?s|let me)\\b',
  '^the user\\b',
  '^they\\s+(?:want|need|are|have)\\b',
  '^(?:okay|ok|alright|right|so|now|first|next|then|finally|hmm)\\b[,:]',
  '^(?:looking at|based on|given|considering|according to)\\b',
  '^(?:step|point|option)\\s*\\d+\\b',
  '^\\d+\\s*[.)]\\s',
  '^[A-Z][A-Za-z /-]{2,28}:\\s*\\S',          // "Current Status:", "Time:", "Analysis:"
  '^(?:analysis|reasoning|thinking|thought|plan|draft|notes?)\\b',
].join('|'), 'i');

/* Where a model marks its own answer. Anything before the last one is thought. */
const FINAL_MARKER = /(?:^|\n)\s*(?:final answer|final|answer|response|suggestion|advice|output)\s*[:\-–]\s*/gi;

function stripReasoning(raw) {
  let t = stripHarmony(String(raw || ''));
  THINK_BLOCKS.forEach(re => { t = t.replace(re, ' '); });
  t = t.replace(THINK_OPEN, ' ');

  /* If it labelled its answer, take what follows the last such label. */
  let last = null, m;
  FINAL_MARKER.lastIndex = 0;
  while ((m = FINAL_MARKER.exec(t)) !== null) last = m.index + m[0].length;
  if (last != null && t.slice(last).trim().length > 12) t = t.slice(last);

  const kept = t.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !MONOLOGUE_LINE.test(l));

  /* Everything looked like monologue — fall back to the raw text and let the
     length check reject it, rather than returning a confident empty string. */
  return (kept.length ? kept.join(' ') : t).trim();
}

/* The 45-word rule is in the prompt, but a prompt is a request, not a
   guarantee. Checked here so a messy answer is retried instead of shown. */
const ADVICE_MAX_WORDS = 50;

function adviceLooksClean(t) {
  const s = String(t || '').trim();
  if (s.length < 12) return { ok: false, why: 'too short' };

  const words = s.split(/\s+/).length;
  if (words > ADVICE_MAX_WORDS) return { ok: false, why: `${words} words, over the ${ADVICE_MAX_WORDS} limit` };

  /* A colon-label or a bullet that survived the strip means structure, and
     structure means it is not the one-or-two sentences that were asked for. */
  if (/^[A-Z][A-Za-z /-]{2,28}:\s/.test(s)) return { ok: false, why: 'starts with a label' };
  if (/[•]|(?:^|\s)\d+\s*[.)]\s/.test(s)) return { ok: false, why: 'contains a list' };
  if (MONOLOGUE_LINE.test(s)) return { ok: false, why: 'still reads as internal monologue' };
  if (/\b(?:the user|we need to|let me|i should|as an ai)\b/i.test(s)) return { ok: false, why: 'talks about the user in the third person' };

  const sentences = s.split(/[.!?]+\s/).filter(x => x.trim().length > 3);
  if (sentences.length > 3) return { ok: false, why: `${sentences.length} sentences` };

  return { ok: true, why: '' };
}

/* Keys a model might wrap prose in when it decides to answer with JSON
   despite being told not to. */
const ADVICE_KEYS = ['advice', 'suggestion', 'recommendation', 'text', 'message',
                     'answer', 'response', 'result', 'output', 'summary'];

/* Salvage a usable sentence from whatever came back: fenced blocks,
   prose-wrapped JSON, markdown bullets, stray quotes. */
function cleanAdvice(raw) {
  let t = stripReasoning(String(raw || ''));
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
    /* Two attempts. openrouter/free picks a different model per call, so a
       second try is a genuinely different roll of the dice rather than the
       same model repeating itself — and the second attempt says so more
       bluntly in the prompt. 700 tokens because these models reason first;
       160 once left the budget spent before a word was written. */
    let clean = '', lastWhy = '', lastErr = null;
    for (let attempt = 0; attempt < 2 && !clean; attempt++) {
      const system = attempt === 0 ? ADVICE_SYSTEM : ADVICE_SYSTEM + '\n' + ADVICE_RETRY_NUDGE;
      let text = '';
      try {
        text = await aiChat(system, advicePrompt(d, cpKey), {
          maxTokens: 700, temperature: attempt === 0 ? 0.4 : 0.2, reasoningEffort: 'low',
        });
      } catch (err) {
        /* A reply that ran out of budget mid-thought is a bad round, not a
           broken setup — and the router picks a different model next time,
           so it is worth one more roll. A rejected key or a rate limit is
           not, and rethrows immediately. */
        if (!ADVICE_RETRYABLE.includes(err.code) || attempt === 1) throw err;
        lastErr = err;
        lastWhy = err.message;
        console.warn('[Macros] advice attempt 1 failed (%s) — retrying', err.code);
        continue;
      }

      adviceRawText = typeof text === 'string' ? text : '';
      console.info('[Macros] advice raw response (attempt %d):', attempt + 1, text, aiChat.lastRaw);

      const candidate = cleanAdvice(text);
      const verdict = candidate ? adviceLooksClean(candidate) : { ok: false, why: 'nothing usable in reply' };
      if (verdict.ok) { clean = candidate; break; }

      lastWhy = verdict.why;
      lastErr = null;
      console.warn('[Macros] advice attempt %d rejected: %s —', attempt + 1, verdict.why, candidate);
    }

    if (!clean) {
      if (lastErr) throw lastErr;
      throw Object.assign(new Error(lastWhy || 'nothing usable in reply'),
        { code: 'messy', why: lastWhy, raw: JSON.stringify(aiChat.lastRaw, null, 2) });
    }
    state.advice[key] = {
      text: clean,
      model: aiChat.lastModel || state.ai.model,
      ts: Date.now(),
      cp: cpKey,
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

  /* The raw JSON is a debugging aid, not the headline: the toggle is offered
     whenever there is something to look at, but the box always starts shut. */
  const rawBtn = $('#adviceRawBtn'), rawBox = $('#adviceRaw');
  resetRawToggle('#adviceRawBtn', '#adviceRaw');

  if (adviceLoading) {
    $('#adviceText').textContent = 'Working out what to eat next…';
    $('#adviceMeta').textContent = '';
    $('#adviceAgain').classList.add('hidden');
    return;
  }
  $('#adviceAgain').classList.remove('hidden');

  /* Whenever there is a raw reply worth inspecting, offer it — that is the
     only way to report what actually came back if this misbehaves again. */
  if (adviceRawText && err) {
    rawBtn.classList.remove('hidden');
    rawBox.textContent = adviceRawText;
  }

  if (cached) {
    $('#adviceText').textContent = cached.text;
    /* A failed retry keeps the old suggestion, but must say the retry failed —
       otherwise the button looks like it did nothing. */
    $('#adviceMeta').textContent = err
      ? 'Retry failed — ' + err
      : `after ${minToPretty(slot)} · ${cached.model || ''}`;
  } else if (err) {
    $('#adviceText').textContent = err;
    $('#adviceMeta').textContent = adviceRawText ? 'Tap below to see what the model actually sent.' : '';
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
   PROFILE UI
   ===================================================================== */

const TARGET_FIELDS = { kcal: '#tKcal', p: '#tP', c: '#tC', f: '#tF', water: '#tW' };
const ALL_TARGET_KEYS = ['kcal', 'p', 'c', 'f', 'water', 'fb', 'sg', 'as', 'ns', 'na', 'ch', 'ca', 'fe'];
const TARGET_LABELS = {
  kcal: 'Calories', p: 'Protein', c: 'Carbs', f: 'Fat', water: 'Water',
  fb: 'Fibre', sg: 'Sugar', na: 'Sodium', ch: 'Cholesterol', ca: 'Calcium', fe: 'Iron',
};
const TARGET_UNITS = { kcal: 'kcal', p: 'g', c: 'g', f: 'g', water: 'ml',
                       fb: 'g', sg: 'g', na: 'mg', ch: 'mg', ca: 'mg', fe: 'mg' };

const fieldFor = k => TARGET_FIELDS[k] || MICRO_TARGET_IDS[k];
const isCustom = k => state.customTargets.includes(k);

function renderProfile() {
  const p = state.profile;
  $('#pfH').value = p.h ?? '';
  $('#pfW').value = p.w ?? '';
  $('#pfAge').value = p.age ?? '';
  $('#pfSex').value = p.sex || 'male';
  $('#pfGoal').value = p.goal || 'maintain';
  $('#pfGoalKg').value = p.goalKg ?? '';
  $('#pfGoalWeeks').value = p.goalWeeks ?? '';
  $('#pfFocusText').value = p.focusText || '';
  $('#pfCity').value = p.city || '';

  const act = $('#pfActivity');
  if (!act.options.length) {
    ACTIVITY_LEVELS.forEach(l => {
      const o = document.createElement('option');
      o.value = l.k; o.textContent = l.label;
      act.appendChild(o);
    });
  }
  act.value = p.activity || 'mod';

  const chips = $('#pfFocus');
  chips.innerHTML = '';
  FOCUS_AREAS.forEach(f => {
    const b = document.createElement('button');
    b.className = 'chip' + ((p.focus || []).includes(f.k) ? ' on' : '');
    b.textContent = f.label;
    b.onclick = () => {
      const cur = state.profile.focus || [];
      state.profile.focus = cur.includes(f.k) ? cur.filter(x => x !== f.k) : cur.concat(f.k);
      renderProfile();
    };
    chips.appendChild(b);
  });

  $('#pfGoalRow').classList.toggle('hidden', p.goal === 'maintain');
  renderGoalNote();
  renderBurnNote();
  if (!cityPending) $('#pfWeather').textContent = weatherNote();
  /* An unreadable goal gets said out loud rather than quietly dropped —
     otherwise you would be left thinking it had been taken into account. */
  const note = $('#pfFocusNote');
  const af = p.aiFocus;
  note.classList.toggle('warnnote', !!(af && af.unmapped));
  note.textContent = af && af.note
    ? (af.unmapped ? 'Couldn’t read that: ' + af.note : 'From what you wrote: ' + af.note)
    : (p.focusText ? 'Saved. It will be read the next time targets are calculated.' : '');
  renderProfileSummary();
}

function renderBurnNote() {
  const burn = recentActiveBurn();
  $('#pfBurnNote').textContent = burn
    ? `Using your real burn instead: ${r0(burn.avg).toLocaleString()} kcal a day on average `
      + `across the last ${burn.days} days with readings. The dropdown above is ignored while that data exists.`
    : 'Once you have three days of burn check-ins, your real average replaces this estimate.';
}

function renderGoalNote() {
  const p = state.profile;
  const el = $('#pfGoalNote');
  if (p.goal === 'maintain') { el.textContent = 'Targets will sit at your maintenance calories.'; return; }
  if (!p.w || !p.goalKg || !p.goalWeeks) { el.textContent = ''; return; }

  const plan = goalPlan(p);
  el.textContent = plan.capped
    ? `${p.goalKg} kg in ${p.goalWeeks} weeks means ${plan.wantedRate.toFixed(2)} kg a week, which is faster than is `
      + `useful — ${p.goal === 'gain' ? 'the extra is mostly fat' : 'that rate costs muscle'}. `
      + `Capped at ${plan.ratePerWeek.toFixed(2)} kg a week (${signed(plan.kcalDelta)} kcal a day), `
      + `which reaches ${p.goalKg} kg in about ${plan.weeks} weeks.`
    : `${plan.ratePerWeek.toFixed(2)} kg a week — ${signed(plan.kcalDelta)} kcal a day. That is inside the safe range.`;
}

function renderProfileSummary() {
  const el = $('#pfSummary');
  if (!hasProfile()) { el.textContent = 'Height, weight and age are needed before anything can be calculated.'; return; }

  const t = computeTargets(state.profile);
  const m = t.meta;
  const bits = [
    `BMR ${m.bmr.toLocaleString()} kcal (Mifflin-St Jeor).`,
    m.basis === 'measured'
      ? `Maintenance ${m.tdee.toLocaleString()} kcal, from your real ${m.active.toLocaleString()} kcal/day burn over ${m.burnDays} days.`
      : `Maintenance ${m.tdee.toLocaleString()} kcal, estimated from your activity level.`,
    m.plan.kcalDelta ? `Goal ${signed(m.plan.kcalDelta)} kcal → ${t.kcal.toLocaleString()} kcal.` : `Target ${t.kcal.toLocaleString()} kcal.`,
    `Protein ${t.p} g (${m.gPerKg} g/kg${m.notes.length ? ', raised by your focus areas' : ''}).`,
  ];
  if (m.hitFloor) bits.push('Held at your BMR — the deficit you asked for would have gone below resting metabolism.');
  if (m.notes.length) bits.push('Focus: ' + m.notes.join('; ') + '.');
  el.textContent = bits.join(' ');
}

/* A field the user typed into gets a CUSTOM tag next to its label and a
   reset link, so it is obvious why recalculation left it alone. */
function renderCustomMarks() {
  ALL_TARGET_KEYS.forEach(k => {
    const input = $(fieldFor(k));
    if (!input) return;
    const label = input.closest('.field');
    if (!label) return;
    label.classList.toggle('customised', isCustom(k));

    let tag = label.querySelector('.customtag');
    if (isCustom(k) && !tag) {
      tag = document.createElement('button');
      tag.className = 'customtag';
      tag.type = 'button';
      tag.textContent = 'custom · reset';
      tag.onclick = e => { e.preventDefault(); resetOneTarget(k); };
      label.querySelector('span').appendChild(tag);
    } else if (!isCustom(k) && tag) {
      tag.remove();
    }
  });

  $('#nutTargetsIntro').textContent = (hasProfile()
    ? 'Calculated from your profile. '
    : 'General reference values for a healthy adult male, not personal ones. ')
    + 'Fibre, calcium and iron are minimums to reach; sugar, sodium and cholesterol are limits to '
    + 'stay under. Cholesterol, calcium and iron are judged on a 7-day average, not day by day.';

  const n = state.customTargets.length;
  $('#customNote').textContent = !hasProfile()
    ? 'Set up My Profile above and these are calculated for you. Any value you type stays yours.'
    : n
      ? `${n} target${n > 1 ? 's are' : ' is'} set by you rather than calculated. Recalculating asks before changing ${n > 1 ? 'them' : 'it'}.`
      : 'All of these are calculated from your profile. Type over any of them and it becomes yours.';
}

function resetOneTarget(k) {
  if (!hasProfile()) return;
  const calc = computeTargets(state.profile);
  state.targets[k] = Math.round(calc[k]);
  state.customTargets = state.customTargets.filter(x => x !== k);
  saveTargets();
  saveCustomTargets();
  renderSettings();
  renderSummary();
  renderWater();
  toast(`${TARGET_LABELS[k]} back to the calculated ${r0(state.targets[k]).toLocaleString()} ${TARGET_UNITS[k]}`);
}

/* ------------------------- saving and recalculating ------------------------- */

function readProfileForm() {
  const p = state.profile;
  p.h = +$('#pfH').value || null;
  p.w = +$('#pfW').value || null;
  p.age = +$('#pfAge').value || null;
  p.sex = $('#pfSex').value;
  p.activity = $('#pfActivity').value;
  p.goal = $('#pfGoal').value;
  p.goalKg = +$('#pfGoalKg').value || null;
  p.goalWeeks = +$('#pfGoalWeeks').value || null;
  p.focusText = $('#pfFocusText').value.trim();
  p.city = $('#pfCity').value.trim();
  p.updated = Date.now();
}

function profileComplaint(p) {
  if (!p.h || p.h < 100 || p.h > 250) return 'Height should be somewhere between 100 and 250 cm.';
  if (!p.w || p.w < 30 || p.w > 300) return 'Weight should be somewhere between 30 and 300 kg.';
  if (!p.age || p.age < 14 || p.age > 100) return 'Age should be between 14 and 100.';
  if (p.goal !== 'maintain' && (!p.goalKg || !p.goalWeeks)) return 'Say how many kg and over how many weeks.';
  if (p.goal !== 'maintain' && p.goalKg > p.w * 0.5) return 'That is more than half your bodyweight — check the number.';
  return '';
}

async function saveProfileAndCalc({ recalcOnly = false } = {}) {
  if (!recalcOnly) readProfileForm();
  const complaint = profileComplaint(state.profile);
  if (complaint) { toast(complaint); return; }

  saveProfile();

  /* City -> coordinates -> forecast, all best-effort. A dead network changes
     the water target's precision, never whether the profile saves. */
  if (state.profile.city && state.profile.city !== state.profile.cityLabel) {
    await resolveCity(state.profile.city);
  }
  await refreshWeather({ force: true });

  /* Re-reading unchanged text on every weekly weight update would be a free
     model call spent on an answer already known. */
  if (state.profile.focusText && state.profile.focusText !== state.profile.focusRead) {
    await interpretFocusText();
  }

  applyCalculatedTargets();
  renderProfile();
}

/* Writes the calculated numbers, but never over a target edited by hand —
   those are listed and the choice handed back. */
function applyCalculatedTargets() {
  const calc = computeTargets(state.profile);
  const conflicts = [];

  ALL_TARGET_KEYS.forEach(k => {
    if (isCustom(k)) {
      if (Math.round(calc[k]) !== Math.round(state.targets[k])) {
        conflicts.push({ k, from: state.targets[k], to: Math.round(calc[k]) });
      }
      return;
    }
    state.targets[k] = Math.round(calc[k]);
  });

  saveTargets();
  renderSettings();
  renderSummary();
  renderWater();

  if (conflicts.length) openRecalcDiff(conflicts);
  else toast(`Targets calculated — ${state.targets.kcal.toLocaleString()} kcal, ${state.targets.p} g protein`);
}

let recalcPending = [];

function openRecalcDiff(conflicts) {
  recalcPending = conflicts;
  $('#recalcIntro').textContent = conflicts.length === 1
    ? 'One target you set by hand differs from the freshly calculated value. Tick it to take the new number, or keep yours.'
    : `${conflicts.length} targets you set by hand differ from the freshly calculated values. Tick the ones to update.`;

  const list = $('#recalcList');
  list.innerHTML = '';
  conflicts.forEach(c => {
    const row = document.createElement('label');
    row.className = 'diffrow';
    row.innerHTML = `
      <input type="checkbox" data-k="${c.k}">
      <span class="diffname">${TARGET_LABELS[c.k]}</span>
      <span class="diffval">${r0(c.from).toLocaleString()} → <b>${r0(c.to).toLocaleString()}</b> ${TARGET_UNITS[c.k]}</span>`;
    list.appendChild(row);
  });
  showSheet('#recalcSheet');
}

function commitRecalcDiff() {
  let n = 0;
  $$('#recalcList input[type="checkbox"]').forEach(cb => {
    if (!cb.checked) return;
    const c = recalcPending.find(x => x.k === cb.dataset.k);
    if (!c) return;
    state.targets[c.k] = c.to;
    /* Taking the calculated number means it is no longer a custom value. */
    state.customTargets = state.customTargets.filter(x => x !== c.k);
    n++;
  });
  saveTargets();
  saveCustomTargets();
  closeSheets();
  renderSettings();
  renderSummary();
  renderWater();
  toast(n ? `${n} target${n > 1 ? 's' : ''} updated` : 'Kept your own targets');
}

/* --------------------------- city and free text --------------------------- */

async function resolveCity(name) {
  try {
    const hits = await geocodeCity(name);
    if (!hits.length) { toast(`No place called “${name}” found`); return; }
    if (hits.length === 1) { pickCity(hits[0]); return; }
    showCityChoices(hits);
  } catch (err) {
    console.warn('[Macros] geocoding failed:', err.message);
    toast('Could not look that city up — the water target will use a warm-climate default');
  }
}

function showCityChoices(hits) {
  const box = $('#pfCityResults');
  box.innerHTML = '';
  /* Several places share a name — "Riyadh" matches Saudi Arabia, Iraq and
     Sudan. Until one is picked there are no coordinates, so say so rather
     than quietly leaving the water target on its fallback. */
  cityPending = true;
  $('#pfWeather').textContent = `${hits.length} places match — tap the right one and the water target will follow its forecast.`;
  hits.forEach(h => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = h.label;
    b.onclick = async () => { pickCity(h); await refreshWeather({ force: true }); applyCalculatedTargets(); renderProfile(); };
    box.appendChild(b);
  });
  box.classList.remove('hidden');
}

let cityPending = false;

function pickCity(h) {
  cityPending = false;
  state.profile.lat = h.lat;
  state.profile.lon = h.lon;
  state.profile.cityLabel = h.label;
  state.profile.city = h.label;
  saveProfile();
  $('#pfCityResults').classList.add('hidden');
}

/* The free-text box goes to the model, which maps it onto the same focus
   keys the chips use. Constrained to that list on purpose: it can shift
   emphasis, it cannot invent a nutrient target. With no key, or if the call
   fails, the text is kept and matched against the same keywords locally. */
const FOCUS_SYSTEM = [
  'You map a short free-text health goal onto a fixed list of nutrition focus areas.',
  'Valid areas: ' + FOCUS_AREAS.map(f => f.k).join(', ') + '.',
  'Reply with JSON only: {"areas":["key",...],"note":"one short sentence, max 20 words"}',
  'Pick at most 3 areas. If nothing fits, return an empty array.',
].join('\n');

async function interpretFocusText() {
  const text = state.profile.focusText;
  if (!text) { state.profile.aiFocus = null; state.profile.focusRead = ''; saveProfile(); return; }

  focusBusy = true;
  renderFocusBusy();

  if (!features.ai || !(state.ai.key || '').trim()) {
    state.profile.aiFocus = localFocusGuess(text);
    state.profile.focusRead = text;
    focusBusy = false;
    saveProfile();
    renderFocusBusy();
    return;
  }
  try {
    const raw = await aiChat(FOCUS_SYSTEM, text, { json: true, maxTokens: 300, temperature: 0.1 });
    const obj = extractJson(raw) || {};
    /* Only the fixed area keys are accepted, so the model can shift emphasis
       but never invent a nutrient — the same rule the food estimator uses on
       implausible values. */
    const valid = FOCUS_AREAS.map(f => f.k);
    const areas = (Array.isArray(obj.areas) ? obj.areas : []).filter(a => valid.includes(a)).slice(0, 3);

    state.profile.aiFocus = areas.length
      ? { areas, note: String(obj.note || '').slice(0, 140), by: 'ai' }
      /* Nothing usable came back. Silently applying nothing would leave you
         believing a goal had been taken into account when it had not. */
      : { areas: [], by: 'ai', unmapped: true,
          note: 'The model could not turn that into a nutrition emphasis. Try naming what you '
              + 'want to change — "hair thinning", "losing belly fat", "more energy on shift" — '
              + 'or tap one of the chips above instead.' };
  } catch (err) {
    console.warn('[Macros] focus interpretation failed:', err.code, err.message);
    const guess = localFocusGuess(text);
    state.profile.aiFocus = Object.assign(guess, {
      failed: true,
      note: guess.areas.length
        ? guess.note + ' (' + aiErrorText(err) + ')'
        : 'Could not reach the model to read that. ' + aiErrorText(err),
      unmapped: !guess.areas.length,
    });
  }
  state.profile.focusRead = text;
  focusBusy = false;
  saveProfile();
  renderFocusBusy();
}

/* The profile save already awaits this; the note says so rather than the
   screen simply sitting there. */
let focusBusy = false;
function renderFocusBusy() {
  const note = $('#pfFocusNote');
  if (!note) return;
  if (focusBusy) {
    note.classList.remove('warnnote');
    note.textContent = 'Reading your goal…';
  }
}

/* No key, no network, no problem — a keyword pass covers the obvious cases. */
const FOCUS_KEYWORDS = {
  hair: /hair|nail|ferritin|shed|bald/i,
  skin: /skin|acne|complexion|collagen|dry skin/i,
  muscle: /muscle|strength|lift|gym|bicep|bulk up/i,
  bulk: /weight gain|gain weight|skinny|underweight/i,
  belly: /belly|tummy|waist|stomach fat|love handle/i,
  fatloss: /fat loss|lose fat|slim|cut|lean out/i,
  healthy: /health|energy|tired|fatigue|immun|general/i,
};

function localFocusGuess(text) {
  const areas = Object.keys(FOCUS_KEYWORDS).filter(k => FOCUS_KEYWORDS[k].test(text)).slice(0, 3);
  return {
    areas,
    note: areas.length
      ? 'Matched to ' + areas.map(k => (FOCUS_AREAS.find(f => f.k === k) || {}).label).join(', ') + ' without the model.'
      : 'Nothing obvious matched that text. Add an OpenRouter key in Settings and it will be read '
        + 'properly, or tap one of the chips above.',
    by: 'local',
    unmapped: !areas.length,
  };
}

/* =====================================================================
   WORKOUT TAB
   ===================================================================== */

function renderWorkout() {
  const focusKey = activeFocus();
  const sess = sessionFor(focusKey);
  const d = todayStr();
  const rec = workoutFor(d);
  const done = rec ? rec.done : [];
  const ids = allExerciseIds(sess);

  /* Focus chips */
  const chips = $('#woFocus');
  chips.innerHTML = '';
  WORKOUT_FOCUS.forEach(f => {
    const b = document.createElement('button');
    b.className = 'chip' + (f.k === focusKey ? ' on' : '');
    b.textContent = f.label;
    b.onclick = () => {
      state.workout.focus = f.k;
      saveWorkout();
      renderWorkout();
    };
    chips.appendChild(b);
  });

  $('#woNudgeNote') && ($('#woNudgeNote').textContent = workoutEngaged() ? ''
    : 'Reminders start once you tick your first exercise or set your own time in Settings.');
  $('#woFocusNote').textContent = state.workout.focus
    ? 'Your choice. Tap another any time.'
    : hasProfile()
      ? `Suggested from your profile goal. Tap any chip to choose your own.`
      : 'A sensible default — set up My Profile in Settings and this follows your goal instead.';

  $('#woDoneCount').textContent = `${done.filter(x => ids.includes(x)).length}/${ids.length}`;
  $('#woMins').textContent = sess.minutes;
  $('#woStreak').textContent = workoutStreak();

  /* Blocks */
  const wrap = $('#woBlocks');
  wrap.innerHTML = '';
  sess.blocks.forEach(block => {
    const h = document.createElement('h2');
    h.className = 'sect';
    h.textContent = block.label;
    wrap.appendChild(h);

    const card = document.createElement('div');
    card.className = 'card wolist';
    block.ex.forEach(e => {
      const isDone = done.includes(e.id);
      const row = document.createElement('button');
      row.className = 'worow' + (isDone ? ' done' : '');
      row.innerHTML = `
        <span class="wotick" aria-hidden="true">${isDone ? '&#10003;' : ''}</span>
        <span class="woinfo">
          <b>${escapeHtml(e.name)}</b>
          <small>${e.sets} × ${e.hold ? e.reps + ' s' : e.reps}${
            e.note ? ' · ' + escapeHtml(e.note) : ''}</small>
        </span>`;
      row.setAttribute('aria-pressed', isDone ? 'true' : 'false');
      row.onclick = () => {
        toggleExercise(d, e.id);
        renderWorkout();
        renderWorkoutBanner();
        renderBell();
  renderBell();

  /* Regions already switched on come from localStorage, so this resolves
     immediately in the normal case and never blocks the first render. */
  loadEnabledRegions().then(() => {
    if (Object.keys(regionFoods).length) { renderAll(); renderLibrary(); }
  });
        if (workoutComplete(d)) toast(`Session done · ${workoutStreak()} day streak`);
      };
      card.appendChild(row);
    });
    wrap.appendChild(card);
  });

  const wk = workoutWeekCount();
  $('#woNote').textContent = workoutComplete(d)
    ? `Every exercise ticked today. ${wk} full session${wk === 1 ? '' : 's'} in the last 7 days.`
    : `Circuit style: one round of everything, then repeat — ${ROUNDS} rounds in all, moving straight `
      + `on between exercises and taking about a minute between rounds. Tick each exercise as you `
      + `finish it; a part-finished session still counts. `
      + `${wk} full session${wk === 1 ? '' : 's'} in the last 7 days.`;

  renderWorkoutBanner();
}

function renderWorkoutBanner() {
  const banner = $('#woBanner');
  const item = pendingByKey('workout');
  const due = item && !item.dismissed ? workoutDue() : null;
  if (!due) { banner.classList.add('hidden'); return; }
  $('#woBannerTitle').textContent = `It’s past ${minToPretty(due.min)} — nothing ticked off yet today`;
  $('#woBannerHint').textContent = `Today’s session is about ${sessionFor(activeFocus()).minutes} minutes. `
    + 'Tick exercises as you go; a part-finished session still counts.';
  banner.classList.remove('hidden');
}

/* ------------------------------ region toggles ------------------------------ */

let regionBusy = null;

function renderRegions() {
  const list = $('#regionList');
  if (!list) return;
  list.innerHTML = '';

  REGIONS.forEach(r => {
    const row = document.createElement('label');
    row.className = 'toggle';
    const on = regionOn(r.k);
    const busy = regionBusy === r.k;

    /* Say what the toggle will cost before it is tapped: nothing at all for
       a built-in or an already-cached region, one small download otherwise. */
    const state_ = r.builtin ? 'built in'
      : busy ? 'downloading…'
      : regionCached(r.k) ? 'saved on this device'
      : 'downloads once, ~3 KB';

    row.innerHTML = `
      <span><b>${escapeHtml(r.label)}</b><small>${r.sub} · ${state_}</small></span>
      <input type="checkbox"${on ? ' checked' : ''}${busy ? ' disabled' : ''}><i></i>`;

    row.querySelector('input').onchange = e => setRegion(r.k, e.target.checked, e.target);
    list.appendChild(row);
  });

  const err = document.createElement('p');
  err.className = 'hint';
  err.id = 'regionErr';
  if (regionError) { err.textContent = regionError; err.style.color = 'var(--over)'; }
  list.appendChild(err);
}

let regionError = '';

async function setRegion(key, want, input) {
  regionError = '';

  if (!want) {
    state.regions[key] = false;
    saveRegions();
    renderRegions();
    refreshAfterRegionChange();
    toast(regionByKey(key).label + ' hidden — nothing deleted');
    return;
  }

  const meta = regionByKey(key);
  if (meta.builtin || regionCached(key)) {
    state.regions[key] = true;
    saveRegions();
    renderRegions();
    refreshAfterRegionChange();
    toast(meta.label + ' added');
    return;
  }

  /* First time on: this is the one moment a region needs the network. */
  regionBusy = key;
  renderRegions();
  try {
    const foods = await loadRegion(key);
    state.regions[key] = true;
    saveRegions();
    toast(`${meta.label} added — ${foods.length} dishes, saved for offline`);
  } catch (err) {
    state.regions[key] = false;
    regionError = navigator.onLine === false
      ? `${meta.label} needs one download and this device is offline. Connect once and try again — after that it works with no signal.`
      : `Could not download ${meta.label} (${err.message}). Check your connection and try again.`;
    console.warn('[Macros] region download failed:', key, err);
  } finally {
    regionBusy = null;
    renderRegions();
    refreshAfterRegionChange();
  }
}

function refreshAfterRegionChange() {
  renderAll();
  renderLibrary();
  if (currentView === 'add') runSearch($('#searchInput').value);
}

/* ------------------------ workout times in Settings ------------------------ */

/* Reminder times look and behave the same wherever they appear, so both
   lists are drawn by one function rather than two that drift apart. */
function renderTimeList({ mount, get, set, emptyText, after }) {
  const list = $(mount);
  if (!list) return;
  list.innerHTML = '';
  const times = get();

  if (!times.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = emptyText;
    list.appendChild(p);
    return;
  }

  times.forEach(t => {
    const row = document.createElement('div');
    row.className = 'timerow';

    const input = document.createElement('input');
    input.type = 'time';
    input.value = minToHHMM(t.min);
    input.onchange = () => {
      const v = parseTimeInput(input.value);
      if (v == null) { input.value = minToHHMM(t.min); return; }
      t.min = v;
      set(times.slice().sort((a, b) => a.min - b.min));
      after();
    };

    const del = document.createElement('button');
    del.className = 'ghost small';
    del.textContent = 'Remove';
    del.onclick = () => { set(times.filter(x => x.id !== t.id)); after(); };

    row.appendChild(input);
    row.appendChild(del);
    list.appendChild(row);
  });
}

/* A new row lands on a free minute so two never collide and look like a
   duplicate that will not delete. */
function nextFreeMinute(times, start) {
  const used = times.map(t => t.min);
  let m = start;
  while (used.includes(m)) m = (m + 30) % 1440;
  return m;
}

function renderWorkoutTimes() {
  renderTimeList({
    mount: '#woTimeList',
    get: () => state.workout.times || [],
    set: v => { state.workout.times = v; saveWorkout(); markSeen('workoutTimes'); },
    emptyText: 'No workout times set — the Workout tab still works, it just will not nudge you.',
    after: () => { renderWorkoutTimes(); renderWorkoutBanner(); renderBell(); },
  });
}

function renderCheckinTimes() {
  renderTimeList({
    mount: '#cpTimeList',
    get: () => state.checkins,
    set: v => { state.checkins = v; saveCheckins(); },
    emptyText: 'No check-in times — burn tracking still works, you just log readings when you choose.',
    after: () => { renderCheckinTimes(); renderAll(); },
  });
}

/* =====================================================================
   PENDING ITEMS  —  one producer, three consumers

   The Today banner, the Workout banner and the alerts hub all render from
   this list. They differ in how much they show, never in what is true.

   Dismissal is deliberately not baked in here. Dismissing a banner silences
   it for the session; the hub still lists the thing, because "I swiped it
   away this morning" is not the same as "it is done". Each item carries its
   own `dismissed` flag and the banners are the ones that honour it.

   group: 'act'   — something to do; these are what the badge counts
          'today' — worth knowing, nothing to clear
          'setup' — one-time, dismissible for good
   ===================================================================== */

const seenKey = k => !!(state.seen && state.seen[k]);
function markSeen(k) { state.seen[k] = true; writeJSON(KEY.seen, state.seen); }

function pendingItems() {
  const items = [];
  const d = todayStr();

  /* --- burn check-ins --- */
  if (features.burn) {
    const due = checkinDue();
    if (due) {
      items.push({
        key: 'checkin', group: 'act', dismissed: bannerDismissed,
        title: due.count > 1
          ? `Log your burned total — ${due.count} reminders have passed`
          : `Log burned calories — it’s past ${due.since.label}`,
        sub: 'Enter the cumulative total your fitness app shows right now.',
        go: () => { closeSheets(); showView('today'); openCheckin(d, null); },
      });
    }

    /* Every unfinished day, not just the most recent — the whole point of
       looking here is to find what has been quietly piling up. */
    daysNeedingFinal().forEach(day => {
      const last = readingsFor(day).slice(-1)[0];
      items.push({
        key: 'final:' + day, group: 'act', dismissed: finalDismissed.has(day),
        /* "Finish yesterday" reads better lowercase; "Finish fri, aug 21"
           does not. Only the single-word relative labels get folded. */
        title: 'Finish ' + (/^[A-Za-z]+$/.test(prettyDate(day))
          ? prettyDate(day).toLowerCase() : prettyDate(day)),
        sub: last
          ? `Last reading ${r0(last.cum).toLocaleString()} kcal at ${minToPretty(last.min)}. `
            + 'The rest of that evening is still blank.'
          : 'No final total recorded.',
        go: () => { closeSheets(); showView('today'); finalPending = day; openCheckin(day, null); },
      });
    });
  }

  /* --- workout --- */
  const wd = workoutDue();
  if (wd) {
    items.push({
      key: 'workout', group: 'act', dismissed: workoutBannerDismissed,
      title: `Workout not done — it’s past ${minToPretty(wd.min)}`,
      sub: `Today’s session is about ${sessionFor(activeFocus()).minutes} minutes.`,
      go: () => { closeSheets(); showView('workout'); },
    });
  }

  /* --- a region that could not be downloaded --- */
  if (regionError) {
    items.push({
      key: 'region', group: 'act', dismissed: false,
      title: 'A food region could not be downloaded',
      sub: regionError,
      go: () => { closeSheets(); showView('settings');
                  setTimeout(() => $('#regionList').scrollIntoView({ block: 'center' }), 60); },
    });
  }

  /* --- profile, once --- */
  if (!hasProfile() && !seenKey('profileNudge')) {
    items.push({
      key: 'profile', group: 'setup', dismissed: false, dismissable: true,
      title: 'Your targets are generic',
      sub: 'Fill in My Profile and they are calculated from your body, activity and goal '
         + 'instead of average adult values.',
      go: () => { closeSheets(); showView('settings');
                  setTimeout(() => $('#pfH').scrollIntoView({ block: 'center' }), 60); },
    });
  }

  /* --- today's nutrient flags, from the same verdicts the grid draws --- */
  microFlags(d).forEach(v => {
    items.push({
      key: 'nut:' + v.m.k, group: 'today', dismissed: false,
      title: v.m.dir === 'max'
        ? `Over on ${v.m.label.toLowerCase()}`
        : `Low on ${v.m.label.toLowerCase()}`,
      sub: `${microFmt(v.value, v.m)} ${v.m.unit}${v.weekly ? ', 7-day average' : ''} `
         + `against ${v.m.dir === 'max' ? 'a limit of' : 'a target of'} `
         + `${microFmt(v.target, v.m)} ${v.m.unit}.`,
      go: () => { closeSheets(); showView('today');
                  totalsOpen = true; setExpanded($('#toggleTotals'), $('#totalsMicros'), true);
                  setTimeout(() => $('#totalsMicroGrid').scrollIntoView({ block: 'center' }), 60); },
    });
  });

  /* --- today's suggestion, cached; nothing here touches the network --- */
  if (features.ai) {
    const slot = currentAdviceSlot(d);
    const cached = slot != null ? state.advice[adviceKey(d, slot)] : null;
    if (cached && cached.text) {
      items.push({
        key: 'advice', group: 'today', dismissed: false, sparkle: true,
        title: cached.text,
        sub: `Suggested after your ${minToPretty(slot)} reading.`,
        go: () => { closeSheets(); showView('today');
                    setTimeout(() => $('#adviceBox').scrollIntoView({ block: 'center' }), 60); },
      });
    }
  }

  return items;
}

const pendingActions = () => pendingItems().filter(i => i.group === 'act');
const pendingCount = () => pendingActions().length;
const pendingByKey = k => pendingItems().find(i => i.key === k);

/* ------------------------------ the bell ------------------------------ */

function renderBell() {
  const badge = $('#bellCount');
  if (!badge) return;
  const n = pendingCount();
  badge.textContent = n > 9 ? '9+' : String(n);
  badge.classList.toggle('hidden', n === 0);
  $('#bellBtn').setAttribute('aria-label',
    n ? `${n} item${n === 1 ? '' : 's'} need attention` : 'Nothing needs attention');
}

const GROUP_LABELS = { act: 'Needs you', today: 'Today', setup: 'Setup' };

function openAlerts() {
  renderAlerts();
  showSheet('#alertSheet');
}

function renderAlerts() {
  const wrap = $('#alertList');
  wrap.innerHTML = '';
  const items = pendingItems();

  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Nothing needs attention. Everything is logged and up to date.';
    wrap.appendChild(p);
  }

  ['act', 'today', 'setup'].forEach(g => {
    const rows = items.filter(i => i.group === g);
    if (!rows.length) return;

    const h = document.createElement('h4');
    h.className = 'alerthead';
    h.textContent = GROUP_LABELS[g] + (g === 'act' ? ` · ${rows.length}` : '');
    wrap.appendChild(h);

    rows.forEach(i => {
      const row = document.createElement('div');
      row.className = 'alertrow' + (g === 'act' ? ' act' : '');

      const btn = document.createElement('button');
      btn.className = 'alertgo';
      btn.innerHTML = `
        <span class="dot${i.sparkle ? ' sparkle' : ''}" aria-hidden="true">${i.sparkle ? '✦' : ''}</span>
        <span class="alerttext"><b>${escapeHtml(i.title)}</b><small>${escapeHtml(i.sub)}</small></span>`;
      btn.onclick = i.go;
      row.appendChild(btn);

      if (i.dismissable) {
        const x = document.createElement('button');
        x.className = 'alertx';
        x.setAttribute('aria-label', 'Dismiss');
        x.textContent = '×';
        x.onclick = () => { markSeen(i.key === 'profile' ? 'profileNudge' : i.key);
                            renderAlerts(); renderBell(); };
        row.appendChild(x);
      }
      wrap.appendChild(row);
    });
  });

  /* The header shows whichever date is being browsed; this list is always
     about today, and saying so is cheaper than the confusion is. */
  $('#alertNote').textContent = state.date === todayStr()
    ? 'Everything here is about today.'
    : `You are looking at ${prettyDate(state.date)}, but these items are about today.`;
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

/* Micro key -> its Settings input. Derived from MICROS so adding a nutrient
   means touching one list, not three. */
const MICRO_TARGET_IDS = {};
MICROS.forEach(m => { MICRO_TARGET_IDS[m.k] = '#t' + m.k[0].toUpperCase() + m.k[1]; });

function renderSettings() {
  $('#tKcal').value = state.targets.kcal;
  $('#tP').value = state.targets.p;
  $('#tC').value = state.targets.c;
  $('#tF').value = state.targets.f;
  $('#tW').value = state.targets.water;
  MICROS.forEach(m => { $(MICRO_TARGET_IDS[m.k]).value = state.targets[m.k]; });
  renderCustomMarks();
  renderProfile();
  $('#aiKey').value = state.ai.key || '';
  $('#aiModel').value = state.ai.model || AI_DEFAULT_MODEL;
  renderAiStatus();
  renderRegions();
  renderCheckinTimes();
  renderWorkoutTimes();
  checkTargetMath();
}

function renderAiStatus(msg) {
  const el = $('#aiStatus');
  if (msg) { el.textContent = msg; return; }
  const k = (state.ai.key || '').trim();
  /* A model swapped out from under you deserves saying so, once. */
  const moved = modelMigratedFrom
    ? `Your saved model ${modelMigratedFrom} was retired by OpenRouter and has been switched to ${AI_DEFAULT_MODEL}. `
    : '';
  el.textContent = moved + (k
    ? `Key saved on this device (…${k.slice(-4)}). Test it to be sure it works.`
    : 'No key saved — “Estimate with AI” will tell you to come back here.');
}

async function testAiKey() {
  if (!(state.ai.key || '').trim()) { renderAiStatus('Paste a key and tap Save first.'); return; }
  renderAiStatus('Testing…');
  $('#aiTest').disabled = true;
  try {
    const est = await aiRequest('plain boiled white rice', { timeout: 30000 });
    renderAiStatus(`Working. Test estimate for boiled rice: ${r0(est.values.kcal)} kcal/100 g `
      + `(a sane answer is roughly 120–140). Model: ${est.model}`
      + (aiChat.retriedAfterTimeout ? ' — the first attempt timed out and the retry succeeded, so expect the odd slow round.' : '')
      + (aiChat.lastDroppedFormat ? ' (That model would not take a strict JSON format, so plain prompting was used.)' : ''));
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
  const micro = {};
  /* 0 or blank means "no target": microState skips it and the cell just shows
     the number, which is what the app did before targets existed. */
  MICROS.forEach(m => { micro[m.k] = Math.max(0, +$(MICRO_TARGET_IDS[m.k]).value || 0); });

  const next = Object.assign(micro, {
    kcal:  Math.max(0, +$('#tKcal').value || 0),
    p:     Math.max(0, +$('#tP').value || 0),
    c:     Math.max(0, +$('#tC').value || 0),
    f:     Math.max(0, +$('#tF').value || 0),
    water: Math.max(0, +$('#tW').value || 0),
  });

  /* Anything typed that differs from what the engine would produce is a
     deliberate override, and recalculation asks before touching it. With no
     profile there is nothing to compare against, so nothing is marked. */
  if (hasProfile()) {
    const calc = computeTargets(state.profile);
    ALL_TARGET_KEYS.forEach(k => {
      const differs = Math.round(next[k]) !== Math.round(calc[k]);
      const already = isCustom(k);
      if (differs && !already) state.customTargets.push(k);
      if (!differs && already) state.customTargets = state.customTargets.filter(x => x !== k);
    });
    saveCustomTargets();
  }

  state.targets = next;
  saveTargets();
  renderSettings();
  renderSummary();
  renderWater();
  toast('Targets saved');
}

function exportBackup() {
  /* The API key is deliberately left out — a backup file often gets emailed
     or synced, and a leaked key is someone else spending your credit. */
  const payload = {
    app: 'macros', version: 5, exported: new Date().toISOString(),
    targets: state.targets, foods: state.custom, entries: state.entries,
    water: state.water, names: state.names,
    burn: state.burn, advice: state.advice, features,
    profile: state.profile, customTargets: state.customTargets,
    workout: state.workout,
    regions: state.regions,
    checkins: state.checkins,
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

      /* Body stats and which targets were hand-set travel together — importing
         the targets without the overrides would let the next recalculation
         quietly undo edits the backup was meant to preserve. */
      if (d.profile) state.profile = Object.assign({}, DEFAULT_PROFILE, d.profile, {
        focus: Array.isArray(d.profile.focus) ? d.profile.focus.slice() : [],
      });
      if (Array.isArray(d.customTargets)) state.customTargets = d.customTargets.slice();
      if (d.regions) state.regions = Object.assign({}, DEFAULT_REGIONS, d.regions);
      if (Array.isArray(d.checkins)) {
        state.checkins = d.checkins.filter(t => t && typeof t.min === 'number')
          .map(t => ({ id: t.id || uid(), min: t.min }));
      }
      if (d.workout) {
        state.workout = {
          focus: d.workout.focus || state.workout.focus || null,
          times: Array.isArray(d.workout.times) && d.workout.times.length
            ? d.workout.times.map(t => ({ id: t.id || uid(), min: t.min }))
            : state.workout.times.map(t => ({ ...t })),
          /* Days merge rather than replace, matching how entries and foods
             import — a backup from another device should not erase a session
             logged on this one. */
          log: Object.assign({}, state.workout.log, JSON.parse(JSON.stringify(d.workout.log || {}))),
        };
      }

      saveFoods(); saveEntries(); saveWater(); saveBurn(); saveNames(); saveAdvice();
      saveTargets(); saveAi(); saveProfile(); saveCustomTargets(); saveWorkout(); saveRegions(); saveCheckins();
      loadEnabledRegions().then(() => { renderAll(); renderLibrary(); });
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

/* Everything that is a sheet, found from the DOM rather than a hand-kept
   list — the burn sheet was missing from the old list, so its Cancel, the
   scrim and Escape all silently did nothing. A sheet added later is covered. */
const allSheets = () => $$('.sheet');

/* Opening one sheet closes the others so they can never stack, but it
   deliberately leaves module state alone: openFoodEditor sets fsForceId
   before it calls this, and wiping that would lose the barcode. */
function showSheet(sel) {
  const target = $(sel);
  if (!target) return;
  stopScanner();
  allSheets().forEach(el => { if (el !== target) el.classList.add('hidden'); });
  $('#scrim').classList.remove('hidden');
  target.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

/* A real dismiss: hide every sheet and drop the half-finished state behind
   it, so nothing stale is waiting the next time a sheet opens. */
function closeSheets() {
  stopScanner();
  scanBusy = false;
  aiGen++;                 // an estimate still in flight must not reopen a sheet
  aiInFlight = false;

  allSheets().forEach(el => el.classList.add('hidden'));
  $('#scrim').classList.add('hidden');

  finalPending = null;
  bs = { d: null, id: null };

  /* Inputs and warnings that are not rebuilt on open. */
  hideRenameRow();
  $('#scanManualInput').value = '';
  $('#bsWarn').classList.add('hidden');
  $('#aiError').classList.add('hidden');
  $('#aiLoading').classList.add('hidden');
  $('#aiGo').disabled = false;
  resetRawToggle('#aiRawBtn', '#aiRaw');

  document.body.style.overflow = '';
}

/* Both AI cards get the same collapsed-by-default debug view. Collapsed is
   the point: the raw JSON is only wanted when something has gone wrong. */
function resetRawToggle(btnSel, boxSel) {
  const btn = $(btnSel), box = $(boxSel);
  if (!btn || !box) return;
  btn.classList.add('hidden');
  box.classList.add('hidden');
  btn.textContent = 'Show raw model response';
}

function bindRawToggle(btnSel, boxSel) {
  const btn = $(btnSel), box = $(boxSel);
  if (!btn || !box) return;
  btn.onclick = () => {
    const nowHidden = box.classList.toggle('hidden');
    btn.textContent = nowHidden ? 'Show raw model response' : 'Hide raw model response';
  };
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
  if (name === 'workout') renderWorkout();
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
  $('#bellBtn').onclick = openAlerts;
  $('#alertClose').onclick = closeSheets;
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
  $('#toggleNutTargets').onclick = () => {
    const open = $('#toggleNutTargets').getAttribute('aria-expanded') !== 'true';
    setExpanded($('#toggleNutTargets'), $('#nutTargets'), open);
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
  $('#bannerDismiss').onclick = () => {
    bannerDismissed = true;
    $('#bannerCum').value = '';
    $('#bannerErr').classList.add('hidden');
    renderBanner();
    renderBell();
  };
  $('#finalSave').onclick = commitFinal;
  $('#finalCum').onkeydown = e => { if (e.key === 'Enter') commitFinal(); };
  $('#finalDismiss').onclick = () => {
    if (finalTarget) finalDismissed.add(finalTarget);
    finalTarget = null;
    $('#finalCum').value = '';
    $('#finalErr').classList.add('hidden');
    renderFinalBanner();
  };
  bindRawToggle('#adviceRawBtn', '#adviceRaw');

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
  /* workout */
  $('#woDismiss').onclick = () => { workoutBannerDismissed = true; renderWorkoutBanner(); renderBell(); };
  $('#woAddTime').onclick = () => {
    state.workout.times.push({ id: uid(), min: nextFreeMinute(state.workout.times, 18 * 60) });
    state.workout.times.sort((a, b) => a.min - b.min);
    saveWorkout();
    markSeen('workoutTimes');
    renderWorkoutTimes();
    renderWorkoutBanner();
    renderBell();
  };
  $('#cpAddTime').onclick = () => {
    state.checkins.push({ id: uid(), min: nextFreeMinute(state.checkins, 15 * 60) });
    state.checkins.sort((a, b) => a.min - b.min);
    saveCheckins();
    renderCheckinTimes();
    renderAll();
  };
  $('#cpResetTimes').onclick = () => {
    state.checkins = DEFAULT_CHECKPOINTS.map(min => ({ id: uid(), min }));
    saveCheckins();
    renderCheckinTimes();
    renderAll();
    toast('Check-in times reset to 8:00, 12:00, 5:00 and 10:30');
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
  bindRawToggle('#aiRawBtn', '#aiRaw');

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

  /* profile */
  ['#pfH', '#pfW', '#pfAge', '#pfGoalKg', '#pfGoalWeeks'].forEach(sel =>
    $(sel).oninput = () => { readProfileForm(); renderGoalNote(); renderProfileSummary(); });
  ['#pfSex', '#pfActivity'].forEach(sel =>
    $(sel).onchange = () => { readProfileForm(); renderProfileSummary(); });
  $('#pfGoal').onchange = () => {
    readProfileForm();
    $('#pfGoalRow').classList.toggle('hidden', state.profile.goal === 'maintain');
    renderGoalNote();
    renderProfileSummary();
  };
  $('#pfSave').onclick = () => saveProfileAndCalc();
  $('#pfRecalc').onclick = () => {
    if (!hasProfile()) { toast('Fill in height, weight and age first'); return; }
    readProfileForm();
    saveProfile();
    saveProfileAndCalc({ recalcOnly: true });
  };
  $('#pfCity').onchange = () => {
    const v = $('#pfCity').value.trim();
    state.profile.city = v;
    if (v && v !== state.profile.cityLabel) resolveCity(v).then(() => refreshWeather({ force: true }))
      .then(() => { $('#pfWeather').textContent = weatherNote(); });
  };
  $('#recalcApply').onclick = commitRecalcDiff;
  $('#recalcKeep').onclick = () => { closeSheets(); toast('Kept your own targets'); };

  $('#saveTargets').onclick = persistTargets;
  $('#resetTargets').onclick = () => {
    /* With a profile, "reset" means back to calculated rather than back to
       the generic defaults — those are not this person's numbers. */
    state.targets = hasProfile()
      ? (() => { const c = computeTargets(state.profile); const o = {};
                 ALL_TARGET_KEYS.forEach(k => { o[k] = Math.round(c[k]); }); return o; })()
      : Object.assign({}, DEFAULT_TARGETS);
    state.customTargets = [];
    saveTargets(); saveCustomTargets();
    renderSettings(); renderSummary(); renderWater();
    toast(hasProfile() ? 'Back to your calculated targets' : 'Targets reset to the defaults');
  };
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
      workoutBannerDismissed = false;
    }
    renderAll();
  });

  /* Offline support on the real host only. On localhost the cache-first
     worker would keep serving a stale build while editing, so skip it. */
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !isLocal) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /* Best-effort, and never blocks anything: the water target falls back to a
     warm-climate figure when this fails or the device is offline. */
  refreshWeather().then(w => { if (w) { renderWater(); renderSettings(); } });

  renderWorkoutBanner();

  /* Say it out loud as well as in Settings — a model changing under you is
     not something to find out from a failed suggestion. */
  if (modelMigratedFrom) {
    setTimeout(() => toast(`${modelMigratedFrom} was retired — model switched to ${AI_DEFAULT_MODEL}`), 400);
  }
}

/* Undo for a water quick-add: drop it without the second confirming toast. */
function removeWaterSilent(id) {
  state.water = state.water.filter(w => w.id !== id);
  saveWater();
  renderWater();
}

init();

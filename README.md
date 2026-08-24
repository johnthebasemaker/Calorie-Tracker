# Macros — South Indian + Gulf calorie tracker

**Live: https://johnthebasemaker.github.io/Calorie-Tracker/**

A single-page, offline food and water log. No backend, no login, no account.
Everything is stored in your browser's `localStorage` on the device you use it on.

Targets ship at **2900 kcal / 130 g protein / 390 g carbs / 90 g fat** — change them
in Settings any time.

---

## Getting it onto your iPhone

The app needs to be served over `http(s)` — opening `index.html` directly from
Files (`file://`) disables the service worker and blocks the Open Food Facts
lookups. Two ways to do it:

### A. Use the hosted version

Open **https://johnthebasemaker.github.io/Calorie-Tracker/** in Safari, then
**Share → Add to Home Screen**. It launches full-screen with its own icon and
works with no signal — useful on shift.

Served from the `main` branch by GitHub Pages. Pushing to `main` redeploys it.

### B. Run it locally

```bash
python3 -m http.server 8765
```

from the project folder, then open `http://localhost:8765`. To reach it from
your phone on the same Wi-Fi, use the machine's LAN address instead
(`http://192.168.x.x:8765`).

Any static host works too — the whole app is six files plus icons. Netlify Drop
and Cloudflare Pages both serve it free over HTTPS.

---

## How it works

**Adding food.** Type a name in the Add tab. Your own library (120+ pre-seeded
South Indian, Gulf, drink and protein-staple foods) matches instantly and appears
first. Open Food Facts is queried in parallel for packaged and branded items and
appears under "Packaged foods". Nothing found? Tap *Add "…" manually*, enter the
per-100 g values once, and it's in your library forever.

Local-first rather than strictly OFF-first: for idli or kabsa the local hit is
both faster and more accurate, and you still see every packaged match below it.

**Food regions.** Five curated cuisines, switched on independently in
Settings → **Food regions** — South Indian, Saudi/Gulf, North Indian, Pakistani
and Filipino. They stack rather than being one exclusive mode, because someone
in Riyadh might genuinely eat all three of South Indian, Gulf and Filipino food
in the same week.

South Indian and Saudi/Gulf ship inside the app. The other three live in
`regions/*.json` and are fetched the first time you switch one on, then kept in
this browser — after that, switching is instant and needs no signal. The service
worker also precaches them after the app shell is in, so in practice the first
switch-on is usually local too. Switch a region off and its foods leave search
and Quick add; **nothing you have logged changes**, because every log entry
already carries its own per-100 g numbers.

Basics that belong to no cuisine — oils, drinks, protein staples — are never
hidden by a toggle.

*On the size tradeoff, measured rather than assumed:* all three region files
together are **7 KB gzipped**, against **367 KB** for the barcode scanner that
already ships. Lazy loading is not what makes the app fast today; it is what
stops the tenth region from being the thing that slows it down. Bundling would
have been simpler and fully offline from install — the lazy path was chosen for
how it scales, not for what it saves right now.

**What the EST tag means.** 120 new dishes came with the three added regions.
Nine of them — the Filipino dishes with a direct entry in the FNRI Philippine
Food Composition Tables — are read straight off a published table. The other 111
are derived from a standard home recipe using IFCT 2017 and USDA FoodData Central
ingredient values, and carry an **EST** tag in the Foods tab so you know which
numbers to distrust first. Tap any of them to correct it.

**Anything outside those five regions** is covered by what was already there:
search Open Food Facts, estimate it with AI, or add it by hand. Once saved it is
in your library permanently, exactly like a barcode miss.

**Why the fizzy drinks are seeded.** Open Food Facts' search server goes down
for minutes at a time, often enough that a can of Mirinda was simply unfindable
when it did. So Pepsi, Coca-Cola, Mountain Dew, Mirinda, 7UP, the zero-sugar
versions, Barbican, Rani, orange juice and Red Bull are in the local library
with per-100 ml label values, and match with no network at all. A can with a
shift meal is the easiest 150 kcal in the day to miss.

The packaged search itself asks OFF to rank by scan count and requests three
times as many rows as it shows. Both matter: unranked, "mountain dew" led with
obscure regional entries carrying no nutrition data, which then got dropped for
having no calories, and the actual bottle never made the visible eight. When a
request does fail it is retried rather than given up on, because the failures
are per-request rather than sticky, and the message says their server is down
rather than implying your connection is.

**Barcodes.** Tap **Scan** next to the search box to open the camera and point it
at the barcode; it looks the product up automatically and drops you straight on
grams entry. You can also type or paste the number (8–14 digits) into the search
box, or into the scanner's own field. Typed lookups hit OFF's product endpoint
directly, which is far more reliable than its free-text search.

If the camera is blocked or unavailable the scanner says why — including the iOS
path to re-enable it — and puts the manual number field right there. The scanner
library is vendored in `vendor/`, so scanning keeps working offline and doesn't
depend on a CDN. It only loads the first time you tap Scan.

**Non-English product names.** Gulf barcodes often come back Arabic-only, and a
text search reaches the whole database, so Cyrillic, Chinese, Thai and Hebrew
names turn up just as readily. The app asks Open Food Facts for the English
fields first (`product_name_en`, then `generic_name_en`) — but those are
crowd-entered and regularly hold Arabic anyway, so **every** candidate is
script-checked rather than trusted by its field name. There are live products
where `product_name_en` is pure Arabic; those fall through to the next candidate.

If nothing readable is left, the row is tagged **rename** in the results, the
portion sheet says why, and **Rename** stores your name against that barcode
forever. This applies identically to barcode scans and text searches — same
products, same treatment.

One honest limit: script is detectable in a few lines of code, language is not.
"Lait fermenté" and "leche fermentada" are Latin script and pass the check. They
get the Rename button like anything else, but the app will not flag them for you.

**Burn & balance.** Log a reading whenever you like — you type the **cumulative**
total Apple Health is showing and never work out a difference yourself.

Apple Health resets at midnight, so your first reading of the day *is* the
midnight-to-then segment with nothing subtracted. Every later segment is that
reading minus the one before it. Balance is eaten minus burned — a surplus shows
green because that's what builds weight on a bulk, a shortfall shows amber.

Segments are labelled with the real clock times you logged at, so a wide window
is obvious without a footnote. Because readings are cumulative, a wide window is
exact rather than estimated — nothing is lost, and the segments still sum to the
day total. A reading that would go *down* is refused with an explanation, since a
cumulative total that falls is a typo; if a backup ever imports a pair out of
order, that segment is flagged rather than shown as negative burn.

**Meal times.** Every log entry carries the time you ate, pre-filled with the
current time and editable in the portion sheet. Log breakfast at 2pm because you
were on shift and you can correct it to 07:30, so it lands in the right segment.
Entries logged before this existed fall back to when they were saved.

**Check-in times are yours.** Settings → **Burn check-in times** takes as many
or as few as your shift needs — add, remove, retime. A fresh install starts on
8:00, 12:00, 5:00 and 10:30, which is only where it starts. Everything
downstream reads that list: the banner, the bell, and the "reminders you passed
inside this window" labels under the segment table. Remove them all and burn
tracking still works; it simply stops nudging.

**Check-in reminders.** There's no server, so there are no push notifications —
your iPhone Reminders do the nudging. When you open the app it checks the clock
against the four times and, if any have gone by since your last reading, shows
one dismissible banner asking for your current total. Open it at 1pm having
missed 8am and 12pm and you still get a single prompt, not two. Dismissing lasts
for the session, so the nudge returns next time you open the app.

**Week.** Its own tab; the calendar and **This week** button in the header move
it. Per day: burned, eaten, balance and protein against target, plus averages
that cover only the days with data — a day you logged nothing is left out rather
than dragged down as a zero. With burn tracking off the burn columns drop away
and the weekly food view stays.

**Meal suggestions.** Saving a reading automatically asks the model what to eat
next, given your remaining calories and protein, everything logged so far with
times, your burn/eaten balance, all six extra nutrients against their targets,
and 55 foods from your own library with their per-100 g values. It's told to name
only foods from that list, so you get "add 150 g chicken breast and 3 idli with
sambar" rather than generic advice.

**It can only name food you can actually eat.** The list comes from the same
region-filtered library the rest of the app uses, so a suggestion can never reach
for a Filipino dish while that region is switched off — the grounding falls out
of the region toggles rather than being bolted on beside them. The list is also
split in two: foods you have actually logged, most-eaten first and explicitly
marked as ones you eat, then the rest of the library. Advice built from what is
already in your rotation gets followed; advice naming something you have never
eaten usually does not.

**Estimates get cross-checked against your library.** If an AI estimate has the
same name as a food already on file, the confirm screen shows both numbers —
*"your library already has Chicken Biryani at 180 kcal"* — and says plainly when
the estimate is more than 25% away. It is context, never a block; the estimate
may well be the better number. Matching is deliberately near-exact rather than
fuzzy: "mutton biryani" against "chicken biryani" is a genuinely different dish,
and a warning there would be noise.

The nutrient lines spell out the direction and the verdict — `Fibre: 2 g (aim for
at least 30 g) — well under the minimum` — so the model isn't left to guess
whether 2600 mg of sodium is good news. A nutrient nothing reported is stated as
missing rather than as zero, and the model is told explicitly not to call that a
deficiency. It's asked to work one nutrient gap into the same sentence, not to
list all six.

Read-only — it never saves anything, so there's no confirm step. Each suggestion
is cached against the reading that triggered it, so re-opening the app doesn't
spend another call; **Suggest again** forces a fresh one. Four calls a day sits inside
OpenRouter's limits, but free models share a daily cap with barcode estimates —
if a retry gets throttled the previous suggestion stays on screen and the footer
says the retry failed.

**Check-ins are flexible.** 8:00, 12:00, 17:00 and 22:30 are reminder triggers,
not slots you must fill one by one. If several have gone by, you get **one**
prompt — enter whatever your fitness app shows right now. The reading is stamped
with the real time you logged it (editable), so logging at 13:40 records 13:40,
and the segment maths uses that boundary rather than a fictional 12:00 one. Gaps
merge into one wider window, which is exact because the readings are cumulative.

**Closing off a day.** Burn readings stop when you stop logging, so food eaten
after the last one shows "—". On the first open of a new day you're asked for
yesterday's final total; enter it and the stretch from your last reading to
midnight fills in. Skip it and the day stays open — the Week view puts a
**finish** button next to any unclosed day so you can back-fill it whenever you
next check your Health app.

**AI estimation.** When a barcode or a text search finds nothing, you get two
options side by side: **Enter it manually** or **✦ Estimate with AI**. The AI path
asks you to describe the food first — a barcode number on its own is not enough
context to estimate from, so "Almarai chocolate milk 200 ml" beats a bare number.

Nothing is saved until you approve it. The estimate lands on a **Check the
estimate** screen with every value in an editable field under an "AI estimated —
please check before saving" banner, showing the model's own confidence. Change
whatever looks wrong, then **Confirm & Save** writes it to your library keyed to
the barcode — or to the food name when there's no barcode, so re-estimating the
same thing updates it instead of making a duplicate. AI-sourced foods carry an
**AI** tag in the Foods tab so you always know which numbers were estimated.

Set it up in **Settings → AI estimation**: paste an OpenRouter key and tap **Test
connection**, which runs one real estimate on boiled rice and tells you whether
the answer is sane.

The default model is **`openrouter/free`** — OpenRouter's own router, which picks
an available free model per request based on the features asked for. Individual
`:free` slugs get pulled without notice: `openai/gpt-oss-20b:free` was the default
here until it started returning *"This model is unavailable for free"* and
disappeared from the model list entirely. Of the free slugs available at the time
of writing, most do not support structured outputs at all, so pinning a named one
and hoping is the fragile choice, not the safe one.

A saved model matching a retired default is moved forward automatically, and the
app says so in Settings and in a toast rather than changing it behind your back.
If a model you pinned yourself is later retired, that exact 404 is recognised and
the message names it — *"Your selected model, X, is no longer free — switched to
openrouter/free"* — instead of a generic failure. The field stays editable, so
pinning a specific model is still yours to do.

Because the router can land on a model without structured-output support, a
refusal of `response_format` — as a 400, or as a 404 saying no endpoint supports
it — drops the strict format and asks again in plain prose, which the fenced-JSON
and messy-output parsers already handle.

Your key lives in this browser's localStorage and nowhere else. It is not in the
repo, and it is deliberately **excluded from backup exports** — a backup file
tends to get emailed or synced around, and a leaked key is someone else spending
your credit. The model name does travel in the backup; the key never does.

**Keeping the monologue off the screen.** Because `openrouter/free` routes to a
different model each call, some of them think out loud. Three shapes turn up: a
separate `reasoning` field, `<think>` tags, or no separation at all. The first is
dropped outright — an earlier version fell back to it when `content` came back
empty, which was defensible while one reasoning model was pinned, and became a bug
the moment the router started rotating. Tags and the gpt-oss `<|channel|>` format
are cut out. The unseparated case has no marker to split on, so lines that restate
the task, narrate a plan, or read as a scratchpad label are dropped.

What survives is then checked here rather than merely requested in the prompt: over
50 words, a list, a leading label, or anything still talking about "the user" is
rejected. A rejected answer is retried once — a fresh roll of the router's dice,
with a blunter instruction — and if that fails too you get *"Couldn't get a clean
suggestion that round"* rather than a truncated paragraph of someone else's
thinking. A reply that ran out of budget mid-thought is retried the same way; a
rejected key or a rate limit is not, because a second try cannot fix those.

**Slow models** are retried once automatically rather than given a longer leash.
A timeout under `openrouter/free` usually means the router landed on a slow model,
so a retry is a different model rather than the same one being asked to hurry.
Only if both attempts time out does anything appear on screen. Both the Suggest
card and Settings → Test connection go through the same path.

**If a suggestion fails**, the message names the actual cause — the HTTP status
and OpenRouter's own words. A rate limit says it is a rate limit and how long to
wait; a bad model id says so; only a genuinely unreachable server blames the
connection, and even then the app first checks whether openrouter.ai answers at
all, so "reachable but refused" and "cannot reach it" are never confused. Both
AI paths — meal suggestions and food estimates — share that one error mapper.

A **Show raw model response** link under the message opens the exact reply, and
the full response object is logged to the console. It starts collapsed; the raw
JSON is only wanted when something has gone wrong. Reasoning
models (`gpt-oss`, and most `:free` models worth using) spend tokens thinking
before they answer, so the request sends `reasoning: {effort:'low'}` and a token
budget with room for both; if the budget still runs out, the answer is recovered
from the reasoning trace. Replies wrapped in markdown fences, prose, or JSON are
all unwrapped rather than rejected.

No proxy is needed. OpenRouter returns `access-control-allow-origin: *`, so the
browser calls it directly from the Pages origin. (For reference, Anthropic also
works browser-direct via its `anthropic-dangerous-direct-browser-access` header,
and OpenAI echoes the requesting origin — but Gemini's endpoint rejected the
preflight, so it would need a proxy.)

**Sharing it.** Both extras are **off by default**, so anyone opening the link
gets a plain food and water tracker. Settings → Features turns on **Calorie
burned tracking** and **AI summary** independently. Switching one off only hides
its UI — every reading, suggestion and key stays put and reappears when you
switch it back on. A browser that already had readings or a key keeps them on,
so an existing install is never silently stripped.

**Picking a date.** The header is a calendar icon, the date, and a **Today**
button — no step arrows, since a stray tap on those was how entries ended up on
the wrong day. The calendar marks every day that has food logged with a dot.

**Water.** A card under the day's macros: `+250 ml`, `+500 ml`, `+1 L` for the
usual glass and bottle sizes, plus a field for anything else. Target defaults to
3500 ml and is editable in Settings. Each add appears as a chip — tap it to
remove. Resets daily and follows the same date navigation as food.

**The other nutrients.** Fibre, sugar, sodium, cholesterol, calcium and iron are
tracked alongside the four main numbers, kept out of the way behind an expander:
**Full breakdown** under the daily totals, and **More details** on any individual
food. Fibre, sugar and sodium are filled in for all 113 seeded foods; cholesterol,
calcium and iron only where the value is well established.

A missing value shows as **—**, never as 0 — so an unknown sodium and a genuine
zero are never confused. In the daily breakdown, a count like `(3/6)` means only 3
of the 6 foods you logged reported that nutrient, so the true total is higher.

Each of the six carries a daily target, shown inside **Full breakdown** rather than
on the main Today screen. Fibre, calcium and iron are minimums to reach; sugar,
sodium and cholesterol are limits to stay under. Only the two states worth acting
on — **OVER** a limit, **UNDER** a minimum — get colour, so a glance finds the
problem instead of reading six badges. A nutrient nothing reported has no state at
all, because "no data" and "below the minimum" are different claims.

Defaults are general adult male reference values: fibre 30 g, sugar 36 g, sodium
2300 mg, cholesterol 300 mg, calcium 1000 mg, iron 8 mg. Iron is 8 mg because that
is the adult male RDA — 18 mg is the figure for menstruating women. Fill in **My
profile** and these are calculated for you instead. Edit any of them under
Settings → Daily targets → **Other nutrients**, or clear one to switch its flag off.

**Daily or weekly.** Sugar and sodium are judged day by day, because their effects
— blood glucose, blood pressure — genuinely are acute. Cholesterol, calcium and
iron act over weeks, through stores and bone turnover, so those three show a
**7-day average** and one heavy or light day is not a miss. Days with nothing
logged are left out of the average rather than counted as zero.

**Sugar is three numbers, not one.** A single total-sugars figure punished a glass
of milk exactly as hard as a fizzy drink, which is nonsense — so it is split:

- **Added sugar** is the one worth limiting: table sugar, jaggery, honey, syrup,
  concentrated juice. Target 36 g, the WHO free-sugars line. This is the only
  sugar row that ever turns red.
- **Natural sugar** is lactose and fruit sugar. There is no health guideline
  telling anyone to eat less fruit or drink less milk, so its 100 g ceiling is
  informational and stays a quiet grey even when you go past it.
- **Total sugar** is the raw figure the other two come from, and carries no
  target at all.

Natural sugar is worked out as total minus added, and **only for foods where both
are on record**. One food missing its added-sugar figure makes the split partial
for the day, and the app says so — naming the food — rather than printing a
number that quietly excludes it.

120 of the 123 seeded foods carry a real added-sugar value: 0 for plain rice, dal,
milk, curd, meat and dates, and the honest figure for karak chai, kunafa, basbousa
and the fizzy drinks. Three are deliberately left unknown, because the true answer
varies too much to fake: pickle (sweet mango against plain lime), whey powder (all
in the flavouring) and peanut butter (natural has none, commercial has plenty).

Open Food Facts publishes `added-sugars_100g`, but it is crowd-entered and
unvalidated — there are live products listing 10 g added against 9.4 g total,
which cannot be true. Anything above the total is dropped as a data error rather
than imported. The AI estimator is asked for both figures separately and is told
that null beats a guess; a reply where added exceeds total has the added figure
discarded before you ever see it.

**Entries logged before the split** keep their one sugar number as total sugar,
with added sugar reading "—" rather than a fabricated 0. Re-saving such an entry
in the portion sheet adopts the food's current figures, same as the earlier
micronutrient migration.

**Portions.** Every food has grams plus household portions — *1 idli · 45 g*,
*1 plate · 400 g*, *3 dates · 24 g*. Everything recalculates live as you change
the number, and shows what percentage of your day the portion is.

**Repeat meals.** Foods you log show as Quick add chips on the Today screen with
the grams you last used. One tap logs them, with an Undo in the toast.

**Fixing the numbers.** Foods tab → tap any food → edit its per-100 g values.
Your version overrides the built-in one from then on. The editor cross-checks
your macros against your calories and warns if they don't add up. Already-logged
entries keep the numbers they were logged with, so history never shifts under you.

**Other days.** The arrows and the date in the header move the whole log. Adding
food while on a past date logs it to that date — useful after a long shift.

---

## The bell

Reminders used to be scattered — a burn banner on Today, a workout banner on
Workout, a skippable "finish yesterday" prompt — so knowing what was outstanding
meant visiting tabs to check. The bell in the header aggregates all of it and is
reachable from every tab.

It was a bell rather than a seventh tab because six tabs already sit at 62 px on
a 375 px screen; a seventh drops them to 53 px and "Settings" starts to clip.

**The badge counts only things with an action**: burn check-ins, each unfinished
day, the workout reminder, a region that failed to download, and the one-time
profile nudge. Nutrient warnings and the day's AI suggestion are listed but not
counted — they are worth knowing, not tasks to clear, and a badge that never
reaches zero stops meaning anything.

The list is grouped: **Needs you**, then **Today**, then **Setup**. Tapping any
row goes to where you would act on it — a check-in row opens the check-in sheet,
an unfinished day opens that day's sheet with the date already set, a nutrient
warning opens Today with the breakdown expanded.

**One producer, three consumers.** `pendingItems()` computes the list; the Today
banner, the Workout banner and the bell all render from it. They differ in how
much they show, never in what is true. Nutrient warnings come from the same
`microVerdicts()` the Full breakdown grid draws, so the two cannot drift apart.

**Dismissal is deliberately not baked into the producer.** Swiping a banner away
silences it for that session; the bell still lists the thing, because "I
dismissed it this morning" is not the same as "it is done". The hub is where you
find what has quietly piled up — and unlike the banner, which shows the oldest
unfinished day, it lists every one.

**Nothing here touches the network.** The AI suggestion shows its cached text or
is simply absent; there is no call to make.

One judgement call worth flagging: the workout reminder does **not** fire on a
fresh install. The 6 am default is a starting point, not a commitment, and
opening a new app to "workout not done" plus a badge for a schedule nobody chose
is noise. It starts once you tick an exercise or set your own time, and the
Workout tab says so while it waits.

---

## My profile

Optional. Skip it and everything above still works on generic adult values.

Fill in height, weight, age and sex and the targets are calculated instead of
assumed. **BMR** uses Mifflin-St Jeor (1990), which the Academy of Nutrition and
Dietetics prefers over Harris-Benedict for predictive accuracy. **Maintenance**
comes from your real burn where there is any — three days of check-ins is enough
— because a measured figure beats a guessed activity multiplier every time. Apple
Health reports *active* energy, so it is added to BMR rather than multiplying it,
with 10 % on top for the thermic effect of food.

**Goals are capped at what the evidence supports.** Gaining is limited to 0.5 % of
bodyweight a week, losing to 1 %, and calories never go below your BMR. Ask for
10 kg in 6 weeks at 72 kg and it says so plainly: that is 1.67 kg a week, it caps
to 0.36, and it tells you the honest answer is about 28 weeks. Faster gain is
mostly fat; steeper deficits cost the muscle a gaining phase is for.

**Protein** follows the training literature: 1.8 g/kg gaining, 2.2 g/kg in a
deficit to protect lean mass, 1.6 g/kg maintaining — the range where gains plateau
in Morton et al. (2018) and Helms et al. (2014). Fat holds at 25 % of energy with
a floor of 0.8 g/kg and 20 % of calories; carbs take the remainder.

**Focus areas and free text combine.** Chips and typed text are both things you
asked for, so both apply — tick *Specific muscle gain* and type *"my hair is
shedding"* and you get the muscle protein target **and** the raised iron. Where
they speak to the same nutrient, the chip wins: you tapped it deliberately, the
text was read by a model. Two chips still compound with each other; so does text
with itself. Only chip-versus-text is a conflict.

If the model cannot turn what you typed into a nutrition emphasis, the app says
so in amber and asks you to rephrase or use a chip — rather than storing an
empty result and leaving you thinking your goal was taken into account. Unchanged
text is not re-sent on later recalculations, so a weekly weight update does not
spend a call re-reading an answer already known.

**Focus areas** shift the emphasis. Hair growth raises iron and protein, because
low ferritin is the most common dietary factor in shedding. Belly and full-body
fat loss raise protein and fibre for satiety and tighten sugar. Muscle gain pushes
protein toward the top of the range. The free-text box goes to the model, which
maps it onto the same fixed list — it can shift emphasis, it cannot invent a
nutrient. With no key, a keyword pass covers the obvious cases offline.

Every source is cited in the code comments above `computeTargets`, so the
arithmetic can be checked rather than trusted.

**Water follows the weather.** Type your city once — it is geocoded and cached, so
there is no location permission prompt and nothing precise leaves the device.
35 ml/kg is the baseline, plus roughly 600 ml per 1000 kcal of measured activity,
plus 4 % per degree above 27 °C capped at +50 %. In Riyadh at 43 °C that is the
difference between 2,900 ml and 3,800 ml. Open-Meteo needs no key and no account.
Offline, the last good forecast is used and its age is shown; with no city at all
it assumes warm rather than temperate.

**Nothing is ever taken from you.** Type over any target and it is tagged
**CUSTOM** and skipped by every recalculation. Update your weight weekly, tap
Recalculate, and anything you set by hand is listed with its old and new value so
you can tick which to accept — the rest update silently. Each custom row carries
its own reset, and it stops being custom the moment you take the calculated value.

---

## Workout

Its own tab. Bodyweight only, no equipment, built around 15-20 minutes between
shifts.

Pick a focus — upper body, lower body, full body, aerobic, muscle gain or weight
loss — and the session is built from push, legs, pull, conditioning and a core
finisher that runs whatever the focus. If My Profile has a goal, the focus starts
on the matching one; tapping any chip overrides that for good.

**The timing is circuit-based, and computed rather than typed.** One round of
every exercise, then repeat, three rounds in all — moving straight on between
exercises and taking about a minute between rounds. That is what makes three sets
of everything fit: charging a full rest after every individual set instead put
sessions at 23-32 minutes, well past what this is for. If a session still runs
long, the longest block is trimmed until it fits, so changing a rep count later
cannot quietly break the promise on the card. All six focuses currently land
between 18 and 20 minutes.

**Tick exercises as you go.** The session counts as done when every one is ticked,
but a half-finished session after a long shift still shows what you managed rather
than nothing. Untick everything and the day is dropped entirely. A streak counts
consecutive complete days, and an unfinished today does not break it before the
day is over.

**Reminders** work like the burn check-ins: no server, so nothing is pushed. Set
any number of workout times in Settings; when one has passed and nothing is ticked
off, the Workout tab shows a banner. Ticking anything silences it for the day.

---

## Backup — please actually do this

iOS clears website data for sites you haven't opened in a while. Adding the app
to your Home Screen makes that much less likely, but it is not a guarantee.

Settings → **Export backup** writes a `.json` file to Files. Do it every few
weeks. **Import backup** merges it back in on any device. The backup carries your
food library, log, water, barcode renames and targets — but not your API key, so
you'll paste that in again on a new device.

---

## Files

| File | What it is |
|---|---|
| `index.html` | All markup — six tabs and the bottom sheets |
| `styles.css` | Mobile-first styling, automatic light/dark |
| `foods.js` | The built-in food database + its micronutrient table |
| `regions/` | North Indian, Pakistani and Filipino libraries, fetched on demand |
| `app.js` | All logic — storage, search, OFF lookups, totals, water, scanning, AI, the nutrition engine |
| `vendor/` | html5-qrcode, committed so scanning works offline |
| `sw.js` | Service worker; caches the app shell for offline use |
| `manifest.webmanifest` | PWA metadata for Add to Home Screen |
| `icons/` | App icons |

If you edit any shell file, bump `CACHE` at the top of `sw.js` so the change
reaches devices that already installed the app.

---

## On the nutrition numbers

The seeded values are averages for home-style cooking, drawn from Indian food
composition tables, USDA data, and typical Gulf restaurant preparations. Real
dishes vary a lot — how much oil goes into your sambar, how much ghee is on the
dosa, how fatty the mutton is. They're good enough to trend against and to keep
you honest about protein; they are not lab measurements. Weigh what you can, and
correct any food whose numbers look wrong for how yours is actually made.

Nothing here is medical or dietary advice. If you want the surplus and protein
split dialled in properly for your bodyweight and training, that's a
conversation for a dietitian.

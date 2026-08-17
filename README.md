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

**Adding food.** Type a name in the Add tab. Your own library (110+ pre-seeded
South Indian, Gulf, and protein-staple foods) matches instantly and appears
first. Open Food Facts is queried in parallel for packaged and branded items and
appears under "Packaged foods". Nothing found? Tap *Add "…" manually*, enter the
per-100 g values once, and it's in your library forever.

Local-first rather than strictly OFF-first: for idli or kabsa the local hit is
both faster and more accurate, and you still see every packaged match below it.

**Barcodes.** Tap **Scan** next to the search box to open the camera and point it
at the barcode; it looks the product up automatically and drops you straight on
grams entry. You can also type or paste the number (8–14 digits) into the search
box, or into the scanner's own field. Typed lookups hit OFF's product endpoint
directly, which is far more reliable than its free-text search.

If the camera is blocked or unavailable the scanner says why — including the iOS
path to re-enable it — and puts the manual number field right there. The scanner
library is vendored in `vendor/`, so scanning keeps working offline and doesn't
depend on a CDN. It only loads the first time you tap Scan.

**Arabic product names.** Gulf barcodes often come back Arabic-only. The app asks
Open Food Facts for the English fields first (`product_name_en`, then
`generic_name_en`). If there's still no English name, the portion sheet says so
and offers **Rename** — the name you type is stored against that barcode, so
every future scan of that product uses your name.

**Burn & balance.** Four fixed check-ins a day — 8:00 AM, 12:00 PM, 5:00 PM,
10:30 PM. At each one you type the **cumulative** total Apple Health is showing;
you never work out a difference yourself.

Apple Health resets at midnight, so the 8am reading *is* the midnight-to-8am
segment with nothing subtracted. Every later segment is that reading minus the
one before it. Balance is eaten minus burned — a surplus shows green because
that's what builds weight on a bulk, a shortfall shows amber.

Miss a check-in and the two windows merge into one wider row, labelled with what
was missed. Because the readings are cumulative, the later one still contains
that burn, so the merged figure is exact rather than estimated — nothing is lost
and the segments still sum to the day total. Food eaten after your last check-in
gets its own row with burn shown as "—", since there's no reading to compare it
against yet. A reading that would go *down* is refused with an explanation,
because a cumulative total that falls is a typo.

**Meal times.** Every log entry carries the time you ate, pre-filled with the
current time and editable in the portion sheet. Log breakfast at 2pm because you
were on shift and you can correct it to 07:30, so it lands in the right segment.
Entries logged before this existed fall back to when they were saved.

**Check-in reminders.** There's no server, so there are no push notifications —
your iPhone Reminders do the nudging. When you open the app it checks the clock
against the four times and shows a dismissible banner for every checkpoint that
has passed unlogged, each with its own input. Open it at 3pm having missed 8am
and 12pm and you get both rows at once. Dismissing lasts for the session, so the
nudge returns next time you open the app rather than vanishing for the day.

**Week.** Its own tab. The same topbar arrows step by week instead of by day.
Per day: burned, eaten, balance and protein against target, plus averages that
cover only the days with data — a day you logged nothing is left out rather than
dragged down as a zero.

**Meal suggestions.** Saving a check-in automatically asks the model what to eat
next, given your remaining calories and protein, everything logged so far with
times, your burn/eaten balance, and 55 foods from your own library with their
per-100 g values. It's told to name only foods from that list, so you get "add
150 g chicken breast and 3 idli with sambar" rather than generic advice.

Read-only — it never saves anything, so there's no confirm step. Each suggestion
is cached against its checkpoint, so re-opening the app doesn't spend another
call; **Suggest again** forces a fresh one. Four calls a day sits inside
OpenRouter's limits, but free models share a daily cap with barcode estimates —
if a retry gets throttled the previous suggestion stays on screen and the footer
says the retry failed.

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
the answer is sane. The default model is `openai/gpt-oss-20b:free`; any OpenRouter
model id works.

Your key lives in this browser's localStorage and nowhere else. It is not in the
repo, and it is deliberately **excluded from backup exports** — a backup file
tends to get emailed or synced around, and a leaked key is someone else spending
your credit. The model name does travel in the backup; the key never does.

No proxy is needed. OpenRouter returns `access-control-allow-origin: *`, so the
browser calls it directly from the Pages origin. (For reference, Anthropic also
works browser-direct via its `anthropic-dangerous-direct-browser-access` header,
and OpenAI echoes the requesting origin — but Gemini's endpoint rejected the
preflight, so it would need a proxy.)

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
| `index.html` | All markup — four tabs and two bottom sheets |
| `styles.css` | Mobile-first styling, automatic light/dark |
| `foods.js` | The seeded food database + its micronutrient table |
| `app.js` | All logic — storage, search, OFF lookups, totals, water, scanning, AI |
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

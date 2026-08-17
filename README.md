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
weeks. **Import backup** merges it back in on any device.

---

## Files

| File | What it is |
|---|---|
| `index.html` | All markup — four tabs and two bottom sheets |
| `styles.css` | Mobile-first styling, automatic light/dark |
| `foods.js` | The seeded food database + its micronutrient table |
| `app.js` | All logic — storage, search, OFF lookups, totals, water, scanning |
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

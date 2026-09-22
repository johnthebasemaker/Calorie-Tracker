# Play Store listing assets

Generated for `com.john3004.calorietracker`. Everything here is reproducible:

```bash
python3 scripts/store-assets.py     # icon + feature graphic
```

Screenshots were captured from the signed release build on an API 36 emulator
with a real day of food logged, not mocked up.

## Text

| File | Play field | Length |
|---|---|---|
| `short-description.txt` | Short description | 65 / 80 |
| `full-description.txt` | Full description | 3,584 / 4,000 |

## Graphics

| File | Play field | Spec |
|---|---|---|
| `icon-512.png` | App icon | 512×512, 24-bit, 39 KB |
| `feature-graphic.png` | Feature graphic | 1024×500, no alpha, 58 KB |

## Screenshots

All are 24-bit PNG with no alpha, well under the 8 MB limit.

| Folder | Play field | Size | Count |
|---|---|---|---|
| `screenshots/phone/` | Phone screenshots | 1080×1920 (9:16) | 6 |
| `screenshots/tablet-7/` | 7-inch tablet | 1200×1920 | 5 |
| `screenshots/tablet-10/` | 10-inch tablet | 1600×2560 | 5 |
| `screenshots/phone-tall-1080x2400/` | alternative, see below | 1080×2400 (9:20) | 7 |

### Why there are two phone sets

The emulator's native resolution is 1080×2400, which is 9:20 — taller than the
9:16 Play documents for phone screenshots. Play's uploader is usually lenient
about this, but there is no reason to find out during a submission, so the set
to upload is the 1080×1920 one. The tall set is kept because it shows more of
each screen and includes an extra shot (`04-portions`), and is worth using if
you would rather have the taller framing and the uploader accepts it.

### Suggested order

Play shows the first two most prominently:

1. `01-today` — the headline: calories, macros, water, a real day's log
2. `03-search` — six South Indian dosa variants plus Open Food Facts results;
   this is the thing no other tracker does well
3. `02-nutrients` — the eight-nutrient breakdown with over/under flags
4. `06-week` — a full week with averages
5. `05-workout` — the workout tab
6. `07-settings` — personalised targets

## Still needed in the Console

Neither can be generated here:

- **Content rating questionnaire** — answer it in the Console. There is no user
  content, no ads, no purchases and no data collection, so it should come back
  as rated for everyone.
- **App category** — Health & Fitness.
- **Contact email** — Play requires one on the listing. The privacy policy
  points at the repository's issue tracker instead, so no personal address is
  published on the web page itself.

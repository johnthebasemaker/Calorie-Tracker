# Removed on 16 October 2026 (disk cleanup)

These folders were removed to free disk space, with your confirmation. **Your
own code, documents and data were not touched.** Everything removed here can be
rebuilt.

| Removed | Size | What it was |
|---|---|---|
| `node_modules/` | 68 MB | JavaScript packages |
| `android/app/build, android/build` | ~77 MB | Android build output |

## Only reinstall if you need this again

- Rebuild only when you work on this project again; until then nothing is
  missing that you use.
- Every step below **downloads from the internet**, and some downloads are
  large.
- Before running a step, ask Claude. It will tell you what will be downloaded
  and how big it is, and **wait for your yes**.

**The packages (`node_modules/`):**

```bash
npm ci
```

**The Android build folders** (`android/app/build`, `android/build`, `android/.gradle`) are made again the next time you build the app (Android Studio, or the project's Android build script). Nothing to do until then.


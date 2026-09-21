# Releasing the Android app

App: **Calorie Tracker**
Application id: `com.john3004.calorietracker` — **must never change.** Google
treats a different id as a different app, with a new install base and no
upgrade path for anyone already on the old one.

The web version at <https://johnthebasemaker.github.io/Calorie-Tracker/> is
unaffected by any of this. GitHub Pages still serves the files from the repo
root; the Android build only *copies* them.

---

## One-time setup: create the upload key

You have to do this part yourself, because it means choosing passwords.

```bash
"/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" \
  -genkeypair -v \
  -keystore android/upload-keystore.jks \
  -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

It asks for a keystore password, your name and organisation, and then a key
password (pressing Return reuses the keystore password, which is fine).

Then copy the template and fill in what you just chose:

```bash
cp android/keystore.properties.example android/keystore.properties
```

```properties
storeFile=upload-keystore.jks
storePassword=<the keystore password>
keyAlias=upload
keyPassword=<the key password>
```

Both `android/keystore.properties` and `*.jks` are gitignored and must stay
that way.

### Back the key up before you upload anything

**If you lose this file you cannot ship an update again** without asking Google
to reset the upload key, which takes days. Copy `upload-keystore.jks` and the
passwords somewhere durable — a password manager, not this repo.

The key that now exists was created on 2026-09-21 and is valid until
2054-02-06. Its SHA-256 fingerprint, which must never change:

```
DF:CF:69:8F:44:A2:C7:5C:29:18:C6:1A:68:06:B9:A3:EA:72:DD:C2:EA:9B:1E:B2:E2:6A:97:BD:8F:D9:30:DD
```

Check a keystore against that at any time with:

```bash
"/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" \
  -list -v -keystore android/upload-keystore.jks
```

---

## Every release

1. **Bump the version** in `android/app/build.gradle`. `versionCode` must be a
   whole number strictly higher than the live listing — check the Play Console
   dashboard first. `versionName` is the string users see.

   ```
   versionCode 3
   versionName "0.0.3"
   ```

   The live release is **0.0.2 / versionCode 2**.

2. **Build the bundle.**

   ```bash
   npm run android:aab
   ```

   That runs `scripts/build-www.mjs`, syncs the result into the native project
   and runs `bundleRelease`. The AAB lands at:

   ```
   android/app/build/outputs/bundle/release/app-release.aab
   ```

3. **Check it is signed with the real key**, not the debug fallback:

   ```bash
   "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" \
     -printcert -jarfile android/app/build/outputs/bundle/release/app-release.aab \
     | grep Owner
   ```

   `CN=Android Debug` means `keystore.properties` was not found and Play will
   reject the upload. The build warns loudly when this happens, but it does not
   fail — it still produces an APK you can test on the emulator.

4. **Upload** to Play Console → Testing → Internal testing → Create new release.

---

## What is already handled

You do not need to configure these in the Console; they are in the build.

| Play Console item | Where it is handled |
|---|---|
| Target API level 36 | `android/variables.gradle` |
| Deobfuscation / mapping file | `minifyEnabled true` embeds `proguard.map` in the AAB automatically. A check in `app/build.gradle` fails the build if it ever goes missing |
| App optimization (R8) | `minifyEnabled` + `shrinkResources` |
| Startup profile | `baseline.prof` is merged from library ART profiles and ships in the bundle |
| 16 KB page size | No native libraries at all, so it does not apply |
| Unused resources | `shrinkResources true`, plus `resourceConfigurations = ['en']` |
| Exact alarms | Deliberately **not** requested. `SCHEDULE_EXACT_ALARM` is stripped in the manifest and every notification sets `isExactNotification: false`, so no policy declaration is needed |
| Notification permission | `POST_NOTIFICATIONS`, requested at the moment the user switches reminders on, never at launch |

### Data Safety answers

Short, because the app genuinely does very little:

- **No data is collected or shared.** Everything is in WebView localStorage on
  the device. There is no account, no backend, no analytics and no ads.
- **Camera** is used only to decode a barcode in-process. No image is stored or
  transmitted; only the decoded number goes to Open Food Facts.
- **Android Auto Backup is disabled** (`android:allowBackup="false"`), so not
  even Google's backup sees the data. The reason is in the manifest comment: a
  backup would include the OpenRouter API key, which the app's own export
  deliberately leaves out.
- The three outbound calls — OpenRouter, Open Food Facts, Open-Meteo — are all
  optional features, and the first needs a key the user pastes in themselves.

---

## A note on `npm audit`

`package.json` pins `uuid` forward with an `overrides` block. Do not remove it,
and do not run `npm audit fix --force` if the warning returns.

The advisory is real but unreachable here: the vulnerable path is `uuid`'s
v3/v5/v6 with a `buf` argument, and the only thing in the tree that depends on
`uuid` is `xcode`, which calls `uuid.v4()` once, with no arguments, and only
when generating an **iOS** project. This is an Android-only build, and the
whole chain is a devDependency that never reaches a device.

What `--force` actually proposes is a *downgrade* of `@capacitor/cli` to 8.4.3,
which would leave the CLI out of step with `@capacitor/android`. Pinning the
leaf forward silences the finding without splitting the Capacitor versions.

---

## Installing over an existing build

If the emulator or phone already has a build signed with a **different** key —
for example a debug-signed test build from before the upload key existed —
`adb install -r` fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Android will
not let one signer replace another. Uninstall first:

```bash
adb uninstall com.john3004.calorietracker
```

That wipes the app's data, so export a backup first if it matters. This does
not affect Play updates, which are always signed with the same key.

---

## Testing on the emulator

```bash
bin/android-preview.sh boot       # headless emulator
bin/android-preview.sh install    # build + install the release APK
bin/android-preview.sh launch
bin/android-preview.sh shot NAME  # screenshot into .android-shots/
bin/android-preview.sh dark yes   # check the dark theme
bin/android-preview.sh stop
```

The emulator is shared with the Overtime Calculator project (`AVD=otc-test`).
The two apps have different package ids, so they coexist; set `AVD=` to use a
different device.

---

## Regenerating the icons

Edit `icons/icon-maskable-512.png`, then:

```bash
python3 scripts/android-assets.py
```

That rewrites every launcher icon and splash screen from that one file. Do not
hand-edit anything under `android/app/src/main/res/mipmap-*` — it is generated,
and the sizing is deliberate (see the comments in the script; an adaptive icon
is cropped to the central 72dp of a 108dp canvas, which magnifies the artwork
by 1.5x and is easy to get wrong).

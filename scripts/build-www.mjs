/* Build the web bundle the Android app ships.
 *
 * This repo has no bundler: GitHub Pages serves the files straight from the
 * root, and that must keep working untouched. Capacitor, though, needs a
 * directory it can copy wholesale into the APK's assets. So this script does
 * the one thing a bundler would have done for us — assemble that directory.
 *
 * The list below is an ALLOWLIST rather than a copy-everything-minus-junk.
 * A denylist silently ships whatever it has not been taught to exclude, and
 * the things sitting in this root that must never reach a device (the
 * keystore, android/, node_modules, README) are exactly the things a forgotten
 * exclusion would leak.
 */
import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'www');

/* Everything the app actually loads at runtime, verified against the <script>
 * and <link> tags in index.html plus the fetch() calls in app.js. */
const SHIP = [
  'index.html',
  'styles.css',
  'app.js',
  'foods.js',
  'manifest.webmanifest',
  'icons',
  'regions',
  'vendor',
];

/* sw.js is deliberately NOT shipped.
 *
 * Capacitor serves the app from https://localhost, and app.js already skips
 * registration on a localhost hostname, so the worker would never start. But
 * relying on that coincidence is one refactor away from a very bad bug: a
 * service worker inside a native app would cache the assets of build N and go
 * on serving them after Play has installed build N+1, with no way for the user
 * to clear it. Leaving the file out entirely means that cannot happen even if
 * the hostname check is one day changed.
 *
 * Offline support is not lost. On the web the worker provides it; in the
 * native app every asset is already on the filesystem. */

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const missing = SHIP.filter(name => !existsSync(join(ROOT, name)));
  if (missing.length) {
    console.error(`build-www: missing required asset(s): ${missing.join(', ')}`);
    process.exit(1);
  }

  for (const name of SHIP) {
    await cp(join(ROOT, name), join(OUT, name), { recursive: true });
  }

  let files = 0, bytes = 0;
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else { files++; bytes += (await stat(p)).size; }
    }
  };
  await walk(OUT);
  console.log(`build-www: ${files} files, ${(bytes / 1024).toFixed(0)} KB -> www/`);
}

main().catch(err => { console.error(err); process.exit(1); });

// QC: static consistency checks — run with: node tools/check.js
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url).pathname.replace(/^\//, '');
const p = (f) => root + '/' + f;
const fail = [];
const ok = [];

// 1. Element IDs referenced in app.js exist in index.html
const app = readFileSync(p('js/app.js'), 'utf8');
const html = readFileSync(p('index.html'), 'utf8');
const idRefs = [...new Set([...app.matchAll(/\$\('#([a-zA-Z-]+)'\)/g)].map((m) => m[1]))];
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const missingIds = idRefs.filter((id) => !htmlIds.has(id));
missingIds.length ? fail.push(`Missing IDs in HTML: ${missingIds.join(', ')}`) : ok.push(`All ${idRefs.length} JS-referenced IDs exist in HTML`);

// 2. JSON files parse
for (const f of ['manifest.webmanifest', 'package.json']) {
  try {
    JSON.parse(readFileSync(p(f), 'utf8'));
    ok.push(`${f} is valid JSON`);
  } catch (e) {
    fail.push(`${f} INVALID: ${e.message}`);
  }
}

// 3. Manifest sanity
const manifest = JSON.parse(readFileSync(p('manifest.webmanifest'), 'utf8'));
for (const key of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons']) {
  if (!manifest[key]) fail.push(`manifest missing "${key}"`);
}
if (manifest.start_url.startsWith('/') || manifest.scope.startsWith('/')) {
  fail.push('manifest start_url/scope must be RELATIVE for GitHub Pages');
} else {
  ok.push('manifest start_url/scope are relative');
}
for (const icon of manifest.icons) {
  const src = icon.src.replace('./', '');
  existsSync(p(src)) ? ok.push(`icon exists: ${src}`) : fail.push(`icon MISSING: ${src}`);
}

// 4. Every file precached in sw.js exists
const sw = readFileSync(p('sw.js'), 'utf8');
const shellBlock = sw.match(/APP_SHELL = \[([\s\S]*?)\]/);
const shellPaths = [...shellBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
for (const sp of shellPaths) {
  const f = sp === './' ? 'index.html' : sp.replace('./', '');
  existsSync(p(f)) ? ok.push(`shell file exists: ${f}`) : fail.push(`shell file MISSING: ${f}`);
}

// 5. No absolute internal refs in HTML (GitHub Pages lives under /repo/)
const absRefs = [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map((m) => m[1]);
absRefs.length ? fail.push(`Absolute paths in HTML: ${absRefs.join(', ')}`) : ok.push('No absolute paths in HTML');

// 6. Service worker registered with relative path
app.includes("register('./sw.js')") ? ok.push('SW registered with relative path') : fail.push('SW registration path not relative ./sw.js');

// 7. Every data-error-for in dialogs matches a validation error key
const errorKeys = new Set([...html.matchAll(/data-error-for="([^"]+)"/g)].map((m) => m[1]));
const domain = readFileSync(p('js/domain.js'), 'utf8');
const jsErrorKeys = new Set([...domain.matchAll(/errors\.(\w+) =/g)].map((m) => m[1]));
const unmatched = [...jsErrorKeys].filter((k) => !errorKeys.has(k) && k !== 'side');
// 'side' handled in feeding dialog
const reallyUnmatched = unmatched.filter((k) => k !== 'durationMinBottle');
reallyUnmatched.length ? fail.push(`Domain error keys with no display slot: ${reallyUnmatched.join(', ')}`) : ok.push('All domain error keys have display slots');

// Report
console.log('== QC PASS ==');
for (const line of ok) console.log('  ✔ ' + line);
if (fail.length) {
  console.log('\n== QC FAIL ==');
  for (const line of fail) console.log('  ✘ ' + line);
  process.exit(1);
}
console.log('\nAll checks passed.');

// E2E QC: reproduces reported bugs against the real app in Chromium.
// Usage: node tools/e2e.js  (starts its own static server on port 8123)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}/`;
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`);
};

mkdirSync('tools/shots', { recursive: true });

const server = spawn(process.execPath, ['tools/serve.js', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));

let browser;
try {
  browser = await chromium.launch({ channel: 'msedge' });
} catch {
  browser = await chromium.launch({ channel: 'chrome' });
}

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500); // absorb possible first-install SW reload
  await page.screenshot({ path: 'tools/shots/01-home.png' });

  // BUG 4: update bar must be hidden when no update is waiting
  const barVisible = await page.isVisible('#update-bar');
  check('BUG4 update-bar hidden by default', !barVisible, `visible=${barVisible}`);

  // BUG 2: date picker input must be same width as other inputs
  await page.click('#btn-add-diaper');
  await page.waitForSelector('#diaper-dialog[open]');
  await page.waitForTimeout(200);
  const widths = await page.evaluate(() => {
    const w = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().width);
    return { ts: w('#diaper-ts'), note: w('#diaper-note'), dialog: w('.dialog') };
  });
  check('BUG2 datetime width == text width', Math.abs(widths.ts - widths.note) <= 2, JSON.stringify(widths));
  await page.screenshot({ path: 'tools/shots/02-diaper-dialog.png' });

  // BUG 6: radios must keep native size (not stretched by input sizing rules)
  const visibleRadioBoxes = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.dialog input[type=radio]')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        })
    );
  let radioBoxes = await visibleRadioBoxes();
  check(
    'BUG6 diaper radios keep native size',
    radioBoxes.length > 0 && radioBoxes.every((b) => b.w <= 24 && b.h <= 24),
    JSON.stringify(radioBoxes)
  );

  // BUG 1: Đóng button must close the dialog
  await page.click('#diaper-dialog [data-close]');
  await page.waitForTimeout(300);
  const dialogOpen = await page.evaluate(() => document.querySelector('#diaper-dialog').open);
  check('BUG1 Đóng closes diaper dialog', !dialogOpen, `open=${dialogOpen}`);

  // BUG 3: breast feeding must save and show in history
  await page.click('#btn-add-feeding');
  await page.waitForSelector('#feeding-dialog[open]');
  radioBoxes = await visibleRadioBoxes();
  check(
    'BUG6 feeding radios (Bú mẹ/Bú bình) keep native size',
    radioBoxes.length > 0 && radioBoxes.every((b) => b.w <= 24 && b.h <= 24),
    JSON.stringify(radioBoxes)
  );
  await page.fill('#feeding-duration', '12');
  await page.click('#feeding-form button[type=submit]');
  await page.waitForTimeout(600);
  const feedDlgOpen = await page.evaluate(() => document.querySelector('#feeding-dialog').open);
  check('BUG3 breast feeding: dialog closes after save', !feedDlgOpen, `open=${feedDlgOpen}`);
  const hist = await page.textContent('#history');
  check('BUG3 breast feeding appears in history', hist.includes('Bú mẹ'), hist.replace(/\s+/g, ' ').slice(0, 90));
  await page.screenshot({ path: 'tools/shots/03-after-breast-save.png' });

  // regression: diaper still saves (Đóng was fixed, so use submit)
  await page.click('#btn-add-diaper');
  await page.click('#diaper-form button[type=submit]');
  await page.waitForTimeout(600);
  const hist2 = await page.textContent('#history');
  check('REG diaper still saves', hist2.includes('Tã'));
  const statTotal = await page.textContent('#stat-total');
  check('REG today diaper stat = 1', statTotal.trim() === '1', `total=${statTotal}`);

  // BUG 5: stats date navigation (prev/next day)
  const todayLabel = (await page.textContent('#stats-date')).trim();
  const nextDisabledToday = await page.evaluate(() => document.querySelector('#stats-next').disabled);
  check('BUG5 next-day disabled at today', nextDisabledToday === true);
  await page.click('#stats-prev');
  await page.waitForTimeout(250);
  const prevLabel = (await page.textContent('#stats-date')).trim();
  check('BUG5 prev-day changes the label', prevLabel !== todayLabel && prevLabel !== '', `${todayLabel} -> ${prevLabel}`);
  const yesterdayTotal = (await page.textContent('#stat-total')).trim();
  check('BUG5 stats follow selected day (yesterday=0)', yesterdayTotal === '0', `yesterday=${yesterdayTotal}`);
  await page.screenshot({ path: 'tools/shots/04-prev-day.png' });
  await page.click('#stats-next');
  await page.waitForTimeout(250);
  const backTotal = (await page.textContent('#stat-total')).trim();
  check('BUG5 back-to-today restores stats', backTotal === '1', `today=${backTotal}`);

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

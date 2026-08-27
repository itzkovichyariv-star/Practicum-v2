#!/usr/bin/env node
/**
 * dev-render-check.mjs — the app must still render under `astro dev`, not only in dist/.
 *
 * 2026-08-27. Yariv's ship run died at the warming step: "STILL BLANK", with the
 * built-in advice to clear the Vite cache. The cache was innocent. The dev server was
 * refusing to transform a file:
 *
 *   [vite] Internal server error: src/components/PlacementStrip.tsx:
 *   Identifier 'PlacementChip' has already been declared.
 *
 * A duplicated type import, mine, from an hour earlier. The reason nothing caught it is
 * the point of this file:
 *
 *   · `astro build` PASSED. Rollup/esbuild elides type-only imports before anything can
 *     object to two of them, so the production bundle was correct and shipped fine.
 *   · Every offline check in this directory serves `dist/`. They drove the real screens,
 *     found the real rows, and all six were green — against a bundle that was never in
 *     question.
 *   · `astro dev` transforms each module separately through Babel, which does object.
 *     One dead module takes the whole island with it, so the page answers 200 and
 *     renders nothing but the version stamp.
 *
 * So "the build passes" and "the offline checks pass" were both true and neither was
 * evidence. The gap is exactly one thing: nobody ran the dev server. This does, on a
 * port of its own, and asserts the app appears — which is the same question ship.mjs
 * asks before it lets the gate start, just asked early enough to be cheap.
 *
 * No Supabase, no fixtures: the sign-in screen renders on its own, and a transform
 * error takes even that away. Anything that hydrates at all clears this bar.
 *
 *   node scripts/dev-render-check.mjs
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = 4329;                    // clear of ship (4325) and of every other check
const URL_ = `http://127.0.0.1:${PORT}`;
const BOOT_TIMEOUT_MS = 90_000;

let log = '';
// detached so the whole process GROUP can be killed: `npx` forwards nothing useful,
// and a surviving astro would hold the port and outlive this script.
const dev = spawn('npx', ['astro', 'dev', '--port', String(PORT)], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: false, detached: true,
});
dev.stdout.on('data', d => { log += d; });
dev.stderr.on('data', d => { log += d; });

let stopped = false;
const stop = () => {
  if (stopped) return; stopped = true;
  try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* group already gone */ }
  try { dev.kill('SIGKILL'); } catch { /* already gone */ }
};
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

const reachable = async () => {
  try { const r = await fetch(URL_ + '/', { signal: AbortSignal.timeout(2500) }); return r.ok; }
  catch { return false; }
};

console.log('\ndev-render-check — does the app survive the dev transform?\n');

const startedAt = Date.now();
let up = false;
while (Date.now() - startedAt < BOOT_TIMEOUT_MS) {
  if (await reachable()) { up = true; break; }
  await new Promise(r => setTimeout(r, 800));
}

// Astro silently moves to the next free port when this one is taken, which would leave
// us measuring somebody else's server. Its own banner is the only honest witness.
const movedTo = log.match(/Port \d+ is in use, trying another one/i);
if (movedTo) {
  console.error(`✗ port ${PORT} was already in use, so this ran against something else.`);
  console.error('  Free it and retry:  lsof -ti tcp:' + PORT + ' | xargs kill -9');
  stop();
  process.exit(1);
}

if (!up) {
  console.error(`✗ the dev server never answered on ${URL_}.`);
  console.error(log.split('\n').filter(l => /error/i.test(l)).slice(0, 5).join('\n') || log.slice(-600));
  stop();
  process.exit(1);
}
console.log(`  ✓ dev server answered after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
             '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const pg = await (await browser.newContext()).newPage();
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));

// Every wait here is bounded, and that is not fussiness: on a BROKEN page the module
// requests abort rather than settle, so `networkidle` never arrives and each attempt
// burns Playwright's full default timeout. The first version of this check took longer
// to report the failure than the failure took to happen.
let text = '';
for (let i = 0; i < 6; i++) {
  await pg.goto(URL_ + '/', { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
  // Null-safe on purpose: the predicate starts polling while the document is still
  // being replaced, and a bare document.body.innerText throws on the first tick — which
  // this script's own pageerror listener then reported as if the APP had thrown.
  await pg.waitForFunction(() => (document.body?.innerText || '').trim().length > 40, null, { timeout: 6_000 })
    .catch(() => {});
  text = await pg.evaluate(() => (document.body?.innerText || '').trim()).catch(() => '');
  if (text.length > 40) break;
}
await browser.close();

// The version stamp renders from the Astro shell whether or not the island lives, so a
// page carrying nothing else is the exact signature of a module that failed to transform.
const ok = text.length > 40;
console.log(`  ${ok ? '✓' : '✗'} the app rendered — ${text.length} characters: "${text.replace(/\s+/g, ' ').slice(0, 70)}"`);

if (!ok) {
  const transform = log.split('\n').filter(l => /Internal server error|has already been declared|Transform failed|Failed to parse/i.test(l));
  console.error('\n✗ the dev server answers but the app never rendered.');
  if (transform.length) {
    console.error('  Vite refused to transform a module — this is the cause, and it is in the code:');
    for (const l of transform.slice(0, 5)) console.error('    ' + l.trim());
  } else if (pageErrors.length) {
    console.error('  the island threw at runtime:');
    for (const e of pageErrors.slice(0, 3)) console.error('    ' + e);
  } else {
    console.error(log.slice(-800));
  }
  stop();
  process.exit(1);
}

stop();
console.log('\n✅ dev-render-check passed');
process.exit(0);

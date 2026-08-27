#!/usr/bin/env node
/**
 * ship.mjs — dev server → gate → deploy, as ONE command that cannot be run wrong.
 *
 *   npm run ship            start the server, run the gate, deploy only if green
 *   npm run ship -- --dry   start the server and run the gate, then STOP. No deploy.
 *   npm run ship -- --check start the server, prove it is reachable, stop. No gate.
 *
 * Three separate accidents on 2026-08-13 cost a deploy each, and none of them were
 * about the code:
 *
 *   1. `npm run deploy   # only if the gate is green` — npm forwards trailing args
 *      to the script, so the COMMENT became six arguments to wrangler:
 *      "Unknown arguments: #, only, if, the, gate, is, green". A comment cannot
 *      guard a command; only an exit code can. Here the gate's exit code does.
 *
 *   2. `npm run dev &` serves 4321 while the gate looks at 4325, so the gate
 *      exited "dev server NOT reachable" and the deploy ran anyway, unguarded.
 *      Here one constant feeds both, and the deploy is downstream of the gate.
 *
 *   3. Backgrounded with `&`, the dev server is SUSPENDED by zsh the moment it
 *      reads the keyboard for Astro's shortcuts ("suspended (tty input)"), so it
 *      stops answering before the gate looks. Here it is spawned with stdio
 *      ignored — it has no terminal to read, so it cannot be stopped that way.
 *
 * The server is always torn down, including on Ctrl-C and on a failing gate.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.GATE_PORT || 4325);
const URL_ = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 90_000;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const checkOnly = args.includes('--check');

let dev = null;
function stopDev() {
  if (!dev || dev.killed) return;
  try { dev.kill('SIGTERM'); } catch {}
  dev = null;
}
process.on('SIGINT', () => { console.log('\ninterrupted — stopping the dev server'); stopDev(); process.exit(130); });
process.on('SIGTERM', () => { stopDev(); process.exit(143); });

const run = (cmd, argv, extraEnv) => new Promise(res => {
  const p = spawn(cmd, argv, { cwd: ROOT, stdio: 'inherit', shell: false, env: { ...process.env, ...extraEnv } });
  p.on('exit', code => res(code ?? 1));
  p.on('error', () => res(1));
});

async function reachable() {
  try {
    const ctl = AbortSignal.timeout(2500);
    const r = await fetch(URL_ + '/', { signal: ctl });
    return r.ok || r.status < 500;
  } catch { return false; }
}

console.log(`\n▸ starting the dev server on ${URL_}`);
console.log('  (stdin is detached on purpose — a backgrounded Astro that reads the');
console.log('   keyboard gets suspended by the shell and silently stops answering)\n');

// stdio 'ignore' is the load-bearing part: no tty to read, so no SIGTTIN, so no
// "suspended (tty input)". Astro's interactive shortcuts are lost; nothing else is.
// stdout/stderr are PIPED (stdin stays ignored, which is the part that mattered): with
// them discarded, a dev server that refuses to transform a module fails silently and the
// blank-app message below could only guess at a cache. It guessed wrong on 2026-08-27 and
// sent Yariv after `rm -rf node_modules/.vite` for a duplicated type import of mine.
let devLog = '';
dev = spawn('npm', ['run', 'dev', '--', '--port', String(PORT)], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: false, detached: false,
});
dev.stdout?.on('data', d => { devLog += d; });
dev.stderr?.on('data', d => { devLog += d; });
dev.on('exit', code => {
  if (code !== null && code !== 0 && dev) console.error(`✗ the dev server exited early (code ${code})`);
});

const startedAt = Date.now();
let up = false;
while (Date.now() - startedAt < READY_TIMEOUT_MS) {
  if (await reachable()) { up = true; break; }
  await new Promise(r => setTimeout(r, 800));
}

if (!up) {
  console.error(`✗ the dev server never answered on ${URL_} within ${READY_TIMEOUT_MS / 1000}s.`);
  console.error('  Run it by hand to see why:  npm run dev -- --port ' + PORT);
  stopDev();
  process.exit(2);
}
console.log(`✓ dev server up on ${URL_} after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

// A 200 from the shell is not readiness. Astro answers `/` immediately while Vite is
// still optimising dependencies, and a page requested during that window gets
// `504 (Outdated Optimize Dep)` for its island — the HTML arrives, nothing hydrates.
// The gate then ran against a blank app and reported REVIEW/ORG/SLOT/EMAIL as broken:
// always the EARLIEST suites, because they are the ones that arrive during the window
// (2026-08-18, four runs lost to it). So warm it with a real browser and wait for the
// app to actually appear before letting the gate start.
async function hydrated() {
  const { chromium } = await import('@playwright/test');
  const b = await chromium.launch();
  try {
    const pg = await (await b.newContext()).newPage();
    for (let i = 0; i < 20; i++) {
      await pg.goto(URL_ + '/', { waitUntil: 'networkidle' }).catch(() => {});
      const ok = await pg.evaluate(() => document.body.innerText.trim().length > 40).catch(() => false);
      if (ok) return true;
      await new Promise(r => setTimeout(r, 1500));
    }
    return false;
  } finally { await b.close().catch(() => {}); }
}

process.stdout.write('  warming the app (waiting for the island to hydrate)… ');
const warm = await hydrated();
console.log(warm ? 'ready' : 'STILL BLANK');
if (!warm) {
  console.error(`\n✗ the server answers but the app never rendered on ${URL_}.`);

  // Read the cause off the dev server before offering any remedy. A module Vite refused
  // to transform takes the whole island with it, the page still answers 200, and it
  // looks exactly like a cache problem while being a compile error in the code — one
  // that `astro build` can pass, because esbuild elides type imports before it could
  // object to a duplicate and Babel does not.
  const transform = devLog.split('\n').filter(l =>
    /Internal server error|has already been declared|Transform failed|Failed to parse|Pre-transform error/i.test(l));
  const moved = /Port \d+ is in use, trying another one/i.test(devLog);

  if (transform.length) {
    console.error('  Vite refused to transform a module. This is a compile error in the code,');
    console.error('  not a cache — clearing the cache will not touch it:\n');
    for (const l of [...new Set(transform.map(l => l.trim()))].slice(0, 5)) console.error('    ' + l);
  } else if (moved) {
    console.error(`  something else was already listening on ${PORT}, so Astro moved to another`);
    console.error('  port and the warming step measured the OTHER server. Free it and retry:');
    console.error(`    lsof -ti tcp:${PORT} | xargs kill -9 && npm run ship`);
  } else {
    console.error('  No transform error was reported, which does point at a stale Vite cache:');
    console.error('    rm -rf node_modules/.vite && npm run ship');
    const tail = devLog.trim().split('\n').slice(-8).join('\n');
    if (tail) console.error('\n  last lines from the dev server:\n' + tail.replace(/^/gm, '    '));
  }
  stopDev();
  process.exit(2);
}

if (checkOnly) {
  console.log('\n--check: server proven reachable. Not running the gate. Stopping.');
  stopDev();
  process.exit(0);
}

console.log('\n▸ deploy gate — lints, then every audit cell. Several minutes; do not interrupt.\n');
const gate = await run('node', ['scripts/deploy-gate.mjs']);

if (gate !== 0) {
  console.error(`\n✗ GATE FAILED (exit ${gate}). Nothing was deployed, and the version was NOT bumped.`);
  stopDev();
  process.exit(1);
}
console.log('\n✓ gate green');

if (dryRun) {
  console.log('--dry: stopping before the deploy, as asked.');
  stopDev();
  process.exit(0);
}

console.log('\n▸ deploying — predeploy stamps the version, then wrangler uploads dist/\n');
// The token scripts/require-gate.mjs demands. Set ONLY here, and only after the
// gate has actually exited 0 — that is what makes a bare `npm run deploy`, or a
// stale block pasted out of scrollback, refuse instead of shipping ungated.
const dep = await run('npm', ['run', 'deploy'], { SHIP_GATE_PASSED: '1' });
stopDev();

if (dep !== 0) {
  console.error(`\n✗ DEPLOY FAILED (exit ${dep}).`);
  console.error('  predeploy may already have bumped the version for a deploy that did not happen.');
  console.error('  Undo it with:  git checkout -- src/lib/version.ts public/sw.js');
  process.exit(1);
}
console.log('\n✅ deployed. Check the version stamp in the bottom-left corner of the app.');
process.exit(0);

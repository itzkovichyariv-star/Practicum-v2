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
dev = spawn('npm', ['run', 'dev', '--', '--port', String(PORT)], {
  cwd: ROOT, stdio: 'ignore', shell: false, detached: false,
});
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

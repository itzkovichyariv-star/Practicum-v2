#!/usr/bin/env node
/**
 * deploy-gate.mjs — run every audit cell file under scripts/audit/.
 * Exits 0 only if every cell passes. Use as the MANDATORY check before
 * `npm run deploy` (which calls `astro build && wrangler pages deploy`).
 *
 * Usage:
 *   node scripts/deploy-gate.mjs               # run everything
 *   node scripts/deploy-gate.mjs --only 01     # one suite by prefix
 *   node scripts/deploy-gate.mjs --skip-build  # skip dev-server probe
 *
 * Pairs with the family-tasks pattern:
 *   ~/.claude/projects/-Users-yarivitzkovich-Code-practicum-v2/memory/skill_visual_deploy_audit.md
 */
import { execSync, spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Derived, not pinned to one person's home directory — the gate has to run from
// whatever checkout it happens to sit in.
const ROOT = resolve(import.meta.dirname, '..');
// Every cell resolves its target as `AUDIT_BASE_URL || localhost:4325`. This line
// used to be a lone hard-coded literal, so the gate could demand one port while
// the cells were pointed at another. 2026-08-09 lost a run to that mismatch (cell
// 48); 2026-08-13 lost a deploy to its mirror image — the gate checked 4325 while
// `npm run dev` served 4321, exited "not reachable", and the deploy that followed
// ran unguarded. One expression now feeds both.
const DEV_URL = process.env.AUDIT_BASE_URL || `http://localhost:${process.env.GATE_PORT || 4325}`;
const args = process.argv.slice(2);
const onlyPrefix = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const skipBuildProbe = args.includes('--skip-build');

// 1. Confirm the dev server is reachable. Most cells boot a real
//    browser against it, so a missing dev server fails everything in
//    confusing ways.
if (!skipBuildProbe) {
  try {
    execSync(`curl -sf -o /dev/null -m 3 ${DEV_URL}`, { stdio: 'ignore' });
    console.log(`✓ dev server reachable at ${DEV_URL}`);
  } catch {
    console.error(`✗ dev server NOT reachable at ${DEV_URL}.
   Start it first: cd ${ROOT} && npm run dev`);
    process.exit(2);
  }
}

// 1b. Static lints first — they need no browser, take milliseconds, and catch whole
//     CLASSES of bug rather than one instance. Any scripts/audit/lint-*.mjs is picked up,
//     so adding one needs no wiring here.
const auditDir = join(ROOT, 'scripts/audit');
const lints = readdirSync(auditDir).filter((f) => /^lint-.+\.mjs$/.test(f)).sort();
for (const lint of lints) {
  console.log(`\n━━━ ${lint} ━━━`);
  const code = await new Promise((res) => spawn('node', [join('scripts/audit', lint)], { cwd: ROOT, stdio: 'inherit' }).on('exit', res));
  if (code !== 0) {
    console.error(`\n❌ DEPLOY GATE FAILED — ${lint} found a problem. Do NOT deploy.`);
    process.exit(1);
  }
}

// 1c. Offline checks — each serves dist/ locally and answers every off-origin call
//     from a fixture, so they drive the real screens without touching the live
//     project. They belong BEFORE the numbered cells: they are faster, they need no
//     seeding, and they are the only place the draft, intake and cancellation
//     guarantees are enforced at all.
//
//     Listed explicitly rather than globbed. scripts/ also holds health-check.mjs,
//     which talks to live services and is not this kind of check — a pattern match
//     would sweep it in and fail the gate for the wrong reason.
//
//     Skipped under --only, which means "run one suite".
const OFFLINE_CHECKS = [
  'candidates-archive-check.mjs',
  'form-drafts-check.mjs',
  'intake-safety-check.mjs',
  'interview-cancel-check.mjs',
];
if (!onlyPrefix) {
  console.log('\n━━━ building dist/ for the offline checks ━━━');
  const built = await new Promise((res) =>
    spawn('npx', ['astro', 'build'], { cwd: ROOT, stdio: 'inherit' }).on('exit', res));
  if (built !== 0) {
    console.error('\n❌ DEPLOY GATE FAILED — the build failed. Do NOT deploy.');
    process.exit(1);
  }
  for (const check of OFFLINE_CHECKS) {
    console.log(`\n━━━ ${check} ━━━`);
    const code = await new Promise((res) =>
      spawn('node', [join('scripts', check)], { cwd: ROOT, stdio: 'inherit' }).on('exit', res));
    if (code !== 0) {
      console.error(`\n❌ DEPLOY GATE FAILED — ${check} found a problem. Do NOT deploy.`);
      process.exit(1);
    }
  }
}

// 2. Run each audit file in sequence. We can't run in parallel because
//    Supabase writes from concurrent runs can collide and the headed
//    browsers compete for focus.
const files = readdirSync(auditDir).filter((f) => /^\d{2}-.+\.mjs$/.test(f)).sort();
const results = [];

// A failing suite is run ONCE more before it is believed.
//
// Until 2026-08-11 a red cell exited 0, so the gate could never fail on a wrong answer
// (only on a crash). Fixing that immediately exposed something the false green had been
// hiding for a long time: the suites are FLAKY. Four consecutive full runs failed on four
// DIFFERENT, disjoint sets of cells, and every single one of them passed when run on its
// own — suites run sequentially and the database is clean, so this is timing: cells wait
// with fixed sleeps, and sixty browser launches into a run the machine is slower than it
// is in isolation.
//
// A retry does NOT hide failures. It distinguishes non-deterministic from deterministic,
// which is the distinction that was actually missing: a suite that fails twice in a row is
// a real failure and still fails the gate. One that passes on the retry is reported, by
// name, as FLAKY — visible every run, so the list cannot quietly grow.
const flaky = [];
for (const file of files) {
  if (onlyPrefix && !file.startsWith(onlyPrefix)) continue;
  const t0 = Date.now();
  console.log(`\n━━━ ${file} ━━━`);
  const run = () => new Promise((res) => spawn('node', [join('scripts/audit', file)], { cwd: ROOT, stdio: 'inherit' }).on('exit', res));
  let code = await run();
  if (code !== 0) {
    console.log(`━━━ ${file} → exit ${code}; re-running once to see whether it is flaky or broken ━━━`);
    const second = await run();
    if (second === 0) flaky.push(file);
    code = second;
  }
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  results.push({ file, code, dur, flaky: flaky.includes(file) });
  console.log(`━━━ ${file} → exit ${code} (${dur}s)${flaky.includes(file) ? ' [FLAKY — passed on retry]' : ''} ━━━`);
}

// 3. Summary table + exit code.
console.log('\n========== Deploy Gate Summary ==========');
let anyFailed = false;
for (const r of results) {
  const mark = r.code === 0 ? (r.flaky ? '⚠️ ' : '✅') : '❌';
  console.log(`${mark} ${r.file.padEnd(40)} ${r.dur}s  exit=${r.code}${r.flaky ? '  (FLAKY — failed once, passed on retry)' : ''}`);
  if (r.code !== 0) anyFailed = true;
}
if (flaky.length) {
  console.log(`\n⚠️  ${flaky.length} FLAKY suite(s) — passed only on the second attempt:`);
  for (const f of flaky) console.log(`     ${f}`);
  console.log('   These are real instability, not noise to ignore: each one waits with a fixed');
  console.log('   sleep rather than for a condition. Replace the sleeps and this list empties.');
}
if (anyFailed) {
  console.error('\n❌ DEPLOY GATE FAILED — at least one cell did not pass. Do NOT deploy.');
  process.exit(1);
}
console.log('\n✅ DEPLOY GATE PASSED — safe to deploy.');

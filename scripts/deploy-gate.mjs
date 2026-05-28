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
import { join } from 'node:path';

const ROOT = '/Users/yarivitzkovich/Code/practicum-v2';
const DEV_URL = 'http://localhost:4325';
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

// 2. Run each audit file in sequence. We can't run in parallel because
//    Supabase writes from concurrent runs can collide and the headed
//    browsers compete for focus.
const auditDir = join(ROOT, 'scripts/audit');
const files = readdirSync(auditDir).filter((f) => /^\d{2}-.+\.mjs$/.test(f)).sort();
const results = [];

for (const file of files) {
  if (onlyPrefix && !file.startsWith(onlyPrefix)) continue;
  const t0 = Date.now();
  console.log(`\n━━━ ${file} ━━━`);
  const proc = spawn('node', [join('scripts/audit', file)], { cwd: ROOT, stdio: 'inherit' });
  const code = await new Promise((res) => proc.on('exit', res));
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  results.push({ file, code, dur });
  console.log(`━━━ ${file} → exit ${code} (${dur}s) ━━━`);
}

// 3. Summary table + exit code.
console.log('\n========== Deploy Gate Summary ==========');
let anyFailed = false;
for (const r of results) {
  const mark = r.code === 0 ? '✅' : '❌';
  console.log(`${mark} ${r.file.padEnd(40)} ${r.dur}s  exit=${r.code}`);
  if (r.code !== 0) anyFailed = true;
}
if (anyFailed) {
  console.error('\n❌ DEPLOY GATE FAILED — at least one cell did not pass. Do NOT deploy.');
  process.exit(1);
}
console.log('\n✅ DEPLOY GATE PASSED — safe to deploy.');

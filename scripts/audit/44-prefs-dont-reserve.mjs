#!/usr/bin/env node
/**
 * 44-prefs-dont-reserve.mjs — a PREFERENCE reserves no place; SENDING the CV does.
 *
 *   PREFS-no-reserve   Building a student's 3 preferences leaves every place
 *                      `available` — 0 slots consumed, and each preference carries
 *                      slotId: null / status 'tentative' ("ממתין לשליחה").
 *   PREFS-allow-full   A preference may point at an org with NO free place (it is
 *                      only intent). Previously this was refused at build time
 *                      ("אין מקום פנוי בקורס שלך").
 *
 * Why: preferences used to flip a slot to `tentative` each, so 3 preferences × N
 * students consumed 3N places and a course could read "full" before a single CV
 * went out — פרקטיקום מש״א תשפ״ז demanded 11×3=33 against 21 real places. Yariv:
 * "מה שקובע תפיסה של מקום צריך להיות שליחת קורות חיים".
 *
 * Runs the REAL library (src/lib/placement.ts) through esbuild, not a replica.
 */
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Audit } from '../audit-lib.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const dir = mkdtempSync(join(tmpdir(), 'prefs-'));
const out = join(dir, 'placement.mjs');
await build({
  entryPoints: [join(ROOT, 'src/lib/placement.ts')],
  bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'silent',
  external: ['@supabase/supabase-js'],
});
const { buildPlacementPreferences } = await import(pathToFileURL(out).href);

const COURSE = 'c-test';
const mkEmp = (id, name, places) => ({
  id, name, courseIds: [COURSE], notes: 'desc', contactStatus: 'approved',
  positionsTotal: places,
  vacancySlots: Array.from({ length: places }, (_, i) => ({
    id: `${id}-s${i + 1}`, courseId: COURSE, status: 'available', studentId: null, prefRank: null, history: [],
  })),
});
const freeCount = (emps) => emps.flatMap(e => e.vacancySlots || []).filter(s => s.status === 'available').length;

const audit = new Audit({ name: 'prefs-dont-reserve' });

// ── 1. Three preferences must consume ZERO places ───────────────────────────
{
  const employers = [mkEmp('e1', 'ארגון א', 2), mkEmp('e2', 'ארגון ב', 2), mkEmp('e3', 'ארגון ג', 2)];
  const student = { id: 's1', name: 'בדיקה', courseId: COURSE };
  const before = freeCount(employers);
  const res = buildPlacementPreferences(student, ['ארגון א', 'ארגון ב', 'ארגון ג'], employers, { actorId: 'test' });
  const after = freeCount(res.updatedEmployers);
  const prefs = res.updatedStudent.preferences || [];
  const allUnreserved = prefs.length === 3
    && prefs.every(p => p.slotId === null && p.status === 'tentative');
  audit.recordCell({
    id: 'PREFS-no-reserve', tableRef: 'placement.buildPlacementPreferences / intent only',
    expected: '3 preferences built, 0 places consumed, every preference slotId=null + status tentative',
    observed: `prefs=${prefs.length}, freeBefore=${before}, freeAfter=${after}, allUnreserved=${allUnreserved}, statuses=${prefs.map(p => p.status).join('/')}`,
    pass: prefs.length === 3 && before === after && allUnreserved,
    notes: before !== after ? `LEAK: preferences consumed ${before - after} place(s) — they must reserve nothing.` : '',
  });
}

// ── 2. A preference for a FULL org is allowed (intent, not a reservation) ────
{
  const full = mkEmp('e9', 'ארגון מלא', 1);
  full.vacancySlots[0] = { ...full.vacancySlots[0], status: 'placed', studentId: 'someone-else' };
  const employers = [full];
  const student = { id: 's2', name: 'בדיקה 2', courseId: COURSE };
  const res = buildPlacementPreferences(student, ['ארגון מלא'], employers, { actorId: 'test' });
  const prefs = res.updatedStudent.preferences || [];
  const unresolved = res.unresolved || [];
  const stolen = (res.updatedEmployers[0].vacancySlots || []).some(s => s.studentId === 's2');
  audit.recordCell({
    id: 'PREFS-allow-full', tableRef: 'placement.buildPlacementPreferences / full org still choosable',
    expected: 'a preference for a full org is accepted (not "אין מקום פנוי") and steals nobody\'s place',
    observed: `prefs=${prefs.length}, unresolved=${unresolved.length} ${JSON.stringify(unresolved.map(u => u.reason))}, stoleAPlace=${stolen}`,
    pass: prefs.length === 1 && stolen === false,
    notes: prefs.length === 0 ? 'Still refused at build time — availability must be judged at SEND time, not here.' : '',
  });
}

rmSync(dir, { recursive: true, force: true });
// Pure-library cell: no browser, so no audit.setup()/report dir — the recorded
// cells above are logged to stdout and the exit code is the gate signal.
const failed = audit.cells.some((c) => c.pass === false);
console.log(`\n${failed ? '❌' : '✅'} prefs-dont-reserve: ${audit.cells.filter(c => c.pass === true).length}/${audit.cells.length} pass`);
process.exit(failed ? 1 : 0);

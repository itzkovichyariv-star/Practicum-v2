#!/usr/bin/env node
/**
 * 38-status-dot-size.mjs — the status dot is big + the green is vivid.
 *
 *   DOT-green-big   A מאושר employer's list-row dot is ≥ 15px and its background
 *                   resolves to the vivid --tl-green (rgb(22,163,74) in light), with a
 *                   glow — so "available" is unmistakable (Yariv's task-app ramzor).
 *
 * Seeds one approved (green) temp employer, reads the rendered dot via getComputedStyle,
 * asserts size + green fill, cleans up.
 */
import { Audit, sbQuery, mutateData } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'status-dot-size' });
const ts = Date.now();
const EMP_ID = `audit-dot-${ts}`, EMP_NAME = `SDמאושר ${ts}`;

let seedOk = false, year = '';
try {
  const data = await loadData();
  const course = (data.courses || []).find(c => c?.year);
  if (!course) throw new Error('no course'); year = course.year;
  const emp = { id: EMP_ID, name: EMP_NAME, contactStatus: 'approved', approvalStatus: 'approved', addedBy: 'admin', restrictedToStudentId: null, notes: 'audit', contactPhone: '0500000000', contactEmail: 'a@b.local', courseIds: [course.id], vacancySlots: [{ id: `${EMP_ID}-s1`, courseId: course.id, status: 'available', studentId: null, prefRank: null, history: [] }] };
  await mutateData(data => ({ ...data, employers: [...(data.employers || []), emp] }));
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
if (!seedOk) { audit.recordCell({ id: 'DOT-seed', expected: 'seed', observed: 'failed', pass: null }); await audit.teardown(); process.exit(0); }

await audit.page.evaluate((y) => { localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: '__all__', year: y })); localStorage.setItem('practicum_v2_page', 'employers'); }, year);
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1200);

const dot = await audit.page.evaluate((name) => {
  const row = [...document.querySelectorAll('li')].find(li => li.querySelector('.serif')?.textContent?.trim() === name);
  if (!row) return { error: 'row not found' };
  // the status dot is the first small round div in line 1 (before the .serif name)
  const cand = [...row.querySelectorAll('div')].find(d => {
    const s = getComputedStyle(d); return s.borderRadius === '50%' && parseFloat(s.width) >= 10 && parseFloat(s.width) < 40 && parseFloat(s.width) === parseFloat(s.height);
  });
  if (!cand) return { error: 'no dot' };
  const s = getComputedStyle(cand);
  return { width: parseFloat(s.width), bg: s.backgroundColor, glow: s.boxShadow };
}, EMP_NAME);

if (dot.error) audit.recordCell({ id: 'DOT-green-big', expected: 'green dot ≥15px', observed: dot.error, pass: false });
else {
  audit.log(`DOT: width=${dot.width}px bg=${dot.bg} glow=${(dot.glow || '').slice(0, 40)}`);
  const isGreen = /rgb\(\s*22,\s*163,\s*74\)|rgb\(\s*74,\s*222,\s*128\)/.test(dot.bg); // --tl-green light/dark
  audit.recordCell({
    id: 'DOT-green-big', tableRef: 'EmployersPage dot',
    expected: 'green dot width ≥15px + background = --tl-green + a glow',
    observed: `width=${dot.width}, bg=${dot.bg}, hasGlow=${(dot.glow || 'none') !== 'none'}`,
    pass: dot.width >= 15 && isGreen && (dot.glow || 'none') !== 'none',
  });
}

try {
  const data = await loadData();
  await mutateData(data => ({ ...data, employers: (data.employers || []).filter(e => e.id !== EMP_ID) }));
  audit.log('Cleanup: removed temp employer');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

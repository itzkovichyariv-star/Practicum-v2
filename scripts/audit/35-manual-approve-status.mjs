#!/usr/bin/env node
/**
 * 35-manual-approve-status.mjs — manual "מאושר" (approved) status forces green.
 *
 *   APPROVE-forces-green   An employer with contactStatus='approved' reads GREEN
 *                          (מאושר), overriding an otherwise-'בתהליך' state (e.g.
 *                          approvalStatus='pending'). This is the manual advance
 *                          בתהליך → מאושר Yariv needs — the auto-green was blocked by
 *                          an explicit in-process status before.
 *
 * Seeds one temp employer (contactStatus='approved' + approvalStatus='pending' + a
 * description + an open place), opens the Employers list, asserts its pill = מאושר,
 * then removes it. Touches no real data.
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
async function sbPatchData(data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/practicum_data?org_id=eq.default`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ data }),
  });
  if (!r.ok) throw new Error(`sbPatch failed ${r.status}: ${await r.text().catch(() => '')}`);
}
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'manual-approve-status' });
const ts = Date.now();
const EMP_ID = `audit-ap-emp-${ts}`, EMP_NAME = `ארגון אישור ${ts}`;

let seedOk = false, year = '';
try {
  const data = await loadData();
  const course = (data.courses || []).find(c => c?.year);
  if (!course) throw new Error('no course');
  year = course.year;
  const emp = {
    id: EMP_ID, name: EMP_NAME,
    contactStatus: 'approved', approvalStatus: 'pending', // pending would normally be בתהליך
    addedBy: 'admin', restrictedToStudentId: null, courseIds: [course.id],
    positionsTotal: 1, positions: 1, filledPositions: 0, notes: 'audit approve',
    contactPhone: '0500000000', contactEmail: 'a@b.local',
    vacancySlots: [{ id: `${EMP_ID}-s1`, courseId: course.id, status: 'available', studentId: null, prefRank: null, history: [] }],
  };
  await sbPatchData({ ...data, employers: [...(data.employers || []), emp] });
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();

if (!seedOk) {
  audit.recordCell({ id: 'APPROVE-seed', expected: 'seed temp employer', observed: 'seed failed', pass: null });
  await audit.teardown();
  process.exit(0);
}

await audit.page.evaluate((y) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: '__all__', year: y }));
  localStorage.setItem('practicum_v2_page', 'employers');
}, year);
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1200);

const pill = await audit.page.evaluate((name) => {
  const row = [...document.querySelectorAll('li')].find(li => li.querySelector('.serif')?.textContent?.trim() === name);
  if (!row) return '(row not found)';
  // the status pill is now a <button> (one-tap toggle) with a trailing " ▾" affordance.
  const p = [...row.querySelectorAll('button, span')].find(s => /מלא|מאושר|טרם|בתהליך|נדחה/.test(s.textContent) && s.textContent.replace(/[▾\s]+/g, '').length < 18);
  return p ? p.textContent.replace(/▾/g, '').trim() : '(no pill)';
}, EMP_NAME);

audit.log(`APPROVE: ${EMP_NAME} (contactStatus=approved, approvalStatus=pending) → pill="${pill}"`);
audit.recordCell({
  id: 'APPROVE-forces-green', tableRef: 'employerStatus contactStatus==="approved"',
  expected: 'pill = מאושר (green) — manual approve overrides the otherwise-בתהליך state',
  observed: `pill="${pill}"`,
  pass: pill === 'מאושר',
});

try {
  const data = await loadData();
  await sbPatchData({ ...data, employers: (data.employers || []).filter(e => e.id !== EMP_ID) });
  audit.log('Cleanup: removed temp employer');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

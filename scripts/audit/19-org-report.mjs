#!/usr/bin/env node
/**
 * 19-org-report.mjs — "🏢 שיבוץ לפי ארגון — פירוט" report.
 *
 *   ORG-REPORT  The Reports page lists, per organization, which students were
 *               sent, their status, and the remaining places (פנויים / סה"כ).
 *
 * Seeds a temp employer (2 slots, 1 held) + a student with a structured
 * preference to it, opens the report, asserts the org + student + capacity +
 * status render, then removes both.
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
async function sbPatchData(data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/practicum_data?org_id=eq.default`, {
    method: 'PATCH', headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ data }),
  });
  if (!r.ok) throw new Error(`sbPatch ${r.status}`);
}
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'org-report' });
const ts = Date.now();
const EMP_ID = `audit-or-emp-${ts}`, EMP_NAME = `ארגון דוח ${ts}`;
const STU_ID = `audit-or-stu-${ts}`, STU_NAME = `סטודנט דוח ${ts}`;
const SLOT1 = `${EMP_ID}-s1`, SLOT2 = `${EMP_ID}-s2`;

let seedOk = false, courseId = '';
try {
  const data = await loadData();
  courseId = ((data.courses || []).find(c => c?.type === 'practicum') || (data.courses || [])[0])?.id || '';
  const emp = {
    id: EMP_ID, name: EMP_NAME, approvalStatus: 'approved', addedBy: 'admin', restrictedToStudentId: null,
    courseIds: [courseId], positionsTotal: 2, positions: 2, filledPositions: 1, notes: 'audit', contactPhone: '0500000000', contactEmail: 'a@b.local',
    vacancySlots: [
      { id: SLOT1, courseId, status: 'under_review', studentId: STU_ID, prefRank: 1, history: [] },
      { id: SLOT2, courseId, status: 'available', studentId: null, prefRank: null, history: [] },
    ],
  };
  const stu = {
    id: STU_ID, name: STU_NAME, email: `audit-or-${ts}@audit.local`, courseId,
    submissionStatus: 'submitted',
    preferences: [{ rank: 1, employerId: EMP_ID, slotId: SLOT1, status: 'under_review' }],
  };
  await sbPatchData({ ...data, employers: [...(data.employers || []), emp], students: [...(data.students || []), stu] });
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
await audit.page.evaluate(() => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'reports');
});
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1200);

audit.log('ORG-REPORT: per-org placement detail renders the seeded org + student');
{
  audit.observerMark();
  // Pick the "שיבוץ לפי ארגון" report.
  const chip = audit.page.locator('button').filter({ hasText: /שיבוץ לפי ארגון/ }).first();
  let clicked = false;
  if (await chip.count() > 0) { await chip.click().catch(() => {}); await audit.page.waitForTimeout(800); clicked = true; }
  const after = await audit.shot('ORG-REPORT');

  const found = await audit.page.evaluate(({ emp, stu }) => {
    const t = document.body.textContent || '';
    return {
      org: t.includes(emp), student: t.includes(stu),
      capacity: /1\s*\/\s*2/.test(t), status: /בבדיקה אצל מעסיק/.test(t),
      headers: /פנויים\s*\/\s*סה/.test(t) && t.includes('סטטוס'),
    };
  }, { emp: EMP_NAME, stu: STU_NAME });
  const obs = audit.observerSnapshot();

  if (!seedOk || !clicked) {
    audit.recordCell({ id: 'ORG-REPORT', tableRef: 'ReportsPage / placement_by_org', expected: 'seed + open report', observed: `seedOk=${seedOk}, clicked=${clicked}`, pass: seedOk ? false : null, notes: 'Could not seed / open the report.' });
  } else {
    const pass = found.org && found.student && found.capacity && found.status && found.headers && obs.pageErrors.length === 0;
    audit.recordCell({
      id: 'ORG-REPORT',
      tableRef: 'ReportsPage / 🏢 שיבוץ לפי ארגון — פירוט',
      expected: 'report shows the org, the student sent to it, status "בבדיקה אצל מעסיק", and remaining places "1 / 2"',
      observed: `org=${found.org}, student=${found.student}, capacity1/2=${found.capacity}, status=${found.status}, headers=${found.headers}, errors=(${obs.pageErrors.length}p)`,
      pass, after,
      notes: !found.org ? 'Org not listed.' : !found.student ? 'Student not listed under the org.' : !found.capacity ? 'Remaining places (1/2) not shown.' : !found.status ? 'Status not shown.' : '',
    });
  }
}

try {
  const data = await loadData();
  await sbPatchData({ ...data, students: (data.students || []).filter(s => s.id !== STU_ID), employers: (data.employers || []).filter(e => e.id !== EMP_ID) });
  audit.log('Cleanup: removed temp student + employer');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

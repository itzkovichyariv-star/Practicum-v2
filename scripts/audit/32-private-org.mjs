#!/usr/bin/env node
/**
 * 32-private-org.mjs — a student's own suggested (private) org.
 *
 *   PRIVATE-admin-affiliation  In the admin Employers tab, a private org
 *                              (restrictedToStudentId) shows a "🔒 פרטי ל<student>"
 *                              badge naming the affiliated student — so the
 *                              coordinator knows whose it is and can edit / contact.
 *   PRIVATE-student-sees-own   On /organizations?email=, the affiliated student SEES
 *                              their own private org + its vacancy; another student
 *                              of the SAME course does NOT (it stays private).
 *
 * Seeds a temp course-mate pair + one private org with a reserved place, then removes
 * all three. Touches no real data.
 */
import { Audit, sbQuery, BASE_URL, mutateData } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'private-org' });
const ts = Date.now();
const OWNER_ID = `audit-po-owner-${ts}`, OWNER_NAME = `בעל הצעה ${ts}`, OWNER_EMAIL = `audit-po-owner-${ts}@audit.local`;
const OTHER_ID = `audit-po-other-${ts}`, OTHER_NAME = `עמית קורס ${ts}`, OTHER_EMAIL = `audit-po-other-${ts}@audit.local`;
const EMP_ID = `audit-po-emp-${ts}`, EMP_NAME = `ארגון פרטי ${ts}`;

let seedOk = false, courseId = '';
try {
  const data = await loadData();
  const courses = data.courses || [];
  courseId = (courses.find(c => c?.type === 'practicum') || courses[0])?.id || '';
  if (!courseId) throw new Error('no course');
  const emp = {
    id: EMP_ID, name: EMP_NAME, approvalStatus: 'approved', addedBy: OWNER_EMAIL,
    restrictedToStudentId: OWNER_ID, courseIds: [courseId],
    positionsTotal: 1, positions: 1, filledPositions: 0,
    notes: 'הצעת מועמד/ת (audit)', contactPhone: '0500000000', contactEmail: 'a@b.local',
    vacancySlots: [{ id: `${EMP_ID}-s1`, courseId, status: 'available', studentId: null, prefRank: null, history: [] }],
  };
  const owner = { id: OWNER_ID, name: OWNER_NAME, email: OWNER_EMAIL, courseId, firstChoiceOrg: EMP_NAME, submissionStatus: 'submitted', preferences: [] };
  const other = { id: OTHER_ID, name: OTHER_NAME, email: OTHER_EMAIL, courseId, submissionStatus: 'submitted', preferences: [] };
  await mutateData(data => ({ ...data, employers: [...(data.employers || []), emp], students: [...(data.students || []), owner, other] }));
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();

if (!seedOk) {
  audit.recordCell({ id: 'PRIVATE-seed', expected: 'seed temp private org + students', observed: 'seed failed', pass: null, notes: 'Could not seed.' });
  await audit.teardown();
  process.exit(0);
}

// ── 1. Admin affiliation badge ────────────────────────────────────────────────
await audit.page.evaluate(() => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'employers');
});
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1200);

const adminBadge = await audit.page.evaluate((t) => {
  const row = [...document.querySelectorAll('li')].find((li) => li.textContent.includes(t.EMP_NAME));
  if (!row) return { found: false };
  const txt = row.textContent || '';
  return { found: true, hasBadge: txt.includes('פרטי ל') && txt.includes(t.OWNER_NAME) };
}, { EMP_NAME, OWNER_NAME });

audit.recordCell({
  id: 'PRIVATE-admin-affiliation', tableRef: 'EmployersPage row/card',
  expected: `private org shows "🔒 פרטי ל${OWNER_NAME}"`,
  observed: `rowFound=${adminBadge.found}, badgeWithOwner=${adminBadge.hasBadge}`,
  pass: adminBadge.found && adminBadge.hasBadge,
});

// ── 2. Student-facing visibility (owner sees it, course-mate does not) ─────────
async function orgVisibleFor(email) {
  await audit.page.goto(`${BASE_URL}/organizations?email=${encodeURIComponent(email)}`, { waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(1500);
  return audit.page.evaluate((name) => (document.body.innerText || '').includes(name), EMP_NAME);
}
const ownerSees = await orgVisibleFor(OWNER_EMAIL);
const otherSees = await orgVisibleFor(OTHER_EMAIL);

audit.recordCell({
  id: 'PRIVATE-student-sees-own', tableRef: 'OrganizationsPage restricted filter',
  expected: `${OWNER_NAME} sees the private org; ${OTHER_NAME} (same course) does not`,
  observed: `ownerSees=${ownerSees}, otherSees=${otherSees}`,
  pass: ownerSees && !otherSees,
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
try {
  const data = await loadData();
  await mutateData(data => ({
    ...data,
    students: (data.students || []).filter(s => s.id !== OWNER_ID && s.id !== OTHER_ID),
    employers: (data.employers || []).filter(e => e.id !== EMP_ID),
  }));
  audit.log('Cleanup: removed temp private org + 2 students');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

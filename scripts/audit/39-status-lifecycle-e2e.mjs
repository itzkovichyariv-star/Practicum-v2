#!/usr/bin/env node
/**
 * 39-status-lifecycle-e2e.mjs — END-TO-END employer status lifecycle → student link.
 *
 * Walks the real coordinator workflow and asserts the student-facing link reflects it:
 *
 *   E2E-inprocess-hidden  A NOT-ready employer in 'בתהליך' (in_process, NO description) is
 *                         HIDDEN from the matching student's /organizations?email= link —
 *                         it hasn't qualified for auto-green yet, so it is not offerable.
 *   E2E-approved-shown    PATCHing that SAME employer to מאושר (contactStatus:'approved')
 *                         makes it APPEAR on that student's link — the whole point of the
 *                         approve workflow: green ⇒ visible to the student.
 *   E2E-year-isolated     A student in the OTHER (course × year) does NOT see it. The
 *                         employer is attached to the course-name in BOTH years but has an
 *                         open slot ONLY in year A — so year B's student is filtered out by
 *                         the per-(course×year) slot gate (the שגיא / TLVtech leak class).
 *   E2E-selectable        For the year-A student the shown org is actually selectable —
 *                         its card carries the 'בקש/י מקום' request control.
 *
 * Drives state via the anon PATCH (exactly like the app's saveSnapshot writes), loads the
 * PUBLIC link in a real browser for each state, asserts the visible outcome, then removes
 * every temp row. Touches no real employer/student.
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

const audit = new Audit({ name: 'status-lifecycle-e2e' });
const ts = Date.now();
const EMP_ID = `audit-e2e-emp-${ts}`, EMP_NAME = `E2E מחזור סטטוס ${ts}`;
const SA_ID = `audit-e2e-stuA-${ts}`, SA_EMAIL = `e2e-a-${ts}@audit.local`;
const SB_ID = `audit-e2e-stuB-${ts}`, SB_EMAIL = `e2e-b-${ts}@audit.local`;

// Set the employer's contactStatus, re-loading the live snapshot first (CAS-safe-ish for a test).
async function setEmpStatus(contactStatus) {
  const data = await loadData();
  const employers = (data.employers || []).map(e => e.id === EMP_ID ? { ...e, contactStatus } : e);
  await sbPatchData({ ...data, employers });
}
// Does the seeded employer appear on the public link for this email, as a proper
// org CARD? /organizations is now the read-only preview (2026-07-21) — choosing
// happens on the /cv-update link — so "selectable" no longer means a "בקש/י מקום"
// button; it means the org renders as its own list card (data-org-name), i.e. the
// student can actually see and read it, not just find the name somewhere in the text.
async function orgVisibleFor(email) {
  await audit.page.goto(`${audit.baseUrl}/organizations?email=${encodeURIComponent(email)}`, { waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(1400);
  return audit.page.evaluate((name) => {
    const bodyHas = (document.body.textContent || '').includes(name);
    const asCard = [...document.querySelectorAll('[data-org-name]')].some(el => (el.getAttribute('data-org-name') || '') === name);
    return { visible: bodyHas, selectable: asCard };
  }, EMP_NAME);
}

let seedOk = false, yearA = '', yearB = '', courseA = null, courseB = null;
try {
  const data = await loadData();
  const courses = (data.courses || []).filter(c => c?.year && c?.name);
  // A course NAME present in ≥2 years → year A (earliest) + year B (latest).
  const byName = {};
  for (const c of courses) (byName[c.name] ||= []).push(c);
  const pair = Object.values(byName).find(cs => new Set(cs.map(c => c.year)).size >= 2);
  if (!pair) throw new Error('no course name spanning ≥2 years');
  const sorted = pair.slice().sort((a, b) => String(a.year).localeCompare(String(b.year)));
  courseA = sorted[sorted.length - 1]; courseB = sorted[0]; // A = latest, B = earliest
  yearA = courseA.year; yearB = courseB.year;

  // Employer attached to BOTH years, ONE OPEN slot only in year A, none in year B. Starts
  // NOT-ready (NO description) so its in_process state stays בתהליך + hidden — a ready
  // in_process org would now auto-green and show. The 'approve' step then makes it visible.
  const emp = {
    id: EMP_ID, name: EMP_NAME, contactStatus: 'in_process', approvalStatus: 'approved',
    addedBy: 'admin', restrictedToStudentId: null, notes: '',
    contactPhone: '0500000000', contactEmail: 'a@b.local',
    courseIds: [courseA.id, courseB.id], positionsTotal: 1, positions: 1, filledPositions: 0,
    vacancySlots: [{ id: `${EMP_ID}-a1`, courseId: courseA.id, status: 'available', studentId: null, prefRank: null, history: [] }],
  };
  const mkStu = (id, email, course) => ({ id, name: `E2E סטודנט ${id.slice(-4)}`, email, courseId: course.id, year: course.year, submissionStatus: 'submitted', preferences: [], acceptedOrg: null });
  await sbPatchData({
    ...data,
    employers: [...(data.employers || []), emp],
    students: [...(data.students || []), mkStu(SA_ID, SA_EMAIL, courseA), mkStu(SB_ID, SB_EMAIL, courseB)],
  });
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();

if (!seedOk) {
  audit.recordCell({ id: 'E2E-seed', expected: 'seed temp employer + 2 students', observed: 'seed failed', pass: null, notes: 'Could not seed (need a course name spanning ≥2 years).' });
  await audit.teardown();
  process.exit(0);
}

try {
  // ── State 1: בתהליך → hidden from the year-A student ──
  const inproc = await orgVisibleFor(SA_EMAIL);
  audit.log(`בתהליך: year-A student sees it = ${inproc.visible}`);
  audit.recordCell({
    id: 'E2E-inprocess-hidden', tableRef: 'OrganizationsPage active filter (employerStatus !== approved)',
    expected: `a NOT-ready in_process employer (no description) is HIDDEN from the ${yearA} student`,
    observed: `visibleWhileInProcess=${inproc.visible}`,
    pass: inproc.visible === false,
    notes: inproc.visible ? 'בתהליך employer leaked to the student link.' : '',
  });

  // ── State 2: approve → shown to the year-A student + selectable ──
  await setEmpStatus('approved');
  const approved = await orgVisibleFor(SA_EMAIL);
  audit.log(`מאושר: year-A student sees it = ${approved.visible}, selectable = ${approved.selectable}`);
  audit.recordCell({
    id: 'E2E-approved-shown', tableRef: 'OrganizationsPage active filter (approved + open slot in student course)',
    expected: `after approve, the employer APPEARS on the ${yearA} student's link`,
    observed: `visibleAfterApprove=${approved.visible}`,
    pass: approved.visible === true,
    notes: !approved.visible ? 'Approved employer did NOT appear for the matching student.' : '',
  });
  audit.recordCell({
    id: 'E2E-selectable', tableRef: 'OrgCard renders as a list card (read-only preview)',
    expected: `the shown org renders as its own card (data-org-name) for the identified ${yearA} student — the read-only preview, choosing is on /cv-update`,
    observed: `rendersAsCard=${approved.selectable}`,
    pass: approved.selectable === true,
    notes: !approved.selectable ? 'Org name in the text but not rendered as a proper org card.' : '',
  });

  // ── State 3: year-B student (no open slot in their year) still does NOT see it ──
  const other = await orgVisibleFor(SB_EMAIL);
  audit.log(`cross-year: year-B (${yearB}) student sees it = ${other.visible}`);
  audit.recordCell({
    id: 'E2E-year-isolated', tableRef: 'OrganizationsPage per-(course×year) slot gate (countSlotsByStatus)',
    expected: `the ${yearB} student does NOT see it (open slot exists only in ${yearA}) — cross-year isolation`,
    observed: `visibleToOtherYear=${other.visible}`,
    pass: other.visible === false,
    notes: other.visible ? 'Cross-year leak: year-B student saw an org with an open slot only in year A.' : '',
  });
} finally {
  try {
    const data = await loadData();
    await sbPatchData({
      ...data,
      employers: (data.employers || []).filter(e => e.id !== EMP_ID),
      students: (data.students || []).filter(s => s.id !== SA_ID && s.id !== SB_ID),
    });
    audit.log('Cleanup: removed temp employer + 2 students');
  } catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }
}

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

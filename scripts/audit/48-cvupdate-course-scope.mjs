#!/usr/bin/env node
/**
 * 48-cvupdate-course-scope.mjs — the STAGE-2 request form offers only the
 * student's OWN course organizations, resolved from their email.
 *
 *   CVUP-scope-by-email  Open /cv-update/?email=<student> with NO ?course= (this is
 *                        exactly the link the acceptance email sends —
 *                        notify-acceptance/index.ts:59 builds ?email=&name= and no
 *                        course). The preference picker must list the student's own
 *                        course org and must NOT list an org belonging to another
 *                        course.
 *   CVUP-fail-closed     An email the system doesn't recognise offers NO orgs at all
 *                        (rather than every approved org across all programmes).
 *
 * Guards a real leak found 2026-07-20: the form scoped its list ONLY by the ?course=
 * URL param (CvUpdateForm.tsx), which the emailed link does not carry — so the filter
 * was skipped entirely and a תשפ״ז HR student was offered organizations from other
 * programmes/years, on the very screen where they pick preferences. Fixed by resolving
 * the course from ?email= the way the public /organizations page does, which also
 * repairs every link already sent (no reissue needed). The GREEN-and-has-a-free-place
 * rule is now shared with /organizations so the two surfaces cannot disagree.
 *
 * Seeds a temp student + two employers (one in the student's course, one in a DIFFERENT
 * course); removes all three.
 */
import { Audit, sbQuery, BASE_URL, appReady } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };

const readRow = async () => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/practicum_data?org_id=eq.default&select=data,version`, { headers: H });
  return (await r.json())[0];
};
const writeData = async (data, version) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/practicum_data?org_id=eq.default&version=eq.${version}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ data, version: version + 1, updated_at: new Date().toISOString() }),
  });
  const j = await r.json().catch(() => null);
  return Array.isArray(j) && j.length > 0;
};

const ts = Date.now();
const STU_ID = `zcvs-${ts.toString(36).slice(-5)}`, STU_MAIL = `cvs-${ts}@audit.local`, STU_NAME = `סקופ בדיקה ${ts}`;
const MINE = `ארגון שלי ${ts}`, OTHER = `ארגון זר ${ts}`;
const EMP_MINE = `audit-cvs-mine-${ts}`, EMP_OTHER = `audit-cvs-other-${ts}`;

let seedOk = false, myCourse = '', otherCourse = '';
try {
  const row = await readRow();
  const d = row.data;
  const practicum = (d.courses || []).filter(c => c?.type === 'practicum');
  myCourse = practicum[0]?.id || '';
  otherCourse = practicum.find(c => c.id !== myCourse)?.id || '';
  if (!myCourse || !otherCourse) throw new Error('need two practicum courses');

  const mkEmp = (id, name, courseId) => ({
    id, name, approvalStatus: 'approved', contactStatus: 'approved', addedBy: 'admin',
    restrictedToStudentId: null, courseIds: [courseId], positionsTotal: 1, positions: 1, filledPositions: 0,
    notes: 'תיאור לבדיקת סקופ', contactPhone: '0500000000', contactEmail: 'a@b.local',
    vacancySlots: [{ id: `${id}-s1`, courseId, status: 'available', studentId: null, prefRank: null, history: [] }],
  });
  const stu = { id: STU_ID, name: STU_NAME, email: STU_MAIL, courseId: myCourse, cvUrl: 'storage://candidate-uploads/x.pdf', submissionStatus: 'submitted', preferences: [] };

  if (!await writeData({
    ...d,
    students: [...(d.students || []), stu],
    employers: [...(d.employers || []), mkEmp(EMP_MINE, MINE, myCourse), mkEmp(EMP_OTHER, OTHER, otherCourse)],
  }, row.version)) throw new Error('seed CAS lost');
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

const audit = new Audit({ name: 'cvupdate-course-scope' });
await audit.setup();

// Read every option the preference picker offers (open the first picker, list rows).
async function optionsFor(url) {
  await audit.page.goto(url, { waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1800); // blob fetch + derive
  const picker = audit.page.locator('button:has-text("— ללא העדפה —")').first();
  if (await picker.count() === 0) return null; // section hidden ⇒ no orgs offered
  await picker.click().catch(() => {});
  await audit.page.waitForTimeout(400);
  return audit.page.$$eval('[data-org-option]', els => els.map(e => e.getAttribute('data-org-option')));
}

// Honour AUDIT_BASE_URL like every other cell. This was the ONLY cell with a hard-coded
// port, so it failed with ERR_CONNECTION_REFUSED whenever the gate ran against a dev
// server on another port — a false red that says nothing about the code under test.
const base = BASE_URL;

audit.log('CVUP-scope-by-email: the emailed link (?email=, no ?course=) is course-scoped');
{
  audit.observerMark();
  const opts = seedOk ? await optionsFor(`${base}/cv-update/?email=${encodeURIComponent(STU_MAIL)}&name=${encodeURIComponent(STU_NAME)}`) : null;
  const list = opts || [];
  const hasMine = list.includes(MINE);
  const hasForeign = list.includes(OTHER);
  const shot = await audit.shot('CVUP-scoped');
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'CVUP-scope-by-email',
    tableRef: 'CvUpdateForm — resolve course from ?email= (acceptance-email link carries no ?course=)',
    expected: "the student's OWN course org is offered and an org from ANOTHER course is NOT",
    observed: seedOk ? `offered=${list.length}, ownCourseOrg=${hasMine}, foreignCourseOrg=${hasForeign}, errors=(${obs.pageErrors.length}p)` : 'seed failed',
    pass: seedOk ? (hasMine && !hasForeign && obs.pageErrors.length === 0) : null,
    after: shot,
    notes: !seedOk ? 'could not seed'
      : hasForeign ? 'LEAK: an org from another course is offered — the list is not scoped to the student.'
      : !hasMine ? "the student's own course org is missing — scoping is too aggressive." : '',
  });
}

audit.log('CVUP-fail-closed: an unknown email offers nothing');
{
  audit.observerMark();
  const opts = await optionsFor(`${base}/cv-update/?email=${encodeURIComponent(`nobody-${ts}@audit.local`)}`);
  const list = opts || [];
  const shot = await audit.shot('CVUP-failclosed');
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'CVUP-fail-closed',
    tableRef: 'CvUpdateForm — unresolvable identity ⇒ no organizations',
    expected: 'an unrecognised email is offered ZERO organizations (never the full cross-programme list)',
    observed: `offered=${list.length}, errors=(${obs.pageErrors.length}p)`,
    pass: list.length === 0 && obs.pageErrors.length === 0,
    after: shot,
    notes: list.length ? `fails open: ${list.length} orgs offered to an unidentified visitor.` : '',
  });
}

// ── Cleanup (CAS retry) ─────────────────────────────────────────────────────
let cleaned = false;
for (let i = 0; i < 6 && !cleaned; i++) {
  try {
    const row = await readRow();
    const d = row.data;
    cleaned = await writeData({
      ...d,
      students: (d.students || []).filter(s => s.id !== STU_ID),
      employers: (d.employers || []).filter(e => e.id !== EMP_MINE && e.id !== EMP_OTHER),
    }, row.version);
  } catch (e) { audit.log(`Cleanup attempt ${i} failed: ${e.message.slice(0, 80)}`); }
}
audit.log(cleaned ? 'Cleanup: removed temp student + 2 employers' : '⚠ Cleanup FAILED after retries.');

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

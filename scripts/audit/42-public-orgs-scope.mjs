#!/usr/bin/env node
/**
 * 30-public-orgs-scope.mjs — the PUBLIC /organizations page never leaks another
 * course's organizations.
 *
 *   ORGS-fail-closed   /organizations with NO ?email= and NO ?course= lists ZERO
 *                      organizations (it must ask the student to identify first).
 *                      Guards the 2026-07 report: students of פרקטיקום מש״א תשפ״ז
 *                      saw 15 orgs — 5 of them from other programmes — because an
 *                      unscoped visit skipped every course/status/availability guard.
 *   ORGS-course-scope  /organizations?course=<id> lists ONLY orgs that the DATA says
 *                      are assigned to that course. Derived from practicum_data, not
 *                      a hardcoded list, so it keeps holding as orgs change.
 *   ORGS-email-scope   /organizations?email=<student> shows exactly the same set as
 *                      that student's own ?course= — identification and explicit
 *                      scoping must agree.
 */
import { Audit, sbQuery, appReady } from '../audit-lib.mjs';

const COURSE = 'hr-practicum-tashpaz'; // פרקטיקום משאבי אנוש תשפ״ז

const data = (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};
const employers = data.employers || [];
const students = data.students || [];
// A real student of that course, to exercise the ?email= path.
const student = students.find(s => s.courseId === COURSE && s.email);
// Orgs the DATA assigns to this course (superset of what may legitimately show).
const assigned = new Set(
  employers
    .filter(e => (e.courseIds || (e.courseId ? [e.courseId] : [])).includes(COURSE))
    .map(e => e.name)
);

const audit = new Audit({ name: 'public-orgs-scope' });
await audit.setup();
await audit.page.setViewportSize({ width: 1200, height: 1000 });

/** Load a /organizations URL and return the org names it renders. */
async function orgsAt(query) {
  await audit.page.goto(`${audit.baseUrl}/organizations${query}`, { waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1800);
  return audit.page.$$eval('[data-org-name]', els => els.map(e => e.getAttribute('data-org-name')));
}

// ── 1. Unscoped must show nothing ───────────────────────────────────────────
audit.observerMark();
const bare = await orgsAt('');
const promptShown = await audit.page.evaluate(() => /הזן\/י את המייל|הזן\/י למעלה/.test(document.body.innerText));
{
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'ORGS-fail-closed', tableRef: 'OrganizationsPage / scope gate (public page)',
    expected: 'no ?email= and no ?course= → ZERO organizations listed + identify prompt',
    observed: `orgsListed=${bare.length}, identifyPrompt=${promptShown}, errors=(${obs.pageErrors.length}p)`,
    pass: bare.length === 0 && promptShown && obs.pageErrors.length === 0,
    notes: bare.length === 0 ? '' : `LEAK: unscoped visit exposed ${bare.length} orgs → ${bare.slice(0, 6).join(', ')}`,
  });
}

// ── 2. ?course= shows only orgs assigned to that course ─────────────────────
const scoped = await orgsAt(`?course=${encodeURIComponent(COURSE)}`);
const foreign = scoped.filter(n => !assigned.has(n));
audit.recordCell({
  id: 'ORGS-course-scope', tableRef: 'OrganizationsPage / course filter',
  expected: `every org shown for ?course=${COURSE} is assigned to it in the data`,
  observed: `shown=${scoped.length}, assignedInData=${assigned.size}, foreign=${foreign.length}`,
  pass: scoped.length > 0 && foreign.length === 0,
  notes: foreign.length ? `LEAK: not assigned to this course → ${foreign.join(', ')}` : (scoped.length ? '' : 'nothing shown — expected a non-empty list'),
});

// ── 3. ?email= agrees with ?course= ─────────────────────────────────────────
let byEmail = null, agree = false;
if (student) {
  byEmail = await orgsAt(`?email=${encodeURIComponent(student.email)}`);
  agree = byEmail.length === scoped.length && byEmail.every(n => scoped.includes(n));
}
audit.recordCell({
  id: 'ORGS-email-scope', tableRef: 'OrganizationsPage / student identification',
  expected: 'an identified student sees exactly their own course list',
  observed: student ? `student=${student.name}, viaEmail=${byEmail.length}, viaCourse=${scoped.length}, identical=${agree}` : 'no student with email found for this course',
  pass: student ? agree : null,
  notes: student ? (agree ? '' : 'the ?email= list differs from the ?course= list') : 'skipped — no test student',
});

// ── 4. Badge counts are course-scoped ───────────────────────────────────────
// The "N מקומות פנויים" pill used to fall back to an UNSCOPED count for a visitor
// who wasn't identified, so browsing by ?course= could show places belonging to
// other courses. The number must be identical whichever way you arrive.
const availBy = async (query) => {
  await audit.page.goto(`${audit.baseUrl}/organizations${query}`, { waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1800);
  return audit.page.$$eval('[data-org-name]', els =>
    Object.fromEntries(els.map(e => [e.getAttribute('data-org-name'), e.getAttribute('data-org-avail')])));
};
let badgeMatch = null, byCourseAvail = {}, byEmailAvail = {};
if (student) {
  byCourseAvail = await availBy(`?course=${encodeURIComponent(COURSE)}`);
  byEmailAvail = await availBy(`?email=${encodeURIComponent(student.email)}`);
  const keys = Object.keys(byEmailAvail);
  badgeMatch = keys.length > 0 && keys.every(k => byCourseAvail[k] === byEmailAvail[k]);
}
audit.recordCell({
  id: 'ORGS-badge-scoped', tableRef: 'OrganizationsPage / availFor course scoping',
  expected: 'places-remaining per org is identical via ?course= and via ?email= (both course-scoped)',
  observed: student ? `orgs=${Object.keys(byEmailAvail).length}, identical=${badgeMatch}` : 'no test student',
  pass: student ? badgeMatch : null,
  notes: badgeMatch === false ? `counts differ → course:${JSON.stringify(byCourseAvail)} vs email:${JSON.stringify(byEmailAvail)}` : '',
});

// ── 5. The email is remembered across a reload, and "זה לא אני" clears it ────
let rememberedAfterReload = null, forgotten = null;
if (student) {
  await audit.page.goto(`${audit.baseUrl}/organizations`, { waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1500);
  await audit.page.fill('input[type="email"]', student.email).catch(() => {});
  await audit.page.locator('button').filter({ hasText: 'המשך' }).first().click().catch(() => {});
  await audit.page.waitForTimeout(1800);
  // reload the BARE url — identity must survive
  await audit.page.goto(`${audit.baseUrl}/organizations`, { waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1800);
  rememberedAfterReload = (await audit.page.$$('[data-org-name]')).length > 0;
  // now explicitly forget, and confirm it does NOT come back after a reload
  await audit.page.locator('button').filter({ hasText: 'זה לא אני' }).first().click().catch(() => {});
  await audit.page.waitForTimeout(600);
  await audit.page.goto(`${audit.baseUrl}/organizations`, { waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1800);
  forgotten = (await audit.page.$$('[data-org-name]')).length === 0;
}
audit.recordCell({
  id: 'ORGS-remember-email', tableRef: 'OrganizationsPage / remembered identity',
  expected: 'after identifying once, reloading the BARE link keeps the student identified; "זה לא אני" clears it for good',
  observed: student ? `survivesReload=${rememberedAfterReload}, clearedByForgetMe=${forgotten}` : 'no test student',
  pass: student ? (rememberedAfterReload === true && forgotten === true) : null,
  notes: rememberedAfterReload === false ? 'identity did NOT survive a reload — student must retype every visit'
       : forgotten === false ? '"זה לא אני" did not clear the remembered identity (shared-device risk)' : '',
});

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

#!/usr/bin/env node
/**
 * 36-student-link-status.mjs — the student link shows ONLY green (מאושר) orgs.
 *
 *   LINK-green-only   On /organizations?email=<student>, an org appears iff its status
 *                     is 🟢 מאושר (manual contactStatus='approved' OR auto: description +
 *                     open place) AND it has a real open (course×year) slot. A NOT-READY
 *                     בתהליך org (in_process, NO description) is HIDDEN; but once it has a
 *                     description + an open place it AUTO-GREENS and is SHOWN (Yariv: בתהליך
 *                     no longer holds a ready org). A green-but-full org is HIDDEN; a green
 *                     org on ANOTHER course is HIDDEN.
 *
 * Seeds one temp student + 5 temp employers on that student's course, loads the link,
 * asserts presence/absence, then removes all temp data. Touches no real data.
 */
import { Audit, sbQuery, BASE_URL, mutateData } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'student-link-status' });
const ts = Date.now();
const STU_ID = `audit-sl-stu-${ts}`, STU_EMAIL = `sl-${ts}@audit.local`;
const N = {
  inproc: `SLבתהליך ${ts}`, inprocReady: `SLבתהליך-מוכן ${ts}`, manual: `SLמאושר-ידני ${ts}`,
  auto: `SLאוטו-ירוק ${ts}`, full: `SLמלא-ירוק ${ts}`, other: `SLקורס-אחר ${ts}`,
};

let seedOk = false, courseId = '', otherCourseId = '';
try {
  const data = await loadData();
  const courses = (data.courses || []).filter(c => c?.year);
  courseId = (courses.find(c => c?.type === 'practicum') || courses[0])?.id || '';
  otherCourseId = (courses.find(c => c.id !== courseId) || {}).id || courseId;
  if (!courseId) throw new Error('no course');
  const slot = (id, cid, status, sid = null) => ({ id, courseId: cid, status, studentId: sid, prefRank: null, history: [] });
  const base = (id, name, extra) => ({ id, name, addedBy: 'admin', restrictedToStudentId: null, notes: 'audit desc', contactPhone: '0500000000', contactEmail: 'a@b.local', ...extra });
  const emps = [
    // NOT-ready בתהליך (in_process, NO description) → stays orange → hidden from students.
    base(`${STU_ID}-e-inproc`, N.inproc, { notes: '', contactStatus: 'in_process', approvalStatus: 'approved', courseIds: [courseId], vacancySlots: [slot(`${STU_ID}-inproc-s1`, courseId, 'available')] }),
    // READY בתהליך (in_process, HAS description + open place) → auto-greens → SHOWN.
    base(`${STU_ID}-e-inprocready`, N.inprocReady, { contactStatus: 'in_process', approvalStatus: 'approved', courseIds: [courseId], vacancySlots: [slot(`${STU_ID}-inprocready-s1`, courseId, 'available')] }),
    base(`${STU_ID}-e-manual`, N.manual, { contactStatus: 'approved', approvalStatus: 'approved', courseIds: [courseId], vacancySlots: [slot(`${STU_ID}-manual-s1`, courseId, 'available')] }),
    base(`${STU_ID}-e-auto`, N.auto, { contactStatus: 'not_contacted', approvalStatus: 'approved', courseIds: [courseId], vacancySlots: [slot(`${STU_ID}-auto-s1`, courseId, 'available')] }),
    base(`${STU_ID}-e-full`, N.full, { contactStatus: 'approved', approvalStatus: 'approved', courseIds: [courseId], vacancySlots: [slot(`${STU_ID}-full-s1`, courseId, 'placed', 'someone')] }),
    base(`${STU_ID}-e-other`, N.other, { contactStatus: 'approved', approvalStatus: 'approved', courseIds: [otherCourseId], vacancySlots: [slot(`${STU_ID}-other-s1`, otherCourseId, 'available')] }),
  ];
  const stu = { id: STU_ID, name: `SL סטודנט ${ts}`, email: STU_EMAIL, courseId, year: courses.find(c => c.id === courseId)?.year || '', submissionStatus: 'submitted', preferences: [] };
  await mutateData(data => ({ ...data, employers: [...(data.employers || []), ...emps], students: [...(data.students || []), stu] }));
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
if (!seedOk) { audit.recordCell({ id: 'LINK-seed', expected: 'seed temp data', observed: 'seed failed', pass: null }); await audit.teardown(); process.exit(0); }

await audit.page.goto(`${BASE_URL}/organizations?email=${encodeURIComponent(STU_EMAIL)}`, { waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1800);
const seen = await audit.page.evaluate((names) => {
  const body = document.body.innerText || '';
  const out = {}; for (const k of Object.keys(names)) out[k] = body.includes(names[k]); return out;
}, N);

audit.log(`LINK: inproc=${seen.inproc} inprocReady=${seen.inprocReady} manual=${seen.manual} auto=${seen.auto} full=${seen.full} other=${seen.other}`);
audit.recordCell({
  id: 'LINK-green-only', tableRef: 'OrganizationsPage active filter',
  expected: 'manual-מאושר + auto-green + READY-בתהליך PRESENT; NOT-ready בתהליך + green-but-full + other-course ABSENT',
  observed: `manualPresent=${seen.manual}, autoPresent=${seen.auto}, inprocReadyPresent=${seen.inprocReady}, inprocPresent=${seen.inproc}, fullPresent=${seen.full}, otherPresent=${seen.other}`,
  pass: seen.manual && seen.auto && seen.inprocReady && !seen.inproc && !seen.full && !seen.other,
});

try {
  const data = await loadData();
  const empIds = new Set([`${STU_ID}-e-inproc`, `${STU_ID}-e-inprocready`, `${STU_ID}-e-manual`, `${STU_ID}-e-auto`, `${STU_ID}-e-full`, `${STU_ID}-e-other`]);
  await mutateData(data => ({ ...data, students: (data.students || []).filter(s => s.id !== STU_ID), employers: (data.employers || []).filter(e => !empIds.has(e.id)) }));
  audit.log('Cleanup: removed temp student + 5 employers');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

#!/usr/bin/env node
/**
 * 33-year-scoped-status.mjs — employer status is per (year × course).
 *
 *   STATUS-not-full-other-year   An employer whose ONLY filled place is in a PAST
 *                                year must NOT read "מלא" when you're viewing a year
 *                                where it has no (or open) places. A student belongs
 *                                to one course+year and occupies exactly one vacancy,
 *                                so a תשפ״ו placement can't make תשפ״ז read full.
 *                                (The TLVtech/שגיא bug: "הכל מלא בגלל שגיא".)
 *   STATUS-full-own-year         Viewing the year the place IS filled, it reads "מלא".
 *
 * Seeds a temp employer with a placed past-year slot + a next-year course attached
 * with 0 slots, checks the pill in both years, then removes it. Touches no real data.
 */
import { Audit, sbQuery, mutateData, appReady } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'year-scoped-status' });
const ts = Date.now();
const EMP_ID = `audit-yss-emp-${ts}`, EMP_NAME = `ארגון סטטוס ${ts}`;
const STU_ID = `audit-yss-stu-${ts}`;

// Find a PAST course + a NEWER course (two courses with different years).
let seedOk = false, pastCourse = null, nextCourse = null, pastYear = '', nextYear = '';
try {
  const data = await loadData();
  const courses = (data.courses || []).filter(c => c?.year);
  const years = [...new Set(courses.map(c => c.year))].sort();       // asc → [past, …, latest]
  if (years.length < 2) throw new Error('need ≥2 academic years');
  pastYear = years[0]; nextYear = years[years.length - 1];
  pastCourse = courses.find(c => c.year === pastYear);
  nextCourse = courses.find(c => c.year === nextYear);
  if (!pastCourse || !nextCourse) throw new Error('could not resolve past/next course');
  const emp = {
    id: EMP_ID, name: EMP_NAME, approvalStatus: 'approved', addedBy: 'admin', restrictedToStudentId: null,
    courseIds: [pastCourse.id, nextCourse.id], positionsTotal: 1, positions: 1, filledPositions: 1,
    notes: 'audit yss', contactPhone: '0500000000', contactEmail: 'a@b.local',
    vacancySlots: [{ id: `${EMP_ID}-p1`, courseId: pastCourse.id, status: 'placed', studentId: STU_ID, prefRank: null, history: [] }],
  };
  const stu = { id: STU_ID, name: `סטטוס סטודנט ${ts}`, email: `yss-${ts}@audit.local`, courseId: pastCourse.id, year: pastYear, acceptedOrg: EMP_NAME, submissionStatus: 'placed', preferences: [] };
  await mutateData(data => ({ ...data, employers: [...(data.employers || []), emp], students: [...(data.students || []), stu] }));
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();

if (!seedOk) {
  audit.recordCell({ id: 'STATUS-seed', expected: 'seed temp employer', observed: 'seed failed', pass: null, notes: 'Could not seed.' });
  await audit.teardown();
  process.exit(0);
}

async function pillFor(year) {
  await audit.page.evaluate((y) => {
    localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: '__all__', year: y }));
    localStorage.setItem('practicum_v2_page', 'employers');
  }, year);
  await audit.page.reload({ waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1200);
  return audit.page.evaluate((name) => {
    const row = [...document.querySelectorAll('li')].find(li => li.querySelector('.serif')?.textContent?.trim() === name);
    if (!row) return '(row not found)';
    // the status pill is now a <button> (one-tap toggle) with a trailing " ▾" affordance.
    const pill = [...row.querySelectorAll('button, span')].find(s => /מלא|מאושר|טרם|בתהליך|נדחה/.test(s.textContent) && s.textContent.replace(/[▾\s]+/g, '').length < 18);
    return pill ? pill.textContent.replace(/▾/g, '').trim() : '(no pill)';
  }, EMP_NAME);
}

const nextPill = await pillFor(nextYear);
const pastPill = await pillFor(pastYear);
audit.log(`STATUS: ${EMP_NAME} — viewing ${nextYear} pill="${nextPill}", viewing ${pastYear} pill="${pastPill}"`);

audit.recordCell({
  id: 'STATUS-not-full-other-year', tableRef: 'employerStatus(emp, yearCourseIds)',
  expected: `viewing ${nextYear} (no places there): pill is NOT "מלא"`,
  observed: `pill="${nextPill}"`,
  pass: nextPill !== 'מלא' && !nextPill.startsWith('(') ,
});
audit.recordCell({
  id: 'STATUS-full-own-year', tableRef: 'employerStatus(emp, yearCourseIds)',
  expected: `viewing ${pastYear} (its filled place): pill IS "מלא"`,
  observed: `pill="${pastPill}"`,
  pass: pastPill === 'מלא',
});

// Cleanup
try {
  const data = await loadData();
  await mutateData(data => ({ ...data, students: (data.students || []).filter(s => s.id !== STU_ID), employers: (data.employers || []).filter(e => e.id !== EMP_ID) }));
  audit.log('Cleanup: removed temp employer + student');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

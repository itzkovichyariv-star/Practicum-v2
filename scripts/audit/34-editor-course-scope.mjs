#!/usr/bin/env node
/**
 * 34-editor-course-scope.mjs — the employer editor is scoped to the selected context.
 *
 *   EDITOR-scoped     With a specific year+course in the top-bar context, the editor's
 *                     capacity control shows ONLY that (year × course) by default —
 *                     NOT every course, and NOT past years. ("בדיפולט זה רק אותה שנה
 *                     ואותו קורס").
 *   EDITOR-history    A "🕐 הצג היסטוריה" toggle reveals attached PAST years (with
 *                     their placements) — hidden by default.
 *   EDITOR-show-all   A "הצג את כל הקורסים" toggle reveals every course (to attach).
 *
 * Seeds a temp employer attached to the SAME course in two years, with a placement in
 * the past year, opens its editor scoped to the newer year, and checks default hides
 * the past year, the history toggle reveals it, and show-all reveals every course.
 * Removes the temp data. Touches no real data.
 */
import { Audit, sbQuery, mutateData, appReady } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'editor-course-scope' });
const ts = Date.now();
const EMP_ID = `audit-ecs-emp-${ts}`, EMP_NAME = `ארגון סקופ ${ts}`, STU_ID = `audit-ecs-stu-${ts}`;

let seedOk = false, sameName = null, pastCourse = null, nextCourse = null, totalCourses = 0;
try {
  const data = await loadData();
  const courses = (data.courses || []).filter(c => c?.year && c?.name);
  totalCourses = courses.length;
  if (totalCourses < 3) throw new Error('need ≥3 courses');
  // A course NAME present in ≥2 years → use its earliest (past) + latest (next).
  const byName = {};
  for (const c of courses) (byName[c.name] ||= []).push(c);
  const pair = Object.values(byName).find(cs => new Set(cs.map(c => c.year)).size >= 2);
  if (!pair) throw new Error('no course name spanning ≥2 years');
  const sorted = pair.slice().sort((a, b) => String(a.year).localeCompare(String(b.year)));
  pastCourse = sorted[0]; nextCourse = sorted[sorted.length - 1]; sameName = nextCourse.name;
  const emp = {
    id: EMP_ID, name: EMP_NAME, approvalStatus: 'approved', addedBy: 'admin', restrictedToStudentId: null,
    courseIds: [pastCourse.id, nextCourse.id], positionsTotal: 3, positions: 3, filledPositions: 1, notes: 'audit ecs',
    contactPhone: '0500000000', contactEmail: 'a@b.local',
    // 1 placed + 1 open in the PAST year, 1 open in the NEXT year — so an UNSCOPED
    // pill would sum to 2 open across years; a per-(course×year) pill shows just 1.
    vacancySlots: [
      { id: `${EMP_ID}-p1`, courseId: pastCourse.id, status: 'placed', studentId: STU_ID, prefRank: null, history: [] },
      { id: `${EMP_ID}-pa`, courseId: pastCourse.id, status: 'available', studentId: null, prefRank: null, history: [] },
      { id: `${EMP_ID}-na`, courseId: nextCourse.id, status: 'available', studentId: null, prefRank: null, history: [] },
    ],
  };
  const stu = { id: STU_ID, name: `סקופ סטודנט ${ts}`, email: `ecs-${ts}@audit.local`, courseId: pastCourse.id, year: pastCourse.year, acceptedOrg: EMP_NAME, submissionStatus: 'placed', preferences: [] };
  await mutateData(data => ({ ...data, employers: [...(data.employers || []), emp], students: [...(data.students || []), stu] }));
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();

if (!seedOk) {
  audit.recordCell({ id: 'EDITOR-seed', expected: 'seed temp employer', observed: 'seed failed', pass: null, notes: 'Could not seed.' });
  await audit.teardown();
  process.exit(0);
}

await audit.page.evaluate((ctx) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: ctx.name, year: ctx.year }));
  localStorage.setItem('practicum_v2_page', 'employers');
}, { name: sameName, year: nextCourse.year });
await audit.page.reload({ waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(1200);

const result = await audit.page.evaluate((t) => {
  const row = [...document.querySelectorAll('li')].find(li => li.querySelector('.serif')?.textContent?.trim() === t.EMP_NAME);
  if (!row) return { error: 'employer row not found' };
  [...row.querySelectorAll('button')].find(b => b.textContent.includes('עריכה'))?.click();
  const sec = () => [...document.querySelectorAll('span.small-caps')].find(s => s.textContent.includes('מקומות התנסות'))?.closest('div.col-span-full');
  return new Promise(resolve => setTimeout(() => {
    const s = sec();
    if (!s) return resolve({ error: 'no capacity section' });
    const defaultYears = [...s.querySelectorAll('.mono.font-bold')].map(h => h.textContent.trim());
    const scopedCount = s.querySelectorAll('input[type=checkbox]').length;
    const statusSec = [...document.querySelectorAll('span.small-caps')].find(x => x.textContent.includes('סטטוס מעסיק'))?.closest('div.col-span-full');
    const pillOpen = ((statusSec?.innerText || '').match(/(\d+)\s*מקומות פנויים/) || [])[1] || null;
    const histBtn = [...s.querySelectorAll('button')].find(b => b.textContent.includes('היסטוריה'));
    if (!histBtn) return resolve({ defaultYears, scopedCount, pillOpen, hasHistoryToggle: false });
    histBtn.click();
    setTimeout(() => {
      const s2 = sec();
      const historyYears = [...s2.querySelectorAll('.mono.font-bold')].map(h => h.textContent.trim());
      const allBtn = [...s2.querySelectorAll('button')].find(b => b.textContent.includes('הצג את כל'));
      allBtn?.click();
      setTimeout(() => {
        resolve({ defaultYears, scopedCount, pillOpen, hasHistoryToggle: true, historyYears, allCount: sec().querySelectorAll('input[type=checkbox]').length });
      }, 250);
    }, 250);
  }, 400));
}, { EMP_NAME });

if (result.error) {
  audit.recordCell({ id: 'EDITOR-scoped', expected: 'editor opens scoped', observed: result.error, pass: false });
} else {
  audit.log(`EDITOR: default years=[${result.defaultYears}] scoped=${result.scopedCount}/${totalCourses}; historyYears=[${result.historyYears}]; allCount=${result.allCount}`);
  audit.recordCell({
    id: 'EDITOR-scoped', tableRef: 'EmployerEditor visibleCourses',
    expected: `default shows ONLY ${nextCourse.year} (not the past ${pastCourse.year}); < all ${totalCourses} courses`,
    observed: `defaultYears=[${result.defaultYears}], scoped=${result.scopedCount}, total=${totalCourses}`,
    pass: result.defaultYears.length === 1 && result.defaultYears[0] === nextCourse.year && result.scopedCount < totalCourses,
  });
  audit.recordCell({
    id: 'EDITOR-history', tableRef: 'showHistory toggle',
    expected: `history toggle reveals the past year ${pastCourse.year}`,
    observed: `hasToggle=${result.hasHistoryToggle}, historyYears=[${result.historyYears}]`,
    pass: result.hasHistoryToggle && (result.historyYears || []).includes(pastCourse.year),
  });
  audit.recordCell({
    id: 'EDITOR-show-all', tableRef: 'showAllCourses toggle',
    expected: `show-all reveals all ${totalCourses} courses`,
    observed: `allCount=${result.allCount}`,
    pass: (result.allCount || 0) >= totalCourses,
  });
  audit.recordCell({
    id: 'EDITOR-pill-scoped', tableRef: 'EmployerEditor status pill = employerStatus(form, scopeCourseIds)',
    expected: `pill shows ${nextCourse.year}'s open count (1), NOT the cross-year sum (2)`,
    observed: `pillOpen=${result.pillOpen}`,
    pass: result.pillOpen === '1',
  });
}

try {
  const data = await loadData();
  await mutateData(data => ({ ...data, students: (data.students || []).filter(s => s.id !== STU_ID), employers: (data.employers || []).filter(e => e.id !== EMP_ID) }));
  audit.log('Cleanup: removed temp employer + student');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

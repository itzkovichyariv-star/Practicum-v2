#!/usr/bin/env node
/**
 * 34-editor-course-scope.mjs — the employer editor is scoped to the selected context.
 *
 *   EDITOR-scoped        With a specific course selected in the top-bar context, the
 *                        employer editor's capacity control shows only that course
 *                        (its years) + attached courses — NOT every course in the
 *                        system. ("כשאני בוחר שנה וקורס אני לא רוצה לראות קורסים אחרים".)
 *   EDITOR-show-all      A "הצג את כל הקורסים" toggle reveals every course (to attach).
 *
 * Seeds a temp employer attached to one course, opens its editor with that course as
 * context, and checks the visible course count is < total, then that the toggle
 * reveals all. Removes the temp employer. Touches no real data.
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

const audit = new Audit({ name: 'editor-course-scope' });
const ts = Date.now();
const EMP_ID = `audit-ecs-emp-${ts}`, EMP_NAME = `ארגון סקופ ${ts}`;

let seedOk = false, course = null, totalCourses = 0;
try {
  const data = await loadData();
  const courses = (data.courses || []).filter(c => c?.year);
  totalCourses = courses.length;
  if (totalCourses < 3) throw new Error('need ≥3 courses to prove filtering');
  course = courses.find(c => c.type === 'practicum') || courses[0];
  const emp = {
    id: EMP_ID, name: EMP_NAME, approvalStatus: 'approved', addedBy: 'admin', restrictedToStudentId: null,
    courseIds: [course.id], positionsTotal: 0, positions: 0, filledPositions: 0, notes: 'audit ecs',
    contactPhone: '0500000000', contactEmail: 'a@b.local', vacancySlots: [],
  };
  await sbPatchData({ ...data, employers: [...(data.employers || []), emp] });
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();

if (!seedOk) {
  audit.recordCell({ id: 'EDITOR-seed', expected: 'seed temp employer', observed: 'seed failed', pass: null, notes: 'Could not seed.' });
  await audit.teardown();
  process.exit(0);
}

// Open the editor with THIS course selected in context.
await audit.page.evaluate((c) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c.name, year: c.year }));
  localStorage.setItem('practicum_v2_page', 'employers');
}, course);
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1200);

const result = await audit.page.evaluate((t) => {
  const row = [...document.querySelectorAll('li')].find(li => li.querySelector('.serif')?.textContent?.trim() === t.EMP_NAME);
  if (!row) return { error: 'employer row not found' };
  const btn = [...row.querySelectorAll('button')].find(b => b.textContent.includes('עריכה'));
  if (!btn) return { error: 'no edit button' };
  btn.click();
  return new Promise(resolve => setTimeout(() => {
    const section = [...document.querySelectorAll('span.small-caps')].find(s => s.textContent.includes('מקומות התנסות'))?.closest('div.col-span-full');
    if (!section) return resolve({ error: 'no capacity section' });
    const scopedCount = section.querySelectorAll('input[type=checkbox]').length;
    const toggle = [...section.querySelectorAll('button')].find(b => b.textContent.includes('הצג את כל'));
    if (!toggle) return resolve({ scopedCount, hasToggle: false });
    toggle.click();
    setTimeout(() => {
      const s2 = [...document.querySelectorAll('span.small-caps')].find(s => s.textContent.includes('מקומות התנסות'))?.closest('div.col-span-full');
      resolve({ scopedCount, hasToggle: true, allCount: s2.querySelectorAll('input[type=checkbox]').length });
    }, 250);
  }, 400));
}, { EMP_NAME });

if (result.error) {
  audit.recordCell({ id: 'EDITOR-scoped', expected: 'editor opens scoped', observed: result.error, pass: false, notes: `total courses=${totalCourses}` });
} else {
  audit.log(`EDITOR-scope: scopedCheckboxes=${result.scopedCount}, totalCourses=${totalCourses}, afterShowAll=${result.allCount}`);
  audit.recordCell({
    id: 'EDITOR-scoped', tableRef: 'EmployerEditor visibleCourses',
    expected: `scoped course checkboxes (${result.scopedCount}) < all courses (${totalCourses})`,
    observed: `scoped=${result.scopedCount}, total=${totalCourses}`,
    pass: result.scopedCount > 0 && result.scopedCount < totalCourses,
  });
  audit.recordCell({
    id: 'EDITOR-show-all', tableRef: 'showAllCourses toggle',
    expected: `toggle reveals all ${totalCourses} courses`,
    observed: `hasToggle=${result.hasToggle}, afterShowAll=${result.allCount}`,
    pass: result.hasToggle && result.allCount >= totalCourses,
  });
}

// Cleanup
try {
  const data = await loadData();
  await sbPatchData({ ...data, employers: (data.employers || []).filter(e => e.id !== EMP_ID) });
  audit.log('Cleanup: removed temp employer');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

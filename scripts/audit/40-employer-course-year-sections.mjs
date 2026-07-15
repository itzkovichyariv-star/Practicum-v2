#!/usr/bin/env node
/**
 * 40-employer-course-year-sections.mjs — the Employers page separates each (course × year).
 *
 *   SECTIONS-per-unit    With several (course × year) in view, the page renders ONE section
 *                        per unit (a header per course-year), NOT one flat list.
 *   ISOLATION-two-dots   An employer attached to course A (FULL) and course B (OPEN) in the
 *                        SAME year renders as TWO rows under TWO sections with DIFFERENT dots
 *                        — slate 'מלא' under A, green 'מאושר' under B. Impossible with the old
 *                        single summed dot. This is the visual proof of per-(course×year)
 *                        isolation (the שגיא / TLVtech leak class).
 *   NO-blended-count     Neither row shows a cross-course blended capacity — the B row's open
 *                        count is 1 (its own unit), never 2 (A+B summed).
 *   GRID-also-groups     Switching to grid view ALSO groups into the two sections (never flat).
 *
 * Seeds one employer in two same-year courses (A full, B open), views all-courses × that year,
 * asserts the two differently-coloured rows in BOTH list and grid, then removes the temp data.
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

const audit = new Audit({ name: 'employer-course-year-sections' });
const ts = Date.now();
const EMP_ID = `audit-cys-emp-${ts}`, EMP_NAME = `CYSחוצה-קורס ${ts}`, STU_ID = `audit-cys-stu-${ts}`;

let seedOk = false, year = '', courseA = null, courseB = null;
try {
  const data = await loadData();
  const courses = (data.courses || []).filter(c => c?.year && c?.name);
  // A YEAR that has ≥2 distinct course NAMES → A + B, same year, different course.
  const byYear = {};
  for (const c of courses) (byYear[normal(c.year)] ||= []).push(c);
  function normal(y) { return String(y || '').replace(/["'`׳״]/g, '').trim(); }
  const pairYear = Object.entries(byYear).find(([, cs]) => new Set(cs.map(c => c.name)).size >= 2);
  if (!pairYear) throw new Error('no year with ≥2 course names');
  const cs = pairYear[1];
  const seen = new Set(); const distinct = [];
  for (const c of cs) { if (!seen.has(c.name)) { seen.add(c.name); distinct.push(c); } }
  courseA = distinct[0]; courseB = distinct[1]; year = courseA.year;

  const emp = {
    id: EMP_ID, name: EMP_NAME, addedBy: 'admin', restrictedToStudentId: null,
    notes: 'CYS — ארגון בדיקת בידוד קורס×שנה', contactPhone: '0500000000', contactEmail: 'a@b.local',
    courseIds: [courseA.id, courseB.id], positionsTotal: 2, positions: 2, filledPositions: 1,
    // Course A: 1 slot, PLACED → full (0 open). Course B: 1 slot, available + desc → auto-green.
    vacancySlots: [
      { id: `${EMP_ID}-a1`, courseId: courseA.id, status: 'placed', studentId: STU_ID, prefRank: null, history: [] },
      { id: `${EMP_ID}-b1`, courseId: courseB.id, status: 'available', studentId: null, prefRank: null, history: [] },
    ],
  };
  const stu = { id: STU_ID, name: `CYS סטודנט ${ts}`, email: `cys-${ts}@audit.local`, courseId: courseA.id, year: courseA.year, acceptedOrg: EMP_NAME, submissionStatus: 'placed', preferences: [] };
  await sbPatchData({ ...data, employers: [...(data.employers || []), emp], students: [...(data.students || []), stu] });
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
if (!seedOk) { audit.recordCell({ id: 'CYS-seed', expected: 'seed', observed: 'failed', pass: null, notes: 'Need a year with ≥2 course names.' }); await audit.teardown(); process.exit(0); }

await audit.page.evaluate((y) => { localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: '__all__', year: y })); localStorage.setItem('practicum_v2_page', 'employers'); }, year);
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1400);

// Read the emp's dot colour inside the section headed by a given course name.
const probe = await audit.page.evaluate((p) => {
  function dotIn(courseName, empName) {
    const sec = [...document.querySelectorAll('section[id^="unit-"]')]
      .find(s => (s.querySelector('.serif')?.textContent || '').includes(courseName));
    if (!sec) return { section: false };
    const row = [...sec.querySelectorAll('li')].find(li => (li.querySelector('.serif')?.textContent || '').includes(empName));
    if (!row) return { section: true, row: false };
    const dot = [...row.querySelectorAll('div')].find(d => {
      const s = getComputedStyle(d);
      return s.borderRadius === '50%' && parseFloat(s.width) >= 10 && parseFloat(s.width) < 40 && parseFloat(s.width) === parseFloat(s.height);
    });
    const chip = (row.textContent || '');
    return { section: true, row: true, bg: dot ? getComputedStyle(dot).backgroundColor : null, text: chip.replace(/\s+/g, ' ').slice(0, 120) };
  }
  const totalSections = document.querySelectorAll('section[id^="unit-"]').length;
  return { totalSections, a: dotIn(p.a, p.emp), b: dotIn(p.b, p.emp) };
}, { a: courseA.name, b: courseB.name, emp: EMP_NAME });

audit.log(`sections=${probe.totalSections}; A(${courseA.name})=${JSON.stringify(probe.a)}; B(${courseB.name})=${JSON.stringify(probe.b)}`);

const isSlate = (c) => /rgb\(\s*100,\s*116,\s*139\)/.test(c || '');       // STATUS_COLORS.full
const isGreen = (c) => /rgb\(\s*22,\s*163,\s*74\)|rgb\(\s*74,\s*222,\s*128\)/.test(c || '');

audit.recordCell({
  id: 'SECTIONS-per-unit', tableRef: 'EmployersPage sections',
  expected: 'several (course × year) in view → ≥2 sections (not one flat list)',
  observed: `sections=${probe.totalSections}`,
  pass: probe.totalSections >= 2,
});
audit.recordCell({
  id: 'ISOLATION-two-dots', tableRef: 'one employer, one row per (course × year)',
  expected: `${EMP_NAME} = slate 'מלא' dot under ${courseA.name} AND green 'מאושר' dot under ${courseB.name} (two different dots)`,
  observed: `A.bg=${probe.a?.bg} (slate=${isSlate(probe.a?.bg)}), B.bg=${probe.b?.bg} (green=${isGreen(probe.b?.bg)})`,
  pass: !!(probe.a?.row && probe.b?.row && isSlate(probe.a.bg) && isGreen(probe.b.bg) && probe.a.bg !== probe.b.bg),
  notes: (!probe.a?.row || !probe.b?.row) ? 'Employer did not render in BOTH course sections.' : '',
});
audit.recordCell({
  id: 'NO-blended-count', tableRef: 'per-unit capacity (never A+B)',
  expected: `the B-section row shows its own open count (1), never the blended 2`,
  observed: `B.text="${probe.b?.text || ''}"`,
  pass: !!(probe.b?.text && !/\b2\s*מקומות פנויים/.test(probe.b.text)),
});

// GRID view must also group into sections.
await audit.page.evaluate(() => localStorage.setItem('employers_view', 'grid'));
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1200);
const grid = await audit.page.evaluate((p) => {
  const secs = [...document.querySelectorAll('section[id^="unit-"]')];
  const inA = secs.some(s => (s.querySelector('.serif')?.textContent || '').includes(p.a) && s.textContent.includes(p.emp));
  const inB = secs.some(s => (s.querySelector('.serif')?.textContent || '').includes(p.b) && s.textContent.includes(p.emp));
  return { sections: secs.length, inA, inB };
}, { a: courseA.name, b: courseB.name, emp: EMP_NAME });
audit.log(`grid: sections=${grid.sections}, inA=${grid.inA}, inB=${grid.inB}`);
audit.recordCell({
  id: 'GRID-also-groups', tableRef: 'grid view grouping',
  expected: 'grid view ALSO groups into the two course sections (never flat)',
  observed: `sections=${grid.sections}, empInA=${grid.inA}, empInB=${grid.inB}`,
  pass: grid.sections >= 2 && grid.inA && grid.inB,
});
await audit.page.evaluate(() => localStorage.setItem('employers_view', 'list'));

try {
  const data = await loadData();
  await sbPatchData({ ...data, employers: (data.employers || []).filter(e => e.id !== EMP_ID), students: (data.students || []).filter(s => s.id !== STU_ID) });
  audit.log('Cleanup: removed temp employer + student');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

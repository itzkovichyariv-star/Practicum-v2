#!/usr/bin/env node
/**
 * 31-employer-year-lens.mjs — employer capacity is scoped to (year × course).
 *
 *   YEAR-LENS-grouped   The employer editor's capacity control is grouped by
 *                       academic year (year headings present) — the (year × course)
 *                       grain the coordinator manages.
 *   YEAR-LENS-history   A placed student renders under the year of THEIR OWN course
 *                       (not whichever slot a year-blind reconcile happened to grab).
 *                       This is the TLVtech/שגיא regression: a תשפ״ו student must NOT
 *                       show under תשפ״ז. Validates the placement.ts year-aware
 *                       occupation + self-healing re-tag end-to-end (migration runs
 *                       in the client on load, editor renders the repaired state).
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

const audit = new Audit({ name: 'employer-year-lens' });
await audit.setup();

// ── Pick a target: an employer with a placed/occupied slot whose student has a
//    course with a known year. Prefer a genuine YEAR-MISMATCH (raw slot.courseId's
//    year ≠ the student's year) so the cell specifically exercises the repair; else
//    fall back to any occupied slot (still asserts grouping + correct-year render).
let target = null; // { empName, studentName, expectedYear }
try {
  const rows = await sbQuery('practicum_data', { filter: 'org_id=eq.default', select: 'data' });
  const data = rows?.[0]?.data || {};
  const emps = data.employers || [];
  const students = data.students || [];
  const byId = new Map(students.filter((s) => s?.id != null).map((s) => [String(s.id), s]));
  const yearOf = new Map((data.courses || []).map((c) => [c.id, c.year]));

  const candidates = [];
  for (const e of emps) {
    for (const s of e.vacancySlots || []) {
      if (!s.studentId || s.status === 'available') continue;
      const stu = byId.get(String(s.studentId));
      const stc = stu?.courseId;
      const stYear = stc ? yearOf.get(stc) : null;
      if (!stu?.name || !stYear) continue;
      const slotYear = yearOf.get(s.courseId);
      const mismatch = !!(slotYear && slotYear !== stYear);
      candidates.push({ empName: e.name, studentName: stu.name, expectedYear: stYear, mismatch });
    }
  }
  target = candidates.find((c) => c.mismatch) || candidates[0] || null;
} catch (e) {
  audit.recordCell({ id: 'YEAR-LENS-setup', expected: 'read practicum_data', observed: String(e), pass: null, notes: 'Could not read data.' });
}

if (!target) {
  audit.recordCell({ id: 'YEAR-LENS', expected: 'an employer with a placed student', observed: 'none found in data', pass: null, notes: 'No occupied slot with a year-bearing student course — nothing to assert.' });
  await audit.teardown();
  process.exit(0);
}

// ── Open the target employer's editor and read the year-grouped capacity section.
await audit.page.evaluate(() => { localStorage.setItem('practicum_v2_page', 'employers'); localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: '__all__', year: '__all__' })); });
await audit.page.reload({ waitUntil: 'networkidle' });

const result = await audit.page.evaluate((t) => {
  const rows = [...document.querySelectorAll('li')];
  const row = rows.find((li) => li.textContent.includes(t.empName));
  if (!row) return { error: `no row for ${t.empName}` };
  const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('עריכה'));
  if (!btn) return { error: 'no edit button' };
  btn.click();
  // The editor mounts synchronously; give the DOM a tick.
  return new Promise((resolve) => setTimeout(() => {
    const heads = [...document.querySelectorAll('span.small-caps')];
    const cap = heads.find((s) => s.textContent.includes('מקומות התנסות'));
    const section = cap ? cap.closest('div.col-span-full') : null;
    if (!section) return resolve({ error: 'no capacity section' });
    const yearHeads = [...section.querySelectorAll('.mono.font-bold')].map((h) => h.textContent.trim());
    // Find the year block whose heading === expectedYear, check it contains the student.
    let studentUnderExpectedYear = false;
    for (const h of section.querySelectorAll('.mono.font-bold')) {
      if (h.textContent.trim() !== t.expectedYear) continue;
      const block = h.parentElement; // the <div key={year}>
      if (block && block.textContent.includes(t.studentName)) studentUnderExpectedYear = true;
    }
    // And the student must NOT appear under any OTHER year block.
    let studentUnderWrongYear = false;
    for (const h of section.querySelectorAll('.mono.font-bold')) {
      if (h.textContent.trim() === t.expectedYear) continue;
      const block = h.parentElement;
      if (block && block.textContent.includes(t.studentName)) studentUnderWrongYear = true;
    }
    resolve({ yearHeads, grouped: yearHeads.length > 0, studentUnderExpectedYear, studentUnderWrongYear });
  }, 60));
}, target);

if (result.error) {
  audit.recordCell({ id: 'YEAR-LENS-grouped', expected: 'editor opens with year-grouped capacity', observed: result.error, pass: false, notes: `target=${JSON.stringify(target)}` });
} else {
  audit.log(`YEAR-LENS: ${target.empName} / ${target.studentName} — expected year ${target.expectedYear}; headings=[${result.yearHeads.join(', ')}]`);
  audit.recordCell({
    id: 'YEAR-LENS-grouped', tableRef: 'employer editor',
    expected: 'capacity grouped by year (≥1 year heading)',
    observed: `headings=[${result.yearHeads.join(', ')}]`,
    pass: result.grouped,
  });
  audit.recordCell({
    id: 'YEAR-LENS-history', tableRef: 'placement.ts year-aware occupation',
    expected: `${target.studentName} under ${target.expectedYear} (their own course year), not another year`,
    observed: `underExpectedYear=${result.studentUnderExpectedYear}, underWrongYear=${result.studentUnderWrongYear}`,
    pass: result.studentUnderExpectedYear && !result.studentUnderWrongYear,
  });
}

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

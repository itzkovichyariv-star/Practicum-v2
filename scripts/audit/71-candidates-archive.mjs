#!/usr/bin/env node
/**
 * 71-candidates-archive.mjs — a candidate who already became a student leaves the
 * working list, and the toggle brings them back marked.
 *
 *   ARCHIVE-hidden   A candidate carrying convertedToStudentId is NOT in the list
 *                    by default, while an ordinary candidate seeded beside them IS.
 *   ARCHIVE-toggle   Ticking "הצג ארכיון" brings that row back, it carries the
 *                    בארכיון marker, and the "הכל" tab count rises by at least one.
 *   ARCHIVE-outside  The toggle is NOT inside a row, so cell 07's row-checkbox
 *                    selector still matches only real row checkboxes.
 *
 * Yariv, 2026-08-11: they used to sit in the list with a green dot, reading exactly
 * like a candidate still waiting on him.
 *
 * Seeds ONE archived candidate + ONE plain control + the student the first points
 * at, and removes all three. Every assertion is RELATIVE — membership and deltas,
 * never an absolute count — because the live board already holds real candidates
 * and real archived ones, and a cell that assumes an empty board is a cell that
 * goes red for the wrong reason.
 *
 * NOTE ON PROVENANCE: the behaviour under test is also covered offline by
 * scripts/candidates-archive-check.mjs, which was run against both the pre-change
 * and post-change builds (5/19 → 19/19). THIS cell has not been executed — it
 * seeds through the live project, and it was written on a branch nobody has
 * merged. Run it against a deployment before trusting a green from it.
 */
import { Audit, sbQuery, mutateData, appReady } from '../audit-lib.mjs';

const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'candidates-archive' });
const ts = Date.now();
const ARCH_ID = `audit-arch-${ts}`, PLAIN_ID = `audit-plain-${ts}`, STU_ID = `audit-archstu-${ts}`;
const ARCH_NAME = `ארכיון בדיקה ${ts}`, PLAIN_NAME = `פעיל בדיקה ${ts}`;

let seedOk = false, courseId = '', year = '__all__';
try {
  const data = await loadData();
  const course = (data.courses || []).find(c => c?.type === 'practicum') || (data.courses || [])[0];
  courseId = course?.id || '';
  year = course?.year || '__all__';
  const common = { courseId, year, cvUrl: 'https://x/cv', applicationUrl: 'https://x/app' };
  const student = { id: STU_ID, name: ARCH_NAME, email: `audit-arch-${ts}@audit.local`,
    courseId, year, preparation: { passed: false }, fromCandidate: true, fromCandidateId: ARCH_ID };
  const archived = { ...common, id: ARCH_ID, name: ARCH_NAME, email: `audit-arch-${ts}@audit.local`,
    interviewConducted: true, interviewResult: 'passed', interviewSummary: 'בדיקת ארכיון.',
    convertedToStudentId: STU_ID };
  const plain = { ...common, id: PLAIN_ID, name: PLAIN_NAME, email: `audit-plain-${ts}@audit.local` };
  await mutateData(d => ({
    ...d,
    candidates: [...(d.candidates || []), archived, plain],
    students: [...(d.students || []), student],
  }));
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
await audit.page.evaluate(({ cId, y }) => {
  localStorage.setItem('practicum_v2_page', 'candidates');
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: cId || '__all__', year: y || '__all__' }));
}, { cId: courseId, y: year });
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(1400);

const rowVisible = name => audit.page.locator('li[data-info-row]').filter({ hasText: name }).first()
  .isVisible().catch(() => false);
const allTabCount = () => audit.page.evaluate(() => {
  const tab = [...document.querySelectorAll('.ramzor-bar button')].find(b => /הכל/.test(b.textContent || ''));
  const m = tab && (tab.textContent || '').match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
});
const toggle = () => audit.page.locator('input[data-archive-toggle]');

// ─── ARCHIVE-hidden ──────────────────────────────────────────────────────────
audit.log('ARCHIVE-hidden: the converted one is out, the plain one stays');
{
  audit.observerMark();
  let archIn = null, plainIn = null;
  if (seedOk) {
    archIn = await rowVisible(ARCH_NAME);
    plainIn = await rowVisible(PLAIN_NAME);
  }
  const obs = audit.observerSnapshot();
  if (!seedOk) {
    audit.recordCell({ id: 'ARCHIVE-hidden', tableRef: 'CandidatesPage / archive', expected: 'seed', observed: 'seed failed', pass: null, notes: 'Could not seed.' });
  } else {
    audit.recordCell({
      id: 'ARCHIVE-hidden', tableRef: 'CandidatesPage / converted candidate leaves the working list',
      expected: 'archived row hidden by default, plain row shown',
      observed: `archivedVisible=${archIn}, plainVisible=${plainIn}, errors=(${obs.pageErrors.length}p)`,
      pass: archIn === false && plainIn === true && obs.pageErrors.length === 0,
      notes: archIn ? 'A converted candidate is still in the default list.' : plainIn ? '' : 'The control candidate is missing — the seed or the context filter is wrong, so this is not evidence about the archive.',
    });
  }
}

// ─── ARCHIVE-toggle ──────────────────────────────────────────────────────────
audit.log('ARCHIVE-toggle: the switch brings it back, marked, and the count rises');
{
  audit.observerMark();
  let present = null, backIn = null, marked = null, before = null, after = null;
  if (seedOk) {
    present = await toggle().count() === 1;
    if (present) {
      before = await allTabCount();
      await toggle().check().catch(() => {});
      await audit.page.waitForTimeout(700);
      after = await allTabCount();
      backIn = await rowVisible(ARCH_NAME);
      marked = await audit.page.evaluate(n => {
        const row = [...document.querySelectorAll('li[data-info-row]')].find(e => (e.textContent || '').includes(n));
        return row ? /בארכיון/.test(row.textContent || '') : false;
      }, ARCH_NAME);
    }
  }
  const obs = audit.observerSnapshot();
  if (!seedOk || present !== true) {
    audit.recordCell({ id: 'ARCHIVE-toggle', tableRef: 'CandidatesPage / הצג ארכיון', expected: 'a toggle to operate', observed: `seedOk=${seedOk}, togglePresent=${present}`, pass: null, notes: 'No toggle on the page — it renders only when the archive is non-empty, so with a failed seed this is not a result.' });
  } else {
    audit.recordCell({
      id: 'ARCHIVE-toggle', tableRef: 'CandidatesPage / archive toggle restores and marks the row',
      expected: 'row returns, carries בארכיון, and "הכל" rises by ≥1',
      observed: `back=${backIn}, marked=${marked}, הכל ${before}→${after}, errors=(${obs.pageErrors.length}p)`,
      pass: backIn === true && marked === true && before !== null && after !== null && after > before && obs.pageErrors.length === 0,
      notes: !backIn ? 'The archived row did not come back.' : !marked ? 'It came back with nothing saying it is archived.' : (after <= before ? 'The "הכל" count did not follow the shown pool.' : ''),
    });
  }
}

// ─── ARCHIVE-outside ─────────────────────────────────────────────────────────
audit.log('ARCHIVE-outside: the toggle is not a row checkbox (cell 07 selects on those)');
{
  const inRows = await audit.page.locator('li[data-info-row] input[data-archive-toggle]').count();
  const rowBoxes = await audit.page.locator('li[data-info-row] input[type="checkbox"]').count();
  audit.recordCell({
    id: 'ARCHIVE-outside', tableRef: 'CandidatesPage / toggle lives outside the rows',
    expected: 'zero archive toggles inside li[data-info-row], and rows still have their own checkboxes',
    observed: `toggleInsideRows=${inRows}, rowCheckboxes=${rowBoxes}`,
    pass: inRows === 0 && rowBoxes > 0,
    notes: inRows > 0 ? 'The archive toggle is inside a row and cell 07 will select it by mistake.' : rowBoxes === 0 ? 'No row checkboxes found at all — nothing to compare against.' : '',
  });
}

try {
  await mutateData(d => ({
    ...d,
    candidates: (d.candidates || []).filter(c => c.id !== ARCH_ID && c.id !== PLAIN_ID),
    students: (d.students || []).filter(s => s.id !== STU_ID),
  }));
  audit.log('Cleanup: removed 2 temp candidates + 1 temp student');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

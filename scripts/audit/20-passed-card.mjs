#!/usr/bin/env node
/**
 * 20-passed-card.mjs — passed/converted candidates' cards open from both pages.
 *
 *   PASSED-card-open  A candidate who passed the interview (and was converted to a
 *                     student) can have their editor opened — both from the
 *                     Candidates page AND the Students page — with no JS error.
 *
 * Seeds a temp passed+converted candidate and its student; removes both.
 * (User reported these cards "wouldn't open" — guards that path.)
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
async function sbPatchData(data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/practicum_data?org_id=eq.default`, {
    method: 'PATCH', headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ data }),
  });
  if (!r.ok) throw new Error(`sbPatch ${r.status}`);
}
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'passed-card' });
const ts = Date.now();
const CAND_ID = `audit-pc-cand-${ts}`, STU_ID = `audit-pc-stu-${ts}`, NAME = `עבר ראיון ${ts}`;

let seedOk = false, courseId = '';
try {
  const data = await loadData();
  courseId = ((data.courses || []).find(c => c?.type === 'practicum') || (data.courses || [])[0])?.id || '';
  const cand = { id: CAND_ID, name: NAME, email: `audit-pc-${ts}@audit.local`, courseId, interviewResult: 'passed', interviewConducted: true, interviewSummary: 'audit pass', convertedToStudentId: STU_ID };
  const stu = { id: STU_ID, name: NAME, email: `audit-pc-${ts}@audit.local`, courseId, fromCandidate: true, fromCandidateId: CAND_ID, preparation: { passed: false }, preferences: [] };
  await sbPatchData({ ...data, candidates: [...(data.candidates || []), cand], students: [...(data.students || []), stu] });
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
await audit.page.evaluate(({ cId }) => localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: cId || '__all__', year: '__all__' })), { cId: courseId });

const editorOpen = () => audit.page.evaluate(() => !!document.querySelector('button[aria-label="סגור"]'));
async function openCardOn(page) {
  await audit.page.evaluate((p) => localStorage.setItem('practicum_v2_page', p), page);
  await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(1200);
  if (page === 'candidates') {
    const tab = audit.page.locator('button').filter({ hasText: /^עברו/ }).first();
    if (await tab.count() > 0) { await tab.click().catch(() => {}); await audit.page.waitForTimeout(500); }
  }
  const row = audit.page.locator('li').filter({ hasText: NAME }).first();
  if (!(await row.isVisible().catch(() => false))) return { opened: false, rowSeen: false };
  const eb = row.getByTitle('ערוך').first();
  if (await eb.isVisible().catch(() => false)) await eb.click().catch(() => {});
  else { await row.hover(); await audit.page.waitForTimeout(250); await row.getByTitle('ערוך').first().click().catch(() => {}); }
  await audit.page.waitForTimeout(1200);
  const opened = await editorOpen();
  // close again for the next step
  if (opened) { await audit.page.keyboard.press('Escape'); await audit.page.waitForTimeout(400); }
  return { opened, rowSeen: true };
}

audit.log('PASSED-card-open: candidate + student editors open for a passed/converted candidate');
{
  audit.observerMark();
  let candOpen = false, studOpen = false, candRow = false, studRow = false;
  if (seedOk) {
    const c = await openCardOn('candidates'); candOpen = c.opened; candRow = c.rowSeen;
    const s = await openCardOn('students'); studOpen = s.opened; studRow = s.rowSeen;
  }
  const obs = audit.observerSnapshot();
  if (!seedOk) {
    audit.recordCell({ id: 'PASSED-card-open', tableRef: 'passed/converted candidate editors', expected: 'seed', observed: 'seed failed', pass: null, notes: 'Seed failed.' });
  } else {
    const pass = candRow && candOpen && studRow && studOpen && obs.pageErrors.length === 0;
    audit.recordCell({
      id: 'PASSED-card-open',
      tableRef: 'CandidatesPage + StudentsPage / open editor of a passed+converted candidate',
      expected: 'the card opens from BOTH the Candidates page and the Students page, with no JS error',
      observed: `candidateRow=${candRow}, candidateEditorOpened=${candOpen}, studentRow=${studRow}, studentEditorOpened=${studOpen}, errors=(${obs.pageErrors.length}p) ${obs.pageErrors.slice(0, 2).join(' | ')}`,
      pass,
      notes: !candOpen ? 'Candidate editor did not open for a passed candidate.' : !studOpen ? 'Student editor did not open for a converted student.' : obs.pageErrors.length ? 'JS error while opening.' : '',
    });
  }
}

try {
  const data = await loadData();
  await sbPatchData({ ...data, candidates: (data.candidates || []).filter(c => c.id !== CAND_ID), students: (data.students || []).filter(s => s.id !== STU_ID) });
  audit.log('Cleanup: removed temp candidate + student');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

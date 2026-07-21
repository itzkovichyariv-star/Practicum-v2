#!/usr/bin/env node
/**
 * 25-form-carryover.mjs — the submitted application form travels candidate→student.
 *
 *   FORM-carryover  A student converted from a candidate shows the original
 *                   submitted application form ("שאלון מועמדות") in their editor,
 *                   with its original design. Covers the carry-over on conversion
 *                   AND the migration backfill for students converted earlier
 *                   (questionnaire pulled from the linked candidate).
 *
 * Seeds a candidate WITH a questionnaire + a student linked to it WITHOUT one,
 * so this exercises the backfill path specifically. Cleans both up.
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

const audit = new Audit({ name: 'form-carryover' });
const ts = Date.now();
const CID = `audit-fc-cand-${ts}`, SID = `audit-fc-stu-${ts}`, NAME = `טופס קארי ${ts}`;
const ANSWER = `ניסיון תעסוקתי ${ts}`;

let seedOk = false, courseId = '';
try {
  const data = await loadData();
  courseId = ((data.courses || []).find(c => c?.type === 'practicum') || (data.courses || [])[0])?.id || '';
  const questionnaire = { workHistory: ANSWER, favRole: 'רכז/ת גיוס', whyPracticum: 'התפתחות מקצועית' };
  const cand = { id: CID, name: NAME, email: `audit-fc-${ts}@audit.local`, courseId, questionnaire, convertedToStudentId: SID };
  // Student linked to the candidate but WITHOUT questionnaire → exercises backfill.
  const stu = { id: SID, name: NAME, email: `audit-fc-${ts}@audit.local`, courseId, fromCandidate: true, fromCandidateId: CID, preparation: { passed: false }, preferences: [] };
  await sbPatchData({ ...data, candidates: [...(data.candidates || []), cand], students: [...(data.students || []), stu] });
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
await audit.page.evaluate(({ c }) => {
  localStorage.setItem('practicum_v2_page', 'students');
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c || '__all__', year: '__all__' }));
}, { c: courseId });
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1400);

audit.log('FORM-carryover: converted student shows the submitted "שאלון מועמדות"');
{
  audit.observerMark();
  let opened = false, hasForm = null, hasAnswer = null;
  if (seedOk) {
    const row = audit.page.locator('li[data-info-row]').filter({ hasText: NAME }).first();
    if (await row.isVisible().catch(() => false)) {
      await row.getByTitle('ערוך').first().click().catch(() => {});
      await audit.page.waitForTimeout(1400);
      opened = await audit.page.evaluate(() => !!document.querySelector('button[aria-label="סגור"]'));
      // The questionnaire lives inside the (collapsed) "מסמכים וחוו״ד מעסיק" accordion —
      // expand it first (the redesign folds secondary sections into accordions).
      const docsAcc = audit.page.locator('[data-accordion="מסמכים וחוו״ד מעסיק"]').first();
      if (await docsAcc.count() > 0) { await docsAcc.scrollIntoViewIfNeeded().catch(() => {}); await docsAcc.click().catch(() => {}); await audit.page.waitForTimeout(400); }
      hasForm = await audit.page.evaluate(() => /שאלון מועמדות/.test(document.body.innerText || ''));
      // The form view is collapsed by default (same as the candidate card) — expand it.
      const toggle = audit.page.locator('button').filter({ hasText: /^שאלון מועמדות/ }).first();
      if (await toggle.count() > 0) { await toggle.scrollIntoViewIfNeeded().catch(() => {}); await toggle.click().catch(() => {}); await audit.page.waitForTimeout(400); }
      hasAnswer = await audit.page.evaluate((ans) => (document.body.innerText || '').includes(ans), ANSWER);
      await audit.page.keyboard.press('Escape').catch(() => {});
    }
  }
  const obs = audit.observerSnapshot();
  if (!seedOk || !opened) {
    audit.recordCell({ id: 'FORM-carryover', tableRef: 'StudentEditor / application form (questionnaire)', expected: 'seed + open', observed: `seedOk=${seedOk}, opened=${opened}`, pass: null, notes: 'Could not open the student editor.' });
  } else {
    audit.recordCell({
      id: 'FORM-carryover', tableRef: 'StudentEditor / "שאלון מועמדות" carried from candidate',
      expected: 'the student editor shows the original application form ("שאלון מועמדות") with the submitted answer',
      observed: `editorOpened=${opened}, showsForm=${hasForm}, showsAnswer=${hasAnswer}, errors=(${obs.pageErrors.length}p)`,
      pass: hasForm === true && hasAnswer === true && obs.pageErrors.length === 0,
      notes: !hasForm ? 'Application form ("שאלון מועמדות") not shown on the student.' : !hasAnswer ? 'Form shown but the submitted answer is missing.' : '',
    });
  }
}

try {
  const data = await loadData();
  await sbPatchData({ ...data, candidates: (data.candidates || []).filter(c => c.id !== CID), students: (data.students || []).filter(s => s.id !== SID) });
  audit.log('Cleanup: removed temp candidate + student');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

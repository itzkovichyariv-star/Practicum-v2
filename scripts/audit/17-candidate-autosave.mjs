#!/usr/bin/env node
/**
 * 17-candidate-autosave.mjs — live interview assessment auto-saves.
 *
 *   AUTOSAVE-pending  Typing an interview summary in a candidate's editor persists
 *                     to the DB ~1.5s later WITHOUT clicking save and WITHOUT
 *                     deciding pass/fail (interviewResult stays 'pending').
 *
 * Seeds a temp candidate (interviewResult pending), removes it after.
 */
import { Audit, sbQuery, mutateData, appReady } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'candidate-autosave' });
const ts = Date.now();
const CAND_ID = `audit-as-${ts}`, CAND_NAME = `מועמד אוטו ${ts}`;
const SUMMARY = `הערכת ראיון בזמן אמת ${ts} — מוטיבציה גבוהה`;

let seedOk = false, courseId = '';
try {
  const data = await loadData();
  courseId = (data.courses || [])[0]?.id || '';
  await mutateData(data => ({ ...data, candidates: [...(data.candidates || []), { id: CAND_ID, name: CAND_NAME, email: `audit-as-${ts}@audit.local`, courseId, interviewDate: '2026-05-30', interviewResult: 'pending', interviewSummary: '' }] }));
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
await audit.page.evaluate(({ cId }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: cId || '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'candidates');
}, { cId: courseId });
await audit.page.reload({ waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(1000);

audit.log('AUTOSAVE-pending: typing the summary persists without save / without deciding');
{
  audit.observerMark();
  let opened = false, savedSummary = '', resultAfter = '', indicatorSeen = false, conductedPersisted = false, conductedResult = '';

  if (seedOk) {
    const row = audit.page.locator('li').filter({ hasText: CAND_NAME }).first();
    if (await row.isVisible().catch(() => false)) {
      const editBtn = row.getByTitle('ערוך').first();
      if (await editBtn.isVisible().catch(() => false)) await editBtn.click();
      else { await row.hover(); await audit.page.waitForTimeout(300); await row.getByTitle('ערוך').first().click().catch(() => {}); }
      await audit.page.waitForTimeout(1000);
      opened = true;

      // Type into the interview-summary textarea (no Save click).
      const ta = audit.page.locator('textarea').first();
      if (await ta.count() > 0) {
        await ta.scrollIntoViewIfNeeded();
        await ta.fill(SUMMARY);
      }
      // Wait past the 1.5s debounce + persist, then confirm via DB (no save click).
      for (let i = 0; i < 12; i++) {
        await audit.page.waitForTimeout(600);
        const c = (await loadData()).candidates?.find(x => x.id === CAND_ID);
        if ((c?.interviewSummary || '') === SUMMARY) { savedSummary = c.interviewSummary; resultAfter = c.interviewResult || ''; break; }
        resultAfter = c?.interviewResult || '';
      }
      indicatorSeen = await audit.page.evaluate(() => /נשמר אוטומטית|שומר…/.test(document.body.textContent || ''));

      // "ראיון בוצע" — marking it should FORCE an immediate save (protection
      // checkpoint), persisting interviewConducted=true while result stays pending.
      const conductedCb = audit.page.locator('label').filter({ hasText: 'הראיון בוצע' }).locator('input[type="checkbox"]').first();
      if (await conductedCb.count() > 0) {
        await conductedCb.scrollIntoViewIfNeeded();
        await conductedCb.check().catch(() => {});
        for (let i = 0; i < 8; i++) {
          await audit.page.waitForTimeout(400);
          const c = (await loadData()).candidates?.find(x => x.id === CAND_ID);
          if (c?.interviewConducted === true) { conductedPersisted = true; conductedResult = c.interviewResult || ''; break; }
        }
      }
    }
  }

  const after = await audit.shot('AUTOSAVE-pending');
  const obs = audit.observerSnapshot();
  if (!seedOk || !opened) {
    audit.recordCell({ id: 'AUTOSAVE-pending', tableRef: 'CandidateEditor auto-save', expected: 'open editor', observed: `seedOk=${seedOk}, opened=${opened}`, pass: seedOk ? false : null, notes: 'Could not seed/open.' });
  } else {
    const pass = savedSummary === SUMMARY && resultAfter === 'pending' && indicatorSeen
      && conductedPersisted && conductedResult === 'pending' && obs.pageErrors.length === 0;
    audit.recordCell({
      id: 'AUTOSAVE-pending',
      tableRef: 'CandidateEditor / debounced auto-save + "ראיון בוצע" checkpoint (result stays pending)',
      expected: 'summary auto-persists (no save click); marking "ראיון בוצע" force-saves interviewConducted=true; interviewResult stays "pending" throughout',
      observed: `summaryPersisted=${savedSummary === SUMMARY}, conducted=${conductedPersisted}, resultAfter="${resultAfter}/${conductedResult}", indicator=${indicatorSeen}, errors=(${obs.pageErrors.length}p)`,
      pass, after,
      notes: savedSummary !== SUMMARY ? 'Summary did not auto-persist (no save click).'
        : !conductedPersisted ? '"ראיון בוצע" did not force-save interviewConducted.'
        : (resultAfter !== 'pending' || conductedResult !== 'pending') ? 'Result changed — should stay pending.'
        : !indicatorSeen ? 'No auto-save indicator shown.' : '',
    });
  }
}

try {
  const data = await loadData();
  await mutateData(data => ({ ...data, candidates: (data.candidates || []).filter(c => c.id !== CAND_ID) }));
  audit.log('Cleanup: removed temp candidate');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

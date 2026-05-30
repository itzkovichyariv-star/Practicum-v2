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

const audit = new Audit({ name: 'candidate-autosave' });
const ts = Date.now();
const CAND_ID = `audit-as-${ts}`, CAND_NAME = `מועמד אוטו ${ts}`;
const SUMMARY = `הערכת ראיון בזמן אמת ${ts} — מוטיבציה גבוהה`;

let seedOk = false, courseId = '';
try {
  const data = await loadData();
  courseId = (data.courses || [])[0]?.id || '';
  await sbPatchData({ ...data, candidates: [...(data.candidates || []), { id: CAND_ID, name: CAND_NAME, email: `audit-as-${ts}@audit.local`, courseId, interviewDate: '2026-05-30', interviewResult: 'pending', interviewSummary: '' }] });
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
await audit.page.evaluate(({ cId }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: cId || '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'candidates');
}, { cId: courseId });
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1000);

audit.log('AUTOSAVE-pending: typing the summary persists without save / without deciding');
{
  audit.observerMark();
  let opened = false, savedSummary = '', resultAfter = '', indicatorSeen = false;

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
    }
  }

  const after = await audit.shot('AUTOSAVE-pending');
  const obs = audit.observerSnapshot();
  if (!seedOk || !opened) {
    audit.recordCell({ id: 'AUTOSAVE-pending', tableRef: 'CandidateEditor auto-save', expected: 'open editor', observed: `seedOk=${seedOk}, opened=${opened}`, pass: seedOk ? false : null, notes: 'Could not seed/open.' });
  } else {
    const pass = savedSummary === SUMMARY && resultAfter === 'pending' && indicatorSeen && obs.pageErrors.length === 0;
    audit.recordCell({
      id: 'AUTOSAVE-pending',
      tableRef: 'CandidateEditor / debounced auto-save (no save click, result stays pending)',
      expected: 'interview summary persists to DB without clicking save; interviewResult stays "pending"; "נשמר אוטומטית" indicator shown',
      observed: `summaryPersisted=${savedSummary === SUMMARY}, resultAfter="${resultAfter}", indicator=${indicatorSeen}, errors=(${obs.pageErrors.length}p)`,
      pass, after,
      notes: savedSummary !== SUMMARY ? 'Summary did not auto-persist (no save click).' : resultAfter !== 'pending' ? 'Result changed — should stay pending.' : !indicatorSeen ? 'No auto-save indicator shown.' : '',
    });
  }
}

try {
  const data = await loadData();
  await sbPatchData({ ...data, candidates: (data.candidates || []).filter(c => c.id !== CAND_ID) });
  audit.log('Cleanup: removed temp candidate');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

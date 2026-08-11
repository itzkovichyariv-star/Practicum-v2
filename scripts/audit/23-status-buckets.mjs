#!/usr/bin/env node
/**
 * 23-status-buckets.mjs — "ממתינים" and "ראיון בוצע" are SEPARATE buckets.
 *
 *   BUCKET-split   A candidate marked "ראיון בוצע" (interviewConducted, decision
 *                  pending) appears under the "ראיון בוצע" tab and is EXCLUDED
 *                  from the "ממתינים" tab. Guards the user report that a conducted
 *                  candidate was still being counted/listed as pending.
 *
 * Seeds one temp conducted candidate and removes it.
 */
import { Audit, sbQuery, mutateData } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'status-buckets' });
const ts = Date.now();
const CAND_ID = `audit-sb-${ts}`, NAME = `סטטוס באקט ${ts}`;

let seedOk = false, courseId = '';
try {
  const data = await loadData();
  courseId = ((data.courses || []).find(c => c?.type === 'practicum') || (data.courses || [])[0])?.id || '';
  const cand = { id: CAND_ID, name: NAME, email: `audit-sb-${ts}@audit.local`, courseId,
    cvUrl: 'https://x/cv', applicationUrl: 'https://x/app',
    interviewConducted: true, interviewConductedAt: new Date(ts).toISOString(), interviewResult: 'pending' };
  await mutateData(data => ({ ...data, candidates: [...(data.candidates || []), cand] }));
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
await audit.page.evaluate(({ cId }) => {
  localStorage.setItem('practicum_v2_page', 'candidates');
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: cId || '__all__', year: '__all__' }));
}, { cId: courseId });
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1300);

async function clickTab(re) {
  const tab = audit.page.locator('.ramzor-bar button').filter({ hasText: re }).first();
  if (await tab.count() === 0) return false;
  await tab.click().catch(() => {});
  await audit.page.waitForTimeout(500);
  return true;
}
const rowVisible = () => audit.page.locator('li[data-info-row]').filter({ hasText: NAME }).first().isVisible().catch(() => false);

audit.log('BUCKET-split: conducted candidate is under "ראיון בוצע", not "ממתינים"');
{
  audit.observerMark();
  let inConducted = null, inPending = null, tabsOk = false;
  if (seedOk) {
    const a = await clickTab(/ראיון בוצע/);
    inConducted = await rowVisible();
    const b = await clickTab(/^ממתינים/);
    inPending = await rowVisible();
    tabsOk = a && b;
  }
  const obs = audit.observerSnapshot();
  if (!seedOk || !tabsOk) {
    audit.recordCell({ id: 'BUCKET-split', tableRef: 'CandidatesPage / pending vs conducted buckets', expected: 'seed + tabs', observed: `seedOk=${seedOk}, tabsOk=${tabsOk}`, pass: null, notes: 'Could not seed or find tabs.' });
  } else {
    audit.recordCell({
      id: 'BUCKET-split', tableRef: 'CandidatesPage / "ממתינים" excludes "ראיון בוצע"',
      expected: 'conducted candidate shows under "ראיון בוצע" and is hidden from "ממתינים"',
      observed: `underConducted=${inConducted}, underPending=${inPending}, errors=(${obs.pageErrors.length}p)`,
      pass: inConducted === true && inPending === false && obs.pageErrors.length === 0,
      notes: inPending ? 'Conducted candidate still appears under "ממתינים" (buckets overlap).' : inConducted ? '' : 'Conducted candidate not shown under "ראיון בוצע".',
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

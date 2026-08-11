#!/usr/bin/env node
/**
 * 30-feedback-pill.mjs — the "✓ משוב" (employer-feedback-received) card pill.
 *
 *   FEEDBACK-pill   A student who has employer feedback (feedbackSubmittedAt set,
 *                   OR non-empty feedbackText) shows a green "✓ משוב" pill on the
 *                   Students card; a placed student WITHOUT feedback shows none.
 *                   Lets a coordinator scan the list and instantly see who has an
 *                   employer evaluation and who is still waiting. Derived purely
 *                   from data (no backfill) so it lights up the moment feedback
 *                   lands and works for every course, not only HR practicum.
 *
 * Seeds two temp students (one with feedback, one without) and removes them.
 */
import { Audit, sbQuery, mutateData, appReady } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'feedback-pill' });
const ts = Date.now();
const WITH_ID = `audit-fbp-with-${ts}`,  WITH_NAME  = `משוב יש ${ts}`;
const WITHOUT_ID = `audit-fbp-wo-${ts}`,  WITHOUT_NAME = `משוב אין ${ts}`;

let seedOk = false, courseId = '', year = '';
try {
  const data = await loadData();
  const course = (data.courses || []).find(c => c?.type === 'practicum') || (data.courses || [])[0] || {};
  courseId = course.id || '';
  year = course.year || '';
  const base = { courseId, year, acceptedOrg: 'ארגון בדיקה', hired: false };
  const withFb = { ...base, id: WITH_ID, name: WITH_NAME,
    feedbackSubmittedAt: new Date(ts).toISOString(),
    feedbackText: JSON.stringify({ v: 2, overallScore: 90, recommendation: 'yes' }) };
  const withoutFb = { ...base, id: WITHOUT_ID, name: WITHOUT_NAME };
  await mutateData(data => ({ ...data, students: [...(data.students || []), withFb, withoutFb] }));
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
await audit.page.evaluate(({ cId }) => {
  localStorage.setItem('practicum_v2_page', 'students');
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: cId || '__all__', year: '__all__' }));
}, { cId: courseId });
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(1300);

const rowFor = (name) => audit.page.locator('li[data-info-row]').filter({ hasText: name }).first();
const pillIn = async (name) => {
  const row = rowFor(name);
  if (await row.count() === 0) return null; // row not found
  return await row.locator('span', { hasText: /^✓ משוב$/ }).count() > 0;
};

audit.log('FEEDBACK-pill: with-feedback student shows "✓ משוב", without-feedback does not');
{
  audit.observerMark();
  const withPill = seedOk ? await pillIn(WITH_NAME) : null;
  const withoutPill = seedOk ? await pillIn(WITHOUT_NAME) : null;
  const obs = audit.observerSnapshot();
  if (!seedOk || withPill === null || withoutPill === null) {
    audit.recordCell({ id: 'FEEDBACK-pill', tableRef: 'StudentsPage / "✓ משוב" card pill', expected: 'seed + both rows render', observed: `seedOk=${seedOk}, withRow=${withPill !== null}, withoutRow=${withoutPill !== null}`, pass: null, notes: 'Could not seed or find the seeded rows.' });
  } else {
    audit.recordCell({
      id: 'FEEDBACK-pill', tableRef: 'StudentsPage / green "✓ משוב" iff hasEmployerFeedback(s)',
      expected: 'feedback student shows "✓ משוב"; placed-but-no-feedback student shows no pill',
      observed: `withFeedbackPill=${withPill}, withoutFeedbackPill=${withoutPill}, errors=(${obs.pageErrors.length}p)`,
      pass: withPill === true && withoutPill === false && obs.pageErrors.length === 0,
      notes: withPill !== true ? 'Feedback student is MISSING the "✓ משוב" pill.' : withoutPill ? 'No-feedback student WRONGLY shows the "✓ משוב" pill.' : '',
    });
  }
}

try {
  const data = await loadData();
  await mutateData(data => ({ ...data, students: (data.students || []).filter(s => s.id !== WITH_ID && s.id !== WITHOUT_ID) }));
  audit.log('Cleanup: removed temp students');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

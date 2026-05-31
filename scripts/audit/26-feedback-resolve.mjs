#!/usr/bin/env node
/**
 * 26-feedback-resolve.mjs — "שלח משוב למעסיק" resolves the hosting employer even
 * when the student's acceptedOrg is a near-miss of the employer name, and gives a
 * CLEAR error (not a silent no-op) when no employer matches.
 *
 *   FEEDBACK-resolve  acceptedOrg "X" matched to employer "X/Y" → no "not found"
 *                     alert (it resolved, the email/WhatsApp can go out).
 *   FEEDBACK-missing  acceptedOrg with no matching employer → a clear alert fires
 *                     ("לא נמצא מעסיק…") instead of silently doing nothing.
 *
 * Guards the report that feedback couldn't be sent to שירי (acceptedOrg
 * "Icon Group" vs employer "Icon Group/I digital").
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

const audit = new Audit({ name: 'feedback-resolve' });
const ts = Date.now();
const EID = `audit-fb-emp-${ts}`, ORG = `מעסיק משוב ${ts}`;
const S_MATCH = `audit-fb-m-${ts}`, NAME_M = `משוב התאמה ${ts}`;
const S_MISS = `audit-fb-x-${ts}`, NAME_X = `משוב חסר ${ts}`;

let seedOk = false, courseId = '';
try {
  const data = await loadData();
  courseId = ((data.courses || []).find(c => c?.type === 'practicum') || (data.courses || [])[0])?.id || '';
  // Employer name is the org name + a "/branch" suffix → exact match on the
  // student's acceptedOrg fails, prefix match must succeed.
  const emp = { id: EID, name: `${ORG}/סניף`, courseIds: [courseId], description: 'x', contactEmail: 'audit-emp@audit.local', contactPhone: '050-0000000', contactPerson: 'איש קשר', positions: 1, positionsTotal: 1, filledPositions: 1, vacancySlots: [] };
  const sMatch = { id: S_MATCH, name: NAME_M, email: `m${ts}@audit.local`, courseId, acceptedOrg: ORG, feedbackToken: `tok-m-${ts}` };
  const sMiss = { id: S_MISS, name: NAME_X, email: `x${ts}@audit.local`, courseId, acceptedOrg: `ארגון לא קיים ${ts}`, feedbackToken: `tok-x-${ts}` };
  await sbPatchData({ ...data, employers: [...(data.employers || []), emp], students: [...(data.students || []), sMatch, sMiss] });
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
await audit.page.setViewportSize({ width: 1440, height: 1000 });
await audit.page.evaluate(({ c }) => {
  localStorage.setItem('practicum_v2_page', 'students');
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c || '__all__', year: '__all__' }));
}, { c: courseId });
// Capture native alert text + swallow popups (mailto window.open).
let lastDialog = '';
audit.page.on('dialog', d => { lastDialog = d.message(); d.dismiss().catch(() => {}); });
audit.page.on('popup', p => p.close().catch(() => {}));
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1300);

async function clickFeedback(name) {
  lastDialog = '';
  const row = audit.page.locator('li[data-info-row]').filter({ hasText: name }).first();
  if (!(await row.isVisible().catch(() => false))) return { opened: false };
  await row.getByTitle('ערוך').first().click().catch(() => {});
  await audit.page.waitForTimeout(1200);
  const opened = await audit.page.evaluate(() => !!document.querySelector('button[aria-label="סגור"]'));
  const btn = audit.page.locator('button').filter({ hasText: 'שלח משוב למעסיק' }).first();
  if (await btn.count() > 0) { await btn.scrollIntoViewIfNeeded().catch(() => {}); await btn.click().catch(() => {}); await audit.page.waitForTimeout(700); }
  await audit.page.keyboard.press('Escape').catch(() => {});
  await audit.page.waitForTimeout(400);
  return { opened, dialog: lastDialog };
}

audit.log('FEEDBACK-resolve: near-miss org name resolves (no "not found" alert)');
{
  audit.observerMark();
  const r = seedOk ? await clickFeedback(NAME_M) : { opened: false };
  const obs = audit.observerSnapshot();
  const resolved = r.opened && !/לא נמצא מעסיק/.test(r.dialog || '');
  audit.recordCell({
    id: 'FEEDBACK-resolve', tableRef: 'StudentEditor / feedback employer resolution (prefix)',
    expected: 'acceptedOrg "X" resolves to employer "X/branch" — no "not found" alert',
    observed: `editorOpened=${r.opened}, alert="${(r.dialog || '').slice(0, 40)}", errors=(${obs.pageErrors.length}p)`,
    pass: seedOk ? (resolved && obs.pageErrors.length === 0) : null,
    notes: !seedOk ? 'seed failed' : resolved ? '' : 'Near-miss org name did not resolve to the employer.',
  });
}

audit.log('FEEDBACK-missing: unmatched org gives a clear alert (not silent)');
{
  audit.observerMark();
  const r = seedOk ? await clickFeedback(NAME_X) : { opened: false };
  const obs = audit.observerSnapshot();
  const clearError = r.opened && /לא נמצא מעסיק/.test(r.dialog || '');
  audit.recordCell({
    id: 'FEEDBACK-missing', tableRef: 'StudentEditor / feedback no-employer error',
    expected: 'an unmatched acceptedOrg shows a clear "לא נמצא מעסיק" alert',
    observed: `editorOpened=${r.opened}, alert="${(r.dialog || '').slice(0, 40)}", errors=(${obs.pageErrors.length}p)`,
    pass: seedOk ? (clearError && obs.pageErrors.length === 0) : null,
    notes: !seedOk ? 'seed failed' : clearError ? '' : 'No clear alert for an unmatched employer (silent failure).',
  });
}

try {
  const data = await loadData();
  await sbPatchData({ ...data, employers: (data.employers || []).filter(e => e.id !== EID), students: (data.students || []).filter(s => s.id !== S_MATCH && s.id !== S_MISS) });
  audit.log('Cleanup: removed temp employer + students');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

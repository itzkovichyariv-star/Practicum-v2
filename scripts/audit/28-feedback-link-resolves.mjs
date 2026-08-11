#!/usr/bin/env node
/**
 * 28-feedback-link-resolves.mjs — the employer-feedback LINK actually works.
 *
 * Pins the desired behaviour behind the 2026-07-08 fix (email/copy link was
 * arriving as "הקישור אינו תקין"):
 *
 *   FB-LINK-format   Clicking "🔗 העתק קישור" produces a SHORT production URL
 *                    (https://practicum.yarivitzkovich.org/f?t=<token>) — the
 *                    short route + short query is what survives email wrapping.
 *   FB-LINK-persist  The token in that URL is actually written to the DB (the
 *                    intermittent copy-failure was a token that never persisted).
 *   FB-LINK-resolves Navigating the /f?t= link renders the evaluation FORM for
 *                    the right student — NOT the "הקישור אינו תקין" page.
 *   FB-LINK-stable   Clicking again returns the SAME token (never regenerated →
 *                    a link already sent to an employer stays valid).
 *
 * The generated URL points at production by design, so we assert its shape +
 * DB persistence, then prove resolution by opening the SAME token on the dev
 * server's /f route (which reads the same Supabase row).
 */
import { Audit, sbQuery, mutateData, appReady } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'feedback-link-resolves' });
const ts = Date.now();
// Short, realistic student id (real ids are 1–3 chars) so the generated URL
// length reflects production — a 23-char audit id would falsely fail the wrap
// check. Still unique + clearly an audit row for cleanup.
const SID = `z${ts.toString(36).slice(-5)}`, SNAME = `משוב קישור ${ts}`, ORG = `ארגון קישור ${ts}`;
const EID = `audit-fbl-emp-${ts}`;
const PROD_PREFIX = 'https://practicum.yarivitzkovich.org/f?t=';

let seedOk = false, courseId = '';
try {
  const data = await loadData();
  courseId = ((data.courses || []).find(c => c?.type === 'practicum') || (data.courses || [])[0])?.id || '';
  // Student WITH acceptedOrg but NO feedbackToken — forces the create+verify path.
  const emp = { id: EID, name: ORG, courseIds: [courseId], description: 'x', contactEmail: 'audit-fbl@audit.local', contactPhone: '050-0000000', contactPerson: 'איש קשר', positions: 1, positionsTotal: 1, filledPositions: 1, vacancySlots: [] };
  const student = { id: SID, name: SNAME, email: `fbl${ts}@audit.local`, courseId, acceptedOrg: ORG };
  await mutateData(data => ({ ...data, employers: [...(data.employers || []), emp], students: [...(data.students || []), student] }));
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
await audit.page.setViewportSize({ width: 1440, height: 1000 });
await audit.page.evaluate(({ c }) => {
  localStorage.setItem('practicum_v2_page', 'students');
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c || '__all__', year: '__all__' }));
}, { c: courseId });
audit.page.on('dialog', d => d.dismiss().catch(() => {}));
audit.page.on('popup', p => p.close().catch(() => {}));
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(1300);

/** Open the student editor and click "🔗 העתק קישור"; return the URL shown in the box. */
async function generateLink() {
  const row = audit.page.locator('li[data-info-row]').filter({ hasText: SNAME }).first();
  if (!(await row.isVisible().catch(() => false))) return { opened: false, url: '' };
  await row.getByTitle('ערוך').first().click().catch(() => {});
  await audit.page.waitForTimeout(1000);
  const opened = await audit.page.evaluate(() => !!document.querySelector('button[aria-label="סגור"]'));
  // Target the FEEDBACK copy button by its unique title (there is a separate
  // Stage-2 "העתק קישור" button for the org-preference link).
  const btn = audit.page.getByTitle('העתק קישור משוב ללוח').first();
  if (await btn.count() === 0) return { opened, url: '' };
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click({ timeout: 8000 }).catch(() => {});
  // Wait for ensureFeedbackToken's read → CAS-save → read-back round-trips.
  const box = audit.page.locator('input[data-feedback-url]').first();
  await box.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  return { opened, url: await box.inputValue().catch(() => '') };
}

audit.log('FB-LINK: generate link via the copy button');
const first = seedOk ? await generateLink() : { opened: false, url: '' };
const tokenMatch = (first.url || '').startsWith(PROD_PREFIX) ? decodeURIComponent(first.url.slice(PROD_PREFIX.length)) : '';

// ── Cell 1: URL shape ──────────────────────────────────────────────────────
audit.recordCell({
  id: 'FB-LINK-format', tableRef: 'dataApi.buildFeedbackUrl / short prod route',
  expected: `link is ${PROD_PREFIX}<token>`,
  observed: `url="${(first.url || '').slice(0, 72)}"`,
  pass: seedOk ? (!!tokenMatch && first.url.length <= 72) : null,
  notes: !seedOk ? 'seed failed' : tokenMatch ? '' : 'link is not the short production /f?t= form',
});

// ── Cell 2: token persisted to the DB ──────────────────────────────────────
let dbToken = '';
if (seedOk) {
  const data = await loadData();
  dbToken = ((data.students || []).find(s => s.id === SID) || {}).feedbackToken || '';
}
audit.recordCell({
  id: 'FB-LINK-persist', tableRef: 'ensureFeedbackToken / read-back verify',
  expected: 'the token in the link is saved on the student row',
  observed: `dbToken="${dbToken}", urlToken="${tokenMatch}"`,
  pass: seedOk ? (!!dbToken && dbToken === tokenMatch) : null,
  notes: !seedOk ? 'seed failed' : dbToken === tokenMatch ? '' : 'token in link was not persisted (would be a dead link)',
});

// ── Cell 3: the link resolves to the form (not "invalid") ──────────────────
let resolvedName = false, invalidPage = false;
if (tokenMatch) {
  await audit.page.goto(`${audit.baseUrl}/f?t=${encodeURIComponent(tokenMatch)}`, { waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1500);
  const txt = await audit.page.evaluate(() => document.body.innerText || '');
  resolvedName = txt.includes(SNAME);
  invalidPage = /הקישור אינו תקין/.test(txt);
}
audit.recordCell({
  id: 'FB-LINK-resolves', tableRef: '/f?t= → EmployerFeedback form',
  expected: `opening the link shows the eval form for "${SNAME}", not "הקישור אינו תקין"`,
  observed: `studentNameShown=${resolvedName}, invalidLinkPage=${invalidPage}`,
  pass: tokenMatch ? (resolvedName && !invalidPage) : null,
  notes: !tokenMatch ? 'no token to resolve' : resolvedName ? '' : 'the generated link did NOT render the form',
});

// ── Cell 4: idempotent (no regeneration) ───────────────────────────────────
let second = { url: '' };
if (tokenMatch) {
  await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1200);
  second = await generateLink();
}
const secondToken = (second.url || '').startsWith(PROD_PREFIX) ? decodeURIComponent(second.url.slice(PROD_PREFIX.length)) : '';
audit.recordCell({
  id: 'FB-LINK-stable', tableRef: 'ensureFeedbackToken / existing token wins',
  expected: 'clicking again returns the SAME token (never regenerated)',
  observed: `first="${tokenMatch}", second="${secondToken}"`,
  pass: tokenMatch ? (!!secondToken && secondToken === tokenMatch) : null,
  notes: !tokenMatch ? 'no first token' : secondToken === tokenMatch ? '' : 'token was regenerated — old links would die',
});

// ── Cleanup ────────────────────────────────────────────────────────────────
try {
  const data = await loadData();
  await mutateData(data => ({
    ...data,
    employers: (data.employers || []).filter(e => e.id !== EID),
    students: (data.students || []).filter(s => s.id !== SID),
  }));
  audit.log('Cleanup: removed temp employer + student');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

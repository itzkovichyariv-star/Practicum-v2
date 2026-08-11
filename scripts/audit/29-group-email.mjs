#!/usr/bin/env node
/**
 * 29-group-email.mjs — the Students-screen group-email tool ("✉ מייל לקבוצה").
 *
 *   GROUP-MAIL-open     The header button opens the compose modal with the
 *                       division chips.
 *   GROUP-MAIL-buckets  Switching division re-computes the recipient set from
 *                       the current course+year context: a placed test student
 *                       shows under "שובצו בארגון" and NOT under "טרם שובצו";
 *                       a not-placed test student shows the opposite.
 *
 * Seeds one placed + one not-placed student (unique names, same course/year) so
 * the assertion is by NAME membership, independent of the other live students.
 */
import { Audit, sbQuery, mutateData, appReady } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'group-email' });
const ts = Date.now();
const S_PLACED = `zgm-p-${ts.toString(36).slice(-4)}`, N_PLACED = `קבוצה שובץ ${ts}`;
const S_UNPLACED = `zgm-u-${ts.toString(36).slice(-4)}`, N_UNPLACED = `קבוצה טרם ${ts}`;

let seedOk = false, courseId = '', year = '';
try {
  const data = await loadData();
  const course = (data.courses || []).find(c => c?.type === 'practicum') || (data.courses || [])[0];
  courseId = course?.id || '';
  year = course?.year || '';
  const placed = { id: S_PLACED, name: N_PLACED, email: `p${ts}@audit.local`, courseId, year, acceptedOrg: `ארגון ${ts}` };
  const unplaced = { id: S_UNPLACED, name: N_UNPLACED, email: `u${ts}@audit.local`, courseId, year };
  await mutateData(data => ({ ...data, students: [...(data.students || []), placed, unplaced] }));
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
await audit.page.setViewportSize({ width: 1440, height: 1000 });
await audit.page.evaluate(({ c, y }) => {
  localStorage.setItem('practicum_v2_page', 'students');
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c || '__all__', year: y || '__all__' }));
}, { c: courseId, y: year });
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(1400);

/** Read the recipient-names box text in the open modal. */
const recipientsText = () => audit.page.locator('[data-mail-recipients]').first().innerText().catch(() => '');

// ── Open the modal ──────────────────────────────────────────────────────────
audit.observerMark();
let opened = false, chipsPresent = false;
if (seedOk) {
  const btn = audit.page.locator('button').filter({ hasText: 'מייל לקבוצה' }).first();
  if (await btn.count() > 0) {
    await btn.click().catch(() => {});
    await audit.page.waitForTimeout(700);
    opened = await audit.page.locator('[data-mail-recipients]').count() > 0;
    chipsPresent = await audit.page.locator('button').filter({ hasText: 'שובצו בארגון' }).count() > 0
      && await audit.page.locator('button').filter({ hasText: 'טרם שובצו' }).count() > 0;
  }
}
{
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'GROUP-MAIL-open', tableRef: 'StudentsPage / group-email button + modal',
    expected: '"✉ מייל לקבוצה" opens the compose modal with division chips',
    observed: `opened=${opened}, chipsPresent=${chipsPresent}, errors=(${obs.pageErrors.length}p)`,
    pass: seedOk ? (opened && chipsPresent && obs.pageErrors.length === 0) : null,
    notes: !seedOk ? 'seed failed' : (opened && chipsPresent) ? '' : 'modal or chips missing',
  });
}

// ── Division switching recomputes recipients ────────────────────────────────
let placedInPlaced = false, unplacedNotInPlaced = false, unplacedInNotplaced = false, placedNotInNotplaced = false;
if (opened) {
  // Scope chip clicks to the modal — "טרם שובצו" also exists as a stage tab.
  const chip = (label) => audit.page.locator('[data-mail-modal] button').filter({ hasText: label }).first();
  await chip('שובצו בארגון').click().catch(() => {});
  await audit.page.waitForTimeout(400);
  const placedText = await recipientsText();
  placedInPlaced = placedText.includes(N_PLACED);
  unplacedNotInPlaced = !placedText.includes(N_UNPLACED);

  await chip('טרם שובצו').click().catch(() => {});
  await audit.page.waitForTimeout(400);
  const notplacedText = await recipientsText();
  unplacedInNotplaced = notplacedText.includes(N_UNPLACED);
  placedNotInNotplaced = !notplacedText.includes(N_PLACED);
}
{
  const ok = placedInPlaced && unplacedNotInPlaced && unplacedInNotplaced && placedNotInNotplaced;
  audit.recordCell({
    id: 'GROUP-MAIL-buckets', tableRef: 'StudentsPage / MAIL_BUCKETS predicate → recipients',
    expected: 'placed student appears only under "שובצו", not-placed only under "טרם שובצו"',
    observed: `placed∈placed=${placedInPlaced}, unplaced∉placed=${unplacedNotInPlaced}, unplaced∈notplaced=${unplacedInNotplaced}, placed∉notplaced=${placedNotInNotplaced}`,
    pass: opened ? ok : null,
    notes: !opened ? 'modal never opened' : ok ? '' : 'division predicate did not partition recipients correctly',
  });
}

// ── Candidates-parity: always-visible checkboxes + select-all + inline mail ──
let checkboxAlways = false, inlineMailShown = false, inlineModalOpened = false;
if (opened) {
  // Close the bucket modal first.
  await audit.page.locator('[data-mail-modal] button').filter({ hasText: 'ביטול' }).first().click().catch(() => {});
  await audit.page.locator('[data-mail-modal]').first().waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
}
if (seedOk) {
  // Row checkboxes exist with NO select-mode toggle (they're always rendered).
  checkboxAlways = await audit.page.locator('li[data-info-row] [role="checkbox"]').count() > 0;
  // "בחר הכל" selects the current filter → the inline "📧 מייל Outlook" appears.
  await audit.page.locator('button').filter({ hasText: 'בחר הכל' }).first().click().catch(() => {});
  await audit.page.waitForTimeout(400);
  const inlineMail = audit.page.locator('button').filter({ hasText: 'מייל Outlook' }).first();
  inlineMailShown = await inlineMail.count() > 0;
  await inlineMail.click().catch(() => {});
  await audit.page.waitForTimeout(500);
  inlineModalOpened = await audit.page.locator('[data-mail-recipients]').count() > 0;
}
audit.recordCell({
  id: 'GROUP-MAIL-checkbox', tableRef: 'StudentsPage / always-visible checkboxes + inline select-all mail',
  expected: 'row checkboxes always shown; "בחר הכל" selects → inline "📧 מייל Outlook" opens the compose modal',
  observed: `checkboxAlways=${checkboxAlways}, inlineMailShown=${inlineMailShown}, modalOpened=${inlineModalOpened}`,
  pass: seedOk ? (checkboxAlways && inlineMailShown && inlineModalOpened) : null,
  notes: !seedOk ? 'seed failed' : (checkboxAlways && inlineMailShown && inlineModalOpened) ? '' : 'candidates-style selection UI missing',
});

// ── Cleanup ─────────────────────────────────────────────────────────────────
try {
  const data = await loadData();
  await mutateData(data => ({ ...data, students: (data.students || []).filter(s => s.id !== S_PLACED && s.id !== S_UNPLACED) }));
  audit.log('Cleanup: removed temp students');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

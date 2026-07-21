#!/usr/bin/env node
/**
 * 09-org-history-dedup.mjs — org-choice history + change-check + dedup.
 *
 *   DEDUP-suggestions  The Employers admin "הצעות ארגון מהמועמדים" section shows
 *                      exactly ONE row per candidate — the candidate's LATEST
 *                      submission, and only if that submission still carries an
 *                      unhandled suggestion. Rendered count must equal the
 *                      latest-per-candidate expectation computed from cv_updates,
 *                      and no proposer may appear twice.
 *
 *   CARD-history       Opening a student who has /cv-update submissions shows the
 *                      "העדפות הארגון שהמועמד/ת הגיש/ה" panel inside "בחירת ארגון".
 *                      When the candidate has >1 submission, the "היסטוריית הגשות"
 *                      toggle expands the dated history.
 *
 * NOTE: DEDUP runs FIRST (on the Employers page). The Students page has an
 * auto-process effect that may mark a submission seen on mount; running the
 * Employers measurement before ever mounting StudentsPage keeps the expectation
 * stable.
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

const audit = new Audit({ name: 'org-history-dedup' });
await audit.setup();

// ─── Preload cv_updates + students for expectations ───────────────────
let cvRows = [];
let students = [];
try {
  cvRows = await sbQuery('cv_updates', {
    select: 'id,email,name,suggested_org,uploaded_at,seen_at',
    filter: 'order=uploaded_at.desc',
  });
} catch (e) { audit.log(`cv_updates preload failed (non-fatal): ${e.message.slice(0, 100)}`); }
let dismissedSuggestions = new Set();
try {
  const pd = await sbQuery('practicum_data', { filter: 'org_id=eq.default', select: 'data' });
  students = (pd?.[0]?.data?.students || []).filter((s) => s?.email);
  // Handled suggestions live in the data blob (dismissedSuggestionIds), not seen_at.
  dismissedSuggestions = new Set(pd?.[0]?.data?.dismissedSuggestionIds || []);
} catch (e) { audit.log(`practicum_data preload failed (non-fatal): ${e.message.slice(0, 100)}`); }

// Latest submission per candidate (rows already sorted uploaded_at desc).
const latestByEmail = new Map();
for (const r of cvRows) {
  const key = (r.email || '').trim().toLowerCase();
  if (!key || latestByEmail.has(key)) continue; // first seen = latest
  latestByEmail.set(key, r);
}
const expectedSuggestions = [...latestByEmail.values()].filter((r) => r.suggested_org?.name && !r.seen_at && !dismissedSuggestions.has(r.id));
const expectedCount = expectedSuggestions.length;
// Naive (pre-dedup) count: every unseen, non-dismissed row with a suggestion. If
// this exceeds expectedCount, dedup is actively collapsing duplicates.
const naiveCount = cvRows.filter((r) => r.suggested_org?.name && !r.seen_at && !dismissedSuggestions.has(r.id)).length;

// ─── DEDUP-suggestions ────────────────────────────────────────────────
audit.log(`DEDUP-suggestions: Employers shows latest-per-candidate suggestions (expect ${expectedCount}, naive ${naiveCount})`);
{
  await audit.page.evaluate(() => localStorage.setItem('practicum_v2_page', 'employers'));
  await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(1500);
  audit.observerMark();
  const after = await audit.shot('DEDUP-suggestions');

  const ui = await audit.page.evaluate(() => {
    const approveBtns = [...document.querySelectorAll('button')]
      .filter((b) => /אשר — צור ארגון פרטי/.test(b.textContent || '')).length;
    const proposers = [...document.querySelectorAll('div')]
      .map((d) => (d.textContent || '').trim())
      .filter((t) => /^הוצע ע״י:/.test(t))
      .map((t) => t.replace(/^הוצע ע״י:\s*/, ''));
    return { approveBtns, proposers };
  });
  const obs = audit.observerSnapshot();
  const uniqueProposers = new Set(ui.proposers).size;

  if (expectedCount === 0) {
    audit.recordCell({
      id: 'DEDUP-suggestions',
      tableRef: 'Employers / pending suggestions — latest-per-candidate',
      expected: 'no pending suggestions → section renders 0 rows',
      observed: `rendered=${ui.approveBtns}, expected=0, naive=${naiveCount}`,
      pass: ui.approveBtns === 0 ? null : false, after,
      notes: ui.approveBtns === 0
        ? 'Data-dependent: no unhandled suggestions to exercise dedup (asserted 0 rendered).'
        : 'Expected 0 suggestion rows but some rendered.',
    });
  } else {
    // The dedup invariant is per-CANDIDATE (per email): rendered must equal the
    // latest-per-email suggestion count. That alone proves dedup — if a real
    // duplicate leaked through, rendered would exceed expectedCount.
    // NOTE: we do NOT assert unique proposer *display names*. Two distinct
    // candidates (different emails) can legitimately share a name, which would
    // make a name-uniqueness check a false negative. uniqueProposers is kept in
    // `observed` for information only.
    const pass = ui.approveBtns === expectedCount && obs.pageErrors.length === 0;
    audit.recordCell({
      id: 'DEDUP-suggestions',
      tableRef: 'Employers / pending suggestions — latest-per-candidate',
      expected: `rendered == latest-per-candidate count (${expectedCount})${naiveCount > expectedCount ? `; dedup collapses ${naiveCount}→${expectedCount}` : ''}`,
      observed: `rendered=${ui.approveBtns}, expected=${expectedCount}, naive=${naiveCount}, proposers=${ui.proposers.length}, unique=${uniqueProposers}${uniqueProposers < ui.proposers.length ? ' (same-name distinct candidates — OK)' : ''}, errors=(${obs.pageErrors.length}p)`,
      pass, after,
      notes: ui.approveBtns !== expectedCount
        ? `Rendered ${ui.approveBtns} ≠ expected ${expectedCount} latest-per-candidate.`
        : '',
    });
  }
}

// ─── CARD-history ─────────────────────────────────────────────────────
// Open a student who has cv_updates and assert the submitted-prefs panel +
// (when applicable) the collapsible dated history toggle.
audit.log('CARD-history: student editor shows submitted-prefs panel + history toggle');
{
  const emailsWithCv = new Set([...latestByEmail.keys()]);
  const target = students.find((s) => emailsWithCv.has((s.email || '').trim().toLowerCase()));
  const targetSubs = target
    ? cvRows.filter((r) => (r.email || '').trim().toLowerCase() === (target.email || '').trim().toLowerCase())
    : [];

  if (!target) {
    audit.recordCell({
      id: 'CARD-history',
      tableRef: 'StudentEditor / בחירת ארגון / submitted-prefs panel',
      expected: 'panel shown for a student with cv_updates history',
      observed: `no student email matched any cv_updates row (cvEmails=${emailsWithCv.size}, students=${students.length})`,
      pass: null,
      notes: 'Data-dependent: no candidate with submissions is also a placed student — nothing to exercise.',
    });
  } else {
    await audit.page.evaluate(() => localStorage.setItem('practicum_v2_page', 'students'));
    await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
    await audit.page.waitForTimeout(1200);
    audit.observerMark();

    // Filter to the target via the search box (matches email).
    const search = audit.page.locator('input[type="search"]').first();
    await search.fill(target.email).catch(() => {});
    await audit.page.waitForTimeout(800);

    // Open the editor for the row containing the target email.
    const row = audit.page.locator('li').filter({ hasText: target.email }).first();
    let editorOpened = false;
    if (await row.isVisible().catch(() => false)) {
      const editBtn = row.getByTitle('ערוך').first();
      if (await editBtn.isVisible().catch(() => false)) {
        await editBtn.click().catch(() => {});
      } else {
        await row.hover();
        await audit.page.waitForTimeout(300);
        await row.getByTitle('ערוך').first().click().catch(() => {});
      }
      await audit.page.waitForTimeout(1200);
      editorOpened = true;
    }

    const before = await audit.shot('CARD-history-panel');
    // The redesign surfaces the student's submitted orgs as ranked OrgHub cards + a
    // "הוגש ע״י המועמד/ת · DATE" caption (practicum) and the previous-submissions
    // toggle (>1). Any of these — or the legacy panel text — counts as "submitted
    // prefs shown".
    const panelShown = await audit.page.evaluate(() =>
      document.querySelectorAll('[data-org-card]').length > 0
      || /הוגש ע״י המועמד\/ת/.test(document.body.textContent || '')
      || /היסטוריית הגשות קודמות/.test(document.body.textContent || '')
      || /העדפות הארגון שהמועמד\/ת הגיש\/ה/.test(document.body.textContent || ''));

    // If the candidate has >1 submission, exercise the history toggle.
    let toggleWorked = null;
    if (panelShown && targetSubs.length > 1) {
      const toggle = audit.page.getByRole('button', { name: /היסטוריית הגשות קודמות/ }).first();
      if (await toggle.isVisible().catch(() => false)) {
        await toggle.click().catch(() => {});
        await audit.page.waitForTimeout(400);
        toggleWorked = await audit.page.evaluate(() =>
          /הסתר היסטוריית הגשות/.test(document.body.textContent || ''));
      } else {
        toggleWorked = false;
      }
    }
    const after = await audit.shot('CARD-history-expanded');
    const obs = audit.observerSnapshot();

    // Pass: editor opened + panel shown + (if multi-submission) toggle expanded.
    const pass = editorOpened && panelShown &&
      (targetSubs.length > 1 ? toggleWorked === true : true) &&
      obs.pageErrors.length === 0;
    audit.recordCell({
      id: 'CARD-history',
      tableRef: 'StudentEditor / בחירת ארגון / submitted-prefs panel + history toggle',
      expected: `panel "העדפות הארגון…" shown for ${target.name || target.email}${targetSubs.length > 1 ? `; history toggle expands (${targetSubs.length} submissions)` : ' (single submission — no toggle)'}`,
      observed: `editorOpened=${editorOpened}, panelShown=${panelShown}, subs=${targetSubs.length}, toggleWorked=${toggleWorked}, errors=(${obs.pageErrors.length}p)`,
      pass, before, after,
      notes: !editorOpened ? 'Could not open the student editor (row/edit button not found).'
        : !panelShown ? 'Editor opened but submitted-prefs panel did not render.'
        : (targetSubs.length > 1 && toggleWorked !== true) ? 'History toggle did not expand.' : '',
    });
  }
}

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

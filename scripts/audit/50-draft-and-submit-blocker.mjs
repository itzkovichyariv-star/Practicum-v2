#!/usr/bin/env node
/**
 * 50-draft-and-submit-blocker.mjs — nothing typed is ever lost, and a blocked
 * submit always says why in Hebrew.
 *
 *   FB-submit-says-why   Press "שלח משוב" with the required score empty: the form
 *                        must show a HEBREW reason at the field. Before this fix the
 *                        native `required` made Chrome block the submit with an
 *                        English tooltip anchored ~930px above the button — off-screen
 *                        on a phone — so the page appeared to do nothing AND the app's
 *                        own Hebrew check was unreachable dead code. Two supervisors
 *                        gave up that way (נעמה ביטרמן, שיראל קורן — 2026-07-09), and
 *                        every word they had typed was unrecoverable.
 *   FB-draft-survives    Type into the open-ended fields, RELOAD the page, and the
 *                        text is still there with a "שוחזרו התשובות" banner.
 *
 * Yariv's binding ground rule (2026-07-20): "the recorded data should be kept
 * automatically while typed. that way if they go back to the same link nothing is
 * lost — this should be a ground rule in any current planning or future and should be
 * placed on all open ended."
 *
 * Uses a REAL student's feedback token from the live blob but NEVER submits — the
 * submit is deliberately blocked by the missing score, so no feedback is ever written.
 * The draft it creates is local to the audit browser and cleared at the end.
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

const audit = new Audit({ name: 'draft-and-submit-blocker' });

// A student who has a feedback token and has NOT yet submitted — so the form renders.
let token = '';
try {
  const d = (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};
  const s = (d.students || []).find(x => x.feedbackToken && !x.feedbackSubmittedAt);
  token = s?.feedbackToken || '';
} catch (e) { console.log(`token lookup failed: ${e.message.slice(0, 120)}`); }

await audit.setup();

const STRENGTHS = 'טקסט בדיקה — חוזקות';
const IMPROVE = 'טקסט בדיקה — לשיפור';

let hebrewError = false, stillOnForm = false, draftStored = false;
let restoredBanner = false, restoredStrengths = '', restoredImprove = '';

if (token) {
  const url = `${audit.baseUrl}/f/?t=${encodeURIComponent(token)}`;
  await audit.page.goto(url, { waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(2500);

  // Fill the OPEN-ENDED fields only — deliberately leaving the required score empty,
  // which is exactly the state both supervisors were in.
  await audit.page.evaluate(({ a, b }) => {
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const tas = [...document.querySelectorAll('textarea')];
    if (tas[3]) set(tas[3], a);
    if (tas[4]) set(tas[4], b);
  }, { a: STRENGTHS, b: IMPROVE });
  await audit.page.waitForTimeout(900); // debounced draft write

  draftStored = await audit.page.evaluate(t => !!localStorage.getItem(`practicum_draft_feedback_${t}`), token);

  await audit.page.locator('button[type=submit]').first().click().catch(() => {});
  await audit.page.waitForTimeout(900);

  const t1 = await audit.page.evaluate(() => document.body.innerText);
  hebrewError = /יש להזין ציון שביעות רצון כללית/.test(t1);
  stillOnForm = await audit.page.evaluate(() => !!document.querySelector('form'));

  // ── Reload: the typing must come back ────────────────────────────────────
  await audit.page.goto(url, { waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(2800);
  const after = await audit.page.evaluate(() => {
    const tas = [...document.querySelectorAll('textarea')];
    return {
      banner: /שוחזרו התשובות שהתחלת למלא/.test(document.body.innerText),
      s: tas[3]?.value || '', i: tas[4]?.value || '',
    };
  });
  restoredBanner = after.banner; restoredStrengths = after.s; restoredImprove = after.i;

  // Leave nothing behind in the audit browser.
  await audit.page.evaluate(t => localStorage.removeItem(`practicum_draft_feedback_${t}`), token);
}

const shot = await audit.shot('draft-and-blocker');

audit.recordCell({
  id: 'FB-submit-says-why',
  tableRef: 'EmployerFeedback — noValidate + Hebrew reason at the field',
  expected: 'submitting without the required score keeps you on the form and shows a HEBREW explanation (never a silent no-op or an English browser tooltip)',
  observed: token ? `hebrewError=${hebrewError}, stillOnForm=${stillOnForm}` : 'no unsubmitted feedback token available',
  pass: token ? (hebrewError && stillOnForm) : null,
  after: shot,
  notes: !hebrewError ? 'No Hebrew reason shown — the supervisor is back to guessing why nothing happens.' : '',
});

audit.recordCell({
  id: 'FB-draft-survives',
  tableRef: 'useFormDraft — typed content survives leaving and returning to the link',
  expected: 'open-ended text is persisted while typing and restored on a full reload, with a visible "שוחזרו התשובות" banner',
  observed: token
    ? `stored=${draftStored}, banner=${restoredBanner}, strengths="${restoredStrengths}", improvements="${restoredImprove}"`
    : 'no unsubmitted feedback token available',
  pass: token ? (draftStored && restoredBanner && restoredStrengths === STRENGTHS && restoredImprove === IMPROVE) : null,
  notes: !draftStored ? 'Nothing was persisted while typing — the ground rule is not implemented.'
    : !restoredBanner ? 'Restored silently; the person is not told their work came back.'
    : (restoredStrengths !== STRENGTHS) ? 'Restored content does not match what was typed.' : '',
});

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

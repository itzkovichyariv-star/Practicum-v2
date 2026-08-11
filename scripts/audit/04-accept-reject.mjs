#!/usr/bin/env node
/**
 * 04-accept-reject.mjs — acceptance / rejection email flow audit.
 *
 * Cell map:
 *   EMAIL-dialog-opens    Clicking "✓ הודעת קבלה" strip button opens
 *                         the email confirmation dialog.
 *   EMAIL-subject         Dialog subject = "ברכות — התקבלת לתכנית הפרקטיקום"
 *   EMAIL-orgs-link       Dialog body contains {{קישור_ארגונים}} placeholder.
 *   EMAIL-workshop-date   {{תאריך_סדנה}} is replaced (real date or ⚠️ warning).
 *   EMAIL-reject-dialog   Rejection dialog opens with correct subject.
 *
 * Seed: inserts an audit-tagged candidate with interviewResult="passed"
 * AND one with interviewResult="failed". Cleaned up at the end.
 * NEVER touches real candidates.
 */
import { Audit, sbQuery, appReady } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';

async function sbPatch(patch) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/practicum_data?org_id=eq.default`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`sbPatch failed ${r.status}: ${await r.text().catch(() => '')}`);
}

const audit = new Audit({ name: 'accept-reject' });
const auditTs = Date.now();
const AUDIT_PASSED_ID   = `audit-cand-pass-${auditTs}`;
const AUDIT_FAILED_ID   = `audit-cand-fail-${auditTs}`;
const AUDIT_PASSED_NAME = `Audit Pass ${auditTs}`;
const AUDIT_FAILED_NAME = `Audit Fail ${auditTs}`;
const AUDIT_EMAIL_PASS  = `audit-pass-${auditTs}@audit.local`;
const AUDIT_EMAIL_FAIL  = `audit-fail-${auditTs}@audit.local`;

// ── Seed ─────────────────────────────────────────────────────────────────────
let seedOk = false;
let seedCourseId = '';
try {
  const rows = await sbQuery('practicum_data', { select: 'data' });
  const current = rows?.[0]?.data || {};
  const existing = current.candidates || [];
  const courses  = current.courses || [];
  seedCourseId = courses[0]?.id || 'audit-course';

  await sbPatch({
    data: {
      ...current,
      candidates: [
        ...existing,
        { id: AUDIT_PASSED_ID, name: AUDIT_PASSED_NAME, email: AUDIT_EMAIL_PASS,
          courseId: seedCourseId, interviewResult: 'passed', interviewSummary: 'audit test summary', notes: '' },
        { id: AUDIT_FAILED_ID, name: AUDIT_FAILED_NAME, email: AUDIT_EMAIL_FAIL,
          courseId: seedCourseId, interviewResult: 'failed', interviewSummary: 'audit test summary', notes: '' },
      ],
    },
  });
  seedOk = true;
} catch (e) {
  console.log(`Seed failed: ${e.message.slice(0, 200)}`);
}

await audit.setup();
await audit.page.evaluate(({ cId }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: cId || '__all__', year: '__all__' }));
}, { cId: seedCourseId });
await audit.page.reload({ waitUntil: 'networkidle' });

// ── Navigate to candidates → passed tab ──────────────────────────────────────
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(800);
const candidatesBtn = audit.page.locator('button, [role="tab"]').filter({ hasText: /מועמדים/ }).first();
if (await candidatesBtn.count() > 0) await candidatesBtn.click();
await audit.page.waitForTimeout(1200);

// Click "passed" stage tab so the group-send strip appears
const passedTab = audit.page.locator('button').filter({ hasText: /עבר|עברה/ }).first();
if (await passedTab.count() > 0) {
  await passedTab.click();
  await audit.page.waitForTimeout(600);
}

// ─── EMAIL-dialog-opens ──────────────────────────────────────────────────────
audit.log('EMAIL-dialog-opens: acceptance dialog opens');
let dialogOpen = false;
{
  const before = await audit.shot('EMAIL-dialog-before');
  audit.observerMark();

  // Select our audit-pass candidate by clicking its checkbox
  const auditRow = audit.page.locator('li').filter({ hasText: AUDIT_PASSED_NAME }).first();
  if (await auditRow.isVisible().catch(() => false)) {
    const cb = auditRow.locator('input[type="checkbox"]').first();
    if (await cb.count() > 0) await cb.check();
    await audit.page.waitForTimeout(400);
  }

  // The group-send strip should now show "✓ הודעת קבלה"
  const acceptBtn = audit.page.locator('button').filter({ hasText: /הודעת קבלה/ }).first();
  const btnVisible = await acceptBtn.isVisible().catch(() => false);
  let observed = '';

  if (btnVisible) {
    await acceptBtn.click();
    await audit.page.waitForTimeout(800);
    const dialogHeading = audit.page.locator('text=הודעת קבלה').first();
    dialogOpen = await dialogHeading.isVisible().catch(() => false);
    observed = `acceptBtn visible; dialogOpen=${dialogOpen}`;
  } else {
    observed = `acceptBtn not visible (seedOk=${seedOk})`;
  }

  const after = await audit.shot('EMAIL-dialog-after');
  const obs = audit.observerSnapshot();
  audit.recordCell({
    id: 'EMAIL-dialog-opens',
    tableRef: 'CandidatesPage / passed tab / group-send strip / acceptance dialog',
    expected: 'Email confirmation dialog opens after clicking "הודעת קבלה"',
    observed: `${observed}; errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p)`,
    pass: dialogOpen,
    before, after,
    notes: !dialogOpen
      ? seedOk
        ? 'Audit passed-candidate was seeded but dialog did not open. Check the group-send strip logic.'
        : 'Seed failed — audit candidate not in DB. Check RLS on practicum_data.'
      : '',
  });
}

// ─── EMAIL-subject ────────────────────────────────────────────────────────────
audit.log('EMAIL-subject: acceptance dialog shows correct subject');
{
  audit.observerMark();
  const expectedSubject = 'ברכות — התקבלת לתכנית הפרקטיקום';
  let found = false;

  if (dialogOpen) {
    // Subject is in an <input> element in the modal, NOT a textarea
    const inputs = await audit.page.locator('input[type="text"], input:not([type])').all();
    for (const inp of inputs) {
      const val = await inp.inputValue().catch(() => '');
      if (val.includes(expectedSubject)) { found = true; break; }
    }
    // Also check plain text as fallback (rendered heading)
    if (!found) {
      const pageText = await audit.page.textContent('body').catch(() => '');
      found = pageText.includes(expectedSubject);
    }
  }

  audit.recordCell({
    id: 'EMAIL-subject',
    tableRef: 'CandidatesPage / acceptance dialog / subject input',
    expected: `Subject input value = "${expectedSubject}"`,
    observed: dialogOpen ? `subjectFound=${found}` : 'dialog not open — skipped',
    pass: dialogOpen ? found : null,
    notes: dialogOpen && !found ? 'Subject not found in any textarea value or page text.' : '',
  });
}

// ─── EMAIL-orgs-link ─────────────────────────────────────────────────────────
audit.log('EMAIL-orgs-link: acceptance email body contains /organizations');
{
  audit.observerMark();
  let pass = null;
  let observed = 'dialog not open — skipped';

  if (dialogOpen) {
    // Body is in a <textarea>. The dialog shows the template with {{קישור_ארגונים}}
    // placeholder — the actual URL is substituted only at send time.
    // We verify the placeholder exists in the body, confirming the link will be sent.
    let hasLink = false;
    const textareas = await audit.page.locator('textarea').all();
    for (const ta of textareas) {
      const val = await ta.inputValue().catch(() => '');
      if (val.includes('קישור_ארגונים') || val.includes('/organizations')) { hasLink = true; break; }
    }
    pass = hasLink;
    observed = `{{קישור_ארגונים}} placeholder in body textarea=${hasLink}`;
  }

  audit.recordCell({
    id: 'EMAIL-orgs-link',
    tableRef: 'CandidatesPage / acceptance dialog / body textarea / organizations placeholder',
    expected: 'Acceptance email body textarea contains {{קישור_ארגונים}} placeholder',
    observed,
    pass,
    notes: pass === false ? '{{קישור_ארגונים}} placeholder missing from the body textarea. Check EMAIL_TEMPLATES.acceptance.body in CandidatesPage.' : '',
  });
}

// ─── EMAIL-workshop-date ─────────────────────────────────────────────────────
audit.log('EMAIL-workshop-date: acceptance body contains workshop date (resolved or warning)');
{
  audit.observerMark();
  let pass = null;
  let observed = 'dialog not open — skipped';

  if (dialogOpen) {
    // The body should NOT contain the raw {{תאריך_סדנה}} placeholder —
    // it must have been replaced with either a real date or the ⚠️ warning.
    let bodyVal = '';
    const textareas = await audit.page.locator('textarea').all();
    for (const ta of textareas) {
      const val = await ta.inputValue().catch(() => '');
      if (val.includes('תאריך_סדנה') || val.includes('תאריך טרם נקבע')) { bodyVal = val; break; }
      if (val.length > 50) bodyVal = val; // pick the longest textarea as the body
    }
    const hasRawPlaceholder = bodyVal.includes('{{תאריך_סדנה}}');
    const hasResolvedDate = !hasRawPlaceholder && (bodyVal.includes('תאריך') || bodyVal.includes('סדנה'));
    pass = !hasRawPlaceholder; // passes if placeholder was substituted (date or warning)
    observed = `raw placeholder present=${hasRawPlaceholder}; resolved=${hasResolvedDate}`;
  }

  audit.recordCell({
    id: 'EMAIL-workshop-date',
    tableRef: 'CandidatesPage / acceptance dialog / body textarea / workshop date substitution',
    expected: '{{תאריך_סדנה}} is replaced in the body (either real date or ⚠️ warning)',
    observed,
    pass,
    notes: pass === false ? '{{תאריך_סדנה}} placeholder was not substituted. Check openEmailConfirm course lookup in CandidatesPage.' : '',
  });
}

// ─── EMAIL-present-tense ─────────────────────────────────────────────────────
audit.log('EMAIL-present-tense: acceptance body uses present tense ("אנו שמחים", not "שמחנו")');
{
  audit.observerMark();
  let pass = null;
  let observed = 'dialog not open — skipped';
  if (dialogOpen) {
    let bodyVal = '';
    const textareas = await audit.page.locator('textarea').all();
    for (const ta of textareas) {
      const val = await ta.inputValue().catch(() => '');
      if (val.length > 50) bodyVal = val; // the body is the long textarea
    }
    const hasPresent = bodyVal.includes('אנו שמחים');
    const hasPast = bodyVal.includes('שמחנו');
    pass = hasPresent && !hasPast;
    observed = `present("אנו שמחים")=${hasPresent}, past("שמחנו")=${hasPast}`;
  }
  audit.recordCell({
    id: 'EMAIL-present-tense',
    tableRef: 'CandidatesPage / acceptance body / present-tense phrasing',
    expected: 'body contains "אנו שמחים" and NOT the past-tense "שמחנו"',
    observed,
    pass,
    notes: pass === false ? 'Acceptance copy is past tense ("שמחנו") — should be present ("אנו שמחים").' : '',
  });
}

// Close dialog — modal has no Escape handler; must click ✕ or ביטול button inside it.
// The backdrop (fixed inset-0) doesn't block clicks on elements INSIDE the modal box.
if (dialogOpen) {
  // Click ביטול — the "cancel, don't send" button at the bottom of the dialog
  const cancelBtn = audit.page.locator('button').filter({ hasText: /ביטול — אל תשלח/ }).first();
  if (await cancelBtn.isVisible().catch(() => false)) {
    await cancelBtn.click();
  } else {
    // Fallback: click the ✕ close button in the dialog header
    await audit.page.locator('button').filter({ hasText: '✕' }).first().click().catch(() => {});
  }
  await audit.page.waitForTimeout(700);
  // Confirm the modal is gone
  const stillOpen = await audit.page.locator('text=ברכות — התקבלת').first().isVisible().catch(() => false);
  if (stillOpen) {
    // Last resort: force-click ✕
    await audit.page.locator('button').filter({ hasText: '✕' }).first().click({ force: true }).catch(() => {});
    await audit.page.waitForTimeout(500);
  }
}

// ─── EMAIL-reject-dialog ─────────────────────────────────────────────────────
audit.log('EMAIL-reject-dialog: rejection dialog opens with correct subject');
{
  const before = await audit.shot('EMAIL-reject-before');
  audit.observerMark();

  // Switch to "failed" tab
  const failedTab = audit.page.locator('button').filter({ hasText: /לא התקבל|נדחה|failed/i }).first();
  if (await failedTab.count() > 0) {
    await failedTab.click();
    await audit.page.waitForTimeout(600);
  }

  // Select the audit-fail candidate
  const failRow = audit.page.locator('li').filter({ hasText: AUDIT_FAILED_NAME }).first();
  if (await failRow.isVisible().catch(() => false)) {
    const cb = failRow.locator('input[type="checkbox"]').first();
    if (await cb.count() > 0) await cb.check();
    await audit.page.waitForTimeout(400);
  }

  const rejectBtn = audit.page.locator('button').filter({ hasText: /הודעת דחייה/ }).first();
  let rejectDialogOpen = false;
  let observed = '';

  if (await rejectBtn.isVisible().catch(() => false)) {
    await rejectBtn.click();
    await audit.page.waitForTimeout(800);
    const expectedSubject = 'תוצאת ראיון — תכנית הפרקטיקום';
    rejectDialogOpen = await audit.page.locator('text=הודעת דחייה').first().isVisible().catch(() => false);

    // Subject is in an <input> element — check its value
    let found = false;
    if (rejectDialogOpen) {
      const inputs = await audit.page.locator('input[type="text"], input:not([type])').all();
      for (const inp of inputs) {
        const val = await inp.inputValue().catch(() => '');
        if (val.includes(expectedSubject)) { found = true; break; }
      }
      if (!found) {
        const pageText = await audit.page.textContent('body').catch(() => '');
        found = pageText.includes(expectedSubject);
      }
    }
    observed = `rejectDialog=${rejectDialogOpen}; subject=${found}`;

    // Close rejection dialog via ביטול button (same as acceptance — no Escape handler)
    const cancelRejectBtn = audit.page.locator('button').filter({ hasText: /ביטול — אל תשלח/ }).first();
    if (await cancelRejectBtn.isVisible().catch(() => false)) {
      await cancelRejectBtn.click();
    } else {
      await audit.page.locator('button').filter({ hasText: '✕' }).first().click({ force: true }).catch(() => {});
    }
    await audit.page.waitForTimeout(400);

    const obs = audit.observerSnapshot();
    audit.recordCell({
      id: 'EMAIL-reject-dialog',
      tableRef: 'CandidatesPage / rejection dialog / subject',
      expected: `Rejection dialog opens; subject = "תוצאת ראיון — תכנית הפרקטיקום"`,
      observed: `${observed}; errors=(${obs.consoleErrors.length}c)`,
      pass: rejectDialogOpen && found,
      before, after: await audit.shot('EMAIL-reject-after'),
      notes: !rejectDialogOpen ? 'Rejection dialog did not open.' : !found ? 'Rejection subject text not found.' : '',
    });
  } else {
    const obs = audit.observerSnapshot();
    audit.recordCell({
      id: 'EMAIL-reject-dialog',
      tableRef: 'CandidatesPage / rejection dialog',
      expected: 'Rejection dialog opens',
      observed: `Rejection button not visible (seedOk=${seedOk})`,
      pass: seedOk ? false : null,
      notes: 'No failed candidates visible or group-send strip not showing.',
    });
  }
}

// ── Cleanup: remove all audit-cand-* candidates ──────────────────────────────
try {
  const rows = await sbQuery('practicum_data', { select: 'data' });
  const current = rows?.[0]?.data || {};
  const cleaned = (current.candidates || []).filter((c) => !c.id?.startsWith('audit-cand-'));
  await sbPatch({ data: { ...current, candidates: cleaned } });
  audit.log(`Cleanup: removed audit candidates (kept ${cleaned.length} real ones)`);
} catch (e) {
  audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`);
}

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

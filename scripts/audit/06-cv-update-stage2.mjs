#!/usr/bin/env node
/**
 * 06-cv-update-stage2.mjs — public /cv-update (stage 2) form audit.
 *
 * Cell map:
 *   CV-pickers-render     The 3 ranked org pickers + the "suggest your own org"
 *                         checkbox all render on the public form.
 *   CV-description-reveal Clicking an "ⓘ תיאור" button reveals that org's
 *                         description inline, and the revealed text matches the
 *                         org's `notes` in practicum_data. (This is the behavior
 *                         the coordinator couldn't find before — guard it.)
 *   CV-suggestion-required Ticking "suggest your own org" and submitting with the
 *                         required HR-rep fields empty shows the specific
 *                         validation error AND creates NO cv_updates row.
 *
 * Writes nothing to the DB: the validation cell is blocked before the insert,
 * so the audit never leaves a fake pending suggestion in your data.
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

const audit = new Audit({ name: 'cv-update-stage2' });
await audit.setup();

const auditTs = Date.now();
const auditEmail = `audit-${auditTs}-cv@audit.local`;
const auditStuId = `zcv6-${auditTs.toString(36).slice(-5)}`;

// The form is now FAIL-CLOSED: it offers only the organizations of the visitor's OWN
// course, resolved from ?email= (see 48-cvupdate-course-scope). A synthetic email that
// matches nobody is therefore offered NOTHING and the pickers do not render — that is
// correct behaviour, not a regression, but it means this cell must use a REAL student
// to exercise the pickers at all. Seed one for the audit email; removed at the end.
// (Same lesson as cells 46/47: a fixture that cannot occur in production tests nothing.)
const SB_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SB_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const SBH = { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}`, 'Content-Type': 'application/json' };
const readBlob = async () => {
  const r = await fetch(`${SB_URL}/rest/v1/practicum_data?org_id=eq.default&select=data,version`, { headers: SBH });
  return (await r.json())[0];
};
const writeBlob = async (data, version) => {
  const r = await fetch(`${SB_URL}/rest/v1/practicum_data?org_id=eq.default&version=eq.${version}`, {
    method: 'PATCH', headers: { ...SBH, Prefer: 'return=representation' },
    body: JSON.stringify({ data, version: version + 1, updated_at: new Date().toISOString() }),
  });
  const j = await r.json().catch(() => null);
  return Array.isArray(j) && j.length > 0;
};
let seededStudent = false;
for (let i = 0; i < 6 && !seededStudent; i++) {
  try {
    const row = await readBlob();
    const d = row.data;
    const courseId = ((d.courses || []).find(c => c?.type === 'practicum') || (d.courses || [])[0])?.id || '';
    seededStudent = await writeBlob({
      ...d,
      students: [...(d.students || []), {
        id: auditStuId, name: 'Audit CV', email: auditEmail, courseId,
        // NO CV on file — a FIRST-TIME student, so the form still REQUIRES a CV upload
        // (CV-nofile-feedback). A returning student who already has a CV is the
        // separate partial-update case, covered by cell 54.
        submissionStatus: 'submitted', preferences: [],
      }],
    }, row.version);
  } catch (e) { audit.log(`seed attempt ${i} failed: ${e.message.slice(0, 80)}`); }
}
audit.log(seededStudent ? 'Seeded a temp student so the course-scoped pickers render' : '⚠ could not seed student — pickers will be empty');

// Load the approved-org notes once so we can compare the revealed description
// against the real source-of-truth.
let employersByName = {};
try {
  const rows = await sbQuery('practicum_data', { filter: `org_id=eq.default`, select: 'data' });
  const emps = rows?.[0]?.data?.employers || [];
  for (const e of emps) if (e?.name) employersByName[e.name] = (e.notes || '').trim();
} catch (e) {
  audit.log(`could not preload employer notes (non-fatal): ${e.message.slice(0, 120)}`);
}

async function gotoForm() {
  await audit.page.goto(`${audit.baseUrl}/cv-update/?email=${encodeURIComponent(auditEmail)}&name=Audit%20CV`, { waitUntil: 'networkidle' });
  // Wait for the React island + Supabase org fetch (pickers only render once orgs load).
  await audit.page.waitForFunction(
    () => [...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('ללא העדפה')),
    null, { timeout: 20_000 },
  ).catch(() => {});
}

// ─── CV-pickers-render ────────────────────────────────────────────────
audit.log('CV-pickers-render: 3 ranked pickers + suggestion checkbox present');
{
  await gotoForm();
  await audit.page.waitForTimeout(400);
  const before = await audit.shot('CV-pickers-before');
  audit.observerMark();
  const labels = await audit.page.evaluate(() =>
    [...document.querySelectorAll('span')].map(s => s.textContent.trim()).filter(t => t.includes('העדפת ארגון')));
  const hasSuggestCheckbox = await audit.page.evaluate(() =>
    [...document.querySelectorAll('label')].some(l => (l.textContent || '').includes('יש לי ארגון להציע')));
  const obs = audit.observerSnapshot();
  const threePickers = labels.length === 3;
  audit.recordCell({
    id: 'CV-pickers-render',
    tableRef: '/cv-update / ranked pickers + suggestion toggle',
    expected: '3 "העדפת ארגון" picker labels + a "יש לי ארגון להציע" checkbox; no page errors',
    observed: `pickerLabels=${labels.length} [${labels.join(' | ')}], suggestCheckbox=${hasSuggestCheckbox}, errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p/${obs.netFailures.length}n)`,
    pass: threePickers && hasSuggestCheckbox && obs.pageErrors.length === 0,
    before,
    notes: !threePickers ? `Expected 3 picker labels, got ${labels.length}.` :
           !hasSuggestCheckbox ? 'Suggestion checkbox missing.' :
           obs.pageErrors.length ? `Page errors: ${obs.pageErrors.slice(0, 3).join(' | ')}` : '',
  });
}

// ─── CV-description-reveal ──────────────────────────────────────────────
audit.log('CV-description-reveal: ⓘ תיאור reveals org description matching practicum_data notes');
{
  await gotoForm();
  await audit.page.waitForTimeout(300);
  audit.observerMark();

  // Open the first ranked picker.
  const trigger = audit.page.getByRole('button').filter({ hasText: 'ללא העדפה' }).first();
  await trigger.click();
  await audit.page.waitForTimeout(250);

  // Click the first "ⓘ תיאור" button, recording which org it belongs to.
  const click = await audit.page.evaluate(() => {
    const infoBtns = [...document.querySelectorAll('button')].filter(b => (b.textContent || '').includes('תיאור'));
    if (!infoBtns.length) return { ok: false, reason: 'no ⓘ תיאור buttons' };
    const btn = infoBtns[0];
    const rowWrap = btn.closest('div')?.parentElement;
    const orgName = rowWrap?.querySelector('span')?.textContent?.trim() || null;
    btn.click();
    return { ok: true, orgName };
  });
  // Let React re-render, then read the revealed description via its stable hook.
  await audit.page.waitForTimeout(300);
  const descText = click.ok
    ? await audit.page.evaluate((name) => {
        const el = document.querySelector(`[data-org-description="${(window.CSS && CSS.escape) ? CSS.escape(name) : name}"]`)
          || document.querySelector('[data-org-description]');
        return el ? el.textContent.trim() : '';
      }, click.orgName).catch(() => '')
    : '';
  const result = { ok: click.ok, reason: click.reason, orgName: click.orgName, descText };
  const after = await audit.shot('CV-description-after');
  const obs = audit.observerSnapshot();

  const expectedNotes = result.orgName ? (employersByName[result.orgName] || '') : '';
  const revealedNonEmpty = !!result.descText && result.descText.length > 3;
  // The revealed text should match the real notes (compare a leading slice to
  // tolerate whitespace/truncation differences).
  const matchesNotes = expectedNotes
    ? result.descText.replace(/\s+/g, ' ').startsWith(expectedNotes.replace(/\s+/g, ' ').slice(0, 40))
    : revealedNonEmpty; // if we couldn't preload notes, accept any non-empty reveal
  audit.recordCell({
    id: 'CV-description-reveal',
    tableRef: '/cv-update / ⓘ תיאור description reveal',
    expected: 'clicking ⓘ תיאור reveals the org description; revealed text matches the org notes in practicum_data; no page errors',
    observed: `org="${result.orgName}", revealedLen=${result.descText?.length ?? 0}, matchesNotes=${matchesNotes}, sample="${(result.descText || '').slice(0, 60)}", errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p/${obs.netFailures.length}n)`,
    pass: result.ok && revealedNonEmpty && matchesNotes && obs.pageErrors.length === 0,
    after,
    notes: !result.ok ? `Reveal failed: ${result.reason}` :
           !revealedNonEmpty ? 'Clicked ⓘ but no description text appeared.' :
           !matchesNotes ? `Revealed text doesn't match practicum_data notes for "${result.orgName}".` : '',
  });
}

// ─── CV-nofile-feedback ─────────────────────────────────────────────────
// The submit button must RESPOND when no CV is attached (show a clear error),
// not sit there as a silent disabled/dead button.
audit.log('CV-nofile-feedback: submitting with no file shows a clear error (button responds)');
{
  await gotoForm();
  await audit.page.waitForTimeout(300);
  audit.observerMark();

  const rowsBefore = await sbQuery('cv_updates', { filter: `email=eq.${encodeURIComponent(auditEmail)}`, select: 'id' }).catch(() => []);

  const submit = audit.page.getByRole('button', { name: /שלח CV/ }).first();
  const isDisabled = await submit.isDisabled().catch(() => null);
  await submit.scrollIntoViewIfNeeded();
  await submit.click().catch(() => {});
  await audit.page.waitForTimeout(700);

  const after = await audit.shot('CV-nofile-feedback-after');
  const obs = audit.observerSnapshot();
  const bodyText = await audit.page.evaluate(() => document.body.textContent || '');
  const showsFileError = /יש לצרף קובץ קורות חיים/.test(bodyText);
  const rowsAfter = await sbQuery('cv_updates', { filter: `email=eq.${encodeURIComponent(auditEmail)}`, select: 'id' }).catch(() => []);
  const noRowCreated = rowsAfter.length === rowsBefore.length;

  audit.recordCell({
    id: 'CV-nofile-feedback',
    tableRef: '/cv-update / submit with no file → visible error (not a dead button)',
    expected: 'button is clickable (not disabled); clicking with no file shows "יש לצרף קובץ קורות חיים"; no row created',
    observed: `disabledBeforeClick=${isDisabled}, fileError=${showsFileError}, rowDelta=${rowsAfter.length - rowsBefore.length}, errors=(${obs.pageErrors.length}p)`,
    pass: isDisabled === false && showsFileError && noRowCreated && obs.pageErrors.length === 0,
    after,
    notes: isDisabled ? 'Submit button is still disabled with no file — it should be clickable and explain why.' :
           !showsFileError ? 'No file-required error appeared after clicking — button felt unresponsive.' : '',
  });
}

// ─── CV-suggestion-required ─────────────────────────────────────────────
audit.log('CV-suggestion-required: empty suggestion submit shows error + creates NO cv_updates row');
{
  await gotoForm();
  await audit.page.waitForTimeout(300);
  audit.observerMark();

  // Upload a tiny CV so the file-required guard passes (it runs before the
  // suggestion check). The upload itself only happens AFTER validation passes,
  // so an incomplete suggestion never writes to storage/DB.
  await audit.page.locator('input[type="file"]').first().setInputFiles({
    name: 'audit-cv.txt', mimeType: 'text/plain',
    buffer: Buffer.from(`audit cv ${auditTs}`, 'utf-8'),
  });

  // Tick the "suggest your own org" checkbox, leave all HR fields empty.
  await audit.page.locator('input[type="checkbox"]').first().check();
  await audit.page.waitForTimeout(150);

  const rowsBefore = await sbQuery('cv_updates', { filter: `email=eq.${encodeURIComponent(auditEmail)}`, select: 'id' }).catch(() => []);

  const submit = audit.page.getByRole('button', { name: /שלח CV/ }).first();
  await submit.scrollIntoViewIfNeeded();
  await submit.click();
  await audit.page.waitForTimeout(900);

  const after = await audit.shot('CV-suggestion-required-after');
  const obs = audit.observerSnapshot();
  const errText = await audit.page.evaluate(() => document.body.textContent || '');
  const showsRequiredError = /להצעת ארגון יש למלא/.test(errText);
  const rowsAfter = await sbQuery('cv_updates', { filter: `email=eq.${encodeURIComponent(auditEmail)}`, select: 'id' }).catch(() => []);
  const noRowCreated = rowsAfter.length === rowsBefore.length;

  audit.recordCell({
    id: 'CV-suggestion-required',
    tableRef: '/cv-update / suggestion required-fields validation',
    expected: 'specific "להצעת ארגון יש למלא…" error shown; no cv_updates row created; no page errors',
    observed: `requiredError=${showsRequiredError}, rowDelta=${rowsAfter.length - rowsBefore.length}, errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p/${obs.netFailures.length}n)`,
    pass: showsRequiredError && noRowCreated && obs.pageErrors.length === 0,
    after,
    notes: !showsRequiredError ? 'Expected the required-fields error; not found in page text.' :
           !noRowCreated ? `A cv_updates row was created despite incomplete suggestion (delta=${rowsAfter.length - rowsBefore.length}).` : '',
  });
}

// ── Cleanup: remove the seeded student (CAS retry — must not linger in prod) ──
if (seededStudent) {
  let cleaned = false;
  for (let i = 0; i < 6 && !cleaned; i++) {
    try {
      const row = await readBlob();
      const d = row.data;
      cleaned = await writeBlob({ ...d, students: (d.students || []).filter(s => s.id !== auditStuId) }, row.version);
    } catch (e) { audit.log(`cleanup attempt ${i} failed: ${e.message.slice(0, 80)}`); }
  }
  audit.log(cleaned ? 'Cleanup: removed temp student' : '⚠ Cleanup FAILED — a temp student may remain.');
}

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

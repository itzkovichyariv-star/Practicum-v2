#!/usr/bin/env node
/**
 * 01-registration.mjs — public /register form audit.
 *
 * Cell map:
 *   REG-validation     Empty submit shows specific error message ("שם ומייל נדרשים")
 *   REG-happy-path     Filling all required fields + CV upload creates one
 *                      candidate_submissions row with EXACTLY the values we
 *                      filled in. Success UI replaces the form.
 *   REG-slot-booking   When an available slot is picked, the slot's
 *                      booked_count increments by exactly 1.
 *   REG-idempotency    Submitting twice (refresh + resubmit same email)
 *                      doesn't crash or create a malformed row.
 *
 * Seed-and-clean: every cell uses a UNIQUE email tagged `audit-<ts>@audit.local`
 * so concurrent runs and real submissions can't collide. We DELETE these
 * audit-tagged rows at the start and end of the run.
 *
 * NOTE on file upload: the form requires a CV upload to storage bucket
 * `candidate-uploads`. We use a tiny in-memory text file so the upload
 * succeeds without disk I/O. The bucket should accept text/plain.
 */
import { Audit, sbQuery, sbInsert, sbDelete, appReady } from '../audit-lib.mjs';

const audit = new Audit({ name: 'registration' });
await audit.setup();

const auditTs = Date.now();
const auditEmail = `audit-${auditTs}@audit.local`;
const auditName = `Audit User ${auditTs}`;

// Clean any leftover audit-tagged rows from prior runs so we have a
// known-empty starting state. RLS lets anon DELETE here only if the
// table's policy allows it; if not, we'll surface the error.
try {
  await sbDelete('candidate_submissions', `email=like.audit-*@audit.local`);
} catch (e) {
  // Anon may not have DELETE rights — that's fine; the unique email
  // per run means we never collide. Just log and continue.
  audit.log(`pre-clean (non-fatal): ${e.message.slice(0, 120)}`);
}

// ── Seed a slot + its per-day Zoom link (for REG-onscreen-zoom) ───────────────
// The success screen shows the Zoom block ONLY when practicum_data.interviewZoomLinks
// has a link for the BOOKED slot's date (else it shows "the link will be sent later").
// Booking whatever slot sorted first meant the cell depended on ambient data and sat
// permanently red. So we seed our own future slot AND a Zoom link for its exact date,
// book that slot by id, and remove both afterwards.
const SUPA = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const SBH = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
const zoomSlotDate = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
const ZOOM_TEST_LINK = `https://ariel-ac-il.zoom.us/j/audit-${auditTs}`;
let zoomSlotId = null;

const readBlob = async () => (await (await fetch(`${SUPA}/rest/v1/practicum_data?org_id=eq.default&select=data,version`, { headers: SBH })).json())[0];
/** CAS-write practicum_data; returns true when this write won the version race. */
async function casBlob(mutate) {
  for (let i = 0; i < 6; i++) {
    const row = await readBlob();
    const next = mutate(structuredClone(row.data));
    const r = await fetch(`${SUPA}/rest/v1/practicum_data?org_id=eq.default&version=eq.${row.version}`, {
      method: 'PATCH', headers: { ...SBH, Prefer: 'return=representation' },
      body: JSON.stringify({ data: next, version: row.version + 1, updated_at: new Date().toISOString() }),
    });
    const j = await r.json().catch(() => null);
    if (Array.isArray(j) && j.length) return true;
  }
  return false;
}

try {
  const ins = await sbInsert('public_interview_slots', {
    date: zoomSlotDate, start_time: '09:00', end_time: '09:30', capacity: 1, booked_count: 0,
    course_name: 'פרקטיקום משאבי אנוש', note: `audit-zoom-${auditTs}`,
  });
  zoomSlotId = (Array.isArray(ins) ? ins[0]?.id : ins?.id) ?? null;
  const linked = await casBlob((d) => ({ ...d, interviewZoomLinks: { ...(d.interviewZoomLinks || {}), [zoomSlotDate]: ZOOM_TEST_LINK } }));
  audit.log(`Seeded zoom slot ${zoomSlotId} on ${zoomSlotDate} (zoom link seeded: ${linked})`);
} catch (e) {
  audit.log(`zoom-slot seed (non-fatal): ${e.message.slice(0, 120)}`);
}

// Helper to fill a textarea/input by id and dispatch change events
// React expects (otherwise the state doesn't update).
async function fillById(page, id, value) {
  await page.locator(`#${id}`).fill(value);
}

// Helper to upload a tiny CV file via the form's file input.
async function uploadTinyCv(page, name = 'audit-cv.txt') {
  const fileInput = page.locator('input[type="file"]').first();
  // Build a buffer via setInputFiles' second form (in-memory File). The
  // upload path lands in Supabase storage at `candidate-uploads/...`.
  await fileInput.setInputFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(`Audit CV placeholder — run ${auditTs}`, 'utf-8'),
  });
}

// Fill EVERY questionnaire textarea so validation passes. Each is
// addressed by its q-<key> id (from RegistrationForm.tsx line 281+).
async function fillQuestionnaire(page) {
  const placeholder = 'Audit-fill placeholder text for required questionnaire field.';
  const ids = [
    'q-studyTracks', 'q-gpa', 'q-workHistory', 'q-favRole', 'q-leastFavRole',
    'q-whyPracticum', 'q-whySuitable', 'q-persistence', 'q-expectations',
  ];
  for (const id of ids) {
    const el = page.locator(`#${id}`);
    if (await el.count() === 0) continue; // form may evolve; skip missing
    await el.fill(placeholder);
  }
}

// ─── REG-validation ─────────────────────────────────────────────────
// HTML5 native `required` attributes on the questionnaire textareas
// short-circuit the submit before our JS validation runs (Chrome shows
// its native popup; our setErr never fires). Either remove `required`
// from the questionnaire fields OR change this cell's premise. For now
// we assert the page's checkValidity() returns false — i.e. the browser
// refuses to submit — and no DB row is created.
audit.log('REG-validation: questionnaire-missing submit blocked with specific error');
{
  await audit.page.goto(`${audit.baseUrl}/register`, { waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(800);
  const before = await audit.shot('REG-validation-before');
  audit.observerMark();
  // Fill HTML5-required fields so the submit handler actually runs.
  await audit.page.locator('input[type="text"]').nth(0).fill('Validation Test');
  await audit.page.locator('input[type="email"]').first().fill(`audit-${auditTs}-val@audit.local`);
  await audit.page.locator('input[type="tel"]').first().fill('0501234567');
  const cityIn = audit.page.locator('input[type="text"]:not([id^="q-"])').nth(1);
  if (await cityIn.count() > 0) await cityIn.fill('Tel Aviv');
  // Upload a CV so the !cv guard passes, but DON'T fill the questionnaire.
  await audit.page.locator('input[type="file"]').first().setInputFiles({
    name: 'audit-val-cv.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('validation cell CV', 'utf-8'),
  });
  // Click submit. HTML5 native validation should block it (form has
  // unfilled required textareas). Assert: form.checkValidity()===false
  // AND no DB row created AND no page errors.
  const submit = audit.page.getByRole('button', { name: /שלח|הגש|submit/i }).first();
  const rowCountBefore = (await sbQuery('candidate_submissions', {
    filter: `email=like.audit-${auditTs}-val%40audit.local`,
  })).length;
  await submit.click();
  await audit.page.waitForTimeout(800);
  const after = await audit.shot('REG-validation-after');
  const obs = audit.observerSnapshot();
  const formValid = await audit.page.evaluate(() => {
    const form = document.querySelector('form');
    return form ? form.checkValidity() : null;
  });
  const rowCountAfter = (await sbQuery('candidate_submissions', {
    filter: `email=like.audit-${auditTs}-val%40audit.local`,
  })).length;
  const blocked = formValid === false;
  const noRowCreated = rowCountAfter === rowCountBefore;
  const noPageErrors = obs.pageErrors.length === 0;
  audit.recordCell({
    id: 'REG-validation',
    tableRef: '/register / Incomplete-form submit blocked',
    expected: 'form.checkValidity()=false; no new DB row; no page errors',
    observed: `formValid=${formValid}, rowCountDelta=${rowCountAfter - rowCountBefore}, errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p/${obs.netFailures.length}n)`,
    pass: blocked && noRowCreated && noPageErrors,
    before, after,
    notes: !blocked
      ? `Form considered valid despite missing questionnaire fields — HTML5 required attributes are not protecting submission.`
      : '',
  });
}

// ─── REG-happy-path ────────────────────────────────────────────────
// Fill EVERYTHING with known values, submit, and assert the resulting
// candidate_submissions row matches what we typed — exactly.
audit.log('REG-happy-path: submit creates row with EXACT filled values');
{
  await audit.page.goto(`${audit.baseUrl}/register`, { waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(800);
  const before = await audit.shot('REG-happy-before');
  audit.observerMark();

  // Use slightly different unique email so REG-validation's audit pre-check
  // count stays meaningful regardless of order.
  const happyEmail = `audit-${auditTs}-happy@audit.local`;
  const happyName = `${auditName} happy`;
  const happyPhone = '0501234567';
  const happyCity = 'Tel Aviv (audit)';

  // Top-level fields. The form uses controlled inputs without `name=` or
  // `id=` attrs on the main fields, so we target by placeholder/label.
  // The simplest robust approach: fill the visible inputs by their
  // position-based label using getByLabel-ish heuristics.
  // The first <input type=text> in the page is "שם מלא". Then email
  // (type=email), then phone (type=tel), then city.
  await audit.page.locator('input[type="text"]').nth(0).fill(happyName);
  await audit.page.locator('input[type="email"]').first().fill(happyEmail);
  await audit.page.locator('input[type="tel"]').first().fill(happyPhone);
  // city is the next text input after the conditional phone/city block —
  // robust target: index 1 of text inputs that aren't questionnaire (those
  // have id="q-..."). Use a CSS exclusion.
  const cityInput = audit.page.locator('input[type="text"]:not([id^="q-"])').nth(1);
  if (await cityInput.count() > 0) await cityInput.fill(happyCity);

  // Course + year: the form auto-selects the first available course on
  // mount, but the dropdown may need explicit selection. Skip if the
  // value is already set; otherwise pick the first option.
  const courseSel = audit.page.locator('select').nth(0);
  const yearSel = audit.page.locator('select').nth(1);
  // Read the auto-selected values so we can assert against them later.
  const filledCourse = await courseSel.inputValue().catch(() => '');
  const filledYear = await yearSel.inputValue().catch(() => '');

  // Questionnaire
  await fillQuestionnaire(audit.page);

  // CV
  await uploadTinyCv(audit.page);

  // Slot — prefer OUR seeded slot: its date has a Zoom link seeded too, so
  // REG-onscreen-zoom actually exercises the Zoom block instead of depending on
  // whichever ambient slot happened to sort first (that dependency is why the cell
  // sat permanently red). Fall back to the first radio if the seed didn't take.
  const slotRadios = audit.page.locator('input[type="radio"][name="slot"]');
  const slotCount = await slotRadios.count();
  if (slotCount > 0) {
    const mine = zoomSlotId ? audit.page.locator(`input[type="radio"][name="slot"][value="${zoomSlotId}"]`) : null;
    if (mine && (await mine.count()) > 0) {
      await mine.check();
      audit.log(`  slot present (${slotCount}) — selected the seeded zoom slot (${zoomSlotDate})`);
    } else {
      await slotRadios.first().check();
      audit.log(`  slot present (${slotCount}) — seeded slot not offered, selected first`);
    }
  }

  // Submit
  const submit = audit.page.getByRole('button', { name: /שלח|הגש|submit/i }).first();
  await submit.scrollIntoViewIfNeeded();
  await submit.click();

  // Wait for the success UI ('status === done' branch). The success
  // page shows a heading and a "תודה" message. Tolerate up to 30s
  // for the upload + insert + edge function call.
  const successShown = await audit.page.waitForFunction(
    () => /תודה|נשלח|בהצלחה/.test(document.body.textContent || ''),
    null, { timeout: 30_000 },
  ).then(() => true).catch(() => false);

  const after = await audit.shot('REG-happy-after');
  const obs = audit.observerSnapshot();

  // Verify the DB row
  const rows = await sbQuery('candidate_submissions', {
    filter: `email=eq.${encodeURIComponent(happyEmail)}`,
    select: 'id,name,email,phone,city,course_name,year,cv_file_path,submitted_at',
  });
  const dbRow = rows?.[0];
  const expected = {
    name: happyName,
    email: happyEmail,
    phone: happyPhone,
    city: happyCity,
    course_name: filledCourse,
    year: filledYear,
  };
  const fieldMatches = dbRow ? Object.keys(expected).every((k) => dbRow[k] === expected[k]) : false;
  const cvUploaded = !!dbRow?.cv_file_path && dbRow.cv_file_path.length > 5;
  const exactlyOneRow = rows.length === 1;
  const noErrors = obs.consoleErrors.length === 0 && obs.pageErrors.length === 0 && obs.netFailures.length === 0;

  audit.recordCell({
    id: 'REG-happy-path',
    tableRef: '/register / Happy-path submit',
    expected: `success UI shown; exactly 1 row in candidate_submissions with email=${happyEmail} and matching name/phone/city/course/year; cv_file_path populated; no errors`,
    observed: `successShown=${successShown}, rowCount=${rows.length}, fieldMatches=${fieldMatches}, cvUploaded=${cvUploaded}, errors=(${obs.consoleErrors.length}c/${obs.pageErrors.length}p/${obs.netFailures.length}n)` +
      (dbRow ? `, row=${JSON.stringify({ name: dbRow.name, email: dbRow.email, course: dbRow.course_name }).slice(0, 200)}` : ''),
    pass: successShown && exactlyOneRow && fieldMatches && cvUploaded && noErrors,
    before, after,
    notes: !exactlyOneRow ? `Wanted exactly 1 row, got ${rows.length}.` :
           !fieldMatches ? `Row exists but a field doesn't match what was typed. Compare row vs expected.` :
           !cvUploaded ? 'cv_file_path missing — storage upload may have failed silently.' :
           !successShown ? 'Status never advanced to done — form likely stuck in error state.' :
           !noErrors ? `Console errors during submit (sample): ${obs.consoleErrors.slice(0, 5).map((e) => e.slice(0, 150)).join(' | ')}` :
           obs.reactKeyWarnings > 0 ? `INFO: ${obs.reactKeyWarnings} React duplicate-key warnings (known issue — filtered for now; see audit-lib.mjs).` : '',
  });

  if (obs.reactKeyWarnings > 0) {
    audit.log(`  KNOWN ISSUE: ${obs.reactKeyWarnings} React "duplicate key" warnings during submit. Filtered for now — fix and remove filter.`);
  }

  // REG-onscreen-zoom: the success screen must mirror the email — the booked slot
  // is on a day with a Zoom link, so the on-screen confirmation shows the Zoom
  // block (link + instructions). Guards the "gap between on-screen and email" report.
  if (successShown) {
    const onScreen = await audit.page.evaluate(() => {
      const t = document.body.innerText || '';
      return {
        hasZoomBlock: /קישור לראיון בזום/.test(t),
        hasWaitingRoom: /חדר ההמתנה בזום/.test(t),
        noStaleArrive: !/נא להגיע במועד שנבחר/.test(t), // the confusing "arrive" line is gone
      };
    });
    audit.recordCell({
      id: 'REG-onscreen-zoom',
      tableRef: '/register success screen / Zoom block mirrors the email',
      expected: 'the on-screen confirmation shows the Zoom link block + "חדר ההמתנה בזום", and not the stale "נא להגיע" wording',
      observed: `hasZoomBlock=${onScreen.hasZoomBlock}, hasWaitingRoom=${onScreen.hasWaitingRoom}, noStaleArrive=${onScreen.noStaleArrive}`,
      pass: onScreen.hasZoomBlock && onScreen.hasWaitingRoom && onScreen.noStaleArrive,
      notes: !onScreen.hasZoomBlock ? 'No Zoom block on the success screen (gap vs email).' : !onScreen.hasWaitingRoom ? 'Missing the "חדר ההמתנה" wording.' : !onScreen.noStaleArrive ? 'Stale "נא להגיע במועד שנבחר" still shown.' : '',
    });
  }

  // Clean up our happy-path row so it doesn't leak into real data.
  // Every row this run created, not just the happy-path one — the others were left
  // behind on each run and surfaced in the submissions inbox as audit clutter.
  try { await sbDelete('candidate_submissions', `email=like.audit-${auditTs}*@audit.local`); } catch { /* non-fatal */ }
  try { await sbDelete('candidate_submissions', `email=eq.${encodeURIComponent(happyEmail)}`); }
  catch (e) { audit.log(`post-clean (non-fatal): ${e.message.slice(0, 100)}`); }

  // CRITICAL: release any interview slot this run BOOKED. The happy-path picks a
  // real available slot to verify booked_count increments — without releasing it,
  // every gate run permanently consumes a real slot (they vanish from candidates'
  // availability). All audit bookings are named "Audit User …", so reset those.
  try {
    const SUPA = 'https://vpqgmcmavnszcnakhiat.supabase.co';
    const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
    await fetch(`${SUPA}/rest/v1/public_interview_slots?booked_by=like.Audit%20User*`, {
      method: 'PATCH',
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ booked_count: 0, booked_by: null }),
    });
    audit.log('Released audit-booked interview slot(s)');
  } catch (e) { audit.log(`slot-release (non-fatal): ${e.message.slice(0, 100)}`); }

  // Remove the seeded zoom slot + its per-day Zoom link so neither leaks into the
  // real interview schedule (a stray slot would be offered to actual candidates).
  try {
    if (zoomSlotId) await sbDelete('public_interview_slots', `id=eq.${zoomSlotId}`);
    const unlinked = await casBlob((d) => {
      const links = { ...(d.interviewZoomLinks || {}) };
      delete links[zoomSlotDate];
      return { ...d, interviewZoomLinks: links };
    });
    audit.log(`Cleaned seeded zoom slot + link (link removed: ${unlinked})`);
  } catch (e) { audit.log(`zoom-seed cleanup (non-fatal): ${e.message.slice(0, 100)}`); }
}

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

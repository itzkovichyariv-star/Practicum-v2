#!/usr/bin/env node
/**
 * 47-integrated-e2e.mjs — the session's placement features CHAINED end to end.
 *
 *   E2E-suggest-to-placement  One student, one unbroken coordinator session:
 *     (1) the student SUGGESTED an org (a cv_updates suggestion) → coordinator
 *         approves it from the student card "…כבחירה ראשונה" → it becomes the
 *         student's firstChoiceOrg + a PRIVATE employer restricted to them, and
 *         the suggestion is dismissed;  (2) coordinator builds the preferences
 *         ("אשר העדפות והכן לשליחה") → the suggested org becomes preference #1 in
 *         the tentative state (reserving no place);  (3) BOTH routes are then on
 *         offer — the "שלח קו״ח" checkbox ENABLED (the student has a CV, as every
 *         real student does) and the direct-placement button;  (4) because the
 *         student is already in advanced contact, coordinator takes PATH 2 — the
 *         "✓ כבר במגעים — אשר שיבוץ" button → confirm → direct placement (השמה),
 *         the CV is NOT SENT.  Asserts the student ends PLACED at the suggested
 *         org with one occupancy recorded.
 *
 * This guards the HANDOFF between features that individual cells don't: cell 45
 * stops at first-choice; cell 46 seeds the preference directly. Only here do we
 * prove that approving a suggestion produces a first-choice that
 * buildPlacementPreferences turns into a pref #1 the two-path flow can place.
 *
 * Yariv 2026-07-19: "continue and at the end test all these features together."
 *
 * Seeds a temp practicum student + a cv_updates suggestion for a brand-new org;
 * removes the student + the created private employer, and hides the suggestion
 * (anon can't delete cv_updates) via dismissedSuggestionIds.
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };

const readRow = async () => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/practicum_data?org_id=eq.default&select=data,version`, { headers: H });
  return (await r.json())[0];
};
const writeData = async (data, version) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/practicum_data?org_id=eq.default&version=eq.${version}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ data, version: version + 1, updated_at: new Date().toISOString() }),
  });
  const j = await r.json().catch(() => null);
  return Array.isArray(j) && j.length > 0;
};
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const ts = Date.now();
const STU_ID = `zint-${ts.toString(36).slice(-5)}`, STU_MAIL = `int-${ts}@audit.local`, STU_NAME = `אינטגרציה בדיקה ${ts}`;
const ORG = `ארגון אינטגרציה ${ts}`;
let sugId = '';

let seedOk = false, courseId = '';
try {
  const row = await readRow();
  const d = row.data;
  courseId = ((d.courses || []).find(c => c?.type === 'practicum') || (d.courses || [])[0])?.id || '';
  if (!courseId) throw new Error('no course');
  // Student: submitted, WITH a CV on file, no prefs, no firstChoiceOrg.
  // Yariv 2026-07-20: "אין מצב כזה אין קורות חיים — טופס שליחת בקשות מחייב העלאת
  // קורות חיים." A CV-less student is impossible: /register blocks submit without one
  // (RegistrationForm.tsx:132) and the stage-2 request form blocks it too
  // (CvUpdateForm.tsx:75), its cv_file_path being promoted to cvUpdatedUrl by
  // StudentsPage.tsx:189-220. Seeding cvUpdatedUrl directly also keeps that
  // auto-promotion from racing this cell (it only fires for students lacking it).
  const stu = { id: STU_ID, name: STU_NAME, email: STU_MAIL, courseId, cvUrl: 'storage://candidate-uploads/int-orig.pdf', cvUpdatedUrl: 'storage://candidate-uploads/int-updated.pdf', submissionStatus: 'submitted', preferences: [] };
  if (!await writeData({ ...d, students: [...(d.students || []), stu] }, row.version)) throw new Error('seed CAS lost');
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/cv_updates`, {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ email: STU_MAIL, name: STU_NAME, cv_file_path: 'x/int.pdf', suggested_org: { name: ORG, contactName: 'איש קשר', email: 'org@audit.local' } }),
  });
  sugId = (await ins.json())[0]?.id || '';
  seedOk = !!sugId;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

const audit = new Audit({ name: 'integrated-e2e' });
await audit.setup();
await audit.page.evaluate(({ c }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c || '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'students');
}, { c: courseId });
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1200);

audit.log('E2E: suggestion → approve as first choice → build prefs → path-2 direct placement');
audit.observerMark();

const openEditor = async () => {
  const row = audit.page.locator('li').filter({ hasText: STU_NAME }).first();
  if (!await row.isVisible().catch(() => false)) return false;
  const editBtn = row.getByTitle('ערוך').first();
  if (await editBtn.isVisible().catch(() => false)) await editBtn.click();
  else { await row.hover(); await audit.page.waitForTimeout(300); await row.getByTitle('ערוך').first().click().catch(() => {}); }
  await audit.page.waitForTimeout(1500);
  return audit.page.evaluate(() => !!document.querySelector('button[aria-label="סגור"]'));
};

// ── Step 1: approve the suggestion as first choice ───────────────────────────
let approved1 = false, firstChoiceOk = false, privateEmpOk = false, dismissedOk = false;
if (seedOk) {
  await openEditor();
  await audit.page.waitForTimeout(2500); // pendingCv fetch
  const approveBtn = audit.page.locator('button').filter({ hasText: 'כבחירה ראשונה' }).first();
  if (await approveBtn.count() > 0) {
    await approveBtn.scrollIntoViewIfNeeded().catch(() => {});
    await approveBtn.click().catch(() => {});
    approved1 = true;
    for (let i = 0; i < 16; i++) {
      const s = (await loadData()).students?.find(x => x.id === STU_ID);
      if ((s?.firstChoiceOrg || '') === ORG) break;
      await audit.page.waitForTimeout(400);
    }
  }
  const d = await loadData();
  const stu = (d.students || []).find(s => s.id === STU_ID);
  firstChoiceOk = (stu?.firstChoiceOrg || '') === ORG;
  privateEmpOk = (d.employers || []).some(e => e.name === ORG && e.restrictedToStudentId === STU_ID);
  dismissedOk = ((d.dismissedSuggestionIds || [])).includes(sugId);
}

// ── Step 2 + 3: build preferences → path-2 direct placement ──────────────────
let builtPrefTentative = false, twoPathSeen = false, bothPathsOffered = false, placedConverged = false, acceptedOk = false, statusPlaced = false, slotPlaced = false;
if (seedOk && firstChoiceOk) {
  // Fresh editor so the placement panel reflects the just-approved first choice.
  await audit.page.reload({ waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(1200);
  await openEditor();

  // No "build" step now — the approved firstChoiceOrg surfaces directly as a ranked
  // OrgHub card (union of prefs ∪ legacy), tentative and reserving no place. A tentative
  // suggested-org card is exactly the one that offers the place-direct button, so its
  // presence IS the "intent, no place held" state the old build produced.
  await audit.page.waitForSelector('[data-org-card]', { timeout: 4000 }).catch(() => {});
  {
    const cards = await audit.page.locator('[data-org-card]').count();
    const directs = await audit.page.locator('[data-place-direct]').count();
    // still tentative → not yet placed in the DB, no slot held
    const stu = (await loadData()).students?.find(s => s.id === STU_ID);
    const noPlaceHeld = !(stu?.preferences || []).some(p => p.slotId);
    builtPrefTentative = cards >= 1 && directs === 1 && noPlaceHeld;
  }

  // Path 2: the "כבר במגעים — אשר שיבוץ" button (suggested org only).
  // Same wrong-student guard as cell 46 — the open editor must be the subject's and
  // exactly one place-direct button may exist, or a stray row gets placed instead
  // and the failure masquerades as a flake (see 46's header for the 2026-07-20 case).
  const editorHasSubject = await audit.page.locator(`text=${STU_NAME}`).first().isVisible().catch(() => false);
  const directCount = await audit.page.locator('[data-place-direct]').count();
  if (!editorHasSubject) audit.log('⚠ editor does not show the subject student — refusing to click');
  if (directCount > 1) audit.log(`⚠ ${directCount} place-direct buttons on the page — ambiguous, refusing to click`);
  const directBtn = audit.page.locator('[data-place-direct]').first();
  await directBtn.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  twoPathSeen = directCount === 1 && editorHasSubject;

  // REALISTIC CHECK — the student HAS a CV and the built preference has a free place,
  // so BOTH routes must genuinely be on offer: path 1 (the "שלח קו״ח" checkbox, ENABLED
  // — not greyed) and path 2 (direct placement). That is Yariv's design: "the system
  // asks whether to send the CV, or whether the student is already in advanced contact
  // and only your approval is needed." If path 1 were disabled here it would mean the
  // CV/place gate is wrong, not that path 2 works.
  const sendBox = audit.page.locator('[data-send-cv]').first();
  bothPathsOffered = (await sendBox.count()) > 0
    && !(await sendBox.isDisabled().catch(() => true))
    && twoPathSeen;
  if (twoPathSeen) {
    await directBtn.scrollIntoViewIfNeeded();
    await directBtn.click().catch(() => {});
    const confirm = audit.page.getByRole('button', { name: /אשר שיבוץ ישיר/ }).first();
    await confirm.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (await confirm.count() > 0) {
      await confirm.click().catch(() => {});
      await audit.page.locator('text=✅ שובץ').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      for (let i = 0; i < 24; i++) {
        const s = (await loadData()).students?.find(x => x.id === STU_ID);
        if ((s?.acceptedOrg || '') === ORG) break;
        await audit.page.waitForTimeout(500);
      }
    }
  }
  const d = await loadData();
  const stu = (d.students || []).find(s => s.id === STU_ID);
  const emp = (d.employers || []).find(e => e.name === ORG && e.restrictedToStudentId === STU_ID);
  acceptedOk = (stu?.acceptedOrg || '') === ORG;
  statusPlaced = (stu?.submissionStatus || '') === 'placed';
  slotPlaced = ((emp?.vacancySlots) || []).some(s => s.status === 'placed' && s.studentId === STU_ID);
  const pref = (stu?.preferences || []).find(p => p.status === 'placed' && p.slotId);
  placedConverged = acceptedOk && statusPlaced && slotPlaced && !!pref;
}

const after = await audit.shot('E2E-suggest-to-placement');
const obs = audit.observerSnapshot();
if (!seedOk) {
  audit.recordCell({ id: 'E2E-suggest-to-placement', tableRef: 'integrated placement lifecycle', expected: 'seed', observed: 'seed failed', pass: null, notes: 'Could not seed.' });
} else {
  const pass = firstChoiceOk && privateEmpOk && dismissedOk && builtPrefTentative && twoPathSeen && bothPathsOffered && placedConverged && obs.pageErrors.length === 0;
  audit.recordCell({
    id: 'E2E-suggest-to-placement',
    tableRef: 'suggestion → first-choice → build prefs → BOTH paths offered → PATH-2 direct placement, chained',
    expected: 'approve suggestion sets firstChoiceOrg + private employer + dismissed; building prefs makes it pref #1 tentative (no place held); BOTH routes are then offered for the suggested org — the "שלח קו״ח" checkbox ENABLED (the student has a CV, as every real student does) and the "כבר במגעים" direct-placement button; confirming the latter places the student (acceptedOrg + submissionStatus=placed + a placed slot held by the student) without SENDING the CV',
    observed: `approve(first=${firstChoiceOk}, privEmp=${privateEmpOk}, dismissed=${dismissedOk}) → builtPrefTentative=${builtPrefTentative} → twoPathSeen=${twoPathSeen}, bothPathsOffered=${bothPathsOffered} → placed(accepted=${acceptedOk}, status=${statusPlaced}, slot=${slotPlaced}), errors=(${obs.pageErrors.length}p)`,
    pass, after,
    notes: !firstChoiceOk ? 'approval did not persist firstChoiceOrg (feature 4 broke).'
      : !builtPrefTentative ? 'building prefs did not create a tentative pref #1 holding no place.'
      : !twoPathSeen ? 'the two-path button did not appear for the approved suggested org (handoff broke).'
      : !bothPathsOffered ? 'path 1 (send-CV checkbox) was NOT enabled alongside path 2 — with a CV on file and a free place the coordinator must genuinely have both choices.'
      : !placedConverged ? 'path-2 direct placement did not converge the student to placed.' : '',
  });
}

// ── Cleanup (CAS retry) ──────────────────────────────────────────────────────
let cleaned = false;
for (let i = 0; i < 6 && !cleaned; i++) {
  try {
    const row = await readRow();
    const d = row.data;
    cleaned = await writeData({
      ...d,
      students: (d.students || []).filter(s => s.id !== STU_ID),
      employers: (d.employers || []).filter(e => e.name !== ORG),
      dismissedSuggestionIds: Array.from(new Set([...((d.dismissedSuggestionIds) || []), sugId])),
    }, row.version);
  } catch (e) { audit.log(`Cleanup attempt ${i} failed: ${e.message.slice(0, 80)}`); }
}
audit.log(cleaned ? 'Cleanup: removed temp student + private employer; dismissed seeded suggestion'
                  : '⚠ Cleanup FAILED after retries.');

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

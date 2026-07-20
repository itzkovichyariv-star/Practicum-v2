#!/usr/bin/env node
/**
 * 46-suggested-place-direct.mjs — the SECOND path for a student-suggested org:
 * "already in advanced contact — your approval is the placement (no CV sent)".
 *
 *   SUGGEST-place-direct  Seed a student whose first preference is a PRIVATE org
 *                         restricted to them (restrictedToStudentId = the student),
 *                         in the tentative state, WITH an updated CV on file (every
 *                         real student has one — both public forms mandate the
 *                         upload). Open the editor → the "✓ כבר במגעים — אשר שיבוץ"
 *                         button appears (path 2) → click it → confirm "אשר שיבוץ
 *                         ישיר". Asserts in the DB:
 *                         (a) student.acceptedOrg = the org, (b) submissionStatus
 *                         = 'placed', (c) the preference is 'placed' holding a slot,
 *                         (d) a vacancy slot on the org is 'placed' for the student.
 *
 * Yariv's two-path design (2026-07-19): a student-suggested org becomes preference
 * #1, and the coordinator either "שלח קו״ח" (checkbox, path 1) OR — when the student
 * is already in advanced contact — approves directly, which IS the placement (השמה),
 * with no CV sent. This cell guards path 2 end-to-end, incl. the slot-mint fallback
 * (a private org may carry no pre-provisioned vacancy — the suggestion is the place).
 *
 * Seeds a temp practicum student + a restricted employer with ZERO slots (forces the
 * mint path); removes both. Because the org has no free place, path 1 (the send-CV
 * checkbox) is correctly DISABLED here even though the student HAS a CV — the block
 * reason is "no free place", not "no CV". Cell 47 covers the both-paths-offered case.
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

const audit = new Audit({ name: 'suggested-place-direct' });
const ts = Date.now();
const EMP_ID = `audit-pd-emp-${ts}`, EMP_NAME = `ארגון מוצע ישיר ${ts}`;
const STU_ID = `audit-pd-stu-${ts}`, STU_NAME = `סטודנט מגעים ${ts}`;

let seedOk = false, courseId = '';
try {
  const data = await loadData();
  courseId = ((data.courses || []).find(c => c?.type === 'practicum') || (data.courses || [])[0])?.id || '';
  if (!courseId) throw new Error('no course');
  // Private (student-suggested) employer restricted to the student, with NO vacancy
  // slots at all — forces handlePlaceDirect's mint-a-placed-slot fallback.
  const emp = { id: EMP_ID, name: EMP_NAME, approvalStatus: 'approved', addedBy: 'student', restrictedToStudentId: STU_ID, courseIds: [courseId], positionsTotal: 1, positions: 1, filledPositions: 0, notes: 'audit place-direct', contactPhone: '0500000000', contactEmail: 'a@b.local', vacancySlots: [] };
  // Student with the org as preference #1 in tentative, WITH an updated CV on file.
  // Yariv 2026-07-20: "אין מצב כזה אין קורות חיים — טופס שליחת בקשות מחייב העלאת קורות
  // חיים." A CV-less student cannot exist: /register hard-blocks submit without a CV
  // (RegistrationForm.tsx:132 → cvUrl) and the stage-2 request form does the same
  // (CvUpdateForm.tsx:75 → cv_updates.cv_file_path, promoted to cvUpdatedUrl by
  // StudentsPage.tsx:189-220 on coordinator mount). Path 2 is about NOT SENDING the
  // CV — never about lacking one — so the seed must carry one.
  const stu = { id: STU_ID, name: STU_NAME, email: `audit-pd-${ts}@audit.local`, courseId, cvUrl: 'storage://candidate-uploads/audit-pd-orig.pdf', cvUpdatedUrl: 'storage://candidate-uploads/audit-pd-updated.pdf', firstChoiceOrg: EMP_NAME, submissionStatus: 'submitted', preferences: [{ rank: 1, employerId: EMP_ID, slotId: null, status: 'tentative' }] };
  await sbPatchData({ ...data, employers: [...(data.employers || []), emp], students: [...(data.students || []), stu] });
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
await audit.page.evaluate(({ cId }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: cId || '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'students');
}, { cId: courseId });
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1000);

audit.log('SUGGEST-place-direct: approve a suggested org directly → placement without a CV');
{
  audit.observerMark();
  let opened = false, btnSeen = false, approved = false;

  if (seedOk) {
    const row = audit.page.locator('li').filter({ hasText: STU_NAME }).first();
    if (await row.isVisible().catch(() => false)) {
      const editBtn = row.getByTitle('ערוך').first();
      if (await editBtn.isVisible().catch(() => false)) await editBtn.click();
      else { await row.hover(); await audit.page.waitForTimeout(300); await row.getByTitle('ערוך').first().click().catch(() => {}); }
      await audit.page.waitForTimeout(1500);
      opened = true;

      // Path-2 button: only rendered for a suggested (restricted) org in tentative.
      //
      // GUARDED against acting on the WRONG STUDENT. On 2026-07-20 this cell reported
      // approved=true with its own student unplaced, and the slot history showed a
      // 'placed-direct' landing on a LEFTOVER preview student at that exact second —
      // i.e. the click hit a row that was not the subject. An unscoped `.first()` plus
      // any stray student carrying a place-direct button silently tests the wrong row
      // and reads as a mysterious "flake". So: require the open editor to be THIS
      // student's, and require exactly ONE such button on the page.
      const editorHasSubject = await audit.page.locator(`text=${STU_NAME}`).first().isVisible().catch(() => false);
      const directCount = await audit.page.locator('[data-place-direct]').count();
      if (!editorHasSubject) audit.log('⚠ editor does not show the subject student — refusing to click');
      if (directCount > 1) audit.log(`⚠ ${directCount} place-direct buttons on the page — ambiguous, refusing to click`);
      const directBtn = audit.page.locator('[data-place-direct]').first();
      await directBtn.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
      btnSeen = directCount === 1 && editorHasSubject;
      if (btnSeen) {
        await directBtn.scrollIntoViewIfNeeded();
        await directBtn.click().catch(() => {});
        // Confirm dialog "✅ שיבוץ ישיר (השמה)" → "אשר שיבוץ ישיר →".
        const confirm = audit.page.getByRole('button', { name: /אשר שיבוץ ישיר/ }).first();
        await confirm.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        if (await confirm.count() > 0) {
          await confirm.click().catch(() => {});
          approved = true;
          // First wait for the UI's own completion signal: the preference row flips
          // to "✅ שובץ" only after onDataChange (→ saveSnapshot) RESOLVES. Under a
          // loaded gate, saveSnapshot's CAS can retry-with-backoff for several seconds
          // (realtime bumps the version), so a fixed short DB poll would read a false
          // red on a slow-but-successful write. Gate the DB read on the UI signal.
          await audit.page.locator('text=✅ שובץ').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
          // Then confirm the write landed in the DB (replica settle).
          for (let i = 0; i < 24; i++) {
            const s = (await loadData()).students?.find(x => x.id === STU_ID);
            if ((s?.acceptedOrg || '') === EMP_NAME) break;
            await audit.page.waitForTimeout(500);
          }
        }
      }
    }
  }

  const after = await audit.shot('SUGGEST-place-direct');
  let acceptedOk = false, statusPlaced = false, prefPlaced = false, slotPlaced = false;
  try {
    const data = await loadData();
    const stu = (data.students || []).find(s => s.id === STU_ID);
    const emp = (data.employers || []).find(e => e.id === EMP_ID);
    acceptedOk = (stu?.acceptedOrg || '') === EMP_NAME;
    statusPlaced = (stu?.submissionStatus || '') === 'placed';
    const p = (stu?.preferences || []).find(x => x.employerId === EMP_ID);
    prefPlaced = p?.status === 'placed' && !!p?.slotId;
    const slot = ((emp?.vacancySlots) || []).find(s => s.status === 'placed' && s.studentId === STU_ID);
    slotPlaced = !!slot;
  } catch (e) { audit.log(`DB check failed: ${e.message.slice(0, 100)}`); }

  const obs = audit.observerSnapshot();
  if (!seedOk || !opened) {
    audit.recordCell({ id: 'SUGGEST-place-direct', tableRef: 'PlacementPanel handlePlaceDirect', expected: 'open editor', observed: `seedOk=${seedOk}, opened=${opened}`, pass: seedOk ? false : null, notes: 'Could not seed/open.' });
  } else {
    const pass = btnSeen && approved && acceptedOk && statusPlaced && prefPlaced && slotPlaced && obs.pageErrors.length === 0;
    audit.recordCell({
      id: 'SUGGEST-place-direct',
      tableRef: 'PlacementPanel path 2 — כבר במגעים → שיבוץ ישיר (השמה) ללא קו״ח',
      expected: 'the "כבר במגעים — אשר שיבוץ" button appears for a suggested org; confirming it sets acceptedOrg=org + submissionStatus=placed + the preference placed holding a slot + a placed vacancy for the student — with NO CV sent',
      observed: `btnSeen=${btnSeen}, approved=${approved}, acceptedOrg=${acceptedOk}, statusPlaced=${statusPlaced}, prefPlaced=${prefPlaced}, slotPlaced=${slotPlaced}, errors=(${obs.pageErrors.length}p)`,
      pass, after,
      notes: !btnSeen ? 'Path-2 button not rendered for a suggested org.'
        : !approved ? 'Could not confirm direct placement.'
        : !acceptedOk ? 'acceptedOrg was not set by the direct placement.'
        : !statusPlaced ? 'submissionStatus did not become placed.'
        : !prefPlaced ? 'the preference did not become placed holding a slot.'
        : !slotPlaced ? 'no placed vacancy slot recorded for the student (mint fallback failed).' : '',
    });
  }
}

try {
  const data = await loadData();
  await sbPatchData({ ...data, students: (data.students || []).filter(s => s.id !== STU_ID), employers: (data.employers || []).filter(e => e.id !== EMP_ID) });
  audit.log('Cleanup: removed temp student + employer');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

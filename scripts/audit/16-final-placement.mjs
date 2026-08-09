#!/usr/bin/env node
/**
 * 16-final-placement.mjs — placing via PlacementPanel converges with acceptedOrg.
 *
 *   PLACED-converges  Build a preference → dispatch (WhatsApp) → mark "נקלט".
 *                     The result: the slot becomes 'placed', AND the student's
 *                     acceptedOrg + placedAt are set, AND the org shows 0 open
 *                     vacancies — one occupancy recorded through one path.
 *
 * Seeds a temp practicum student + a 1-slot employer; removes both.
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

const audit = new Audit({ name: 'final-placement' });
const pageErrors = [];
const ts = Date.now();
const EMP_ID = `audit-fp-emp-${ts}`, EMP_NAME = `ארגון שיבוץ ${ts}`, SLOT_ID = `${EMP_ID}-s1`;
const STU_ID = `audit-fp-stu-${ts}`, STU_NAME = `סטודנט שיבוץ ${ts}`;

let seedOk = false, courseId = '';
try {
  const data = await loadData();
  courseId = ((data.courses || []).find(c => c?.type === 'practicum') || (data.courses || [])[0])?.id || '';
  if (!courseId) throw new Error('no course');
  const emp = { id: EMP_ID, name: EMP_NAME, approvalStatus: 'approved', addedBy: 'admin', restrictedToStudentId: null, courseIds: [courseId], positionsTotal: 1, positions: 1, filledPositions: 0, notes: 'audit', contactPhone: '0500000000', contactEmail: 'a@b.local', vacancySlots: [{ id: SLOT_ID, courseId, status: 'available', studentId: null, prefRank: null, history: [] }] };
  const stu = { id: STU_ID, name: STU_NAME, email: `audit-fp-${ts}@audit.local`, courseId, cvUpdatedUrl: 'storage://candidate-uploads/a.pdf', firstChoiceOrg: EMP_NAME, submissionStatus: 'submitted', preferences: [] };
  await sbPatchData({ ...data, employers: [...(data.employers || []), emp], students: [...(data.students || []), stu] });
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
audit.page.on('pageerror', e => { pageErrors.push(String(e.message || e).slice(0, 160)); });
await audit.page.evaluate(({ cId }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: cId || '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'students');
}, { cId: courseId });
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1000);

audit.log('PLACED-converges: dispatch → נקלט sets acceptedOrg + occupies the slot');
{
  audit.observerMark();
  let opened = false, dispatched = false, marked = false;

  if (seedOk) {
    const row = audit.page.locator('li').filter({ hasText: STU_NAME }).first();
    if (await row.isVisible().catch(() => false)) {
      const editBtn = row.getByTitle('ערוך').first();
      if (await editBtn.isVisible().catch(() => false)) await editBtn.click();
      else { await row.hover(); await audit.page.waitForTimeout(300); await row.getByTitle('ערוך').first().click().catch(() => {}); }
      await audit.page.waitForTimeout(1200);
      opened = true;

      // The chosen org renders as an OrgHub card directly (union — no "build" step).
      await audit.page.waitForSelector('[data-org-card]', { timeout: 4000 }).catch(() => {});

      // Stub window.open so the WhatsApp dispatch doesn't launch a tab.
      await audit.page.evaluate(() => { window.open = () => null; });
      // Send the CV: tick the card's "שלח קו"ח" checkbox (selects) → the send bar →
      // WhatsApp. (Sending is behind a checkbox + a channel bottom-sheet now.)
      const sendBox = audit.page.locator('[data-send-cv]').first();
      await sendBox.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
      if (await sendBox.count() > 0) {
        await sendBox.scrollIntoViewIfNeeded();
        await sendBox.click().catch(() => {});
        await audit.page.waitForTimeout(300);
        await audit.page.locator('[data-send-selected]').first().click().catch(() => {});
        await audit.page.waitForTimeout(300);
        // This cell is about PLACEMENT CONVERGENCE, not popup blocking. By the time it
        // dispatches, Chromium has spent its popup allowance on earlier clicks in the
        // flow, so window.open returns null and the app correctly refuses to record a
        // send whose window never opened. Stand in a compose window that DID open, so
        // the cell can get to the thing it actually tests.
        // (The blocked-popup path itself is asserted separately — see SEND-blocked-not-recorded.)
        audit.page.context().on('page', p => p.close().catch(() => {}));
        await audit.page.evaluate(() => {
          window.__realOpen = window.open;
          window.open = () => ({ closed: false, close() {}, focus() {} });
        });
        const waBtn = audit.page.locator('[data-dispatch="whatsapp"]').first();
        if (await waBtn.count() > 0) { await waBtn.click().catch(() => {}); dispatched = true; }

        // Sending is provisional until confirmed: the app opens a compose window and only
        // then asks whether the message really went (2026-08-09 — committing on open
        // recorded CVs as sent that iOS never opened). Drive that step.
        await audit.page.waitForSelector('[data-send-confirm]', { timeout: 5000 }).catch(() => {});
        await audit.page.locator('[data-send-confirm-yes]').first().click().catch(() => {});
        // The commit saves + refreshes the editor; give the org panel time to re-render
        // before looking for the "✓ נקלט" control.
        for (let i = 0; i < 12; i++) {
          const s2 = (await loadData()).students?.find(x => x.id === STU_ID);
          if ((s2?.preferences || []).some(p => p.status === 'under_review')) break;
          await audit.page.waitForTimeout(400);
        }
        await audit.page.waitForTimeout(600);
      }

      // Wait for the row to transition to under_review (the "✓ נקלט" button appears).
      // Match the exact button text — a bare "נקלט" also matches the student
      // editor's "סומן כנקלט/ה" control above the panel.
      const placedBtn = audit.page.locator('button').filter({ hasText: '✓ נקלט' }).first();
      await placedBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      if (await placedBtn.count() > 0) {
        await placedBtn.scrollIntoViewIfNeeded();
        await placedBtn.click().catch(() => {});
        const confirm = audit.page.getByRole('button', { name: /אשר שיבוץ/ }).first();
        await confirm.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        if (await confirm.count() > 0) { await confirm.click().catch(() => {}); marked = true; }
        // Wait until acceptedOrg is persisted.
        for (let i = 0; i < 10; i++) {
          const s = (await loadData()).students?.find(x => x.id === STU_ID);
          if ((s?.acceptedOrg || '') === EMP_NAME) break;
          await audit.page.waitForTimeout(400);
        }
      }
    }
  }

  const after = await audit.shot('PLACED-converges');
  let acceptedOk = false, slotPlaced = false, openZero = false;
  try {
    const data = await loadData();
    const stu = (data.students || []).find(s => s.id === STU_ID);
    const emp = (data.employers || []).find(e => e.id === EMP_ID);
    acceptedOk = (stu?.acceptedOrg || '') === EMP_NAME;
    const slot = ((emp?.vacancySlots) || []).find(s => s.id === SLOT_ID);
    slotPlaced = slot?.status === 'placed' && slot?.studentId === STU_ID;
    openZero = ((emp?.vacancySlots) || []).filter(s => s.status === 'available').length === 0;
  } catch (e) { audit.log(`DB check failed: ${e.message.slice(0, 100)}`); }

  const obs = audit.observerSnapshot();
  if (!seedOk || !opened) {
    audit.recordCell({ id: 'PLACED-converges', tableRef: 'PlacementPanel placed → acceptedOrg', expected: 'open editor', observed: `seedOk=${seedOk}, opened=${opened}`, pass: seedOk ? false : null, notes: 'Could not seed/open.' });
  } else {
    const pass = dispatched && marked && acceptedOk && slotPlaced && openZero && obs.pageErrors.length === 0;
    audit.recordCell({
      id: 'PLACED-converges',
      tableRef: 'PlacementPanel נקלט → student.acceptedOrg + slot placed + 0 open',
      expected: 'marking נקלט sets acceptedOrg=org, the slot becomes placed (held by the student), and the org has 0 open vacancies',
      observed: `dispatched=${dispatched}, marked=${marked}, acceptedOrg=${acceptedOk}, slotPlaced=${slotPlaced}, openZero=${openZero}, errors=(${obs.pageErrors.length}p)`,
      pass, after,
      notes: !dispatched ? 'Could not dispatch.' : !marked ? 'Could not confirm placement.' : !acceptedOk ? 'acceptedOrg was not set on placement.' : !slotPlaced ? 'Slot not marked placed for the student.' : !openZero ? 'Org still shows open vacancies.' : '',
    });
  }
}

try {
  const data = await loadData();
  await sbPatchData({ ...data, students: (data.students || []).filter(s => s.id !== STU_ID), employers: (data.employers || []).filter(e => e.id !== EMP_ID) });
  audit.log('Cleanup: removed temp student + employer');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

if (pageErrors.length) audit.log(`PAGE ERRORS: ${pageErrors.join(' || ')}`);
await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

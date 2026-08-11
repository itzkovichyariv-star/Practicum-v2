#!/usr/bin/env node
/**
 * 24-cancel-dialog.mjs — the placement confirm dialog opens ON TOP of the editor.
 *
 *   CANCEL-dialog   In the student placement panel, an "under_review" preference
 *                   shows נקלט / נדחה / "בטל מועמדות". Clicking one must open the
 *                   confirmation dialog ABOVE the editor modal — clickable, not
 *                   trapped behind it. Guards the report that "בטל מועמדות" did
 *                   nothing (the dialog was rendering behind the editor; now it's
 *                   portalled to <body> at z-[300]).
 *
 * Seeds a temp employer + student with one under_review preference; cleans up.
 */
import { Audit, sbQuery, mutateData, appReady } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'cancel-dialog' });
const ts = Date.now();
const EID = `audit-cd-emp-${ts}`, SID = `audit-cd-stu-${ts}`, SLOT = `slot-${ts}`, NAME = `ביטול דיאלוג ${ts}`;

let seedOk = false, courseId = '';
try {
  const data = await loadData();
  courseId = ((data.courses || []).find(c => c?.type === 'practicum') || (data.courses || [])[0])?.id || '';
  const emp = { id: EID, name: `מעסיק ${ts}`, courseIds: [courseId], description: 'x', positions: 1, positionsTotal: 1, filledPositions: 1, vacancySlots: [{ id: SLOT, courseId, status: 'under_review', studentId: SID, prefRank: 1, history: [] }] };
  const stu = { id: SID, name: NAME, email: `audit-cd-${ts}@audit.local`, phone: '0500000000', courseId, fromCandidate: true, preferences: [{ rank: 1, employerId: EID, slotId: SLOT, status: 'under_review' }] };
  // The confirm is reached by unticking "קו״ח נשלח", and that checkbox only renders
  // when a dispatch exists — a preference alone is not a send. Without this the probe
  // found no button and the cell skipped silently (it had been skipping since the
  // OrgHub redesign 1d8fa560 renamed the old "בטל מועמדות" button out of existence).
  const disp = { id: `${SID}-d1`, studentId: SID, employerId: EID, slotId: SLOT, channel: 'email',
    sentBy: 'audit', sentAt: new Date().toISOString(), messageSnapshot: 'audit', result: 'pending' };
  await mutateData(data => ({ ...data, employers: [...(data.employers || []), emp], students: [...(data.students || []), stu],
    dispatches: [...(data.dispatches || []), disp] }));
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
await audit.page.setViewportSize({ width: 1440, height: 1000 });
await audit.page.evaluate(({ c }) => {
  localStorage.setItem('practicum_v2_page', 'students');
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c || '__all__', year: '__all__' }));
}, { c: courseId });
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(1400);

audit.log('CANCEL-dialog: "בטל מועמדות" opens a confirm dialog on top of the editor');
{
  audit.observerMark();
  let opened = false, btnSeen = false, onTop = null, actionClickable = null;
  if (seedOk) {
    const row = audit.page.locator('li[data-info-row]').filter({ hasText: NAME }).first();
    if (await row.isVisible().catch(() => false)) {
      await row.getByTitle('ערוך').first().click().catch(() => {});
      await audit.page.waitForTimeout(1400);
      opened = await audit.page.evaluate(() => !!document.querySelector('button[aria-label="סגור"]'));
      const cancel = audit.page.locator('[data-sent-cv]').first();
      btnSeen = await cancel.isVisible().catch(() => false);
      if (btnSeen) {
        await cancel.scrollIntoViewIfNeeded().catch(() => {});
        await audit.page.waitForTimeout(200);
        await cancel.click().catch(() => {});
        await audit.page.waitForTimeout(700);
        onTop = await audit.page.evaluate(() => {
          const c = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
          return /WhatsApp|Email|ביטול מועמדות|לבטל את מועמדות|פתח/.test(c?.textContent || '');
        });
        actionClickable = await audit.page.locator('button').filter({ hasText: 'פתח WhatsApp + סמן בוטל' }).first().isVisible().catch(() => false);
      }
    }
  }
  const obs = audit.observerSnapshot();
  if (!seedOk || !opened || !btnSeen) {
    audit.recordCell({ id: 'CANCEL-dialog', tableRef: 'PlacementPanel / cancel confirm dialog', expected: 'seed + open + button', observed: `seedOk=${seedOk}, editorOpened=${opened}, cancelBtnSeen=${btnSeen}`, pass: null, notes: 'Could not reach the cancel button.' });
  } else {
    audit.recordCell({
      id: 'CANCEL-dialog', tableRef: 'PlacementPanel / confirm dialog stacking (portal to body)',
      expected: 'clicking "בטל מועמדות" opens the confirm dialog ON TOP (its action buttons are the topmost element + clickable)',
      observed: `dialogOnTop=${onTop}, actionClickable=${actionClickable}, errors=(${obs.pageErrors.length}p)`,
      pass: onTop === true && actionClickable === true && obs.pageErrors.length === 0,
      notes: onTop ? '' : 'Confirm dialog rendered behind the editor — the button reads as dead.',
    });
  }
}

try {
  const data = await loadData();
  await mutateData(data => ({ ...data, employers: (data.employers || []).filter(e => e.id !== EID),
    students: (data.students || []).filter(s => s.id !== SID),
    dispatches: (data.dispatches || []).filter(d => d.studentId !== SID) }));
  audit.log('Cleanup: removed temp employer + student + dispatch');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

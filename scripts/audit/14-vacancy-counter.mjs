#!/usr/bin/env node
/**
 * 14-vacancy-counter.mjs — a place is taken by SENDING the CV, not by building.
 *
 *   COUNTER-send-takes-place  Building preferences reserves NOTHING (both of the
 *                             org's 2 vacancies stay open). Ticking the "שלח קו"ח"
 *                             checkbox and choosing a channel sends the CV AND takes
 *                             exactly one place (open drops to 1, that preference
 *                             becomes under_review holding a slot).
 *
 * Rule change 2026-07-19 (Yariv: "מה שקובע תפיסה של מקום צריך להיות שליחת קורות
 * חיים"). Previously build reserved a slot per preference — this cell asserted that
 * and is now re-pinned to the send-takes-place model.
 *
 * Seeds a temp practicum student (with an updated CV) + a temp employer with TWO
 * vacancy slots, then removes both. Touches no real data.
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
async function sbPatchData(data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/practicum_data?org_id=eq.default`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ data }),
  });
  if (!r.ok) throw new Error(`sbPatch failed ${r.status}: ${await r.text().catch(() => '')}`);
}
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};
const availSlots = (emp) => ((emp && emp.vacancySlots) || []).filter(s => s.status === 'available').length;

const audit = new Audit({ name: 'vacancy-counter' });
const ts = Date.now();
const EMP_ID = `audit-vc-emp-${ts}`, EMP_NAME = `ארגון קיבולת ${ts}`;
const STU_ID = `audit-vc-stu-${ts}`, STU_NAME = `סטודנט קיבולת ${ts}`;

let seedOk = false, courseId = '';
try {
  const data = await loadData();
  const courses = data.courses || [];
  courseId = (courses.find(c => c?.type === 'practicum') || courses[0])?.id || '';
  if (!courseId) throw new Error('no course');
  const emp = {
    id: EMP_ID, name: EMP_NAME, approvalStatus: 'approved', addedBy: 'admin', restrictedToStudentId: null,
    courseIds: [courseId], positionsTotal: 2, positions: 2, filledPositions: 0, notes: 'audit cap', contactPhone: '0500000000', contactEmail: 'a@b.local',
    vacancySlots: [
      { id: `${EMP_ID}-s1`, courseId, status: 'available', studentId: null, prefRank: null, history: [] },
      { id: `${EMP_ID}-s2`, courseId, status: 'available', studentId: null, prefRank: null, history: [] },
    ],
  };
  const stu = { id: STU_ID, name: STU_NAME, email: `audit-vc-${ts}@audit.local`, courseId, cvUpdatedUrl: 'storage://candidate-uploads/a.pdf', firstChoiceOrg: EMP_NAME, submissionStatus: 'submitted', preferences: [] };
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

audit.log('COUNTER-send-takes-place: build reserves nothing; ticking the send-CV checkbox takes a place');
{
  audit.observerMark();
  let opened = false, availAfterBuild = null, availAfterSend = null, sentUnderReview = false;

  if (seedOk) {
    const row = audit.page.locator('li').filter({ hasText: STU_NAME }).first();
    if (await row.isVisible().catch(() => false)) {
      const editBtn = row.getByTitle('ערוך').first();
      if (await editBtn.isVisible().catch(() => false)) await editBtn.click();
      else { await row.hover(); await audit.page.waitForTimeout(300); await row.getByTitle('ערוך').first().click().catch(() => {}); }
      await audit.page.waitForTimeout(1200);
      opened = true;

      // Build the preferences → must reserve NOTHING (new rule: a place is taken
      // only when the CV is sent). Both of the org's 2 slots stay available.
      const buildBtn = audit.page.getByRole('button', { name: /אשר העדפות והכן לשליחה/ }).first();
      if (await buildBtn.count() > 0) { await buildBtn.scrollIntoViewIfNeeded(); await buildBtn.click().catch(() => {}); await audit.page.waitForTimeout(2500); }
      availAfterBuild = availSlots((await loadData()).employers?.find(e => e.id === EMP_ID));

      // Tick the "שלח קו"ח" checkbox → pick a channel (WhatsApp) → sends AND takes
      // one place. The window.open popup is swallowed by the audit popup handler.
      const sendBox = audit.page.locator('[data-send-cv]').first();
      await sendBox.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
      if (await sendBox.count() > 0) {
        await sendBox.scrollIntoViewIfNeeded();
        await sendBox.click().catch(() => {}); // opens the channel picker
        await audit.page.waitForTimeout(400);
        await audit.page.locator('[data-dispatch="whatsapp"]').first().click().catch(() => {});
        // Wait until a slot is actually taken (send persisted).
        for (let i = 0; i < 12; i++) {
          const emp = (await loadData()).employers?.find(e => e.id === EMP_ID);
          if (availSlots(emp) === 1) break;
          await audit.page.waitForTimeout(400);
        }
      }
      const after = await loadData();
      availAfterSend = availSlots(after.employers?.find(e => e.id === EMP_ID));
      sentUnderReview = ((after.students?.find(s => s.id === STU_ID)?.preferences) || []).some(p => p.status === 'under_review' && p.slotId);
    }
  }

  const shot = await audit.shot('COUNTER-after');
  const obs = audit.observerSnapshot();
  if (!seedOk || !opened) {
    audit.recordCell({ id: 'COUNTER-send-takes-place', tableRef: 'vacancy ledger', expected: 'seed + open editor', observed: `seedOk=${seedOk}, opened=${opened}`, pass: seedOk ? false : null, notes: 'Could not seed/open.' });
  } else {
    const pass = availAfterBuild === 2 && availAfterSend === 1 && sentUnderReview && obs.pageErrors.length === 0;
    audit.recordCell({
      id: 'COUNTER-send-takes-place',
      tableRef: 'PlacementPanel / send-CV checkbox — build reserves nothing, sending takes a place',
      expected: 'after build: both 2 vacancies still open; after ticking send-CV + choosing a channel: 1 open + that preference is under_review holding a slot',
      observed: `availAfterBuild=${availAfterBuild} (want 2), availAfterSend=${availAfterSend} (want 1), sentUnderReview=${sentUnderReview}, errors=(${obs.pageErrors.length}p)`,
      pass, after: shot,
      notes: availAfterBuild !== 2 ? 'Build consumed a place — preferences must reserve nothing.'
        : availAfterSend !== 1 ? 'Ticking send-CV did not take exactly one place.'
        : !sentUnderReview ? 'The sent preference is not under_review holding a slot.' : '',
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

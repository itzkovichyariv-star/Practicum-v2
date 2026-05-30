#!/usr/bin/env node
/**
 * 14-vacancy-counter.mjs — open-vacancy ledger updates live.
 *
 *   COUNTER-reserve-release  Building a placement reserves one of the org's
 *                            vacancies (open count drops); releasing the
 *                            tentative preference frees it (open count returns).
 *                            Verifies the single capacity ledger (vacancySlots)
 *                            and that PlacementPanel shows the live "נותרו N".
 *
 * Seeds a temp practicum student + a temp employer with TWO vacancy slots, then
 * removes both. Touches no real data.
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

audit.log('COUNTER-reserve-release: build reserves a vacancy, release frees it');
{
  audit.observerMark();
  let opened = false, availAfterBuild = null, availAfterRelease = null, uiShowedRemaining = false, prefsAfterRelease = null;

  if (seedOk) {
    const row = audit.page.locator('li').filter({ hasText: STU_NAME }).first();
    if (await row.isVisible().catch(() => false)) {
      const editBtn = row.getByTitle('ערוך').first();
      if (await editBtn.isVisible().catch(() => false)) await editBtn.click();
      else { await row.hover(); await audit.page.waitForTimeout(300); await row.getByTitle('ערוך').first().click().catch(() => {}); }
      await audit.page.waitForTimeout(1200);
      opened = true;

      // Build → reserves one of the 2 slots.
      const buildBtn = audit.page.getByRole('button', { name: /אשר העדפות והכן לשליחה/ }).first();
      if (await buildBtn.count() > 0) { await buildBtn.scrollIntoViewIfNeeded(); await buildBtn.click().catch(() => {}); await audit.page.waitForTimeout(2500); }

      availAfterBuild = availSlots((await loadData()).employers?.find(e => e.id === EMP_ID));
      uiShowedRemaining = await audit.page.evaluate(() => /נותרו\s*1\s*מקומות/.test(document.body.textContent || ''));

      // Release → frees the reserved slot. Wait for the button to settle after the
      // post-build refresh (which re-saves the reconciled employer ledger).
      const releaseBtn = audit.page.getByRole('button', { name: /הסר ושחרר מקום/ }).first();
      await releaseBtn.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
      if (await releaseBtn.count() > 0) {
        await releaseBtn.scrollIntoViewIfNeeded();
        await releaseBtn.click().catch(() => {});
        // Wait until the preference is actually gone from the DB (release persisted).
        for (let i = 0; i < 10; i++) {
          const s = (await loadData()).students?.find(x => x.id === STU_ID);
          if (((s && s.preferences) || []).length === 0) break;
          await audit.page.waitForTimeout(400);
        }
      }

      const after = await loadData();
      availAfterRelease = availSlots(after.employers?.find(e => e.id === EMP_ID));
      prefsAfterRelease = (after.students?.find(s => s.id === STU_ID)?.preferences || []).length;
    }
  }

  const shot = await audit.shot('COUNTER-after');
  const obs = audit.observerSnapshot();
  if (!seedOk || !opened) {
    audit.recordCell({ id: 'COUNTER-reserve-release', tableRef: 'vacancy ledger', expected: 'seed + open editor', observed: `seedOk=${seedOk}, opened=${opened}`, pass: seedOk ? false : null, notes: 'Could not seed/open.' });
  } else {
    const pass = availAfterBuild === 1 && uiShowedRemaining && availAfterRelease === 2 && prefsAfterRelease === 0 && obs.pageErrors.length === 0;
    audit.recordCell({
      id: 'COUNTER-reserve-release',
      tableRef: 'PlacementPanel / vacancySlots ledger — reserve drops, release returns',
      expected: 'after build: 1 of 2 vacancies open + UI "נותרו 1 מקומות"; after release: 2 open again, 0 preferences',
      observed: `availAfterBuild=${availAfterBuild} (want 1), uiRemaining=${uiShowedRemaining}, availAfterRelease=${availAfterRelease} (want 2), prefsAfterRelease=${prefsAfterRelease}, errors=(${obs.pageErrors.length}p)`,
      pass, after: shot,
      notes: availAfterBuild !== 1 ? 'Build did not consume exactly one vacancy.'
        : !uiShowedRemaining ? 'PlacementPanel did not show the live "נותרו 1 מקומות" count.'
        : availAfterRelease !== 2 ? 'Release did not return the vacancy to the ledger.'
        : prefsAfterRelease !== 0 ? 'Released preference was not removed.' : '',
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

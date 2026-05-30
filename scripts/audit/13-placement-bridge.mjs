#!/usr/bin/env node
/**
 * 13-placement-bridge.mjs — "אשר העדפות והכן לשליחה" builds structured placements.
 *
 *   BUILD-preferences  Opening a practicum student who chose an org and clicking
 *                      "אשר העדפות והכן לשליחה" must create a structured
 *                      StudentPreference (rank+employerId+slotId+status) AND
 *                      reserve a vacancy slot on that employer — which is what
 *                      lights up PlacementPanel's WhatsApp/email dispatch.
 *
 * Seeds a TEMPORARY practicum student + a TEMPORARY employer (both audit-tagged),
 * exercises the build, asserts the DB result, and removes both. Touches no real
 * student or employer.
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
async function loadData() {
  const rows = await sbQuery('practicum_data', { select: 'data' });
  return rows?.[0]?.data || {};
}

const audit = new Audit({ name: 'placement-bridge' });
const ts = Date.now();
const EMP_ID = `audit-emp-${ts}`, EMP_NAME = `ארגון בדיקה ${ts}`;
const STU_ID = `audit-stu-${ts}`, STU_NAME = `סטודנט בדיקה ${ts}`;
const SLOT_ID = `${EMP_ID}-s1`;

// ── Seed temp practicum course (reuse real one if present) + employer + student ──
let seedOk = false, courseId = '';
try {
  const data = await loadData();
  const courses = data.courses || [];
  const practicum = courses.find(c => c?.type === 'practicum') || courses[0];
  courseId = practicum?.id || '';
  if (!courseId) throw new Error('no course to attach to');

  const tempEmp = {
    id: EMP_ID, name: EMP_NAME, approvalStatus: 'approved', addedBy: 'admin',
    restrictedToStudentId: null, courseIds: [courseId], positionsTotal: 1,
    contactPhone: '0500000000', contactEmail: 'audit@org.local', notes: 'audit employer',
    vacancySlots: [{ id: SLOT_ID, courseId, status: 'available', studentId: null, prefRank: null, history: [] }],
  };
  const tempStu = {
    id: STU_ID, name: STU_NAME, email: `audit-${ts}@audit.local`, courseId,
    cvUpdatedUrl: 'storage://candidate-uploads/audit-cv.pdf',
    firstChoiceOrg: EMP_NAME, firstChoiceResult: 'pending',
    submissionStatus: 'submitted', preferences: [],
  };
  await sbPatchData({
    ...data,
    employers: [...(data.employers || []), tempEmp],
    students: [...(data.students || []), tempStu],
  });
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 200)}`); }

await audit.setup();
await audit.page.evaluate(({ cId }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: cId || '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'students');
}, { cId: courseId });
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1000);

audit.log('BUILD-preferences: אשר העדפות והכן לשליחה → structured preference + reserved slot');
{
  audit.observerMark();
  let opened = false, clicked = false;

  if (seedOk) {
    const row = audit.page.locator('li').filter({ hasText: STU_NAME }).first();
    if (await row.isVisible().catch(() => false)) {
      const editBtn = row.getByTitle('ערוך').first();
      if (await editBtn.isVisible().catch(() => false)) await editBtn.click();
      else { await row.hover(); await audit.page.waitForTimeout(300); await row.getByTitle('ערוך').first().click().catch(() => {}); }
      await audit.page.waitForTimeout(1200);
      opened = true;

      const buildBtn = audit.page.getByRole('button', { name: /אשר העדפות והכן לשליחה/ }).first();
      if (await buildBtn.count() > 0) {
        await buildBtn.scrollIntoViewIfNeeded();
        await buildBtn.click().catch(() => {});
        await audit.page.waitForTimeout(2200); // build + persist
        clicked = true;
      }
    }
  }

  const after = await audit.shot('BUILD-preferences-after');

  // Deterministic DB assertion: the student now has a structured preference and
  // the employer's slot is reserved (tentative + studentId).
  let prefOk = false, slotOk = false, prefCount = 0;
  try {
    const data = await loadData();
    const stu = (data.students || []).find(s => s.id === STU_ID);
    const emp = (data.employers || []).find(e => e.id === EMP_ID);
    const prefs = (stu && stu.preferences) || [];
    prefCount = prefs.length;
    prefOk = prefs.some(p => p.employerId === EMP_ID && p.slotId === SLOT_ID && p.status === 'tentative');
    const slot = ((emp && emp.vacancySlots) || []).find(s => s.id === SLOT_ID);
    slotOk = !!slot && slot.status === 'tentative' && slot.studentId === STU_ID;
  } catch (e) { audit.log(`DB check failed: ${e.message.slice(0, 100)}`); }

  // UI corroboration: a WhatsApp dispatch button now exists in PlacementPanel.
  const waButton = await audit.page.evaluate(() =>
    [...document.querySelectorAll('button')].some(b => /WhatsApp/.test(b.textContent || '')));

  const obs = audit.observerSnapshot();
  if (!seedOk) {
    audit.recordCell({ id: 'BUILD-preferences', tableRef: 'StudentEditor / build placements', expected: 'seed temp student+employer', observed: 'seed failed', pass: null, notes: 'Could not seed (RLS / no course).' });
  } else {
    const pass = opened && clicked && prefOk && slotOk && obs.pageErrors.length === 0;
    audit.recordCell({
      id: 'BUILD-preferences',
      tableRef: 'StudentEditor / אשר העדפות והכן לשליחה → preferences[] + reserved slot',
      expected: 'clicking build creates a tentative StudentPreference (employerId+slotId) AND flips the employer slot to tentative for this student',
      observed: `opened=${opened}, clicked=${clicked}, prefCount=${prefCount}, prefOk=${prefOk}, slotReserved=${slotOk}, waButton=${waButton}, errors=(${obs.pageErrors.length}p)`,
      pass, after,
      notes: !opened ? 'Could not open the seeded student editor.'
        : !clicked ? 'Build button not found in the editor.'
        : !prefOk ? 'No structured preference was created.'
        : !slotOk ? 'Employer slot was not reserved for the student.' : '',
    });
  }
}

// ── Cleanup: remove temp student + temp employer ─────────────────────
try {
  const data = await loadData();
  await sbPatchData({
    ...data,
    students: (data.students || []).filter(s => s.id !== STU_ID),
    employers: (data.employers || []).filter(e => e.id !== EMP_ID),
  });
  audit.log('Cleanup: removed temp student + employer');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

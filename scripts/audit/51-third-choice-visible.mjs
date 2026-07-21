#!/usr/bin/env node
/**
 * 51-third-choice-visible.mjs — the coordinator's editor loads AND builds all THREE
 * ranked student choices.
 *
 *   THIRD-choice-built  Seed a student with first/second/third choice orgs (three real
 *                       approved employers) and NO cv_updates row. Open the editor →
 *                       click "אשר העדפות והכן לשליחה" (build placements) → assert the
 *                       resulting student.preferences contain ALL THREE orgs, third
 *                       included.
 *
 * Found live 2026-07-21: הדר עוזירי chose 3 orgs (נישה פרו / עיריית אריאל / ביה"ח שיבא
 * תל השומר). The editor's `form` was initialised with firstChoiceOrg + secondChoiceOrg
 * ONLY — `thirdChoiceOrg` was never loaded — so Yariv saw only 2, AND buildPlacements
 * (which reads form.thirdChoiceOrg) silently dropped the third. Testing the BUILD (not
 * the mere display) guards the real consequence: the third choice reaching the
 * employer-dispatch pipeline. Display alone can't be asserted from page text — a
 * separate read-only "submitted preferences" block also shows the values.
 *
 * Seeds a temp student + three approved employers; removes them.
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

const SB_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
const readRow = async () => {
  const r = await fetch(`${SB_URL}/rest/v1/practicum_data?org_id=eq.default&select=data,version`, { headers: H });
  return (await r.json())[0];
};
const writeData = async (data, version) => {
  const r = await fetch(`${SB_URL}/rest/v1/practicum_data?org_id=eq.default&version=eq.${version}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ data, version: version + 1, updated_at: new Date().toISOString() }),
  });
  const j = await r.json().catch(() => null);
  return Array.isArray(j) && j.length > 0;
};
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const ts = Date.now();
const STU_ID = `ztc-${ts.toString(36).slice(-5)}`, STU_NAME = `שלוש בחירות ${ts}`;
const FIRST = `בחירה-א ${ts}`, SECOND = `בחירה-ב ${ts}`, THIRD = `בחירה-ג ${ts}`;

let seedOk = false, courseId = '';
for (let i = 0; i < 6 && !seedOk; i++) {
  try {
    const row = await readRow();
    const d = row.data;
    courseId = ((d.courses || []).find(c => c?.type === 'practicum') || (d.courses || [])[0])?.id || '';
    const mkEmp = (name) => ({ id: `${STU_ID}-${name}`, name, approvalStatus: 'approved', contactStatus: 'approved', addedBy: 'admin', restrictedToStudentId: null, courseIds: [courseId], positionsTotal: 1, positions: 1, notes: 'audit', contactPhone: '050', contactEmail: 'a@b.local', vacancySlots: [{ id: `${STU_ID}-${name}-s1`, courseId, status: 'available', studentId: null, prefRank: null, history: [] }] });
    const stu = {
      id: STU_ID, name: STU_NAME, email: `ztc-${ts}@audit.local`, courseId,
      cvUrl: 'storage://candidate-uploads/x.pdf', cvUpdatedUrl: 'storage://candidate-uploads/x-updated.pdf',
      submissionStatus: 'submitted',
      firstChoiceOrg: FIRST, secondChoiceOrg: SECOND, thirdChoiceOrg: THIRD, preferences: [],
    };
    seedOk = await writeData({
      ...d,
      students: [...(d.students || []), stu],
      employers: [...(d.employers || []), mkEmp(FIRST), mkEmp(SECOND), mkEmp(THIRD)],
    }, row.version);
  } catch (e) { console.log(`seed attempt ${i} failed: ${e.message.slice(0, 80)}`); }
}

const audit = new Audit({ name: 'third-choice-visible' });
await audit.setup();
await audit.page.evaluate(({ c }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c || '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'students');
}, { c: courseId });
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1200);

let opened = false, thirdFieldShown = false, built = [];
if (seedOk) {
  const row = audit.page.locator('li').filter({ hasText: STU_NAME }).first();
  if (await row.isVisible().catch(() => false)) {
    await row.getByTitle('ערוך').first().click().catch(() => {});
    await audit.page.waitForTimeout(1800);
    opened = await audit.page.evaluate(() => !!document.querySelector('button[aria-label="סגור"]'));

    // The editable third-choice field must at least exist (regression guard for the
    // missing Field). Its VALUE we verify through the build below, not page text.
    thirdFieldShown = await audit.page.evaluate(() => /בחירה שלישית — ארגון/.test(document.body.innerText));

    const buildBtn = audit.page.getByRole('button', { name: /אשר העדפות והכן לשליחה/ }).first();
    if (await buildBtn.count() > 0) {
      await buildBtn.scrollIntoViewIfNeeded();
      await buildBtn.click().catch(() => {});
      for (let i = 0; i < 14; i++) {
        const s = (await loadData()).students?.find(x => x.id === STU_ID);
        if ((s?.preferences || []).length >= 3) break;
        await audit.page.waitForTimeout(400);
      }
    }
  }
}

const after = await loadData();
const stu = (after.students || []).find(s => s.id === STU_ID);
built = (stu?.preferences || []).map(p => {
  const e = (after.employers || []).find(x => x.id === p.employerId);
  return e?.name || p.employerId;
});
const shot = await audit.shot('third-choice');

const hasAll3 = [FIRST, SECOND, THIRD].every(n => built.includes(n));
audit.recordCell({
  id: 'THIRD-choice-built',
  tableRef: 'StudentEditor form-load + buildPlacements — all three ranked choices',
  expected: 'a student with three choices builds THREE preferences (first, second AND third) — the third is not silently dropped',
  observed: seedOk
    ? `opened=${opened}, thirdField=${thirdFieldShown}, builtCount=${built.length}, hasThird=${built.includes(THIRD)}`
    : 'seed failed',
  pass: seedOk ? (opened && thirdFieldShown && built.length === 3 && hasAll3) : null,
  after: shot,
  notes: !thirdFieldShown ? 'No third-choice field in the editor.'
    : !built.includes(THIRD) ? "The third choice was dropped from the build — the exact הדר עוזירי bug (form init did not load thirdChoiceOrg)."
    : built.length !== 3 ? `Built ${built.length} preferences, expected 3: [${built.join(', ')}]` : '',
});

// Cleanup (CAS retry)
let cleaned = false;
for (let i = 0; i < 6 && !cleaned; i++) {
  try {
    const row = await readRow();
    const d = row.data;
    cleaned = await writeData({
      ...d,
      students: (d.students || []).filter(s => s.id !== STU_ID),
      employers: (d.employers || []).filter(e => !String(e.id).startsWith(`${STU_ID}-`)),
    }, row.version);
  } catch (e) { audit.log(`cleanup ${i} failed: ${e.message.slice(0, 80)}`); }
}
audit.log(cleaned ? 'Cleanup: removed temp student + 3 employers' : '⚠ Cleanup FAILED.');

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

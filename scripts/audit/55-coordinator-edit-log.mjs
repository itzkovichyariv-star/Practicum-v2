#!/usr/bin/env node
/**
 * 55-coordinator-edit-log.mjs — a coordinator's direct edit of a student is recorded
 * in the activity history (who + what).
 *
 *   COORD-edit-logged  Seed a student (firstChoiceOrg = A). As the coordinator, open
 *                      the editor, change the first choice to B, save. Assert the blob
 *                      history gains an entry whose `who` is the coordinator and whose
 *                      `action` names the change (mentions בחירה ראשונה / עריכת רכז)
 *                      for this student.
 *
 * Yariv 2026-07-21: coordinators (he or Rachel) can directly change any student's
 * choice — so there must be a "who changed what" trail. Student SUBMISSIONS are logged
 * in cv_updates; COORDINATOR edits previously left NO history entry (verified live).
 *
 * Seeds a temp student; removes it.
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
const STU_ID = `zclog-${ts.toString(36).slice(-5)}`, STU_NAME = `לוג רכז ${ts}`;
const NEW_ORG = 'Manpower';

let seedOk = false, courseId = '';
for (let i = 0; i < 6 && !seedOk; i++) {
  try {
    const row = await readRow();
    const d = row.data;
    courseId = ((d.courses || []).find(c => c?.type === 'practicum') || (d.courses || [])[0])?.id || '';
    const stu = { id: STU_ID, name: STU_NAME, email: `zclog-${ts}@audit.local`, courseId, cvUrl: 'storage://x', firstChoiceOrg: 'נישה פרו', submissionStatus: 'submitted', preferences: [] };
    seedOk = await writeData({ ...d, students: [...(d.students || []).filter(s => s.id !== STU_ID), stu] }, row.version);
  } catch (e) { console.log(`seed attempt ${i} failed: ${e.message.slice(0, 80)}`); }
}

const audit = new Audit({ name: 'coordinator-edit-log' });
await audit.setup();
await audit.page.evaluate(({ c }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c || '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'students');
}, { c: courseId });
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1200);

let opened = false, saved = false, persistedNewOrg = false;
if (seedOk) {
  const row = audit.page.locator('li').filter({ hasText: STU_NAME }).first();
  if (await row.isVisible().catch(() => false)) {
    await row.getByTitle('ערוך').first().click().catch(() => {});
    await audit.page.waitForTimeout(2000);
    opened = await audit.page.evaluate(() => !!document.querySelector('button[aria-label="סגור"]'));

    // Change the first choice (free-text input) to NEW_ORG. The input sits right after
    // the "בחירה ראשונה — ארגון" label — target it with a locator and fill() so React's
    // onChange fires reliably (headless evaluate-set can miss the controlled update).
    const firstInput = audit.page.locator('xpath=//span[normalize-space()="בחירה ראשונה — ארגון"]/following::input[1]');
    await firstInput.fill(NEW_ORG).catch(() => {});
    await firstInput.press('Tab').catch(() => {}); // blur → commit + close dropdown (Escape would close the whole modal)
    await audit.page.waitForTimeout(400);
    await audit.page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim().startsWith('שמור'));
      if (b) b.click();
    });
    for (let i = 0; i < 12; i++) {
      const s = (await loadData()).students?.find(x => x.id === STU_ID);
      if ((s?.firstChoiceOrg || '') === NEW_ORG) { saved = true; break; }
      await audit.page.waitForTimeout(400);
    }
    persistedNewOrg = saved;
  }
}

// ── Assert a coordinator-edit history entry exists ──────────────────────────
const after = await loadData();
const entries = (after.history || []).filter(e => e.target === STU_NAME);
const editEntry = entries.find(e => /עריכת רכז|בחירה ראשונה|עריכת פרטי/.test(e.action || ''));
const hasWho = !!editEntry?.who;

const shot = await audit.shot('coordinator-edit-log');
audit.recordCell({
  id: 'COORD-edit-logged',
  tableRef: 'StudentsPage.handleSave → saveSnapshot activity (who + what)',
  expected: "a coordinator's direct edit records a history entry naming WHO changed it and WHAT (the changed field)",
  observed: seedOk
    ? `opened=${opened}, persistedNewOrg=${persistedNewOrg}, historyEntry=${editEntry ? `"${editEntry.action}" by ${editEntry.who}` : 'NONE'}`
    : 'seed failed',
  pass: seedOk ? (opened && persistedNewOrg && !!editEntry && hasWho) : null,
  after: shot,
  notes: !persistedNewOrg ? 'The edit did not persist — cannot assess logging.'
    : !editEntry ? 'No coordinator-edit history entry — the change left no "who changed what" trail (the bug).'
    : !hasWho ? 'History entry has no `who` — cannot tell which coordinator made the change.' : '',
});

// Cleanup
let cleaned = false;
for (let i = 0; i < 6 && !cleaned; i++) {
  try {
    const row = await readRow();
    cleaned = await writeData({
      ...row.data,
      students: (row.data.students || []).filter(s => s.id !== STU_ID),
      // Drop the audit's own history entries so the log isn't polluted by test runs.
      history: (row.data.history || []).filter(e => e.target !== STU_NAME),
    }, row.version);
  } catch (e) { audit.log(`cleanup ${i} failed: ${e.message.slice(0, 80)}`); }
}
audit.log(cleaned ? 'Cleanup: removed temp student + its history entries' : '⚠ Cleanup FAILED.');

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

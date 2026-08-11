#!/usr/bin/env node
/**
 * 45-suggestion-firstchoice.mjs — approving a student-suggested org from the
 * STUDENT CARD actually makes it the student's first choice and dismisses the
 * suggestion.
 *
 *   SUGGEST-firstchoice  Seed a student + a cv_updates suggestion → open the
 *                        student editor → click "✓ אשר … וקבע כבחירה ראשונה".
 *                        Asserts in the DB: (a) the student's firstChoiceOrg is
 *                        the suggested org, (b) a PRIVATE employer (restrictedTo
 *                        that student) was created for it, (c) the suggestion's
 *                        cv_updates id is in dismissedSuggestionIds.
 *
 * Guards the bug: the student-card handler saved ONLY employers, so firstChoiceOrg
 * (set in the editor's local form) was silently dropped and the suggestion stayed
 * live in the banner. The Employers-page path did it right; this brings the card
 * path to parity. Yariv: "אם סטודנט העלה ארגון זו הופכת להיות העדפה ראשונה שלו".
 *
 * Note: anon can INSERT cv_updates but not UPDATE/DELETE it (RLS). Cleanup removes
 * the seeded student + created employer from the data blob and adds the cv_updates
 * id to dismissedSuggestionIds — which is exactly the marker the banner now honours,
 * so the seeded suggestion is hidden rather than orphaned.
 */
import { Audit, sbQuery, appReady } from '../audit-lib.mjs';

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

const ts = Date.now();
const tag = ts.toString(36).slice(-5);
const STU_ID = `zsug-${tag}`, STU_MAIL = `sug-${ts}@audit.local`, STU_NAME = `הצעה בדיקה ${ts}`;
const ORG = `ארגון מוצע ${ts}`;
let sugId = '';

let seedOk = false, courseId = '';
try {
  const row = await readRow();
  const d = row.data;
  courseId = ((d.courses || []).find(c => c?.type === 'practicum') || (d.courses || [])[0])?.id || '';
  // Student with NO updated CV (so the suggestion panel loads) and no firstChoiceOrg.
  const stu = { id: STU_ID, name: STU_NAME, email: STU_MAIL, courseId, submissionStatus: 'submitted', preferences: [] };
  if (!await writeData({ ...d, students: [...(d.students || []), stu] }, row.version)) throw new Error('seed student CAS lost');
  // Suggestion row (anon can insert).
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/cv_updates`, {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ email: STU_MAIL, name: STU_NAME, cv_file_path: 'x/audit.pdf', suggested_org: { name: ORG, contactName: 'איש קשר', email: 'org@audit.local' } }),
  });
  sugId = (await ins.json())[0]?.id || '';
  seedOk = !!sugId;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

const audit = new Audit({ name: 'suggestion-firstchoice' });
await audit.setup();
await audit.page.evaluate(({ c }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c || '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'students');
}, { c: courseId });
await audit.page.reload({ waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(1200);

let opened = false, approved = false;
if (seedOk) {
  const row = audit.page.locator('li').filter({ hasText: STU_NAME }).first();
  if (await row.isVisible().catch(() => false)) {
    await row.getByTitle('ערוך').first().click().catch(() => {});
    await audit.page.waitForTimeout(3000); // editor + the pendingCv fetch
    opened = await audit.page.evaluate(() => !!document.querySelector('button[aria-label="סגור"]'));
    const approveBtn = audit.page.locator('button').filter({ hasText: 'כבחירה ראשונה' }).first();
    if (await approveBtn.count() > 0) {
      await approveBtn.scrollIntoViewIfNeeded().catch(() => {});
      await approveBtn.click().catch(() => {});
      await audit.page.waitForTimeout(2500); // approve → save → refresh
      approved = true;
    }
  }
}

// ── Assert against the DB ────────────────────────────────────────────────────
let firstChoiceOk = false, privateEmpOk = false, dismissedOk = false, fcVal = '';
if (seedOk) {
  const d = (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};
  const stu = (d.students || []).find(s => s.id === STU_ID);
  fcVal = stu?.firstChoiceOrg || '';
  firstChoiceOk = fcVal === ORG;
  privateEmpOk = (d.employers || []).some(e => e.name === ORG && e.restrictedToStudentId === STU_ID);
  dismissedOk = ((d.dismissedSuggestionIds || [])).includes(sugId);
}

audit.recordCell({
  id: 'SUGGEST-firstchoice',
  tableRef: 'StudentEditor.approveSuggestion + StudentsPage.onApproveSuggestion',
  expected: 'card-approve sets student.firstChoiceOrg=suggested org, creates a private employer for that student, and dismisses the suggestion',
  observed: seedOk
    ? `opened=${opened}, approved=${approved}, firstChoice="${fcVal}"(${firstChoiceOk}), privateEmp=${privateEmpOk}, dismissed=${dismissedOk}`
    : 'seed failed',
  pass: seedOk ? (firstChoiceOk && privateEmpOk && dismissedOk) : null,
  notes: !opened ? 'editor did not open — cannot exercise approve'
    : !firstChoiceOk ? 'firstChoiceOrg NOT persisted — the card approve dropped it (the bug).'
    : !dismissedOk ? 'suggestion not added to dismissedSuggestionIds — it would re-appear in the banner.' : '',
});

// ── Cleanup (CAS retry — must not leave an unhidden suggestion) ──────────────
let cleaned = false;
for (let i = 0; i < 6 && !cleaned; i++) {
  try {
    const row = await readRow();
    const d = row.data;
    cleaned = await writeData({
      ...d,
      students: (d.students || []).filter(s => s.id !== STU_ID),
      employers: (d.employers || []).filter(e => e.name !== ORG),
      // Hide the seeded cv_updates suggestion (anon can't delete it) — the banner
      // now honours dismissedSuggestionIds, so this fully removes it from view.
      dismissedSuggestionIds: Array.from(new Set([...((d.dismissedSuggestionIds) || []), sugId])),
    }, row.version);
  } catch (e) { audit.log(`Cleanup attempt ${i} failed: ${e.message.slice(0, 80)}`); }
}
audit.log(cleaned ? 'Cleanup: removed temp student + employer; dismissed seeded suggestion'
                  : '⚠ Cleanup FAILED after retries — a seeded suggestion may be left unhidden.');

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

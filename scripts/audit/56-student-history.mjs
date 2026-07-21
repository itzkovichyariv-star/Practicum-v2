#!/usr/bin/env node
/**
 * 56-student-history.mjs — the STUDENT sees their own submission history on /cv-update.
 *
 *   STU-history-shown  Seed a student + TWO cv_updates submissions, open their
 *                      /cv-update?email= link, and assert a "היסטוריית ההגשות שלי (2)"
 *                      toggle appears and, when clicked, reveals BOTH submissions
 *                      (the earlier org and the latest), read-only.
 *
 * Yariv 2026-07-21: "student history was also requested" — after adding the
 * coordinator-edit trail, the student must also see their own past submissions on the
 * one link they use. The coordinator already sees this in the editor.
 *
 * Seeds a temp student; removes it. (cv_updates rows are inert — @audit.local email —
 * and anon can't delete them.)
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

const ts = Date.now();
const STU_ID = `zsh-${ts.toString(36).slice(-5)}`, MAIL = `zsh-${ts}@audit.local`;
const OLD_ORG = `ארגון ישן ${ts}`, NEW_ORG = 'נישה פרו';

let seedOk = false, courseId = '';
for (let i = 0; i < 6 && !seedOk; i++) {
  try {
    const row = await readRow();
    const d = row.data;
    courseId = ((d.courses || []).find(c => c?.type === 'practicum') || (d.courses || [])[0])?.id || '';
    const stu = { id: STU_ID, name: `היסטוריה ${ts}`, email: MAIL, courseId, cvUrl: 'storage://x', cvUpdatedUrl: `storage://candidate-uploads/cv-updates/${STU_ID}-B.docx`, firstChoiceOrg: NEW_ORG, submissionStatus: 'submitted', preferences: [] };
    seedOk = await writeData({ ...d, students: [...(d.students || []).filter(s => s.id !== STU_ID), stu] }, row.version);
  } catch (e) { console.log(`seed attempt ${i} failed: ${e.message.slice(0, 80)}`); }
}
if (seedOk) {
  await fetch(`${SB_URL}/rest/v1/cv_updates`, { method: 'POST', headers: H, body: JSON.stringify({ email: MAIL, name: 'היסטוריה', cv_file_path: `cv-updates/${STU_ID}-A.docx`, org_pref_1: OLD_ORG, uploaded_at: new Date(ts - 172800000).toISOString() }) });
  await fetch(`${SB_URL}/rest/v1/cv_updates`, { method: 'POST', headers: H, body: JSON.stringify({ email: MAIL, name: 'היסטוריה', cv_file_path: `cv-updates/${STU_ID}-B.docx`, org_pref_1: NEW_ORG }) });
}

const audit = new Audit({ name: 'student-history' });
await audit.setup();

let toggleShown = false, toggleLabel = '', revealsOld = false, revealsNew = false, prevCvLinks = 0;
if (seedOk) {
  await audit.page.goto(`${audit.baseUrl}/cv-update/?email=${encodeURIComponent(MAIL)}&name=${encodeURIComponent('היסטוריה')}`, { waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(2800);

  const toggle = audit.page.locator('button', { hasText: /היסטוריית ההגשות שלי/ }).first();
  toggleShown = (await toggle.count()) > 0;
  toggleLabel = toggleShown ? (await toggle.textContent() || '').trim() : '';
  if (toggleShown) {
    await toggle.click().catch(() => {});
    await audit.page.waitForTimeout(600);
    const state = await audit.page.evaluate(({ oldOrg, newOrg }) => ({
      old: document.body.innerText.includes(oldOrg),
      neu: document.body.innerText.includes(newOrg),
      links: [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim() === 'קו״ח ↗').length,
    }), { oldOrg: OLD_ORG, newOrg: NEW_ORG });
    revealsOld = state.old; revealsNew = state.neu; prevCvLinks = state.links;
  }
}

const shot = await audit.shot('student-history');
audit.recordCell({
  id: 'STU-history-shown',
  tableRef: 'CvUpdateForm — student sees their own submission history',
  expected: "a returning student sees a 'היסטוריית ההגשות שלי (N)' toggle that reveals ALL their past submissions (earlier + latest)",
  observed: seedOk
    ? `toggleShown=${toggleShown}, label="${toggleLabel}", revealsEarlier=${revealsOld}, revealsLatest=${revealsNew}, cvLinks=${prevCvLinks}`
    : 'seed failed',
  pass: seedOk ? (toggleShown && /\(2\)/.test(toggleLabel) && revealsOld && revealsNew) : null,
  after: shot,
  notes: !toggleShown ? 'No student-history toggle — the student cannot see their past submissions (the gap).'
    : !revealsOld ? 'The earlier submission is not revealed.'
    : !revealsNew ? 'The latest submission is not revealed.' : '',
});

// Cleanup
let cleaned = false;
for (let i = 0; i < 6 && !cleaned; i++) {
  try {
    const row = await readRow();
    cleaned = await writeData({ ...row.data, students: (row.data.students || []).filter(s => s.id !== STU_ID) }, row.version);
  } catch (e) { audit.log(`cleanup ${i} failed: ${e.message.slice(0, 80)}`); }
}
audit.log(cleaned ? 'Cleanup: removed temp student' : '⚠ Cleanup FAILED.');

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

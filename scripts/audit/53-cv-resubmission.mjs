#!/usr/bin/env node
/**
 * 53-cv-resubmission.mjs — a RE-SUBMITTED CV is surfaced and can replace the old one.
 *
 *   RESUB-shown-and-applied  Seed a student who ALREADY has an updated CV (FIRST) +
 *                            a seen cv_updates row, then insert a NEWER unseen
 *                            cv_updates row (SECOND, a re-upload). Open the editor →
 *                            the "הגשה חדשה יותר ממתינה" panel MUST appear showing the
 *                            SECOND file → click "אמץ כ‑CV מעודכן" → Save → assert the
 *                            student's cvUpdatedUrl now points to SECOND (the old CV
 *                            was replaced), and reopening does NOT re-nag.
 *
 * Found live 2026-07-21: the pending-CV detection skipped entirely when the student
 * already had a cvUpdatedUrl (`if (!email || student.cvUpdatedUrl) return`), and the
 * StudentsPage auto-promote only runs for students WITHOUT one. So a student who
 * re-uploaded a corrected CV was silently ignored — the coordinator kept sending the
 * OLD CV with no signal. Yariv: "לבדוק מה קורה כשמחליפים/מעדכנים את קורות החיים".
 *
 * Seeds a temp student; removes it. (cv_updates rows can't be deleted by anon — they
 * are keyed to a @audit.local email no real student matches, so they are inert.)
 */
import { Audit, sbQuery, appReady } from '../audit-lib.mjs';

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
const STU_ID = `zresub-${ts.toString(36).slice(-5)}`, MAIL = `zresub-${ts}@audit.local`, STU_NAME = `בדיקת החלפה ${ts}`;
const FIRST_FILE = `cv-updates/${STU_ID}-FIRST.docx`;
const SECOND_FILE = `cv-updates/${STU_ID}-SECOND.docx`;

let seedOk = false, courseId = '';
for (let i = 0; i < 6 && !seedOk; i++) {
  try {
    const row = await readRow();
    const d = row.data;
    courseId = ((d.courses || []).find(c => c?.type === 'practicum') || (d.courses || [])[0])?.id || '';
    const stu = {
      id: STU_ID, name: STU_NAME, email: MAIL, courseId,
      cvUrl: `storage://candidate-uploads/${STU_ID}/original.docx`,
      cvUpdatedUrl: `storage://candidate-uploads/${FIRST_FILE}`, // already has the FIRST updated CV
      firstChoiceOrg: 'ארגון ראשון', submissionStatus: 'submitted', preferences: [],
    };
    seedOk = await writeData({ ...d, students: [...(d.students || []).filter(s => s.id !== STU_ID), stu] }, row.version);
  } catch (e) { console.log(`seed attempt ${i} failed: ${e.message.slice(0, 80)}`); }
}
if (seedOk) {
  // FIRST row (seen — already applied); SECOND row (unseen re-submission).
  await fetch(`${SB_URL}/rest/v1/cv_updates`, { method: 'POST', headers: H, body: JSON.stringify({ email: MAIL, name: STU_NAME, cv_file_path: FIRST_FILE, org_pref_1: 'ארגון ראשון', seen_at: new Date(ts - 86400000).toISOString() }) });
  await fetch(`${SB_URL}/rest/v1/cv_updates`, { method: 'POST', headers: H, body: JSON.stringify({ email: MAIL, name: STU_NAME, cv_file_path: SECOND_FILE, org_pref_1: 'ארגון חדש' }) });
}

const audit = new Audit({ name: 'cv-resubmission' });
await audit.setup();
await audit.page.evaluate(({ c }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c || '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'students');
}, { c: courseId });
await audit.page.reload({ waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(1500);

const openEditor = async () => {
  const row = audit.page.locator('li').filter({ hasText: STU_NAME }).first();
  if (!await row.isVisible().catch(() => false)) return false;
  await row.getByTitle('ערוך').first().click().catch(() => {});
  await audit.page.waitForTimeout(2500);
  return audit.page.evaluate(() => !!document.querySelector('button[aria-label="סגור"]'));
};

let opened = false, panelShown = false, showsSecond = false, applied = false, reNags = false;
if (seedOk) {
  opened = await openEditor();
  const state = await audit.page.evaluate(() => ({
    panel: /הגשה חדשה יותר ממתינה/.test(document.body.innerText),
    second: /SECOND/.test(document.body.innerText),
  }));
  panelShown = state.panel; showsSecond = state.second;

  if (panelShown) {
    await audit.page.evaluate(() => {
      // Matches both labels: "אמץ כ‑CV מעודכן" (CV-only re-upload) and
      // "אמץ הגשה (קו״ח + העדפות)" (submission with org preferences).
      const b = [...document.querySelectorAll('button')].find(x => /^✓ אמץ/.test((x.textContent || '').trim()));
      if (b) b.click();
    });
    await audit.page.waitForTimeout(600);
    await audit.page.evaluate(() => {
      const s = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim().startsWith('שמור'));
      if (s) s.click();
    });
    for (let i = 0; i < 12; i++) {
      const s = (await loadData()).students?.find(x => x.id === STU_ID);
      if ((s?.cvUpdatedUrl || '').includes('SECOND')) { applied = true; break; }
      await audit.page.waitForTimeout(400);
    }
    // Reopen — must not re-nag now that the current CV IS the second file.
    await audit.page.reload({ waitUntil: 'networkidle' });
    await appReady(audit.page);
    await audit.page.waitForTimeout(1200);
    await openEditor();
    reNags = await audit.page.evaluate(() => /הגשה חדשה יותר ממתינה/.test(document.body.innerText));
  }
}

const after = await loadData();
const finalStu = (after.students || []).find(s => s.id === STU_ID) || {};
const finalCv = finalStu.cvUpdatedUrl || '';
// The submission carried org_pref_1='ארגון חדש' — applying it must REPLACE the old
// firstChoiceOrg ('ארגון ראשון'), per Yariv "בקשה חדשה צריכה להחליף את הישנה".
const orgAdopted = (finalStu.firstChoiceOrg || '') === 'ארגון חדש';
const shot = await audit.shot('cv-resubmission');
audit.recordCell({
  id: 'RESUB-shown-and-applied',
  tableRef: 'StudentEditor pending-CV detection — a re-submission is surfaced + replaces the old CV AND orgs',
  expected: 'a newer unseen cv_updates row is shown even when a CV already exists; applying it replaces cvUpdatedUrl with the new file AND adopts the submission org preferences (firstChoiceOrg); reopening does not re-nag',
  observed: seedOk
    ? `opened=${opened}, panelShown=${panelShown}, showsSecond=${showsSecond}, appliedToSecond=${applied}, orgAdopted=${orgAdopted}(${finalStu.firstChoiceOrg||''}), reNags=${reNags}, finalCv=…${finalCv.split('/').pop()}`
    : 'seed failed',
  pass: seedOk ? (opened && panelShown && showsSecond && applied && orgAdopted && !reNags) : null,
  after: shot,
  notes: !panelShown ? 'The re-submission was NOT surfaced — the coordinator would keep sending the old CV (the bug).'
    : !applied ? 'Applying the re-submission did not replace cvUpdatedUrl with the new file.'
    : !orgAdopted ? 'Applying did not adopt the new org preferences — the old firstChoiceOrg was kept.'
    : reNags ? 'The panel re-nags after applying (the file-match guard failed).' : '',
});

// Cleanup — remove the temp student (cv_updates rows are inert; anon can't delete them).
let cleaned = false;
for (let i = 0; i < 6 && !cleaned; i++) {
  try {
    const row = await readRow();
    cleaned = await writeData({ ...row.data, students: (row.data.students || []).filter(s => s.id !== STU_ID) }, row.version);
  } catch (e) { audit.log(`cleanup ${i} failed: ${e.message.slice(0, 80)}`); }
}
audit.log(cleaned ? 'Cleanup: removed temp student (cv_updates rows are inert)' : '⚠ Cleanup FAILED.');

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

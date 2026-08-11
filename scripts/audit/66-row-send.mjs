#!/usr/bin/env node
/**
 * 66-row-send.mjs — sending a CV from the students LIST, and undoing a send.
 *
 * Both come from Yariv's own use on 2026-08-09:
 *   "אם אפשר שהשליחה תהיה מהמלבן של הסטודנט זה יקל, במקום לגלול עד למטה" — send without
 *   entering the card, while keeping every guard that stops a stray tap.
 *   "צריך לחצן שמבטל או מאפשר שליחה חוזרת של קורות החיים" — after a CV was recorded as
 *   sent that Outlook never opened, there was no way back: the only exit was 'בוטל',
 *   which is terminal and forced re-adding the organization.
 *
 *   ROWSEND-names-target      The row's button names the employer it will send to.
 *   ROWSEND-not-sent-nothing  Opening the compose window then answering "לא נשלח" writes
 *                             NOTHING — no place taken, no dispatch. This is the exact
 *                             shape of the phantom-dispatch bug.
 *   ROWSEND-confirmed-commits Answering "✓ נשלח" takes the place and logs the dispatch.
 *   ROWSEND-return-to-list    "↩︎ לא נשלח" in the card frees the place and returns the org
 *                             to the list as sendable again (status back to tentative).
 *
 * Seeds its own student + employer and removes them afterwards, so it never depends on —
 * or disturbs — real coordinator data.
 */
import { Audit, sbQuery, appReady } from '../audit-lib.mjs';

const SB_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
const readRow = async () => (await (await fetch(`${SB_URL}/rest/v1/practicum_data?org_id=eq.default&select=data,version`, { headers: H })).json())[0];
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
const STU_ID = `zrs-${ts.toString(36).slice(-5)}`, STU_NAME = `שליחה משורה ${ts}`;
const EMP_ID = `${STU_ID}-e1`, ORG = `ארגון-שורה ${ts}`;

let seedOk = false, courseId = '';
for (let i = 0; i < 6 && !seedOk; i++) {
  try {
    const row = await readRow();
    const d = row.data;
    courseId = ((d.courses || []).find(c => c?.type === 'practicum') || (d.courses || [])[0])?.id || '';
    const emp = {
      id: EMP_ID, name: ORG, approvalStatus: 'approved', contactStatus: 'approved', addedBy: 'admin',
      restrictedToStudentId: null, courseIds: [courseId], positionsTotal: 1, positions: 1,
      notes: 'audit', contactPhone: '0500000000', contactEmail: 'a@b.local',
      vacancySlots: [{ id: `${EMP_ID}-s1`, courseId, status: 'available', studentId: null, prefRank: null, history: [] }],
    };
    const stu = {
      id: STU_ID, name: STU_NAME, email: `${STU_ID}@audit.local`, courseId,
      cvUrl: 'storage://candidate-uploads/x.pdf', cvUpdatedUrl: 'storage://candidate-uploads/x-updated.pdf',
      submissionStatus: 'submitted', preparation: { passed: true },
      firstChoiceOrg: ORG, preferences: [],
    };
    seedOk = await writeData({
      ...d,
      students: [...(d.students || []).filter(s => s.id !== STU_ID), stu],
      employers: [...(d.employers || []).filter(e => e.id !== EMP_ID), emp],
    }, row.version);
  } catch (e) { console.log(`seed attempt ${i} failed: ${String(e.message).slice(0, 80)}`); }
}

const audit = new Audit({ name: 'row-send' });
await audit.setup();
await audit.page.evaluate(({ c }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c || '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'students');
}, { c: courseId });

const stateOf = async () => {
  const d = await loadData();
  const s = (d.students || []).find(x => x.id === STU_ID);
  const e = (d.employers || []).find(x => x.id === EMP_ID);
  const slot = ((e?.vacancySlots) || [])[0];
  return {
    prefStatus: ((s?.preferences || []).find(p => p.orgName === ORG) || {}).status || '(none)',
    slotStatus: slot?.status || '(none)',
    dispatches: (d.dispatches || []).filter(x => x.studentId === STU_ID).length,
  };
};

/** Open the row's send dialog and pick the email channel. Returns what the row offered. */
const openRowSend = async () => audit.page.evaluate(async (name) => {
  window.open = () => ({ closed: false, close() {}, focus() {} });   // stand in an opened window
  const li = [...document.querySelectorAll('li')].find(l => (l.innerText || '').includes(name));
  const strip = li?.querySelector('[data-placement-strip]');
  const btn = strip?.querySelector('[data-strip-action="send_cv"]');
  if (!btn) return { err: 'no send button on the row', state: strip?.getAttribute('data-placement-strip') || 'no strip' };
  const label = btn.textContent.trim();
  const target = btn.getAttribute('data-strip-target');
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  await new Promise(r => setTimeout(r, 350));
  const dlg = document.querySelector('[data-placement-confirm="send_cv"]');
  dlg?.querySelector('[data-channel="email"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  await new Promise(r => setTimeout(r, 700));
  const rowDlg = document.querySelector('[data-row-send-confirm]');
  const rec = document.querySelector('[data-send-recipient]');
  return { label, target, rowDialog: !!rowDlg, rowText: (rowDlg?.innerText || '').replace(/\s+/g, ' '),
           recipient: rec ? rec.innerText.replace(/\s+/g, ' ').slice(0, 70) : null };
}, STU_NAME);

if (!seedOk) {
  audit.recordCell({ id: 'ROWSEND-seed', expected: 'seed', observed: 'failed', pass: null });
} else {
  await audit.page.reload({ waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1600);

  // ── 1. the row names its target ────────────────────────────────────────────
  const before = await stateOf();
  const opened = await openRowSend();
  audit.recordCell({
    id: 'ROWSEND-names-target', tableRef: 'Yariv: "לא ברור לאיזה מעסיק זה יישלח"',
    expected: 'the row button names the employer, and the confirmation names student + org',
    observed: opened.err ? `${opened.err} (${opened.state})` : `"${opened.label}" target=${opened.target} | ${(opened.rowText||'').slice(0,110)}`,
    pass: !opened.err && opened.target === ORG && opened.rowDialog && opened.rowText.includes(STU_NAME),
  });

  // ── 2. "לא נשלח" must write nothing ────────────────────────────────────────
  await audit.page.evaluate(() => document.querySelector('[data-row-send-no]')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })));
  await audit.page.waitForTimeout(1200);
  const afterNo = await stateOf();
  audit.recordCell({
    id: 'ROWSEND-names-recipient', tableRef: 'proposal 4 — say who it reaches, before it opens',
    expected: 'the confirmation names the contact and the address',
    observed: opened.recipient || 'no recipient block',
    pass: !!opened.recipient && /נמען/.test(opened.recipient) });

  audit.recordCell({
    id: 'ROWSEND-not-sent-nothing', tableRef: 'the phantom-dispatch shape, from the row',
    expected: 'answering "לא נשלח" leaves the place free and writes no dispatch',
    observed: `pref ${before.prefStatus}→${afterNo.prefStatus}, slot ${before.slotStatus}→${afterNo.slotStatus}, dispatches ${before.dispatches}→${afterNo.dispatches}`,
    pass: afterNo.prefStatus === before.prefStatus && afterNo.slotStatus === 'available' && afterNo.dispatches === before.dispatches,
  });

  // ── 3. confirming commits ──────────────────────────────────────────────────
  await audit.page.reload({ waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1500);
  await openRowSend();
  await audit.page.evaluate(() => document.querySelector('[data-row-send-yes]')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })));
  let afterYes = await stateOf();
  for (let i = 0; i < 14 && afterYes.prefStatus !== 'under_review'; i++) {
    await audit.page.waitForTimeout(500); afterYes = await stateOf();
  }
  audit.recordCell({
    id: 'ROWSEND-confirmed-commits', tableRef: 'Yariv: send from the row without entering the card',
    expected: 'confirming takes the place and logs the dispatch',
    observed: `pref=${afterYes.prefStatus}, slot=${afterYes.slotStatus}, dispatches=${afterYes.dispatches}`,
    pass: afterYes.prefStatus === 'under_review' && afterYes.slotStatus === 'under_review' && afterYes.dispatches === before.dispatches + 1,
  });

  // ── 4. "↩︎ לא נשלח" in the card returns it to the list ─────────────────────
  // Reload first: the editor builds its org cards from its own form state, which was
  // loaded before the row send committed.
  await audit.page.reload({ waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1600);
  const returned = await audit.page.evaluate(async (name) => {
    const li = [...document.querySelectorAll('li')].find(l => (l.innerText || '').includes(name));
    const edit = li?.querySelector('[title="ערוך"]');
    if (!edit) return { err: 'no edit control' };
    edit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    await new Promise(r => setTimeout(r, 1800));
    const btn = document.querySelector('[data-never-sent]');
    if (!btn) return {
      err: 'no ↩︎ לא נשלח button on the sent org',
      cards: document.querySelectorAll('[data-org-card]').length,
      sentMarkers: document.querySelectorAll('[data-sent-cv]').length,
      editorOpen: !!document.querySelector('button[aria-label="סגור"]'),
    };
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    await new Promise(r => setTimeout(r, 400));
    const go = document.querySelector('[data-confirm-action="never_sent"]');
    if (!go) return { err: 'never_sent confirmation not offered' };
    go.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    await new Promise(r => setTimeout(r, 1500));
    return { ok: true };
  }, STU_NAME);
  let afterReturn = await stateOf();
  for (let i = 0; i < 14 && afterReturn.prefStatus === 'under_review'; i++) {
    await audit.page.waitForTimeout(500); afterReturn = await stateOf();
  }
  audit.recordCell({
    id: 'ROWSEND-return-to-list', tableRef: 'Yariv: "צריך לחצן שמבטל או מאפשר שליחה חוזרת"',
    expected: 'the org returns to the list as sendable (tentative) and the place is freed',
    observed: returned.err ? returned.err : `pref=${afterReturn.prefStatus}, slot=${afterReturn.slotStatus}`,
    pass: !returned.err && afterReturn.prefStatus === 'tentative' && afterReturn.slotStatus === 'available',
  });

  // ── 5. the undo stays put, and it works from the row ────────────────────────
  // Yariv 2026-08-10: "it should be there but should stay after it is created" — a timed
  // toast is useless, because confirming whether Outlook really sent means switching to
  // Outlook and back, which outlasts any countdown. So the bar persists until dismissed
  // and every sent organization keeps its own undo.
  // Placed BEFORE the release test below, which removes the organization from the
  // ranking and would leave nothing to send.
  await audit.page.reload({ waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1500);
  await openRowSend();
  await audit.page.evaluate(() => document.querySelector('[data-row-send-yes]')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })));
  let sent2 = await stateOf();
  for (let i = 0; i < 14 && sent2.prefStatus !== 'under_review'; i++) { await audit.page.waitForTimeout(500); sent2 = await stateOf(); }

  await audit.page.waitForTimeout(6500);   // well past any 5-second window
  const bar = await audit.page.evaluate(() => {
    const b = document.querySelector('[data-sent-bar]');
    return { present: !!b, hasUndo: !!document.querySelector('[data-sent-bar-undo]'),
             text: (b?.innerText || '').replace(/\s+/g, ' ').slice(0, 70) };
  });
  audit.recordCell({ id: 'ROWSEND-undo-bar-persists', tableRef: 'Yariv 2026-08-10: the undo must stay',
    expected: 'the just-sent bar and its undo are still there after 6.5s',
    observed: bar.present ? `present · ${bar.text}` : `gone (sent=${sent2.prefStatus})`,
    pass: bar.present && bar.hasUndo });

  await audit.page.evaluate(() => document.querySelector('[data-sent-bar-undo]')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })));
  await audit.page.waitForTimeout(450);
  await audit.page.evaluate(() => {
    const go = [...document.querySelectorAll('button')].find(b => /שחרר והחזר/.test(b.textContent || ''))
      || document.querySelector('[data-confirm-go]');
    go?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  });
  let undone = await stateOf();
  for (let i = 0; i < 14 && undone.prefStatus === 'under_review'; i++) { await audit.page.waitForTimeout(500); undone = await stateOf(); }
  audit.recordCell({ id: 'ROWSEND-undo-frees-place', tableRef: 'Yariv 2026-08-10',
    expected: 'the undo returns the org to the list and frees the place',
    observed: `pref=${undone.prefStatus}, slot=${undone.slotStatus}`,
    pass: undone.prefStatus === 'tentative' && undone.slotStatus === 'available' });

  // ── 6. releasing a not-yet-sent org frees anything it held ──────────────────
  // RUNS LAST: it removes the organization from the ranking entirely.

  // handleRelease was the one data-changing operation in this flow with no cell at all
  // (found by the 2026-08-09 coverage sweep). It is the "✕ הסר ושחרר מקום" exit.
  const released = await audit.page.evaluate(async (name) => {
    // The release control lives inside the card, and the undo step above reloaded the
    // page — so open the editor again before looking for it.
    if (!document.querySelector('[data-release]')) {
      const li = [...document.querySelectorAll('li')].find(l => (l.innerText || '').includes(name));
      li?.querySelector('[title="ערוך"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      await new Promise(r => setTimeout(r, 1800));
    }
    const btn = document.querySelector('[data-release]');
    if (!btn) return { err: 'no release control on a tentative org' };
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    await new Promise(r => setTimeout(r, 1500));
    return { ok: true };
  }, STU_NAME);
  let afterRelease = await stateOf();
  for (let i = 0; i < 10 && afterRelease.prefStatus === 'tentative'; i++) {
    await audit.page.waitForTimeout(400); afterRelease = await stateOf();
  }
  audit.recordCell({
    id: 'ROWSEND-release-frees-place', tableRef: 'OrgHub handleRelease — previously untested',
    expected: 'removing a not-yet-sent org leaves no reserved place behind',
    observed: released.err ? released.err : `pref=${afterRelease.prefStatus}, slot=${afterRelease.slotStatus}`,
    pass: released.err ? null : afterRelease.slotStatus === 'available',
  });

}

// ── cleanup: remove the seeded student, employer AND its dispatches ────────────
// (Earlier cells left orphaned dispatch rows behind — ~78 of them by 2026-08-09.)
for (let i = 0; i < 6; i++) {
  try {
    const row = await readRow();
    const ok = await writeData({
      ...row.data,
      students: (row.data.students || []).filter(s => s.id !== STU_ID),
      employers: (row.data.employers || []).filter(e => e.id !== EMP_ID),
      dispatches: (row.data.dispatches || []).filter(x => x.studentId !== STU_ID),
    }, row.version);
    if (ok) break;
  } catch { /* retry */ }
}

await audit.teardown();

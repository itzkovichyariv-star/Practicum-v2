#!/usr/bin/env node
/**
 * 58-orghub-cards.mjs — the redesigned OrgHub renders the student's orgs as ONE
 * re-rankable card list, and the two behaviours the redesign hinges on hold end-to-end
 * through the real editor UI.
 *
 *   ORGHUB-union-cards   A student with THREE legacy choices and NO built preferences
 *                        (the הדר עוזירי case) shows THREE org cards — no "build" step.
 *   ORGHUB-rerank-keeps-result  Mark card #2's interview result "עבר", move it up to
 *                        #1, Save → the DB preference now ranked #1 is that org and it
 *                        STILL carries interviewResult 'passed' (result bound to the
 *                        org, not the rank slot) AND the legacy firstChoiceOrg synced.
 *   ORGHUB-send-takes-place  Tick a card's "שלח קו״ח" → send bar → WhatsApp → the
 *                        preference becomes under_review holding a real slot (send is
 *                        what takes a place; a card alone reserves nothing).
 *
 * Drives the actual editor (localStorage session, open by ערוך) like the other cells.
 * Seeds temp students + employers; removes them (CAS retry).
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

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
const A_ID = `zoa-${ts.toString(36).slice(-5)}`, A_NAME = `אורגהאב א ${ts}`;
const B_ID = `zob-${ts.toString(36).slice(-5)}`, B_NAME = `אורגהאב ב ${ts}`;
const O1 = `ארגון-א ${ts}`, O2 = `ארגון-ב ${ts}`, O3 = `ארגון-ג ${ts}`;

let seedOk = false, courseId = '';
for (let i = 0; i < 6 && !seedOk; i++) {
  try {
    const row = await readRow();
    const d = row.data;
    courseId = ((d.courses || []).find(c => c?.type === 'practicum') || (d.courses || [])[0])?.id || '';
    const mkEmp = (name, sfx) => ({ id: `${A_ID}-${sfx}`, name, approvalStatus: 'approved', contactStatus: 'approved', addedBy: 'admin', restrictedToStudentId: null, courseIds: [courseId], positionsTotal: 1, positions: 1, notes: 'audit', contactPhone: '0500000000', contactEmail: 'a@b.local', vacancySlots: [{ id: `${A_ID}-${sfx}-s1`, courseId, status: 'available', studentId: null, prefRank: null, history: [] }] });
    const mkStu = (id, name) => ({ id, name, email: `${id}@audit.local`, courseId, cvUrl: 'storage://candidate-uploads/x.pdf', cvUpdatedUrl: 'storage://candidate-uploads/x-updated.pdf', submissionStatus: 'submitted', firstChoiceOrg: O1, secondChoiceOrg: O2, thirdChoiceOrg: O3, preferences: [] });
    seedOk = await writeData({
      ...d,
      students: [...(d.students || []).filter(s => s.id !== A_ID && s.id !== B_ID), mkStu(A_ID, A_NAME), mkStu(B_ID, B_NAME)],
      employers: [...(d.employers || []).filter(e => !String(e.id).startsWith(`${A_ID}-`)), mkEmp(O1, 'o1'), mkEmp(O2, 'o2'), mkEmp(O3, 'o3')],
    }, row.version);
  } catch (e) { console.log(`seed attempt ${i} failed: ${e.message.slice(0, 80)}`); }
}

const audit = new Audit({ name: 'orghub-cards' });
await audit.setup();
await audit.page.evaluate(({ c }) => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c || '__all__', year: '__all__' }));
  localStorage.setItem('practicum_v2_page', 'students');
}, { c: courseId });

async function openEditor(name) {
  await audit.page.reload({ waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(1000);
  const row = audit.page.locator('li').filter({ hasText: name }).first();
  if (!(await row.isVisible().catch(() => false))) return false;
  await row.getByTitle('ערוך').first().click().catch(() => {});
  await audit.page.waitForTimeout(1600);
  return audit.page.evaluate(() => !!document.querySelector('button[aria-label="סגור"]'));
}

// ── Student A: union cards + re-rank-keeps-result through Save ───────────────
let cardCount = 0, thirdShown = false, rerankOrg = '', rerankResult = '', legacyFirst = '';
if (seedOk) {
  const openedA = await openEditor(A_NAME);
  if (openedA) {
    await audit.page.waitForSelector('[data-org-card]', { timeout: 4000 }).catch(() => {});
    cardCount = await audit.page.locator('[data-org-card]').count();
    // A tentative card shows its org name in the combobox INPUT value (not text) —
    // read every card's input to confirm the third choice surfaced.
    thirdShown = await audit.page.evaluate((o3) =>
      [...document.querySelectorAll('[data-org-card] input')].some(i => (i.value || '').includes(o3)), O3);

    // Card index 1 = rank #2. Mark its result 'passed', then move it up to rank #1.
    const name2 = await audit.page.evaluate(() => {
      const card = document.querySelector('[data-org-card="1"]');
      // org name is the combobox input value on a tentative card
      const inp = card?.querySelector('input');
      return inp ? inp.value : '';
    });
    await audit.page.locator('[data-result="1:passed"]').first().click().catch(() => {});
    await audit.page.waitForTimeout(250);
    await audit.page.locator('[data-move-up="1"]').first().click().catch(() => {});
    await audit.page.waitForTimeout(300);

    // Save (persist form → preferences[] + legacy sync)
    await audit.page.getByRole('button', { name: /^שמור/ }).first().click().catch(() => {});
    for (let i = 0; i < 16; i++) {
      const s = (await loadData()).students?.find(x => x.id === A_ID);
      if ((s?.preferences || []).length >= 1) break;
      await audit.page.waitForTimeout(400);
    }
    const s = (await loadData()).students?.find(x => x.id === A_ID);
    const p0 = (s?.preferences || [])[0];
    rerankOrg = p0?.orgName || '';
    rerankResult = p0?.interviewResult || '';
    legacyFirst = s?.firstChoiceOrg || '';
    // The org that was rank #2 (name2) must now be rank #1 with result passed.
    audit.recordCell({
      id: 'ORGHUB-rerank-keeps-result',
      tableRef: 'OrgHub re-rank + Save — interviewResult bound to the org',
      expected: `after marking #2 'עבר' and moving it up, the DB pref #1 is that org (${O2}) with interviewResult 'passed', and firstChoiceOrg synced to it`,
      observed: `movedOrg="${name2}", pref1.org="${rerankOrg}", pref1.result="${rerankResult}", firstChoiceOrg="${legacyFirst}"`,
      pass: seedOk ? (rerankOrg === O2 && rerankResult === 'passed' && legacyFirst === O2) : null,
      notes: rerankResult !== 'passed' ? 'The interview result detached from its org on re-rank — the exact bug the data model prevents.'
        : rerankOrg !== O2 ? 'Re-rank did not move the org to #1.'
        : legacyFirst !== O2 ? 'Legacy firstChoiceOrg not synced on Save (compat shim broken).' : '',
    });
  }
  audit.recordCell({
    id: 'ORGHUB-union-cards',
    tableRef: 'OrgHub — prefs ∪ legacy choices as cards (no build step)',
    expected: 'a student with three legacy choices and zero built preferences shows THREE org cards, the third included',
    observed: `opened=${openedA}, cards=${cardCount}, thirdShown=${thirdShown}`,
    pass: seedOk ? (openedA && cardCount === 3 && thirdShown) : null,
    notes: cardCount !== 3 ? `Expected 3 cards, saw ${cardCount} — the union (prefs ∪ legacy) did not surface every chosen org.` : '',
  });
}

// ── Student B: add an org, then tick send → WhatsApp → the preference takes a place ─
let sendStatus = '', sendSlot = '', addOrgWorked = false;
if (seedOk) {
  const openedB = await openEditor(B_NAME);
  if (openedB) {
    await audit.page.waitForSelector('[data-org-card]', { timeout: 4000 }).catch(() => {});
    // ADD an org outside the chosen list (absorbs old cell 13's "הוסף לשליחה"):
    // ➕ → type a 4th org → הוסף → a 4th card appears.
    const before = await audit.page.locator('[data-org-card]').count();
    await audit.page.locator('[data-add-org]').first().click().catch(() => {});
    await audit.page.waitForTimeout(200);
    await audit.page.locator('[data-add-input]').first().fill(`ארגון-ד ${ts}`).catch(() => {});
    await audit.page.locator('[data-add-confirm]').first().click().catch(() => {});
    await audit.page.waitForTimeout(400);
    const afterAdd = await audit.page.locator('[data-org-card]').count();
    addOrgWorked = afterAdd === before + 1;
    audit.recordCell({
      id: 'ORGHUB-add-org',
      tableRef: 'OrgHub ➕ הוסף ארגון לדירוג — add an org to the ranking',
      expected: 'clicking ➕, typing an org name and confirming adds one ranked card',
      observed: `before=${before}, afterAdd=${afterAdd}`,
      pass: seedOk ? addOrgWorked : null,
      notes: !addOrgWorked ? 'Add-org did not create a new card — the הוסף button/flow is broken.' : '',
    });

    await audit.page.waitForSelector('[data-send-cv="0"]', { timeout: 4000 }).catch(() => {});
    await audit.page.locator('[data-send-cv="0"]').first().click().catch(() => {}); // select card 0
    await audit.page.waitForTimeout(250);
    await audit.page.locator('[data-send-selected]').first().click().catch(() => {}); // open channel sheet
    await audit.page.waitForTimeout(300);
    // WhatsApp opens a popup — swallow it so the click resolves.
    audit.page.context().on('page', p => p.close().catch(() => {}));
    await audit.page.locator('[data-dispatch="whatsapp"]').first().click().catch(() => {});
    for (let i = 0; i < 16; i++) {
      const s = (await loadData()).students?.find(x => x.id === B_ID);
      const p = (s?.preferences || []).find(x => x.status === 'under_review');
      if (p) { sendStatus = p.status; sendSlot = p.slotId || ''; break; }
      await audit.page.waitForTimeout(400);
    }
  }
  audit.recordCell({
    id: 'ORGHUB-send-takes-place',
    tableRef: 'OrgHub send (checkbox → WhatsApp) — takes a real place',
    expected: 'ticking a card and sending via WhatsApp moves that preference to under_review holding a slot',
    observed: `opened=${openedB}, status="${sendStatus}", slot="${sendSlot ? 'held' : 'none'}"`,
    pass: seedOk ? (openedB && sendStatus === 'under_review' && !!sendSlot) : null,
    notes: !sendStatus ? 'Send did not persist an under_review preference — the checkbox→send→WhatsApp flow is broken.'
      : !sendSlot ? 'Under_review but no slot held — the place was not taken.' : '',
  });
}

const shot = await audit.shot('orghub-cards');
audit.cells.forEach(c => { if (!c.after) c.after = shot; });

// Cleanup (CAS retry)
let cleaned = false;
for (let i = 0; i < 6 && !cleaned; i++) {
  try {
    const row = await readRow();
    const d = row.data;
    cleaned = await writeData({
      ...d,
      students: (d.students || []).filter(s => s.id !== A_ID && s.id !== B_ID),
      employers: (d.employers || []).filter(e => !String(e.id).startsWith(`${A_ID}-`)),
    }, row.version);
  } catch (e) { audit.log(`cleanup ${i} failed: ${e.message.slice(0, 80)}`); }
}
audit.log(cleaned ? 'Cleanup: removed 2 temp students + 3 employers' : '⚠ Cleanup FAILED.');

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

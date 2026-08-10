#!/usr/bin/env node
/**
 * 67-employer-response.mjs — the employer answers through the link (routes א + ג).
 *
 * Yariv 2026-08-10: "הוא מזמין לראיון ואחרי ראיון הוא לוחץ על הקישור. הבעיה היא שזה
 * לעיתים לוקח חודש וחצי." So the answer is not one step, and the page must ask only the
 * question that fits where the process has reached.
 *
 *   RESP-link-in-message     A send composes a /r?t=<dispatchId> link, and the id it
 *                            carries is the id of the dispatch actually recorded.
 *   RESP-asks-about-interview  Before any interview, the page offers to invite — never
 *                            "was she accepted?".
 *   RESP-invite-records      Choosing "אשמח לזמן לראיון" records the date and keeps the place.
 *   RESP-asks-decision-after Once the interview date has passed, the page asks what was decided.
 *   RESP-accepted-places     "מתקבל/ת" places the student and takes the place.
 *   RESP-bad-token           A junk token shows an error rather than anything actionable.
 *
 * Seeds its own student + employer and removes them, including its dispatches.
 */
import { Audit, sbQuery, BASE_URL } from '../audit-lib.mjs';

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
const STU_ID = `zer-${ts.toString(36).slice(-5)}`, STU_NAME = `תשובת מעסיק ${ts}`;
const EMP_ID = `${STU_ID}-e1`, ORG = `ארגון-תשובה ${ts}`;
const DISP_ID = `${STU_ID}-d1`;
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

/** Seed a student whose CV is already out, with a dispatch we know the id of. */
const seed = async (over = {}) => {
  for (let i = 0; i < 6; i++) {
    try {
      const row = await readRow(); const d = row.data;
      const courseId = ((d.courses || []).find(c => c?.type === 'practicum') || (d.courses || [])[0])?.id || '';
      const emp = { id: EMP_ID, name: ORG, approvalStatus: 'approved', contactStatus: 'approved',
        addedBy: 'admin', restrictedToStudentId: null, courseIds: [courseId], positionsTotal: 1, positions: 1,
        notes: 'audit', contactPhone: '0500000000', contactEmail: 'a@b.local', contactPerson: 'איש קשר בדיקה',
        vacancySlots: [{ id: `${EMP_ID}-s1`, courseId, status: 'under_review', studentId: STU_ID, prefRank: 1, history: [] }] };
      const stu = { id: STU_ID, name: STU_NAME, email: `${STU_ID}@audit.local`, courseId,
        cvUrl: 'storage://candidate-uploads/x.pdf', cvUpdatedUrl: 'storage://candidate-uploads/x-updated.pdf',
        submissionStatus: 'submitted', preparation: { passed: true }, firstChoiceOrg: ORG,
        preferences: [{ rank: 1, orgName: ORG, employerId: EMP_ID, status: 'under_review', slotId: `${EMP_ID}-s1`, interviewResult: 'pending' }],
        ...over };
      const disp = { id: DISP_ID, studentId: STU_ID, employerId: EMP_ID, slotId: `${EMP_ID}-s1`,
        channel: 'email', sentBy: 'audit', sentAt: new Date(Date.now() - 20 * 86400000).toISOString(),
        messageSnapshot: 'audit', result: 'pending', resultAt: null, resultBy: null };
      const ok = await writeData({
        ...d,
        students: [...(d.students || []).filter(s => s.id !== STU_ID), stu],
        employers: [...(d.employers || []).filter(e => e.id !== EMP_ID), emp],
        dispatches: [...(d.dispatches || []).filter(x => x.id !== DISP_ID), disp],
      }, row.version);
      if (ok) return courseId;
    } catch { /* retry */ }
  }
  return null;
};

const courseId = await seed();
const audit = new Audit({ name: 'employer-response' });
await audit.setup();

const stateOf = async () => {
  const d = await loadData();
  const s = (d.students || []).find(x => x.id === STU_ID);
  const e = (d.employers || []).find(x => x.id === EMP_ID);
  return {
    prefStatus: ((s?.preferences || []).find(p => p.orgName === ORG) || {}).status || '(none)',
    slotStatus: ((e?.vacancySlots) || [])[0]?.status || '(none)',
    interviewDate: s?.placementInterviewDate || '',
    acceptedOrg: s?.acceptedOrg || '',
    dispatchResult: (d.dispatches || []).find(x => x.id === DISP_ID)?.result || '(none)',
  };
};

const openLink = async (t) => {
  await audit.page.goto(`${BASE_URL}/r?t=${encodeURIComponent(t)}`, { waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(1400);
  return audit.page.evaluate(() => ({
    stage: document.querySelector('[data-response-stage]')?.getAttribute('data-response-stage') || null,
    answers: [...document.querySelectorAll('[data-answer]')].map(b => b.getAttribute('data-answer')),
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 120),
  }));
};

if (!courseId) {
  audit.recordCell({ id: 'RESP-seed', expected: 'seed', observed: 'failed', pass: null });
} else {
  // the link must carry the id of the dispatch that was actually recorded
  const d0 = await loadData();
  const disp = (d0.dispatches || []).find(x => x.id === DISP_ID);
  audit.recordCell({ id: 'RESP-link-in-message', tableRef: 'the link identifies one send',
    expected: 'a dispatch id exists and addresses one student × one employer',
    observed: disp ? `${disp.id} → ${disp.studentId} / ${disp.employerId}` : 'no dispatch',
    pass: !!disp && disp.studentId === STU_ID && disp.employerId === EMP_ID });

  // stage 1 — before any interview
  const s1 = await openLink(DISP_ID);
  audit.recordCell({ id: 'RESP-asks-about-interview', tableRef: 'stage 1 — never ask about a decision yet',
    expected: 'offers to invite / still reviewing / not suitable — and NOT accepted',
    observed: `${s1.stage} · ${s1.answers.join(',')}`,
    pass: s1.stage === 'awaiting_reply' && s1.answers.includes('invite') && !s1.answers.includes('accepted') });

  // accepting the invitation records the date and must not disturb the place
  const before = await stateOf();
  await audit.page.evaluate((d) => {
    const input = document.querySelector('input[type="date"]');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, d);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, iso(6));
  await audit.page.waitForTimeout(250);
  await audit.page.locator('[data-answer="invite"]').first().click().catch(() => {});
  await audit.page.waitForTimeout(2200);
  let after = await stateOf();
  for (let i = 0; i < 12 && !after.interviewDate; i++) { await audit.page.waitForTimeout(500); after = await stateOf(); }
  audit.recordCell({ id: 'RESP-invite-records', tableRef: 'stage 1 → 2',
    expected: 'the interview date is recorded and the place is untouched',
    observed: `date=${after.interviewDate || '(none)'}, slot ${before.slotStatus}→${after.slotStatus}`,
    pass: after.interviewDate === iso(6) && after.slotStatus === 'under_review' });

  // stage 3 — with the interview in the past, the question changes
  await seed({ placementInterviewDate: iso(-3), placementInterviewOrg: ORG });
  const s3 = await openLink(DISP_ID);
  audit.recordCell({ id: 'RESP-asks-decision-after', tableRef: 'stage 3 — only now ask what was decided',
    expected: 'offers accepted / not accepted',
    observed: `${s3.stage} · ${s3.answers.join(',')}`,
    pass: s3.stage === 'awaiting_decision' && s3.answers.includes('accepted') && s3.answers.includes('not_accepted') });

  await audit.page.locator('[data-answer="accepted"]').first().click().catch(() => {});
  await audit.page.waitForTimeout(2200);
  let acc = await stateOf();
  for (let i = 0; i < 12 && !acc.acceptedOrg; i++) { await audit.page.waitForTimeout(500); acc = await stateOf(); }
  audit.recordCell({ id: 'RESP-accepted-places', tableRef: 'the employer said yes',
    expected: 'the student is placed, the place is taken, the send is resolved',
    observed: `acceptedOrg=${acc.acceptedOrg || '(none)'}, slot=${acc.slotStatus}, dispatch=${acc.dispatchResult}`,
    pass: acc.acceptedOrg === ORG && acc.slotStatus === 'placed' && acc.dispatchResult === 'placed' });

  // a junk token must not offer anything
  const bad = await openLink('not-a-real-token');
  audit.recordCell({ id: 'RESP-bad-token', tableRef: 'a wrong link is inert',
    expected: 'an error, and no answer buttons',
    observed: `${bad.answers.length} buttons · ${bad.text.slice(0, 50)}`,
    pass: bad.answers.length === 0 });

  // The employer has NO login — and every cell above ran in the audit context, which
  // carries an injected session. A page that quietly depended on it would pass all of
  // them and still be unusable by the only people who will ever open it. Fresh context
  // = no session, which is what actually arrives from an email client.
  await seed();
  const anon = await audit.browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(`${BASE_URL}/r?t=${DISP_ID}`, { waitUntil: 'networkidle' });
  await anonPage.waitForTimeout(1500);
  const seen = await anonPage.evaluate(() => ({
    stage: document.querySelector('[data-response-stage]')?.getAttribute('data-response-stage') || null,
    answers: [...document.querySelectorAll('[data-answer]')].map(b => b.getAttribute('data-answer')).length,
    sessionKeys: Object.keys(localStorage).filter(k => /supabase|auth|sb-/i.test(k)).length,
  }));
  await anon.close();
  audit.recordCell({ id: 'RESP-works-logged-out', tableRef: 'employers have no account',
    expected: 'the question renders with no session at all',
    observed: `stage=${seen.stage}, ${seen.answers} buttons, sessionKeys=${seen.sessionKeys}`,
    pass: seen.stage === 'awaiting_reply' && seen.answers === 3 && seen.sessionKeys === 0 });
}

// cleanup — student, employer and every dispatch of theirs
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

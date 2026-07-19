#!/usr/bin/env node
/**
 * 43-hold-race.mjs — two students click for the SAME last place at the same
 * instant. Exactly one may end up holding it, and the one who was told "success"
 * must be the one actually holding it.
 *
 *   HOLD-race-one-winner  Two real browser pages, one free place, simultaneous
 *                         «בקש/י מקום» clicks. Asserts: exactly ONE holder in the
 *                         database, and the student whose page reported success is
 *                         that holder.
 *
 * Why this shape: the caller used to read → compute the hold → hand a PRE-COMPUTED
 * blob to saveSnapshot. The compare-and-swap only guarded the window INSIDE
 * saveSnapshot, so a loser that lost the CAS replayed a blob computed before the
 * race and replaced the whole employers array — erasing the winner's reservation
 * while BOTH students were told it worked. Yariv's rule: a place is only ever
 * released by the student holding it. requestOrg now passes a MUTATOR, which is
 * recomputed against fresh cloud state on every attempt and declines cleanly.
 *
 * NOTE: a sequential "stale page" test does NOT prove this — the old code also
 * re-read at click time and refused. Only genuinely concurrent clicks enter the
 * read→write window, which is why this cell drives two pages in parallel.
 */
import { Audit } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json' };

const read = async () => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/practicum_data?org_id=eq.default&select=data,version`, { headers: H });
  return (await r.json())[0];
};
const write = async (data, version) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/practicum_data?org_id=eq.default&version=eq.${version}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ data, version: version + 1, updated_at: new Date().toISOString() }),
  });
  const j = await r.json().catch(() => null);
  return Array.isArray(j) && j.length > 0;
};

const ts = Date.now();
const tag = ts.toString(36).slice(-5);
const EID = `zrace-emp-${tag}`, ORG = `ארגון מרוץ ${ts}`, SLOT = `${EID}-slot-1`;
const A = { id: `zrace-a-${tag}`, mail: `race-a-${ts}@audit.local`, name: `מרוץ א ${ts}` };
const B = { id: `zrace-b-${tag}`, mail: `race-b-${ts}@audit.local`, name: `מרוץ ב ${ts}` };

let seedOk = false;
try {
  const row = await read();
  const d = row.data;
  const COURSE = ((d.courses || []).find(c => c?.type === 'practicum') || (d.courses || [])[0])?.id || '';
  const emp = {
    id: EID, name: ORG, courseIds: [COURSE], notes: 'תיאור לבדיקת מרוץ', contactStatus: 'approved',
    contactEmail: 'race@audit.local', positions: 1, positionsTotal: 1, filledPositions: 0,
    vacancySlots: [{ id: SLOT, courseId: COURSE, status: 'available', studentId: null, history: [] }],
  };
  await write({
    ...d,
    employers: [...(d.employers || []), emp],
    students: [...(d.students || []),
      { id: A.id, name: A.name, email: A.mail, courseId: COURSE },
      { id: B.id, name: B.name, email: B.mail, courseId: COURSE }],
  }, row.version);
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

const audit = new Audit({ name: 'hold-race' });
await audit.setup();

/** Open the public page as one student and return { page, button }. */
async function openAs(stu) {
  const page = await audit.ctx.newPage();
  await page.goto(`${audit.baseUrl}/organizations?email=${encodeURIComponent(stu.mail)}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const card = page.locator(`[data-org-name="${ORG}"]`).locator('xpath=ancestor::div[3]');
  const button = card.locator('button').filter({ hasText: 'בקש/י מקום' }).first();
  return { page, button, ready: await button.count() > 0 };
}
/** success | error | none, as the student sees it. */
async function outcome(page) {
  const t = await page.evaluate(() => document.body.innerText);
  if (/בקשתך ל.*נשלחה/.test(t)) return 'success';
  if (/אין כרגע מקום פנוי|נכשל|נסה\/י שוב|כבר יש לך בקשה|לא נמצא|עדכן באותו רגע/.test(t)) return 'error';
  return 'none';
}

let bothReady = false, outA = 'n/a', outB = 'n/a', holder = null, holders = -1, consistent = null;
if (seedOk) {
  const a = await openAs(A);
  const b = await openAs(B);
  bothReady = a.ready && b.ready;
  if (bothReady) {
    // THE RACE: fire both clicks together so they enter the read→write window.
    await Promise.all([
      a.button.click({ timeout: 10000 }).catch(() => {}),
      b.button.click({ timeout: 10000 }).catch(() => {}),
    ]);
    await a.page.waitForTimeout(4500);
    outA = await outcome(a.page);
    outB = await outcome(b.page);

    const after = (await read()).data;
    const slots = ((after.employers || []).find(e => e.id === EID)?.vacancySlots || []);
    const taken = slots.filter(s => s.studentId);
    holders = taken.length;
    holder = taken[0]?.studentId || null;
    // The student told "success" MUST be the one holding it.
    const claimed = outA === 'success' ? A.id : outB === 'success' ? B.id : null;
    consistent = holders === 1 && claimed !== null && holder === claimed
      && !(outA === 'success' && outB === 'success');
  }
  await a.page.close().catch(() => {});
  await b.page.close().catch(() => {});
}

audit.recordCell({
  id: 'HOLD-race-one-winner',
  tableRef: 'OrganizationsPage.requestOrg / atomic hold under concurrent clicks',
  expected: 'exactly ONE holder in the DB, and the student who saw "success" is that holder (never two successes, never a silently erased hold)',
  observed: seedOk
    ? `bothReady=${bothReady}, A=${outA}, B=${outB}, holdersInDb=${holders}, holder=${holder === A.id ? 'A' : holder === B.id ? 'B' : holder}`
    : 'seed failed',
  pass: seedOk ? (bothReady === true && consistent === true) : null,
  notes: !bothReady ? 'Both pages must show the request button — otherwise no race happened and this proves nothing.'
    : holders > 1 ? 'OVER-SUBSCRIBED: more than one student holds the single place.'
    : (outA === 'success' && outB === 'success') ? 'LOST UPDATE: both students were told success but only one place exists — one reservation was erased.'
    : consistent === false ? 'The student told "success" is NOT the one holding the place.' : '',
});

// ── Cleanup ─────────────────────────────────────────────────────────────────
try {
  const row = await read();
  const d = row.data;
  await write({
    ...d,
    employers: (d.employers || []).filter(e => e.id !== EID),
    students: (d.students || []).filter(s => s.id !== A.id && s.id !== B.id),
  }, row.version);
  audit.log('Cleanup: removed temp employer + 2 students');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

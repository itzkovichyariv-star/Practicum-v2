#!/usr/bin/env node
/**
 * 43-hold-race.mjs — two students edit their request lists at the same instant.
 *
 * RE-POINTED 2026-07-20 for the 3-request INTENT model. A request no longer takes a
 * place, so the old race (two students grabbing the same last place) cannot happen at
 * request time — that contention moved to when the COORDINATOR sends a CV, where a
 * full org is refused. What still matters, and still needs two real browsers, is the
 * LOST UPDATE the mutator prevents: two concurrent writes to the students array must
 * BOTH survive.
 *
 *   HOLD-race-no-lost-update  Two real browser pages, simultaneous «בקש/י מקום»
 *                             clicks on the same org. Asserts: both succeed, NOBODY
 *                             holds the place (0 reservations), and both students'
 *                             request lists are intact afterwards.
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
  if (/נרשמה בקשתך/.test(t)) return 'success';
  if (/נכשל|נסה\/י שוב|לא נמצא|עדכן באותו רגע|הגעת ל|כבר שובצת/.test(t)) return 'error';
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
    // A request now reserves NOTHING, so NOBODY may hold the place afterwards.
    holders = slots.filter(s => s.studentId).length;
    holder = null;
    // The contention moved from the vacancy to the students array: two concurrent
    // list edits must BOTH survive. A lost update here means one student's request
    // was silently erased by the other's write — the same class of bug fix ③ closed,
    // which is why this cell keeps its two-real-browser shape.
    const reqOf = (id) => {
      const s = (after.students || []).find(x => x.id === id) || {};
      return [s.firstChoiceOrg, s.secondChoiceOrg, s.thirdChoiceOrg].filter(Boolean);
    };
    const aKept = reqOf(A.id).some(n => n === ORG);
    const bKept = reqOf(B.id).some(n => n === ORG);
    consistent = holders === 0
      && outA === 'success' && outB === 'success'   // no place to contend for
      && aKept && bKept;                             // neither write erased the other
  }
  await a.page.close().catch(() => {});
  await b.page.close().catch(() => {});
}

audit.recordCell({
  id: 'HOLD-race-no-lost-update',
  tableRef: 'OrganizationsPage.toggleRequest / atomic mutator under concurrent clicks',
  expected: 'a request reserves nothing, so BOTH students succeed and NOBODY holds the place — and both request lists survive (neither concurrent write erased the other)',
  observed: seedOk
    ? `bothReady=${bothReady}, A=${outA}, B=${outB}, holdersInDb=${holders} (want 0), bothListsKept=${consistent}`
    : 'seed failed',
  pass: seedOk ? (bothReady === true && consistent === true) : null,
  notes: !bothReady ? 'Both pages must show the request button — otherwise no race happened and this proves nothing.'
    : holders > 0 ? 'A request RESERVED a place — requests must be intent only (see cell 49).'
    : (outA !== 'success' || outB !== 'success') ? 'A student was refused; with no place at stake both requests must succeed.'
    : consistent === false ? 'LOST UPDATE: one student\'s request list was erased by the other\'s concurrent write.' : '',
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

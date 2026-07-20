#!/usr/bin/env node
/**
 * 49-student-three-requests.mjs — a student request is INTENT, never a reservation.
 *
 * Yariv 2026-07-20: "אפשר לבקש שלושה כאשר הרכזת תווסת… אם היא שלחה יותר מדי למקום
 * כלשהו היא לא תוכל לשלוח לאותו מקום אם עברה את המכסה אבל ניתן לבקש."
 *
 *   REQ-holds-nothing     Three requests change NOT ONE vacancy slot. This is the
 *                         whole point: the old model flipped a slot to `tentative`
 *                         per request, so 11 students × 3 demanded 33 places against
 *                         21 real ones. A place is consumed only when the coordinator
 *                         sends the CV.
 *   REQ-cap-three         A 4th request is refused with a specific reason.
 *   REQ-full-org-allowed  An organization with ZERO free places is still requestable
 *                         ("אבל ניתן לבקש") — the quota constrains SENDING, not asking.
 *   REQ-remove-frees-slot Removing a request re-opens a slot in the list (and still
 *                         touches no vacancy).
 *   REQ-suggested-keeps-1 A self-suggested org holds rank #1 and is not consumed by
 *                         the list, so such a student may add only 2 more.
 *   REQ-not-after-placed  Once placed, the list is settled — requests are refused.
 *
 * Runs the REAL src/lib/placement.ts through esbuild (same approach as cell 44), so
 * it tests shipped logic rather than a re-implementation. Touches no database.
 */
import { Audit } from '../audit-lib.mjs';
import esbuild from 'esbuild';

const audit = new Audit({ name: 'student-three-requests' });

// ── Bundle the real library ─────────────────────────────────────────────────
const built = await esbuild.build({
  entryPoints: ['src/lib/placement.ts'],
  bundle: true, format: 'esm', write: false, platform: 'neutral', logLevel: 'silent',
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const { studentSetRequests, MAX_STUDENT_REQUESTS } = mod;

// ── Fixture: one student, four orgs (one of them FULL) ──────────────────────
const COURSE = 'c-test';
const slot = (id, status = 'available', studentId = null) => ({ id, courseId: COURSE, status, studentId, prefRank: null, history: [] });
const emp = (id, name, slots) => ({ id, name, approvalStatus: 'approved', courseIds: [COURSE], positionsTotal: slots.length, vacancySlots: slots });

const baseData = () => ({
  courses: [{ id: COURSE, name: 'פרקטיקום בדיקה', year: 'תשפ״ז', type: 'practicum' }],
  students: [{ id: 's1', name: 'סטודנט', email: 'stu@test.local', courseId: COURSE, preferences: [] }],
  employers: [
    emp('e1', 'ארגון א', [slot('e1-s1')]),
    emp('e2', 'ארגון ב', [slot('e2-s1')]),
    emp('e3', 'ארגון ג', [slot('e3-s1')]),
    emp('e4', 'ארגון מלא', [slot('e4-s1', 'placed', 'other-student')]), // ZERO free
  ],
});
const countFree = (d) => d.employers.reduce((n, e) => n + e.vacancySlots.filter(s => s.status === 'available').length, 0);
const slotSig = (d) => JSON.stringify(d.employers.map(e => e.vacancySlots.map(s => `${s.status}:${s.studentId || '-'}`)));
const reqOf = (d) => { const s = d.students[0]; return [s.firstChoiceOrg, s.secondChoiceOrg, s.thirdChoiceOrg].filter(Boolean); };

const add = (d, empId) => studentSetRequests(d, 'stu@test.local', empId, 'add');
const rm = (d, empId) => studentSetRequests(d, 'stu@test.local', empId, 'remove');

// ── REQ-holds-nothing + REQ-cap-three ───────────────────────────────────────
{
  let d = baseData();
  const freeBefore = countFree(d), sigBefore = slotSig(d);
  const r1 = add(d, 'e1'); d = r1.ok ? r1.data : d;
  const r2 = add(d, 'e2'); d = r2.ok ? r2.data : d;
  const r3 = add(d, 'e3'); d = r3.ok ? r3.data : d;
  const freeAfter = countFree(d), sigAfter = slotSig(d);
  const requests = reqOf(d);
  const allOk = r1.ok && r2.ok && r3.ok;

  audit.recordCell({
    id: 'REQ-holds-nothing',
    tableRef: 'studentSetRequests — a request reserves NOTHING',
    expected: 'after three requests every vacancy is byte-identical and all 3 places remain free; the requests are recorded as the ordered choice fields',
    observed: `ok=${allOk}, freePlaces ${freeBefore}→${freeAfter}, slotsUnchanged=${sigBefore === sigAfter}, requests=[${requests.join(' | ')}]`,
    pass: allOk && freeBefore === freeAfter && sigBefore === sigAfter && requests.length === 3,
    notes: sigBefore !== sigAfter ? 'A vacancy changed — requests must never touch the ledger.' : '',
  });

  const r4 = add(d, 'e4');
  audit.recordCell({
    id: 'REQ-cap-three',
    tableRef: `studentSetRequests — cap of ${MAX_STUDENT_REQUESTS}`,
    expected: 'a 4th request is refused with a reason naming the cap',
    observed: `ok=${r4.ok}, error="${r4.error || ''}", stillThree=${reqOf(r4.ok ? r4.data : d).length === 3}`,
    pass: !r4.ok && /הגעת ל/.test(r4.error || ''),
    notes: r4.ok ? 'A 4th request was accepted — the cap is not enforced.' : '',
  });

  // Removing one frees a place in the LIST (not in the ledger) and lets another in.
  const rr = rm(d, 'e2');
  const after = rr.ok ? rr.data : d;
  const r5 = rr.ok ? add(after, 'e4') : { ok: false, error: 'remove failed' };
  audit.recordCell({
    id: 'REQ-remove-frees-slot',
    tableRef: 'studentSetRequests remove → re-rank',
    expected: 'removing a request drops it, closes the rank gap, and allows a new request in its place — with the vacancy ledger still untouched',
    observed: `removeOk=${rr.ok}, after=[${reqOf(after).join(' | ')}], readdOk=${r5.ok}, slotsUnchanged=${slotSig(after) === sigBefore}`,
    pass: rr.ok && !reqOf(after).some(n => n === 'ארגון ב') && r5.ok && slotSig(after) === sigBefore,
    notes: '',
  });
}

// ── REQ-full-org-allowed ────────────────────────────────────────────────────
{
  const d = baseData();
  const r = add(d, 'e4'); // e4 has zero free places
  audit.recordCell({
    id: 'REQ-full-org-allowed',
    tableRef: 'studentSetRequests — a FULL organization is still requestable',
    expected: 'requesting an org with 0 free places SUCCEEDS (the quota constrains the coordinator sending a CV, not the student asking)',
    observed: `ok=${r.ok}, error="${r.error || ''}"`,
    pass: r.ok === true,
    notes: !r.ok ? 'A full org was refused — this is the old reserve-on-request rule.' : '',
  });
}

// ── REQ-suggested-keeps-1 ───────────────────────────────────────────────────
{
  const d = baseData();
  // A private org the student proposed themselves → always rank #1.
  d.employers.push({ ...emp('e9', 'הארגון שהצעתי', [slot('e9-s1')]), restrictedToStudentId: 's1' });
  d.students[0].firstChoiceOrg = 'הארגון שהצעתי';

  let cur = d;
  const a1 = add(cur, 'e1'); cur = a1.ok ? a1.data : cur;
  const a2 = add(cur, 'e2'); cur = a2.ok ? a2.data : cur;
  const a3 = add(cur, 'e3'); // should be refused — suggestion occupies rank #1
  const ranks = [cur.students[0].firstChoiceOrg, cur.students[0].secondChoiceOrg, cur.students[0].thirdChoiceOrg];
  const selfReq = add(cur, 'e9'); // cannot toggle your own suggestion

  audit.recordCell({
    id: 'REQ-suggested-keeps-1',
    tableRef: 'studentSetRequests — a self-suggested org holds rank #1',
    expected: 'the suggested org stays first choice, only 2 further requests are allowed, and the suggestion itself cannot be toggled',
    observed: `rank1="${ranks[0]}", ranks=[${ranks.filter(Boolean).join(' | ')}], thirdRefused=${!a3.ok}, selfToggleRefused=${!selfReq.ok}`,
    pass: ranks[0] === 'הארגון שהצעתי' && a1.ok && a2.ok && !a3.ok && !selfReq.ok,
    notes: ranks[0] !== 'הארגון שהצעתי' ? 'The suggested org lost rank #1.' : '',
  });
}

// ── REQ-not-after-placed ────────────────────────────────────────────────────
{
  const d = baseData();
  d.students[0].acceptedOrg = 'ארגון א';
  const r = add(d, 'e2');
  audit.recordCell({
    id: 'REQ-not-after-placed',
    tableRef: 'studentSetRequests — settled once placed',
    expected: 'a placed student cannot change their requests (only the coordinator moves them)',
    observed: `ok=${r.ok}, error="${r.error || ''}"`,
    pass: !r.ok && /כבר שובצת/.test(r.error || ''),
    notes: '',
  });
}

// Pure-library cell: no browser, so no audit.setup()/report dir (same as cell 44) —
// the recorded cells above are logged to stdout and the exit code is the gate signal.
const failed = audit.cells.some((c) => c.pass === false);
console.log(`\n${failed ? '❌' : '✅'} student-three-requests: ${audit.cells.filter(c => c.pass === true).length}/${audit.cells.length} pass`);
process.exit(failed ? 1 : 0);

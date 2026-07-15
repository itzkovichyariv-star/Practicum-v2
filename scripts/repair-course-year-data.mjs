#!/usr/bin/env node
/**
 * repair-course-year-data.mjs — one-time data hygiene for the (course × year) audit
 * (docs/2026-07-15-course-year-audit.md, item M6 + data section).
 *
 * DRY-RUN by default (prints what it WOULD do, writes nothing). Pass --apply to write.
 *
 *   (1) Frees dangling-FK occupied slots — vacancy slots whose studentId resolves to
 *       NO student (held by already-deleted students). Flips them to 'available'.
 *   (2) Deletes synthetic test students (id/name matching /audit/).
 *   (3) Places accepted-elsewhere students into their org's ledger [Yariv's choice (a),
 *       2026-07-15]: for a student whose acceptedOrg names a REAL employer that has no
 *       slot for them, attach the student's OWN course to that employer and add a
 *       'placed' slot. (External free-text acceptedOrg like צה״ל is left alone.)
 *
 * Usage:
 *   node scripts/repair-course-year-data.mjs            # dry run
 *   node scripts/repair-course-year-data.mjs --apply    # write to prod
 */
const URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const K = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };
const APPLY = process.argv.includes('--apply');

const d = (await (await fetch(`${URL}/rest/v1/practicum_data?select=data&org_id=eq.default`, { headers: H })).json())[0].data;
const now = new Date().toISOString();
const reconcile = (e) => { const occ = (e.vacancySlots || []).filter(s => s.status !== 'available').length; return { ...e, positionsTotal: (e.vacancySlots || []).length, positions: (e.vacancySlots || []).length, filledPositions: occ }; };

// (2) delete synthetic test students first (so later steps see the real roster)
const isTest = s => /audit/i.test(String(s.id)) || /audit/i.test(String(s.name || ''));
const testStudents = (d.students || []).filter(isTest);
const students = (d.students || []).filter(s => !isTest(s));
const studentIds = new Set(students.map(s => String(s.id)));
const studentById = new Map(students.map(s => [String(s.id), s]));

// (1) free dangling-FK occupied slots — only touch employers that actually have one
const dangling = [];
let employers = (d.employers || []).map(e => {
  let touched = false;
  const slots = (e.vacancySlots || []).map(s => {
    if (s.studentId && s.status !== 'available' && !studentIds.has(String(s.studentId))) {
      touched = true;
      dangling.push({ emp: e.name, course: s.courseId, status: s.status, sid: s.studentId });
      return { ...s, status: 'available', studentId: null, prefRank: null, history: [...(s.history || []), { at: now, from: s.status, to: 'available', by: 'admin', actorId: 'cleanup-dangling-fk', reason: 'dangling-fk' }] };
    }
    return s;
  });
  return touched ? reconcile({ ...e, vacancySlots: slots }) : e;
});

// (3) place accepted-elsewhere students (option a) — attach their course + a placed slot
const placements = [];
employers = employers.map(e => {
  const toPlace = students.filter(s => s.acceptedOrg === e.name && s.courseId
    && !(e.vacancySlots || []).some(sl => String(sl.studentId) === String(s.id)));
  if (!toPlace.length) return e;
  const courseIds = Array.from(new Set([...(e.courseIds || []), ...toPlace.map(s => s.courseId)]));
  const newSlots = toPlace.map(s => {
    placements.push({ emp: e.name, student: s.name, course: s.courseId });
    return { id: `${e.id}-${s.courseId}-p${s.id}`, courseId: s.courseId, status: 'placed', studentId: s.id, prefRank: null, history: [{ at: now, from: null, to: 'placed', by: 'admin', actorId: 'reconcile-acceptedOrg', reason: 'acceptedOrg-place' }] };
  });
  return reconcile({ ...e, courseIds, vacancySlots: [...(e.vacancySlots || []), ...newSlots] });
});

console.log(`=== repair-course-year-data ${APPLY ? '(APPLYING)' : '(DRY RUN — no writes)'} ===`);
console.log(`(1) dangling-FK slots to free: ${dangling.length}`);
dangling.forEach(x => console.log(`    - ${x.emp} | ${x.course} | ${x.status} | sid=${x.sid}`));
console.log(`(2) synthetic test students to delete: ${testStudents.length}  ${testStudents.map(s => s.id + '/' + s.name).join(', ')}`);
console.log(`(3) accepted-elsewhere students to PLACE (attach course + placed slot): ${placements.length}`);
placements.forEach(x => console.log(`    - ${x.student} → ${x.emp} · ${x.course}`));

if (APPLY) {
  const r = await fetch(`${URL}/rest/v1/practicum_data?org_id=eq.default`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ data: { ...d, employers, students } }) });
  console.log(`\nPATCH ${r.ok ? 'OK ✓ — data cleaned + placements applied' : 'FAILED ' + r.status + ' ' + (await r.text().catch(() => ''))}`);
} else {
  console.log('\n(dry run) re-run with --apply to write these changes to prod.');
}

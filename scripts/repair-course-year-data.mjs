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
 *   (3) REPORTS ONLY (never changes): students whose acceptedOrg names an employer that
 *       has no slot for them AND isn't attached to their course — a real "who accepted
 *       them?" question for Yariv, not pure corruption.
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
const studentIds = new Set((d.students || []).map(s => String(s.id)));
const now = new Date().toISOString();

// (1) free dangling-FK occupied slots — only touch employers that actually have one
const dangling = [];
const employers = (d.employers || []).map(e => {
  let touched = false;
  const slots = (e.vacancySlots || []).map(s => {
    if (s.studentId && s.status !== 'available' && !studentIds.has(String(s.studentId))) {
      touched = true;
      dangling.push({ emp: e.name, course: s.courseId, status: s.status, sid: s.studentId });
      return { ...s, status: 'available', studentId: null, prefRank: null, history: [...(s.history || []), { at: now, from: s.status, to: 'available', by: 'admin', actorId: 'cleanup-dangling-fk', reason: 'dangling-fk' }] };
    }
    return s;
  });
  if (!touched) return e; // untouched employers unchanged (surgical)
  const occ = slots.filter(s => s.status !== 'available').length;
  return { ...e, vacancySlots: slots, positionsTotal: slots.length, positions: slots.length, filledPositions: occ };
});

// (2) delete synthetic test students
const isTest = s => /audit/i.test(String(s.id)) || /audit/i.test(String(s.name || ''));
const testStudents = (d.students || []).filter(isTest);
const nextStudents = (d.students || []).filter(s => !isTest(s));

// (3) report acceptedOrg mismatches (never changed here)
const empByName = new Map((d.employers || []).map(e => [e.name, e]));
const mism = (d.students || []).filter(s => {
  if (!s.acceptedOrg) return false;
  const e = empByName.get(s.acceptedOrg);
  if (!e) return false; // external org — legitimate
  const hasSlot = (e.vacancySlots || []).some(sl => sl.studentId === s.id);
  const courseMatch = (e.courseIds || []).includes(s.courseId);
  return !hasSlot && !courseMatch;
});

console.log(`=== repair-course-year-data ${APPLY ? '(APPLYING)' : '(DRY RUN — no writes)'} ===`);
console.log(`(1) dangling-FK slots to free: ${dangling.length}`);
dangling.forEach(x => console.log(`    - ${x.emp} | ${x.course} | ${x.status} | sid=${x.sid}`));
console.log(`(2) synthetic test students to delete: ${testStudents.length}  ${testStudents.map(s => s.id + '/' + s.name).join(', ')}`);
console.log(`(3) acceptedOrg↔course MISMATCH (NOT changed — your call): ${mism.length}`);
mism.forEach(x => console.log(`    - ${x.name} (course ${x.courseId}) → acceptedOrg="${x.acceptedOrg}"  [either attach a matching course+slot to that employer, or fix acceptedOrg]`));

if (APPLY) {
  const r = await fetch(`${URL}/rest/v1/practicum_data?org_id=eq.default`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ data: { ...d, employers, students: nextStudents } }) });
  console.log(`\nPATCH ${r.ok ? 'OK ✓ — data cleaned' : 'FAILED ' + r.status + ' ' + (await r.text().catch(() => ''))}`);
} else {
  console.log('\n(dry run) re-run with --apply to write these changes to prod.');
}

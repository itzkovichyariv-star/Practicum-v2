#!/usr/bin/env node
/**
 * link-org-course.mjs — is this organization actually offered to this course, and if not, why not?
 *
 * Written for one concrete question (Yariv 2026-10-07): "תוודא שהקורס של פסגות מקושר ואם לא
 * תקשר אותו ורק אותו". The /ma form offers an organization only when FOUR things hold, and
 * three of them are invisible from the employers screen at a glance:
 *
 *   1. the course id is in the org's `courseIds`
 *   2. `notes` is non-empty            ← orgAvailability: no description ⇒ not available
 *   3. at least one `vacancySlots` entry for THAT course has status 'available'
 *   4. `approvalStatus` is not 'rejected' and not 'pending'
 *
 * So this prints all four, then fixes only what you ask for. A silent "the org does not
 * appear" has four different causes and they are not interchangeable.
 *
 * Usage (dry run first — it writes nothing without --apply):
 *   node scripts/link-org-course.mjs
 *   node scripts/link-org-course.mjs --course "פרקטיקום תואר שני" --year תשפ״ז
 *   node scripts/link-org-course.mjs --course c-ma --apply            # link the course, nothing else
 *   node scripts/link-org-course.mjs --course c-ma --places 8 --apply # link AND set 8 places
 *
 *   --org <name|id>     which organization (default: פסגות)
 *   --course <name|id>  which course row; with --year when a name repeats across years
 *   --places <n>        set that course's capacity to n (only when passed)
 *   --apply             write (compare-and-swap on `version`, exactly like saveSnapshot)
 *   --file <snap.json>  work against a local snapshot instead of prod. With --apply it writes
 *                       the RESULT to <snap.json>.next.json and never touches prod — which is
 *                       how the write path itself gets tested before it runs for real.
 *
 * It touches ONE organization and nothing else in the blob.
 */

import { readFileSync, writeFileSync } from 'node:fs';

// Same project + publishable key the app and every sibling script use; RLS gates access.
const SB_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const APPLY = argv.includes('--apply');
const ORG = flag('org', 'פסגות');
const COURSE = flag('course');
const YEAR = flag('year');
const PLACES = flag('places') != null ? Number(flag('places')) : null;
const FILE = flag('file');
if (PLACES != null && (!Number.isInteger(PLACES) || PLACES < 0)) {
  console.error('--places must be a non-negative whole number'); process.exit(2);
}

const normYear = (y) => String(y || '').replace(/["״'׳\s]/g, '').trim();
const eq = (a, b) => String(a || '').trim() === String(b || '').trim();

let row;
if (FILE) {
  const j = JSON.parse(readFileSync(FILE, 'utf8'));
  row = Array.isArray(j) ? j[0] : j.data ? j : { data: j, version: 0 };
} else {
  const res = await fetch(`${SB_URL}/rest/v1/practicum_data?org_id=eq.default&select=data,version`, { headers: H });
  if (!res.ok) { console.error(`read failed ${res.status}: ${await res.text().catch(() => '')}`); process.exit(1); }
  row = (await res.json())[0];
}
if (!row) { console.error('no practicum_data row for org_id=default'); process.exit(1); }
const d = row.data || {};
const employers = d.employers || [];
const courses = d.courses || [];
const students = d.students || [];

/* ── the organization ──────────────────────────────────────────────────── */
const orgMatches = employers.filter((e) => eq(e.id, ORG) || eq(e.name, ORG));
if (!orgMatches.length) {
  console.error(`no organization matches "${ORG}". Names containing it:`);
  for (const e of employers.filter((e) => String(e.name || '').includes(ORG))) console.error(`  · ${e.name} [${e.id}]`);
  process.exit(1);
}
if (orgMatches.length > 1) {
  console.error(`"${ORG}" matches ${orgMatches.length} organizations — pass --org <id>:`);
  for (const e of orgMatches) console.error(`  · ${e.name} [${e.id}]`);
  process.exit(1);
}
const org = orgMatches[0];

/* ── the course row ────────────────────────────────────────────────────── */
// A "course" here is one ROW = course-name × year, which is how the whole app scopes.
const practicums = courses.filter((c) => !c.type || c.type === 'practicum');
let course = null;
if (COURSE) {
  const hits = courses.filter((c) =>
    (eq(c.id, COURSE) || eq(c.name, COURSE)) && (!YEAR || normYear(c.year) === normYear(YEAR)));
  if (!hits.length) {
    console.error(`no course matches --course "${COURSE}"${YEAR ? ` --year ${YEAR}` : ''}. Courses on record:`);
    for (const c of courses) console.error(`  · ${c.name} · ${c.year || '—'} [${c.id}]`);
    process.exit(1);
  }
  if (hits.length > 1) {
    console.error(`"${COURSE}" matches ${hits.length} course rows — add --year, or pass the id:`);
    for (const c of hits) console.error(`  · ${c.name} · ${c.year || '—'} [${c.id}]`);
    process.exit(1);
  }
  course = hits[0];
}

console.log(`=== link-org-course ${APPLY ? '(APPLYING)' : '(DRY RUN — nothing written)'} ===`);
console.log(`organization: ${org.name} [${org.id}]`);

const linked = org.courseIds || (org.courseId ? [org.courseId] : []);
console.log(`\ncurrently linked to ${linked.length} course row(s):`);
for (const id of linked) {
  const c = courses.find((x) => x.id === id);
  console.log(`  · ${c ? `${c.name} · ${c.year || '—'}` : '(unknown course)'} [${id}]`);
}
if (!linked.length) console.log('  (none)');

if (!course) {
  console.log(`\npractpicum course rows on record — pick one with --course <id>:`.replace('practpicum', 'practicum'));
  for (const c of practicums) {
    const n = students.filter((s) => s.courseId === c.id).length;
    const mark = linked.includes(c.id) ? '✓ linked' : '  not linked';
    console.log(`  ${mark}  ${c.name} · ${c.year || '—'}  [${c.id}]  ${n} students`);
  }
  console.log('\nNo --course given, so nothing to check or change. Re-run with --course <id>.');
  process.exit(0);
}

/* ── the four conditions, one line each ────────────────────────────────── */
const slots = (org.vacancySlots || []).filter((s) => s.courseId === course.id);
const available = slots.filter((s) => s.status === 'available').length;
const hasDesc = !!String(org.notes || '').trim();
const status = org.approvalStatus || 'approved';
const isLinked = linked.includes(course.id);
const cohort = students.filter((s) => s.courseId === course.id);

console.log(`\ncourse: ${course.name} · ${course.year || '—'} [${course.id}] · ${cohort.length} students`);
console.log('\nwhat the student form requires:');
console.log(`  ${isLinked ? '✓' : '✗'} course linked to the organization`);
console.log(`  ${hasDesc ? '✓' : '✗'} description (notes) — without it orgAvailability reports "לא זמין"`);
console.log(`  ${available > 0 ? '✓' : '✗'} an available place for THIS course — ${slots.length} slot(s) total, ${available} available`);
console.log(`  ${status !== 'rejected' && status !== 'pending' ? '✓' : '✗'} approvalStatus = ${status}`);
const offered = isLinked && hasDesc && available > 0 && status !== 'rejected' && status !== 'pending';
console.log(`\n⇒ the form ${offered ? 'WILL' : 'will NOT'} offer ${org.name} to a student of this course.`);

/* ── the change ────────────────────────────────────────────────────────── */
const willLink = !isLinked;
const willPlaces = PLACES != null && PLACES !== slots.length;
if (!willLink && !willPlaces) {
  console.log('\nnothing to change.');
  if (!offered) console.log('(Still not offered — fix the ✗ lines above; a description is edited in the employers screen.)');
  process.exit(0);
}

console.log('\nplanned change — this organization only:');
if (willLink) console.log(`  + courseIds: add ${course.id}  (${linked.length} → ${linked.length + 1})`);
if (willPlaces) console.log(`  + vacancySlots for this course: ${slots.length} → ${PLACES} (free slots only; an occupied slot is never removed)`);

if (!APPLY) { console.log('\nDRY RUN — pass --apply to write.'); process.exit(0); }

const nextOrg = { ...org };
if (willLink) {
  nextOrg.courseIds = [...linked, course.id];
  delete nextOrg.courseId; // superseded by courseIds; leaving both invites two answers
}
if (willPlaces) {
  const mine = (org.vacancySlots || []).filter((s) => s.courseId === course.id);
  const others = (org.vacancySlots || []).filter((s) => s.courseId !== course.id);
  const taken = mine.filter((s) => s.status !== 'available');
  if (PLACES < taken.length) {
    console.error(`\n❌ ${taken.length} place(s) are already taken by a student; cannot reduce to ${PLACES}.`);
    process.exit(1);
  }
  const free = mine.filter((s) => s.status === 'available');
  const keepFree = free.slice(0, Math.max(0, PLACES - taken.length));
  const add = Math.max(0, PLACES - taken.length - keepFree.length);
  const minted = Array.from({ length: add }, (_, i) => ({
    id: `v-${course.id}-${Date.now()}-${i}`,
    courseId: course.id,
    status: 'available',
    history: [{ at: new Date().toISOString(), from: null, to: 'available', by: 'admin', reason: 'link-org-course.mjs' }],
  }));
  nextOrg.vacancySlots = [...others, ...taken, ...keepFree, ...minted];
}

const next = { ...d, employers: employers.map((e) => (e.id === org.id ? nextOrg : e)) };

if (FILE) {
  // A local run writes the RESULT beside the input and stops. Prod is never reached from
  // here, and the mutation above is exercised rather than merely described.
  const out = `${FILE}.next.json`;
  writeFileSync(out, JSON.stringify({ version: row.version + 1, data: next }, null, 2));
  console.log(`\n✅ local run — result written to ${out} (prod untouched).`);
  process.exit(0);
}

// CAS on `version`, exactly like saveSnapshot: a write that skips the bump is silently
// overwritten by any open browser tab.
const r = await fetch(`${SB_URL}/rest/v1/practicum_data?org_id=eq.default&version=eq.${row.version}`, {
  method: 'PATCH',
  headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({ data: next, version: row.version + 1, updated_at: new Date().toISOString() }),
});
const j = await r.json().catch(() => null);
if (!r.ok) { console.log(`\n❌ PATCH failed ${r.status}: ${JSON.stringify(j).slice(0, 300)}`); process.exit(1); }
if (!Array.isArray(j) || !j.length) { console.log('\n❌ CAS lost — someone saved in between. Re-run.'); process.exit(1); }
console.log(`\n✅ written — version ${row.version} → ${row.version + 1}`);
console.log('Re-run without --apply to confirm the four conditions now read ✓.');

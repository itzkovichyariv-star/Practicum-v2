/**
 * Copy תשפ״ו lectures → תשפ״ז as tentative (טנטטיבי).
 * Rules (approved by Yariv 2026-07-08):
 *   • skip cancelled (בוטל)
 *   • shift dates +364 days (52 weeks) — preserves weekday
 *   • keep the same course; only the copy's `year` becomes תשפ״ז
 *     (exception: hr-practicum → hr-practicum-tashpaz, the real תשפ״ז course)
 *   • new id per copy; graphEventId cleared (must not reuse the Outlook event)
 *
 * Usage:  node copy-lectures.mjs            → DRY RUN (prints, writes nothing)
 *         node copy-lectures.mjs --apply    → applies (pre-change snapshot + CAS write)
 */
const SB = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const KEY = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const APPLY = process.argv.includes('--apply');

const SRC_YEAR = 'תשפ״ו';
const DST_YEAR = 'תשפ״ז';
const TENTATIVE = 'טנטטיבי';
const CANCELLED = 'בוטל';
const COURSE_MAP = { 'hr-practicum': 'hr-practicum-tashpaz', 'counseling-practicum-tashpav': 'counseling-practicum-tashpaz' };

const norm = (y) => (y || '').replace(/["״'']/g, '').trim();
const shift364 = (iso) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + 364);
  return d.toISOString().slice(0, 10);
};
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const dayName = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) ? DAYS[new Date(iso + 'T00:00:00Z').getUTCDay()] : '—';

async function readRow() {
  const r = await fetch(`${SB}/rest/v1/practicum_data?org_id=eq.default&select=data,version`, { headers: H });
  const j = await r.json();
  return j[0];
}

const row = await readRow();
const data = row.data;
const version = row.version;
const lectures = data.lectures || [];
const courses = data.courses || [];
const courseName = (id) => (courses.find(c => c.id === id) || {}).name || id;

// ── Select sources ──────────────────────────────────────────────────────────
const sources = lectures.filter(l => norm(l.year) === norm(SRC_YEAR) && l.status !== CANCELLED);
const skippedCancelled = lectures.filter(l => norm(l.year) === norm(SRC_YEAR) && l.status === CANCELLED);

// Guard: don't double-copy if תשפ״ז tentative lectures already exist.
const already = lectures.filter(l => norm(l.year) === norm(DST_YEAR));

// ── Build copies ────────────────────────────────────────────────────────────
let seq = 0;
const stamp = Date.now().toString(36);
const copies = sources.map(l => {
  const { graphEventId, ...rest } = l; // drop the Outlook event link
  return {
    ...rest,
    id: `lec-${DST_YEAR.replace(/["״]/g, '')}-${stamp}-${++seq}`,
    courseId: COURSE_MAP[l.courseId] || l.courseId,
    year: DST_YEAR,
    date: shift364(l.date),
    status: TENTATIVE,
  };
});

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`MODE: ${APPLY ? '*** APPLY ***' : 'DRY RUN (no writes)'}`);
console.log(`current version: ${version} | total lectures now: ${lectures.length}`);
console.log(`sources (${SRC_YEAR}, not ${CANCELLED}): ${sources.length}`);
console.log(`skipped cancelled: ${skippedCancelled.length}`);
console.log(`already in ${DST_YEAR}: ${already.length}${already.length ? '  ⚠ (possible re-run)' : ''}`);
console.log(`copies to create: ${copies.length}\n`);

const byCourse = {};
copies.forEach((c, i) => { const k = c.courseId; (byCourse[k] = byCourse[k] || []).push([sources[i], c]); });
for (const [cid, pairs] of Object.entries(byCourse)) {
  console.log(`── ${courseName(cid)}  [${cid}]  (${pairs.length}) ──`);
  pairs.forEach(([src, cp]) => {
    console.log(`   ${src.date} (${dayName(src.date)}) → ${cp.date} (${dayName(cp.date)})  ${cp.startTime || ''}-${cp.endTime || ''}  | ${src.status} → ${cp.status} | ${(cp.title || cp.topic || '').slice(0, 38)}`);
  });
  console.log('');
}
if (skippedCancelled.length) {
  console.log('── skipped (בוטל) ──');
  skippedCancelled.forEach(l => console.log(`   ${l.date}  ${(l.title || l.topic || '').slice(0, 38)}  [${courseName(l.courseId)}]`));
  console.log('');
}

if (!APPLY) {
  console.log('DRY RUN complete — nothing written. Re-run with --apply to write.');
  process.exit(0);
}

if (already.length > 0) {
  console.log(`ABORT: ${already.length} lectures already exist in ${DST_YEAR}. Refusing to duplicate.`);
  process.exit(1);
}

// ── Apply: pre-change snapshot, then CAS write ──────────────────────────────
const snapRes = await fetch(`${SB}/rest/v1/practicum_snapshots`, {
  method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
  body: JSON.stringify({
    editor_name: 'יריב', action: 'לפני העתקת הרצאות לתשפ״ז', entity: 'הרצאות',
    target: `${copies.length} הרצאות`, version, data,
  }),
});
console.log(`pre-change snapshot insert: HTTP ${snapRes.status}`);

const nextData = { ...data, lectures: [...lectures, ...copies] };
const now = new Date().toISOString();
const upd = await fetch(`${SB}/rest/v1/practicum_data?org_id=eq.default&version=eq.${version}`, {
  method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({ data: nextData, updated_at: now, last_editor_name: 'יריב', version: version + 1 }),
});
const updRows = await upd.json();
if (!Array.isArray(updRows) || updRows.length === 0) {
  console.log('ABORT: CAS write matched 0 rows (someone else wrote meanwhile). Nothing changed. Re-run.');
  process.exit(1);
}
console.log(`write OK → version ${version} → ${version + 1}`);

// ── Verify by read-back ─────────────────────────────────────────────────────
const after = await readRow();
const afterLec = after.data.lectures || [];
const tentative = afterLec.filter(l => norm(l.year) === norm(DST_YEAR) && l.status === TENTATIVE);
console.log(`verify: total lectures ${lectures.length} → ${afterLec.length}; ${DST_YEAR} tentative = ${tentative.length}`);
console.log(tentative.length === copies.length ? '✅ VERIFIED' : '⚠ MISMATCH');

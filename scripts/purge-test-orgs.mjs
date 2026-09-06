#!/usr/bin/env node
/**
 * purge-test-orgs.mjs — remove the audit fixture organizations the screen refuses to delete.
 *
 * Why the screen refuses. EmployersPage.handleDelete counts the org's tentative /
 * under_review / placed slots and, when any exist, offers ONLY "archive as 🔴 נדחה" — there
 * is no hard delete behind that dialog. The audit cells mint orgs such as
 * "ארגון מוצע ישיר 1786371974607" (cell 46) together with a fixture student who takes a
 * tentative or placed slot there. Once that student is purged, the slot dangles: it still
 * counts as occupied, so the org can never be deleted from the UI, and pressing "אישור" in
 * the dialog paints it red instead. Only a direct write removes it — this script.
 *
 * What counts as a fixture org (ALL verified against real references before removal):
 *   • id minted by a cell: `audit-*`, `z<stamp>-e1`, `zoc-emp-*`, `zdv-emp-*`
 *   • a 13-digit epoch stamp in the NAME ("ארגון קשר 1786371974607") — real organizations
 *     are called "Codeoasis" and "TLVtech", never that
 *   • a contact address at @audit.local
 *   • anything passed with --also <id-or-exact-name> (for a hand-made test org)
 * An org that a REAL student still references (acceptedOrg, a choice, a preference) is
 * reported and left alone — deleting it would orphan the student's record.
 *
 * Also swept, because they die with the org: fixture students (@audit.local / stamped
 * name), dispatches and approval requests pointing at removed orgs or missing students.
 *
 * Usage:
 *   node scripts/purge-test-orgs.mjs                    # dry run against prod
 *   node scripts/purge-test-orgs.mjs --apply            # write (CAS on `version`, like saveSnapshot)
 *   node scripts/purge-test-orgs.mjs --file snap.json   # dry run against a local snapshot
 *   node scripts/purge-test-orgs.mjs --also "ארגון בדיקה" --also emp-xyz
 */
import { readFileSync } from 'node:fs';

// Same project + publishable key the app and every sibling script use; RLS gates access.
const SB_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const fileIdx = argv.indexOf('--file');
const FILE = fileIdx >= 0 ? argv[fileIdx + 1] : null;
const ALSO = new Set(argv.flatMap((a, i) => (a === '--also' && argv[i + 1] ? [argv[i + 1].trim()] : [])));
if (APPLY && FILE) {
  console.error('--apply and --file do not mix: a local file is never written back to prod.');
  process.exit(2);
}

let row;
if (FILE) {
  const j = JSON.parse(readFileSync(FILE, 'utf8'));
  row = Array.isArray(j) ? j[0] : j.data ? j : { data: j, version: 0 };
} else {
  const res = await fetch(`${SB_URL}/rest/v1/practicum_data?org_id=eq.default&select=data,version`, { headers: H });
  if (!res.ok) { console.error(`read failed ${res.status}: ${await res.text().catch(() => '')}`); process.exit(1); }
  row = (await res.json())[0];
}
const d = row.data || {};
const students = d.students || [];
const employers = d.employers || [];

// ── fixture students: the markers purge-orphan-dispatches.mjs settled on (never "a
// timestamp in the id" — that once matched 16 real cp-tashpaz-* / s-rst-* students) ────
const isFixtureStudent = (s) => /@audit\.local$/i.test(s.email || '') || /\d{13}/.test(s.name || '');
const fixtureStudentIds = new Set(students.filter(isFixtureStudent).map((s) => s.id));
const realStudents = students.filter((s) => !isFixtureStudent(s));
const liveIds = new Set(students.map((s) => s.id));

// ── fixture orgs ───────────────────────────────────────────────────────────────────
const mintedId = (id) =>
  /^audit-/.test(id) || /^z[a-z]*-?[0-9a-z]{5}-e1$/.test(id) || /^z(oc|dv)-emp-\d{13}$/.test(id)
  || [...fixtureStudentIds].some((sid) => id.startsWith(sid));
const looksMinted = (e) =>
  mintedId(String(e.id || '')) || /\d{13}/.test(e.name || '') || /@audit\.local$/i.test(e.contactEmail || '')
  || ALSO.has(String(e.id)) || ALSO.has(String(e.name || '').trim());
const realRefs = (e) => realStudents.filter((s) =>
  [...(s.preferences || []).map((p) => p.employerId), ...(s.preferences || []).map((p) => p.orgName),
    s.firstChoiceOrg, s.secondChoiceOrg, s.thirdChoiceOrg, s.acceptedOrg, s.placementInterviewOrg]
    .filter(Boolean).some((r) => r === e.id || r === e.name));

const candidates = employers.filter(looksMinted);
const blocked = candidates.filter((e) => realRefs(e).length);
const toDelete = candidates.filter((e) => !realRefs(e).length);
const deleteIds = new Set(toDelete.map((e) => e.id));

// Why the UI could not delete each one — the exact guard handleDelete applies.
const whyStuck = (e) => {
  const occ = (e.vacancySlots || []).filter((s) => s.status !== 'available');
  if (!occ.length) return 'no occupied slot — deletable from the UI, simply never deleted';
  const held = occ.map((s) => {
    const st = students.find((x) => x.id === s.studentId);
    const who = st
      ? `${isFixtureStudent(st) ? 'fixture ' : ''}${st.name}`
      : `DANGLING (student ${s.studentId ?? '?'} no longer exists)`;
    return `${s.status}${s.courseId ? '@' + s.courseId : ''} → ${who}`;
  });
  return `${occ.length} occupied slot(s) block hard delete — the dialog only offers 🔴 archive: ${held.join(' · ')}`;
};

const unknownAlso = [...ALSO].filter((a) => !employers.some((e) => e.id === a || String(e.name || '').trim() === a));

const fixtureStudents = students.filter(isFixtureStudent);
const keepIds = new Set(realStudents.map((s) => s.id));
const dispatches = d.dispatches || [];
const keepDispatches = dispatches.filter((x) => !deleteIds.has(x.employerId) && keepIds.has(x.studentId));
const requests = d.employerApprovalRequests || [];
const dropRequest = (r) =>
  (r.resultingEmployerId && deleteIds.has(r.resultingEmployerId))
  || fixtureStudentIds.has(r.requesterStudentId)
  || (r.requesterStudentId && !liveIds.has(r.requesterStudentId));
const keepRequests = requests.filter((r) => !dropRequest(r));

console.log(`=== purge-test-orgs ${APPLY ? '(APPLYING)' : '(DRY RUN — nothing written)'} · source: ${FILE || 'prod'} ===`);
console.log(`employers: ${employers.length} total · ${candidates.length} look like fixtures · ${toDelete.length} will be removed · ${blocked.length} kept (referenced by a real student)\n`);
for (const e of toDelete) {
  const courses = (e.courseIds || (e.courseId ? [e.courseId] : [])).join(',') || '—';
  console.log(`  ✗ ${e.name}  [${e.id}]  courses=${courses}  approval=${e.approvalStatus ?? 'approved'}`);
  console.log(`      ${whyStuck(e)}`);
}
for (const e of blocked) {
  console.log(`  ⚠ KEPT ${e.name}  [${e.id}] — referenced by real student(s): ${realRefs(e).map((s) => s.name).join(', ')}. Detach them first, then re-run.`);
}
if (unknownAlso.length) console.log(`\n  ⚠ --also matched nothing: ${unknownAlso.join(', ')}`);
console.log(`\nfixture students to remove: ${fixtureStudents.length}${fixtureStudents.length ? ' — ' + fixtureStudents.map((s) => s.name).join(', ') : ''}`);
console.log(`dispatches: ${dispatches.length} → ${keepDispatches.length} (dropping ${dispatches.length - keepDispatches.length} that point at a removed org or a missing student)`);
console.log(`approval requests: ${requests.length} → ${keepRequests.length}`);

const nothing = !toDelete.length && !fixtureStudents.length
  && dispatches.length === keepDispatches.length && requests.length === keepRequests.length;
if (nothing) { console.log('\nnothing to do.'); process.exit(0); }
if (!APPLY) { console.log('\nDRY RUN — pass --apply to write.'); process.exit(0); }

const next = {
  ...d,
  employers: employers.filter((e) => !deleteIds.has(e.id)),
  students: realStudents,
  dispatches: keepDispatches,
  employerApprovalRequests: keepRequests,
};
// CAS on `version`, exactly like saveSnapshot: a write that skips the bump is silently
// overwritten by any open browser tab.
const r = await fetch(`${SB_URL}/rest/v1/practicum_data?org_id=eq.default&version=eq.${row.version}`, {
  method: 'PATCH',
  headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({ data: next, version: row.version + 1, updated_at: new Date().toISOString() }),
});
const j = await r.json().catch(() => null);
if (!r.ok) { console.log(`\n❌ PATCH failed ${r.status}: ${JSON.stringify(j).slice(0, 300)}`); process.exit(1); }
console.log(Array.isArray(j) && j.length
  ? `\n✅ removed ${toDelete.length} org(s) · ${fixtureStudents.length} fixture student(s) · ${dispatches.length - keepDispatches.length} dispatch(es) — version ${row.version} → ${row.version + 1}`
  : '\n❌ CAS lost — someone saved in between. Re-run.');

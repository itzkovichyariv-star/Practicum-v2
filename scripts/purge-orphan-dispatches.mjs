#!/usr/bin/env node
/**
 * purge-orphan-dispatches.mjs — remove dispatch rows whose student no longer exists.
 *
 * By 2026-08-10, 221 of 228 dispatch rows pointed at audit students that had been
 * deleted, 101 of them still 'pending'. They are invisible in the UI (every screen
 * looks the student up first) but they inflate every dispatch scan and would surface
 * in any future report. Cells 14/16/58/66/67 now clean up after themselves; this
 * clears what they left behind.
 *
 * Only a row whose studentId is absent from students[] is removed — a real send is
 * never touched. Run with --apply to write; default is a dry run.
 *
 * Writes bump `version` exactly like saveSnapshot does. A write that skips the bump
 * gets silently overwritten the next time an open browser tab saves (this happened on
 * 2026-08-09 and undid a release).
 */
const SB_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
const APPLY = process.argv.includes('--apply');

const row = (await (await fetch(`${SB_URL}/rest/v1/practicum_data?org_id=eq.default&select=data,version`, { headers: H })).json())[0];
const d = row.data;

// Fixture students are identified ONLY by the @audit.local address the cells mint.
// A looser guess ("the id ends in a timestamp") matched 16 REAL students — the
// cp-tashpaz-* course import and s-rst-* both carry timestamps in their ids.
const isFixtureStudent = (s) => /@audit\.local$/i.test(s.email || '');
const fixtureStudentIds = new Set((d.students || []).filter(isFixtureStudent).map(s => s.id));
const fixtureStudents = (d.students || []).filter(isFixtureStudent);

// A fixture employer is one a cell minted (its id starts with `audit-`, or with a
// fixture student's id) AND that no real student references — checked below, not assumed.
// Cells mint employer ids in several shapes, so match the id patterns AND the epoch
// stamp cells put in the name. Widening this is safe only because every removal is
// still gated on referencedByReal() below — a name-based guess alone is exactly what
// mis-classified 16 real STUDENTS earlier, and real organizations are called
// "Codeoasis" and "TLVtech", never "ארגון קשר 1786371974607".
const looksMinted = (e) => /^audit-/.test(e.id) || /\d{13}/.test(e.name || '')
  || [...fixtureStudentIds].some(i => e.id.startsWith(i));
const referencedByReal = (e) => (d.students || []).some(s => !isFixtureStudent(s) &&
  [...(s.preferences || []).map(p => p.employerId), ...(s.preferences || []).map(p => p.orgName),
   s.firstChoiceOrg, s.secondChoiceOrg, s.thirdChoiceOrg, s.acceptedOrg].filter(Boolean)
    .some(r => r === e.id || r === e.name));
const fixtureEmployers = (d.employers || []).filter(e => looksMinted(e) && !referencedByReal(e));

// Any fixture holding a place on a REAL employer would block a real placement — that is
// a bug, not clutter, so it is reported loudly rather than quietly swept up.
const fixtureEmpIds = new Set(fixtureEmployers.map(e => e.id));
const phantomHolds = (d.employers || []).filter(e => !fixtureEmpIds.has(e.id))
  .flatMap(e => (e.vacancySlots || []).filter(v => v.studentId && fixtureStudentIds.has(v.studentId)).map(v => `${e.name} · ${v.status}`));

const live = new Set((d.students || []).filter(s => !isFixtureStudent(s)).map(s => s.id));
const all = d.dispatches || [];
const keep = all.filter(x => live.has(x.studentId));
const drop = all.filter(x => !live.has(x.studentId));

console.log(`dispatches: ${all.length} total · ${keep.length} live · ${drop.length} orphaned`);
console.log(`orphans by result: ${JSON.stringify(drop.reduce((a, x) => ({ ...a, [x.result || 'pending']: (a[x.result || 'pending'] || 0) + 1 }), {}))}`);
console.log('\nkeeping:');
for (const x of keep) {
  const s = (d.students || []).find(y => y.id === x.studentId);
  const e = (d.employers || []).find(y => y.id === x.employerId);
  console.log(`  ${s?.name || x.studentId} → ${e?.name || x.employerId}  [${x.result || 'pending'}]  ${(x.sentAt || '').slice(0, 16)}`);
}

console.log(`\nfixture students (@audit.local): ${fixtureStudents.length} of ${(d.students || []).length}`);
fixtureStudents.forEach(s => console.log(`  ${s.name}`));
console.log(`fixture employers: ${fixtureEmployers.length} of ${(d.employers || []).length}`);
console.log(phantomHolds.length
  ? `\n⚠️  a fixture is holding a place on a REAL employer: ${phantomHolds.join(', ')}`
  : '\nno fixture holds a place on a real employer');

// Fixture org-suggestions surface in the banner at the top of the students page — the
// one piece of this residue Yariv actually sees. Anon cannot DELETE cv_updates under
// RLS, so they are suppressed the way the cells do it, via dismissedSuggestionIds.
// They are normally cleaned by the cell that seeded them; leftovers mean a run was
// interrupted before its cleanup (killing a gate mid-flight does exactly this).
const cvRows = await (await fetch(`${SB_URL}/rest/v1/cv_updates?select=id,email,suggested_org,seen_at,uploaded_at&order=uploaded_at.desc`, { headers: H })).json();
const latestByEmail = new Map();
for (const r of cvRows) {
  const k = (r.email || '').trim().toLowerCase();
  if (k && !latestByEmail.has(k)) latestByEmail.set(k, r);
}
const alreadyDismissed = new Set(d.dismissedSuggestionIds || []);
const strandedSuggestions = [...latestByEmail.values()].filter(r =>
  r.suggested_org?.name && !r.seen_at && !alreadyDismissed.has(r.id) && /@audit\.local$/i.test(r.email || ''));
console.log(`\nfixture suggestions still showing in the banner: ${strandedSuggestions.length}`);
strandedSuggestions.forEach(r => console.log(`  ${r.email}`));

if (!APPLY) { console.log('\nDRY RUN — pass --apply to write.'); process.exit(0); }

const r = await fetch(`${SB_URL}/rest/v1/practicum_data?org_id=eq.default&version=eq.${row.version}`, {
  method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({
    data: {
      ...d, dispatches: keep,
      students: (d.students || []).filter(s => !isFixtureStudent(s)),
      employers: (d.employers || []).filter(e => !fixtureEmpIds.has(e.id)),
      dismissedSuggestionIds: [...new Set([...(d.dismissedSuggestionIds || []), ...strandedSuggestions.map(r => r.id)])],
    },
    version: row.version + 1, updated_at: new Date().toISOString(),
  }),
});
const j = await r.json().catch(() => null);
console.log(Array.isArray(j) && j.length
  ? `\n✅ removed ${drop.length} dispatches · ${fixtureStudents.length} students · ${fixtureEmployers.length} employers — version ${row.version} → ${row.version + 1}`
  : `\n❌ CAS lost — someone else wrote first. Re-run.`);

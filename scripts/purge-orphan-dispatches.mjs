#!/usr/bin/env node
/**
 * purge-orphan-dispatches.mjs — remove what the audit suites left in Yariv's real data.
 *
 * Started as orphaned dispatch rows (221 of 228 on 2026-08-10) and grew as each new
 * hiding place turned up. It now covers, in the order they were found:
 *
 *   • dispatch rows whose student no longer exists   — invisible, but they inflate every scan
 *   • fixture students, employers, candidates        — 18 of 31 candidates were fixtures
 *   • fixture rows in candidate_submissions          — 56 of 85 in the inbox Yariv reads
 *   • fixture org-suggestions still in the banner    — suppressed, since anon cannot DELETE cv_updates
 *
 * Every removal is verified first, never guessed: no real send is touched, no fixture
 * holds a place on a real employer, and no real student references a fixture org. An
 * early attempt that identified fixtures by "a timestamp in the id" matched 16 REAL
 * students (cp-tashpaz-*, s-rst-*), which is why the markers here are @audit.local and a
 * 13-digit stamp in the NAME — checked against the live data before being widened.
 *
 * Run with --apply to write; the default is a dry run that prints what it would do.
 *
 * Writes to practicum_data bump `version` exactly like saveSnapshot does. A write that
 * skips the bump is silently overwritten by any open browser tab (this happened on
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
// @audit.local is the unambiguous marker, but two fixtures ("משוב יש/אין <stamp>") carry
// NO email at all — a 13-digit epoch in the NAME catches those. Verified safe before
// widening: no real person in this dataset has 4+ consecutive digits in their name, and
// the earlier trap was a timestamp in the ID (cp-tashpaz-*, s-rst-*), never the name.
const isFixtureStudent = (s) => /@audit\.local$/i.test(s.email || '') || /\d{13}/.test(s.name || '');
const isFixtureCandidate = (c) => /@audit\.local$/i.test(c.email || '') || /\d{13}/.test(c.name || '');
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

const fixtureCandidates = (d.candidates || []).filter(isFixtureCandidate);
console.log(`\nfixture candidates: ${fixtureCandidates.length} of ${(d.candidates || []).length}`);
fixtureCandidates.slice(0, 8).forEach(c => console.log(`  ${c.name}`));
if (fixtureCandidates.length > 8) console.log(`  … and ${fixtureCandidates.length - 8} more`);
console.log(`\nfixture students: ${fixtureStudents.length} of ${(d.students || []).length}`);
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

// The submissions inbox — the one Yariv actually looks at. 56 of 85 rows there were
// audit fixtures on 2026-08-11, because two cells wrote their cleanup filter as
// `%40audit.local`: %40 decodes to '@', so the intended wildcard disappeared and the
// delete matched nothing. Those cells are fixed; this clears what they left.
const subs = await (await fetch(`${SB_URL}/rest/v1/candidate_submissions?select=id,name,email&email=like.audit-*@audit.local`, { headers: H })).json();
console.log(`\nfixture submissions in the inbox: ${Array.isArray(subs) ? subs.length : 'could not read'}`);
if (Array.isArray(subs)) subs.slice(0, 5).forEach(x => console.log(`  ${x.name}`));

if (!APPLY) { console.log('\nDRY RUN — pass --apply to write.'); process.exit(0); }

const r = await fetch(`${SB_URL}/rest/v1/practicum_data?org_id=eq.default&version=eq.${row.version}`, {
  method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({
    data: {
      ...d, dispatches: keep,
      students: (d.students || []).filter(s => !isFixtureStudent(s)),
      candidates: (d.candidates || []).filter(c => !isFixtureCandidate(c)),
      employers: (d.employers || []).filter(e => !fixtureEmpIds.has(e.id)),
      dismissedSuggestionIds: [...new Set([...(d.dismissedSuggestionIds || []), ...strandedSuggestions.map(r => r.id)])],
    },
    version: row.version + 1, updated_at: new Date().toISOString(),
  }),
});
const j = await r.json().catch(() => null);
// the submission rows are their own table, so they need their own delete
if (Array.isArray(subs) && subs.length) {
  const r2 = await fetch(`${SB_URL}/rest/v1/candidate_submissions?email=like.audit-*@audit.local`, { method: 'DELETE', headers: H });
  console.log(r2.ok ? `✅ removed ${subs.length} fixture submission(s) from the inbox`
                    : `⚠️  could not remove submissions (${r2.status}) — anon may lack DELETE here`);
}

console.log(Array.isArray(j) && j.length
  ? `\n✅ removed ${drop.length} dispatches · ${fixtureStudents.length} students · ${fixtureEmployers.length} employers — version ${row.version} → ${row.version + 1}`
  : `\n❌ CAS lost — someone else wrote first. Re-run.`);

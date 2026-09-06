#!/usr/bin/env node
/**
 * red-orgs-vs-students.mjs — why does a 🔴 org in one (course × year) have students in it?
 *
 * Reported 2026-09-06: in משאבי אנוש · תשפ״ו, organizations such as אקיורט דאטה show the red
 * "נדחה" pill although students actually did their practicum there that year.
 *
 * The mechanism (src/lib/orgAvailability.ts, employerStatus):
 *   • red  ⇔  `employer.approvalStatus === 'rejected'`, and it is checked FIRST — before the
 *     year-scoped occupants, before the placed slots, before anything.
 *   • `approvalStatus` is ONE flag on the employer record. Capacity and occupancy are scoped
 *     per (course × year) through vacancySlots, but the flag is not — so a rejection recorded
 *     in ANY context paints EVERY year's row red, including a past year where the org hosted
 *     students.
 *   Three writers set the flag:
 *     (a) the 🔴 chip / quick toggle          → applyEmployerStatus, appends statusHistory
 *     (b) "🗑 מחק / ארכב" on an org WITH students → handleArchive, NO history entry
 *     (c) rejecting a student's org-approval request → handleDecision, NO history entry
 *   Path (b) is the sneaky one: the delete button on an org that has placed students cannot
 *   delete (it would orphan them), so its "אישור" button archives the org as נדחה instead.
 *   One attempt to tidy up last year's list turns a real host red retroactively.
 *
 * This script lists every red org in the chosen unit, cross-references it with the unit's
 * students (ledger slots, acceptedOrg exact + loose match, choices/preferences) and says
 * which writer most likely set the flag, from the evidence the record carries.
 *
 * Usage:
 *   node scripts/red-orgs-vs-students.mjs                              # משאבי אנוש · תשפ״ו against prod
 *   node scripts/red-orgs-vs-students.mjs --course "משאבי אנוש" --year תשפ״ז
 *   node scripts/red-orgs-vs-students.mjs --file snap.json             # offline, from a snapshot
 *   node scripts/red-orgs-vs-students.mjs --all                         # every org in the unit, not only red
 */
import { readFileSync } from 'node:fs';

const SB_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H = { apikey: ANON, Authorization: `Bearer ${ANON}` };

const argv = process.argv.slice(2);
const opt = (k, dflt) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const COURSE = opt('--course', 'משאבי אנוש');
const YEAR = opt('--year', 'תשפ״ו');
const FILE = opt('--file', null);
const ALL = argv.includes('--all');

// Mirrors src/lib/session.ts normalizeYear: whitespace → '-', every double-quote → ״.
const normalizeYear = (y) => (y ? String(y).trim().replace(/\s+/g, '-').replace(/["“”״]/g, '״') : '');
// Loose org-name key: lower-case, letters and digits only, then drop a trailing legal suffix
// (בע"מ / ltd / inc). `\b` is ASCII-only in JS, so the suffix is stripped from the key, not
// the raw string.
const loose = (s) => String(s || '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '')
  .replace(/(בעמ|ltd|inc)$/u, '');

let d;
if (FILE) {
  const j = JSON.parse(readFileSync(FILE, 'utf8'));
  d = Array.isArray(j) ? j[0].data : (j.data || j);
} else {
  const res = await fetch(`${SB_URL}/rest/v1/practicum_data?org_id=eq.default&select=data`, { headers: H });
  if (!res.ok) { console.error(`read failed ${res.status}: ${await res.text().catch(() => '')}`); process.exit(1); }
  d = (await res.json())[0].data;
}
const courses = d.courses || [];
const students = d.students || [];
const employers = d.employers || [];
const requests = d.employerApprovalRequests || [];
const empCourseIds = (e) => (e.courseIds && e.courseIds.length ? e.courseIds : e.courseId ? [e.courseId] : []);

// ── the (course × year) unit ────────────────────────────────────────────────────────
const unit = courses.filter((c) => c.id && String(c.name || '').includes(COURSE) && normalizeYear(c.year) === normalizeYear(YEAR));
if (!unit.length) {
  console.error(`no course named like "${COURSE}" in year ${YEAR}. Courses present:`);
  courses.forEach((c) => console.error(`  ${c.id}  ${c.name}  ${normalizeYear(c.year) || '—'}`));
  process.exit(1);
}
const unitIds = new Set(unit.map((c) => c.id));
const unitStudents = students.filter((s) => unitIds.has(s.courseId));
const byId = new Map(students.map((s) => [s.id, s]));

console.log(`=== ${COURSE} · ${normalizeYear(YEAR)} — ${unit.map((c) => c.id).join(', ')} · ${unitStudents.length} students · source: ${FILE || 'prod'} ===\n`);

// Orgs relevant to the unit: attached to it, OR hosting one of its students by any record.
const hosts = (e) => {
  const key = loose(e.name);
  const slots = (e.vacancySlots || []).filter((s) => unitIds.has(s.courseId) && s.status !== 'available');
  const ledger = slots.map((s) => ({ slot: s, student: byId.get(s.studentId) || null }));
  const exact = unitStudents.filter((s) => s.acceptedOrg === e.name);
  const looseHit = unitStudents.filter((s) => s.acceptedOrg && s.acceptedOrg !== e.name && loose(s.acceptedOrg) === key);
  const chose = unitStudents.filter((s) =>
    [s.firstChoiceOrg, s.secondChoiceOrg, s.thirdChoiceOrg, s.placementInterviewOrg,
      ...(s.preferences || []).map((p) => p.orgName), ...(s.preferences || []).map((p) => p.employerId)]
      .filter(Boolean).some((r) => r === e.name || r === e.id));
  return { ledger, exact, looseHit, chose };
};

const relevant = employers.filter((e) => {
  if (empCourseIds(e).some((id) => unitIds.has(id))) return true;
  const h = hosts(e);
  return h.ledger.length || h.exact.length || h.looseHit.length;
});
const red = relevant.filter((e) => e.approvalStatus === 'rejected');
const shown = ALL ? relevant : red;

console.log(`orgs in the unit: ${relevant.length} · 🔴 red (approvalStatus=rejected): ${red.length}\n`);

const writerGuess = (e, h) => {
  const hist = [...(e.statusHistory || [])].filter((x) => x.status === 'rejected');
  const last = hist[hist.length - 1];
  if (last) return `(a) marked 🔴 נדחה by hand on ${String(last.at).slice(0, 10)}${last.note ? ` — note: "${last.note}"` : ''}; the flag is global, so it also colours ${normalizeYear(YEAR)}.`;
  const req = requests.find((r) => r.status === 'rejected' && (r.resultingEmployerId === e.id || loose(r.draft?.name) === loose(e.name)));
  if (req) return `(c) a student's org-approval request for it was rejected on ${String(req.decidedAt || req.createdAt).slice(0, 10)} — that writes approvalStatus='rejected' on the employer itself.`;
  if (h.ledger.length || h.exact.length) return `(b) no statusHistory entry and it holds students → almost certainly "🗑 מחק / ארכב": the delete guard saw occupied slots and its "אישור" button ARCHIVED the org as נדחה (no hard delete exists for an org with students).`;
  return 'approvalStatus=rejected with no history and no students — set by a writer that leaves no trace (archive via delete, or an import).';
};

let redWithStudents = 0;
for (const e of shown) {
  const h = hosts(e);
  const hasStudents = h.ledger.length || h.exact.length || h.looseHit.length;
  if (e.approvalStatus === 'rejected' && hasStudents) redWithStudents++;
  const dot = e.approvalStatus === 'rejected' ? '🔴' : e.approvalStatus === 'pending' ? '🟠' : '⚪';
  console.log(`${dot} ${e.name}  [${e.id}]  approval=${e.approvalStatus ?? 'approved'}  contact=${e.contactStatus ?? '—'}  attached=${empCourseIds(e).filter((id) => unitIds.has(id)).length ? 'yes' : 'NO'}`);
  if (h.ledger.length) {
    console.log(`    ledger slots in ${normalizeYear(YEAR)}: ${h.ledger.map(({ slot, student }) => `${slot.status} → ${student ? student.name : `DANGLING ${slot.studentId}`}`).join(' · ')}`);
  }
  if (h.exact.length) console.log(`    students with acceptedOrg = "${e.name}": ${h.exact.map((s) => s.name).join(', ')}`);
  if (h.looseHit.length) console.log(`    students whose acceptedOrg is a spelling variant (not counted by the screen, which matches the exact name): ${h.looseHit.map((s) => `${s.name} ("${s.acceptedOrg}")`).join(', ')}`);
  if (h.chose.length) console.log(`    chosen / interviewed / preferred by: ${h.chose.map((s) => s.name).join(', ')}`);
  if (!hasStudents && !h.chose.length) console.log('    no student of this unit touches it');
  if (e.approvalStatus === 'rejected') console.log(`    why red → ${writerGuess(e, h)}`);
  console.log('');
}

// Students of the unit whose acceptedOrg matches no employer by exact name — they vanish
// from every org's "👤 hired" line even when the org exists under a variant spelling.
const names = new Set(employers.map((e) => e.name));
const byLoose = new Map(employers.map((e) => [loose(e.name), e]));
const unmatched = unitStudents.filter((s) => s.acceptedOrg && !names.has(s.acceptedOrg));
if (unmatched.length) {
  console.log(`students placed (acceptedOrg) at a name that is not an employer record — ${unmatched.length}:`);
  for (const s of unmatched) {
    const near = byLoose.get(loose(s.acceptedOrg));
    console.log(`  ${s.name} → "${s.acceptedOrg}"${near ? `  ≈ employer "${near.name}" [${near.id}] (spelling variant)` : '  (external / free text)'}`);
  }
  console.log('');
}

console.log(`summary: ${red.length} red org(s) in ${COURSE} · ${normalizeYear(YEAR)}; ${redWithStudents} of them hosted students of this unit.`);
if (redWithStudents) {
  console.log('root cause: approvalStatus is one global flag per employer, checked before the year-scoped occupants,');
  console.log('so a rejection (or an archive-via-delete) recorded for the current year colours past years red too.');
}

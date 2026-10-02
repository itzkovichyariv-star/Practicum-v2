#!/usr/bin/env node
/**
 * purge-audit-data.mjs — remove what the deploy gate's live audit cells left behind.
 *
 * Yariv 2026-10-02, after `npm run ship`: "delete all the fake events you added audit
 * events". The full gate's numbered cells read AND WRITE the live project; each is meant
 * to clean up after itself, but a cell that times out or dies leaves its seed behind —
 * test lectures ("מרצה בדיקה"), free interview slots, candidates, submissions — and they
 * show up on the calendar as if they were real.
 *
 * Every audit seed is recognisable by construction (see scripts/audit-lib.mjs and the
 * cells): an id or note that starts with "audit-", an e-mail at @audit.local, or a name
 * containing "בדיקה". Nothing else is touched.
 *
 *   node scripts/purge-audit-data.mjs           # DRY RUN — lists what it would delete
 *   node scripts/purge-audit-data.mjs --apply   # snapshot first, then delete
 *
 * Rollback: ניהול → גרסאות → the snapshot labelled "לפני ניקוי נתוני בדיקה".
 */

const SB = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const KEY = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const APPLY = process.argv.includes('--apply');

const isAuditId = (id) => /^audit/i.test(String(id || ''));
const isAuditMail = (m) => /@audit\.local$/i.test(String(m || ''));
const saysTest = (s) => /בדיקה/.test(String(s || ''));

const isAuditLecture = (l) =>
  isAuditId(l.id) || saysTest(l.lecturer) || isAuditMail(l.lecturerEmail)
  || /^[A-D] · /.test(String(l.topic || ''));          // lecture-time-check's "A · מ‑17 עד 20"
const isAuditPerson = (p) => isAuditId(p.id) || isAuditMail(p.email) || /בדיקה \d{6,}/.test(String(p.name || ''));
const isAuditEmployer = (e) => isAuditId(e.id) || isAuditMail(e.contactEmail) || /^audit/i.test(String(e.name || ''));

async function get(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

// ── 1. The practicum blob ─────────────────────────────────────────────────
const [row] = await get('practicum_data?org_id=eq.default&select=data,version');
const data = row.data || {};
const version = row.version;
const plan = {
  lectures: (data.lectures || []).filter(isAuditLecture),
  candidates: (data.candidates || []).filter(isAuditPerson),
  students: (data.students || []).filter(isAuditPerson),
  trainers: (data.trainers || []).filter(isAuditPerson),
  employers: (data.employers || []).filter(isAuditEmployer),
};

// ── 2. The public tables ──────────────────────────────────────────────────
const slots = (await get('public_interview_slots?select=id,date,start_time,note,course_name'))
  .filter((s) => isAuditId(s.id) || /^audit/i.test(String(s.note || '')));
let subs = [];
try {
  subs = (await get('candidate_submissions?select=id,name,email,created_at'))
    .filter((s) => isAuditMail(s.email) || /^audit/i.test(String(s.email || '')) || saysTest(s.name));
} catch (e) {
  console.log(`candidate_submissions not readable with the public key (${String(e.message).slice(0, 60)}) — skipped.`);
}

// ── Report ────────────────────────────────────────────────────────────────
console.log(`MODE: ${APPLY ? '*** APPLY ***' : 'DRY RUN (nothing is written)'} · data version ${version}\n`);
const show = (title, list, fmt) => {
  console.log(`── ${title}: ${list.length}`);
  list.forEach((x) => console.log(`   ${fmt(x)}`));
};
show('הרצאות', plan.lectures, (l) => `${l.date || '—'}  ${l.lecturer || ''} · ${l.topic || ''}  [${l.id}]`);
show('מועמדים', plan.candidates, (c) => `${c.name} <${c.email || ''}>  [${c.id}]`);
show('סטודנטים', plan.students, (s) => `${s.name} <${s.email || ''}>  [${s.id}]`);
show('מדריכים', plan.trainers, (t) => `${t.name}  [${t.id}]`);
show('ארגונים', plan.employers, (e) => `${e.name}  [${e.id}]`);
show('מועדי ראיון', slots, (s) => `${s.date} ${s.start_time}  ${s.note || ''}  [${s.id}]`);
show('הגשות מועמדים', subs, (s) => `${s.name} <${s.email || ''}>  [${s.id}]`);

const blobCount = Object.values(plan).reduce((n, l) => n + l.length, 0);
if (blobCount + slots.length + subs.length === 0) {
  console.log('\nNothing to clean — no audit leftovers found.');
  process.exit(0);
}
if (!APPLY) {
  console.log('\nDRY RUN complete. Check the list above, then re-run with --apply to delete exactly these.');
  process.exit(0);
}

// ── Apply: snapshot, CAS write, then the public tables ─────────────────────
if (blobCount > 0) {
  const snap = await fetch(`${SB}/rest/v1/practicum_snapshots`, {
    method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ editor_name: 'יריב', action: 'לפני ניקוי נתוני בדיקה', entity: 'נתוני בדיקה',
      target: `${blobCount} רשומות`, version, data }),
  });
  if (!snap.ok) { console.log(`ABORT: snapshot failed (HTTP ${snap.status}) — nothing deleted.`); process.exit(1); }
  console.log(`\nsnapshot saved (version ${version})`);

  const drop = (list, pred) => (list || []).filter((x) => !pred(x));
  const next = {
    ...data,
    lectures: drop(data.lectures, isAuditLecture),
    candidates: drop(data.candidates, isAuditPerson),
    students: drop(data.students, isAuditPerson),
    trainers: drop(data.trainers, isAuditPerson),
    employers: drop(data.employers, isAuditEmployer),
  };
  const upd = await fetch(`${SB}/rest/v1/practicum_data?org_id=eq.default&version=eq.${version}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ data: next, updated_at: new Date().toISOString(), last_editor_name: 'יריב', version: version + 1 }),
  });
  const rows = await upd.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('ABORT: someone saved meanwhile (version changed). Nothing deleted from the data — re-run.');
    process.exit(1);
  }
  console.log(`data: removed ${blobCount} records → version ${version + 1}`);
}
for (const s of slots) {
  const r = await fetch(`${SB}/rest/v1/public_interview_slots?id=eq.${encodeURIComponent(s.id)}`, { method: 'DELETE', headers: H });
  console.log(`slot ${s.id}: HTTP ${r.status}`);
}
for (const s of subs) {
  const r = await fetch(`${SB}/rest/v1/candidate_submissions?id=eq.${encodeURIComponent(s.id)}`, { method: 'DELETE', headers: H });
  console.log(`submission ${s.id}: HTTP ${r.status}`);
}
console.log('\nDone. Re-run without --apply to confirm nothing is left.');

#!/usr/bin/env node
/**
 * health-check.mjs — READ-ONLY integrity audit of the LIVE practicum data.
 *
 * The deploy gate proves the CODE behaves on synthetic fixtures. This proves the
 * REAL DATA is coherent under the rules that code now enforces — the two are not
 * the same thing, and a green gate has never implied healthy data.
 *
 *   node scripts/health-check.mjs            # all courses
 *   node scripts/health-check.mjs --course hr-practicum-tashpaz
 *   node scripts/health-check.mjs --json     # machine-readable
 *
 * Writes NOTHING. Safe to run against production at any time.
 *
 * Checks, grouped by the rule they defend:
 *   CV        every student carries a CV (Yariv: "אין מצב כזה אין קורות חיים —
 *             טופס שליחת בקשות מחייב העלאת קורות חיים")
 *   PREFS     preferences reference real employers; ranks are 1..N, no dupes
 *   SLOTS     no place is held by two students; held slots name their student;
 *             a placed preference points at a slot really placed for them
 *   PLACED    submissionStatus='placed' ⟺ acceptedOrg set ⟺ a placed slot held
 *   ORPHAN    a placed student still showing open candidacies elsewhere
 *   SCOPE     a student's slots belong to that student's own course
 *   CAPACITY  positionsTotal agrees with the vacancy ledger; demand vs places
 *   PRIVATE   a student-suggested (restricted) org points at a real student
 *   TESTDATA  leftover audit/preview rows left behind in production
 */

const SB = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';

const args = process.argv.slice(2);
const onlyCourse = args.includes('--course') ? args[args.indexOf('--course') + 1] : null;
const asJson = args.includes('--json');

const findings = [];
const add = (sev, group, msg, detail) => findings.push({ sev, group, msg, detail });

const data = await (async () => {
  const r = await fetch(`${SB}/rest/v1/practicum_data?org_id=eq.default&select=data,version`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  if (!r.ok) throw new Error(`read failed ${r.status}`);
  const row = (await r.json())[0];
  return { blob: row.data, version: row.version };
})();

const d = data.blob;
const courses = d.courses || [];
const allStudents = d.students || [];
const employers = d.employers || [];

const practicumCourseIds = new Set(courses.filter(c => c.type === 'practicum').map(c => c.id));
const inScope = (s) => (onlyCourse ? s.courseId === onlyCourse : practicumCourseIds.has(s.courseId));
const students = allStudents.filter(inScope);
const courseName = (id) => { const c = courses.find(x => x.id === id); return c ? `${c.name} ${c.year}` : id; };
const empById = (id) => employers.find(e => e.id === id);
const slotsOf = (e) => (e && e.vacancySlots) || [];
const isTestId = (v) => /^(audit-|zprev-|zint-|zsug-|zpd-)/.test(String(v || ''))
  || /@audit\.local$/i.test(String(v || ''));

// ── TESTDATA — leftovers from audit runs must never linger in production ─────
for (const s of allStudents) {
  if (isTestId(s.id) || isTestId(s.email)) add('WARN', 'TESTDATA', `leftover test STUDENT "${s.name}"`, `id=${s.id} email=${s.email || ''}`);
}
for (const e of employers) {
  if (isTestId(e.id) || /^ארגון (בדיקה|קיבולת|שיבוץ|מוצע|תצוגה|אינטגרציה)/.test(e.name || '')) {
    add('WARN', 'TESTDATA', `leftover test EMPLOYER "${e.name}"`, `id=${e.id}`);
  }
}

// ── Per-student invariants ──────────────────────────────────────────────────
for (const s of students) {
  const who = `${s.name} [${courseName(s.courseId)}]`;
  const prefs = s.preferences || [];

  // CV. The forms mandate an upload, but only for students who actually go THROUGH
  // them. A roster student the coordinator added and who has not yet submitted the
  // request form has no CV, and that is the normal pre-submission state — not a
  // defect. Only a student already IN the pipeline must carry one.
  // Legacy: the תשפ״ו cohorts were placed under the old acceptedOrg-string flow,
  // before preferences/submissionStatus existed — don't score those as broken.
  const isLegacyPlacement = !!s.acceptedOrg && prefs.length === 0 && s.submissionStatus !== 'placed';
  const inPipeline = prefs.length > 0 || s.submissionStatus === 'placed' || s.submissionStatus === 'submitted';
  if (!s.cvUrl && !s.cvUpdatedUrl) {
    if (inPipeline) add('FAIL', 'CV', `${who} is IN the placement pipeline but has NO CV`,
      `submissionStatus=${s.submissionStatus || '-'} prefs=${prefs.length} — the request form mandates an upload, so this row bypassed it`);
    else if (isLegacyPlacement) add('INFO', 'CV', `${who} placed under the LEGACY flow (acceptedOrg only), no CV on file`, s.acceptedOrg);
    else add('INFO', 'CV', `${who} has no CV yet — has not submitted the request form`, 'normal pre-submission state');
  } else if (!s.cvUpdatedUrl && prefs.length > 0) {
    add('WARN', 'CV', `${who} has only the ORIGINAL CV (no updated one) but already has preferences`,
      'path-1 "שלח קו״ח" stays disabled until the updated CV is promoted');
  }

  // PREFS — ranks 1..N, no dupes, employers exist.
  const ranks = prefs.map(p => p.rank);
  if (new Set(ranks).size !== ranks.length) add('FAIL', 'PREFS', `${who} has DUPLICATE preference ranks`, JSON.stringify(ranks));
  ranks.forEach((r, i) => { if (r !== i + 1) add('WARN', 'PREFS', `${who} preference ranks are not 1..N`, JSON.stringify(ranks)); });
  const seenEmp = new Set();
  for (const p of prefs) {
    const e = empById(p.employerId);
    if (!e) { add('FAIL', 'PREFS', `${who} preference #${p.rank} points at a MISSING employer`, `employerId=${p.employerId}`); continue; }
    if (seenEmp.has(p.employerId)) add('WARN', 'PREFS', `${who} lists the same org twice`, e.name);
    seenEmp.add(p.employerId);

    // SLOTS — a preference claiming a slot must really own it.
    if (p.slotId) {
      const slot = slotsOf(e).find(x => x.id === p.slotId);
      if (!slot) add('FAIL', 'SLOTS', `${who} preference #${p.rank} references a MISSING slot`, `${e.name} slotId=${p.slotId}`);
      else {
        if (slot.studentId !== s.id) add('FAIL', 'SLOTS', `${who} preference #${p.rank} claims a slot held by SOMEONE ELSE`, `${e.name} slot=${slot.id} heldBy=${slot.studentId}`);
        if (p.status === 'placed' && slot.status !== 'placed') add('FAIL', 'SLOTS', `${who} is 'placed' at ${e.name} but the slot is '${slot.status}'`, `slot=${slot.id}`);
        if (slot.courseId && s.courseId && slot.courseId !== s.courseId) add('FAIL', 'SCOPE', `${who} holds a slot belonging to another course`, `${e.name} slotCourse=${slot.courseId}`);
      }
    }
    // A tentative preference must hold nothing (the v1.27.0 rule).
    if (p.status === 'tentative' && p.slotId) {
      add('WARN', 'SLOTS', `${who} preference #${p.rank} is 'tentative' yet holds a place`, `${e.name} — preferences must reserve nothing until the CV is sent`);
    }
  }

  // PLACED — the three markers must agree.
  const placedPref = prefs.find(p => p.status === 'placed');
  const isPlaced = s.submissionStatus === 'placed';
  if (isPlaced && !s.acceptedOrg) add('FAIL', 'PLACED', `${who} is placed but has NO acceptedOrg`, '');
  if (isPlaced && !placedPref) add('WARN', 'PLACED', `${who} is placed but no preference is marked placed`, `acceptedOrg=${s.acceptedOrg || ''}`);
  if (!isPlaced && placedPref) add('FAIL', 'PLACED', `${who} has a placed preference but submissionStatus='${s.submissionStatus || ''}'`, '');
  if (s.acceptedOrg && !isPlaced) {
    add(isLegacyPlacement ? 'INFO' : 'WARN', 'PLACED',
      `${who} has acceptedOrg but submissionStatus='${s.submissionStatus || '-'}'`,
      isLegacyPlacement ? `${s.acceptedOrg} — legacy placement, not represented in the preferences model` : s.acceptedOrg);
  }

  // ORPHAN — placed yet still in play elsewhere.
  if (isPlaced) {
    const open = prefs.filter(p => p.status === 'tentative' || p.status === 'under_review');
    if (open.length) add('WARN', 'ORPHAN', `${who} is placed but still has ${open.length} open candidacy(ies)`,
      open.map(p => `${empById(p.employerId)?.name || p.employerId}:${p.status}`).join(', '));
  }
}

// ── Slot-level: no place held by two students ───────────────────────────────
for (const e of employers) {
  const byStudent = new Map();
  for (const slot of slotsOf(e)) {
    if (slot.studentId && (slot.status === 'placed' || slot.status === 'under_review' || slot.status === 'tentative')) {
      const list = byStudent.get(slot.studentId) || [];
      list.push(slot);
      byStudent.set(slot.studentId, list);
    }
    if (!slot.studentId && (slot.status === 'placed' || slot.status === 'under_review')) {
      add('FAIL', 'SLOTS', `${e.name} has a '${slot.status}' place with NO student`, `slot=${slot.id}`);
    }
  }
  for (const [sid, list] of byStudent) {
    if (list.length > 1) {
      const nm = allStudents.find(x => x.id === sid)?.name || sid;
      add('WARN', 'SLOTS', `${e.name} holds ${list.length} places for the SAME student (${nm})`, list.map(x => `${x.id}:${x.status}`).join(', '));
    }
  }
  // CAPACITY — the ledger vs the declared total.
  const total = Number(e.positionsTotal ?? e.positions ?? 0) || 0;
  const ledger = slotsOf(e).length;
  if (ledger && total && ledger !== total) {
    add('INFO', 'CAPACITY', `${e.name}: positionsTotal=${total} but the ledger has ${ledger} places`, '');
  }
  // PRIVATE — a suggested org must point at a real student.
  if (e.restrictedToStudentId && !allStudents.find(x => x.id === e.restrictedToStudentId)) {
    add('FAIL', 'PRIVATE', `${e.name} is restricted to a student who does not exist`, `restrictedToStudentId=${e.restrictedToStudentId}`);
  }
}

// ── Demand vs capacity, per practicum course ────────────────────────────────
const capacityRows = [];
for (const c of courses.filter(x => x.type === 'practicum')) {
  if (onlyCourse && c.id !== onlyCourse) continue;
  const cohort = allStudents.filter(s => s.courseId === c.id);
  const placed = cohort.filter(s => s.submissionStatus === 'placed').length;
  const needing = cohort.length - placed;
  let open = 0, held = 0, taken = 0;
  for (const e of employers) {
    for (const slot of slotsOf(e)) {
      if (slot.courseId !== c.id) continue;
      if (slot.status === 'available') open++;
      else if (slot.status === 'under_review' || slot.status === 'tentative') held++;
      else if (slot.status === 'placed') taken++;
    }
  }
  capacityRows.push({ course: `${c.name} ${c.year}`, students: cohort.length, placed, needing, open, inProcess: held, takenPlaces: taken });
  if (needing > open + held) {
    add('WARN', 'CAPACITY', `${c.name} ${c.year}: ${needing} students still need a place but only ${open} are open (+${held} in process)`,
      `short by ${needing - open - held}`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
if (asJson) {
  console.log(JSON.stringify({ version: data.version, capacity: capacityRows, findings }, null, 2));
} else {
  console.log(`\n📋 Practicum data health — blob v${data.version}${onlyCourse ? ` (course: ${onlyCourse})` : ''}`);
  console.log(`   ${students.length} practicum students · ${employers.length} employers\n`);
  console.log('── Capacity per course ──');
  for (const r of capacityRows) {
    console.log(`  ${r.course}: ${r.students} students (${r.placed} placed, ${r.needing} still need a place) · places: ${r.open} open, ${r.inProcess} in process, ${r.takenPlaces} taken`);
  }
  const order = { FAIL: 0, WARN: 1, INFO: 2 };
  const icon = { FAIL: '❌', WARN: '⚠️ ', INFO: 'ℹ️ ' };
  findings.sort((a, b) => order[a.sev] - order[b.sev] || a.group.localeCompare(b.group));
  console.log(`\n── Findings (${findings.filter(f => f.sev === 'FAIL').length} FAIL · ${findings.filter(f => f.sev === 'WARN').length} WARN · ${findings.filter(f => f.sev === 'INFO').length} INFO) ──`);
  if (!findings.length) console.log('  ✅ nothing to report — every invariant holds.');
  for (const f of findings) console.log(`  ${icon[f.sev]} [${f.group}] ${f.msg}${f.detail ? `\n        ${f.detail}` : ''}`);
  console.log('');
}

process.exit(findings.some(f => f.sev === 'FAIL') ? 1 : 0);

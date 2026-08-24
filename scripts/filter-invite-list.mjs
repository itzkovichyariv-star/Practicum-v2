#!/usr/bin/env node
/**
 * filter-invite-list.mjs — who on a mailing list should NOT be invited?
 *
 * Yariv has a list of addresses and wants to offer the practicum to everyone on
 * it who is not already a student of פרקטיקום משאבי אנוש תשפ״ז. Doing that by eye
 * across 70+ addresses and 13 candidates is how someone already enrolled gets a
 * "come apply" letter.
 *
 * It reports four groups rather than two, because "not a student of this course"
 * is not the same as "safe to invite":
 *
 *   ENROLLED   a student of the named course+year — removed, as asked
 *   OTHER      a student of a DIFFERENT course or year — reported, NOT removed,
 *              because that is Yariv's call and not a rule he gave
 *   PIPELINE   already a candidate, or has a submission on file — flagged, since
 *              the standing rule is that neither students nor candidates are
 *              written to. Someone who applied last week, or withdrew, must not
 *              be asked to apply.
 *   SEND       everyone left
 *
 * READ-ONLY. It writes nothing, to the database or to anyone.
 *
 * The addresses are read from a FILE, never stored here: a list of real people's
 * private addresses does not belong in a repository's history. Separators are
 * free — semicolons, commas, newlines all work, and duplicates collapse.
 *
 *   node scripts/filter-invite-list.mjs invite-list.txt   # against live data
 *   cat invite-list.txt | node scripts/filter-invite-list.mjs
 *   node scripts/filter-invite-list.mjs --self-test       # prove the logic, no network
 */

import { readFileSync } from 'node:fs';

const COURSE_NAME = 'פרקטיקום משאבי אנוש';
const COURSE_YEAR = 'תשפ״ז';


/* ── pure helpers ─────────────────────────────────────────────────────────── */

const norm = (e) => String(e || '').trim().toLowerCase();
/** Same rule the app uses (src/lib/session.ts) so a year can't mismatch on a quote glyph. */
const normYear = (y) => !y ? '' : String(y).trim().replace(/\s+/g, '-').replace(/["“”״]/g, '״');
const normCourseName = (n) => String(n || '').replace(/\s+/g, '').toLowerCase();

export function parseList(raw) {
  return [...new Set(
    String(raw).split(/[;,\s]+/).map(norm).filter(e => e.includes('@'))
  )];
}

export function resolveCourse(courses, name, year) {
  const byNameYear = courses.find(c =>
    normCourseName(c.name) === normCourseName(name) && normYear(c.year) === normYear(year));
  return byNameYear || courses.find(c => normCourseName(c.name) === normCourseName(name)) || null;
}

/**
 * Classify every address. Order matters: the most restrictive verdict wins, so
 * an address that is both a student and a candidate is reported as a student.
 */
export function classify(emails, { students = [], candidates = [], submissions = [], course }) {
  const inCourse = (r) =>
    !!course && r.courseId === course.id &&
    (!r.year || !course.year || normYear(r.year) === normYear(course.year));

  const idx = new Map();
  const put = (email, verdict, who) => {
    if (!email) return;
    const k = norm(email);
    if (!idx.has(k)) idx.set(k, { verdict, who });
  };
  // Most restrictive first.
  students.filter(inCourse).forEach(s => put(s.email, 'ENROLLED', s.name));
  students.filter(s => !inCourse(s)).forEach(s => put(s.email, 'OTHER', `${s.name} · ${s.year || '—'}`));
  candidates.forEach(c => put(c.email, 'PIPELINE',
    `${c.name}${c.convertedToStudentId ? ' · הפך/ה לסטודנט' : ' · מועמד/ת'}`));
  submissions.forEach(s => put(s.email, 'PIPELINE', `${s.name} · הגיש/ה מועמדות`));

  const out = { ENROLLED: [], OTHER: [], PIPELINE: [], SEND: [] };
  for (const email of emails) {
    const hit = idx.get(norm(email));
    if (hit) out[hit.verdict].push({ email, who: hit.who });
    else out.SEND.push({ email, who: '' });
  }
  return out;
}

/* ── self-test: prove the logic without touching the network ──────────────── */

if (process.argv.includes('--self-test')) {
  const course = { id: 'hr', name: COURSE_NAME, year: COURSE_YEAR };
  const data = {
    course,
    students: [
      { name: 'רות אלון',  email: 'Enrolled@Example.com', courseId: 'hr',    year: 'תשפ"ז' }, // ASCII quote
      { name: 'דנה כהן',   email: 'other@example.com',    courseId: 'other', year: 'תשפ״ו' },
    ],
    candidates: [
      { name: 'מאיה בר',   email: 'cand@example.com' },
      { name: 'עדי חסידי', email: 'withdrew@example.com', convertedToStudentId: undefined },
      { name: 'רות אלון',  email: 'enrolled@example.com' }, // also a candidate — student wins
    ],
    submissions: [{ name: 'נועה שקד', email: 'SUBMITTED@example.com' }],
  };
  const emails = parseList(`
    enrolled@example.com; other@example.com; cand@example.com; withdrew@example.com;
    submitted@example.com; fresh@example.com; fresh@example.com`);

  const r = classify(emails, data);
  const got = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.map(x => x.email)]));
  const checks = [
    ['deduplicates the input',            emails.length === 6,                          `${emails.length} unique`],
    ['a student of this course is out',   got.ENROLLED.join() === 'enrolled@example.com', got.ENROLLED.join()],
    ['case is ignored',                   got.ENROLLED.includes('enrolled@example.com'), 'Enrolled@Example.com matched'],
    ['ASCII vs Hebrew quote in the year',  got.ENROLLED.length === 1,                     'תשפ"ז matched תשפ״ז'],
    ['another course is reported, not cut', got.OTHER.join() === 'other@example.com',     got.OTHER.join()],
    ['a candidate is flagged',            got.PIPELINE.includes('cand@example.com'),     got.PIPELINE.join()],
    ['a withdrawal is flagged',           got.PIPELINE.includes('withdrew@example.com'), got.PIPELINE.join()],
    ['a submission is flagged',           got.PIPELINE.includes('submitted@example.com'), got.PIPELINE.join()],
    ['student beats candidate',           !got.PIPELINE.includes('enrolled@example.com'), 'not double-counted'],
    ['everyone else is sendable',         got.SEND.join() === 'fresh@example.com',       got.SEND.join()],
    ['nobody is lost or duplicated',
      got.ENROLLED.length + got.OTHER.length + got.PIPELINE.length + got.SEND.length === emails.length,
      `${emails.length} in`],
  ];
  let bad = 0;
  console.log('\nfilter-invite-list — self-test\n');
  for (const [name, pass, detail] of checks) {
    if (!pass) bad++;
    console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  }
  console.log(`\n${checks.length - bad}/${checks.length} passed\n`);
  process.exit(bad ? 1 : 0);
}

/* ── live run ─────────────────────────────────────────────────────────────── */

// Anything that goes wrong here is operational — an unreadable file, a database
// that will not answer. One sentence is more use than a stack trace to someone
// running this between meetings.
try {

  const URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
  const KEY = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
  const get = async (path) => {
    const r = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${path} → ${r.status} ${r.statusText}: ${(await r.text()).slice(0, 160)}`);
    return r.json();
  };

  const fileArg = process.argv.slice(2).find(a => !a.startsWith('--'));
  let raw = '';
  if (fileArg) {
    raw = readFileSync(fileArg, 'utf8');
  } else if (!process.stdin.isTTY) {
    raw = readFileSync(0, 'utf8');
  } else {
    console.error('Give it the address list: node scripts/filter-invite-list.mjs <file>');
    console.error('(or pipe it in). Refusing to run against an empty list.');
    process.exit(2);
  }

  const emails = parseList(raw);
  if (!emails.length) throw new Error(`no addresses found in ${fileArg || 'stdin'}`);
  const rows = await get('practicum_data?org_id=eq.default&select=data');
  const d = rows?.[0]?.data;
  if (!d) throw new Error('practicum_data returned no row — refusing to filter against nothing');

  let submissions = [];
  try { submissions = await get('candidate_submissions?select=name,email,processed'); }
  catch (e) { console.log(`  (submissions unreadable — pipeline flags will be incomplete: ${e.message})\n`); }

  const course = resolveCourse(d.courses || [], COURSE_NAME, COURSE_YEAR);
  if (!course) throw new Error(`no course matched "${COURSE_NAME}" ${COURSE_YEAR} — refusing to guess`);

  const r = classify(emails, { students: d.students || [], candidates: d.candidates || [], submissions, course });

  const show = (title, list, note) => {
    console.log(`\n${title} — ${list.length}${note ? `  (${note})` : ''}`);
    list.forEach(x => console.log(`   ${x.email}${x.who ? `   ← ${x.who}` : ''}`));
  };

  console.log(`\nfilter-invite-list · ${course.name} ${course.year || ''} · course id ${course.id}`);
  console.log(`${emails.length} unique addresses in · ${(d.students || []).length} students, ${(d.candidates || []).length} candidates, ${submissions.length} submissions on file`);

  show('ENROLLED — removed, as asked', r.ENROLLED);
  show('OTHER COURSE OR YEAR — your call, NOT removed', r.OTHER);
  show('ALREADY IN THE PIPELINE — inviting these means writing to a candidate', r.PIPELINE);
  show('SEND', r.SEND);

  console.log(`\n── paste-ready (SEND only, ${r.SEND.length}) ──\n`);
  console.log(r.SEND.map(x => x.email).join('; '));
  console.log('\nNothing was written and no message was sent.\n');
} catch (e) {
  console.error(`\n✗ ${e?.message || e}\n`);
  process.exit(1);
}

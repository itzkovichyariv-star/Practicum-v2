/**
 * rules-placement.mts — the PURE half of audit cell 42.
 *
 * Runs under tsx because it imports lib/placementStatus.ts directly; plain node (22)
 * strips types but cannot resolve the extensionless import inside placement.ts. Emits
 * one JSON array on stdout, which 42-placement-strip.mjs turns into audit cells.
 * Deliberately NOT named `NN-*.mjs`, so the gate does not pick it up as a cell of its own.
 */
import { placementStatus, SILENCE_DAYS } from '../../src/lib/placementStatus.ts';

const cells: any[] = [];
const audit = { recordCell: (c: any) => cells.push(c) };

const NOW = Date.parse('2026-08-09T09:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const COURSE = { id: 'c1', type: 'practicum' };
const student = (over = {}) => ({ id: 'stu1', name: 'בדיקה', courseId: 'c1', email: 'a@b.local', ...over });

const run = (over, extra = {}) => placementStatus({
  student: student(over.student || {}),
  employers: over.employers || [],
  dispatches: over.dispatches || [],
  pending: over.pending || null,
  lastSubmissionAt: over.lastSubmissionAt || null,
  course: over.course === undefined ? COURSE : over.course,
  now: NOW, ...extra,
});

const rule = (id, tableRef, expected, got) =>
  audit.recordCell({ id, tableRef, expected, observed: got, pass: got === expected });

// A1 — a waiting submission with NEW orgs outranks everything (the state that strands
// students today: it is invisible from the list until someone opens the card).
{
  const st = run({
    pending: { id: 'r1', uploaded_at: daysAgo(3), cv_file_path: 'x/new.pdf', org_pref_1: 'UCL Group' },
    student: { cvUpdatedUrl: 'storage://x/old.pdf' },
  });
  rule('STRIP-pending-wins', 'brief §states row 1',
    'submission_pending/ours', `${st.key}/${st.turn}`);
  rule('STRIP-pending-copy', 'brief §states row 1',
    'רשימת העדפות התקבלה — יש לקלוט לכרטיס', st.headline);
}

// A2 — REGRESSION GUARD (הדר עוזירי, 2026-08-09): a CV-only submission has all three org
// fields empty. A naive field-by-field diff reads that emptiness as "a list is waiting"
// and buries the real state. It must NOT take the row over; it rides along in `sub`.
{
  const emp = { id: 'e1', name: 'מערך הדיגיטל הלאומי', restrictedToStudentId: 'stu1', approvalStatus: 'approved' };
  const st = run({
    employers: [emp],
    student: { cvUpdatedUrl: 'storage://x/old.pdf', firstChoiceOrg: 'מערך הדיגיטל הלאומי' },
    pending: { id: 'r2', uploaded_at: daysAgo(12), cv_file_path: 'x/newer.pdf', org_pref_1: null, org_pref_2: null, org_pref_3: null },
  });
  rule('STRIP-cv-only-does-not-mask', 'brief §no schema change / הדר case',
    'suggested_org/ours', `${st.key}/${st.turn}`);
  rule('STRIP-cv-only-noted', 'brief §no schema change',
    true, st.sub.includes('קו״ח מעודכן חדש'));
}

// A3 — a self-suggested org is talk-and-approve, never send-CV (Yariv's correction).
{
  const emp = { id: 'e1', name: 'מרקמן טומשין ושו״ת', restrictedToStudentId: 'stu1', approvalStatus: 'approved', contactPerson: 'שרון פלס' };
  const st = run({ employers: [emp], student: { firstChoiceOrg: 'מרקמן טומשין ושו״ת' } });
  rule('STRIP-suggested-copy', 'brief §self-suggested org',
    'ארגון בהצעת הסטודנט/ית — יש לשוחח עם המעסיק ולאשר', st.headline);
  rule('STRIP-suggested-action', 'brief §self-suggested org', 'place_direct', st.action?.id);
  // and the missing-CV blocker must NOT fire for it — place_direct needs no CV
  rule('STRIP-suggested-not-blocked', 'brief §self-suggested org', true, st.key !== 'blocked_no_cv');
}

// A4 — the mixed shape leads with the suggested org (decision ד).
{
  const emps = [
    { id: 'e1', name: 'מערך הדיגיטל הלאומי', restrictedToStudentId: 'stu1', approvalStatus: 'approved' },
    { id: 'e2', name: 'נישה פרו', approvalStatus: 'approved' },
  ];
  const st = run({ employers: emps, student: {
    cvUpdatedUrl: 'storage://x/cv.pdf', firstChoiceOrg: 'מערך הדיגיטל הלאומי', secondChoiceOrg: 'נישה פרו' } });
  rule('STRIP-mixed-leads-suggested', 'brief §decision ד', true,
    st.chips[0]?.suggested === true && st.chips[0]?.orgName === 'מערך הדיגיטל הלאומי');
  rule('STRIP-mixed-copy', 'brief §decision ד', true,
    st.headline.startsWith('ארגון בהצעת הסטודנט/ית') && st.headline.includes('מהרשימה'));
}

// A5 — Yariv's headline ask, with the singular fixed.
{
  const emps = [{ id: 'e1', name: 'A', approvalStatus: 'approved' }, { id: 'e2', name: 'B', approvalStatus: 'approved' }];
  const mk = (n) => ({
    employers: emps,
    student: { cvUpdatedUrl: 'x', preferences: Array.from({ length: n }, (_, i) => ({ rank: i + 1, orgName: emps[i].name, employerId: emps[i].id, status: 'under_review', slotId: `s${i}` })) },
    dispatches: Array.from({ length: n }, (_, i) => ({ studentId: 'stu1', slotId: `s${i}`, employerId: emps[i].id, result: 'pending', sentAt: daysAgo(2) })),
  });
  rule('STRIP-sent-2', 'Yariv: "נשלחו ל2 מקומות"',
    'קו״ח נשלחו ל‑2 מקומות · ממתין לתשובת המעסיק', run(mk(2)).headline);
  rule('STRIP-sent-1-singular', 'brief §states row 6',
    'קו״ח נשלחו למקום אחד · ממתין לתשובת המעסיק', run(mk(1)).headline);
  rule('STRIP-sent-turn', 'brief §states row 6', 'employer', run(mk(2)).turn);
}

// A6 — silence past the threshold hands the ball back to us (7 days, Yariv 2026-08-09).
{
  const emps = [{ id: 'e1', name: 'A', approvalStatus: 'approved' }];
  const mk = (age) => ({
    employers: emps,
    student: { cvUpdatedUrl: 'x', preferences: [{ rank: 1, orgName: 'A', employerId: 'e1', status: 'under_review', slotId: 's0' }] },
    dispatches: [{ studentId: 'stu1', slotId: 's0', employerId: 'e1', result: 'pending', sentAt: daysAgo(age) }],
  });
  rule('STRIP-silence-threshold', `brief §states row 7 (${SILENCE_DAYS}d)`, 7, SILENCE_DAYS);
  rule('STRIP-inside-window', 'brief §states row 6', 'employer', run(mk(SILENCE_DAYS)).turn);
  rule('STRIP-past-window', 'brief §states row 7', 'sent_stale/ours',
    `${run(mk(SILENCE_DAYS + 1)).key}/${run(mk(SILENCE_DAYS + 1)).turn}`);
}

// A7 — scope of "always": practicum courses only (53 of 83 students are elsewhere).
rule('STRIP-practicum-only', 'brief §decision א scope', null,
  run({ student: { cvUpdatedUrl: 'x' }, course: { id: 'c9', type: 'other' } }));
rule('STRIP-practicum-shown', 'brief §decision א scope', true,
  run({ student: {} }) !== null);


process.stdout.write(JSON.stringify(cells));

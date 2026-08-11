/**
 * rules-placement.mts — the PURE half of audit cell 64.
 *
 * Runs under tsx because it imports lib/placementStatus.ts directly; plain node (22)
 * strips types but cannot resolve the extensionless import inside placement.ts. Emits
 * one JSON array on stdout, which 64-placement-strip.mjs turns into audit cells.
 * Deliberately NOT named `NN-*.mjs`, so the gate does not pick it up as a cell of its own.
 */
import { placementStatus, actionsForChip, SILENCE_DAYS, DECISION_DAYS, MAX_REMINDERS, NO_RESPONSE_DAYS } from '../../src/lib/placementStatus.ts';
import { responseStageOf, applyEmployerAnswer } from '../../src/lib/dispatch.ts';
import { migratePlacementData, renderTemplate } from '../../src/lib/placement.ts';

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
  allStudents: over.allStudents || [],
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


// A8 — the actions offered depend on how the org got onto the list (Yariv 2026-08-09):
// an org the student brought can be approved into a placement OR sent a CV; an org from
// the shared list only ever gets a CV, and reaches placement via a passed interview.
rule('STRIP-actions-suggested', 'Yariv: mixed list rule',
  'place_direct,send_cv', actionsForChip({ suggested: true }).map(a => a.id).join(','));
rule('STRIP-actions-list-org', 'Yariv: "שאר הארגונים — שלח קורות חיים"',
  'send_cv', actionsForChip({ suggested: false }).map(a => a.id).join(','));
rule('STRIP-list-org-never-places', 'placement follows an interview, not a click',
  false, actionsForChip({ suggested: false }).some(a => a.id === 'place_direct'));

// A9 — states the coverage sweep found unasserted (2026-08-09). Each is cheap to pin
// and each is a sentence a coordinator will actually read on the row.
{
  const st = run({ student: { preparation: { passed: true } } });
  rule('STRIP-not-submitted', 'brief §states row 0', 'not_submitted/student', `${st.key}/${st.turn}`);
  rule('STRIP-not-submitted-copy', 'brief §states row 0',
    'טרם הוגשו קו״ח מעודכנים והעדפות', st.headline);
}
{
  const emp = { id: 'e9', name: 'ארגון שהוצע', restrictedToStudentId: 'stu1', approvalStatus: 'pending', contactPerson: 'דנה' };
  const st = run({ employers: [emp], student: { firstChoiceOrg: 'ארגון שהוצע' } });
  rule('STRIP-org-approval-pending', 'brief §states row 2', 'org_approval_pending/ours', `${st.key}/${st.turn}`);
  rule('STRIP-org-approval-action', 'brief §states row 2', 'approve_org', st.action?.id);
}
{
  const emps = [{ id: 'e1', name: 'A', approvalStatus: 'approved' }, { id: 'e2', name: 'B', approvalStatus: 'approved' }];
  const st = run({ employers: emps, student: { cvUpdatedUrl: 'x', preferences: [
    { rank: 1, orgName: 'A', employerId: 'e1', status: 'rejected', slotId: null },
    { rank: 2, orgName: 'B', employerId: 'e2', status: 'rejected', slotId: null },
  ] } });
  rule('STRIP-exhausted', 'brief §states row 9', 'exhausted/ours', `${st.key}/${st.turn}`);
  rule('STRIP-exhausted-copy', 'brief §states row 9',
    'נדחה/תה ל‑2 מקומות — יש להציע ארגונים חדשים', st.headline);
  rule('STRIP-exhausted-action', 'brief §states row 9', 'add_orgs', st.action?.id);
}
// The reminder action does not exist in the app yet. It must SAY so rather than look
// like a working button — the flag is what the confirmation dialog renders.
{
  const emps = [{ id: 'e1', name: 'A', approvalStatus: 'approved' }];
  const st = run({
    employers: emps,
    student: { cvUpdatedUrl: 'x', preferences: [{ rank: 1, orgName: 'A', employerId: 'e1', status: 'under_review', slotId: 's0' }] },
    dispatches: [{ studentId: 'stu1', slotId: 's0', employerId: 'e1', result: 'pending', sentAt: daysAgo(SILENCE_DAYS + 5) }],
  });
  // Built on 2026-08-10 — it must no longer carry the "not yet built" flag.
  rule('STRIP-remind-is-built', 'reminder shipped 2026-08-10', undefined, st.action?.isNew);
}

// A10 — the three faults Yariv reported from v1.36.1 (2026-08-10), on a row that has
// one CV already out and two organizations still waiting.
{
  const emps = [
    { id: 'e1', name: 'Icon', approvalStatus: 'approved', vacancySlots: [{ id: 'i1', courseId: 'c1', status: 'under_review', studentId: 'other' }] },
    { id: 'e2', name: 'TLV',  approvalStatus: 'approved', vacancySlots: [{ id: 't1', courseId: 'c1', status: 'under_review', studentId: 'stu1' }] },
    { id: 'e3', name: 'UCL',  approvalStatus: 'approved', vacancySlots: [{ id: 'u1', courseId: 'c1', status: 'available', studentId: null }] },
  ];
  const st = run({
    employers: emps,
    allStudents: [{ id: 'other', name: 'שובל קוממי' }],
    student: { courseId: 'c1', cvUpdatedUrl: 'x', preferences: [
      { rank: 1, orgName: 'Icon', employerId: 'e1', status: 'tentative', slotId: null },
      { rank: 2, orgName: 'TLV',  employerId: 'e2', status: 'under_review', slotId: 't1' },
      { rank: 3, orgName: 'UCL',  employerId: 'e3', status: 'tentative', slotId: null },
    ] },
    dispatches: [{ studentId: 'stu1', slotId: 't1', employerId: 'e2', result: 'pending', sentAt: daysAgo(0) }],
  });
  // "אין מה לשנות את הסדר של המקומות ששתיים יהיה לפני 1"
  rule('STRIP-chips-keep-rank-order', 'Yariv 2026-08-10: never reorder the ranking',
    '1,2,3', st.chips.map(c => c.rank).join(','));
  // "כתוב של‑1 עדיין לא נשלח אבל זה לא נשלח כי אין מקום"
  rule('STRIP-blocked-says-why', 'Yariv 2026-08-10: say WHY it was not sent',
    true, /תפוס/.test(st.chips.find(c => c.rank === 1)?.suffix || ''));
  rule('STRIP-blocked-names-holder', 'Yariv 2026-08-10',
    true, (st.chips.find(c => c.rank === 1)?.suffix || '').includes('שובל קוממי'));
  // "כפתורים לא לחיצים יותר אם רוצים לשלוח ליותר ממקום אחד"
  rule('STRIP-can-still-send-after-first', 'Yariv 2026-08-10: sending must stay possible',
    'send_cv', st.action?.id);
  rule('STRIP-recommends-next-free', 'points at the choice that can actually receive it',
    3, st.chips.find(c => c.recommended)?.rank);
}

// A11 — staged clocks. Yariv 2026-08-10: a decision can take a month and a half, so one
// 7-day clock shouted "no reply" straight through a scheduled interview.
{
  const emps = [{ id: 'e1', name: 'Codeoasis', approvalStatus: 'approved' }];
  const base = (over: any = {}) => ({
    employers: emps,
    student: { courseId: 'c1', cvUpdatedUrl: 'x',
      preferences: [{ rank: 1, orgName: 'Codeoasis', employerId: 'e1', status: 'under_review', slotId: 's0' }],
      ...over },
    dispatches: [{ studentId: 'stu1', slotId: 's0', employerId: 'e1', result: 'pending', sentAt: daysAgo(30), reminders: over.__rem ?? 0 }],
  });
  const iso = (d: number) => new Date(NOW + d * 86400000).toISOString().slice(0, 10);

  // an interview booked for next week must NOT read as "no reply"
  const sched = run(base({ placementInterviewDate: iso(7), placementInterviewOrg: 'Codeoasis' }));
  rule('CLOCK-interview-silences', 'stage 2 — silent until the date',
    'interview_scheduled/employer', `${sched.key}/${sched.turn}`);
  rule('CLOCK-interview-no-nag', 'stage 2 must not demand a reminder', true, sched.action?.id !== 'remind');

  // the day after the interview: waiting on a decision, not overdue yet
  const justAfter = run(base({ placementInterviewDate: iso(-2), placementInterviewOrg: 'Codeoasis' }));
  rule('CLOCK-after-interview', 'stage 3 — awaiting a decision',
    'awaiting_decision/employer', `${justAfter.key}/${justAfter.turn}`);

  // past the decision window the ball comes back to us
  const overdue = run(base({ placementInterviewDate: iso(-(DECISION_DAYS + 3)), placementInterviewOrg: 'Codeoasis' }));
  rule('CLOCK-decision-overdue', 'stage 3 — past the window it is ours',
    'awaiting_decision/ours', `${overdue.key}/${overdue.turn}`);
  rule('CLOCK-decision-offers-remind', 'stage 3 overdue offers a reminder', 'remind', overdue.action?.id);

  // and after three reminders we stop chasing and say so
  const spent = run(base({ placementInterviewDate: iso(-(DECISION_DAYS + 3)), __rem: MAX_REMINDERS }));
  rule('CLOCK-stops-after-3', 'Yariv: stop after three and mark אין מענה',
    'no_response/ours', `${spent.key}/${spent.turn}`);
  rule('CLOCK-stops-not-remind', 'a fourth reminder is not offered', true, spent.action?.id !== 'remind');
}

// A12 — the employer's own answer (routes א + ג). The question must follow the stage:
// nobody is asked "was she accepted?" before an interview has happened.
{
  const stu = (over: any = {}) => ({ id: 'stu1', name: 'בדיקה', courseId: 'c1',
    preferences: [{ rank: 1, orgName: 'Codeoasis', employerId: 'e1', status: 'under_review', slotId: 's0' }], ...over });
  const emps = [{ id: 'e1', name: 'Codeoasis', vacancySlots: [{ id: 's0', courseId: 'c1', status: 'under_review', studentId: 'stu1' }] }];
  const disp = [{ id: 'd1', studentId: 'stu1', slotId: 's0', employerId: 'e1', result: 'pending', sentAt: daysAgo(20) }];
  const iso = (d: number) => new Date(NOW + d * 86400000).toISOString().slice(0, 10);

  rule('ANSWER-stage-before-interview', 'ask about an interview, not a decision',
    'awaiting_reply', responseStageOf({ student: stu(), orgName: 'Codeoasis', now: NOW }));
  rule('ANSWER-stage-interview-booked', 'stage 2',
    'interview_booked', responseStageOf({ student: stu({ placementInterviewDate: iso(5) }), orgName: 'Codeoasis', now: NOW }));
  rule('ANSWER-stage-after-interview', 'only now ask about a decision',
    'awaiting_decision', responseStageOf({ student: stu({ placementInterviewDate: iso(-3) }), orgName: 'Codeoasis', now: NOW }));

  // an invitation records the date and does NOT free or take anything
  const inv = applyEmployerAnswer({ student: stu(), employers: emps, dispatches: disp,
    orgName: 'Codeoasis', answer: { kind: 'invite', interviewDate: iso(6) }, now: new Date(NOW).toISOString() });
  rule('ANSWER-invite-records-date', 'stage 1 → 2', iso(6), inv.student.placementInterviewDate);
  rule('ANSWER-invite-keeps-place', 'an invitation changes no place',
    'under_review', (inv.employers[0] as any).vacancySlots[0].status);

  // accepted places the student and takes the place for good
  const acc = applyEmployerAnswer({ student: stu(), employers: emps, dispatches: disp,
    orgName: 'Codeoasis', answer: { kind: 'accepted' }, now: new Date(NOW).toISOString() });
  rule('ANSWER-accepted-places', 'the employer said yes', 'Codeoasis', acc.student.acceptedOrg);
  rule('ANSWER-accepted-takes-slot', 'the place is taken for good',
    'placed', (acc.employers[0] as any).vacancySlots[0].status);
  rule('ANSWER-accepted-closes-dispatch', 'the send is resolved', 'placed', acc.dispatches[0].result);

  // a refusal frees the place so the next choice can be used
  const no = applyEmployerAnswer({ student: stu(), employers: emps, dispatches: disp,
    orgName: 'Codeoasis', answer: { kind: 'not_accepted' }, now: new Date(NOW).toISOString() });
  rule('ANSWER-refusal-frees-place', 'the next choice becomes possible',
    'available', (no.employers[0] as any).vacancySlots[0].status);
  rule('ANSWER-refusal-marks-pref', 'the choice is closed off', 'rejected', no.student.preferences[0].status);
  rule('ANSWER-refusal-records-interview', 'a post-interview refusal records the result',
    'failed', no.student.preferences[0].interviewResult);

  // "still reviewing" is a real answer — it restarts the clock and changes nothing else
  const wait = applyEmployerAnswer({ student: stu(), employers: emps, dispatches: disp,
    orgName: 'Codeoasis', answer: { kind: 'still_reviewing' }, now: new Date(NOW).toISOString() });
  rule('ANSWER-still-reviewing-holds', 'nothing is released', 'under_review', (wait.employers[0] as any).vacancySlots[0].status);
  rule('ANSWER-still-reviewing-resets', 'the clock restarts', true, !!(wait.dispatches[0] as any).remindedAt);
}

// ── the answer link has to survive a template that predates it ────────────────
// Yariv's four templates were saved long before {responseLink} existed, and the
// settings backfill only fills keys that are MISSING — so without this migration the
// response page would be reachable and never reached, and the feature would look
// shipped while being dead. These prove the repair, and prove it is not a clobber.
{
  const saved = {
    whatsappTemplate: 'שלום {contactName},\nמצורף קו"ח של {studentName}.\nתודה,\n{adminName}',
    emailBodyTemplate: 'שלום {contactName},\nניסוח משלי שאסור לדרוס.\nתודה רבה,\n{adminName}',
    reminderWhatsappTemplate: 'שלום {contactName},\nמזכיר לגבי {studentName}.\nתודה,\n{adminName}',
    reminderEmailBodyTemplate: 'כבר מכיל {responseLink} ולא צריך שינוי\nתודה,\n{adminName}',
  };
  // migratePlacementData deep-clones and RETURNS — reading the input back shows nothing.
  const ps: any = migratePlacementData({ placementSettings: { ...saved } } as any).placementSettings;

  rule('LINK-added-to-saved-email', 'a template saved without the link gets it',
    true, ps.emailBodyTemplate.includes('{responseLink}'));
  rule('LINK-added-to-saved-whatsapp', 'both channels, not just mail',
    true, ps.whatsappTemplate.includes('{responseLink}'));
  rule('LINK-added-to-reminder', 'the reminder carries it too',
    true, ps.reminderWhatsappTemplate.includes('{responseLink}'));
  rule('LINK-keeps-custom-wording', 'hand-edited wording is preserved',
    true, ps.emailBodyTemplate.includes('ניסוח משלי שאסור לדרוס'));
  // NOTE the `>= 0`: without it this cell passes when the link is ABSENT (-1 < N), which
  // is exactly how it read green while the migration was doing nothing at all.
  rule('LINK-sits-above-signature', 'it reads as part of the ask, not after the sign-off',
    true, ps.emailBodyTemplate.indexOf('{responseLink}') >= 0
      && ps.emailBodyTemplate.indexOf('{responseLink}') < ps.emailBodyTemplate.indexOf('{adminName}'));
  rule('LINK-not-duplicated', 'a template that already has it is left alone',
    1, (ps.reminderEmailBodyTemplate.match(/\{responseLink\}/g) || []).length);

  // ── and now what the employer ACTUALLY receives ───────────────────────────────
  // Every cell above asserts the TEMPLATE. None of them asserts the MESSAGE, and that
  // gap hid two live bugs: renderTemplate substituted a hardcoded list of eight keys, so
  // {daysWaiting} and {responseLink} were shipped verbatim — the v1.39 reminder really
  // did read "לפני {daysWaiting} ימים" to real employers. Assert the rendered text.
  // Render the REAL shipping reminder body, not the stub above — that stub deliberately
  // carries no {daysWaiting}, so composing it would prove nothing about the substitution.
  const shipped: any = migratePlacementData({} as any).placementSettings;
  const composed = renderTemplate(shipped.reminderEmailBodyTemplate, {
    contactName: 'איש קשר', studentName: 'סטודנטית', positionTitle: 'ארגון', adminName: 'יריב',
    courseName: 'פרקטיקום', cvLink: 'https://x/cv.pdf', employerName: 'ארגון',
    daysWaiting: '8', responseLink: 'https://practicum.yarivitzkovich.org/r?t=d1',
  });
  rule('RENDER-no-placeholder-left', 'nothing reaches the employer as {…}',
    true, !/\{\w+\}/.test(composed));
  rule('RENDER-link-is-a-url', 'the answer link is a URL, not the word',
    true, composed.includes('https://practicum.yarivitzkovich.org/r?t=d1'));
  rule('RENDER-days-substituted', 'the reminder says a number of days',
    true, composed.includes('8') && !composed.includes('{daysWaiting}'));
  rule('RENDER-unknown-stays-visible', 'a typo in a template is visible, not silently blanked',
    '{notARealKey}', renderTemplate('{notARealKey}', { studentName: 'x' }));
  rule('RENDER-legacy-key-still-blanks', 'an omitted original key renders empty as before',
    '', renderTemplate('{scope}', { studentName: 'x' }));

  // a second load must not append it again
  const twice: any = migratePlacementData({ placementSettings: ps } as any).placementSettings;
  rule('LINK-migration-is-idempotent', 'reloading adds nothing',
    1, (twice.emailBodyTemplate.match(/\{responseLink\}/g) || []).length);
}

// ── the two clocks, the right way round ───────────────────────────────────────
// Yariv 2026-08-10, correcting me: "החודש וחצי זה עד שיש זימון לראיון אחר כך הזמן הוא
// יותר מצומצם". I had put the month and a half on the post-interview decision, which is
// backwards. The long wait is BEFORE an invitation; after the interview it is short.
{
  const emps = [{ id: 'e1', name: 'A', approvalStatus: 'approved' }];
  const waiting = (age, reminders = 0) => ({
    employers: emps,
    student: { cvUpdatedUrl: 'x', preferences: [{ rank: 1, orgName: 'A', employerId: 'e1', status: 'under_review', slotId: 's0' }] },
    dispatches: [{ studentId: 'stu1', slotId: 's0', employerId: 'e1', result: 'pending', sentAt: daysAgo(age), reminders }],
  });

  rule('CLOCK-post-interview-is-shorter', 'after a ראיון the answer comes faster',
    true, DECISION_DAYS < NO_RESPONSE_DAYS && DECISION_DAYS <= 7);
  rule('CLOCK-invite-window-is-45', 'a זימון לראיון can take a month and a half',
    45, NO_RESPONSE_DAYS);

  // the state that burned before: chased out at ~21 days and declared dead
  const chasedOut = run(waiting(24, MAX_REMINDERS));
  rule('CLOCK-not-abandoned-at-21d', 'three reminders is not the same as no answer',
    true, chasedOut.key !== 'no_response');
  rule('CLOCK-quiet-wait-is-employers-turn', 'nothing for us to do while it is still normal',
    'employer', chasedOut.turn);
  rule('CLOCK-quiet-wait-explains', 'the row says why it went quiet',
    true, chasedOut.sub.includes(String(NO_RESPONSE_DAYS)));

  // and past the real horizon it IS dead
  const past = run(waiting(NO_RESPONSE_DAYS + 2, MAX_REMINDERS));
  rule('CLOCK-abandoned-past-45d', 'past the window it is genuinely no answer',
    'no_response/ours', `${past.key}/${past.turn}`);

  // still inside the window, un-chased: a reminder is the right move, not giving up
  const nudge = run(waiting(SILENCE_DAYS + 1, 0));
  rule('CLOCK-reminder-inside-window', 'a nudge, not an abandonment',
    'sent_stale/remind', `${nudge.key}/${nudge.action?.id}`);
}

process.stdout.write(JSON.stringify(cells));

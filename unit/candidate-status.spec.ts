import { test, expect } from '@playwright/test';
import {
  candidateStatus, findStudentForCandidate, isArchivedCandidate,
  candidateChips, questionnaireFilled, scalePosition,
  DOCS_CHASE_DAYS, DECISION_DAYS,
} from '../src/lib/candidateStatus';
import type { Candidate, Student } from '../src/lib/supabase';

/**
 * The applicants view.
 *
 * Yariv 2026-08-22, two asks in one message:
 *   1. "once they passed the interview they move to the students page ... yet they
 *      stay in the candidate view marked with green dot. I would think that once
 *      approved and moved to students view they don't need to be viewed in the
 *      candidate view."
 *   2. "while they are candidates they don't have a rich view that is similar to
 *      the one they have as students ... there is still lots of data that can be
 *      visualized in a candidate view."
 */

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-26T10:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();
const dateAgo = (n: number) => new Date(NOW - n * DAY).toISOString().slice(0, 10);
const dateIn = (n: number) => new Date(NOW + n * DAY).toISOString().slice(0, 10);

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  id: 'k1', name: 'עינה נוימן', email: 'eina@example.com', courseId: 'c1',
  applicationDate: dateAgo(3), ...over,
} as Candidate);

const stu = (over: Partial<Student> = {}): Student => ({
  id: 's1', name: 'עינה נוימן', email: 'eina@example.com', courseId: 'c1', ...over,
} as Student);

const statusOf = (c: Candidate, enrolled = false) => candidateStatus({ candidate: c, enrolled, now: NOW });

// ── 1. the green-dot complaint ─────────────────────────────────────────────

test('THE BUG: a passed candidate whose student record was NOT created here still showed', () => {
  // This is the whole complaint. The old rule was `!!c.convertedToStudentId`, which is
  // only ever written by the candidates page's own conversion. A student created by the
  // Excel import, by Emma, or typed straight into the students page left the candidacy
  // unlinked — so the person sat in the applicants list forever, green.
  const c = cand({ interviewResult: 'passed' });          // note: no convertedToStudentId
  expect(c.convertedToStudentId).toBeUndefined();
  expect(isArchivedCandidate(c, [stu()])).toBe(true);
});

test('the stored link still wins when it is set', () => {
  const c = cand({ convertedToStudentId: 's9' });
  expect(isArchivedCandidate(c, [stu({ id: 's9', name: 'שם אחר', email: 'other@example.com' })])).toBe(true);
});

test('a link pointing at a deleted student falls through to identity, not to true', () => {
  const c = cand({ convertedToStudentId: 'gone' });
  expect(isArchivedCandidate(c, [])).toBe(false);
  expect(isArchivedCandidate(c, [stu()])).toBe(true); // same person, still enrolled
});

test('a candidate with no student record is NOT archived', () => {
  expect(isArchivedCandidate(cand(), [])).toBe(false);
  expect(isArchivedCandidate(cand(), [stu({ name: 'מישהו אחר', email: 'x@example.com' })])).toBe(false);
});

test('THE FALSE-POSITIVE BOUNDARY: the same person reapplying next year is not archived', () => {
  // The practicum runs annually and people reapply. Matching on name/email alone would
  // hide a live applicant behind their own record from a previous cohort — hiding
  // someone who still needs handling is the expensive direction of this mistake.
  const lastYear = stu({ id: 's-old', courseId: 'c0' });
  expect(isArchivedCandidate(cand({ courseId: 'c1' }), [lastYear])).toBe(false);
});

test('identity matches on email before name', () => {
  const byEmail = stu({ id: 's-email', name: 'שם שגוי' });
  expect(findStudentForCandidate([byEmail], cand())?.id).toBe('s-email');
});

test('identity matches on exact name when there is no email', () => {
  const c = cand({ email: undefined });
  expect(findStudentForCandidate([stu({ email: undefined })], c)?.id).toBe('s1');
  // ...but not on a partial name
  expect(findStudentForCandidate([stu({ name: 'עינה', email: undefined })], c)).toBeUndefined();
});

// ── 2. the rich view ───────────────────────────────────────────────────────

test('the journey states run in order, each naming the next action', () => {
  const cases: [Candidate, string, string | null][] = [
    [cand(), 'awaiting_docs', 'collect_docs'],
    [cand({ cvUrl: 'u', submittedAt: daysAgo(1) }), 'needs_interview', 'book_interview'],
    [cand({ cvUrl: 'u', interviewDate: dateIn(3) }), 'interview_scheduled', null],
    [cand({ cvUrl: 'u', interviewDate: dateAgo(2) }), 'interview_due', 'mark_conducted'],
    [cand({ cvUrl: 'u', interviewDate: dateAgo(2), interviewConducted: true, interviewConductedAt: daysAgo(2) }), 'awaiting_decision', 'decide'],
    [cand({ interviewResult: 'passed' }), 'passed_unconverted', 'convert'],
  ];
  for (const [c, key, action] of cases) {
    const st = statusOf(c);
    expect(st?.key, `${key}`).toBe(key);
    expect(st?.action?.id ?? null, `${key} action`).toBe(action);
  }
});

test('whose turn it is, is the point of the dot', () => {
  // Waiting on them is amber-ish "student"; anything overdue becomes ours and goes red.
  expect(statusOf(cand({ applicationDate: dateAgo(1) }))?.turn).toBe('student');
  expect(statusOf(cand({ applicationDate: dateAgo(DOCS_CHASE_DAYS + 1) }))?.turn).toBe('ours');

  const conducted = (d: number) => cand({ cvUrl: 'u', interviewDate: dateAgo(d), interviewConducted: true, interviewConductedAt: daysAgo(d) });
  expect(statusOf(conducted(1))?.turn).toBe('student');
  expect(statusOf(conducted(DECISION_DAYS + 1))?.turn).toBe('ours');
});

test('an enrolled candidate is closed — unless the acceptance email never went', () => {
  const passed = cand({ interviewResult: 'passed' });
  const unsent = statusOf(passed, true);
  expect(unsent?.key).toBe('acceptance_unsent');
  expect(unsent?.turn).toBe('ours');
  expect(unsent?.action?.id).toBe('send_acceptance');

  const done = statusOf(cand({ interviewResult: 'passed', acceptanceEmailSent: true }), true);
  expect(done?.key).toBe('enrolled');
  expect(done?.turn).toBe('closed');
  expect(done?.action).toBeNull();
});

test('a rejection is closed — unless its email never went', () => {
  const unsent = statusOf(cand({ interviewResult: 'failed', rejectionReason: 'חוסר התאמה' }));
  expect(unsent?.key).toBe('rejection_unsent');
  expect(unsent?.action?.id).toBe('send_rejection');

  const done = statusOf(cand({ interviewResult: 'failed', rejectionEmailSent: true, rejectionReason: 'חוסר התאמה' }));
  expect(done?.key).toBe('rejected');
  expect(done?.turn).toBe('closed');
  expect(done?.sub).toContain('חוסר התאמה');
});

test('rejection beats enrolment — a failed candidate is never read as a student', () => {
  // Order matters: a stale student record must not present a rejected person as enrolled.
  expect(statusOf(cand({ interviewResult: 'failed', rejectionEmailSent: true }), true)?.key).toBe('rejected');
});

test('the evaluation becomes chips — this is the data that had nowhere to show', () => {
  const chips = candidateChips(cand({
    cvUrl: 'https://x/cv.pdf', preferredArea: 'גיוס',
    evalCommitment: 'מצטיין', evalMotivation: 'נמוכה', evalEnglish: 'טובה',
    evalScore: 88,
    questionnaire: { studyTracks: 'תואר', gpa: '90', workHistory: 'כן' } as any,
  }));
  const by = (l: string) => chips.find(c => c.label === l);
  expect(by('קו״ח')?.tone).toBe('done');
  expect(by('קו״ח')?.fileRef).toBe('https://x/cv.pdf');
  expect(by('שאלון')?.value).toBe('3/9');
  expect(by('מחויבות')?.tone).toBe('good');   // top of its scale
  expect(by('מוטיבציה')?.tone).toBe('weak');  // bottom of its scale
  expect(by('אנגלית')?.tone).toBe('plain');   // middle
  expect(by('ציון')?.tone).toBe('good');
  expect(by('תחום מועדף')?.value).toBe('גיוס');
});

test('a missing document reads as missing, not as absent', () => {
  const chips = candidateChips(cand());
  expect(chips.find(c => c.label === 'קו״ח')?.tone).toBe('missing');
  expect(chips.find(c => c.label === 'שאלון')?.value).toBe('חסר');
});

test('an unrecognised scale value degrades to plain instead of throwing', () => {
  // These are free text in the data. A hand-typed value must still render.
  expect(scalePosition('משהו אחר', ['נמוך', 'גבוה'])).toBeNull();
  expect(scalePosition(undefined, ['נמוך', 'גבוה'])).toBeNull();
  const chips = candidateChips(cand({ evalCommitment: 'סביר' as any }));
  expect(chips.find(c => c.label === 'מחויבות')?.tone).toBe('plain');
});

test('questionnaireFilled counts only answers that carry text', () => {
  expect(questionnaireFilled(cand()).filled).toBe(0);
  expect(questionnaireFilled(cand({ questionnaire: { gpa: '  ', whyPracticum: 'כי' } as any })).filled).toBe(1);
});

test('every state carries chips, so opening a row is never empty', () => {
  for (const c of [cand(), cand({ interviewResult: 'passed' }), cand({ interviewResult: 'failed', rejectionEmailSent: true })]) {
    expect(statusOf(c)?.chips.length).toBeGreaterThan(0);
  }
});

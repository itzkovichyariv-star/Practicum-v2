/**
 * The candidate's status sentence — the applicants-page counterpart to
 * placementStatus.ts.
 *
 * Yariv 2026-08-22: "while they are candidates they don't have a rich view that is
 * similar to the one they have as students. Although the available data differs,
 * there is still lots of data that can be visualized in a candidate view."
 *
 * The students page works because one pure function turns the record into a
 * sentence, a whose-turn-is-it, and the single next action — and the row only
 * renders it. That architecture is what carries over; the data underneath is not
 * the same and is not forced to be. A candidate has no employers, no vacancy
 * slots and no CV dispatches. What a candidate does have, and what nothing was
 * showing, is an intake (CV, questionnaire), a booked interview, a structured
 * evaluation across five dimensions plus a score, and two outbound emails whose
 * sent-state is already tracked and never surfaced.
 *
 * The deliberate difference from placementStatus: `turn` here is only ours /
 * student / closed. There is no employer in this half of the process, and
 * inventing one would make the dot lie.
 */

import type { Candidate, Student } from './supabase';

export type CandidateTurn = 'ours' | 'student' | 'closed';

export type CandidateKey =
  | 'awaiting_docs'
  | 'needs_interview'
  | 'interview_scheduled'
  | 'interview_due'
  | 'awaiting_decision'
  | 'passed_unconverted'
  | 'acceptance_unsent'
  | 'enrolled'
  | 'rejected'
  | 'rejection_unsent';

export type CandidateChipTone = 'plain' | 'good' | 'weak' | 'missing' | 'done';

export type CandidateChip = {
  label: string;
  value: string;
  tone: CandidateChipTone;
  /** The STORED file reference, verbatim — usually `storage://bucket/path`.
   *  Deliberately not a URL: resolving one needs the Supabase client, and this module
   *  stays pure so it can be tested without it. The renderer calls viewableCvUrl.
   *  Handing this to an <a href> directly is what produced a blank tab. */
  fileRef?: string;
};

export type CandidateActionId =
  | 'collect_docs'
  | 'book_interview'
  | 'mark_conducted'
  | 'decide'
  | 'convert'
  | 'send_acceptance'
  | 'send_rejection';

export type CandidateAction = { id: CandidateActionId; label: string; short: string };

export type CandidateStatus = {
  key: CandidateKey;
  turn: CandidateTurn;
  headline: string;
  sub: string;
  chips: CandidateChip[];
  age: string;
  action: CandidateAction | null;
};

const DAY = 86_400_000;

/** Days a candidate may sit without documents before the row asks us to chase.
 *  Shorter than the placement clocks on purpose: this is one form and one file,
 *  not an employer's hiring decision. */
export const DOCS_CHASE_DAYS = 7;
/** Days after a conducted interview before an undecided candidate becomes ours. */
export const DECISION_DAYS = 5;

export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY));
}

const agoPhrase = (d: number | null): string =>
  d === null ? '' : d === 0 ? 'היום' : d === 1 ? 'אתמול' : `לפני ${d} ימים`;

/** Evidence of a submission, in any form it can take. Mirrors hasSubmitted in
 *  CandidatesPage — the public form sends no application FILE, only a questionnaire,
 *  so a file test would be false for every real candidate. */
export const hasSubmitted = (c: Candidate): boolean =>
  !!(c.cvUrl || c.applicationUrl || c.questionnaire || c.submittedAt);

const ACTIONS: Record<CandidateActionId, CandidateAction> = {
  collect_docs:    { id: 'collect_docs',    label: 'בקש/י מסמכים',           short: 'מסמכים' },
  book_interview:  { id: 'book_interview',  label: 'קבע/י ראיון',            short: 'ראיון' },
  mark_conducted:  { id: 'mark_conducted',  label: 'סמן/י שהראיון בוצע',     short: 'בוצע' },
  decide:          { id: 'decide',          label: 'רשום/י תוצאת ראיון',     short: 'תוצאה' },
  convert:         { id: 'convert',         label: 'העבר/י לסטודנטים',       short: 'העברה' },
  send_acceptance: { id: 'send_acceptance', label: 'שלח/י מייל קבלה',        short: 'קבלה' },
  send_rejection:  { id: 'send_rejection',  label: 'שלח/י מייל דחייה',       short: 'דחייה' },
};
const act = (id: CandidateActionId): CandidateAction => ({ ...ACTIONS[id] });

// ── the evaluation, as chips ────────────────────────────────────────────────
// Five ordered scales the interviewer already fills in and nothing ever displayed
// outside the editor. Ordered so "is this a strong candidate" is answerable at a
// glance instead of by opening the card.

const SCALES: { field: keyof Candidate; label: string; order: string[] }[] = [
  { field: 'evalCommitment',    label: 'מחויבות', order: ['נמוך', 'בינוני', 'גבוה', 'מצטיין'] },
  { field: 'evalMotivation',    label: 'מוטיבציה', order: ['נמוכה', 'בינונית', 'גבוהה', 'גבוהה מאוד'] },
  { field: 'evalCommunication', label: 'תקשורת',  order: ['חלשה', 'בינונית', 'טובה', 'מצוינת'] },
  { field: 'evalEnglish',       label: 'אנגלית',  order: ['בסיסית', 'טובה', 'טובה מאוד', 'שפת אם'] },
  { field: 'evalAcquaintance',  label: 'היכרות',  order: ['אין', 'מעט', 'טובה', 'רחבה'] },
];

/** Where a value sits on its own scale, 0..1, or null when unset or unrecognised.
 *  Unrecognised rather than crashing matters: these are free-text in the data and a
 *  value typed by hand must degrade to "shown, uncoloured", never to a thrown row. */
export function scalePosition(value: string | undefined, order: string[]): number | null {
  const v = (value || '').trim();
  if (!v) return null;
  const i = order.findIndex(o => o === v);
  return i < 0 ? null : i / (order.length - 1);
}

/** How many of the nine questionnaire answers actually carry text. */
export function questionnaireFilled(c: Candidate): { filled: number; total: number } {
  const q = c.questionnaire;
  const keys = ['studyTracks', 'gpa', 'workHistory', 'favRole', 'leastFavRole',
    'whyPracticum', 'whySuitable', 'persistence', 'expectations'] as const;
  if (!q) return { filled: 0, total: keys.length };
  return { filled: keys.filter(k => String((q as any)[k] ?? '').trim()).length, total: keys.length };
}

export function candidateChips(c: Candidate): CandidateChip[] {
  const chips: CandidateChip[] = [];

  chips.push({ label: 'קו״ח', value: c.cvUrl ? 'הוגש' : 'חסר',
    tone: c.cvUrl ? 'done' : 'missing', fileRef: c.cvUrl });

  const q = questionnaireFilled(c);
  chips.push({ label: 'שאלון', value: q.filled ? `${q.filled}/${q.total}` : 'חסר',
    tone: !q.filled ? 'missing' : q.filled === q.total ? 'done' : 'plain' });

  if (c.preferredArea?.trim()) {
    chips.push({ label: 'תחום מועדף', value: c.preferredArea.trim(), tone: 'plain' });
  }

  for (const s of SCALES) {
    const raw = String((c as any)[s.field] ?? '').trim();
    if (!raw) continue;
    const pos = scalePosition(raw, s.order);
    chips.push({ label: s.label, value: raw,
      tone: pos === null ? 'plain' : pos >= 0.66 ? 'good' : pos <= 0.33 ? 'weak' : 'plain' });
  }

  if (typeof c.evalScore === 'number' && Number.isFinite(c.evalScore)) {
    chips.push({ label: 'ציון', value: `${c.evalScore}/100`,
      tone: c.evalScore >= 80 ? 'good' : c.evalScore < 60 ? 'weak' : 'plain' });
  }

  return chips;
}

export type CandidateStatusInput = {
  candidate: Candidate;
  /** True when a student record already exists for this person — by the stored link
   *  OR by identity. The page owns that question; this function only consumes it. */
  enrolled: boolean;
  now?: number;
};

/**
 * One sentence, one turn, one next action.
 *
 * Read top-down: the states are in journey order, and the first one that matches
 * wins. An earlier state can therefore never be masked by a later one.
 */
export function candidateStatus(input: CandidateStatusInput): CandidateStatus | null {
  const { candidate: c, enrolled } = input;
  if (!c) return null;
  const now = input.now ?? Date.now();
  const chips = candidateChips(c);
  const result = c.interviewResult || 'pending';

  // ── closed states first: an enrolled or rejected candidate is not a queue item ──
  if (result === 'failed') {
    if (!c.rejectionEmailSent) {
      return {
        key: 'rejection_unsent', turn: 'ours',
        headline: 'לא התקבל/ה · מייל הדחייה טרם נשלח',
        sub: c.rejectionReason?.trim() || 'ללא סיבה רשומה',
        chips, age: agoPhrase(daysSince(c.interviewDate, now)), action: act('send_rejection'),
      };
    }
    return {
      key: 'rejected', turn: 'closed',
      headline: 'לא התקבל/ה',
      sub: c.rejectionReason?.trim() || 'ללא סיבה רשומה',
      chips, age: agoPhrase(daysSince(c.interviewDate, now)), action: null,
    };
  }

  if (enrolled) {
    // Converted, but the acceptance email is tracked and may never have gone. That
    // is a real open loop and the only reason an enrolled row still wants us.
    if (!c.acceptanceEmailSent) {
      return {
        key: 'acceptance_unsent', turn: 'ours',
        headline: 'הועבר/ה לסטודנטים · מייל הקבלה טרם נשלח',
        sub: 'הרשומה קיימת בסטודנטים — נותר רק לבשר למועמד/ת',
        chips, age: '', action: act('send_acceptance'),
      };
    }
    return {
      key: 'enrolled', turn: 'closed',
      headline: 'הועבר/ה לסטודנטים',
      sub: 'התהליך ממשיך בעמוד הסטודנטים',
      chips, age: '', action: null,
    };
  }

  if (result === 'passed') {
    return {
      key: 'passed_unconverted', turn: 'ours',
      headline: 'עבר/ה ראיון · טרם נוצרה רשומת סטודנט/ית',
      sub: 'ההעברה לסטודנטים היא מה שמוציא אותו/ה מרשימת המועמדים',
      chips, age: agoPhrase(daysSince(c.interviewDate, now)), action: act('convert'),
    };
  }

  // ── the interview ──────────────────────────────────────────────────────────
  const ivTs = c.interviewDate
    ? Date.parse(`${c.interviewDate}T${(c.interviewTime || '').split(/[-–]/)[0] || '23:59'}`)
    : NaN;
  const ivKnown = Number.isFinite(ivTs);

  if (c.interviewConducted) {
    const since = daysSince(c.interviewConductedAt || c.interviewDate, now);
    const overdue = (since ?? 0) > DECISION_DAYS;
    return {
      key: 'awaiting_decision', turn: overdue ? 'ours' : 'student',
      headline: `הראיון בוצע · ממתין להחלטה${since !== null ? ` — ${since} ימים` : ''}`,
      sub: overdue
        ? `מעל ${DECISION_DAYS} ימים ללא תוצאה — המועמד/ת ממתין/ה לתשובה`
        : 'יש לרשום עבר/לא התקבל כדי לסגור את המועמדות',
      chips, age: agoPhrase(since), action: act('decide'),
    };
  }

  if (ivKnown && ivTs > now) {
    const when = new Date(ivTs).toLocaleDateString('he-IL');
    return {
      key: 'interview_scheduled', turn: 'student',
      headline: `ראיון ב‑${when}${c.interviewTime ? ` · ${c.interviewTime}` : ''}`,
      sub: 'אין מה לעשות עד למועד',
      chips, age: '', action: null,
    };
  }

  if (ivKnown) {
    const since = daysSince(c.interviewDate, now);
    return {
      key: 'interview_due', turn: 'ours',
      headline: `מועד הראיון עבר${since ? ` — ${since} ימים` : ''} · טרם סומן שבוצע`,
      sub: 'סימון "ראיון בוצע" הוא מה שמעביר את הכרטיס להערכה',
      chips, age: agoPhrase(since), action: act('mark_conducted'),
    };
  }

  // ── before the interview ───────────────────────────────────────────────────
  const applied = daysSince(c.submittedAt || c.applicationDate, now);

  if (!hasSubmitted(c)) {
    const overdue = (applied ?? 0) > DOCS_CHASE_DAYS;
    return {
      key: 'awaiting_docs', turn: overdue ? 'ours' : 'student',
      headline: `טרם הוגשו מסמכים${applied !== null ? ` — ${applied} ימים` : ''}`,
      sub: overdue
        ? `מעל ${DOCS_CHASE_DAYS} ימים ללא הגשה — כדאי לפנות`
        : 'ממתין/ה לקו״ח ולשאלון המועמדות',
      chips, age: agoPhrase(applied), action: act('collect_docs'),
    };
  }

  return {
    key: 'needs_interview', turn: 'ours',
    headline: `מסמכים הוגשו${applied !== null ? ` ${agoPhrase(applied)}` : ''} · יש לקבוע ראיון`,
    sub: 'כל מה שנדרש להחלטה נמצא בכרטיס',
    chips, age: agoPhrase(applied), action: act('book_interview'),
  };
}

export const CANDIDATE_TURN_LABEL: Record<CandidateTurn, string> = {
  ours: 'אצלנו',
  student: 'אצל המועמד/ת',
  closed: 'סגור',
};

/** Same semantic tones the placement strip uses, so a coordinator reads one colour
 *  language across both pages. */
export const CANDIDATE_TURN_COLOR: Record<CandidateTurn, string> = {
  ours: '#b91c1c',
  student: '#b45309',
  closed: '#15803d',
};

// ── enrolment ──────────────────────────────────────────────────────────────
// Moved here from CandidatesPage so the rule is testable on its own. It answers
// the question the whole applicants list turns on: is this person already a student?

const normName = (n: string) => (n || '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The student record this candidate became, or undefined.
 *
 * `convertedToStudentId` is authoritative when it is set — but it is only ever
 * written by THIS page's conversion. A student who arrived any other way (the
 * Excel import, Emma, a record typed straight into the students page, data
 * carried over from v1) leaves the candidacy unlinked, and the candidate then
 * sits in the applicants list forever wearing a green dot.
 *
 * Yariv 2026-08-22: "once they passed the interview they move to the students
 * page and continue the process yet they stay in the candidate view marked with
 * green dot. I would think that once approved and moved to students view they
 * don't need to be viewed in the candidate view."
 *
 * So identity is the fallback, and it is deliberately narrow, because the cost of
 * a false match is hiding someone who still needs handling: the same course
 * (never merely the same name across years — the practicum runs annually and
 * people reapply), then email, then exact name. A stale link that points at a
 * deleted student does NOT count as enrolled; it falls through to identity.
 */
export function findStudentForCandidate(
  students: Student[],
  c: Pick<Candidate, 'convertedToStudentId' | 'email' | 'name' | 'courseId'>,
): Student | undefined {
  if (c.convertedToStudentId) {
    const linked = (students || []).find(s => s.id === c.convertedToStudentId);
    if (linked) return linked;
  }
  const sameCourse = (students || []).filter(s => s.courseId && c.courseId && s.courseId === c.courseId);
  const email = (c.email || '').trim().toLowerCase();
  if (email) {
    const byEmail = sameCourse.find(s => (s.email || '').trim().toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  const name = normName(c.name || '');
  return name ? sameCourse.find(s => normName(s.name) === name) : undefined;
}

/** Archived = a student record already exists for this candidate. Single source
 *  of truth for the toggle, the pool, the counts and the row's own marker, so
 *  "in the archive" can never mean one thing in the tab bar and another in the
 *  list — and, since the dashboard imports it too, not one thing on one screen
 *  and another on the next. Derived rather than stored, so there is no second
 *  field to keep in step. */
export const isArchivedCandidate = (c: Candidate, students: Student[]): boolean =>
  !!findStudentForCandidate(students, c);

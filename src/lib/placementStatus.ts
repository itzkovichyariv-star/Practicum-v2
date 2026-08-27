/**
 * Placement status — the ONE rule that says where a student stands, used by the
 * student-list strip and by anything that filters or reports on it.
 *
 * Design brief: docs/design/2026-08-09-placement-status-strip.md (approved by Yariv
 * 2026-08-09, all four decisions closed).
 *
 * Why a separate pure module: the list row, the turn filter and the gate cells must
 * never disagree about what a student's state is. One function, no I/O, no React —
 * the same input always yields the same sentence.
 *
 * The organising question is "אצל מי הכדור" (whose turn is it), because that is what
 * turns the roster into a work queue:
 *   ours     — we owe the next move
 *   student  — waiting on the student
 *   employer — sent, inside the waiting window
 *   closed   — placed, nothing to do
 *
 * TRAP (cost a wrong first draft): `submissionStatus === 'submitted'` does NOT mean a
 * preferences list was submitted — migratePlacementData() derives it from `cvUrl` alone,
 * so every תשפ״ז student carries it, several with no list at all. The ranked orgs must
 * come from buildUnifiedOrgList().
 */

import { buildUnifiedOrgList, countSlotsByStatus, type UnifiedOrgPref } from './placement';

/** The DEFAULT days of employer silence before the ball comes back to us, for a course
 *  that does not set its own `reviewAgingThresholdDays`.
 *
 *  14 — Yariv 2026-08-11, reversing the 7 he asked for on 2026-08-09. It also squares with
 *  the clocks below: three reminders at a 14-day cadence run to day 42, just inside the
 *  45-day window before an invitation is genuinely overdue.
 *
 *  (For the record, because a stale note in the log said otherwise and I repeated it: the
 *  card's ⏱ chip was NOT out of step at the time — it had already been switched to this
 *  constant on 2026-08-09. What was actually wrong is that the per-course field was
 *  editable in the settings UI and read by nothing.) */
export const SILENCE_DAYS = 14;

/** After an interview the answer comes FASTER, not slower — Yariv 2026-08-10, correcting
 *  me: "החודש וחצי זה עד שיש זימון לראיון, אחר כך הזמן הוא יותר מצומצם". I had applied
 *  the month and a half to the post-interview decision, which is backwards: the long
 *  wait is BEFORE the invitation. Once an interview has happened, a week is enough. */
export const DECISION_DAYS = 7;

/** The long one. An employer can genuinely take a month and a half to invite anyone to
 *  an interview, so "no answer" must not be declared while that is still normal. */
export const NO_RESPONSE_DAYS = 45;

/** Stop chasing after this many reminders and go quiet, rather than nag forever. Note
 *  this no longer decides when we give UP — it only caps the nudging. Giving up is
 *  NO_RESPONSE_DAYS, because 3 reminders at a 7-day cadence runs out around day 21,
 *  and abandoning an employer at 21 days would drop the ones still about to answer. */
export const MAX_REMINDERS = 3;

export type PlacementTurn = 'ours' | 'student' | 'employer' | 'closed';

export type PlacementKey =
  | 'placed'
  | 'submission_pending'
  | 'org_approval_pending'
  | 'suggested_org'
  | 'list_ready'
  | 'blocked_no_cv'
  | 'sent_stale'
  | 'interview_passed'
  | 'sent'
  | 'interview_scheduled'
  | 'awaiting_decision'
  | 'no_response'
  | 'exhausted'
  | 'not_submitted';

/** One ranked org, as it appears on the strip. `suggested` is marked by FORM (a dashed
 *  chip), never by a colour of its own — the turn colour has to stay readable. */
export type PlacementChip = {
  rank: number;
  orgName: string;
  suggested: boolean;
  tone: 'plain' | 'sent' | 'late' | 'dead' | 'pass';
  suffix: string;
  /** Can a CV actually go here right now? False when the course's places are all taken.
   *  Yariv 2026-08-09: "איקון גרופ תפוס כרגע והייתי מצפה שהמערכת תגיד שהבחירה הראשונה
   *  תפוסה על ידי סטודנט אחר … ומייד תעביר לבחירה השניה". */
  available: boolean;
  /** Why it is blocked, naming the student holding the place when we can. */
  blockedReason: string;
  /** True for the chip the row will act on unless the coordinator picks another. */
  recommended: boolean;
};

export type PlacementActionId =
  | 'adopt' | 'approve_org' | 'place_direct' | 'send_cv' | 'remind' | 'add_orgs' | 'unsend' | 'drop_org';

/** Every action states its consequence before it runs (Yariv 2026-08-09: "1 click opens
 *  a warning saying clicking will do..."). The copy is derived from what the real
 *  handlers do — see the brief's table — never from what they sound like they do. */
export type PlacementAction = {
  id: PlacementActionId;
  label: string;
  /** One word for the collapsed row. The full label + employer name stay in the
   *  confirmation, so the button never wraps to two lines on a phone. */
  short: string;
  warnTitle: string;
  warnBody: string;
  confirmLabel: string;
  /** true when the action does not exist in the app yet (only 'remind' today). */
  isNew?: boolean;
};

export type PlacementStatus = {
  key: PlacementKey;
  turn: PlacementTurn;
  headline: string;
  /** Secondary sentence — capacity, blockers, what the chips mean. */
  sub: string;
  chips: PlacementChip[];
  age: string;
  action: PlacementAction | null;
};

/** The latest /cv-update submission for this student, as read from `cv_updates`. */
export type CvSubmission = {
  id: string;
  uploaded_at: string;
  cv_file_path?: string | null;
  org_pref_1?: string | null;
  org_pref_2?: string | null;
  org_pref_3?: string | null;
};

export type PlacementInput = {
  student: any;
  employers: any[];
  dispatches: any[];
  /** Latest UNSEEN submission whose orgs/CV differ from the record, or null. */
  pending: CvSubmission | null;
  /** uploaded_at of the student's most recent submission of any kind, or null. */
  lastSubmissionAt?: string | null;
  /** All students, so a blocked place can name who is holding it. */
  allStudents?: any[];
  course?: any;
  now?: number;
};

const DAY = 86400000;

export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY));
}

function agoPhrase(days: number | null): string {
  if (days === null) return '';
  if (days === 0) return 'היום';
  if (days === 1) return 'אתמול';
  return `לפני ${days} ימים`;
}

function waitPhrase(days: number | null): string {
  if (days === null) return '';
  if (days === 0) return 'הוגשה היום';
  if (days === 1) return 'יום אחד בהמתנה';
  return `${days} ימים בהמתנה`;
}

/** "ל‑2 מקומות" / "למקום אחד" — the wording Yariv asked for, with the singular fixed. */
export function placesPhrase(n: number): string {
  return n === 1 ? 'למקום אחד' : `ל‑${n} מקומות`;
}

/**
 * WHERE the CV went, by name.
 *
 * Yariv 2026-08-27: "אני רוצה לראות את שם הארגון אליו זה נשלח במסך הראשי מבלי להכנס
 * לכרטיס הסטודנט."
 *
 * The headline counted places — "למקום אחד" — while the names sat in the chips, which
 * are collapsed by default. So the one fact he needs while scanning eighty rows was the
 * one fact behind an expander. A count answers a question nobody asks; on a list, the
 * name IS the status.
 *
 * The name goes FIRST, right after "קו״ח נשלחו", because a collapsed headline is
 * truncated with an ellipsis — whatever leads survives, and everything after it may not.
 * Past two organizations it degrades to "and N more" rather than growing without bound
 * and pushing the days-waiting off the end of the line.
 */
export function sentToPhrase(orgNames: (string | null | undefined)[]): string {
  const names = (orgNames || []).map(n => String(n ?? '').trim()).filter(Boolean);
  if (!names.length) return placesPhrase(orgNames?.length || 0);
  if (names.length === 1) return `ל‑${names[0]}`;
  if (names.length === 2) return `ל‑${names[0]} ו‑${names[1]}`;
  return `ל‑${names[0]} ועוד ${names.length - 1}`;
}

const norm = (s: any) => String(s ?? '').trim().toLowerCase();

/** An org the student brought themselves: private to them, and the coordinator's move is
 *  a conversation + approval (= placement), NOT a CV send. OrgHub models this as
 *  `place_direct`; the strip has to speak the same way (Yariv 2026-08-09). */
function isSuggestedOrg(pref: UnifiedOrgPref, employers: any[], studentId: string): boolean {
  const emp = pref.employerId
    ? (employers || []).find((e: any) => e?.id === pref.employerId)
    : (employers || []).find((e: any) => norm(e?.name) === norm(pref.orgName));
  return !!emp && emp.restrictedToStudentId === studentId;
}

/**
 * Does the unread submission carry ORGS we haven't taken in yet?
 *
 * Only positions the student actually filled count. A CV-only submission leaves all
 * three org fields empty, and a naive field-by-field comparison reads that emptiness as
 * "different from the record" — which is how הדר עוזירי (a real case, 2026-08-09) came
 * out as "a list is waiting" when her list had been adopted weeks earlier and only a new
 * CV was pending. An empty form must never outrank a live placement state.
 */
function pendingHasNewOrgs(pending: CvSubmission | null, student: any): boolean {
  if (!pending) return false;
  const sub = [pending.org_pref_1, pending.org_pref_2, pending.org_pref_3].map(norm).filter(Boolean);
  if (sub.length === 0) return false;
  const rec = [student?.firstChoiceOrg, student?.secondChoiceOrg, student?.thirdChoiceOrg].map(norm).filter(Boolean);
  return sub.some(o => !rec.includes(o));
}

/** A newer CV file than the one on the record — compared by filename, the way
 *  StudentEditor's own pending check does it. */
function pendingHasNewCv(pending: CvSubmission | null, student: any): boolean {
  if (!pending) return false;
  const incoming = String(pending.cv_file_path || '').split('/').pop() || '';
  if (!incoming) return false;
  const current = String(student?.cvUpdatedUrl || '').split('/').pop() || '';
  return incoming !== current;
}

const ACTIONS: Record<PlacementActionId, Omit<PlacementAction, 'label'> & { label: string }> = {
  adopt: {
    id: 'adopt', short: 'קלוט', label: 'קלוט לכרטיס', confirmLabel: 'קלוט לכרטיס',
    warnTitle: 'קליטת ההגשה לכרטיס',
    warnBody: 'רשימת ההעדפות והקו״ח המעודכנים מההגשה יועתקו לכרטיס הסטודנט/ית, וההגשה תסומן כטופלה ולא תופיע יותר כממתינה. לא נשלחת שום הודעה — לא לסטודנט/ית ולא למעסיק.',
  },
  approve_org: {
    id: 'approve_org', short: 'אשר ארגון', label: 'בדוק ואשר ארגון', confirmLabel: 'פתח כרטיס לאישור',
    warnTitle: 'אישור ארגון שהוצע',
    // This one does NOT approve from the row, and used to say that it did — the same lie
    // place_direct told (Yariv 2026-08-11: "ניכר ששום כפתור לא באמת עבד מחוץ למערכת").
    // Here the card really is the right place: approving an org the student proposed
    // means checking it and speaking to the employer first, not one click from a list.
    warnBody: 'ייפתח כרטיס הסטודנט/ית במקטע הארגונים, כדי לבדוק את הארגון ולאשר אותו שם. האישור עצמו נעשה בכרטיס — לא מכאן — ולא מתבצע שום שינוי בנתונים בלחיצה הזו.',
  },
  place_direct: {
    id: 'place_direct', short: 'אשר השמה', label: 'אשר השמה', confirmLabel: 'אשר השמה',
    warnTitle: 'אישור השמה ישירה',
    warnBody: 'הסטודנט/ית יירשם/תירשם כמשובץ/ת בארגון, ייתפס מקום בארגון, ותאריך ההשמה יירשם כהיום. לא נשלחים קו״ח ולא נשלחת הודעה לאף אחד.\n⚠ שאר הארגונים בדירוג יישארו פתוחים — יש לבטל אותם מול המעסיקים מתוך הכרטיס.',
  },
  send_cv: {
    id: 'send_cv', short: 'שלח', label: 'שלח קו״ח', confirmLabel: 'המשך לשליחה',
    warnTitle: 'שליחת קו״ח למעסיק',
    warnBody: 'ייתפס מקום בארגון והסטטוס יעבור ל"ממתין לתשובת המעסיק". לאחר מכן ייפתח חלון WhatsApp או מייל עם ההודעה המוכנה — ההודעה נשלחת רק אחרי שתלחץ/י «שלח» שם, לא מכאן.',
  },
  remind: {
    id: 'remind', short: 'תזכר', label: 'תזכר מעסיק', confirmLabel: 'פתח תזכורת',
    warnTitle: 'תזכורת למעסיק שטרם ענה',
    warnBody: 'ייפתח חלון WhatsApp או מייל עם תזכורת מוכנה — נוסח קצר שמזכיר מי המועמד/ת וכמה זמן עבר. המקום בארגון כבר תפוס ולא ייתפס שוב. ההודעה נשלחת רק אחרי שתלחץ/י «שלח» שם, ורק אישור שלך מפעיל מחדש את השעון.',
  },
  unsend: {
    id: 'unsend', short: 'בטל שליחה', label: 'לא נשלח — החזר לרשימה', confirmLabel: 'שחרר והחזר לרשימה',
    warnTitle: 'ההודעה לא נשלחה בפועל',
    warnBody: 'המקום בארגון ישוחרר, והארגון יחזור לרשימה כ"טרם נשלח" כדי שאפשר יהיה לשלוח שוב. רישום השליחה יסומן כבוטל ויישאר בהיסטוריה. לא נשלחת שום הודעה למעסיק.',
  },
  drop_org: {
    id: 'drop_org', short: 'הסר', label: 'הסר מהדירוג', confirmLabel: 'הסר מהדירוג',
    warnTitle: 'הסרת ארגון מהדירוג',
    warnBody: 'הארגון יוסר מרשימת ההעדפות של הסטודנט/ית, ושאר הבחירות ימוספרו מחדש. אם הוא החזיק מקום — המקום ישוחרר. לא נשלחת שום הודעה. אפשר להוסיף אותו שוב מהכרטיס בכל שלב.',
  },
  add_orgs: {
    id: 'add_orgs', short: 'הוסף', label: 'הוסף ארגונים', confirmLabel: 'פתח כרטיס',
    warnTitle: 'הוספת ארגונים לדירוג',
    warnBody: 'ייפתח כרטיס הסטודנט/ית במקטע הארגונים, כדי להוסיף ארגונים חדשים לדירוג. לא מתבצע שום שינוי בנתונים.',
  },
};

const act = (id: PlacementActionId): PlacementAction => ({ ...ACTIONS[id] });

/** The action catalogue, for callers that offer an action the state itself does not
 *  carry — the per-organization undo on a sent chip, for instance. */
export const ACTION_BY_ID = ACTIONS;

/**
 * The actions available for ONE ranked org, which depend on how it got there
 * (Yariv 2026-08-09):
 *   · an org the student brought   → אשר השמה (approval IS the placement) OR שלח קו״ח,
 *                                    for the less common case where the employer asks.
 *   · an org from the shared list  → שלח קו״ח only. Placement there follows a passed
 *                                    interview, it is never the coordinator's first move.
 */
export function actionsForChip(chip: { suggested: boolean }): PlacementAction[] {
  return chip.suggested ? [act('place_direct'), act('send_cv')] : [act('send_cv')];
}

/** Courses with no placement route at all (`type: 'other'` — מיומנויות ייעוץ, ניהול
 *  משאבי אנוש) get no strip: 53 of 83 students, for whom it would be pure noise.
 *  Yariv 2026-08-09, confirming the scope of "always". */
export function isPlacementCourse(course: any): boolean {
  if (!course) return false;
  return (course.type ?? 'practicum') === 'practicum';
}

export function placementStatus(input: PlacementInput): PlacementStatus | null {
  const { student, employers = [], dispatches = [], pending = null, course, now = Date.now() } = input;
  // A course may set its own patience. The field has been editable in the course settings
  // all along and read by NOTHING — a control that claims an effect and has none, which is
  // the same defect as a button that says it placed someone and does not. Honoured here,
  // and by the card's ⏱ chip, so the two still agree with each other per course.
  const silenceDays = Number((course as any)?.reviewAgingThresholdDays) || SILENCE_DAYS;
  if (!student) return null;
  if (!isPlacementCourse(course)) return null;

  const list = buildUnifiedOrgList(student, employers);
  const suggested = list.filter(p => isSuggestedOrg(p, employers, student.id));
  const suggestedNames = new Set(suggested.map(p => norm(p.orgName)));
  const isSug = (p: UnifiedOrgPref) => suggestedNames.has(norm(p.orgName));

  const sent = list.filter(p => p.status === 'under_review');
  const tentative = list.filter(p => p.status === 'tentative');
  const tentativeList = tentative.filter(p => !isSug(p));
  const tentativeSuggested = tentative.filter(p => isSug(p));
  const rejected = list.filter(p => p.status === 'rejected' || p.status === 'withdrawn');
  const passed = list.filter(p => p.interviewResult === 'passed' && p.status !== 'rejected');

  /** The pending dispatch for this preference, newest first. */
  const dispatchFor = (p: UnifiedOrgPref): any =>
    (dispatches || [])
      .filter((x: any) => x.studentId === student.id && x.result === 'pending'
        && (p.slotId ? x.slotId === p.slotId : norm(x.employerId) === norm(p.employerId)))
      .sort((a: any, b: any) => String(b.sentAt).localeCompare(String(a.sentAt)))[0];

  /** Days since the CV itself went out. This is what a chip's "נשלח לפני X" reports,
   *  and it must NOT move when a reminder is sent — the CV left when it left. */
  const sentDays = (p: UnifiedOrgPref): number | null => {
    const d = dispatchFor(p);
    return d ? daysSince(d.sentAt, now) : null;
  };

  /** Days of SILENCE — since we last made contact, a confirmed reminder included.
   *  This is the clock that decides whether it is our turn to chase again.
   *
   *  Yariv 2026-08-26: "it is not updated, stays in תזכר mode after reminder was
   *  submitted." Confirming a reminder wrote `remindedAt` and bumped `reminders`, but
   *  nothing read `remindedAt` — staleness was measured from `sentAt` alone, so the row
   *  went straight back to "תזכר" and stayed there until MAX_REMINDERS. The confirm bar
   *  promises "השעון יתחיל מחדש" in so many words; this is the clock it meant. */
  const quietDays = (p: UnifiedOrgPref): number | null => {
    const d = dispatchFor(p);
    if (!d) return null;
    const lastTouch = d.remindedAt && String(d.remindedAt) > String(d.sentAt) ? d.remindedAt : d.sentAt;
    return daysSince(lastTouch, now);
  };

  // Who is holding this employer's places for THIS course, and is one free?
  const capacityOf = (p: UnifiedOrgPref): { free: boolean; reason: string } => {
    const emp = (employers || []).find((e: any) => e?.id === p.employerId)
      || (employers || []).find((e: any) => norm(e?.name) === norm(p.orgName));
    if (!emp) return { free: false, reason: 'לא זוהה מעסיק' };
    // A place already reserved for THIS student is free to use for this student.
    if (p.slotId) return { free: true, reason: '' };
    const cap = countSlotsByStatus(emp, student.courseId);
    if (cap.total === 0) return { free: false, reason: 'לא הוגדרו מקומות בקורס' };
    if (cap.available > 0) return { free: true, reason: '' };
    // Name the student occupying it — that is the fact that explains the block.
    const holderSlot = ((emp as any).vacancySlots || [])
      .filter((sl: any) => sl.courseId === student.courseId && sl.studentId && sl.studentId !== student.id)
      .find((sl: any) => sl.status === 'under_review' || sl.status === 'placed' || sl.status === 'tentative');
    const holder = holderSlot ? (input.allStudents || []).find((x: any) => x.id === holderSlot.studentId) : null;
    if (holder?.name) {
      return { free: false, reason: holderSlot.status === 'placed'
        ? `תפוס — ${holder.name} שובץ/ה שם`
        : `תפוס — ${holder.name} בתהליך שם` };
    }
    return { free: false, reason: 'אין מקום פנוי בקורס' };
  };

  const chipFor = (p: UnifiedOrgPref, tone: PlacementChip['tone'], suffix = ''): PlacementChip => {
    const cap = capacityOf(p);
    return {
      rank: p.rank, orgName: p.orgName, suggested: isSug(p), tone,
      // A not-yet-sent chip always says where it stands, in every state — "טרם נשלח" when
      // there is a place, and WHY when there is not. This used to be set only in the
      // already-sent branch, so before any CV went out a full organization looked exactly
      // like an open one on the chip: the very thing Yariv reported on 2026-08-10 ("כתוב
      // של‑1 עדיין לא נשלח אבל זה לא נשלח כי אין מקום"), fixed then for one branch only.
      // Callers that pass their own suffix (נשלח לפני X, נדחה, בוטל) still win.
      suffix: suffix || (tone === 'plain' ? (cap.free ? 'טרם נשלח' : cap.reason || 'לא ניתן לשלוח') : ''),
      available: cap.free, blockedReason: cap.reason, recommended: false,
    };
  };

  const waitDays = daysSince(input.lastSubmissionAt ?? null, now);

  // ── 1. placed — nothing to chase ────────────────────────────────────────────
  if (student.acceptedOrg || list.some(p => p.status === 'placed')) {
    const org = student.acceptedOrg || list.find(p => p.status === 'placed')?.orgName || '';
    const when = student.placedAt ? new Date(student.placedAt).toLocaleDateString('he-IL') : '';
    return {
      key: 'placed', turn: 'closed',
      headline: `שובץ/ה ב‑${org}${when ? ` · ${when}` : ''}`,
      sub: student.feedbackSubmittedAt ? 'התקבל משוב מעסיק' : 'ממתין למשוב מעסיק',
      chips: [], age: '', action: null,
    };
  }

  // ── 2. a submission is sitting unread ──────────────────────────────────────
  // New ORGS take the row over — that is the state Yariv asked for, and the one that
  // silently strands students today. A new CV ALONE does not: it is clerical, it blocks
  // nothing on the self-suggested route, and letting it win would mask a live placement
  // action. It rides along as a note on whatever state is really active (see cvNote).
  const newOrgs = pendingHasNewOrgs(pending, student);
  const newCv = pendingHasNewCv(pending, student);
  const cvNote = newCv && pending
    ? `ממתין גם קו״ח מעודכן חדש לקליטה (${agoPhrase(daysSince(pending.uploaded_at, now))})`
    : '';
  const withCvNote = (sub: string) => [sub, cvNote].filter(Boolean).join(' · ');

  if (pending && (newOrgs || (newCv && !student.cvUpdatedUrl))) {
    const orgs = [pending.org_pref_1, pending.org_pref_2, pending.org_pref_3].filter(Boolean) as string[];
    const d = daysSince(pending.uploaded_at, now);
    return {
      key: 'submission_pending', turn: 'ours',
      headline: newOrgs
        ? 'רשימת העדפות התקבלה — יש לקלוט לכרטיס'
        : 'קו״ח מעודכנים התקבלו — יש לקלוט לכרטיס',
      sub: newOrgs ? `${orgs.length} ארגונים בהגשה · טרם נקלטו` : 'ההגשה טרם נקלטה',
      chips: orgs.map((o, i) => ({ rank: i + 1, orgName: o, suggested: false, tone: 'plain' as const, suffix: '' })),
      age: `הוגשה ${agoPhrase(d)}`,
      action: act('adopt'),
    };
  }

  // ── 3. the student proposed a new employer we haven't vetted ────────────────
  const pendingEmp = (employers || []).find((e: any) =>
    e?.restrictedToStudentId === student.id && e?.approvalStatus === 'pending');
  if (pendingEmp) {
    return {
      key: 'org_approval_pending', turn: 'ours',
      headline: 'הצעת ארגון חדש — יש לבדוק ולאשר את הארגון',
      sub: withCvNote([pendingEmp.contactPerson && `איש קשר: ${pendingEmp.contactPerson}`, 'הוצע ע״י הסטודנט/ית']
        .filter(Boolean).join(' · ')),
      chips: [{ rank: 1, orgName: pendingEmp.name, suggested: true, tone: 'plain', suffix: '' }],
      age: waitPhrase(waitDays),
      action: act('approve_org'),
    };
  }

  // ── 4. CVs are out with employers ───────────────────────────────────────────
  if (sent.length > 0) {
    const ages = sent.map(p => ({ p, d: sentDays(p), q: quietDays(p) }));
    const maxOf = (pick: (x: { d: number | null; q: number | null }) => number | null) =>
      ages.reduce<number | null>((m, x) => { const v = pick(x); return v === null ? m : (m === null ? v : Math.max(m, v)); }, null);
    /** How long the CV has been out — what the user is told, and what "no answer" means. */
    const oldest = maxOf(x => x.d);
    /** How long we have been quiet — what decides whether it is our turn to chase. */
    const oldestQuiet = maxOf(x => x.q);
    // Tone follows the SILENCE clock so an org reminded yesterday stops reading as late,
    // while the label keeps reporting when the CV actually went out.
    const sentChips = ages.map(({ p, d, q }) =>
      chipFor(p, q !== null && q > silenceDays ? 'late' : 'sent', d === null ? '' : `נשלח ${agoPhrase(d)}`));
    // A not-yet-sent org must say WHY. "טרם נשלח" on a full organization reads as an
    // oversight when it is actually blocked — Yariv 2026-08-10: "כתוב של‑1 עדיין לא
    // נשלח אבל זה לא נשלח כי אין מקום ולכן נשלח ל‑2".
    const waitingChips = tentative.map(p => {
      const c = chipFor(p, 'plain', '');
      return { ...c, suffix: c.available ? 'טרם נשלח' : c.blockedReason || 'לא ניתן לשלוח' };
    });
    // RANK ORDER, always. Grouping by status put #2 above #1 and made the ranking look
    // wrong (same report). The rank is the student's stated preference — never reorder it.
    const allChips = [...sentChips, ...waitingChips].sort((a, b) => a.rank - b.rank);
    // Sending is still possible while earlier sends are outstanding, as long as some
    // ranked org actually has a free place. Without this the row offered no way to send
    // the remaining choices once the first CV went out.
    const stillSendable = waitingChips.filter(c => c.available);
    if (stillSendable.length) stillSendable[0].recommended = true;
    const sendAction = stillSendable.length ? act('send_cv') : null;
    // ── stage, not just elapsed days ────────────────────────────────────────
    // One 7-day clock shouted "no reply" straight through a scheduled interview.
    // Each stage now has its own (Yariv 2026-08-10).
    const ivDate = String(student.placementInterviewDate || '').trim();
    const ivTs = ivDate ? Date.parse(`${ivDate}T${student.placementInterviewTime || '23:59'}`) : NaN;
    const ivKnown = Number.isFinite(ivTs);
    const ivFuture = ivKnown && ivTs > now;
    const ivPast = ivKnown && ivTs <= now;
    const sinceIv = ivPast ? Math.floor((now - ivTs) / DAY) : null;
    const pendingForStudent = (dispatches || [])
      .filter((d: any) => d.studentId === student.id && d.result === 'pending');
    const remindersSent = Math.max(0, ...pendingForStudent.map((d: any) => d.reminders || 0), 0);
    const exhaustedReminders = remindersSent >= MAX_REMINDERS;
    /** Days since the last confirmed reminder to ANY of this student's employers, or
     *  null if none was sent. The post-interview clock needs it for the same reason the
     *  silence clock does: chasing has to count as contact, or the row never settles. */
    const lastRemindedAt = pendingForStudent
      .map((d: any) => d.remindedAt).filter(Boolean).sort().pop();
    const sinceRemind = lastRemindedAt ? daysSince(lastRemindedAt, now) : null;

    // Stage 2 — an interview is booked. Silent until the date arrives.
    if (ivFuture) {
      const when = new Date(ivTs).toLocaleDateString('he-IL');
      return {
        key: 'interview_scheduled', turn: 'employer',
        headline: `ראיון ב‑${student.placementInterviewOrg || sent[0]?.orgName || ''} · ${when}`,
        sub: withCvNote(`אין מה לעשות עד לראיון${student.placementInterviewTime ? ` (${student.placementInterviewTime})` : ''}`),
        chips: allChips, age: '', action: sendAction,
      };
    }

    // Stage 3 — the interview happened and no decision has been recorded.
    if (ivPast) {
      // Overdue only if BOTH the interview and our last nudge are past the decision
      // window — a reminder sent yesterday means the ball is back with the employer.
      const overdue = (sinceIv ?? 0) > DECISION_DAYS && (sinceRemind === null || sinceRemind > DECISION_DAYS);
      if (exhaustedReminders) {
        return {
          key: 'no_response', turn: 'ours',
          headline: `אין מענה מ‑${student.placementInterviewOrg || sent[0]?.orgName || 'המעסיק'} אחרי ${MAX_REMINDERS} תזכורות`,
          sub: withCvNote('כדאי להתקדם לבחירה הבאה או להציע ארגון אחר'),
          chips: allChips, age: '', action: sendAction || act('add_orgs'),
        };
      }
      return {
        key: 'awaiting_decision', turn: overdue ? 'ours' : 'employer',
        headline: `הראיון התקיים · ממתין להחלטה${sinceIv !== null ? ` — ${sinceIv} ימים` : ''}`,
        sub: withCvNote(overdue
          ? `מעל ${DECISION_DAYS} ימים מהראיון — כדאי לתזכר${remindersSent ? ` (נשלחו ${remindersSent})` : ''}`
          : `אחרי ראיון ההחלטה מגיעה מהר יחסית. תזכורת אחרי ${DECISION_DAYS} ימים.`),
        chips: allChips, age: '', action: overdue ? act('remind') : sendAction,
      };
    }

    // Two different questions, two different clocks. "Should we chase?" resets when we
    // chase — otherwise a confirmed reminder changes nothing and the row nags forever.
    // "Has this gone on too long?" does NOT reset: an employer sitting on a CV for
    // NO_RESPONSE_DAYS is out of road whether or not we nudged them yesterday.
    const stale = oldestQuiet !== null && oldestQuiet > silenceDays;
    const abandoned = oldest !== null && oldest > NO_RESPONSE_DAYS;

    // Stage 1 is the LONG one: an invitation to interview can take a month and a half
    // (Yariv 2026-08-10). Only silence past that is really silence.
    if (abandoned) {
      return {
        key: 'no_response', turn: 'ours',
        headline: `אין מענה כבר ${oldest} ימים — מעל ${NO_RESPONSE_DAYS} הימים הצפויים לזימון לראיון`,
        sub: withCvNote('כדאי להתקדם לבחירה הבאה או להציע ארגון אחר'),
        chips: allChips, age: '', action: sendAction || act('add_orgs'),
      };
    }

    // Chased to exhaustion but still inside the normal window: stop nagging, and stop
    // asking US to do anything — but do NOT call it dead. Giving up here (around day 21)
    // would abandon exactly the employers who were still going to answer.
    if (stale && exhaustedReminders) {
      return {
        key: 'sent', turn: 'employer',
        headline: `קו״ח נשלחו ${sentToPhrase(sent.map(p => p.orgName))} · ${oldest} ימים ללא תשובה`,
        sub: withCvNote(`נשלחו ${MAX_REMINDERS} תזכורות — זימון לראיון יכול לקחת עד ${NO_RESPONSE_DAYS} ימים. אין מה לעשות בינתיים.`),
        chips: allChips, age: '', action: sendAction,
      };
    }

    if (stale) {
      return {
        key: 'sent_stale', turn: 'ours',
        headline: `קו״ח נשלחו ${sentToPhrase(sent.map(p => p.orgName))} · ${oldest} ימים ללא תשובה`,
        sub: withCvNote(`מעל סף ההמתנה (${silenceDays} ימים) — כדאי לתזכר את המעסיקים`),
        chips: allChips, age: '', action: act('remind'),
      };
    }
    if (passed.length > 0) {
      const p0 = passed[0];
      return {
        key: 'interview_passed', turn: 'employer',
        headline: `עבר/ה ראיון ב‑${p0.orgName} — ממתין להחלטת המעסיק`,
        sub: withCvNote(`קו״ח נשלחו ${sentToPhrase(sent.map(p => p.orgName))}`),
        chips: allChips.map(c => (norm(c.orgName) === norm(p0.orgName) ? { ...c, tone: 'pass' as const } : c)),
        age: '', action: sendAction,
      };
    }
    const blockedWaiting = waitingChips.filter(c => !c.available);
    return {
      key: 'sent', turn: 'employer',
      headline: `קו״ח נשלחו ${sentToPhrase(sent.map(p => p.orgName))} · ממתין לתשובת המעסיק`,
      sub: withCvNote(
        stillSendable.length ? `אפשר לשלוח גם לבחירה ${stillSendable[0].rank}: ${stillSendable[0].orgName}`
        : blockedWaiting.length ? blockedWaiting.map(c => `בחירה ${c.rank} (${c.orgName}) ${c.blockedReason}`).join(' · ')
        : ''),
      chips: allChips, age: '', action: sendAction,
    };
  }

  // ── 5. an org the student brought — talk and approve, never "send CV" ───────
  if (tentativeSuggested.length > 0) {
    const s0 = tentativeSuggested[0];
    const emp = (employers || []).find((e: any) => e?.id === s0.employerId || norm(e?.name) === norm(s0.orgName));
    const alsoList = tentativeList.length;
    return {
      key: 'suggested_org', turn: 'ours',
      headline: alsoList
        ? `ארגון בהצעת הסטודנט/ית — לשוחח ולאשר · ועוד ${alsoList} מהרשימה — לשלוח קו״ח`
        : 'ארגון בהצעת הסטודנט/ית — יש לשוחח עם המעסיק ולאשר',
      sub: withCvNote([emp?.contactPerson && `איש קשר: ${emp.contactPerson}`, 'אישור = השמה, ללא שליחת קו״ח']
        .filter(Boolean).join(' · ')),
      // The suggested org leads — the shortest route to a placement (decision ד).
      chips: [...tentativeSuggested.map(p => chipFor(p, 'plain', '')),
              ...tentativeList.map(p => chipFor(p, 'plain', ''))],
      age: waitPhrase(waitDays),
      action: act('place_direct'),
    };
  }

  // ── 6. a list is ready to go out ────────────────────────────────────────────
  if (tentativeList.length > 0) {
    const listChips = tentativeList.map(p => chipFor(p, 'plain', ''));
    // Mark the choice the row will act on: the highest-ranked one that actually has a
    // free place. Without this the coordinator cannot tell which employer a send would
    // reach, and a full first choice looks identical to an open one (Yariv 2026-08-09).
    const firstFree = listChips.find(c => c.available);
    if (firstFree) firstFree.recommended = true;
    const blockedAbove = listChips.filter(c => !c.available && c.rank < (firstFree?.rank ?? Infinity));

    if (!student.cvUpdatedUrl) {
      return {
        key: 'blocked_no_cv', turn: 'student',
        headline: 'רשימת העדפות נשלחה — חסר קו״ח מעודכן',
        sub: withCvNote('לא ניתן לשלוח למעסיק עד לקבלת קו״ח · יש לפנות לסטודנט/ית'),
        chips: listChips, age: waitPhrase(waitDays), action: null,
      };
    }

    // No free place anywhere on the list — that is its own dead end, not a "send" state.
    if (!firstFree) {
      return {
        key: 'list_ready', turn: 'ours',
        headline: 'כל הארגונים בדירוג תפוסים כרגע',
        sub: withCvNote(listChips.map(c => `${c.orgName}: ${c.blockedReason}`).join(' · ')
          + ' — יש להציע ארגון נוסף או להמתין לשחרור מקום'),
        chips: listChips, age: waitPhrase(waitDays), action: act('add_orgs'),
      };
    }

    const blockedNote = blockedAbove.length
      ? blockedAbove.map(c => `בחירה ${c.rank} (${c.orgName}) ${c.blockedReason}`).join(' · ')
        + ` — מוצע לשלוח לבחירה ${firstFree.rank}: ${firstFree.orgName}`
      : `${tentativeList.length} ארגונים בדירוג · טרם נשלחו קו״ח`;

    return {
      key: 'list_ready', turn: 'ours',
      headline: 'רשימת העדפות נשלחה — יש לטפל מול המעסיק',
      sub: withCvNote(blockedNote),
      chips: listChips, age: waitPhrase(waitDays), action: act('send_cv'),
    };
  }

  // ── 7. the list is spent ────────────────────────────────────────────────────
  if (rejected.length > 0) {
    return {
      key: 'exhausted', turn: 'ours',
      headline: `נדחה/תה ${placesPhrase(rejected.length)} — יש להציע ארגונים חדשים`,
      sub: withCvNote('לא נותרו ארגונים פעילים בדירוג'),
      chips: rejected.map(p => chipFor(p, 'dead', p.status === 'withdrawn' ? 'בוטל' : 'נדחה')),
      age: '', action: act('add_orgs'),
    };
  }

  // ── 8. nothing yet ──────────────────────────────────────────────────────────
  return {
    key: 'not_submitted', turn: 'student',
    headline: student.cvUpdatedUrl
      ? 'קו״ח מעודכנים התקבלו — טרם נבחרו ארגונים'
      : 'טרם הוגשו קו״ח מעודכנים והעדפות',
    sub: withCvNote(student.preparation?.passed ? 'עבר/ה הכנה · הקישור נשלח' : 'טרם עבר/ה הכנה'),
    chips: [], age: '', action: null,
  };
}

/**
 * Which organizations an action is about, once the confirmation is accepted.
 *
 * Yariv 2026-08-26: "רציתי לשחרר את הארגון והכפתור לא עובד ... לא עושה כלום", and
 * separately "אפשר לשנות את הסטטוס ... מתוך הכרטיס אבל לא מחוצה לו". One cause.
 *
 * Two kinds of action reach the same dialog and they name their target differently:
 *
 *   per-chip  — ✕ drop_org and ↻ unsend. The chip that was clicked IS the target, and
 *               it is stamped onto the action at click time.
 *   row-level — send_cv and place_direct. The target is whatever the coordinator
 *               ticked, which is why the strip keeps a selection at all.
 *
 * The dialog used to overwrite `targetOrg` with the ticked selection unconditionally.
 * But the strip only builds a selection when the ROW's action is send_cv/place_direct
 * (see `targets`), so on any other row — one asking to remind, say — the selection is
 * empty, the stamped org was replaced by undefined, and the handler's `if (!orgName)
 * return` swallowed the click. The button was wired the whole way down and lost its
 * argument on the last step, which is why it failed silently and only outside the card.
 *
 * So: an action that already names its target keeps it. Selection fills in only when
 * it does not.
 */
export function resolveActionTargets(
  action: { targetOrg?: string },
  chosen: { orgName: string }[],
): { targetOrg: string | undefined; targetOrgs: string[] } {
  const own = (action?.targetOrg || '').trim();
  if (own) return { targetOrg: own, targetOrgs: [own] };
  const list = (chosen || []).map(c => c.orgName).filter(Boolean);
  return { targetOrg: list[0], targetOrgs: list };
}

export const TURN_LABEL: Record<PlacementTurn, string> = {
  ours: 'אצלנו',
  student: 'אצל הסטודנט/ית',
  employer: 'אצל המעסיק',
  closed: 'סגור',
};

/** Semantic tones — deliberately NOT the wine accent, which stays the app's identity
 *  colour so urgency can never be mistaken for chrome. */
export const TURN_COLOR: Record<PlacementTurn, string> = {
  ours: '#b91c1c',
  student: '#b45309',
  employer: '#3b5a8f',
  closed: '#15803d',
};

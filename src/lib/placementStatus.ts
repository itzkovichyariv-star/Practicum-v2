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

/** Days of employer silence before the ball comes back to us. Yariv 2026-08-09: 7,
 *  down from 14. Deliberately a constant here rather than the per-course
 *  `reviewAgingThresholdDays`, which still governs the ⏱ chip inside the card. */
export const SILENCE_DAYS = 7;

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
  | 'adopt' | 'approve_org' | 'place_direct' | 'send_cv' | 'remind' | 'add_orgs';

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
    id: 'approve_org', short: 'אשר ארגון', label: 'בדוק ואשר ארגון', confirmLabel: 'אשר ארגון',
    warnTitle: 'אישור ארגון שהוצע',
    warnBody: 'הארגון יאושר ויתווסף כארגון פרטי של הסטודנט/ית בלבד, ויוגדר כבחירה ראשונה בדירוג. לא נשלחת הודעה אוטומטית — עדכון הסטודנט/ית נעשה בנפרד.',
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
    id: 'remind', short: 'תזכר', label: 'תזכר מעסיקים', confirmLabel: 'פתח תזכורת', isNew: true,
    warnTitle: 'תזכורת למעסיקים שטרם ענו',
    warnBody: 'ייפתח חלון WhatsApp או מייל עם תזכורת מוכנה למעסיקים שטרם ענו. ההודעה נשלחת רק אחרי שתלחץ/י «שלח» שם.',
  },
  add_orgs: {
    id: 'add_orgs', short: 'הוסף', label: 'הוסף ארגונים', confirmLabel: 'פתח כרטיס',
    warnTitle: 'הוספת ארגונים לדירוג',
    warnBody: 'ייפתח כרטיס הסטודנט/ית במקטע הארגונים, כדי להוסיף ארגונים חדשים לדירוג. לא מתבצע שום שינוי בנתונים.',
  },
};

const act = (id: PlacementActionId): PlacementAction => ({ ...ACTIONS[id] });

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

  const sentDays = (p: UnifiedOrgPref): number | null => {
    const d = (dispatches || [])
      .filter((x: any) => x.studentId === student.id && x.result === 'pending'
        && (p.slotId ? x.slotId === p.slotId : norm(x.employerId) === norm(p.employerId)))
      .sort((a: any, b: any) => String(b.sentAt).localeCompare(String(a.sentAt)))[0];
    return d ? daysSince(d.sentAt, now) : null;
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
      rank: p.rank, orgName: p.orgName, suggested: isSug(p), tone, suffix,
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
    const ages = sent.map(p => ({ p, d: sentDays(p) }));
    const oldest = ages.reduce<number | null>((m, x) => (x.d === null ? m : (m === null ? x.d : Math.max(m, x.d))), null);
    const sentChips = ages.map(({ p, d }) =>
      chipFor(p, d !== null && d > SILENCE_DAYS ? 'late' : 'sent', d === null ? '' : `נשלח ${agoPhrase(d)}`));
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
    const stale = oldest !== null && oldest > SILENCE_DAYS;

    if (stale) {
      return {
        key: 'sent_stale', turn: 'ours',
        headline: `קו״ח נשלחו ${placesPhrase(sent.length)} · ${oldest} ימים ללא תשובה`,
        sub: withCvNote(`מעל סף ההמתנה (${SILENCE_DAYS} ימים) — כדאי לתזכר את המעסיקים`),
        chips: allChips, age: '', action: act('remind'),
      };
    }
    if (passed.length > 0) {
      const p0 = passed[0];
      return {
        key: 'interview_passed', turn: 'employer',
        headline: `עבר/ה ראיון ב‑${p0.orgName} — ממתין להחלטת המעסיק`,
        sub: withCvNote(`קו״ח נשלחו ${placesPhrase(sent.length)}`),
        chips: allChips.map(c => (norm(c.orgName) === norm(p0.orgName) ? { ...c, tone: 'pass' as const } : c)),
        age: '', action: sendAction,
      };
    }
    const blockedWaiting = waitingChips.filter(c => !c.available);
    return {
      key: 'sent', turn: 'employer',
      headline: `קו״ח נשלחו ${placesPhrase(sent.length)} · ממתין לתשובת המעסיק`,
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

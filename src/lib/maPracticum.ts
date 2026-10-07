import { employerStatus } from './orgAvailability';
import { countSlotsByStatus } from './placement';

/**
 * The master's-practicum intake form (/ma) — all of its decisions, none of its markup.
 *
 * Yariv 2026-10-07: "בפרקטיקום תואר שני תשפ״ז יש 15 סטודנטים אני רוצה לשלוח להם קישור
 * בו יוכלו להעלות קורת חיים ויבחרו ארגון או יציעו אחד … אני צריך לדעת עם מי הסטודנט
 * בוחר לעשות או שהוא עושה לבד".
 *
 * Three things make this NOT the /cv-update form with a field bolted on:
 *
 *   1. No candidacy. A master's student is already a `students` row, so identity is a
 *      LOOKUP, not a registration — an address the app does not know must be refused
 *      rather than quietly accepted into a table nobody reads (see resolveMaStudent).
 *   2. One organization, not a ranking of three. With a single approved org on offer
 *      (פסגות, 8 places) a 1-2-3 ranking asks a question that has no second answer.
 *   3. The partner. A practicum done in pairs is the coordinator's scheduling unit, and
 *      the names have to come FROM the course's own student list — free text would
 *      produce "נועה", "נועה כ", "נועה כהן" for one person and no way to pair them up.
 *
 * Everything here is pure so it can be tested without a browser, a dev server, or
 * Supabase — none of which this sandbox can reach.
 */

export type Blob = {
  students?: any[];
  employers?: any[];
  courses?: any[];
};

/** Years are written תשפ״ז / תשפ"ז / תשפז across the app; compare them stripped. */
export function sameYear(a?: string, b?: string): boolean {
  const norm = (y?: string) => (y || '').replace(/["״'׳\s]/g, '').trim();
  return norm(a) === norm(b);
}

export function normEmail(v?: string | null): string {
  return (v || '').trim().toLowerCase();
}

export type StudentLookup =
  | { ok: true; student: any; courseId: string; courseName: string }
  | { ok: false; reason: 'no-email' | 'not-loaded' | 'unknown-email' };

/**
 * Who is this, according to the app's own student list?
 *
 * FAIL CLOSED, and this is the whole reason the function exists. The BA form accepts any
 * address and lets the coordinator sort it out later, because a BA candidate may legitimately
 * not be a student yet. Here the opposite is true: the 15 people who get this link are
 * already entered, so an address with no match is a typo, a personal mail instead of the
 * university one, or someone who was never meant to have the link. Accepting it would file a
 * CV under an email no student record carries — and nothing in the app would ever surface it.
 */
export function resolveMaStudent(blob: Blob | null, email: string): StudentLookup {
  const em = normEmail(email);
  if (!em) return { ok: false, reason: 'no-email' };
  if (!blob) return { ok: false, reason: 'not-loaded' };
  const student = (blob.students || []).find((s: any) => normEmail(s?.email) === em);
  if (!student) return { ok: false, reason: 'unknown-email' };
  const course = (blob.courses || []).find((c: any) => c?.id === student.courseId);
  return {
    ok: true,
    student,
    courseId: student.courseId || '',
    courseName: course?.name || student.courseId || '',
  };
}

export type PartnerOption = { id: string; name: string };

/**
 * The names the partner picker offers: the student's OWN cohort, minus themselves.
 *
 * Same course AND same year — a cohort is (course × year) everywhere else in this app, and
 * a master's course that runs again next year must not offer last year's students as
 * partners. The student's own record is excluded because "I will do it with myself" is
 * what the «לבד» option is for, and a nameless record is dropped because an empty option
 * in a dropdown is a trap.
 */
export function partnerOptions(blob: Blob | null, student: any): PartnerOption[] {
  if (!blob || !student?.courseId) return [];
  return (blob.students || [])
    .filter((s: any) =>
      s?.id !== student.id &&
      String(s?.name || '').trim() &&
      s?.courseId === student.courseId &&
      sameYear(s?.year, student.year))
    .map((s: any) => ({ id: String(s.id), name: String(s.name).trim() }))
    .sort((a: PartnerOption, b: PartnerOption) => a.name.localeCompare(b.name, 'he'));
}

export type MaOrgOption = {
  name: string;
  notes: string;
  /** Places configured for this course — what the coordinator negotiated. */
  total: number;
  /** Places not yet taken by a sent CV. Intent alone reserves nothing. */
  available: number;
};

/**
 * What the student may choose from: EXACTLY the rule the BA form applies.
 *
 * Yariv 2026-10-07: "שם כל ארגון תופס מקום וגם כאן — לא ברורה לי ההפרדה". He is right,
 * and the unclear separation was mine: an earlier version of this listed a FULL
 * organization with a "already chosen by N students" counter, which invented a second
 * meaning of "taken" that exists nowhere else in the app.
 *
 * There is one meaning, and it is the same for both degrees: a place is taken when the
 * coordinator SENDS a CV to that employer (the slot goes under_review) — choosing on a
 * form reserves nothing. So an organization is offered here on the same two conditions
 * the BA form and /organizations use — green status, and at least one place still
 * available — and when none is left the student is told and offered the proposal route,
 * which is the action actually available to them.
 */
export function maOrgOptions(blob: Blob | null, courseId: string): MaOrgOption[] {
  if (!blob || !courseId) return [];
  const seen = new Set<string>();
  return (blob.employers || [])
    .filter((e: any) => {
      if (!e?.name) return false;
      if (e.restrictedToStudentId) return false; // someone else's private proposal
      const ids = e.courseIds || (e.courseId ? [e.courseId] : []);
      if (!ids.includes(courseId)) return false;
      const key = String(e.name);
      if (seen.has(key)) return false;
      seen.add(key);
      if (employerStatus(e, [courseId]).key !== 'approved') return false;
      return countSlotsByStatus(e, courseId).available > 0;
    })
    .map((e: any) => {
      const c = countSlotsByStatus(e, courseId);
      return {
        name: String(e.name),
        notes: String(e.notes || ''),
        total: c.total,
        available: c.available,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

export type PartnerMode = 'alone' | 'with';

export type MaSubmission = {
  email: string;
  orgChoice: string;
  proposing: boolean;
  proposal: { name: string; contactName: string; contactRole: string; email: string; phone: string };
  partnerMode: PartnerMode | '';
  partnerNames: string[];
  hasFile: boolean;
  hasExistingCv: boolean;
};

export type MaContext = {
  lookup: StudentLookup;
  partners: PartnerOption[];
  orgs: MaOrgOption[];
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * One gate, in the order a person fills the form, returning the FIRST thing that is wrong.
 *
 * Every rule here exists because its absence would cost the coordinator a phone call:
 * an unidentifiable submission, a CV-less student, an intent with no organization behind
 * it, or "עם שותף" with nobody named — which is indistinguishable from «לבד» once it is
 * a row in a table.
 */
export function validateMaSubmission(s: MaSubmission, ctx: MaContext): string | null {
  const em = normEmail(s.email);
  if (!em) return 'יש להזין כתובת מייל';
  if (!EMAIL_RE.test(em)) return 'כתובת המייל אינה תקינה';
  if (ctx.lookup.ok === false) {
    if (ctx.lookup.reason === 'not-loaded') return 'הנתונים עוד נטענים — נסו שוב בעוד רגע';
    return 'הכתובת הזו אינה מופיעה ברשימת הסטודנטים של הפרקטיקום. בדקו את הכתובת, או פנו לרכזת.';
  }

  if (!s.hasFile && !s.hasExistingCv) return 'יש לצרף קובץ קורות חיים (PDF או Word)';

  if (s.proposing) {
    const required: Array<[string, string]> = [
      [s.proposal.name, 'שם הארגון'],
      [s.proposal.contactName, 'שם איש/אשת הקשר'],
      [s.proposal.contactRole, 'תפקיד איש/אשת הקשר'],
      [s.proposal.email, 'אימייל איש/אשת הקשר'],
      [s.proposal.phone, 'טלפון איש/אשת הקשר'],
    ];
    const missing = required.find(([v]) => !String(v || '').trim());
    if (missing) return `להצעת ארגון יש למלא: ${missing[1]}`;
    if (!EMAIL_RE.test(s.proposal.email.trim())) return 'אימייל איש/אשת הקשר אינו תקין';
    if (s.proposal.phone.replace(/\D/g, '').length < 9) return 'טלפון איש/אשת הקשר אינו תקין';
  } else if (!s.orgChoice.trim()) {
    return 'יש לבחור ארגון מהרשימה, או לסמן «אני מציע/ה ארגון אחר»';
  } else if (!ctx.orgs.some(o => o.name === s.orgChoice)) {
    // A stale draft restored into a form whose org list has since changed.
    return 'הארגון שנבחר אינו ברשימה המוצעת לפרקטיקום שלך — בחרו שוב.';
  }

  if (!s.partnerMode) return 'יש לציין אם הפרקטיקום ייעשה לבד או עם שותף/ה';
  if (s.partnerMode === 'with') {
    const names = s.partnerNames.map(n => n.trim()).filter(Boolean);
    if (!names.length) return 'בחרו את השותף/ה מהרשימה, או סמנו «לבד»';
    if (new Set(names).size !== names.length) return 'אותו שותף/ה נבחר/ה פעמיים';
    const unknown = names.find(n => !ctx.partners.some(p => p.name === n));
    if (unknown) return `«${unknown}» אינו/ה ברשימת הסטודנטים של הפרקטיקום שלך`;
  }

  return null;
}

/**
 * The proposal exactly as `cv_updates.suggested_org`, in ONE definition.
 *
 * Yariv 2026-10-07: "מה שחשוב כמו בפרקטיקום משאבי אנוש שסטודנט שיציע ארגון הארגון יהפוך
 * בחירה ראשונה שלו." That promotion is already implemented, once, in the coordinator's
 * suggestion inbox (EmployersPage.approveSuggestion → setCourseCapacity +
 * promoteOrgToFirst). It is reached by writing the SAME seven keys the BA form writes —
 * so the one thing that can break the promise is this object drifting from those keys.
 *
 * Hence a named builder the form uses and a test asserts against, rather than an object
 * literal inside a submit handler where a renamed key would go unnoticed.
 */
export type Proposal = {
  name: string; contactName: string; contactRole: string;
  email: string; phone: string; location: string; notes: string;
};

export function buildProposal(f: {
  name: string; contactName: string; contactRole: string;
  email: string; phone: string; location?: string; notes?: string;
}): Proposal {
  return {
    name: f.name.trim(),
    contactName: f.contactName.trim(),
    contactRole: f.contactRole.trim(),
    email: f.email.trim(),
    phone: f.phone.trim(),
    location: (f.location || '').trim(),
    notes: (f.notes || '').trim(),
  };
}

/** How the choice reads to the coordinator, in one line, in the inbox and the card. */
export function partnerSummary(mode?: string | null, names?: string[] | null): string {
  const list = (names || []).map(n => String(n || '').trim()).filter(Boolean);
  if (mode === 'alone') return 'לבד';
  if (mode === 'with') return list.length ? `עם ${list.join(' + ')}` : 'עם שותף/ה (לא צוין שם)';
  return '';
}

/**
 * The places line, in the same words the rest of the app uses for the same number.
 *
 * `available` only — deliberately NOT a count of who chose it on a form. A place is taken
 * when a CV is sent, and a second, form-based notion of "taken" would be a number the
 * coordinator's own screens never show.
 */
export function placesNote(o: MaOrgOption): string {
  if (o.available <= 0) return 'אין מקום פנוי';
  const word = o.available === 1 ? 'מקום פנוי' : 'מקומות פנויים';
  return o.total > o.available
    ? `${o.available} ${word} (מתוך ${o.total})`
    : `${o.available} ${word}`;
}

/**
 * Does the partner's own submission name this student back?
 *
 * Yariv 2026-10-07: a student whose partner marked something else "יקבל התראה שמבקשת ממנו
 * לבדוק שהסטודנט השני גם סימן את זה **מבלי להגיד לו מה הוא סימן**".
 *
 * So this returns ONE BIT, and the caller may show only that bit. 'unconfirmed' covers
 * every reason equally — the partner said «לבד», named someone else, or has not filled the
 * form yet — precisely so the notice cannot be read backwards into what they chose.
 */
export type MutualState = 'confirmed' | 'unconfirmed';

export function mutualNotice(state: MutualState, names: string[]): string {
  if (state === 'confirmed') return '';
  const who = names.length === 1 ? 'השותף/ה' : 'השותפים/ות';
  return `בדקו עם ${who} שגם סימן/ה אותך בטופס — כרגע אין לנו סימון הדדי. (אנחנו לא מציגים מה סומן בטופס של אף אחד אחר.)`;
}

/** The addresses to ask about — resolved from the cohort, never typed by the student. */
export function partnerEmails(blob: Blob | null, student: any, names: string[]): string[] {
  if (!blob || !student?.courseId) return [];
  const wanted = new Set(names.map(n => n.trim()).filter(Boolean));
  return (blob.students || [])
    .filter((s: any) => wanted.has(String(s?.name || '').trim()) && s?.id !== student.id)
    .map((s: any) => normEmail(s?.email))
    .filter(Boolean);
}

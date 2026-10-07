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

export type IdentifiedBy = 'email' | 'name' | 'preview';

/**
 * The address that may open this form as a PREVIEW, to walk the whole flow before a
 * student does.
 *
 * Yariv 2026-10-07: "תכניס גם את המייל שלי כדי שאוכל לבדוק". Deliberately NOT a students row:
 * a real row would put him in the partner picker of all fifteen students and in the
 * coordinator's own screens. A code-only identity is visible to nobody but whoever types
 * the address.
 *
 * Both of his addresses, at his word ("תכניס את שניהם") — asked first, because this file ships
 * inside a public browser bundle and every address listed here becomes public with it.
 *
 * TEMPORARY, by his instruction ("אחר כך נסיר אותי"): emptying this array removes the
 * preview completely, and nothing else has to change.
 *
 * REMOVED 2026-10-07, once the walkthrough was done: "ואז תסיר את השם שלי ואשלח
 * לסטודנטים". The form was driven end to end under yarivi@ariel.ac.il against the live
 * project first — CV uploaded, organization proposed, row written, the coordinator's mail
 * sent — and the addresses came out before the link goes to the cohort, because this file
 * ships inside a public browser bundle and every address listed here is published with it.
 * Putting one address back is all it takes to walk the form again.
 */
export const PREVIEW_EMAILS: string[] = [];

/** The course row the /ma link was built for, and the one a preview stands in. */
export const MA_COURSE_ID = 'counseling-practicum-tashpaz';

export type StudentLookup =
  | { ok: true; student: any; courseId: string; courseName: string; identifiedBy: IdentifiedBy }
  | { ok: false; reason: 'no-email' | 'not-loaded' | 'unknown-email' | 'unknown-name' | 'ambiguous-name' };

/**
 * A name used as a key: quote marks dropped, hyphens and the maqaf read as spaces, runs of
 * whitespace collapsed, Latin letters lowered.
 *
 * The same reasoning as sameYear(): תשפ״ז and תשפ"ז are one year, and «בן־צבי» typed with a
 * plain hyphen, or with a space, is one person. Hebrew has no case, so lowering only
 * affects a name written in Latin letters.
 */
export function normName(v?: string | null): string {
  return String(v || '')
    .replace(/["״'׳]/g, '')
    .replace(/[-־–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The words of a name as a sorted set, so «לוי אבי» finds «אבי לוי». */
function nameKey(v?: string | null): string {
  return normName(v).split(' ').filter(Boolean).sort().join(' ');
}

/**
 * Which PERSON a student row belongs to.
 *
 * The live data carries one person on several course rows — the יעוץ ארגוני cohort sits on
 * ariel-counseling-a, ariel-counseling-b AND counseling-practicum-tashpaz, three rows per
 * student, same address on each. So rows are not people, and anything that counts rows and
 * calls the result "two students" is wrong about all fifteen of them.
 *
 * The address is the identity because that is what the rest of the app pairs on. A row with
 * no address can only be itself.
 */
function identityKey(s: any): string {
  return normEmail(s?.email) || `id:${String(s?.id || '')}`;
}

/**
 * Of one person's several rows, the one this link is about.
 *
 * The row decides which organizations are offered and whose names the partner picker
 * carries, so taking whichever row happened to be first would show a יעוץ ארגוני student the
 * wrong course's organizations — quite possibly none at all.
 */
function preferRow(rows: any[], targetCourseId: string): any {
  return rows.find((r: any) => r?.courseId === targetCourseId) || rows[0];
}

function identified(blob: Blob, student: any, identifiedBy: IdentifiedBy): StudentLookup {
  const course = (blob.courses || []).find((c: any) => c?.id === student.courseId);
  return {
    ok: true,
    student,
    courseId: student.courseId || '',
    courseName: course?.name || student.courseId || '',
    identifiedBy,
  };
}

/**
 * Who is this, according to the app's own student list?
 *
 * TWO KEYS, TRIED IN ORDER, and still fail closed. The BA form accepts any address and
 * lets the coordinator sort it out later, because a BA candidate may legitimately not be a
 * student yet. Here the opposite is true: the people who get this link are already
 * entered, so a submission that matches nobody would be filed under an identity no student
 * record carries and nothing in the app would ever surface it.
 *
 * The address alone was not enough. Yariv 2026-10-07: "אני מעדיף קישור גנרי שבו
 * הסטודנט יגדיר מייל וקורות חיים ואז זה ישוייך אליו גם לפי השם שלו". A generic link means
 * whatever address the student happens to be sitting in front of — a personal Gmail rather
 * than the university one — and refusing that is refusing the student.
 *
 * So the NAME is the second key, and it is TYPED, never picked from a list. A public page
 * that offered the cohort by name would let anyone holding the link read off who is in it;
 * the partner picker may do that only after the person is already identified. A typed name
 * reveals nothing, which is the whole point.
 */
export function resolveMaStudent(
  blob: Blob | null,
  email: string,
  name?: string,
  previewCourseId?: string,
): StudentLookup {
  const em = normEmail(email);
  if (!em) return { ok: false, reason: 'no-email' };
  if (!blob) return { ok: false, reason: 'not-loaded' };

  const students = blob.students || [];
  const target = previewCourseId || MA_COURSE_ID;

  // All of this person's rows, then the one for this link — not merely the first found.
  const byEmail = students.filter((s: any) => normEmail(s?.email) === em);
  if (byEmail.length) return identified(blob, preferRow(byEmail, target), 'email');

  // The coordinator's own preview, before any name is asked for: he is not on the student
  // list and never should be, so neither key can ever find him.
  if (PREVIEW_EMAILS.includes(em)) {
    const courseId = previewCourseId || MA_COURSE_ID;
    const course = (blob.courses || []).find((c: any) => c?.id === courseId);
    // The YEAR decides who the partner picker offers (a cohort is course × year), so a
    // course row without one would hand the coordinator an empty list and look like a bug
    // in the picker. Fall back to the year its own students carry.
    const cohortYear = (blob.students || []).find((st: any) => st?.courseId === courseId && st?.year)?.year;
    return {
      ok: true,
      identifiedBy: 'preview',
      courseId,
      courseName: course?.name || courseId,
      student: {
        id: '__preview__',
        name: 'תצוגה מקדימה (רכז/ת)',
        email: em,
        courseId,
        year: course?.year || cohortYear || '',
      },
    };
  }

  const typed = normName(name);
  if (!typed) return { ok: false, reason: 'unknown-email' };

  const named = students.filter((s: any) => String(s?.name || '').trim());
  let hits = named.filter((s: any) => normName(s.name) === typed);
  if (!hits.length && typed.split(' ').filter(Boolean).length >= 2) {
    const want = nameKey(typed);
    hits = named.filter((s: any) => nameKey(s.name) === want);
  }
  if (!hits.length) return { ok: false, reason: 'unknown-name' };

  // COUNT PEOPLE, NOT ROWS. Counting rows reported "יש יותר מסטודנט/ית אחד/ת בשם הזה"
  // for every one of the fifteen, because each of them is carried on three course rows.
  const people = new Set(hits.map(identityKey));
  // Two students really do share a name: say so rather than guessing which one gets the CV.
  if (people.size > 1) return { ok: false, reason: 'ambiguous-name' };
  return identified(blob, preferRow(hits, target), 'name');
}

/**
 * The address the submission is FILED under, which is not always the one typed.
 *
 * Everything downstream keys on this: the coordinator's intake path, the student's own
 * submission history, and the mutual-partner question, which looks the partner up by the
 * address on their card. So a student identified by NAME has their row filed under the
 * address the app already holds for them — otherwise one person would carry two
 * identities and a pair could never be matched up.
 *
 * A student with no address on record keeps the one they typed, which is then the only one
 * anybody has for them.
 */
export function submissionEmail(lookup: StudentLookup, typed: string): string {
  if (lookup.ok) {
    const onRecord = normEmail(lookup.student?.email);
    if (onRecord) return onRecord;
  }
  return normEmail(typed);
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

/**
 * WHERE THE STUDENT IS WITH AN ORGANIZATION, when the answer is not yet a name.
 *
 * Yariv 2026-10-07: "אני רוצה שתוסיף בקישור אפשרות לסטודנט לכתוב הערה בסגנון אני בקשר עם
 * ארגון ועדיין זה לא סופי … אין לי ארגון (אבל אז שיגיד מדוע לא בחר בפסגות)".
 *
 * Until now the form had exactly two answers — a listed organization, or a proposal with
 * full contact details — and a student still in conversation with somebody had to pick one
 * of them or abandon the form. Both are wrong: a half-made arrangement is not a proposal,
 * and leaving is not an answer.
 *
 *   'pending' — in touch with an organization, nothing settled. Details follow later.
 *   'none'    — no organization, which raises the question the coordinator actually wants
 *               answered: why not the one already on offer.
 */
export type OrgStatus = '' | 'pending' | 'none';

/**
 * MAY I CALL THEM, AND WHEN — the question the coordinator actually has.
 *
 * Yariv 2026-10-07: "אם הארגון בתהליך בדיקה בין הסטודנט לארגון אני צריך לדעת מתי אוכל
 * לפנות". A status like "not final yet" describes the student; this describes what HE may
 * do, which is the only part he can act on.
 *
 * It also removes an option rather than adding one: "I propose an organization" and "I am
 * in touch with one" turned out to be the same answer with different timing, so they are
 * now one choice carrying this question.
 *
 * There were three answers for a while, the middle one being "not before <date>". Yariv
 * struck it 2026-10-07: "לא צריך תאריך שיוגדר זה במילא לא ראלי". He is right — a date a
 * student guesses at is a date nobody honours, and it only invited him to diarise a
 * fiction. Two answers: call them, or do not call them yet.
 */
export type ContactPermission = '' | 'now' | 'later';

export type MaSubmission = {
  email: string;
  orgChoice: string;
  /** The student brings their own organization — proposed outright, or still being settled. */
  proposing: boolean;
  proposal: { name: string; contactName: string; contactRole: string; email: string; phone: string };
  /**
   * WHAT THE STUDENT KNOWS THAT THE COORDINATOR CANNOT GUESS, in his own ordering —
   * "איך הגיע יותר חשוב מה הארגון מציע ומה סיכמת עם איש אשת הקשר ומה אופי הקשר (משפחה וכו)".
   * A single "tell us about it" box returned one sentence; four questions return four
   * answers, and he needs them before he picks up the phone.
   */
  orgOffer?: string;      // מה הארגון מציע
  agreedWith?: string;    // מה סוכם עם איש/אשת הקשר
  relationship?: string;  // אופי הקשר — משפחה, מכר, מעסיק קודם
  howFound?: string;      // איך הגעת לארגון — the one he called least important
  contactPermission?: ContactPermission;
  /** Only 'none' now — "I have no organization". 'pending' is derived from the permission. */
  orgStatus?: OrgStatus;
  /** Free text, offered whatever the answer — "סטטוס כללי שלא מוגבל לאחת מאלה שהעלתי". */
  statusNote?: string;
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
 * Does this look like a FINISHED address?
 *
 * The form used to judge an address the moment the field was non-empty, so typing "ya"
 * raised "הכתובת הזו אינה מופיעה..." in red under a half-typed word, and with the name
 * fallback it would also have opened a second field mid-keystroke. An unfinished address is
 * not a wrong one; feedback waits until there is something to be right or wrong about.
 */
export function emailLooksComplete(v?: string | null): boolean {
  return EMAIL_RE.test(normEmail(v || ''));
}

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
    // One message per reason: "not on the list" and "that name matches nobody" send the
    // student to different places, and a single sentence covering both sends them nowhere.
    if (ctx.lookup.reason === 'not-loaded') return 'הנתונים עוד נטענים — נסו שוב בעוד רגע';
    if (ctx.lookup.reason === 'unknown-name') return 'לא מצאנו סטודנט/ית בשם הזה ברשימות התכנית. בדקו את האיות והשם המלא, או פנו לרכזת.';
    if (ctx.lookup.reason === 'ambiguous-name') return 'יש יותר מסטודנט/ית אחד/ת בשם הזה. הזינו את המייל שרשום בתכנית, או פנו לרכזת.';
    return 'הכתובת הזו אינה מופיעה ברשימת הסטודנטים. הוסיפו את שמכם המלא בשדה שנפתח, כדי שנזהה אתכם לפיו.';
  }

  if (!s.hasFile && !s.hasExistingCv) return 'יש לצרף קובץ קורות חיים (PDF או Word)';

  // "I have no organization" short-circuits the rules below: there is no name to check
  // against the list and no contact to reach.
  if (s.orgStatus === 'none') {
    // Nothing more is asked. Yariv struck the "why not the listed organization" box
    // 2026-10-07 — "אפשר להסיר שיפנו אלי להסבר" — because the explanation belongs in a
    // conversation with him, not in a text box a student fills in to get past a form.
  } else if (s.orgStatus) {
    return 'בחירת הארגון אינה תקינה';
  } else if (s.proposing) {
    // The organization and the student's own account of it are required WHATEVER the
    // timing: they are what the coordinator reads before deciding anything, and a student
    // who cannot answer them does not really have an organization yet.
    const always: Array<[string | undefined, string]> = [
      [s.proposal.name, 'שם הארגון'],
      [s.orgOffer, 'מה הארגון מציע'],
      [s.agreedWith, 'מה סוכם עם איש/אשת הקשר'],
      [s.relationship, 'אופי הקשר שלך לארגון'],
    ];
    const missingAlways = always.find(([v]) => !String(v || '').trim());
    if (missingAlways) return `כדי שנוכל לפנות לארגון יש למלא: ${missingAlways[1]}`;

    if (!s.contactPermission) return 'יש לציין מתי אפשר לפנות לארגון';
    if (!['now', 'later'].includes(s.contactPermission)) return 'בחירת מועד הפנייה אינה תקינה';

    // CONTACT DETAILS ARE REQUIRED ONLY TO CALL TODAY.
    //
    // A student still in conversation often does not have the direct line yet, and
    // demanding it produces an invented number — worse than an empty field, because an
    // empty field is visible. So they are required when the answer is "call them now",
    // and merely requested otherwise; whatever IS given must still be well formed, or it
    // is not a contact detail at all.
    const contact: Array<[string, string]> = [
      [s.proposal.contactName, 'שם איש/אשת הקשר'],
      [s.proposal.contactRole, 'תפקיד איש/אשת הקשר'],
      [s.proposal.email, 'אימייל איש/אשת הקשר'],
      [s.proposal.phone, 'טלפון איש/אשת הקשר'],
    ];
    if (s.contactPermission === 'now') {
      const missing = contact.find(([v]) => !String(v || '').trim());
      if (missing) return `כדי שנוכל לפנות עכשיו יש למלא: ${missing[1]}`;
    }
    const mail = String(s.proposal.email || '').trim();
    if (mail && !EMAIL_RE.test(mail)) return 'אימייל איש/אשת הקשר אינו תקין';
    const phone = String(s.proposal.phone || '').trim();
    if (phone && phone.replace(/\D/g, '').length < 9) return 'טלפון איש/אשת הקשר אינו תקין';
  } else if (!s.orgChoice.trim()) {
    return 'יש לבחור ארגון מהרשימה, להציע ארגון, או לסמן שעדיין אין לכם ארגון סופי';
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

/**
 * WHETHER HE MAY CALL, as a sentence rather than a code.
 *
 * This is the line that decides whether he picks up the phone, so it leads with the
 * permission rather than with the organization's name.
 */
export function contactPermissionLine(p: ContactPermission): string {
  if (p === 'now') return 'אפשר לפנות לארגון עכשיו';
  if (p === 'later') return 'עדיין בתהליך — הסטודנט/ית יעדכן/תעדכן מתי אפשר לפנות';
  return '';
}

/**
 * The student's own account of the organization, as the labelled block that travels into
 * the employer record's notes once the proposal is approved.
 *
 * Labelled rather than run together, because he reads these before a phone call and needs
 * to find one of them fast. An unanswered optional question leaves no empty heading.
 */
export function proposalContext(f: {
  orgOffer?: string; agreedWith?: string; relationship?: string; howFound?: string;
}): string {
  const t = (v?: string) => String(v || '').trim();
  const rows: Array<[string, string]> = [
    ['מה הארגון מציע', t(f.orgOffer)],
    ['מה סוכם עם איש/אשת הקשר', t(f.agreedWith)],
    ['אופי הקשר', t(f.relationship)],
    ['איך הגיע/ה לארגון', t(f.howFound)],
  ];
  return rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
}

/**
 * What the row's org_status says, derived rather than asked.
 *
 * 'pending' is not a thing the student picks — it is what "I have an organization but do
 * not call them yet" MEANS, and deriving it keeps the two from drifting apart.
 */
export function derivedOrgStatus(s: {
  orgStatus?: OrgStatus; proposing?: boolean; contactPermission?: ContactPermission;
}): 'pending' | 'none' | null {
  if (s.orgStatus === 'none') return 'none';
  if (s.proposing && s.contactPermission && s.contactPermission !== 'now') return 'pending';
  return null;
}

/**
 * THE ONE LINE in his inbox and on the student card.
 *
 * Several fields that may each be empty would otherwise reach his screen as a row of
 * blanks; a sentence either says something or is absent. Order is what he scans for: the
 * permission first, because it decides whether he acts today, then the organization, then
 * whatever the student added.
 */
export function orgStatusLine(s: {
  orgStatus?: OrgStatus; proposing?: boolean; orgName?: string;
  contactPermission?: ContactPermission; statusNote?: string;
}): string {
  const t = (v?: string) => String(v || '').trim();
  const parts: string[] = [];
  if (s.orgStatus === 'none') {
    parts.push('אין ארגון כרגע');
  } else if (s.proposing) {
    const when = contactPermissionLine(s.contactPermission || '');
    if (when) parts.push(when);
    if (t(s.orgName)) parts.push(t(s.orgName));
  }
  if (t(s.statusNote)) parts.push(t(s.statusNote));
  return parts.join(' · ');
}

/** What the student is told their answer was, on the confirmation screen. */
export function orgStatusHeadline(status: OrgStatus): string {
  if (status === 'pending') return 'רשמנו שאת/ה בקשר עם ארגון שטרם סוכם';
  if (status === 'none') return 'רשמנו שעדיין אין לך ארגון';
  return '';
}

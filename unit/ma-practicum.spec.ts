import { test, expect } from '@playwright/test';
import {
  resolveMaStudent, partnerOptions, maOrgOptions, validateMaSubmission,
  partnerSummary, placesNote, mutualNotice, partnerEmails, buildProposal, sameYear,
  submissionEmail, normName, PREVIEW_EMAILS, MA_COURSE_ID, orgStatusLine, orgStatusHeadline,
  contactPermissionLine, proposalContext, derivedOrgStatus,
  type Blob, type MaContext, type MaSubmission,
} from '../src/lib/maPracticum';
import { promoteOrgToFirst, setCourseCapacity, countSlotsByStatus } from '../src/lib/placement';

/**
 * The master's-practicum link (/ma), tested where it actually decides things.
 *
 * Yariv is sending this to 15 real students before anyone has clicked it once, and this
 * sandbox can reach neither Supabase nor a live browser session — so every rule that
 * could send a student down the wrong path is pinned here instead: who the form will
 * identify, whose names the partner picker offers, which organizations it offers, and
 * what it refuses to submit.
 */

const COURSE = 'c-ma';

const blob: Blob = {
  courses: [
    { id: COURSE, name: 'פרקטיקום תואר שני', year: 'תשפ״ז', type: 'practicum' },
    { id: 'c-ba', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', type: 'practicum' },
  ],
  students: [
    { id: 's1', name: 'נועה כהן',   email: 'Noa@ariel.ac.il', courseId: COURSE, year: 'תשפ״ז' },
    { id: 's2', name: 'אבי לוי',    email: 'avi@ariel.ac.il',  courseId: COURSE, year: 'תשפ"ז' },
    { id: 's3', name: 'דנה מזרחי',  email: 'dana@ariel.ac.il', courseId: COURSE, year: 'תשפז'  },
    // Same course, LAST year — a previous cohort must not be offered as a partner.
    { id: 's4', name: 'יובל אשכנזי', email: 'yuval@ariel.ac.il', courseId: COURSE, year: 'תשפ״ו' },
    // Another programme entirely.
    { id: 's5', name: 'רון ברק',    email: 'ron@ariel.ac.il',  courseId: 'c-ba', year: 'תשפ״ז' },
    // No name — an unusable option in a dropdown.
    { id: 's6', name: '  ',         email: 'blank@ariel.ac.il', courseId: COURSE, year: 'תשפ״ז' },
  ],
  employers: [
    {
      id: 'e1', name: 'פסגות', courseIds: [COURSE], notes: 'קרן פנסיה',
      approvalStatus: 'approved',
      vacancySlots: Array.from({ length: 8 }, (_, i) => ({ id: `v${i}`, courseId: COURSE, status: 'available' })),
    },
    // Belongs to the BA course — must never appear for the master's student.
    {
      id: 'e2', name: 'איקון גרופ', courseIds: ['c-ba'], notes: 'גיוס',
      approvalStatus: 'approved',
      vacancySlots: [{ id: 'w1', courseId: 'c-ba', status: 'available' }],
    },
    // Someone else's private proposal.
    {
      id: 'e3', name: 'ארגון פרטי', courseIds: [COURSE], notes: 'x',
      approvalStatus: 'approved', restrictedToStudentId: 's2',
      vacancySlots: [{ id: 'p1', courseId: COURSE, status: 'available' }],
    },
  ],
};

function ctxFor(email: string): MaContext {
  const lookup = resolveMaStudent(blob, email);
  return {
    lookup,
    partners: lookup.ok ? partnerOptions(blob, lookup.student) : [],
    orgs: lookup.ok ? maOrgOptions(blob, lookup.courseId) : [],
  };
}

function base(over: Partial<MaSubmission> = {}): MaSubmission {
  return {
    email: 'noa@ariel.ac.il',
    orgChoice: 'פסגות',
    proposing: false,
    proposal: { name: '', contactName: '', contactRole: '', email: '', phone: '' },
    partnerMode: 'alone',
    partnerNames: [],
    hasFile: true,
    hasExistingCv: false,
    ...over,
  };
}

/* ── identity ─────────────────────────────────────────────────────────── */

test('a student is identified case-insensitively, by the app\'s own list', () => {
  const r = resolveMaStudent(blob, '  NOA@ariel.ac.il ');
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.student.id).toBe('s1');
    expect(r.courseName).toBe('פרקטיקום תואר שני');
  }
});

test('an address the app does not know is REFUSED, not filed away', () => {
  const r = resolveMaStudent(blob, 'someone@gmail.com');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe('unknown-email');
  const err = validateMaSubmission(base({ email: 'someone@gmail.com' }), ctxFor('someone@gmail.com'));
  expect(err).toContain('אינה מופיעה ברשימת הסטודנטים');
});

test('while the data is still loading the form says so instead of refusing the person', () => {
  const ctx: MaContext = { lookup: resolveMaStudent(null, 'noa@ariel.ac.il'), partners: [], orgs: [] };
  expect(validateMaSubmission(base(), ctx)).toContain('נטענים');
});

/* ── the second key: the NAME ────────────────────────────────────────── */
/**
 * Yariv 2026-10-07: "המייל שלהן זה המייל שהם רשומים איתו לאוניברסיטה אז זה לא לתכנית
 * ואם תהיה אי התאמה שיזה גם לפי שם". A mismatch is the EXPECTED case on a generic link, not an
 * edge one, so these pin the fallback that keeps a real student from being turned away.
 */

test('THE MISMATCH CASE: an address nobody has on record, identified by the typed name', () => {
  const r = resolveMaStudent(blob, 'noa.cohen.personal@gmail.com', 'נועה כהן');
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.student.id).toBe('s1');
    expect(r.identifiedBy).toBe('name');
    expect(r.courseName).toBe('פרקטיקום תואר שני');
  }
});

test('the address wins when it IS on record — a typed name cannot redirect the submission', () => {
  // Otherwise a student could type someone else's name and file a CV against their record.
  const r = resolveMaStudent(blob, 'noa@ariel.ac.il', 'אבי לוי');
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.student.id).toBe('s1');
    expect(r.identifiedBy).toBe('email');
  }
});

test('word order, quote marks, a hyphen and double spaces do not break the match', () => {
  for (const typed of ['לוי אבי', '  אבי   לוי ', 'אבי-לוי']) {
    const r = resolveMaStudent(blob, 'avi.personal@gmail.com', typed);
    expect(r.ok, `"${typed}" should identify אבי לוי`).toBe(true);
    if (r.ok) expect(r.student.id).toBe('s2');
  }
  expect(normName('בן־צבי')).toBe(normName('בן צבי'));
});

test('ONE first name is not an identity', () => {
  // 'נועה' matches no full name exactly, and the word-set path needs two words — a
  // cohort has more than one נועה often enough that guessing would file a CV wrongly.
  const r = resolveMaStudent(blob, 'someone@gmail.com', 'נועה');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe('unknown-name');
});

test('a name nobody on the list carries is refused, and says so in its own words', () => {
  const r = resolveMaStudent(blob, 'someone@gmail.com', 'מיכל ברקוביץ');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe('unknown-name');
  const ctx: MaContext = { lookup: r, partners: [], orgs: [] };
  const err = validateMaSubmission(base({ email: 'someone@gmail.com' }), ctx);
  expect(err).toContain('לא מצאנו');
});

test('two students really sharing a name is reported, never guessed', () => {
  const twins: Blob = {
    courses: blob.courses,
    employers: blob.employers,
    students: [...(blob.students || []),
      { id: 's7', name: 'נועה כהן', email: 'noa.cohen2@ariel.ac.il', courseId: 'c-ba', year: 'תשפ״ז' }],
  };
  const r = resolveMaStudent(twins, 'personal@gmail.com', 'נועה כהן');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe('ambiguous-name');
  const ctx: MaContext = { lookup: r, partners: [], orgs: [] };
  expect(validateMaSubmission(base({ email: 'personal@gmail.com' }), ctx)).toContain('יותר מסטודנט');
});

test('a blank name does not match the record whose name is blank', () => {
  // s6 carries '  ' as a name. Typing spaces must not become a key onto it.
  const r = resolveMaStudent(blob, 'someone@gmail.com', '   ');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe('unknown-email');
});

test('ONE IDENTITY PER PERSON: a name match is filed under the address on the card', () => {
  // The partner question looks the other student up BY the address on their card
  // (partnerEmails), and the coordinator's intake keys on it too. A row filed under the
  // personal address the student happened to type would be a second identity for one
  // person, and no pair could ever be matched up.
  const r = resolveMaStudent(blob, 'noa.cohen.personal@gmail.com', 'נועה כהן');
  expect(submissionEmail(r, 'noa.cohen.personal@gmail.com')).toBe('noa@ariel.ac.il');
});

/**
 * THE PREVIEW IS GONE, and that is the point.
 *
 * It existed so Yariv could walk the form before anyone else did — "אני רוצה לעבור את כל
 * התהליך אחר כך נסיר אותי". He walked it on 2026-10-07 against the live project (CV
 * uploaded, organization proposed, row written, notification mail sent) and then said
 * "ואז תסיר את השם שלי ואשלח לסטודנטים". These tests pin the removal, because this file
 * ships inside a public browser bundle: an address left in the array is published with it.
 */
test('NO ADDRESS SHIPS WITH THE FORM — the preview list is empty', () => {
  expect(PREVIEW_EMAILS).toEqual([]);
});

test("the coordinator's own addresses now take the ordinary path, like anyone else's", () => {
  for (const em of ['yarivi@ariel.ac.il', 'itzkovichyariv@gmail.com']) {
    const r = resolveMaStudent(blob, em, '', COURSE);
    expect(r.ok, `${em} must no longer be let in without a name`).toBe(false);
    // 'unknown-email' is what opens the name field — not a dead end, just no shortcut.
    if (!r.ok) expect(r.reason).toBe('unknown-email');
  }
});

test('the preview was never a student, so removing it leaves no trace in any cohort', () => {
  expect(partnerOptions(blob, (blob.students || [])[0]).map(p => p.name))
    .not.toContain('תצוגה מקדימה (רכז/ת)');
});

test('a student with NO address on record keeps the one they typed', () => {
  const noMail: Blob = {
    courses: blob.courses,
    employers: blob.employers,
    students: [{ id: 's8', name: 'עדי שרון', courseId: COURSE, year: 'תשפ״ז' }],
  };
  const r = resolveMaStudent(noMail, 'Adi.Sharon@Gmail.com', 'עדי שרון');
  expect(r.ok).toBe(true);
  // Lowercased, because it becomes the only address anybody has for them.
  expect(submissionEmail(r, 'Adi.Sharon@Gmail.com')).toBe('adi.sharon@gmail.com');
});

/* ── the partner list ─────────────────────────────────────────────────── */

test('the partner list is the student\'s own cohort, without themselves', () => {
  const names = partnerOptions(blob, blob.students![0]).map(p => p.name);
  expect(names).toEqual(['אבי לוי', 'דנה מזרחי']);
  expect(names).not.toContain('נועה כהן');     // self
  expect(names).not.toContain('יובל אשכנזי');  // same course, previous year
  expect(names).not.toContain('רון ברק');      // another programme
});

test('תשפ״ז, תשפ"ז and תשפז are the same year — a quote mark must not split a cohort', () => {
  expect(sameYear('תשפ״ז', 'תשפ"ז')).toBe(true);
  expect(sameYear('תשפ״ז', 'תשפז')).toBe(true);
  expect(sameYear('תשפ״ז', 'תשפ״ו')).toBe(false);
  // דנה is stored as 'תשפז' and still appears for נועה, stored as 'תשפ״ז'.
  expect(partnerOptions(blob, blob.students![0]).map(p => p.name)).toContain('דנה מזרחי');
});

/* ── the organization list ────────────────────────────────────────────── */

test('only the course\'s own public organizations are offered, with their places', () => {
  const orgs = maOrgOptions(blob, COURSE);
  expect(orgs.map(o => o.name)).toEqual(['פסגות']);
  expect(orgs[0].total).toBe(8);
  expect(orgs[0].available).toBe(8);
});

test('a FULL organization is not offered — the same rule the BA form applies', () => {
  // Yariv: "שם כל ארגון תופס מקום וגם כאן — לא ברורה לי ההפרדה". There is one meaning of
  // taken, and one list rule, for both degrees.
  const full: Blob = {
    ...blob,
    employers: [{
      ...blob.employers![0],
      vacancySlots: Array.from({ length: 8 }, (_, i) => ({ id: `v${i}`, courseId: COURSE, status: 'placed' })),
    }],
  };
  expect(maOrgOptions(full, COURSE)).toEqual([]);
});

test('the places line says what the rest of the app says, and nothing it does not', () => {
  const o = maOrgOptions(blob, COURSE)[0];
  expect(placesNote(o)).toBe('8 מקומות פנויים');
  expect(placesNote({ ...o, available: 3, total: 8 })).toBe('3 מקומות פנויים (מתוך 8)');
  expect(placesNote({ ...o, available: 1, total: 8 })).toBe('1 מקום פנוי (מתוך 8)');
  // No count of who picked it on a form: a place is taken when a CV is sent, and a second
  // notion of "taken" would be a number the coordinator's own screens never show.
  expect(placesNote(o)).not.toContain('בחרו');
});

/* ── what cannot be submitted ─────────────────────────────────────────── */

test('a first submission must carry a CV; a returning one may keep the file on record', () => {
  expect(validateMaSubmission(base({ hasFile: false }), ctxFor('noa@ariel.ac.il')))
    .toContain('קורות חיים');
  expect(validateMaSubmission(base({ hasFile: false, hasExistingCv: true }), ctxFor('noa@ariel.ac.il')))
    .toBeNull();
});

test('neither an organization nor a proposal is not a submission', () => {
  expect(validateMaSubmission(base({ orgChoice: '' }), ctxFor('noa@ariel.ac.il')))
    .toContain('יש לבחור ארגון');
});

test('an organization that is not on the student\'s own list is refused', () => {
  // What a restored draft does after the coordinator re-scopes an org.
  expect(validateMaSubmission(base({ orgChoice: 'איקון גרופ' }), ctxFor('noa@ariel.ac.il')))
    .toContain('אינו ברשימה המוצעת');
});

test('a proposal needs the contact details that make it reachable', () => {
  // Reachability is now conditional on the timing — see the permission tests below — so
  // this pins the "call them now" case, which is the one that must be complete.
  const p = { name: 'חברה חדשה', contactName: 'שרה', contactRole: 'מנהלת HR', email: 'sara@x.co.il', phone: '0501234567' };
  const own = (over: Partial<MaSubmission> = {}) => base({
    orgChoice: '', proposing: true, proposal: p, contactPermission: 'now',
    orgOffer: 'ליווי', agreedWith: 'מעוניינים', relationship: 'מכר', ...over,
  });
  expect(validateMaSubmission(own(), ctxFor('noa@ariel.ac.il'))).toBeNull();
  expect(validateMaSubmission(own({ proposal: { ...p, contactRole: '' } }), ctxFor('noa@ariel.ac.il')))
    .toContain('תפקיד');
  expect(validateMaSubmission(own({ proposal: { ...p, email: 'not-an-email' } }), ctxFor('noa@ariel.ac.il')))
    .toContain('אימייל');
  expect(validateMaSubmission(own({ proposal: { ...p, phone: '123' } }), ctxFor('noa@ariel.ac.il')))
    .toContain('טלפון');
});

test('THE POINT OF THE FORM: "with a partner" and no name is refused', () => {
  // Without this rule the row is indistinguishable from «לבד», which is exactly the
  // question Yariv said he needs answered.
  expect(validateMaSubmission(base({ partnerMode: 'with', partnerNames: [] }), ctxFor('noa@ariel.ac.il')))
    .toContain('בחרו את השותף');
  expect(validateMaSubmission(base({ partnerMode: '' }), ctxFor('noa@ariel.ac.il')))
    .toContain('לבד או עם שותף');
});

test('a partner must be a real classmate, and may not be named twice', () => {
  expect(validateMaSubmission(base({ partnerMode: 'with', partnerNames: ['מישהו מחוץ לקורס'] }), ctxFor('noa@ariel.ac.il')))
    .toContain('אינו/ה ברשימת הסטודנטים');
  expect(validateMaSubmission(base({ partnerMode: 'with', partnerNames: ['אבי לוי', 'אבי לוי'] }), ctxFor('noa@ariel.ac.il')))
    .toContain('פעמיים');
  expect(validateMaSubmission(base({ partnerMode: 'with', partnerNames: ['אבי לוי', 'דנה מזרחי'] }), ctxFor('noa@ariel.ac.il')))
    .toBeNull();
});

test('alone, with one partner, and with two read as one line for the coordinator', () => {
  expect(partnerSummary('alone', [])).toBe('לבד');
  expect(partnerSummary('with', ['אבי לוי'])).toBe('עם אבי לוי');
  expect(partnerSummary('with', ['אבי לוי', 'דנה מזרחי'])).toBe('עם אבי לוי + דנה מזרחי');
  // A row written before the columns existed, or a half-saved one: never a bare "עם".
  expect(partnerSummary('with', [])).toContain('לא צוין שם');
  expect(partnerSummary(null, null)).toBe('');
});

/* ── the mutual-confirmation nudge ────────────────────────────────────── */

test('THE NUDGE NEVER REVEALS THE OTHER ANSWER', () => {
  // Yariv: ask the student to check with their partner "מבלי להגיד לו מה הוא סימן".
  const text = mutualNotice('unconfirmed', ['אבי לוי']);
  expect(text).toContain('בדקו עם השותף/ה');
  // Not a word about what the partner marked, or whether they marked anything at all.
  expect(text).not.toContain('לבד');
  expect(text).not.toContain('אבי');      // not even the name is needed to say this
  expect(text).not.toContain('לא מילא');
  expect(text).not.toContain('בחר');
  // Confirmed needs no nudge.
  expect(mutualNotice('confirmed', ['אבי לוי'])).toBe('');
});

test('the addresses to verify against come from the cohort, never from typing', () => {
  const me = blob.students![0];
  expect(partnerEmails(blob, me, ['אבי לוי'])).toEqual(['avi@ariel.ac.il']);
  expect(partnerEmails(blob, me, ['אבי לוי', 'דנה מזרחי'])).toEqual(['avi@ariel.ac.il', 'dana@ariel.ac.il']);
  // Never the student's own address, and never a name outside the list.
  expect(partnerEmails(blob, me, ['נועה כהן'])).toEqual([]);
  expect(partnerEmails(blob, me, ['מישהו אחר'])).toEqual([]);
});

/* ── a proposed organization becomes the FIRST choice ─────────────────── */

test('A PROPOSAL BECOMES FIRST CHOICE — the same path as משאבי אנוש', () => {
  // Yariv: "שסטודנט שיציע ארגון הארגון יהפוך בחירה ראשונה שלו". That promotion lives in
  // the coordinator's suggestion inbox and is reached by writing these exact keys, so what
  // is pinned here is the contract between the two: the shape /ma submits, run through the
  // promotion the inbox performs.
  const proposal = buildProposal({
    name: '  חברת ביטוח כלשהי ', contactName: ' שרה כהן ', contactRole: 'מנהלת משאבי אנוש',
    email: ' Sara@insure.co.il ', phone: '050-1234567 ',
  });
  // Every key approveSuggestion reads, and nothing renamed.
  expect(Object.keys(proposal).sort()).toEqual(
    ['contactName', 'contactRole', 'email', 'location', 'name', 'notes', 'phone']);
  expect(proposal.name).toBe('חברת ביטוח כלשהי'); // trimmed, or it will not match by name
  expect(proposal.contactRole).toBe('מנהלת משאבי אנוש');

  // The inbox creates the employer from it, reserves one place in the student's course,
  // and promotes it. A student who had already ranked פסגות keeps it — one rank lower.
  const student: any = { id: 's1', name: 'נועה כהן', courseId: COURSE, year: 'תשפ״ז',
    firstChoiceOrg: 'פסגות', firstChoiceResult: 'pending', preferences: [] };
  const emp: any = { id: 'emp-new', name: proposal.name, approvalStatus: 'approved',
    restrictedToStudentId: 's1', courseIds: [COURSE] };
  const withPlace = setCourseCapacity(emp, COURSE, 1);
  const after = promoteOrgToFirst(student, [...(blob.employers as any[]), withPlace], proposal.name, withPlace.id);

  const ranked = [after.firstChoiceOrg, after.secondChoiceOrg, after.thirdChoiceOrg].filter(Boolean);
  expect(ranked[0]).toBe('חברת ביטוח כלשהי'); // FIRST
  expect(ranked).toContain('פסגות');          // and the earlier choice is not lost
  expect(countSlotsByStatus(withPlace, COURSE).available).toBe(1);
});

/* ── one person, several course rows ─────────────────────────────────────── */
/**
 * FOUND ON THE LIVE PROJECT, 2026-10-07, not by these tests.
 *
 * Name identification refused all fifteen students of פרקטיקום יעוץ ארגוני with "יש
 * יותר מסטודנט/ית אחד/ת בשם הזה". They are each carried on THREE course rows —
 * ariel-counseling-a, ariel-counseling-b and counseling-practicum-tashpaz are the same
 * people — and the ambiguity guard counted rows. The fixtures above hold exactly one row
 * per student, which is why nothing here caught it; this block models the real shape.
 */

const MULTI: Blob = {
  courses: [
    { id: MA_COURSE_ID,        name: 'פרקטיקום יעוץ ארגוני', year: 'תשפ״ז', type: 'practicum' },
    { id: 'ariel-counseling-a', name: 'מיומנויות ייעוץ א',    year: 'תשפ״ז', type: 'practicum' },
    { id: 'ariel-counseling-b', name: 'מיומנויות ייעוץ ב',    year: 'תשפ״ז', type: 'practicum' },
  ],
  students: [
    // ONE person, three rows, one address — the live shape.
    { id: 'r1', name: 'שירה אלון', email: 'shira@ariel.ac.il', courseId: 'ariel-counseling-a', year: 'תשפ״ז' },
    { id: 'r2', name: 'שירה אלון', email: 'shira@ariel.ac.il', courseId: 'ariel-counseling-b', year: 'תשפ״ז' },
    { id: 'r3', name: 'שירה אלון', email: 'shira@ariel.ac.il', courseId: MA_COURSE_ID,         year: 'תשפ״ז' },
    { id: 'r4', name: 'תום ברק',   email: 'tom@ariel.ac.il',   courseId: MA_COURSE_ID,         year: 'תשפ״ז' },
    // Two people who really do share a name: different addresses.
    { id: 'x1', name: 'מאיה גל',  email: 'maya1@ariel.ac.il', courseId: MA_COURSE_ID,         year: 'תשפ״ז' },
    { id: 'x2', name: 'מאיה גל',  email: 'maya2@ariel.ac.il', courseId: 'ariel-counseling-a', year: 'תשפ״ז' },
  ],
  employers: [{
    id: 'p1', name: 'פסגות', courseIds: [MA_COURSE_ID], notes: 'קרן פנסיה',
    approvalStatus: 'approved',
    vacancySlots: [{ id: 'sl1', courseId: MA_COURSE_ID, status: 'available' }],
  }],
};

test('THE LIVE BUG: one person on three course rows is one person, not an ambiguity', () => {
  const r = resolveMaStudent(MULTI, 'shira.alon.private@gmail.com', 'שירה אלון');
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.identifiedBy).toBe('name');
});

test('and the row it picks is the one THIS LINK is about, so the right organizations show', () => {
  // ariel-counseling-a comes first in the list and offers no organization at all; taking
  // whichever row was found first would have shown the student an empty form.
  const r = resolveMaStudent(MULTI, 'shira.alon.private@gmail.com', 'שירה אלון');
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.courseId).toBe(MA_COURSE_ID);
  expect(maOrgOptions(MULTI, r.courseId).map(o => o.name)).toEqual(['פסגות']);
  expect(partnerOptions(MULTI, r.student).map(p => p.name)).toEqual(['מאיה גל', 'תום ברק']);
});

test('the ADDRESS path picks that row too — the common case, and the same trap', () => {
  const r = resolveMaStudent(MULTI, 'shira@ariel.ac.il');
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.identifiedBy).toBe('email');
  expect(r.courseId).toBe(MA_COURSE_ID);
  expect(r.student.id).toBe('r3');
});

test('two people who really share a name are still refused, duplicates or not', () => {
  // The guard has to survive the fix: different addresses means different people.
  const r = resolveMaStudent(MULTI, 'someone@gmail.com', 'מאיה גל');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe('ambiguous-name');
});

test('a duplicated person is filed under their one address, once', () => {
  const r = resolveMaStudent(MULTI, 'shira.alon.private@gmail.com', 'שירה אלון');
  expect(submissionEmail(r, 'shira.alon.private@gmail.com')).toBe('shira@ariel.ac.il');
});


/**
 * "NOT YET" IS AN ANSWER — and the question behind it is WHEN MAY HE CALL.
 *
 * Yariv 2026-10-07: "אם הארגון בתהליך בדיקה בין הסטודנט לארגון אני צריך לדעת מתי אוכל
 * לפנות". A status describes the student; a permission describes what HE may do, which is
 * the only part he can act on — so "I propose an organization" and "I am in touch with
 * one" collapsed into a single option carrying this question.
 */
const own = (over: Partial<MaSubmission> = {}) => ({
  sub: base({
    email: 'noa@ariel.ac.il', orgChoice: '', proposing: true,
    proposal: { name: 'מכון אביב', contactName: '', contactRole: '', email: '', phone: '' },
    orgOffer: 'ליווי תהליכי פיתוח ארגוני', agreedWith: 'דיברנו והם מעוניינים',
    relationship: 'מכר של אבא שלי',
    ...over,
  }),
  ctx: { ...ctxFor('noa@ariel.ac.il'), orgs: maOrgOptions(blob, COURSE) } as MaContext,
});
const notYet = (over: Partial<MaSubmission> = {}) => ({
  sub: base({ email: 'noa@ariel.ac.il', orgChoice: '', ...over }),
  ctx: { ...ctxFor('noa@ariel.ac.il'), orgs: maOrgOptions(blob, COURSE) } as MaContext,
});

test('CALL THEM NOW: every contact detail is required, because he is about to dial', () => {
  const bare = own({ contactPermission: 'now' });
  expect(validateMaSubmission(bare.sub, bare.ctx)).toContain('שם איש/אשת הקשר');
  const full = own({
    contactPermission: 'now',
    proposal: { name: 'מכון אביב', contactName: 'שרה כהן', contactRole: 'מנהלת', email: 's@a.co.il', phone: '0501234567' },
  });
  expect(validateMaSubmission(full.sub, full.ctx)).toBeNull();
});

test('NOT YET: the same details are requested but not enforced', () => {
  // A student mid-conversation often does not have the direct line, and demanding it
  // produces an invented number — worse than a blank, because a blank is visible.
  const later = own({ contactPermission: 'later' });
  expect(validateMaSubmission(later.sub, later.ctx)).toBeNull();
});

test('THE DATE IS GONE — "not before the 15th" is no longer an answer the form accepts', () => {
  // Yariv 2026-10-07: "לא צריך תאריך שיוגדר זה במילא לא ראלי". A date a student guesses
  // at is a date nobody honours, and it only invited him to diarise a fiction.
  const wait = own({ contactPermission: 'wait' as any });
  expect(validateMaSubmission(wait.sub, wait.ctx)).toContain('מועד הפנייה');
  expect(contactPermissionLine('wait' as any)).toBe('');
});

test('but a detail that IS given must be a real one, whatever the timing', () => {
  const bad = own({
    contactPermission: 'later',
    proposal: { name: 'מכון אביב', contactName: 'שרה', contactRole: '', email: 'not-an-address', phone: '' },
  });
  expect(validateMaSubmission(bad.sub, bad.ctx)).toContain('אימייל');
  const badPhone = own({
    contactPermission: 'later',
    proposal: { name: 'מכון אביב', contactName: '', contactRole: '', email: '', phone: '12' },
  });
  expect(validateMaSubmission(badPhone.sub, badPhone.ctx)).toContain('טלפון');
});


test('the timing question itself cannot be skipped', () => {
  const none = own({ contactPermission: '' });
  expect(validateMaSubmission(none.sub, none.ctx)).toContain('מתי אפשר לפנות');
});

test("THE STUDENT'S OWN ACCOUNT is required whatever the timing", () => {
  // These are what he reads before he picks up the phone, and a student who cannot answer
  // them does not really have an organization yet.
  for (const [field, word] of [['orgOffer', 'מה הארגון מציע'], ['agreedWith', 'מה סוכם'], ['relationship', 'אופי הקשר']] as const) {
    const miss = own({ contactPermission: 'later', [field]: '' } as any);
    expect(validateMaSubmission(miss.sub, miss.ctx), `${field} must be required`).toContain(word);
  }
  // "How did you get to them" is the one he called least important, so it stays optional.
  const noHow = own({ contactPermission: 'later', howFound: '' });
  expect(validateMaSubmission(noHow.sub, noHow.ctx)).toBeNull();
});

test('an organization with no name is not an organization', () => {
  const anon = own({ contactPermission: 'later', proposal: { name: '', contactName: '', contactRole: '', email: '', phone: '' } });
  expect(validateMaSubmission(anon.sub, anon.ctx)).toContain('שם הארגון');
});

test('NO ORGANIZATION: nothing further is asked — the explanation belongs with him', () => {
  // Yariv struck the "why not the listed organization" box 2026-10-07: "אפשר להסיר שיפנו
  // אלי להסבר". A reason typed to get past a form is not a reason he can act on.
  const { sub, ctx } = notYet({ orgStatus: 'none' });
  expect(validateMaSubmission(sub, ctx)).toBeNull();
});


test('neither answer skips the CV — that is still the point of the form', () => {
  const a = own({ contactPermission: 'later', hasFile: false, hasExistingCv: false });
  expect(validateMaSubmission(a.sub, a.ctx)).toContain('קורות חיים');
  const b = notYet({ orgStatus: 'none', hasFile: false, hasExistingCv: false });
  expect(validateMaSubmission(b.sub, b.ctx)).toContain('קורות חיים');
});

test('a status or a permission the app never offers is refused rather than stored', () => {
  const s1 = notYet({ orgStatus: 'maybe' as any });
  expect(validateMaSubmission(s1.sub, s1.ctx)).not.toBeNull();
  const s2 = own({ contactPermission: 'whenever' as any });
  expect(validateMaSubmission(s2.sub, s2.ctx)).not.toBeNull();
});

test('THE LINE HE ACTS ON: the permission leads, then the organization', () => {
  expect(orgStatusLine({ proposing: true, orgName: 'מכון אביב', contactPermission: 'now' }))
    .toBe('אפשר לפנות לארגון עכשיו · מכון אביב');
  expect(orgStatusLine({ proposing: true, orgName: 'מכון אביב', contactPermission: 'later' }))
    .toContain('מכון אביב');
  expect(orgStatusLine({ orgStatus: 'none' })).toBe('אין ארגון כרגע');
});

test('the permission reads as a sentence, and an empty one prints nothing', () => {
  expect(contactPermissionLine('now')).toBe('אפשר לפנות לארגון עכשיו');
  expect(contactPermissionLine('later')).toContain('יעדכן');
  expect(contactPermissionLine('')).toBe('');
});

test('the open box stands on its own — offered whatever was chosen above', () => {
  expect(orgStatusLine({ statusNote: 'אני בחופשת לידה עד דצמבר' })).toBe('אני בחופשת לידה עד דצמבר');
  expect(orgStatusLine({})).toBe('');
  expect(orgStatusLine({ orgStatus: 'none' })).toBe('אין ארגון כרגע');
});

test("THE FOUR ANSWERS become the labelled block he reads before phoning", () => {
  expect(proposalContext({ orgOffer: 'ליווי', agreedWith: 'מעוניינים', relationship: 'מכר', howFound: 'דרך אבא' }))
    .toBe('מה הארגון מציע: ליווי\nמה סוכם עם איש/אשת הקשר: מעוניינים\nאופי הקשר: מכר\nאיך הגיע/ה לארגון: דרך אבא');
  // An unanswered optional question leaves no empty heading behind.
  expect(proposalContext({ orgOffer: 'ליווי' })).toBe('מה הארגון מציע: ליווי');
  expect(proposalContext({})).toBe('');
});

test('org_status is DERIVED, so the stored status cannot drift from the permission', () => {
  expect(derivedOrgStatus({ orgStatus: 'none' })).toBe('none');
  expect(derivedOrgStatus({ proposing: true, contactPermission: 'now' })).toBeNull();
  expect(derivedOrgStatus({ proposing: true, contactPermission: 'later' })).toBe('pending');
  expect(derivedOrgStatus({})).toBeNull();
});

test('the confirmation tells the student which answer was recorded', () => {
  expect(orgStatusHeadline('none')).toContain('אין לך ארגון');
  expect(orgStatusHeadline('')).toBe('');
});

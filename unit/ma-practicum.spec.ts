import { test, expect } from '@playwright/test';
import {
  resolveMaStudent, partnerOptions, maOrgOptions, validateMaSubmission,
  partnerSummary, placesNote, mutualNotice, partnerEmails, buildProposal, sameYear,
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
  const p = { name: 'חברה חדשה', contactName: 'שרה', contactRole: 'מנהלת HR', email: 'sara@x.co.il', phone: '0501234567' };
  const ok = base({ orgChoice: '', proposing: true, proposal: p });
  expect(validateMaSubmission(ok, ctxFor('noa@ariel.ac.il'))).toBeNull();
  expect(validateMaSubmission(base({ orgChoice: '', proposing: true, proposal: { ...p, contactRole: '' } }), ctxFor('noa@ariel.ac.il')))
    .toContain('תפקיד');
  expect(validateMaSubmission(base({ orgChoice: '', proposing: true, proposal: { ...p, email: 'not-an-email' } }), ctxFor('noa@ariel.ac.il')))
    .toContain('אימייל');
  expect(validateMaSubmission(base({ orgChoice: '', proposing: true, proposal: { ...p, phone: '123' } }), ctxFor('noa@ariel.ac.il')))
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

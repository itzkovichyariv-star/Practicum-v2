import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Two promises the student reads before they ever get an email:
 *
 *  • choosing an existing organization → "הארגון יצור איתך קשר להמשך מיון"
 *  • proposing their own organization  → 'ד"ר יריב איצקוביץ יצור קשר עם הארגון …
 *     ברגע שהארגון יאושר תקבל/י על כך עדכון במייל'
 *
 * Both promises are kept by supabase/functions/notify-placement. It runs on Deno
 * and cannot be imported here, so these cells read its source: the point is not
 * the HTML, it is that the promise and the mail that keeps it do not drift apart.
 * (Yariv 2026-10-07, "ברגע שזה ארגון כמו פסגות … הוא מקבל הודעה".)
 */
const fn = readFileSync(new URL('../supabase/functions/notify-placement/index.ts', import.meta.url), 'utf8');
const form = readFileSync(new URL('../src/components/MaPracticumForm.tsx', import.meta.url), 'utf8');

test('the function answers exactly the two events the form promises', () => {
  expect(fn).toContain("kind !== 'placed' && kind !== 'org-approved'");
});

test('a placed student is told the organization accepted them, by name', () => {
  expect(fn).toMatch(/kind === 'placed'[\s\S]{0,200}שובצת ל\$\{org\}/);
});

test('an approved proposal names WHO approved it — the same person the form named', () => {
  // ONE NAME, both ends. Yariv 2026-10-07: "אם אתה רוצה מנחה התכנית במקום ד״ר איצקוביץ
  // ולאחד את הנוסח של השם שלי זה סבבה" — the form had been calling him four things
  // (רכז התכנית, מנחה התכנית, מנחה הפרקטיקום, ד״ר איצקוביץ), which reads as four people.
  expect(form).toContain('מנחה התכנית יצור קשר עם הארגון');
  expect(fn).toContain('מנחה התכנית בחן את הארגון שהצעת');
  expect(form, 'the /ma form must name him one way only').not.toContain('ד"ר יריב איצקוביץ');
  expect(form).not.toContain('ד״ר יריב איצקוביץ');
  expect(form).not.toContain('רכז התכנית');
});

test('an approved proposal says the student may start, which is the whole point', () => {
  expect(fn).toContain('ותוכל/י להתחיל');
});

test('the supervisor is copied, so a mail that never arrives is visible to Yariv', () => {
  expect(fn).toContain('cc: [supervisorEmail]');
});

test('no RESEND key is a quiet no-send, never a thrown save', () => {
  expect(fn).toContain("return json({ ok: true, sent: false, reason: 'no key' })");
});

test('a student with no address is refused before any send', () => {
  expect(fn).toContain("if (!student?.email) return json({ ok: false, error: 'no student email' }, 400)");
});

/**
 * The mail YARIV gets when a student proposes an organization. One function serves two
 * forms: /cv-update is genuinely a second stage, /ma has no stages at all, so the shared
 * sentence "מועמד/ת מהשלב השני" was false for half its traffic — and named nobody.
 * (Yariv 2026-10-07: "אין שלב שני במקרה הזה … סטודנט או לנקוב בשמו הציע ארגון".)
 */
const sug = readFileSync(new URL('../supabase/functions/notify-org-suggestion/index.ts', import.meta.url), 'utf8');

test('the /ma form says which track it is, or the mail cannot tell', () => {
  expect(form).toContain("track: 'ma'");
});

test('a /ma proposal names the student and claims no second stage', () => {
  expect(sug).toContain("const isMa = record.track === 'ma'");
  expect(sug).toContain('${candidateName} הציע/ה ארגון מטעמו/ה לפרקטיקום');
});

test('/ma calls them a student, /cv-update still a candidate', () => {
  expect(sug).toContain("const person = isMa ? 'סטודנט/ית' : 'מועמד/ת'");
  expect(sug).toContain('מועמד/ת מהשלב השני הציע/ה ארגון מטעמו/ה');
});

test('the alert carries the address the row was FILED under, not the typed one', () => {
  // A student identified by name files under the address on their card. Sending the
  // typed address handed Yariv a key that opens no record.
  expect(form).toContain('candidateEmail: filedEmail');
  expect(form).not.toContain('candidateEmail: normEmail(email)');
});

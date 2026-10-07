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
  expect(form).toContain('ד"ר יריב איצקוביץ יצור קשר עם הארגון');
  expect(fn).toContain('ד"ר יריב איצקוביץ בחן את הארגון שהצעת');
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

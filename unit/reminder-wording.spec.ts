import { test, expect } from '@playwright/test';
import { migratePlacementData, getDefaultPlacementSettings, renderTemplate, firstNameOf, waitedForPhrase } from '../src/lib/placement';

/**
 * The reminder mail Yariv dictated on 2026-09-15. The wording is his; what is tested
 * here is that it actually REACHES him — a template he saved months ago is what the app
 * reads, so a new default alone would have changed nothing on his own practicum.
 */

const SUPERSEDED = `שלום {contactName},
רק מזכיר בעדינות — שלחנו אליכם את קורות החיים של {studentName} לפני {daysWaiting} ימים, במסגרת {courseName}.
קישור לקו"ח: {cvLink}
לתשובה בלחיצה אחת: {responseLink}
גם תשובה שלילית עוזרת לנו להתקדם עם הסטודנט/ית.
{contactBack}
תודה רבה,
{adminName}`;

const ctx = {
  contactName: 'אורטל חוברה', contactFirstName: 'אורטל', studentName: 'עטרת מישלוב',
  positionTitle: 'ארגון', adminName: 'יריב איצקוביץ', courseName: 'פרקטיקום משאבי אנוש',
  cvLink: 'https://x/cv.pdf', employerName: 'ארגון', daysWaiting: '22',
  waitedFor: waitedForPhrase(22),
  responseLink: 'https://practicum.yarivitzkovich.org/r?t=d1',
  contactBack: 'אם הקישור לא נפתח — אפשר פשוט לחזור אליי במייל Yarivi@ariel.ac.il.',
};
const mail = () => renderTemplate(getDefaultPlacementSettings().reminderEmailBodyTemplate ?? '', ctx);

test('the mail greets by first name and asks after them', () => {
  expect(mail().startsWith('שלום אורטל, מה שלומך?')).toBe(true);
  expect(mail()).not.toContain('חוברה');
});

test('the wait is phrased, not counted, and no placeholder leaks', () => {
  expect(mail()).toContain('לפני שלושה שבועות');   // 22 days, Yariv's own example
  expect(mail()).not.toContain('22');
  expect(mail()).not.toContain('לפני מספר שבועות'); // the fixed text it replaced
  expect(/\{\w+\}/.test(mail())).toBe(false);
});

/**
 * "לפני מספר שבועות" was fixed text, and the reminder can fire from about fourteen days —
 * so day 15 claimed "a few weeks" and day 40 understated it. Yariv: "תתאים את זה - מספר
 * הימים." Every boundary rounds DOWN: the sentence goes to someone who has not answered,
 * and overstating the wait would be both wrong and pointed.
 */
test('THE BUG: the phrase follows the real interval', () => {
  expect(waitedForPhrase(1)).toBe('אתמול');
  expect(waitedForPhrase(2)).toBe('לפני יומיים');
  expect(waitedForPhrase(5)).toBe('לפני 5 ימים');
  expect(waitedForPhrase(7)).toBe('לפני שבוע');
  expect(waitedForPhrase(13)).toBe('לפני שבוע');
  expect(waitedForPhrase(14)).toBe('לפני שבועיים');
  expect(waitedForPhrase(20)).toBe('לפני שבועיים');
  expect(waitedForPhrase(21)).toBe('לפני שלושה שבועות');
  expect(waitedForPhrase(28)).toBe('לפני חודש');
  expect(waitedForPhrase(44)).toBe('לפני חודש');
  expect(waitedForPhrase(45)).toBe('לפני יותר מחודש');
  expect(waitedForPhrase(120)).toBe('לפני יותר מחודש');
});

test('no number invents no interval', () => {
  for (const v of [undefined, null, '', 0, -3, NaN, 'abc']) {
    expect(waitedForPhrase(v as any)).toBe('לאחרונה');
  }
});

test('a string count works — the send path passes it as text', () => {
  expect(waitedForPhrase('22')).toBe('לפני שלושה שבועות');
});

test('the ask comes before the one-click link, and the sign-off is his', () => {
  const m = mail();
  expect(m.indexOf('נשמח לדעת')).toBeLessThan(m.indexOf('לתשובה בלחיצה אחת'));
  expect(m).toContain('המון תודה,\nיריב איצקוביץ');
});

test('THE POINT: a stored copy of the old wording is swapped for the new one', () => {
  const out: any = migratePlacementData({ placementSettings: { reminderEmailBodyTemplate: SUPERSEDED } } as any);
  expect(out.placementSettings.reminderEmailBodyTemplate).toContain('מה שלומך?');
  expect(out.placementSettings.reminderEmailBodyTemplate).not.toContain('רק מזכיר בעדינות');
});

test('a hand-edited template is never clobbered', () => {
  const mine = 'שלום {contactName},\nניסוח משלי שאסור לדרוס. {responseLink} {contactBack}\nתודה,\n{adminName}';
  const out: any = migratePlacementData({ placementSettings: { reminderEmailBodyTemplate: mine } } as any);
  expect(out.placementSettings.reminderEmailBodyTemplate).toContain('ניסוח משלי שאסור לדרוס');
});

test('a one-word contact name survives, and an empty one does not become "שלום ,"', () => {
  expect(firstNameOf('אורטל חוברה')).toBe('אורטל');
  expect(firstNameOf('אורטל')).toBe('אורטל');
  expect(firstNameOf('  יובל   ליבנה ')).toBe('יובל');
  expect(firstNameOf('')).toBe('');
  expect(firstNameOf(null)).toBe('');
});

/**
 * Each revision leaves another stored copy out there. A migration that only ever compares
 * against the immediately previous wording strands whoever deployed in between — so both
 * superseded versions have to move forward.
 */
test('the first-pass wording migrates too, not just the oldest one', () => {
  const firstPass = `שלום {contactFirstName}, מה שלומך?
שלחנו אליכם את קורות החיים של {studentName} לפני מספר שבועות, במסגרת {courseName}.
קישור לקו"ח: {cvLink}
נשמח לדעת אם המועמדות רלוונטית עבורכם. גם תשובה שלילית עוזרת לנו להתקדם עם הסטודנט/ית.
לתשובה בלחיצה אחת: {responseLink}
{contactBack}
המון תודה,
{adminName}`;
  const out: any = migratePlacementData({ placementSettings: { reminderEmailBodyTemplate: firstPass } } as any);
  expect(out.placementSettings.reminderEmailBodyTemplate).toContain('{waitedFor}');
  expect(out.placementSettings.reminderEmailBodyTemplate).not.toContain('לפני מספר שבועות');
});

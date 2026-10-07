import { test, expect } from '@playwright/test';
import { migratePlacementData, getDefaultPlacementSettings, renderTemplate, firstNameOf } from '../src/lib/placement';

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
  responseLink: 'https://practicum.yarivitzkovich.org/r?t=d1',
  contactBack: 'אם הקישור לא נפתח — אפשר פשוט לחזור אליי במייל Yarivi@ariel.ac.il.',
};
const mail = () => renderTemplate(getDefaultPlacementSettings().reminderEmailBodyTemplate ?? '', ctx);

test('the mail greets by first name and asks after them', () => {
  expect(mail().startsWith('שלום אורטל, מה שלומך?')).toBe(true);
  expect(mail()).not.toContain('חוברה');
});

test('no day count is quoted, and no placeholder leaks', () => {
  expect(mail()).toContain('לפני מספר שבועות');
  expect(mail()).not.toContain('22');
  expect(/\{\w+\}/.test(mail())).toBe(false);
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

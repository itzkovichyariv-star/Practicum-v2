import { test, expect } from '@playwright/test';
import { getDefaultPlacementSettings, migratePlacementData, renderTemplate } from '../src/lib/placement';

// Yariv 2026-10-14: "נוסח ההודעות בווטסאפ מאוד מסורבל … רק שם פרטי … יותר חברי בסגנון היי
// מרב, אני מצרף קישור לקורות חיים לפרקטיקום של הסטודנטית, אנא זמנו בהקדם לראיון ועדכנו,
// המון תודה יריב".

const ctx = {
  contactName: 'מרב כהן', contactFirstName: 'מרב', studentName: 'נועה ברק',
  positionTitle: 'מרכז רפואי שמיר', adminName: 'יריב איצקוביץ', adminFirstName: 'יריב',
  courseName: 'פרקטיקום משאבי אנוש', cvLink: 'https://x/cv.pdf', employerName: 'מרכז רפואי שמיר',
  responseLink: 'https://practicum.yarivitzkovich.org/r?t=d1', contactBack: 'אם הקישור לא נפתח…',
};

const OLD = `שלום {contactName},
מצורף קישור לקורות חיים של {studentName} עבור התפקיד {positionTitle} במסגרת {courseName}.
קישור לקו"ח: {cvLink}
לתשובה מהירה (הזמנה לראיון / לא מתאים): {responseLink}
{contactBack}
תודה,
{adminName}`;

test('the first WhatsApp is short, friendly, first names only', () => {
  const msg = renderTemplate(getDefaultPlacementSettings().whatsappTemplate, ctx);
  expect(msg.startsWith('היי מרב,')).toBe(true);
  expect(msg).not.toContain('כהן');
  expect(msg).toContain('נועה ברק');
  expect(msg).toContain('https://x/cv.pdf');
  expect(msg).toContain('https://practicum.yarivitzkovich.org/r?t=d1');
  expect(msg.trim().endsWith('המון תודה,\nיריב')).toBe(true);
  expect(msg).not.toContain('איצקוביץ');
  expect(msg).not.toContain('אם הקישור לא נפתח');
  expect(msg).not.toContain('במסגרת');
  expect(msg).not.toMatch(/\{\w+\}/);
});

test('his saved stock template is swapped for the new one', () => {
  const out: any = migratePlacementData({ placementSettings: { ...getDefaultPlacementSettings(), whatsappTemplate: OLD } } as any);
  expect(out.placementSettings.whatsappTemplate).toBe(getDefaultPlacementSettings().whatsappTemplate);
});

test('a hand-written WhatsApp template is left alone', () => {
  const mine = 'היי {contactFirstName}, ניסוח שלי {cvLink} {responseLink}\nתודה';
  const out: any = migratePlacementData({ placementSettings: { ...getDefaultPlacementSettings(), whatsappTemplate: mine } } as any);
  expect(out.placementSettings.whatsappTemplate).toBe(mine);
});

test('the new template survives a second migration pass unchanged', () => {
  const once: any = migratePlacementData({ placementSettings: getDefaultPlacementSettings() } as any);
  const twice: any = migratePlacementData(once);
  expect(twice.placementSettings.whatsappTemplate).toBe(getDefaultPlacementSettings().whatsappTemplate);
});

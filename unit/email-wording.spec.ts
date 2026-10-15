import { test, expect } from '@playwright/test';
import { getDefaultPlacementSettings, migratePlacementData, renderTemplate, buildWhatsAppUrl, buildMailtoUrl, myPhoneOf } from '../src/lib/placement';

// Yariv 2026-10-15, his own wording for the first mail to an employer (an acquaintance,
// "לא שיחה ראשונה"), no answer link ("בהרבה מקרים זה לא עובד"), and both channels
// forced right-to-left ("אחרת זה מייצר טקסט שקשה לערוך").

const ctx = {
  contactName: 'מרב כהן', contactFirstName: 'מרב', studentName: 'נועה ברק',
  positionTitle: 'מרכז רפואי שמיר', adminName: 'יריב איצקוביץ', adminFirstName: 'יריב',
  courseName: 'פרקטיקום משאבי אנוש', cvLink: 'https://x/cv.pdf', employerName: 'מרכז רפואי שמיר',
  responseLink: 'https://p/r?t=d1', contactBack: 'אם הקישור לא נפתח…', myPhone: '052-3975027',
};
const OLD_BODY = `שלום {contactName},
מצורף קישור לקורות חיים של {studentName} עבור התפקיד {positionTitle} במסגרת קורס {courseName} באוניברסיטת אריאל.
קישור לקו"ח: {cvLink}
לתשובה מהירה (הזמנה לראיון / לא מתאים): {responseLink}
{contactBack}
תודה,
{adminName}`;

test('the first mail reads as he wrote it', () => {
  const d = getDefaultPlacementSettings();
  const body = renderTemplate(d.emailBodyTemplate, ctx);
  expect(body).toBe(`היי מרב,
מצורף קישור לקורות חיים של נועה ברק במסגרת קורס פרקטיקום משאבי אנוש באוניברסיטת אריאל.
קישור לקו"ח: https://x/cv.pdf

אשמח אם תוכלו לזמן לראיון בהקדם. בכל דבר ועניין אפשר לחזור אליי בטלפון או בוואטסאפ 052-3975027.
המון תודה,
יריב`);
  expect(renderTemplate(d.emailSubjectTemplate, ctx)).toBe('קורות חיים לפרקטיקום – נועה ברק');
});

test('his saved stock mail and subject are swapped; his own wording is kept', () => {
  const stock: any = migratePlacementData({ placementSettings: { ...getDefaultPlacementSettings(),
    emailBodyTemplate: OLD_BODY, emailSubjectTemplate: 'מועמדות {studentName} ל-{positionTitle}' } } as any).placementSettings;
  expect(stock.emailBodyTemplate).toBe(getDefaultPlacementSettings().emailBodyTemplate);
  expect(stock.emailSubjectTemplate).toBe(getDefaultPlacementSettings().emailSubjectTemplate);
  expect(stock.emailBodyTemplate).not.toContain('{responseLink}');
  expect(stock.emailBodyTemplate).not.toContain('{contactBack}');
  const mine = 'היי {contactFirstName}, משלי {cvLink}';
  const kept: any = migratePlacementData({ placementSettings: { ...getDefaultPlacementSettings(), emailBodyTemplate: mine } } as any).placementSettings;
  expect(kept.emailBodyTemplate).toBe(mine);
});

test('the phone is the coordinator phone, else the WhatsApp one', () => {
  expect(myPhoneOf({ coordinatorPhone: '052-1', coordinatorWhatsapp: '054-2' })).toBe('052-1');
  expect(myPhoneOf({ coordinatorWhatsapp: '054-2' })).toBe('054-2');
  expect(myPhoneOf({})).toBe('');
});

test('both channels open every line right-to-left, link lines included', () => {
  const msg = 'היי מרב,\nhttps://x/cv.pdf\nהמון תודה';
  const wa = decodeURIComponent(buildWhatsAppUrl('0521234567', msg).split('?text=')[1]);
  expect(wa.split('\n').every((l) => l.startsWith('‏'))).toBe(true);
  const mail = decodeURIComponent(buildMailtoUrl('a@b.c', 's', msg).split('&body=')[1]);
  expect(mail.split('\n').every((l) => l.startsWith('‏'))).toBe(true);
});

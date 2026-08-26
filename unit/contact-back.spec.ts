import { test, expect } from '@playwright/test';
import { contactBackSentence, getDefaultPlacementSettings, migratePlacementData } from '../src/lib/placement';

/**
 * The human route back.
 *
 * Yariv 2026-08-26, after an employer's one-click link failed: "ואמירה בהודעה שאפשר
 * לחזור אלי גם בטלפון או במייל או בווטסאפ".
 *
 * A link is a single point of failure. It can be stripped by a mail client, wrapped by
 * a plain-text renderer, or point at a dispatch whose "it went" confirmation was never
 * given — and today, when it fails, the employer has nowhere to go and the placement
 * just goes quiet.
 */

test('no contact configured → no sentence, rather than an empty promise', () => {
  expect(contactBackSentence({})).toBe('');
  expect(contactBackSentence({ coordinatorPhone: '   ' })).toBe('');
  expect(contactBackSentence(null)).toBe('');
});

test('each configured channel appears, and only the configured ones', () => {
  const phoneOnly = contactBackSentence({ coordinatorPhone: '054-1234567' });
  expect(phoneOnly).toContain('054-1234567');
  expect(phoneOnly).not.toContain('במייל');

  const emailOnly = contactBackSentence({ coordinatorEmail: 'yariv@example.ac.il' });
  expect(emailOnly).toContain('yariv@example.ac.il');
  expect(emailOnly).not.toContain('בטלפון');
});

test('WhatsApp falls back to the phone — it is normally the same number', () => {
  const s = contactBackSentence({ coordinatorPhone: '054-1234567' });
  expect(s).toContain('בוואטסאפ 054-1234567');

  const split = contactBackSentence({ coordinatorPhone: '03-9000000', coordinatorWhatsapp: '054-1234567' });
  expect(split).toContain('בטלפון 03-9000000');
  expect(split).toContain('בוואטסאפ 054-1234567');
});

test('every employer-facing template ships with the placeholder', () => {
  const d = getDefaultPlacementSettings();
  for (const k of ['whatsappTemplate', 'emailBodyTemplate', 'reminderWhatsappTemplate', 'reminderEmailBodyTemplate'] as const) {
    expect((d as any)[k], k).toContain('{contactBack}');
  }
});

test('a template saved before this existed gains the line, without losing its wording', () => {
  // Same migration the response link uses. The wording may have been edited by hand,
  // so only the missing line is ours to add.
  const custom = 'שלום {contactName},\nנוסח שיריב כתב בעצמו.\nתודה,\n{adminName}';
  const data: any = { placementSettings: { ...getDefaultPlacementSettings(), emailBodyTemplate: custom } };
  const out: any = migratePlacementData(data);
  const tpl: string = out.placementSettings.emailBodyTemplate;
  expect(tpl).toContain('{contactBack}');
  expect(tpl).toContain('נוסח שיריב כתב בעצמו.');
  // ...and it lands above the signature, so it reads as part of the ask.
  expect(tpl.indexOf('{contactBack}')).toBeLessThan(tpl.indexOf('תודה,'));
});

test('the migration is idempotent — a second pass does not double the line', () => {
  const data: any = { placementSettings: getDefaultPlacementSettings() };
  const once: any = migratePlacementData(data);
  const twice: any = migratePlacementData(once);
  const count = (s: string) => s.split('{contactBack}').length - 1;
  expect(count(twice.placementSettings.emailBodyTemplate)).toBe(1);
});

test('the email is taken from where the system already keeps it', () => {
  // Yariv 2026-08-26: "צריך להילקח משם". coordinatorEmail/supervisorEmail have lived at
  // the top level of the data since long before {contactBack} existed. Asking for the
  // same address a second time is how two boxes drift apart.
  const out: any = migratePlacementData({ coordinatorEmail: 'rachel@example.ac.il' } as any);
  expect(out.placementSettings.coordinatorEmail).toBe('rachel@example.ac.il');
  expect(contactBackSentence(out.placementSettings)).toContain('rachel@example.ac.il');
});

test('THE SUPERVISOR WINS: the coordinator role is vacant, so it must not be offered', () => {
  // Yariv 2026-08-26: "אין רכז פרקטיקום פעיל ואני יכול להיות זמין עם המייל שלי".
  // Preferring the coordinator would print a dead end in every employer message — worse
  // than the broken link this line exists to survive.
  const out: any = migratePlacementData({
    coordinatorEmail: 'rachel@example.ac.il',
    supervisorEmail: 'yariv@example.ac.il',
  } as any);
  expect(out.placementSettings.coordinatorEmail).toBe('yariv@example.ac.il');
  expect(contactBackSentence(out.placementSettings)).not.toContain('rachel');
});

test('the coordinator is still used when there is no supervisor', () => {
  const out: any = migratePlacementData({ coordinatorEmail: 'rachel@example.ac.il' } as any);
  expect(out.placementSettings.coordinatorEmail).toBe('rachel@example.ac.il');
});

test('an address typed into placement settings is not overwritten by the seed', () => {
  const out: any = migratePlacementData({
    coordinatorEmail: 'rachel@example.ac.il',
    placementSettings: { ...getDefaultPlacementSettings(), coordinatorEmail: 'someone.else@example.ac.il' },
  } as any);
  expect(out.placementSettings.coordinatorEmail).toBe('someone.else@example.ac.il');
});

test('the phone is NOT taken from an employer — that is the organization own number', () => {
  // An employer receiving their own number back cannot use it to reach the coordinator.
  // Nothing in the data model holds a coordinator phone, which is why it is the one
  // field that must be typed once.
  const s = contactBackSentence({ coordinatorEmail: 'rachel@example.ac.il' });
  expect(s).toContain('rachel@example.ac.il');
  expect(s).not.toContain('בטלפון');
});

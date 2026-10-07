import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';

/**
 * The coordinator's alert mail, RENDERED — not grepped.
 *
 * notify-org-suggestion now says three different things (a proposal awaiting approval, an
 * organization that may be called, a plain status update), and the three share one deeply
 * nested template literal. Reading the source cannot tell you which branch a student's
 * answer will actually produce, so this runs the real handler: the function is transpiled,
 * Deno.serve and fetch are stubbed, and the assertions are made against the HTML and the
 * subject line that Resend would have been handed.
 *
 * It is the only check in this repository that the mail Yariv reads matches the promise the
 * form makes on screen, and it needs neither Supabase nor Resend to run.
 */

type Sent = { subject: string; html: string; to: string[] };

/** Load the edge function with its two outside dependencies replaced by stubs. */
async function callFunction(record: unknown): Promise<Sent> {
  const src = buildSync({
    entryPoints: ['supabase/functions/notify-org-suggestion/index.ts'],
    bundle: false, write: false, format: 'cjs', platform: 'node', loader: { '.ts': 'ts' },
  }).outputFiles[0].text;

  let handler: ((req: Request) => Promise<Response>) | null = null;
  const sent: Sent[] = [];

  const Deno = {
    serve: (h: (req: Request) => Promise<Response>) => { handler = h; },
    env: { get: (k: string) => (k === 'RESEND_API_KEY' ? 'test-key' : 'https://example.test') },
  };
  const __createClient = () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { data: { supervisorEmail: 'itzkovichyariv@gmail.com' } } }),
        }),
      }),
    }),
  });
  const fetchStub = async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    sent.push({ subject: body.subject, html: body.html, to: body.to });
    return { json: async () => ({ id: 'test-message-id' }) } as any;
  };

  // eslint-disable-next-line no-new-func
  new Function('Deno', '__createClient', 'fetch', 'Response', 'module', 'exports', 'require', src)(
    // require() is how the transpiled module reaches @supabase/supabase-js; the stub
    // answers with the one call the function makes (practicum_data → the recipients).
    Deno, __createClient, fetchStub, Response, { exports: {} }, {}, () => ({ createClient: __createClient }),
  );
  if (!handler) throw new Error('the function never registered a handler');

  const res = await (handler as (req: Request) => Promise<Response>)(
    new Request('https://example.test/', { method: 'POST', body: JSON.stringify({ record }) }),
  );
  const payload = await res.json();
  if (!sent.length) throw new Error(`no mail was sent: ${JSON.stringify(payload)}`);
  return sent[0];
}

const ORG = {
  name: 'מכון אביב', contactName: 'רונית שגב', contactRole: 'מנהלת משאבי אנוש',
  email: 'ronit@aviv.co.il', phone: '052-1234567', location: 'תל אביב',
  notes: 'מה הארגון מציע: ליווי תהליך שינוי\nמה סוכם עם איש/אשת הקשר: יומיים בשבוע\nאופי הקשר: אחותי עובדת שם',
};

test('A PROPOSAL HE MAY CALL TODAY: approve-this, and a green permission band', async () => {
  const mail = await callFunction({
    track: 'ma', candidateName: 'נועה כהן', candidateEmail: 'noa@ariel.ac.il',
    suggestedOrg: ORG, contactPermission: 'now', permissionLine: 'אפשר לפנות לארגון עכשיו',
  });
  expect(mail.subject).toContain('הצעת ארגון');
  expect(mail.subject).toContain('אפשר לפנות');
  expect(mail.html).toContain('הציע/ה ארגון');
  expect(mail.html).toContain('לאישור ההצעה');
  expect(mail.html).toContain('אפשר לפנות לארגון עכשיו');
  expect(mail.html).toContain('#065f46');          // green: act today
  // The details he wanted collected, so he can call without opening the app.
  expect(mail.html).toContain('רונית שגב');
  expect(mail.html).toContain('052-1234567');
  expect(mail.html).toContain('ליווי תהליך שינוי');
  expect(mail.html).toContain('אחותי עובדת שם');
  // track: 'ma' — no second stage in this practicum (Yariv 2026-10-07).
  expect(mail.html).toContain('סטודנט/ית');
  expect(mail.html).not.toContain('מהשלב השני');
});

test('A PROPOSAL HE MAY NOT CALL YET says so in the subject line, and in amber', async () => {
  const mail = await callFunction({
    track: 'ma', candidateName: 'נועה כהן', candidateEmail: 'noa@ariel.ac.il',
    suggestedOrg: ORG, contactPermission: 'wait', contactAfter: '2026-11-03',
    permissionLine: 'לא לפנות עד 03/11/2026',
  });
  // The subject is where he decides whether to open it now, so the hold has to be there.
  expect(mail.subject).toContain('לא לפנות עד 03/11/2026');
  expect(mail.html).toContain('לא לפנות עד 03/11/2026');
  expect(mail.html).toContain('#92400e');          // amber: do not act yet
  expect(mail.html).not.toContain('#065f46');
});

test('THE /cv-update FORM IS UNTOUCHED: with no track, the stage-2 wording stands', async () => {
  const mail = await callFunction({ candidateName: 'דני כץ', candidateEmail: 'dani@x.co.il', suggestedOrg: ORG });
  expect(mail.html).toContain('מועמד/ת מהשלב השני');
  expect(mail.subject).toContain('הצעת ארגון');
});

test('RELEASED: the mail says exactly what Yariv asked it to say', async () => {
  // "אני אקבל הודעה שאומרת סטודנט x עדכן שניתן לפנות לארגון"
  const mail = await callFunction({
    track: 'ma', isRelease: true, candidateName: 'נועה כהן', candidateEmail: 'noa@ariel.ac.il',
    suggestedOrg: ORG, contactPermission: 'now', permissionLine: 'אפשר לפנות לארגון עכשיו',
  });
  expect(mail.subject).toContain('נועה כהן');
  expect(mail.subject).toContain('אפשר לפנות למכון אביב');
  expect(mail.html).toContain('עדכן/ה: אפשר לפנות');
  expect(mail.html).toContain('ניתן לפנות לארגון');       // the eyebrow, not "דרוש אישור"
  // It must not describe a release as a brand-new proposal he has yet to see.
  expect(mail.html).not.toContain('הציע/ה ארגון מטעמו/ה לפרקטיקום');
  // It carries the contact, which is the whole point of releasing him to call.
  expect(mail.html).toContain('רונית שגב');
  expect(mail.html).toContain('052-1234567');
});

test('NO ORGANIZATION reaches him too, with the why — and asks him to make contact', async () => {
  // Until now this answer sat unseen in the table. Yariv 2026-10-07: a student with no
  // organization is told "אנא פנה למנחה הפרקטיקום לתיאום", so he has to know they exist.
  const mail = await callFunction({
    track: 'ma', noOrg: true, candidateName: 'אבי לוי', candidateEmail: 'avi@ariel.ac.il',
    whyNotListed: 'מרחק נסיעה מפתח תקווה', statusNote: 'אשמח לעזרה בחיפוש',
  });
  expect(mail.subject).toContain('אין ארגון כרגע');
  expect(mail.subject).toContain('אבי לוי');
  expect(mail.html).toContain('מרחק נסיעה מפתח תקווה');
  expect(mail.html).toContain('אשמח לעזרה בחיפוש');
  expect(mail.html).toContain('לתיאום');
  expect(mail.html).toContain('אין ארגון כרגע');     // the eyebrow says what this is
  // Nothing to approve, so nothing may say there is: this is the defect a grep would miss.
  expect(mail.html).not.toContain('דרוש אישור');
  expect(mail.html).not.toContain('לאישור ההצעה');
  expect(mail.html).not.toContain('כפופה לאישורך');
  expect(mail.html).not.toContain('הבחירה הראשונה');
  // And no permission band, because there is no organization to have permission about.
  expect(mail.html).not.toContain('אפשר לפנות לארגון עכשיו');
});

test('the student’s own note travels whatever the answer was', async () => {
  const mail = await callFunction({
    track: 'ma', candidateName: 'דנה מזרחי', suggestedOrg: ORG,
    contactPermission: 'later', permissionLine: 'עדיין בתהליך — הסטודנט/ית יעדכן/תעדכן מתי אפשר לפנות',
    statusNote: 'אני בחופשת לידה עד דצמבר',
  });
  expect(mail.html).toContain('הערת הסטודנט/ית');
  expect(mail.html).toContain('אני בחופשת לידה עד דצמבר');
});

test('the mail always goes to Yariv, is RTL, and leaves no label over a blank', async () => {
  const mail = await callFunction({ track: 'ma', noOrg: true, candidateName: 'אבי לוי', whyNotListed: 'רחוק' });
  expect(mail.to).toContain('itzkovichyariv@gmail.com');
  expect(mail.html).toMatch(/dir="rtl"/);
  // detailRow drops empty values, so no heading is left dangling over nothing.
  expect(mail.html).not.toContain('שם הארגון</td>');
  expect(mail.html).not.toContain('טלפון</td>');
});

test('A PLAIN LIST CHOICE is the quietest of the four, and asks for nothing', async () => {
  // The form now mails him on every submission, because the confirmation promises in
  // writing that he was updated. This one must not read as work: there is nothing to
  // approve and nobody to call.
  const mail = await callFunction({
    track: 'ma', chosenOrg: 'פסגות', candidateName: 'נועה כהן', candidateEmail: 'noa@ariel.ac.il',
    partnerSummary: 'בזוג עם אבי לוי',
  });
  expect(mail.subject).toContain('בחר/ה בפסגות');
  expect(mail.html).toContain('הגשה רגילה');
  expect(mail.html).toContain('בזוג עם אבי לוי');
  // Nothing in it may claim a proposal is waiting on him — the defect this test exists for.
  expect(mail.html).not.toContain('דרוש אישור');
  expect(mail.html).not.toContain('כפופה לאישורך');
  expect(mail.html).not.toContain('לאישור ההצעה');
  expect(mail.html).not.toContain('הבחירה הראשונה');
});

test('a payload with neither an organization nor the noOrg flag is refused, not half-sent', async () => {
  await expect(callFunction({ track: 'ma', candidateName: 'אבי לוי' })).rejects.toThrow(/no mail was sent/);
});

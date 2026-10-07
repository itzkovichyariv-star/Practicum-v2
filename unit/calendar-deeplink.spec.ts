import { test, expect } from '@playwright/test';
import { outlookCalendarUrl, ARIEL_CALENDAR_ACCOUNT } from '../src/components/pageShared';

/**
 * The link behind "📅 פתח יומן אריאל".
 *
 * Yariv, 2026-09-08: "כשאני קובע הרצאה ומבקש לשריין ביומן שלי הוא לא פותח יומן
 * (בלחיצה על יומן). הצפיה שיפתח יומן של yarivi@ariel.ac.il."
 *
 * Three separate reasons that click could do nothing, all of them real:
 *
 *   1. The URL was missing `path=/calendar/action/compose`. `rru=addevent` on its own
 *      loads the OWA shell and stops — a blank tab, which is the single most reported
 *      symptom of these deeplinks. This is the one that made a click "not open a
 *      calendar" even when the popup itself succeeded.
 *   2. `/calendar/0/` pinned the request to account INDEX 0 of the browser's Outlook
 *      session — "whoever signed in first", not the Ariel mailbox. Nothing in the URL
 *      even mentioned yarivi@ariel.ac.il.
 *   3. The button was `disabled` whenever the lecture had no date, so clicking it ran
 *      no code at all and the `alert('חסר תאריך')` inside the handler was unreachable.
 *      Covered in LectureEditor, not here.
 *
 * Worth stating plainly, because it bounds what this test can promise: Microsoft
 * publishes NO parameter that forces a specific mailbox. `login_hint` only pre-fills the
 * address when Outlook actually routes through sign-in; a live session for another
 * account still wins. That is why the popup-blocked path falls back to an .ics file,
 * which lands in the right calendar no matter which session the browser holds.
 */

const base = {
  subject: 'הרצאה: אתיקה בייעוץ',
  startDate: '2026-11-03',
  startTime: '10:00',
  endTime: '11:30',
};

test('the compose path is present — without it OWA opens a blank shell', () => {
  const u = new URL(outlookCalendarUrl(base));
  expect(u.searchParams.get('path')).toBe('/calendar/action/compose');
  expect(u.searchParams.get('rru')).toBe('addevent');
});

test('no hardcoded account index — /calendar/0/ pinned the wrong mailbox', () => {
  const u = new URL(outlookCalendarUrl(base));
  expect(u.pathname).toBe('/calendar/deeplink/compose');
  expect(u.pathname).not.toContain('/0/');
});

test('the Ariel mailbox is named in the URL, so sign-in pre-fills it', () => {
  const u = new URL(outlookCalendarUrl(base));
  expect(u.searchParams.get('login_hint')).toBe(ARIEL_CALENDAR_ACCOUNT);
  expect(ARIEL_CALENDAR_ACCOUNT).toBe('yarivi@ariel.ac.il');
});

test('the signed-in user overrides the default hint', () => {
  const u = new URL(outlookCalendarUrl({ ...base, account: 'rachelshal@ariel.ac.il' }));
  expect(u.searchParams.get('login_hint')).toBe('rachelshal@ariel.ac.il');
});

test('date and time survive the round trip unescaped', () => {
  const u = new URL(outlookCalendarUrl(base));
  expect(u.searchParams.get('startdt')).toBe('2026-11-03T10:00:00');
  expect(u.searchParams.get('enddt')).toBe('2026-11-03T11:30:00');
});

test('a missing end time becomes start + 1h rather than a zero-length event', () => {
  const u = new URL(outlookCalendarUrl({ ...base, endTime: undefined }));
  expect(u.searchParams.get('enddt')).toBe('2026-11-03T11:00:00');
});

test('Hebrew subject, location and attendee are encoded, not dropped', () => {
  const u = new URL(outlookCalendarUrl({
    ...base,
    location: 'בניין 46, חדר 12',
    attendeeEmail: 'lecturer@example.com',
    body: 'קורס: משאבי אנוש\nמרצה: דנה',
  }));
  expect(u.searchParams.get('subject')).toBe('הרצאה: אתיקה בייעוץ');
  expect(u.searchParams.get('location')).toBe('בניין 46, חדר 12');
  expect(u.searchParams.get('to')).toBe('lecturer@example.com');
  expect(u.searchParams.get('body')).toContain('משאבי אנוש');
});

test('an absent location or attendee adds no empty parameter', () => {
  const u = new URL(outlookCalendarUrl(base));
  expect(u.searchParams.has('location')).toBe(false);
  expect(u.searchParams.has('to')).toBe(false);
});

test('spaces are %20, never +, and path keeps its literal slashes', () => {
  // Outlook's deeplink handler mis-reads `+` in these fields, so URLSearchParams
  // (which writes spaces as `+`) must not be used to build this URL.
  const raw = outlookCalendarUrl({ ...base, subject: 'שתי מילים', location: 'בניין 46' });
  expect(raw).toContain('path=/calendar/action/compose');
  const query = raw.slice(raw.indexOf('?') + 1);
  expect(query).not.toContain('+');
  expect(raw).toContain('%20');
});

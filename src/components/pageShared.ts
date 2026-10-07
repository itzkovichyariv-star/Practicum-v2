import type { PracticumData, Course } from '../lib/supabase';
import { normalizeYear } from '../lib/session';
import type { Context } from '../lib/session';
import type { Page } from './TopBar';

export { normalizeYear };

export type PageProps = {
  data: PracticumData;
  context: Context;
  onContext?: (c: Context) => void;
  userName: string;
  lastUpdated?: string;
  lastEditor?: string;
  onRefresh: () => void;
  onNavigate: (page: Page) => void;
};

/**
 * Checks whether an item belongs to the current context (course + year).
 *
 * context.courseId can be either:
 *   - '__all__'            → no course filter
 *   - a course ID string   → exact match (legacy / editor use)
 *   - a course NAME string → matches all course records with that name (TopBar filter)
 *
 * Pass `courses` (from data.courses) so the function can expand a name to all matching IDs.
 */
export function sameContext(
  item: { courseId?: string; year?: string },
  context: Context,
  courses?: { id: string; name?: string }[],
): boolean {
  if (context.courseId !== '__all__') {
    if (courses && courses.length > 0) {
      // Resolve: if context.courseId is a known course name, expand to all matching IDs.
      // If it's an exact ID, this still works (the set will contain just that ID).
      const allowedIds = new Set(
        courses
          .filter(c => c.name === context.courseId || c.id === context.courseId)
          .map(c => c.id)
      );
      if (!allowedIds.has(item.courseId || '')) return false;
    } else {
      // Fallback (no courses list): exact ID match
      if (item.courseId !== context.courseId) return false;
    }
  }
  if (context.year !== '__all__' && normalizeYear(item.year) !== normalizeYear(context.year)) return false;
  return true;
}

/** Groups a filtered list by year then course, for display when context is "all". */
export function groupByYearCourse<T extends { courseId?: string | null; year?: string }>(
  items: T[],
  courses: Course[],
  context: Context,
): { year: string; courseId: string; courseName: string; showYear: boolean; items: T[] }[] {
  const courseMap = new Map(courses.map(c => [c.id, c.name || c.id]));
  const showYear = context.year === '__all__';
  const map = new Map<string, { year: string; courseId: string; courseName: string; showYear: boolean; items: T[] }>();

  for (const item of items) {
    const year = normalizeYear(item.year) || '—';
    const courseId = item.courseId || '';
    const courseName = courseMap.get(courseId) || courseId || '—';
    const key = `${year}||${courseId}`;
    if (!map.has(key)) map.set(key, { year, courseId, courseName, showYear, items: [] });
    map.get(key)!.items.push(item);
  }

  return Array.from(map.values()).sort((a, b) => {
    if (showYear && a.year !== b.year) return b.year.localeCompare(a.year, 'he');
    return a.courseName.localeCompare(b.courseName, 'he');
  });
}

/**
 * Returns an Outlook Web App (O365/Ariel) day-view URL for a given date.
 * Opens the institutional calendar at the specific day — no login needed
 * if the user is already signed into their Ariel O365 account.
 * Only `startDate` (YYYY-MM-DD) is required; the rest are unused but kept
 * for call-site compatibility.
 */
/**
 * Opens a calendar event by generating an ICS blob and opening it.
 * iOS/macOS recognise text/calendar and hand it to Outlook (or Calendar).
 * This is the only reliable cross-platform way to navigate to a specific
 * event date — OWA SPA URLs reset to today when opened externally.
 *
 * Call this function directly from a click handler — no URL needed.
 */
export function openIcsEvent(opts: {
  subject: string;
  startDate: string;    // YYYY-MM-DD
  startTime?: string;   // HH:MM
  endTime?: string;     // HH:MM
  location?: string;
  description?: string;
}): void {
  function toIcsDt(date: string, time?: string): string {
    // YYYYMMDDTHHMMSS (local, no Z — Israel timezone, no DST confusion)
    const d = date.replace(/-/g, '');
    if (!time) return `${d}`;
    const t = time.replace(/:/g, '').slice(0, 4) + '00';
    return `${d}T${t}`;
  }

  const start = toIcsDt(opts.startDate, opts.startTime);
  // Default end = start + 1 hour
  let end = start;
  if (opts.endTime) {
    end = toIcsDt(opts.startDate, opts.endTime);
  } else if (opts.startTime) {
    const [h, m] = opts.startTime.split(':').map(Number);
    const endH = String(h + 1).padStart(2, '0');
    end = toIcsDt(opts.startDate, `${endH}:${String(m).padStart(2, '0')}`);
  }

  const uid = `${Date.now()}@practicum.yarivitzkovich.org`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Practicum Ariel//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${opts.subject}`,
    opts.location ? `LOCATION:${opts.location}` : '',
    opts.description ? `DESCRIPTION:${opts.description.replace(/\n/g, '\\n')}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  const blob = new Blob([lines], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `event-${opts.startDate}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** The Ariel mailbox the calendar should open in when nobody is signed in yet. */
export const ARIEL_CALENDAR_ACCOUNT = 'yarivi@ariel.ac.il';

/**
 * Returns an Outlook Web App (O365 / Ariel) compose-event URL.
 *
 * Two things this URL has to get right, both of which the old builder got wrong
 * and both of which showed up as "clicking 📅 opens nothing":
 *
 *  1. `path=/calendar/action/compose` is REQUIRED. Without it OWA loads the
 *     calendar shell and stops — the reported blank tab. `rru=addevent` alone
 *     is not enough.
 *  2. `/calendar/0/` pins the request to account **index 0** of the browser's
 *     Outlook session — literally "whoever signed in first", which on a machine
 *     with a personal Microsoft account is not the Ariel mailbox. Dropping the
 *     index lets Outlook resolve the session itself.
 *
 * No query parameter can *force* a particular mailbox — Microsoft publishes no
 * such switch. `login_hint` is the closest thing: when Outlook does bounce
 * through sign-in it pre-fills that address, and it is ignored when a session
 * already exists. So the account is a hint, never a guarantee — which is why
 * every caller should go through `openCalendarEvent` below, whose .ics fallback
 * lands in the right calendar regardless of which browser session is live.
 */
export function outlookCalendarUrl(opts: {
  subject?: string;
  startDate: string;    // YYYY-MM-DD
  startTime?: string;   // HH:MM
  endTime?: string;     // HH:MM
  location?: string;
  attendeeEmail?: string;
  body?: string;
  account?: string;     // mailbox to hint at sign-in; defaults to the Ariel account
}): string {
  function addHour(t: string) {
    const [h, m] = t.split(':').map(Number);
    return `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const time    = opts.startTime ?? '08:00';
  const endTime = opts.endTime   ?? addHour(time);
  // encodeURIComponent, NOT URLSearchParams: the latter encodes a space as `+`, and
  // Outlook's deeplink handler is on record mis-reading `+` in exactly these fields
  // (it round-trips them back to spaces, and mangles `+` that was meant literally).
  // `%20` is what the working examples use. `path` keeps its slashes unescaped for
  // the same reason — that is the form Microsoft's own examples publish.
  const enc = (s: string) => encodeURIComponent(s);
  const parts = [
    'path=/calendar/action/compose',
    'rru=addevent',
    `startdt=${enc(`${opts.startDate}T${time}:00`)}`,
    `enddt=${enc(`${opts.startDate}T${endTime}:00`)}`,
    `subject=${enc(opts.subject ?? '')}`,
    `body=${enc(opts.body ?? '')}`,
  ];
  if (opts.location) parts.push(`location=${enc(opts.location)}`);
  if (opts.attendeeEmail) parts.push(`to=${enc(opts.attendeeEmail)}`);
  parts.push(`login_hint=${enc(opts.account || ARIEL_CALENDAR_ACCOUNT)}`);
  return `https://outlook.office.com/calendar/deeplink/compose?${parts.join('&')}`;
}

/**
 * Opens a prebuilt calendar URL from a row button, and says so when the browser
 * blocks it. The row call sites only hold the URL, not the event fields, so
 * there is nothing to build an .ics from — but a blocked popup must still not
 * look like a dead button.
 */
export function openCalendarLink(url: string): void {
  const win = typeof window !== 'undefined' ? window.open(url, '_blank') : null;
  if (!win) alert('הדפדפן חסם את פתיחת היומן. אפשרו חלונות קופצים לאתר, או פתחו את ההרצאה ולחצו «פתח יומן אריאל».');
}

/**
 * Opens an event in the Ariel Outlook calendar, and actually says something when
 * it can't.
 *
 * `window.open(url, '_blank')` returns null when a popup blocker eats the call —
 * the old call sites ignored that, so a blocked popup was indistinguishable from
 * a dead button. Here a blocked popup falls back to `openIcsEvent`, which hands
 * the browser a real .ics file: it opens in whatever calendar the user has and
 * does not care which Microsoft account the browser session belongs to.
 */
export function openCalendarEvent(opts: {
  subject: string;
  startDate?: string;   // YYYY-MM-DD — required; the caller may not have one yet
  startTime?: string;
  endTime?: string;
  location?: string;
  attendeeEmail?: string;
  body?: string;
  account?: string;
}): { ok: boolean; reason?: 'no-date' | 'fallback-ics' } {
  if (!opts.startDate) return { ok: false, reason: 'no-date' };
  const url = outlookCalendarUrl({ ...opts, startDate: opts.startDate });
  const win = typeof window !== 'undefined' ? window.open(url, '_blank') : null;
  if (win) return { ok: true };
  openIcsEvent({
    subject: opts.subject,
    startDate: opts.startDate,
    startTime: opts.startTime,
    endTime: opts.endTime,
    location: opts.location,
    description: opts.body,
  });
  return { ok: true, reason: 'fallback-ics' };
}

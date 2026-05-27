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

/**
 * Returns an Outlook Web App (O365 / Ariel) compose-event URL.
 * Opens OWA in the browser at the correct date & time — no file download,
 * no login if already signed into the Ariel O365 account.
 * The compose form is pre-filled; closing it shows the calendar at that date.
 */
export function outlookCalendarUrl(opts: {
  subject?: string;
  startDate: string;    // YYYY-MM-DD
  startTime?: string;   // HH:MM
  endTime?: string;     // HH:MM
  location?: string;
  attendeeEmail?: string;
  body?: string;
}): string {
  function addHour(t: string) {
    const [h, m] = t.split(':').map(Number);
    return `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const time    = opts.startTime ?? '08:00';
  const endTime = opts.endTime   ?? addHour(time);
  const startdt = encodeURIComponent(`${opts.startDate}T${time}:00`);
  const enddt   = encodeURIComponent(`${opts.startDate}T${endTime}:00`);
  const subject = encodeURIComponent(opts.subject ?? '');
  const body    = encodeURIComponent(opts.body ?? '');
  const location = opts.location ? `&location=${encodeURIComponent(opts.location)}` : '';
  const to = opts.attendeeEmail ? `&to=${encodeURIComponent(opts.attendeeEmail)}` : '';
  return `https://outlook.office.com/calendar/0/deeplink/compose?rru=addevent&startdt=${startdt}&enddt=${enddt}&subject=${subject}&body=${body}${location}${to}`;
}

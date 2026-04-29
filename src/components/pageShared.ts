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

export function sameContext(
  item: { courseId?: string; year?: string },
  context: Context,
): boolean {
  if (context.courseId !== '__all__' && item.courseId !== context.courseId) return false;
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

export function outlookCalendarUrl(opts: {
  subject: string;
  startDate: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  attendeeEmail?: string;
  body?: string;
}): string {
  const base = 'https://outlook.live.com/calendar/0/deeplink/compose';
  const startdt = opts.startTime ? `${opts.startDate}T${opts.startTime}:00` : opts.startDate;
  const enddt   = opts.endTime   ? `${opts.startDate}T${opts.endTime}:00`   : startdt;
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: opts.subject,
    startdt,
    enddt,
    body: opts.body ?? '',
    to: opts.attendeeEmail ?? '',
  });
  if (opts.location) params.set('location', opts.location);
  return `${base}?${params.toString()}`;
}

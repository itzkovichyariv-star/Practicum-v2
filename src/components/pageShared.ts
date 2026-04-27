import type { PracticumData } from '../lib/supabase';
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

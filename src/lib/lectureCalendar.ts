/**
 * The LECTURE layer of the academic-year screen — the half that makes it a scheduling
 * surface rather than a poster.
 *
 * Yariv 2026-09-23: "בפרקטיקום הייתי מציע שהלוח יכלול את לוח ההרצאות". The academic
 * calendar is the BACKGROUND (the university's year, fixed, printed); the lectures are
 * the FOREGROUND (his own bookings, in motion, the thing he is placing). This module
 * owns the foreground: which lectures land on which day, how to tell an approved one
 * from one still being chased, and — the point of the whole screen — whether a lecture
 * has been put somewhere the university's calendar says it cannot be.
 *
 * It reads lectures from the app's existing snapshot (PracticumData.lectures, loaded by
 * src/lib/supabase.ts → loadSnapshot and handed down as page props). It opens no
 * connection of its own: the lecture data arrives the same way it does on every other
 * screen, which keeps this feature out of the way of the auth/RLS work in flight.
 */

import type { Lecture } from './supabase';
import type { AcademicDayItem } from './academicCalendar';
import { dayBlockers, type DayBlocker } from './academicCalendar';

/**
 * Three states, because that is how many Yariv acts on differently:
 *   approved  — done. Nothing to do.
 *   pending   — the actual job. "יש לי הרבה לא מאושר ורדיפה אחריהם היא העבודה עצמה."
 *   cancelled — kept visible (the date is free again) but drawn as struck through.
 *
 * Anything that is not exactly 'מאושר' or 'בוטל' counts as pending, INCLUDING a blank
 * status. Production carries four spellings of not-yet-approved today (ממתין לאישור,
 * בקשה נשלחה, שינוי מתבצע, טנטטיבי) and the editor lets a new one be typed, so an
 * allow-list of pending values would silently show tomorrow's spelling as approved.
 * Only approval is stated positively; everything else is still open.
 */
export type LectureState = 'approved' | 'pending' | 'cancelled';

export const LECTURE_APPROVED_STATUS = 'מאושר';
export const LECTURE_CANCELLED_STATUS = 'בוטל';

export function lectureState(lecture: Pick<Lecture, 'status'>): LectureState {
  const s = (lecture.status || '').trim();
  if (s === LECTURE_APPROVED_STATUS) return 'approved';
  if (s === LECTURE_CANCELLED_STATUS) return 'cancelled';
  return 'pending';
}

export const LECTURE_STATE_LABEL: Record<LectureState, string> = {
  approved: 'מאושר',
  pending: 'טרם אושר',
  cancelled: 'בוטל',
};

/**
 * The lecture layer's own colours. Deliberately NOT from ARIEL_PAPER: the academic
 * marks are the printed document's gold and cream, and a lecture drawn in those would
 * disappear into the page. The wine is the app's own accent — the reader already
 * associates it with "this app's records" everywhere else — and it is the strongest
 * value on a sheet of white paper, which is what "foreground" has to mean here.
 *
 * Fixed hexes rather than var(--accent) for the same reason the paper is fixed: this
 * sits ON the document's white card in both themes, so a token that flips in dark mode
 * would put white-on-white.
 */
export const LECTURE_INK = {
  /** Approved: solid wine. Settled, needs nothing. */
  approved: '#7A1E2B',
  /** Pending: amber. Reads as "unfinished" at a glance, and is the one he scans for. */
  pending: '#B45309',
  /** Cancelled: grey. Present, so the freed date is visible, but plainly inert. */
  cancelled: 'rgba(0, 0, 0, 0.38)',
};

export function lectureColor(state: LectureState): string {
  return LECTURE_INK[state];
}

/** A lecture positioned on a day, with everything the day panel shows. */
export interface LectureDayItem {
  id: string;
  iso: string;
  state: LectureState;
  /** The raw status as stored — shown verbatim, so "טנטטיבי" is not flattened to "טרם אושר". */
  statusLabel: string;
  /** "17:00–20:00", "17:00", or null. */
  time: string | null;
  title: string;
  lecturer: string | null;
  courseName: string | null;
  type: string | null;
  semester: string | null;
  location: string | null;
  /** The lecture record itself, so the panel can hand it straight to the editor. */
  lecture: Lecture;
}

/** How a day's lectures summarise onto a single 44px cell. */
export interface LectureDayMark {
  total: number;
  approved: number;
  pending: number;
  cancelled: number;
  /** True when at least one lecture on the day still needs chasing. */
  hasPending: boolean;
}

/**
 * The ISO date of a lecture, or null.
 *
 * Sliced, never `new Date(...)`: a lecture date is stored as "2026-12-08", and parsing
 * that to a Date and formatting it back re-introduces exactly the timezone shift that
 * this repo has already been bitten by around midnight (see unit/time-input.spec.ts).
 * A stored "2026-12-08" belongs on 2026-12-08 in every timezone. Values that carry a
 * time ("2026-12-08T00:00:00Z") still resolve, by taking the date part only.
 */
export function lectureIso(lecture: Pick<Lecture, 'date'>): string | null {
  const raw = (lecture.date || '').trim();
  if (!raw) return null;
  const iso = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function formatTime(l: Lecture): string | null {
  const start = (l.startTime || '').trim();
  const end = (l.endTime || '').trim();
  if (start && end) return `${start}–${end}`;
  return start || null;
}

export function toLectureDayItem(l: Lecture, iso: string): LectureDayItem {
  return {
    id: l.id,
    iso,
    state: lectureState(l),
    statusLabel: (l.status || '').trim() || '—',
    time: formatTime(l),
    title: (l.topic || l.title || l.courseName || 'הרצאה').trim(),
    lecturer: (l.lecturer || '').trim() || null,
    courseName: (l.courseName || '').trim() || null,
    type: (l.type || '').trim() || null,
    semester: (l.semester || '').trim() || null,
    location: (l.link || l.location || l.institution || '').trim() || null,
    lecture: l,
  };
}

/**
 * date → the lectures on it, each day sorted by clock then title.
 *
 * Undated lectures are dropped rather than bucketed somewhere: a lecture with no date
 * cannot be drawn on a calendar, and inventing a day for it would put a booking on a
 * date nobody chose. The screen reports the count separately instead.
 */
export function buildLectureDayMap(lectures: Lecture[]): Map<string, LectureDayItem[]> {
  const map = new Map<string, LectureDayItem[]>();
  for (const l of lectures) {
    const iso = lectureIso(l);
    if (!iso) continue;
    const item = toLectureDayItem(l, iso);
    const list = map.get(iso);
    if (list) list.push(item);
    else map.set(iso, [item]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title, 'he'));
  }
  return map;
}

/** How many lectures with no usable date — surfaced, never silently dropped. */
export function undatedLectures(lectures: Lecture[]): Lecture[] {
  return lectures.filter((l) => !lectureIso(l));
}

/** The per-day summary the grid cell draws. */
export function lectureMarksFor(items: LectureDayItem[]): LectureDayMark {
  let approved = 0, pending = 0, cancelled = 0;
  for (const it of items) {
    if (it.state === 'approved') approved++;
    else if (it.state === 'pending') pending++;
    else cancelled++;
  }
  return { total: items.length, approved, pending, cancelled, hasPending: pending > 0 };
}

/** date → summary, for every day that carries a lecture. */
export function buildLectureMarkIndex(
  dayMap: Map<string, LectureDayItem[]>,
): Map<string, LectureDayMark> {
  const out = new Map<string, LectureDayMark>();
  for (const [iso, items] of dayMap) out.set(iso, lectureMarksFor(items));
  return out;
}

/* ── Conflicts: a lecture standing on a day the university has closed ─────── */

export interface LectureConflict {
  iso: string;
  lectureId: string;
  title: string;
  lecturer: string | null;
  /** The worst blocker on that day — what makes it a conflict. */
  blocker: DayBlocker;
  /** Every blocker on the day, worst first. */
  blockers: DayBlocker[];
}

/**
 * Every lecture that stands on a day the academic calendar objects to.
 *
 * `level: 'blocked'` only, by default — a lecture on a make-up day or the last day of
 * a semester is unusual, not wrong, and a list that cried wolf about those would stop
 * being read. Pass `includeCaution` to see those too.
 *
 * A cancelled lecture is never a conflict: it is not happening, so the clash is moot.
 * That is the difference between this list and "every lecture that overlaps something",
 * and it is why the list stays short enough to act on.
 */
export function findLectureConflicts(
  lectureDayMap: Map<string, LectureDayItem[]>,
  academicDayMap: Map<string, AcademicDayItem[]>,
  { includeCaution = false }: { includeCaution?: boolean } = {},
): LectureConflict[] {
  const out: LectureConflict[] = [];
  for (const [iso, items] of lectureDayMap) {
    const academic = academicDayMap.get(iso);
    if (!academic?.length) continue;
    const blockers = dayBlockers(academic);
    const relevant = includeCaution ? blockers : blockers.filter((b) => b.level === 'blocked');
    if (!relevant.length) continue;
    for (const it of items) {
      if (it.state === 'cancelled') continue;
      out.push({
        iso,
        lectureId: it.id,
        title: it.title,
        lecturer: it.lecturer,
        blocker: relevant[0],
        blockers: relevant,
      });
    }
  }
  return out.sort((a, b) => a.iso.localeCompare(b.iso) || a.title.localeCompare(b.title, 'he'));
}

/**
 * Everything the day panel needs to answer "can I put a lecturer here?" — the
 * university's objections, this day's lectures, and whether any of them is already
 * standing on a blocked day.
 */
export interface DaySchedulingReport {
  iso: string;
  blockers: DayBlocker[];
  /** Lectures already on the day that a blocker applies to. */
  conflicting: LectureDayItem[];
  /** True when the university's calendar forbids the day outright. */
  blocked: boolean;
}

export function daySchedulingReport(
  iso: string,
  academic: AcademicDayItem[],
  lectures: LectureDayItem[],
): DaySchedulingReport {
  const blockers = dayBlockers(academic);
  const blocked = blockers.some((b) => b.level === 'blocked');
  return {
    iso,
    blockers,
    blocked,
    conflicting: blocked ? lectures.filter((l) => l.state !== 'cancelled') : [],
  };
}

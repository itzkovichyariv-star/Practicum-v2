/**
 * לוח שנה — THE calendar. One screen, two views, no second calendar anywhere.
 *
 * Yariv 2026-09-23, on finding two of them side by side:
 *   "זה מה שצריך לוח מאוחד עם האירועים ובכל מקרה אין לי אפשרות בחירה על המסך."
 * לוח אקדמי was shipped as a SECOND calendar an hour after this one already drew
 * lectures, interviews, free interview slots and preparations. It has been folded into
 * this file and deleted; `page === 'academic'` no longer exists.
 *
 * WHAT MERGED, and how the two layers were reconciled:
 *
 *   THE MONTH VIEW keeps everything it had — its month navigation, its course/year
 *   filters, its event chips, its month list — and gains the university's year UNDER
 *   them: the Ariel document's own gold (semester boundaries, exam windows) and cream
 *   (no-teaching days, special arrangements, make-up days) painted into the cell, with
 *   the event chips redrawn on a near-white underlay so a wine/green/blue/brown marker
 *   stays legible on a pale fill instead of sinking into it.
 *
 *   THE YEAR VIEW is the twelve-month Ariel poster, unchanged: white paper, black ink,
 *   fixed hexes in both themes, the lectures on it as rings and bars. It replaces the
 *   month view rather than sitting beside it — never both at once — and opens on
 *   whatever month the month view was showing.
 *
 *   ONE DAY SURFACE. The old hover/pinned popover is gone. A tap on any day — including
 *   an empty one, because "can I put a lecturer here?" is a question about empty days —
 *   opens the sheet that leads with the verdict, then the day's lectures, then its
 *   interviews / slots / preparations, then the university's entry for it, then the
 *   button that books it through src/lib/lectureSave.ts, the single lecture-write path.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PageProps } from './pageShared';
import { sameContext, outlookCalendarUrl, normalizeYear } from './pageShared';
import { supabase } from '../lib/supabase';
import type { Lecture, Trainer } from '../lib/supabase';
import {
  ACADEMIC_CATEGORIES,
  ACADEMIC_WEEKDAY_LABELS,
  ARIEL_PAPER,
  DAY_VERDICT_LABEL,
  academicCourseKeysFor,
  academicMarksFor,
  buildAcademicDayMap,
  dayBlockers,
  buildAcademicMonths,
  academicItemsOutsideGrid,
  dayVerdict,
  initialMonthKey,
  isTeachingSession,
  todayIso,
  type AcademicDayItem,
  type AcademicMonth,
} from '../lib/academicCalendar';
import {
  LECTURE_STATE_LABEL,
  buildLectureDayMap,
  buildLectureMarkIndex,
  daySchedulingReport,
  findLectureConflicts,
  lectureColor,
  lecturerContact,
  undatedLectures,
  type LecturerContact,
  type LectureDayItem,
  type LectureDayMark,
} from '../lib/lectureCalendar';
import { saveLecture, deleteLecture } from '../lib/lectureSave';
import { showToast } from '../lib/toast';
import LectureEditor from './LectureEditor';

type CalEvent = {
  date: Date;
  title: string;
  type: 'lecture' | 'interview' | 'prep' | 'slot';
  status?: string;
  id: string;
  onClick?: () => void;
  calendarUrl?: string;
};

type SlotRow = {
  id: string; date: string; start_time: string; end_time: string;
  capacity: number; booked_count: number; course_name?: string; note?: string;
};

type CalendarView = 'month' | 'year';

const HEB_DAYS = ACADEMIC_WEEKDAY_LABELS;
const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/* One-handed at 430px: 430 − 32 (page gutter) − 12 (card padding) = 386 across seven
 * columns ⇒ 55px each, over the 44px minimum. */
const CELL_MIN = 52;

/**
 * Jewish holidays, as a FALLBACK layer only.
 *
 * The Ariel dataset (src/lib/academic-calendar-2026-27.json) already carries every
 * holiday that closes the university, with its real title and its real span — but it
 * covers תשפ״ז only, and the month view navigates to any month there is. Outside that
 * window this subset is all there is, so it stays; inside it, it steps aside. See
 * `cellBackground` for the precedence rule.
 */
const HEB_HOLIDAYS: Record<string, string> = {
  // 2025 / תשפ״ה
  '2025-09-23': 'ראש השנה', '2025-09-24': 'ראש השנה ב׳',
  '2025-10-02': 'יום כיפור',
  '2025-10-07': 'סוכות', '2025-10-14': 'שמחת תורה',
  '2025-12-14': 'חנוכה',
  // 2026 / תשפ״ו
  '2026-03-03': 'פורים',
  '2026-04-02': 'פסח', '2026-04-08': 'שביעי של פסח',
  '2026-04-22': 'יום העצמאות',
  '2026-05-22': 'שבועות',
  '2026-09-12': 'ראש השנה', '2026-09-13': 'ראש השנה ב׳',
  '2026-09-21': 'יום כיפור',
  '2026-09-26': 'סוכות', '2026-10-03': 'שמחת תורה',
  '2026-12-04': 'חנוכה',
  // 2027 / תשפ״ז
  '2027-02-22': 'פורים',
  '2027-04-22': 'פסח',
  '2027-05-12': 'יום העצמאות',
  '2027-06-11': 'שבועות',
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "ג׳ · 8 בדצמבר 2026" — read out loud, which is how a date gets confirmed on a call. */
function longHebrewDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${ACADEMIC_WEEKDAY_LABELS[d.getUTCDay()]}׳ · ${d.getUTCDate()} ב${HEB_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/* ══════════════════════ THE LAYERING RULE ══════════════════════
 *
 * Yariv 2026-09-23, on the first cut, which put the university's gold and cream in the
 * cell and his own events in little dots on top of it:
 *   "אני מציע שאם זו התצוגה תצבע את כל הריבוע בצבע המתאים כי הנקודה לא ממש ויזיבילית"
 *
 * So the two layers swapped places, and the rule is now:
 *
 *   THE FILL BELONGS TO THE EVENTS. What is HAPPENING on a day colours the whole cell —
 *   his הרצאה, ראיון, מועד פנוי and הכנה, plus the university's own teaching sessions
 *   (which are events too: a class that meets is the most booked a day can be). A day
 *   with several kinds is split into equal vertical stripes, one per kind, running
 *   right to left in a fixed order, so the common single-kind day is ONE solid block of
 *   colour and a mixed day still shows every colour it earns instead of hiding all but
 *   one. Nothing is capped: five kinds is five stripes.
 *
 *   THE UNIVERSITY'S DAY TYPE BECOMES A BAND across the top of the cell — gold for a
 *   semester boundary or an exam window, cream for a no-teaching day / special
 *   arrangement / make-up day, and the dataset's own grey for a Jewish holiday that
 *   falls outside תשפ״ז, where the Ariel data has nothing to say. It keeps the
 *   document's fixed hexes in both themes, and it carries its label on a plate beside
 *   the date, so the band is never a colour you have to remember.
 *
 *   "DO NOT BOOK HERE" IS NOT A COLOUR. It was the whole point of the second calendar
 *   and it matters MORE now that the fill is spoken for, so on a day the university is
 *   shut — אין לימודים or תקופת בחינות — the band is drawn as CAUTION TAPE: a diagonal
 *   hatch of the fill against near-black. Hatching survives being next to a saturated
 *   event colour in a way that another flat pastel would not, its label goes bold, and
 *   the day sheet still leads with the verdict in words.
 *
 *   TODAY AND THE OPEN DAY ARE CHROME, NEVER COLOUR. Today lost its wine wash: the
 *   fill now MEANS "something is here", so tinting an empty today would claim a lecture
 *   that does not exist. Today is its wine date badge plus a ring; the open day is a
 *   thicker ring. On a filled cell both go white with a dark outer edge so they read on
 *   a pale session pastel and on the dark wine alike.
 *
 *   ALL TEXT SITS ON A PLATE. A date can straddle two stripes, so guessing one ink per
 *   cell cannot work: the date, the band's label, the event chips and the היום stamp
 *   each get a 94%-white plate and black-or-own-colour ink on it. That is one contrast
 *   to reason about instead of one per colour per theme, and it is the same in dark
 *   mode, where the fills do not change.
 */

/** The plate every glyph on a filled cell sits on. */
const PLATE = 'rgba(255,255,255,0.94)';
/** The band across the top of a cell that carries a university day type. */
const BAND_H = 12;

/** Priority order for the stripes — what he is most likely to be looking for, first. */
function eventStripes(dayEvents: CalEvent[], academic: AcademicDayItem[]): string[] {
  const out: string[] = [];
  const has = (t: CalEvent['type']) => dayEvents.some((e) => e.type === t);
  if (has('lecture')) out.push(eventColor('lecture'));
  // the university's own teaching, in the dataset's course colours
  for (const hex of new Set(academic.filter(isTeachingSession).map((s) => s.hex))) out.push(hex);
  if (has('interview')) out.push(eventColor('interview'));
  if (has('prep')) out.push(eventColor('prep'));
  if (has('slot')) out.push(eventColor('slot'));
  return out;
}

/** Equal vertical stripes, right to left — the reading direction of the page. */
function stripeBackground(colors: string[]): string | undefined {
  if (colors.length === 0) return undefined;
  const step = 100 / colors.length;
  const stops = colors.map((c, i) => `${c} ${(i * step).toFixed(3)}% ${((i + 1) * step).toFixed(3)}%`);
  return `linear-gradient(to left, ${stops.join(', ')})`;
}

/** The dataset's own grey for אין לימודים — reused for a holiday it does not cover. */
const HOLIDAY_BAND = '#BFBFBF';

/* The legend's groups, and the band's own source of truth — one list, so the grid and
 * the legend cannot drift apart when a future תשפ״ח JSON adds a category. */

/** Teaching. These own the CELL FILL. */
const SESSION_CATEGORY_KEYS = ['seminar', 'skills', 'practicum', 'simulation'];

/**
 * The five categories that describe what KIND OF DAY it is, and nothing else. These own
 * the BAND.
 *
 * Deliberately a list rather than "everything that is not a session": the dataset has
 * two `reminder` rows filed under `simulation` — "לתאם החלפת שיעור: סימולציה ב-15.12" —
 * which are notes ABOUT a simulation, not a simulation. Taking every non-session item
 * painted 1.12.2026 with a red "simulation" band on a day whose only real content is a
 * מיומנויות session, which the first cut of this screen did until calendar-check caught
 * it. A to-do is not a day type; it still shows in the day sheet, where it belongs.
 */
const BAND_CATEGORY_KEYS = ['boundary', 'exam', 'off', 'special', 'makeup_day'];

const SESSION_CATEGORIES = ACADEMIC_CATEGORIES.filter((c) => SESSION_CATEGORY_KEYS.includes(c.key));
const BAND_CATEGORIES = ACADEMIC_CATEGORIES.filter((c) => BAND_CATEGORY_KEYS.includes(c.key));
const TODO_CATEGORIES = ACADEMIC_CATEGORIES.filter(
  (c) => !SESSION_CATEGORY_KEYS.includes(c.key) && !BAND_CATEGORY_KEYS.includes(c.key));

type AcademicBand = { color: string; label: string; category: string; blocked: boolean };

/**
 * The band, from the day-TYPE items only — see BAND_CATEGORY_KEYS. Teaching moved to
 * the fill, so a seminar no longer paints a band; a holiday, an exam window, a semester
 * edge and a make-up day still do, and so does a Jewish holiday outside the dataset's
 * window, in the dataset's own grey.
 */
function academicBand(academic: AcademicDayItem[], holiday: string | undefined): AcademicBand | null {
  const dayTypes = academic.filter((it) => BAND_CATEGORY_KEYS.includes(it.category));
  const marks = academicMarksFor(dayTypes);
  const blocked = dayBlockers(dayTypes).some((b) => b.level === 'blocked');
  if (marks.fill && marks.paint) {
    return { color: marks.fill, label: marks.paint.label, category: marks.paint.key, blocked };
  }
  if (holiday) return { color: HOLIDAY_BAND, label: holiday, category: 'holiday', blocked: true };
  return null;
}

export default function CalendarPage({ data, context, onNavigate, userName, onRefresh }: PageProps) {
  const now = new Date();
  const today = todayIso();
  const [view, setView] = useState<CalendarView>('month');
  const [cursor, setCursor] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [pendingSubs, setPendingSubs] = useState<Array<{ id: string; name: string; email?: string; date: string; time: string }>>([]);
  const [editing, setEditing] = useState<Lecture | null>(null);
  const [creatingOn, setCreatingOn] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const monthRefs = useRef<Record<string, HTMLElement | null>>({});

  /* The academic year is static — derive it once, not on every render. */
  const academicDayMap = useMemo(() => buildAcademicDayMap(), []);
  const posterMonths = useMemo(() => buildAcademicMonths(academicDayMap), [academicDayMap]);
  const outside = useMemo(() => academicItemsOutsideGrid(), []);

  // Load interview slots + pending submissions (candidates who booked but haven't been
  // accepted into the candidates table yet) from the public tables.
  useEffect(() => {
    (async () => {
      const [slotsRes, subsRes] = await Promise.all([
        supabase.from('public_interview_slots').select('*'),
        supabase.from('candidate_submissions').select('id, name, email, notes').eq('processed', false),
      ]);
      setSlots((slotsRes.data as SlotRow[]) || []);
      // Extract slot info from each submission's notes field
      const pending: Array<{ id: string; name: string; email?: string; date: string; time: string }> = [];
      ((subsRes.data as any[]) || []).forEach(s => {
        const m = String(s.notes || '').match(/בחר מועד ראיון:\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?:–\d{1,2}:\d{2})?)/);
        if (m) pending.push({ id: s.id, name: s.name, email: s.email, date: m[1], time: m[2] });
      });
      setPendingSubs(pending);
    })();
  }, []);

  /* ESC closes the day sheet — it is a modal surface and has to behave like one. */
  useEffect(() => {
    if (!openDay) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenDay(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openDay]);

  const courses = data.courses || [];
  const candidates = data.candidates || [];
  const students = data.students || [];
  const yearFilterActive = context.year !== '__all__';

  /**
   * WHICH LECTURES — and why the YEAR filter does not reach them.
   *
   * This screen's job is to decide whether a date is free. A lecture hidden behind a
   * year filter is a lecture that gets double-booked, and hiding it would make the grid
   * disagree with the day sheet, the poster and the conflict banner — all of which have
   * to tell the truth about an occupied date. So lectures are COURSE-filtered only, in
   * every one of those four places, and the screen says so under the header.
   *
   * The year filter still scopes the cohort-shaped events — interviews, interview slots
   * and student preparations — where "which year am I looking at" is exactly what it
   * means. And in the year view it is doubly moot: the poster IS שנה״ל תשפ״ז, so a
   * top-bar year of תשפ״ו would blank a grid whose own title says otherwise.
   */
  const lectures = useMemo(
    () => (data.lectures || []).filter(l => sameContext(l, { courseId: context.courseId, year: '__all__' }, courses)),
    [data.lectures, context.courseId, courses],
  );

  const lectureDayMap = useMemo(() => buildLectureDayMap(lectures, userName), [lectures, userName]);
  /**
   * The top bar's COURSE filter, resolved against the ACADEMIC dataset's own course
   * list (semA / skA / prA / …). `null` means "do not filter teaching": either nothing
   * is selected, or the selection names a course this dataset has never heard of — and
   * filtering teaching down to nothing would read as "no class that day", which is the
   * exact wrong answer on the screen whose job is to say whether a date is free.
   */
  const academicCourseKeys = useMemo(() => {
    if (context.courseId === '__all__') return null;
    const keys = academicCourseKeysFor(context.courseId);
    return keys.length > 0 ? keys : null;
  }, [context.courseId]);

  const trainers = (data.trainers || []) as Trainer[];
  const lectureMarks = useMemo(() => buildLectureMarkIndex(lectureDayMap), [lectureDayMap]);
  const conflicts = useMemo(
    () => findLectureConflicts(lectureDayMap, academicDayMap),
    [lectureDayMap, academicDayMap],
  );
  const undated = useMemo(() => undatedLectures(lectures), [lectures]);

  /** Lectures that actually land inside תשפ״ז — the poster's headline must count what
   *  is on screen, not what is in the database. */
  const inGrid = useMemo(() => {
    let approved = 0, pending = 0, cancelled = 0, total = 0;
    const from = posterMonths[0]?.key ?? '', to = posterMonths[posterMonths.length - 1]?.key ?? '';
    for (const [iso, items] of lectureDayMap) {
      const mk = iso.slice(0, 7);
      if (mk < from || mk > to) continue;
      for (const it of items) {
        total++;
        if (it.state === 'approved') approved++;
        else if (it.state === 'pending') pending++;
        else cancelled++;
      }
    }
    return { total, approved, pending, cancelled };
  }, [lectureDayMap, posterMonths]);

  // Interview Zoom link for a given ISO day: the day's own link, else the permanent
  // default room. Same resolution as RegistrationForm/notify-submission, so the invite
  // Yariv sends a candidate carries the SAME link they saw on screen and in their email.
  const zoomFor = (isoDate: string): string =>
    String((data.interviewZoomLinks || {})[String(isoDate).slice(0, 10)] || data.interviewZoomLinkDefault || '').trim();

  const events = useMemo<CalEvent[]>(() => {
    const list: CalEvent[] = [];
    lectures.forEach(l => {
      if (!l.date) return;
      const d = new Date(l.date);
      if (isNaN(d.getTime())) return;
      list.push({
        id: l.id,
        date: d,
        title: l.topic || l.courseName || 'הרצאה',
        type: 'lecture',
        status: l.status,
        onClick: () => onNavigate('lectures'),
        calendarUrl: outlookCalendarUrl({
          subject: `${l.type || 'הרצאה'}: ${l.topic || l.courseName || ''}`,
          startDate: l.date.slice(0, 10),
          startTime: l.startTime,
          endTime: l.endTime,
          location: l.link || l.location || l.institution,
          body: [l.topic, l.courseName ? 'קורס: ' + l.courseName : '', l.lecturer ? 'מרצה: ' + l.lecturer : '', l.notes || ''].filter(Boolean).join('\n'),
          attendeeEmail: l.lecturerEmail,
        }),
      });
    });
    candidates.filter(c => sameContext(c, context, courses)).forEach(c => {
      if (!c.interviewDate) return;
      const d = new Date(c.interviewDate);
      if (isNaN(d.getTime())) return;
      list.push({
        id: c.id,
        date: d,
        title: `ראיון · ${c.name}`,
        type: 'interview',
        status: c.interviewResult,
        onClick: () => onNavigate('candidates'),
        calendarUrl: outlookCalendarUrl({
          subject: `ראיון מועמד: ${c.name || ''}`,
          startDate: c.interviewDate.slice(0, 10),
          startTime: c.interviewTime ? c.interviewTime.split(/[-–]/)[0] : '10:00',
          endTime: c.interviewTime ? (c.interviewTime.split(/[-–]/)[1] || '10:45') : '10:45',
          location: zoomFor(c.interviewDate),
          body: [zoomFor(c.interviewDate) ? `קישור לראיון בזום: ${zoomFor(c.interviewDate)}` : '', 'נא להתחבר כמה דקות לפני המועד, במקום שקט ועם מצלמה פתוחה, ולהמתין בחדר ההמתנה בזום.'].filter(Boolean).join('\n'),
          attendeeEmail: c.email,
        }),
      });
    });
    students.filter(s => sameContext(s, context, courses)).forEach(s => {
      if (!s.preparation?.date) return;
      const d = new Date(s.preparation.date);
      if (isNaN(d.getTime())) return;
      list.push({
        id: s.id + '-prep',
        date: d,
        title: `הכנה · ${s.name}`,
        type: 'prep',
        onClick: () => onNavigate('students'),
        calendarUrl: outlookCalendarUrl({
          subject: `הכנה לפרקטיקום: ${s.name || ''}`,
          startDate: s.preparation.date.slice(0, 10),
        }),
      });
    });
    // Interview slots (availability) — show free slots in the calendar.
    // Excludes slots already fully booked (they become "interview" events via the candidate pipeline anyway).
    slots.forEach(s => {
      const d = new Date(s.date);
      if (isNaN(d.getTime())) return;
      const free = s.capacity - s.booked_count;
      if (free <= 0) return; // full slot — no need to show availability
      list.push({
        id: 'slot-' + s.id,
        date: d,
        title: `${s.start_time}–${s.end_time} · ${free}/${s.capacity} פנוי${s.course_name ? ' · ' + s.course_name : ''}`,
        type: 'slot',
        status: s.note,
        onClick: () => onNavigate('management'),
      });
    });
    // Pending submissions (candidates who booked an interview but haven't been accepted yet)
    pendingSubs.forEach(p => {
      const d = new Date(p.date);
      if (isNaN(d.getTime())) return;
      list.push({
        id: 'pending-' + p.id,
        date: d,
        title: `ראיון · ${p.name} · ${p.time}`,
        type: 'interview',
        status: 'pending',
        onClick: () => onNavigate('candidates'),
        calendarUrl: outlookCalendarUrl({
          subject: `ראיון מועמד: ${p.name}`,
          startDate: p.date,
          startTime: p.time.split('–')[0] || '10:00',
          endTime: p.time.split('–')[1] || '10:30',
          location: zoomFor(p.date),
          body: [zoomFor(p.date) ? `קישור לראיון בזום: ${zoomFor(p.date)}` : '', 'נא להתחבר כמה דקות לפני המועד, במקום שקט ועם מצלמה פתוחה, ולהמתין בחדר ההמתנה בזום.'].filter(Boolean).join('\n'),
          attendeeEmail: p.email,
        }),
      });
    });
    return list;
  }, [lectures, candidates, students, slots, pendingSubs, context, courses, onNavigate]);

  const eventsByDay = useMemo(() => {
    const m: Record<string, CalEvent[]> = {};
    events.forEach(e => {
      const k = dayKey(e.date);
      (m[k] ||= []).push(e);
    });
    return m;
  }, [events]);

  const firstOfMonth = cursor;
  const year = firstOfMonth.getFullYear();
  const month = firstOfMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = firstOfMonth.getDay(); // 0 = Sunday

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);
  while (cells.length % 7 !== 0) cells.push(null);

  const monthUpcoming = events
    .filter(e => e.date.getFullYear() === year && e.date.getMonth() === month)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  function goPrev() { setCursor(new Date(year, month - 1, 1)); }
  function goNext() { setCursor(new Date(year, month + 1, 1)); }
  function goToday() { setCursor(new Date(now.getFullYear(), now.getMonth(), 1)); }

  /** The month the poster should land on: whatever the month view is showing, when the
   *  year has a grid for it; the first month of תשפ״ז otherwise. */
  const posterMonthKey = useMemo(
    () => initialMonthKey(posterMonths, `${year}-${String(month + 1).padStart(2, '0')}-01`),
    [posterMonths, year, month],
  );

  /** Switch to the poster and put the month that was on screen at the top of it. */
  function showYear() {
    setView('year');
    requestAnimationFrame(() => {
      monthRefs.current[posterMonthKey]?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  }

  /** Back to the month grid, on a given month. */
  function showMonth(key?: string) {
    if (key) {
      const [y, m] = key.split('-').map(Number);
      setCursor(new Date(y, m - 1, 1));
    }
    setView('month');
  }

  /* ── the write path: the SAME one the lectures list uses ──────────────────
     src/lib/lectureSave.ts, which carries the Outlook sync, the
     fill-never-overwrite employer-contact rule and the CAS-guarded snapshot write.
     Booking a lecturer from here is not a second flow; it is that flow, reached
     from a date. */
  async function handleSave(lec: Lecture) {
    setEditing(null);
    setCreatingOn(null);
    setSaving(true);
    const res = await saveLecture(lec, data, userName);
    setSaving(false);
    if (!res.ok) { showToast('שגיאה בשמירה: ' + (res.error || ''), 'error'); return; }
    showToast(res.message + ' · נשמר בענן ☁️', 'success');
    onRefresh();
  }

  async function handleDelete(id: string) {
    setEditing(null);
    setSaving(true);
    const res = await deleteLecture(id, data, userName);
    setSaving(false);
    if (!res.ok) { showToast('שגיאה במחיקה: ' + (res.error || ''), 'error'); return; }
    showToast(res.message + ' · נשמר בענן ☁️', 'success');
    onRefresh();
  }

  const years = useMemo(() => {
    const set = new Set<string>();
    courses.forEach((c) => c.year && set.add(normalizeYear(c.year)));
    (data.lectures || []).forEach((l) => l.year && set.add(normalizeYear(l.year)));
    (data.academicYears || []).forEach((y) => set.add(normalizeYear(y)));
    return Array.from(set).sort().reverse();
  }, [courses, data.lectures, data.academicYears]);

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-10 pt-14 pb-28" data-calendar-page data-calendar-view={view}>

      <section className="pt-4 pb-10 border-b mb-8" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-6">VI · לוח שנה</div>
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <h1 className="serif text-[30px] sm:text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>
              {view === 'month' ? (
                <>{HEB_MONTHS[month]} <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>{year}</em></>
              ) : (
                <>שנה״ל <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>תשפ״ז</em></>
              )}
            </h1>
            <p className="text-[15px] sm:text-[17.5px] max-w-[620px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
              {view === 'month'
                ? (monthUpcoming.length === 0
                  ? 'אין אירועים מתוכננים לחודש זה בהקשר הנוכחי. לחיצה על יום פותחת את מה שקורה בו ומאפשרת לקבוע בו הרצאה.'
                  : `${monthUpcoming.length} אירועים החודש · הרצאות, ראיונות, מועדים והכנות. לחיצה על יום פותחת את מה שקורה בו.`)
                : 'אוקטובר 2026 – ספטמבר 2027, לוח אוניברסיטת אריאל עם לוח ההרצאות עליו. לחיצה על יום פותחת את מה שקורה בו.'}
            </p>
          </div>

          {/* ── The view toggle. Month ⇄ the year poster, never both at once. ── */}
          <div className="flex items-center gap-2 rounded-full p-1" data-view-switch
            style={{ border: '1px solid var(--divider)' }}>
            <ViewBtn active={view === 'month'} onClick={() => showMonth()} testId="month">חודש</ViewBtn>
            <ViewBtn active={view === 'year'} onClick={showYear} testId="year">שנה תשפ״ז</ViewBtn>
          </div>
        </div>

        {view === 'month' && (
          <div className="flex items-center gap-2 mt-6 flex-wrap">
            <NavBtn onClick={goPrev}>← חודש קודם</NavBtn>
            <NavBtn onClick={goToday} primary>היום</NavBtn>
            <NavBtn onClick={goNext}>חודש הבא →</NavBtn>
          </div>
        )}

        {view === 'year' && (
          <div className="flex flex-wrap gap-x-8 gap-y-3 mt-7">
            <Stat label="הרצאות בשנה" value={inGrid.total} />
            <Stat label="מאושרות" value={inGrid.approved} color={lectureColor('approved')} />
            <Stat label="טרם אושרו" value={inGrid.pending} color={lectureColor('pending')} />
          </div>
        )}

        {/* What is NOT on screen, said out loud rather than left to be discovered. */}
        {(yearFilterActive || undated.length > 0 || context.courseId !== '__all__') && (
          <div className="mt-6 text-[12.5px] leading-[1.7]" style={{ color: 'var(--text-soft)' }}>
            {context.courseId !== '__all__' && <div data-scope-note>מסונן לקורס: <strong>{context.courseId}</strong></div>}
            {yearFilterActive && (
              <div data-year-note>
                מסנן השנה בסרגל העליון ({context.year}) חל על הראיונות, המועדים וההכנות.
                ההרצאות מוצגות במלואן — בלוח, בכרטיס היום, בתצוגת השנה ובהתראת ההתנגשויות — כדי שלא תיקבע הרצאה על תאריך תפוס.
              </div>
            )}
            {undated.length > 0 && <div data-undated-note>{undated.length} הרצאות ללא תאריך אינן מופיעות בלוח.</div>}
          </div>
        )}
      </section>

      {/* ── Conflicts: lectures already standing on a day the university has closed ── */}
      {conflicts.length > 0 && (
        <section
          data-conflict-banner
          className="mb-8 rounded-2xl p-4 sm:p-5"
          style={{ background: 'rgba(224,102,102,0.10)', border: '1px solid rgba(224,102,102,0.55)' }}
        >
          <div className="serif text-[19px] mb-2" style={{ color: 'var(--ink)' }}>
            {conflicts.length === 1 ? 'הרצאה אחת בתאריך שאינו מתאים' : `${conflicts.length} הרצאות בתאריכים שאינם מתאימים`}
          </div>
          <ul className="flex flex-col gap-2">
            {conflicts.map((c) => (
              <li key={c.lectureId + c.iso}>
                <button
                  onClick={() => { showMonth(c.iso.slice(0, 7)); setOpenDay(c.iso); }}
                  className="w-full text-right rounded-xl px-3 py-2"
                  style={{ minHeight: 44, background: 'transparent', border: '1px solid var(--divider)', cursor: 'pointer' }}
                >
                  <span className="text-[14px]" style={{ color: 'var(--ink)' }}>{c.title}</span>
                  <span className="mono text-[11px] mx-2" dir="ltr" style={{ color: 'var(--text-soft)' }}>{c.iso}</span>
                  <span className="block text-[12.5px] mt-0.5" style={{ color: 'var(--text-soft)' }}>{c.blocker.reason}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ══════════════════════ MONTH VIEW ══════════════════════ */}
      {view === 'month' && (
        <section className="mb-12" data-month-grid={`${year}-${String(month + 1).padStart(2, '0')}`}>
          <div className="grid grid-cols-7 gap-0 border rounded-xl overflow-hidden"
            style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.25)' }}>
            {HEB_DAYS.map(d => (
              <div key={d} className="py-3 text-center mono text-[11.5px] uppercase tracking-[0.16em] font-semibold border-b"
                style={{ color: 'var(--ink)', borderColor: 'var(--divider)', background: 'rgba(122,30,43,0.04)' }}>
                {d}
              </div>
            ))}
            {cells.map((day, i) => {
              if (day === null) {
                return <div key={i} className="h-28 border-t border-l"
                  style={{ borderColor: 'var(--divider)' }}/>;
              }
              const cellDate = new Date(year, month, day);
              const key = dayKey(cellDate);
              const dayEvents = eventsByDay[key] || [];
              const holiday = HEB_HOLIDAYS[key];
              const isToday = key === today;
              const isOpen = openDay === key;
              const hasEvents = dayEvents.length > 0;
              const academic = academicDayMap.get(key) ?? [];
              const verdict = dayVerdict(academic);

              /* THE FILL IS THE EVENTS' — see `eventStripes`. */
              const stripes = eventStripes(dayEvents, academic);
              const filled = stripes.length > 0;
              /* THE UNIVERSITY'S DAY TYPE IS THE BAND — see `academicBand`. */
              const band = academicBand(academic, holiday);

              return (
                <div
                  key={i}
                  data-day-cell={key}
                  data-verdict={verdict}
                  data-lectures={lectureMarks.get(key)?.total ?? 0}
                  data-filled={filled ? stripes.length : 0}
                  role="button"
                  tabIndex={0}
                  aria-label={`${longHebrewDate(key)}${hasEvents ? ` · ${dayEvents.length} אירועים` : ''}${band ? ` · ${band.label}` : ''}`}
                  onClick={() => setOpenDay(key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenDay(key); } }}
                  className="h-28 border-t border-l p-2 overflow-hidden flex flex-col gap-1 relative cursor-pointer"
                  style={{
                    borderColor: 'var(--divider)',
                    backgroundImage: stripeBackground(stripes),
                    /* No tint for "today" any more: the fill now MEANS "an event is
                       here", so a wine wash on an empty today would claim a lecture that
                       does not exist. Today is the ring and the badge instead. */
                    backgroundColor: 'transparent',
                    /* Selected outranks today, and both are drawn as chrome rather than
                       colour so neither can be confused with an event. On a filled cell
                       they go white (with a dark outer edge when selected, so the ring
                       survives a pale session colour); on an empty one they stay the
                       theme's own ink and accent. */
                    boxShadow: isOpen
                      ? (filled ? 'inset 0 0 0 3px #fff, inset 0 0 0 5px rgba(0,0,0,0.55)' : 'inset 0 0 0 3px var(--ink)')
                      : isToday
                        ? (filled ? 'inset 0 0 0 3px #fff, inset 0 0 0 4px rgba(0,0,0,0.35)' : 'inset 0 0 0 2px var(--accent)')
                        : undefined,
                  }}
                >
                  {/* ── The university's day type: a band across the top. Caution tape on a
                         day it is SHUT — the one treatment that still reads "do not book
                         here" when a strong event colour is filling the cell under it. ── */}
                  {band && (
                    <span
                      data-academic-band={band.category}
                      data-band-blocked={band.blocked ? '1' : '0'}
                      aria-hidden="true"
                      className="absolute top-0 left-0 right-0"
                      style={{
                        height: BAND_H,
                        background: band.blocked
                          ? `repeating-linear-gradient(45deg, ${band.color} 0 5px, rgba(0,0,0,0.55) 5px 10px)`
                          : band.color,
                        borderBottom: `1px solid ${ARIEL_PAPER.edge}`,
                      }}
                    />
                  )}

                  {/* Everything TEXTUAL sits on a near-white plate, so it is readable on
                      any stripe — the app's dark wine/green/blue/brown and the dataset's
                      pale pastels alike — in both themes, without guessing an ink per
                      stripe for a date that may straddle two of them. */}
                  <div className="flex items-start justify-between gap-1" style={{ marginTop: band ? BAND_H - 2 : 0 }}>
                    {isToday ? (
                      <span
                        className="serif text-[18px] leading-none rounded-full flex items-center justify-center shrink-0"
                        style={{
                          width: 30, height: 30, background: 'var(--accent)', color: '#fff',
                          boxShadow: filled ? '0 0 0 2px rgba(255,255,255,0.95)' : undefined,
                        }}
                      >
                        {day}
                      </span>
                    ) : (
                      <span
                        className="serif leading-none shrink-0 rounded"
                        style={{
                          color: filled ? ARIEL_PAPER.ink : (hasEvents ? 'var(--accent)' : 'var(--ink)'),
                          fontSize: hasEvents ? '22px' : '20px',
                          fontWeight: hasEvents ? 700 : 400,
                          background: filled ? PLATE : 'transparent',
                          padding: filled ? '1px 5px' : 0,
                        }}
                      >
                        {day}
                      </span>
                    )}
                    {/* The band's NAME, from 640px up only. A 55px cell has ~20px left
                        beside the date, which turns "אין לימודים" into "א…" — noise that
                        reads as a rendering fault rather than as information. On the
                        phone the band's colour and its caution-tape hatch carry it (both
                        named in the legend), the cell's aria-label says it in full, and
                        the day sheet leads with it in words. */}
                    {band && (
                      <span className="mono text-[9px] uppercase tracking-[0.1em] truncate max-w-[62%] rounded hidden sm:inline-block"
                        title={band.label} data-band-label={band.category}
                        style={{
                          color: ARIEL_PAPER.ink,
                          background: PLATE,
                          padding: '2px 4px',
                          fontWeight: band.blocked ? 700 : 400,
                        }}>
                        {band.label}
                      </span>
                    )}
                  </div>

                  {/* ── The event titles, from 640px up. Same shape, same ink, same
                         right bar as they have always had; on a filled cell the plate
                         under them keeps the wine / green / blue / brown at full
                         contrast. Below 640px a 55px cell truncates every one of them to
                         two characters, so the phone gets a COUNT instead and the titles
                         live one tap away, in the day sheet. ── */}
                  <div className="hidden sm:flex flex-col gap-0.5 overflow-hidden">
                    {dayEvents.slice(0, 2).map(e => (
                      <span
                        key={e.id}
                        data-event-chip={e.type}
                        className="text-right text-[10.5px] truncate rounded px-1.5 py-0.5"
                        style={{
                          background: filled ? PLATE : eventColor(e.type) + '22',
                          color: eventColor(e.type),
                          borderRight: `2px solid ${eventColor(e.type)}`,
                        }}
                      >
                        {e.title}
                      </span>
                    ))}
                    {dayEvents.length > 2 && (
                      <span className="text-[10px] mono tracking-[0.12em] rounded self-start"
                        style={{
                          color: filled ? ARIEL_PAPER.ink : 'var(--text-soft)',
                          background: filled ? PLATE : 'transparent',
                          padding: filled ? '0 4px' : 0,
                        }}>
                        +{dayEvents.length - 2} נוספים
                      </span>
                    )}
                  </div>

                  {hasEvents && (
                    <span
                      data-event-count={dayEvents.length}
                      className="sm:hidden mono text-[11px] font-bold rounded-full self-start grid place-items-center"
                      style={{
                        minWidth: 18, height: 18, padding: '0 5px',
                        background: filled ? PLATE : 'var(--accent)',
                        color: filled ? ARIEL_PAPER.ink : 'var(--bg)',
                      }}
                    >
                      {dayEvents.length}
                    </span>
                  )}

                  {isToday && (
                    <span className="absolute bottom-1.5 right-2 mono text-[9px] uppercase tracking-[0.15em] font-bold rounded"
                      style={{
                        color: filled ? ARIEL_PAPER.ink : 'var(--accent)',
                        background: filled ? PLATE : 'transparent',
                        padding: filled ? '1px 4px' : 0,
                      }}>היום</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ══════════════════════ YEAR VIEW — the Ariel poster ══════════════════════
           Fixed white/black in both themes. This is the university's printed table,
           reproduced; it does not follow the app's day/night switch. */}
      {view === 'year' && (
        <>
          <nav className="flex flex-wrap gap-2 mb-6" aria-label="קפיצה לחודש">
            {posterMonths.map((m) => (
              <button
                key={m.key}
                data-month-chip={m.key}
                onClick={() => monthRefs.current[m.key]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="mono text-[12px] font-semibold rounded-full px-3"
                style={{
                  minHeight: 44, minWidth: 56,
                  border: '1px solid var(--divider)',
                  background: 'transparent',
                  color: 'var(--ink)',
                  cursor: 'pointer',
                }}
              >
                {m.shortLabel}
              </button>
            ))}
          </nav>

          <div className="flex flex-col gap-5 mb-10" data-year-poster>
            {posterMonths.map((m) => (
              <section
                key={m.key}
                data-paper
                ref={(el) => { monthRefs.current[m.key] = el; }}
                className="rounded-2xl"
                style={{
                  background: ARIEL_PAPER.paper,
                  color: ARIEL_PAPER.ink,
                  border: `1px solid ${ARIEL_PAPER.edge}`,
                  padding: '14px 6px 10px',
                  boxShadow: '0 18px 48px rgba(0,0,0,0.10)',
                  scrollMarginTop: 'calc(var(--header-h, 108px) + 12px)',
                }}
              >
                <PosterMonth
                  month={m}
                  academicDayMap={academicDayMap}
                  lectureMarks={lectureMarks}
                  today={today}
                  openDay={openDay}
                  onOpenDay={setOpenDay}
                />
              </section>
            ))}
          </div>
        </>
      )}

      {/* ══════════════════════ ONE LEGEND ══════════════════════
           The month view's event chips, the poster's lecture states and the
           university's own categories, in one place. Two legends for one calendar was
           part of what made it read as two calendars. */}
      <section className="mb-12" data-legend>
        <h2 className="serif text-[24px] tracking-tight mb-4 pb-3 border-b" style={{ color: 'var(--ink)', borderColor: 'var(--divider)' }}>
          מקרא
        </h2>

        {/* ── 1. THE FILL: what is happening on the day. ── */}
        <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--text-soft)' }}>
          צבע התא — מה קורה ביום
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-2.5 mb-6">
          {([['lecture', 'הרצאה'], ['interview', 'ראיון'], ['slot', 'מועד פנוי'], ['prep', 'הכנה']] as const).map(([t, label]) => (
            <li key={t} className="inline-flex items-center gap-2 text-[13.5px]" style={{ color: 'var(--ink)' }}>
              <span data-legend-swatch={t} className="inline-block rounded-[3px]"
                style={{ width: 20, height: 14, background: eventColor(t), border: `1px solid ${ARIEL_PAPER.edge}` }} />
              {label}
            </li>
          ))}
          {SESSION_CATEGORIES.map((c) => (
            <li key={c.key} className="inline-flex items-center gap-2 text-[13.5px]" style={{ color: 'var(--ink)' }}>
              <span data-legend-swatch={c.key} className="inline-block rounded-[3px]"
                style={{ width: 20, height: 14, background: c.swatch, border: `1px solid ${ARIEL_PAPER.edge}` }} />
              {c.label}
            </li>
          ))}
        </ul>
        <p className="text-[12.5px] leading-[1.7] mb-7" style={{ color: 'var(--text-soft)' }}>
          יום שיש בו כמה סוגים נחלק לפסים אנכיים שווים — פס אחד לכל סוג, מימין לשמאל — כך שיום עם סוג אחד
          הוא ריבוע אחיד ויום מעורב עדיין מראה כל צבע שיש בו.
        </p>

        {/* ── 2. THE BAND: what the university says the day IS. ── */}
        <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--text-soft)' }}>
          הפס העליון — יום האוניברסיטה
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-2.5 mb-3">
          {BAND_CATEGORIES.map((c) => (
            <li key={c.key} className="inline-flex items-center gap-2 text-[13.5px]" style={{ color: 'var(--ink)' }}>
              <span data-legend-swatch={c.key} className="inline-block rounded-[3px]"
                style={{ width: 24, height: 12, background: c.swatch, border: `1px solid ${ARIEL_PAPER.edge}` }} />
              {c.label}
            </li>
          ))}
          <li className="inline-flex items-center gap-2 text-[13.5px]" style={{ color: 'var(--ink)' }}>
            <span data-legend-swatch="holiday" className="inline-block rounded-[3px]"
              style={{ width: 24, height: 12, background: HOLIDAY_BAND, border: `1px solid ${ARIEL_PAPER.edge}` }} />
            חג יהודי
          </li>
        </ul>
        <ul className="flex flex-wrap gap-x-6 gap-y-2.5 mb-3">
          <li className="inline-flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>
            <span data-legend-swatch="blocked-band" className="inline-block rounded-[3px]"
              style={{
                width: 24, height: 12,
                background: `repeating-linear-gradient(45deg, ${ARIEL_PAPER.gold} 0 5px, rgba(0,0,0,0.55) 5px 10px)`,
                border: `1px solid ${ARIEL_PAPER.edge}`,
              }} />
            לא לקבוע הרצאה — אין לימודים או תקופת בחינות
          </li>
        </ul>
        <ul className="flex flex-wrap gap-x-6 gap-y-2.5 mb-7">
          {TODO_CATEGORIES.map((c) => (
            <li key={c.key} className="inline-flex items-center gap-2 text-[13.5px]" style={{ color: 'var(--text-soft)' }}>
              <span data-legend-swatch={c.key} className="inline-block rounded-[3px]"
                style={{ width: 20, height: 14, background: c.swatch, border: `1px solid ${ARIEL_PAPER.edge}` }} />
              {c.label} — מופיע בכרטיס היום
            </li>
          ))}
        </ul>

        {/* ── 3. The year view's own marks. ── */}
        <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--text-soft)' }}>
          מצב ההרצאה — הטבעת והפסים בתצוגת השנה
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-2.5">
          {(['approved', 'pending', 'cancelled'] as const).map((s) => (
            <li key={s} className="inline-flex items-center gap-2 text-[13.5px]" style={{ color: 'var(--ink)' }}>
              <span
                data-legend-swatch={s}
                className="inline-block rounded-[3px]"
                style={{ width: 18, height: 10, background: lectureColor(s), border: `1px solid ${ARIEL_PAPER.edge}` }}
              />
              {LECTURE_STATE_LABEL[s]}
            </li>
          ))}
        </ul>

        <p className="mt-5 text-[12.5px] leading-[1.7]" data-precedence-note style={{ color: 'var(--text-soft)' }}>
          צבע התא שייך לאירועים; יום האוניברסיטה עבר לפס העליון, ובימים שאין בהם לימודים או שהם בתקופת בחינות
          הפס מסורגל — זהו הסימן ״לא לקבוע כאן״, והוא נשאר גם כשהתא מלא בצבע. חג יהודי מסומן בפס אפור רק בימים
          שהלוח האקדמי שותק לגביהם — כלומר מחוץ לשנה״ל תשפ״ז; בתוכה הלוח של האוניברסיטה הוא הקובע. ״היום״ והיום
          הפתוח מסומנים במסגרת בלבד, לעולם לא בצבע מילוי, כדי שלא ייקראו כאירוע.
        </p>

        {outside.length > 0 && (
          <p className="mt-3 text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
            מחוץ לטווח הלוח האקדמי: {outside.map((o) => `${o.title} (${o.date})`).join(' · ')}
          </p>
        )}
      </section>

      {/* ── Month list — the month view's own agenda, unchanged ── */}
      {view === 'month' && (
        <section>
          <div className="flex items-baseline justify-between gap-10 mb-8 pb-5 border-b" style={{ borderColor: 'var(--divider)' }}>
            <h2 className="serif text-[30px] tracking-tight leading-[1.15]" style={{ color: 'var(--ink)' }}>אירועי החודש</h2>
            <span className="mono text-[12px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-soft)' }}>
              {monthUpcoming.length} אירועים
            </span>
          </div>
          {monthUpcoming.length === 0 ? (
            <div className="py-12 text-center text-[15px]" style={{ color: 'var(--text-soft)' }}>
              אין אירועים בחודש זה.
            </div>
          ) : (
            <ul>
              {monthUpcoming.map(e => (
                <li key={e.id} className="py-4 border-b flex items-baseline gap-5" style={{ borderColor: 'var(--divider)' }}>
                  <div className="w-20 text-right">
                    <div className="serif text-[24px] leading-none" style={{ color: 'var(--ink)' }}>
                      {String(e.date.getDate()).padStart(2, '0')}
                    </div>
                    <div className="mono text-[10px] uppercase tracking-[0.16em] mt-1" style={{ color: 'var(--text-soft)' }}>
                      {HEB_DAYS[e.date.getDay()]}
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="text-[15px]" style={{ color: 'var(--ink)' }}>{e.title}</div>
                    <div className="mono text-[10.5px] uppercase tracking-[0.14em] mt-1" style={{ color: eventColor(e.type) }}>
                      {EVENT_TYPE_LABEL[e.type]}
                      {e.status && ` · ${e.status}`}
                    </div>
                  </div>
                  <button onClick={() => setOpenDay(dayKey(e.date))}
                    className="mono text-[11px] uppercase tracking-[0.14em] font-semibold hover:opacity-70"
                    style={{ color: 'var(--accent)' }}>
                    פתח ←
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── The day sheet — the ONE thing a day tap opens, in either view ── */}
      {openDay && (
        <DaySheet
          iso={openDay}
          academic={academicDayMap.get(openDay) ?? []}
          academicCourseKeys={academicCourseKeys}
          lectures={lectureDayMap.get(openDay) ?? []}
          other={(eventsByDay[openDay] ?? []).filter(e => e.type !== 'lecture')}
          trainers={trainers}
          onClose={() => setOpenDay(null)}
          onEditLecture={(l) => setEditing(l)}
          onAddLecture={() => setCreatingOn(openDay)}
          onOpenTrainers={() => { setOpenDay(null); onNavigate('trainers'); }}
        />
      )}

      {/* ── The app's own lecture editor, reached from a date ── */}
      {(editing || creatingOn) && (
        <LectureEditor
          lecture={editing}
          courses={courses}
          years={years}
          defaultCourseId={context.courseId}
          defaultYear={context.year}
          defaultDate={creatingOn ?? undefined}
          typeOptions={Array.from(new Set((data.lectures || []).map((l) => l.type).filter(Boolean))) as string[]}
          statusOptions={Array.from(new Set((data.lectures || []).map((l) => l.status).filter(Boolean))) as string[]}
          lectures={data.lectures || []}
          onSave={handleSave}
          onDelete={editing ? handleDelete : undefined}
          onClose={() => { setEditing(null); setCreatingOn(null); }}
        />
      )}

      {saving && (
        <div className="fixed bottom-4 right-4 mono text-[11px] uppercase tracking-[0.14em] px-3 py-2 rounded-full z-[80]"
          style={{ background: 'var(--accent)', color: 'white' }}>
          שומר…
        </div>
      )}
    </main>
  );
}

/* ══════════════════════ one poster month ══════════════════════ */

function PosterMonth({
  month, academicDayMap, lectureMarks, today, openDay, onOpenDay,
}: {
  month: AcademicMonth;
  academicDayMap: Map<string, AcademicDayItem[]>;
  lectureMarks: Map<string, LectureDayMark>;
  today: string;
  openDay: string | null;
  onOpenDay: (iso: string) => void;
}) {
  return (
    <div data-month={month.key}>
      <div className="serif text-[20px] text-center mb-2.5" style={{ color: ARIEL_PAPER.ink }}>
        {month.label}
      </div>
      <div className="grid grid-cols-7" style={{ gap: 2 }}>
        {ACADEMIC_WEEKDAY_LABELS.map((d) => (
          <div key={d} className="mono text-[11px] font-bold text-center pb-1"
            style={{ color: ARIEL_PAPER.muted }}>
            {d}
          </div>
        ))}
        {month.cells.map((cell) => {
          if (!cell.inMonth) {
            return <div key={cell.iso} style={{ minHeight: CELL_MIN }} aria-hidden="true" />;
          }
          const lm = lectureMarks.get(cell.iso);
          const items = academicDayMap.get(cell.iso) ?? [];
          const verdict = dayVerdict(items);
          const isToday = cell.iso === today;
          const isOpen = cell.iso === openDay;

          /* The lecture ring is what lifts a booked day off the paper. Amber the
             moment anything on the day is still unapproved — chasing those is the
             actual job, so "something here needs me" outranks "something here is
             settled" on a single cell. */
          const ring = lm
            ? (lm.hasPending ? lectureColor('pending') : lm.approved > 0 ? lectureColor('approved') : lectureColor('cancelled'))
            : null;

          return (
            <button
              key={cell.iso}
              data-academic-day={cell.iso}
              data-verdict={verdict}
              data-lectures={lm?.total ?? 0}
              aria-label={`${longHebrewDate(cell.iso)}${lm ? ` · ${lm.total} הרצאות` : ''}`}
              onClick={() => onOpenDay(cell.iso)}
              className="relative rounded-[6px] flex flex-col items-center justify-start"
              style={{
                minHeight: CELL_MIN,
                padding: '3px 1px 4px',
                background: cell.fill ?? ARIEL_PAPER.paper,
                color: ARIEL_PAPER.ink,
                border: `1px solid ${isToday ? ARIEL_PAPER.ink : ARIEL_PAPER.rule}`,
                boxShadow: isOpen
                  ? `0 0 0 3px ${ARIEL_PAPER.ink}`
                  : ring ? `inset 0 0 0 2px ${ring}` : undefined,
                cursor: 'pointer',
                overflow: 'hidden',
              }}
            >
              <span
                className="serif leading-none"
                style={{ fontSize: 17, fontWeight: isToday ? 700 : 400, marginTop: 1 }}
              >
                {cell.day}
              </span>

              {/* the academic layer's own course colours, as dots */}
              {cell.accents.length > 0 && (
                <span className="flex gap-[2px] mt-[3px]">
                  {cell.accents.map((hex, i) => (
                    <span key={i} className="inline-block rounded-full"
                      style={{ width: 5, height: 5, background: hex, border: `0.5px solid ${ARIEL_PAPER.edge}` }} />
                  ))}
                </span>
              )}

              {/* the FOREGROUND: one bar per lecture, colour = its state */}
              {lm && lm.total > 0 && (
                <span className="flex gap-[2px] mt-auto w-full justify-center" data-lecture-bars>
                  {barsFor(lm).map((color, i) => (
                    <span key={i} className="inline-block rounded-[2px]"
                      style={{ width: 9, height: 5, background: color }} />
                  ))}
                  {lm.total > 3 && (
                    <span className="mono" style={{ fontSize: 8, lineHeight: '5px', color: ARIEL_PAPER.ink }}>
                      +{lm.total - 3}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Up to three bars, pending first — the unapproved ones must never be the ones cut off. */
function barsFor(lm: LectureDayMark): string[] {
  const out: string[] = [];
  for (let i = 0; i < lm.pending && out.length < 3; i++) out.push(lectureColor('pending'));
  for (let i = 0; i < lm.approved && out.length < 3; i++) out.push(lectureColor('approved'));
  for (let i = 0; i < lm.cancelled && out.length < 3; i++) out.push(lectureColor('cancelled'));
  return out;
}

/* ══════════════════════ the day sheet ══════════════════════ */

const VERDICT_STYLE: Record<string, { bg: string; border: string }> = {
  blocked: { bg: 'rgba(224,102,102,0.14)', border: 'rgba(224,102,102,0.65)' },
  caution: { bg: 'rgba(246,178,107,0.16)', border: 'rgba(246,178,107,0.75)' },
  open: { bg: 'rgba(147,196,125,0.16)', border: 'rgba(147,196,125,0.75)' },
};

const EVENT_TYPE_LABEL: Record<CalEvent['type'], string> = {
  lecture: 'הרצאה', interview: 'ראיון', prep: 'הכנה', slot: 'מועד פנוי',
};

function DaySheet({
  iso, academic, academicCourseKeys, lectures, other, trainers,
  onClose, onEditLecture, onAddLecture, onOpenTrainers,
}: {
  iso: string;
  academic: AcademicDayItem[];
  /** Academic course keys the top-bar filter resolved to, or null for "all". */
  academicCourseKeys: string[] | null;
  lectures: LectureDayItem[];
  other: CalEvent[];
  trainers: Trainer[];
  onClose: () => void;
  onEditLecture: (l: Lecture) => void;
  onAddLecture: () => void;
  onOpenTrainers: () => void;
}) {
  const report = daySchedulingReport(iso, academic, lectures);
  const verdict = dayVerdict(academic);
  const style = VERDICT_STYLE[verdict];

  /* THE THREE QUESTIONS a day tap has to answer, in the order he asks them:
     is there teaching, is there a guest lecture, and who is the lecturer. */
  const allSessions = academic.filter(isTeachingSession);
  const sessions = academicCourseKeys
    ? allSessions.filter((s) => !s.course || academicCourseKeys.includes(s.course))
    : allSessions;
  const hiddenSessions = allSessions.length - sessions.length;
  const universityItems = academic.filter((it) => !isTeachingSession(it));
  const guestLectures = lectures.filter((l) => l.isGuest);
  const ownLectures = lectures.filter((l) => !l.isGuest);

  return (
    <>
      <div className="fixed inset-0 z-[70]" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose} />
      {/* A bottom sheet, because this is used one-handed on a phone: everything that
          can be tapped sits in the lower half of the screen, where the thumb is. */}
      <div
        data-day-sheet={iso}
        role="dialog"
        aria-label={longHebrewDate(iso)}
        className="fixed left-0 right-0 bottom-0 z-[75] rounded-t-3xl overflow-y-auto"
        style={{
          background: 'var(--bg)',
          borderTop: '1px solid var(--divider)',
          boxShadow: '0 -18px 60px rgba(0,0,0,0.30)',
          maxHeight: '82vh',
          padding: '14px 16px calc(20px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="mx-auto rounded-full mb-3" style={{ width: 44, height: 4, background: 'var(--divider)' }} />

        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="serif text-[24px] leading-tight" style={{ color: 'var(--ink)' }}>
            {longHebrewDate(iso)}
          </h2>
          <button
            onClick={onClose}
            aria-label="סגור"
            className="rounded-full shrink-0 grid place-items-center"
            style={{ width: 44, height: 44, border: '1px solid var(--divider)', color: 'var(--ink)', background: 'transparent', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {/* ── THE ANSWER. This is the reason the sheet exists: whether a lecturer can
               be put here, said in words, before anything else on it. ── */}
        <div
          data-day-verdict={verdict}
          className="rounded-2xl p-3.5 mb-5"
          style={{ background: style.bg, border: `1px solid ${style.border}` }}
        >
          <div className="serif text-[18px] mb-1" style={{ color: 'var(--ink)' }}>
            {DAY_VERDICT_LABEL[verdict]}
          </div>
          {report.blockers.length === 0 ? (
            <div className="text-[13px]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
              לוח האוניברסיטה אינו מציב מגבלה על תאריך זה.
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {report.blockers.map((b, i) => (
                <li key={i} data-blocker={b.level} className="text-[13px] leading-[1.55]" style={{ color: 'var(--ink)', opacity: 0.9 }}>
                  {b.level === 'blocked' ? '⛔ ' : '⚠️ '}{b.reason}
                </li>
              ))}
            </ul>
          )}
          {report.conflicting.length > 0 && (
            <div data-day-conflict className="mt-2.5 pt-2.5 text-[13px] font-semibold border-t"
              style={{ color: 'var(--ink)', borderColor: style.border }}>
              {report.conflicting.length === 1
                ? 'הרצאה שכבר קבועה כאן נמצאת בתאריך שאינו מתאים.'
                : `${report.conflicting.length} הרצאות שכבר קבועות כאן נמצאות בתאריך שאינו מתאים.`}
            </div>
          )}
        </div>

        {/* ── 1. IS THERE TEACHING, AND IN WHICH COURSE.
               "הקשה עליו צריכה להראות גם אם יש לימודים וקורס מסויים" — so the courses
               that actually MEET that day are named, with the session number and the
               hour, before anything about a guest. A day with no class of his says so
               in words: silence here would read as missing data. ── */}
        <section className="mb-5" data-day-teaching={sessions.length}>
          <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--text-soft)' }}>
            לימודים ביום זה {sessions.length > 0 && `(${sessions.length})`}
          </div>
          {sessions.length === 0 ? (
            <div className="text-[13.5px]" style={{ color: 'var(--text-soft)' }}>
              {report.blocked ? 'אין לימודים ביום זה.' : 'אין מפגש קורס ביום זה.'}
              {hiddenSessions > 0 && ` (${hiddenSessions} מפגשים בקורסים אחרים הוסתרו על ידי מסנן הקורס.)`}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {sessions.map((s, i) => (
                <li key={i} data-day-session={s.course || s.category}
                  className="rounded-2xl p-3"
                  style={{ border: '1px solid var(--divider)', borderRight: `4px solid ${s.hex}`, background: 'var(--surface-1, transparent)' }}>
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
                      {s.courseTitle || s.categoryLabel}
                    </span>
                    {s.time && <span className="mono text-[12px]" dir="ltr" style={{ color: 'var(--ink)' }}>{s.time}</span>}
                  </div>
                  <div className="text-[12.5px] mt-1 leading-[1.6]" style={{ color: 'var(--text-soft)' }}>
                    {[s.session ? `מפגש ${s.session}` : '', s.categoryLabel, s.code].filter(Boolean).join(' · ')}
                  </div>
                  <div className="text-[12.5px] mt-1 leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.85 }}>{s.title}</div>
                  {s.note && <div className="text-[12px] mt-1.5" style={{ color: 'var(--text-soft)' }}>{s.note}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── 2. IS THERE A GUEST LECTURE — and 3. WHO IS GIVING IT.
               "ואם אפשר שתהיה מחוברת לפרטי המרצה שקיימים כבר": the lecturer's name is
               not dead text. It resolves to the app's own trainer record when one
               exists, and to the lecture's own contact fields when it does not, with
               tap-to-call and tap-to-mail because he is holding a phone. ── */}
        <section className="mb-5" data-day-guests={guestLectures.length}>
          <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--text-soft)' }}>
            הרצאות אורח ביום זה {guestLectures.length > 0 && `(${guestLectures.length})`}
          </div>
          {guestLectures.length === 0 ? (
            <div className="text-[13.5px]" style={{ color: 'var(--text-soft)' }}>אין הרצאת אורח ביום זה.</div>
          ) : (
            <ul className="flex flex-col gap-3">
              {guestLectures.map((l) => (
                <li key={l.id}>
                  <LectureRow l={l} onEdit={onEditLecture} guest />
                  <LecturerCard
                    contact={lecturerContact(l.lecture, trainers)}
                    onOpenTrainers={onOpenTrainers}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── His own entries on the day — kept apart from the guests, never dropped. ── */}
        {ownLectures.length > 0 && (
          <section className="mb-5" data-day-own={ownLectures.length}>
            <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--text-soft)' }}>
              מפגשים נוספים שלך ({ownLectures.length})
            </div>
            <ul className="flex flex-col gap-2">
              {ownLectures.map((l) => <li key={l.id}><LectureRow l={l} onEdit={onEditLecture} /></li>)}
            </ul>
          </section>
        )}

        {/* ── Everything ELSE the calendar knows about the day: the interviews, the
               free interview slots and the student preparations it has always drawn. ── */}
        {other.length > 0 && (
          <section className="mb-5">
            <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--text-soft)' }}>
              ראיונות, מועדים והכנות ({other.length})
            </div>
            <ul className="flex flex-col gap-2">
              {other.map((e) => (
                <li key={e.id} className="flex items-stretch gap-2">
                  <button
                    data-day-event={e.type}
                    onClick={e.onClick}
                    className="flex-1 text-right rounded-2xl p-3"
                    style={{
                      minHeight: 44,
                      background: 'var(--surface-1, transparent)',
                      border: '1px solid var(--divider)',
                      borderRight: `4px solid ${eventColor(e.type)}`,
                      cursor: 'pointer',
                    }}
                  >
                    <div className="text-[14.5px] leading-[1.4]" style={{ color: 'var(--ink)' }}>{e.title}</div>
                    <div className="mono text-[10.5px] uppercase tracking-[0.12em] mt-1" style={{ color: eventColor(e.type) }}>
                      {EVENT_TYPE_LABEL[e.type]}{e.status && ` · ${e.status}`}
                    </div>
                  </button>
                  {e.calendarUrl && (
                    <button
                      type="button"
                      title="הוסף ליומן Outlook"
                      aria-label="הוסף ליומן Outlook"
                      data-outlook={e.id}
                      onClick={() => window.open(e.calendarUrl, '_blank')}
                      className="rounded-2xl border grid place-items-center shrink-0"
                      style={{ width: 44, minHeight: 44, borderColor: 'var(--divider)', color: 'var(--ink)', background: 'transparent', cursor: 'pointer', fontSize: 15 }}
                    >📅</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── What the university says about this day, beyond the teaching itself. ── */}
        <section className="mb-5">
          <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--text-soft)' }}>
            לוח אקדמי
          </div>
          {universityItems.length === 0 ? (
            <div className="text-[13.5px]" style={{ color: 'var(--text-soft)' }}>אין רישום נוסף בלוח האקדמי ליום זה.</div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {universityItems.map((it, i) => (
                <li key={i} data-day-academic={it.category} className="flex items-start gap-2.5">
                  <span className="inline-block rounded-[3px] shrink-0 mt-1"
                    style={{ width: 14, height: 14, background: it.hex, border: `1px solid ${ARIEL_PAPER.edge}` }} />
                  <div className="min-w-0">
                    <div className="text-[14px] leading-[1.45]" style={{ color: 'var(--ink)' }}>{it.title}</div>
                    <div className="text-[12px] mt-0.5" style={{ color: 'var(--text-soft)' }}>
                      {[it.categoryLabel, it.time, it.session ? `מפגש ${it.session}` : '', it.courseTitle]
                        .filter(Boolean).join(' · ')}
                    </div>
                    {it.note && <div className="text-[12px] mt-1" style={{ color: 'var(--text-soft)', opacity: 0.85 }}>{it.note}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Book the date. The same editor the lectures screen opens, already on this
               day. On a blocked day the button still works — Yariv is the one who
               decides, and a make-up arrangement is a real thing — but it says what it
               is doing. ── */}
        <button
          data-add-lecture={iso}
          onClick={onAddLecture}
          className="w-full rounded-full font-semibold text-[13.5px]"
          style={{
            minHeight: 48,
            background: report.blocked ? 'transparent' : 'var(--accent)',
            color: report.blocked ? 'var(--accent)' : 'white',
            border: '1px solid var(--accent)',
            cursor: 'pointer',
          }}
        >
          {report.blocked ? '+ קבע הרצאה בכל זאת בתאריך זה' : '+ קבע הרצאה בתאריך זה'}
        </button>
      </div>
    </>
  );
}

/** One lecture on the day sheet. Opens the app's own editor — the single write path. */
function LectureRow({ l, onEdit, guest }: { l: LectureDayItem; onEdit: (x: Lecture) => void; guest?: boolean }) {
  return (
    <button
      data-day-lecture={l.id}
      data-lecture-state={l.state}
      data-lecture-kind={guest ? 'guest' : 'own'}
      onClick={() => onEdit(l.lecture)}
      className="w-full text-right rounded-2xl p-3"
      style={{
        minHeight: 44,
        background: 'var(--surface-1, transparent)',
        border: '1px solid var(--divider)',
        borderRight: `4px solid ${lectureColor(l.state)}`,
        cursor: 'pointer',
        opacity: l.state === 'cancelled' ? 0.55 : 1,
      }}
    >
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-[15px] font-semibold"
          style={{ color: 'var(--ink)', textDecoration: l.state === 'cancelled' ? 'line-through' : 'none' }}>
          {l.title}
        </span>
        {l.time && <span className="mono text-[12px]" dir="ltr" style={{ color: 'var(--ink)' }}>{l.time}</span>}
      </div>
      <div className="text-[12.5px] mt-1 leading-[1.6]" style={{ color: 'var(--text-soft)' }}>
        {[guest && l.lecturer ? `מרצה אורח: ${l.lecturer}` : l.lecturer, l.courseName, l.type,
          l.semester ? `סמ׳ ${l.semester}` : '', l.location].filter(Boolean).join(' · ')}
      </div>
      <span
        className="inline-block mono text-[10.5px] font-bold uppercase tracking-[0.1em] rounded-full px-2.5 py-1 mt-2"
        style={{ background: lectureColor(l.state), color: 'white' }}
      >
        {l.statusLabel}
      </span>
    </button>
  );
}

/**
 * The lecturer's existing details, attached to the lecture that names them.
 *
 * Rendered only when there is something real to show. A card that says "no details"
 * implies a record exists and is empty; nothing at all is the truthful state, and the
 * lecture row above still carries the name.
 */
function LecturerCard({ contact, onOpenTrainers }: { contact: LecturerContact | null; onOpenTrainers: () => void }) {
  if (!contact) return null;
  return (
    <div
      data-lecturer-card={contact.source}
      className="rounded-2xl mt-1.5 mr-3 p-3"
      style={{ border: '1px dashed var(--divider)', background: 'var(--accent-soft, transparent)' }}
    >
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
        <span className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>{contact.name}</span>
        <span className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-soft)' }}>
          {contact.source === 'trainer' ? 'מתוך כרטיס המנחים/מרצים' : 'מתוך פרטי ההרצאה'}
        </span>
      </div>
      {(contact.role || contact.organization) && (
        <div className="text-[12.5px] mb-2" style={{ color: 'var(--text-soft)' }}>
          {[contact.role, contact.organization].filter(Boolean).join(' · ')}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {contact.phone && (
          <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} data-lecturer-phone
            className="mono text-[12px] rounded-full px-3 inline-flex items-center gap-1.5"
            dir="ltr"
            style={{ minHeight: 44, border: '1px solid var(--divider)', color: 'var(--ink)', textDecoration: 'none' }}>
            📞 {contact.phone}
          </a>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} data-lecturer-email
            className="mono text-[12px] rounded-full px-3 inline-flex items-center gap-1.5"
            dir="ltr"
            style={{ minHeight: 44, border: '1px solid var(--divider)', color: 'var(--ink)', textDecoration: 'none' }}>
            ✉️ {contact.email}
          </a>
        )}
        {contact.source === 'trainer' && (
          <button type="button" onClick={onOpenTrainers} data-lecturer-open-record
            className="mono text-[12px] font-semibold rounded-full px-3"
            style={{ minHeight: 44, border: '1px solid var(--accent)', color: 'var(--accent)', background: 'transparent', cursor: 'pointer' }}>
            פתח כרטיס ←
          </button>
        )}
      </div>
    </div>
  );
}

function eventColor(type: string): string {
  switch (type) {
    case 'lecture': return '#7a1e2b';
    case 'interview': return '#0a6e44';
    case 'prep': return '#7a5a1e';
    case 'slot': return '#4a6b8a';  // calm blue — indicates availability
    default: return '#1a1612';
  }
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div className="mono text-[11px] uppercase tracking-[0.16em] font-medium mb-1" style={{ color: 'var(--text-soft)' }}>
        {label}
      </div>
      <div className="serif text-[30px] leading-none tracking-tight" style={{ color: color ?? 'var(--ink)' }}>
        {value}
      </div>
    </div>
  );
}

function ViewBtn({ children, onClick, active, testId }: { children: any; onClick: () => void; active: boolean; testId: string }) {
  return (
    <button
      onClick={onClick}
      data-view-btn={testId}
      aria-pressed={active}
      className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-4 rounded-full transition-colors"
      style={{
        minHeight: 44,
        color: active ? 'var(--bg)' : 'var(--ink)',
        background: active ? 'var(--accent)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}>
      {children}
    </button>
  );
}

function NavBtn({ children, onClick, primary }: { children: any; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick}
      className="mono text-[11.5px] uppercase tracking-[0.15em] font-semibold px-4 rounded-full border transition-colors"
      style={{
        minHeight: 44,
        color: primary ? 'var(--bg)' : 'var(--accent)',
        background: primary ? 'var(--accent)' : 'transparent',
        borderColor: 'var(--accent)',
      }}>
      {children}
    </button>
  );
}

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
  buildAcademicDayMap,
  buildAcademicMarkIndex,
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

/**
 * THE PRECEDENCE RULE — which layer paints a day of the month grid.
 *
 * A cell gets exactly one background. Most decisive first:
 *   1. THE ACADEMIC LAYER. The Ariel document's own fill for the day, exactly the one
 *      the poster uses (red for a simulation, else gold for a semester boundary or an
 *      exam window, else cream for a no-teaching day / special arrangement / make-up
 *      day). This is the layer he SCHEDULES against, so it outranks everything.
 *   2. TODAY's wine tint, when the academic layer says nothing about the day.
 *   3. The Jewish-holiday grey, when neither of the above applies.
 *
 * The grey and the academic fill therefore never fight: the grey was always a stand-in
 * for "the university is probably shut", and where the real dataset speaks — all of
 * תשפ״ז — the stand-in yields to it. Outside תשפ״ז the dataset is silent and the grey
 * is still the only signal there is, so it keeps drawing. The holiday's NAME renders in
 * the cell corner either way, so a day that is both is never mute about it.
 *
 * Today never loses its identity to this: its wine ring and its wine date badge are
 * drawn ON TOP of whatever fill won, so "today" and "exam period" can both be true.
 */
function cellBackground(fill: string | null, isToday: boolean, holiday: string | undefined): string {
  if (fill) return fill;
  if (isToday) return 'rgba(122, 30, 43, 0.1)';
  if (holiday) return 'rgba(26, 22, 18, 0.04)';
  return 'transparent';
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
  const academicMarks = useMemo(() => buildAcademicMarkIndex(academicDayMap), [academicDayMap]);
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
              const hasEvents = dayEvents.length > 0;
              const academic = academicDayMap.get(key) ?? [];
              const marks = academicMarks.get(key) ?? null;
              const fill = marks?.fill ?? null;
              /* A pale document fill forces black ink: gold and cream are light in BOTH
                 themes (they are the printed page's colours, not the app's), so every
                 glyph on a filled cell is re-inked here rather than left on var(--ink). */
              const onPaper = !!fill;
              const verdict = dayVerdict(academic);

              return (
                <div
                  key={i}
                  data-day-cell={key}
                  data-verdict={verdict}
                  data-lectures={lectureMarks.get(key)?.total ?? 0}
                  role="button"
                  tabIndex={0}
                  aria-label={`${longHebrewDate(key)}${hasEvents ? ` · ${dayEvents.length} אירועים` : ''}`}
                  onClick={() => setOpenDay(key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenDay(key); } }}
                  className="h-28 border-t border-l p-2 overflow-hidden flex flex-col gap-1 relative cursor-pointer"
                  style={{
                    borderColor: 'var(--divider)',
                    background: cellBackground(fill, isToday, holiday),
                    color: onPaper ? ARIEL_PAPER.ink : 'var(--ink)',
                    boxShadow: isToday ? 'inset 0 0 0 2px var(--accent)' : undefined,
                  }}
                >
                  <div className="flex items-baseline justify-between gap-1">
                    {isToday ? (
                      <span
                        className="serif text-[18px] leading-none rounded-full flex items-center justify-center shrink-0"
                        style={{ width: 30, height: 30, background: 'var(--accent)', color: onPaper ? '#fff' : 'var(--bg)' }}
                      >
                        {day}
                      </span>
                    ) : (
                      <span
                        className="serif leading-none shrink-0"
                        style={{
                          /* On a document fill the date is BLACK, as it is on the poster.
                             Wine on the simulation red is 3.06:1 — it scrapes past the
                             large-text floor and nothing more; black on the same red is
                             6.3:1. "This day has something" survives in the size and the
                             weight, and the chip under it still carries the colour. */
                          color: onPaper
                            ? ARIEL_PAPER.ink
                            : (hasEvents ? 'var(--accent)' : 'var(--ink)'),
                          fontSize: hasEvents ? '22px' : '20px',
                          fontWeight: hasEvents ? 700 : 400,
                        }}
                      >
                        {day}
                      </span>
                    )}
                    {holiday && (
                      <span className="mono text-[9px] uppercase tracking-[0.1em] truncate max-w-[70%]" title={holiday}
                        style={{ color: onPaper ? ARIEL_PAPER.muted : 'var(--text-soft)', opacity: onPaper ? 1 : 0.7 }}>
                        {holiday}
                      </span>
                    )}
                  </div>

                  {/* The academic layer's own course colours, as dots — the same marks the
                      poster draws, so a teaching day reads the same in both views. */}
                  {marks && marks.accents.length > 0 && (
                    <span className="flex gap-[3px] -mt-0.5" data-academic-accents>
                      {marks.accents.map((hex, n) => (
                        <span key={n} className="inline-block rounded-full"
                          style={{ width: 6, height: 6, background: hex, border: `0.5px solid ${ARIEL_PAPER.edge}` }} />
                      ))}
                    </span>
                  )}

                  {/* Inline preview — first 2 events. UNCHANGED in shape and ink; on a
                      filled cell the chip gets a near-white underlay so the wine / green /
                      blue / brown stays at full contrast instead of sinking into gold. */}
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {dayEvents.slice(0, 2).map(e => (
                      <span
                        key={e.id}
                        data-event-chip={e.type}
                        className="text-right text-[10.5px] truncate rounded px-1.5 py-0.5"
                        style={{
                          background: onPaper ? 'rgba(255,255,255,0.90)' : eventColor(e.type) + '22',
                          color: eventColor(e.type),
                          borderRight: `2px solid ${eventColor(e.type)}`,
                        }}
                      >
                        {e.title}
                      </span>
                    ))}
                    {dayEvents.length > 2 && (
                      <span className="text-[10px] mono tracking-[0.12em]"
                        style={{ color: onPaper ? ARIEL_PAPER.muted : 'var(--text-soft)' }}>
                        +{dayEvents.length - 2} נוספים
                      </span>
                    )}
                  </div>

                  {isToday && (
                    <span className="absolute bottom-1.5 right-2 mono text-[9px] uppercase tracking-[0.15em] font-bold"
                      style={{ color: onPaper ? ARIEL_PAPER.ink : 'var(--accent)' }}>היום</span>
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

        <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--text-soft)' }}>
          אירועים על הלוח
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-2.5 mb-6">
          {([['lecture', 'הרצאה'], ['interview', 'ראיון'], ['slot', 'מועד פנוי'], ['prep', 'הכנה']] as const).map(([t, label]) => (
            <li key={t} className="inline-flex items-center gap-2 text-[13.5px]" style={{ color: 'var(--ink)' }}>
              <span data-legend-swatch={t} className="inline-block rounded-full"
                style={{ width: 11, height: 11, background: eventColor(t) }} />
              {label}
            </li>
          ))}
        </ul>

        <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--text-soft)' }}>
          מצב ההרצאה — הטבעת והפסים בתצוגת השנה
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-2.5 mb-6">
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

        <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--text-soft)' }}>
          לוח אוניברסיטת אריאל — רקע התא
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-2.5">
          {ACADEMIC_CATEGORIES.map((c) => (
            <li key={c.key} className="inline-flex items-center gap-2 text-[13.5px]" style={{ color: 'var(--ink)' }}>
              <span
                data-legend-swatch={c.key}
                className="inline-block rounded-[3px]"
                style={{ width: 18, height: 14, background: c.swatch, border: `1px solid ${ARIEL_PAPER.edge}` }}
              />
              {c.label}
            </li>
          ))}
        </ul>

        <p className="mt-5 text-[12.5px] leading-[1.7]" data-precedence-note style={{ color: 'var(--text-soft)' }}>
          רקע התא הוא של הלוח האקדמי. חג יהודי מודגש ברקע אפור רק בימים שהלוח האקדמי שותק לגביהם —
          כלומר מחוץ לשנה״ל תשפ״ז; בתוכה הלוח של האוניברסיטה הוא הקובע, ושם החג ממשיך להופיע בפינת התא.
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

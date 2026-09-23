/**
 * לוח אקדמי — the academic year תשפ״ז with the lecture schedule drawn on it.
 *
 * Yariv 2026-09-23, on why this screen belongs in Practicum and not only in Maestro:
 *   "בפרקטיקום הייתי מציע שהלוח יכלול את לוח ההרצאות" · "שם הוא ממש חייב לחיות".
 *
 * The use case is narrow and the design follows from it. This is where guest lecturers
 * and simulations are SCHEDULED. Placing one means asking, about a specific date:
 * is the university open, is it inside an exam window, is it a make-up day running
 * another weekday's timetable — and what is already booked there. Every one of those is
 * answered on this screen, and the answer is followed immediately by the button that
 * books the date, because an answer that requires navigating somewhere else to act on
 * arrives too late.
 *
 * TWO LAYERS, and the distinction is the whole visual design:
 *   BACKGROUND — the university's year. The printed document's own palette (white
 *     paper, black ink, gold for semester boundaries and exam periods, cream for
 *     no-teaching days). Fixed hexes in both themes: a document does not repaint itself
 *     when the app goes dark.
 *   FOREGROUND — his lectures. Wine when approved, amber when not. Drawn ON the paper,
 *     never in it: a ring around the cell and a bar under the date, so a booked day is
 *     the first thing the eye lands on. "הרצאה היא הדבר שהוא מציב" — it reads as
 *     foreground because it is what he is moving.
 *
 * DATA: the academic year comes from src/lib/academicCalendar.ts (a verbatim copy of
 * the verified Maestro dataset); the lectures come from the app's existing snapshot,
 * handed down as page props exactly like every other screen. This file opens no
 * connection of its own.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PageProps } from './pageShared';
import { sameContext, normalizeYear } from './pageShared';
import type { Lecture } from '../lib/supabase';
import {
  ACADEMIC_CATEGORIES,
  ACADEMIC_GRID_FIRST_MONTH,
  ACADEMIC_WEEKDAY_LABELS,
  ARIEL_PAPER,
  DAY_VERDICT_LABEL,
  buildAcademicDayMap,
  buildAcademicMonths,
  academicItemsOutsideGrid,
  dayVerdict,
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
  undatedLectures,
  type LectureDayItem,
  type LectureDayMark,
} from '../lib/lectureCalendar';
import { saveLecture, deleteLecture } from '../lib/lectureSave';
import { showToast } from '../lib/toast';
import LectureEditor from './LectureEditor';

/* One-handed at 430px is a hard constraint, not a nicety: this is worked on a phone.
 * 430 − 32 (page gutter) − 12 (card padding) = 386 for seven columns ⇒ 55px each,
 * comfortably over the 44px minimum, and the cell is tall enough to carry the date,
 * the academic dots and the lecture bar without any of them shrinking below legible. */
const CELL_MIN = 52;

const HEB_MONTH_NAMES = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

/** "ג׳ · 8 בדצמבר 2026" — read out loud, which is how a date gets confirmed on a call. */
function longHebrewDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const wd = ACADEMIC_WEEKDAY_LABELS[d.getUTCDay()];
  return `${wd}׳ · ${d.getUTCDate()} ב${HEB_MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/**
 * Which month to open on.
 *
 * "Opening on the current month" is only meaningful while the current month is inside
 * the academic year. Built in September 2026 — one month BEFORE the year starts — so
 * the very first person to open this screen would have been sent to a month that does
 * not exist in the grid. Outside the window it opens on the first month instead, which
 * is also the right answer once the year has ended.
 */
export function initialMonthKey(months: AcademicMonth[], today = todayIso()): string {
  const key = today.slice(0, 7);
  return months.some((m) => m.key === key) ? key : (months[0]?.key ?? ACADEMIC_GRID_FIRST_MONTH);
}

export default function AcademicYearPage({ data, context, userName, onRefresh }: PageProps) {
  const today = todayIso();

  /* The academic year is static — derive it once, not on every render. */
  const academicDayMap = useMemo(() => buildAcademicDayMap(), []);
  const months = useMemo(() => buildAcademicMonths(academicDayMap), [academicDayMap]);
  const outside = useMemo(() => academicItemsOutsideGrid(), []);

  /**
   * WHICH LECTURES.
   *
   * The COURSE filter from the top bar is honoured — he teaches several and asking
   * "what is already booked" usually means within one of them.
   *
   * The YEAR filter deliberately is NOT: this screen IS a year (October 2026 →
   * September 2027 = תשפ״ז), and its twelve months are the year selector. Honouring a
   * top-bar year of תשפ״ו here would empty a grid whose own title says תשפ״ז — the
   * date window already does that filtering, correctly, by date. The subtitle says so
   * on screen rather than leaving it to be discovered.
   */
  const courses = data.courses || [];
  const yearFilterActive = context.year !== '__all__';
  const lectures = useMemo(() => {
    const all = data.lectures || [];
    return all.filter((l) => sameContext(l, { courseId: context.courseId, year: '__all__' }, courses));
  }, [data.lectures, context.courseId, courses]);

  const lectureDayMap = useMemo(() => buildLectureDayMap(lectures), [lectures]);
  const lectureMarks = useMemo(() => buildLectureMarkIndex(lectureDayMap), [lectureDayMap]);
  const conflicts = useMemo(
    () => findLectureConflicts(lectureDayMap, academicDayMap),
    [lectureDayMap, academicDayMap],
  );
  const undated = useMemo(() => undatedLectures(lectures), [lectures]);

  /** Only the lectures that actually land inside this year — the headline must count
   *  what is on screen, not what is in the database. */
  const inGrid = useMemo(() => {
    let approved = 0, pending = 0, cancelled = 0, total = 0;
    const from = months[0]?.key ?? '', to = months[months.length - 1]?.key ?? '';
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
  }, [lectureDayMap, months]);

  const [monthKey, setMonthKey] = useState(() => initialMonthKey(months, today));
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<Lecture | null>(null);
  const [creatingOn, setCreatingOn] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Only the all-twelve column registers here — the paper card above it is at a fixed
   *  place and needs no scroll target, and two writers under one key would race. */
  const monthRefs = useRef<Record<string, HTMLElement | null>>({});
  const allMonthsRef = useRef<HTMLDetailsElement | null>(null);

  /* ESC closes the day sheet — it is a modal surface and has to behave like one. */
  useEffect(() => {
    if (!openDay) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenDay(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openDay]);

  /**
   * A chip switches the month shown on the paper card. It scrolls ONLY when the
   * all-twelve column is open — the card sits directly under the chips, so scrolling to
   * it would be a jump to where the thumb already is, and when the column is closed its
   * month elements have no box to scroll to anyway.
   */
  function jumpTo(key: string) {
    setMonthKey(key);
    if (allMonthsRef.current?.open) {
      monthRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  const shownMonth = months.find((m) => m.key === monthKey) ?? months[0];

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
    <main className="max-w-[1200px] mx-auto px-4 md:px-10 pt-14 pb-28" data-academic-year-page>

      {/* ── Hero ── */}
      <section className="pt-4 pb-10 border-b mb-8" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-6">VII · לוח אקדמי</div>
        <h1 className="serif text-[30px] sm:text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>
          שנה״ל <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>תשפ״ז</em>
        </h1>
        <p className="text-[15px] sm:text-[17.5px] max-w-[640px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.85 }}>
          אוקטובר 2026 – ספטמבר 2027, עם לוח ההרצאות עליו. לחיצה על יום פותחת את מה שקורה בו
          ומאפשרת לקבוע בו הרצאה.
        </p>

        <div className="flex flex-wrap gap-x-8 gap-y-3 mt-8">
          <Stat label="הרצאות בשנה" value={inGrid.total} />
          <Stat label="מאושרות" value={inGrid.approved} color={lectureColor('approved')} />
          <Stat label="טרם אושרו" value={inGrid.pending} color={lectureColor('pending')} />
        </div>

        {/* What is NOT on screen, said out loud rather than left to be discovered. */}
        {(yearFilterActive || undated.length > 0 || context.courseId !== '__all__') && (
          <div className="mt-6 text-[12.5px] leading-[1.7]" style={{ color: 'var(--text-soft)' }}>
            {context.courseId !== '__all__' && <div data-scope-note>מסונן לקורס: <strong>{context.courseId}</strong></div>}
            {yearFilterActive && (
              <div data-year-note>
                מסנן השנה בסרגל העליון ({context.year}) אינו חל כאן — המסך כולו הוא שנה״ל תשפ״ז.
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
                  onClick={() => { jumpTo(c.iso.slice(0, 7)); setOpenDay(c.iso); }}
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

      {/* ── Jump chips. Wrapped, never a scrolling strip: a row the thumb has to drag
             sideways hides months, and this screen's whole job is that nothing is
             hidden. Two rows at 430px, one on a laptop. ── */}
      <nav className="flex flex-wrap gap-2 mb-6" aria-label="קפיצה לחודש">
        {months.map((m) => {
          const active = m.key === monthKey;
          return (
            <button
              key={m.key}
              data-month-chip={m.key}
              onClick={() => jumpTo(m.key)}
              className="mono text-[12px] font-semibold rounded-full px-3"
              style={{
                minHeight: 44, minWidth: 56,
                border: `1px solid ${active ? 'var(--accent)' : 'var(--divider)'}`,
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? 'white' : 'var(--ink)',
                cursor: 'pointer',
              }}
            >
              {m.shortLabel}
            </button>
          );
        })}
      </nav>

      {/* ── THE SHEET OF PAPER ─────────────────────────────────────────────────
           Fixed white/black in both themes. This is the university's printed table,
           reproduced; it does not follow the app's day/night switch. ── */}
      <section
        className="rounded-2xl mb-8"
        data-paper
        style={{
          background: ARIEL_PAPER.paper,
          color: ARIEL_PAPER.ink,
          border: `1px solid ${ARIEL_PAPER.edge}`,
          padding: '14px 6px 10px',
          boxShadow: '0 18px 48px rgba(0,0,0,0.10)',
        }}
      >
        {shownMonth && (
          <MonthGrid
            month={shownMonth}
            academicDayMap={academicDayMap}
            lectureMarks={lectureMarks}
            today={today}
            openDay={openDay}
            onOpenDay={setOpenDay}
          />
        )}
      </section>

      {/* ── All twelve, so the year is one object rather than twelve visits ── */}
      <details className="mb-10" data-all-months ref={allMonthsRef}>
        <summary
          className="mono text-[12px] uppercase tracking-[0.14em] font-semibold cursor-pointer select-none rounded-xl px-4 flex items-center"
          style={{ minHeight: 44, color: 'var(--accent)', border: '1px solid var(--divider)' }}
        >
          הצג את כל 12 החודשים ברצף
        </summary>
        <div className="flex flex-col gap-5 mt-5">
          {months.map((m) => (
            <div
              key={m.key}
              ref={(el) => { monthRefs.current[m.key] = el; }}
              className="rounded-2xl"
              style={{
                background: ARIEL_PAPER.paper,
                color: ARIEL_PAPER.ink,
                border: `1px solid ${ARIEL_PAPER.edge}`,
                padding: '14px 6px 10px',
                scrollMarginTop: 'calc(var(--header-h, 108px) + 12px)',
              }}
            >
              <MonthGrid
                month={m}
                academicDayMap={academicDayMap}
                lectureMarks={lectureMarks}
                today={today}
                openDay={openDay}
                onOpenDay={setOpenDay}
              />
            </div>
          ))}
        </div>
      </details>

      {/* ── Legend: every colour on the grid, named. ── */}
      <section className="mb-10" data-legend>
        <h2 className="serif text-[24px] tracking-tight mb-4 pb-3 border-b" style={{ color: 'var(--ink)', borderColor: 'var(--divider)' }}>
          מקרא
        </h2>

        <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--text-soft)' }}>
          הרצאות שלך
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
          לוח אוניברסיטת אריאל
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

        {outside.length > 0 && (
          <p className="mt-6 text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
            מחוץ לטווח הלוח: {outside.map((o) => `${o.title} (${o.date})`).join(' · ')}
          </p>
        )}
      </section>

      {/* ── The day sheet ── */}
      {openDay && (
        <DaySheet
          iso={openDay}
          academic={academicDayMap.get(openDay) ?? []}
          lectures={lectureDayMap.get(openDay) ?? []}
          onClose={() => setOpenDay(null)}
          onEditLecture={(l) => setEditing(l)}
          onAddLecture={() => setCreatingOn(openDay)}
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

/* ══════════════════════════ one month ════════════════════════════════════ */

function MonthGrid({
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

/* ══════════════════════════ the day sheet ════════════════════════════════ */

const VERDICT_STYLE: Record<string, { bg: string; border: string }> = {
  blocked: { bg: 'rgba(224,102,102,0.14)', border: 'rgba(224,102,102,0.65)' },
  caution: { bg: 'rgba(246,178,107,0.16)', border: 'rgba(246,178,107,0.75)' },
  open: { bg: 'rgba(147,196,125,0.16)', border: 'rgba(147,196,125,0.75)' },
};

function DaySheet({
  iso, academic, lectures, onClose, onEditLecture, onAddLecture,
}: {
  iso: string;
  academic: AcademicDayItem[];
  lectures: LectureDayItem[];
  onClose: () => void;
  onEditLecture: (l: Lecture) => void;
  onAddLecture: () => void;
}) {
  const report = daySchedulingReport(iso, academic, lectures);
  const verdict = dayVerdict(academic);
  const style = VERDICT_STYLE[verdict];

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

        {/* ── THE ANSWER. This is the reason the screen exists: whether a lecturer can
               be put here, said in words, before anything else on the sheet. ── */}
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

        {/* ── The lectures on this day — the foreground, so it comes first. ── */}
        <section className="mb-5">
          <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--text-soft)' }}>
            הרצאות ביום זה {lectures.length > 0 && `(${lectures.length})`}
          </div>
          {lectures.length === 0 ? (
            <div className="text-[13.5px] mb-3" style={{ color: 'var(--text-soft)' }}>אין הרצאות ביום זה.</div>
          ) : (
            <ul className="flex flex-col gap-2 mb-3">
              {lectures.map((l) => (
                <li key={l.id}>
                  <button
                    data-day-lecture={l.id}
                    data-lecture-state={l.state}
                    onClick={() => onEditLecture(l.lecture)}
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
                      {[l.lecturer, l.courseName, l.type, l.semester ? `סמ׳ ${l.semester}` : '', l.location]
                        .filter(Boolean).join(' · ')}
                    </div>
                    <span
                      className="inline-block mono text-[10.5px] font-bold uppercase tracking-[0.1em] rounded-full px-2.5 py-1 mt-2"
                      style={{ background: lectureColor(l.state), color: 'white' }}
                    >
                      {l.statusLabel}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* ── Book a date. The same editor the lectures screen opens, already on
                 this day. On a blocked day the button still works — Yariv is the one
                 who decides, and a make-up arrangement is a real thing — but it says
                 what it is doing. ── */}
          <button
            data-add-lecture={iso}
            onClick={onAddLecture}
            className="w-full rounded-full font-semibold text-[13.5px]"
            style={{
              minHeight: 48,
              background: report.blocked ? 'transparent' : 'var(--accent)',
              color: report.blocked ? 'var(--accent)' : 'white',
              border: `1px solid var(--accent)`,
              cursor: 'pointer',
            }}
          >
            {report.blocked ? '+ קבע הרצאה בכל זאת בתאריך זה' : '+ קבע הרצאה בתאריך זה'}
          </button>
        </section>

        {/* ── What the university says about this day. ── */}
        <section>
          <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2.5" style={{ color: 'var(--text-soft)' }}>
            לוח אקדמי
          </div>
          {academic.length === 0 ? (
            <div className="text-[13.5px]" style={{ color: 'var(--text-soft)' }}>אין רישום בלוח האקדמי ליום זה.</div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {academic.map((it, i) => (
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
      </div>
    </>
  );
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

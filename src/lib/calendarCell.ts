/**
 * What ONE day of the month grid says, decided in one place.
 *
 * Yariv 2026-10-02, after five rounds of mock-ups: Ariel's own printed calendar is the
 * model — white paper, two highlight colours, no clutter — with his courses as calm
 * tints and every status as a WORD, never a colour you have to remember:
 *
 *   "אם באדום כתוב להזיז אז עדיף שבירוק יהיה כתוב מאושר ובכתום לתאם"
 *
 * So the grammar is:
 *   THE FILL   is the kind of day. One of his three courses (a pale tint plus a strong
 *              edge, the course's full name written on it), אין לימודים (Ariel cream,
 *              with WHICH holiday written on it), or a בחינות window (Ariel gold, with
 *              מועד א׳ / מועד ב׳ — the distinction the old grid lost).
 *   ONE CHIP   at the bottom says what he must know or do: להזיז (red), לתאם / לא אושר
 *              (orange), מאושר (green). A day carries at most one on the phone; the
 *              desktop stacks them.
 *   A RED RING means a class or a guest lecture stands on a day nothing can happen on.
 *
 * "לתאם" is a LEAD-TIME notion, not a same-day one — "לתאם יום לפני שזה קורה הוא לא
 * רלוונטי". A guest lecture that is not approved yet raises its לתאם fourteen days
 * before it; once that day has passed the reminder rides on TODAY until it is marked
 * done, so it cannot scroll out of sight. Marking it lives in `data.calendarDone`.
 *
 * Pure: no React, no clock (today is passed in), so unit/calendar-cell.spec.ts can pin
 * every rule against the real academic dataset.
 */

import {
  addDays,
  dayBlockers,
  isTeachingSession,
  type AcademicDayItem,
} from './academicCalendar';
import type { LectureDayItem } from './lectureCalendar';
import type { Lecture } from './supabase';

/* ── His three courses ─────────────────────────────────────────────────────────── */

export type CourseKind = 'skills' | 'hr' | 'consult';

/**
 * The dataset's course keys (skA/skB, semA/semB, prA/prB) mapped to the names he uses.
 * Confirmed by Yariv 2026-10-02: the "סמינריון פרקטיקום במשאבי אנוש" sessions are
 * פרקטיקום מש״א, the MA "פרקטיקום (סוציולוגיה ואנתרופולוגיה)" ones are פרקטיקום ייעוץ.
 * מיומנויות א׳ and ב׳ share one colour — they never meet in the same semester.
 */
export const COURSE_STYLE: Record<CourseKind, { label: string; tint: string; strong: string }> = {
  skills: { label: 'מיומנויות ייעוץ', tint: '#DCEAF7', strong: '#2B78C2' },
  hr: { label: 'פרקטיקום מש״א', tint: '#DDEFD9', strong: '#3F8F4A' },
  consult: { label: 'פרקטיקום ייעוץ', tint: '#E8E0F3', strong: '#5B3A8E' },
};

export function courseKindOf(course: string | null | undefined): CourseKind | null {
  const c = (course || '').trim();
  if (c.startsWith('sk')) return 'skills';
  if (c.startsWith('sem')) return 'hr';
  if (c.startsWith('pr')) return 'consult';
  return null;
}

/* ── Ariel's two highlights ────────────────────────────────────────────────────── */

export const DAY_FILL = {
  /** אין לימודים — the printed calendar's cream. */
  off: '#FFF2CC',
  /** מועדי בחינות and the semester edges — the printed calendar's gold. */
  exam: '#FFD966',
} as const;

/* ── The chips ─────────────────────────────────────────────────────────────────── */

export type ChipKind = 'move' | 'todo' | 'notApproved' | 'approved' | 'interview' | 'slot' | 'prep';

export const CHIP_STYLE: Record<ChipKind, { bg: string; fg: string; text: string }> = {
  move: { bg: '#D32F2F', fg: '#FFFFFF', text: 'להזיז' },
  todo: { bg: '#F28C28', fg: '#1A1A1A', text: 'לתאם' },
  notApproved: { bg: '#F28C28', fg: '#1A1A1A', text: 'ממתין' },
  approved: { bg: '#2E7D32', fg: '#FFFFFF', text: 'מאושר' },
  interview: { bg: '#E6E1DC', fg: '#2A2422', text: 'ראיון' },
  slot: { bg: '#E6E1DC', fg: '#2A2422', text: 'פנוי' },
  prep: { bg: '#E6E1DC', fg: '#2A2422', text: 'הכנה' },
};

/** Most urgent first — the phone shows only the first. */
const CHIP_ORDER: ChipKind[] = ['move', 'todo', 'notApproved', 'approved', 'interview', 'slot', 'prep'];

export interface CellChip {
  kind: ChipKind;
  /** The word on the chip. */
  text: string;
  /** What it is about, for the desktop chip and the aria-label. */
  detail: string | null;
}

/* ── Labels for a day nothing happens on ───────────────────────────────────────── */

/**
 * "חופשת חנוכה — אין לימודים" → "חופשת חנוכה". He asked for the KIND of day by name:
 * "חופשת בחירות, חופשת סמסטר, חופשת יום העצמאות וכו׳".
 */
export function offDayLabel(title: string): string {
  const t = title || '';
  const rules: [RegExp, string][] = [
    [/בחירות/, 'חופשת בחירות'],
    [/חנוכה/, 'חופשת חנוכה'],
    [/פורים|תענית אסתר/, 'חופשת פורים'],
    [/פסח/, 'חופשת פסח'],
    [/העצמאות/, 'חופשת יום העצמאות'],
    [/הסטודנט/, 'יום הסטודנט'],
    [/שבועות/, 'חופשת שבועות'],
    [/תשעה באב/, 'צום ט׳ באב'],
    [/סמסטר/, 'חופשת סמסטר'],
  ];
  for (const [re, label] of rules) if (re.test(t)) return label;
  return t.split('—')[0].split('(')[0].trim() || 'אין לימודים';
}

export function examLabel(title: string): string {
  if (/מועד א/.test(title)) return 'מועד א׳';
  if (/מועד ב/.test(title)) return 'מועד ב׳';
  return 'בחינות';
}

/* ── לתאם ─────────────────────────────────────────────────────────────────────── */

/** How far ahead a guest lecture that is not approved yet asks to be chased. */
export const TODO_LEAD_DAYS = 14;

export interface TodoItem {
  /** Stable key into `data.calendarDone`. */
  key: string;
  /** The day the chip is drawn on. */
  showOn: string;
  /** The day the thing itself happens, when known. */
  eventIso: string | null;
  /** One sentence: WHAT has to be coordinated. */
  what: string;
  source: 'academic' | 'lecture';
  lecture?: Lecture;
}

export type DoneMark = { status: 'done' | 'not_needed'; by: string; at: string };
export type DoneMap = Record<string, DoneMark>;

export function academicTodoKey(iso: string, title: string): string {
  return `acad:${iso}:${title}`;
}
export function lectureTodoKey(lectureId: string): string {
  return `lec:${lectureId}`;
}

function ddmm(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}`;
}

/**
 * Every לתאם, open AND done (the day sheet shows both so a mark can be undone), keyed by
 * the day its chip is drawn on.
 *   · the academic dataset's own reminders (kind reminder / makeup_todo) — on their date;
 *   · a guest lecture still pending — TODO_LEAD_DAYS before it, or on today once that
 *     date has passed and the lecture is still ahead. Past lectures raise nothing.
 */
export function buildTodoMap(
  academicDayMap: Map<string, AcademicDayItem[]>,
  lectureDayMap: Map<string, LectureDayItem[]>,
  today: string,
): Map<string, TodoItem[]> {
  const out = new Map<string, TodoItem[]>();
  const push = (t: TodoItem) => {
    const list = out.get(t.showOn);
    if (list) list.push(t); else out.set(t.showOn, [t]);
  };
  for (const [iso, items] of academicDayMap) {
    for (const it of items) {
      if (it.kind !== 'reminder' && it.kind !== 'makeup_todo') continue;
      push({
        key: academicTodoKey(iso, it.title),
        showOn: iso,
        eventIso: null,
        what: it.title.replace(/^⚠️?\s*/, ''),
        source: 'academic',
      });
    }
  }
  for (const [iso, items] of lectureDayMap) {
    if (iso < today) continue;
    for (const l of items) {
      if (l.state !== 'pending') continue;
      const lead = addDays(iso, -TODO_LEAD_DAYS);
      const who = l.lecturer ? `מ${l.lecturer}` : '';
      push({
        key: lectureTodoKey(l.id),
        showOn: lead < today ? today : lead,
        eventIso: iso,
        what: `לקבל אישור ${who} להרצאה ב-${ddmm(iso)}${l.title ? ` (${l.title})` : ''}`.replace(/\s+/g, ' ').trim(),
        source: 'lecture',
        lecture: l.lecture,
      });
    }
  }
  return out;
}

/* ── The cell ─────────────────────────────────────────────────────────────────── */

export interface CellModel {
  fill: 'course' | 'off' | 'exam' | 'none';
  /** The words written in the cell under the date: a course, a holiday, a מועד. */
  label: string | null;
  course: CourseKind | null;
  /** A simulation session — drawn with 🎭. */
  simulation: boolean;
  /** First / last day of a semester — Ariel's gold, as a line along the top. */
  semesterEdge: boolean;
  /** ⏱ a special arrangement (shorter day), ↻ a make-up day (another weekday's timetable). */
  special: '⏱' | '↻' | null;
  /** A class or guest lecture on a day nothing can happen on. */
  conflict: boolean;
  chips: CellChip[];
}

export function cellModel(input: {
  academic: AcademicDayItem[];
  lectures: LectureDayItem[];
  todos: TodoItem[];
  done: DoneMap;
  other: { type: 'interview' | 'slot' | 'prep'; title: string }[];
  /** A Jewish holiday name for days outside the academic dataset. */
  holiday?: string;
}): CellModel {
  const { academic, lectures, todos, done, other, holiday } = input;

  const blockers = dayBlockers(academic);
  const shut = blockers.some((b) => b.level === 'blocked');
  const offItem = academic.find((a) => a.category === 'off' || a.category === 'away');
  const examItem = academic.find((a) => a.category === 'exam');
  const sessions = academic.filter(isTeachingSession);
  const session = sessions[0] ?? null;
  const live = lectures.filter((l) => l.state !== 'cancelled');

  let fill: CellModel['fill'] = 'none';
  let label: string | null = null;
  let course: CourseKind | null = null;
  if (offItem) { fill = 'off'; label = offItem.category === 'away' ? offItem.title : offDayLabel(offItem.title); }
  else if (examItem) { fill = 'exam'; label = examLabel(examItem.title); }
  else if (holiday && !session) { fill = 'off'; label = holiday; }
  if (fill === 'none' && session) {
    course = courseKindOf(session.course);
    if (course) { fill = 'course'; label = COURSE_STYLE[course].label; }
  }

  const conflict = (shut || fill === 'off') && (sessions.length > 0 || live.length > 0);

  const chips: CellChip[] = [];
  if (conflict) {
    const what = [
      ...sessions.map((s) => COURSE_STYLE[courseKindOf(s.course) ?? 'skills']?.label ?? s.title),
      ...live.map((l) => l.title),
    ].join(' · ');
    chips.push({ kind: 'move', text: CHIP_STYLE.move.text, detail: what || null });
  }
  for (const t of todos) {
    if (done[t.key]) continue;
    chips.push({ kind: 'todo', text: CHIP_STYLE.todo.text, detail: t.what });
  }
  if (!conflict) {
    for (const l of live) {
      const kind: ChipKind = l.state === 'approved' ? 'approved' : 'notApproved';
      chips.push({ kind, text: CHIP_STYLE[kind].text, detail: [l.time?.split('–')[0], l.title].filter(Boolean).join(' ') });
    }
  }
  for (const o of other) chips.push({ kind: o.type, text: CHIP_STYLE[o.type].text, detail: o.title });
  chips.sort((a, b) => CHIP_ORDER.indexOf(a.kind) - CHIP_ORDER.indexOf(b.kind));

  const special = academic.some((a) => a.category === 'makeup_day')
    ? '↻'
    : academic.some((a) => a.category === 'special') ? '⏱' : null;

  return {
    fill,
    label,
    course,
    simulation: sessions.some((s) => s.category === 'simulation'),
    semesterEdge: academic.some((a) => a.category === 'boundary'),
    special,
    conflict,
    chips,
  };
}

/** Teaching sessions standing on a day the calendar shuts — the class has to move. */
export function sessionConflicts(
  academicDayMap: Map<string, AcademicDayItem[]>,
): { iso: string; title: string; reason: string }[] {
  const out: { iso: string; title: string; reason: string }[] = [];
  for (const [iso, items] of academicDayMap) {
    const blocked = dayBlockers(items).find((b) => b.level === 'blocked');
    if (!blocked) continue;
    for (const s of items.filter(isTeachingSession)) {
      const kind = courseKindOf(s.course);
      out.push({
        iso,
        title: `${kind ? COURSE_STYLE[kind].label : s.title}${s.time ? ` ${s.time}` : ''}`,
        reason: blocked.reason,
      });
    }
  }
  return out.sort((a, b) => a.iso.localeCompare(b.iso));
}

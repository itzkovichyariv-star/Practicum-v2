/**
 * Ariel University academic year תשפ״ז (October 2026 → September 2027), as data.
 *
 * WHY THIS LIVES IN PRACTICUM (Yariv 2026-09-23):
 *   "בפרקטיקום הייתי מציע שהלוח יכלול את לוח ההרצאות" — and earlier, about this app
 *   specifically, "שם הוא ממש חייב לחיות". Practicum is where guest lecturers and
 *   simulations get SCHEDULED. Placing one means answering, at a glance, "is that date
 *   a holiday / an exam period / a make-up day?" — which is a question about the
 *   university's calendar, asked while looking at the lecture list. The two have to be
 *   on the same screen or the answer arrives after the email has gone out.
 *
 * WHERE THE DATA CAME FROM — and what was deliberately NOT done:
 *   academic-calendar-2026-27.json is copied VERBATIM from the Maestro repo
 *   (~/Code/family-tasks/src/lib/academic-calendar-2026-27.json), where it was derived
 *   from the university's published PDF and Yariv's own Google calendar and then
 *   verified. Nothing here re-derives a date or a colour: every event carries its own
 *   `category`, `category_label` and `hex`, and all three are used as given. If the
 *   university publishes תשפ״ח, the fix is a new JSON — not an edit to this file.
 *
 * THE COLOURS ARE THE DOCUMENT'S, NOT THE APP'S:
 *   ARIEL_PAPER below was measured off page 1 of the official scan — white paper, black
 *   ink, a gold highlight for semester boundaries and exam windows, a cream one for
 *   no-teaching days and special arrangements. These are FIXED hex values, never theme
 *   tokens, in both light and dark mode: a printed document does not repaint itself
 *   when the app goes dark, and Yariv rejected a first cut that tried.
 *
 * The helpers (buildAcademicDayMap / academicMarksFor / buildAcademicMarkIndex /
 * buildAcademicMonths) are ported from the Maestro module of the same name so the two
 * apps can never disagree about what is on a day.
 */

import rawCalendar from './academic-calendar-2026-27.json' with { type: 'json' };

/** A category row from the JSON: [label, google colour id, hex]. */
type RawCategory = [string, string, string];

export interface AcademicCategory {
  key: string;
  label: string;
  /** The colour the export gave it (Yariv's Google calendar). */
  hex: string;
  /** How it is drawn on the paper card. */
  treatment: AcademicPaperTreatment;
  /** The colour the grid ACTUALLY shows for it — so the legend cannot lie. */
  swatch: string;
}

export interface AcademicRawEvent {
  kind: 'academic' | 'session' | 'makeup_todo' | 'reminder';
  title: string;
  category: string;
  category_label: string;
  hex: string;
  note?: string;
  all_day?: boolean;
  date?: string;
  start_date?: string;
  end_date?: string;
  start?: string;
  end?: string;
  n?: number;
  course?: string;
  course_title?: string;
  code?: string;
}

/** One thing happening on one day, already formatted for the day panel. */
export interface AcademicDayItem {
  kind: AcademicRawEvent['kind'];
  title: string;
  category: string;
  categoryLabel: string;
  hex: string;
  /** "19:00–21:00" for a timed session, null for an all-day item. */
  time: string | null;
  /** Session number (מפגש N) when the item is a course session. */
  session: number | null;
  /** The dataset's own course key — semA / skA / prA / semB / skB / prB. */
  course: string | null;
  courseTitle: string | null;
  /** The university's course code, e.g. "2-1891410-1". */
  code: string | null;
  note: string | null;
}

/**
 * Is this item TEACHING — a class of his that actually meets on that day?
 *
 * Yariv 2026-09-23: "הקשה עליו צריכה להראות גם אם יש לימודים וקורס מסויים". The
 * dataset draws the distinction itself: `kind: 'session'` rows are the 52 course
 * meetings (סמינריון / מיומנויות / פרקטיקום, simulations included — a simulation IS the
 * class, moved to another hour); every other kind describes the university's year
 * around them (holidays, exam windows, semester boundaries, reminders).
 */
export function isTeachingSession(item: AcademicDayItem): boolean {
  return item.kind === 'session';
}

export interface AcademicMonth {
  /** "2026-10" — also the DOM id suffix and the jump chip's target. */
  key: string;
  /** "אוקטובר 2026" */
  label: string;
  /** "אוק׳" — the short form on the jump chips. */
  shortLabel: string;
  cells: AcademicDayCell[];
}

export interface AcademicDayCell extends AcademicMarks {
  iso: string;
  day: number;
  inMonth: boolean;
}

/** The academic year the grid renders: October 2026 → September 2027. */
export const ACADEMIC_GRID_FIRST_MONTH = '2026-10';
export const ACADEMIC_GRID_MONTHS = 12;

/** Israeli convention — Sunday first, same as the app's existing month grid. */
export const ACADEMIC_WEEKDAY_LABELS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

/**
 * Which category paints a day that carries several. Most decisive first: a day OFF
 * defines the day; then the semester boundary and a make-up day; then teaching
 * (simulation first — it is the one that moves a class); then background states.
 * Every other category on the day still shows, so nothing is hidden.
 */
export const ACADEMIC_CATEGORY_PRIORITY = [
  'off', 'boundary', 'makeup_day', 'simulation', 'skills', 'practicum', 'seminar', 'todo', 'exam', 'special',
];

/**
 * THE PRINTED DOCUMENT'S OWN PALETTE, measured off page 1 of the official scan.
 * Fixed values in BOTH themes — see the file header.
 */
export const ARIEL_PAPER = {
  paper: '#FFFFFF',
  ink: '#000000',
  /** The strong highlight rows: semester boundaries and exam periods. */
  gold: '#FFD966',
  /** The softer highlight rows: no-teaching days, arrangements, make-up days. */
  cream: '#FFF2CC',
  /** Table rules / hairlines, as ink at low alpha. */
  rule: 'rgba(0, 0, 0, 0.20)',
  edge: 'rgba(0, 0, 0, 0.32)',
  muted: 'rgba(0, 0, 0, 0.58)',
};

/** Ink printed ON any of the document's fills — black, like the document. */
export const ACADEMIC_ON_COLOR_INK = ARIEL_PAPER.ink;
/** Hairline around a swatch so a pale colour stays visible on paper. */
export const ACADEMIC_DOT_EDGE = ARIEL_PAPER.edge;

/**
 * How each category is drawn ON THE PAPER:
 *   gold   — the document's strong highlights (תחילת/סיום סמסטר, מועדי בחינות)
 *   cream  — its softer ones (אין לימודים, הסדר מיוחד, יום השלמה)
 *   red    — a simulation: it moves a class to another hour, so it stands out
 *   accent — teaching and to-dos: the cell stays paper white and the course colour
 *            appears as a bar under the date.
 */
export type AcademicPaperTreatment = 'gold' | 'cream' | 'red' | 'accent';
export const ACADEMIC_PAPER_TREATMENT: Record<string, AcademicPaperTreatment> = {
  boundary: 'gold',
  exam: 'gold',
  off: 'cream',
  special: 'cream',
  makeup_day: 'cream',
  simulation: 'red',
  skills: 'accent',
  practicum: 'accent',
  seminar: 'accent',
  todo: 'accent',
};
/** A filled day wins in this order — a simulation is never hidden by a holiday. */
const FILL_ORDER: AcademicPaperTreatment[] = ['red', 'gold', 'cream'];

export function paperSwatch(key: string, hex: string): string {
  const treatment = ACADEMIC_PAPER_TREATMENT[key] ?? 'accent';
  if (treatment === 'gold') return ARIEL_PAPER.gold;
  if (treatment === 'cream') return ARIEL_PAPER.cream;
  return hex;     // the export's own red, or the course colour drawn as a bar
}

/* The JSON is data, not a schema: TypeScript widens its tuples to string[] and its
 * heterogeneous event rows to a union, so both are asserted here — once, at the only
 * boundary where the file is read — rather than at every call site. The shapes are
 * pinned by unit/academic-calendar.spec.ts, which checks the real file rather than
 * these declarations. */
export const ACADEMIC_CATEGORIES: AcademicCategory[] = Object.entries(
  rawCalendar.categories as unknown as Record<string, RawCategory>,
)
  .map(([key, [label, , hex]]) => ({
    key,
    label,
    hex,
    treatment: ACADEMIC_PAPER_TREATMENT[key] ?? 'accent',
    swatch: paperSwatch(key, hex),
  }))
  .sort((a, b) => ACADEMIC_CATEGORY_PRIORITY.indexOf(a.key) - ACADEMIC_CATEGORY_PRIORITY.indexOf(b.key));

const CATEGORY_BY_KEY = new Map(ACADEMIC_CATEGORIES.map((c) => [c.key, c]));

export const ACADEMIC_EVENTS = rawCalendar.events as AcademicRawEvent[];

// ── date helpers — UTC arithmetic only, so no timezone can shift a date ──────
function isoOf(y: number, m0: number, d: number): string {
  return new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();   // 0 = Sunday
}

function formatItem(e: AcademicRawEvent): AcademicDayItem {
  return {
    kind: e.kind,
    title: e.title,
    category: e.category,
    categoryLabel: e.category_label,
    hex: e.hex,
    time: e.start && e.end ? `${e.start}–${e.end}` : null,
    session: typeof e.n === 'number' ? e.n : null,
    course: e.course ?? null,
    courseTitle: e.course_title ?? null,
    code: e.code ?? null,
    note: e.note ? e.note : null,
  };
}

/* ── Which of HIS courses a top-bar course filter means, over THIS dataset ──────
 *
 * The two vocabularies are different on purpose. The top bar filters by the app's own
 * courses (`data.courses[].name`, e.g. "פרקטיקום משאבי אנוש"); this dataset names the
 * university's, by key and title ("skA" → "מיומנויות ייעוציות — חלק א׳"). Nothing
 * guarantees they overlap, so the filter is resolved rather than assumed: a selection
 * that matches no academic course leaves the academic layer UNFILTERED and says so,
 * because filtering teaching down to nothing would read as "no class that day" — the
 * exact wrong answer on the screen whose job is to say whether a date is free.
 */

/** Trim, drop the Hebrew geresh/gershayim and punctuation, collapse spaces, case-fold. */
export function normalizeName(s: string): string {
  return String(s || '')
    .replace(/[׳״'"׳״]/g, '')
    .replace(/[-–—_.,:;()[\]/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** key → title, for every course the dataset actually schedules. */
export const ACADEMIC_COURSE_TITLES: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const e of ACADEMIC_EVENTS) {
    if (e.kind === 'session' && e.course && e.course_title) m.set(e.course, e.course_title);
  }
  return m;
})();

/** The academic course keys a given course NAME refers to. Empty = no overlap. */
export function academicCourseKeysFor(courseName: string): string[] {
  const needle = normalizeName(courseName);
  if (needle.length < 3) return [];
  const out: string[] = [];
  for (const [key, title] of ACADEMIC_COURSE_TITLES) {
    const hay = normalizeName(title);
    if (hay === needle || hay.includes(needle) || needle.includes(hay)) out.push(key);
  }
  return out;
}

/** How one day is MARKED: the document's fill, the course bars, the categories, the count. */
export interface AcademicMarks {
  categories: string[];
  paint: AcademicCategory | null;
  fill: string | null;
  accents: string[];
  count: number;
}

export function academicMarksFor(items: AcademicDayItem[]): AcademicMarks {
  const categories = [...new Set(items.map((it) => it.category))]
    .sort((a, b) => ACADEMIC_CATEGORY_PRIORITY.indexOf(a) - ACADEMIC_CATEGORY_PRIORITY.indexOf(b));
  const treatments = categories.map((k) => CATEGORY_BY_KEY.get(k)).filter(Boolean) as AcademicCategory[];
  const filler = FILL_ORDER.map((t) => treatments.find((c) => c.treatment === t)).find(Boolean);
  return {
    categories,
    paint: treatments[0] ?? null,
    fill: filler ? filler.swatch : null,
    accents: treatments.filter((c) => c.treatment === 'accent').slice(0, 3).map((c) => c.hex),
    count: items.length,
  };
}

/** date → its marks, for every day of the academic year. */
export function buildAcademicMarkIndex(
  dayMap: Map<string, AcademicDayItem[]> = buildAcademicDayMap(),
): Map<string, AcademicMarks> {
  const out = new Map<string, AcademicMarks>();
  for (const [iso, items] of dayMap) out.set(iso, academicMarksFor(items));
  return out;
}

/** The grid's window: first day of the first month → last day of the last. */
export function academicGridRange(): { from: string; to: string } {
  const [y, m] = ACADEMIC_GRID_FIRST_MONTH.split('-').map(Number);
  const from = isoOf(y, m - 1, 1);
  const end = new Date(Date.UTC(y, m - 1 + ACADEMIC_GRID_MONTHS, 0));
  return { from, to: end.toISOString().slice(0, 10) };
}

/**
 * date → everything on it. Multi-day academic events (a holiday, an exam period) are
 * expanded across every day they cover — that is what makes the exam window and
 * חופשת פסח read as blocks on the grid, and it is what lets a lecture placed anywhere
 * inside one of them be flagged.
 */
export function buildAcademicDayMap(
  events: AcademicRawEvent[] = ACADEMIC_EVENTS,
): Map<string, AcademicDayItem[]> {
  const map = new Map<string, AcademicDayItem[]>();
  const push = (iso: string, e: AcademicRawEvent) => {
    const list = map.get(iso);
    if (list) list.push(formatItem(e));
    else map.set(iso, [formatItem(e)]);
  };
  for (const e of events) {
    if (e.kind === 'academic' && e.start_date && e.end_date) {
      for (let iso = e.start_date; iso <= e.end_date; iso = addDays(iso, 1)) push(iso, e);
    } else if (e.date) {
      push(e.date, e);
    }
  }
  // Inside a day: timed sessions in clock order, all-day items first.
  for (const list of map.values()) {
    list.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  }
  return map;
}

/** Events OUTSIDE the 12-month window — surfaced as a footnote rather than dropped. */
export function academicItemsOutsideGrid(
  events: AcademicRawEvent[] = ACADEMIC_EVENTS,
): { date: string; title: string }[] {
  const { from, to } = academicGridRange();
  const out: { date: string; title: string }[] = [];
  for (const e of events) {
    const start = e.date ?? e.start_date;
    const end = e.date ?? e.end_date ?? start;
    if (!start || !end) continue;
    if (end < from || start > to) out.push({ date: start, title: e.title });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The 12 months, each padded to whole Sunday-first weeks. */
export function buildAcademicMonths(
  dayMap: Map<string, AcademicDayItem[]> = buildAcademicDayMap(),
): AcademicMonth[] {
  const [y0, m0] = ACADEMIC_GRID_FIRST_MONTH.split('-').map(Number);
  const longFmt = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const shortFmt = new Intl.DateTimeFormat('he-IL', { month: 'short', timeZone: 'UTC' });
  const months: AcademicMonth[] = [];
  for (let i = 0; i < ACADEMIC_GRID_MONTHS; i++) {
    const y = y0 + Math.floor((m0 - 1 + i) / 12);
    const m = (m0 - 1 + i) % 12;                       // 0-based month
    const first = isoOf(y, m, 1);
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const lead = weekdayOf(first);                     // Sunday-first padding
    const cells: AcademicDayCell[] = [];
    const total = Math.ceil((lead + daysInMonth) / 7) * 7;
    for (let c = 0; c < total; c++) {
      const iso = addDays(first, c - lead);
      const inMonth = c >= lead && c < lead + daysInMonth;
      const items = inMonth ? dayMap.get(iso) ?? [] : [];
      cells.push({ ...academicMarksFor(items), iso, day: Number(iso.slice(8)), inMonth });
    }
    months.push({
      key: `${y}-${String(m + 1).padStart(2, '0')}`,
      label: longFmt.format(new Date(Date.UTC(y, m, 1))),
      shortLabel: shortFmt.format(new Date(Date.UTC(y, m, 1))),
      cells,
    });
  }
  return months;
}

/** Today, as a local ISO date — never `toISOString()`, which would shift it before 02:00. */
export function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/**
 * Which month the year poster opens on.
 *
 * "The month that was on screen" is only meaningful while that month is inside the
 * academic year. The month view navigates to any month there is — September 2026 is one
 * month BEFORE the year starts — so outside the window it opens on the first month
 * instead, which is also the right answer once the year has ended.
 */
export function initialMonthKey(months: AcademicMonth[], today = todayIso()): string {
  const key = today.slice(0, 7);
  return months.some((m) => m.key === key) ? key : (months[0]?.key ?? ACADEMIC_GRID_FIRST_MONTH);
}

/* ═════════════════ §SCHEDULING — the reason this screen exists ══════════════
 *
 * Everything above describes the year. This describes whether Yariv can put a guest
 * lecturer on a given day, which is the only question he actually opens this screen to
 * ask. It is deliberately NOT a boolean: "the university is shut" and "the class ends
 * at 18:30 that evening" are different answers, and the second one only matters if the
 * lecture he is placing runs late.
 */

/** How badly a day resists being scheduled on. */
export type DayVerdict = 'blocked' | 'caution' | 'open';

export interface DayBlocker {
  /** 'blocked' items make the day unusable; 'caution' items constrain it. */
  level: Exclude<DayVerdict, 'open'>;
  /** The academic category that produced it. */
  category: string;
  /** What to say, in Hebrew, on the day panel. */
  reason: string;
}

/**
 * The categories that make a day UNUSABLE for a guest lecture:
 *   off  — the university is closed. Nothing can be scheduled.
 *   exam — a 4-to-5-week examination window. A guest lecture inside one is a mistake
 *          that only shows up when nobody comes.
 * `makeup_day` is deliberately NOT blocked: it IS a teaching day, just running another
 * weekday's timetable — but it is the single easiest day to get wrong, so it warns.
 */
const BLOCKING_CATEGORIES = new Set(['off', 'exam']);
const CAUTION_CATEGORIES = new Set(['makeup_day', 'special', 'boundary']);

/**
 * Why this day is a bad idea, worst first. Empty = nothing in the university's calendar
 * objects to it.
 *
 * Each reason quotes the calendar's OWN title (e.g. "חופשת פסח", "מועדי בחינות סמסטר א׳
 * — מועד א׳"), because a generic "holiday" tells him nothing he can act on, while the
 * real title tells him how long it lasts and what to move it past.
 */
export function dayBlockers(items: AcademicDayItem[]): DayBlocker[] {
  const out: DayBlocker[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.category)) continue;
    if (BLOCKING_CATEGORIES.has(it.category)) {
      seen.add(it.category);
      out.push({
        level: 'blocked',
        category: it.category,
        reason: it.category === 'off'
          ? `אין לימודים — ${it.title}`
          : `תקופת בחינות — ${it.title}`,
      });
    } else if (CAUTION_CATEGORIES.has(it.category)) {
      seen.add(it.category);
      out.push({
        level: 'caution',
        category: it.category,
        reason: it.category === 'makeup_day'
          ? `${it.title} — הלימודים מתקיימים במתכונת של יום אחר`
          : it.category === 'boundary'
            ? `${it.title} — קצה הסמסטר`
            : it.title,
      });
    }
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'blocked' ? -1 : 1));
}

/** One word for the day, from its blockers. */
export function dayVerdict(items: AcademicDayItem[]): DayVerdict {
  const blockers = dayBlockers(items);
  if (blockers.some((b) => b.level === 'blocked')) return 'blocked';
  if (blockers.length) return 'caution';
  return 'open';
}

/** The verdict, in the words shown at the top of the day panel. */
export const DAY_VERDICT_LABEL: Record<DayVerdict, string> = {
  blocked: 'לא מתאים לקביעת הרצאה',
  caution: 'אפשרי — אבל שים לב',
  open: 'מתאים לקביעת הרצאה',
};

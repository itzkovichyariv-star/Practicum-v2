import { test, expect } from '@playwright/test';
import {
  ACADEMIC_CATEGORIES,
  ARIEL_PAPER,
  academicMarksFor,
  buildAcademicDayMap,
  buildAcademicMarkIndex,
  buildAcademicMonths,
  dayBlockers,
  dayVerdict,
  type AcademicDayItem,
} from '../src/lib/academicCalendar';
import {
  buildLectureDayMap,
  buildLectureMarkIndex,
  daySchedulingReport,
  findLectureConflicts,
  lectureIso,
  lectureState,
  lectureMarksFor,
  undatedLectures,
} from '../src/lib/lectureCalendar';
import { initialMonthKey } from '../src/components/AcademicYearPage';
import type { Lecture } from '../src/lib/supabase';

/**
 * The academic-year screen, as logic.
 *
 * Yariv opens this screen to answer one question about a specific date — "can I put a
 * guest lecturer here?" — so these tests are about dates and verdicts, not rendering.
 * Every date asserted below was read off the official Ariel תשפ״ז calendar and the
 * verified dataset copied from Maestro; if one of them ever moves, the dataset changed
 * and somebody must have meant it.
 */

const dayMap = buildAcademicDayMap();

/* ── the dataset itself ───────────────────────────────────────────────────── */

test('the year spans October 2026 → September 2027, Sunday-first, twelve months', () => {
  const months = buildAcademicMonths(dayMap);
  expect(months).toHaveLength(12);
  expect(months[0].key).toBe('2026-10');
  expect(months[11].key).toBe('2027-09');
  // every month is whole weeks, and every week starts on a Sunday
  for (const m of months) {
    expect(m.cells.length % 7).toBe(0);
    expect(new Date(`${m.cells[0].iso}T00:00:00Z`).getUTCDay()).toBe(0);
  }
});

test('every category carries a label and a swatch, so the legend cannot lie', () => {
  expect(ACADEMIC_CATEGORIES.length).toBeGreaterThanOrEqual(10);
  for (const c of ACADEMIC_CATEGORIES) {
    expect(c.label.trim().length).toBeGreaterThan(0);
    expect(c.swatch).toMatch(/^#[0-9A-Fa-f]{6}$/);
  }
  // the document's own fills, measured off the scan — gold for the strong rows,
  // cream for the soft ones. A theme token here would repaint the university's paper.
  const byKey = Object.fromEntries(ACADEMIC_CATEGORIES.map((c) => [c.key, c]));
  expect(byKey.exam.swatch).toBe(ARIEL_PAPER.gold);
  expect(byKey.boundary.swatch).toBe(ARIEL_PAPER.gold);
  expect(byKey.off.swatch).toBe(ARIEL_PAPER.cream);
  expect(byKey.makeup_day.swatch).toBe(ARIEL_PAPER.cream);
  expect(byKey.simulation.swatch).toBe('#E06666');
});

/* ── the six seminar meetings ─────────────────────────────────────────────── */

test('the six סמינריון פרקטיקום meetings land on the dates Yariv teaches them', () => {
  const expected = [
    '2026-10-25', '2026-11-29', '2026-12-27',   // 25.10 · 29.11 · 27.12
    '2027-03-14', '2027-04-18', '2027-05-16',   // 14.3 · 18.4 · 16.5
  ];

  const seminarDays = [...dayMap.entries()]
    .filter(([, items]) => items.some((i) => i.category === 'seminar'))
    .map(([iso]) => iso)
    .sort();

  expect(seminarDays).toEqual(expected);

  // and each one is a numbered meeting, in order — a seminar that lost its מפגש number
  // would still be on the right day and still be wrong.
  for (const [i, iso] of expected.entries()) {
    const seminar = (dayMap.get(iso) ?? []).find((it) => it.category === 'seminar');
    expect(seminar, `no seminar on ${iso}`).toBeTruthy();
    expect(seminar!.session).toBe(i + 1);
    expect(seminar!.categoryLabel).toBe('סמינריון פרקטיקום');
  }
});

/* ── the two December simulations ─────────────────────────────────────────── */

test('8.12 and 15.12 read as simulations, and paint red rather than חנוכה cream', () => {
  for (const iso of ['2026-12-08', '2026-12-15']) {
    const items = dayMap.get(iso) ?? [];
    const sim = items.find((it) => it.category === 'simulation');
    expect(sim, `no simulation on ${iso}`).toBeTruthy();
    expect(sim!.categoryLabel).toBe('סימולציה');
    expect(sim!.time).toBe('15:00–17:00');     // the hour swap is the point of the mark

    // 8.12 also sits inside the חנוכה arrangement (4–11.12). A simulation moves a
    // class to another hour, so it must win the cell — a red day hidden under cream
    // is exactly the mistake this priority order exists to prevent.
    expect(academicMarksFor(items).fill).toBe('#E06666');
  }
});

/* ── multi-day events are expanded, which is what makes a window catchable ── */

test('a multi-day holiday and an exam window cover every day they span', () => {
  // חופשת פסח 21–28.4.2027
  for (const iso of ['2027-04-21', '2027-04-24', '2027-04-28']) {
    expect((dayMap.get(iso) ?? []).some((i) => i.category === 'off'), iso).toBe(true);
  }
  expect((dayMap.get('2027-04-29') ?? []).some((i) => i.category === 'off')).toBe(false);

  // מועדי בחינות סמסטר א׳ מועד א׳ 11.1–8.2.2027
  for (const iso of ['2027-01-11', '2027-01-25', '2027-02-08']) {
    expect((dayMap.get(iso) ?? []).some((i) => i.category === 'exam'), iso).toBe(true);
  }
});

test('the mark index answers the same as academicMarksFor, day for day', () => {
  const index = buildAcademicMarkIndex(dayMap);
  expect(index.size).toBe(dayMap.size);
  for (const [iso, items] of dayMap) {
    expect(index.get(iso)).toEqual(academicMarksFor(items));
  }
});

/* ── the verdict: the one question the screen exists to answer ─────────────── */

test('a closed day is blocked, an exam window is blocked, a make-up day only warns', () => {
  expect(dayVerdict(dayMap.get('2027-04-24') ?? [])).toBe('blocked');   // חופשת פסח
  expect(dayVerdict(dayMap.get('2026-10-27') ?? [])).toBe('blocked');   // יום הבחירות
  expect(dayVerdict(dayMap.get('2027-01-25') ?? [])).toBe('blocked');   // תקופת בחינות
  expect(dayVerdict(dayMap.get('2027-01-10') ?? [])).toBe('caution');   // יום השלמה
  expect(dayVerdict(dayMap.get('2026-10-18') ?? [])).toBe('caution');   // first day of the year
  expect(dayVerdict([])).toBe('open');
});

test('a blocker quotes the calendar\'s own title, not a generic word', () => {
  const [first] = dayBlockers(dayMap.get('2027-04-24') ?? []);
  expect(first.level).toBe('blocked');
  expect(first.category).toBe('off');
  expect(first.reason).toContain('חופשת פסח');       // says WHICH holiday, so he knows how long

  const makeup = dayBlockers(dayMap.get('2027-01-10') ?? [])
    .find((b) => b.category === 'makeup_day');
  expect(makeup?.level).toBe('caution');
  expect(makeup?.reason).toContain('במתכונת');        // says which weekday it runs as
});

test('blockers come worst-first, so the panel leads with the one that stops him', () => {
  // 12.8.2027 — צום תשעה באב: both "no teaching" and "no exams"
  const b = dayBlockers(dayMap.get('2027-08-12') ?? []);
  expect(b.length).toBeGreaterThan(0);
  expect(b[0].level).toBe('blocked');
  expect(b.every((x, i) => i === 0 || x.level !== 'blocked' || b[i - 1].level === 'blocked')).toBe(true);
});

/* ── the lecture overlay ──────────────────────────────────────────────────── */

const lec = (over: Partial<Lecture> = {}): Lecture => ({
  id: 'l-' + Math.random().toString(36).slice(2, 8),
  date: '2026-11-02',
  topic: 'גיוס טכנולוגי',
  lecturer: 'אופיר קרקו',
  courseName: 'פרקטיקום משאבי אנוש',
  status: 'מאושר',
  startTime: '18:30',
  endTime: '19:30',
  ...over,
});

test('only "מאושר" counts as approved — every other spelling is still open work', () => {
  expect(lectureState({ status: 'מאושר' })).toBe('approved');
  expect(lectureState({ status: 'בוטל' })).toBe('cancelled');
  // the four spellings production actually carries today
  for (const s of ['ממתין לאישור', 'בקשה נשלחה', 'שינוי מתבצע', 'טנטטיבי']) {
    expect(lectureState({ status: s }), s).toBe('pending');
  }
  // and the ones nobody has typed yet: a blank, and a status invented next week
  expect(lectureState({ status: '' })).toBe('pending');
  expect(lectureState({})).toBe('pending');
  expect(lectureState({ status: 'ממתין לתקציב' })).toBe('pending');
});

test('a stored date lands on its own day, with no timezone shift', () => {
  expect(lectureIso({ date: '2026-12-08' })).toBe('2026-12-08');
  expect(lectureIso({ date: '2026-12-08T00:00:00.000Z' })).toBe('2026-12-08');
  expect(lectureIso({ date: '  2026-12-08 ' })).toBe('2026-12-08');
  expect(lectureIso({ date: '' })).toBeNull();
  expect(lectureIso({ date: 'לא ידוע' })).toBeNull();
  expect(lectureIso({})).toBeNull();
});

test('lectures bucket by day, in clock order, and undated ones are reported not dropped', () => {
  const late = lec({ date: '2026-11-02', startTime: '18:30', topic: 'ב' });
  const early = lec({ date: '2026-11-02', startTime: '09:00', topic: 'א' });
  const other = lec({ date: '2026-11-03' });
  const nodate = lec({ date: '' });

  const map = buildLectureDayMap([late, early, other, nodate]);
  expect([...map.keys()].sort()).toEqual(['2026-11-02', '2026-11-03']);
  expect(map.get('2026-11-02')!.map((l) => l.title)).toEqual(['א', 'ב']);
  expect(undatedLectures([late, early, other, nodate])).toHaveLength(1);
});

test('a day summarises into counts the cell can draw, pending flagged separately', () => {
  const items = buildLectureDayMap([
    lec({ date: '2027-03-01', status: 'מאושר' }),
    lec({ date: '2027-03-01', status: 'ממתין לאישור' }),
    lec({ date: '2027-03-01', status: 'בוטל' }),
  ]).get('2027-03-01')!;

  const mark = lectureMarksFor(items);
  expect(mark).toEqual({ total: 3, approved: 1, pending: 1, cancelled: 1, hasPending: true });

  const index = buildLectureMarkIndex(buildLectureDayMap([lec({ date: '2027-03-01', status: 'מאושר' })]));
  expect(index.get('2027-03-01')!.hasPending).toBe(false);
});

/* ── THE FEATURE: a lecture standing on a day the university has closed ────── */

test('a lecture on a holiday is flagged, and the flag names the holiday', () => {
  const onPesach = lec({ date: '2027-04-24', topic: 'מפגש בפסח' });   // inside חופשת פסח
  const conflicts = findLectureConflicts(buildLectureDayMap([onPesach]), dayMap);

  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].iso).toBe('2027-04-24');
  expect(conflicts[0].lectureId).toBe(onPesach.id);
  expect(conflicts[0].blocker.level).toBe('blocked');
  expect(conflicts[0].blocker.reason).toContain('חופשת פסח');
});

test('and inside an exam window too — the four-week one nobody remembers', () => {
  const inExams = lec({ date: '2027-01-25', topic: 'הרצאת אורח' });
  const conflicts = findLectureConflicts(buildLectureDayMap([inExams]), dayMap);
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].blocker.category).toBe('exam');
});

test('a clear day is not flagged, and neither is a cancelled lecture on a closed one', () => {
  const clear = lec({ date: '2026-11-02' });          // an ordinary Monday
  expect(findLectureConflicts(buildLectureDayMap([clear]), dayMap)).toHaveLength(0);

  const cancelledOnPesach = lec({ date: '2027-04-24', status: 'בוטל' });
  expect(findLectureConflicts(buildLectureDayMap([cancelledOnPesach]), dayMap)).toHaveLength(0);
});

test('a make-up day does not raise a conflict by default, but does when asked', () => {
  const onMakeup = buildLectureDayMap([lec({ date: '2027-01-10' })]);
  expect(findLectureConflicts(onMakeup, dayMap)).toHaveLength(0);
  expect(findLectureConflicts(onMakeup, dayMap, { includeCaution: true })).toHaveLength(1);
});

test('conflicts come back in date order, so the list reads as a to-do', () => {
  const map = buildLectureDayMap([
    lec({ date: '2027-04-24', topic: 'ג' }),
    lec({ date: '2026-10-27', topic: 'א' }),
    lec({ date: '2027-01-25', topic: 'ב' }),
  ]);
  expect(findLectureConflicts(map, dayMap).map((c) => c.title)).toEqual(['א', 'ב', 'ג']);
});

/* ── the day panel's report ───────────────────────────────────────────────── */

test('the day report tells the panel what to say, and what is already standing there', () => {
  const onPesach = lec({ date: '2027-04-24' });
  const items = buildLectureDayMap([onPesach]).get('2027-04-24')!;

  const bad = daySchedulingReport('2027-04-24', dayMap.get('2027-04-24') ?? [], items);
  expect(bad.blocked).toBe(true);
  expect(bad.blockers[0].reason).toContain('חופשת פסח');
  expect(bad.conflicting).toHaveLength(1);

  const good = daySchedulingReport('2026-11-02', dayMap.get('2026-11-02') ?? [], []);
  expect(good.blocked).toBe(false);
  expect(good.blockers).toHaveLength(0);
  expect(good.conflicting).toHaveLength(0);
});

test('the seminar days are all schedulable — Yariv teaches on them', () => {
  for (const iso of ['2026-10-25', '2026-11-29', '2026-12-27', '2027-03-14', '2027-04-18', '2027-05-16']) {
    expect(dayVerdict(dayMap.get(iso) ?? []), iso).not.toBe('blocked');
  }
});

/* ── which month opens ────────────────────────────────────────────────────── */

test('the screen opens on the current month — and on October when today is outside the year', () => {
  const months = buildAcademicMonths(dayMap);
  expect(initialMonthKey(months, '2026-12-08')).toBe('2026-12');
  expect(initialMonthKey(months, '2027-09-30')).toBe('2027-09');
  // built in September 2026, one month BEFORE the year starts
  expect(initialMonthKey(months, '2026-09-23')).toBe('2026-10');
  // and after it ends
  expect(initialMonthKey(months, '2027-11-01')).toBe('2026-10');
});

/* ── a guard on the cell's own arithmetic ─────────────────────────────────── */

test('an empty day has no fill, no paint and no accents', () => {
  const marks = academicMarksFor([] as AcademicDayItem[]);
  expect(marks).toEqual({ categories: [], paint: null, fill: null, accents: [], count: 0 });
});

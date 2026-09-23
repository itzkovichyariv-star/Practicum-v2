import { test, expect } from '@playwright/test';
import {
  ACADEMIC_CATEGORIES,
  ARIEL_PAPER,
  academicMarksFor,
  buildAcademicDayMap,
  buildAcademicMarkIndex,
  buildAcademicMonths,
  academicCourseKeysFor,
  dayBlockers,
  dayVerdict,
  initialMonthKey,
  isTeachingSession,
  type AcademicDayItem,
} from '../src/lib/academicCalendar';
import {
  buildLectureDayMap,
  buildLectureMarkIndex,
  countTrainerMatches,
  daySchedulingReport,
  findLectureConflicts,
  lectureIso,
  lectureIsGuest,
  lectureState,
  lectureMarksFor,
  lecturerContact,
  matchTrainer,
  undatedLectures,
} from '../src/lib/lectureCalendar';
import type { Lecture, Trainer } from '../src/lib/supabase';

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

/* ══════════════════════════════════════════════════════════════════════════
 * THE DAY SHEET'S THREE QUESTIONS
 *
 * Yariv 2026-09-23, after the two calendars were merged into one:
 *   "הקשה עליו צריכה להראות גם אם יש לימודים וקורס מסויים וגם אם יש באותו יום
 *    הרצאת אורח ואם אפשר שתהיה מחוברת לפרטי המרצה שקיימים כבר"
 * Three questions — is there teaching and in which course, is there a guest lecture,
 * and who is the lecturer — so three groups of cells.
 * ══════════════════════════════════════════════════════════════════════════ */

const TRAINERS: Trainer[] = [
  { id: 't1', name: 'מיכל לאופר פסגות', role: 'מרצה', email: 'michal@psagot.example',
    phone: '050-1234567', organization: 'פסגות', courseId: 'hr', year: 'תשפ״ז' },
  { id: 't2', name: 'ד״ר חיה וגנר מישורי', role: 'מרצה אורחת', email: 'haya@example.com',
    phone: '052-7654321', organization: 'אוניברסיטת אריאל', courseId: 'hr', year: 'תשפ״ז' },
  { id: 't3', name: 'רון כהן', role: 'מנחה', courseId: 'hr', year: 'תשפ״ז' },
];

/* ── 1. is there teaching, and in which course ────────────────────────────── */

test('a teaching day names its course, its session number and its hour', () => {
  // 25.10.2026 — סמינריון פרקטיקום, meeting 1, 17:00–20:00. One session, no simulation.
  const items = dayMap.get('2026-10-25') ?? [];
  const sessions = items.filter(isTeachingSession);
  expect(sessions).toHaveLength(1);
  expect(sessions[0].course).toBe('semA');
  expect(sessions[0].courseTitle).toContain('סמינריון פרקטיקום');
  expect(sessions[0].session).toBe(1);
  expect(sessions[0].time).toBe('17:00–20:00');
  expect(sessions[0].code).toBe('2-2531510-1');
});

test('a day with teaching but no guest lecture is exactly that — a session, zero guests', () => {
  const iso = '2026-10-25';
  const sessions = (dayMap.get(iso) ?? []).filter(isTeachingSession);
  expect(sessions.length).toBeGreaterThan(0);
  const dayLectures = buildLectureDayMap([lec({ id: 'l-elsewhere', date: '2026-11-02', lecturer: 'אופיר קרקו' })]);
  expect(dayLectures.get(iso) ?? []).toHaveLength(0);
});

test('8.12.2026 carries BOTH — session 7 of מיומנויות א׳ AND the simulation that moved it', () => {
  const items = dayMap.get('2026-12-08') ?? [];
  const sessions = items.filter(isTeachingSession);
  expect(sessions.length).toBeGreaterThanOrEqual(1);
  const sim = sessions.find((s) => s.category === 'simulation');
  expect(sim, 'the simulation is the session, moved to another hour — not a separate item').toBeTruthy();
  expect(sim!.course).toBe('skA');
  expect(sim!.courseTitle).toContain('מיומנויות ייעוציות');
  expect(sim!.session).toBe(7);
  expect(sim!.time).toBe('15:00–17:00');
  // and a guest lecture put on the same date shows up beside it, not instead of it
  const withGuest = buildLectureDayMap([lec({ id: 'l-sim-day', date: '2026-12-08', lecturer: 'רון כהן', topic: 'גיוס' })]);
  expect(withGuest.get('2026-12-08')).toHaveLength(1);
  expect(withGuest.get('2026-12-08')![0].isGuest).toBe(true);
});

test('every kind:session row is teaching and every other kind is the university around it', () => {
  let sessions = 0, other = 0;
  for (const items of dayMap.values()) {
    for (const it of items) (isTeachingSession(it) ? sessions++ : other++);
  }
  expect(sessions).toBeGreaterThan(50);      // 52 course meetings, none of them lost
  expect(other).toBeGreaterThan(0);
  // a holiday is never mistaken for a class
  expect((dayMap.get('2027-04-24') ?? []).every((it) => !isTeachingSession(it))).toBe(true);
});

test('the course filter resolves against the academic course list, or does not filter at all', () => {
  expect(academicCourseKeysFor('מיומנויות ייעוציות — חלק א׳')).toEqual(['skA']);
  expect(academicCourseKeysFor('מיומנויות ייעוציות')).toEqual(expect.arrayContaining(['skA', 'skB']));
  // a course this dataset never heard of resolves to nothing — the caller must then
  // leave teaching UNFILTERED rather than render an empty "no class today"
  expect(academicCourseKeysFor('פרקטיקום משאבי אנוש 2026')).toEqual([]);
  expect(academicCourseKeysFor('__all__')).toEqual([]);
});

/* ── 2. is there a guest lecture ──────────────────────────────────────────── */

test('a named lecturer who is not Yariv makes it a guest lecture; no name makes it his own', () => {
  expect(lectureIsGuest(lec({ lecturer: 'אופיר קרקו' }), 'יריב איצקוביץ')).toBe(true);
  expect(lectureIsGuest(lec({ lecturer: '' }), 'יריב איצקוביץ')).toBe(false);
  expect(lectureIsGuest(lec({ lecturer: '   ' }), 'יריב איצקוביץ')).toBe(false);
  // he is the one giving it — a session of his, not a guest
  expect(lectureIsGuest(lec({ lecturer: 'יריב איצקוביץ' }), 'יריב איצקוביץ')).toBe(false);
  expect(lectureIsGuest(lec({ lecturer: 'ד״ר יריב איצקוביץ' }), 'יריב איצקוביץ')).toBe(false);
  // `type` cannot make the call — a guest lecture and his own class are both "הרצאה"
  expect(lectureIsGuest(lec({ type: 'הרצאה', lecturer: 'דנה לוי' }), 'יריב איצקוביץ')).toBe(true);
  expect(lectureIsGuest(lec({ type: 'סדנה', lecturer: 'דנה לוי' }), 'יריב איצקוביץ')).toBe(true);
});

test('the day map carries the guest flag through to the sheet', () => {
  const map = buildLectureDayMap([
    lec({ id: 'g', date: '2026-11-02', lecturer: 'דנה לוי', topic: 'אורחת' }),
    lec({ id: 'o', date: '2026-11-02', lecturer: '', topic: 'שיעור שלי' }),
  ], 'יריב איצקוביץ');
  const day = map.get('2026-11-02')!;
  expect(day.filter((l) => l.isGuest).map((l) => l.id)).toEqual(['g']);
  expect(day.filter((l) => !l.isGuest).map((l) => l.id)).toEqual(['o']);
});

/* ── 3. the lecturer's details, from the records that already exist ───────── */

test('a lecturer who matches a trainer resolves to that record, with its contact details', () => {
  const c = lecturerContact(lec({ lecturer: 'מיכל לאופר פסגות', lecturerEmail: 'stale@old.example' }), TRAINERS);
  expect(c).toBeTruthy();
  expect(c!.source).toBe('trainer');
  expect(c!.trainerId).toBe('t1');
  expect(c!.email).toBe('michal@psagot.example');   // the record wins over the lecture's copy
  expect(c!.phone).toBe('050-1234567');
  expect(c!.organization).toBe('פסגות');
  expect(c!.role).toBe('מרצה');
});

test('a title on either side does not stop the match — ד״ר חיה וגנר מישורי is חיה וגנר מישורי', () => {
  expect(matchTrainer('חיה וגנר מישורי', TRAINERS)?.id).toBe('t2');
  expect(matchTrainer('ד״ר חיה וגנר מישורי', TRAINERS)?.id).toBe('t2');
  expect(matchTrainer('חיה וגנר', TRAINERS)?.id).toBe('t2');      // two shared parts is enough
});

test('a lecturer with no trainer record falls back to the lecture\'s own contact fields', () => {
  const c = lecturerContact(
    lec({ lecturer: 'אופיר קרקו', lecturerEmail: 'ofir@example.com', lecturerPhone: '0504014350', institution: 'חברה' }),
    TRAINERS);
  expect(c).toBeTruthy();
  expect(c!.source).toBe('lecture');
  expect(c!.trainerId).toBeNull();
  expect(c!.name).toBe('אופיר קרקו');
  expect(c!.email).toBe('ofir@example.com');
  expect(c!.phone).toBe('0504014350');
});

test('a lecturer with no record and no contact details renders NO card at all', () => {
  // an empty contact card implies a record exists and is empty — worse than none.
  expect(lecturerContact(lec({ lecturer: 'מישהו לגמרי חדש' }), TRAINERS)).toBeNull();
  expect(lecturerContact(lec({ lecturer: '' }), TRAINERS)).toBeNull();
});

test('a shared first name alone never links two different people', () => {
  const two: Trainer[] = [
    { id: 'a', name: 'רון כהן', courseId: 'hr' },
    { id: 'b', name: 'רון לוי', courseId: 'hr' },
  ];
  expect(matchTrainer('רון', two)).toBeNull();
  expect(matchTrainer('רון מזרחי', two)).toBeNull();
  expect(matchTrainer('רון כהן', two)?.id).toBe('a');
});

test('countTrainerMatches reports named-vs-matched, which is how the rule gets judged', () => {
  const lectures = [
    lec({ id: '1', lecturer: 'מיכל לאופר פסגות' }),
    lec({ id: '2', lecturer: 'ד״ר חיה וגנר מישורי' }),
    lec({ id: '3', lecturer: 'אופיר קרקו' }),
    lec({ id: '4', lecturer: '' }),
  ];
  expect(countTrainerMatches(lectures, TRAINERS)).toEqual({ named: 3, matched: 2 });
});

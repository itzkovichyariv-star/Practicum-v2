/**
 * What Yariv's Google calendar should contain, computed from the app.
 *
 * Yariv 2026-10-02: "כל שינוי יכנס לגוגל ויעודכן שם — למשל אם אני מזיז הרצאה שתעודכן
 * גם בגוגל — וגוגל צריך לשקף את הלוח הנוכחי".
 *
 * The app is the record; Google is a mirror. So the sync is a RECONCILE, not a stream of
 * edits: this module lists every event Google should hold right now, each with a stable
 * `key`, and the gcal-sync edge function makes the dedicated Google calendar equal to that
 * list — creating what is missing, updating what changed (a moved lecture is the same key
 * with a new date), deleting what is gone (a cancelled lecture, a לתאם marked תואם).
 * Running it twice changes nothing, so it is safe to call after every save.
 *
 * What is mirrored: guest lectures (with their status in the title), open לתאם items, his
 * personal days away. The university's own year (courses, holidays, exams) is already in
 * his primary Google calendar since 2026-09-22 and is not duplicated here.
 *
 * Pure: no network, no clock (today is passed in) — unit/gcal-model.spec.ts pins it.
 */

import { ACADEMIC_EVENTS, buildAcademicDayMap, type AcademicDayItem } from './academicCalendar';
import { buildLectureDayMap } from './lectureCalendar';
import { buildTodoMap, courseKindOf, type CourseKind, type DoneMap } from './calendarCell';
import type { Lecture, PracticumData } from './supabase';

export const GCAL_TZ = 'Asia/Jerusalem';

export interface GEvent {
  /** Stable identity across syncs — stored on the Google event as a private property. */
  key: string;
  summary: string;
  description: string;
  location?: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
  /** Google's event colour id: a lecture takes its course's colour (7 / 10 / 3, as the app);
   *  6 = orange for לתאם, 8 = grey for days away. */
  colorId: string;
}

function addDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const isTime = (t?: string) => /^\d{2}:\d{2}$/.test((t || '').trim());

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/**
 * The course session a guest lecture sits inside, if any.
 *
 * Yariv 2026-10-03: "תסיר רק כפילויות ותשאיר את הזימון שיש בו הכי הרבה מידע". His primary
 * calendar got a one-time copy of every course session on 22.9; on the 14 days a guest
 * lecture fills the session, that copy and this event were the same meeting twice. So the
 * lecture's event carries the session too (course, מפגש N, code, the dataset's own note —
 * חנוכה break, "החלפת שעה!" …), which lets the primary copy go without losing a word.
 * Same day; the session whose hours overlap the lecture's (an untimed lecture: the day's
 * only session).
 */
export function sessionFor(l: Lecture, iso: string, dayItems: AcademicDayItem[] = []): AcademicDayItem | null {
  const sessions = dayItems.filter((i) => i.kind === 'session' && i.time);
  if (!sessions.length) return null;
  if (isTime(l.startTime)) {
    const a = toMin(l.startTime!.trim());
    const b = isTime(l.endTime) ? toMin(l.endTime!.trim()) : a + 1;
    const hit = sessions.find((s) => {
      const [s0, s1] = s.time!.split('–').map(toMin);
      return a < s1 && b > s0;
    });
    // A timed lecture belongs to a session only if their hours meet — otherwise the
    // span below would stretch it over hours it does not occupy.
    return hit ?? null;
  }
  return sessions.length === 1 ? sessions[0] : null;
}

function sessionLines(s: AcademicDayItem): string[] {
  return [
    '\n— מפגש הקורס —',
    `${s.courseTitle || s.title}${s.session ? ` · מפגש ${s.session}` : ''} · ${s.time}${s.code ? ` · קוד ${s.code}` : ''}`,
    s.title !== s.courseTitle ? s.title : '',
    s.note ? `הערות מהלוח האקדמי (22.9; הסטטוס העדכני — למעלה): ${s.note}` : '',
  ].filter(Boolean);
}

/* Yariv 2026-10-03, on 8.12 in Google: the event lost the look the app gives it — the
 * 🎭 of a simulation (it showed 🎤) and the course colours ("לא לכולם אותו צבע — לפי המודל
 * של היומן של פרקטיקום"). So Google follows the app's calendar model (calendarCell.ts):
 *   · colour = the COURSE (COURSE_STYLE): מיומנויות ייעוץ blue, פרקטיקום מש״א green,
 *     פרקטיקום ייעוץ purple — the nearest of Google's event colours;
 *   · icon = 🎭 for a simulation, 🎤 for a guest lecture;
 *   · status = words, as the app's chip says it: ✓ (מאושר) / ⏳ ממתין, first in the title.
 * A lecture that fills a course session also carries the session: course + מפגש N (and
 * 🔴 החלפת שעה! where the dataset marks one) in the title, and the session's hours. */
const COURSE_SHORT: Record<string, string> = {
  semA: 'סמינריון א׳', semB: 'סמינריון ב׳', skA: 'מיומנויות א׳', skB: 'מיומנויות ב׳',
  prA: 'פרקטיקום ייעוץ א׳', prB: 'פרקטיקום ייעוץ ב׳',
};
/** COURSE_STYLE.strong → Google colour id: blue 7 (Peacock), green 10 (Basil), purple 3 (Grape). */
const GOOGLE_COURSE_COLOR: Record<CourseKind, string> = { skills: '7', hr: '10', consult: '3' };

/** The app's course kind for a lecture: from its session, else from its course name. */
function lectureKind(l: Lecture, session: AcademicDayItem | null): CourseKind | null {
  const k = courseKindOf(session?.course);
  if (k) return k;
  const n = l.courseName || '';
  if (/מיומנויות/.test(n)) return 'skills';
  if (/משאבי אנוש|מש״א|מש"א/.test(n)) return 'hr';
  if (/ייעוץ/.test(n)) return 'consult';
  return null;
}

function lectureEvent(l: Lecture, iso: string, approved: boolean, session: AcademicDayItem | null = null): GEvent {
  const timed = isTime(l.startTime);
  const lStart = timed ? l.startTime!.trim() : null;
  const lEnd = isTime(l.endTime) && lStart && l.endTime!.trim() > lStart ? l.endTime!.trim() : lStart;
  const title = (l.topic || l.title || l.courseName || 'הרצאה').trim();
  // 🎭 for a simulation, as the app's own calendar draws it; 🎤 for a guest lecture.
  const isSim = session?.category === 'simulation' || /סימולצי/.test(`${title} ${l.lecturer || ''}`);
  const icon = isSim ? '🎭' : '🎤';

  // The span: the session's hours when the lecture sits inside one — that is the time he is
  // in the room — widened, never narrowed, so a lecture running past it still shows whole.
  let from = lStart, to = lEnd;
  if (session?.time && lStart) {
    const [s0, s1] = session.time.split('–');
    from = s0 < lStart ? s0 : lStart;
    to = lEnd && lEnd > s1 ? lEnd : s1;
  }
  const sessionTag = session
    ? ` · ${(session.course && COURSE_SHORT[session.course]) || session.courseTitle || ''}${session.session ? ` מפגש ${session.session}` : ''}`
      + (/החלפת שעה/.test(session.title) ? ' · 🔴 החלפת שעה!' : '')
    : '';

  return {
    key: `lec:${l.id}`,
    summary: `${approved ? '✓' : '⏳ ממתין ·'} ${icon} ${title}${l.lecturer ? ` — ${l.lecturer}` : ''}${sessionTag}`,
    description: [
      l.courseName ? `קורס: ${l.courseName}` : '',
      l.lecturer ? `מרצה: ${l.lecturer}` : '',
      l.lecturerPhone ? `טלפון: ${l.lecturerPhone}` : '',
      l.lecturerEmail ? `מייל: ${l.lecturerEmail}` : '',
      `סטטוס: ${(l.status || '').trim() || '—'}`,
      lStart && (from !== lStart || to !== lEnd) ? `שעות ההרצאה: ${lStart}${lEnd && lEnd !== lStart ? `–${lEnd}` : ''}` : '',
      l.notes ? `\n${l.notes}` : '',
      ...(session ? sessionLines(session) : []),
      '\n— מסונכרן מאפליקציית הפרקטיקום. שינויים עושים באפליקציה.',
    ].filter(Boolean).join('\n'),
    location: (l.link || l.location || l.institution || '').trim() || undefined,
    start: from ? { dateTime: `${iso}T${from}:00`, timeZone: GCAL_TZ } : { date: iso },
    end: to ? { dateTime: `${iso}T${to}:00`, timeZone: GCAL_TZ } : { date: addDay(iso) },
    colorId: (() => { const k = lectureKind(l, session); return k ? GOOGLE_COURSE_COLOR[k] : approved ? '10' : '6'; })(),
  };
}

export function desiredGoogleEvents(
  data: PracticumData,
  today: string,
  academicDayMap: Map<string, AcademicDayItem[]> = buildAcademicDayMap(),
): GEvent[] {
  const out: GEvent[] = [];
  const lectures = (data.lectures || []) as Lecture[];
  const lectureDayMap = buildLectureDayMap(lectures);

  // 1. Guest lectures — every one that is not cancelled. A moved lecture keeps its key,
  //    so Google moves the same event rather than gaining a second one.
  for (const [iso, items] of lectureDayMap) {
    for (const it of items) {
      if (it.state === 'cancelled') continue;
      out.push(lectureEvent(it.lecture, iso, it.state === 'approved', sessionFor(it.lecture, iso, academicDayMap.get(iso))));
    }
  }

  // 2. לתאם still open — on the day the app shows it. Marking it תואם removes it.
  const done = (data.calendarDone || {}) as DoneMap;
  for (const [iso, todos] of buildTodoMap(academicDayMap, lectureDayMap, today)) {
    for (const t of todos) {
      if (done[t.key]) continue;
      out.push({
        key: `todo:${t.key}`,
        summary: `⚠ לתאם: ${t.what}`,
        description: `${t.eventIso ? `האירוע עצמו: ${t.eventIso}\n` : ''}לסימון "תואם" — בלוח באפליקציה.\n\n— מסונכרן מאפליקציית הפרקטיקום.`,
        start: { date: iso },
        end: { date: addDay(iso) },
        colorId: '6',
      });
    }
  }

  // 3. His own days away (e.g. חופשה באילת) — one all-day span each.
  for (const e of ACADEMIC_EVENTS) {
    if (e.category !== 'away' || !e.start_date || !e.end_date) continue;
    out.push({
      key: `away:${e.start_date}:${e.title}`,
      summary: `🏖 ${e.title}`,
      description: 'לא לקבוע הרצאות בימים אלה.\n\n— מסונכרן מאפליקציית הפרקטיקום.',
      start: { date: e.start_date },
      end: { date: addDay(e.end_date) },
      colorId: '8',
    });
  }

  return out.sort((a, b) => a.key.localeCompare(b.key));
}

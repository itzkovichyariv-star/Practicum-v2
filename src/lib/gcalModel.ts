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
import { buildTodoMap, type DoneMap } from './calendarCell';
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
  /** Google's event colour id: 10 = green (approved), 6 = orange (pending / לתאם), 8 = grey. */
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
 * Same day; the session whose hours overlap the lecture's; else the day's only session.
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
    if (hit) return hit;
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

function lectureEvent(l: Lecture, iso: string, approved: boolean, session: AcademicDayItem | null = null): GEvent {
  const timed = isTime(l.startTime);
  const end = isTime(l.endTime) ? l.endTime!.trim() : null;
  const title = (l.topic || l.title || l.courseName || 'הרצאה').trim();
  return {
    key: `lec:${l.id}`,
    summary: `${approved ? '✓' : '⏳ ממתין ·'} 🎤 ${title}${l.lecturer ? ` — ${l.lecturer}` : ''}`,
    description: [
      l.courseName ? `קורס: ${l.courseName}` : '',
      l.lecturer ? `מרצה: ${l.lecturer}` : '',
      l.lecturerPhone ? `טלפון: ${l.lecturerPhone}` : '',
      l.lecturerEmail ? `מייל: ${l.lecturerEmail}` : '',
      `סטטוס: ${(l.status || '').trim() || '—'}`,
      l.notes ? `\n${l.notes}` : '',
      ...(session ? sessionLines(session) : []),
      '\n— מסונכרן מאפליקציית הפרקטיקום. שינויים עושים באפליקציה.',
    ].filter(Boolean).join('\n'),
    location: (l.link || l.location || l.institution || '').trim() || undefined,
    start: timed ? { dateTime: `${iso}T${l.startTime!.trim()}:00`, timeZone: GCAL_TZ } : { date: iso },
    end: timed
      ? { dateTime: `${iso}T${end && end > l.startTime!.trim() ? end : l.startTime!.trim()}:00`, timeZone: GCAL_TZ }
      : { date: addDay(iso) },
    colorId: approved ? '10' : '6',
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

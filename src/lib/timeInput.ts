/**
 * ONE reader for every clock time a person types into this app: a lecture's start and
 * end, the placement-interview time, and the hours of the interview-slot planner.
 *
 * Why it exists (Yariv, 2026-09-22: "מנגנון השעה לא מגיב טוב למספרים ומסובב לי את השעה").
 * Every one of those fields was a native <input type="time">, and the native control does
 * not read what you type — it reads which of its segments has focus:
 *
 *   • Chrome: the clock icon at the end of the field (or Space / Alt+↓) opens a picker.
 *     While it is open, digits go nowhere, and Enter writes the CURRENT time. Reproduced
 *     in Chromium 148: typed "1700" + Enter at 19:38 → saved "19:38". That is the
 *     signature of the damaged lectures — 23:17, 23:18, 23:20, 00:19, 00:21, each a
 *     moment around midnight, which is when they were being entered.
 *   • Chrome: a click on the minutes segment sends the whole typed time into the minutes,
 *     so "20" meant as eight in the evening becomes HH:20 ("00:20").
 *   • Safari (WebKit 26.4): four digits never leave the hour segment ("1700" → hour 00,
 *     minutes empty → nothing saved); the empty field shows a grey "12:30" that reads as a
 *     real value; and on the RTL page it draws minutes:hours, mirrored.
 *
 * Nothing between the control and the database looked at the value, so whatever the
 * control produced was saved, including an end before its start (23:18–00:20).
 *
 * The fields are now plain text, and this is the only place a typed time is read.
 * It is pure: it never consults the clock, so a lecture typed at midnight cannot
 * become "midnight" by accident. It never guesses either — what it cannot read with
 * certainty it refuses, in words, and the field keeps what was typed.
 */

export type TimeParse =
  | { ok: true; value: string }      // 'HH:MM' (24-hour), or '' for an empty field
  | { ok: false; error: string };    // Hebrew, ready to show under the field

/** Invisible direction marks that copy-paste in an RTL interface carries along. */
const INVISIBLE = /[​-‏‪-‮⁦-⁩؜﻿]/g;
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Accepts: "15", "9", "1500", "0930", "930", "15:00", "9:30", "15.00", "15,00",
 * "15 00", "15:", "15:0" and "10:00:00" (the database's own time format). Returns "HH:MM".
 * Refuses, with a message: hours past 23, minutes past 59, one-digit minutes ("9:5" is
 * 9:05 or 9:50 — not ours to decide), am/pm and words, and anything longer than 4 digits.
 */
export function parseTime(raw: unknown): TimeParse {
  const s = String(raw ?? '').replace(INVISIBLE, '').trim();
  if (s === '') return { ok: true, value: '' };

  let h: number;
  let m: number;
  let x: RegExpExecArray | null;
  if ((x = /^(\d{1,2})$/.exec(s))) { h = +x[1]; m = 0; }                                   // 9, 15
  else if ((x = /^(\d{1,2})(\d{2})$/.exec(s))) { h = +x[1]; m = +x[2]; }                   // 930, 0930, 1500
  else if ((x = /^(\d{1,2})(?:\s*[:.,]\s*|\s+)(\d{2})(?::\d{2})?$/.exec(s))) { h = +x[1]; m = +x[2]; } // 9:30, 15.00, 10:00:00
  else if ((x = /^(\d{1,2})\s*[:.,]\s*0?$/.exec(s))) { h = +x[1]; m = 0; }                 // "15:", "15:0"
  else if ((x = /^(\d{1,2})\s*[:.,]\s*(\d)$/.exec(s))) {
    const hh = pad(+x[1]);
    return { ok: false, error: `הדקות צריכות שתי ספרות — ${hh}:0${x[2]} או ${hh}:${x[2]}0?` };
  }
  else if (/[a-zA-Z֐-׿]/.test(s)) {
    return { ok: false, error: 'הקלד/י שעה בספרות, בשעון של 24 שעות — למשל 17:00 או 1700' };
  }
  else if (/^\d{5,}$/.test(s)) {
    return { ok: false, error: 'יותר מדי ספרות — הקלד/י למשל 1700 או 17:00' };
  }
  else {
    return { ok: false, error: `"${s}" אינה שעה — הקלד/י למשל 17:00, 1700 או 17` };
  }

  if (h > 23) return { ok: false, error: `אין שעה ${h} — השעות הן 00 עד 23 (למשל 17:00)` };
  if (m > 59) return { ok: false, error: `אין ${m} דקות — הדקות הן 00 עד 59` };
  return { ok: true, value: `${pad(h)}:${pad(m)}` };
}

/** The normalised time, or '' when the text is empty or unreadable. For links and labels. */
export function timeOrEmpty(raw: unknown): string {
  const r = parseTime(raw);
  return r.ok ? r.value : '';
}

/** 'HH:MM' → minutes since midnight. Expects a normalised value. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes since midnight (0–1439) → 'HH:MM'. */
export function fromMinutes(total: number): string {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export type RangeCheck =
  | { ok: true }
  | { ok: false; error: string; fix?: string };

/**
 * End must come after start. Nothing here crosses midnight: a lecture, an interview and
 * an interview slot all end the same day they start, so 23:18–00:20 is refused, not read
 * as a 62-minute event. When the end looks like a 12-hour habit ("8" for eight in the
 * evening, after a 17:00 start) the evening reading is OFFERED as `fix` — never applied.
 * Either field empty, or unreadable (it carries its own error), means nothing to compare.
 */
export function checkTimeRange(startRaw: unknown, endRaw: unknown): RangeCheck {
  const s = parseTime(startRaw);
  const e = parseTime(endRaw);
  if (!s.ok || !e.ok || !s.value || !e.value) return { ok: true };
  const sm = toMinutes(s.value);
  const em = toMinutes(e.value);
  if (em > sm) return { ok: true };
  if (em === sm) return { ok: false, error: `שעת הסיום זהה לשעת ההתחלה (${s.value})` };
  const evening = em + 12 * 60;
  const fix = em < 12 * 60 && evening > sm && evening < 24 * 60 ? fromMinutes(evening) : undefined;
  return { ok: false, error: `שעת הסיום (${e.value}) מוקדמת משעת ההתחלה (${s.value})`, fix };
}

export type EndSuggestion =
  | { ok: true; value: string }
  | { ok: false; reason: 'no-start' | 'crosses-midnight' };

/** start + duration, or a refusal when that would run past midnight. */
export function suggestEndTime(startRaw: unknown, durationMinutes: number): EndSuggestion {
  const s = parseTime(startRaw);
  if (!s.ok || !s.value) return { ok: false, reason: 'no-start' };
  const end = toMinutes(s.value) + durationMinutes;
  if (end >= 24 * 60) return { ok: false, reason: 'crosses-midnight' };
  return { ok: true, value: fromMinutes(end) };
}

export const DEFAULT_LECTURE_MINUTES = 120;

/**
 * The course's usual lecture length: the most common start→end duration among that
 * course's lectures (a tie goes to the longer one). Durations under 30 minutes or over
 * 8 hours are ignored — a two-minute "lecture" (00:19–00:21) is one of the damaged
 * records, not a habit, and must not teach the suggestion anything. With no usable
 * lecture in the course, the default is two hours.
 */
export function usualDurationMinutes(
  lectures: ReadonlyArray<{ courseId?: string; startTime?: string; endTime?: string }>,
  courseId?: string,
): { minutes: number; fromCourse: boolean } {
  if (courseId) {
    const counts = new Map<number, number>();
    for (const l of lectures) {
      if ((l.courseId || '') !== courseId) continue;
      const s = parseTime(l.startTime);
      const e = parseTime(l.endTime);
      if (!s.ok || !e.ok || !s.value || !e.value) continue;
      const d = toMinutes(e.value) - toMinutes(s.value);
      if (d < 30 || d > 8 * 60) continue;
      counts.set(d, (counts.get(d) || 0) + 1);
    }
    let best = 0;
    let bestN = 0;
    for (const [d, n] of counts) {
      if (n > bestN || (n === bestN && d > best)) { best = d; bestN = n; }
    }
    if (bestN > 0) return { minutes: best, fromCourse: true };
  }
  return { minutes: DEFAULT_LECTURE_MINUTES, fromCourse: false };
}

/** 120 → "שעתיים", 90 → "שעה וחצי", 180 → "3 שעות", 45 → "45 דק׳". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`;
  if (rest === 30) return h === 0 ? '30 דק׳' : h === 1 ? 'שעה וחצי' : h === 2 ? 'שעתיים וחצי' : `${h}.5 שעות`;
  return `${minutes} דק׳`;
}

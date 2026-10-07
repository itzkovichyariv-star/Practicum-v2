import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseTime, timeOrEmpty, checkTimeRange, suggestEndTime, usualDurationMinutes, formatDuration,
  toMinutes, fromMinutes, DEFAULT_LECTURE_MINUTES,
} from '../src/lib/timeInput';

/**
 * "מנגנון השעה לא מגיב טוב למספרים ומסובב לי את השעה כשאני מכניס אותה" — Yariv, 2026-09-22.
 *
 * What was saved instead of what he typed, from production:
 *   23:18–00:20  (meant 17:00–20:00)     00:19–00:21     23:17–23:20
 * Clock times around midnight — the native time picker writes the CURRENT time on Enter —
 * plus an end that "wrapped" past midnight. These tests pin the one parser every time
 * field now goes through: it reads what was typed, never the clock, and refuses rather
 * than guesses.
 */

const ok = (raw: string) => {
  const r = parseTime(raw);
  if (!r.ok) throw new Error(`expected "${raw}" to parse, got: ${r.error}`);
  return r.value;
};
const refused = (raw: string) => {
  const r = parseTime(raw);
  if (r.ok) throw new Error(`expected "${raw}" to be refused, got: ${r.value}`);
  return r.error;
};

test('the seven ways Yariv types a time all land on HH:MM', () => {
  expect(ok('15')).toBe('15:00');
  expect(ok('1500')).toBe('15:00');
  expect(ok('15:00')).toBe('15:00');
  expect(ok('15.00')).toBe('15:00');
  expect(ok('9')).toBe('09:00');
  expect(ok('0930')).toBe('09:30');
  expect(ok('9:30')).toBe('09:30');
});

test('and the near relatives: three digits, a comma, a space, a trailing colon, seconds', () => {
  expect(ok('930')).toBe('09:30');
  expect(ok('15,00')).toBe('15:00');
  expect(ok('15 00')).toBe('15:00');
  expect(ok('15:')).toBe('15:00');
  expect(ok('15:0')).toBe('15:00');       // one reading only, so not a guess
  expect(ok(' 17:30 ')).toBe('17:30');
  expect(ok('10:00:00')).toBe('10:00');   // what the slots table hands back
  expect(ok('0')).toBe('00:00');
  expect(ok('2359')).toBe('23:59');
});

test('invisible direction marks from an RTL copy-paste do not break a time', () => {
  expect(ok('‏17:00‎')).toBe('17:00');
  expect(ok('‫1700‬')).toBe('17:00');
});

test('an empty field is "no time", never a time', () => {
  expect(ok('')).toBe('');
  expect(ok('   ')).toBe('');
  expect(parseTime(undefined)).toEqual({ ok: true, value: '' });
  expect(parseTime(null)).toEqual({ ok: true, value: '' });
});

test('25:00 is refused in words, not guessed', () => {
  const e = refused('25:00');
  expect(e).toContain('25');
  expect(e).toContain('00 עד 23');
  expect(refused('2500')).toContain('25');
  expect(refused('24:00')).toContain('24');
  expect(refused('25')).toContain('25');
});

test('minutes past 59 are refused', () => {
  expect(refused('15:75')).toContain('75');
  expect(refused('1260')).toContain('60');
  expect(refused('999')).toContain('99');
});

test('one-digit minutes are ambiguous, so both readings are offered and neither is picked', () => {
  const e = refused('9:5');
  expect(e).toContain('09:05');
  expect(e).toContain('09:50');
});

test('am/pm, words, too many digits and ranges are refused with a hint', () => {
  expect(refused('5pm')).toContain('24 שעות');
  expect(refused('17:00 בערב')).toContain('24 שעות');
  expect(refused('12345')).toContain('ספרות');
  expect(refused('17-20')).toContain('17:00');
  expect(refused('-5')).toBeTruthy();
});

test('every refusal is a readable Hebrew sentence', () => {
  for (const raw of ['25:00', '15:75', '9:5', '5pm', '12345', 'abc', '17-20']) {
    expect(refused(raw)).toMatch(/[֐-׿]/);
  }
});

/* ── The damaged records ─────────────────────────────────────────────────── */

test('DAMAGED 23:18–00:20: typing "20" for the end gives 20:00, never 00:20', () => {
  expect(ok('20')).toBe('20:00');
  expect(ok('2000')).toBe('20:00');
  expect(checkTimeRange('17', '20')).toEqual({ ok: true });
});

test('DAMAGED 23:18–00:20: an end that wraps past midnight is refused, not saved', () => {
  const r = checkTimeRange('23:18', '00:20');
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error).toContain('00:20');
    expect(r.error).toContain('23:18');
  }
});

test('DAMAGED clock-time records: at 23:18 on the clock, "1700" is still 17:00', () => {
  const RealDate = Date;
  const frozen = new RealDate('2026-09-21T23:18:00+03:00').getTime();
  class FrozenDate extends RealDate {
    constructor(...args: any[]) { super(...((args.length ? args : [frozen]) as [any])); }
    static now() { return frozen; }
  }
  (globalThis as any).Date = FrozenDate;
  try {
    expect(ok('1700')).toBe('17:00');
    expect(ok('17')).toBe('17:00');
    expect(ok('')).toBe('');                  // an empty field does not become "23:18"
    expect(suggestEndTime('17:00', 180)).toEqual({ ok: true, value: '20:00' });
  } finally {
    (globalThis as any).Date = RealDate;
  }
});

test('the parser cannot read the clock at all — no Date anywhere in the module', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'timeInput.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // comments may mention it
  expect(src).not.toMatch(/\bDate\b/);
  expect(src).not.toMatch(/performance\.now|getHours|getMinutes/);
});

test('a valid stored time is returned unchanged — the parser repairs nothing silently', () => {
  expect(ok('23:18')).toBe('23:18');
  expect(ok('00:19')).toBe('00:19');
  expect(ok('23:17')).toBe('23:17');
});

/* ── Start → end ─────────────────────────────────────────────────────────── */

test('end after start passes; equal or earlier is refused', () => {
  expect(checkTimeRange('17:00', '20:00')).toEqual({ ok: true });
  expect(checkTimeRange('9', '930')).toEqual({ ok: true });
  const same = checkTimeRange('17:00', '17:00');
  expect(same.ok).toBe(false);
  if (!same.ok) expect(same.fix).toBeUndefined();
});

test('"8" after a 17:00 start offers 20:00 — offered, not applied', () => {
  const r = checkTimeRange('17:00', '8');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.fix).toBe('20:00');
  // Nothing sensible to offer when the evening reading is still before the start.
  const r2 = checkTimeRange('21:00', '8');
  expect(r2.ok).toBe(false);
  if (!r2.ok) expect(r2.fix).toBeUndefined();
});

test('nothing to compare when a side is empty or unreadable (the field carries its own error)', () => {
  expect(checkTimeRange('', '20:00')).toEqual({ ok: true });
  expect(checkTimeRange('17:00', '')).toEqual({ ok: true });
  expect(checkTimeRange('25:00', '20:00')).toEqual({ ok: true });
});

test('a suggested end never crosses midnight', () => {
  expect(suggestEndTime('17:00', 180)).toEqual({ ok: true, value: '20:00' });
  expect(suggestEndTime('17', 120)).toEqual({ ok: true, value: '19:00' });
  expect(suggestEndTime('21:59', 120)).toEqual({ ok: true, value: '23:59' });
  expect(suggestEndTime('22:00', 120)).toEqual({ ok: false, reason: 'crosses-midnight' });
  expect(suggestEndTime('23:18', 120)).toEqual({ ok: false, reason: 'crosses-midnight' });
  expect(suggestEndTime('', 120)).toEqual({ ok: false, reason: 'no-start' });
  expect(suggestEndTime('25', 120)).toEqual({ ok: false, reason: 'no-start' });
});

test("the course's usual length is its most common lecture — and the damaged records teach it nothing", () => {
  const lectures = [
    { courseId: 'prac', startTime: '17:00', endTime: '20:00' },
    { courseId: 'prac', startTime: '17:00', endTime: '20:00' },
    { courseId: 'prac', startTime: '18:00', endTime: '19:30' },
    { courseId: 'prac', startTime: '00:19', endTime: '00:21' },   // 2 minutes — damaged
    { courseId: 'prac', startTime: '23:17', endTime: '23:20' },   // 3 minutes — damaged
    { courseId: 'prac', startTime: '23:18', endTime: '00:20' },   // negative — damaged
    { courseId: 'other', startTime: '09:00', endTime: '10:30' },
    { courseId: 'other', startTime: '09:00', endTime: '10:30' },
    { courseId: 'other', startTime: '09:00', endTime: '10:30' },
  ];
  expect(usualDurationMinutes(lectures, 'prac')).toEqual({ minutes: 180, fromCourse: true });
  expect(usualDurationMinutes(lectures, 'other')).toEqual({ minutes: 90, fromCourse: true });
});

test('no course, or no usable lecture in it, falls back to two hours', () => {
  expect(DEFAULT_LECTURE_MINUTES).toBe(120);
  expect(usualDurationMinutes([], 'prac')).toEqual({ minutes: 120, fromCourse: false });
  expect(usualDurationMinutes([{ courseId: 'prac', startTime: '17:00', endTime: '20:00' }], undefined))
    .toEqual({ minutes: 120, fromCourse: false });
  expect(usualDurationMinutes([{ courseId: 'prac', startTime: '00:19', endTime: '00:21' }], 'prac'))
    .toEqual({ minutes: 120, fromCourse: false });
});

test('a tie between two lengths goes to the longer one', () => {
  const lectures = [
    { courseId: 'c', startTime: '10:00', endTime: '11:30' },
    { courseId: 'c', startTime: '10:00', endTime: '13:00' },
  ];
  expect(usualDurationMinutes(lectures, 'c').minutes).toBe(180);
});

/* ── Small helpers ───────────────────────────────────────────────────────── */

test('timeOrEmpty gives a link-ready time or nothing', () => {
  expect(timeOrEmpty('1700')).toBe('17:00');
  expect(timeOrEmpty('25:00')).toBe('');
  expect(timeOrEmpty(undefined)).toBe('');
});

test('minutes round-trip', () => {
  expect(toMinutes('17:30')).toBe(1050);
  expect(fromMinutes(1050)).toBe('17:30');
  expect(fromMinutes(0)).toBe('00:00');
});

test('durations read as a person would say them', () => {
  expect(formatDuration(60)).toBe('שעה');
  expect(formatDuration(90)).toBe('שעה וחצי');
  expect(formatDuration(120)).toBe('שעתיים');
  expect(formatDuration(150)).toBe('שעתיים וחצי');
  expect(formatDuration(180)).toBe('3 שעות');
  expect(formatDuration(210)).toBe('3.5 שעות');
  expect(formatDuration(45)).toBe('45 דק׳');
});

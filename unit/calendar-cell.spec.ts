import { test, expect } from '@playwright/test';
import { buildAcademicDayMap } from '../src/lib/academicCalendar';
import { buildLectureDayMap } from '../src/lib/lectureCalendar';
import {
  buildTodoMap, cellModel, courseKindOf, examLabel, lectureTodoKey, offDayLabel, sessionConflicts,
} from '../src/lib/calendarCell';
import type { Lecture } from '../src/lib/supabase';

/* Yariv 2026-10-02 — the month grid after five rounds of mock-ups. The rules below are
 * the ones he approved; each test names the sentence it pins. */

const dayMap = buildAcademicDayMap();
const lec = (o: Partial<Lecture>): Lecture => ({ id: 'l1', courseId: 'hr', year: 'תשפ״ז', date: '2026-11-26',
  startTime: '09:30', endTime: '11:00', topic: 'מקורות גיוס', lecturer: 'למא אבו אחמד', status: 'טנטטיבי', ...o } as Lecture);
const cell = (iso: string, lectures: Lecture[] = [], today = '2026-10-02', done = {}) => {
  const lm = buildLectureDayMap(lectures);
  const todos = buildTodoMap(dayMap, lm, today);
  return cellModel({ academic: dayMap.get(iso) ?? [], lectures: lm.get(iso) ?? [], todos: todos.get(iso) ?? [], done, other: [] });
};

test('his three courses, by their names — "פרקטיקום מש״א, פרקטיקום ייעוץ ומיומנויות ייעוץ"', () => {
  expect(courseKindOf('skA')).toBe('skills');
  expect(courseKindOf('semB')).toBe('hr');
  expect(courseKindOf('prA')).toBe('consult');
  expect(cell('2026-11-03')).toMatchObject({ fill: 'course', label: 'מיומנויות ייעוץ' });
  expect(cell('2026-11-06')).toMatchObject({ fill: 'course', label: 'פרקטיקום ייעוץ' });
  expect(cell('2026-11-29')).toMatchObject({ fill: 'course', label: 'פרקטיקום מש״א' });
});

test('a day off says WHICH day off — "חופשת בחירות, חופשת יום העצמאות"', () => {
  expect(offDayLabel('יום הבחירות — אין לימודים')).toBe('חופשת בחירות');
  expect(offDayLabel('יום הזיכרון ויום העצמאות — אין לימודים')).toBe('חופשת יום העצמאות');
  expect(cell('2026-12-10')).toMatchObject({ fill: 'off', label: 'חופשת חנוכה' });
  expect(cell('2026-11-19')).toMatchObject({ fill: 'off', label: 'חופשה באילת' });
});

test('exam windows say מועד א׳ / מועד ב׳ — the distinction Ariel prints', () => {
  expect(examLabel('מועדי בחינות סמסטר א׳ — מועד ב׳')).toBe('מועד ב׳');
  expect(cell('2027-01-20')).toMatchObject({ fill: 'exam', label: 'מועד א׳' });
  expect(cell('2027-02-15')).toMatchObject({ fill: 'exam', label: 'מועד ב׳' });
});

test('a class on his vacation is a conflict that says להזיז', () => {
  const c = cell('2026-11-20');
  expect(c.conflict).toBe(true);
  expect(c.chips[0]).toMatchObject({ kind: 'move', text: 'להזיז' });
  expect(sessionConflicts(dayMap).map((x) => x.iso)).toContain('2026-11-20');
});

test('a guest lecture on a shut day is a conflict too — "הרצאת אורח ביום חסום היא התנגשות"', () => {
  const c = cell('2026-12-10', [lec({ date: '2026-12-10' })]);
  expect(c.conflict).toBe(true);
  expect(c.chips[0].kind).toBe('move');
});

test('green says מאושר; on the lecture day a pending one says ממתין', () => {
  expect(cell('2026-11-26', [lec({ status: 'מאושר' })]).chips.map((c) => c.text)).toEqual(['מאושר']);
  expect(cell('2026-11-26', [lec({})]).chips.map((c) => c.text)).toContain('ממתין');
});

test('לתאם comes 14 days ahead, not on the day — "לתאם יום לפני הוא לא רלוונטי"', () => {
  const lectures = [lec({})];   // 26.11, pending
  expect(cell('2026-11-12', lectures).chips.map((c) => c.text)).toContain('לתאם');
  expect(cell('2026-11-26', lectures).chips.map((c) => c.text)).not.toContain('לתאם');
  // once the lead day has passed, it rides on today
  expect(cell('2026-11-20', lectures, '2026-11-20').chips.map((c) => c.text)).toContain('לתאם');
});

test('marking it תואם removes it from the grid', () => {
  const lectures = [lec({})];
  const doneMap = { [lectureTodoKey('l1')]: { status: 'done' as const, by: 'יריב', at: '2026-11-01' } };
  expect(cell('2026-11-12', lectures, '2026-10-02', doneMap).chips.map((c) => c.text)).not.toContain('לתאם');
});

test('no swap to coordinate any more (simulations back in the evening, 3.10), and a simulation keeps its course', () => {
  expect(cell('2026-11-24').chips.map((c) => c.text)).not.toContain('לתאם');
  expect(cell('2026-12-08')).toMatchObject({ fill: 'course', course: 'skills', simulation: true });
});

/* Yariv 2026-10-03, on 1.12 (איילה's workshop + a tentative simulation, both 19:00):
 * "כן תוסיף" — 🎭 for a simulation lecture, and a warning when two share hours. */
const ayala = lec({ id: 'ay', date: '2026-12-01', startTime: '19:00', endTime: '21:00', topic: 'מיומנויות קריטיות', lecturer: 'איילה ראובן ללונג' });
const sim1 = lec({ id: 'sm', date: '2026-12-01', startTime: '19:00', endTime: '20:30', topic: 'סימולציית כניסה לארגון', lecturer: 'מרכז סימולציות' });

test('a simulation lecture puts 🎭 on the day, even where the session is an ordinary one', () => {
  expect(cell('2026-12-01').simulation).toBe(false);
  expect(cell('2026-12-01', [sim1]).simulation).toBe(true);
  expect(cell('2026-12-01', [ayala]).simulation).toBe(false);
  expect(cell('2026-12-01', [{ ...sim1, status: 'בוטל' } as Lecture]).simulation).toBe(false);
});

test('two live lectures in the same hours are an overlap — until one is cancelled', () => {
  expect(cell('2026-12-01', [ayala, sim1]).overlap).toBe(true);
  expect(cell('2026-12-01', [ayala, { ...sim1, status: 'בוטל' } as Lecture]).overlap).toBe(false);
  expect(cell('2026-12-01', [ayala, { ...sim1, startTime: '21:00', endTime: '22:00' } as Lecture]).overlap).toBe(false);
  expect(cell('2026-12-01', [ayala]).overlap).toBe(false);
});

import { test, expect } from '@playwright/test';
import { desiredGoogleEvents } from '../src/lib/gcalModel';
import type { Lecture, PracticumData } from '../src/lib/supabase';

/* Yariv 2026-10-02: "כל שינוי יכנס לגוגל — אם אני מזיז הרצאה שתעודכן גם בגוגל".
 * The sync reconciles Google to this list by key, so the list's KEYS are the contract. */

const lec = (o: Partial<Lecture>): Lecture => ({ id: 'l1', date: '2026-11-26', startTime: '09:30', endTime: '11:00',
  topic: 'מקורות גיוס', lecturer: 'למא אבו אחמד', status: 'מאושר', courseName: 'פרקטיקום' , ...o } as Lecture);
const ev = (data: PracticumData, today = '2026-10-02') => desiredGoogleEvents(data, today);

test('an approved lecture is one timed event, keyed by the lecture id', () => {
  const e = ev({ lectures: [lec({})] }).find((x) => x.key === 'lec:l1')!;
  expect(e.summary).toContain('✓');
  expect(e.summary).toContain('מקורות גיוס');
  expect(e.start).toEqual({ dateTime: '2026-11-26T09:30:00', timeZone: 'Asia/Jerusalem' });
  expect(e.end).toEqual({ dateTime: '2026-11-26T11:00:00', timeZone: 'Asia/Jerusalem' });
  expect(e.colorId).toBe('10');
});

test('moving a lecture keeps its key — Google moves the event instead of adding one', () => {
  const before = ev({ lectures: [lec({})] }).filter((x) => x.key.startsWith('lec:'));
  const after = ev({ lectures: [lec({ date: '2026-12-03' })] }).filter((x) => x.key.startsWith('lec:'));
  expect(after.map((x) => x.key)).toEqual(before.map((x) => x.key));
  expect((after[0].start as any).dateTime.slice(0, 10)).toBe('2026-12-03');
});

test('a cancelled lecture is not in Google', () => {
  expect(ev({ lectures: [lec({ status: 'בוטל' })] }).some((x) => x.key === 'lec:l1')).toBe(false);
});

test('a pending lecture says ממתין and raises a לתאם 14 days ahead, until marked תואם', () => {
  const data: PracticumData = { lectures: [lec({ status: 'טנטטיבי' })] };
  const list = ev(data);
  expect(list.find((x) => x.key === 'lec:l1')!.summary).toContain('ממתין');
  const todo = list.find((x) => x.key === 'todo:lec:l1')!;
  expect(todo.start).toEqual({ date: '2026-11-12' });
  const done = ev({ ...data, calendarDone: { 'lec:l1': { status: 'done', by: 'יריב', at: 'x' } } });
  expect(done.some((x) => x.key === 'todo:lec:l1')).toBe(false);
});

test('his vacation is mirrored as one all-day span', () => {
  const v = ev({}).find((x) => x.key.startsWith('away:'))!;
  expect(v.summary).toContain('חופשה באילת');
  expect(v.start).toEqual({ date: '2026-11-18' });
  expect(v.end).toEqual({ date: '2026-11-22' });   // Google's end date is exclusive
});

test('the list is deterministic — same input, same order', () => {
  const d: PracticumData = { lectures: [lec({}), lec({ id: 'l0', date: '2026-12-01' })] };
  expect(ev(d).map((x) => x.key)).toEqual(ev(d).map((x) => x.key));
});

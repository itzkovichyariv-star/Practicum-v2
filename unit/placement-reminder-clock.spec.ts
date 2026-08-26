import { test, expect } from '@playwright/test';
import { placementStatus, SILENCE_DAYS, DECISION_DAYS, MAX_REMINDERS } from '../src/lib/placementStatus';

/**
 * The reminder clock.
 *
 * Yariv 2026-08-26: "it is not updated, stays in תזכר mode after reminder was submitted."
 *
 * Confirming a reminder wrote `remindedAt` and bumped `reminders`, but staleness was
 * measured from `sentAt` alone — so the row dropped straight back into `sent_stale` with
 * a "תזכר" button and stayed there until MAX_REMINDERS was exhausted. The confirmation
 * bar promises "השעון יתחיל מחדש" in so many words.
 *
 * Two clocks now, and these tests exist to keep them apart:
 *   sent  — when the CV left. Never moves. Drives the "נשלח לפני X" label and "no answer".
 *   quiet — when we last made contact, reminder included. Drives whether it is our turn.
 */

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-26T10:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

const COURSE = { id: 'c1', name: 'פרקטיקום משאבי אנוש', type: 'practicum' };
const EMPLOYERS = [
  { id: 'e1', name: 'UCL Group', contactPhone: '0547820993', contactEmail: 'a@ucl.co.il' },
  { id: 'e2', name: 'Acme', contactPhone: '0501112222', contactEmail: 'b@acme.co.il' },
];

const student = (over: Record<string, any> = {}) => ({
  id: 's1', name: 'עינה נוימן', courseId: 'c1', cvUpdatedUrl: 'https://example.com/cv.pdf',
  preferences: [{ rank: 1, orgName: 'UCL Group', employerId: 'e1', status: 'under_review', slotId: 'e1-s1' }],
  ...over,
});

const dispatch = (over: Record<string, any> = {}) => ({
  dispatchId: 'd1', studentId: 's1', employerId: 'e1', slotId: 'e1-s1',
  result: 'pending', sentAt: daysAgo(20), ...over,
});

const statusOf = (s: any, dispatches: any[]) =>
  placementStatus({ student: s, employers: EMPLOYERS, dispatches, course: COURSE, now: NOW });

test('THE BUG: a CV out past the silence threshold asks us to remind', () => {
  const st = statusOf(student(), [dispatch()]);
  expect(st?.key).toBe('sent_stale');
  expect(st?.action?.id).toBe('remind');
});

test('THE FIX: a confirmed reminder restarts the clock and drops the תזכר button', () => {
  const st = statusOf(student(), [dispatch({ remindedAt: daysAgo(1), reminders: 1 })]);
  expect(st?.key).not.toBe('sent_stale');
  expect(st?.action?.id).not.toBe('remind');
});

test('THE POINT: after reminding, the row says the ball is with the employer', () => {
  // Yariv 2026-08-26: "מדוע בפרקטיקום אם הזכרתי למעסיק אני לא אראה עדכון שאומר
  // שהכדור אצל המעסיק". This is the assertion that answers it — `turn` is what the
  // row's coloured dot reads (TURN_LABEL.employer === 'אצל המעסיק'). Before the fix a
  // reminded row stayed turn:'ours' with a red dot, still demanding action from us.
  const before = statusOf(student(), [dispatch()]);
  expect(before?.turn).toBe('ours');

  const after = statusOf(student(), [dispatch({ remindedAt: daysAgo(1), reminders: 1 })]);
  expect(after?.turn).toBe('employer');
  expect(after?.headline).toContain('ממתין לתשובת המעסיק');
});

test('the clock restarts, it does not stop — silence past the threshold AGAIN asks to remind', () => {
  const st = statusOf(student(), [dispatch({ sentAt: daysAgo(40), remindedAt: daysAgo(SILENCE_DAYS + 1), reminders: 1 })]);
  expect(st?.key).toBe('sent_stale');
  expect(st?.action?.id).toBe('remind');
});

test('the label still reports when the CV went out, not when we last chased', () => {
  // Reminded yesterday, but the CV has been out 20 days — the chip must say 20, or the
  // reminder would appear to un-send the application.
  const st = statusOf(student(), [dispatch({ sentAt: daysAgo(20), remindedAt: daysAgo(1), reminders: 1 })]);
  const chip = st?.chips.find(c => c.orgName === 'UCL Group');
  expect(chip?.suffix).toContain('20');
  expect(chip?.tone).not.toBe('late'); // ...but it is no longer shouting
});

test('a reminder does NOT rescue an employer who is simply out of road', () => {
  // The "no answer for 45+ days" clock measures the wait itself. Nudging them yesterday
  // does not make a 60-day silence fresh.
  const st = statusOf(student(), [dispatch({ sentAt: daysAgo(60), remindedAt: daysAgo(1), reminders: 1 })]);
  expect(st?.key).toBe('no_response');
});

test('reminding one employer must not silence another we never contacted', () => {
  // The confirmation used to stamp every pending dispatch for the student. Harmless while
  // nothing read remindedAt; now it would hide a genuinely stale second organization.
  const s = student({
    preferences: [
      { rank: 1, orgName: 'UCL Group', employerId: 'e1', status: 'under_review', slotId: 'e1-s1' },
      { rank: 2, orgName: 'Acme', employerId: 'e2', status: 'under_review', slotId: 'e2-s1' },
    ],
  });
  const st = statusOf(s, [
    dispatch({ dispatchId: 'd1', employerId: 'e1', slotId: 'e1-s1', sentAt: daysAgo(20), remindedAt: daysAgo(1), reminders: 1 }),
    dispatch({ dispatchId: 'd2', employerId: 'e2', slotId: 'e2-s1', sentAt: daysAgo(20) }),
  ]);
  expect(st?.key).toBe('sent_stale');
  expect(st?.action?.id).toBe('remind');
});

test('after the interview, a fresh reminder hands the ball back to the employer', () => {
  const s = student({ placementInterviewDate: '2026-08-06', placementInterviewOrg: 'UCL Group' });
  const chased = statusOf(s, [dispatch({ remindedAt: daysAgo(1), reminders: 1 })]);
  expect(chased?.key).toBe('awaiting_decision');
  expect(chased?.turn).toBe('employer');
  expect(chased?.action?.id).not.toBe('remind');

  const notChased = statusOf(s, [dispatch()]);
  expect(notChased?.turn).toBe('ours');
  expect(notChased?.action?.id).toBe('remind');
});

test('post-interview: a reminder older than the decision window is our turn again', () => {
  const s = student({ placementInterviewDate: '2026-08-06', placementInterviewOrg: 'UCL Group' });
  const st = statusOf(s, [dispatch({ remindedAt: daysAgo(DECISION_DAYS + 1), reminders: 1 })]);
  expect(st?.turn).toBe('ours');
  expect(st?.action?.id).toBe('remind');
});

test('exhausting the reminders still stops the nagging', () => {
  const st = statusOf(student(), [dispatch({ sentAt: daysAgo(30), remindedAt: daysAgo(SILENCE_DAYS + 1), reminders: MAX_REMINDERS })]);
  expect(st?.action?.id).not.toBe('remind');
});

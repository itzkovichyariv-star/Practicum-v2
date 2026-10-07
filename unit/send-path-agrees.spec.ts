import { test, expect } from '@playwright/test';
import { placementStatus } from '../src/lib/placementStatus';
import { planDispatch } from '../src/lib/dispatch';

/**
 * The row and the planner must agree about whether a CV can go to an organization.
 *
 * Yariv 2026-09-14, sending נטע's CV to UCL Group over WhatsApp from the students list:
 * the chip read "טרם נשלח", the confirmation showed the contact (יובל ליבנה) and her
 * number, and the send still came back with "no organization". The strip decides that
 * a place is free by the preference's employerId; the planner then looked the employer
 * up again BY NAME only. Whenever the two disagree, the coordinator is shown a sendable
 * organization and refused when they act on it.
 */

const course = { id: 'c1', name: 'פרקטיקום משאבי אנוש', type: 'practicum' };
const settings = {
  whatsappTemplate: 'שלום {contactName}, מצורפים קו״ח של {studentName}: {cvLink}',
  emailSubjectTemplate: 'קו״ח {studentName}', emailBodyTemplate: '{cvLink}',
};

const employer = (over: any = {}) => ({
  id: 'e-ucl', name: 'UCL Group', contactPerson: 'יובל ליבנה', contactPhone: '052-1234567',
  contactEmail: 'yuval@ucl.example',
  vacancySlots: [{ id: 'sl-1', courseId: 'c1', status: 'available', history: [] }],
  ...over,
});
const student = (over: any = {}) => ({
  id: 's-neta', name: 'נטע נידם', courseId: 'c1', cvUpdatedUrl: 'https://cv.example/neta.pdf',
  preferences: [{ rank: 1, orgName: 'UCL Group', employerId: 'e-ucl', interviewResult: 'pending', status: 'tentative', slotId: null }],
  ...over,
});

function rowAndPlanner(s: any, employers: any[]) {
  const st = placementStatus({ student: s, employers, dispatches: [], pending: null, course } as any)!;
  const chip = st.chips.find(c => c.orgName === 'UCL Group')!;
  const plan = planDispatch({
    student: s, employers, orgNames: ['UCL Group'], channel: 'whatsapp', courseId: 'c1',
    courseName: course.name, cvLink: s.cvUpdatedUrl, userName: 'יריב', settings,
  });
  return { st, chip, plan };
}

test('baseline: a clean record sends', () => {
  const { chip, plan } = rowAndPlanner(student(), [employer()]);
  expect(chip.available).toBe(true);
  expect(plan.blockedReason).toBe('');
  expect(plan.skipped).toEqual([]);
  expect(plan.entries.map(e => e.employerId)).toEqual(['e-ucl']);
  expect(plan.entries[0].recipient).toBe('052-1234567');
});

test('THE BUG: the employer is linked by id but its name no longer matches the ranking', () => {
  // The employer record was renamed after the preference was built (or its name carries
  // a pasted direction mark) — the id still links, the name does not.
  for (const name of ['‎UCL Group', 'UCL-Group', 'יו.סי.אל גרופ']) {
    const { chip, plan } = rowAndPlanner(student(), [employer({ name })]);
    expect(chip.available, name).toBe(true);           // the row offers it…
    expect(plan.blockedReason, name).toBe('');
    expect(plan.skipped, name).toEqual([]);             // …so the planner must not refuse it
    expect(plan.entries.map(e => e.employerId), name).toEqual(['e-ucl']);
  }
});

test('THE BUG: a preference still holds a slot id that the employer no longer has', () => {
  // Left behind by a repair or a capacity change. The row treated "has a slotId" as
  // "has a place" without looking; the planner looked, found nothing, and refused.
  const s = student({ preferences: [{ rank: 1, orgName: 'UCL Group', employerId: 'e-ucl', interviewResult: 'pending', status: 'tentative', slotId: 'sl-gone' }] });
  const full = employer({ vacancySlots: [{ id: 'sl-1', courseId: 'c1', status: 'under_review', studentId: 's-other', history: [] }] });
  const { chip, plan } = rowAndPlanner(s, [full]);
  // No place exists for her: the row must say so, and the planner must agree.
  expect(chip.available).toBe(false);
  expect(plan.entries).toEqual([]);
  // And when a place IS free, the dangling id must not stop the send.
  const free = employer();
  const r2 = rowAndPlanner(s, [free]);
  expect(r2.chip.available).toBe(true);
  expect(r2.plan.skipped).toEqual([]);
  expect(r2.plan.entries.map(e => e.slotId)).toEqual(['sl-1']);
});

test('the planner names the organization it refuses, and why', () => {
  const s = student({ preferences: [{ rank: 1, orgName: 'UCL Group', employerId: null, interviewResult: 'pending', status: 'under_review', slotId: null }] });
  const plan = planDispatch({
    student: s, employers: [employer()], orgNames: ['UCL Group'], channel: 'whatsapp', courseId: 'c1',
    cvLink: s.cvUpdatedUrl, userName: 'יריב', settings,
  });
  expect(plan.entries).toEqual([]);
  expect(plan.blockedReason).toContain('UCL Group');
});

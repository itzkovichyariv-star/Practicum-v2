import { test, expect } from '@playwright/test';
import { dropOrg } from '../src/lib/dispatch';

/**
 * The ✕ on a blocked organization erased the student's ENTIRE ranking.
 *
 * `dropOrg` was the only placement writer that read `preferences[]` raw instead of
 * materialising the unified list first. A student whose organizations still live only in
 * the legacy firstChoiceOrg/second/third fields has an EMPTY preferences array — which
 * is every student until their first CV goes out — so "everything except the dropped
 * one" came out empty, and the write-back then blanked all three legacy fields.
 *
 * One click. No warning. A success toast. Saved to the cloud. And the ✕ is offered
 * exactly on a FULL organization, which is the commonest reason to want it gone.
 */

const employers: any = [
  { id: 'e1', name: 'איקון גרופ', vacancySlots: [] },
  { id: 'e2', name: 'נישה פרו', vacancySlots: [] },
  { id: 'e3', name: 'TLVtech', vacancySlots: [] },
];

test('THE DATA LOSS: dropping one organization kept the other two', () => {
  // A student straight out of "adopt": three ranked choices, nothing materialised yet.
  const student: any = {
    id: 's1', name: 'הדר עוזירי', courseId: 'c1', preferences: [],
    firstChoiceOrg: 'איקון גרופ', secondChoiceOrg: 'נישה פרו', thirdChoiceOrg: 'TLVtech',
    firstChoiceResult: 'pending', secondChoiceResult: 'pending', thirdChoiceResult: 'pending',
  };
  const { student: after } = dropOrg({ student, employers, orgName: 'איקון גרופ', userName: 'יריב' });
  expect(after.preferences.map((p: any) => p.orgName)).toEqual(['נישה פרו', 'TLVtech']);
  expect(after.firstChoiceOrg).toBe('נישה פרו');
  expect(after.secondChoiceOrg).toBe('TLVtech');
  expect(after.thirdChoiceOrg).toBe('');
});

test('a partially materialised student keeps the choices that were never built', () => {
  const student: any = {
    id: 's2', name: 'רות', courseId: 'c1',
    preferences: [{ rank: 1, orgName: 'איקון גרופ', employerId: 'e1', interviewResult: 'pending', status: 'tentative', slotId: null }],
    firstChoiceOrg: 'איקון גרופ', secondChoiceOrg: 'נישה פרו', thirdChoiceOrg: 'TLVtech',
  };
  const { student: after } = dropOrg({ student, employers, orgName: 'TLVtech', userName: 'יריב' });
  expect(after.preferences.map((p: any) => p.orgName)).toEqual(['איקון גרופ', 'נישה פרו']);
});

test('the interview result travels with the organization, never with the rank', () => {
  const student: any = {
    id: 's3', name: 'דנה', courseId: 'c1', preferences: [],
    firstChoiceOrg: 'איקון גרופ', secondChoiceOrg: 'נישה פרו', thirdChoiceOrg: 'TLVtech',
    firstChoiceResult: 'failed', secondChoiceResult: 'passed', thirdChoiceResult: 'pending',
  };
  const { student: after } = dropOrg({ student, employers, orgName: 'איקון גרופ', userName: 'יריב' });
  const byName = Object.fromEntries(after.preferences.map((p: any) => [p.orgName, p.interviewResult]));
  expect(byName['נישה פרו']).toBe('passed');
  expect(byName['TLVtech']).toBe('pending');
});

test('dropping the only organization does leave an empty list', () => {
  const student: any = { id: 's4', name: 'יעל', courseId: 'c1', preferences: [], firstChoiceOrg: 'נישה פרו' };
  const { student: after } = dropOrg({ student, employers, orgName: 'נישה פרו', userName: 'יריב' });
  expect(after.preferences).toEqual([]);
  expect(after.firstChoiceOrg).toBe('');
});

test("the dropped organization's reserved place is freed", () => {
  const withSlot: any = [{ id: 'e1', name: 'איקון גרופ',
    vacancySlots: [{ id: 'sl1', courseId: 'c1', status: 'under_review', studentId: 's5', history: [] }] }];
  const student: any = { id: 's5', name: 'נועה', courseId: 'c1',
    preferences: [{ rank: 1, orgName: 'איקון גרופ', employerId: 'e1', interviewResult: 'pending', status: 'under_review', slotId: 'sl1' }] };
  const { employers: after } = dropOrg({ student, employers: withSlot, orgName: 'איקון גרופ', userName: 'יריב' });
  expect(after[0].vacancySlots?.[0].status).toBe('available');
  expect(after[0].vacancySlots?.[0].studentId).toBe(null);
});

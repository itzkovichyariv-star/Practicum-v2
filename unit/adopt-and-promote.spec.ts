import { test, expect } from '@playwright/test';
import { adoptSubmittedOrgs, promoteOrgToFirst, buildUnifiedOrgList } from '../src/lib/placement';

/**
 * Two writes that went straight to the legacy choice fields while everything that reads
 * them goes through the unified list. The result was a ranking that did not say what the
 * screen had just promised.
 */

const employers: any = [
  { id: 'e1', name: 'איקון גרופ' }, { id: 'e2', name: 'נישה פרו' },
  { id: 'e3', name: 'TLVtech' }, { id: 'e4', name: 'Codeoasis' },
];
const names = (s: any) => buildUnifiedOrgList(s, employers).map(p => p.orgName);

test('THE BUG: an adopted list used to land BELOW the ranking already there', () => {
  // Anyone who has had one CV sent has a materialised preference, and the unified list
  // puts those first — so the newly submitted organizations were appended after them.
  const student: any = {
    id: 's1', name: 'הדר', courseId: 'c1',
    preferences: [{ rank: 1, orgName: 'איקון גרופ', employerId: 'e1', interviewResult: 'pending', status: 'under_review', slotId: 'sl1' }],
  };
  const after = adoptSubmittedOrgs(student, employers, ['Codeoasis', 'נישה פרו']);
  expect(names(after).slice(0, 2)).toEqual(['Codeoasis', 'נישה פרו']);
});

test('an organization already in the ranking keeps its place, its result and its slot', () => {
  const student: any = {
    id: 's2', name: 'רות', courseId: 'c1',
    preferences: [{ rank: 1, orgName: 'איקון גרופ', employerId: 'e1', interviewResult: 'passed', status: 'under_review', slotId: 'sl1' }],
  };
  const after = adoptSubmittedOrgs(student, employers, ['איקון גרופ', 'TLVtech']);
  const icon = after.preferences.find((p: any) => p.orgName === 'איקון גרופ');
  expect(icon.interviewResult).toBe('passed');
  expect(icon.status).toBe('under_review');
  expect(icon.slotId).toBe('sl1');
  expect(icon.rank).toBe(1);
});

test('an organization the student did NOT resubmit is kept, never dropped', () => {
  // It may be holding a reserved place. Dropping it would leak that place.
  const student: any = {
    id: 's3', name: 'דנה', courseId: 'c1',
    preferences: [{ rank: 1, orgName: 'איקון גרופ', employerId: 'e1', interviewResult: 'pending', status: 'under_review', slotId: 'sl1' }],
  };
  const after = adoptSubmittedOrgs(student, employers, ['Codeoasis']);
  expect(names(after)).toEqual(['Codeoasis', 'איקון גרופ']);
  expect(after.preferences.find((p: any) => p.orgName === 'איקון גרופ').slotId).toBe('sl1');
});

test('a legacy-only student adopts cleanly, and the legacy fields follow', () => {
  const student: any = { id: 's4', name: 'יעל', courseId: 'c1', preferences: [], firstChoiceOrg: 'TLVtech' };
  const after = adoptSubmittedOrgs(student, employers, ['נישה פרו', 'Codeoasis']);
  expect(names(after)).toEqual(['נישה פרו', 'Codeoasis', 'TLVtech']);
  expect(after.firstChoiceOrg).toBe('נישה פרו');
  expect(after.secondChoiceOrg).toBe('Codeoasis');
  expect(after.thirdChoiceOrg).toBe('TLVtech');
});

test('the same organization submitted twice is still one card', () => {
  const student: any = { id: 's5', name: 'נועה', courseId: 'c1', preferences: [] };
  const after = adoptSubmittedOrgs(student, employers, ['נישה פרו', 'נישה פרו']);
  expect(names(after)).toEqual(['נישה פרו']);
});

test('THE BUG: approving a suggested organization used to overwrite the first choice', () => {
  const student: any = { id: 's6', name: 'אורי', courseId: 'c1', preferences: [], firstChoiceOrg: 'איקון גרופ', secondChoiceOrg: 'TLVtech' };
  const after = promoteOrgToFirst(student, employers, 'ארגון שהצעתי', 'e-priv');
  expect(names(after)).toEqual(['ארגון שהצעתי', 'איקון גרופ', 'TLVtech']);
  expect(after.firstChoiceOrg).toBe('ארגון שהצעתי');
  expect(after.preferences[0].employerId).toBe('e-priv');
});

test('promoting an organization already ranked moves it up and keeps what it holds', () => {
  const student: any = {
    id: 's7', name: 'שיר', courseId: 'c1',
    preferences: [
      { rank: 1, orgName: 'איקון גרופ', employerId: 'e1', interviewResult: 'pending', status: 'tentative', slotId: null },
      { rank: 2, orgName: 'Codeoasis', employerId: 'e4', interviewResult: 'passed', status: 'under_review', slotId: 'sl9' },
    ],
  };
  const after = promoteOrgToFirst(student, employers, 'Codeoasis');
  expect(names(after)).toEqual(['Codeoasis', 'איקון גרופ']);
  expect(after.preferences[0].slotId).toBe('sl9');
  expect(after.preferences[0].interviewResult).toBe('passed');
});

test('promoting nothing changes nothing', () => {
  const student: any = { id: 's8', name: 'טל', courseId: 'c1', preferences: [], firstChoiceOrg: 'TLVtech' };
  expect(promoteOrgToFirst(student, employers, '   ')).toBe(student);
});

// ── the place a corrected placement leaves behind ────────────────────────────
import { releaseStudentSlotAt, occupyAcceptedOrgSlot } from '../src/lib/placement';

test('changing the hosting organization frees the place at the one being left', () => {
  const emps: any = [
    { id: 'eA', name: 'ארגון א', vacancySlots: [{ id: 'a1', courseId: 'c1', status: 'placed', studentId: 's9', history: [] }] },
    { id: 'eB', name: 'ארגון ב', vacancySlots: [{ id: 'b1', courseId: 'c1', status: 'available', studentId: null, history: [] }] },
  ];
  const student: any = { id: 's9', name: 'עדי', courseId: 'c1', acceptedOrg: 'ארגון ב' };
  const freed: any = releaseStudentSlotAt(student, emps, 'ארגון א', { actorId: 'יריב' });
  expect(freed[0].vacancySlots[0].status).toBe('available');
  expect(freed[0].vacancySlots[0].studentId).toBe(null);
  const after: any = occupyAcceptedOrgSlot(student, freed, { actorId: 'יריב' });
  expect(after[1].vacancySlots[0].status).toBe('placed');
  expect(after[1].vacancySlots[0].studentId).toBe('s9');
});

test('releasing touches only this student, and only a place actually held', () => {
  const emps: any = [{ id: 'eA', name: 'ארגון א', vacancySlots: [
    { id: 'a1', courseId: 'c1', status: 'placed', studentId: 'someone-else', history: [] },
    { id: 'a2', courseId: 'c1', status: 'available', studentId: null, history: [] },
  ] }];
  const student: any = { id: 's9', name: 'עדי', courseId: 'c1' };
  expect(releaseStudentSlotAt(student, emps, 'ארגון א', { actorId: 'יריב' })).toBe(emps);
});

test('releasing is safe to repeat', () => {
  const emps: any = [{ id: 'eA', name: 'ארגון א', vacancySlots: [{ id: 'a1', courseId: 'c1', status: 'placed', studentId: 's9', history: [] }] }];
  const student: any = { id: 's9', name: 'עדי', courseId: 'c1' };
  const once = releaseStudentSlotAt(student, emps, 'ארגון א', { actorId: 'יריב' });
  expect(releaseStudentSlotAt(student, once, 'ארגון א', { actorId: 'יריב' })).toBe(once);
});

test('a failed interview closes the organization instead of chasing the employer', async () => {
  const { placementStatus } = await import('../src/lib/placementStatus');
  const employers: any = [{ id: 'e1', name: 'Codeoasis',
    vacancySlots: [{ id: 'sl1', courseId: 'c1', status: 'under_review', studentId: 's1', history: [] }] }];
  const student: any = {
    id: 's1', name: 'נטע', courseId: 'c1', cvUpdatedUrl: 'https://cv/x.pdf',
    preferences: [{ rank: 1, orgName: 'Codeoasis', employerId: 'e1', interviewResult: 'failed', status: 'under_review', slotId: 'sl1' }],
  };
  const dispatches = [{ id: 'd1', studentId: 's1', employerId: 'e1', slotId: 'sl1', result: 'pending',
    sentAt: new Date(Date.now() - 40 * 86400000).toISOString(), reminders: 0 }];
  const st = placementStatus({ student, employers, dispatches, pending: null, course: { id: 'c1', type: 'practicum' } } as any)!;
  expect(st.action?.id).not.toBe('remind');           // it no longer chases a "no"
  expect(st.chips.some(c => c.tone === 'dead')).toBe(true);
  expect(st.chips.find(c => c.tone === 'dead')?.suffix).toContain('לא עבר ראיון');
  expect(st.chips.find(c => c.tone === 'dead')?.suffix).toContain('המקום עדיין תפוס');
});

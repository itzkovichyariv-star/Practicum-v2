import { test, expect } from '@playwright/test';
import { placementStatus, remindableChips } from '../src/lib/placementStatus';
import { resolveEmployerFor } from '../src/lib/placement';

/**
 * "עיריית אריאל … כתוב שאין מייל ואין טלפון אבל זה לא נכון. בדף המעסיק … יש גם טלפון
 * וגם מייל" — Yariv, 2026-09-15.
 *
 * Nothing was wrong with the employer. The row's strip built its target list ONLY for
 * send_cv / place_direct rows. On a REMIND row that list was empty, so the confirmation
 * dialog had no organization to look up, and it reported the empty lookup as the
 * employer having no contact details — with both channel buttons dead, so the reminder
 * could not be sent at all.
 */

const course = { id: 'c1', name: 'פרקטיקום משאבי אנוש', type: 'practicum' };
const DAY = 86400000;

const ariel = {
  id: 'e-ariel', name: 'עיריית אריאל',
  contactPerson: 'רונית לוי', contactPhone: '03-9061111', contactEmail: 'hr@ariel.muni.il',
  vacancySlots: [{ id: 'sl-a', courseId: 'c1', status: 'under_review', studentId: 's-1', history: [] }],
};
const student = {
  id: 's-1', name: 'דנה כהן', courseId: 'c1', cvUpdatedUrl: 'https://cv.example/dana.pdf',
  preferences: [{ rank: 1, orgName: 'עיריית אריאל', employerId: 'e-ariel', interviewResult: 'pending', status: 'under_review', slotId: 'sl-a' }],
};
const dispatches = [{ id: 'd1', studentId: 's-1', employerId: 'e-ariel', slotId: 'sl-a', result: 'pending', sentAt: new Date(Date.now() - 20 * DAY).toISOString(), reminders: 0 }];

const status = () => placementStatus({ student, employers: [ariel], dispatches, pending: null, course } as any)!;

test('the row asks to remind — the CV has been out 20 days with no answer', () => {
  expect(status().action?.id).toBe('remind');
});

test('THE BUG: the dialog was handed a target list built only for SEND rows', () => {
  // The strip's old expression, verbatim: the list is gated on the row's own action
  // being send_cv or place_direct. On a remind row it is empty whatever the chips say,
  // so the dialog looked up nothing and blamed the employer for the empty result.
  const st = status();
  const oldTargets = st.chips.filter(c => c.available && (st.action?.id === 'send_cv' || st.action?.id === 'place_direct'));
  expect(oldTargets).toEqual([]);
});

test('THE FIX: a reminder targets the organization already awaiting an answer', () => {
  const targets = remindableChips(status().chips);
  expect(targets.map(c => c.orgName)).toEqual(['עיריית אריאל']);
});

test('and that target resolves to the employer WITH its phone and email', () => {
  const chip = remindableChips(status().chips)[0];
  const emp = resolveEmployerFor({ employerId: chip.employerId ?? null, orgName: chip.orgName }, [ariel]);
  expect(emp?.name).toBe('עיריית אריאל');
  expect(emp?.contactPhone).toBe('03-9061111');   // the dialog's WhatsApp button
  expect(emp?.contactEmail).toBe('hr@ariel.muni.il'); // the dialog's mail button
});

test('late organizations are offered before merely-sent ones', () => {
  const chips = [
    { rank: 1, orgName: 'שלח אתמול', tone: 'sent', suggested: false, suffix: '', available: false, blockedReason: '', recommended: false },
    { rank: 2, orgName: 'שותק חודש', tone: 'late', suggested: false, suffix: '', available: false, blockedReason: '', recommended: false },
  ] as any;
  expect(remindableChips(chips).map((c: any) => c.orgName)).toEqual(['שותק חודש', 'שלח אתמול']);
});

test('an organization that answered, was dropped or was never sent is never remindable', () => {
  const chips = [
    { rank: 1, orgName: 'נדחה', tone: 'dead', suggested: false, suffix: '', available: false, blockedReason: '', recommended: false },
    { rank: 2, orgName: 'עבר ראיון', tone: 'pass', suggested: false, suffix: '', available: false, blockedReason: '', recommended: false },
    { rank: 3, orgName: 'טרם נשלח', tone: 'plain', suggested: false, suffix: '', available: true, blockedReason: '', recommended: false },
  ] as any;
  expect(remindableChips(chips)).toEqual([]);
});

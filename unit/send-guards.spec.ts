import { test, expect } from '@playwright/test';
import { planDispatch, splitSendable } from '../src/lib/dispatch';
import { occupyAcceptedOrgSlot, normalizeOrgName } from '../src/lib/placement';
import { placementStatus } from '../src/lib/placementStatus';

/**
 * The guards between "a window opened" and "a person received something".
 *
 * Every one of these ends the same way when it fails: the compose window opens with
 * nobody in it, the coordinator confirms the send because it looked normal, and the
 * app reserves the employer's place and records a dispatch for a message that reached
 * no one. That is the phantom send this module exists to prevent, and each hole below
 * was a different way back into it.
 */

const settings = {
  whatsappTemplate: 'שלום {contactName}, קו״ח של {studentName}: {cvLink}',
  emailSubjectTemplate: 'קו״ח {studentName}', emailBodyTemplate: '{cvLink} {responseLink}',
};
const slot = (id: string) => ({ id, courseId: 'c1', status: 'available', history: [] });
const student = (over: any = {}) => ({
  id: 's1', name: 'נטע נידם', courseId: 'c1', cvUpdatedUrl: 'https://cv.example/n.pdf',
  preferences: [{ rank: 1, orgName: 'ארגון א', employerId: 'e1', interviewResult: 'pending', status: 'tentative', slotId: null }],
  ...over,
});
const plan = (employers: any[], channel: 'whatsapp' | 'email' = 'whatsapp', extra: any = {}) => planDispatch({
  student: student(), employers, orgNames: ['ארגון א'], channel, courseId: 'c1',
  cvLink: 'https://cv.example/n.pdf', userName: 'יריב', settings: { ...settings, ...extra },
  origin: 'http://localhost:4321',
});

test('a phone with a digit missing is NOT a reachable recipient', () => {
  // WhatsApp answers such a number with "not on WhatsApp", which reads as the employer
  // not being there rather than the number being wrong.
  const p = plan([{ id: 'e1', name: 'ארגון א', contactPhone: '054446580', vacancySlots: [slot('sl1')] }]);
  expect(p.entries[0].missingContact).toBe(true);
  expect(splitSendable(p).sendable).toEqual([]);
  expect(splitSendable(p).skipped.join(' ')).toContain('מספר לא תקין');
});

test('a whole, dialable number is sendable', () => {
  const p = plan([{ id: 'e1', name: 'ארגון א', contactPhone: '054-446-5801', vacancySlots: [slot('sl1')] }]);
  expect(p.entries[0].missingContact).toBe(false);
  expect(splitSendable(p).sendable).toHaveLength(1);
});

test('a contact field holding two addresses sends to the first, encoded', () => {
  const p = plan([{ id: 'e1', name: 'ארגון א', contactEmail: 'a@x.com/ b@y.com', vacancySlots: [slot('sl1')] }], 'email');
  expect(p.entries[0].recipient).toBe('a@x.com');
  expect(p.entries[0].missingContact).toBe(false);
  expect(p.entries[0].url.startsWith('mailto:a%40x.com?')).toBe(true);
});

test('an empty contact field is refused rather than opened empty', () => {
  const p = plan([{ id: 'e1', name: 'ארגון א', contactEmail: '', vacancySlots: [slot('sl1')] }], 'email');
  expect(p.entries[0].missingContact).toBe(true);
  expect(splitSendable(p).skipped.join(' ')).toContain('אין כתובת מייל');
});

test('THE PARTIAL BATCH: one bad organization no longer rides along with a good one', () => {
  // The old check refused only when EVERY entry lacked a contact, so in a batch the
  // address-less organization still opened an empty window and was confirmed as sent.
  const employers = [
    { id: 'e1', name: 'ארגון א', contactEmail: 'ok@a.com', vacancySlots: [slot('sl1')] },
    { id: 'e2', name: 'ארגון ב', contactEmail: '', vacancySlots: [slot('sl2')] },
  ];
  const p = planDispatch({
    student: student({ preferences: [
      { rank: 1, orgName: 'ארגון א', employerId: 'e1', interviewResult: 'pending', status: 'tentative', slotId: null },
      { rank: 2, orgName: 'ארגון ב', employerId: 'e2', interviewResult: 'pending', status: 'tentative', slotId: null },
    ] }),
    employers, orgNames: ['ארגון א', 'ארגון ב'], channel: 'email', courseId: 'c1',
    cvLink: 'https://cv.example/n.pdf', userName: 'יריב', settings,
  });
  const { sendable, skipped } = splitSendable(p);
  expect(sendable.map(e => e.orgName)).toEqual(['ארגון א']);
  expect(skipped.join(' ')).toContain('ארגון ב');
});

test("the employer's answer link uses the configured site, not the coordinator's address bar", () => {
  // Sent from a local run or a preview build, window.location.origin puts a dead
  // localhost link in the employer's inbox. publicSiteUrl was settable and read by
  // nothing.
  const employers = [{ id: 'e1', name: 'ארגון א', contactEmail: 'ok@a.com', vacancySlots: [slot('sl1')] }];
  const p = plan(employers, 'email', { publicSiteUrl: 'https://practicum.yarivitzkovich.org/' });
  expect(decodeURIComponent(p.entries[0].url)).toContain('https://practicum.yarivitzkovich.org/r?t=');
  expect(decodeURIComponent(p.entries[0].url)).not.toContain('localhost');
});

test('falls back to the browser origin when no public site is configured', () => {
  const employers = [{ id: 'e1', name: 'ארגון א', contactEmail: 'ok@a.com', vacancySlots: [slot('sl1')] }];
  expect(decodeURIComponent(plan(employers, 'email').entries[0].url)).toContain('http://localhost:4321/r?t=');
});

test('a placement is recorded against the organization even when the quote style differs', () => {
  // acceptedOrg is written THROUGH normalizeOrgName (" → ״); the employer record keeps
  // whatever was typed. The old lowercase compare missed, and returned the employers
  // UNTOUCHED and silently — the student read as placed while the organization went on
  // advertising a free place it did not have.
  const employers: any = [{ id: 'e9', name: 'ביה"ח שיבא', vacancySlots: [{ id: 'sX', courseId: 'c1', status: 'available', history: [] }] }];
  const placed: any = { id: 's5', name: 'רות', courseId: 'c1', acceptedOrg: normalizeOrgName('ביה"ח שיבא') };
  expect(placed.acceptedOrg).not.toBe(employers[0].name); // the two spellings really differ
  const after = occupyAcceptedOrgSlot(placed, employers, { actorId: 'admin' });
  expect(after[0].vacancySlots?.[0].status).toBe('placed');
  expect(after[0].vacancySlots?.[0].studentId).toBe('s5');
});

test('an organization the student brought is still offered "approve", not "send CV"', () => {
  // isSuggestedOrg used a private lookup with no prefix fallback, so the same preference
  // could resolve for its capacity chip and not here — and the row then offered to send
  // a CV to an employer the student had already arranged with.
  const employers: any = [{ id: 'e7', name: 'נישה פרו בע״מ', restrictedToStudentId: 's8',
    approvalStatus: 'approved', vacancySlots: [{ id: 's7', courseId: 'c1', status: 'available', history: [] }] }];
  const st = placementStatus({
    student: { id: 's8', name: 'הדר', courseId: 'c1', cvUpdatedUrl: 'https://cv/x.pdf',
      preferences: [{ rank: 1, orgName: 'נישה פרו', employerId: null, interviewResult: 'pending', status: 'tentative', slotId: null }] },
    employers, dispatches: [], pending: null, course: { id: 'c1', type: 'practicum' },
  } as any)!;
  expect(st.chips[0].suggested).toBe(true);
  expect(st.action?.id).toBe('place_direct');
});

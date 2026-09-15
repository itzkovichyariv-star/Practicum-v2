import { test, expect } from '@playwright/test';
import {
  employerContacts, activeContact, activeContactId, setActiveContact,
  upsertContact, removeContact, applyContacts, nextContactId, contactLine, PRIMARY_CONTACT_ID,
} from '../src/lib/employerContacts';
import { planDispatch } from '../src/lib/dispatch';
import { resolveEmployerFor } from '../src/lib/placement';

/**
 * "הרבה פעמים איש הקשר יוצא לחופשה ובאופן זמני צריך להחליפו ואז להחזיר… והבחירה באיש
 * הקשר תנתב אליו את כל המידע והדפים כולל חוות דעת, טפסי קורות חיים" — Yariv, 2026-09-15.
 *
 * "Routes everything to them" is the claim these tests have to hold up, and the way it
 * is kept true is the mirror: the active contact is written into the three fields the
 * whole app already reads. So the test that matters most is the last one — a real CV
 * send, through the real planner, landing on the stand-in.
 */

const codeoasis: any = {
  id: 'e-code', name: 'Codeoasis',
  contactPerson: 'יובל ליבנה', contactPhone: '052-5550001', contactEmail: 'yuval@codeoasis.example',
  vacancySlots: [{ id: 'sl1', courseId: 'c1', status: 'available', history: [] }],
};

test('an employer saved before the list existed still has exactly one contact', () => {
  const list = employerContacts(codeoasis);
  expect(list).toHaveLength(1);
  expect(list[0].id).toBe(PRIMARY_CONTACT_ID);
  expect(list[0].name).toBe('יובל ליבנה');
  expect(activeContact(codeoasis)?.phone).toBe('052-5550001');
});

test('an employer with nobody in it has no contacts, and no active one', () => {
  expect(employerContacts({ id: 'x', name: 'ריק' } as any)).toEqual([]);
  expect(activeContact({ id: 'x', name: 'ריק' } as any)).toBe(null);
  expect(activeContactId({ id: 'x', name: 'ריק' } as any)).toBe('');
});

test('adding the stand-in does NOT reroute anything on its own', () => {
  const withSub = upsertContact(codeoasis, { id: '', name: 'נועה ברק', role: 'מחליפה בחופשה', phone: '053-5550002', email: 'noa@codeoasis.example' });
  expect(employerContacts(withSub).map(c => c.name)).toEqual(['יובל ליבנה', 'נועה ברק']);
  expect(activeContact(withSub)?.name).toBe('יובל ליבנה');
  expect(withSub.contactPhone).toBe('052-5550001'); // untouched until it is chosen
});

test('THE SWITCH: choosing the stand-in rewrites the three fields the whole app reads', () => {
  const withSub = upsertContact(codeoasis, { id: '', name: 'נועה ברק', phone: '053-5550002', email: 'noa@codeoasis.example' });
  const subId = employerContacts(withSub)[1].id;
  const switched = setActiveContact(withSub, subId);
  expect(switched.contactPerson).toBe('נועה ברק');
  expect(switched.contactPhone).toBe('053-5550002');
  expect(switched.contactEmail).toBe('noa@codeoasis.example');
});

test('and the one who went on holiday keeps their card, so handing it back is one tap', () => {
  const withSub = upsertContact(codeoasis, { id: '', name: 'נועה ברק', phone: '053-5550002' });
  const subId = employerContacts(withSub)[1].id;
  const away = setActiveContact(withSub, subId);
  expect(employerContacts(away).map(c => c.name)).toEqual(['יובל ליבנה', 'נועה ברק']);
  const back = setActiveContact(away, PRIMARY_CONTACT_ID);
  expect(back.contactPerson).toBe('יובל ליבנה');
  expect(back.contactPhone).toBe('052-5550001');
  expect(back.contactEmail).toBe('yuval@codeoasis.example');
});

test('an unknown id changes nothing at all', () => {
  expect(setActiveContact(codeoasis, 'nobody')).toBe(codeoasis);
});

test('removing the active contact hands everything to the one left, never to nobody', () => {
  const two = upsertContact(codeoasis, { id: '', name: 'נועה ברק', phone: '053-5550002' });
  const subId = employerContacts(two)[1].id;
  const onSub = setActiveContact(two, subId);
  const after = removeContact(onSub, subId);
  expect(employerContacts(after).map(c => c.name)).toEqual(['יובל ליבנה']);
  expect(after.contactPerson).toBe('יובל ליבנה');
  expect(after.contactPhone).toBe('052-5550001');
});

test('removing an inactive contact leaves the active one where it is', () => {
  const two = upsertContact(codeoasis, { id: '', name: 'נועה ברק', phone: '053-5550002' });
  const after = removeContact(two, employerContacts(two)[1].id);
  expect(after.contactPerson).toBe('יובל ליבנה');
});

test('an empty card is not a person and is never stored', () => {
  const noise = applyContacts(codeoasis, [
    { id: 'c1', name: 'יובל ליבנה', phone: '052-5550001' },
    { id: 'c2', name: '', phone: '', email: '' },
  ], 'c1');
  expect(noise.contacts).toHaveLength(1);
});

test('removing everyone leaves the employer contactable by nobody, and says so', () => {
  const emptied = removeContact(codeoasis, PRIMARY_CONTACT_ID);
  expect(emptied.contacts).toEqual([]);
  expect(emptied.activeContactId).toBe(null);
  expect(emptied.contactPerson).toBe('');
});

test('ids are stable and never collide', () => {
  expect(nextContactId([{ id: 'primary', name: 'א' }])).toBe('c2');
  expect(nextContactId([{ id: 'primary', name: 'א' }, { id: 'c2', name: 'ב' }])).toBe('c3');
});

test('a card reads as one line', () => {
  expect(contactLine({ id: 'c2', name: 'נועה ברק', role: 'מחליפה בחופשה' })).toBe('נועה ברק · מחליפה בחופשה');
  expect(contactLine({ id: 'c2', name: 'נועה ברק' })).toBe('נועה ברק');
});

test('THE POINT: a real CV send lands on the stand-in, with no caller changed', () => {
  const two = upsertContact(codeoasis, { id: '', name: 'נועה ברק', phone: '053-5550002', email: 'noa@codeoasis.example' });
  const employers = [setActiveContact(two, employerContacts(two)[1].id)];
  const student = {
    id: 's1', name: 'נטע נידם', courseId: 'c1', cvUpdatedUrl: 'https://cv.example/n.pdf',
    preferences: [{ rank: 1, orgName: 'Codeoasis', employerId: 'e-code', interviewResult: 'pending', status: 'tentative', slotId: null }],
  };
  const plan = planDispatch({
    student, employers: employers as any, orgNames: ['Codeoasis'], channel: 'email', courseId: 'c1',
    cvLink: 'https://cv.example/n.pdf', userName: 'יריב',
    settings: { emailSubjectTemplate: 'קו״ח {studentName}', emailBodyTemplate: 'שלום {contactName}, {cvLink}' },
  });
  expect(plan.entries[0].contactName).toBe('נועה ברק');
  expect(plan.entries[0].recipient).toBe('noa@codeoasis.example');
  expect(decodeURIComponent(plan.entries[0].messageSnapshot)).toContain('שלום נועה ברק');
  // and the employer the row's own lookup finds is the same record
  expect((resolveEmployerFor({ employerId: 'e-code', orgName: 'Codeoasis' }, employers as any) as any)?.contactPerson).toBe('נועה ברק');
});

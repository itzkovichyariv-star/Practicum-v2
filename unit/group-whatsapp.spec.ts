import { test, expect } from '@playwright/test';
import { planGroupWhatsApp, personalizeGroupMessage } from '../src/lib/groupWhatsApp';

// Yariv 2026-10-25: one message to every student in the course, to each one's own
// WhatsApp. The queue opens one chat per click; these cells pin what each chat holds.

const students = [
  { id: 'a', name: 'נועה ברק', phone: '050-1234567' },
  { id: 'b', name: 'דן לוי', phone: '' },
  { id: 'c', name: 'מאיה כהן', phone: '050-123456' },     // one digit short
  { id: 'd', name: 'עומר  שלו', phone: '+972 52 765 4321' },
];

test('{{שם}} becomes the first name only, every occurrence', () => {
  expect(personalizeGroupMessage('היי {{שם}}, {{שם}}!', 'נועה ברק')).toBe('היי נועה, נועה!');
});

test('each reachable student gets their own chat with their own name in it', () => {
  const plan = planGroupWhatsApp(students, 'היי {{שם}}, מחר אין מפגש.');
  expect(plan.entries.map(e => e.id)).toEqual(['a', 'd']);
  expect(plan.entries[0].url).toBe(`https://wa.me/972501234567?text=${encodeURIComponent('היי נועה, מחר אין מפגש.')}`);
  expect(plan.entries[1].url).toBe(`https://wa.me/972527654321?text=${encodeURIComponent('היי עומר, מחר אין מפגש.')}`);
});

test('nobody is silently dropped: missing and broken numbers are named apart', () => {
  const plan = planGroupWhatsApp(students, 'x');
  expect(plan.noPhone).toEqual(['דן לוי']);
  expect(plan.badPhone).toEqual(['מאיה כהן']);
  expect(plan.entries.length + plan.noPhone.length + plan.badPhone.length).toBe(students.length);
});

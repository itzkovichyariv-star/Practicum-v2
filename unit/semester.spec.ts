import { test, expect } from '@playwright/test';
import { normalizeSemester, sameSemester } from '../src/lib/semester';

/**
 * "כאשר אני מסנן הרצאות לפי סמסטר אני לא רואה את אלה שמוגדרות" — Yariv, 2026-10-02.
 * Seeded lectures carry 'א' / 'ב'; the filter offers 'א׳' / 'ב׳'. Both must match.
 */

test('every spelling of a semester reads as the one the filter offers', () => {
  for (const raw of ['א', 'א׳', "א'", 'סמסטר א', 'סמ׳ א', ' א ']) expect(normalizeSemester(raw)).toBe('א׳');
  for (const raw of ['ב', 'ב׳', "ב'", 'סמסטר ב׳']) expect(normalizeSemester(raw)).toBe('ב׳');
  expect(normalizeSemester('קיץ')).toBe('קיץ');
});

test('an empty semester stays empty, an unknown one is kept as typed', () => {
  expect(normalizeSemester('')).toBe('');
  expect(normalizeSemester(undefined)).toBe('');
  expect(normalizeSemester('שנתי')).toBe('שנתי');
});

test('the filter matches a seeded lecture', () => {
  expect(sameSemester('א', 'א׳')).toBe(true);
  expect(sameSemester('ב', 'א׳')).toBe(false);
});

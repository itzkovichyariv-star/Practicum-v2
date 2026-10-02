/**
 * One spelling for a lecture's semester.
 *
 * The seeded 2025-2026 lectures were saved as 'א' / 'ב' (no geresh), while the
 * editor and the לפי סמסטר filter use 'א׳' / 'ב׳'. The filter compared the two
 * strings exactly, so filtering by semester hid every seeded lecture — they only
 * showed under "הכל" (Yariv, 2026-10-02). Every comparison goes through here.
 */
export const SEMESTERS = ['א׳', 'ב׳', 'קיץ'] as const;

/** 'א', "א'", 'א׳', 'סמסטר א', ' A ' → 'א׳'; unknown text is returned trimmed. */
export function normalizeSemester(raw: string | null | undefined): string {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = s.replace(/^סמ(סטר|׳|')?\s*/, '').replace(/["'׳״`]/g, '').trim();
  if (s === 'א' || /^(a|1)$/i.test(s)) return 'א׳';
  if (s === 'ב' || /^(b|2)$/i.test(s)) return 'ב׳';
  if (s === 'ג' || s === 'קיץ' || /^(c|3|summer)$/i.test(s)) return 'קיץ';
  return String(raw).trim();
}

export function sameSemester(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeSemester(a) === normalizeSemester(b);
}

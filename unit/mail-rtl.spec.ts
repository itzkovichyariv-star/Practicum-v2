import { test, expect } from '@playwright/test';
import { rtlBody, buildMailtoUrl } from '../src/lib/placement';

const RLM = '‏';

/**
 * The reminder mail opened left-aligned, with the line `קישור לקו"ח: https://…` laid out
 * the wrong way round — a mailto: body is plain text, so the client guesses a direction
 * per line from the first strong character, and a line whose Hebrew is followed by a URL
 * guesses wrong. Yariv 2026-09-15: "אני רוצה … ליישר את הכיתוב לימין".
 */

const body = `שלום אורטל חוברה,
רק מזכיר בעדינות — שלחנו אליכם את קורות החיים של עטרת מישלוב לפני 22 ימים.
קישור לקו"ח: https://vpqgmcmavnszcnakhiat.supabase.co/storage/v1/object/public/x.pdf

תודה רבה,
יריב איצקוביץ`;

test('THE BUG: every line opens right-to-left', () => {
  const out = rtlBody(body).split('\n');
  for (const line of out) {
    if (line.trim()) expect(line.startsWith(RLM)).toBe(true);
  }
});

test('the wording itself is untouched — only the layout changes', () => {
  expect(rtlBody(body).split(RLM).join('')).toBe(body);
});

test('a blank line stays blank, and the mark is never doubled', () => {
  expect(rtlBody(body).split('\n')[3]).toBe('');
  expect(rtlBody(rtlBody(body))).toBe(rtlBody(body));
});

test('the mail the app opens carries it', () => {
  const url = buildMailtoUrl('ortal@x.com', 'תזכורת', body);
  expect(url.startsWith('mailto:ortal%40x.com?')).toBe(true);
  const sent = decodeURIComponent(url.split('&body=')[1]);
  expect(sent.split('\n')[0]).toBe(RLM + 'שלום אורטל חוברה,');
  expect(sent).toContain('קישור לקו"ח: https://');
});

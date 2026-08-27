import { test, expect } from '@playwright/test';
import { viewableCvUrl } from '../src/lib/cvUrl';

/**
 * The link behind a CV chip.
 *
 * Yariv 2026-08-26: "קורות חיים של עדי גורביץ לא נפתחות — נותן דף לבן."
 *
 * The candidates list rendered `<a href={c.cvUrl}>` with the value exactly as stored.
 * That fails two ways, and both look identical to the reader — a blank tab, which
 * reads as "the file is missing" when the file is fine and only the link was wrong:
 *
 *   storage://bucket/path   is not a URL a browser can follow at all
 *   …/cv.docx               resolves, but Word cannot render inline
 *
 * viewableCvUrl exists for precisely this and its own comment says so ("the
 * coordinator's open button"). It was wired to the student editor and to nothing on
 * the candidates page.
 *
 * Only the cases that need no network are asserted here: a full https URL returns
 * early, before the Supabase client is ever consulted.
 */

test('a Word CV is routed through the Office viewer, not handed to the browser raw', () => {
  const out = viewableCvUrl('https://example.com/files/cv.docx');
  expect(out).toContain('view.officeapps.live.com');
  expect(out).toContain(encodeURIComponent('https://example.com/files/cv.docx'));
});

test('.doc is treated the same as .docx', () => {
  expect(viewableCvUrl('https://example.com/cv.doc')).toContain('view.officeapps.live.com');
});

test('a PDF opens directly — wrapping it would add a hop for nothing', () => {
  expect(viewableCvUrl('https://example.com/cv.pdf')).toBe('https://example.com/cv.pdf');
});

test('a query string does not fool the extension test', () => {
  // A signed or cache-busted URL still ends in .docx before the '?'.
  expect(viewableCvUrl('https://example.com/cv.docx?token=abc')).toContain('view.officeapps.live.com');
  expect(viewableCvUrl('https://example.com/cv.pdf?token=abc')).toBe('https://example.com/cv.pdf?token=abc');
});

test('an empty reference yields an empty string, never a broken link', () => {
  // FileChip renders the "missing" state on a falsy url. A non-empty nonsense href
  // would render as an openable chip that opens nothing — the blank page again.
  expect(viewableCvUrl('')).toBe('');
  expect(viewableCvUrl(null)).toBe('');
  expect(viewableCvUrl(undefined)).toBe('');
  expect(viewableCvUrl('   ')).toBe('');
});

// ── the fix itself ──────────────────────────────────────────────────────────
// The defect was not in viewableCvUrl, which was always correct. It was that the
// candidates list never called it. That lives in a React component and this repo has
// no component-test setup, so it is pinned at the source level instead — the same
// trick the family-tasks repo uses for "the code shipped" claims. Crude, and it
// catches exactly the regression that actually happened.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test('the candidates list never hands a raw stored reference to an <a href>', () => {
  const src = read('src/components/CandidatesPage.tsx');
  expect(src, 'CV chip must resolve').not.toContain('FileChip label="CV" url={c.cvUrl}');
  expect(src, 'form chip must resolve').not.toContain('FileChip label="טופס" url={c.applicationUrl}');
  expect(src).toContain('viewableCvUrl(c.cvUrl)');
  expect(src).toContain('viewableCvUrl(c.applicationUrl)');
});

test('the candidate strip resolves before rendering, and the status module stays pure', () => {
  expect(read('src/components/CandidateStrip.tsx')).toContain('viewableCvUrl(c.fileRef)');
  // The pure module must not import the Supabase-backed resolver, or these tests —
  // and anything else that reasons about a candidate offline — stop working.
  expect(read('src/lib/candidateStatus.ts')).not.toContain("from './cvUrl'");
});

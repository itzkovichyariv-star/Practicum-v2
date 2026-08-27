import { test, expect } from '@playwright/test';
import { resolveCvUrl } from '../src/lib/cvUrl';

/**
 * The link behind a CV chip.
 *
 * Yariv, 2026-08-26 through 2026-08-27, five rounds on one bug: "קורות חיים של עדי
 * גורביץ לא נפתחות — נותן דף לבן."
 *
 * The version of this file that these tests replace asserted that a Word CV is routed
 * through view.officeapps.live.com. That was the fix for the first round, it was wrong,
 * and it was wrong in the direction that costs most: the Office viewer answers with an
 * EMPTY FRAME whenever it cannot fetch the file, which is a blank page chosen on
 * purpose. The old tests were green about it the whole time.
 *
 * Two things he said settled it, and neither needed a debugger:
 *   · "הקישור נפתח בהעתקה שלו" — pasting the RAW link worked.
 *   · "לחלק מהאנשים זה כן נפתח" — PDF against Word.
 *
 * So nothing is rerouted any more. Every link points at the file itself and the
 * platform decides: iOS previews .docx, a desktop downloads it, and both beat a viewer
 * that renders nothing. resolveCvUrl is all that is left, and all it does is turn a
 * stored reference into a URL a browser can follow.
 */

test('a full URL is passed through untouched', () => {
  expect(resolveCvUrl('https://example.com/files/cv.pdf')).toBe('https://example.com/files/cv.pdf');
});

test('a Word CV is passed through as itself — no viewer in the path', () => {
  // The assertion that used to say the opposite is the one that let the blank page live.
  for (const u of ['https://example.com/cv.docx', 'https://example.com/cv.doc',
                   'https://example.com/cv.docx?token=abc']) {
    expect(resolveCvUrl(u), u).toBe(u);
    expect(resolveCvUrl(u), u).not.toContain('view.officeapps.live.com');
  }
});

test('an empty reference yields an empty string, never a broken link', () => {
  // FileChip renders the "missing" state on a falsy url. A non-empty nonsense href
  // would render as an openable chip that opens nothing — the blank page again.
  expect(resolveCvUrl('')).toBe('');
  expect(resolveCvUrl(null)).toBe('');
  expect(resolveCvUrl(undefined)).toBe('');
  expect(resolveCvUrl('   ')).toBe('');
});

// ── the wiring ──────────────────────────────────────────────────────────────
// These live in React components and this repo has no component-test setup, so they are
// pinned at the source level — the same trick the family-tasks repo uses for "the code
// shipped" claims. Crude, and it catches exactly the regressions that actually happened.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

test('the Office viewer is gone from the app entirely', () => {
  // Round one added it, rounds two through four tuned around it, and round five found it
  // was the blank page. Nothing should reintroduce it quietly.
  for (const f of ['src/lib/cvUrl.ts', 'src/components/CandidatesPage.tsx',
                   'src/components/CandidateStrip.tsx', 'src/components/StudentEditor.tsx',
                   'src/components/CvUpdateForm.tsx']) {
    expect(read(f), f).not.toContain('view.officeapps.live.com');
  }
});

test('nothing opens a CV with window.open any more', () => {
  // window.open is what an installed PWA has nowhere to put: no tab bar, so iOS declines
  // it silently. openCv hands the URL to a real anchor click instead.
  expect(read('src/lib/cvUrl.ts')).not.toContain('window.open');
  for (const f of ['src/components/StudentEditor.tsx', 'src/components/CvUpdateForm.tsx']) {
    expect(read(f), f).not.toContain('window.open(viewableCvUrl');
  }
});

test('every CV opener goes through openCv', () => {
  expect(read('src/components/CandidatesPage.tsx')).toContain('openCv(fileRef)');
  expect(read('src/components/CandidateStrip.tsx')).toContain('openCv(c.fileRef)');
  expect(read('src/components/StudentEditor.tsx')).toContain('openCv(');
  // ...and the chips still carry a real href, so copy-link and middle-click keep working.
  expect(read('src/components/CandidatesPage.tsx')).toContain('resolveCvUrl(c.cvUrl)');
  expect(read('src/components/CandidateStrip.tsx')).toContain('resolveCvUrl(c.fileRef)');
});

test('the pure status module stays free of the Supabase-backed resolver', () => {
  expect(read('src/lib/candidateStatus.ts')).not.toContain("from './cvUrl'");
});

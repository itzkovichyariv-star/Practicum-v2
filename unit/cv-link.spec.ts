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

test('nothing holds a blank tab across an await — the shape that caused every blank page', () => {
  // THE HAZARD, stated as itself. Rounds one to five all banned a NAME (the Office
  // viewer, then window.open) and the blank page came back each time, because the fault
  // was never the name: it is opening a tab BEFORE the file is known and pointing it
  // somewhere after an await. The await spends the click, iOS refuses the navigation,
  // and the held tab is the blank page. A direct window.open of a URL we already have,
  // inside the click, is not that shape — and in the installed app it is the only thing
  // left that can put a file on screen, so banning the name outright (as this test did
  // until 2026-09-15) forbade the fix.
  for (const f of ['src/lib/cvUrl.ts', 'src/components/SubmissionsInbox.tsx',
                   'src/components/CandidatesPage.tsx', 'src/components/CandidateStrip.tsx',
                   'src/components/StudentEditor.tsx', 'src/components/CvUpdateForm.tsx']) {
    const src = read(f);
    expect(src, f).not.toContain("window.open('about:blank'");
    expect(src, f).not.toContain('window.open("about:blank"');
    expect(src, f).not.toContain("window.open('', '_blank')");
    expect(src, f).not.toContain('win.location.href');
  }
  // And no CV path may rebuild the file as a blob to show it: that needs a fetch, and a
  // fetch needs an await. It also handed the viewer the service worker's offline JSON.
  expect(read('src/components/SubmissionsInbox.tsx')).not.toContain("new Blob([buf]");
});

test('the installed app has a hand-off that cannot end in nothing', () => {
  // A scripted anchor click aimed at a new tab is what iOS standalone drops silently.
  // There, openCv asks for a window and, if the platform refuses one, navigates in
  // place — so the file always arrives somewhere.
  const src = read('src/lib/cvUrl.ts');
  expect(src).toContain('isStandaloneApp');
  expect(src).toContain('window.location.href = url');
});

test('every CV opener goes through the shared module', () => {
  // A chip that ALREADY renders a real anchor opens the file with the browser's own
  // navigation — the one hand-off no platform drops — and calls the shared module only
  // to say what is wrong when the storage refuses the object. Cancelling that navigation
  // with preventDefault to run a scripted open is what left the installed app opening
  // nothing at all, so the two chips must not do it again.
  for (const f of ['src/components/CandidatesPage.tsx', 'src/components/CandidateStrip.tsx']) {
    const src = read(f);
    expect(src, f).toContain('warnIfCvUnreadable');
    expect(src, f).not.toContain('e.preventDefault(); void openCv');
  }
  // Buttons with no anchor of their own still hand off through openCv.
  expect(read('src/components/StudentEditor.tsx')).toContain('openCv(');
  expect(read('src/components/SubmissionsInbox.tsx')).toContain('openCv(');
  // ...and the chips still carry a real href, so copy-link and middle-click keep working.
  expect(read('src/components/CandidatesPage.tsx')).toContain('resolveCvUrl(c.cvUrl)');
  expect(read('src/components/CandidateStrip.tsx')).toContain('resolveCvUrl(c.fileRef)');
});

test('the pure status module stays free of the Supabase-backed resolver', () => {
  expect(read('src/lib/candidateStatus.ts')).not.toContain("from './cvUrl'");
});

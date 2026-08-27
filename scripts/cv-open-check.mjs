#!/usr/bin/env node
/**
 * cv-open-check.mjs — the blank page, and why it must never be what a broken CV looks like.
 *
 * Yariv 2026-08-26, and again on 2026-08-27 after a deploy that was supposed to settle it:
 *   "קורות חיים של עדי גורביץ לא נפתחות — נותן דף לבן."
 *
 * The first fix wired the candidates list through viewableCvUrl, which was correct and
 * did not settle it — so the defect was never only the link builder. A blank tab is the
 * worst failure available here because it is AMBIGUOUS: four different faults render
 * identically, and only ONE of them means "there is no CV".
 *
 *   · nothing stored on the record         → there is genuinely no CV
 *   · object missing from the bucket       → the CV is fine, the saved path is stale
 *   · bucket not public (400)              → the CV is fine, the bucket is wrong
 *   · Word file the Office viewer declined → the CV is fine, the viewer gave up
 *
 * A coordinator reading a blank tab concludes the first one every time, and the last
 * three are the ones that are actually fixable. So `openCv` opens the tab, checks the
 * object resolves, and writes what went wrong into the tab that used to be empty.
 *
 * This check drives that in a real browser: a candidate whose CV 404s, and one whose CV
 * is a Word file. Offline and fixture-backed like its siblings — the fixture's CVs are
 * served by this script's own server, so the 404 is a real 404 and the .docx is a real
 * file, with nobody's data involved.
 *
 *   npx astro build && node scripts/cv-open-check.mjs
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PORT = 4326;
const ORIGIN = `http://127.0.0.1:${PORT}`;
/* A SECOND origin, and the reason it has to be one: same-origin fetch never consults
   CORS, so a no-CORS file served from ORIGIN would be read happily and the case below
   would prove nothing. `localhost` and `127.0.0.1` are different origins to a browser
   even on the same port — a different port here makes it unambiguous. */
const PORT2 = PORT + 1;
const ORIGIN2 = `http://localhost:${PORT2}`;

/* Served by the server below. The missing one is never written, so it is a genuine 404
   from a real HTTP server rather than a stubbed rejection. */
const GOOD_PDF = `${ORIGIN}/fixture/cv-good.pdf`;
const MISSING  = `${ORIGIN}/fixture/cv-missing.pdf`;
const WORD_DOC = `${ORIGIN}/fixture/cv-word.docx`;
/* Served WITHOUT Access-Control-Allow-Origin, so the HEAD probe throws while the file
   itself is perfectly fine — the shape of Yariv's "opens when I copy the link". */
const NO_CORS  = `${ORIGIN2}/cv-nocors.pdf`;

/* A knob for the failure this check ONCE had rather than found.
 *
 * Every tab starts at about:blank; the ones that resolve navigate afterwards, and a
 * HEAD probe has to return before that can even begin. Reading the tab's URL after a
 * fixed sleep therefore measures the machine, not the app — and on Yariv's Mac the
 * same code that passed here reported 14/16, red on exactly the two cases that
 * navigate (2026-08-27).
 *
 * CV_CHECK_DELAY_MS slows every fixture response, which reproduces his slower machine
 * on demand: at 900 the old fixed-sleep reader goes red here too, and the condition
 * that replaced it stays green. Use it whenever this file's waiting is touched.
 */
const DELAY_MS = Number(process.env.CV_CHECK_DELAY_MS || 0);
const slow = () => (DELAY_MS ? new Promise(r => setTimeout(r, DELAY_MS)) : null);

const FIXTURE = {
  courses: [{ id: 'hr', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', type: 'practicum' }],
  academicYears: ['תשפ״ז'],
  candidates: [
    { id: 'k1', name: 'רות מזרחי', email: 'ruth@example.com', phone: '052-1111111',
      courseId: 'hr', year: 'תשפ״ז', cvUrl: GOOD_PDF },
    { id: 'k2', name: 'עדי גורביץ׳', email: 'adi@example.com', phone: '054-2222222',
      courseId: 'hr', year: 'תשפ״ז', cvUrl: MISSING },
    { id: 'k3', name: 'נועם קדם', email: 'noam@example.com', phone: '053-3333333',
      courseId: 'hr', year: 'תשפ״ז', cvUrl: WORD_DOC },
    { id: 'k4', name: 'שירה אלון', email: 'shira@example.com', phone: '055-4444444',
      courseId: 'hr', year: 'תשפ״ז', cvUrl: NO_CORS },
  ],
  students: [], employers: [], dispatches: [], trainers: [], lectures: [], institutions: [],
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/fixture/')) await slow();
  // The fixture files, answered from memory. cv-missing is deliberately absent.
  if (p === '/fixture/cv-good.pdf' || p === '/fixture/cv-word.docx') {
    res.writeHead(200, { 'Content-Type': MIME[extname(p)], 'Access-Control-Allow-Origin': '*' });
    return res.end(Buffer.from('fixture'));
  }
  if (p.startsWith('/fixture/')) {
    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
    return res.end('missing');
  }
  if (p.endsWith('/')) p += 'index.html';
  try {
    const b = await readFile(join(DIST, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(PORT, r));

/* Cross-origin, and deliberately WITHOUT Access-Control-Allow-Origin: the browser
   refuses to let fetch read it, while navigating to it works perfectly. Real storage
   backends behave exactly this way, and it is the shape of what Yariv found — the link
   opens when pasted, and the check that inspected it first concluded otherwise. */
const foreign = createServer(async (req, res) => {
  await slow();
  if (req.url.split('?')[0] === '/cv-nocors.pdf') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<!doctype html><meta charset="utf-8"><p>fixture cv body</p>');
  }
  res.writeHead(404); res.end('nf');
});
await new Promise(r => foreign.listen(PORT2, r));

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
             '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
/**
 * A browser context configured the way the app expects, and a page on the candidates
 * screen. Factored out because one case needs a FRESH one: Chromium allows a context
 * its first automatic download and then quietly declines the rest, so a .docx clicked
 * after any other case produced neither a download nor even a request. That is
 * Chromium's policy about repeated downloads, not the app's behaviour, and giving the
 * case its own context removes it from the measurement instead of working around it.
 */
async function freshContext() {
  const c = await browser.newContext({ viewport: { width: 1180, height: 900 }, acceptDownloads: true });
  await c.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(ORIGIN) || url.startsWith(ORIGIN2)) return route.continue();
    if (url.includes('practicum_data') && route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: FIXTURE, updated_at: '2026-01-01T00:00:00.000Z',
          last_editor_name: 'check', last_editor_email: 'check@local' }) });
    }
    if (url.includes('fonts.g')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await c.addInitScript(() => {
    localStorage.setItem('practicum_v2_session', JSON.stringify({ profile: { name: 'יריב איצקוביץ', email: 'yarivi@ariel.ac.il' } }));
    localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'hr', year: 'תשפ״ז' }));
    localStorage.setItem('practicum_v2_page', 'candidates');
    localStorage.setItem('practicum_theme', 'light');
  });
  const page = await c.newPage();
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('li[data-info-row]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(900);
  return { c, page };
}

const { c: ctx, page: pg } = await freshContext();

console.log('\ncv-open-check — offline, fixture-backed\n');

/* Dialogs are how openCv reports a definitive failure now, since the tab has already
   been handed to the platform and there is nothing to write into. Captured, not just
   dismissed, because their text is the assertion. */
const dialogs = [];
const watchDialogs = page => page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
watchDialogs(pg);

/**
 * Click the CV chip on the row carrying `name`, and return the tab it opens.
 *
 * A REAL click, not a dispatched MouseEvent: an anchor click needs user activation, and
 * Chromium blocks a synthetic event's tab exactly as it would an unsolicited one.
 *
 * There is no settling to do any more, and that is the point of the change this tests.
 * openCv hands the file to an anchor inside the gesture, so the tab is BORN pointing at
 * its destination — there is no about:blank to wait out, no held window to navigate
 * later, and therefore no race to lose on a slower machine. The previous two versions
 * of this helper both failed on Yariv's Mac while passing here, which was the mechanism
 * telling us what it was.
 */
async function openCvFor(name, { c = ctx, page = pg, expectDialog = false } = {}) {
  dialogs.length = 0;
  const chip = page.locator('li[data-info-row]').filter({ hasText: name })
    .locator('a').filter({ hasText: 'CV' }).first();
  if (!(await chip.count())) return { error: 'no CV chip on that row' };

  // Three ways the platform can take a file, and the app controls none of them: a tab,
  // a download, or (for a .docx after another tab has already opened) a download
  // Chromium quietly declines. Which one happens is the platform's business.
  //
  // What the app decides — and all this check is entitled to assert — is WHICH URL it
  // hands over. So requests are collected too, and they are the reliable witness: they
  // are made whatever the platform then does with the response, and they are what
  // "never through the Office viewer" is actually a claim about.
  const tabs = [], downloads = [], requested = [];
  const onPage = pop => tabs.push(pop);
  const onDownload = dl => downloads.push(dl);
  const onRequest = r => requested.push(r.url());
  c.on('page', onPage);
  c.on('request', onRequest);
  page.on('download', onDownload);
  try {
    await chip.click({ force: true });
    for (let i = 0; i < 30 && !tabs.length && !downloads.length; i++) await page.waitForTimeout(150);
    // The probe runs AFTER the hand-off, so a dialog it raises lands later than the tab.
    // Polled rather than slept: a fixed wait here is the same bug this file has already
    // had twice, and it would fail on a slower machine exactly as those did. A case that
    // expects silence still needs a floor, or it would call every dialog "silent" simply
    // by looking too early.
    if (expectDialog) {
      for (let i = 0; i < 60 && !dialogs.length; i++) await page.waitForTimeout(150);
    } else {
      await page.waitForTimeout(1500);
    }
  } finally {
    c.off('page', onPage);
    c.off('request', onRequest);
    page.off('download', onDownload);
  }

  const via = downloads.length ? 'download' : tabs.length ? 'tab' : 'request only';
  // A download names the file; a transient tab does not.
  const url = downloads.length ? downloads[0].url() : tabs.length ? tabs[0].url() : '';
  for (const t of tabs) await t.close().catch(() => {});
  return { url, via, requested, dialogs: [...dialogs] };
}

// ── the happy path ───────────────────────────────────────────────────────────
console.log('PDF: the tab is born pointing at the file');
{
  const r = await openCvFor('רות מזרחי');
  check('the chip opens a tab', !r.error, r.error || r.url);
  if (!r.error) {
    check('it goes straight to the file — no placeholder, no interstitial', r.url === GOOD_PDF, r.url);
    check('and nothing is raised about it', r.dialogs.length === 0, r.dialogs[0] || 'silent');
  }
}

// ── Word: the viewer that renders an empty frame is not used at all ──────────
console.log('\nWORD: handed over raw, never through the Office viewer');
{
  // Yariv 2026-08-27: "לחלק מהאנשים זה כן נפתח" — PDF against Word. view.officeapps
  // answers with an empty frame when it cannot fetch the file, and that empty frame is
  // the blank page from the original report. iOS previews .docx; a desktop downloads it.
  const { c: wordCtx, page: wordPg } = await freshContext();
  watchDialogs(wordPg);
  const r = await openCvFor('נועם קדם', { c: wordCtx, page: wordPg });
  await wordCtx.close();
  check('the app hands the file over', !r.error, r.error || `${r.via}`);
  if (!r.error) {
    const asked = r.requested.concat(r.url ? [r.url] : []);
    check('the raw .docx is what it asked for', asked.includes(WORD_DOC), `${r.via}: ${asked.join(' , ') || '(none)'}`);
    check('and view.officeapps.live.com is never requested',
      !asked.some(u => u.includes('view.officeapps.live.com')), 'the viewer is out of the path');
  }
}

// ── a reference that resolves to nothing ─────────────────────────────────────
console.log('\nMISSING: the file still opens, and the coordinator is TOLD why it will not show');
{
  // The tab is handed over before the probe can object — a probe must never be able to
  // withhold a file (2026-08-27, when it withheld a good one). It reports instead.
  const r = await openCvFor('עדי גורביץ', { expectDialog: true });
  check('the chip opens a tab', !r.error, r.error || r.url);
  if (!r.error) {
    check('the tab went to the stored reference, not somewhere else', r.url === MISSING, r.url);
    check('the failure is reported, not silent', r.dialogs.length > 0, r.dialogs[0]?.slice(0, 60) || 'nothing raised');
    check('and it names WHY', (r.dialogs[0] || '').includes('לא נמצא'), r.dialogs[0]?.slice(0, 80) || '');
    check('and prints what is stored on the record', (r.dialogs[0] || '').includes(MISSING), 'reference printed');
  }
}

// ── a probe that could not read must stay silent ─────────────────────────────
console.log('\nUNREADABLE PROBE: CORS blocks the check, not the file');
{
  const r = await openCvFor('שירה אלון');
  check('the chip opens a tab', !r.error, r.error || r.url);
  if (!r.error) {
    check('the file is handed over as normal', r.url === NO_CORS, r.url);
    check('and nothing is claimed about a file we could not inspect', r.dialogs.length === 0,
      r.dialogs[0]?.slice(0, 60) || 'silent');
  }
}

await ctx.close();
await browser.close();
server.close();
foreign.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error(`\n❌ ${failed.length} failed: ${failed.map(f => f.name).join(' · ')}`);
  process.exit(1);
}
console.log('✅ cv-open-check passed');

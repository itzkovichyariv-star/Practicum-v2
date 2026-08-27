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
const foreign = createServer((req, res) => {
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
const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });

await ctx.route('**/*', route => {
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
await ctx.addInitScript(() => {
  localStorage.setItem('practicum_v2_session', JSON.stringify({ profile: { name: 'יריב איצקוביץ', email: 'yarivi@ariel.ac.il' } }));
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'hr', year: 'תשפ״ז' }));
  localStorage.setItem('practicum_v2_page', 'candidates');
  localStorage.setItem('practicum_theme', 'light');
});

const pg = await ctx.newPage();
await pg.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
await pg.waitForSelector('li[data-info-row]', { timeout: 15000 }).catch(() => {});
await pg.waitForTimeout(900);

console.log('\ncv-open-check — offline, fixture-backed\n');

/**
 * Click the CV chip on the row carrying `name`, and return the tab it opens.
 *
 * A REAL click, not a dispatched MouseEvent: `window.open` needs user activation, and
 * Chromium blocks a synthetic event's popup exactly as it would block an unsolicited
 * one. The first version of this check dispatched the event and reported "no tab
 * opened" for all three cases — a property of the test, not of the page.
 */
async function openCvFor(name) {
  const chip = pg.locator('li[data-info-row]').filter({ hasText: name })
    .locator('a').filter({ hasText: 'CV' }).first();
  if (!(await chip.count())) return { error: 'no CV chip on that row' };
  const [popup] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null),
    chip.click({ force: true }),
  ]);
  if (!popup) return { error: 'no tab opened' };
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await popup.waitForTimeout(700);
  const text = (await popup.evaluate(() => document.body?.innerText || '').catch(() => '')) || '';
  const url = popup.url();
  return { popup, text, url };
}

// ── THE BUG: a CV that is not there ──────────────────────────────────────────
console.log('MISSING: a stale path explains itself instead of rendering blank');
{
  const r = await openCvFor('עדי גורביץ');
  check('the chip opens a tab', !r.error, r.error || `url: ${r.url}`);
  if (!r.error) {
    check('the tab is NOT blank', r.text.trim().length > 40, `${r.text.trim().length} characters of text`);
    check('it says the file was not found', r.text.includes('לא נמצא'), r.text.split('\n')[1] || '');
    check('it shows what is stored on the record', r.text.includes(MISSING), 'the reference is printed');
    await r.popup.close();
  }
}

// ── The Word case: the viewer that answers with an empty frame ───────────────
console.log('\nWORD: a .docx offers the viewer AND the download');
{
  const r = await openCvFor('נועם קדם');
  check('the chip opens a tab', !r.error, r.error || `url: ${r.url}`);
  if (!r.error) {
    check('the tab is NOT blank', r.text.trim().length > 40, `${r.text.trim().length} characters of text`);
    const links = await r.popup.evaluate(() => [...document.querySelectorAll('a')].map(a => a.getAttribute('href')));
    check('the Office viewer is offered', links.some(h => (h || '').includes('view.officeapps.live.com')));
    // The download is the load-bearing half: it works when the viewer does not, and
    // the viewer failing is the most likely reading of the original blank page.
    check('a direct download is offered beside it', links.some(h => h === WORD_DOC), `${links.length} links`);
    await r.popup.close();
  }
}

// ── THE FALSE NEGATIVE: a probe that could not read is not a missing file ───
console.log('\nUNREADABLE PROBE: a CORS-blocked HEAD must not withhold a good file');
{
  // Yariv 2026-08-27: "הקישור נפתח בהעתקה שלו אבל לא על ידי לחיצה". Copying the URL
  // and pasting it opened the CV — so the object was there the whole time and anything
  // refusing to open it was wrong about the file. fetch cannot read this one; the tab
  // can render it. The tab must therefore get it.
  const r = await openCvFor('שירה אלון');
  check('the chip opens a tab', !r.error, r.error || `url: ${r.url}`);
  if (!r.error) {
    check('the tab goes to the FILE, not to an explanation', r.url === NO_CORS, r.url);
    check('and no explanation page stands between him and it', !r.text.includes('לא ניתן לפתוח'), r.text.slice(0, 40));
    await r.popup.close();
  }
}

// ── THE PHONE: the app installed to the home screen ─────────────────────────
console.log('\nINSTALLED APP: no tab bar, so window.open has nowhere to put a tab');
{
  // Yariv 2026-08-27: "מהמחשב זה נפתח אבל מהטלפון לא אולי הגדרה שקשורה לגודל
  // והתצוגה?" — and it is a display setting: manifest.json says
  // "display": "standalone", so on the phone the app runs without tabs and iOS
  // silently declines the window.open the desktop happily honours.
  //
  // navigator.standalone is set here the way iOS sets it. What is asserted is that the
  // tab which appears carries the FILE, not the about:blank placeholder the browser
  // path opens and then writes into — because that placeholder is the thing that never
  // appears on his phone.
  const app = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await app.route('**/*', route => {
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
  await app.addInitScript(() => {
    Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
    localStorage.setItem('practicum_v2_session', JSON.stringify({ profile: { name: 'יריב איצקוביץ', email: 'yarivi@ariel.ac.il' } }));
    localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'hr', year: 'תשפ״ז' }));
    localStorage.setItem('practicum_v2_page', 'candidates');
    localStorage.setItem('practicum_theme', 'light');
  });
  const apg = await app.newPage();
  apg.on('dialog', d => d.dismiss().catch(() => {}));
  await apg.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  await apg.waitForSelector('li[data-info-row]', { timeout: 15000 }).catch(() => {});
  await apg.waitForTimeout(900);

  const openInApp = async (name) => {
    const chip = apg.locator('li[data-info-row]').filter({ hasText: name })
      .locator('a').filter({ hasText: 'CV' }).first();
    if (!(await chip.count())) return { error: 'no CV chip' };
    const [popup] = await Promise.all([
      app.waitForEvent('page', { timeout: 8000 }).catch(() => null),
      chip.click({ force: true }),
    ]);
    if (!popup) return { error: 'nothing opened' };
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    const url = popup.url();
    await popup.close();
    return { url };
  };

  const good = await openInApp('רות מזרחי');
  check('the installed app still opens something', !good.error, good.error || good.url);
  check('and it is the file itself, not a placeholder tab', good.url === GOOD_PDF, good.url);

  // The Office viewer is the component that answers with an empty frame. iOS previews
  // .docx natively, so on the phone the raw file is the better destination — and the
  // interstitial has no tab to live in here anyway.
  // What is claimed is that the Office VIEWER is not what the phone is sent to. Where
  // the raw .docx then goes is the platform's business and differs by platform: iOS
  // previews it, and this headless Chromium treats it as a download and closes the tab
  // it briefly opened — which is why the URL asserted here is "anything but the
  // viewer" rather than the file. Asserting the file would be asserting Chromium's
  // download policy, which is not the behaviour under test.
  const word = await openInApp('נועם קדם');
  const sentToViewer = String(word.url || '').includes('view.officeapps.live.com');
  check('a Word CV is NOT handed to the Office viewer on the phone', !sentToViewer,
    word.error || word.url || '(the platform took it as a download)');

  await app.close();
}

// ── The happy path must stay a single hop ────────────────────────────────────
console.log('\nPDF: a file that resolves opens directly, with no interstitial');
{
  const r = await openCvFor('רות מזרחי');
  check('the chip opens a tab', !r.error, r.error || `url: ${r.url}`);
  if (!r.error) {
    check('the tab goes straight to the file', r.url === GOOD_PDF, r.url);
    await r.popup.close();
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

#!/usr/bin/env node
/**
 * candidates-archive-check.mjs — drives the REAL candidates screen and asserts
 * the archive behaviour, entirely offline.
 *
 * Why this exists alongside scripts/audit/: every numbered gate cell seeds through
 * the live Supabase project. That is right for proving a deployment, and wrong for
 * proving an unmerged branch — it would write fixture rows into the data Yariv is
 * working in. This serves dist/ locally and answers every off-origin request from a
 * fixture, so the same UI can be driven with nobody's data at risk.
 *
 * It is a real test, not a screenshot: each check states what it expected and what
 * it got, and the process exits 1 on any failure. Proven discriminating — run it
 * against the pre-change build and ARCHIVE-hidden, CHIP-link and ICONS-shared all
 * go red.
 *
 *   npx astro build && node scripts/candidates-archive-check.mjs
 *
 * What it does NOT cover: anything that needs a server round-trip — conversion,
 * the reversal confirm, the acceptance mail. Those still belong in a gate cell run
 * against a deployment.
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PORT = 4322;

/* דנה = passed AND converted (the archived one) · מאיה = both files, waiting ·
   רון = CV only, failed · טל = no files at all. Four rows chosen so every
   assertion below has both a positive and a negative case in the same list. */
const FIXTURE = {
  courses: [{ id: 'hr', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז' }],
  academicYears: ['תשפ״ז'],
  candidates: [
    { id: 'c1', name: 'דנה כהן', phone: '052-1234567', email: 'dana@example.com',
      courseId: 'hr', year: 'תשפ״ז', cvUrl: 'https://example.com/dana-cv.pdf',
      applicationUrl: 'https://example.com/dana-form.pdf', interviewConducted: true,
      interviewResult: 'passed', interviewSummary: 'מוטיבציה גבוהה.', evalScore: 88,
      convertedToStudentId: 's1' },
    { id: 'c2', name: 'מאיה בר', phone: '054-1112222', email: 'maya@example.com',
      courseId: 'hr', year: 'תשפ״ז', cvUrl: 'https://example.com/maya-cv.pdf',
      applicationUrl: 'https://example.com/maya-form.pdf' },
    { id: 'c3', name: 'רון שגב', phone: '050-3334444', email: 'ron@example.com',
      courseId: 'hr', year: 'תשפ״ז', cvUrl: 'https://example.com/ron-cv.pdf',
      interviewConducted: true, interviewResult: 'failed', interviewSummary: 'לא התאים.' },
    { id: 'c4', name: 'טל אבני', phone: '058-7778888', email: 'tal@example.com',
      courseId: 'hr', year: 'תשפ״ז' },
  ],
  students: [
    { id: 's1', name: 'דנה כהן', phone: '052-1234567', email: 'dana@example.com',
      courseId: 'hr', year: 'תשפ״ז', preparation: { passed: false }, fromCandidate: true,
      fromCandidateId: 'c1' },
  ],
  employers: [], dispatches: [], trainers: [], lectures: [], institutions: [],
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  try { const b = await readFile(join(DIST, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(PORT, r));

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

async function openPage(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
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
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await pg.waitForSelector('li[data-info-row]', { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(900);
  return { pg, ctx, errs };
}

const rowNames = pg => pg.$$eval('li[data-info-row]',
  els => els.map(e => (e.querySelector('.serif')?.textContent || '').trim()));
// The ramzor tab's own number, read off the tab rather than recomputed, so the
// assertion fails if the tab and the list ever disagree.
const tabCount = (pg, label) => pg.evaluate(l => {
  const tab = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes(l));
  const m = tab && (tab.textContent || '').match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}, label);

console.log('\ncandidates-archive-check — offline, fixture-backed\n');

const { pg, ctx, errs } = await openPage(1180);

// ── ARCHIVE-hidden ───────────────────────────────────────────────────────────
console.log('ARCHIVE-hidden: a converted candidate is not in the working list');
{
  const names = await rowNames(pg);
  check('דנה (converted) absent by default', !names.includes('דנה כהן'), `rows: ${names.join(', ')}`);
  check('the other three are present', ['מאיה בר', 'רון שגב', 'טל אבני'].every(n => names.includes(n)), `${names.length} rows`);
  const all = await tabCount(pg, 'הכל');
  const passed = await tabCount(pg, 'עברו');
  check('tab "הכל" counts the shown pool', all === 3, `expected 3, got ${all}`);
  check('tab "עברו" excludes the archived one', passed === 0, `expected 0, got ${passed}`);
}

// ── ARCHIVE-toggle ───────────────────────────────────────────────────────────
console.log('\nARCHIVE-toggle: the switch brings them back, marked');
{
  const box = pg.locator('input[data-archive-toggle]');
  const present = await box.count() === 1;
  check('toggle is present when the archive is non-empty', present);

  // A missing control is a FAILED assertion, not a crash. Letting the locator
  // time out here would abort the run and take the CHIP and ICON sections with
  // it — the later checks would read as "not run" when they are simply unknown.
  if (!present) {
    for (const name of ['toggle names the count', 'דנה returns when the archive is shown',
      'counts follow the shown pool', 'the archived row says so on the row itself',
      'archive toggle is outside the rows', 'unchecking hides them again']) {
      check(name, false, 'skipped — no toggle to operate');
    }
  } else {
    const labelText = await pg.evaluate(() => {
      const i = document.querySelector('input[data-archive-toggle]');
      return i ? (i.closest('label')?.textContent || '').trim() : '';
    });
    check('toggle names the count', /\(1\)/.test(labelText), `label: "${labelText}"`);

    await box.check();
    await pg.waitForTimeout(500);
    const names = await rowNames(pg);
    check('דנה returns when the archive is shown', names.includes('דנה כהן'), `rows: ${names.join(', ')}`);
    const all = await tabCount(pg, 'הכל');
    const passed = await tabCount(pg, 'עברו');
    check('counts follow the shown pool', all === 4 && passed === 1, `הכל=${all} (want 4), עברו=${passed} (want 1)`);

    const marked = await pg.evaluate(() => {
      const row = [...document.querySelectorAll('li[data-info-row]')]
        .find(e => (e.querySelector('.serif')?.textContent || '').includes('דנה'));
      return row ? /בארכיון/.test(row.textContent || '') : false;
    });
    check('the archived row says so on the row itself', marked);

    // The row checkbox must remain the only checkbox INSIDE a row — cell 07 selects on it.
    const inRow = await pg.locator('li[data-info-row] input[type="checkbox"]').count();
    check('archive toggle is outside the rows', inRow === 4, `row checkboxes: ${inRow}, want 4`);

    await box.uncheck();
    await pg.waitForTimeout(400);
    const back = await rowNames(pg);
    check('unchecking hides them again', !back.includes('דנה כהן'), `rows: ${back.join(', ')}`);
  }
}

// ── CHIP-link ────────────────────────────────────────────────────────────────
console.log('\nCHIP-link: a submitted file is a link, a missing one is not');
{
  const chips = await pg.evaluate(() => {
    const out = {};
    for (const row of document.querySelectorAll('li[data-info-row]')) {
      const name = (row.querySelector('.serif')?.textContent || '').trim();
      out[name] = [...row.querySelectorAll('a,span')]
        .filter(e => /^(CV|טופס)\s/.test((e.textContent || '').trim()))
        .map(e => ({ text: (e.textContent || '').trim(), tag: e.tagName, href: e.getAttribute('href') || null }));
    }
    return out;
  });
  const maya = chips['מאיה בר'] || [];
  check('both of מאיה\'s files are links', maya.length === 2 && maya.every(c => c.tag === 'A' && c.href),
    maya.map(c => `${c.text}=${c.tag}`).join(' '));
  const tal = chips['טל אבני'] || [];
  check('neither of טל\'s is a link', tal.length === 2 && tal.every(c => c.tag !== 'A'),
    tal.map(c => `${c.text}=${c.tag}`).join(' '));
  const ron = chips['רון שגב'] || [];
  check('רון: CV links, טופס does not', ron.length === 2
    && ron.find(c => c.text.startsWith('CV'))?.tag === 'A'
    && ron.find(c => c.text.startsWith('טופס'))?.tag !== 'A',
    ron.map(c => `${c.text}=${c.tag}`).join(' '));
}

// ── ICONS-shared ─────────────────────────────────────────────────────────────
console.log('\nICONS-shared: the contact row draws icons, not emoji');
{
  const seen = await pg.evaluate(() => {
    const row = document.querySelector('li[data-info-row]');
    const btns = [...row.querySelectorAll('button')].filter(b => /התקשר|WhatsApp|מייל/.test(b.getAttribute('title') || ''));
    return btns.map(b => ({ title: b.getAttribute('title'), svg: !!b.querySelector('svg'), text: (b.textContent || '').trim() }));
  });
  check('three contact buttons on the row', seen.length === 3, seen.map(s => s.title).join(' · '));
  check('each renders an <svg>, none renders a glyph', seen.length === 3 && seen.every(s => s.svg && s.text === ''),
    seen.map(s => `${s.svg ? 'svg' : 'NO-SVG'}${s.text ? `+"${s.text}"` : ''}`).join(' '));
}

check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await ctx.close();

// ── NARROW-phone ─────────────────────────────────────────────────────────────
console.log('\nNARROW-phone: 390px — no sideways scroll, and the number stays whole');
{
  const { pg: p2, ctx: c2 } = await openPage(390);
  const over = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check('no horizontal overflow', over.sw <= over.cw, `scrollWidth ${over.sw} vs client ${over.cw}`);
  // One line box for the phone span = it did not break mid-number.
  const lines = await p2.evaluate(() => {
    const row = document.querySelector('li[data-info-row]');
    const span = [...row.querySelectorAll('span')].find(s => /^\d{2,3}-\d{7}$/.test((s.textContent || '').trim()));
    return span ? span.getClientRects().length : -1;
  });
  check('the phone number occupies a single line', lines === 1, `client rects: ${lines}`);
  await c2.close();
}

await browser.close();
server.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error('\nFAILED:');
  for (const f of failed) console.error(`  ✗ ${f.name} — ${f.detail || ''}`);
  process.exit(1);
}
console.log('all green');

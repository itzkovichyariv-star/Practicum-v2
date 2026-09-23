#!/usr/bin/env node
/**
 * academic-calendar-check.mjs — the academic-year screen, driven as a browser, offline.
 *
 * WHAT IT IS FOR. The screen exists to answer one question about a date — "can I put a
 * guest lecturer here?" — and the ways that answer can be wrong are all VISUAL:
 *   · the verdict is computed correctly and never reaches the screen,
 *   · the day panel opens but the lecture's status is not on it,
 *   · it all works at 1180px and the cells are 38px on the phone he actually uses,
 *   · the sheet of paper renders white-on-white in dark mode.
 * unit/academic-calendar.spec.ts proves the logic. Only a browser proves the screen,
 * and only at 430px does it prove the screen he uses.
 *
 * OFFLINE, like its siblings in this directory: dist/ is served locally and every
 * off-origin call is answered from a fixture, so an unmerged branch is proven without
 * writing anything into the live practicum data.
 *
 *   npx astro build && node scripts/academic-calendar-check.mjs
 *
 * Screenshots land in test-results/academic-calendar/ (git-ignored).
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, 'test-results', 'academic-calendar');
const PORT = 4331;                       // clear of every other check's port

/* ── The dates under test, all read off the official Ariel תשפ״ז calendar ──── */
const SEMINAR_1 = '2026-10-25';          // סמינריון פרקטיקום — מפגש 1
const SIMULATION_1 = '2026-12-08';       // סימולציה 15:00, inside the חנוכה arrangement
const PESACH = '2027-04-24';             // inside חופשת פסח 21–28.4 — the university is shut
const EXAMS = '2027-01-25';              // inside מועדי בחינות סמסטר א׳ מועד א׳
const CLEAR_DAY = '2026-11-02';          // an ordinary Monday, nothing against it

const FIXTURE = {
  courses: [{ id: 'hr', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', type: 'practicum' }],
  academicYears: ['תשפ״ז'],
  students: [], candidates: [], employers: [], trainers: [], institutions: [],
  lectures: [
    /* approved, on a real teaching day — the settled case */
    { id: 'lec-approved', courseId: 'hr', courseName: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז',
      date: SEMINAR_1, startTime: '17:00', endTime: '20:00', topic: 'שוק העבודה מאז ועד היום',
      lecturer: 'מיכל לאופר פסגות', lecturerEmail: 'michal@example.com', lecturerPhone: '0501234567',
      type: 'הרצאה', semester: 'א׳', status: 'מאושר', institution: 'אוניברסיטת אריאל' },
    /* NOT approved — the one he is chasing, and the state the cell must shout */
    { id: 'lec-pending', courseId: 'hr', courseName: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז',
      date: CLEAR_DAY, startTime: '18:30', endTime: '20:00', topic: 'גיוס טכנולוגי',
      lecturer: 'אופיר קרקו', lecturerEmail: 'ofir@example.com', lecturerPhone: '0504014350',
      type: 'הרצאה', semester: 'א׳', status: 'ממתין לאישור', institution: 'אוניברסיטת אריאל' },
    /* THE BUG THIS SCREEN PREVENTS: a lecturer booked inside חופשת פסח */
    { id: 'lec-on-pesach', courseId: 'hr', courseName: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז',
      date: PESACH, startTime: '17:00', endTime: '19:00', topic: 'מפגש שנקבע בחופשת פסח',
      lecturer: 'דנה לוי', lecturerEmail: 'dana@example.com', lecturerPhone: '0521112222',
      type: 'הרצאה', semester: 'ב׳', status: 'ממתין לאישור', institution: 'אוניברסיטת אריאל' },
    /* and one inside the four-week exam window nobody remembers */
    { id: 'lec-in-exams', courseId: 'hr', courseName: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז',
      date: EXAMS, startTime: '10:00', endTime: '12:00', topic: 'מפגש בתקופת בחינות',
      lecturer: 'רון כהן', lecturerEmail: 'ron@example.com', lecturerPhone: '0533334444',
      type: 'הרצאה', semester: 'א׳', status: 'טנטטיבי', institution: 'אוניברסיטת אריאל' },
    /* cancelled — visible, inert, and NEVER a conflict even though it is on פסח */
    { id: 'lec-cancelled', courseId: 'hr', courseName: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז',
      date: PESACH, startTime: '09:00', endTime: '10:00', topic: 'מפגש שבוטל',
      lecturer: 'נועה שגיא', lecturerEmail: 'noa@example.com', lecturerPhone: '0545556666',
      type: 'הרצאה', semester: 'ב׳', status: 'בוטל', institution: 'אוניברסיטת אריאל' },
  ],
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const b = await readFile(join(DIST, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(PORT, r));
await mkdir(SHOTS, { recursive: true });

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass === null ? '•' : pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
             '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

async function openScreen(width, theme = 'light') {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    // A service worker would serve its own cached bundle straight past route(), which
    // has cost this repo a run before.
    serviceWorkers: 'block',
  });
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
    if (url.includes('practicum_data') && route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: FIXTURE, updated_at: '2026-09-23T00:00:00.000Z',
          last_editor_name: 'check', last_editor_email: 'check@local' }) });
    }
    if (url.includes('fonts.g')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await ctx.addInitScript((t) => {
    localStorage.setItem('practicum_v2_session', JSON.stringify({ profile: { name: 'יריב איצקוביץ', email: 'yarivi@ariel.ac.il' } }));
    localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: '__all__', year: '__all__' }));
    localStorage.setItem('practicum_v2_page', 'academic');
    localStorage.setItem('practicum_theme', t);
  }, theme);
  const pg = await ctx.newPage();
  await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await pg.waitForSelector('[data-academic-year-page]', { timeout: 20000 });
  await pg.waitForSelector('[data-paper]', { timeout: 20000 });
  return { pg, ctx };
}

/** Open a day's panel by jumping to its month first — a cell in another month is not in the DOM. */
async function openDay(pg, iso) {
  await pg.click(`[data-month-chip="${iso.slice(0, 7)}"]`);
  await pg.waitForSelector(cell(iso), { timeout: 10000 });
  await pg.click(cell(iso));
  await pg.waitForSelector(`[data-day-sheet="${iso}"]`, { timeout: 10000 });
}

/** A day cell ON THE PAPER CARD. The all-twelve column below carries the same
 *  data-academic-day attributes (hidden until it is expanded), so every selector that
 *  means "the cell on screen" has to say which one. */
const cell = (iso) => `[data-paper] [data-academic-day="${iso}"]`;

console.log('\nacademic-calendar-check — offline, fixture-backed, at the width Yariv works\n');

/* ══════════════ PHONE (430px): the screen he actually uses ══════════════ */
console.log('PHONE (430px)');
{
  const { pg, ctx } = await openScreen(430);

  // ── ACAL-grid: twelve months, and the paper is paper ──────────────────────
  const chips = await pg.$$eval('[data-month-chip]', (els) => els.map((e) => e.getAttribute('data-month-chip')));
  check('ACAL-months — twelve jump chips, October 2026 → September 2027',
    chips.length === 12 && chips[0] === '2026-10' && chips[11] === '2027-09',
    `${chips.length} chips: ${chips[0]} … ${chips[chips.length - 1]}`);

  const paper = await pg.evaluate(() => {
    const el = document.querySelector('[data-paper]');
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, fg: cs.color };
  });
  check('ACAL-paper — the university\'s sheet is white with black ink',
    paper.bg === 'rgb(255, 255, 255)' && paper.fg === 'rgb(0, 0, 0)',
    `background ${paper.bg}, ink ${paper.fg}`);

  // ── ACAL-noscroll: no sideways drift at 430px ─────────────────────────────
  const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('ACAL-noscroll — the page does not scroll sideways at 430px', over <= 0, `${over}px over`);

  // ── ACAL-tap: every tap target clears 44px ────────────────────────────────
  const small = await pg.evaluate(() => {
    const sel = '[data-month-chip], [data-academic-day], [data-all-months] summary';
    return [...document.querySelectorAll(sel)]
      .map((e) => ({ what: e.getAttribute('data-month-chip') || e.getAttribute('data-academic-day') || 'summary',
                     h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) }))
      .filter((x) => x.h > 0 && (x.h < 44 || x.w < 44));
  });
  check('ACAL-tap — no tap target under 44px', small.length === 0,
    small.length ? small.slice(0, 4).map((s) => `${s.what} ${s.w}×${s.h}`).join(' · ') : 'day cells, chips and the expander all clear it');

  // ── ACAL-simulation: 8.12 paints red, not חנוכה cream ─────────────────────
  await pg.click('[data-month-chip="2026-12"]');
  await pg.waitForSelector(cell(SIMULATION_1));
  const simBg = await pg.$eval(cell(SIMULATION_1), (e) => getComputedStyle(e).backgroundColor);
  check('ACAL-simulation — 8.12 is drawn as a simulation (red), not as the חנוכה arrangement',
    simBg === 'rgb(224, 102, 102)', `cell background ${simBg}`);

  // ── ACAL-foreground: a booked day is ringed; an unapproved one in amber ────
  await pg.click('[data-month-chip="2026-11"]');
  await pg.waitForSelector(cell(CLEAR_DAY));
  // The colours are read off the LEGEND rather than typed here, so the cell and the
  // legend are asserted to agree. A hand-copied hex in this file could only ever prove
  // that two literals match; this proves the thing the legend promises.
  const swatch = (state) => pg.$eval(`[data-legend-swatch="${state}"]`, (e) => getComputedStyle(e).backgroundColor);
  const pendingColor = await swatch('pending');
  const approvedColor = await swatch('approved');

  const ring = await pg.$eval(cell(CLEAR_DAY), (e) => ({
    shadow: getComputedStyle(e).boxShadow,
    lectures: e.getAttribute('data-lectures'),
    bars: e.querySelectorAll('[data-lecture-bars] > span').length,
  }));
  check('ACAL-foreground — a day with an unapproved lecture is ringed in the legend\'s amber',
    ring.lectures === '1' && ring.bars >= 1 && ring.shadow.includes(pendingColor),
    `data-lectures=${ring.lectures}, bars=${ring.bars}, ring "${ring.shadow || 'none'}" vs legend ${pendingColor}`);

  const approvedRing = await pg.evaluate(async (iso) => {
    document.querySelector('[data-month-chip="2026-10"]').click();
    await new Promise((r) => setTimeout(r, 350));
    const e = document.querySelector(`[data-paper] [data-academic-day="${iso}"]`);
    return e ? getComputedStyle(e).boxShadow : 'missing';
  }, SEMINAR_1);
  check('ACAL-foreground-approved — an approved-only day is ringed in the legend\'s wine, not amber',
    approvedRing.includes(approvedColor) && !approvedRing.includes(pendingColor),
    `${approvedRing} vs legend ${approvedColor}`);

  // ── ACAL-verdict-blocked: THE feature ─────────────────────────────────────
  await openDay(pg, PESACH);
  const bad = await pg.evaluate(() => {
    const sheet = document.querySelector('[data-day-sheet]');
    const v = sheet.querySelector('[data-day-verdict]');
    return {
      verdict: v.getAttribute('data-day-verdict'),
      text: v.innerText.replace(/\s+/g, ' ').trim(),
      conflictNote: sheet.querySelector('[data-day-conflict]')?.innerText.trim() || null,
      lectures: [...sheet.querySelectorAll('[data-day-lecture]')].map((e) => ({
        state: e.getAttribute('data-lecture-state'),
        text: e.innerText.replace(/\s+/g, ' ').trim(),
      })),
      academic: [...sheet.querySelectorAll('[data-day-academic]')].map((e) => e.getAttribute('data-day-academic')),
    };
  });
  check('ACAL-verdict-blocked — חופשת פסח says, in words, that the day is unsuitable',
    bad.verdict === 'blocked' && bad.text.includes('לא מתאים') && bad.text.includes('חופשת פסח'),
    `verdict=${bad.verdict} · "${bad.text.slice(0, 90)}"`);
  check('ACAL-conflict-note — and it says a lecture is already standing there',
    !!bad.conflictNote, bad.conflictNote || 'no note rendered');
  check('ACAL-day-academic — the day panel lists the academic item behind the verdict',
    bad.academic.includes('off'), `categories: ${bad.academic.join(', ') || 'none'}`);

  // ── ACAL-day-lectures: time, topic, lecturer, course, status, all present ──
  const pesachLecture = bad.lectures.find((l) => l.state === 'pending');
  check('ACAL-day-lecture-fields — the panel shows time, topic, lecturer, course and status',
    !!pesachLecture
      && pesachLecture.text.includes('17:00–19:00')
      && pesachLecture.text.includes('מפגש שנקבע בחופשת פסח')
      && pesachLecture.text.includes('דנה לוי')
      && pesachLecture.text.includes('פרקטיקום משאבי אנוש')
      && pesachLecture.text.includes('ממתין לאישור'),
    pesachLecture ? `"${pesachLecture.text.slice(0, 110)}"` : 'no pending lecture in the panel');
  check('ACAL-day-cancelled — a cancelled lecture is shown but marked cancelled',
    bad.lectures.some((l) => l.state === 'cancelled' && l.text.includes('בוטל')),
    `${bad.lectures.length} lectures on the day: ${bad.lectures.map((l) => l.state).join(', ')}`);

  await pg.screenshot({ path: join(SHOTS, 'day-panel-blocked-430.png'), fullPage: false });

  // ── ACAL-add-lecture: the existing editor, already on this date ────────────
  await pg.click(`[data-add-lecture="${PESACH}"]`);
  await pg.waitForSelector('#lecture-start-time', { timeout: 10000 });
  const editor = await pg.evaluate(() => {
    const date = document.querySelector('input[type="date"]');
    const body = document.body.innerText;
    return { date: date?.value || null, isNew: body.includes('הרצאה חדשה'), createBtn: body.includes('צור הרצאה') };
  });
  check('ACAL-add-lecture — the day panel opens the app\'s OWN lecture editor, pre-filled with the date',
    editor.date === PESACH && editor.isNew && editor.createBtn,
    `date field = ${editor.date}, "הרצאה חדשה" = ${editor.isNew}`);
  await pg.keyboard.press('Escape').catch(() => {});

  // ── ACAL-all-months: the whole year as one object, when he wants it ───────
  // Hidden behind an expander so the phone lands on one month, but it is a real
  // surface: twelve grids, every day still a 44px target, still no sideways drift.
  await pg.click('[data-all-months] summary');
  await pg.waitForTimeout(400);
  const column = await pg.evaluate(() => {
    const months = [...document.querySelectorAll('[data-all-months] [data-month]')];
    const cells = [...document.querySelectorAll('[data-all-months] [data-academic-day]')];
    const tooSmall = cells.filter((c) => {
      const r = c.getBoundingClientRect();
      return r.height > 0 && (r.height < 44 || r.width < 44);
    }).length;
    return {
      months: months.length,
      keys: months.map((m) => m.getAttribute('data-month')),
      cells: cells.length,
      tooSmall,
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  check('ACAL-all-months — expanding shows all twelve grids, none of them cramped',
    column.months === 12 && column.keys[0] === '2026-10' && column.keys[11] === '2027-09'
      && column.tooSmall === 0 && column.over <= 0,
    `${column.months} months · ${column.cells} day cells · ${column.tooSmall} under 44px · ${column.over}px sideways`);
  await pg.screenshot({ path: join(SHOTS, 'all-months-430.png'), fullPage: false });

  await ctx.close();
}

/* ══════════════ the year view, the conflict list and the legend ══════════ */
console.log('\nYEAR VIEW + CONFLICTS + LEGEND (430px)');
{
  const { pg, ctx } = await openScreen(430);

  // The banner has to be above the fold, or it is not a warning.
  const banner = await pg.evaluate(() => {
    const b = document.querySelector('[data-conflict-banner]');
    if (!b) return null;
    return {
      text: b.innerText.replace(/\s+/g, ' ').trim(),
      rows: b.querySelectorAll('li').length,
      top: Math.round(b.getBoundingClientRect().top),
    };
  });
  check('ACAL-conflict-banner — the two misplaced lectures are listed on arrival',
    !!banner && banner.rows === 2 && banner.text.includes('חופשת פסח') && banner.text.includes('בחינות'),
    banner ? `${banner.rows} rows at y=${banner.top}: "${banner.text.slice(0, 100)}"` : 'no banner');
  check('ACAL-conflict-cancelled-excluded — the cancelled lecture on פסח is NOT called a conflict',
    !!banner && !banner.text.includes('מפגש שבוטל'),
    banner ? 'cancelled row absent, as intended' : 'no banner');

  // The headline counts what is on screen.
  const stats = await pg.evaluate(() => document.querySelector('[data-academic-year-page] section').innerText.replace(/\s+/g, ' '));
  check('ACAL-headline — the year\'s lecture counts are stated up front',
    /הרצאות בשנה 5/.test(stats) && /מאושרות 1/.test(stats) && /טרם אושרו 3/.test(stats),
    stats.slice(0, 140));

  // The legend must name every colour the grid can draw.
  const legend = await pg.evaluate(() => {
    const el = document.querySelector('[data-legend]');
    return {
      swatches: [...el.querySelectorAll('[data-legend-swatch]')].map((s) => s.getAttribute('data-legend-swatch')),
      text: el.innerText.replace(/\s+/g, ' ').trim(),
    };
  });
  const needed = ['approved', 'pending', 'cancelled',
    'off', 'boundary', 'makeup_day', 'simulation', 'skills', 'practicum', 'seminar', 'todo', 'exam', 'special'];
  const missing = needed.filter((k) => !legend.swatches.includes(k));
  check('ACAL-legend — every colour on the grid has a label', missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : `${legend.swatches.length} swatches, all named`);

  await pg.screenshot({ path: join(SHOTS, 'year-view-430.png'), fullPage: false });
  await pg.screenshot({ path: join(SHOTS, 'year-view-430-full.png'), fullPage: true });

  // A clear day must say so — the screen has to be usable, not only cautious.
  await openDay(pg, CLEAR_DAY);
  const good = await pg.$eval('[data-day-verdict]', (e) => ({
    verdict: e.getAttribute('data-day-verdict'), text: e.innerText.replace(/\s+/g, ' ').trim(),
  }));
  check('ACAL-verdict-open — an ordinary Monday says the date is suitable',
    good.verdict === 'open' && good.text.includes('מתאים'), `verdict=${good.verdict} · "${good.text.slice(0, 70)}"`);
  await pg.screenshot({ path: join(SHOTS, 'day-panel-open-430.png'), fullPage: false });

  // And the seminar day carries its academic item next to the lecture.
  await pg.keyboard.press('Escape');
  await openDay(pg, SEMINAR_1);
  const seminar = await pg.evaluate(() => {
    const s = document.querySelector('[data-day-sheet]');
    return {
      verdict: s.querySelector('[data-day-verdict]').getAttribute('data-day-verdict'),
      academic: [...s.querySelectorAll('[data-day-academic]')].map((e) => e.getAttribute('data-day-academic')),
      text: s.innerText.replace(/\s+/g, ' ').trim(),
    };
  });
  check('ACAL-seminar — 25.10 shows מפגש 1 of the seminar alongside the booked lecture',
    seminar.academic.includes('seminar') && seminar.text.includes('מפגש 1') && seminar.verdict !== 'blocked',
    `verdict=${seminar.verdict}, categories: ${seminar.academic.join(', ')}`);
  await pg.screenshot({ path: join(SHOTS, 'day-panel-seminar-430.png'), fullPage: false });

  await ctx.close();
}

/* ══════════════ DARK MODE: the paper must not go white-on-white ══════════ */
console.log('\nDARK MODE (430px)');
{
  const { pg, ctx } = await openScreen(430, 'dark');
  const paper = await pg.evaluate(() => {
    const el = document.querySelector('[data-paper]');
    const cs = getComputedStyle(el);
    const cell = document.querySelector('[data-paper] [data-academic-day]');
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      bg: cs.backgroundColor, fg: cs.color,
      cellFg: cell ? getComputedStyle(cell).color : null,
    };
  });
  check('ACAL-dark-paper — the printed calendar stays white paper / black ink in dark mode',
    paper.theme === 'dark' && paper.bg === 'rgb(255, 255, 255)' && paper.fg === 'rgb(0, 0, 0)'
      && paper.cellFg === 'rgb(0, 0, 0)',
    `theme=${paper.theme}, paper ${paper.bg}, ink ${paper.fg}, cell ink ${paper.cellFg}`);
  await pg.screenshot({ path: join(SHOTS, 'year-view-430-dark.png'), fullPage: false });
  await ctx.close();
}

/* ══════════════ DESKTOP: nothing was taken away from the wider screen ════ */
console.log('\nDESKTOP (1180px)');
{
  const { pg, ctx } = await openScreen(1180);
  const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('ACAL-desktop-noscroll — no sideways drift at 1180px either', over <= 0, `${over}px over`);

  await openDay(pg, EXAMS);
  const exam = await pg.$eval('[data-day-verdict]', (e) => ({
    verdict: e.getAttribute('data-day-verdict'), text: e.innerText.replace(/\s+/g, ' ').trim(),
  }));
  check('ACAL-verdict-exam — a date inside the exam window is refused, and says which window',
    exam.verdict === 'blocked' && exam.text.includes('בחינות'), `"${exam.text.slice(0, 90)}"`);
  await pg.screenshot({ path: join(SHOTS, 'day-panel-exams-1180.png'), fullPage: false });
  await ctx.close();
}

await browser.close();
server.close();

console.log(`\nscreenshots → ${SHOTS}`);
const failed = results.filter((r) => r.pass === false);
const skipped = results.filter((r) => r.pass === null);
console.log(`${results.length - failed.length - skipped.length}/${results.length} checks passed${skipped.length ? ` (${skipped.length} not run)` : ''}`);
if (failed.length) {
  console.error(`\n❌ ${failed.length} failed: ${failed.map((f) => f.name).join(' · ')}`);
  process.exit(1);
}
console.log('✅ academic-calendar-check passed');

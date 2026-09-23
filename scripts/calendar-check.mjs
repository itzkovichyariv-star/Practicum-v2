#!/usr/bin/env node
/**
 * calendar-check.mjs — THE calendar (`page === 'calendar'`), driven as a browser, offline.
 *
 * WHAT IT IS FOR. Practicum had two calendars for an hour: 📅 לוח שנה, which already drew
 * lectures, interviews, free interview slots and preparations, and 🎓 לוח אקדמי, shipped
 * beside it. Yariv: "זה מה שצריך לוח מאוחד עם האירועים". They are one screen now, and the
 * ways that can be wrong are all VISUAL:
 *   · the academic fill lands on the month grid and buries the event chips,
 *   · the verdict is computed correctly and never reaches the screen,
 *   · the day sheet opens but does not say whether there is teaching, or who the guest is,
 *   · month and year are both on screen at once,
 *   · it all works at 1180px and the cells are 38px on the phone he actually uses.
 * unit/academic-calendar.spec.ts proves the logic. Only a browser proves the screen,
 * and only at 430px does it prove the screen he uses.
 *
 * NO CELL MAY TARGET A `לוח אקדמי` ROUTE — that page is gone. Everything below drives
 * `practicum_v2_page = 'calendar'`, and one cell asserts that a stored 'academic'
 * resumes onto the merged calendar instead of a blank screen.
 *
 * OFFLINE, like its siblings in this directory: dist/ is served locally and every
 * off-origin call is answered from a fixture, so an unmerged branch is proven without
 * writing anything into the live practicum data.
 *
 *   npx astro build && node scripts/calendar-check.mjs
 *
 * Screenshots land in test-results/calendar/ (git-ignored).
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, 'test-results', 'calendar');
const PORT = 4331;                       // clear of every other check's port

/* ── The dates under test, all read off the official Ariel תשפ״ז calendar ──── */
const SEMINAR_1 = '2026-10-25';          // סמינריון פרקטיקום — מפגש 1, 17:00–20:00
const SIMULATION_1 = '2026-12-08';       // מיומנויות א׳ מפגש 7 · סימולציה 15:00, in the חנוכה arrangement
const PESACH = '2027-04-24';             // inside חופשת פסח 21–28.4 — the university is shut
const EXAMS = '2027-01-25';              // inside מועדי בחינות סמסטר א׳ מועד א׳
const CLEAR_DAY = '2026-11-02';          // an ordinary Monday, nothing against it

const FIXTURE = {
  courses: [{ id: 'hr', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', type: 'practicum' }],
  academicYears: ['תשפ״ז'],
  students: [], candidates: [], employers: [], institutions: [],
  /* The people records the day sheet has to reach: one lecturer who HAS a card and one
     who does not, so both branches of the contact panel are exercised on screen. */
  trainers: [
    { id: 't-michal', name: 'מיכל לאופר פסגות', role: 'מרצה', email: 'michal@psagot.example',
      phone: '050-1234567', organization: 'פסגות', courseId: 'hr', year: 'תשפ״ז' },
  ],
  lectures: [
    /* approved, on a real teaching day, by a lecturer who HAS a trainer record */
    { id: 'lec-approved', courseId: 'hr', courseName: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז',
      date: SEMINAR_1, startTime: '17:00', endTime: '20:00', topic: 'שוק העבודה מאז ועד היום',
      lecturer: 'מיכל לאופר פסגות', lecturerEmail: 'stale@old.example', lecturerPhone: '0501234567',
      type: 'הרצאה', semester: 'א׳', status: 'מאושר', institution: 'אוניברסיטת אריאל' },
    /* NOT approved — the one he is chasing — by a lecturer with NO trainer record, so
       the panel has to fall back to the lecture's own contact fields */
    { id: 'lec-pending', courseId: 'hr', courseName: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז',
      date: CLEAR_DAY, startTime: '18:30', endTime: '20:00', topic: 'גיוס טכנולוגי',
      lecturer: 'אופיר קרקו', lecturerEmail: 'ofir@example.com', lecturerPhone: '0504014350',
      type: 'הרצאה', semester: 'א׳', status: 'ממתין לאישור', institution: 'אוניברסיטת אריאל' },
    /* a guest lecture ON the simulation day — teaching AND a guest, the sheet he asked to see */
    { id: 'lec-on-simday', courseId: 'hr', courseName: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז',
      date: SIMULATION_1, startTime: '19:00', endTime: '20:30', topic: 'ראיון עומק בארגון',
      lecturer: 'מיכל לאופר פסגות', lecturerEmail: 'michal@psagot.example', lecturerPhone: '0501234567',
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

async function openScreen(width, { theme = 'light', page = 'calendar' } = {}) {
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
  await ctx.addInitScript(([t, p]) => {
    localStorage.setItem('practicum_v2_session', JSON.stringify({ profile: { name: 'יריב איצקוביץ', email: 'yarivi@ariel.ac.il' } }));
    localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: '__all__', year: '__all__' }));
    localStorage.setItem('practicum_v2_page', p);
    localStorage.setItem('practicum_theme', t);
  }, [theme, page]);
  const pg = await ctx.newPage();
  await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await pg.waitForSelector('[data-calendar-page]', { timeout: 20000 });
  return { pg, ctx };
}

/** The month grid shows one month at a time — walk the cursor to the month that holds
 *  `iso`, then open its day sheet. No `לוח אקדמי` route is involved. */
async function openDayInMonth(pg, iso) {
  const want = iso.slice(0, 7);
  for (let i = 0; i < 30; i++) {
    const shown = await pg.$eval('[data-month-grid]', (e) => e.getAttribute('data-month-grid'));
    if (shown === want) break;
    await pg.click(shown < want ? 'text=חודש הבא' : 'text=חודש קודם');
    await pg.waitForTimeout(60);
  }
  await pg.waitForSelector(`[data-day-cell="${iso}"]`, { timeout: 10000 });
  await pg.click(`[data-day-cell="${iso}"]`);
  await pg.waitForSelector(`[data-day-sheet="${iso}"]`, { timeout: 10000 });
}

const readSheet = (pg) => pg.evaluate(() => {
  const s = document.querySelector('[data-day-sheet]');
  if (!s) return null;
  const v = s.querySelector('[data-day-verdict]');
  return {
    verdict: v?.getAttribute('data-day-verdict') ?? null,
    verdictText: (v?.innerText || '').replace(/\s+/g, ' ').trim(),
    conflictNote: s.querySelector('[data-day-conflict]')?.innerText.trim() || null,
    teaching: Number(s.querySelector('[data-day-teaching]')?.getAttribute('data-day-teaching') ?? -1),
    teachingText: (s.querySelector('[data-day-teaching]')?.innerText || '').replace(/\s+/g, ' ').trim(),
    sessions: [...s.querySelectorAll('[data-day-session]')].map((e) => e.getAttribute('data-day-session')),
    guests: Number(s.querySelector('[data-day-guests]')?.getAttribute('data-day-guests') ?? -1),
    lectures: [...s.querySelectorAll('[data-day-lecture]')].map((e) => ({
      state: e.getAttribute('data-lecture-state'),
      kind: e.getAttribute('data-lecture-kind'),
      text: e.innerText.replace(/\s+/g, ' ').trim(),
    })),
    cards: [...s.querySelectorAll('[data-lecturer-card]')].map((e) => ({
      source: e.getAttribute('data-lecturer-card'),
      phone: e.querySelector('[data-lecturer-phone]')?.getAttribute('href') || null,
      email: e.querySelector('[data-lecturer-email]')?.getAttribute('href') || null,
      openRecord: !!e.querySelector('[data-lecturer-open-record]'),
      text: e.innerText.replace(/\s+/g, ' ').trim(),
    })),
    academic: [...s.querySelectorAll('[data-day-academic]')].map((e) => e.getAttribute('data-day-academic')),
    events: [...s.querySelectorAll('[data-day-event]')].map((e) => e.getAttribute('data-day-event')),
    addBtn: !!s.querySelector('[data-add-lecture]'),
  };
});

console.log('\ncalendar-check — one calendar, offline, at the width Yariv works\n');

/* ══════════════ PHONE (430px): the month view ══════════════ */
console.log('PHONE (430px) — the month view');
{
  const { pg, ctx } = await openScreen(430);

  // ── CAL-one-screen: the merged screen IS לוח שנה, and it opens on the month ────
  const shell = await pg.evaluate(() => ({
    view: document.querySelector('[data-calendar-page]')?.getAttribute('data-calendar-view'),
    chapter: document.querySelector('.chapter-mark')?.innerText.trim(),
    monthGrids: document.querySelectorAll('[data-month-grid]').length,
    posters: document.querySelectorAll('[data-year-poster]').length,
  }));
  check('CAL-one-screen — לוח שנה opens on the month grid, with no poster beside it',
    shell.view === 'month' && shell.monthGrids === 1 && shell.posters === 0 && /לוח שנה/.test(shell.chapter || ''),
    `view=${shell.view}, month grids=${shell.monthGrids}, posters=${shell.posters}, chapter="${shell.chapter}"`);

  // ── CAL-noscroll / CAL-tap ────────────────────────────────────────────────
  const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('CAL-noscroll — the page does not scroll sideways at 430px', over <= 0, `${over}px over`);

  const small = await pg.evaluate(() => {
    const sel = '[data-day-cell], [data-view-btn]';
    return [...document.querySelectorAll(sel)]
      .map((e) => ({ what: e.getAttribute('data-day-cell') || e.getAttribute('data-view-btn'),
                     h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) }))
      .filter((x) => x.h > 0 && (x.h < 44 || x.w < 44));
  });
  check('CAL-tap — no tap target under 44px on the month view', small.length === 0,
    small.length ? small.slice(0, 4).map((s) => `${s.what} ${s.w}×${s.h}`).join(' · ') : 'day cells and the view toggle all clear it');

  // ── CAL-event-fill: the EVENTS own the whole cell ─────────────────────────
  // Yariv: "תצבע את כל הריבוע בצבע המתאים כי הנקודה לא ממש ויזיבילית". 8.12 carries the
  // simulation session AND a guest lecture, so it must be TWO stripes across the whole
  // cell — not a dot, and not one colour hiding the other.
  await openDayInMonth(pg, SIMULATION_1);
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(150);
  const fills = await pg.evaluate((iso) => {
    const e = document.querySelector(`[data-day-cell="${iso}"]`);
    if (!e) return null;
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return { image: cs.backgroundImage, stripes: e.getAttribute('data-filled'),
             w: Math.round(r.width), h: Math.round(r.height) };
  }, SIMULATION_1);
  check('CAL-event-fill — 8.12 fills the WHOLE cell: a lecture stripe and the simulation stripe',
    fills?.stripes === '2'
      && /linear-gradient/.test(fills.image)
      && fills.image.includes('rgb(122, 30, 43)')     // הרצאה
      && fills.image.includes('rgb(224, 102, 102)'),  // סימולציה
    `data-filled=${fills?.stripes} over ${fills?.w}\u00d7${fills?.h}px — ${String(fills?.image).slice(0, 120)}`);

  // a single-kind day is ONE solid block, which is what "colour the whole square" means
  const solid = await pg.evaluate(() => {
    const e = [...document.querySelectorAll('[data-day-cell][data-filled="1"]')][0];
    return e ? { iso: e.getAttribute('data-day-cell'), image: getComputedStyle(e).backgroundImage } : null;
  });
  check('CAL-event-fill-solid — a day with one kind of event is a single solid block of colour',
    !!solid && /linear-gradient/.test(solid.image) && solid.image.split('rgb').length === 3,
    solid ? `${solid.iso}: ${solid.image.slice(0, 100)}` : 'no single-kind day in this month');

  // ── CAL-events-kept: at 430px the cell is colour + date + COUNT. A 55px cell
  //    truncates every title to two characters, so the titles move to the day sheet
  //    and the phone gets a number it can actually read. ──
  const marks = await pg.evaluate((iso) => {
    const cell = document.querySelector(`[data-day-cell="${iso}"]`);
    const badge = cell?.querySelector('[data-event-count]');
    const chip = cell?.querySelector('[data-event-chip]');
    return {
      count: badge?.getAttribute('data-event-count') ?? null,
      countVisible: badge ? getComputedStyle(badge).display !== 'none' : false,
      countText: badge?.innerText.trim() ?? null,
      chipInDom: !!chip,
      chipHidden: chip ? getComputedStyle(chip.parentElement).display === 'none' : null,
      lectures: cell?.getAttribute('data-lectures'),
      verdict: cell?.getAttribute('data-verdict'),
    };
  }, SIMULATION_1);
  check('CAL-events-kept — at 430px the cell carries a readable event COUNT, not a truncated title',
    marks.count === '1' && marks.countVisible && marks.countText === '1'
      && marks.chipInDom && marks.chipHidden === true && marks.lectures === '1',
    `count=${marks.countText} (visible=${marks.countVisible}), titles hidden at this width=${marks.chipHidden}, data-lectures=${marks.lectures}`);

  // ── CAL-band: the university's day type moved to a band, and "do not book here"
  //    is CAUTION TAPE, which survives sitting next to a saturated event colour. ──
  const band = await pg.evaluate(() => {
    const walk = (iso) => {
      const c = document.querySelector(`[data-day-cell="${iso}"]`);
      const b = c?.querySelector('[data-academic-band]');
      if (!b) return null;
      const cs = getComputedStyle(b);
      const cr = c.getBoundingClientRect(), br = b.getBoundingClientRect();
      return { category: b.getAttribute('data-academic-band'), blocked: b.getAttribute('data-band-blocked'),
               image: cs.backgroundImage, color: cs.backgroundColor,
               h: Math.round(br.height), fullWidth: Math.abs(br.width - cr.width) <= 1,
               aria: c.getAttribute('aria-label') };
    };
    return { hanukkah: walk('2026-12-04'), plain: walk('2026-12-01') };
  });
  check('CAL-band-present — a university day type draws a full-width band, and names itself to the reader',
    !!band.hanukkah && band.hanukkah.fullWidth && band.hanukkah.h >= 10
      && band.hanukkah.category === 'special'
      && /הסדר מיוחד/.test(String(band.hanukkah.aria)),
    band.hanukkah ? `${band.hanukkah.category} band ${band.hanukkah.h}px, full width=${band.hanukkah.fullWidth}, aria="${String(band.hanukkah.aria).slice(0, 70)}"` : 'no band on 4.12');
  check('CAL-band-absent — a day the university says nothing about draws no band at all',
    band.plain === null, band.plain ? `unexpected ${band.plain.category} band` : 'no band, as intended');

  await pg.screenshot({ path: join(SHOTS, 'month-430.png'), fullPage: false });
  // the whole screen in one image — grid, legend and month list — which is what
  // Yariv is actually judging when he asks whether the colours read.
  await pg.screenshot({ path: join(SHOTS, 'month-430-full.png'), fullPage: true });
  await ctx.close();
}

/* ══════════════ "DO NOT BOOK HERE" SURVIVES THE FILL ══════════════ */
console.log('\nTHE BLOCKED SIGNAL (430px)');
{
  const { pg, ctx } = await openScreen(430);
  // חופשת פסח: the university is SHUT and a lecture is standing on it, so the cell is
  // filled by the event AND has to keep saying "not here".
  await openDayInMonth(pg, PESACH);
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(150);
  const shut = await pg.evaluate((iso) => {
    const c = document.querySelector(`[data-day-cell="${iso}"]`);
    const b = c?.querySelector('[data-academic-band]');
    return {
      verdict: c?.getAttribute('data-verdict'),
      filled: c?.getAttribute('data-filled'),
      cellImage: getComputedStyle(c).backgroundImage,
      bandBlocked: b?.getAttribute('data-band-blocked') ?? null,
      bandImage: b ? getComputedStyle(b).backgroundImage : null,
      aria: c?.getAttribute('aria-label') ?? null,
      labelCategory: c?.querySelector('[data-band-label]')?.getAttribute('data-band-label') ?? null,
      labelWeight: c?.querySelector('[data-band-label]') ? getComputedStyle(c.querySelector('[data-band-label]')).fontWeight : null,
    };
  }, PESACH);
  check('CAL-blocked-band — a shut day keeps its event fill AND is hatched as caution tape',
    shut.verdict === 'blocked'
      && shut.filled !== '0'
      && shut.bandBlocked === '1'
      && /repeating-linear-gradient/.test(String(shut.bandImage)),
    `verdict=${shut.verdict}, stripes=${shut.filled}, band blocked=${shut.bandBlocked}, ${String(shut.bandImage).slice(0, 90)}`);
  check('CAL-blocked-label — and it names which kind of shut day it is, in bold from 640px up',
    shut.labelCategory === 'off' && Number(shut.labelWeight) >= 700 && /אין לימודים/.test(String(shut.aria)),
    `category=${shut.labelCategory} weight=${shut.labelWeight} aria="${String(shut.aria).slice(0, 70)}"`);

  // ── CAL-today-chrome: today and the open day are chrome, never a colour ────
  const chrome = await pg.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-day-cell]')];
    const filled = cells.find((c) => c.getAttribute('data-filled') !== '0');
    const empty = cells.find((c) => c.getAttribute('data-filled') === '0');
    return {
      emptyHasNoFill: empty ? getComputedStyle(empty).backgroundImage === 'none'
        && getComputedStyle(empty).backgroundColor === 'rgba(0, 0, 0, 0)' : null,
      filledIso: filled?.getAttribute('data-day-cell') ?? null,
    };
  });
  check('CAL-empty-day-uncoloured — a day with nothing on it takes no fill at all',
    chrome.emptyHasNoFill === true, `empty cell painted: ${!chrome.emptyHasNoFill}`);

  // the open day must be unmistakable even though the fill is spoken for
  await pg.click(`[data-day-cell="${PESACH}"]`);
  await pg.waitForSelector(`[data-day-sheet="${PESACH}"]`);
  const openRing = await pg.evaluate((iso) => {
    const c = document.querySelector(`[data-day-cell="${iso}"]`);
    return getComputedStyle(c).boxShadow;
  }, PESACH);
  check('CAL-open-ring — the open day carries a ring, on top of whatever fills it',
    /inset/.test(openRing) && openRing !== 'none',
    `box-shadow: ${String(openRing).slice(0, 110)}`);
  await ctx.close();
}

/* ══════════════ the day sheet: the three questions ══════════════ */
console.log('\nTHE DAY SHEET (430px) — teaching · guests · who the lecturer is');
{
  const { pg, ctx } = await openScreen(430);

  // ── CAL-verdict-blocked: THE feature ──────────────────────────────────────
  await openDayInMonth(pg, PESACH);
  const bad = await readSheet(pg);
  check('CAL-verdict-blocked — חופשת פסח says, in words, that the day is unsuitable',
    bad.verdict === 'blocked' && bad.verdictText.includes('לא מתאים') && bad.verdictText.includes('חופשת פסח'),
    `verdict=${bad.verdict} · "${bad.verdictText.slice(0, 90)}"`);
  check('CAL-conflict-note — and it says a lecture is already standing there',
    !!bad.conflictNote, bad.conflictNote || 'no note rendered');
  check('CAL-day-academic — the sheet lists the academic item behind the verdict',
    bad.academic.includes('off'), `categories: ${bad.academic.join(', ') || 'none'}`);
  check('CAL-no-teaching — a shut day says there is no teaching, rather than saying nothing',
    bad.teaching === 0 && bad.teachingText.includes('אין לימודים'),
    `sessions=${bad.teaching} · "${bad.teachingText.slice(0, 70)}"`);

  const pesachGuest = bad.lectures.find((l) => l.state === 'pending');
  check('CAL-day-lecture-fields — the sheet shows time, topic, lecturer, course and status',
    !!pesachGuest
      && pesachGuest.kind === 'guest'
      && pesachGuest.text.includes('17:00–19:00')
      && pesachGuest.text.includes('מפגש שנקבע בחופשת פסח')
      && pesachGuest.text.includes('דנה לוי')
      && pesachGuest.text.includes('פרקטיקום משאבי אנוש')
      && pesachGuest.text.includes('ממתין לאישור'),
    pesachGuest ? `"${pesachGuest.text.slice(0, 110)}"` : 'no pending lecture in the sheet');
  check('CAL-day-cancelled — a cancelled lecture is shown but marked cancelled',
    bad.lectures.some((l) => l.state === 'cancelled' && l.text.includes('בוטל')),
    `${bad.lectures.length} lectures on the day: ${bad.lectures.map((l) => l.state).join(', ')}`);
  await pg.screenshot({ path: join(SHOTS, 'day-sheet-blocked-430.png'), fullPage: false });

  // ── CAL-add-lecture: the existing editor, already on this date ─────────────
  await pg.click(`[data-add-lecture="${PESACH}"]`);
  await pg.waitForSelector('#lecture-start-time', { timeout: 10000 });
  const editor = await pg.evaluate(() => {
    const date = document.querySelector('input[type="date"]');
    const body = document.body.innerText;
    return { date: date?.value || null, isNew: body.includes('הרצאה חדשה'), createBtn: body.includes('צור הרצאה') };
  });
  check('CAL-add-lecture — the sheet opens the app\'s OWN lecture editor, pre-filled with the date',
    editor.date === PESACH && editor.isNew && editor.createBtn,
    `date field = ${editor.date}, "הרצאה חדשה" = ${editor.isNew}`);
  await ctx.close();
}

{
  const { pg, ctx } = await openScreen(430);

  // ── CAL-teaching: "is there teaching, and in which course" ─────────────────
  await openDayInMonth(pg, SEMINAR_1);
  const seminar = await readSheet(pg);
  check('CAL-teaching-course — 25.10 names the course, the session number and the hour',
    seminar.teaching === 1 && seminar.sessions.includes('semA')
      && seminar.teachingText.includes('סמינריון פרקטיקום')
      && seminar.teachingText.includes('מפגש 1')
      && seminar.teachingText.includes('17:00–20:00'),
    `sessions=${seminar.teaching} [${seminar.sessions.join(', ')}] · "${seminar.teachingText.slice(0, 110)}"`);

  // ── CAL-lecturer-record: "connected to the lecturer details that already exist" ──
  const fromTrainer = seminar.cards.find((c) => c.source === 'trainer');
  check('CAL-lecturer-record — a lecturer with a trainer card shows it, with tap-to-call and tap-to-mail',
    !!fromTrainer
      && fromTrainer.phone === 'tel:0501234567'
      && fromTrainer.email === 'mailto:michal@psagot.example'
      && fromTrainer.openRecord
      && fromTrainer.text.includes('פסגות'),
    fromTrainer ? `${fromTrainer.phone} · ${fromTrainer.email} · "${fromTrainer.text.slice(0, 80)}"` : 'no trainer-sourced card');
  await pg.screenshot({ path: join(SHOTS, 'day-sheet-teaching-430.png'), fullPage: false });

  // ── CAL-both: teaching AND a guest lecture on one day — the sheet he asked to see ──
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(150);
  await openDayInMonth(pg, SIMULATION_1);
  const both = await readSheet(pg);
  check('CAL-both — 8.12 shows the simulation session AND the guest lecture on it',
    both.teaching >= 1 && both.sessions.includes('skA') && both.guests === 1
      && both.teachingText.includes('מיומנויות ייעוציות')
      && both.teachingText.includes('מפגש 7')
      && both.lectures.some((l) => l.kind === 'guest' && l.text.includes('ראיון עומק בארגון')),
    `teaching=${both.teaching} [${both.sessions.join(', ')}], guests=${both.guests}`);
  check('CAL-both-verdict — and it is still answerable: a simulation day is not a blocked day',
    both.verdict !== 'blocked' && both.addBtn,
    `verdict=${both.verdict}, booking button present=${both.addBtn}`);
  await pg.screenshot({ path: join(SHOTS, 'day-sheet-both-430.png'), fullPage: false });

  // ── CAL-lecturer-fallback: no trainer record ⇒ the lecture's own fields ────
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(150);
  await openDayInMonth(pg, CLEAR_DAY);
  const good = await readSheet(pg);
  check('CAL-verdict-open — an ordinary Monday says the date is suitable',
    good.verdict === 'open' && good.verdictText.includes('מתאים'),
    `verdict=${good.verdict} · "${good.verdictText.slice(0, 70)}"`);
  const fallback = good.cards.find((c) => c.source === 'lecture');
  check('CAL-lecturer-fallback — a lecturer with no trainer card falls back to the lecture\'s own contacts',
    !!fallback
      && fallback.phone === 'tel:0504014350'
      && fallback.email === 'mailto:ofir@example.com'
      && !fallback.openRecord,
    fallback ? `${fallback.phone} · ${fallback.email} · offers a record: ${fallback.openRecord}` : 'no lecture-sourced card');
  check('CAL-no-session — an ordinary Monday with no class of his says "אין מפגש קורס"',
    good.teaching === 0 && good.teachingText.includes('אין מפגש קורס'),
    `"${good.teachingText.slice(0, 70)}"`);
  await pg.screenshot({ path: join(SHOTS, 'day-sheet-open-430.png'), fullPage: false });

  await ctx.close();
}

/* ══════════════ the year poster, the banner and the one legend ══════════ */
console.log('\nYEAR VIEW + CONFLICTS + LEGEND (430px)');
{
  const { pg, ctx } = await openScreen(430);

  // The banner has to be above the fold, or it is not a warning.
  const banner = await pg.evaluate(() => {
    const b = document.querySelector('[data-conflict-banner]');
    if (!b) return null;
    return { text: b.innerText.replace(/\s+/g, ' ').trim(), rows: b.querySelectorAll('li').length,
             top: Math.round(b.getBoundingClientRect().top) };
  });
  check('CAL-conflict-banner — the two misplaced lectures are listed on arrival',
    !!banner && banner.rows === 2 && banner.text.includes('חופשת פסח') && banner.text.includes('בחינות'),
    banner ? `${banner.rows} rows at y=${banner.top}: "${banner.text.slice(0, 100)}"` : 'no banner');
  check('CAL-conflict-cancelled-excluded — the cancelled lecture on פסח is NOT called a conflict',
    !!banner && !banner.text.includes('מפגש שבוטל'),
    banner ? 'cancelled row absent, as intended' : 'no banner');

  // ── CAL-view-toggle: month ⇄ year, never both ─────────────────────────────
  await pg.click('[data-view-btn="year"]');
  await pg.waitForSelector('[data-year-poster]', { timeout: 10000 });
  const year = await pg.evaluate(() => ({
    view: document.querySelector('[data-calendar-page]').getAttribute('data-calendar-view'),
    monthGrids: document.querySelectorAll('[data-month-grid]').length,
    papers: document.querySelectorAll('[data-paper]').length,
    months: [...document.querySelectorAll('[data-year-poster] [data-month]')].map((m) => m.getAttribute('data-month')),
    paper: (() => { const cs = getComputedStyle(document.querySelector('[data-paper]')); return { bg: cs.backgroundColor, fg: cs.color }; })(),
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    tooSmall: [...document.querySelectorAll('[data-academic-day]')]
      .filter((c) => { const r = c.getBoundingClientRect(); return r.height > 0 && (r.height < 44 || r.width < 44); }).length,
  }));
  check('CAL-view-toggle — the year poster REPLACES the month grid; never both at once',
    year.view === 'year' && year.monthGrids === 0 && year.papers === 12,
    `view=${year.view}, month grids=${year.monthGrids}, paper cards=${year.papers}`);
  check('CAL-poster — twelve months, October 2026 → September 2027, white paper / black ink',
    year.months.length === 12 && year.months[0] === '2026-10' && year.months[11] === '2027-09'
      && year.paper.bg === 'rgb(255, 255, 255)' && year.paper.fg === 'rgb(0, 0, 0)',
    `${year.months.length} months ${year.months[0]}…${year.months[year.months.length - 1]} · paper ${year.paper.bg} / ${year.paper.fg}`);
  check('CAL-poster-tap — every day on the poster is still a 44px target, and it does not drift sideways',
    year.tooSmall === 0 && year.over <= 0, `${year.tooSmall} under 44px · ${year.over}px sideways`);
  await pg.screenshot({ path: join(SHOTS, 'year-430.png'), fullPage: false });

  // ── CAL-poster-day: the SAME sheet opens from the poster ──────────────────
  await pg.click(`[data-paper] [data-academic-day="${SEMINAR_1}"]`);
  await pg.waitForSelector(`[data-day-sheet="${SEMINAR_1}"]`, { timeout: 10000 });
  const fromPoster = await readSheet(pg);
  check('CAL-poster-day — a day on the poster opens the same one sheet, verdict first',
    fromPoster.verdict === 'open' && fromPoster.teaching === 1 && fromPoster.guests === 1,
    `verdict=${fromPoster.verdict}, teaching=${fromPoster.teaching}, guests=${fromPoster.guests}`);
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(150);

  // ── CAL-back-to-month ─────────────────────────────────────────────────────
  await pg.click('[data-view-btn="month"]');
  await pg.waitForSelector('[data-month-grid]', { timeout: 10000 });
  const back = await pg.evaluate(() => ({
    view: document.querySelector('[data-calendar-page]').getAttribute('data-calendar-view'),
    posters: document.querySelectorAll('[data-year-poster]').length,
  }));
  check('CAL-back-to-month — and back again, with the poster gone',
    back.view === 'month' && back.posters === 0, `view=${back.view}, posters=${back.posters}`);

  // ── CAL-legend: ONE legend, covering both layers ──────────────────────────
  const legend = await pg.evaluate(() => {
    const els = [...document.querySelectorAll('[data-legend]')];
    return {
      count: els.length,
      swatches: els.flatMap((el) => [...el.querySelectorAll('[data-legend-swatch]')].map((s) => s.getAttribute('data-legend-swatch'))),
      precedence: els[0]?.querySelector('[data-precedence-note]')?.innerText.replace(/\s+/g, ' ').trim() || null,
    };
  });
  const needed = ['lecture', 'interview', 'slot', 'prep',
    'approved', 'pending', 'cancelled',
    'off', 'boundary', 'makeup_day', 'simulation', 'skills', 'practicum', 'seminar', 'todo', 'exam', 'special',
    // the two the fill/band split added: the holiday grey and the caution tape
    'holiday', 'blocked-band'];
  const missing = needed.filter((k) => !legend.swatches.includes(k));
  check('CAL-legend — ONE legend, and every colour on either layer has a label',
    legend.count === 1 && missing.length === 0,
    missing.length ? `${legend.count} legends, missing: ${missing.join(', ')}` : `1 legend, ${legend.swatches.length} swatches, all named`);
  check('CAL-precedence-stated — the fill-vs-band rule is written on the screen',
    !!legend.precedence
      && legend.precedence.includes('צבע התא שייך לאירועים')
      && legend.precedence.includes('מסורגל')
      && legend.precedence.includes('אפור')
      && legend.precedence.includes('תשפ״ז'),
    legend.precedence ? `"${legend.precedence.slice(0, 110)}"` : 'no precedence note');

  await ctx.close();
}

/* ══════════════ THE SECOND CALENDAR IS GONE ══════════════ */
console.log('\nNO SECOND CALENDAR');
{
  // Anyone whose last screen was 'academic' must land on the merged calendar, not on a
  // blank page — and the nav must not offer a second calendar at all.
  const { pg, ctx } = await openScreen(430, { page: 'academic' });
  const gone = await pg.evaluate(() => ({
    view: document.querySelector('[data-calendar-page]')?.getAttribute('data-calendar-view') ?? null,
    body: document.body.innerText,
  }));
  check('CAL-migrated — a stored page of "academic" resumes onto the merged calendar',
    gone.view === 'month' && !gone.body.includes('לוח אקדמי תשפ״ז'),
    `view=${gone.view}`);

  await pg.setViewportSize({ width: 1180, height: 900 });
  await pg.waitForTimeout(200);
  const navLabels = await pg.evaluate(() => [...document.querySelectorAll('header nav button')].map((b) => b.innerText.trim()));
  check('CAL-nav-single — the top bar offers exactly one calendar',
    navLabels.filter((l) => l.includes('לוח')).length === 1 && !navLabels.includes('לוח אקדמי'),
    `nav: ${navLabels.join(' · ')}`);
  await ctx.close();
}

/* ══════════════ DARK MODE: the paper must not go white-on-white ══════════ */
console.log('\nDARK MODE (430px)');
{
  const { pg, ctx } = await openScreen(430, { theme: 'dark' });
  await pg.click('[data-view-btn="year"]');
  await pg.waitForSelector('[data-year-poster]');
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
  check('CAL-dark-paper — the printed calendar stays white paper / black ink in dark mode',
    paper.theme === 'dark' && paper.bg === 'rgb(255, 255, 255)' && paper.fg === 'rgb(0, 0, 0)'
      && paper.cellFg === 'rgb(0, 0, 0)',
    `theme=${paper.theme}, paper ${paper.bg}, ink ${paper.fg}, cell ink ${paper.cellFg}`);

  // and the MONTH grid's academic fills force black ink too — gold on a dark cell with
  // the theme's pale ink would be unreadable.
  await pg.click('[data-view-btn="month"]');
  await pg.waitForSelector('[data-month-grid]');
  await openDayInMonth(pg, SIMULATION_1);
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(150);
  const darkCell = await pg.evaluate((iso) => {
    const e = document.querySelector(`[data-day-cell="${iso}"]`);
    if (!e) return null;
    const date = e.querySelector('[data-band-label]')?.previousElementSibling
      || e.querySelector('span.serif');
    const ds = date ? getComputedStyle(date) : null;
    return { image: getComputedStyle(e).backgroundImage, stripes: e.getAttribute('data-filled'),
             dateInk: ds?.color ?? null, datePlate: ds?.backgroundColor ?? null };
  }, SIMULATION_1);
  check('CAL-dark-month-fill — the event fill is identical in dark mode, and the date keeps its plate',
    darkCell?.stripes === '2'
      && darkCell.image.includes('rgb(224, 102, 102)')
      && darkCell.dateInk === 'rgb(0, 0, 0)'
      && /255, 255, 255/.test(String(darkCell.datePlate)),
    `stripes=${darkCell?.stripes}, date ink ${darkCell?.dateInk} on plate ${darkCell?.datePlate}`);
  await pg.screenshot({ path: join(SHOTS, 'month-430-dark.png'), fullPage: false });
  await ctx.close();
}

/* ══════════════ DESKTOP: nothing was taken away from the wider screen ════ */
console.log('\nDESKTOP (1180px)');
{
  const { pg, ctx } = await openScreen(1180);
  const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('CAL-desktop-noscroll — no sideways drift at 1180px either', over <= 0, `${over}px over`);

  // ── CAL-chip-legible: from 640px up the titles are shown, and a title on a filled
  //    cell has to survive the fill — the whole risk of letting events own it. ──
  await openDayInMonth(pg, SIMULATION_1);
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(150);
  const chip = await pg.evaluate((iso) => {
    const cell = document.querySelector(`[data-day-cell="${iso}"]`);
    const c = cell?.querySelector('[data-event-chip]');
    if (!c) return null;
    const lum = (rgb) => {
      const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(Number).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const cs = getComputedStyle(c);
    const L1 = lum(cs.backgroundColor), L2 = lum(cs.color);
    return {
      type: c.getAttribute('data-event-chip'),
      shown: getComputedStyle(c.parentElement).display !== 'none',
      text: c.innerText.trim(),
      bg: cs.backgroundColor, fg: cs.color,
      contrast: +(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2)),
    };
  }, SIMULATION_1);
  check('CAL-chip-legible — at 1180px the event title is shown, untruncated, and clears 4.5:1 on the fill',
    !!chip && chip.shown && chip.contrast >= 4.5 && chip.text.length > 4 && !chip.text.endsWith('…'),
    chip ? `"${chip.text}" — ${chip.fg} on ${chip.bg} = ${chip.contrast}:1` : 'no chip on the simulation day');

  await openDayInMonth(pg, EXAMS);
  const exam = await readSheet(pg);
  check('CAL-verdict-exam — a date inside the exam window is refused, and says which window',
    exam.verdict === 'blocked' && exam.verdictText.includes('בחינות'),
    `"${exam.verdictText.slice(0, 90)}"`);
  await pg.screenshot({ path: join(SHOTS, 'day-sheet-exams-1180.png'), fullPage: false });
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
console.log('✅ calendar-check passed');

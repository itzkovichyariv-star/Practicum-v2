#!/usr/bin/env node
/**
 * placement-headline-check.mjs — the organization's name, on the phone, for real.
 *
 * Yariv 2026-08-22 → 2026-08-27, three rounds on one ask:
 *   "אני רוצה לראות את שם הארגון אליו זה נשלח במסך הראשי מבלי להכנס לכרטיס הסטודנט."
 *
 * Round two put the name in the headline and the unit test went green. Round three he
 * deployed it, looked at his phone, and said "no change" — the row read `קו״ח נשלחו ...`
 * and stopped. The name was in the string and had never been on his screen.
 *
 * The test that let that through asserted the name came before the day count: an
 * ORDERING, in a string, with no width anywhere in it. But a collapsed headline is
 * `text-overflow: ellipsis`, and at 375px the strip's middle column is about 73px once
 * the turn label, the action button and the expander have taken theirs — roughly seven
 * Hebrew characters, and "קו״ח נשלחו " is ten. Every string assertion in the repo was
 * true of a line that rendered without the one word it exists to show.
 *
 * So this check measures the rendered line instead of the string behind it. It uses a
 * Range over the text node to get the name's actual box and asks whether that box is
 * inside the element's visible box — the same question Yariv answers by looking.
 *
 * Offline, like its four siblings in this directory: dist/ is served locally and every
 * off-origin call is answered from a fixture, so an unmerged branch can be proven
 * without writing a fixture student into the data he is working in.
 *
 *   npx astro build && node scripts/placement-headline-check.mjs
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PORT = 4324;

const SHORT_ORG = 'UCL Group';
/* A real one from his board, and the length that actually tests the claim. */
const LONG_ORG = 'מערך הדיגיטל הלאומי';
/* Rank 2, still open, so every row offers an action and pays for it in width. */
const SPARE_ORG = 'TLVtech';

const sentAt = '2026-08-24T09:00:00.000Z';   // 2 days before NOW below — plainly "sent"

const FIXTURE = {
  courses: [{ id: 'hr', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', type: 'practicum' }],
  academicYears: ['תשפ״ז'],
  candidates: [],
  students: [
    { id: 'st1', name: 'עינה נוימן', email: 'eina@example.com', courseId: 'hr', year: 'תשפ״ז',
      cvUpdatedUrl: 'https://example.com/cv.pdf',
      preferences: [
        { rank: 1, orgName: SHORT_ORG, employerId: 'e1', status: 'under_review', slotId: 'e1-s1' },
        /* A second, still-open choice so the row offers "שלח" — the button is on the
           headline's line and takes its width from it, which is half of why the name
           was being cut in the first place. Without it this check would measure a
           roomier row than the one Yariv photographed. */
        { rank: 2, orgName: SPARE_ORG, employerId: 'e3', status: 'tentative', slotId: 'e3-s1' },
      ] },
    { id: 'st2', name: 'עטרת מישלוב', email: 'ateret@example.com', courseId: 'hr', year: 'תשפ״ז',
      cvUpdatedUrl: 'https://example.com/cv2.pdf',
      preferences: [
        { rank: 1, orgName: LONG_ORG, employerId: 'e2', status: 'under_review', slotId: 'e2-s1' },
        { rank: 2, orgName: SPARE_ORG, employerId: 'e3', status: 'tentative', slotId: 'e3-s1' },
      ] },
  ],
  employers: [
    { id: 'e1', name: SHORT_ORG, courseId: 'hr', year: 'תשפ״ז', contactPhone: '0547820993',
      contactEmail: 'a@ucl.co.il', slots: [{ id: 'e1-s1', title: 'גיוס', status: 'taken' }] },
    { id: 'e2', name: LONG_ORG, courseId: 'hr', year: 'תשפ״ז', contactPhone: '0501112222',
      contactEmail: 'b@digital.gov.il', slots: [{ id: 'e2-s1', title: 'למידה', status: 'taken' }] },
    { id: 'e3', name: SPARE_ORG, courseId: 'hr', year: 'תשפ״ז', contactPhone: '0503334444',
      contactEmail: 'c@spare.co.il', slots: [{ id: 'e3-s1', title: 'רווחה', status: 'available' },
                                             { id: 'e3-s2', title: 'רווחה', status: 'available' }] },
  ],
  dispatches: [
    { dispatchId: 'd1', studentId: 'st1', employerId: 'e1', slotId: 'e1-s1', result: 'pending', sentAt },
    { dispatchId: 'd2', studentId: 'st2', employerId: 'e2', slotId: 'e2-s1', result: 'pending', sentAt },
  ],
  trainers: [], lectures: [], institutions: [],
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
await new Promise(r => server.listen(PORT, r));

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
             '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

async function openPage(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
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
    localStorage.setItem('practicum_v2_page', 'students');
    localStorage.setItem('practicum_theme', 'light');
  });
  const pg = await ctx.newPage();
  await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await pg.waitForSelector('[data-strip-headline]', { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(900);
  return { pg, ctx };
}

/**
 * Where the organization's name actually lands, in pixels.
 *
 * A Range over the substring gives its real box after layout, shaping and the RTL
 * reorder — none of which a string index knows about. `startsInside` is the load-bearing
 * one: it is what "the ellipsis got there first" fails, and it is exactly what round two
 * shipped. `fullyInside` is the stronger claim, and only a name short enough to fit can
 * make it.
 */
const measure = (pg, org) => pg.evaluate((orgName) => {
  const els = [...document.querySelectorAll('[data-strip-headline]')];
  const el = els.find(e => (e.textContent || '').includes(orgName));
  if (!el) return { found: false, headlines: els.map(e => e.textContent.trim()) };
  const node = el.firstChild;
  if (!node || node.nodeType !== 3) return { found: false, why: 'headline is not one text node' };

  const text = node.textContent;
  const idx = text.indexOf(orgName);
  const box = el.getBoundingClientRect();
  const r = document.createRange();
  r.setStart(node, idx); r.setEnd(node, idx + orgName.length);
  const name = r.getBoundingClientRect();

  // RTL: the line starts at the RIGHT edge. "Where it begins" is therefore name.right.
  const rtl = getComputedStyle(el).direction === 'rtl';
  const begins = rtl ? name.right : name.left;
  const ends = rtl ? name.left : name.right;

  return {
    found: true, text, idx,
    clipped: el.scrollWidth > el.clientWidth + 1,
    width: Math.round(box.width),
    startsInside: begins <= box.right + 0.5 && begins >= box.left - 0.5,
    fullyInside: name.left >= box.left - 0.5 && name.right <= box.right + 0.5,
    visibleFraction: +(((rtl ? Math.max(0, begins - Math.max(ends, box.left))
                             : Math.min(ends, box.right) - begins) / (name.width || 1))).toFixed(2),
  };
}, org);

console.log('\nplacement-headline-check — offline, fixture-backed\n');

// ── PHONE: the case Yariv photographed ───────────────────────────────────────
console.log(`PHONE (375px): the name is the first thing on the line`);
{
  const { pg, ctx } = await openPage(375);

  const short = await measure(pg, SHORT_ORG);
  check('the sent row is on screen', short.found,
    short.found ? `headline: "${short.text}"` : `headlines seen: ${JSON.stringify(short.headlines || short.why)}`);

  if (short.found) {
    // Position 0 is the whole fix. Anything ahead of the name is width the ellipsis
    // can spend before reaching it, and at this size there is none to spare.
    check('the name leads the rendered line', short.idx === 0, `starts at character ${short.idx}`);
    check('the name begins inside the visible box', short.startsInside,
      `headline is ${short.width}px${short.clipped ? ' and clipped' : ''}`);
    check(`"${SHORT_ORG}" is legible in full`, short.fullyInside,
      `${Math.round(short.visibleFraction * 100)}% of it rendered inside the box`);
  }

  // A name too long to fit must still SHOW ITS BEGINNING — that is what identifies it
  // in a list. Requiring the whole thing would be a promise the width cannot keep.
  const long = await measure(pg, LONG_ORG);
  check('the long-named row is on screen', long.found,
    long.found ? `headline: "${long.text}"` : 'not found');
  if (long.found) {
    check('a long name still starts inside the box', long.startsInside && long.idx === 0,
      `starts at character ${long.idx}, ${Math.round(long.visibleFraction * 100)}% rendered`);
    check('and enough of it renders to identify the organization', long.visibleFraction >= 0.35,
      `${Math.round(long.visibleFraction * 100)}% visible (want ≥ 35%)`);
  }

  // The width this fix spends comes from the turn label, which said in words what the
  // dot says in colour and the headline repeats in full.
  const label = await pg.evaluate(() => {
    const s = document.querySelector('.turn-label-text');
    return s ? { present: true, shown: getComputedStyle(s).display !== 'none', text: s.textContent.trim() } : { present: false };
  });
  check('the turn label text is hidden on a phone', label.present && !label.shown,
    label.present ? `display of "${label.text}"` : 'no .turn-label-text in the DOM');

  const dot = await pg.evaluate(() => {
    const s = document.querySelector('[data-placement-strip] span span');
    const r = s?.getBoundingClientRect();
    return r ? Math.round(r.width) : 0;
  });
  check('the colour dot stays', dot > 0, `${dot}px`);

  await ctx.close();
}

// ── DESKTOP: nothing was taken away from the screen that has room ────────────
console.log('\nDESKTOP (1180px): the label is back and the name still leads');
{
  const { pg, ctx } = await openPage(1180);

  const short = await measure(pg, SHORT_ORG);
  check('the name still leads', short.found && short.idx === 0, short.found ? `"${short.text}"` : 'row not found');
  check('and there is room for all of it', short.found && short.fullyInside && !short.clipped,
    short.found ? `headline is ${short.width}px${short.clipped ? ', clipped' : ', not clipped'}` : '');

  const label = await pg.evaluate(() => {
    const s = document.querySelector('.turn-label-text');
    return s ? { shown: getComputedStyle(s).display !== 'none', text: s.textContent.trim() } : null;
  });
  check('the turn label reads in words again', !!label?.shown, label ? `"${label.text}"` : 'missing');

  await ctx.close();
}

await browser.close();
server.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error(`\n❌ ${failed.length} failed: ${failed.map(f => f.name).join(' · ')}`);
  process.exit(1);
}
console.log('✅ placement-headline-check passed');

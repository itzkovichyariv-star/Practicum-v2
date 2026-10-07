#!/usr/bin/env node
/**
 * button-sweep.mjs — press every button on every page and report the ones that do NOTHING.
 *
 * Yariv 2026-10-06: "הדפסת דוחות לא עובדת … הכפתור לא מגיב. זה הזמן לבדוק את כל הכפתורים
 * באפליקציה ולראות אם יש כאלה שלא מגיבים".
 *
 * Offline, fixture-backed, nothing leaves the machine. For each page it collects every
 * visible, enabled <button>, and for each one: reload the page fresh, press it, and watch
 * for ANY effect within a short window —
 *   a DOM change, a new tab, a download, an alert/confirm, a request, a URL change,
 *   window.print(), navigator.share(), a clipboard write.
 * A button with none of those is listed as a no-op. Buttons that open a window (a modal)
 * are then swept again one level in, inside that window.
 *
 * It is a FINDER, not a gate: a no-op can be legitimate (a toggle already in its state),
 * so every hit is read by hand.
 *
 *   npx astro build && node scripts/button-sweep.mjs [page ...]
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PORT = 4333;
const PAGES = process.argv.slice(2).length ? process.argv.slice(2)
  : ['dashboard', 'lectures', 'students', 'employers', 'trainers', 'candidates', 'calendar', 'reports', 'forms', 'management', 'settings'];

const FIXTURE = {
  courses: [{ id: 'hr', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', type: 'practicum' }],
  academicYears: ['תשפ״ז'],
  candidates: [
    { id: 'c1', name: 'מאיה בר', email: 'maya@example.com', phone: '0501234567', courseId: 'hr', year: 'תשפ״ז', status: 'interview' },
  ],
  students: [
    { id: 'st1', name: 'נועה ברק', email: 'noa@example.com', phone: '0507654321', courseId: 'hr', year: 'תשפ״ז',
      cvUpdatedUrl: 'https://example.com/cv.pdf',
      preferences: [{ rank: 1, orgName: 'מרכז רפואי שמיר', employerId: 'e1', status: 'tentative' }] },
    { id: 'st2', name: 'רון שגב', email: 'ron@example.com', phone: '0509998888', courseId: 'hr', year: 'תשפ״ז',
      submissionStatus: 'placed', acceptedOrg: 'מרכז רפואי שמיר',
      preferences: [{ rank: 1, orgName: 'מרכז רפואי שמיר', employerId: 'e1', status: 'placed', slotId: 'e1-s2' }] },
  ],
  employers: [
    { id: 'e1', name: 'מרכז רפואי שמיר', courseId: 'hr', courseIds: ['hr'], year: 'תשפ״ז', approvalStatus: 'approved',
      contactName: 'דנה', contactPhone: '0501112222', contactEmail: 'hr@shamir.example',
      vacancySlots: [{ id: 'e1-s1', courseId: 'hr', status: 'available', studentId: null },
                     { id: 'e1-s2', courseId: 'hr', status: 'placed', studentId: 'st2' }],
      positionsTotal: 2, positions: 2, filledPositions: 1 },
  ],
  trainers: [{ id: 't1', name: 'מיכל לאופר', phone: '0501234567', email: 'michal@example.com', courseId: 'hr', year: 'תשפ״ז' }],
  lectures: [
    { id: 'l1', courseId: 'hr', courseName: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', date: '2026-10-25',
      startTime: '17:00', endTime: '20:00', topic: 'שוק העבודה', lecturer: 'מיכל לאופר', lecturerPhone: '0501234567',
      lecturerEmail: 'michal@example.com', status: 'מאושר', semester: 'א׳' },
    { id: 'l2', courseId: 'hr', courseName: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', date: '2026-11-29',
      startTime: '18:00', endTime: '19:30', topic: 'קריירה', lecturer: 'חיה וגנר', status: 'ממתין לאישור', semester: 'א׳' },
  ],
  dispatches: [], institutions: [],
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json' };
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

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
             '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

async function newCtx(page) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, acceptDownloads: true });
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
    ctx.__net = (ctx.__net || 0) + (req.method() !== 'GET' || /functions\/v1|storage\/v1/.test(url) ? 1 : 0);
    if (url.includes('practicum_data')) {
      if (req.method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ data: FIXTURE, version: 1, updated_at: '2026-01-01T00:00:00.000Z' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ version: 2 }]) });
    }
    if (url.includes('fonts.g')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await ctx.addInitScript((pg) => {
    localStorage.setItem('practicum_v2_session', JSON.stringify({ profile: { name: 'יריב איצקוביץ', email: 'yarivi@ariel.ac.il' } }));
    localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'hr', year: 'תשפ״ז' }));
    localStorage.setItem('practicum_v2_page', pg);
    localStorage.setItem('practicum_theme', 'light');
    window.__fx = [];
    window.print = () => window.__fx.push('print');
    try { navigator.share = async () => { window.__fx.push('share'); }; } catch {}
    try { navigator.clipboard.writeText = async () => { window.__fx.push('clipboard'); }; } catch {}
    const _open = window.open;
    window.open = (...a) => { window.__fx.push('open:' + String(a[0] || '').slice(0, 40)); return null; };
  }, page);
  return ctx;
}

/** Stable identity for a button across reloads: its text + title + index among same text. */
async function listButtons(pg, scopeSel) {
  return pg.evaluate((scope) => {
    const root = scope ? document.querySelector(scope) : document;
    if (!root) return [];
    const seen = {};
    return [...root.querySelectorAll('button')].filter((b) => {
      const r = b.getBoundingClientRect();
      const st = getComputedStyle(b);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    }).map((b) => {
      const label = (b.innerText || b.getAttribute('aria-label') || b.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const key = label + '|' + (b.title || '');
      seen[key] = (seen[key] || 0) + 1;
      return { label, title: b.title || '', nth: seen[key] - 1, disabled: b.disabled };
    });
  }, scopeSel);
}

async function pressAndWatch(pg, ctx, scopeSel, btn) {
  await pg.evaluate(() => {
    window.__mut = 0;
    window.__mo?.disconnect();
    window.__mo = new MutationObserver((m) => { window.__mut += m.length; });
    window.__mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    window.__fx = [];
  });
  const before = { url: pg.url(), net: ctx.__net || 0, pages: ctx.pages().length };
  let download = false, dialog = '';
  const onDl = () => { download = true; };
  const onDlg = async (d) => { dialog = d.type() + ':' + d.message().slice(0, 50); await d.dismiss().catch(() => {}); };
  pg.on('download', onDl); pg.on('dialog', onDlg);
  const ok = await pg.evaluate(({ scope, b }) => {
    const root = scope ? document.querySelector(scope) : document;
    const all = [...(root?.querySelectorAll('button') || [])].filter((x) => {
      const label = (x.innerText || x.getAttribute('aria-label') || x.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      return label === b.label && (x.title || '') === b.title;
    });
    const el = all[b.nth];
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  }, { scope: scopeSel, b: btn }).catch(() => false);
  await pg.waitForTimeout(700);
  pg.off('download', onDl); pg.off('dialog', onDlg);
  const after = await pg.evaluate(() => ({ mut: window.__mut, fx: window.__fx })).catch(() => ({ mut: -1, fx: [] }));
  const effects = [];
  if (!ok) effects.push('not-found');
  if (after.mut > 0) effects.push(`dom:${after.mut}`);
  if (after.fx.length) effects.push(...after.fx);
  if (download) effects.push('download');
  if (dialog) effects.push(dialog);
  if ((ctx.__net || 0) > before.net) effects.push('request');
  if (pg.url() !== before.url) effects.push('url');
  if (ctx.pages().length > before.pages) effects.push('new-tab');
  return effects;
}

async function openPage(name) {
  const ctx = await newCtx(name);
  const pg = await ctx.newPage();
  pg.on('popup', (p) => p.close().catch(() => {}));
  await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(800);
  return { ctx, pg };
}

const report = [];
console.log('\nbutton-sweep — offline\n');
for (const name of PAGES) {
  let { ctx, pg } = await openPage(name);
  const buttons = (await listButtons(pg, null)).filter((b) => !b.disabled);
  console.log(`── ${name}: ${buttons.length} buttons`);
  for (const b of buttons) {
    await ctx.close();
    ({ ctx, pg } = await openPage(name));
    const effects = await pressAndWatch(pg, ctx, null, b);
    const noop = effects.length === 0;
    report.push({ page: name, level: 0, label: b.label, title: b.title, effects });
    if (noop) console.log(`   ✗ NO EFFECT: "${b.label}"${b.title ? ` (title: ${b.title})` : ''}`);
    // A button that opened a window: sweep that window's buttons once.
    const modalSel = await pg.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"], .fixed.inset-0')].filter((e) => e.getBoundingClientRect().height > 100).pop();
      if (!d) return null;
      d.setAttribute('data-sweep-modal', '1');
      return '[data-sweep-modal="1"]';
    }).catch(() => null);
    if (modalSel && !noop) {
      const inner = (await listButtons(pg, modalSel)).filter((x) => !x.disabled);
      for (const ib of inner.slice(0, 40)) {
        await ctx.close();
        ({ ctx, pg } = await openPage(name));
        await pressAndWatch(pg, ctx, null, b);
        await pg.evaluate(() => {
          const d = [...document.querySelectorAll('[role="dialog"], .fixed.inset-0')].filter((e) => e.getBoundingClientRect().height > 100).pop();
          d?.setAttribute('data-sweep-modal', '1');
        }).catch(() => {});
        const eff = await pressAndWatch(pg, ctx, modalSel, ib);
        report.push({ page: name, level: 1, via: b.label, label: ib.label, title: ib.title, effects: eff });
        if (eff.length === 0) console.log(`   ✗ NO EFFECT (inside "${b.label}"): "${ib.label}"${ib.title ? ` (title: ${ib.title})` : ''}`);
      }
    }
  }
  await ctx.close();
}
await browser.close();
server.close();

const noops = report.filter((r) => r.effects.length === 0);
const prints = report.filter((r) => r.effects.includes('print'));
const opens = report.filter((r) => r.effects.some((e) => e.startsWith('open:')));
await writeFile(join(ROOT, 'test-results', 'button-sweep.json'), JSON.stringify(report, null, 2)).catch(() => {});
console.log(`\n${report.length} presses · ${noops.length} with no effect · ${prints.length} call window.print() on the app page`);
for (const p of prints) console.log(`   ⚠ window.print() on the app page (a no-op in the installed app): ${p.page} → "${p.label}"`);
for (const o of opens) console.log(`   · window.open: ${o.page}${o.via ? ` › ${o.via}` : ''} → "${o.label}" ${o.effects.filter((e) => e.startsWith('open:')).join(' ')}`);

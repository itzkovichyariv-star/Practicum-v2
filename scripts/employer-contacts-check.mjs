#!/usr/bin/env node
/**
 * employer-contacts-check.mjs — "＋ הוסף איש קשר" really adds a second contact.
 *
 * Yariv 2026-10-14: "הוספת מעסיק כדי שיהיה איש קשר ראשי או משני — לוחצים וכלום לא קורה".
 * The new card was an empty draft, and every other action on the form (typing into the
 * first contact, tapping "סמן/י כפעיל" on the new one) went through a function that
 * drops empty cards — so it vanished; on a phone it also opened below the fold.
 *
 * Phone width, offline: existing employer with one contact → add → the card is on
 * screen with the cursor in it → typing into the FIRST contact keeps it → marking it
 * active keeps it → fill it → save writes two contacts, the new one active.
 *
 *   npx astro build && node scripts/employer-contacts-check.mjs
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = join(resolve(import.meta.dirname, '..'), 'dist');
const PORT = 4341;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  try { const b = await readFile(join(DIST, p)); res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(PORT, r));

const FIXTURE = {
  courses: [{ id: 'hr', name: 'פרקטיקום משאבי אנוש', year: 'תשפ״ז', type: 'practicum' }], academicYears: ['תשפ״ז'],
  employers: [{ id: 'e1', name: 'מרכז רפואי שמיר', courseIds: ['hr'], year: 'תשפ״ז', approvalStatus: 'approved',
    contactPerson: 'דנה לוי', contactPhone: '0501112222', contactEmail: 'dana@shamir.example',
    vacancySlots: [{ id: 'e1-s1', courseId: 'hr', status: 'available', studentId: null }], positionsTotal: 1 }],
  students: [], candidates: [], trainers: [], lectures: [], dispatches: [], institutions: [],
};

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass }); console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true });
let current = FIXTURE; const writes = [];
await ctx.route('**/*', async (route) => {
  const req = route.request(); const url = req.url();
  if (url.startsWith(`http://127.0.0.1:${PORT}`)) return route.continue();
  if (url.includes('practicum_data')) {
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: current, version: 1, updated_at: '2026-01-01T00:00:00.000Z' }) });
    if (req.method() === 'PATCH') { const b = JSON.parse(req.postData() || '{}'); writes.push(b); if (b.data) current = b.data;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ version: 2 }]) }); }
  }
  if (url.includes('fonts.g')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await ctx.addInitScript(() => {
  localStorage.setItem('practicum_v2_session', JSON.stringify({ profile: { name: 'יריב איצקוביץ', email: 'yarivi@ariel.ac.il' } }));
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'hr', year: 'תשפ״ז' }));
  localStorage.setItem('practicum_v2_page', 'employers');
  localStorage.setItem('practicum_theme', 'light');
});
const pg = await ctx.newPage();
const errors = []; pg.on('pageerror', (e) => errors.push(String(e.message || e))); pg.on('dialog', (d) => d.accept());

console.log('\nemployer-contacts-check — offline, phone width\n');
await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await pg.waitForTimeout(700);
await pg.getByRole('button', { name: 'עריכה' }).first().click().catch(() => {});
await pg.waitForSelector('[data-add-contact]', { timeout: 8000 }).catch(() => {});
const cards = () => pg.locator('[data-contact-card]').count();
check('the editor opens with the one existing contact', await cards() === 1, `${await cards()} card(s)`);

await pg.locator('[data-add-contact]').click();
await pg.waitForTimeout(700);
check('pressing ＋ הוסף איש קשר adds a card', await cards() === 2, `${await cards()} card(s)`);
const onScreen = await pg.evaluate(() => {
  const c = document.querySelector('[data-contact-card="c2"]'); if (!c) return false;
  const r = c.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0;
});
check('and the new card is on screen (not below the fold)', onScreen);
const focused = await pg.evaluate(() => !!document.activeElement?.closest('[data-contact-card="c2"]'));
check('with the cursor in it', focused);

const first = pg.locator('[data-contact-card="primary"] input').first();
await first.fill('דנה לוי-כהן');
await pg.waitForTimeout(200);
check('typing into the FIRST contact does not delete the new one', await cards() === 2, `${await cards()} card(s)`);

await pg.locator('[data-make-active="c2"]').click();
await pg.waitForTimeout(200);
check('marking the empty new card active keeps it', await cards() === 2, `${await cards()} card(s)`);

await pg.locator('[data-contact-card="c2"] input').first().fill('מירב שושן');
await pg.locator('[data-contact-card="c2"] input[type="tel"]').fill('0523334444');
await pg.waitForTimeout(200);
await pg.getByRole('button', { name: /^שמור/ }).last().click().catch(() => {});
await pg.waitForTimeout(1500);
const emp = writes.at(-1)?.data?.employers?.find((e) => e.id === 'e1');
check('save writes both contacts', emp?.contacts?.length === 2, emp ? JSON.stringify(emp.contacts?.map((c) => c.name)) : `${writes.length} write(s)`);
check('the new one is active and mirrored', emp?.activeContactId === 'c2' && emp?.contactPerson === 'מירב שושן' && emp?.contactPhone === '0523334444',
  emp ? `${emp.activeContactId} · ${emp.contactPerson} · ${emp.contactPhone}` : '');
check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));

await browser.close(); server.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.error(`\n❌ ${failed.length} failed: ${failed.map((f) => f.name).join(' · ')}`); process.exit(1); }
console.log('✅ employer-contacts-check passed');

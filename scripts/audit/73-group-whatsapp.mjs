#!/usr/bin/env node
/**
 * 73-group-whatsapp.mjs — the Students-screen group WhatsApp queue ("WhatsApp לקבוצה").
 *
 *   GROUP-WA-open      The header button opens the modal in WhatsApp mode, with the
 *                      greeting "היי {{שם}}," already in the box (more than one recipient).
 *   GROUP-WA-untick    "נקה הכל" empties the send; ticking only the three seeded students
 *                      gives exactly 1 reachable recipient, and the one with no phone and
 *                      the one with a broken phone are each named in their own warning.
 *   GROUP-WA-queue     The queue holds only that one student, and "פתח" opens a wa.me
 *                      link to their number with the message greeting their FIRST name.
 *
 * window.open is stubbed in the page, so no WhatsApp window opens and nothing is sent.
 * Seeds three students with unique names (Yariv 2026-10-25, group WhatsApp).
 */
import { Audit, sbQuery, mutateData, appReady } from '../audit-lib.mjs';

const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'group-whatsapp' });
const ts = Date.now();
const tag = ts.toString(36).slice(-5);
const GOOD = { id: `zgw-g-${tag}`, name: `ווטסטוב${tag} בדיקה`, phone: '050-7654321' };
const NOPHONE = { id: `zgw-n-${tag}`, name: `ווטסחסר${tag} בדיקה`, phone: '' };
const BAD = { id: `zgw-b-${tag}`, name: `ווטסשבור${tag} בדיקה`, phone: '050-76543' };
const SEEDED = [GOOD, NOPHONE, BAD];

let seedOk = false, courseId = '', year = '';
try {
  const data = await loadData();
  const course = (data.courses || []).find(c => c?.type === 'practicum') || (data.courses || [])[0];
  courseId = course?.id || '';
  year = course?.year || '';
  await mutateData(data => ({ ...data, students: [...(data.students || []),
    ...SEEDED.map(s => ({ ...s, email: `${s.id}@audit.local`, courseId, year }))] }));
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
await audit.page.setViewportSize({ width: 1440, height: 1000 });
await audit.page.evaluate(({ c, y }) => {
  localStorage.setItem('practicum_v2_page', 'students');
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c || '__all__', year: y || '__all__' }));
}, { c: courseId, y: year });
await audit.page.goto(`${audit.baseUrl}/`, { waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(1400);

const modal = () => audit.page.locator('[data-mail-modal]').first();
const countText = () => modal().locator('div').filter({ hasText: /^\d+ נמענים$/ }).first().innerText().catch(() => '');

// ── Open in WhatsApp mode ───────────────────────────────────────────────────
audit.observerMark();
let opened = false, body = '';
if (seedOk) {
  await audit.page.locator('[data-group-whatsapp]').first().click().catch(() => {});
  await audit.page.waitForTimeout(700);
  opened = await audit.page.locator('[data-mail-recipients]').count() > 0;
  if (opened) {
    await modal().locator('button').filter({ hasText: /^כולם/ }).first().click().catch(() => {});
    await audit.page.waitForTimeout(300);
    body = await modal().locator('textarea').inputValue().catch(() => '');
  }
}
{
  const obs = audit.observerSnapshot();
  const ok = opened && body.startsWith('היי {{שם}},');
  audit.recordCell({
    id: 'GROUP-WA-open', tableRef: 'StudentsPage / WhatsApp לקבוצה button + modal',
    expected: 'modal opens with recipient checkboxes; the box starts with "היי {{שם}},"',
    observed: `opened=${opened}, body=${JSON.stringify(body.slice(0, 20))}, errors=(${obs.pageErrors.length}p)`,
    pass: seedOk ? (ok && obs.pageErrors.length === 0) : null,
    notes: !seedOk ? 'seed failed' : ok ? '' : 'modal missing or greeting not typed in',
  });
}

// ── Untick everyone, tick only the seeded three ─────────────────────────────
let zeroAfterClear = false, startDisabledAtZero = false, oneAfterTick = false, noPhoneNamed = false, badPhoneNamed = false;
if (opened) {
  await modal().locator('button').filter({ hasText: 'נקה הכל' }).first().click().catch(() => {});
  await audit.page.waitForTimeout(300);
  zeroAfterClear = (await countText()) === '0 נמענים';
  startDisabledAtZero = await modal().locator('[data-wa-start]').isDisabled().catch(() => false);
  for (const s of SEEDED) {
    await modal().locator('[data-mail-recipients] label').filter({ hasText: s.name }).locator('input').first().check().catch(() => {});
  }
  await audit.page.waitForTimeout(300);
  oneAfterTick = (await countText()) === '1 נמענים';
  noPhoneNamed = (await modal().locator('[data-wa-no-phone]').innerText().catch(() => '')).includes(NOPHONE.name);
  badPhoneNamed = (await modal().locator('[data-wa-bad-phone]').innerText().catch(() => '')).includes(BAD.name);
}
{
  const ok = zeroAfterClear && startDisabledAtZero && oneAfterTick && noPhoneNamed && badPhoneNamed;
  audit.recordCell({
    id: 'GROUP-WA-untick', tableRef: 'StudentsPage / recipient checkboxes + planGroupWhatsApp',
    expected: 'נקה הכל → "0 נמענים" + start disabled; seeded three ticked → "1 נמענים", no-phone and bad-phone named apart',
    observed: `zero=${zeroAfterClear}, disabled=${startDisabledAtZero}, one=${oneAfterTick}, noPhone=${noPhoneNamed}, badPhone=${badPhoneNamed}`,
    pass: opened ? ok : null,
    notes: !opened ? 'modal never opened' : ok ? '' : 'exclusion or phone warnings wrong',
  });
}

// ── The queue opens one personal chat ───────────────────────────────────────
let queueOne = false, currentIsGood = false, url = '', urlOk = false;
if (opened && oneAfterTick) {
  await audit.page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  const ta = modal().locator('textarea');
  await ta.fill('היי {{שם}},\nבדיקה');
  await modal().locator('[data-wa-start]').click().catch(() => {});
  await audit.page.waitForTimeout(400);
  const q = audit.page.locator('[data-wa-queue]').first();
  queueOne = (await q.locator('[data-wa-progress]').innerText().catch(() => '')).includes('1 מתוך 1');
  currentIsGood = (await q.locator('[data-wa-current]').innerText().catch(() => '')) === GOOD.name;
  await q.locator('[data-wa-open]').click().catch(() => {});
  await audit.page.waitForTimeout(300);
  url = (await audit.page.evaluate(() => window.__opened?.[0] || '')) || '';
  urlOk = url === `https://wa.me/972507654321?text=${encodeURIComponent(`היי ווטסטוב${tag},\nבדיקה`)}`;
  await q.locator('button').filter({ hasText: 'סגירה' }).first().click().catch(() => {});
}
audit.recordCell({
  id: 'GROUP-WA-queue', tableRef: 'StudentsPage / WhatsApp queue → wa.me link',
  expected: 'queue "1 מתוך 1" on the seeded student; פתח opens wa.me/972507654321 greeting their first name',
  observed: `queueOne=${queueOne}, current=${currentIsGood}, url=${url.slice(0, 40)}…`,
  pass: (opened && oneAfterTick) ? (queueOne && currentIsGood && urlOk) : null,
  notes: !(opened && oneAfterTick) ? 'queue not reached' : (queueOne && currentIsGood && urlOk) ? '' : 'queue content or link wrong',
});

// ── Cleanup ─────────────────────────────────────────────────────────────────
try {
  const ids = new Set(SEEDED.map(s => s.id));
  await mutateData(data => ({ ...data, students: (data.students || []).filter(s => !ids.has(s.id)) }));
  audit.log('Cleanup: removed temp students');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

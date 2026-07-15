#!/usr/bin/env node
/**
 * 41-status-quick-and-autogreen.mjs — auto-green-when-ready + one-tap row status toggle.
 *
 *   AUTOGREEN-ready   A בתהליך employer (contactStatus:'in_process') that HAS a description
 *                     AND an open place in this (course × year) renders 🟢 מאושר (green dot),
 *                     NOT 🟠 בתהליך — the manual בתהליך no longer holds a ready org.
 *   AUTOGREEN-not     A בתהליך employer with NO description stays 🟠 בתהליך (orange) — it
 *                     hasn't qualified yet.
 *   ROW-toggle-saves  Clicking the row's status pill opens an inline picker; picking 🔴 נדחה
 *                     PERSISTS immediately (no editor, no שמור) — the DB employer flips to
 *                     approvalStatus:'rejected' and the row dot turns red.
 *
 * Seeds two in_process orgs (ready + not-ready) on one (course × year), verifies the two
 * dots, drives the one-tap toggle on the ready org, re-reads the DB, then removes temp data.
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
async function sbPatchData(data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/practicum_data?org_id=eq.default`, {
    method: 'PATCH', headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ data }),
  });
  if (!r.ok) throw new Error(`sbPatch failed ${r.status}: ${await r.text().catch(() => '')}`);
}
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'status-quick-and-autogreen' });
const ts = Date.now();
const READY_ID = `audit-sq-ready-${ts}`, READY_NAME = `SQמוכן ${ts}`;
const NOT_ID = `audit-sq-not-${ts}`, NOT_NAME = `SQלא-מוכן ${ts}`;

let seedOk = false, year = '';
try {
  const data = await loadData();
  const course = (data.courses || []).find(c => c?.year && c?.name);
  if (!course) throw new Error('no course'); year = course.year;
  const mk = (id, name, notes) => ({ id, name, addedBy: 'admin', restrictedToStudentId: null, notes, contactStatus: 'in_process', approvalStatus: 'approved', contactPhone: '0500000000', contactEmail: 'a@b.local', courseIds: [course.id], vacancySlots: [{ id: `${id}-s1`, courseId: course.id, status: 'available', studentId: null, prefRank: null, history: [] }] });
  await sbPatchData({ ...data, employers: [...(data.employers || []), mk(READY_ID, READY_NAME, 'תיאור מלא — מוכן'), mk(NOT_ID, NOT_NAME, '')] });
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
if (!seedOk) { audit.recordCell({ id: 'SQ-seed', expected: 'seed', observed: 'failed', pass: null }); await audit.teardown(); process.exit(0); }

await audit.page.evaluate((y) => { localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: '__all__', year: y })); localStorage.setItem('practicum_v2_page', 'employers'); localStorage.setItem('employers_view', 'list'); }, year);
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1400);

const dotOf = (name) => audit.page.evaluate((n) => {
  const li = [...document.querySelectorAll('li')].find(l => (l.querySelector('.serif')?.textContent || '').includes(n));
  if (!li) return { found: false };
  const dot = [...li.querySelectorAll('div')].find(d => { const s = getComputedStyle(d); return s.borderRadius === '50%' && parseFloat(s.width) >= 10 && parseFloat(s.width) < 40; });
  const pill = [...li.querySelectorAll('button,span')].map(s => s.textContent.trim()).find(t => /^(בתהליך|מאושר|טרם|מלא|נדחה)/.test(t));
  return { found: true, bg: dot ? getComputedStyle(dot).backgroundColor : null, pill };
}, name);

const isGreen = (c) => /rgb\(\s*22,\s*163,\s*74\)|rgb\(\s*74,\s*222,\s*128\)/.test(c || '');
const isOrange = (c) => /rgb\(\s*245,\s*158,\s*11\)/.test(c || '');
const isRed = (c) => /rgb\(\s*220,\s*38,\s*38\)/.test(c || '');

const ready = await dotOf(READY_NAME);
const notReady = await dotOf(NOT_NAME);
audit.log(`AUTOGREEN: ready=${JSON.stringify(ready)} notReady=${JSON.stringify(notReady)}`);
audit.recordCell({
  id: 'AUTOGREEN-ready', tableRef: 'employerStatus auto-green precedence',
  expected: 'in_process + description + open place → 🟢 מאושר (green dot)',
  observed: `pill=${ready.pill}, dot=${ready.bg}`,
  pass: !!(ready.found && isGreen(ready.bg) && /מאושר/.test(ready.pill || '')),
});
audit.recordCell({
  id: 'AUTOGREEN-not', tableRef: 'employerStatus in_process (not ready)',
  expected: 'in_process + NO description → stays 🟠 בתהליך (orange dot)',
  observed: `pill=${notReady.pill}, dot=${notReady.bg}`,
  pass: !!(notReady.found && isOrange(notReady.bg) && /בתהליך/.test(notReady.pill || '')),
});

// ── One-tap row toggle: open the READY org's status picker, pick 🔴 נדחה ──
const toggled = await audit.page.evaluate((n) => {
  const li = [...document.querySelectorAll('li')].find(l => (l.querySelector('.serif')?.textContent || '').includes(n));
  if (!li) return { ok: false, why: 'row' };
  const pillBtn = [...li.querySelectorAll('button')].find(b => /מאושר|בתהליך|טרם|מלא|נדחה/.test(b.textContent));
  if (!pillBtn) return { ok: false, why: 'pill' };
  pillBtn.click();
  return new Promise(res => setTimeout(() => {
    const reject = [...li.querySelectorAll('button')].find(b => b.textContent.trim() === '🔴 נדחה');
    if (!reject) return res({ ok: false, why: 'chip' });
    reject.click();
    res({ ok: true });
  }, 350));
}, READY_NAME);
await audit.page.waitForTimeout(2500); // let saveSnapshot round-trip

let dbRejected = false;
try {
  const after = await loadData();
  dbRejected = (after.employers || []).find(e => e.id === READY_ID)?.approvalStatus === 'rejected';
} catch {}
const afterDot = await dotOf(READY_NAME);
audit.log(`ROW-toggle: clicked=${JSON.stringify(toggled)} dbRejected=${dbRejected} afterDot=${afterDot.bg}`);
audit.recordCell({
  id: 'ROW-toggle-saves', tableRef: 'EmployersPage StatusChips → handleSetStatus',
  expected: 'picking 🔴 נדחה from the row persists (DB approvalStatus=rejected) + the dot turns red',
  observed: `pickerWorked=${toggled.ok}, dbRejected=${dbRejected}, dotRed=${isRed(afterDot.bg)}`,
  pass: toggled.ok === true && dbRejected === true && isRed(afterDot.bg),
});

try {
  const data = await loadData();
  await sbPatchData({ ...data, employers: (data.employers || []).filter(e => e.id !== READY_ID && e.id !== NOT_ID) });
  audit.log('Cleanup: removed 2 temp employers');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

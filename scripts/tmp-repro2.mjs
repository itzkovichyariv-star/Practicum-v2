// Seed a student in the state הדר was in — a self-suggested org, not yet placed — and
// click "אשר השמה" from the OUTER card exactly as Yariv did.
import { chromium } from 'playwright';
import { mutateData, sbQuery } from '../scripts/audit-lib.mjs';
const ts = Date.now();
const SID = `zrp-${ts.toString(36).slice(-5)}`, NAME = `שחזור באג ${ts}`;
const EID = `${SID}-e1`, ORG = `ארגון מוצע ${ts}`;
const d0 = (await sbQuery('practicum_data', { select: 'data' }))[0].data;
const courseId = 'hr-practicum-tashpaz';
const year = (d0.courses || []).find(c => c.id === courseId)?.year;
await mutateData(data => ({
  ...data,
  employers: [...(data.employers || []), { id: EID, name: ORG, approvalStatus: 'approved', contactStatus: 'approved',
    addedBy: 'student', restrictedToStudentId: SID, courseIds: [courseId], positionsTotal: 1, positions: 1,
    contactPerson: 'איש קשר', contactPhone: '050-1112222', contactEmail: 'x@y.local', notes: 'repro',
    vacancySlots: [{ id: `${EID}-s1`, courseId, status: 'available', studentId: null, prefRank: null, history: [] }] }],
  students: [...(data.students || []), { id: SID, name: NAME, email: `${SID}@audit.local`, courseId,
    submissionStatus: 'submitted', preparation: { passed: true }, firstChoiceOrg: ORG, year }],
}));
console.log(`seeded ${NAME} → ${ORG} (course ${courseId}, year ${year})`);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'he-IL' });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('  PAGE ERROR:', e.message.slice(0, 160)));
await p.goto('http://localhost:4325/', { waitUntil: 'domcontentloaded' });
await p.evaluate(([c, y]) => {
  localStorage.setItem('practicum_v2_session', JSON.stringify({ profile: { name: 'יריב בדיקה', email: 'yarivi@ariel.ac.il' } }));
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c, year: y }));
  localStorage.setItem('practicum_v2_page', 'students');
}, [courseId, year]);
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('[data-placement-strip]', { timeout: 25000 });
await p.waitForTimeout(1500);
await p.evaluate(() => document.querySelectorAll('[data-strip-expand="closed"]').forEach(x => x.click()));
await p.waitForTimeout(700);

const found = await p.evaluate((n) => {
  const li = [...document.querySelectorAll('li')].find(l => l.textContent.includes(n));
  if (!li) return { row: false };
  const strip = li.querySelector('[data-placement-strip]');
  return { row: true, state: strip?.getAttribute('data-placement-strip'),
    headline: strip?.innerText.replace(/\s+/g, ' ').slice(0, 90),
    actions: [...(strip?.querySelectorAll('[data-strip-action]') || [])].map(x => x.getAttribute('data-strip-action')) };
}, NAME);
console.log('row state →', JSON.stringify(found));
if (!found.row) {
  console.log('rendered rows:', JSON.stringify(await p.evaluate(() =>
    [...document.querySelectorAll('li')].map(l => l.querySelector('.serif')?.textContent?.trim().slice(0,20)).filter(Boolean).slice(0,20))));
  console.log('name anywhere on page?', await p.evaluate(n => document.body.innerText.includes(n), NAME));
  console.log('active filters:', await p.evaluate(() => (document.body.innerText.match(/[^\n]*מסונן[^\n]*|[^\n]*סטודנטים ·[^\n]*/)||['?'])[0].slice(0,90)));
}

if (found.actions?.includes('place_direct')) {
  await p.evaluate((n) => {
    const li = [...document.querySelectorAll('li')].find(l => l.textContent.includes(n));
    li.querySelector('[data-strip-action="place_direct"]').click();
  }, NAME);
  await p.waitForTimeout(800);
  console.log('confirm dialog →', JSON.stringify(await p.evaluate(() => ({
    open: !!document.querySelector('[data-placement-confirm]'),
    text: document.querySelector('[data-placement-confirm]')?.innerText.replace(/\s+/g, ' ').slice(0, 120) || '' }))));
  await p.evaluate(() => document.querySelector('[data-confirm-go]')?.click());
  await p.waitForTimeout(3000);
  console.log('AFTER CONFIRM →', JSON.stringify(await p.evaluate(() => ({
    editorOpen: !!document.querySelector('button[aria-label="סגור"]'),
    bodyMentionsSaved: /נשמר/.test(document.body.innerText),
    toast: (document.body.innerText.match(/[^\n]*נשמר[^\n]*/) || ['(none)'])[0].slice(0, 70),
  }))));
  const db = (await sbQuery('practicum_data', { select: 'data' }))[0].data;
  const s = (db.students || []).find(x => x.id === SID);
  const e = (db.employers || []).find(x => x.id === EID);
  console.log('DB AFTER →', JSON.stringify({ accepted: s?.acceptedOrg || '(none)',
    prefs: (s?.preferences || []).map(x => `${x.orgName}:${x.status}`),
    slot: (e?.vacancySlots || [])[0]?.status }));
  await p.screenshot({ path: '/private/tmp/claude-501/-Users-yarivitzkovich-Code-family-tasks/af30e257-39b3-4752-924d-24c6f88da363/scratchpad/repro2.png' });
}
await b.close();
await mutateData(data => ({ ...data,
  students: (data.students || []).filter(s => s.id !== SID),
  employers: (data.employers || []).filter(e => e.id !== EID),
  dispatches: (data.dispatches || []).filter(x => x.studentId !== SID) }));
console.log('cleaned up');

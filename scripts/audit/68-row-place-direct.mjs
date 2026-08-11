#!/usr/bin/env node
/**
 * 68-row-place-direct.mjs — a button that says it placed someone must place them.
 *
 * Yariv, 2026-08-11, on הדר עוזירי → מערך הדיגיטל הלאומי: "לחצתי אישור והמערכת עדכנה
 * שהנתונים נשמרו אבל לא היה שינוי. רק כשנכנסתי לפרטי הכרטיס יכולתי לבצע את הקליטה …
 * ניכר ששום כפתור לא באמת עבד מחוץ למערכת."
 *
 * The confirmation promised "הסטודנט/ית יירשם/תירשם כמשובץ/ת בארגון, ייתפס מקום בארגון",
 * and the row then called setEditing() and returned. The card opened, so it LOOKED like
 * something happened, while the database was untouched.
 *
 * Seeds a student in exactly her state — one organization she brought herself, not yet
 * placed — clicks אשר השמה from the OUTER row, confirms, and reads the DATABASE back.
 * Asserting the toast alone would have passed on the broken code.
 *
 *   ROWPLACE-offered      the row offers place_direct for a self-suggested org
 *   ROWPLACE-persists     confirming writes the placement: pref placed, slot taken, acceptedOrg set
 *   ROWPLACE-no-card      it completes in the row — the card is not required to finish the job
 *
 * Seeds and removes its own student + employer, including any dispatch.
 */
import { Audit, mutateData, sbQuery, BASE_URL } from '../audit-lib.mjs';
const ts = Date.now();
const SID = `zrp-${ts.toString(36).slice(-5)}`, NAME = `שחזור באג ${ts}`;
const EID = `${SID}-e1`, ORG = `ארגון מוצע ${ts}`;
const d0 = (await sbQuery('practicum_data', { select: 'data' }))[0].data;
const courseId = ((d0.courses || []).find(c => c?.type === 'practicum' && c?.year) || (d0.courses || [])[0])?.id;
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


const audit = new Audit({ name: 'row-place-direct' });
await audit.setup();
const p = audit.page;
await p.evaluate(([c, y]) => {
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
audit.recordCell({ id: 'ROWPLACE-offered', tableRef: 'Yariv: an org the student brought → אשר השמה',
  expected: 'the row offers place_direct without opening anything',
  observed: `${found.state} · [${found.actions || ''}]`,
  pass: found.row === true && (found.actions || []).includes('place_direct') });
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

  await p.evaluate(() => document.querySelector('[data-confirm-go]')?.click());
  await p.waitForTimeout(3000);
  const ui = await p.evaluate(() => ({
    editorOpen: !!document.querySelector('button[aria-label="סגור"]'),
    toast: (document.body.innerText.match(/[^\n]*שובץ[^\n]*/) || ['(none)'])[0].slice(0, 70),
  }));
  let db = (await sbQuery('practicum_data', { select: 'data' }))[0].data;
  let st = (db.students || []).find(x => x.id === SID);
  for (let i = 0; i < 10 && !st?.acceptedOrg; i++) {
    await p.waitForTimeout(600);
    db = (await sbQuery('practicum_data', { select: 'data' }))[0].data;
    st = (db.students || []).find(x => x.id === SID);
  }
  const emp = (db.employers || []).find(x => x.id === EID);
  const slot = (emp?.vacancySlots || []).find(v => v.studentId === SID) || (emp?.vacancySlots || [])[0];
  // The DATABASE is the assertion. A toast alone passed on the broken code.
  audit.recordCell({ id: 'ROWPLACE-persists', tableRef: 'the confirmation promised a placement',
    expected: 'preference placed, place taken by her, acceptedOrg set',
    observed: `accepted=${st?.acceptedOrg || '(none)'}, pref=${(st?.preferences || []).map(x => x.status).join(',') || '(none)'}, slot=${slot?.status}/${slot?.studentId === SID ? 'hers' : 'not hers'}`,
    pass: st?.acceptedOrg === ORG && (st?.preferences || []).some(x => x.orgName === ORG && x.status === 'placed')
       && slot?.status === 'placed' && slot?.studentId === SID });
  audit.recordCell({ id: 'ROWPLACE-no-card', tableRef: 'Yariv: "רק כשנכנסתי לפרטי הכרטיס יכולתי לבצע את הקליטה"',
    expected: 'the row finishes the job — no card needed, and it says so',
    observed: `editorOpen=${ui.editorOpen}, toast="${ui.toast}"`,
    pass: ui.editorOpen === false && /שובץ/.test(ui.toast) });

}
await audit.teardown();
await mutateData(data => ({ ...data,
  students: (data.students || []).filter(s => s.id !== SID),
  employers: (data.employers || []).filter(e => e.id !== EID),
  dispatches: (data.dispatches || []).filter(x => x.studentId !== SID) }));


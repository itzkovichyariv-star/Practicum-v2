#!/usr/bin/env node
/**
 * 63-completed-keeps-placement.mjs — "סיים" must not hide WHERE the student did it.
 *
 *   DONE-keeps-placement  A student who finished the practicum shows BOTH the placement
 *                         tag (שובץ/ה — or נקלט/ה when hired) AND ✓ סיים on the students
 *                         list. Placement and completion are independent facts.
 *
 * Why this exists (Yariv 2026-07-29): marking a cohort as finished made the completion
 * capsule REPLACE the placement capsule, so the list stopped showing whether a student had
 * been taken on by an org at all — "אנא אפשר את שני סוגי המידע". The old row logic gated
 * the placement tags on `&& !completed`.
 *
 * Seeds one placed+completed and one hired+completed student; removes both.
 */
import { Audit, appReady } from '../audit-lib.mjs';

const SUPA = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
const SBH = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };

const ts = Date.now();
const PLACED_ID = `zdone-p-${ts}`, PLACED_NAME = `סיים משובץ ${ts}`;
const HIRED_ID = `zdone-h-${ts}`, HIRED_NAME = `סיים נקלט ${ts}`;

const readRow = async () => (await (await fetch(`${SUPA}/rest/v1/practicum_data?org_id=eq.default&select=data,version`, { headers: SBH })).json())[0];
async function cas(mutate) {
  for (let i = 0; i < 6; i++) {
    const row = await readRow();
    const next = mutate(structuredClone(row.data));
    const r = await fetch(`${SUPA}/rest/v1/practicum_data?org_id=eq.default&version=eq.${row.version}`, {
      method: 'PATCH', headers: { ...SBH, Prefer: 'return=representation' },
      body: JSON.stringify({ data: next, version: row.version + 1, updated_at: new Date().toISOString() }),
    });
    const j = await r.json().catch(() => null);
    if (Array.isArray(j) && j.length) return true;
  }
  return false;
}

const audit = new Audit({ name: 'completed-keeps-placement' });
await audit.setup();

let courseId = '';
const seeded = await cas((d) => {
  courseId = ((d.courses || []).find((c) => c?.type === 'practicum') || (d.courses || [])[0])?.id || '';
  const base = { courseId, acceptedOrg: 'ארגון בדיקה', placedAt: '2026-01-01', hoursReported: 120, hoursApproved: 120, practicumCompleted: true };
  return {
    ...d,
    students: [
      ...(d.students || []).filter((s) => s.id !== PLACED_ID && s.id !== HIRED_ID),
      { id: PLACED_ID, name: PLACED_NAME, email: `${PLACED_ID}@audit.local`, phone: '0501234567', ...base, hired: false },
      { id: HIRED_ID, name: HIRED_NAME, email: `${HIRED_ID}@audit.local`, phone: '0501234567', ...base, hired: true },
    ],
  };
});

let seen = { placed: null, hired: null };
if (seeded) {
  await audit.page.evaluate(({ c }) => {
    localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: c || '__all__', year: '__all__' }));
    localStorage.setItem('practicum_v2_page', 'students');
  }, { c: courseId });
  await audit.page.reload({ waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1200);

  seen = await audit.page.evaluate(({ pName, hName }) => {
    const TAGS = /^(שובץ\/ה|נקלט\/ה|✓ סיים)$/;
    const read = (name) => {
      const li = [...document.querySelectorAll('[data-info-row]')]
        .find((el) => (el.querySelector('.serif') || {}).textContent?.includes(name));
      if (!li) return null;
      const tags = [...new Set([...li.querySelectorAll('span,div')].map((e) => e.textContent.trim()).filter((t) => TAGS.test(t)))];
      return tags;
    };
    return { placed: read(pName), hired: read(hName) };
  }, { pName: PLACED_NAME, hName: HIRED_NAME });
}

const placedOk = Array.isArray(seen.placed) && seen.placed.includes('שובץ/ה') && seen.placed.includes('✓ סיים');
const hiredOk = Array.isArray(seen.hired) && seen.hired.includes('נקלט/ה') && seen.hired.includes('✓ סיים');

audit.recordCell({
  id: 'DONE-keeps-placement',
  tableRef: 'StudentsPage StudentRow — completion does not hide placement',
  expected: 'a finished student still shows their placement tag: placed → "שובץ/ה" + "✓ סיים"; hired → "נקלט/ה" + "✓ סיים"',
  observed: seeded ? `placedRow=${JSON.stringify(seen.placed)}, hiredRow=${JSON.stringify(seen.hired)}` : 'seed failed',
  pass: seeded ? (placedOk && hiredOk) : null,
  after: await audit.shot('completed-keeps-placement'),
  notes: !placedOk && Array.isArray(seen.placed) && !seen.placed.includes('שובץ/ה')
    ? 'Completion is hiding the placement tag — the list no longer shows whether the student was placed.'
    : (!hiredOk && Array.isArray(seen.hired) && !seen.hired.includes('נקלט/ה')
      ? 'Completion is hiding the "נקלט/ה" tag.' : ''),
});

const cleaned = await cas((d) => ({ ...d, students: (d.students || []).filter((s) => s.id !== PLACED_ID && s.id !== HIRED_ID) }));
audit.log(cleaned ? 'Cleanup: temp students removed' : '⚠ Cleanup FAILED — remove them manually.');

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

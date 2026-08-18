#!/usr/bin/env node
/**
 * 71-touch-reachable.mjs — a control that only appears on hover does not exist on a phone.
 *
 * Yariv, on רננה (2026-08-11): "לא רואה אפשרות למחוק אותה מרשימת המועמדים. החץ המעוקל
 * מעביר אותה בחזרה לתיבה לפני קליטה אז לא בטוח שזו הדרך הנכונה."
 *
 * The removal control was there all along — `✕ בטל ראיון`, built in PR #4 — wearing
 * `opacity-0 group-hover:opacity-100`. A phone has no hover, so on the device he actually
 * works on it was permanently invisible. That is worse than a missing feature: a missing
 * one gets reported, an invisible one gets worked around for weeks.
 *
 * Measured with a real touch viewport and NO pointer over the row: every control inside a
 * row must be visible on arrival. Structural — it walks whatever rows exist rather than
 * naming buttons, so a new hover-gated control is caught without anyone adding a cell.
 */
import { Audit, appReady, mutateData, sbQuery } from '../audit-lib.mjs';

// Seed one candidate to look at. On 2026-08-11 the only non-archived candidate was
// removed while this was being written, and the cell went quiet — the state Yariv
// reported would have been untested precisely because he had dealt with it.
const ts = Date.now();
const CAND_ID = `audit-cand-touch-${ts}`;
const CAND_NAME = `מועמד/ת מגע ${ts}`;
const d0 = (await sbQuery('practicum_data', { select: 'data' }))[0].data;
const course = (d0.courses || []).find(c => c.id === 'hr-practicum-tashpaz')
  || (d0.courses || []).find(c => c?.type === 'practicum' && c?.year);
await mutateData(data => ({
  ...data,
  candidates: [...(data.candidates || []), {
    id: CAND_ID, name: CAND_NAME, email: `${CAND_ID}@audit.local`, phone: '0500000000',
    courseId: course?.id, year: course?.year, interviewResult: 'pending',
    interviewDate: '2026-09-30', interviewTime: '10:00-10:30', interviewSummary: '', notes: '',
  }],
}));

const audit = new Audit({ name: 'touch-reachable' });
await audit.setup();
await audit.page.setViewportSize({ width: 390, height: 844 });

for (const page of ['candidates', 'students']) {
  await audit.page.evaluate((pg) => {
    // The candidates list renders inside a course context; '__all__' shows none.
    localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'hr-practicum-tashpaz', year: 'תשפ״ז' }));
    localStorage.setItem('practicum_v2_page', pg);
  }, page);
  await audit.page.reload({ waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1500);
  // Park the pointer away from every row, so nothing is hovered by accident.
  await audit.page.mouse.move(5, 5);

  const r = await audit.page.evaluate(() => {
    const rows = [...document.querySelectorAll('li')].filter(li => li.querySelector('button'));
    const ghosts = [];
    for (const li of rows) {
      for (const b of li.querySelectorAll('button')) {
        // Only controls that OCCUPY SPACE but are transparent — that is the hover-gating
        // shape. A button inside a collapsed detail section has no layout box at all and
        // is not hidden from touch; it is simply in a closed drawer.
        if (!b.offsetParent && getComputedStyle(b).position !== 'fixed') continue;
        const cs = getComputedStyle(b);
        if (parseFloat(cs.opacity) < 0.15) {
          ghosts.push(`${(b.textContent || b.title || '?').trim().slice(0, 24)} (opacity ${cs.opacity})`);
        }
      }
    }
    return { rows: rows.length, ghosts: [...new Set(ghosts)] };
  });

  audit.recordCell({
    id: `TOUCH-${page}-controls-visible`,
    tableRef: 'Yariv works this app on an iPhone — there is no hover there',
    expected: 'every control inside a row is visible without hovering',
    observed: r.rows === 0 ? 'no rows on screen'
      : r.ghosts.length ? `${r.ghosts.length} invisible: ${r.ghosts.join(' · ')}`
      : `${r.rows} rows, all controls visible`,
    pass: r.rows === 0 ? null : r.ghosts.length === 0,
  });
}

// And the one Yariv asked for: a candidate must be removable FROM THE ROW.
// Back to the candidates screen first — the loop above ends on students, and asking the
// wrong page produced a "no candidate row on screen" skip that looked like missing data.
await audit.page.evaluate(() => localStorage.setItem('practicum_v2_page', 'candidates'));
await audit.page.reload({ waitUntil: 'networkidle' });
await appReady(audit.page);
await audit.page.waitForTimeout(1600);
await audit.page.mouse.move(5, 5);
const removal = await audit.page.evaluate(() => {
  const li = [...document.querySelectorAll('li')].find(l => l.querySelector('[data-cancel-interview]'));
  if (!li) return { skip: 'no candidate row on screen' };
  const b = li.querySelector('[data-cancel-interview]');
  const cs = getComputedStyle(b);
  return { label: (b.textContent || '').trim(), opacity: cs.opacity, visible: parseFloat(cs.opacity) > 0.15 };
});
audit.recordCell({
  id: 'TOUCH-candidate-can-leave',
  tableRef: 'Yariv 2026-08-11: "לא רואה אפשרות למחוק אותה מרשימת המועמדים"',
  expected: 'the row carries a visible way to remove a candidate who is not continuing',
  observed: removal.skip || `"${removal.label}" (opacity ${removal.opacity})`,
  pass: removal.skip ? null : removal.visible,
});

try {
  await mutateData(data => ({ ...data, candidates: (data.candidates || []).filter(c => c.id !== CAND_ID) }));
  audit.log('Cleanup: removed the seeded candidate');
} catch (e) { audit.log(`⚠ Cleanup failed: ${String(e.message).slice(0, 80)}`); }

await audit.teardown();

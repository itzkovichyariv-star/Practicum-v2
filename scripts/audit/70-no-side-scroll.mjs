#!/usr/bin/env node
/**
 * 70-no-side-scroll.mjs — no screen may scroll sideways on a phone.
 *
 * Found while chasing something else (2026-08-11): the candidates screen scrolled
 * sideways by 64px at 390px wide. The cause was an InfoPopover with `minWidth: 340,
 * maxWidth: 420` plus padding — 440px on a 390px viewport — and because that box is only
 * `invisible` rather than unmounted, it widened the PAGE even when it was never opened.
 * Nobody would connect "the list drifts sideways" to a popover they never touched.
 *
 * Read-only, and structural rather than per-instance: it walks the real screens at phone
 * width and, when one overflows, NAMES the widest element responsible — so the next
 * report starts with the answer instead of the symptom.
 */
import { Audit, appReady } from '../audit-lib.mjs';

const audit = new Audit({ name: 'no-side-scroll' });
await audit.setup();
await audit.page.setViewportSize({ width: 390, height: 844 });

for (const page of ['students', 'candidates', 'employers']) {
  await audit.page.evaluate((pg) => {
    localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: '__all__', year: '__all__' }));
    localStorage.setItem('practicum_v2_page', pg);
  }, page);
  await audit.page.reload({ waitUntil: 'networkidle' });
  await appReady(audit.page);
  await audit.page.waitForTimeout(1400);

  const r = await audit.page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const over = document.documentElement.scrollWidth - vw;
    if (over <= 0) return { over };
    // Name the culprit: the widest element that is NOT itself a scrollable strip (a tab
    // bar with overflow-x:auto is allowed to be wider than the screen — that is its job).
    const blame = [...document.querySelectorAll('body *')]
      .map(e => ({ e, w: e.getBoundingClientRect().width }))
      .filter(x => x.w > vw + 2 && !['auto', 'scroll'].includes(getComputedStyle(x.e).overflowX))
      .sort((a, b) => b.w - a.w)[0];
    return {
      over,
      blame: blame ? `${blame.e.tagName.toLowerCase()}.${String(blame.e.className || '').split(' ')[0]} @ ${Math.round(blame.w)}px` : 'no single element — check margins/padding',
    };
  });

  // A long unbroken token is what actually caused the 64px: machine-made submission names
  // like "Audit Zoomdef 1786285223226" and their addresses have no break opportunity, so
  // they pushed their column past the screen. Purging those rows made the symptom vanish,
  // which would leave this cell passing for a reason that will not hold for the next long
  // name a real person submits. So it injects one and measures — the rule, not the data.
  const stress = await audit.page.evaluate(() => {
    // Only where USER DATA lands — inside a list row. A page heading is a fixed literal
    // that no submission can lengthen, so stressing it would report a problem nobody can
    // ever have.
    const el = [...document.querySelectorAll('li .serif, [data-info-row] .serif')]
      .filter(e => (e.textContent || '').trim().length > 2)
      .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    if (!el) return { skip: 'no data-bearing name on this screen' };
    const before = el.textContent;
    // ONE token, no spaces — a string with spaces can wrap at them and proves nothing.
    el.textContent = 'AuditZoomdef1786285223226aVeryLongUnbrokenTokenIndeedNoSpacesHere';
    const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    el.textContent = before;
    return { over, where: `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ').slice(0, 2).join('.')}` };
  });
  audit.recordCell({
    id: `SIDESCROLL-${page}-long-name`,
    tableRef: 'a machine-made name, or simply a long one, must not widen the page',
    expected: 'still fits with an unbreakable 55-character name in a row',
    observed: stress.skip || (stress.over <= 0 ? `fits (${stress.over}px) — stressed ${stress.where}` : `overflows by ${stress.over}px — ${stress.where}`),
    pass: stress.skip ? null : stress.over <= 0,
  });

  audit.recordCell({
    id: `SIDESCROLL-${page}`,
    tableRef: 'Yariv works this app on an iPhone',
    expected: 'the page fits a 390px screen',
    observed: r.over <= 0 ? `fits (${r.over}px)` : `overflows by ${r.over}px — ${r.blame}`,
    pass: r.over <= 0,
  });
}

await audit.teardown();

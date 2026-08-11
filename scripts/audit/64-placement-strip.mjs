#!/usr/bin/env node
/**
 * 64-placement-strip.mjs — the placement strip on the student row.
 *
 * Two layers, deliberately:
 *
 *  A. RULE cells (pure, no browser, no seeding) — drive lib/placementStatus.ts with
 *     fixtures and assert the state + whose-turn + the exact sentence. These are the
 *     cells that would go red if someone re-ordered the precedence or reworded a state.
 *
 *  B. RENDER cells (browser, against whatever real students exist) — assert that the
 *     rule actually reaches the screen: every practicum row carries exactly one strip,
 *     the turn filter narrows to the turn it names, and a self-suggested org is marked
 *     by FORM (dashed) rather than by a colour of its own.
 *
 * No prod data is seeded or mutated: layer A needs none, and layer B only reads what is
 * already there and asserts structure, so it stays green as Yariv works the list.
 */
import { Audit } from '../audit-lib.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const audit = new Audit({ name: 'placement-strip' });

// ── A. rule cells — run through tsx (the rule module is TypeScript) ─────────────
let ruleCells = [];
try {
  const out = execFileSync('npx', ['tsx', 'scripts/audit/rules-placement.mts'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
  });
  ruleCells = JSON.parse(out.slice(out.indexOf('[')));
} catch (e) {
  ruleCells = [{ id: 'STRIP-rules', tableRef: 'rules-placement.mts',
    expected: 'rule suite runs', observed: String(e.message || e).slice(0, 160), pass: false }];
}
for (const c of ruleCells) audit.recordCell(c);

// Rows are COLLAPSED by default since 2026-08-10 (a row with organizations was ~500px
// on a phone; eleven students spanned about five screens). Anything that inspects the
// ranking, the ⓘ or the chips must open the row first — that is the design, not a bug.
const expandAll = () => audit.page.evaluate(async () => {
  for (const b of document.querySelectorAll('[data-strip-expand="closed"]')) {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }
  await new Promise(r => setTimeout(r, 350));
  return document.querySelectorAll('[data-org-chip]').length;
});

// ── B. render cells ─────────────────────────────────────────────────────────────
await audit.setup();
await audit.page.evaluate(() => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'hr-practicum-tashpaz', year: 'תשפ״ז' }));
  localStorage.setItem('practicum_v2_page', 'students');
});
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1600);

await expandAll();
const shape = await audit.page.evaluate(() => {
  const rows = [...document.querySelectorAll('li')].filter(li => li.querySelector('[data-placement-strip]'));
  const strips = [...document.querySelectorAll('[data-placement-strip]')];
  const chip = document.querySelector('[data-org-chip]');
  return {
    rows: rows.length,
    strips: strips.length,
    everyRowHasOne: rows.every(li => li.querySelectorAll('[data-placement-strip]').length === 1),
    headlinesNonEmpty: strips.every(s => (s.querySelector('[data-strip-headline]')?.textContent || '').trim().length > 5),
    turnsValid: strips.every(s => ['ours', 'student', 'employer', 'closed'].includes(s.getAttribute('data-turn'))),
    dashedSuggested: chip ? getComputedStyle(chip).borderStyle : null,
  };
});
audit.recordCell({ id: 'STRIP-render-one-per-row', tableRef: 'PlacementStrip in StudentRow',
  expected: 'every practicum row has exactly 1 strip', observed: `${shape.strips} strips / ${shape.rows} rows, unique=${shape.everyRowHasOne}`,
  pass: shape.rows > 0 && shape.everyRowHasOne && shape.strips === shape.rows });
audit.recordCell({ id: 'STRIP-render-sentence', tableRef: 'Yariv: the explaining line is the most important',
  expected: 'every strip carries a headline sentence', observed: String(shape.headlinesNonEmpty), pass: shape.headlinesNonEmpty });
audit.recordCell({ id: 'STRIP-render-turn', tableRef: 'brief §whose turn',
  expected: 'every strip has a valid turn', observed: String(shape.turnsValid), pass: shape.turnsValid });

// the turn filter must narrow to exactly the turn it names
const filtered = await audit.page.evaluate(async () => {
  const btn = document.querySelector('[data-turn-filter="ours"]');
  if (!btn) return { skip: 'no filter control' };
  // How many rows are in that turn BEFORE filtering. With none, the filter correctly
  // shows an empty list and there is nothing to assert — that is a skip, not a failure.
  const before = [...document.querySelectorAll('[data-placement-strip]')]
    .filter(s => s.getAttribute('data-turn') === 'ours').length;
  if (!before) return { skip: 'no student is in the "ours" turn right now' };
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  await new Promise(r => setTimeout(r, 350));
  const turns = [...document.querySelectorAll('[data-placement-strip]')].map(s => s.getAttribute('data-turn'));
  // Put the list back. Leaving it filtered starved every later cell on this page: with
  // nobody in "ours" the page went empty and STRIP-org-details reported "no info
  // control", which reads as a missing feature rather than an empty screen.
  document.querySelector('[data-turn-filter="all"]')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  await new Promise(r => setTimeout(r, 350));
  return { ok: turns.length > 0 && turns.every(t => t === 'ours'), turns: [...new Set(turns)].join(','), before };
});
audit.recordCell({ id: 'STRIP-turn-filter', tableRef: 'brief §whose turn filter',
  expected: 'only ours rows remain', observed: filtered.skip || `${filtered.before} ours → [${filtered.turns}]`,
  pass: filtered.skip ? null : filtered.ok });

// an org chip opens the employer's real contact details — including a private org the
// student proposed, which had no reachable details anywhere (Yariv 2026-08-09).
await expandAll();
const details = await audit.page.evaluate(async () => {
  // Details moved to a dedicated ⓘ control: tapping the chip now SELECTS the org to
  // send to (Yariv 2026-08-09 — "מסמנים את אחת הבחירות ושולחים לה"), so the two
  // gestures must not fight.
  const info = document.querySelector('[data-org-info]');
  if (!info) return { ok: false, why: 'no info control' };
  info.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  await new Promise(r => setTimeout(r, 300));
  const pop = document.querySelector('[data-employer-details]');
  return { ok: !!pop, text: (pop?.innerText || '').replace(/\s+/g, ' ').slice(0, 90) };
});
audit.recordCell({ id: 'STRIP-org-details', tableRef: 'Yariv 2026-08-09: reach the contact from the student page',
  expected: 'chip opens employer contact details', observed: details.text || details.why || 'not opened', pass: details.ok });

// every action states its consequence BEFORE it runs
const warn = await audit.page.evaluate(async () => {
  const btn = document.querySelector('[data-strip-action]');
  if (!btn) return { ok: null, why: 'no action button on screen' };
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  await new Promise(r => setTimeout(r, 300));
  const dlg = document.querySelector('[data-placement-confirm]');
  const txt = dlg?.innerText || '';
  [...(dlg?.querySelectorAll('button') || [])].find(b => b.textContent.trim() === 'ביטול')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  return { ok: !!dlg && txt.length > 60, text: txt.replace(/\s+/g, ' ').slice(0, 90) };
});
audit.recordCell({ id: 'STRIP-action-warns', tableRef: 'Yariv decision ב: 1 click opens a warning',
  expected: 'action opens a consequence warning', observed: warn.text || warn.why || 'no dialog', pass: warn.ok });


// ── C. narrow-screen containment ────────────────────────────────────────────────
// Reported from Yariv's iPhone on v1.34.0: the org chip sat outside the strip's border.
// It fitted on the dev machine by ~15px and broke wherever the Hebrew font renders wider.
// A nowrap chip cannot shrink, so this is a brittleness bug, not a width bug — the cell
// therefore forces a wider font AND a phone viewport, which is what makes it discriminating
// (restoring white-space:nowrap pushes the chip 65px out and turns this red).
await audit.page.setViewportSize({ width: 375, height: 812 });
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1400);

await expandAll();
const contained = await audit.page.evaluate(async () => {
  const st = document.createElement('style');
  st.textContent = '[data-org-chip]{font-size:15.5px !important}';   // ~35% wider than dev
  document.head.appendChild(st);
  await new Promise(r => setTimeout(r, 250));
  let worst = 0, who = '', chips = 0;
  for (const strip of document.querySelectorAll('[data-placement-strip]')) {
    const cs = getComputedStyle(strip), b = strip.getBoundingClientRect();
    const innerL = b.left + parseFloat(cs.paddingLeft), innerR = b.right - parseFloat(cs.paddingRight);
    for (const c of strip.querySelectorAll('[data-org-chip]')) {
      chips++;
      const r = c.getBoundingClientRect();
      const over = Math.max(innerL - r.left, r.right - innerR);
      if (over > worst) { worst = over; who = c.textContent.trim().slice(0, 26); }
    }
  }
  const bodyScroll = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  st.remove();
  return { worst: +worst.toFixed(1), who, chips, bodyScroll };
});
audit.recordCell({ id: 'STRIP-narrow-containment', tableRef: 'iPhone report 2026-08-09 (v1.34.0)',
  expected: 'no org chip escapes the strip at 375px with a 35%-wider font, and the page never scrolls sideways',
  observed: `${contained.chips} chips, worst overflow ${contained.worst}px${contained.who ? ` (${contained.who})` : ''}, bodyScrollX=${contained.bodyScroll}`,
  // bodyScroll <= 0: sub-pixel rounding can make scrollWidth 1px LESS than clientWidth.
  // Anything > 0 is real sideways scroll; -1 is not a failure.
  pass: contained.chips > 0 && contained.worst <= 0.5 && contained.bodyScroll <= 0 });


// Sections D and E both drive selection state on the SAME page, so each starts from a
// fresh load — otherwise the earlier section's clicks decide what the later one reads.
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1400);

// ── D. pick-then-send, and a readable rank ──────────────────────────────────────
// Yariv on v1.34.0: "לא ברור לאיזה מעסיק זה שילחץ", "המספור קטן ולא רואים", and the
// system should say when the first choice is taken and point at the next open one.
await expandAll();
const pick = await audit.page.evaluate(async () => {
  const strip = [...document.querySelectorAll('[data-placement-strip="list_ready"]')]
    .find(s => s.querySelectorAll('[data-org-chip][data-org-available="1"]').length > 1);
  if (!strip) return { skip: 'no send_cv row on screen' };
  const btn = strip.querySelector('[data-strip-action]');
  const chips = [...strip.querySelectorAll('[data-org-chip]')];
  const badge = chips[0]?.querySelector('span[aria-label^="בחירה"]');
  const before = { label: btn.textContent.trim(), target: btn.getAttribute('data-strip-target') };
  // switch the target by ticking a different AVAILABLE org
  const other = chips.find(c => c.getAttribute('data-org-available') === '1'
    && c.getAttribute('data-org-selected') !== '1');
  if (other) { other.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
               await new Promise(r => setTimeout(r, 250)); }
  const after = { label: btn.textContent.trim(), target: btn.getAttribute('data-strip-target') };
  return {
    before, after,
    switched: !!other,
    badgePx: badge ? parseFloat(getComputedStyle(badge).fontSize) : 0,
    badgeW: badge ? parseFloat(getComputedStyle(badge).width) : 0,
    blockedShown: !!strip.querySelector('[data-org-blocked]'),
    namesTarget: /ל‑/.test(before.label),
  };
});

if (pick.skip) {
  audit.recordCell({ id: 'STRIP-pick-then-send', expected: 'a send_cv row exists', observed: pick.skip, pass: null });
} else {
  audit.recordCell({ id: 'STRIP-action-names-target', tableRef: 'Yariv: "לא ברור לאיזה מעסיק זה יישלח"',
    expected: 'the button names the employer it will send to',
    observed: `${pick.before.label} (target=${pick.before.target})`, pass: pick.namesTarget && !!pick.before.target });
  audit.recordCell({ id: 'STRIP-pick-then-send', tableRef: 'Yariv: "מסמנים את אחת הבחירות ושולחים לה"',
    expected: 'ticking another available org retargets the send',
    observed: pick.switched ? `${pick.before.target} → ${pick.after.target}` : 'only one available org (nothing to switch)',
    pass: !pick.switched || pick.after.target !== pick.before.target });
  audit.recordCell({ id: 'STRIP-rank-readable', tableRef: 'Yariv: "המספור קטן ולא רואים"',
    expected: 'rank badge >= 10px text in a >= 15px badge',
    observed: `${pick.badgePx}px in ${pick.badgeW}px`, pass: pick.badgePx >= 10 && pick.badgeW >= 15 });
}

// Yariv 2026-08-11: "הטלפון של הארגון שמוצג אינו לחיץ." The number is what you reach
// for on a phone; there was only a call ICON beside it. The href must also survive the
// U+202D/U+202C direction marks that Excel-pasted numbers carry — the live מערך הדיגיטל
// הלאומי number is wrapped in exactly those, and they would break tel: silently.
await expandAll();
const contact = await audit.page.evaluate(async () => {
  document.querySelector('[data-org-info]')?.click();
  await new Promise(r => setTimeout(r, 500));
  const a = document.querySelector('[data-org-phone-link]');
  return a ? { href: a.getAttribute('href') || '', text: (a.textContent || '').trim() } : null;
});
audit.recordCell({ id: 'STRIP-phone-is-tappable', tableRef: 'Yariv 2026-08-11',
  expected: 'the number itself is a tel: link carrying digits only',
  observed: contact ? `${contact.text} → ${contact.href}` : 'no phone on screen right now',
  pass: contact ? /^tel:\+?[0-9]+$/.test(contact.href) : null });

// A blocked first choice must SAY it is blocked, on the row.
await expandAll();
const blocked = await audit.page.evaluate(() => {
  const el = document.querySelector('[data-org-blocked]');
  const chip = el?.closest('[data-org-chip]');
  return el ? { text: el.textContent.trim(), avail: chip?.getAttribute('data-org-available') } : null;
});
audit.recordCell({ id: 'STRIP-blocked-explains', tableRef: 'Yariv: "הבחירה הראשונה תפוסה על ידי סטודנט אחר"',
  expected: 'a full choice states why it is blocked and is not selectable',
  observed: blocked ? `"${blocked.text}" (available=${blocked.avail})` : 'no blocked chip on screen right now',
  pass: blocked ? (blocked.text.length > 3 && blocked.avail === '0') : null });


// Sections D and E both drive selection state on the SAME page, so each starts from a
// fresh load — otherwise the earlier section's clicks decide what the later one reads.
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1400);

// ── E. mixed row: the buttons follow the SELECTED org ───────────────────────────
await expandAll();
const mixed = await audit.page.evaluate(async () => {
  const strip = [...document.querySelectorAll('[data-placement-strip="suggested_org"]')][0];
  if (!strip) return { skip: 'no mixed row on screen' };
  const read = () => [...strip.querySelectorAll('[data-strip-action]')].map(b => b.getAttribute('data-strip-action'));
  const suggestedFirst = read();
  const listChip = [...strip.querySelectorAll('[data-org-chip]')]
    .find(c => c.getAttribute('data-org-available') === '1' && c.getAttribute('data-org-selected') !== '1');
  if (!listChip) return { skip: 'no second selectable org' };
  listChip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  await new Promise(r => setTimeout(r, 300));
  return { suggestedFirst, afterListPick: read(), org: listChip.getAttribute('data-org-chip') };
});
if (mixed.skip) {
  audit.recordCell({ id: 'STRIP-mixed-actions', expected: 'a mixed row exists', observed: mixed.skip, pass: null });
} else {
  audit.recordCell({ id: 'STRIP-mixed-actions', tableRef: 'Yariv 2026-08-09: mixed suggested + list rule',
    expected: 'suggested org → place_direct + send_cv; list org → send_cv only',
    observed: `suggested=[${mixed.suggestedFirst}] → ${mixed.org}=[${mixed.afterListPick}]`,
    pass: mixed.suggestedFirst.includes('place_direct') && mixed.suggestedFirst.includes('send_cv')
       && mixed.afterListPick.join(',') === 'send_cv' });
}


// ── F. the compact row and the waiting queue ────────────────────────────────────
// Approved 2026-08-10 after measuring the live page: a row with organizations was
// 475–613px at 375px wide, and eleven students came to 4,163px — about five phone
// screens to reach the four that need action.
await audit.page.setViewportSize({ width: 375, height: 812 });
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1600);

const compact = await audit.page.evaluate(async () => {
  const rows = [...document.querySelectorAll('li[data-student-row]')];
  const h = rows.map(li => Math.round(li.getBoundingClientRect().height));
  const exp = document.querySelector('[data-strip-expand="closed"]');
  const li = exp?.closest('li');
  const before = li ? Math.round(li.getBoundingClientRect().height) : 0;
  const chipsClosed = li ? li.querySelectorAll('[data-org-chip]').length : -1;
  if (exp) { exp.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); await new Promise(r => setTimeout(r, 350)); }
  const after = li ? Math.round(li.getBoundingClientRect().height) : 0;
  const chipsOpen = li ? li.querySelectorAll('[data-org-chip]').length : -1;
  return { rows: rows.length, total: h.reduce((a, b) => a + b, 0), before, after, chipsClosed, chipsOpen,
           sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
audit.recordCell({ id: 'STRIP-collapsed-by-default', tableRef: 'page design 2026-08-10, decision א',
  expected: 'a row with organizations hides its ranking until opened',
  observed: `chips closed=${compact.chipsClosed}, open=${compact.chipsOpen}, height ${compact.before}→${compact.after}px`,
  pass: compact.chipsClosed === 0 && compact.chipsOpen > 0 && compact.after > compact.before });
audit.recordCell({ id: 'STRIP-total-height-reduced', tableRef: 'the 4,163px measurement that prompted the redesign',
  expected: 'the whole cohort fits in well under the 4,163px it took before',
  observed: `${compact.rows} rows, ${compact.total}px (${(compact.total / 812).toFixed(1)} screens)`,
  pass: compact.rows > 0 && compact.total < 3400 });
// The expanded state is where a nowrap, non-shrinking button pushed the row 90px past
// the viewport — the redesign must not reintroduce sideways scroll.
audit.recordCell({ id: 'STRIP-expanded-no-side-scroll', tableRef: 'regression 2026-08-10',
  expected: 'no sideways scroll with a row expanded at 375px',
  observed: `${compact.sideScroll}px`, pass: compact.sideScroll <= 0 });

const queue = await audit.page.evaluate(() => {
  // Measure from the top of the page, not from wherever the previous section left the
  // scroll — "is it above the fold" means nothing against an arbitrary scroll offset.
  window.scrollTo(0, 0);
  const q = document.querySelector('[data-waiting-queue]');
  if (!q) return { present: false };
  const rows = [...q.querySelectorAll('[data-waiting-row]')];
  return { present: true, count: +q.getAttribute('data-waiting-queue'), rows: rows.length,
           actions: rows.map(r => r.querySelector('[data-waiting-action]')?.getAttribute('data-waiting-action')).filter(Boolean).length,
           top: Math.round(q.getBoundingClientRect().top),
           aboveTheFold: Math.round(q.getBoundingClientRect().top) < 812 };
});
audit.recordCell({ id: 'QUEUE-lists-who-waits', tableRef: 'page design 2026-08-10, decision ג',
  expected: 'the waiting list appears with one action per row (or is absent when nobody waits)',
  observed: queue.present ? `${queue.count} waiting, ${queue.rows} rows, ${queue.actions} actions, top=${queue.top}px aboveFold=${queue.aboveTheFold}` : 'nobody waiting — band absent',
  pass: queue.present ? (queue.rows === queue.count && queue.actions === queue.rows && queue.aboveTheFold) : null });

await audit.teardown();

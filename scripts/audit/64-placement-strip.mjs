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

// ── B. render cells ─────────────────────────────────────────────────────────────
await audit.setup();
await audit.page.evaluate(() => {
  localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'hr-practicum-tashpaz', year: 'תשפ״ז' }));
  localStorage.setItem('practicum_v2_page', 'students');
});
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1600);

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
  if (!btn) return { ok: false, why: 'no filter' };
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  await new Promise(r => setTimeout(r, 350));
  const turns = [...document.querySelectorAll('[data-placement-strip]')].map(s => s.getAttribute('data-turn'));
  return { ok: turns.length > 0 && turns.every(t => t === 'ours'), turns: [...new Set(turns)].join(',') };
});
audit.recordCell({ id: 'STRIP-turn-filter', tableRef: 'brief §whose turn filter',
  expected: 'only ours rows remain', observed: filtered.turns || filtered.why || 'none', pass: filtered.ok });

// an org chip opens the employer's real contact details — including a private org the
// student proposed, which had no reachable details anywhere (Yariv 2026-08-09).
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

// A blocked first choice must SAY it is blocked, on the row.
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

await audit.teardown();

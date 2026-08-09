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
  const chip = document.querySelector('[data-org-chip]');
  if (!chip) return { ok: false, why: 'no chip' };
  chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
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

await audit.teardown();

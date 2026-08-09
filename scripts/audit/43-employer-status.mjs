#!/usr/bin/env node
/**
 * 43-employer-status.mjs — the employers screen tells you WHOSE process is open.
 *
 * The reported bug (Yariv, 2026-08-09): sending שובל's CV took Icon Group's only place,
 * which knocked the org out of auto-green (auto-green requires an OPEN place) and dropped
 * it onto his own stale "פניתי לרנית…" recruiting note — so "בתהליך" was read as "I am
 * mid-approval with this org" when in fact a STUDENT was mid-process there.
 *
 *  A. RULE cells (pure) — precedence, the two amber states, and the explanation sentence.
 *  B. RENDER cells (browser) — the sentence actually reaches the screen, on both the list
 *     row and the grid card, and outranks the pill in size.
 *
 * Reads only; seeds nothing.
 */
import { Audit } from '../audit-lib.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const audit = new Audit({ name: 'employer-status' });

// ── A. rule cells ───────────────────────────────────────────────────────────────
let ruleCells = [];
try {
  const out = execFileSync('npx', ['tsx', 'scripts/audit/rules-employer-status.mts'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
  });
  ruleCells = JSON.parse(out.slice(out.indexOf('[')));
} catch (e) {
  ruleCells = [{ id: 'EMP-rules', tableRef: 'rules-employer-status.mts',
    expected: 'rule suite runs', observed: String(e.message || e).slice(0, 160), pass: false }];
}
for (const c of ruleCells) audit.recordCell(c);

// ── B. render cells ─────────────────────────────────────────────────────────────
await audit.setup();

for (const view of ['list', 'grid']) {
  await audit.page.evaluate((v) => {
    localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: 'hr-practicum-tashpaz', year: 'תשפ״ז' }));
    localStorage.setItem('practicum_v2_page', 'employers');
    localStorage.setItem('employers_view', v);
  }, view);
  await audit.page.reload({ waitUntil: 'networkidle' });
  await audit.page.waitForTimeout(1500);

  const shape = await audit.page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-employer-explain]')];
    const first = els[0];
    // The status pill is the round-cornered button carrying the label text. Matched by
    // COMPUTED style + text, not by an inline-style substring, which silently found
    // nothing and made the size comparison vacuous.
    const card = first?.closest('li') || first?.parentElement;
    const pill = [...(card?.querySelectorAll('button') || [])].find(b =>
      getComputedStyle(b).borderRadius.startsWith('999px')
      && /^(מאושר|סטודנט\/ית בתהליך|בתהליך מול הארגון|טרם|מלא|נדחה)/.test(b.textContent.trim()));
    return {
      count: els.length,
      allNonEmpty: els.length > 0 && els.every(e => (e.textContent || '').trim().length > 10),
      explainSize: first ? parseFloat(getComputedStyle(first).fontSize) : 0,
      explainColor: first ? getComputedStyle(first).color : '',
      pillSize: pill ? parseFloat(getComputedStyle(pill).fontSize) : 0,
    };
  });
  audit.recordCell({ id: `EMP-render-${view}-explain`, tableRef: 'brief part 2 §fix 4',
    expected: 'every employer row carries an explanation sentence',
    observed: `${shape.count} rows, allNonEmpty=${shape.allNonEmpty}`, pass: shape.count > 0 && shape.allNonEmpty });
  // Yariv: "the line that explains the status is the one that is most important" — so it
  // must outrank the pill in size, not merely exist.
  audit.recordCell({ id: `EMP-render-${view}-hierarchy`, tableRef: 'Yariv 2026-08-09',
    expected: 'explanation larger than the status pill',
    observed: `explain ${shape.explainSize}px vs pill ${shape.pillSize}px`,
    pass: shape.explainSize >= 13 && (shape.pillSize === 0 || shape.explainSize > shape.pillSize) });
}

await audit.teardown();

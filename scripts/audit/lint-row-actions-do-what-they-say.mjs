#!/usr/bin/env node
/**
 * lint-row-actions-do-what-they-say.mjs — static, no browser.
 *
 * Yariv, 2026-08-11, on הדר עוזירי → מערך הדיגיטל הלאומי: "לחצתי אישור והמערכת עדכנה
 * שהנתונים נשמרו אבל לא היה שינוי … ניכר ששום כפתור לא באמת עבד מחוץ למערכת."
 *
 * `place_direct` promised, in its own confirmation dialog, that the student would be
 * recorded as placed and the place taken. The row then called setEditing() and returned.
 * The dialog was a promise the code never kept, and nothing failed loudly — the card
 * opened, so it looked like something had happened.
 *
 * Structural rather than per-instance: for EVERY action the row can offer, either
 *   (a) runPlacementAction handles it — it does something, or
 *   (b) its warnBody says the card will open and no data changes.
 * A new action added to the catalogue is checked automatically, which is the point: the
 * next one cannot slip through because nobody remembered to write a cell for it.
 *
 * Run by the pre-gate lint sweep; exits 1 on a broken promise.
 */
import { readFileSync } from 'node:fs';

const status = readFileSync('src/lib/placementStatus.ts', 'utf8');
const page = readFileSync('src/components/StudentsPage.tsx', 'utf8');

const ids = [...status.matchAll(/^ {2}(\w+): \{$/gm)]
  .map((m) => m[1])
  .filter((id) => new RegExp(`id: '${id}'`).test(status));

// the ones runPlacementAction acts on itself, rather than handing to the card
const handled = new Set([...page.matchAll(/action\.id === '(\w+)'/g)].map((m) => m[1]));
if (/action\.id !== 'adopt'/.test(page)) handled.add('adopt');

// "this only opens the card" — the honest phrasing add_orgs already used
const opensCard = (id) => {
  const after = status.split(new RegExp(`\\n {2}${id}: \\{`))[1] || '';
  const body = (after.split('warnBody:')[1] || '').split('\n')[0];
  return /ייפתח כרטיס/.test(body);
};

const broken = ids.filter((id) => !handled.has(id) && !opensCard(id));

console.log(`lint-row-actions: ${ids.length} action(s) — ${ids.join(', ')}`);
console.log(`  acted on in the row : ${[...handled].filter((h) => ids.includes(h)).join(', ') || '(none)'}`);
console.log(`  say the card opens  : ${ids.filter(opensCard).join(', ') || '(none)'}`);

if (broken.length) {
  console.error(`\n❌ LINT-row-actions-honest: ${broken.join(', ')}`);
  console.error('   Each shows a confirmation promising an effect, then only opens the card.');
  console.error('   Either handle it in runPlacementAction, or say "ייפתח כרטיס" in its warnBody.');
  process.exit(1);
}
console.log('\n✅ LINT-row-actions-honest: every action either acts or says the card opens.');

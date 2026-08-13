#!/usr/bin/env node
/**
 * lint-contact-buttons-match.mjs — static, no browser.
 *
 * Yariv, 2026-08-13, on the candidates screen: "האיקונים של התקשורת בדף מועמד
 * נראים מוזר אבל מניח שהם ידמו לאיקונים הקיימים בדף סטודנט."
 *
 * He was right, and it was not a rendering accident. The student row drew its
 * three contact controls with the SVG components in components/icons.tsx inside a
 * 36px wine-outlined circle; the candidate row went through RowActions, which
 * draws 📞 💬 ✉ as literal emoji in a 32px circle with the ink colour. Two
 * different-looking controls for the same three actions on two screens the same
 * person moves between all day.
 *
 * Structural rather than per-instance, so the two cannot drift apart again:
 *   1. contactBtn / contactStyle are declared EXACTLY ONCE in the codebase, in
 *      StudentsPage, and exported — one definition, not two that agree today.
 *   2. Every screen that draws a contact row imports them from there rather than
 *      re-deriving the look locally.
 *   3. Those screens use the icon COMPONENTS. An emoji glyph inside a contactBtn
 *      is the exact regression this exists to catch.
 *
 * RowActions itself is deliberately NOT in scope: lectures and trainers still use
 * it and were not part of the approved change. When they are aligned, add them to
 * SCREENS and this lint starts guarding them too.
 *
 * Run by the pre-gate lint sweep; exits 1 on a mismatch.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/components';
const OWNER = 'StudentsPage.tsx';
// Screens whose contact row must match the student row, byte for byte in style.
const SCREENS = ['StudentsPage.tsx', 'CandidatesPage.tsx'];
const EMOJI_CONTACT = /['"`][📞💬✉📧☎️📱]/u;

const read = (f) => readFileSync(join(DIR, f), 'utf8');
const problems = [];

// ── 1. one definition, in the owner, exported ────────────────────────────────
const declarers = readdirSync(DIR)
  .filter((f) => f.endsWith('.tsx'))
  .filter((f) => /\b(const|let|var)\s+contactBtn\s*=/.test(read(f)));

if (declarers.length !== 1 || declarers[0] !== OWNER) {
  problems.push(
    `contactBtn must be declared exactly once, in ${OWNER} — found in [${declarers.join(', ') || 'nowhere'}]`,
  );
}
const owner = read(OWNER);
for (const name of ['contactBtn', 'contactStyle']) {
  if (!new RegExp(`export const ${name}\\s*=`).test(owner)) {
    problems.push(`${OWNER} must \`export const ${name}\` so other screens share it`);
  }
}

// ── 2 + 3. every listed screen imports it, and draws icons not emoji ─────────
for (const file of SCREENS) {
  const src = read(file);
  if (file !== OWNER) {
    const imports = new RegExp(`import\\s*\\{[^}]*\\bcontactBtn\\b[^}]*\\}\\s*from\\s*'\\./StudentsPage'`, 's');
    if (!imports.test(src)) {
      problems.push(`${file} draws contact buttons but does not import contactBtn from ./StudentsPage`);
    }
  }
  // A contactBtn button whose child is an emoji literal rather than an icon component.
  for (const m of src.matchAll(/className=\{contactBtn\}[^>]*>([^<]*)</g)) {
    if (EMOJI_CONTACT.test(`'${m[1]}`)) {
      problems.push(`${file}: a contactBtn renders an emoji (${m[1].trim()}) instead of an icon component`);
    }
  }
  const usesIcons = /<(PhoneIcon|WhatsAppIcon|MailIcon)\b/.test(src);
  if (!usesIcons) {
    problems.push(`${file}: no PhoneIcon / WhatsAppIcon / MailIcon — the contact row is not using the shared icons`);
  }
}

console.log(`lint-contact-buttons: ${SCREENS.length} screen(s) — ${SCREENS.join(', ')}`);
console.log(`  contactBtn declared in : ${declarers.join(', ') || '(nowhere)'}`);
console.log(`  icon components used   : ${SCREENS.filter((f) => /<(PhoneIcon|WhatsAppIcon|MailIcon)\b/.test(read(f))).join(', ') || '(none)'}`);

if (problems.length) {
  console.error('\nFAIL — the candidate and student contact rows have drifted apart:');
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\nPASS — one definition, shared by every screen that draws a contact row.');

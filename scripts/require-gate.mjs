#!/usr/bin/env node
/**
 * require-gate.mjs — refuses a deploy that did not come through the gate.
 *
 * Runs FIRST in the `predeploy` hook, before bump-version, so a refused deploy
 * leaves the tree untouched: no version bump, no sw.js cache rename, nothing to
 * undo.
 *
 * WHY THIS EXISTS. On 2026-08-13 five deploy attempts failed, none of them about
 * the code, and the last two failed the SAME WAY as the first: a command block
 * containing `npm run deploy   # only if the gate is green` stayed in terminal
 * scrollback and got re-used. npm forwards trailing args to the script, so the
 * comment reached wrangler as six arguments. Worse, the run before it had already
 * skipped the gate entirely (dev server on 4321, gate looking at 4325) and gone
 * ahead and deployed anyway, because the two commands were separate lines and
 * nothing connected them.
 *
 * The lesson is not "write clearer instructions". Scrollback outlives advice, and
 * a comment cannot guard a command. Only an exit code can. So the deploy now
 * demands a token that ONLY scripts/ship.mjs sets, after the gate has actually
 * exited 0. Typing `npm run deploy` by hand — or pasting a stale block — stops
 * here with an explanation instead of shipping ungated.
 *
 * The escape hatch is deliberately awkward to type by accident:
 *   SHIP_GATE_PASSED=i-ran-the-gate-myself npm run deploy
 */
const TOKEN = process.env.SHIP_GATE_PASSED;

if (TOKEN === '1' || TOKEN === 'i-ran-the-gate-myself') {
  process.exit(0);
}

console.error(`
✗ Refusing to deploy: this did not come through the gate.

  Deploy with:   npm run ship

  That starts the dev server, runs every lint and audit cell, and deploys ONLY
  if the gate exits 0. Nothing has been changed — the version was not bumped.

  Variants:
    npm run ship -- --dry     gate, then stop before deploying
    npm run ship -- --check   prove the dev server comes up, then stop

  If you truly mean to deploy a build you gated yourself:
    SHIP_GATE_PASSED=i-ran-the-gate-myself npm run deploy
`);
process.exit(1);

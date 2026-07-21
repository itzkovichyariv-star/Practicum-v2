#!/usr/bin/env node
/**
 * 57-unified-org-list.mjs — Phase 0 data model: ONE ordered, org-keyed preference
 * list where the interview result is bound to the ORG, not to a rank slot.
 *
 *   UNI-order        buildUnifiedOrgList returns the student's orgs in rank order
 *                    (1..N), whether sourced from preferences[] or the legacy
 *                    firstChoiceOrg/second/third fields.
 *   UNI-result-follows-org   THE CORE FIX: after reorderUnifiedList moves an org, its
 *                    interviewResult travels WITH it — re-ranking never detaches
 *                    'עבר'/'לא עבר' onto the wrong org.
 *   UNI-legacy-derive   With no preferences[], the list derives from the legacy
 *                    *ChoiceOrg + *ChoiceResult fields, in that order.
 *   UNI-writeback-syncs-legacy   applyUnifiedList writes preferences[] (carrying
 *                    orgName + interviewResult) AND keeps firstChoiceOrg/second/third
 *                    + *ChoiceResult in sync (compat shim) so old readers keep working.
 *
 * Why: today a student's org choices live in TWO places — the legacy choice fields
 * AND preferences[]. The redesign (docs/design/2026-07-21-student-editor-redesign.md)
 * renders ONE re-rankable list; the result must belong to the org so re-ordering is
 * safe. This is behaviour-preserving plumbing (Phase 0) — no component uses it yet.
 *
 * Runs the REAL library (src/lib/placement.ts) through esbuild, not a replica.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Audit } from '../audit-lib.mjs';

const ROOT = '/Users/yarivitzkovich/Code/practicum-v2';
const dir = mkdtempSync(join(tmpdir(), 'unified-'));
const out = join(dir, 'placement.mjs');
await build({
  entryPoints: [join(ROOT, 'src/lib/placement.ts')],
  bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'silent',
  external: ['@supabase/supabase-js'],
});
const { buildUnifiedOrgList, reorderUnifiedList, applyUnifiedList } = await import(pathToFileURL(out).href);

const employers = [
  { id: 'e1', name: 'ארגון אלפא' },
  { id: 'e2', name: 'ארגון בטא' },
  { id: 'e3', name: 'ארגון גמא' },
];

const audit = new Audit({ name: 'unified-org-list' });

// ── 1. Ordered list from preferences[] ──────────────────────────────────────
{
  const student = {
    id: 's1', name: 'סדר',
    preferences: [
      { rank: 2, employerId: 'e2', status: 'tentative', slotId: null },
      { rank: 1, employerId: 'e1', status: 'tentative', slotId: null },
      { rank: 3, employerId: 'e3', status: 'tentative', slotId: null },
    ],
  };
  const list = buildUnifiedOrgList(student, employers);
  const names = list.map(p => p.orgName).join(' > ');
  const ranks = list.map(p => p.rank).join(',');
  audit.recordCell({
    id: 'UNI-order', tableRef: 'placement.buildUnifiedOrgList / rank order',
    expected: 'orgs returned in rank order 1..N: ארגון אלפא > ארגון בטא > ארגון גמא, ranks 1,2,3',
    observed: `order="${names}", ranks=${ranks}`,
    pass: names === 'ארגון אלפא > ארגון בטא > ארגון גמא' && ranks === '1,2,3',
    notes: names !== 'ארגון אלפא > ארגון בטא > ארגון גמא' ? 'List not in rank order.' : '',
  });
}

// ── 2. THE CORE FIX: interviewResult follows the ORG on re-rank ──────────────
{
  // אלפא passed, בטא failed, גמא pending. Re-rank so גמא is #1, בטא #2, אלפא #3.
  const student = {
    id: 's2', name: 'תוצאה נודדת',
    preferences: [
      { rank: 1, employerId: 'e1', orgName: 'ארגון אלפא', interviewResult: 'passed', status: 'under_review', slotId: 's-a' },
      { rank: 2, employerId: 'e2', orgName: 'ארגון בטא', interviewResult: 'failed', status: 'rejected', slotId: null },
      { rank: 3, employerId: 'e3', orgName: 'ארגון גמא', interviewResult: 'pending', status: 'tentative', slotId: null },
    ],
  };
  const list = buildUnifiedOrgList(student, employers);
  const reordered = reorderUnifiedList(list, ['ארגון גמא', 'ארגון בטא', 'ארגון אלפא']);
  const byName = Object.fromEntries(reordered.map(p => [p.orgName, p]));
  // Each org must keep its own result after moving to a new rank.
  const alphaKept = byName['ארגון אלפא']?.interviewResult === 'passed' && byName['ארגון אלפא']?.rank === 3;
  const betaKept = byName['ארגון בטא']?.interviewResult === 'failed' && byName['ארגון בטא']?.rank === 2;
  const gammaKept = byName['ארגון גמא']?.interviewResult === 'pending' && byName['ארגון גמא']?.rank === 1;
  const slotKept = byName['ארגון אלפא']?.slotId === 's-a'; // status/slot travel too
  audit.recordCell({
    id: 'UNI-result-follows-org', tableRef: 'placement.reorderUnifiedList / result bound to org',
    expected: "after re-rank, אלפא still 'passed' (now #3), בטא still 'failed' (#2), גמא still 'pending' (#1); slot travels",
    observed: `alpha=${byName['ארגון אלפא']?.interviewResult}@#${byName['ארגון אלפא']?.rank}(slot=${byName['ארגון אלפא']?.slotId}), beta=${byName['ארגון בטא']?.interviewResult}@#${byName['ארגון בטא']?.rank}, gamma=${byName['ארגון גמא']?.interviewResult}@#${byName['ארגון גמא']?.rank}`,
    pass: alphaKept && betaKept && gammaKept && slotKept,
    notes: !(alphaKept && betaKept && gammaKept) ? 'A result detached from its org on re-rank — the exact bug this model prevents.' : '',
  });
}

// ── 3. Derive from legacy fields when preferences[] is empty ─────────────────
{
  const student = {
    id: 's3', name: 'מדור מדור ישן',
    firstChoiceOrg: 'ארגון בטא', firstChoiceResult: 'passed',
    secondChoiceOrg: 'ארגון אלפא', secondChoiceResult: 'failed',
    thirdChoiceOrg: 'ארגון גמא', thirdChoiceResult: 'pending',
    // no preferences[]
  };
  const list = buildUnifiedOrgList(student, employers);
  const names = list.map(p => p.orgName).join(' > ');
  const results = list.map(p => `${p.orgName}:${p.interviewResult}`).join(', ');
  const resolvedIds = list.map(p => p.employerId).join(',');
  audit.recordCell({
    id: 'UNI-legacy-derive', tableRef: 'placement.buildUnifiedOrgList / legacy fallback',
    expected: 'orgs from legacy fields in order בטא>אלפא>גמא with their own results (passed/failed/pending); employerIds resolved by name',
    observed: `order="${names}", results=[${results}], ids=${resolvedIds}`,
    pass: names === 'ארגון בטא > ארגון אלפא > ארגון גמא'
      && list[0].interviewResult === 'passed' && list[1].interviewResult === 'failed' && list[2].interviewResult === 'pending'
      && resolvedIds === 'e2,e1,e3',
    notes: names !== 'ארגון בטא > ארגון אלפא > ארגון גמא' ? 'Legacy derivation lost order or results.' : '',
  });
}

// ── 4. Write-back syncs the legacy compat fields ────────────────────────────
{
  const student = { id: 's4', name: 'כתיבה חזרה', firstChoiceOrg: 'stale', firstChoiceResult: 'passed' };
  const list = [
    { rank: 1, orgName: 'ארגון גמא', employerId: 'e3', interviewResult: 'passed', status: 'under_review', slotId: 's-g' },
    { rank: 2, orgName: 'ארגון אלפא', employerId: 'e1', interviewResult: 'pending', status: 'tentative', slotId: null },
  ];
  const next = applyUnifiedList(student, list);
  const prefsOk = Array.isArray(next.preferences) && next.preferences.length === 2
    && next.preferences[0].orgName === 'ארגון גמא' && next.preferences[0].interviewResult === 'passed'
    && next.preferences[0].employerId === 'e3';
  const legacyOk = next.firstChoiceOrg === 'ארגון גמא' && next.firstChoiceResult === 'passed'
    && next.secondChoiceOrg === 'ארגון אלפא' && next.secondChoiceResult === 'pending'
    && next.thirdChoiceOrg === '' && next.thirdChoiceResult === 'pending';
  const pure = student.firstChoiceOrg === 'stale'; // did not mutate input
  audit.recordCell({
    id: 'UNI-writeback-syncs-legacy', tableRef: 'placement.applyUnifiedList / compat shim',
    expected: 'preferences[] carries orgName+interviewResult AND legacy firstChoiceOrg/second/third + *Result stay in sync; input not mutated',
    observed: `prefsOk=${prefsOk}, legacy={${next.firstChoiceOrg}/${next.firstChoiceResult}, ${next.secondChoiceOrg}/${next.secondChoiceResult}, ${next.thirdChoiceOrg || '∅'}/${next.thirdChoiceResult}}, pure=${pure}`,
    pass: prefsOk && legacyOk && pure,
    notes: !legacyOk ? 'Legacy fields not kept in sync — old readers (reports, /cv-update pre-fill) would go stale.' : '',
  });
}

rmSync(dir, { recursive: true, force: true });
// Pure-library cell: no browser. Recorded cells log to stdout; exit code is the gate signal.
const failed = audit.cells.some((c) => c.pass === false);
console.log(`\n${failed ? '❌' : '✅'} unified-org-list: ${audit.cells.filter(c => c.pass === true).length}/${audit.cells.length} pass`);
process.exit(failed ? 1 : 0);

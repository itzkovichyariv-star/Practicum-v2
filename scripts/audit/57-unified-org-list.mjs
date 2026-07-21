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

// ── 3b. UNION: a legacy org not yet built still shows as a card ──────────────
{
  // e1 is built into preferences[]; e2/e3 are only chosen in the legacy fields
  // (coordinator picked them but never pressed "build"). All three must appear.
  const student = {
    id: 's3b', name: 'איחוד',
    preferences: [{ rank: 1, employerId: 'e1', orgName: 'ארגון אלפא', interviewResult: 'passed', status: 'under_review', slotId: 's-a' }],
    secondChoiceOrg: 'ארגון בטא', secondChoiceResult: 'failed',
    thirdChoiceOrg: 'ארגון גמא', thirdChoiceResult: 'pending',
  };
  const list = buildUnifiedOrgList(student, employers);
  const names = list.map(p => p.orgName).join(' > ');
  const alphaBuilt = list[0]?.status === 'under_review' && list[0]?.slotId === 's-a';
  const betaResult = list.find(p => p.orgName === 'ארגון בטא')?.interviewResult;
  audit.recordCell({
    id: 'UNI-union', tableRef: 'placement.buildUnifiedOrgList / prefs ∪ legacy',
    expected: 'a built pref (אלפא, under_review) AND two legacy-only orgs (בטא, גמא) all appear as cards, ranks 1..3; built keeps its slot, legacy keeps its result',
    observed: `order="${names}", alphaBuilt=${alphaBuilt}, betaResult=${betaResult}, count=${list.length}`,
    pass: list.length === 3 && names === 'ארגון אלפא > ארגון בטא > ארגון גמא' && alphaBuilt && betaResult === 'failed',
    notes: list.length !== 3 ? 'A chosen-but-not-built org is hidden — the union failed, so the editor would drop it.' : '',
  });
}

// ── 3c. Dedup by EMPLOYER id: canonical pref name vs free-text legacy ────────
{
  // Old built pref carries employerId 'e1' but NO orgName; the employer's canonical
  // name ("ארגון אלפא/מטה") differs from the free-text firstChoiceOrg ("ארגון אלפא").
  // Both resolve to e1, so it must be ONE card, not a phantom duplicate.
  const emps = [{ id: 'e1', name: 'ארגון אלפא/מטה' }, { id: 'e2', name: 'ארגון בטא' }];
  const student = {
    id: 's3c', name: 'כפילות מעסיק',
    preferences: [{ rank: 1, employerId: 'e1', interviewResult: 'passed', status: 'under_review', slotId: 's-a' }],
    firstChoiceOrg: 'ארגון אלפא', firstChoiceResult: 'passed',
  };
  const list = buildUnifiedOrgList(student, emps);
  const forE1 = list.filter(p => p.employerId === 'e1');
  audit.recordCell({
    id: 'UNI-dedup-by-employer',
    tableRef: 'placement.buildUnifiedOrgList / dedup by resolved employer id',
    expected: 'a built pref and a free-text legacy choice resolving to the SAME employer collapse to ONE card',
    observed: `cards=${list.length}, cardsForE1=${forE1.length}, names=[${list.map(p => p.orgName).join(', ')}]`,
    pass: list.length === 1 && forE1.length === 1,
    notes: forE1.length > 1 ? 'Phantom duplicate — the canonical vs free-text name was not deduped by employer id.' : '',
  });
}

// ── 3d. A slot-holding pref NEVER vanishes, even with an unresolved employer ──
{
  // Employer was deleted; the pref still holds a slot (under_review). It must remain a
  // card (fallback name) so the coordinator can still mark/release it — never orphaned.
  const student = {
    id: 's3d', name: 'מקום יתום',
    preferences: [{ rank: 1, employerId: 'gone', status: 'under_review', slotId: 's-x' }],
  };
  const list = buildUnifiedOrgList(student, []);
  const held = list.find(p => p.slotId === 's-x');
  audit.recordCell({
    id: 'UNI-slot-survives',
    tableRef: 'placement.buildUnifiedOrgList / slot-holding pref never dropped',
    expected: 'a preference holding a slot survives as a card (fallback name) even when its employer no longer resolves',
    observed: `cards=${list.length}, heldPresent=${!!held}, name="${held?.orgName || ''}"`,
    pass: list.length === 1 && !!held && !!held.orgName,
    notes: !held ? 'The slot-holding preference was filtered out — its reserved place is now orphaned/unmanageable.' : '',
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

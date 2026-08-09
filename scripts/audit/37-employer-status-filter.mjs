#!/usr/bin/env node
/**
 * 37-employer-status-filter.mjs — filter the Employers list by status (רמזור).
 *
 *   FILTER-by-status   Clicking the 'בתהליך מול הארגון' status chip shows only in_process
 *                      employers; a מאושר employer drops out. 'כל הסטטוסים' restores.
 *   FILTER-two-ambers  The filter bar offers BOTH amber states as separate chips.
 *
 * Seeds one approved + one in_process temp employer, filters, asserts, cleans up.
 *
 * EXPECTATION MOVED 2026-08-09 — deliberately, not to make a red go away. The chip used to
 * read a bare 'בתהליך', which is exactly the ambiguity Yariv reported: it was read as "a
 * student is in process here" when it means "I am mid-approval with this org". It is now
 * 'בתהליך מול הארגון', beside a new 'סטודנט/ית בתהליך' chip. The BEHAVIOUR under test is
 * unchanged — only the label the cell locates, plus a new assertion that the two amber
 * states are offered separately.
 */
import { Audit, sbQuery } from '../audit-lib.mjs';

const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
async function sbPatchData(data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/practicum_data?org_id=eq.default`, {
    method: 'PATCH', headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ data }),
  });
  if (!r.ok) throw new Error(`sbPatch failed ${r.status}: ${await r.text().catch(() => '')}`);
}
const loadData = async () => (await sbQuery('practicum_data', { select: 'data' }))?.[0]?.data || {};

const audit = new Audit({ name: 'employer-status-filter' });
const ts = Date.now();
const A_ID = `audit-sf-approved-${ts}`, A_NAME = `SFמאושר ${ts}`;
const P_ID = `audit-sf-inproc-${ts}`, P_NAME = `SFבתהליך ${ts}`;

let seedOk = false, year = '';
try {
  const data = await loadData();
  const course = (data.courses || []).find(c => c?.year);
  if (!course) throw new Error('no course'); year = course.year;
  const mk = (id, name, cs) => ({ id, name, addedBy: 'admin', restrictedToStudentId: null, notes: 'audit', contactPhone: '0500000000', contactEmail: 'a@b.local', courseIds: [course.id], vacancySlots: [{ id: `${id}-s1`, courseId: course.id, status: 'available', studentId: null, prefRank: null, history: [] }], ...cs });
  const approved = mk(A_ID, A_NAME, { contactStatus: 'approved', approvalStatus: 'approved' });
  // NOT-ready (no description) so it genuinely stays בתהליך — a ready in_process org would
  // now auto-green (auto-green beats in_process) and drop out of the בתהליך filter.
  const inproc = mk(P_ID, P_NAME, { contactStatus: 'in_process', approvalStatus: 'approved', notes: '' });
  await sbPatchData({ ...data, employers: [...(data.employers || []), approved, inproc] });
  seedOk = true;
} catch (e) { console.log(`Seed failed: ${e.message.slice(0, 160)}`); }

await audit.setup();
if (!seedOk) { audit.recordCell({ id: 'FILTER-seed', expected: 'seed', observed: 'failed', pass: null }); await audit.teardown(); process.exit(0); }

await audit.page.evaluate((y) => { localStorage.setItem('practicum_v2_context', JSON.stringify({ courseId: '__all__', year: y })); localStorage.setItem('practicum_v2_page', 'employers'); }, year);
await audit.page.reload({ waitUntil: 'networkidle' });
await audit.page.waitForTimeout(1200);

const res = await audit.page.evaluate((names) => {
  const present = (name) => !![...document.querySelectorAll('li')].find(li => li.querySelector('.serif')?.textContent?.trim() === name);
  const before = { approved: present(names.A), inproc: present(names.P) };
  // The org-process filter chip, by its exact (renamed) label.
  const labels = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
  const hasStudentChip = labels.includes('סטודנט/ית בתהליך');
  const chip = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'בתהליך מול הארגון');
  if (!chip) return { error: 'no בתהליך מול הארגון chip', hasStudentChip };
  chip.click();
  return new Promise(r => setTimeout(() => {
    r({ before, hasStudentChip, afterInproc: present(names.P), afterApproved: present(names.A) });
  }, 400));
}, { A: A_NAME, P: P_NAME });

if (res.error) audit.recordCell({ id: 'FILTER-by-status', expected: 'chip filters list', observed: res.error, pass: false });
else {
  // The two amber states must be reachable separately — that separation IS the fix.
  audit.recordCell({
    id: 'FILTER-two-ambers', tableRef: 'EmployersPage statusFilter — in_review vs in_process',
    expected: 'both "סטודנט/ית בתהליך" and "בתהליך מול הארגון" chips exist',
    observed: `studentChip=${res.hasStudentChip}, orgChip=true`,
    pass: res.hasStudentChip === true,
  });
  audit.log(`FILTER: before(approved=${res.before.approved},inproc=${res.before.inproc}) → after בתהליך: inproc=${res.afterInproc}, approved=${res.afterApproved}`);
  audit.recordCell({
    id: 'FILTER-by-status', tableRef: 'EmployersPage statusFilter',
    expected: 'after clicking בתהליך: the in_process org stays, the מאושר org is filtered out',
    observed: `inprocStays=${res.afterInproc}, approvedGone=${!res.afterApproved}`,
    pass: res.afterInproc === true && res.afterApproved === false,
  });
}

try {
  const data = await loadData();
  await sbPatchData({ ...data, employers: (data.employers || []).filter(e => e.id !== A_ID && e.id !== P_ID) });
  audit.log('Cleanup: removed 2 temp employers');
} catch (e) { audit.log(`Cleanup (non-fatal): ${e.message.slice(0, 100)}`); }

await audit.teardown();
process.exit(audit.cells.some((c) => c.pass === false) ? 1 : 0);

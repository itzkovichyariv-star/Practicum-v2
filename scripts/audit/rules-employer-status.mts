/**
 * rules-employer-status.mts — the PURE half of audit cell 65.
 *
 * Runs under tsx (imports lib/orgAvailability.ts). Emits a JSON array on stdout that
 * 65-employer-status.mjs turns into audit cells. Not named `NN-*.mjs`, so the gate does
 * not pick it up as a cell of its own.
 */
import { employerStatus, STATUS_COLORS } from '../../src/lib/orgAvailability.ts';

const cells: any[] = [];
const rule = (id: string, tableRef: string, expected: any, observed: any) =>
  cells.push({ id, tableRef, expected, observed, pass: observed === expected });

const NOW = Date.parse('2026-08-09T09:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86400000).toISOString();
const CID = 'c1';
const students = [{ id: 'stu1', name: 'שובל קוממי' }, { id: 'stu2', name: 'אלה לוי' }];

const emp = (over: any = {}, slots: any[] = []) => ({
  id: 'e1', name: 'Icon Group/I digital', notes: 'תיאור ההתמחות', courseIds: [CID],
  approvalStatus: 'approved', vacancySlots: slots, ...over,
});
const slot = (status: string, studentId: string | null = null, id = 's1') => ({ id, courseId: CID, status, studentId });
const ctx = (dispatches: any[] = []) => ({ students, dispatches, now: NOW });

// ── THE BUG (Icon Group, reported 2026-08-09) ───────────────────────────────────
// contactStatus 'in_process' is Yariv's own recruiting note. A student took the only
// place, so auto-green (which needs an OPEN place) could not fire and the row fell
// through to that stale note — one pill answering two unrelated questions.
{
  const e = emp({ contactStatus: 'in_process', statusNote: 'פניתי לרנית ויש צורך' },
    [slot('under_review', 'stu1')]);
  const st = employerStatus(e, [CID], ctx([{ slotId: 's1', result: 'pending', sentAt: daysAgo(5) }]));
  rule('EMP-student-in-review-key', 'brief part 2 §fix 1 (precedence)', 'in_review', st.key);
  rule('EMP-student-in-review-label', 'brief part 2 §fix 2', 'סטודנט/ית בתהליך', st.label);
  rule('EMP-not-org-process', 'the reported bug', true, st.key !== 'in_process');
  rule('EMP-explain-names-student', 'Yariv: the explaining line matters most', true,
    st.explain.includes('שובל קוממי') && st.explain.includes('לפני 5 ימים'));
  rule('EMP-explain-names-capacity', 'brief part 2 §fix 3', true, st.explain.includes('אין מקום פנוי'));
  rule('EMP-note-preserved', 'his recruiting note is not deleted', 'פניתי לרנית ויש צורך', st.note);
}

// ── Green means "nothing open that needs action" (Yariv's ruling) ───────────────
// An org with FREE places and a student in process must still leave green.
{
  const e = emp({ id: 'e2', name: 'Manpower' },
    [slot('under_review', 'stu1', 's1'), slot('available', null, 's2'), slot('available', null, 's3')]);
  const st = employerStatus(e, [CID], ctx([{ slotId: 's1', result: 'pending', sentAt: daysAgo(3) }]));
  rule('EMP-free-places-still-amber', 'Yariv: "anyway not green"', 'in_review', st.key);
  rule('EMP-amber-not-green-colour', 'Yariv: green = no action needed', STATUS_COLORS.in_review, st.color);
  rule('EMP-availability-kept-in-sentence', 'brief part 2 §fix 3', true,
    st.explain.includes('2 מקומות פנויים'));
}

// ── The two amber states differ by WORDS, never by hue ──────────────────────────
{
  const orgProcess = employerStatus(
    emp({ id: 'e3', notes: '', contactStatus: 'in_process', statusNote: 'ממתין לאישור' }, [slot('available')]),
    [CID], ctx());
  rule('EMP-org-process-renamed', 'brief part 2 §fix 2', 'בתהליך מול הארגון', orgProcess.label);
  rule('EMP-same-amber-both', 'told apart by words, not hue',
    STATUS_COLORS.in_review, STATUS_COLORS.in_process);
  rule('EMP-org-process-says-no-student', 'brief part 2 §fix 2', true,
    orgProcess.explain.includes('אף סטודנט/ית לא בתהליך'));
}

// ── A rejection still blocks everything ────────────────────────────────────────
{
  const st = employerStatus(emp({ approvalStatus: 'rejected', contactStatus: 'in_process' },
    [slot('under_review', 'stu1')]), [CID], ctx());
  rule('EMP-rejected-wins', 'brief part 2 §fix 1', 'rejected', st.key);
}

// ── Placed students read as done, not as a live thread ─────────────────────────
{
  const st = employerStatus(emp({ id: 'e4', name: 'עיריית אריאל' }, [slot('placed', 'stu2')]), [CID], ctx());
  rule('EMP-placed-is-full', 'brief part 2 §fix 1', 'full', st.key);
  rule('EMP-placed-explain', 'Yariv: the explaining line matters most', true,
    st.explain.includes('אלה לוי') && st.explain.includes('אין פעולה נדרשת'));
}

// ── Backwards compatibility: no ctx → behaves exactly as before, plus `explain` ──
{
  const st = employerStatus(emp({ contactStatus: 'in_process', notes: '' }, [slot('available')]), [CID]);
  rule('EMP-no-ctx-unchanged', 'every existing caller keeps working', 'in_process', st.key);
  rule('EMP-no-ctx-has-explain', 'explain is always present', true, st.explain.length > 5);
}

process.stdout.write(JSON.stringify(cells));

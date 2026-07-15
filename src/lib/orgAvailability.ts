// Whether an organization may be offered to students for selection.
// Rule: it needs a description (notes) AND open places (positions defined and not
// all filled) and must not be pending/rejected.
//   Green dot = available · Purple dot = not available (see `reason`).
import { openVacancies, totalVacancies, countSlotsByStatus } from './placement';

export const ORG_PURPLE = '#9333ea';

export type OrgAvailability = {
  available: boolean;
  open: number; total: number; filled: number;
  hasDesc: boolean; isPending: boolean; isRejected: boolean;
  reason: string;
  badge: string | null;
  dotColor: string;
};

export function orgAvailability(emp: any, courseIds?: string[]): OrgAvailability {
  // Capacity from the vacancySlots ledger (single source of truth), falling back
  // to legacy positions/filledPositions when an employer has no slots yet. When a
  // `courseIds` set is given (e.g. all the courses of the SELECTED year), scope the
  // counts to only those courses' slots — so we never sum in irrelevant past years.
  let total: number, open: number;
  if (courseIds) {
    const slots = (emp?.vacancySlots || []).filter((s: any) => courseIds.includes(s.courseId));
    total = slots.length;
    open = slots.filter((s: any) => s.status === 'available').length;
  } else {
    total = totalVacancies(emp);
    open = openVacancies(emp);
  }
  const filled = Math.max(0, total - open);
  const hasDesc = !!(emp?.notes && String(emp.notes).trim());
  const isRejected = emp?.approvalStatus === 'rejected';
  const isPending = emp?.approvalStatus === 'pending';
  const available = hasDesc && total > 0 && open > 0 && !isRejected && !isPending;

  let reason: string;
  let badge: string | null = null;
  if (available) {
    reason = `זמין לסטודנטים · ${open} מקומות פנויים`;
  } else if (isRejected) {
    reason = 'נדחה'; badge = '✕ נדחה';
  } else if (isPending) {
    reason = 'ממתין לאישור'; badge = '⏳ ממתין לאישור';
  } else {
    const missing: string[] = [];
    if (!hasDesc) missing.push('תיאור');
    if (total === 0) missing.push('מקומות');
    else if (open === 0) missing.push('מקומות פנויים');
    reason = `לא זמין לסטודנטים — חסר ${missing.join(' ו')}`;
    badge = `⚠ חסר ${missing.join(' ו')}`;
  }
  return {
    available, open, total, filled, hasDesc, isPending, isRejected, reason, badge,
    dotColor: available ? 'var(--tl-green)' : ORG_PURPLE,
  };
}

// ── Employer workflow status (traffic light / רמזור) ──────────────────────────
// A single per-employer status the coordinator tracks:
//   🟢 מאושר    — DERIVED: has a description AND open places (> 0). Auto — set the
//                 per-course places and add a description and it turns green.
//   🟠 בתהליך   — contactStatus 'in_process' (reached out, no place secured yet) OR
//                 approvalStatus 'pending'. Carries a free-text statusNote.
//   ⚪ טרם פניתי — contactStatus 'not_contacted' (default for a new employer).
//   🔴 נדחה     — approvalStatus 'rejected' (contacted and ruled out / declined).
// Single source of truth for status colour — used by the dot, the pill, the legend,
// the filter chips and the editor chips so they always MATCH. Vivid (like the tasks
// app ramzor) so "available/green" is unmistakable, and consistent across all surfaces.
export const STATUS_COLORS = {
  approved: '#16a34a',       // green  — matches --tl-green; has a description + open places
  in_process: '#f59e0b',     // amber  — contacted, in negotiation
  not_contacted: '#94a3b8',  // gray   — not contacted / no capacity set
  full: '#64748b',           // slate  — has places but all are taken
  rejected: '#dc2626',       // red    — ruled out
} as const;

export type EmployerStatusKey = keyof typeof STATUS_COLORS;

export type EmployerStatus = {
  key: EmployerStatusKey;
  label: string;
  color: string;
  detail: string;    // short secondary line (e.g. "3 מקומות פנויים")
  note: string;      // free-text statusNote (shown for בתהליך)
  missing: string[]; // what's missing to turn green (תיאור / מקומות פנויים)
};

export function employerStatus(emp: any, courseIds?: string[]): EmployerStatus {
  const note = String(emp?.statusNote || '').trim();
  const av = orgAvailability(emp, courseIds);
  const missing: string[] = [];
  if (!av.hasDesc) missing.push('תיאור');
  if (av.open === 0) missing.push('מקומות פנויים');
  // Precedence: 🔴 נדחה blocks everything; then a manual 🟢 מאושר; then AUTO-GREEN once the
  // org is READY (description + open places for this course×year) — which now beats בתהליך,
  // so a ready org is never stuck orange; only then the not-yet-ready בתהליך state.
  if (emp?.approvalStatus === 'rejected') {
    return { key: 'rejected', label: 'נדחה', color: STATUS_COLORS.rejected, detail: 'לא רלוונטי', note, missing: [] };
  }
  // Explicit manual APPROVAL — the coordinator confirmed the org (מאושר). Green independent
  // of the place count (the org agreed; capacity is a separate dimension shown in detail).
  if (emp?.contactStatus === 'approved') {
    return { key: 'approved', label: 'מאושר', color: STATUS_COLORS.approved, detail: av.open > 0 ? `${av.open} מקומות פנויים` : (av.total > 0 ? 'מלא · אושר' : 'אושר — הוסף/י מקומות'), note, missing: av.open === 0 ? ['מקומות פנויים'] : [] };
  }
  // AUTO-GREEN when READY — a description AND open places in THIS (course × year) makes it
  // מאושר automatically, EVEN IF it was marked בתהליך. Yariv: בתהליך must not hold against a
  // ready org — once it qualifies it advances on its own; only 🔴 נדחה blocks it. Runs BEFORE
  // the in_process check so a ready org is never stuck orange.
  if (av.available) {
    return { key: 'approved', label: 'מאושר', color: STATUS_COLORS.approved, detail: `${av.open} מקומות פנויים`, note, missing: [] };
  }
  // Contacted but NOT yet ready (missing a description or open places for this unit), or
  // awaiting approval — stays בתהליך until it qualifies (then the auto-green above takes over).
  if (emp?.contactStatus === 'in_process' || emp?.approvalStatus === 'pending') {
    return { key: 'in_process', label: 'בתהליך', color: STATUS_COLORS.in_process, detail: note || 'בתהליך מול הארגון', note, missing };
  }
  // FULL — this (year × course) has places and they're ALL taken. Year-scoped: a
  // student belongs to one course+year and occupies exactly one vacancy, so a
  // past-year placement (e.g. שגיא in תשפ״ו) NEVER makes another year read full.
  if (av.total > 0 && av.open === 0) {
    return { key: 'full', label: 'מלא', color: STATUS_COLORS.full, detail: 'כל המקומות אוישו', note, missing: [] };
  }
  // Year-scoped and NO places defined for this year yet — needs setup, NOT "full"
  // and NOT "never contacted": the org may be active in another year.
  if (courseIds && av.total === 0) {
    return { key: 'not_contacted', label: 'טרם הוגדר לשנה', color: STATUS_COLORS.not_contacted, detail: 'הוסף/י מקומות לשנה זו', note: '', missing: av.hasDesc ? ['מקומות'] : ['תיאור', 'מקומות'] };
  }
  return { key: 'not_contacted', label: 'טרם פניתי', color: STATUS_COLORS.not_contacted, detail: '', note: '', missing };
}

// Set the workflow status on an employer, appending a dated statusHistory entry. Shared by
// the editor chips AND the list-row quick toggle so both write IDENTICALLY. Manual approved
// wins over auto-green; rejected wins over all. Pure — returns a new employer, no I/O.
export type ManualStatusKey = 'not_contacted' | 'in_process' | 'approved' | 'rejected';
export function applyEmployerStatus(emp: any, which: ManualStatusKey) {
  const statusHistory = [...((emp?.statusHistory) || []), { at: new Date().toISOString(), status: which, note: String(emp?.statusNote || '').trim() }];
  if (which === 'rejected') return { ...emp, approvalStatus: 'rejected', statusHistory };
  if (which === 'approved') return { ...emp, contactStatus: 'approved', approvalStatus: 'approved', statusHistory };
  // not_contacted / in_process: clear a prior manual approve, and lift a prior reject back to
  // a neutral approvalStatus so the org is reconsidered.
  return { ...emp, contactStatus: which, approvalStatus: emp?.approvalStatus === 'rejected' ? 'approved' : emp?.approvalStatus, statusHistory };
}

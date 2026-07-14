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

export function orgAvailability(emp: any, courseId?: string): OrgAvailability {
  // Capacity from the vacancySlots ledger (single source of truth), falling back
  // to legacy positions/filledPositions when an employer has no slots yet. When a
  // courseId is given, scope the counts to THAT course's slots (per-course view).
  const total = courseId ? countSlotsByStatus(emp, courseId).total : totalVacancies(emp);
  const open = courseId ? countSlotsByStatus(emp, courseId).available : openVacancies(emp);
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
export const STATUS_COLORS = {
  approved: '#15803d',       // green  — has a description + open places
  in_process: '#d97706',     // amber  — contacted, in negotiation
  not_contacted: '#9ca3af',  // gray   — not contacted / no capacity set
  full: '#64748b',           // slate  — has places but all are taken
  rejected: '#b91c1c',       // red    — ruled out
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

export function employerStatus(emp: any, courseId?: string): EmployerStatus {
  const note = String(emp?.statusNote || '').trim();
  const av = orgAvailability(emp, courseId);
  const missing: string[] = [];
  if (!av.hasDesc) missing.push('תיאור');
  if (av.open === 0) missing.push('מקומות פנויים');
  // Precedence: an EXPLICIT manual status (נדחה / בתהליך) wins over the auto-green,
  // so the coordinator can always set it — even for an org that already has places.
  if (emp?.approvalStatus === 'rejected') {
    return { key: 'rejected', label: 'נדחה', color: STATUS_COLORS.rejected, detail: 'לא רלוונטי', note, missing: [] };
  }
  if (emp?.contactStatus === 'in_process' || emp?.approvalStatus === 'pending') {
    return { key: 'in_process', label: 'בתהליך', color: STATUS_COLORS.in_process, detail: note || 'בתהליך מול הארגון', note, missing };
  }
  if (av.available) {
    return { key: 'approved', label: 'מאושר', color: STATUS_COLORS.approved, detail: `${av.open} מקומות פנויים`, note: '', missing: [] };
  }
  // Has capacity (slots/positions) but all are taken → FULL, not "not contacted".
  if (av.total > 0 && av.hasDesc) {
    return { key: 'full', label: 'מלא', color: STATUS_COLORS.full, detail: 'כל המקומות אוישו', note, missing: [] };
  }
  return { key: 'not_contacted', label: 'טרם פניתי', color: STATUS_COLORS.not_contacted, detail: '', note: '', missing };
}

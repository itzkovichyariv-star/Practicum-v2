// Whether an organization may be offered to students for selection.
// Rule: it needs a description (notes) AND open places (positions defined and not
// all filled) and must not be pending/rejected.
//   Green dot = available · Purple dot = not available (see `reason`).
export const ORG_PURPLE = '#9333ea';

export type OrgAvailability = {
  available: boolean;
  open: number; total: number; filled: number;
  hasDesc: boolean; isPending: boolean; isRejected: boolean;
  reason: string;
  badge: string | null;
  dotColor: string;
};

export function orgAvailability(emp: any): OrgAvailability {
  const total = Number(emp?.positions) || 0;
  const filled = Number(emp?.filledPositions) || 0;
  const open = Math.max(0, total - filled);
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

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
  // Yariv 2026-08-09: "orange is a color for in process… anyway not green. the status
  // green says that there is no action currently we need to take." So a student's live
  // process is the SAME amber as ours — the two are told apart by the words and the
  // explanation line, never by hue.
  in_review: '#f59e0b',      // amber  — a STUDENT is in process there (CV out, awaiting reply)
  in_process: '#f59e0b',     // amber  — contacted, in negotiation
  not_contacted: '#94a3b8',  // gray   — not contacted / no capacity set
  full: '#64748b',           // slate  — has places but all are taken
  rejected: '#dc2626',       // red    — ruled out
} as const;

export type EmployerStatusKey = keyof typeof STATUS_COLORS;

/** Who is sitting in this employer's places right now, scoped to the same courses. */
export type Occupant = { studentId: string; name: string; state: 'under_review' | 'placed'; days: number | null };

export type EmployerStatus = {
  key: EmployerStatusKey;
  label: string;
  color: string;
  detail: string;    // short secondary line (e.g. "3 מקומות פנויים")
  note: string;      // free-text statusNote (shown for בתהליך)
  missing: string[]; // what's missing to turn green (תיאור / מקומות פנויים)
  /** THE line. Yariv 2026-08-09: "the line that explains the status is the one that is
   *  most important." Who, what and how long — a full sentence, not a chip. */
  explain: string;
  occupants: Occupant[];
};

/** Optional live context. Without it employerStatus() behaves exactly as before plus an
 *  `explain` line, so every existing caller keeps working untouched. */
export type EmployerStatusCtx = {
  students?: any[];
  dispatches?: any[];
  now?: number;
};

function occupantsOf(emp: any, courseIds: string[] | undefined, ctx?: EmployerStatusCtx): Occupant[] {
  if (!ctx?.students?.length) return [];
  const now = ctx.now ?? Date.now();
  const slots = (emp?.vacancySlots || []).filter((s: any) =>
    (!courseIds || courseIds.includes(s.courseId)) && s.studentId &&
    (s.status === 'under_review' || s.status === 'placed'));
  return slots.map((s: any) => {
    const stu = ctx.students!.find((x: any) => x.id === s.studentId);
    const d = (ctx.dispatches || [])
      .filter((x: any) => x.slotId === s.id && x.result === 'pending')
      .sort((a: any, b: any) => String(b.sentAt).localeCompare(String(a.sentAt)))[0];
    const days = d?.sentAt ? Math.max(0, Math.floor((now - new Date(d.sentAt).getTime()) / 86400000)) : null;
    return { studentId: s.studentId, name: stu?.name || 'סטודנט/ית', state: s.status, days };
  });
}

const nameList = (o: Occupant[]) => o.map(x => x.name).join(', ');
const agoText = (d: number | null) => d === null ? '' : d === 0 ? 'היום' : d === 1 ? 'אתמול' : `לפני ${d} ימים`;

export function employerStatus(emp: any, courseIds?: string[], ctx?: EmployerStatusCtx): EmployerStatus {
  const note = String(emp?.statusNote || '').trim();
  const av = orgAvailability(emp, courseIds);
  const missing: string[] = [];
  if (!av.hasDesc) missing.push('תיאור');
  if (av.open === 0) missing.push('מקומות פנויים');

  const occupants = occupantsOf(emp, courseIds, ctx);
  const inReview = occupants.filter(o => o.state === 'under_review');
  const placedOcc = occupants.filter(o => o.state === 'placed');
  const capacityLine = av.open > 0
    ? `נותרו ${av.open} מקומות פנויים — עדיין זמין לסטודנטים נוספים.`
    : (av.total === 1 ? 'אין מקום פנוי — המקום היחיד תפוס.' : 'אין מקום פנוי — כל המקומות תפוסים.');

  // ── Precedence ────────────────────────────────────────────────────────────────
  // 🔴 נדחה blocks everything. Then a STUDENT'S live process — it is the fact that is
  // true right now, and it carries a clock, whereas contactStatus is a note that may be
  // months stale. That ordering is the actual bug fix (Yariv 2026-08-09): when a student
  // took Icon Group's last place the org fell out of auto-green (which needs an OPEN
  // place) and landed back on his own "פניתי לרנית…" recruiting note, so one pill was
  // answering two unrelated questions.
  if (emp?.approvalStatus === 'rejected') {
    return { key: 'rejected', label: 'נדחה', color: STATUS_COLORS.rejected, detail: 'לא רלוונטי', note, missing: [],
      explain: 'הארגון נדחה — לא רלוונטי לשיבוץ.', occupants };
  }

  if (inReview.length > 0) {
    const who = nameList(inReview);
    const when = inReview[0].days !== null ? ` — קו״ח נשלחו ${agoText(inReview[0].days)}, ממתין לתשובת המעסיק` : ' — ממתין לתשובת המעסיק';
    return {
      key: 'in_review',
      // No emoji in the pill: several gate cells locate it by a length-bounded text match,
      // and the marker belongs on the sentence anyway. The WORDS carry the distinction.
      label: 'סטודנט/ית בתהליך',
      color: STATUS_COLORS.in_review,
      detail: av.open > 0 ? `${av.open} מקומות פנויים · ${inReview.length} בתהליך` : 'המקום שמור — ממתין לתשובה',
      note, missing: [],
      explain: `👤 ${who} בתהליך אצלם${when}. ${capacityLine}`,
      occupants,
    };
  }

  // Explicit manual APPROVAL — the coordinator confirmed the org (מאושר). Green independent
  // of the place count (the org agreed; capacity is a separate dimension shown in detail).
  if (emp?.contactStatus === 'approved') {
    return { key: 'approved', label: 'מאושר', color: STATUS_COLORS.approved, detail: av.open > 0 ? `${av.open} מקומות פנויים` : (av.total > 0 ? 'מלא · אושר' : 'אושר — הוסף/י מקומות'), note, missing: av.open === 0 ? ['מקומות פנויים'] : [],
      explain: av.open > 0 ? `אין תהליך פתוח — ${av.open} מקומות פנויים, זמין לשיבוץ.` : 'הארגון אושר, אך אין כרגע מקום פנוי.', occupants };
  }
  // AUTO-GREEN when READY — a description AND open places in THIS (course × year) makes it
  // מאושר automatically, EVEN IF it was marked בתהליך. Yariv: בתהליך must not hold against a
  // ready org — once it qualifies it advances on its own; only 🔴 נדחה blocks it.
  if (av.available) {
    return { key: 'approved', label: 'מאושר', color: STATUS_COLORS.approved, detail: `${av.open} מקומות פנויים`, note, missing: [],
      explain: `אין תהליך פתוח — ${av.open} מקומות פנויים, זמין לשיבוץ.`, occupants };
  }
  // Contacted but NOT yet ready, or awaiting approval. Renamed from the bare "בתהליך":
  // that bareness is exactly what let it be read as a student's process.
  if (emp?.contactStatus === 'in_process' || emp?.approvalStatus === 'pending') {
    return { key: 'in_process', label: 'בתהליך מול הארגון', color: STATUS_COLORS.in_process, detail: note || 'בתהליך מול הארגון', note, missing,
      explain: `🏢 אני באמצע לסגור מולם${note ? ` — ${note}` : ''}. אף סטודנט/ית לא בתהליך אצלם.`, occupants };
  }
  // FULL — this (year × course) has places and they're ALL taken. Year-scoped.
  if (av.total > 0 && av.open === 0) {
    return { key: 'full', label: 'מלא', color: STATUS_COLORS.full, detail: 'כל המקומות אוישו', note, missing: [],
      explain: placedOcc.length
        ? `${nameList(placedOcc)} ${placedOcc.length > 1 ? 'שובצו' : 'שובץ/ה'} אצלם. כל המקומות אוישו — אין פעולה נדרשת.`
        : 'כל המקומות אוישו — אין פעולה נדרשת.', occupants };
  }
  // Year-scoped and NO places defined for this year yet — needs setup.
  if (courseIds && av.total === 0) {
    return { key: 'not_contacted', label: 'טרם הוגדר לשנה', color: STATUS_COLORS.not_contacted, detail: 'הוסף/י מקומות לשנה זו', note: '', missing: av.hasDesc ? ['מקומות'] : ['תיאור', 'מקומות'],
      explain: 'טרם הוגדרו מקומות לשנה זו — יש להוסיף מקומות כדי שהארגון יוצג לסטודנטים.', occupants };
  }
  return { key: 'not_contacted', label: 'טרם פניתי', color: STATUS_COLORS.not_contacted, detail: '', note: '', missing,
    explain: missing.length ? `טרם פניתי לארגון — חסר ${missing.join(' ו')}.` : 'טרם פניתי לארגון.', occupants };
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

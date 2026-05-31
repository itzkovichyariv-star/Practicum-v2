/**
 * Placement extension — helper utilities.
 * Handles migration, template rendering, URL builders, and availability logic.
 */

import type {
  PracticumData,
  PlacementSettings,
  Employer,
  Course,
  Student,
  StudentPreference,
  VacancySlot,
} from './supabase';

// ── Default Hebrew templates ──────────────────────────────────────────────────

const DEFAULT_WHATSAPP = `שלום {contactName},
מצורף קישור לקורות חיים של {studentName} עבור התפקיד {positionTitle} במסגרת {courseName}.
קישור לקו"ח: {cvLink}
אשמח לתאם ראיון בנוחיותכם.
תודה,
{adminName}`;

const DEFAULT_EMAIL_SUBJECT = `מועמדות {studentName} ל-{positionTitle}`;

const DEFAULT_EMAIL_BODY = `שלום {contactName},
מצורף קישור לקורות חיים של {studentName} עבור התפקיד {positionTitle} במסגרת קורס {courseName} באוניברסיטת אריאל.
קישור לקו"ח: {cvLink}
אשמח לתאם ראיון בנוחיותכם.
תודה,
{adminName}`;

const DEFAULT_WHATSAPP_WITHDRAWAL = `שלום {contactName},
ברצוננו לעדכן כי {studentName} שובץ/ה לתפקיד אחר, ועל כן אנו מבטלים את המועמדות לתפקיד {positionTitle}.
תודה רבה על זמנכם ועל שיתוף הפעולה.
{adminName}`;

const DEFAULT_EMAIL_WITHDRAWAL_SUBJECT = `ביטול מועמדות — {studentName}`;

const DEFAULT_EMAIL_WITHDRAWAL_BODY = `שלום {contactName},
ברצוננו לעדכן כי {studentName} שובץ/ה לתפקיד אחר במסגרת קורס {courseName}, ועל כן אנו מבטלים את המועמדות לתפקיד {positionTitle}.
תודה רבה על זמנכם ועל שיתוף הפעולה.
{adminName}`;

const DEFAULT_STUDENT_NOTIFY_APPROVED_WHATSAPP = `שלום {studentName},
הצעת המעסיק "{employerName}" אושרה ({scope}).
ניתן לבחור אותה כהעדפה בטופס שלך.
{adminName}`;

const DEFAULT_STUDENT_NOTIFY_APPROVED_EMAIL_SUBJECT = `הצעת המעסיק "{employerName}" אושרה`;

const DEFAULT_STUDENT_NOTIFY_APPROVED_EMAIL_BODY = `שלום {studentName},
הצעת המעסיק שהגשת ("{employerName}") אושרה — {scope}.
ניתן כעת לבחור אותה כהעדפה בטופס שלך במערכת.
בהצלחה,
{adminName}`;

const DEFAULT_STUDENT_NOTIFY_REJECTED_WHATSAPP = `שלום {studentName},
לאחר בחינה, הצעת המעסיק "{employerName}" לא אושרה השלב הזה.
פתחנו לך את שורת ההעדפה הרלוונטית כדי שתבחר/י מעסיק אחר מתוך הרשימה.
{adminName}`;

const DEFAULT_STUDENT_NOTIFY_REJECTED_EMAIL_SUBJECT = `עדכון בנוגע להצעת המעסיק "{employerName}"`;

const DEFAULT_STUDENT_NOTIFY_REJECTED_EMAIL_BODY = `שלום {studentName},
לאחר בחינה, הצעת המעסיק שהגשת ("{employerName}") לא אושרה השלב הזה.
פתחנו לך את שורת ההעדפה הרלוונטית כדי שתוכל/י לבחור מעסיק אחר מתוך הרשימה.
אשמח להסביר בפגישה אם תרצה/י.
בברכה,
{adminName}`;

// ── Default settings factory ──────────────────────────────────────────────────

export function getDefaultPlacementSettings(): PlacementSettings {
  return {
    defaultPreferenceCount: 3,
    defaultAgingThresholdDays: 14,
    whatsappTemplate: DEFAULT_WHATSAPP,
    emailSubjectTemplate: DEFAULT_EMAIL_SUBJECT,
    emailBodyTemplate: DEFAULT_EMAIL_BODY,
    whatsappWithdrawalTemplate: DEFAULT_WHATSAPP_WITHDRAWAL,
    emailWithdrawalSubjectTemplate: DEFAULT_EMAIL_WITHDRAWAL_SUBJECT,
    emailWithdrawalBodyTemplate: DEFAULT_EMAIL_WITHDRAWAL_BODY,
    studentNotifyApprovedTemplateWhatsApp: DEFAULT_STUDENT_NOTIFY_APPROVED_WHATSAPP,
    studentNotifyApprovedTemplateEmailSubject: DEFAULT_STUDENT_NOTIFY_APPROVED_EMAIL_SUBJECT,
    studentNotifyApprovedTemplateEmailBody: DEFAULT_STUDENT_NOTIFY_APPROVED_EMAIL_BODY,
    studentNotifyRejectedTemplateWhatsApp: DEFAULT_STUDENT_NOTIFY_REJECTED_WHATSAPP,
    studentNotifyRejectedTemplateEmailSubject: DEFAULT_STUDENT_NOTIFY_REJECTED_EMAIL_SUBJECT,
    studentNotifyRejectedTemplateEmailBody: DEFAULT_STUDENT_NOTIFY_REJECTED_EMAIL_BODY,
  };
}

// ── In-memory migration (idempotent) ─────────────────────────────────────────

export function migratePlacementData(data: PracticumData): PracticumData {
  const now = new Date().toISOString();
  let changed = false;

  // Deep clone to avoid mutating the original
  const d: PracticumData = JSON.parse(JSON.stringify(data));

  // Determine a default course to attach things to
  const courses = d.courses || [];
  const defaultCourseId = courses[0]?.id || '';

  // 1. Extend courses — add type based on name heuristic
  if (d.courses) {
    d.courses = d.courses.map(c => {
      const patched: typeof c = { ...c };
      if (!patched.type) {
        patched.type = patched.name.includes('פרקטיקום') ? 'practicum' : 'other';
        changed = true;
      }
      return patched;
    });
  }

  // 2. Extend employers
  if (d.employers) {
    d.employers = d.employers.map(emp => {
      const e = { ...emp };

      if (e.approvalStatus === undefined) {
        (e as any).approvalStatus = 'approved';
        changed = true;
      }
      if (e.addedBy === undefined) {
        (e as any).addedBy = 'admin';
        changed = true;
      }
      if ((e as any).restrictedToStudentId === undefined) {
        (e as any).restrictedToStudentId = null;
        changed = true;
      }

      // Build vacancySlots if missing
      if (!e.vacancySlots || e.vacancySlots.length === 0) {
        const total = (e as any).positionsTotal ?? (Number(e.positions) || 1);
        if (!(e as any).positionsTotal) {
          (e as any).positionsTotal = total;
        }
        const courseId = (e.courseIds && e.courseIds[0]) || defaultCourseId;
        (e as any).vacancySlots = Array.from({ length: total }, (_, i) => ({
          id: `${e.id}-s${i + 1}`,
          courseId,
          status: 'available' as const,
          studentId: null,
          prefRank: null,
          history: [{
            at: now,
            from: null,
            to: 'available' as const,
            by: 'system' as const,
            actorId: 'migration',
          }],
        }));
        changed = true;
      } else if (!(e as any).positionsTotal) {
        (e as any).positionsTotal = e.vacancySlots.length;
        changed = true;
      }

      return e;
    });
  }

  // 3. Extend students
  if (d.students) {
    // For backfilling the submitted application form onto already-converted
    // students whose linked candidate still carries the questionnaire.
    const candById = new Map((d.candidates || []).map(c => [c.id, c] as const));
    d.students = d.students.map(s => {
      const st = { ...s };

      // Carry the application form (questionnaire) from the linked candidate if
      // this student was converted before it was wired through, so the original
      // submitted form travels with the person.
      if ((st as any).questionnaire == null && (st as any).fromCandidateId) {
        const cand = candById.get((st as any).fromCandidateId);
        if (cand?.questionnaire) { (st as any).questionnaire = cand.questionnaire; changed = true; }
      }

      if (st.submissionStatus === undefined) {
        (st as any).submissionStatus = st.cvUrl ? 'submitted' : 'not_submitted';
        changed = true;
      }
      if (st.submittedAt === undefined) {
        (st as any).submittedAt = null;
        changed = true;
      }
      if ((st as any).cvShareUrl === undefined) {
        (st as any).cvShareUrl = null;
        changed = true;
      }

      // Migrate old string preferences → legacyPreferences
      const rawPrefs = (st as any).preferences;
      if (!Array.isArray(rawPrefs) || (rawPrefs.length > 0 && typeof rawPrefs[0] === 'string')) {
        (st as any).legacyPreferences = Array.isArray(rawPrefs) ? rawPrefs.slice() : ((st as any).legacyPreferences || []);
        (st as any).preferences = [];
        changed = true;
      } else if (rawPrefs === undefined || rawPrefs === null) {
        (st as any).preferences = [];
        changed = true;
      }

      if (!(st as any).legacyPreferences) {
        // Preserve firstChoiceOrg etc. as legacy strings
        const legacy: string[] = [];
        if ((st as any).firstChoiceOrg) legacy.push((st as any).firstChoiceOrg);
        if ((st as any).secondChoiceOrg) legacy.push((st as any).secondChoiceOrg);
        (st as any).legacyPreferences = legacy;
        changed = true;
      }

      return st;
    });
  }

  // 4. Initialize new top-level arrays
  if (!d.dispatches) {
    d.dispatches = [];
    changed = true;
  }
  if (!d.employerApprovalRequests) {
    d.employerApprovalRequests = [];
    changed = true;
  }
  if (!d.placementSettings) {
    d.placementSettings = getDefaultPlacementSettings();
    changed = true;
  } else {
    // Ensure all keys exist (additive)
    const defaults = getDefaultPlacementSettings();
    const ps = d.placementSettings as any;
    let settingsChanged = false;
    for (const [k, v] of Object.entries(defaults)) {
      if (ps[k] === undefined) {
        ps[k] = v;
        settingsChanged = true;
      }
    }
    if (settingsChanged) changed = true;
  }

  // 5. Reconcile legacy `acceptedOrg` placements into the vacancySlots ledger
  //    (idempotent). Until now, marking a student placed via acceptedOrg bumped
  //    `filledPositions` but never occupied a slot, so the slot ledger (now the
  //    single source of truth for "open places") over-reported availability for
  //    orgs that already have placed students. For each placed student, occupy
  //    one available slot at their org. Then mirror the legacy counters.
  if (d.students && d.employers) {
    const byName = new Map(d.employers.filter(e => e?.name).map(e => [e.name, e]));
    for (const st of d.students) {
      const orgName = (st as any).acceptedOrg;
      if (!orgName) continue;
      const emp: any = byName.get(orgName);
      if (!emp) continue;
      const slots: any[] = (emp.vacancySlots = emp.vacancySlots || []);
      if (slots.some(s => s.studentId === st.id)) continue; // already reflected
      const slot = slots.find(s => s.status === 'available');
      if (!slot) continue; // org at/over capacity — open stays 0, which is correct
      slot.status = 'placed';
      slot.studentId = st.id;
      slot.prefRank = slot.prefRank ?? null;
      slot.history = [...(slot.history || []), { at: now, from: 'available', to: 'placed', by: 'system', actorId: 'migrate-acceptedOrg' }];
      changed = true;
    }
    const mirrored = d.employers.map(e => reconcileEmployerCapacity(e as Employer));
    if (JSON.stringify(mirrored) !== JSON.stringify(d.employers)) { d.employers = mirrored as any; changed = true; }
  }

  return changed ? d : data;
}

// ── Template rendering ────────────────────────────────────────────────────────

export function renderTemplate(
  template: string,
  ctx: Partial<Record<string, string>>,
): string {
  return template
    .replaceAll('{contactName}', ctx.contactName ?? '')
    .replaceAll('{studentName}', ctx.studentName ?? '')
    .replaceAll('{positionTitle}', ctx.positionTitle ?? '')
    .replaceAll('{adminName}', ctx.adminName ?? '')
    .replaceAll('{courseName}', ctx.courseName ?? '')
    .replaceAll('{cvLink}', ctx.cvLink ?? '')
    .replaceAll('{employerName}', ctx.employerName ?? '')
    .replaceAll('{scope}', ctx.scope ?? '');
}

// ── Channel URL builders ──────────────────────────────────────────────────────

export function buildWhatsAppUrl(rawPhone: string, message: string): string {
  let intl = rawPhone.replace(/[^\d]/g, '');
  if (intl.startsWith('0')) intl = '972' + intl.slice(1);
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

export function buildMailtoUrl(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ── Build placement preferences from a candidate's chosen org names ───────────
//
// The bridge between the candidate's free-text org choices (org_pref_1/2/3 /
// firstChoiceOrg strings) and the structured StudentPreference[] that
// PlacementPanel needs to dispatch a CV to an employer. For each org name, in
// order, it: resolves the name → an Employer, reserves an available VacancySlot
// (generating slots from positionsTotal if the employer has none yet), and
// pushes a tentative StudentPreference. Orgs that can't be matched or have no
// open slot are returned in `unresolved` so the admin can swap them.
//
// Pure: inputs are never mutated; returns fresh student + employers arrays.
export function buildPlacementPreferences(
  student: Student,
  orderedOrgNames: string[],
  employers: Employer[],
  opts: { actorId: string; now?: string },
): {
  updatedStudent: Student;
  updatedEmployers: Employer[];
  built: Array<{ rank: number; orgName: string; employerId: string }>;
  unresolved: Array<{ orgName: string; reason: string }>;
} {
  const now = opts.now || new Date().toISOString();
  const emps: Employer[] = employers.map(e => ({ ...e }));
  const prefs: StudentPreference[] = [];
  const built: Array<{ rank: number; orgName: string; employerId: string }> = [];
  const unresolved: Array<{ orgName: string; reason: string }> = [];
  const usedEmployerIds = new Set<string>();

  for (const rawName of orderedOrgNames) {
    const orgName = (rawName || '').trim();
    if (!orgName) continue;

    const empIdx = emps.findIndex(e => (e.name || '').trim().toLowerCase() === orgName.toLowerCase());
    if (empIdx < 0) { unresolved.push({ orgName, reason: 'לא נמצא ברשימת הארגונים' }); continue; }

    const emp = emps[empIdx];
    if (usedEmployerIds.has(emp.id)) continue; // candidate listed the same org twice — keep one

    const approval = (emp as any).approvalStatus ?? 'approved';
    if (approval === 'rejected') { unresolved.push({ orgName, reason: 'הארגון נדחה' }); continue; }
    const restricted = (emp as any).restrictedToStudentId;
    if (restricted && restricted !== student.id) { unresolved.push({ orgName, reason: 'הארגון פרטי למועמד/ת אחר/ת' }); continue; }

    // Ensure the employer has slots (lazily generate from positionsTotal).
    let slots: VacancySlot[] = ((emp as any).vacancySlots || []).map((s: any) => ({ ...s }));
    if (slots.length === 0) {
      const total = Math.max(1, Number((emp as any).positionsTotal ?? emp.positions ?? 1) || 1);
      const courseId = (emp.courseIds && emp.courseIds[0]) || student.courseId || '';
      slots = Array.from({ length: total }, (_, i) => ({
        id: `${emp.id}-s${i + 1}`, courseId, status: 'available', studentId: null, prefRank: null,
        history: [{ at: now, from: null, to: 'available', by: 'system', actorId: opts.actorId }],
      }));
    }

    // Reuse a slot already held by this student here, else take an available one.
    let slot = slots.find(s => s.studentId === student.id && (s.status === 'tentative' || s.status === 'under_review' || s.status === 'placed'))
      || slots.find(s => s.status === 'available');
    if (!slot) { unresolved.push({ orgName, reason: 'אין מקום פנוי' }); continue; }

    const rank = built.length + 1;
    if (slot.status === 'available') {
      slot.status = 'tentative';
      slot.studentId = student.id;
      slot.prefRank = rank;
      slot.history = [...(slot.history || []), { at: now, from: 'available', to: 'tentative', by: 'admin', actorId: opts.actorId }];
    } else {
      slot.prefRank = rank;
    }
    (emp as any).vacancySlots = slots;
    if ((emp as any).positionsTotal == null) (emp as any).positionsTotal = slots.length;

    usedEmployerIds.add(emp.id);
    prefs.push({ rank, employerId: emp.id, slotId: slot.id, status: 'tentative' });
    built.push({ rank, orgName: emp.name, employerId: emp.id });
  }

  const updatedStudent: Student = {
    ...student,
    preferences: prefs,
    // Mark "submitted" so the placement workflow is active (never downgrade a placed student).
    submissionStatus: student.submissionStatus === 'placed' ? 'placed' : (prefs.length ? 'submitted' : student.submissionStatus),
  };
  // Mirror the slot ledger into legacy capacity fields for the employers we touched.
  const updatedEmployers = emps.map(e => usedEmployerIds.has(e.id) ? reconcileEmployerCapacity(e) : e);
  return { updatedStudent, updatedEmployers, built, unresolved };
}

// ── Add a single ad-hoc placement (employer outside the candidate's list) ─────
//
// Appends ONE employer to the student's dispatch list, reserving a vacancy slot,
// WITHOUT touching existing preferences (so already-dispatched rows keep their
// status). Used for "send a CV to an employer the candidate didn't choose — and
// still occupy one of that employer's vacancies".
export function addPlacementPreference(
  student: Student,
  employer: Employer,
  employers: Employer[],
  opts: { actorId: string; now?: string },
): { updatedStudent: Student; updatedEmployers: Employer[]; ok: boolean; reason?: string } {
  const now = opts.now || new Date().toISOString();
  const prefs = student.preferences || [];
  if (prefs.some(p => p.employerId === employer.id)) {
    return { updatedStudent: student, updatedEmployers: employers, ok: false, reason: 'הארגון כבר ברשימת השליחה' };
  }
  const emps: Employer[] = employers.map(e => ({ ...e }));
  const idx = emps.findIndex(e => e.id === employer.id);
  if (idx < 0) return { updatedStudent: student, updatedEmployers: employers, ok: false, reason: 'הארגון לא נמצא ברשימה' };
  const emp = emps[idx];

  let slots: VacancySlot[] = ((emp as any).vacancySlots || []).map((s: any) => ({ ...s }));
  if (slots.length === 0) {
    const total = Math.max(1, Number((emp as any).positionsTotal ?? emp.positions ?? 1) || 1);
    const courseId = (emp.courseIds && emp.courseIds[0]) || student.courseId || '';
    slots = Array.from({ length: total }, (_, i) => ({
      id: `${emp.id}-s${i + 1}`, courseId, status: 'available', studentId: null, prefRank: null,
      history: [{ at: now, from: null, to: 'available', by: 'system', actorId: opts.actorId }],
    }));
  }
  const slot = slots.find(s => s.studentId === student.id && (s.status === 'tentative' || s.status === 'under_review' || s.status === 'placed'))
    || slots.find(s => s.status === 'available');
  if (!slot) return { updatedStudent: student, updatedEmployers: employers, ok: false, reason: 'אין מקום פנוי בארגון' };

  const rank = prefs.reduce((m, p) => Math.max(m, p.rank), 0) + 1;
  if (slot.status === 'available') {
    slot.status = 'tentative';
    slot.studentId = student.id;
    slot.prefRank = rank;
    slot.history = [...(slot.history || []), { at: now, from: 'available', to: 'tentative', by: 'admin', actorId: opts.actorId }];
  }
  (emp as any).vacancySlots = slots;
  emps[idx] = reconcileEmployerCapacity(emp);

  const updatedStudent: Student = {
    ...student,
    preferences: [...prefs, { rank, employerId: emp.id, slotId: slot.id, status: 'tentative' }],
    submissionStatus: student.submissionStatus === 'placed' ? 'placed' : 'submitted',
  };
  return { updatedStudent, updatedEmployers: emps, ok: true };
}

// ── Occupy a slot when a student's final org is recorded (acceptedOrg) ────────
//
// Keeps the slot ledger the single source of truth: setting "ארגון מאכסן בפועל"
// occupies one vacancy at that org (→ placed), instead of the old bare
// filledPositions++. Idempotent — if the student already holds a slot there it
// just ensures it's marked placed. Returns a fresh employers array.
export function occupyAcceptedOrgSlot(
  student: Student,
  employers: Employer[],
  opts: { actorId: string; now?: string },
): Employer[] {
  const orgName = ((student as any).acceptedOrg || '').trim();
  if (!orgName) return employers;
  const now = opts.now || new Date().toISOString();
  const emps = employers.map(e => ({ ...e }));
  const idx = emps.findIndex(e => (e.name || '').trim().toLowerCase() === orgName.toLowerCase());
  if (idx < 0) return employers;
  const emp: any = emps[idx];

  let slots: VacancySlot[] = (emp.vacancySlots || []).map((s: any) => ({ ...s }));
  const held = slots.find(s => s.studentId === student.id);
  if (held) {
    if (held.status !== 'placed') {
      held.history = [...(held.history || []), { at: now, from: held.status, to: 'placed', by: 'admin', actorId: opts.actorId }];
      held.status = 'placed';
    }
    emp.vacancySlots = slots;
    emps[idx] = reconcileEmployerCapacity(emp);
    return emps;
  }
  if (slots.length === 0) {
    const total = Math.max(1, Number(emp.positionsTotal ?? emp.positions ?? 1) || 1);
    const courseId = (emp.courseIds && emp.courseIds[0]) || student.courseId || '';
    slots = Array.from({ length: total }, (_, i) => ({
      id: `${emp.id}-s${i + 1}`, courseId, status: 'available', studentId: null, prefRank: null,
      history: [{ at: now, from: null, to: 'available', by: 'system', actorId: opts.actorId }],
    }));
  }
  const slot = slots.find(s => s.status === 'available');
  if (slot) {
    slot.status = 'placed';
    slot.studentId = student.id;
    slot.history = [...(slot.history || []), { at: now, from: 'available', to: 'placed', by: 'admin', actorId: opts.actorId }];
  }
  // No available slot → org is full; acceptedOrg still recorded, open stays 0.
  emp.vacancySlots = slots;
  emps[idx] = reconcileEmployerCapacity(emp);
  return emps;
}

// ── Availability logic ────────────────────────────────────────────────────────

/**
 * Returns employers attached to courseId that are visible and have available capacity
 * for the given student (or any student if currentStudentId not provided).
 */
export function getAvailableEmployersForCourse(
  courseId: string,
  employers: Employer[],
  currentStudentId?: string,
): Employer[] {
  return employers.filter(emp => {
    // Must be attached to this course
    const cids: string[] = (emp as any).courseIds || ((emp as any).courseId ? [(emp as any).courseId] : []);
    if (!cids.includes(courseId)) return false;

    // Approval check
    const approvalStatus = (emp as any).approvalStatus ?? 'approved';
    if (approvalStatus === 'rejected') return false;
    if (approvalStatus === 'pending') {
      // Only visible to the student who suggested it
      const restricted = (emp as any).restrictedToStudentId;
      if (!restricted || restricted !== currentStudentId) return false;
    }
    if (approvalStatus === 'approved') {
      // If restricted, only visible to that student
      const restricted = (emp as any).restrictedToStudentId;
      if (restricted && restricted !== currentStudentId) return false;
    }

    // Must have at least one available slot OR a slot held by this student
    const slots: any[] = (emp as any).vacancySlots || [];
    const courseSlots = slots.filter((sl: any) => sl.courseId === courseId);
    const hasCapacity = courseSlots.some((sl: any) => {
      if (sl.status === 'available') return true;
      if (currentStudentId && sl.studentId === currentStudentId && sl.status === 'tentative') return true;
      return false;
    });

    return hasCapacity;
  });
}

// ── Single source of truth for "open places" ─────────────────────────────────
//
// vacancySlots is the capacity ledger. openVacancies = available slots; when an
// employer has no slots yet (not migrated), fall back to positions/filledPositions.
// reconcileEmployerCapacity mirrors the slot ledger back into the legacy
// positions/positionsTotal/filledPositions fields so older readers stay correct.
export function totalVacancies(emp: any): number {
  const slots = emp?.vacancySlots || [];
  if (slots.length) return slots.length;
  return Math.max(0, Number(emp?.positionsTotal ?? emp?.positions ?? 0) || 0);
}

export function openVacancies(emp: any): number {
  const slots = emp?.vacancySlots || [];
  if (slots.length) return slots.filter((s: any) => s?.status === 'available').length;
  const total = Number(emp?.positionsTotal ?? emp?.positions ?? 0) || 0;
  const filled = Number(emp?.filledPositions ?? 0) || 0;
  return Math.max(0, total - filled);
}

export function reconcileEmployerCapacity<T extends Employer>(emp: T): T {
  const slots = (emp as any)?.vacancySlots || [];
  if (!slots.length) return emp; // nothing to mirror from
  const occupied = slots.filter((s: any) => s?.status !== 'available').length;
  return {
    ...emp,
    positionsTotal: slots.length,
    positions: slots.length,
    filledPositions: occupied,
  } as T;
}

/**
 * Count vacancy slot statuses for an employer (optionally filtered by courseId).
 */
export function countSlotsByStatus(
  emp: Employer,
  courseId?: string,
): { total: number; available: number; tentative: number; under_review: number; placed: number } {
  const slots: any[] = (emp as any).vacancySlots || [];
  const filtered = courseId ? slots.filter((s: any) => s.courseId === courseId) : slots;
  return {
    total: filtered.length,
    available: filtered.filter((s: any) => s.status === 'available').length,
    tentative: filtered.filter((s: any) => s.status === 'tentative').length,
    under_review: filtered.filter((s: any) => s.status === 'under_review').length,
    placed: filtered.filter((s: any) => s.status === 'placed').length,
  };
}

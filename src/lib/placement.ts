/**
 * Placement extension — helper utilities.
 * Handles migration, template rendering, URL builders, and availability logic.
 */

import type {
  PracticumData,
  PlacementSettings,
  Employer,
  Course,
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
    d.students = d.students.map(s => {
      const st = { ...s };

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

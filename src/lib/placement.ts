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
לתשובה מהירה (הזמנה לראיון / לא מתאים): {responseLink}
{contactBack}
תודה,
{adminName}`;

const DEFAULT_EMAIL_SUBJECT = `מועמדות {studentName} ל-{positionTitle}`;

// The one line that carries the employer's answer link, per template. Used both by the
// defaults above and by the migration in normalizeData() that repairs templates saved
// before the link existed — so the two can never drift apart.
const RESPONSE_LINK_LINES: Record<string, string> = {
  whatsappTemplate: 'לתשובה מהירה (הזמנה לראיון / לא מתאים): {responseLink}',
  emailBodyTemplate: 'לתשובה מהירה (הזמנה לראיון / לא מתאים): {responseLink}',
  reminderWhatsappTemplate: 'לתשובה בלחיצה אחת: {responseLink}',
  reminderEmailBodyTemplate: 'לתשובה בלחיצה אחת: {responseLink}',
};

/** The line that offers a human route back, per template.
 *
 *  Yariv 2026-08-26, after an employer's one-click link failed: "ואמירה בהודעה שאפשר
 *  לחזור אלי גם בטלפון או במייל או בווטסאפ". A link is a single point of failure —
 *  it can be stripped by a mail client, mangled by line-wrap, or point at a dispatch
 *  that was never confirmed — and when it fails the employer currently has nowhere
 *  to go. This line means a broken link costs a phone call, not a lost placement. */
const CONTACT_BACK_LINES: Record<string, string> = {
  whatsappTemplate: '{contactBack}',
  emailBodyTemplate: '{contactBack}',
  reminderWhatsappTemplate: '{contactBack}',
  reminderEmailBodyTemplate: '{contactBack}',
};

/** Render the coordinator's contact details as one sentence, or '' when none are
 *  configured — an empty line is better than "reach me at: ". */
export function contactBackSentence(settings: any): string {
  const phone = String(settings?.coordinatorPhone || '').trim();
  const email = String(settings?.coordinatorEmail || '').trim();
  const wa = String(settings?.coordinatorWhatsapp || settings?.coordinatorPhone || '').trim();

  // One number, said once. The WhatsApp field defaults to the phone — which is the
  // common case, since almost nobody has a separate one — and printing both produced
  // "בטלפון 052… · בוואטסאפ 052…" to every employer: the same digits twice in a row,
  // which reads like a mistake because it is one. Only a genuinely DIFFERENT number
  // earns a second mention.
  const digits = (v: string) => v.replace(/\D/g, '');
  const sameNumber = !!phone && !!wa && digits(phone) === digits(wa);

  const parts: string[] = [];
  if (sameNumber) parts.push(`בטלפון או בוואטסאפ ${phone}`);
  else {
    if (phone) parts.push(`בטלפון ${phone}`);
    if (wa) parts.push(`בוואטסאפ ${wa}`);
  }
  if (email) parts.push(`במייל ${email}`);
  if (!parts.length) return '';
  return `אם הקישור לא נפתח — אפשר פשוט לחזור אליי ${parts.join(' · ')}.`;
}

// ── Reminder after silence ────────────────────────────────────────────────────
// Sent when an employer has not responded. Deliberately short and un-pushy: it
// re-states who and what, and offers the easy exit ("if it is not relevant, tell us")
// so a non-answer becomes an answer. {daysWaiting} is filled by the caller.
const DEFAULT_REMINDER_WHATSAPP = `שלום {contactName},
רק מזכיר בעדינות — שלחנו אליכם את קורות החיים של {studentName} לפני {daysWaiting} ימים.
קישור לקו"ח: {cvLink}
לתשובה בלחיצה אחת: {responseLink}
גם "לא מתאים" עוזר לנו להתקדם.
{contactBack}
תודה,
{adminName}`;

const DEFAULT_REMINDER_EMAIL_SUBJECT = `תזכורת — מועמדות {studentName} ל{positionTitle}`;

const DEFAULT_REMINDER_EMAIL_BODY = `שלום {contactName},
רק מזכיר בעדינות — שלחנו אליכם את קורות החיים של {studentName} לפני {daysWaiting} ימים, במסגרת {courseName}.
קישור לקו"ח: {cvLink}
לתשובה בלחיצה אחת: {responseLink}
גם תשובה שלילית עוזרת לנו להתקדם עם הסטודנט/ית.
{contactBack}
תודה רבה,
{adminName}`;

const DEFAULT_EMAIL_BODY = `שלום {contactName},
מצורף קישור לקורות חיים של {studentName} עבור התפקיד {positionTitle} במסגרת קורס {courseName} באוניברסיטת אריאל.
קישור לקו"ח: {cvLink}
לתשובה מהירה (הזמנה לראיון / לא מתאים): {responseLink}
{contactBack}
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
    reminderWhatsappTemplate: DEFAULT_REMINDER_WHATSAPP,
    reminderEmailSubjectTemplate: DEFAULT_REMINDER_EMAIL_SUBJECT,
    reminderEmailBodyTemplate: DEFAULT_REMINDER_EMAIL_BODY,
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

    // The four send templates were persisted before {responseLink} existed, and the
    // additive pass above only fills keys that are *missing* — so a saved template
    // would keep its old text for ever and the employer would never receive the
    // answer link. That would leave the response page reachable but never reached.
    //
    // Insert the line rather than overwrite the template: the wording may have been
    // edited by hand, and only the missing line is ours to add. It goes above the
    // closing "תודה" so it reads as part of the ask, not after the signature.
    for (const [key, line] of Object.entries(RESPONSE_LINK_LINES)) {
      const tpl = ps[key];
      if (typeof tpl !== 'string' || !tpl.trim() || tpl.includes('{responseLink}')) continue;
      const lines = tpl.split('\n');
      const at = lines.findIndex((l: string) => /^\s*תודה/.test(l));
      lines.splice(at === -1 ? lines.length : at, 0, line);
      ps[key] = lines.join('\n');
      changed = true;
    }

    // Same treatment for the human route back, and for the same reason: a template
    // saved before this existed would otherwise offer the employer a link and nothing
    // else. Placeholder rather than literal text, so the details stay editable in
    // settings and one edit reaches every template.
    for (const [key, line] of Object.entries(CONTACT_BACK_LINES)) {
      const tpl = ps[key];
      if (typeof tpl !== 'string' || !tpl.trim() || tpl.includes('{contactBack}')) continue;
      const lines = tpl.split('\n');
      const at = lines.findIndex((l: string) => /^\s*תודה/.test(l));
      lines.splice(at === -1 ? lines.length : at, 0, line);
      ps[key] = lines.join('\n');
      changed = true;
    }
  }

  // Yariv 2026-08-26: "צריך להילקח משם" — do not ask for what the system already has.
  // coordinatorEmail (Rachel) and supervisorEmail (Yariv) have lived at the top level of
  // the data since long before this line existed, and the settings screen already edits
  // them. Seeded here rather than inside the branch above, because the branch that
  // BUILDS fresh defaults carries no address either — that is where a brand-new
  // practicum lands, and it is exactly the case that must not need typing twice.
  // A value typed into placement settings still wins if one is ever set.
  //
  // SUPERVISOR FIRST, and that order matters. Yariv 2026-08-26: "אין רכז פרקטיקום פעיל
  // ואני יכול להיות זמין עם המייל שלי". coordinatorEmail is the role that is currently
  // vacant; supervisorEmail is him. Preferring the coordinator would have told every
  // employer to chase a person who is not there — a dead end printed in every message,
  // which is worse than the broken link this line exists to survive.
  {
    const ps2 = d.placementSettings as any;
    const knownEmail = String((d as any)?.supervisorEmail || (d as any)?.coordinatorEmail || '').trim();
    if (ps2 && knownEmail && !String(ps2.coordinatorEmail || '').trim()) {
      ps2.coordinatorEmail = knownEmail;
      changed = true;
    }
  }

  // 4b. Materialize legacy global `positions`/`positionsTotal` into per-course
  //     vacancySlots for employers that carry a number but have NO slots yet AND
  //     are attached to exactly ONE course (unambiguous). This self-heals the
  //     "positions:N but 0 slots → per-course views show 0 places / never green"
  //     class of bug. Multi-course legacy employers are left untouched (can't split
  //     one number across courses) and are set up manually per course.
  if (d.employers) {
    const materialized = d.employers.map((e: any) => {
      if ((e.vacancySlots || []).length) return e;
      const cids = (e.courseIds && e.courseIds.length) ? e.courseIds : (e.courseId ? [e.courseId] : []);
      if (cids.length !== 1) return e;
      const n = Math.max(0, Number(e.positionsTotal ?? e.positions ?? 0) || 0);
      if (n <= 0) return e;
      return setCourseCapacity(e, cids[0], n, 'migrate-legacy-positions', now);
    });
    if (JSON.stringify(materialized) !== JSON.stringify(d.employers)) { d.employers = materialized as any; changed = true; }
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
      // Occupy an available slot of the student's OWN course/year. NEVER steal a
      // slot that belongs to a different (course×year) — grabbing any open slot
      // mis-tags the placement and pollutes the other year's availability (the
      // TLVtech/שגיא bug). If nothing matches the student's course, skip (leave the
      // count honest); do NOT fabricate a placement — capacity is added per course.
      const stCourse = String((st as any).courseId || '');
      const slot = slots.find(s => s.status === 'available' && (!stCourse || s.courseId === stCourse));
      if (!slot) continue; // no open slot for this student's course — open stays 0
      slot.status = 'placed';
      slot.studentId = st.id;
      slot.prefRank = slot.prefRank ?? null;
      slot.history = [...(slot.history || []), { at: now, from: 'available', to: 'placed', by: 'system', actorId: 'migrate-acceptedOrg' }];
      changed = true;
    }
    const mirrored = d.employers.map(e => reconcileEmployerCapacity(e as Employer));
    if (JSON.stringify(mirrored) !== JSON.stringify(d.employers)) { d.employers = mirrored as any; changed = true; }
  }

  // 5b. REPAIR year-mismatched occupied slots (self-healing, idempotent). A slot's
  //     courseId is the (course×year) key — a course row is per-year. A year-blind
  //     legacy reconcile could occupy a slot whose course/YEAR doesn't match the
  //     placed student (e.g. שגיא, a תשפ״ו student, on TLVtech's תשפ״ז slot),
  //     which then reads as "מלא" for the OTHER year and blocks editing it. Re-tag
  //     each such slot to the student's OWN course, attach that course to the
  //     employer, and keep the original course attached (0 slots) so the freed year
  //     stays plannable. Only fires on a genuine YEAR change — a same-year, different
  //     course-name slot is left alone.
  if (d.students && d.employers && d.courses) {
    const stById = new Map(d.students.filter(s => s?.id != null).map(s => [String(s.id), s as any]));
    const yearOf = new Map((d.courses || []).map(c => [c.id, (c as any).year]));
    let repaired = false;
    d.employers = d.employers.map((e: any) => {
      let touched = false;
      const slots = (e.vacancySlots || []).map((s: any) => {
        if (!s.studentId || s.status === 'available') return s;
        const stu = stById.get(String(s.studentId));
        const stc = stu?.courseId;
        if (!stc || stc === s.courseId) return s;           // no course, or already correct
        const sy = yearOf.get(s.courseId), ty = yearOf.get(stc);
        if (sy && ty && sy === ty) return s;                // same year, different name → leave
        touched = true;
        return {
          ...s, courseId: stc,
          history: [...(s.history || []), { at: now, from: s.status, to: s.status, by: 'system', actorId: 'repair-year-mismatch', reason: `course ${s.courseId}→${stc}` }],
        };
      });
      if (!touched) return e;
      const courseIds = Array.from(new Set([...(e.courseIds || []), ...slots.map((s: any) => s.courseId)]));
      repaired = true;
      return reconcileEmployerCapacity({ ...e, vacancySlots: slots, courseIds });
    });
    if (repaired) changed = true;
  }

  return changed ? d : data;
}

// ── Template rendering ────────────────────────────────────────────────────────

// The original eight. Kept ONLY so that a template using one of them while the caller
// omits it still renders empty, exactly as it did before this function became generic.
//
// contactBack joins them for a different reason, and it is not legacy: it is OPTIONAL BY
// DESIGN. It renders to nothing when no contact is configured, so a caller that does not
// supply it is a normal state, not a typo — and the alternative is the failure this file
// already has scar tissue about. The deploy gate caught it the moment the placeholder
// entered the shipping templates: RENDER-no-placeholder-left went red because a render
// without the key would have put the literal "{contactBack}" in front of an employer,
// exactly as v1.39 shipped "לפני {daysWaiting} ימים" to real people.
const LEGACY_PLACEHOLDERS = ['contactName', 'studentName', 'positionTitle', 'adminName',
  'courseName', 'cvLink', 'employerName', 'scope', 'contactBack'];

/**
 * Substitute every {placeholder} the caller supplied.
 *
 * This was a hardcoded list of eight replaceAll() calls, which meant a placeholder added
 * to a template but not to the list shipped LITERALLY to the employer. Two did: the
 * reminder went out reading "לפני {daysWaiting} ימים", and {responseLink} would have put
 * the words in the mail instead of the URL — the answer page reachable and never reached.
 * Unknown placeholders are now left visible rather than blanked, so a typo in a template
 * shows up in the preview instead of silently vanishing.
 */
export function renderTemplate(
  template: string,
  ctx: Partial<Record<string, string>>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in ctx ? (ctx[key] ?? '')
      : LEGACY_PLACEHOLDERS.includes(key) ? ''
      : whole);
}

// ── Channel URL builders ──────────────────────────────────────────────────────

/** Normalize a raw phone to an international wa.me number (972… for Israel). */
export function normalizeIsraeliPhone(raw: string): string {
  let n = String(raw || '').replace(/[^\d]/g, '');
  if (!n) return '';
  if (n.startsWith('00')) n = n.slice(2);            // drop the international 00 prefix
  if (n.startsWith('972')) return n;                 // already international
  if (n.startsWith('0')) return '972' + n.slice(1);  // local 0XX… → 972XX…
  if (n.length === 9) return '972' + n;              // bare local without a leading 0
  return n;                                          // assume already international
}

/**
 * True when the number can actually be dialed. Israeli numbers must be a full
 * 10-digit local (972 + 9-digit mobile `5X…`, or 972 + 8-digit landline). This
 * catches a number with a missing digit (e.g. "054446580" → not dialable) BEFORE
 * we send the user to WhatsApp's misleading "not on WhatsApp" page.
 */
export function isDialablePhone(raw: string): boolean {
  const n = normalizeIsraeliPhone(raw);
  if (n.startsWith('972')) return /^972(5\d{8}|[2-489]\d{7})$/.test(n);
  return /^\d{10,15}$/.test(n);
}

/** Open WhatsApp for a number, warning clearly (not via WhatsApp) if it's malformed. */
export function openWhatsApp(rawPhone: string, opts: { message?: string; name?: string } = {}): boolean {
  const raw = String(rawPhone || '').trim();
  if (!raw) { alert('לא הוזן מספר טלפון.'); return false; }
  if (!isDialablePhone(raw)) {
    alert(`מספר הטלפון "${raw}"${opts.name ? ` של ${opts.name}` : ''} אינו תקין — ייתכן שחסרה ספרה. עדכן/י את המספר בכרטיס המעסיק ונסה/י שוב.`);
    return false;
  }
  const n = normalizeIsraeliPhone(raw);
  window.open(opts.message ? `https://wa.me/${n}?text=${encodeURIComponent(opts.message)}` : `https://wa.me/${n}`, '_blank');
  return true;
}

export function buildWhatsAppUrl(rawPhone: string, message: string): string {
  return `https://wa.me/${normalizeIsraeliPhone(rawPhone)}?text=${encodeURIComponent(message)}`;
}

// ── Student self-service: request an org → temporary hold ──────────────────────
//
// The student, from the acceptance-email /organizations link, requests a specific
// employer. This flips ONE course-matched `available` slot to `tentative`
// (by:'student') — the place is HELD for them and drops out of the available count
// everywhere — until the coordinator resolves it (accept → placed, reject →
// released). Guards: the student must exist and have a course, must not already be
// placed, and may hold only ONE org at a time. Pure: returns a new data blob.
export function studentCurrentPlacement(data: any, email: string): { orgName: string; status: VacancySlotStatus | 'placed' } | null {
  const e = String(email || '').trim().toLowerCase();
  const student = (data?.students || []).find((s: any) => String(s.email || '').trim().toLowerCase() === e);
  if (!student) return null;
  for (const emp of (data?.employers || [])) {
    const slot = (emp.vacancySlots || []).find((s: any) => s.studentId === student.id && s.status !== 'available');
    if (slot) return { orgName: emp.name, status: slot.status };
  }
  if (student.acceptedOrg) return { orgName: student.acceptedOrg, status: 'placed' };
  return null;
}

// ── Student requests = INTENT, never a reservation ───────────────────────────
//
// Yariv 2026-07-20: "אפשר לבקש שלושה כאשר הרכזת תווסת… אם היא שלחה יותר מדי למקום
// כלשהו היא לא תוכל לשלוח לאותו מקום אם עברה את המכסה אבל ניתן לבקש."
//
// A request states a preference and TOUCHES NO VACANCY. What consumes a place is the
// coordinator actually sending the CV (PlacementPanel), which is where a full org is
// refused — refusing there is meaningful, refusing at request time is not. This also
// dissolves the capacity trap the old model created: one hold per request meant 11
// students × 3 = 33 places demanded against 21 real ones.
//
// Replaces studentRequestHold, which allowed exactly ONE request, flipped a slot to
// `tentative`, and refused a full org outright.
export const MAX_STUDENT_REQUESTS = 3;

// The org a student proposed themselves is private to them and is always their FIRST
// choice (v1.26.7) — it is not one of the list requests and they cannot drop it here.
export function studentSuggestedOrgName(data: any, student: any): string | null {
  const emp = (data?.employers || []).find((e: any) => e?.restrictedToStudentId === student?.id);
  return emp?.name || null;
}

/**
 * Toggle one organization in the student's ordered request list.
 *
 * `mode` 'add' appends (subject to the cap), 'remove' drops it and closes the gap.
 * Writes ONLY the ordered choice fields the coordinator's bridge already reads
 * (StudentEditor buildPlacements → buildPlacementPreferences). No slot is touched.
 */
export function studentSetRequests(
  data: any,
  studentEmail: string,
  employerId: string,
  mode: 'add' | 'remove',
): { ok: boolean; error?: string; data?: any; employerName?: string; requests?: string[] } {
  const email = String(studentEmail || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'לא זוהה מייל.' };
  const students: any[] = data?.students || [];
  const employers: any[] = data?.employers || [];
  const student = students.find(s => String(s.email || '').trim().toLowerCase() === email);
  if (!student) return { ok: false, error: 'המייל לא נמצא ברשימת הסטודנטים. פנה/י לרכזת הפרקטיקום.' };
  if (!student.courseId) return { ok: false, error: 'לא הוגדר קורס עבורך במערכת. פנה/י לרכזת.' };
  // Once placed the list is settled — only the coordinator may move a placed student.
  if (student.acceptedOrg || employers.some(e => (e.vacancySlots || []).some((s: any) => s.studentId === student.id && s.status === 'placed')))
    return { ok: false, error: 'כבר שובצת לארגון. לשינוי פנה/י לרכזת.' };

  const emp = employers.find(e => e.id === employerId);
  if (!emp) return { ok: false, error: 'הארגון לא נמצא.' };

  // A self-suggested org occupies rank #1 and is never part of the toggleable list.
  const suggested = studentSuggestedOrgName(data, student);
  if (suggested && suggested.toLowerCase() === String(emp.name).toLowerCase())
    return { ok: false, error: 'הארגון שהצעת שמור עבורך כבחירה ראשונה.' };

  const listCap = suggested ? MAX_STUDENT_REQUESTS - 1 : MAX_STUDENT_REQUESTS;
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

  // Current list requests, in rank order, excluding the suggested org.
  const current: string[] = [student.firstChoiceOrg, student.secondChoiceOrg, student.thirdChoiceOrg]
    .map(v => (v || '').trim())
    .filter(Boolean)
    .filter(n => !(suggested && same(n, suggested)));

  let next: string[];
  if (mode === 'remove') {
    next = current.filter(n => !same(n, emp.name));
    if (next.length === current.length) return { ok: false, error: 'הארגון אינו ברשימת הבקשות שלך.' };
  } else {
    if (current.some(n => same(n, emp.name))) return { ok: false, error: 'כבר ביקשת את הארגון הזה.' };
    if (current.length >= listCap) {
      return { ok: false, error: suggested
        ? `הגעת ל‑${listCap} בקשות (בנוסף לארגון שהצעת). הסר/י בקשה כדי לבקש ארגון אחר.`
        : `הגעת ל‑${listCap} בקשות. הסר/י בקשה כדי לבקש ארגון אחר.` };
    }
    next = [...current, emp.name];
  }

  // Re-rank: the suggested org keeps #1, list requests fill the remaining ranks.
  const ordered = suggested ? [suggested, ...next] : next;
  const updated = {
    ...student,
    firstChoiceOrg: ordered[0] || '',
    secondChoiceOrg: ordered[1] || '',
    thirdChoiceOrg: ordered[2] || '',
    firstChoiceResult: ordered[0] ? (student.firstChoiceResult || 'pending') : student.firstChoiceResult,
  };
  const nextStudents = students.map(s => s.id === student.id ? updated : s);
  return { ok: true, data: { ...data, students: nextStudents }, employerName: emp.name, requests: next };
}

export function buildMailtoUrl(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Normalise an org name so it can never be truncated by a stray ASCII double-quote.
 * A name like `ביה"ח שיבא` uses a straight `"` where the Hebrew gershayim `״` (U+05F4)
 * is meant; the `"` terminates HTML attributes / datalist values / CSV fields, cutting
 * `ביה"ח שיבא` down to `ביה` (live bug found 2026-07-22). Converting `"`→`״` keeps the
 * intended glyph and removes the fragile character at every entry point.
 */
export function normalizeOrgName(s: any): string {
  return String(s ?? '').replace(/"/g, '״');
}

// ── Unified ordered org list — the single source for the student-editor org hub ──
//
// 2026-07-21 redesign, Phase 0 (data model). Today a student's org choices live in
// TWO places: the legacy `firstChoiceOrg/second/third` + `*ChoiceResult` fields, AND
// the structured `preferences: StudentPreference[]`. The redesign renders ONE ordered,
// coordinator-reorderable list where the interview result is bound to the ORG (not a
// rank slot) — so re-ranking never moves 'עבר' onto the wrong org. These pure helpers
// derive that list, reorder it, and write it back (keeping the legacy fields in sync
// as a compat shim). Behaviour-preserving: no component consumes them yet (Phase 1).
export type InterviewResult = 'pending' | 'passed' | 'failed';
export type UnifiedOrgPref = {
  rank: number;
  orgName: string;
  employerId: string | null;
  interviewResult: InterviewResult;
  status: 'tentative' | 'under_review' | 'rejected' | 'placed' | 'withdrawn';
  slotId: string | null;
};

const eqName = (a?: string | null, b?: string | null) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase() && !!String(a || '').trim();

// Resolve an org name to an employer id the SAME fuzzy way the rest of the app does
// (exact → case-insensitive → prefix, either direction), so a free-text choice like
// "Icon Group" resolves to the employer "Icon Group/I digital". Matches
// StudentEditor.resolveEmployerForOrg / OrgHub.resolveEmployer.
function resolveEmployerIdByName(orgName: string, employers: any[]): string | null {
  const norm = (s?: string) => String(s || '').trim().toLowerCase();
  const n = norm(orgName);
  if (!n) return null;
  const list = employers || [];
  const e = list.find((x: any) => x?.name === orgName)
    || list.find((x: any) => norm(x?.name) === n)
    || list.find((x: any) => { const en = norm(x?.name); return !!en && (en.startsWith(n) || n.startsWith(en)); });
  return e ? e.id : null;
}

/** The legacy choice fields as an ordered [{orgName, interviewResult}] list. */
function legacyChoices(student: any): Array<{ orgName: string; interviewResult: InterviewResult }> {
  return [
    { orgName: (student?.firstChoiceOrg || '').trim(), interviewResult: (student?.firstChoiceResult || 'pending') as InterviewResult },
    { orgName: (student?.secondChoiceOrg || '').trim(), interviewResult: (student?.secondChoiceResult || 'pending') as InterviewResult },
    { orgName: (student?.thirdChoiceOrg || '').trim(), interviewResult: (student?.thirdChoiceResult || 'pending') as InterviewResult },
  ].filter(c => c.orgName);
}

/**
 * Build the unified ordered org list for a student — the UNION of the structured
 * `preferences[]` (rank order, each carrying its own interviewResult, falling back to
 * the legacy result matched BY ORG NAME) and any legacy `*ChoiceOrg` the coordinator
 * chose but never "built" into a preference yet. A freshly-typed org therefore shows
 * as a card immediately, and a built org keeps its placement status/slot. Always
 * re-numbered 1..N. The union is what lets the editor drop the explicit "build" step.
 */
export function buildUnifiedOrgList(student: any, employers: any[] = []): UnifiedOrgPref[] {
  const legacy = legacyChoices(student);
  const legacyResultFor = (orgName: string): InterviewResult | undefined =>
    legacy.find(c => eqName(c.orgName, orgName))?.interviewResult;
  const nameOf = (empId: string): string => (employers || []).find((e: any) => e?.id === empId)?.name || '';

  const prefs: any[] = Array.isArray(student?.preferences) ? student.preferences : [];
  const fromPrefs: UnifiedOrgPref[] = [...prefs]
    .sort((a, b) => (a.rank || 0) - (b.rank || 0))
    .map((p) => {
      const orgName = (p.orgName || nameOf(p.employerId) || legacy[(p.rank || 1) - 1]?.orgName || '').trim();
      const interviewResult: InterviewResult = p.interviewResult || legacyResultFor(orgName) || 'pending';
      // A preference that HOLDS A SLOT must never vanish (an unresolved/deleted employer
      // would otherwise drop it, orphaning its reserved place). Give it a fallback name.
      const name = orgName || (p.slotId ? 'ארגון לא ידוע' : '');
      return { rank: p.rank || 0, orgName: name, employerId: p.employerId || resolveEmployerIdByName(orgName, employers), interviewResult, status: p.status || 'tentative', slotId: p.slotId ?? null } as UnifiedOrgPref;
    })
    .filter(p => p.orgName);

  // Append any legacy choice not already represented by a preference — deduping by BOTH
  // the org name AND the resolved employer id. Without the id check a built preference
  // whose CANONICAL employer name differs from the free-text legacy choice (e.g.
  // "Icon Group/I digital" vs "Icon Group") would appear as a phantom second card.
  const seenNames = new Set(fromPrefs.map(p => p.orgName.trim().toLowerCase()));
  const seenEmpIds = new Set(fromPrefs.map(p => p.employerId).filter(Boolean) as string[]);
  const fromLegacy: UnifiedOrgPref[] = legacy
    .filter(c => {
      if (seenNames.has(c.orgName.trim().toLowerCase())) return false;
      const eid = resolveEmployerIdByName(c.orgName, employers);
      if (eid && seenEmpIds.has(eid)) return false;
      return true;
    })
    .map(c => ({
      rank: 0, orgName: c.orgName, employerId: resolveEmployerIdByName(c.orgName, employers),
      interviewResult: c.interviewResult, status: 'tentative' as const, slotId: null,
    }));

  return [...fromPrefs, ...fromLegacy].map((p, i) => ({ ...p, rank: i + 1 }));
}

/**
 * Reorder the unified list to match `orderedOrgNames` and re-number ranks 1..N. Each
 * entry KEEPS its interviewResult and status — the whole point: the result follows the
 * org, never the rank index. Names not found are ignored; entries not named keep their
 * relative order at the end.
 */
export function reorderUnifiedList(list: UnifiedOrgPref[], orderedOrgNames: string[]): UnifiedOrgPref[] {
  const used = new Set<number>();
  const out: UnifiedOrgPref[] = [];
  for (const name of orderedOrgNames) {
    const idx = list.findIndex((p, i) => !used.has(i) && eqName(p.orgName, name));
    if (idx >= 0) { used.add(idx); out.push(list[idx]); }
  }
  list.forEach((p, i) => { if (!used.has(i)) out.push(p); });
  return out.map((p, i) => ({ ...p, rank: i + 1 }));
}

/**
 * Write a unified list back onto a student: the structured `preferences[]` becomes the
 * source of truth (carrying orgName + interviewResult), and the legacy
 * `firstChoiceOrg/second/third` + `*ChoiceResult` fields are kept in sync (compat shim)
 * so existing readers (reports, PlacementPanel, /cv-update pre-fill) keep working.
 * Pure: returns a fresh student.
 */
export function applyUnifiedList(student: any, list: UnifiedOrgPref[]): any {
  const ranked = list.map((p, i) => ({ ...p, rank: i + 1 }));
  const preferences = ranked.map(p => ({
    rank: p.rank, employerId: p.employerId || '', orgName: p.orgName,
    interviewResult: p.interviewResult, status: p.status, slotId: p.slotId ?? null,
  }));
  const legacyKeys: Array<['firstChoiceOrg' | 'secondChoiceOrg' | 'thirdChoiceOrg', 'firstChoiceResult' | 'secondChoiceResult' | 'thirdChoiceResult']> = [
    ['firstChoiceOrg', 'firstChoiceResult'], ['secondChoiceOrg', 'secondChoiceResult'], ['thirdChoiceOrg', 'thirdChoiceResult'],
  ];
  const sync: any = {};
  legacyKeys.forEach(([orgKey, resKey], i) => {
    sync[orgKey] = ranked[i]?.orgName || '';
    sync[resKey] = ranked[i] ? ranked[i].interviewResult : 'pending';
  });
  return { ...student, ...sync, preferences };
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
      const courseId = student.courseId || (emp.courseIds && emp.courseIds[0]) || '';
      slots = Array.from({ length: total }, (_, i) => ({
        id: `${emp.id}-s${i + 1}`, courseId, status: 'available', studentId: null, prefRank: null,
        history: [{ at: now, from: null, to: 'available', by: 'system', actorId: opts.actorId }],
      }));
    }

    // A preference is INTENT ONLY — it must never reserve a place. What takes a
    // place is the coordinator actually SENDING the CV (PlacementPanel), which
    // acquires an available slot at that moment.
    //
    // Previously every preference flipped a slot to `tentative`, so 3 preferences
    // × N students consumed 3N places and a course could read "full" before a
    // single CV went out (תשפ״ז: 11 students × 3 = 33 demanded vs 21 real places).
    // Consequently a preference for a CURRENTLY-FULL org is allowed — availability
    // is re-checked at send time, where refusing is meaningful.
    const held = slots.find(s => s.studentId === student.id
      && (s.status === 'tentative' || s.status === 'under_review' || s.status === 'placed'));

    const rank = built.length + 1;
    if (held) held.prefRank = rank; // CV already sent / placed here — keep the link
    (emp as any).vacancySlots = slots;
    if ((emp as any).positionsTotal == null) (emp as any).positionsTotal = slots.length;

    usedEmployerIds.add(emp.id);
    prefs.push({
      rank,
      employerId: emp.id,
      // null until a CV is actually sent (that is what acquires the place).
      slotId: held ? held.id : null,
      status: held ? (held.status === 'placed' ? 'placed' : 'under_review') : 'tentative',
    });
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
    const courseId = student.courseId || (emp.courseIds && emp.courseIds[0]) || '';
    slots = Array.from({ length: total }, (_, i) => ({
      id: `${emp.id}-s${i + 1}`, courseId, status: 'available', studentId: null, prefRank: null,
      history: [{ at: now, from: null, to: 'available', by: 'system', actorId: opts.actorId }],
    }));
  }
  // Adding a target reserves NOTHING — same rule as buildPlacementPreferences:
  // a place is taken only when the CV is actually SENT (PlacementPanel acquires
  // an available slot at that moment). Keep the link if this student already
  // holds a place here (a CV was already sent to this employer).
  const held = slots.find(s => s.studentId === student.id
    && (s.status === 'tentative' || s.status === 'under_review' || s.status === 'placed'));

  const rank = prefs.reduce((m, p) => Math.max(m, p.rank), 0) + 1;
  if (held) held.prefRank = rank;
  (emp as any).vacancySlots = slots;
  emps[idx] = reconcileEmployerCapacity(emp);

  const updatedStudent: Student = {
    ...student,
    preferences: [...prefs, {
      rank,
      employerId: emp.id,
      slotId: held ? held.id : null,
      status: held ? (held.status === 'placed' ? 'placed' : 'under_review') : 'tentative',
    }],
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
  // Prefer the student's OWN course/year when materializing a fresh employer.
  const stCourse = String((student as any).courseId || '');
  if (slots.length === 0) {
    const total = Math.max(1, Number(emp.positionsTotal ?? emp.positions ?? 1) || 1);
    const courseId = stCourse || (emp.courseIds && emp.courseIds[0]) || '';
    slots = Array.from({ length: total }, (_, i) => ({
      id: `${emp.id}-s${i + 1}`, courseId, status: 'available', studentId: null, prefRank: null,
      history: [{ at: now, from: null, to: 'available', by: 'system', actorId: opts.actorId }],
    }));
  }
  // Occupy a slot of the student's course/year — never another year's slot. If the
  // org has none for that course, materialize one and attach the course.
  let slot: any = slots.find(s => s.status === 'available' && (!stCourse || s.courseId === stCourse));
  if (!slot && stCourse) {
    slot = { id: `${emp.id}-${stCourse}-p${student.id}`, courseId: stCourse, status: 'available', studentId: null, prefRank: null,
      history: [{ at: now, from: null, to: 'available', by: 'admin', actorId: opts.actorId }] };
    slots.push(slot);
    emp.courseIds = Array.from(new Set([...(emp.courseIds || []), stCourse]));
  }
  if (slot) {
    slot.status = 'placed';
    slot.studentId = student.id;
    slot.history = [...(slot.history || []), { at: now, from: 'available', to: 'placed', by: 'admin', actorId: opts.actorId }];
  }
  // No available slot for the student's course → org full for that year; open stays 0.
  emp.vacancySlots = slots;
  emps[idx] = reconcileEmployerCapacity(emp);
  return emps;
}

// ── Free a removed student's slots (prevents dangling slot→student refs) ───────
//
// When a student is deleted / reverted to candidate, any vacancy slot they held
// (tentative/under_review/placed) must be freed — otherwise the slot keeps a
// studentId that resolves to nobody, which inflates occupancy, understates open
// places, and blocks course-detach/capacity edits. Flips each such slot back to
// 'available' with studentId cleared. Pure: returns a fresh employers array; only
// employers that actually held a slot for this student change.
export function releaseStudentSlots(employers: Employer[], studentId: string, now?: string): Employer[] {
  const sid = String(studentId);
  const ts = now || new Date().toISOString();
  return employers.map(e => {
    const slots: any[] = (e as any).vacancySlots || [];
    if (!slots.some(s => String(s.studentId) === sid)) return e;
    const next = slots.map(s => String(s.studentId) === sid
      ? { ...s, status: 'available', studentId: null, prefRank: null, history: [...(s.history || []), { at: ts, from: s.status, to: 'available', by: 'admin', actorId: 'student-deleted', reason: 'student-deleted' }] }
      : s);
    return reconcileEmployerCapacity({ ...(e as any), vacancySlots: next } as Employer);
  });
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
 * Set the number of vacancy slots for ONE course on an employer — the per-course
 * capacity primitive (single source of truth). Growing appends fresh `available`
 * slots; shrinking removes `available` slots only, and never below the number of
 * occupied (tentative/under_review/placed) slots for that course — an occupied
 * place can't be dropped by lowering the number. Pure: returns a new employer and
 * mirrors the legacy global scalars via reconcileEmployerCapacity so old readers
 * stay correct. `n` is clamped to >= occupied.
 */
export function setCourseCapacity<T extends Employer>(
  emp: T,
  courseId: string,
  n: number,
  actorId = 'admin',
  now?: string,
): T {
  const ts = now || new Date().toISOString();
  const all: any[] = ((emp as any).vacancySlots || []).map((s: any) => ({ ...s }));
  const mine = all.filter(s => s.courseId === courseId);
  const others = all.filter(s => s.courseId !== courseId);
  const occupied = mine.filter(s => s.status !== 'available');
  const available = mine.filter(s => s.status === 'available');
  const target = Math.max(occupied.length, Math.max(0, Math.floor(Number(n) || 0)));
  let next: any[];
  if (target >= mine.length) {
    const add = target - mine.length;
    const extra = Array.from({ length: add }, (_, i) => ({
      id: `${(emp as any).id}-${courseId}-s${mine.length + i + 1}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      courseId,
      status: 'available' as const,
      studentId: null,
      prefRank: null,
      history: [{ at: ts, from: null, to: 'available', by: 'admin' as const, actorId }],
    }));
    next = [...mine, ...extra];
  } else {
    const keepAvail = Math.max(0, target - occupied.length);
    next = [...occupied, ...available.slice(0, keepAvail)];
  }
  // Always sync the legacy mirrors to the ACTUAL slot count — including 0. (The
  // reconcile helper bails on empty, which would leave positions=1 after a course
  // is zeroed, and the migration/fallback could then re-materialize a phantom slot.)
  const nextSlots = [...others, ...next];
  const occ = nextSlots.filter((s: any) => s.status !== 'available').length;
  return { ...(emp as any), vacancySlots: nextSlots, positionsTotal: nextSlots.length, positions: nextSlots.length, filledPositions: occ } as T;
}

/** Total vacancy slots for one course (per-course "total places"). */
export function courseCapacity(emp: Employer, courseId: string): number {
  return countSlotsByStatus(emp, courseId).total;
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

/**
 * Sending a CV to an employer — the ONE implementation, shared by the student card
 * (OrgHub) and the students-list row.
 *
 * Why this module exists: the row needed to send without entering the card (Yariv
 * 2026-08-09 — "אם אפשר שהשליחה תהיה מהמלבן של הסטודנט זה יקל"). Re-implementing the
 * slot maths in a second place is how the two would drift, and this flow reserves real
 * places for real students. So the logic lives here, pure, and both callers use it.
 *
 * The split is deliberate:
 *   planDispatch()  — decides WHAT would be sent. Pure: no windows, no state, no I/O.
 *   applyDispatch() — folds the entries that were ACTUALLY opened into new
 *                     student/employers/dispatches. Pure.
 *   unsendOrg()     — undoes a send that never really happened, returning the org to
 *                     the list and freeing the place.
 *
 * Nothing here opens a window or writes to the database; the caller does both, in that
 * order, and only after the coordinator has confirmed the message actually went. That
 * separation is what stops a refused compose window from recording a phantom send —
 * see the 2026-08-09 incident (נטע נידם → Codeoasis) in docs/LIVE-PROGRESS.md.
 */

import {
  buildUnifiedOrgList, applyUnifiedList, reconcileEmployerCapacity, renderTemplate,
  buildWhatsAppUrl, buildMailtoUrl,
} from './placement';
import type { Employer, VacancySlot, Dispatch } from './supabase';

export type DispatchChannel = 'whatsapp' | 'email';

export type DispatchPlanEntry = {
  /** Minted here so the employer's response link can carry it, and reused verbatim when
   *  the send is confirmed — the link and the recorded dispatch must be the same id. */
  dispatchId: string;
  orgName: string;
  employerId: string;
  slotId: string;
  /** The slot existed already and is held for THIS student (a re-send), vs newly taken. */
  reusingSlot: boolean;
  channel: DispatchChannel;
  url: string;
  messageSnapshot: string;
  prefRank: number | null;
  contactName: string;
  /** The actual address or number the window will open against — shown before sending,
   *  so an empty compose window is never mistaken for a sent message. */
  recipient: string;
  /** Missing phone/email means the compose window would open with no recipient. */
  missingContact: boolean;
};

export type DispatchPlan = {
  entries: DispatchPlanEntry[];
  skipped: string[];
  /** Set when nothing can be sent at all; a caller can show it verbatim. */
  blockedReason: string;
};

const norm = (s?: string | null) => String(s ?? '').trim().toLowerCase();

export function resolveEmployerByName(orgName: string, employers: Employer[]): Employer | undefined {
  if (!orgName) return undefined;
  const n = norm(orgName);
  return (employers || []).find(e => e.name === orgName)
    || (employers || []).find(e => norm(e.name) === n)
    || (employers || []).find(e => { const en = norm(e.name); return !!en && (en.startsWith(n) || n.startsWith(en)); });
}

const slotOf = (emp: any, slotId: string | null | undefined): VacancySlot | undefined =>
  slotId ? ((emp?.vacancySlots || []) as any[]).find(s => s.id === slotId) : undefined;

export type PlanInput = {
  student: any;
  employers: Employer[];
  orgNames: string[];
  channel: DispatchChannel;
  courseId: string;
  courseName?: string;
  cvLink: string;
  userName: string;
  settings: any;
  /** Mints the dispatch id; also used to build the employer's response link. */
  newId?: () => string;
  /** Origin for the response link, e.g. https://practicum.yarivitzkovich.org */
  origin?: string;
  /** Allow orgs already `under_review` — a re-send to the same employer. */
  allowResend?: boolean;
  /** Compose a REMINDER instead of a first send: different wording, and the place is
   *  already held so nothing new is reserved. */
  reminder?: { daysWaiting: number } | null;
};

/**
 * Work out what would be sent, without sending anything.
 *
 * Mirrors the original in-component logic exactly, including the one-place-per-employer
 * rule within a batch and the reuse of a place this student already holds.
 */
export function planDispatch(input: PlanInput): DispatchPlan {
  const { student, employers, orgNames, channel, courseId, cvLink, userName, settings } = input;
  const skipped: string[] = [];

  if (!student?.cvUpdatedUrl) {
    return { entries: [], skipped, blockedReason: 'אין קו״ח מעודכן לסטודנט/ית — לא ניתן לשלוח' };
  }

  // Resolve against the CURRENT ranked list by identity, never the raw name set: a card
  // renamed or removed after being ticked must drop out rather than reserve a place no
  // preference owns.
  const cards = buildUnifiedOrgList(student, employers);
  const sendable = input.allowResend ? ['tentative', 'under_review'] : ['tentative'];
  const targets = cards.filter(c => orgNames.includes(c.orgName) && sendable.includes(c.status));
  if (targets.length === 0) {
    return { entries: [], skipped, blockedReason: 'לא נשלח — אין ארגון תקף שנבחר' };
  }

  const entries: DispatchPlanEntry[] = [];
  const usedEmployerIds = new Set<string>();

  for (const card of targets) {
    const orgName = card.orgName;
    const emp = resolveEmployerByName(orgName, employers);
    if (!emp) { skipped.push(`${orgName} (לא זוהה מעסיק)`); continue; }
    if (usedEmployerIds.has(emp.id)) { skipped.push(`${orgName} (אותו מעסיק כבר נשלח)`); continue; }

    const already = slotOf(emp, card.slotId);
    const target = already
      || ((emp as any).vacancySlots || []).find((s: any) => s.status === 'available' && s.courseId === courseId);
    if (!target) { skipped.push(`${orgName} (אין מקום פנוי)`); continue; }

    const ctx = {
      contactName: emp.contactPerson || emp.name, studentName: student.name,
      positionTitle: emp.name, adminName: userName,
      courseName: input.courseName || '', cvLink, employerName: emp.name,
    } as Record<string, string>;
    const rem = input.reminder;
    const dispatchId = input.newId ? input.newId() : `d-${target.id}`;
    const origin = input.origin || (typeof window !== 'undefined' ? window.location.origin : '');
    const ctxR = { ...ctx, daysWaiting: String(rem?.daysWaiting ?? ''),
      responseLink: origin ? `${origin}/r?t=${dispatchId}` : '' };
    let url = '', messageSnapshot = '', missingContact = false;
    if (channel === 'whatsapp') {
      messageSnapshot = renderTemplate(
        (rem ? settings?.reminderWhatsappTemplate : settings?.whatsappTemplate) || '', ctxR);
      url = buildWhatsAppUrl(emp.contactPhone || '', messageSnapshot);
      missingContact = !String(emp.contactPhone || '').trim();
    } else {
      const subject = renderTemplate(
        (rem ? settings?.reminderEmailSubjectTemplate : settings?.emailSubjectTemplate) || '', ctxR);
      const body = renderTemplate(
        (rem ? settings?.reminderEmailBodyTemplate : settings?.emailBodyTemplate) || '', ctxR);
      messageSnapshot = `${subject}\n\n${body}`;
      url = buildMailtoUrl(emp.contactEmail || '', subject, body);
      missingContact = !String(emp.contactEmail || '').trim();
    }

    usedEmployerIds.add(emp.id);
    entries.push({
      dispatchId,
      orgName, employerId: emp.id, slotId: target.id, reusingSlot: !!already,
      channel, url, messageSnapshot, prefRank: card.rank ?? null,
      contactName: emp.contactPerson || emp.name,
      recipient: channel === 'whatsapp' ? String(emp.contactPhone || '') : String(emp.contactEmail || ''),
      missingContact,
    });
  }

  return { entries, skipped, blockedReason: '' };
}

export type ApplyInput = {
  student: any;
  employers: Employer[];
  dispatches: Dispatch[];
  /** Only the entries whose compose window actually opened AND were confirmed sent. */
  entries: DispatchPlanEntry[];
  userName: string;
  now?: string;
  newId: () => string;
};

/** Fold confirmed sends into the data. Pure — the caller persists the result. */
export function applyDispatch(input: ApplyInput): { student: any; employers: Employer[]; dispatches: Dispatch[] } {
  const { entries, userName, newId } = input;
  const now = input.now || new Date().toISOString();
  // MATERIALISE first. A student whose orgs live only in the legacy firstChoiceOrg/
  // second/third fields has an empty preferences[], so there is no row to mark
  // under_review — the send would take the place and log the dispatch while the student
  // still looked un-sent. The card did this via materialise() before dispatching; doing
  // it here means every caller inherits it. (Caught by cell 66: pref=(none) with
  // slot=under_review and dispatches=1.)
  let student = applyUnifiedList(input.student, buildUnifiedOrgList(input.student, input.employers));
  let employers = input.employers;
  const added: Dispatch[] = [];

  for (const e of entries) {
    const emp: any = employers.find(x => x.id === e.employerId);
    if (!emp) continue;
    const slots: VacancySlot[] = ((emp.vacancySlots || []) as any[]).map((s: any) => s.id !== e.slotId ? s : ({
      ...s, status: 'under_review', studentId: student.id, prefRank: e.prefRank,
      history: [...(s.history || []), { at: now, from: s.status, to: 'under_review', by: 'admin', actorId: userName }],
    }));
    const updated = reconcileEmployerCapacity({ ...emp, vacancySlots: slots });
    employers = employers.map(x => x.id === updated.id ? updated : x);
    student = {
      ...student,
      preferences: (student.preferences || []).map((p: any) => p.orgName === e.orgName
        ? { ...p, employerId: e.employerId, slotId: e.slotId, status: 'under_review' } : p),
    };
    added.push({
      // the SAME id the response link was built with
      id: e.dispatchId || newId(), studentId: student.id, employerId: e.employerId, slotId: e.slotId,
      channel: e.channel, sentBy: userName, sentAt: now, messageSnapshot: e.messageSnapshot,
      result: 'pending', resultAt: null, resultBy: null,
    } as Dispatch);
  }

  return { student, employers, dispatches: [...input.dispatches, ...added] };
}

/**
 * Drop an organization from the ranking entirely — the exit for a choice that is blocked
 * and will not free up (Yariv 2026-08-10: a full organization said WHY but offered
 * nothing to do). Frees any place it happened to hold, and renumbers the rest so the
 * ranking never has a gap.
 */
export function dropOrg(input: { student: any; employers: Employer[]; orgName: string; userName: string; now?: string }):
  { student: any; employers: Employer[] } {
  const now = input.now || new Date().toISOString();
  const pref = (input.student.preferences || []).find((p: any) => norm(p.orgName) === norm(input.orgName));
  const slotId = pref?.slotId || null;
  const employers = input.employers.map((e: any) => {
    if (!slotId || !((e.vacancySlots || []) as any[]).some(s => s.id === slotId)) return e;
    const slots = ((e.vacancySlots || []) as any[]).map(s => s.id !== slotId ? s : ({
      ...s, status: 'available', studentId: null, prefRank: null,
      history: [...(s.history || []), { at: now, from: s.status, to: 'available', by: 'admin',
        actorId: input.userName, reason: 'dropped-from-ranking' }],
    }));
    return reconcileEmployerCapacity({ ...e, vacancySlots: slots });
  });
  const kept = (input.student.preferences || [])
    .filter((p: any) => norm(p.orgName) !== norm(input.orgName))
    .map((p: any, i: number) => ({ ...p, rank: i + 1 }));
  const student = applyUnifiedList({ ...input.student, preferences: kept },
    kept.map((p: any, i: number) => ({ rank: i + 1, orgName: p.orgName, employerId: p.employerId || null,
      interviewResult: p.interviewResult || 'pending', status: p.status || 'tentative', slotId: p.slotId ?? null })));
  return { student, employers };
}

export type UnsendInput = {
  student: any;
  employers: Employer[];
  dispatches: Dispatch[];
  orgName: string;
  userName: string;
  now?: string;
  /**
   * 'never_sent' — the message never actually went: free the place and put the org back
   *                on the list as not-yet-sent, so it can be sent again.
   * 'cancelled'  — it did go, and we are withdrawing it: the org is closed off.
   */
  mode: 'never_sent' | 'cancelled';
};

/**
 * Undo a send. `never_sent` is the case the phantom-dispatch bug created and which the
 * card had no exit from: the only route out was 'בוטל', which is terminal and forced the
 * coordinator to re-add the organization from scratch (Yariv 2026-08-09).
 */
export function unsendOrg(input: UnsendInput): { student: any; employers: Employer[]; dispatches: Dispatch[] } {
  const { orgName, userName, mode } = input;
  const now = input.now || new Date().toISOString();
  const pref = (input.student.preferences || []).find((p: any) => norm(p.orgName) === norm(orgName));
  const slotId = pref?.slotId || null;

  const employers = input.employers.map((e: any) => {
    if (!slotId || !((e.vacancySlots || []) as any[]).some(s => s.id === slotId)) return e;
    const slots = ((e.vacancySlots || []) as any[]).map(s => s.id !== slotId ? s : ({
      ...s, status: 'available', studentId: null, prefRank: null,
      history: [...(s.history || []), {
        at: now, from: s.status, to: 'available', by: 'admin', actorId: userName,
        reason: mode === 'never_sent' ? 'never-sent-returned-to-list' : 'withdrawn-manual',
      }],
    }));
    return reconcileEmployerCapacity({ ...e, vacancySlots: slots });
  });

  const student = {
    ...input.student,
    preferences: (input.student.preferences || []).map((p: any) => norm(p.orgName) !== norm(orgName) ? p
      : ({ ...p, slotId: null, status: mode === 'never_sent' ? 'tentative' : 'withdrawn' })),
  };

  const dispatches = input.dispatches.map(d => (d.slotId === slotId && d.studentId === input.student.id && d.result === 'pending')
    ? { ...d, result: 'withdrawn', resultAt: now, resultBy: userName } as Dispatch : d);

  return { student, employers, dispatches };
}


// ── The employer's own answer ─────────────────────────────────────────────────
// Yariv 2026-08-10 chose routes א + ג: the employer answers through a link, and we chase
// underneath. The crucial fact he supplied is that the answer is NOT one step — "הוא
// מזמין לראיון ואחרי ראיון הוא לוחץ על הקישור … לפעמים חודש וחצי". So the link asks a
// stage-appropriate question and never asks "was she accepted?" before an interview.

export type ResponseStage = 'awaiting_reply' | 'interview_booked' | 'awaiting_decision' | 'answered';

/** What the employer should be asked, given where this dispatch has got to. */
export function responseStageOf(input: {
  student: any; orgName: string; interviewDate?: string | null; now?: number;
}): ResponseStage {
  const pref = (input.student?.preferences || [])
    .find((p: any) => norm(p.orgName) === norm(input.orgName));
  if (!pref) return 'awaiting_reply';
  if (pref.status === 'placed' || pref.status === 'rejected') return 'answered';
  const iv = String(input.interviewDate || input.student?.placementInterviewDate || '').trim();
  if (!iv) return 'awaiting_reply';
  const ts = Date.parse(`${iv}T23:59`);
  if (!Number.isFinite(ts)) return 'awaiting_reply';
  return ts > (input.now ?? Date.now()) ? 'interview_booked' : 'awaiting_decision';
}

export type EmployerAnswer =
  | { kind: 'invite'; interviewDate?: string }
  | { kind: 'still_reviewing' }
  | { kind: 'not_suitable' }
  | { kind: 'accepted' }
  | { kind: 'not_accepted' };

/**
 * Fold an employer's answer into the data. Pure — the caller persists it.
 * Deliberately conservative: 'accepted' marks the placement, everything else moves the
 * stage or releases the place, and nothing here messages anybody.
 */
export function applyEmployerAnswer(input: {
  student: any; employers: Employer[]; dispatches: Dispatch[];
  orgName: string; answer: EmployerAnswer; now?: string;
}): { student: any; employers: Employer[]; dispatches: Dispatch[] } {
  const now = input.now || new Date().toISOString();
  const { answer, orgName } = input;
  const pref = (input.student.preferences || []).find((p: any) => norm(p.orgName) === norm(orgName));
  const slotId = pref?.slotId || null;

  if (answer.kind === 'invite') {
    return {
      student: {
        ...input.student,
        placementInterviewDate: answer.interviewDate || input.student.placementInterviewDate || '',
        placementInterviewOrg: orgName,
        preferences: (input.student.preferences || []).map((p: any) =>
          norm(p.orgName) === norm(orgName) ? { ...p, interviewResult: 'pending' } : p),
      },
      employers: input.employers, dispatches: input.dispatches,
    };
  }

  if (answer.kind === 'still_reviewing') {
    // Restart the clock without changing anything else — a real answer, just not final.
    return {
      student: input.student, employers: input.employers,
      dispatches: input.dispatches.map(d => (d.slotId === slotId && d.result === 'pending')
        ? ({ ...d, remindedAt: now } as Dispatch) : d),
    };
  }

  if (answer.kind === 'accepted') {
    const employers = input.employers.map((e: any) => {
      if (!slotId || !((e.vacancySlots || []) as any[]).some(s => s.id === slotId)) return e;
      const slots = ((e.vacancySlots || []) as any[]).map(s => s.id !== slotId ? s : ({
        ...s, status: 'placed', studentId: input.student.id,
        history: [...(s.history || []), { at: now, from: s.status, to: 'placed', by: 'system', actorId: 'employer-link' }],
      }));
      return reconcileEmployerCapacity({ ...e, vacancySlots: slots });
    });
    return {
      student: {
        ...input.student, acceptedOrg: orgName, submissionStatus: 'placed',
        placedAt: input.student.placedAt || now.slice(0, 10),
        preferences: (input.student.preferences || []).map((p: any) =>
          norm(p.orgName) === norm(orgName) ? { ...p, status: 'placed', interviewResult: 'passed' } : p),
      },
      employers,
      dispatches: input.dispatches.map(d => (d.slotId === slotId && d.result === 'pending')
        ? ({ ...d, result: 'placed', resultAt: now, resultBy: 'employer-link' } as Dispatch) : d),
    };
  }

  // not_suitable / not_accepted — free the place and mark the choice rejected.
  const employers = input.employers.map((e: any) => {
    if (!slotId || !((e.vacancySlots || []) as any[]).some(s => s.id === slotId)) return e;
    const slots = ((e.vacancySlots || []) as any[]).map(s => s.id !== slotId ? s : ({
      ...s, status: 'available', studentId: null, prefRank: null,
      history: [...(s.history || []), { at: now, from: s.status, to: 'available', by: 'system', actorId: 'employer-link' }],
    }));
    return reconcileEmployerCapacity({ ...e, vacancySlots: slots });
  });
  return {
    student: {
      ...input.student,
      preferences: (input.student.preferences || []).map((p: any) =>
        norm(p.orgName) === norm(orgName)
          ? { ...p, status: 'rejected', slotId: null,
              interviewResult: answer.kind === 'not_accepted' ? 'failed' : p.interviewResult }
          : p),
    },
    employers,
    dispatches: input.dispatches.map(d => (d.slotId === slotId && d.result === 'pending')
      ? ({ ...d, result: 'rejected', resultAt: now, resultBy: 'employer-link' } as Dispatch) : d),
  };
}

// ── Direct placement ─────────────────────────────────────────────────────────
/**
 * Approve a placement without sending a CV — the student and the organization already
 * spoke, which is the normal path for an org the student brought (Yariv 2026-08-09:
 * "אשר השמה או שלח קורות חיים").
 *
 * This lives here, pure, because it has to run from TWO places. The row's confirmation
 * dialog promised "הסטודנט/ית יירשם/תירשם כמשובץ/ת בארגון, ייתפס מקום" and then only
 * called setEditing() — the placement never happened, the database was untouched, and
 * the user was told it had been saved. Yariv hit exactly that on הדר עוזירי → מערך
 * הדיגיטל הלאומי and had to redo it inside the card. Rather than fork the logic (which
 * is what the row was avoiding), both callers now run this one function.
 *
 * Materialises first: a student whose organizations live only in the legacy
 * firstChoiceOrg fields has an empty preferences[], and the placement would find nothing
 * to place — the same trap applyDispatch documents.
 */
export function placeDirect(input: {
  student: any;
  employers: Employer[];
  orgName: string;
  userName: string;
  now?: string;
  newSlotId?: () => string;
}): { ok: boolean; error?: string; student: any; employers: Employer[] } {
  const now = input.now || new Date().toISOString();
  const student = applyUnifiedList(input.student, buildUnifiedOrgList(input.student, input.employers));
  const courseId = student.courseId;
  if (!courseId) return { ok: false, error: 'לא הוגדר קורס לסטודנט/ית', student: input.student, employers: input.employers };

  const pref = (student.preferences || []).find((p: any) => p.orgName === input.orgName);
  const emp = (input.employers || []).find((e: any) => e.name === input.orgName || e.id === (pref || {}).employerId);
  if (!pref || !emp) return { ok: false, error: 'לא זוהה ארגון', student: input.student, employers: input.employers };

  const slots: any[] = ((emp as any).vacancySlots || []);
  const existing = pref.slotId ? slots.find((s) => s.id === pref.slotId) : null;
  let target: any = existing || slots.find((s) => s.status === 'available' && s.courseId === courseId);
  let updatedSlots: VacancySlot[];
  if (target) {
    updatedSlots = slots.map((s) => s.id !== target.id ? s : ({
      ...s, status: 'placed', studentId: student.id, prefRank: pref.rank,
      history: [...(s.history || []), { at: now, from: s.status, to: 'placed', by: 'admin', actorId: input.userName, reason: 'placed-direct' }],
    })) as VacancySlot[];
  } else if ((emp as any).restrictedToStudentId === student.id) {
    // An org this student brought has no shared capacity to draw on — mint the place.
    target = {
      id: input.newSlotId ? input.newSlotId() : `${emp.id}-direct-${now.replace(/\D/g, '').slice(-10)}`,
      courseId, status: 'placed', studentId: student.id, prefRank: pref.rank,
      history: [{ at: now, from: 'available', to: 'placed', by: 'admin', actorId: input.userName, reason: 'placed-direct-mint' }],
    };
    updatedSlots = [...slots, target] as VacancySlot[];
  } else {
    return { ok: false, error: 'אין כרגע מקום פנוי בארגון זה עבור הקורס', student: input.student, employers: input.employers };
  }

  const updatedEmp = reconcileEmployerCapacity({ ...(emp as any), vacancySlots: updatedSlots });
  return {
    ok: true,
    student: {
      ...student,
      preferences: (student.preferences || []).map((p: any) => p.orgName === input.orgName
        ? { ...p, status: 'placed', slotId: target.id } : p),
      submissionStatus: 'placed', acceptedOrg: (emp as any).name,
      placedAt: student.placedAt || now.slice(0, 10),
    },
    employers: (input.employers || []).map((e: any) => e.id === updatedEmp.id ? updatedEmp : e),
  };
}

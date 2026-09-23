/**
 * The ONE way a lecture is written.
 *
 * Extracted from LecturesPage on 2026-09-23, unchanged in behaviour, because the new
 * academic-year screen has to be able to book a lecturer on a date and there must not
 * be two answers to "what happens when a lecture is saved". The brief for that screen
 * was explicit: reuse the existing create/edit flow rather than invent a second one.
 *
 * What a save actually involves, and why none of it can be re-typed at a second call
 * site without drifting:
 *   1. Outlook. A lecture that already carries a graphEventId is UPDATED in place;
 *      one that does not is CREATED and gets its id written back. Re-creating instead
 *      of updating would leave the lecturer holding two invitations.
 *   2. The employer-contact fill, with its FILL-NEVER-OVERWRITE rule. That rule is a
 *      bug fix with a comment longer than the code, and a second copy of this logic is
 *      exactly how it would come back.
 *   3. saveSnapshot, which is CAS-guarded — the lost-update protection every write in
 *      this app depends on.
 *   4. The in-place mutation of data.lectures, which is what makes the calling screen
 *      re-render with the new row before the cloud round-trip returns.
 *
 * Deliberately UI-free: no toast, no state setters, no navigation. It returns what
 * happened and the caller decides how to say it — which is what lets the lectures list
 * and the year grid both use it while each keeps its own feedback.
 */

import type { Lecture, PracticumData } from './supabase';
import { saveSnapshot } from './dataApi';
import * as ms from './msGraph';

export type LectureSaveResult =
  | { ok: true; lectures: Lecture[]; saved: Lecture; message: string }
  | { ok: false; error: string };

export type LectureDeleteResult =
  | { ok: true; lectures: Lecture[]; message: string }
  | { ok: false; error: string };

/**
 * Mirror a lecture into the Ariel Outlook calendar. Silent by design: a missing or
 * expired Microsoft session must never block the lecture from being saved to the cloud,
 * because the cloud is the record and Outlook is a convenience.
 */
export async function syncLectureToOutlook(
  lec: Lecture,
  mode: 'create' | 'update' | 'delete',
): Promise<Lecture> {
  if (!(await ms.isSignedIn())) return lec;
  if (!lec.date) return lec;
  try {
    if (mode === 'delete') {
      if (lec.graphEventId) await ms.deleteEvent(lec.graphEventId);
      return lec;
    }
    const payload: ms.EventInput = {
      subject: `${lec.type || 'הרצאה'}: ${lec.topic || lec.courseName || ''}`,
      startDate: lec.date,
      startTime: lec.startTime,
      endTime: lec.endTime,
      location: lec.link || lec.location || lec.institution,
      body: [
        lec.topic,
        lec.courseName ? 'קורס: ' + lec.courseName : '',
        lec.lecturer ? 'מרצה: ' + lec.lecturer : '',
        lec.notes || '',
      ].filter(Boolean).join('\n'),
      attendeeEmails: lec.lecturerEmail ? [lec.lecturerEmail] : [],
    };
    if (mode === 'update' && lec.graphEventId) {
      await ms.updateEvent(lec.graphEventId, payload);
      return lec;
    }
    const created = await ms.createEvent(payload);
    return created?.id ? { ...lec, graphEventId: created.id } : lec;
  } catch (e) {
    console.warn('Outlook sync failed:', e);
    return lec;
  }
}

/**
 * Fill in an employer's MISSING contact details from the lecturer's, when the lecturer
 * is that employer's contact person.
 *
 * FILL, NEVER OVERWRITE. This used to match an employer by the NAME of its contact
 * person and then replace that employer's mail and phone with the lecturer's. Two
 * people who share a name — or one person whose address for a guest lecture differs
 * from their work address — silently rewrote the contact details that every CV send,
 * reminder and feedback request then used, and the only sign was a few words appended
 * to a toast. An empty field is still worth filling in; a field that already holds
 * something different is the employer's, and stays.
 */
function fillEmployerContacts(
  data: PracticumData,
  lecture: Lecture,
): { employers: any[]; filledFor: string | null } {
  const allEmployers: any[] = data.employers || [];
  const lecName = (lecture.lecturer || '').trim().toLowerCase();
  if (!lecName) return { employers: allEmployers, filledFor: null };

  const empIdx = allEmployers.findIndex(
    (e: any) => (e.contactPerson || '').trim().toLowerCase() === lecName,
  );
  if (empIdx < 0) return { employers: allEmployers, filledFor: null };

  const emp = { ...allEmployers[empIdx] };
  let changed = false;
  if (lecture.lecturerEmail && !String(emp.contactEmail || '').trim()) {
    emp.contactEmail = lecture.lecturerEmail;
    changed = true;
  }
  if (lecture.lecturerPhone && !String(emp.contactPhone || '').trim()) {
    emp.contactPhone = lecture.lecturerPhone;
    changed = true;
  }
  if (!changed) return { employers: allEmployers, filledFor: null };

  const next = [...allEmployers];
  next[empIdx] = emp;
  return { employers: next, filledFor: emp.name };
}

/**
 * Create or update one lecture. Whether it is a create or an update is decided by
 * whether its id is already in `data.lectures` — the same test the lectures list has
 * always used, so the same lecture cannot be created twice from two screens.
 */
export async function saveLecture(
  lecture: Lecture,
  data: PracticumData,
  userName: string,
): Promise<LectureSaveResult> {
  const all = data.lectures || [];
  const idx = all.findIndex((l) => l.id === lecture.id);
  const isNew = idx < 0;

  const synced = await syncLectureToOutlook(lecture, isNew ? 'create' : 'update');

  let next: Lecture[];
  let message: string;
  if (isNew) {
    next = [...all, synced];
    message = '✓ הרצאה נוצרה';
  } else {
    next = [...all];
    next[idx] = synced;
    message = '✓ ההרצאה עודכנה';
  }

  const { employers, filledFor } = fillEmployerContacts(data, synced);
  if (filledFor) message += ` · הושלמו פרטי קשר חסרים ב${filledFor}`;

  const saveData = filledFor
    ? { ...data, lectures: next, employers }
    : { ...data, lectures: next };

  const res = await saveSnapshot(
    saveData,
    { name: userName },
    {
      action: isNew ? 'נוסף' : 'עודכן',
      entity: 'הרצאה',
      target: synced.topic || synced.courseName || 'הרצאה',
    },
  );
  if (!res.ok) return { ok: false, error: res.error || '' };

  // In-place, on purpose: the page props hold this same object, so the screen that
  // called us shows the new row on its next render instead of waiting for the refetch.
  (data.lectures as Lecture[]) = next;
  if (filledFor) (data.employers as any[]) = employers;

  return { ok: true, lectures: next, saved: synced, message };
}

/** Remove one lecture, and its Outlook event with it. */
export async function deleteLecture(
  id: string,
  data: PracticumData,
  userName: string,
): Promise<LectureDeleteResult> {
  const all = data.lectures || [];
  const lec = all.find((l) => l.id === id);
  if (lec) await syncLectureToOutlook(lec, 'delete');

  const next = all.filter((l) => l.id !== id);
  const res = await saveSnapshot(
    { ...data, lectures: next },
    { name: userName },
    { action: 'נמחק', entity: 'הרצאה', target: lec?.topic || lec?.courseName || 'הרצאה' },
  );
  if (!res.ok) return { ok: false, error: res.error || '' };

  (data.lectures as Lecture[]) = next;
  return { ok: true, lectures: next, message: '✓ ההרצאה נמחקה' };
}

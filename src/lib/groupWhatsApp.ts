/**
 * WhatsApp to a group of students — the plan behind the "WhatsApp לקבוצה" queue.
 *
 * A wa.me link opens ONE chat, and a page may not open many windows from one click, so
 * there is no "send to all" link. The queue opens the chats one at a time, each from its
 * own click, and the coordinator presses Send in WhatsApp (Yariv 2026-10-25, "כפתור
 * שיאפשר בחירה של כלל המשתתפים בקורס ושליחת הודעה שתגיע לכולם לווטסאפ האישי").
 *
 * Pure: decides who gets which link, and who cannot be reached and why. No windows here.
 */

import { buildWhatsAppUrl, isDialablePhone, firstNameOf } from './placement';

export type GroupWhatsAppEntry = { id: string; name: string; phone: string; url: string };

export type GroupWhatsAppPlan = {
  entries: GroupWhatsAppEntry[];
  /** No phone stored at all. */
  noPhone: string[];
  /** A phone is stored but would not dial (a missing digit, a stray character). */
  badPhone: string[];
};

/** `{{שם}}` is the student's first name — the same greeting the employer messages use. */
export function personalizeGroupMessage(body: string, fullName: string): string {
  return String(body ?? '').replace(/\{\{שם\}\}/g, firstNameOf(fullName));
}

export function planGroupWhatsApp(
  students: Array<{ id: string; name: string; phone?: string }>,
  body: string,
): GroupWhatsAppPlan {
  const plan: GroupWhatsAppPlan = { entries: [], noPhone: [], badPhone: [] };
  for (const s of students) {
    const phone = String(s.phone || '').trim();
    if (!phone) { plan.noPhone.push(s.name); continue; }
    if (!isDialablePhone(phone)) { plan.badPhone.push(s.name); continue; }
    plan.entries.push({ id: s.id, name: s.name, phone, url: buildWhatsAppUrl(phone, personalizeGroupMessage(body, s.name)) });
  }
  return plan;
}

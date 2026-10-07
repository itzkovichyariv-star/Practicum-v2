/**
 * emailApi.ts — thin wrappers around Supabase edge functions for
 * sending acceptance / rejection emails.
 *
 * Both functions are fire-and-forget safe: they return { ok, sent, error? }
 * but callers don't need to await them if they don't want feedback.
 */

import { supabase } from './supabase';

const EDGE = 'https://vpqgmcmavnszcnakhiat.supabase.co/functions/v1';
const ANON  = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';

async function getToken(): Promise<string> {
  const { data: sess } = await supabase.auth.getSession();
  return sess.session?.access_token || ANON;
}

/** Send acceptance email + CV-update link to a candidate/student.
 * courseId is optional but recommended — the Edge Function uses it to
 * substitute the workshop date from course.workshopDate. */
export async function sendAcceptanceEmail(
  person: { name?: string; email: string; courseId?: string },
): Promise<{ ok: boolean; sent: boolean; error?: string }> {
  try {
    const token = await getToken();
    const r = await fetch(`${EDGE}/notify-acceptance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': ANON,
      },
      body: JSON.stringify({ candidate: person }),
    });
    const result = await r.json();
    return { ok: r.ok, sent: r.ok, ...result };
  } catch (e: any) {
    return { ok: false, sent: false, error: e.message };
  }
}

/** Send rejection notification email */
export async function sendRejectionEmail(
  person: { name?: string; email: string },
): Promise<{ ok: boolean; sent: boolean; error?: string }> {
  try {
    const token = await getToken();
    const r = await fetch(`${EDGE}/notify-rejection`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': ANON,
      },
      body: JSON.stringify({ person }),
    });
    const result = await r.json();
    return { ok: r.ok, sent: r.ok, ...result };
  } catch (e: any) {
    return { ok: false, sent: false, error: e.message };
  }
}

/**
 * Send bulk emails — returns counts of sent / failed / skipped (no email).
 * type: 'acceptance' | 'rejection'
 */
export async function sendBulkEmails(
  people: { name?: string; email?: string }[],
  type: 'acceptance' | 'rejection',
): Promise<{ sent: number; failed: number; skipped: number }> {
  const fn = type === 'acceptance' ? sendAcceptanceEmail : sendRejectionEmail;
  let sent = 0, failed = 0, skipped = 0;
  for (const p of people) {
    if (!p.email) { skipped++; continue; }
    const res = await fn({ name: p.name, email: p.email });
    res.sent ? sent++ : failed++;
  }
  return { sent, failed, skipped };
}

/**
 * Tell a student their placement is settled. Two events, one function, because
 * the student sees them as the same moment: "where am I doing my practicum".
 *
 *  'placed'       the organization they asked to be screened for accepted them
 *                 and the coordinator moved the card to שובץ.
 *  'org-approved' the organization THEY proposed was approved by the supervisor.
 *
 * Fire-and-forget safe: a failure here must never block the save that already
 * happened, so callers log the result rather than aborting.
 */
export async function sendPlacementEmail(
  student: { name?: string; email?: string | null },
  orgName: string,
  kind: 'placed' | 'org-approved',
): Promise<{ ok: boolean; sent: boolean; error?: string }> {
  const to = (student.email || '').trim();
  if (!to) return { ok: false, sent: false, error: 'no email' };
  try {
    const token = await getToken();
    const r = await fetch(`${EDGE}/notify-placement`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': ANON,
      },
      body: JSON.stringify({ student: { name: student.name, email: to }, orgName, kind }),
    });
    const result = await r.json();
    return { ok: r.ok, sent: r.ok, ...result };
  } catch (e: any) {
    return { ok: false, sent: false, error: e.message };
  }
}

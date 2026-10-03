/**
 * Push the app's calendar into Google — see gcalModel.ts (WHAT) and the gcal-sync edge
 * function (HOW). Fire-and-forget: Google is a mirror, so a failure here must never
 * block or undo a save. Calls within a second collapse into one.
 */

import type { PracticumData } from './supabase';
import { desiredGoogleEvents } from './gcalModel';
import { todayIso } from './academicCalendar';

const EDGE = 'https://vpqgmcmavnszcnakhiat.supabase.co/functions/v1';
const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';

export type GcalSyncResult =
  | { ok: true; configured: false }
  | { ok: true; configured: true; created: number; updated: number; deleted: number; unchanged: number }
  | { ok: false; error: string };

export async function syncGoogleNow(data: PracticumData): Promise<GcalSyncResult> {
  try {
    const events = desiredGoogleEvents(data, todayIso());
    const r = await fetch(`${EDGE}/gcal-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
      body: JSON.stringify({ events }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) return { ok: false, error: j.error || `HTTP ${r.status}` };
    return j as GcalSyncResult;
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** After a save: sync shortly, once, in the background. */
export function syncGoogleSoon(data: PracticumData): void {
  if (typeof window === 'undefined') return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    syncGoogleNow(data).then((r) => { if (!r.ok) console.warn('Google sync failed:', r.error); });
  }, 1000);
}

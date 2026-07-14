import { supabase, type PracticumData } from './supabase';

/* ── saveSnapshot ──────────────────────────────────────────────────────── */

/** Critical arrays that must never silently drop to zero. */
const GUARDED_KEYS = ['students', 'employers', 'courses', 'trainers', 'lectures', 'candidates'] as const;

/** Minimum count that triggers the regression guard. */
const REGRESSION_FLOOR = 3;

export async function saveSnapshot(
  data: PracticumData,
  editor: { name: string },
  activity?: { action: string; entity: string; target: string },
): Promise<{ ok: boolean; updated_at?: string; error?: string }> {
  const MAX_ATTEMPTS = 5;

  // Build the write payload from a freshly-read cloud row: merge (cloud is the
  // base, incoming `data` wins per key) + regression guard + history append.
  // Returns { blocked } if the regression guard trips.
  const build = (currentRow: any):
    | { blocked: string }
    | { now: string; currentVersion: number; version: number; payload: any; dataWithHistory: PracticumData } => {
    const now = new Date().toISOString();
    const cloudData: PracticumData = currentRow?.data || {};
    const currentVersion: number = currentRow?.version || 0;

    // Merge: cloud state is the base, incoming data wins for any key it provides.
    // Arrays/objects in `data` fully replace their cloud counterparts (no deep merge).
    const merged: PracticumData = { ...cloudData, ...data };

    // ── Regression guard ── block any save where a key that had ≥ REGRESSION_FLOOR
    // records in the cloud would be reduced to 0 (catches accidental full-wipes).
    for (const key of GUARDED_KEYS) {
      const cloudCount = ((cloudData as any)[key] as any[] | undefined)?.length ?? 0;
      const mergedCount = ((merged as any)[key] as any[] | undefined)?.length ?? 0;
      if (cloudCount >= REGRESSION_FLOOR && mergedCount === 0) {
        const msg = `[Regression guard] Blocked save: "${key}" would drop from ${cloudCount} → 0. Pass the full array or omit the key.`;
        console.error(msg);
        return { blocked: msg };
      }
    }

    const historyEntry = activity
      ? { ts: now, who: editor.name, action: activity.action, entity: activity.entity, target: activity.target }
      : null;
    const existingHistory: any[] = (merged as any).history || [];
    const history = historyEntry ? [historyEntry, ...existingHistory].slice(0, 200) : existingHistory;
    const version = currentVersion + 1;
    const payload = { data: { ...merged, history }, updated_at: now, last_editor_name: editor.name, version };
    const dataWithHistory: PracticumData = { ...merged, history };
    return { now, currentVersion, version, payload, dataWithHistory };
  };

  let lastError: string | undefined;

  // ── Optimistic-concurrency loop (compare-and-swap on `version`) ───────────
  // Read → merge → write guarded by the exact version we read. If another
  // writer committed in between, the `.eq('version', …)` matches 0 rows; we
  // re-read and retry so a concurrent save can NEVER silently revert a field it
  // didn't touch (the lost-update that dropped feedback tokens — 2026-07-08).
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data: currentRow, error: readErr } = await supabase
      .from('practicum_data')
      .select('data, version')
      .eq('org_id', 'default')
      .single();
    if (readErr) { lastError = readErr.message; break; }

    const built = build(currentRow);
    if ('blocked' in built) return { ok: false, error: built.blocked };

    const { data: updatedRows, error } = await supabase
      .from('practicum_data')
      .update(built.payload)
      .eq('org_id', 'default')
      .eq('version', built.currentVersion)
      .select('version');
    if (error) { lastError = error.message; break; }

    if (updatedRows && updatedRows.length > 0) {
      writeVersionedSnapshot(built.dataWithHistory, editor, activity, built.version);
      return { ok: true, updated_at: built.now };
    }
    // 0 rows updated → version moved under us; loop re-reads fresh and retries.
    lastError = 'concurrent update';
  }

  // ── Safety floor ─────────────────────────────────────────────────────────
  // CAS retries exhausted (heavy contention) or a transient read glitch. Fall
  // back to ONE unguarded last-writer-wins write so a save NEVER fails where it
  // would have succeeded before this fix. Worst case = pre-fix behavior.
  const { data: fallbackRow } = await supabase
    .from('practicum_data')
    .select('data, version')
    .eq('org_id', 'default')
    .single();
  const built = build(fallbackRow);
  if ('blocked' in built) return { ok: false, error: built.blocked };
  const { error } = await supabase
    .from('practicum_data')
    .update(built.payload)
    .eq('org_id', 'default');
  if (error) return { ok: false, error: error.message || lastError };
  writeVersionedSnapshot(built.dataWithHistory, editor, activity, built.version);
  return { ok: true, updated_at: built.now };
}

/* ── randomId ──────────────────────────────────────────────────────────── */

export function randomId(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

/* ── Employer-feedback links ────────────────────────────────────────────── */

/**
 * Canonical production host for employer-feedback links. Hardcoded (NOT
 * window.location.origin) so a link sent to an employer always points at prod
 * even when the admin is on a preview/localhost build — an employer can never
 * receive a dead localhost/preview link.
 */
export const FEEDBACK_BASE_URL = 'https://practicum.yarivitzkovich.org';

/**
 * Build the shortest possible feedback URL from a token: `/f?t=<token>`.
 * The short route + short query keep the whole URL well under every mail-client
 * line-wrap threshold, so the `?t=…` can't be split off in a plain-text email.
 * The legacy `/feedback?token=…` route still resolves for already-sent links.
 */
export function buildFeedbackUrl(token: string): string {
  return `${FEEDBACK_BASE_URL}/f?t=${encodeURIComponent(token)}`;
}

/**
 * @deprecated Use ensureFeedbackToken (stable + DB-verified) + buildFeedbackUrl.
 * Kept only so any old caller still compiles. Generates a fresh token/URL but
 * does NOT persist — do not use for new code.
 */
export function generateFeedbackUrl(studentId: string, baseUrl: string): { token: string; url: string } {
  const token = `fb-${studentId}-${Math.random().toString(36).slice(2, 8)}`;
  const url = `${baseUrl}/feedback?token=${encodeURIComponent(token)}`;
  return { token, url };
}

/**
 * Return a STABLE, database-verified feedback token + URL for a student.
 *
 * Robustness contract (the whole point of this function):
 *  1. Reads the student's CURRENT token from the cloud (not stale UI state), so
 *     an existing token is NEVER regenerated — a link already sent to an
 *     employer stays valid forever.
 *  2. If no token exists, it creates one, persists it via the CAS-guarded
 *     saveSnapshot, then READS IT BACK to confirm it actually landed. A URL is
 *     only ever returned once its token is verified live in the DB.
 *  3. Retries the create+verify loop on the rare concurrent-write miss.
 *
 * Callers must treat `ok === false` as "do not send a link".
 */
export async function ensureFeedbackToken(
  studentId: string,
  editorName: string,
): Promise<{ ok: boolean; token?: string; url?: string; error?: string }> {
  const MAX_ATTEMPTS = 4;
  let lastError = 'שמירת קישור המשוב נכשלה';

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 1. Read the freshest cloud state.
    const { data: row, error: readErr } = await supabase
      .from('practicum_data')
      .select('data')
      .eq('org_id', 'default')
      .single();
    if (readErr || !row) { lastError = readErr?.message || 'קריאת הנתונים מהענן נכשלה'; continue; }

    const d = ((row as any).data || {}) as PracticumData;
    const students = (d.students || []) as any[];
    const idx = students.findIndex((s) => s.id === studentId);
    if (idx < 0) return { ok: false, error: 'הסטודנט/ית לא נמצא/ה בענן — רענן/י ונסה/י שוב' };

    // 2. An existing token always wins — never mint a second one.
    const existing = students[idx].feedbackToken;
    if (existing) return { ok: true, token: existing, url: buildFeedbackUrl(existing) };

    // 3. Mint, persist (CAS-guarded), then verify by read-back.
    //    Stamp feedbackRequestedAt at the SAME moment the first token is minted — this
    //    is the single choke-point every send path (email/WhatsApp/copy-link) funnels
    //    through, so it anchors the weekly feedback-reminders clock for free. Preserve
    //    any pre-existing value so the "first request" time never drifts.
    const token = `fb-${studentId}-${Math.random().toString(36).slice(2, 8)}`;
    const requestedAt = students[idx].feedbackRequestedAt || new Date().toISOString();
    const nextStudents = students.map((s, i) => (i === idx ? { ...s, feedbackToken: token, feedbackRequestedAt: requestedAt } : s));
    const res = await saveSnapshot(
      { ...d, students: nextStudents },
      { name: editorName },
      { action: 'נוצר קישור משוב מעסיק', entity: 'סטודנט', target: students[idx].name || studentId },
    );
    if (!res.ok) { lastError = res.error || lastError; continue; }

    const { data: verifyRow } = await supabase
      .from('practicum_data')
      .select('data')
      .eq('org_id', 'default')
      .single();
    const confirmed = (((verifyRow as any)?.data?.students || []) as any[])
      .find((s) => s.id === studentId)?.feedbackToken;
    if (confirmed === token) return { ok: true, token, url: buildFeedbackUrl(token) };
    // Read-back didn't match (a concurrent writer landed) — loop and retry.
    lastError = 'אימות שמירת הקישור נכשל';
  }

  return { ok: false, error: lastError };
}

/* ── Versioned snapshots ────────────────────────────────────────────────
   Table SQL (run once in Supabase dashboard → SQL Editor):

   create table public.practicum_snapshots (
     id uuid default gen_random_uuid() primary key,
     created_at timestamptz default now() not null,
     editor_name text,
     action text,
     entity text,
     target text,
     version integer default 0,
     data jsonb not null
   );
   alter table public.practicum_snapshots enable row level security;
   create policy "auth users" on public.practicum_snapshots
     for all to authenticated using (true) with check (true);
   ──────────────────────────────────────────────────────────────────── */

const MAX_SNAPSHOTS = 50;

export type SnapshotMeta = {
  id: string;
  created_at: string;
  editor_name: string;
  action: string;
  entity: string;
  target: string;
  version: number;
};

/** Called inside saveSnapshot — writes a versioned copy silently (fails gracefully if table missing). */
async function writeVersionedSnapshot(
  data: PracticumData,
  editor: { name: string },
  activity: { action: string; entity: string; target: string } | undefined,
  version: number,
): Promise<void> {
  try {
    const { error } = await supabase.from('practicum_snapshots').insert({
      editor_name: editor.name,
      action: activity?.action || 'שמירה',
      entity: activity?.entity || '',
      target: activity?.target || '',
      version,
      data,
    });
    if (error) return; // table may not exist yet — silent
    // Prune: keep only last MAX_SNAPSHOTS
    const { data: old } = await supabase
      .from('practicum_snapshots')
      .select('id, created_at')
      .order('created_at', { ascending: false })
      .range(MAX_SNAPSHOTS, 999);
    if (old && old.length > 0) {
      await supabase
        .from('practicum_snapshots')
        .delete()
        .in('id', (old as any[]).map((r: any) => r.id));
    }
  } catch { /* silent */ }
}

/** Load snapshot metadata list (no data payload — light query). */
export async function loadSnapshots(): Promise<SnapshotMeta[]> {
  try {
    const { data } = await supabase
      .from('practicum_snapshots')
      .select('id, created_at, editor_name, action, entity, target, version')
      .order('created_at', { ascending: false })
      .limit(MAX_SNAPSHOTS);
    return (data || []) as SnapshotMeta[];
  } catch { return []; }
}

/** Auto-snapshot heartbeat: called on app load. Creates a snapshot if none exists
 *  within the last AUTO_SNAPSHOT_INTERVAL_MS, ensuring there is always a recent
 *  recoverable backup even if the user makes no changes. Silent — never throws. */
const AUTO_SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function ensureAutoSnapshot(
  data: PracticumData,
  editor: { name: string },
): Promise<void> {
  try {
    // Check timestamp of the most recent snapshot
    const { data: latest } = await supabase
      .from('practicum_snapshots')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const lastTs = latest ? new Date((latest as any).created_at).getTime() : 0;
    const age = Date.now() - lastTs;
    if (age < AUTO_SNAPSHOT_INTERVAL_MS) return; // recent enough

    // Write a heartbeat snapshot with current date + record counts
    const dateStr = new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });
    const counts = [
      data.students?.length ? `${data.students.length} סטודנטים` : '',
      data.candidates?.length ? `${data.candidates.length} מועמדים` : '',
      data.lectures?.length ? `${data.lectures.length} הרצאות` : '',
    ].filter(Boolean).join(' · ');
    await writeVersionedSnapshot(
      data,
      editor,
      { action: 'גיבוי אוטומטי', entity: dateStr, target: counts || 'heartbeat' },
      0, // version 0 = heartbeat (doesn't bump main version)
    );
  } catch { /* silent */ }
}

/** Load full data from a specific snapshot (for restore). */
export async function restoreSnapshot(
  id: string,
): Promise<{ ok: boolean; data?: PracticumData; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('practicum_snapshots')
      .select('data')
      .eq('id', id)
      .single();
    if (error || !data) return { ok: false, error: error?.message || 'לא נמצא' };
    return { ok: true, data: (data as any).data as PracticumData };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

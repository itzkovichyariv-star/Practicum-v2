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
  const now = new Date().toISOString();

  // ── Safety merge: always read current cloud state first ──────────────────
  // This prevents partial saves (e.g. { lectures } only) from wiping other
  // fields (students, employers, courses…) that weren't included in `data`.
  const { data: currentRow } = await supabase
    .from('practicum_data')
    .select('data, version')
    .eq('org_id', 'default')
    .single();

  const cloudData: PracticumData = (currentRow as any)?.data || {};

  // Merge: cloud state is the base, incoming data wins for any key it provides.
  // Arrays/objects in `data` fully replace their cloud counterparts (no deep merge).
  const merged: PracticumData = { ...cloudData, ...data };

  // ── Regression guard ─────────────────────────────────────────────────────
  // Block any save where a key that had ≥ REGRESSION_FLOOR records in the cloud
  // would be reduced to 0. This catches accidental full-wipes.
  for (const key of GUARDED_KEYS) {
    const cloudCount = ((cloudData as any)[key] as any[] | undefined)?.length ?? 0;
    const mergedCount = ((merged as any)[key] as any[] | undefined)?.length ?? 0;
    if (cloudCount >= REGRESSION_FLOOR && mergedCount === 0) {
      const msg = `[Regression guard] Blocked save: "${key}" would drop from ${cloudCount} → 0. Pass the full array or omit the key.`;
      console.error(msg);
      return { ok: false, error: msg };
    }
  }

  // Append history entry
  const historyEntry = activity
    ? { ts: now, who: editor.name, action: activity.action, entity: activity.entity, target: activity.target }
    : null;

  const existingHistory: any[] = (merged as any).history || [];
  const history = historyEntry
    ? [historyEntry, ...existingHistory].slice(0, 200)
    : existingHistory;

  const version = ((currentRow as any)?.version || 0) + 1;

  const payload = {
    data: { ...merged, history },
    updated_at: now,
    last_editor_name: editor.name,
    version,
  };

  const dataWithHistory: PracticumData = { ...merged, history };

  const { error } = await supabase
    .from('practicum_data')
    .update(payload)
    .eq('org_id', 'default');

  if (error) return { ok: false, error: error.message };
  // Write versioned snapshot (fire-and-forget, silent failure)
  writeVersionedSnapshot(dataWithHistory, editor, activity, payload.version);
  return { ok: true, updated_at: now };
}

/* ── randomId ──────────────────────────────────────────────────────────── */

export function randomId(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
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
const AUTO_SNAPSHOT_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

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

    // Write a heartbeat snapshot
    await writeVersionedSnapshot(
      data,
      editor,
      { action: 'גיבוי אוטומטי', entity: 'מערכת', target: 'heartbeat' },
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

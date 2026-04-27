import { supabase, type PracticumData } from './supabase';

/* ── saveSnapshot ──────────────────────────────────────────────────────── */

export async function saveSnapshot(
  data: PracticumData,
  editor: { name: string },
  activity?: { action: string; entity: string; target: string },
): Promise<{ ok: boolean; updated_at?: string; error?: string }> {
  const now = new Date().toISOString();

  // Append history entry
  const historyEntry = activity
    ? { ts: now, who: editor.name, action: activity.action, entity: activity.entity, target: activity.target }
    : null;

  const existingHistory: any[] = (data as any).history || [];
  const history = historyEntry
    ? [historyEntry, ...existingHistory].slice(0, 200)
    : existingHistory;

  // Read current version
  const { data: current } = await supabase
    .from('practicum_data')
    .select('version')
    .eq('org_id', 'default')
    .single();

  const version = ((current as any)?.version || 0) + 1;

  const payload = {
    data: { ...data, history },
    updated_at: now,
    last_editor_name: editor.name,
    version,
  };

  const dataWithHistory: PracticumData = { ...data, history };

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

const MAX_SNAPSHOTS = 30;

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

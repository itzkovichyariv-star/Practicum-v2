import { useEffect, useRef, useState } from 'react';

/**
 * Keep what a person types, as they type it.
 *
 * BINDING GROUND RULE (Yariv 2026-07-20): "the recorded data should be kept
 * automatically while typed. that way if they go back to the same link nothing is
 * lost — this should be a ground rule in any current planning or future and should
 * be placed on all open ended."
 *
 * Born from a real loss: the employer-feedback form held everything in React memory
 * only. Two supervisors filled it, hit a separate submit blocker, and every word they
 * had written was unrecoverable — nothing was stored locally or server-side.
 *
 * Never rely on the submit being reached. Persist continuously, restore on return,
 * and clear only once the data is safely saved.
 *
 * Usage:
 *   const draft = useFormDraft(token && `practicum_draft_feedback_${token}`, 'v2',
 *     { strengths, improvements, score },
 *     (v) => { if (v.strengths) setStrengths(v.strengths); ... });
 *   ...on success: draft.clear();
 *   ...in the UI: {draft.savedAt && <span>נשמר אוטומטית</span>}
 */
export function useFormDraft<T extends Record<string, unknown>>(
  /** Stable per-person key, or null/'' to disable (e.g. before identity is known). */
  key: string | null | undefined,
  /** Bump when the form's shape changes, so a stale draft is never restored into it. */
  version: string,
  /** The live values to persist. */
  values: T,
  /** Called ONCE on mount when a compatible draft exists. */
  onRestore: (values: Partial<T>) => void,
  opts?: { debounceMs?: number },
): { savedAt: number | null; restored: boolean; clear: () => void } {
  const debounceMs = opts?.debounceMs ?? 400;
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  const restoreDone = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Restore once, before we ever write, so we can't overwrite a draft with the
  //    empty initial state of a freshly mounted form.
  useEffect(() => {
    if (!key || restoreDone.current) return;
    restoreDone.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== version || !parsed.values) {
        localStorage.removeItem(key); // shape changed — a stale draft is worse than none
        return;
      }
      onRestore(parsed.values as Partial<T>);
      setRestored(true);
      if (typeof parsed.at === 'number') setSavedAt(parsed.at);
    } catch {
      /* private mode / corrupt entry — proceed without a draft */
    }
  }, [key, version]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist (debounced) on every change.
  useEffect(() => {
    if (!key || !restoreDone.current) return;
    // Don't write an all-empty form — it would create noise entries and, worse,
    // clobber a real draft during the first render pass after a restore attempt.
    const hasContent = Object.values(values).some(v =>
      typeof v === 'string' ? v.trim() !== ''
        : v && typeof v === 'object' ? Object.keys(v as object).length > 0
        : v !== undefined && v !== null && v !== false && v !== '');
    if (!hasContent) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const at = Date.now();
        localStorage.setItem(key, JSON.stringify({ v: version, at, values }));
        setSavedAt(at);
      } catch {
        /* quota / private mode — typing must never break because saving failed */
      }
    }, debounceMs);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [key, version, values, debounceMs]);

  function clear() {
    if (timer.current) clearTimeout(timer.current);
    try { if (key) localStorage.removeItem(key); } catch { /* ignore */ }
    setSavedAt(null);
  }

  return { savedAt, restored, clear };
}

/** "נשמר אוטומטית · לפני רגע" — a quiet reassurance so nobody retypes out of doubt. */
export function draftSavedLabel(savedAt: number | null): string {
  if (!savedAt) return '';
  const secs = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
  if (secs < 60) return 'נשמר אוטומטית · לפני רגע';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `נשמר אוטומטית · לפני ${mins} דק׳`;
  return 'נשמר אוטומטית';
}

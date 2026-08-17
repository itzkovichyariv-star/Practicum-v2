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
 * ── 2026-08-17: the rule was failing on every form whose key is typed ──────────
 * The registration draft is keyed by the candidate's own email, so the key changes
 * with every keystroke of that field: a… ad… adi… This hook used to restore ONCE,
 * for the first non-null key it ever saw — a one-letter key that is always empty —
 * and never looked again. It then began persisting the still-blank form under the
 * finished-email key, which is exactly where last visit's answers lived. Returning
 * to the link did not merely fail to restore; it DESTROYED the draft. Proven with
 * scripts/register-draft-check.mjs, which goes red on the previous version.
 *
 * Three changes close it, and all three are no-ops for a key that never changes
 * (the employer-feedback token), so the one form that worked keeps behaving
 * identically:
 *   1. restore is attempted once PER KEY, not once per mount;
 *   2. a restore only FILLS BLANKS — it can never overwrite live typing;
 *   3. "is this empty?" recurses, so a form of blank answers reads as blank. The
 *      old check asked only whether an object HAD fields, which is true of every
 *      form object ever, blank or not — that is what let blanks overwrite answers.
 *
 * Usage:
 *   const draft = useFormDraft(token && `practicum_draft_feedback_${token}`, 'v2',
 *     { strengths, improvements, score },
 *     (v) => { if (v.strengths) setStrengths(v.strengths); ... });
 *   ...on success: draft.clear();
 *   ...in the UI: {draft.savedAt && <span>נשמר אוטומטית</span>}
 */

/**
 * Is there anything in here a person would be sorry to lose?
 *
 * Recurses deliberately: `{ studyTracks: '', gpa: '', … }` is EMPTY, even though it
 * has nine fields. Treating it as content is what allowed a freshly-mounted form to
 * overwrite a real draft.
 */
export function hasDraftContent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return !Number.isNaN(v);
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.some(hasDraftContent);
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some(hasDraftContent);
  return true;
}

/**
 * The part of a stored draft that is safe to put back: every field the person has
 * NOT already filled on screen. Whatever is on screen always wins, so restoring can
 * never delete a word someone just typed — including the email they are mid-way
 * through re-entering, which is what selects the draft in the first place.
 *
 * Returns undefined when there is nothing to contribute.
 */
export function fillBlanksOnly(stored: unknown, current: unknown): unknown {
  if (!hasDraftContent(current)) return hasDraftContent(stored) ? stored : undefined;
  const bothPlainObjects =
    !!stored && !!current &&
    typeof stored === 'object' && typeof current === 'object' &&
    !Array.isArray(stored) && !Array.isArray(current);
  if (!bothPlainObjects) return undefined; // current has content and isn't mergeable — keep it
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    const merged = fillBlanksOnly(v, (current as Record<string, unknown>)[k]);
    if (merged !== undefined && hasDraftContent(merged)) out[k] = merged;
  }
  return Object.keys(out).length ? out : undefined;
}

export function useFormDraft<T extends Record<string, unknown>>(
  /** Stable per-person key, or null/'' to disable (e.g. before identity is known). */
  key: string | null | undefined,
  /** Bump when the form's shape changes, so a stale draft is never restored into it. */
  version: string,
  /** The live values to persist. */
  values: T,
  /** Called when a compatible draft exists, with ONLY the fields still blank on screen. */
  onRestore: (values: Partial<T>) => void,
  opts?: { debounceMs?: number },
): { savedAt: number | null; restored: boolean; clear: () => void } {
  const debounceMs = opts?.debounceMs ?? 400;
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  /** Keys we have already looked under. The email-derived key changes as it is typed,
   *  and each new key deserves its own look — that is the whole fix. */
  const triedKeys = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read through refs so the restore effect depends on the key alone and never
  // re-runs (or restores stale values) just because the form re-rendered.
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  // ── Look under this key, once per key, BEFORE we ever write under it, so we can
  //    never overwrite a draft with the empty state of a freshly mounted form.
  useEffect(() => {
    if (!key || triedKeys.current.has(key)) return;
    triedKeys.current.add(key);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== version || !parsed.values) {
        localStorage.removeItem(key); // shape changed — a stale draft is worse than none
        return;
      }
      const toRestore = fillBlanksOnly(parsed.values, valuesRef.current);
      if (!toRestore) return; // everything it holds is already on screen
      onRestoreRef.current(toRestore as Partial<T>);
      setRestored(true);
      if (typeof parsed.at === 'number') setSavedAt(parsed.at);
    } catch {
      /* private mode / corrupt entry — proceed without a draft */
    }
  }, [key, version]);

  // ── Persist (debounced) on every change, but never under a key we haven't looked
  //    under yet — that ordering is what stops a blank form clobbering real answers.
  useEffect(() => {
    if (!key || !triedKeys.current.has(key)) return;
    if (!hasDraftContent(values)) return;

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

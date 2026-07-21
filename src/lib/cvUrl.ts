import { supabase } from './supabase';

/**
 * Turn a stored CV reference into a real, openable public URL.
 *
 * CVs are stored three ways across the app's history:
 *   • `https://…`                     — a full URL (pass through)
 *   • `storage://<bucket>/<path>`     — the current convention (applyPendingCv,
 *                                        StudentsPage auto-promote, /cv-update upload)
 *   • `<bucket-relative path>.pdf`    — legacy, saved before the storage:// prefix
 *
 * The `candidate-uploads` bucket is public, so `getPublicUrl` yields a link anyone
 * (an employer) can open. Everything that OPENS, COPIES, or SENDS a CV must go
 * through here — FileField already resolved storage:// for the editor, but
 * PlacementPanel sent the raw `storage://…` to employers, i.e. a dead link. All 11
 * תשפ״ז students have `storage://` CVs (found 2026-07-21), so every dispatch would
 * have delivered a broken link.
 */
export function resolveCvUrl(value: string | null | undefined): string {
  const v = (value || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const m = v.match(/^storage:\/\/([^/]+)\/(.+)$/);
  const bucket = m ? m[1] : 'candidate-uploads';
  const path = m ? m[2] : v; // bare legacy path → assume the candidate-uploads bucket
  try {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl || v;
  } catch {
    return v; // never throw from a link builder — worst case, return the raw value
  }
}

/**
 * A link that opens the CV in a browser. Word files can't render inline, so route
 * them through the Microsoft Office Online viewer; PDFs open directly. Use for the
 * coordinator's "open" button and for a link handed to an employer to VIEW.
 */
export function viewableCvUrl(value: string | null | undefined): string {
  const url = resolveCvUrl(value);
  if (!url) return '';
  const isWord = /\.(docx?|doc)$/i.test(url.split('?')[0]);
  return isWord ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}` : url;
}

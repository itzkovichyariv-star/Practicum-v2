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
 * Does the stored reference actually resolve to an object?
 *
 * A blank tab is the worst failure this code can produce, because it is AMBIGUOUS.
 * Four different faults render identically and only ONE of them means "there is no CV":
 *
 *   · nothing is stored on the record at all
 *   · the object is not in the bucket — a path saved before a rename, a failed upload
 *   · the bucket is not public, so the URL 400s
 *   · the file is Word and a viewer declined it
 *
 * A coordinator reading a blank tab concludes the first every time, and the other three
 * are the fixable ones. So the probe exists to tell them apart — and ONLY to tell them
 * apart. It runs after the file has already been handed over (see openCv), because a
 * check that can withhold a file will eventually withhold a good one, and did:
 * `unreachable` is what a CORS-blocked HEAD returns, and it is not evidence of anything.
 */
export type CvProbe = { ok: boolean; url: string; status: number; reason: string };

export async function probeCvUrl(value: string | null | undefined): Promise<CvProbe> {
  const url = resolveCvUrl(value);
  if (!url) return { ok: false, url: '', status: 0, reason: 'no-reference' };
  try {
    // HEAD is enough and costs no bandwidth; Supabase's public objects answer CORS.
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (r.ok) return { ok: true, url, status: r.status, reason: '' };
    return { ok: false, url, status: r.status, reason: r.status === 404 ? 'not-found' : 'http-error' };
  } catch (e: any) {
    // A network or CORS failure is not proof the file is missing, and must not be
    // reported as though it were.
    return { ok: false, url, status: 0, reason: 'unreachable' };
  }
}

/**
 * Open a stored CV. One mechanism, every platform, no blank tab at any point.
 *
 * This is the fifth attempt at one bug — "קורות חיים של עדי גורביץ לא נפתחות, נותן דף
 * לבן" — and the previous four all tuned a mechanism that was wrong to begin with:
 * open a blank tab, hold it, await a network round-trip, then navigate it. Every layer
 * of that is somewhere a tab can get stuck showing nothing:
 *
 *   · a popup blocker refuses the window and there is no tab at all;
 *   · an installed PWA has no tab bar, so iOS declines it silently — Yariv's phone;
 *   · `w.location.href = …` on a held blank tab does not reliably navigate, and when it
 *     does not, the reader is looking at exactly the blank page this set out to remove;
 *   · Microsoft's Office Online viewer answers with an empty frame whenever it cannot fetch the
 *     file, which is a blank page we chose on purpose.
 *
 * The last two are the ones his own evidence named: it opened when he PASTED the link
 * (the raw file, no held tab) and it opened for some people and not others (PDF against
 * Word). The mechanism, not the file, was the fault every time.
 *
 * So: a real anchor click to the real file, inside the gesture that asked for it. It is
 * the one navigation every browser, every popup blocker and every standalone app agrees
 * about, and it has no intermediate state to get stuck in. The probe still runs — after
 * the hand-off, where it can inform without being able to withhold — and a definitive
 * 404 or 400 is told to the coordinator rather than left as a mystery.
 *
 * Word is handed over RAW, never through the Office viewer. iOS previews .docx; a
 * desktop downloads it and opens Word. Both beat a viewer that renders nothing.
 */
export async function openCv(value: string | null | undefined): Promise<CvProbe> {
  const raw = (value || '').trim();
  const url = resolveCvUrl(raw);

  if (!url) {
    try { window.alert('לא נשמר קובץ קו״ח על הרשומה הזו.'); } catch { /* no alert here */ }
    return { ok: false, url: '', status: 0, reason: 'no-reference' };
  }

  // Synchronous, and FIRST: everything after this line is allowed to fail without it
  // costing the coordinator the file.
  handOff(url);

  return warnIfCvUnreadable(raw);
}

/**
 * Probe a stored CV and tell the coordinator if the storage itself refused it.
 *
 * Split out of openCv so a REAL anchor — the browser's own navigation, which is the most
 * reliable hand-off there is — can keep the diagnosis without also handing the file over
 * a second time. A chip with a live `href` calls this from its click and lets the
 * browser do the opening.
 */
export async function warnIfCvUnreadable(value: string | null | undefined): Promise<CvProbe> {
  const raw = (value || '').trim();
  const probe = await probeCvUrl(raw);
  // `unreachable` means the probe could not READ an answer — CORS on a HEAD, a captive
  // network — and says nothing about the file. Only a real HTTP answer is worth raising.
  if (!probe.ok && probe.reason !== 'unreachable' && probe.reason !== 'no-reference') {
    const why = probe.reason === 'not-found'
      ? 'הקובץ לא נמצא באחסון — הנתיב השמור מצביע על קובץ שאינו קיים, בדרך כלל העלאה שנכשלה או קובץ שנמחק.'
      : `האחסון החזיר שגיאה ${probe.status}. אם זה 400, ה־bucket כנראה אינו ציבורי.`;
    try {
      window.alert(`הלשונית שנפתחה כנראה לא תציג את קובץ קו״ח.\n\n${why}\n\nמה שמור ברשומה:\n${raw}`);
    } catch { /* no alert here */ }
  }
  return probe;
}

/**
 * Is this the INSTALLED app rather than a browser tab?
 *
 * It decides the hand-off, so it is deliberately generous: `display-mode: standalone`
 * covers an installed PWA everywhere, and iOS Safari's own non-standard
 * `navigator.standalone` covers the versions that answer the media query wrongly.
 */
export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if ((window.navigator as any)?.standalone === true) return true;
    return !!window.matchMedia?.('(display-mode: standalone)')?.matches
      || !!window.matchMedia?.('(display-mode: fullscreen)')?.matches
      || !!window.matchMedia?.('(display-mode: minimal-ui)')?.matches;
  } catch { return false; }
}

/**
 * Hand a URL to the platform from inside the click that asked for it.
 *
 * A real anchor, clicked. In a standalone iOS app this reaches Safari's own link
 * handler, which presents the file with a Done button back to the app; in a browser it
 * is an ordinary new tab. A scripted window-open call has neither property reliably,
 * and replacing it
 * is the whole of this fix.
 */
function handOff(url: string) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  // THE INSTALLED APP IS THE CASE THAT KEEPS FAILING (Yariv 2026-09-15: "the CV does
  // not open, but copying the link works" — the sixth report of this one bug). There is
  // no tab bar to put a `target="_blank"` document in, and iOS drops a SCRIPTED anchor
  // click aimed at one without an error, which is precisely "nothing happens". So here
  // the hand-off is allowed to end in a navigation that cannot be dropped: ask for a
  // window, and if the platform refuses one, go to the file in place — iOS presents an
  // off-origin page with its own Done control back to the app. Never silently nothing.
  if (isStandaloneApp()) {
    let opened: Window | null = null;
    try { opened = window.open(url, '_blank'); } catch { opened = null; }
    if (opened) { try { (opened as any).opener = null; } catch { /* cross-origin */ } return; }
    try { window.location.href = url; } catch { /* nothing left to try */ }
    return;
  }

  // In a browser tab a real anchor click is the navigation every popup blocker agrees
  // about, and it keeps the file in a NEW tab so the app is not navigated away from.
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

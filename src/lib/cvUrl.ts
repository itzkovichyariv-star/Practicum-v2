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

/**
 * Open a stored CV, and never leave the reader looking at a blank page.
 *
 * Yariv 2026-08-26 and again 2026-08-27: "קורות חיים של עדי גורביץ לא נפתחות — נותן
 * דף לבן." Wiring the candidates list through viewableCvUrl did not settle it, which
 * says the defect was never only the link builder.
 *
 * A blank tab is the worst possible failure here because it is AMBIGUOUS. Four
 * different faults render identically, and the reader cannot tell them apart:
 *
 *   · nothing is stored on the record at all
 *   · the object is not in the bucket (a path saved before a rename, a failed upload)
 *   · the bucket is not public, so the URL 400s
 *   · the file is Word, and view.officeapps.live.com declined it — it will not fetch
 *     a file it cannot reach, and it answers with an empty frame rather than an error
 *
 * Only the first means "there is no CV". The other three mean "the CV is fine and the
 * link is wrong", and a coordinator reading a blank tab concludes the opposite.
 *
 * So: open the tab synchronously (a popup blocker kills any window opened after an
 * await), then check the object actually resolves, and either send the tab to the file
 * or write into it what went wrong and where. The Word path also offers the raw file,
 * because a direct download works even when the Office viewer will not.
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

const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

function explain(probe: CvProbe, rawRef: string): string {
  const why =
    probe.reason === 'no-reference' ? 'לא נשמר קובץ קו״ח על הרשומה הזו.'
    : probe.reason === 'not-found'  ? 'הקובץ לא נמצא באחסון. הנתיב השמור מצביע על קובץ שאינו קיים — בדרך כלל העלאה שנכשלה, או קובץ שנמחק.'
    : probe.reason === 'http-error' ? `האחסון החזיר שגיאה ${probe.status}. אם זה 400, ה־bucket כנראה אינו ציבורי.`
    : 'לא הצלחנו להגיע לקובץ (שגיאת רשת או CORS). ייתכן שהקובץ תקין והבעיה בחיבור.';
  return `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">
<title>קו״ח — לא ניתן לפתוח</title>
<body style="font-family:-apple-system,system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 20px;line-height:1.7;color:#2a2320">
<h1 style="font-size:22px;margin:0 0 6px">לא ניתן לפתוח את קובץ קו״ח</h1>
<p style="margin:0 0 18px;color:#6b6058">${esc(why)}</p>
<div style="border:1px solid #e6ded6;border-radius:10px;padding:14px 16px;background:#faf7f4">
  <div style="font-size:12px;letter-spacing:.1em;color:#8a7e74;margin-bottom:6px">מה שמור ברשומה</div>
  <code style="font-size:12.5px;word-break:break-all;color:#2a2320">${esc(rawRef) || '(ריק)'}</code>
  ${probe.url ? `<div style="font-size:12px;letter-spacing:.1em;color:#8a7e74;margin:12px 0 6px">הכתובת שנוצרה ממנו</div>
  <a href="${esc(probe.url)}" style="font-size:12.5px;word-break:break-all;color:#7a1e2b">${esc(probe.url)}</a>` : ''}
</div>
<p style="margin-top:18px;color:#6b6058;font-size:13.5px">אפשר להעלות קו״ח מחדש דרך כרטיס הסטודנט/ית. אם השורות למעלה נראות תקינות — שלח/י אותן אליי ואבדוק.</p>
</body></html>`;
}

function wordChoice(fileUrl: string): string {
  const office = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(fileUrl)}`;
  return `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">
<title>קו״ח — קובץ Word</title>
<body style="font-family:-apple-system,system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 20px;line-height:1.7;color:#2a2320">
<h1 style="font-size:22px;margin:0 0 6px">קובץ Word</h1>
<p style="margin:0 0 18px;color:#6b6058">דפדפן לא מציג Word ישירות. התצוגה המקוונת של Microsoft בדרך כלל עובדת, אבל היא מחזירה דף ריק כשהיא לא מצליחה למשוך את הקובץ — לכן ההורדה כאן לצידה.</p>
<p style="margin:0 0 10px"><a href="${esc(office)}" style="display:inline-block;padding:10px 18px;border-radius:9px;background:#7a1e2b;color:#fff;text-decoration:none;font-weight:700">פתח בתצוגת Office</a></p>
<p><a href="${esc(fileUrl)}" download style="display:inline-block;padding:10px 18px;border-radius:9px;border:1px solid #d9cec4;color:#2a2320;text-decoration:none;font-weight:700">הורד את הקובץ</a></p>
</body></html>`;
}

/**
 * The single entry point for "show me this CV". Every opener should call this rather
 * than window.open(viewableCvUrl(...)) — that form is what renders the blank page.
 */
export async function openCv(value: string | null | undefined): Promise<CvProbe> {
  const raw = (value || '').trim();
  // Opened FIRST and synchronously: a window created after an await is a popup, and
  // Safari on his phone blocks it silently.
  const w = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  const write = (html: string) => {
    if (!w) return;
    try { w.document.open(); w.document.write(html); w.document.close(); } catch { /* closed */ }
  };

  const probe = await probeCvUrl(raw);
  // A probe that could not READ an answer is not evidence of anything.
  //
  // Yariv 2026-08-27: "הקישור נפתח בהעתקה שלו אבל לא על ידי לחיצה על קורות החיים
  // שלה." Copying the link and pasting it worked — so the object exists and the URL
  // built from it is right, and anything that refuses to open it is wrong about the
  // file. A HEAD blocked by CORS, a captive network or one offline moment all land in
  // `unreachable`, and browser NAVIGATION is not subject to CORS: the tab renders a
  // file the probe was never allowed to inspect.
  //
  // So only a definitive HTTP answer — a 404, a 400 from a private bucket — earns the
  // explanation page. An inconclusive probe hands the tab to the file and lets the
  // browser be the judge; if the object really is gone, the storage layer's own error
  // body is at least visible text rather than the blank page this all started from.
  if (!probe.ok && probe.reason !== 'unreachable') { write(explain(probe, raw)); return probe; }

  const isWord = /\.(docx?|doc)$/i.test(probe.url.split('?')[0]);
  if (isWord) { write(wordChoice(probe.url)); return probe; }
  if (w) { try { w.location.href = probe.url; } catch { /* closed */ } }
  return probe;
}

/**
 * Save a generated file — the one way every download in the app goes.
 *
 * Yariv 2026-10-06: "הכפתור לא מגיב". Every download here did
 * `a.click(); URL.revokeObjectURL(url)` in one breath. Safari (and the installed app on
 * his phone, which IS Safari) starts the download asynchronously, so the URL was gone
 * before it was read: no file, no error — a button that does nothing. The URL now lives
 * for a minute. And in the installed app, where a download has nowhere to land, the
 * share sheet is used instead ("שמור בקבצים", Mail, AirDrop, Print).
 */
export function isStandaloneApp(): boolean {
  try {
    return (typeof window !== 'undefined')
      && ((window.matchMedia?.('(display-mode: standalone)').matches) || (navigator as any).standalone === true);
  } catch { return false; }
}

export async function saveFile(blob: Blob, filename: string): Promise<void> {
  if (isStandaloneApp() && typeof File !== 'undefined' && (navigator as any).canShare) {
    try {
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if ((navigator as any).canShare({ files: [file] })) {
        await (navigator as any).share({ files: [file], title: filename });
        return;
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;          // he closed the sheet — not a failure
      /* anything else: fall through to the plain download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Opens a mailto: URL without navigating the current page.
 *
 * window.open('_blank') keeps the SPA alive on desktop, but on iOS it frequently does
 * nothing at all for a non-http scheme — which is how a CV got marked "נשלח" while
 * Outlook never opened (Yariv, 2026-08-09). So: try the popup, and when it is refused
 * fall back to a same-tab navigation, which iOS honours for mailto and which does NOT
 * unload the page (the mail app takes over; Safari keeps the SPA behind it).
 *
 * Returns whether SOMETHING was attempted that we believe reached the mail client. It is
 * a best effort — no browser reports back — so callers must never treat `true` as proof
 * a message was sent. That is what the send-confirmation step is for.
 */
export function openMailto(url: string): boolean {
  try {
    const w = window.open(url, '_blank');
    if (w) return true;
  } catch { /* fall through to the navigation form */ }
  try {
    window.location.href = url;
    return true;
  } catch {
    return false;
  }
}

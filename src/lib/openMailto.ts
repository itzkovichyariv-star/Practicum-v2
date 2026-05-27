/**
 * Opens a mailto: URL without navigating the current page.
 * window.location.href = 'mailto:...' and a.click() both cause Safari to blank the SPA.
 * window.open with '_blank' opens mail client without navigating away.
 */
export function openMailto(url: string) {
  window.open(url, '_blank');
}

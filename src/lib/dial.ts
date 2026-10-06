import { showToast } from './toast';

/**
 * One call button for the whole app.
 *
 * `tel:` dials on a phone and is a SILENT no-op in a desktop browser — the 2026-10-06
 * button sweep found eight 📞 buttons that did nothing at all on the computer. The
 * student and candidate rows already did the right thing: dial on a touch device,
 * otherwise copy the number and say so. Every call button now goes through here.
 */
export function canDial(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window.matchMedia?.('(pointer: coarse)')?.matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
}

export function dialPhone(phone: string | undefined | null, label = ''): void {
  const raw = String(phone || '').trim();
  if (!raw) { showToast('לא הוזן מספר טלפון', 'error'); return; }
  const tel = raw.replace(/[^\d+]/g, '');
  if (canDial()) { window.location.href = `tel:${tel}`; return; }
  const said = `📞 ${label ? label + ': ' : ''}${raw}`;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(raw).then(() => showToast(`${said} · המספר הועתק`, 'success'), () => showToast(said, 'info'));
  } else {
    showToast(said, 'info');
  }
}

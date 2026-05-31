/**
 * Modal — iOS-safe scroll. Uses body-scroll-lock (BSL).
 *
 * WHY BSL:
 *   Every other approach (position:absolute child, WebkitOverflowScrolling,
 *   touch-action) is unreliable on iOS Safari because the engine refuses to
 *   scroll overflow content inside fixed/absolute elements unless the body
 *   itself is scroll-locked. This is a longstanding iOS WebKit bug.
 *
 *   The only approach proven to work across iOS 13–18 is:
 *     1. Save window.scrollY
 *     2. body { position:fixed; top:-scrollY; overflow:hidden; width:100% }
 *     3. With body locked, overflow-y:auto on a position:fixed modal works.
 *     4. On close: restore body position and scroll.
 *
 *   This is exactly what Radix UI, Headless UI, and react-remove-scroll do.
 *
 * DO NOT remove the useEffect body lock without testing on a real iOS device.
 */

import { useEffect } from 'react';

type Props = {
  onClose: () => void;
  maxWidth?: string;
  zIndex?: string;
  children: React.ReactNode;
};

export default function Modal({
  onClose,
  maxWidth = 'max-w-[820px]',
  zIndex = 'z-[200]',
  children,
}: Props) {

  // Escape closes the editor — so you can always get out (e.g. to switch screens
  // via the top nav, which an open modal otherwise covers).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Scroll-lock. The aggressive position:fixed body lock is ONLY needed on iOS
  // Safari (its overflow-scroll-inside-fixed bug). On DESKTOP that same hack can
  // strand the page after repeated open/close cycles — it felt "frozen". So on
  // desktop we use a plain overflow:hidden (reliable, no scroll-position juggling),
  // and keep the position:fixed technique only for touch / iOS devices.
  useEffect(() => {
    const body = document.body;
    const isTouch = typeof window !== 'undefined' && (
      window.matchMedia?.('(pointer: coarse)')?.matches ||
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) // iPadOS reports as Mac
    );
    if (isTouch) {
      const scrollY = window.scrollY;
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.overflow = 'hidden';
      return () => {
        body.style.position = '';
        body.style.top = '';
        body.style.left = '';
        body.style.right = '';
        body.style.overflow = '';
        window.scrollTo(0, scrollY);
      };
    }
    // Page horizontal stability across this lock is handled globally and
    // RTL-correctly by `html { scrollbar-gutter: stable }` (see global.css) —
    // the gutter stays reserved when overflow:hidden hides the scrollbar, so no
    // control shifts. So here we only need the plain overflow lock.
    const prevOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => { body.style.overflow = prevOverflow; };
  }, []);

  return (
    // With body locked, overflow-y:auto on position:fixed works on iOS
    <div
      className={`fixed inset-0 ${zIndex}`}
      style={{
        background: 'rgba(26, 22, 18, 0.55)',
        backdropFilter: 'blur(4px)',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain',
      } as React.CSSProperties}
    >
      {/* Always-visible close — fixed in the corner so you can exit at any scroll
          position (the open modal otherwise covers the top nav). Esc also closes. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="סגור"
        title="סגור (Esc)"
        className="fixed top-4 left-4 z-[210] w-9 h-9 rounded-full grid place-items-center"
        style={{ background: 'var(--bg)', border: '1px solid var(--divider)', boxShadow: '0 2px 10px rgba(26,22,18,0.18)', color: 'var(--ink)', fontSize: '15px', cursor: 'pointer' }}
      >
        ✕
      </button>

      {/* Centering wrapper — click outside card to close */}
      <div
        className="min-h-full py-6 px-4 flex items-start justify-center"
        onClick={onClose}
      >
        {/* Card — stop click bubbling */}
        <div
          className={`relative w-full ${maxWidth} rounded-2xl`}
          style={{
            background: 'var(--bg)',
            boxShadow: '0 24px 80px rgba(26, 22, 18, 0.25)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

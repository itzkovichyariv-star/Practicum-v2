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

  // Body-scroll-lock: the only reliable iOS Safari modal scroll technique
  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
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

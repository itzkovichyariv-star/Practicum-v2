/**
 * Modal — iOS-safe scroll wrapper used by ALL editor modals.
 *
 * iOS Safari requires:
 *   1. overflow-y: auto  (NOT via className — must be an inline style or it may be
 *      overridden by Tailwind's purge or specificity)
 *   2. -webkit-overflow-scrolling: touch  (React prop: WebkitOverflowScrolling)
 *      Without this, momentum scrolling is disabled and the modal FREEZES on iOS.
 *   3. The backdrop must be the scroll container (position: fixed + inset: 0),
 *      NOT an inner div — inner scroll in a fixed container is unreliable on iOS.
 *   4. A min-h-full centering wrapper INSIDE the scroll container carries
 *      onClick={onClose}, so tapping the dimmed area closes the modal.
 *   5. The card itself carries onClick={e => e.stopPropagation()} to prevent
 *      card taps from bubbling to the close handler.
 *
 * DO NOT change this scroll pattern without testing on a real iOS device.
 */

type Props = {
  onClose: () => void;
  maxWidth?: string;   // e.g. 'max-w-[820px]'
  zIndex?: string;     // e.g. 'z-[200]'
  children: React.ReactNode;
};

export default function Modal({
  onClose,
  maxWidth = 'max-w-[820px]',
  zIndex = 'z-[200]',
  children,
}: Props) {
  return (
    /* ── Backdrop: the scroll container ── */
    <div
      className={`fixed inset-0 ${zIndex}`}
      style={{
        background: 'rgba(26, 22, 18, 0.55)',
        backdropFilter: 'blur(4px)',
        /* iOS Safari: these MUST be inline styles, not Tailwind classes */
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      } as React.CSSProperties}
    >
      {/* ── Centering wrapper: click-to-close ── */}
      <div
        className="min-h-full py-6 px-4 flex items-start justify-center"
        onClick={onClose}
      >
        {/* ── Card: stop click bubbling to close handler ── */}
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

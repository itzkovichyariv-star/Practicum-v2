/**
 * Modal — iOS-safe scroll wrapper used by ALL editor modals.
 *
 * THE iOS SAFARI RULE (tested on iOS 15+):
 *   overflow-y: auto on a position:fixed element does NOT scroll on iOS Safari.
 *   The scroll container MUST be position:absolute nested inside the fixed backdrop.
 *
 * Correct three-layer structure:
 *   1. position:fixed  inset:0  overflow:hidden   ← backdrop (dims + clips, never scrolls)
 *   2. position:absolute inset:0 overflow-y:auto
 *      -webkit-overflow-scrolling:touch           ← SCROLL container (the only scrollable layer)
 *   3. min-h-full flex centering wrapper          ← carries onClick={onClose}
 *   4. the card div                               ← carries onClick={stopPropagation}
 *
 * DO NOT change this structure without testing on a REAL iOS device.
 * DO NOT move overflow-y or WebkitOverflowScrolling to the fixed div.
 */

type Props = {
  onClose: () => void;
  maxWidth?: string;   // Tailwind class e.g. 'max-w-[820px]'
  zIndex?: string;     // Tailwind class e.g. 'z-[200]'
  children: React.ReactNode;
};

export default function Modal({
  onClose,
  maxWidth = 'max-w-[820px]',
  zIndex = 'z-[200]',
  children,
}: Props) {
  return (
    /* Layer 1 — Fixed backdrop: dims the page, clips overflow, never scrolls */
    <div
      className={`fixed inset-0 ${zIndex}`}
      style={{
        background: 'rgba(26, 22, 18, 0.55)',
        backdropFilter: 'blur(4px)',
        overflow: 'hidden',   /* NOT overflow-y:auto — that's on the absolute child */
      }}
    >
      {/* Layer 2 — Absolute scroll container: THIS is what scrolls on iOS */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',  /* required for iOS momentum scroll */
          overscrollBehavior: 'contain',      /* prevent scroll chaining to page behind */
        } as React.CSSProperties}
      >
        {/* Layer 3 — Centering wrapper: click-to-close on the dimmed area */}
        <div
          className="min-h-full py-6 px-4 flex items-start justify-center"
          onClick={onClose}
        >
          {/* Layer 4 — Card: stop clicks bubbling to close handler */}
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
    </div>
  );
}

import { useEffect, useState, type ReactNode } from 'react';

export type InfoRow = { label: string; value?: string | number | null; accent?: boolean };

type Props = {
  id: string;
  title: string;
  subtitle?: string;
  rows: InfoRow[];
  children?: ReactNode; // extra actions
};

/**
 * Hover-reveal, click-to-pin detail popover.
 * Parent must add `data-info-anchor={id}` to its row and have `position: relative`
 * + `className="group"` for hover to work.
 */
export function useInfoPopover() {
  const [pinned, setPinned] = useState<string | null>(null);

  useEffect(() => {
    if (!pinned) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setPinned(null); }
    function onClick(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest(`[data-info-anchor="${pinned}"]`)) setPinned(null);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, [pinned]);

  return {
    pinned,
    toggle: (id: string) => setPinned(prev => prev === id ? null : id),
    close: () => setPinned(null),
  };
}

export default function InfoPopover({ id, title, subtitle, rows, children }: Props) {
  return (
    <div
      className="absolute z-40 right-0 top-full mt-2 invisible group-hover:visible group-[.pinned]:visible rounded-xl shadow-xl border p-5"
      style={{
        background: 'var(--bg)',
        borderColor: 'var(--divider)',
        boxShadow: '0 16px 48px rgba(26, 22, 18, 0.2)',
        // Capped to the viewport: at 390px this box was 440px wide and, because it is
        // only `invisible` rather than unmounted, it widened the PAGE even when never
        // opened — the candidates screen scrolled sideways by 64px on a phone
        // (measured 2026-08-11).
        minWidth: 'min(340px, calc(100vw - 28px))',
        maxWidth: 'min(420px, calc(100vw - 28px))',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="pb-3 mb-3 border-b" style={{ borderColor: 'var(--divider)' }}>
        <div className="serif text-[20px] leading-[1.15]" style={{ color: 'var(--ink)' }}>{title}</div>
        {subtitle && (
          <div className="mono text-[11px] uppercase tracking-[0.14em] mt-1" style={{ color: 'var(--text-soft)' }}>
            {subtitle}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {rows.filter(r => r.value != null && r.value !== '').map((r, i) => (
          <div key={i} className="flex items-baseline gap-3 text-[13.5px]">
            <span className="mono text-[10.5px] uppercase tracking-[0.13em] font-semibold w-24 shrink-0" style={{ color: 'var(--text-soft)' }}>
              {r.label}
            </span>
            <span style={{ color: r.accent ? 'var(--accent)' : 'var(--ink)' }}>
              {String(r.value)}
            </span>
          </div>
        ))}
      </div>

      {children && (
        <div className="mt-4 pt-3 border-t flex flex-wrap gap-2" style={{ borderColor: 'var(--divider)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

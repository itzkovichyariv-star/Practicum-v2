import { useState, useRef, useEffect } from 'react';
import type { Context } from '../lib/session';
import { APP_VERSION } from '../lib/version';

export type Page = 'dashboard' | 'lectures' | 'students' | 'employers' | 'trainers' | 'candidates' | 'calendar' | 'reports' | 'forms' | 'management' | 'settings';

type Option = { value: string; label: string };

type ThemeMode = 'auto' | 'dark' | 'light';

type Props = {
  userName: string;
  onSignOut: () => void;
  context: Context;
  onContext: (c: Context) => void;
  courseOptions: Option[];
  yearOptions: Option[];
  page: Page;
  onNavigate: (p: Page) => void;
  themeMode?: ThemeMode;
  onThemeChange?: (m: ThemeMode) => void;
};

const NAV: { label: string; page: Page; emoji: string }[] = [
  { label: 'דשבורד',    page: 'dashboard',  emoji: '🏠' },
  { label: 'הרצאות',    page: 'lectures',   emoji: '📚' },
  { label: 'סטודנטים',  page: 'students',   emoji: '👥' },
  { label: 'מעסיקים',   page: 'employers',  emoji: '🏢' },
  { label: 'מנחים/מרצים', page: 'trainers', emoji: '🧑‍🏫' },
  { label: 'מועמדים',   page: 'candidates', emoji: '🎯' },
  { label: 'לוח שנה',   page: 'calendar',   emoji: '📅' },
  { label: 'דוחות',     page: 'reports',    emoji: '📊' },
  { label: 'טפסים',     page: 'forms',      emoji: '📄' },
  { label: 'ניהול',     page: 'management', emoji: '⚙️' },
  { label: 'הגדרות',    page: 'settings',   emoji: '🔧' },
];

export default function TopBar({
  userName, onSignOut, context, onContext, courseOptions, yearOptions, page, onNavigate,
  themeMode = 'auto', onThemeChange,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  // Keep a CSS custom property --header-h in sync with the real header height
  // so the page content spacer below always matches exactly.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () =>
      document.documentElement.style.setProperty('--header-h', el.offsetHeight + 'px');
    update();
    // The header now shows the version itself, so Layout's fixed bottom-left
    // stamp is a duplicate here and is hidden by CSS keyed on this attribute.
    // It is NOT removed from Layout: the public pages (register, cv-update,
    // organizations, feedback) have no header, and cell 67 reads the version
    // off the employer-response page. Scoping it this way leaves those alone.
    document.documentElement.setAttribute('data-has-header-version', '1');
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function navigate(p: Page) {
    onNavigate(p);
    setMenuOpen(false);
  }

  const currentLabel = NAV.find(n => n.page === page)?.label || page;

  return (
    <>
      <header
        ref={headerRef}
        className="fixed top-0 left-0 right-0 z-50 border-b"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(16px) saturate(180%)',
          WebkitBackdropFilter: 'blur(16px) saturate(180%)',
          borderColor: 'var(--divider)',
        }}
      >
        {/* ── Version, at the top and IN FLOW ──────────────────────────────────
            It used to be a fixed overlay pinned bottom-left, so it sat on top of
            whatever happened to be underneath — a candidate's status badge, the
            submissions card. Yariv 2026-08-13: "מספר הגרסה מוסתר, הוא צריך
            להופיע למעלה … באופן שכמובן לא יסתיר כלום אחר."

            Living INSIDE the header is what makes "hides nothing" true rather
            than hoped-for: the header's real height is measured into --header-h
            by the effect above, and App renders a spacer of exactly that height,
            so this line pushes the page down by its own height instead of
            covering a row of it. dir=ltr because a version is a Latin token and
            would otherwise be reordered inside an RTL document. */}
        <div
          data-version-line
          dir="ltr"
          className="mono text-[10px] tracking-[0.1em] text-center select-none"
          style={{ color: 'var(--text-soft)', opacity: 0.7, paddingTop: '3px', lineHeight: 1.5 }}
        >
          {APP_VERSION}
        </div>

        {/* ── Desktop Row 1: brand + context + user ── */}
        <div className="max-w-[1200px] mx-auto px-10 pt-5 pb-4 items-center justify-between gap-8 mono text-[12.5px] uppercase tracking-[0.18em] font-medium hidden md:flex">
          <button onClick={() => navigate('dashboard')} className="flex items-center gap-3 hover:opacity-70">
            <span className="font-semibold">פרקטיקום</span>
            <span className="opacity-30">/</span>
            <span className="opacity-60">Est. 2025</span>
          </button>

          <div className="flex items-center gap-2">
            <ContextSelect label="קורס" value={context.courseId} onChange={v => onContext({ ...context, courseId: v })} options={courseOptions} />
            <span className="opacity-20 text-[11px]">|</span>
            <ContextSelect label="שנה" value={context.year} onChange={v => onContext({ ...context, year: v })} options={yearOptions} />
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 font-semibold" style={{ color: 'var(--text-soft)' }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--accent)', boxShadow: '0 0 0 4px rgba(122,30,43,0.12)' }} />
              SYNCED
            </span>
            {/* Theme toggle */}
            {onThemeChange && <ThemeToggle mode={themeMode} onChange={onThemeChange} />}
            <button onClick={onSignOut} className="pill" title="יציאה" style={{ minHeight: 0 }}>
              {userName.charAt(0) || 'U'}
            </button>
          </div>
        </div>

        {/* ── Desktop Row 2: nav links ── */}
        <div className="max-w-[1200px] mx-auto px-10 pb-4 pt-2 items-center gap-8 mono text-[13px] uppercase tracking-[0.16em] hidden md:flex">
          <nav className="flex gap-9 font-semibold">
            {NAV.map(n => (
              <button key={n.page} onClick={() => navigate(n.page)}
                className="transition-opacity hover:opacity-60"
                style={n.page === page ? { color: 'var(--accent)' } : { color: 'var(--ink)' }}>
                {n.label}
              </button>
            ))}
          </nav>
        </div>

        {/* ── Mobile header bar ── */}
        <div className="flex md:hidden items-center justify-between px-4 py-3 gap-3">
          {/* Brand */}
          <button onClick={() => navigate('dashboard')}
            className="mono text-[13px] uppercase tracking-[0.16em] font-semibold"
            style={{ color: 'var(--ink)' }}>
            פרקטיקום
          </button>

          {/* Current page label */}
          <span className="mono text-[12px] uppercase tracking-[0.14em] font-semibold px-3 py-1 rounded-full"
            style={{ background: 'var(--accent)', color: 'var(--bg)', fontSize: '11px' }}>
            {currentLabel}
          </span>

          {/* Search icon (mobile) */}
          <button
            onClick={() => window.dispatchEvent(new Event('open-search'))}
            className="flex items-center justify-center w-9 h-9 rounded-lg border"
            style={{ borderColor: 'var(--divider)', background: 'transparent', minHeight: 0 }}
            aria-label="חיפוש"
          >
            <span style={{ fontSize: '15px' }}>🔍</span>
          </button>

          {/* Hamburger */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="flex flex-col justify-center items-center gap-[5px] w-10 h-10 rounded-lg"
            style={{ background: menuOpen ? 'var(--accent-soft)' : 'transparent' }}
            aria-label="תפריט"
          >
            <span className="block w-5 h-[2px] rounded-full transition-all"
              style={{ background: 'var(--ink)', transform: menuOpen ? 'rotate(45deg) translate(5px, 5px)' : 'none' }} />
            <span className="block w-5 h-[2px] rounded-full transition-all"
              style={{ background: 'var(--ink)', opacity: menuOpen ? 0 : 1 }} />
            <span className="block w-5 h-[2px] rounded-full transition-all"
              style={{ background: 'var(--ink)', transform: menuOpen ? 'rotate(-45deg) translate(5px, -5px)' : 'none' }} />
          </button>
        </div>

        {/* ── Mobile context row (always visible) ── */}
        <div className="flex md:hidden items-center gap-2 px-4 pb-3 overflow-hidden">
          <ContextSelect label="קורס" value={context.courseId} onChange={v => onContext({ ...context, courseId: v })} options={courseOptions} grow />
          <ContextSelect label="שנה" value={context.year} onChange={v => onContext({ ...context, year: v })} options={yearOptions} />
        </div>
      </header>

      {/* ── Mobile drawer ── */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 flex flex-col md:hidden"
          style={{ background: 'var(--nav-bg)', backdropFilter: 'blur(20px)', paddingTop: '64px' }}>

          {/* Context selectors */}
          <div className="px-5 py-4 border-b flex gap-4 items-center" style={{ borderColor: 'var(--divider)' }}>
            <div className="flex-1">
              <div className="mono text-[10px] uppercase tracking-[0.16em] mb-1.5" style={{ color: 'var(--text-soft)' }}>קורס</div>
              <select
                value={context.courseId}
                onChange={e => onContext({ ...context, courseId: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 text-[13px] font-semibold bg-transparent"
                style={{ borderColor: 'var(--divider)', color: 'var(--accent)', minHeight: '40px' }}>
                {courseOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <div className="mono text-[10px] uppercase tracking-[0.16em] mb-1.5" style={{ color: 'var(--text-soft)' }}>שנה</div>
              <select
                value={context.year}
                onChange={e => onContext({ ...context, year: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 text-[13px] font-semibold bg-transparent"
                style={{ borderColor: 'var(--divider)', color: 'var(--accent)', minHeight: '40px' }}>
                {yearOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Nav links */}
          <nav className="flex-1 overflow-y-auto px-4 py-3" style={{ WebkitOverflowScrolling: 'touch' } as any}>
            {NAV.map(n => {
              const active = n.page === page;
              return (
                <button key={n.page} onClick={() => navigate(n.page)}
                  className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl mb-1 text-right transition-colors"
                  style={{
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? 'var(--bg)' : 'var(--ink)',
                  }}>
                  <span className="text-[18px] leading-none">{n.emoji}</span>
                  <span className="mono text-[14px] uppercase tracking-[0.14em] font-semibold">{n.label}</span>
                  {active && <span className="mr-auto serif text-[16px]" style={{ color: 'var(--bg)' }}>←</span>}
                </button>
              );
            })}
          </nav>

          {/* Theme + sign out */}
          <div className="px-5 py-4 border-t flex flex-col gap-2" style={{ borderColor: 'var(--divider)' }}>
            {onThemeChange && (
              <div className="flex items-center justify-between px-4 py-2 rounded-xl"
                style={{ background: 'var(--accent-soft)' }}>
                <span className="mono text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-soft)' }}>תצוגה</span>
                <ThemeToggle mode={themeMode} onChange={onThemeChange} />
              </div>
            )}
            <button onClick={() => { setMenuOpen(false); onSignOut(); }}
              className="w-full mono text-[12px] uppercase tracking-[0.16em] font-semibold py-3 rounded-xl"
              style={{ color: 'var(--accent)', border: '1px solid var(--divider)' }}>
              יציאה — {userName}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ContextSelect({ label, value, onChange, options, grow }: {
  label: string; value: string; onChange: (v: string) => void; options: Option[]; grow?: boolean;
}) {
  const current = options.find(o => o.value === value)?.label || value;
  return (
    <div
      className="relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border cursor-pointer transition-colors hover:border-[var(--accent)]"
      style={{
        borderColor: 'var(--divider)',
        background: 'var(--accent-soft)',
        ...(grow ? { flex: 1, minWidth: 0, overflow: 'hidden' } : { flexShrink: 0 }),
      }}
      title={current}
    >
      <span className="mono text-[10px] uppercase tracking-[0.14em] shrink-0" style={{ color: 'var(--text-soft)' }}>{label}</span>
      <span
        className="mono text-[12px] font-bold uppercase tracking-[0.1em]"
        style={{ color: 'var(--accent)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
      >{current}</span>
      <span style={{ color: 'var(--accent)', fontSize: '9px', opacity: 0.7, flexShrink: 0 }}>▾</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="context-select absolute inset-0 w-full h-full opacity-0"
        style={{ cursor: 'pointer' }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/* ── Theme toggle: Auto (clock) / Light (sun) / Dark (moon) ─────────── */
const THEME_ICONS: Record<ThemeMode, string> = { auto: '🕐', light: '☀️', dark: '🌙' };
// From 'auto' the next mode is the OPPOSITE of what's currently on screen, so the
// first click always produces a visible change (auto→dark at night looked dead).
function nextTheme(mode: ThemeMode): ThemeMode {
  if (mode === 'auto') {
    const effectiveDark = typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-theme') === 'dark';
    return effectiveDark ? 'light' : 'dark';
  }
  if (mode === 'dark') return 'light';
  return 'auto'; // light → back to schedule
}
const THEME_LABELS: Record<ThemeMode, string> = { auto: 'אוטו', light: 'יום', dark: 'לילה' };

function ThemeToggle({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }) {
  return (
    <button
      onClick={() => onChange(nextTheme(mode))}
      title={`תצוגה: ${THEME_LABELS[mode]} — לחץ לשינוי`}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all"
      style={{
        borderColor: 'var(--divider)',
        color: 'var(--ink)',
        background: mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'transparent',
        fontSize: '11px',
        minHeight: 0,
        letterSpacing: '0.1em',
      }}
    >
      <span style={{ fontSize: '14px', lineHeight: 1 }}>{THEME_ICONS[mode]}</span>
      <span className="mono uppercase font-semibold hidden lg:inline">{THEME_LABELS[mode]}</span>
    </button>
  );
}

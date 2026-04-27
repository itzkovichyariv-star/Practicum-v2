import { useState } from 'react';
import type { Context } from '../lib/session';

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
  { label: 'מנחים',     page: 'trainers',   emoji: '🧑‍🏫' },
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

  function navigate(p: Page) {
    onNavigate(p);
    setMenuOpen(false);
  }

  const currentLabel = NAV.find(n => n.page === page)?.label || page;

  return (
    <>
      <header
        className="sticky top-0 z-50 border-b"
        style={{
          background: 'var(--nav-bg)',
          backdropFilter: 'blur(16px) saturate(180%)',
          WebkitBackdropFilter: 'blur(16px) saturate(180%)',
          borderColor: 'var(--divider)',
        }}
      >
        {/* ── Desktop Row 1: brand + context + user ── */}
        <div className="max-w-[1200px] mx-auto px-10 pt-5 pb-4 items-center justify-between gap-8 mono text-[12.5px] uppercase tracking-[0.18em] font-medium hidden md:flex">
          <button onClick={() => navigate('dashboard')} className="flex items-center gap-3 hover:opacity-70">
            <span className="font-semibold">פרקטיקום</span>
            <span className="opacity-30">/</span>
            <span className="opacity-60">Est. 2025</span>
          </button>

          <div className="flex items-center gap-4 px-4 py-1.5 rounded-full border"
            style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.25)' }}>
            <span style={{ color: 'var(--text-soft)' }}>קורס</span>
            <ContextSelect value={context.courseId} onChange={v => onContext({ ...context, courseId: v })} options={courseOptions} />
            <span className="w-px h-3 opacity-30" style={{ background: 'currentColor' }} />
            <span style={{ color: 'var(--text-soft)' }}>שנה</span>
            <ContextSelect value={context.year} onChange={v => onContext({ ...context, year: v })} options={yearOptions} />
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
          <nav className="flex-1 overflow-y-auto px-4 py-3">
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

function ContextSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Option[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="context-select">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/* ── Theme toggle: Auto (clock) / Light (sun) / Dark (moon) ─────────── */
const THEME_ICONS: Record<ThemeMode, string> = { auto: '🕐', light: '☀️', dark: '🌙' };
const THEME_NEXT: Record<ThemeMode, ThemeMode> = { auto: 'dark', dark: 'light', light: 'auto' };
const THEME_LABELS: Record<ThemeMode, string> = { auto: 'אוטו', light: 'יום', dark: 'לילה' };

function ThemeToggle({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }) {
  return (
    <button
      onClick={() => onChange(THEME_NEXT[mode])}
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

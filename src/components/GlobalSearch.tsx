import { useEffect, useRef, useState, useCallback } from 'react';
import type { PracticumData } from '../lib/supabase';
import type { Page } from './TopBar';

type ResultItem = {
  kind: 'student' | 'candidate' | 'employer' | 'trainer' | 'lecture';
  label: string;
  sub?: string;
  page: Page;
};

const KIND_LABEL: Record<ResultItem['kind'], string> = {
  student: 'סטודנט',
  candidate: 'מועמד',
  employer: 'מעסיק',
  trainer: 'מנחה',
  lecture: 'הרצאה',
};

const KIND_ICON: Record<ResultItem['kind'], string> = {
  student: '🎓',
  candidate: '📋',
  employer: '🏢',
  trainer: '👤',
  lecture: '📅',
};

function search(data: PracticumData, q: string): ResultItem[] {
  if (!q.trim()) return [];
  const lq = q.trim().toLowerCase();
  const results: ResultItem[] = [];

  (data.students || []).forEach(s => {
    const hay = [s.name, s.phone, s.email, s.city, s.acceptedOrg].filter(Boolean).join(' ').toLowerCase();
    if (hay.includes(lq)) {
      results.push({ kind: 'student', label: s.name, sub: [s.acceptedOrg, s.phone].filter(Boolean).join(' · '), page: 'students' });
    }
  });

  (data.candidates || []).forEach(c => {
    const hay = [c.name, c.phone, c.email, c.city].filter(Boolean).join(' ').toLowerCase();
    if (hay.includes(lq)) {
      results.push({ kind: 'candidate', label: c.name, sub: [c.phone, c.email].filter(Boolean).join(' · '), page: 'candidates' });
    }
  });

  (data.employers || []).forEach(e => {
    const hay = [e.name, e.contactPerson, e.contactEmail, e.contactPhone, e.location].filter(Boolean).join(' ').toLowerCase();
    if (hay.includes(lq)) {
      results.push({ kind: 'employer', label: e.name, sub: [e.contactPerson, e.location].filter(Boolean).join(' · '), page: 'employers' });
    }
  });

  (data.trainers || []).forEach(t => {
    const hay = [t.name, t.phone, t.email, t.organization, t.role, t.specialty].filter(Boolean).join(' ').toLowerCase();
    if (hay.includes(lq)) {
      results.push({ kind: 'trainer', label: t.name, sub: [t.organization, t.role].filter(Boolean).join(' · '), page: 'trainers' });
    }
  });

  (data.lectures || []).forEach(l => {
    const hay = [l.topic, l.title, l.lecturer, l.lecturerPhone, l.lecturerEmail, l.location].filter(Boolean).join(' ').toLowerCase();
    if (hay.includes(lq)) {
      results.push({ kind: 'lecture', label: l.topic || l.title || 'הרצאה', sub: [l.lecturer, l.date].filter(Boolean).join(' · '), page: 'lectures' });
    }
  });

  return results.slice(0, 30);
}

type Props = {
  data: PracticumData;
  onNavigate: (page: Page) => void;
};

export default function GlobalSearch({ data, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = search(data, q);

  const close = useCallback(() => { setOpen(false); setQ(''); setSelected(0); }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
        setQ('');
        setSelected(0);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); return; }
    if (e.key === 'Enter' && results[selected]) {
      onNavigate(results[selected].page);
      close();
    }
  }

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      title="חיפוש גלובלי (⌘K)"
      className="mono text-[11px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg border flex items-center gap-2"
      style={{ borderColor: 'var(--divider)', color: 'var(--text-soft)', background: 'transparent', cursor: 'pointer' }}
    >
      <span style={{ fontSize: '13px' }}>🔍</span>
      <span className="hidden md:inline">חיפוש</span>
      <kbd className="hidden md:inline mono text-[9px] px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--divider)', opacity: 0.7 }}>⌘K</kbd>
    </button>
  );

  // Group results by kind
  const groups: ResultItem['kind'][] = ['student', 'candidate', 'employer', 'trainer', 'lecture'];
  const grouped = groups.map(k => ({ kind: k, items: results.filter(r => r.kind === k) })).filter(g => g.items.length > 0);

  // Flat index for keyboard nav
  let flatIdx = 0;

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-start justify-center"
      style={{ paddingTop: 'clamp(60px, 12vh, 120px)', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        className="w-full mx-4 rounded-2xl shadow-2xl overflow-hidden"
        style={{ maxWidth: '580px', background: 'var(--bg)', border: '1px solid var(--divider)' }}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--divider)' }}>
          <span style={{ fontSize: '18px', opacity: 0.5 }}>🔍</span>
          <input
            ref={inputRef}
            value={q}
            onChange={e => { setQ(e.target.value); setSelected(0); }}
            onKeyDown={handleKey}
            placeholder="חפש סטודנטים, מעסיקים, מנחים, הרצאות..."
            className="flex-1 bg-transparent outline-none text-[16px]"
            style={{ color: 'var(--ink)', fontFamily: 'inherit' }}
            dir="rtl"
          />
          <button
            onClick={close}
            className="mono text-[10px] uppercase tracking-[0.14em] px-2 py-1 rounded border opacity-50 hover:opacity-100"
            style={{ borderColor: 'var(--divider)', color: 'var(--ink)' }}
          >
            Esc
          </button>
        </div>

        {/* Results */}
        {q.trim() && (
          <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
            {results.length === 0 ? (
              <div className="py-12 text-center mono text-[12px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-soft)' }}>
                אין תוצאות עבור "{q}"
              </div>
            ) : (
              grouped.map(group => (
                <div key={group.kind}>
                  {/* Group header */}
                  <div className="px-5 py-2 mono text-[10px] uppercase tracking-[0.16em] sticky top-0"
                    style={{ color: 'var(--text-soft)', background: 'var(--bg)', borderBottom: '1px solid var(--divider)' }}>
                    {KIND_ICON[group.kind]} {KIND_LABEL[group.kind]}
                  </div>
                  {group.items.map(item => {
                    const idx = flatIdx++;
                    const isSelected = idx === selected;
                    return (
                      <button
                        key={`${item.kind}-${item.label}-${idx}`}
                        className="w-full text-right px-5 py-3 flex items-baseline gap-3 transition-colors"
                        style={{
                          background: isSelected ? 'var(--accent-soft)' : 'transparent',
                          borderBottom: '1px solid var(--divider)',
                          cursor: 'pointer',
                          display: 'flex',
                        }}
                        onMouseEnter={() => setSelected(idx)}
                        onClick={() => { onNavigate(item.page); close(); }}
                      >
                        <span className="text-[15px] font-semibold flex-1 truncate" style={{ color: 'var(--ink)' }}>{item.label}</span>
                        {item.sub && (
                          <span className="text-[12px] truncate shrink-0" style={{ color: 'var(--text-soft)', maxWidth: '180px' }}>{item.sub}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}

        {!q.trim() && (
          <div className="py-8 text-center mono text-[11px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-soft)' }}>
            הקלד לחיפוש · חצים לניווט · Enter למעבר
          </div>
        )}
      </div>
    </div>
  );
}

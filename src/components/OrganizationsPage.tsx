/**
 * Public-facing organization browsing page.
 * Linked from the acceptance email so new students can browse
 * available practicum organizations before choosing one.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Employer } from '../lib/supabase';
import { orgAvailability } from '../lib/orgAvailability';
import { openVacancies, migratePlacementData } from '../lib/placement';

// ── helpers ──────────────────────────────────────────────────────────────────

function getParam(key: string): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(key) || '';
}

function availableCount(emp: Employer): number {
  // Unified capacity ledger: open = available vacancySlots (falls back to legacy).
  return openVacancies(emp);
}

// ── sub-components ───────────────────────────────────────────────────────────

function OrgCard({ emp }: { emp: Employer }) {
  const [open, setOpen] = useState(false);
  const avail = availableCount(emp);

  return (
    <div
      style={{
        background: 'var(--card)',
        border: open ? '1.5px solid var(--accent)' : '1px solid var(--divider)',
        borderRadius: '14px',
        overflow: 'hidden',
        transition: 'border-color 0.15s',
        cursor: emp.notes ? 'pointer' : 'default',
      }}
      onClick={() => emp.notes && setOpen(o => !o)}
    >
      {/* ── header row ── */}
      <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* icon */}
        <div style={{
          width: '42px', height: '42px', borderRadius: '10px', flexShrink: 0,
          background: 'var(--accent-soft)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '20px',
        }}>
          🏢
        </div>

        {/* name + badges */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--ink)', lineHeight: 1.3 }}>
            {emp.name}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
            {emp.location && (
              <span style={{
                fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em',
                background: 'var(--tag-neutral-bg)', color: 'var(--text-soft)',
                padding: '2px 9px', borderRadius: '999px', whiteSpace: 'nowrap',
              }}>
                📍 {emp.location}
              </span>
            )}
            {avail > 0 && (
              <span style={{
                fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em',
                background: 'var(--accent-soft)', color: 'var(--accent)',
                padding: '2px 9px', borderRadius: '999px', whiteSpace: 'nowrap',
              }}>
                {avail} {avail === 1 ? 'מקום פנוי' : 'מקומות פנויים'}
              </span>
            )}
            {avail === 0 && (emp.positionsTotal ?? emp.positions ?? 0) > 0 && (
              <span style={{
                fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em',
                background: 'rgba(217,119,6,0.12)', color: '#b45309',
                padding: '2px 9px', borderRadius: '999px', whiteSpace: 'nowrap',
              }}>
                מלא
              </span>
            )}
          </div>
        </div>

        {/* expand chevron */}
        {emp.notes && (
          <div style={{
            color: 'var(--text-soft)', fontSize: '18px', flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}>
            ⌄
          </div>
        )}
      </div>

      {/* ── description panel ── */}
      {open && emp.notes && (
        <div style={{
          padding: '0 20px 18px 20px',
          borderTop: '1px solid var(--divider)',
          paddingTop: '14px',
        }}>
          <div style={{
            fontSize: '13px', lineHeight: 1.7, color: 'var(--ink)',
            whiteSpace: 'pre-wrap',
          }}>
            {emp.notes}
          </div>
        </div>
      )}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function OrganizationsPage() {
  const [employers, setEmployers] = useState<Employer[]>([]);
  const [loading, setLoading]    = useState(true);
  const [search, setSearch]      = useState('');
  const courseFilter = getParam('course');

  useEffect(() => {
    supabase
      .from('practicum_data')
      .select('data')
      .eq('org_id', 'default')
      .single()
      .then(({ data }) => {
        // Run the placement migration so the public counter reflects the same
        // reconciled vacancy ledger the admin app uses (acceptedOrg → slots).
        const migrated = migratePlacementData(((data as any)?.data || {}) as any);
        const allEmps: Employer[] = (migrated.employers as any) || [];
        // Filter: only approved (or unset) employers with at least a name
        const active = allEmps.filter(e => {
          if (!e.name) return false;
          // Private (candidate-suggested) orgs are not shown in the public list.
          if ((e as any).restrictedToStudentId) return false;
          // Only orgs ready for students: description + open places, not pending/rejected.
          if (!orgAvailability(e).available) return false;
          // If course filter provided, employer must serve that course
          if (courseFilter) {
            const ids = e.courseIds || (e.courseId ? [e.courseId] : []);
            if (ids.length && !ids.includes(courseFilter)) return false;
          }
          return true;
        });
        // Sort: employers with notes first, then alphabetical
        active.sort((a, b) => {
          if (!!b.notes !== !!a.notes) return b.notes ? 1 : -1;
          return (a.name || '').localeCompare(b.name || '', 'he');
        });
        setEmployers(active);
        setLoading(false);
      });
  }, [courseFilter]);

  const filtered = employers.filter(e => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [e.name, e.location, e.notes].filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: '60px' }}>
      {/* ── header ── */}
      <div style={{
        background: 'var(--accent)', color: 'white',
        padding: '28px 24px 24px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.01em' }}>
          ארגונים לפרקטיקום
        </div>
        <div style={{ fontSize: '13px', marginTop: '6px', opacity: 0.85 }}>
          אוניברסיטת אריאל · תכנית הפרקטיקום במשאבי אנוש
        </div>
      </div>

      {/* ── search + count ── */}
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '20px 16px 0' }}>
        <input
          type="search"
          placeholder="חיפוש ארגון..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '10px 16px', borderRadius: '10px',
            border: '1px solid var(--divider)', background: 'var(--card)',
            color: 'var(--ink)', fontSize: '14px',
            outline: 'none',
          }}
        />
        {!loading && (
          <div style={{ fontSize: '12px', color: 'var(--text-soft)', marginTop: '10px', marginBottom: '4px' }}>
            {filtered.length} ארגונים
            {search ? ` תואמים "${search}"` : ' זמינים לפרקטיקום'}
            {' · לחץ/י על ארגון לקריאת התיאור'}
          </div>
        )}
      </div>

      {/* ── list ── */}
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '12px 16px 0' }}>
        {loading ? (
          <div style={{ textAlign: 'center', paddingTop: '60px', color: 'var(--text-soft)' }}>
            טוען...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: '60px', color: 'var(--text-soft)' }}>
            {search ? 'לא נמצאו ארגונים תואמים' : 'אין ארגונים זמינים כרגע'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filtered.map(emp => (
              <OrgCard key={emp.id} emp={emp} />
            ))}
          </div>
        )}
      </div>

      {/* ── footer note ── */}
      {!loading && filtered.length > 0 && (
        <div style={{
          maxWidth: '680px', margin: '24px auto 0',
          padding: '0 16px',
          fontSize: '12px', color: 'var(--text-soft)',
          textAlign: 'center', lineHeight: 1.6,
        }}>
          לחיצה על ארגון מציגה את תיאור הניסיון שתצבור/י שם.
          <br />
          הבחירה הסופית מתבצעת לאחר הגשת קורות חיים מעודכנים.
        </div>
      )}
    </div>
  );
}

/**
 * Public-facing organization page, linked from the acceptance email.
 * A student (identified by ?email=) can browse organizations available for THEIR
 * course and REQUEST one — which temporarily holds a place (tentative slot) until
 * the coordinator resolves it. Without an email it stays a read-only browse.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Employer } from '../lib/supabase';
import { employerStatus } from '../lib/orgAvailability';
import { migratePlacementData, countSlotsByStatus, studentSetRequests, studentCurrentPlacement, studentSuggestedOrgName, MAX_STUDENT_REQUESTS } from '../lib/placement';
import { saveSnapshot } from '../lib/dataApi';

function getParam(key: string): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(key) || '';
}

const STATUS_HE: Record<string, string> = {
  tentative: 'המקום שמור עבורך זמנית — ממתין לתשובת הרכזת',
  under_review: 'הבקשה שלך נשלחה למעסיק ונמצאת בבדיקה',
  placed: 'שובצת לארגון זה 🎉',
};

function OrgCard({ emp, availForCourse, canRequest, requesting, requested, atCap, listCap, onRequest }: {
  emp: Employer; availForCourse: number; canRequest: boolean; requesting: boolean;
  requested: boolean; atCap: boolean; listCap: number;
  onRequest: (e: Employer, mode: 'add' | 'remove') => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: 'var(--card)', border: open ? '1.5px solid var(--accent)' : '1px solid var(--divider)', borderRadius: '14px', overflow: 'hidden', transition: 'border-color 0.15s' }}>
      <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '12px', cursor: emp.notes ? 'pointer' : 'default' }}
        onClick={() => emp.notes && setOpen(o => !o)}>
        <div style={{ width: '42px', height: '42px', borderRadius: '10px', flexShrink: 0, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>🏢</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div data-org-name={emp.name} data-org-avail={availForCourse} style={{ fontWeight: 700, fontSize: '15px', color: 'var(--ink)', lineHeight: 1.3 }}>{emp.name}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
            {emp.location && (
              <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', background: 'var(--tag-neutral-bg)', color: 'var(--text-soft)', padding: '2px 9px', borderRadius: '999px', whiteSpace: 'nowrap' }}>📍 {emp.location}</span>
            )}
            {availForCourse > 0
              ? <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', background: 'var(--accent-soft)', color: 'var(--accent)', padding: '2px 9px', borderRadius: '999px', whiteSpace: 'nowrap' }}>{availForCourse} {availForCourse === 1 ? 'מקום פנוי' : 'מקומות פנויים'}</span>
              : <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', background: 'rgba(217,119,6,0.12)', color: '#b45309', padding: '2px 9px', borderRadius: '999px', whiteSpace: 'nowrap' }}>מלא</span>}
          </div>
        </div>
        {emp.notes && (
          <div style={{ color: 'var(--text-soft)', fontSize: '18px', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>⌄</div>
        )}
      </div>
      {open && emp.notes && (
        <div style={{ padding: '0 20px 14px 20px', borderTop: '1px solid var(--divider)', paddingTop: '14px' }}>
          <div style={{ fontSize: '13px', lineHeight: 1.7, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{emp.notes}</div>
        </div>
      )}
      {/* A request is intent, so a FULL org is still requestable — the coordinator
          regulates, and a place is only refused when she actually sends the CV. */}
      {canRequest && (
        <div style={{ padding: '0 20px 16px 20px' }}>
          <button
            type="button"
            data-request-org={emp.name}
            data-requested={requested ? '1' : '0'}
            onClick={(e) => { e.stopPropagation(); onRequest(emp, requested ? 'remove' : 'add'); }}
            disabled={requesting || (!requested && atCap)}
            title={!requested && atCap ? `הגעת ל‑${listCap} בקשות — הסר/י אחת כדי לבקש אחרת` : undefined}
            style={{
              width: '100%', padding: '11px', borderRadius: '10px',
              border: requested ? '1px solid var(--accent)' : 'none',
              background: requested ? 'transparent' : 'var(--accent)',
              color: requested ? 'var(--accent)' : 'white',
              fontSize: '14px', fontWeight: 700,
              cursor: requesting ? 'wait' : (!requested && atCap) ? 'not-allowed' : 'pointer',
              opacity: requesting ? 0.6 : (!requested && atCap) ? 0.45 : 1,
            }}>
            {requesting ? 'שומר/ת…'
              : requested ? '✓ ביקשת · הסר/י'
              : atCap ? `הגעת ל‑${listCap} בקשות`
              : 'בקש/י מקום זה ›'}
          </button>
          {!requested && availForCourse === 0 && !atCap && (
            <div style={{ marginTop: '6px', fontSize: '11.5px', color: '#b45309', textAlign: 'center' }}>
              הארגון מלא כרגע — ניתן לבקש, והרכזת תווסת.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Remembered identity, so a student types their email once per device rather
 *  than on every visit/reload. Only written after the email actually resolves to
 *  a student (never a typo), and clearable via "זה לא אני" for shared devices. */
const EMAIL_KEY = 'practicum_student_email';
function rememberedEmail(): string {
  if (typeof window === 'undefined') return '';
  try { return (localStorage.getItem(EMAIL_KEY) || '').trim().toLowerCase(); } catch { return ''; }
}

export default function OrganizationsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // ?email= in the link wins; otherwise fall back to the remembered identity.
  const [email, setEmail] = useState(getParam('email').trim().toLowerCase() || rememberedEmail());
  const [emailInput, setEmailInput] = useState('');
  const [requesting, setRequesting] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const courseFilter = getParam('course');

  const load = useCallback(async () => {
    const { data: row } = await supabase.from('practicum_data').select('data').eq('org_id', 'default').single();
    setData(migratePlacementData(((row as any)?.data || {}) as any));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep the places-remaining counts honest. The page used to fetch once on mount
  // and never again (it sits outside App.tsx's realtime channel), so a student
  // could stare at "3 מקומות פנויים" for places another student had already taken.
  // Refetch when the tab regains focus and on a slow interval while visible.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const id = setInterval(refresh, 45000);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      clearInterval(id);
    };
  }, [load]);

  const student = email && data ? (data.students || []).find((s: any) => String(s.email || '').trim().toLowerCase() === email) : null;
  const studentCourse: string | undefined = student?.courseId;
  const current = email && data ? studentCurrentPlacement(data, email) : null;
  // A request is INTENT, not a reservation (2026-07-20). So the only thing that ends
  // the ability to request is being PLACED — a CV already out with an employer no
  // longer blocks anything, and neither does a full organization.
  const isPlaced = current?.status === 'placed' || !!(student as any)?.acceptedOrg;
  const canRequest = !!student && !isPlaced;

  // A self-suggested org keeps rank #1 and is not one of the toggleable requests.
  const suggestedOrg = student && data ? studentSuggestedOrgName(data, student) : null;
  const listCap = MAX_STUDENT_REQUESTS - (suggestedOrg ? 1 : 0);
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const myRequests: string[] = student
    ? [(student as any).firstChoiceOrg, (student as any).secondChoiceOrg, (student as any).thirdChoiceOrg]
        .map((v: any) => (v || '').trim()).filter(Boolean)
        .filter((n: string) => !(suggestedOrg && sameName(n, suggestedOrg)))
    : [];
  const hasRequested = (emp: Employer) => myRequests.some(n => sameName(n, emp.name));
  const atCap = myRequests.length >= listCap;

  // Remember only a VERIFIED identity (resolved to a real student row).
  useEffect(() => {
    if (!student || !email) return;
    try { localStorage.setItem(EMAIL_KEY, email); } catch { /* private mode — fine */ }
  }, [student, email]);

  function forgetMe() {
    try { localStorage.removeItem(EMAIL_KEY); } catch { /* ignore */ }
    setEmail(''); setEmailInput(''); setMsg(null);
  }

  async function toggleRequest(emp: Employer, mode: 'add' | 'remove') {
    setMsg(null);
    setRequesting(emp.id);
    let orgName = emp.name;
    let count = 0;
    // Still a MUTATOR (not a pre-computed blob): it re-runs against the freshest cloud
    // state on every compare-and-swap attempt, so two students editing their lists at
    // the same moment can't clobber each other's students array. Nothing about a
    // vacancy is written here — a request holds no place.
    const save = await saveSnapshot(
      (cloud) => {
        const fresh = migratePlacementData(cloud as any);
        const res = studentSetRequests(fresh, email, emp.id, mode);
        if (!res.ok) return { error: res.error || 'הבקשה נכשלה' };
        orgName = res.employerName || emp.name;
        count = (res.requests || []).length;
        return { data: res.data };
      },
      { name: `סטודנט/ית (${email})` },
      { action: mode === 'add' ? 'בקשת ארגון' : 'הסרת בקשה', entity: 'ארגון', target: emp.name },
    );
    setRequesting(null);
    if (!save.ok) {
      setMsg({ type: 'error', text: save.error || 'השמירה נכשלה — נסה/י שוב.' });
      await load();
      return;
    }
    setMsg({
      type: 'success',
      text: mode === 'add'
        ? `נרשמה בקשתך ל"${orgName}" (${count} מתוך ${listCap}). הרכזת תיצור קשר — בקשה אינה תופסת מקום.`
        : `הבקשה ל"${orgName}" הוסרה (${count} מתוך ${listCap}).`,
    });
    await load();
  }

  const employers: Employer[] = data?.employers || [];
  // The single course×year this visitor may see: an identified student's own course
  // wins, else an explicit ?course=. If NEITHER resolves we show NOTHING.
  //
  // FAIL CLOSED — this page is public. Previously an unscoped visit (a link without
  // ?email= / ?course=, or an unrecognised email) skipped every guard below and
  // listed all globally-approved orgs across all courses AND years, so students saw
  // other programmes' organizations. A missing parameter must never widen access.
  const scope = studentCourse || courseFilter;
  const active = !scope ? [] : employers.filter(e => {
    if (!e.name) return false;
    // Private orgs (a student's OWN approved suggestion) are visible only to THAT
    // student — their reserved first-priority org — and hidden from everyone else.
    const restrictedTo = (e as any).restrictedToStudentId;
    if (restrictedTo && restrictedTo !== student?.id) return false;
    const ids = e.courseIds || ((e as any).courseId ? [(e as any).courseId] : []);
    // Must be explicitly assigned to THIS course. An org with no assignment is
    // unassigned — not "open to everyone" (it used to slip through this filter).
    if (!ids.includes(scope)) return false;
    // Show ONLY a GREEN (מאושר — manual OR auto) org, scoped to that course×year:
    // a בתהליך/נדחה/טרם org never appears to students, and a manually-approved one does.
    if (employerStatus(e, [scope]).key !== 'approved') return false;
    // …and require a real open (course×year) slot — a green-but-full org drops out.
    if (countSlotsByStatus(e, scope).available <= 0) return false;
    return true;
  }).sort((a, b) => {
    if (!!b.notes !== !!a.notes) return b.notes ? 1 : -1;
    return (a.name || '').localeCompare(b.name || '', 'he');
  });

  const filtered = active.filter(e => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [e.name, e.location, e.notes].filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  // Always count places for the SCOPED course. The old fallback
  // (orgAvailability(emp).open) was not course- or year-scoped, so a visitor
  // browsing by ?course= could be shown a number that included places belonging
  // to other courses. `scope` is guaranteed non-empty wherever cards render.
  const availFor = (emp: Employer) => (scope ? countSlotsByStatus(emp, scope).available : 0);

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: '60px' }}>
      <div style={{ background: 'var(--accent)', color: 'white', padding: '28px 24px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.01em' }}>ארגונים לפרקטיקום</div>
        <div style={{ fontSize: '13px', marginTop: '6px', opacity: 0.85 }}>אוניברסיטת אריאל · תכנית הפרקטיקום במשאבי אנוש</div>
        {student && (
          <div style={{ fontSize: '13.5px', marginTop: '10px', fontWeight: 600 }}>
            שלום {student.name || ''} 👋
            {/* Shared-device escape: the identity is remembered on this device, so
                offer an explicit way out — otherwise the next student on the same
                phone would act as this one. */}
            <button type="button" onClick={forgetMe}
              style={{ marginRight: '10px', background: 'transparent', border: 'none', color: 'white', opacity: 0.75, fontSize: '12px', textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 }}>
              זה לא אני
            </button>
          </div>
        )}
      </div>

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '20px 16px 0' }}>
        {/* Identify (only when no email was supplied) */}
        {!student && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--divider)', borderRadius: '12px', padding: '16px', marginBottom: '14px' }}>
            <div style={{ fontSize: '13.5px', color: 'var(--ink)', marginBottom: '8px', fontWeight: 600 }}>כדי לבקש מקום, הזן/י את המייל שאיתו נרשמת:</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input type="email" placeholder="you@example.com" value={emailInput} onChange={e => setEmailInput(e.target.value)}
                style={{ flex: '1 1 180px', minWidth: 0, padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--divider)', background: 'var(--bg)', color: 'var(--ink)', fontSize: '14px' }} />
              <button type="button" onClick={() => { setEmail(emailInput.trim().toLowerCase()); setMsg(null); }}
                style={{ padding: '10px 18px', borderRadius: '10px', border: 'none', background: 'var(--accent)', color: 'white', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>המשך/י</button>
            </div>
            {email && !student && !loading && <div style={{ fontSize: '12.5px', color: '#b91c1c', marginTop: '8px' }}>המייל לא נמצא ברשימת הסטודנטים. בדוק/י אותו או פנה/י לרכזת.</div>}
          </div>
        )}

        {/* Current hold / placement banner */}
        {current && (
          <div style={{ background: current.status === 'placed' ? 'rgba(21,128,61,0.1)' : 'rgba(217,119,6,0.1)', border: `1px solid ${current.status === 'placed' ? '#15803d' : '#d97706'}`, borderRadius: '12px', padding: '14px 16px', marginBottom: '14px' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: current.status === 'placed' ? '#15803d' : '#b45309' }}>{current.orgName}</div>
            <div style={{ fontSize: '12.5px', color: 'var(--ink)', marginTop: '3px' }}>{STATUS_HE[current.status] || 'ממתין'}</div>
          </div>
        )}

        {/* Request result */}
        {msg && (
          <div style={{ background: msg.type === 'success' ? 'rgba(21,128,61,0.1)' : 'rgba(185,28,28,0.08)', border: `1px solid ${msg.type === 'success' ? '#15803d' : '#b91c1c'}`, borderRadius: '12px', padding: '12px 16px', marginBottom: '14px', fontSize: '13.5px', color: msg.type === 'success' ? '#15803d' : '#b91c1c', fontWeight: 600 }}>{msg.text}</div>
        )}

        {/* Search + count only make sense once we know WHICH course's list to show. */}
        {scope && (
          <>
            <input type="search" placeholder="חיפוש ארגון..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 16px', borderRadius: '10px', border: '1px solid var(--divider)', background: 'var(--card)', color: 'var(--ink)', fontSize: '14px', outline: 'none' }} />
            {!loading && (
              <div style={{ fontSize: '12px', color: 'var(--text-soft)', marginTop: '10px', marginBottom: '4px' }}>
                {filtered.length} ארגונים{search ? ` תואמים "${search}"` : (canRequest ? ' זמינים לקורס שלך' : ' זמינים לפרקטיקום')}
                {canRequest ? ' · בחר/י ארגון ולחצ/י «בקש/י מקום»' : ' · לחץ/י על ארגון לקריאת התיאור'}
                {canRequest && (
                  <span data-request-counter={myRequests.length} style={{ display: 'block', marginTop: '4px', fontWeight: 700, color: atCap ? '#b45309' : 'var(--accent)' }}>
                    בחרת {myRequests.length} מתוך {listCap}
                    {suggestedOrg ? ` · «${suggestedOrg}» שהצעת שמור כבחירה ראשונה` : ''}
                    {atCap ? ' · להחלפה — הסר/י בקשה קיימת' : ''}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '12px 16px 0' }}>
        {loading ? (
          <div style={{ textAlign: 'center', paddingTop: '60px', color: 'var(--text-soft)' }}>טוען...</div>
        ) : !scope ? (
          /* No course resolved → show nothing. The identify box above is the way in. */
          <div style={{ textAlign: 'center', paddingTop: '40px', color: 'var(--text-soft)', fontSize: '13.5px', lineHeight: 1.8 }}>
            הזן/י למעלה את המייל שאיתו נרשמת<br />כדי לראות את רשימת הארגונים של הקורס שלך.
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: '60px', color: 'var(--text-soft)' }}>{search ? 'לא נמצאו ארגונים תואמים' : 'אין ארגונים זמינים כרגע'}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filtered.map(emp => (
              <OrgCard key={emp.id} emp={emp} availForCourse={availFor(emp)} canRequest={canRequest}
                requesting={requesting === emp.id} requested={hasRequested(emp)} atCap={atCap} listCap={listCap}
                onRequest={toggleRequest} />
            ))}
          </div>
        )}
      </div>

      {!loading && filtered.length > 0 && (
        <div style={{ maxWidth: '680px', margin: '24px auto 0', padding: '0 16px', fontSize: '12px', color: 'var(--text-soft)', textAlign: 'center', lineHeight: 1.6 }}>
          {canRequest
            ? `ניתן לבקש עד ${listCap} ארגונים${suggestedOrg ? ' (בנוסף לארגון שהצעת, השמור כבחירה ראשונה)' : ''}. הבקשה מציינת העדפה — הרכזת מווסתת ומאשרת. בקשה אינה תופסת מקום ואינה מבטיחה שיבוץ, וניתן לבקש גם ארגון מלא.`
            : 'לחיצה על ארגון מציגה את תיאור הניסיון שתצבור/י שם.'}
        </div>
      )}
    </div>
  );
}

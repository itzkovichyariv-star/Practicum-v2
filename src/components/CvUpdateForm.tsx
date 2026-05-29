import { useState, useEffect, useRef, type FormEvent, type CSSProperties } from 'react';
import { supabase } from '../lib/supabase';

type Status = 'idle' | 'uploading' | 'done' | 'error';
type OrgOption = { name: string; notes: string };

export default function CvUpdateForm() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const prefillEmail = params.get('email') || '';
  const prefillName  = params.get('name')  || '';
  const courseParam  = params.get('course') || '';

  const [email, setEmail] = useState(prefillEmail);
  const [name,  setName]  = useState(prefillName);
  const [file,  setFile]  = useState<File | null>(null);
  const [orgs,  setOrgs]  = useState<OrgOption[]>([]);
  const [pref1, setPref1] = useState('');
  const [pref2, setPref2] = useState('');
  const [pref3, setPref3] = useState('');
  // Candidate-suggested organization (private, needs admin approval, becomes 1st choice)
  const [suggesting, setSuggesting] = useState(false);
  const [sgName,    setSgName]    = useState('');
  const [sgContact, setSgContact] = useState('');
  const [sgRole,    setSgRole]    = useState('');
  const [sgEmail,   setSgEmail]   = useState('');
  const [sgPhone,   setSgPhone]   = useState('');
  const [sgLocation, setSgLocation] = useState('');
  const [sgNotes,   setSgNotes]   = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [err,    setErr]    = useState<string | null>(null);

  // Load approved organizations (with descriptions) so the candidate can state a preference.
  useEffect(() => {
    supabase
      .from('practicum_data')
      .select('data')
      .eq('org_id', 'default')
      .single()
      .then(({ data }) => {
        const all: any[] = (data as any)?.data?.employers || [];
        const seen = new Set<string>();
        const opts = all
          .filter(e => {
            if (!e?.name) return false;
            if (e.approvalStatus === 'rejected') return false;
            if (courseParam) {
              const ids = e.courseIds || (e.courseId ? [e.courseId] : []);
              if (ids.length && !ids.includes(courseParam)) return false;
            }
            if (seen.has(e.name)) return false;
            seen.add(e.name);
            return true;
          })
          .map(e => ({ name: e.name as string, notes: (e.notes as string) || '' }))
          .sort((a, b) => a.name.localeCompare(b.name, 'he'));
        setOrgs(opts);
      });
  }, [courseParam]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!email.trim()) { setErr('יש להזין מייל'); return; }
    if (!file)         { setErr('יש לבחור קובץ'); return; }

    // Build the suggested-org payload. Required fields apply only when suggesting.
    let suggestedOrg: Record<string, string> | null = null;
    if (suggesting) {
      const required: Array<[string, string]> = [
        [sgName, 'שם הארגון'], [sgContact, 'שם איש/אשת הקשר'], [sgRole, 'תפקיד'],
        [sgEmail, 'אימייל'], [sgPhone, 'טלפון'],
      ];
      const missing = required.find(([v]) => !v.trim());
      if (missing) { setErr(`להצעת ארגון יש למלא: ${missing[1]}`); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sgEmail.trim())) { setErr('אימייל איש הקשר אינו תקין'); return; }
      if (sgPhone.replace(/\D/g, '').length < 9) { setErr('טלפון איש הקשר אינו תקין'); return; }
      suggestedOrg = {
        name: sgName.trim(), contactName: sgContact.trim(), contactRole: sgRole.trim(),
        email: sgEmail.trim(), phone: sgPhone.trim(),
        location: sgLocation.trim(), notes: sgNotes.trim(),
      };
    }

    setStatus('uploading');

    // Upload file to candidate-uploads bucket
    const safeEmail = email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40) || 'candidate';
    const ext = (file.name.split('.').pop() || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8) || 'bin';
    const path = `cv-updates/${safeEmail}-${Date.now()}.${ext}`;

    const { error: uploadErr } = await supabase.storage.from('candidate-uploads').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });

    if (uploadErr) {
      setStatus('error');
      setErr('העלאה נכשלה: ' + uploadErr.message);
      return;
    }

    // Record in cv_updates table
    const { error: dbErr } = await supabase.from('cv_updates').insert({
      email: email.trim().toLowerCase(),
      name: name.trim() || null,
      cv_file_path: path,
      org_pref_1: pref1 || null,
      org_pref_2: pref2 || null,
      org_pref_3: pref3 || null,
      suggested_org: suggestedOrg,
    });

    if (dbErr) {
      setStatus('error');
      setErr('שגיאה בשמירה: ' + dbErr.message);
      return;
    }

    // Alert the coordinator when a candidate proposes their own organization.
    // Best-effort: never block the submission on the notification.
    if (suggestedOrg) {
      try {
        await fetch('https://vpqgmcmavnszcnakhiat.supabase.co/functions/v1/notify-org-suggestion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            record: {
              candidateName: name.trim() || null,
              candidateEmail: email.trim().toLowerCase(),
              suggestedOrg,
            },
          }),
        });
      } catch { /* ignore — the suggestion is already saved in cv_updates */ }
    }

    setStatus('done');
  }

  if (status === 'done') {
    return (
      <div className="max-w-[480px] mx-auto p-10 text-center">
        <div className="chapter-mark mb-4">✓ התקבל</div>
        <h1 className="serif text-[36px] leading-[1.1] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>
          קורות החיים עודכנו
        </h1>
        <p className="text-[15px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
          הצוות יקבל עדכון ויעיין בגרסה החדשה. תודה!
        </p>
        <div className="mono text-[11px] uppercase tracking-[0.14em] mt-8" style={{ color: 'var(--text-soft)' }}>
          Ariel University · Management · Practicum
        </div>
      </div>
    );
  }

  const busy = status === 'uploading';

  return (
    <div className="max-w-[480px] mx-auto p-10">
      <div className="chapter-mark mb-4">עדכון מסמכים</div>
      <h1 className="serif text-[36px] leading-[1.1] tracking-tight mb-2" style={{ color: 'var(--ink)' }}>
        העלאת CV מעודכן
      </h1>
      <p className="text-[15px] leading-[1.55] mb-8" style={{ color: 'var(--ink)', opacity: 0.82 }}>
        לאחר סדנת קורות חיים — העלה/י את הגרסה המעודכנת כאן.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block">
            <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>מייל *</span>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              readOnly={!!prefillEmail}
              className="input w-full"
              style={{
                padding: '12px 16px',
                fontSize: '14.5px',
                opacity: prefillEmail ? 0.7 : 1,
                cursor: prefillEmail ? 'default' : undefined,
              }}
            />
          </label>
        </div>

        {!prefillName && (
          <div>
            <label className="block">
              <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>שם מלא (אופציונלי)</span>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="input w-full"
                style={{ padding: '12px 16px', fontSize: '14.5px' }}
              />
            </label>
          </div>
        )}

        <div>
          <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>קורות חיים מעודכנים (PDF / Word) *</span>
          <label
            className="block border-2 border-dashed rounded-xl p-5 cursor-pointer transition-colors hover:bg-[rgba(122,30,43,0.03)]"
            style={{ borderColor: file ? 'var(--accent)' : 'var(--divider)' }}
          >
            <input type="file" accept=".pdf,.doc,.docx" onChange={e => setFile(e.target.files?.[0] || null)} className="hidden" />
            <div className="flex items-center gap-3">
              <span className="serif text-[28px]" style={{ color: file ? 'var(--accent)' : 'var(--text-soft)' }}>
                {file ? '✓' : '📎'}
              </span>
              <div className="flex-1">
                <div className="text-[14px]" style={{ color: file ? 'var(--ink)' : 'var(--text-soft)' }}>
                  {file ? file.name : 'לחץ/י כדי לבחור קובץ'}
                </div>
                {file && (
                  <div className="mono text-[11px] uppercase tracking-[0.12em] mt-0.5" style={{ color: 'var(--text-soft)' }}>
                    {(file.size / 1024).toFixed(0)} KB
                  </div>
                )}
              </div>
              {file && (
                <button
                  type="button"
                  onClick={e => { e.preventDefault(); e.stopPropagation(); setFile(null); }}
                  className="mono text-[10px] uppercase tracking-[0.14em] opacity-60 hover:opacity-100"
                >
                  הסר
                </button>
              )}
            </div>
          </label>
        </div>

        {orgs.length > 0 && (
          <div className="space-y-4 pt-1">
            <OrgPicker
              label="העדפת ארגון — בחירה ראשונה"
              value={pref1}
              onChange={v => { setPref1(v); if (v && v === pref2) setPref2(''); if (v && v === pref3) setPref3(''); }}
              options={orgs}
              placeholder="— ללא העדפה —"
            />
            <OrgPicker
              label="העדפת ארגון — בחירה שנייה (אופציונלי)"
              value={pref2}
              onChange={v => { setPref2(v); if (v && v === pref3) setPref3(''); }}
              options={orgs.filter(o => o.name !== pref1)}
              placeholder="— ללא —"
            />
            <OrgPicker
              label="העדפת ארגון — בחירה שלישית (אופציונלי)"
              value={pref3}
              onChange={setPref3}
              options={orgs.filter(o => o.name !== pref1 && o.name !== pref2)}
              placeholder="— ללא —"
            />
            <p className="text-[12px] leading-[1.5]" style={{ color: 'var(--text-soft)' }}>
לחיצה על שם הארגון בוחרת אותו · לחיצה על «ⓘ תיאור» מציגה את תיאור הארגון. ההעדפה אינה מחייבת שיבוץ — הארגון מראיין בהמשך ויש מועמדים נוספים. ניתן להשאיר ריק.
            </p>
          </div>
        )}

        {/* ── Suggest your own organization (private · needs approval · becomes 1st choice) ── */}
        <div className="pt-1">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={suggesting}
              onChange={e => setSuggesting(e.target.checked)}
              className="mt-0.5"
              style={{ accentColor: 'var(--accent)', width: 16, height: 16 }}
            />
            <span className="text-[14px] leading-[1.5]" style={{ color: 'var(--ink)' }}>
              יש לי ארגון להציע (קשר אישי שאינו ברשימה)
            </span>
          </label>

          {suggesting && (
            <div className="mt-3 rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--accent)', background: 'rgba(122,30,43,0.04)' }}>
              <p className="text-[12.5px] leading-[1.55]" style={{ color: 'var(--ink)', opacity: 0.85 }}>
                ההצעה פרטית אליך וכפופה לאישור מנחה התכנית. אם תאושר — הארגון יהפוך לבחירה הראשונה שלך.
                יש למלא את פרטי איש/אשת הקשר במשאבי אנוש במלואם.
              </p>
              <SgInput label="שם הארגון *" value={sgName} onChange={setSgName} />
              <SgInput label="שם איש/אשת הקשר (משאבי אנוש) *" value={sgContact} onChange={setSgContact} />
              <SgInput label="תפקיד *" value={sgRole} onChange={setSgRole} placeholder="למשל: מנהלת משאבי אנוש" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SgInput label="אימייל *" value={sgEmail} onChange={setSgEmail} type="email" />
                <SgInput label="טלפון *" value={sgPhone} onChange={setSgPhone} type="tel" />
              </div>
              <SgInput label="מיקום (אופציונלי)" value={sgLocation} onChange={setSgLocation} />
              <div>
                <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>פרטים / הקשר שלך לארגון (אופציונלי)</span>
                <textarea
                  value={sgNotes}
                  onChange={e => setSgNotes(e.target.value)}
                  rows={3}
                  className="input w-full"
                  style={{ padding: '10px 14px', fontSize: '14px', resize: 'vertical', lineHeight: 1.6 }}
                />
              </div>
            </div>
          )}
        </div>

        {err && (
          <div className="mono text-[11.5px] uppercase tracking-[0.14em] py-2" style={{ color: 'var(--accent)' }}>
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !file}
          style={{
            display: 'block', width: '100%', padding: '16px', fontSize: '15px', fontWeight: 600,
            background: (busy || !file) ? 'var(--divider)' : 'var(--accent)',
            color: 'white', border: 'none', borderRadius: '12px',
            cursor: (busy || !file) ? 'not-allowed' : 'pointer',
            opacity: (busy || !file) ? 0.6 : 1,
          }}
        >
          {busy ? 'מעלה...' : 'שלח CV מעודכן ←'}
        </button>
      </form>
    </div>
  );
}

function SgInput({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="input w-full"
        style={{ padding: '10px 14px', fontSize: '14px' }}
      />
    </label>
  );
}

/* Custom org selector: tap/click selects; hover (desktop) or long-press (mobile)
   reveals the organization's description inline. Native <select> can't do this. */
function OrgPicker({ label, value, onChange, options, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: OrgOption[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null); // org name whose description is shown
  const ref = useRef<HTMLDivElement>(null);
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpFired = useRef(false);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setPreview(null); }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function select(name: string) { onChange(name); setOpen(false); setPreview(null); }

  function startLongPress(name: string, hasNotes: boolean) {
    lpFired.current = false;
    if (lpTimer.current) clearTimeout(lpTimer.current);
    lpTimer.current = setTimeout(() => {
      lpFired.current = true;
      if (hasNotes) setPreview(p => (p === name ? null : name));
    }, 450);
  }
  function endLongPress(name: string) {
    if (lpTimer.current) clearTimeout(lpTimer.current);
    if (!lpFired.current) select(name); // short tap = select
  }
  function cancelLongPress() { if (lpTimer.current) clearTimeout(lpTimer.current); }

  const sharedRow: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: '10px', padding: '10px 14px', cursor: 'pointer', fontSize: '14px',
    WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none',
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>{label}</span>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="input w-full"
        style={{ padding: '12px 16px', fontSize: '14.5px', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', cursor: 'pointer' }}
      >
        <span style={{ color: value ? 'var(--ink)' : 'var(--text-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value || placeholder}
        </span>
        <span style={{ color: 'var(--text-soft)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', insetInlineStart: 0, insetInlineEnd: 0, top: 'calc(100% + 4px)', zIndex: 50,
            maxHeight: '300px', overflowY: 'auto',
            background: 'var(--card, var(--bg))', border: '1px solid var(--divider)', borderRadius: '12px',
            boxShadow: '0 8px 28px rgba(0,0,0,0.16)',
          }}
        >
          <div onClick={() => select('')} style={{ ...sharedRow, color: 'var(--text-soft)', borderBottom: '1px solid var(--divider)' }}>
            {placeholder}
          </div>
          {options.map(o => {
            const selected = value === o.name;
            const hasNotes = !!o.notes.trim();
            return (
              <div key={o.name} style={{ borderBottom: '1px solid var(--divider)' }}>
                <div
                  onClick={() => select(o.name)}
                  onMouseEnter={() => hasNotes && setPreview(o.name)}
                  onMouseLeave={() => setPreview(p => (p === o.name ? null : p))}
                  onTouchStart={() => startLongPress(o.name, hasNotes)}
                  onTouchEnd={e => { e.preventDefault(); endLongPress(o.name); }}
                  onTouchMove={cancelLongPress}
                  style={{
                    ...sharedRow,
                    background: selected ? 'rgba(122,30,43,0.08)' : 'transparent',
                    color: selected ? 'var(--accent)' : 'var(--ink)',
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>{o.name}</span>
                  {hasNotes && (
                    <button
                      type="button"
                      title="הצג תיאור הארגון"
                      onClick={e => { e.stopPropagation(); setPreview(p => (p === o.name ? null : o.name)); }}
                      onTouchStart={e => { e.stopPropagation(); }}
                      onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); setPreview(p => (p === o.name ? null : o.name)); }}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
                        fontSize: '11px', fontWeight: 600, lineHeight: 1, padding: '4px 8px',
                        borderRadius: 999, cursor: 'pointer',
                        border: '1px solid var(--divider)',
                        background: preview === o.name ? 'var(--accent)' : 'transparent',
                        color: preview === o.name ? 'var(--bg)' : 'var(--text-soft)',
                      }}
                    >ⓘ תיאור</button>
                  )}
                  {selected && <span style={{ flexShrink: 0, color: 'var(--accent)' }}>✓</span>}
                </div>
                {preview === o.name && hasNotes && (
                  <div
                    style={{
                      padding: '8px 14px 12px', fontSize: '12.5px', lineHeight: 1.6,
                      color: 'var(--ink)', opacity: 0.85, whiteSpace: 'pre-wrap',
                      background: 'rgba(122,30,43,0.04)',
                    }}
                  >
                    {o.notes}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useMemo, useRef, type FormEvent, type CSSProperties } from 'react';
import { publicSupabase as supabase } from '../lib/supabase';
import { employerStatus } from '../lib/orgAvailability';
import { useFormDraft } from '../lib/useFormDraft';
import { openCv } from '../lib/cvUrl';
import { countSlotsByStatus } from '../lib/placement';

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
  const errRef = useRef<HTMLDivElement>(null);
  // Whenever a validation error appears, bring it into view so the user sees
  // exactly why the submit didn't go through (the button is at the bottom).
  useEffect(() => {
    if (err) errRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [err]);

  // Nothing typed here may be lost either — the org preferences and, above all, the
  // suggested-organization details (contact person, role, phone…) are real effort.
  // Keyed by the student's email so a shared device never shows someone else's draft.
  // The CV FILE itself cannot be persisted (a File handle isn't serialisable) — that
  // one field must always be re-attached, which the form already tells them.
  const draft = useFormDraft(
    email.trim() ? `practicum_draft_cvupdate_${email.trim().toLowerCase()}` : null,
    'v1',
    { pref1, pref2, pref3, suggesting, sgName, sgContact, sgRole, sgEmail, sgPhone, sgLocation, sgNotes },
    (v) => {
      if (v.pref1) setPref1(v.pref1 as string);
      if (v.pref2) setPref2(v.pref2 as string);
      if (v.pref3) setPref3(v.pref3 as string);
      if (v.suggesting) setSuggesting(v.suggesting as boolean);
      if (v.sgName) setSgName(v.sgName as string);
      if (v.sgContact) setSgContact(v.sgContact as string);
      if (v.sgRole) setSgRole(v.sgRole as string);
      if (v.sgEmail) setSgEmail(v.sgEmail as string);
      if (v.sgPhone) setSgPhone(v.sgPhone as string);
      if (v.sgLocation) setSgLocation(v.sgLocation as string);
      if (v.sgNotes) setSgNotes(v.sgNotes as string);
    },
  );

  // The whole blob once; the option list is derived so it re-scopes the moment the
  // student is identified (the emailed link prefills the address, so that is instant).
  const [blob, setBlob] = useState<any | null>(null);
  useEffect(() => {
    supabase.from('practicum_data').select('data').eq('org_id', 'default').single()
      .then(({ data }) => setBlob((data as any)?.data || null));
  }, []);

  // SCOPE — resolve the student's own course from their email, exactly as the public
  // /organizations page does. The acceptance email links here with ?email= but WITHOUT
  // ?course=, so relying on the URL param alone left the list UNSCOPED and offered a
  // תשפ״ז HR student organizations belonging to other programmes/years. Resolving by
  // email fixes every link already sent — no need to reissue anything.
  const scope: string = useMemo(() => {
    const em = (email || '').trim().toLowerCase();
    if (!em || !blob) return courseParam || '';
    const match = (r: any) => String(r?.email || '').trim().toLowerCase() === em;
    // Students first. Then CANDIDATES — the acceptance mail can reach someone before
    // the coordinator converts them to a student (conversion copies email+courseId
    // from the candidate, CandidatesPage.tsx:296-308), and without this fallback that
    // window would strand a legitimately accepted student with an empty picker.
    const stu = (blob.students || []).find(match);
    const cand = stu ? null : (blob.candidates || []).find(match);
    return stu?.courseId || cand?.courseId || courseParam || '';
  }, [blob, email, courseParam]);

  // FAIL CLOSED — with no resolvable course we offer NOTHING rather than everything.
  // Same GREEN-and-has-a-free-place rule the organizations page applies, so the two
  // student-facing surfaces cannot disagree about what is on offer.
  const orgs: OrgOption[] = useMemo(() => {
    const all: any[] = blob?.employers || [];
    if (!scope) return [];
    const seen = new Set<string>();
    return all
      .filter(e => {
        if (!e?.name) return false;
        // Private (candidate-suggested) orgs aren't offered as generic preferences —
        // a student proposes their own through the suggestion section below.
        if (e.restrictedToStudentId) return false;
        const ids = e.courseIds || (e.courseId ? [e.courseId] : []);
        if (!ids.includes(scope)) return false;
        if (employerStatus(e, [scope]).key !== 'approved') return false;
        if (countSlotsByStatus(e, scope).available <= 0) return false;
        if (seen.has(e.name)) return false;
        seen.add(e.name);
        return true;
      })
      .map(e => ({ name: e.name as string, notes: (e.notes as string) || '' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [blob, scope]);

  // ── Returning student: everything under this one link ──────────────────────
  // Yariv 2026-07-21: "אני רוצה שהכל ישב תחת אותו קישור שכבר יש להם" + be able to
  // "לעדכן רק קורות חיים או רק ארגון אחד". So a student who already submitted can
  // come back here and change JUST the CV or JUST one org — without redoing the rest.
  const me = useMemo(() => {
    const em = (email || '').trim().toLowerCase();
    return em && blob ? (blob.students || []).find((s: any) => String(s.email || '').trim().toLowerCase() === em) : null;
  }, [blob, email]);
  // The current CV's storage path — reused when they update ONLY the orgs (cv_updates
  // requires a cv_file_path, so an org-only update keeps the CV on file).
  const existingCvPath = useMemo(() => {
    const ref = (me as any)?.cvUpdatedUrl || (me as any)?.cvUrl || '';
    const m = String(ref).match(/^storage:\/\/[^/]+\/(.+)$/);
    return m ? m[1] : (ref && !/^https?:\/\//i.test(ref) ? ref : '');
  }, [me]);
  const hasExistingCv = !!existingCvPath;

  // Pre-fill the 3 org pickers with the student's CURRENT choices, once, and only if
  // the form is still blank (never clobber a restored draft or live typing).
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || !me) return;
    prefilledRef.current = true;
    if (!pref1 && !pref2 && !pref3) {
      if ((me as any).firstChoiceOrg) setPref1((me as any).firstChoiceOrg);
      if ((me as any).secondChoiceOrg) setPref2((me as any).secondChoiceOrg);
      if ((me as any).thirdChoiceOrg) setPref3((me as any).thirdChoiceOrg);
    }
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  // The student's OWN submission history — so they can see what they submitted before,
  // when (Yariv: "student history was also requested"). Read-only; the coordinator has
  // the same view in the editor. Refetched via `historyTick` after each submit.
  const [myHistory, setMyHistory] = useState<Array<{ id: string; uploaded_at: string; cv_file_path?: string | null; org_pref_1?: string | null; org_pref_2?: string | null; org_pref_3?: string | null }>>([]);
  const [showMyHistory, setShowMyHistory] = useState(false);
  useEffect(() => {
    const em = (email || '').trim().toLowerCase();
    if (!em) { setMyHistory([]); return; }
    let alive = true;
    supabase.from('cv_updates')
      .select('id, uploaded_at, cv_file_path, org_pref_1, org_pref_2, org_pref_3')
      .eq('email', em)
      .order('uploaded_at', { ascending: false })
      .limit(20)
      .then(({ data }) => { if (alive) setMyHistory((data || []) as any); });
    return () => { alive = false; };
  }, [email]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!email.trim()) { setErr('יש להזין כתובת מייל'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setErr('כתובת המייל אינה תקינה'); return; }
    // A CV is required only for someone with NONE on file. A RETURNING student can
    // update just their orgs and keep the existing CV — the whole point of "one link,
    // partial updates". A first-time submission still must attach a file.
    if (!file && !hasExistingCv) { setErr('יש לצרף קובץ קורות חיים (PDF או Word)'); return; }
    // At least SOMETHING must change — a new CV, or an org preference.
    if (!file && !pref1.trim() && !pref2.trim() && !pref3.trim() && !suggesting) {
      setErr('לא בוצע שינוי — העלה/י קו"ח חדש או בחר/י ארגון לעדכון.'); return;
    }

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

    // Upload a NEW CV if one was attached; otherwise reuse the CV already on file (an
    // org-only update). cv_updates.cv_file_path is NOT NULL, so an org-only submission
    // records the existing path — the coordinator's "adopt" keeps that CV and takes
    // the new org preferences.
    let path = existingCvPath;
    if (file) {
      const safeEmail = email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40) || 'candidate';
      const ext = (file.name.split('.').pop() || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8) || 'bin';
      path = `cv-updates/${safeEmail}-${Date.now()}.${ext}`;
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
    }
    if (!path) { setStatus('error'); setErr('אין קו"ח לשמור — יש לצרף קובץ.'); return; }

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
    // Best-effort: never block the submission on the notification. Mirrors the
    // header pattern of notify-submission so it works once the function is set
    // to verify_jwt=false (required for public/anon invocation).
    if (suggestedOrg) {
      try {
        const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
        await fetch('https://vpqgmcmavnszcnakhiat.supabase.co/functions/v1/notify-org-suggestion', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ANON}`,
            'apikey': ANON,
          },
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

    draft.clear(); // safely submitted — only now is the local copy redundant
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
      <p className="text-[15px] leading-[1.55] mb-3" style={{ color: 'var(--ink)', opacity: 0.82 }}>
        לאחר סדנת קורות חיים — העלה/י את הגרסה המעודכנת ובחר/י העדפות ארגון כאן.
      </p>
      {/* Returning student: everything is under this one link — update just the CV,
          just an org, or both, without redoing the rest. */}
      {hasExistingCv && (
        <div className="rounded-lg px-4 py-3 mb-6 text-[13.5px] leading-[1.6]"
          style={{ background: 'rgba(5,150,105,0.08)', border: '1px solid rgba(5,150,105,0.35)', color: '#065f46' }}>
          ✓ כבר הגשת דרך הקישור הזה. אפשר לעדכן <strong>רק את הקו״ח</strong>, <strong>רק ארגון</strong>, או את שניהם — מה שלא תשנה/י יישאר כפי שהוא. ההעדפות למטה מולאו לפי הבחירה הנוכחית שלך.
        </div>
      )}

      {/* The student's OWN submission history — revealed on demand (Yariv). Read-only. */}
      {myHistory.length > 0 && (
        <div className="mb-6">
          <button type="button" onClick={() => setShowMyHistory(s => !s)}
            className="text-[13px] underline" style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            {showMyHistory ? 'הסתר את היסטוריית ההגשות שלי' : `היסטוריית ההגשות שלי (${myHistory.length})`}
          </button>
          {showMyHistory && (
            <div className="mt-2 space-y-1.5 pt-2" style={{ borderTop: '1px dashed var(--divider)' }}>
              {myHistory.map((row, idx) => {
                const ps = [row.org_pref_1, row.org_pref_2, row.org_pref_3].filter(Boolean);
                let when = row.uploaded_at;
                try { when = new Date(row.uploaded_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch { /* keep raw */ }
                return (
                  <div key={row.id} className="text-[12.5px] flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--text-soft)' }}>
                    <span className="font-semibold" style={{ color: idx === 0 ? 'var(--accent)' : 'var(--text-soft)' }}>{when}{idx === 0 ? ' · אחרונה' : ''}</span>
                    <span>· {ps.length ? ps.map((p, i) => `${i + 1}. ${p}`).join('   ') : 'ללא העדפות'}</span>
                    {row.cv_file_path && (
                      <button type="button" onClick={() => openCv(`storage://candidate-uploads/${row.cv_file_path}`)}
                        className="underline" style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                        קו״ח ↗
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
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
          <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>
            {hasExistingCv ? 'קורות חיים מעודכנים (PDF / Word) — אופציונלי' : 'קורות חיים מעודכנים (PDF / Word) *'}
          </span>
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
                  {file ? file.name : (hasExistingCv ? 'יש קו״ח על הקובץ — לחץ/י כדי להחליף (או השאר/י ריק)' : 'לחץ/י כדי לבחור קובץ')}
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

        {/* Fail-closed means an unidentified visitor sees no organizations. Say WHY,
            otherwise the preference section just silently vanishes and reads as a bug. */}
        {orgs.length === 0 && (
          <div className="rounded-lg px-4 py-3 text-[13px] leading-[1.6]"
            style={{ background: 'rgba(122,30,43,0.05)', border: '1px solid rgba(122,30,43,0.2)', color: 'var(--text-soft)' }}>
            {!email.trim()
              ? 'הזן/י את המייל שאיתו נרשמת כדי לראות את רשימת הארגונים של הקורס שלך.'
              : !scope
              ? 'לא זיהינו את המייל הזה במערכת, ולכן איננו יכולים להציג את הארגונים של הקורס שלך. אפשר להמשיך ולהעלות קו״ח — ולציין העדפה בהמשך מול מנחה התכנית.'
              : 'אין כרגע ארגונים פנויים להצגה בקורס שלך. אפשר להעלות קו״ח כעת — הרשימה תתעדכן.'}
          </div>
        )}

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

        <div ref={errRef}>
          {err && (
            <div className="text-[13.5px] leading-[1.5] rounded-xl px-4 py-3 flex items-start gap-2"
              style={{ background: 'rgba(122,30,43,0.08)', border: '1px solid var(--accent)', color: 'var(--accent)' }}>
              <span aria-hidden>⚠️</span>
              <span style={{ fontWeight: 600 }}>{err}</span>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={busy}
          style={{
            display: 'block', width: '100%', padding: '16px', fontSize: '15px', fontWeight: 600,
            background: busy ? 'var(--divider)' : 'var(--accent)',
            color: 'white', border: 'none', borderRadius: '12px',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'מעלה...' : (hasExistingCv ? 'שלח/י עדכון ←' : 'שלח CV מעודכן ←')}
        </button>
        {!file && !hasExistingCv && (
          <div className="text-[12px] text-center" style={{ color: 'var(--text-soft)', marginTop: '-8px' }}>
            יש לצרף קובץ קורות חיים לפני השליחה
          </div>
        )}
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
                  data-org-option={o.name}
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
                    data-org-description={o.name}
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

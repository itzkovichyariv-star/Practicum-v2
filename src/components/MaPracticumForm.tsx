import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react';
import { publicSupabase as supabase } from '../lib/supabase';
import { useFormDraft } from '../lib/useFormDraft';
import { openCv } from '../lib/cvUrl';
import {
  resolveMaStudent, partnerOptions, maOrgOptions, validateMaSubmission,
  partnerSummary, placesNote, normEmail, mutualNotice, partnerEmails, buildProposal,
  submissionEmail, emailLooksComplete,
  type MaContext, type PartnerMode, type MutualState,
} from '../lib/maPracticum';

/**
 * /ma — the master's-practicum intake link. One link, three answers.
 *
 * A DIFFERENT link from the BA one on purpose (Yariv: "הקישור הפעם צריך להיות קישור שונה
 * מהסטודנטים"), because the two forms ask different questions: there is no candidacy stage
 * here (these 15 people are already `students` rows), the organization is a single choice
 * rather than a ranking of three, and only this form asks who the practicum is done with.
 *
 * It writes to the SAME `cv_updates` table the BA form uses, which is what makes the
 * coordinator side free: the student card's "אמץ הגשה" banner, the submission history and
 * the org-suggestion inbox all already read that table. Two new columns carry the partner.
 */

type Status = 'idle' | 'uploading' | 'done' | 'error';

/** Did the partner columns make it into the database? Probed before anyone submits. */
type Schema = 'checking' | 'ready' | 'missing';

export default function MaPracticumForm() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const prefillEmail = params.get('email') || '';

  const [email, setEmail] = useState(prefillEmail);
  // Typed only when the address matched nobody. A second key, not a second question: a
  // student whose address IS on record never sees this field.
  const [typedName, setTypedName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [orgChoice, setOrgChoice] = useState('');
  const [proposing, setProposing] = useState(false);
  const [pName, setPName] = useState('');
  const [pContact, setPContact] = useState('');
  const [pRole, setPRole] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pLocation, setPLocation] = useState('');
  const [pNotes, setPNotes] = useState('');
  const [partnerMode, setPartnerMode] = useState<PartnerMode | ''>('');
  const [partner1, setPartner1] = useState('');
  const [partner2, setPartner2] = useState('');
  const [wantsSecond, setWantsSecond] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [err, setErr] = useState<string | null>(null);
  /** Set when the row saved but the partner columns were not there to receive it. */
  const [partnerLost, setPartnerLost] = useState(false);
  const errRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (err) errRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [err]);

  // Nothing typed here may be lost — the proposal details especially. Keyed by email so a
  // shared device never restores someone else's draft. The FILE cannot be persisted.
  const draft = useFormDraft(
    normEmail(email) ? `practicum_draft_ma_${normEmail(email)}` : null,
    'v1',
    { orgChoice, proposing, pName, pContact, pRole, pEmail, pPhone, pLocation, pNotes, partnerMode, partner1, partner2, wantsSecond },
    (v) => {
      if (v.orgChoice) setOrgChoice(v.orgChoice as string);
      if (v.proposing) setProposing(v.proposing as boolean);
      if (v.pName) setPName(v.pName as string);
      if (v.pContact) setPContact(v.pContact as string);
      if (v.pRole) setPRole(v.pRole as string);
      if (v.pEmail) setPEmail(v.pEmail as string);
      if (v.pPhone) setPPhone(v.pPhone as string);
      if (v.pLocation) setPLocation(v.pLocation as string);
      if (v.pNotes) setPNotes(v.pNotes as string);
      if (v.partnerMode) setPartnerMode(v.partnerMode as PartnerMode);
      if (v.partner1) setPartner1(v.partner1 as string);
      if (v.partner2) { setPartner2(v.partner2 as string); setWantsSecond(true); }
      if (v.wantsSecond) setWantsSecond(v.wantsSecond as boolean);
    },
  );

  const [blob, setBlob] = useState<any | null>(null);
  const [blobFailed, setBlobFailed] = useState(false);
  useEffect(() => {
    supabase.from('practicum_data').select('data').eq('org_id', 'default').single()
      .then(({ data, error }) => {
        if (error) { setBlobFailed(true); return; }
        setBlob((data as any)?.data || null);
      });
  }, []);

  // Are the partner columns live? Probed once, so the coordinator finds out while TESTING
  // the link rather than from a student whose answer silently went nowhere.
  const [schema, setSchema] = useState<Schema>('checking');
  useEffect(() => {
    supabase.from('cv_updates').select('partner_mode').limit(1)
      .then(({ error }) => setSchema(error ? 'missing' : 'ready'));
  }, []);

  // ?course= lets the coordinator preview the form as a student of another course row.
  const previewCourse = params.get('course') || '';
  const lookup = useMemo(
    () => resolveMaStudent(blob, email, typedName, previewCourse),
    [blob, email, typedName, previewCourse],
  );
  // The address the row is FILED under: the one on the student's card when we have it, so
  // a student identified by name does not become a second identity nobody can pair up.
  const filedEmail = useMemo(() => submissionEmail(lookup, email), [lookup, email]);
  const me = lookup.ok ? lookup.student : null;
  const partners = useMemo(() => (lookup.ok ? partnerOptions(blob, lookup.student) : []), [blob, lookup]);
  const orgs = useMemo(() => (lookup.ok ? maOrgOptions(blob, lookup.courseId) : []), [blob, lookup]);
  const ctx: MaContext = { lookup, partners, orgs };

  /**
   * Has the chosen partner named this student back?
   *
   * ONE BIT, asked of the database rather than computed here: the query is "is there a row
   * by that address whose partner_names contains my name", and it selects `id` only. So the
   * page never receives anyone else's answer — it cannot leak what the partner chose,
   * because it was never told. 'unconfirmed' covers "said alone", "named someone else" and
   * "has not filled it in yet" identically, which is what keeps the notice uninformative
   * about the other student's choice.
   */
  const [mutual, setMutual] = useState<MutualState | null>(null);
  async function checkMutual(names: string[]): Promise<MutualState | null> {
    if (!lookup.ok || !names.length || schema !== 'ready') return null;
    const emails = partnerEmails(blob, lookup.student, names);
    if (!emails.length) return null;
    const myName = String(lookup.student.name || '').trim();
    for (const em of emails) {
      const { data, error } = await supabase.from('cv_updates')
        .select('id')
        .eq('email', em)
        .contains('partner_names', [myName])
        .limit(1);
      if (error) return null;            // never claim a mismatch we could not verify
      if (!data || !data.length) return 'unconfirmed';
    }
    return 'confirmed';
  }

  const existingCvPath = useMemo(() => {
    const ref = (me as any)?.cvUpdatedUrl || (me as any)?.cvUrl || '';
    const m = String(ref).match(/^storage:\/\/[^/]+\/(.+)$/);
    return m ? m[1] : (ref && !/^https?:\/\//i.test(ref) ? ref : '');
  }, [me]);
  const hasExistingCv = !!existingCvPath;

  // The student's own earlier submissions through this link — read-only, and the reason a
  // returning student can change one answer without redoing the rest.
  const [myHistory, setMyHistory] = useState<Array<{ id: string; uploaded_at: string; cv_file_path?: string | null; org_pref_1?: string | null; partner_mode?: string | null; partner_names?: string[] | null }>>([]);
  useEffect(() => {
    const em = filedEmail;
    if (!em || schema === 'checking') { setMyHistory([]); return; }
    let alive = true;
    const cols = schema === 'ready'
      ? 'id, uploaded_at, cv_file_path, org_pref_1, partner_mode, partner_names'
      : 'id, uploaded_at, cv_file_path, org_pref_1';
    supabase.from('cv_updates').select(cols).eq('email', em)
      .order('uploaded_at', { ascending: false }).limit(10)
      .then(({ data }) => { if (alive) setMyHistory((data || []) as any); });
    return () => { alive = false; };
  }, [filedEmail, schema, status]);

  // A returning student sees the same nudge about what they ALREADY submitted, so the
  // mismatch surfaces even if they never submit again. Keyed on the saved names so it runs
  // once per state, not once per keystroke.
  const [savedMutual, setSavedMutual] = useState<MutualState | null>(null);
  const checkedKey = useRef('');
  useEffect(() => {
    const last = myHistory[0];
    const names = (last?.partner_mode === 'with' ? (last?.partner_names || []) : []) as string[];
    const key = names.join('|');
    if (!names.length || !lookup.ok || checkedKey.current === key) return;
    checkedKey.current = key;
    void checkMutual(names).then(setSavedMutual);
  }, [myHistory, lookup.ok]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefill from what the record already says, once, and never over live typing.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !me) return;
    prefilled.current = true;
    if (!orgChoice && (me as any).firstChoiceOrg) setOrgChoice((me as any).firstChoiceOrg);
    const existing: string[] = (me as any).practicumPartners || [];
    if (!partnerMode && existing.length) {
      setPartnerMode('with');
      setPartner1(existing[0] || '');
      if (existing[1]) { setPartner2(existing[1]); setWantsSecond(true); }
    }
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  const partnerNames = [partner1, partner2].map(n => n.trim()).filter(Boolean);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setPartnerLost(false);

    const problem = validateMaSubmission({
      email, orgChoice, proposing,
      proposal: { name: pName, contactName: pContact, contactRole: pRole, email: pEmail, phone: pPhone },
      partnerMode, partnerNames, hasFile: !!file, hasExistingCv,
    }, ctx);
    if (problem) { setErr(problem); return; }

    setStatus('uploading');

    let path = existingCvPath;
    if (file) {
      const safe = filedEmail.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40) || 'student';
      const ext = (file.name.split('.').pop() || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8) || 'bin';
      path = `cv-updates/ma-${safe}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('candidate-uploads').upload(path, file, {
        cacheControl: '3600', upsert: false, contentType: file.type || 'application/octet-stream',
      });
      if (upErr) { setStatus('error'); setErr('העלאת הקובץ נכשלה: ' + upErr.message); return; }
    }
    if (!path) { setStatus('error'); setErr('אין קו״ח לשמור — יש לצרף קובץ.'); return; }

    // buildProposal, not a literal: these exact keys are what the coordinator's approve
    // path reads in order to create the employer and promote it to the student's FIRST
    // choice. A renamed key here would silently cost that promotion.
    const proposal = proposing ? buildProposal({
      name: pName, contactName: pContact, contactRole: pRole,
      email: pEmail, phone: pPhone, location: pLocation, notes: pNotes,
    }) : null;

    const core = {
      email: filedEmail,
      name: (me?.name || '').trim() || null,
      cv_file_path: path,
      // The single choice lands in org_pref_1 so the coordinator's existing "אמץ הגשה"
      // path adopts it with no new plumbing. A proposal leaves it empty, exactly as the
      // BA form does, and travels in suggested_org until it is approved.
      org_pref_1: proposing ? null : (orgChoice || null),
      suggested_org: proposal,
    };
    const withPartner = {
      ...core,
      partner_mode: partnerMode || null,
      partner_names: partnerMode === 'with' ? partnerNames : [],
    };

    let { error: dbErr } = await supabase.from('cv_updates').insert(withPartner);
    if (dbErr && isMissingColumn(dbErr)) {
      // The migration has not been run. Save what the table CAN hold rather than losing
      // the CV too — and say plainly that the partner answer did not persist, so it is
      // never silently dropped.
      const retry = await supabase.from('cv_updates').insert(core);
      dbErr = retry.error;
      if (!dbErr) setPartnerLost(true);
    }
    if (dbErr) { setStatus('error'); setErr('שמירת ההגשה נכשלה: ' + dbErr.message); return; }

    if (proposal) {
      // Best-effort alert to the coordinator; never block a saved submission on it.
      try {
        const ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';
        await fetch('https://vpqgmcmavnszcnakhiat.supabase.co/functions/v1/notify-org-suggestion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON}`, 'apikey': ANON },
          // track: 'ma' — this practicum has no second stage, so the mail must not
          // call the sender "מועמד/ת מהשלב השני" (Yariv 2026-10-07).
          body: JSON.stringify({ record: { candidateName: me?.name || null, candidateEmail: normEmail(email), suggestedOrg: proposal, track: 'ma' } }),
        });
      } catch { /* the proposal is already saved in cv_updates */ }
    }

    draft.clear();
    // Asked AFTER the row is in, so the partner's own submission can already see this one —
    // whoever submits second gets 'confirmed' without having to come back.
    setMutual(partnerMode === 'with' ? await checkMutual(partnerNames) : null);
    setStatus('done');
  }

  if (status === 'done') {
    return (
      <div className="max-w-[520px] mx-auto p-10 text-center" data-ma-done>
        <div className="chapter-mark mb-4">✓ התקבל</div>
        <h1 className="serif text-[36px] leading-[1.1] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>
          ההגשה נשמרה
        </h1>
        <p className="text-[15px] leading-[1.6] mb-2" style={{ color: 'var(--ink)', opacity: 0.85 }}>
          {proposing
            ? 'קורות החיים והצעת הארגון נשמרו.'
            : `קורות החיים נשמרו, והבחירה נרשמה: ${orgChoice || '—'} · ${partnerSummary(partnerMode, partnerNames)}.`}
        </p>

        {/* WHAT HAPPENS NEXT, and who does it. Yariv 2026-10-07: a student who chose an
            organization "צריך לדעת שיצרו איתו קשר עם הארגון להמשך מיון", and one who proposed
            one should be told it is approved by him BY NAME and that an update follows.
            Without this the page ends on "נשמר" and the student is left guessing whether
            anything else is expected of them. */}
        <p className="text-[14px] leading-[1.7] rounded-xl px-4 py-3 mt-3 text-right" data-ma-next
          style={{ background: 'rgba(5,150,105,0.07)', border: '1px solid rgba(5,150,105,0.25)', color: '#065f46' }}>
          {proposing
            ? 'ד"ר יריב איצקוביץ יצור קשר עם הארגון שהצעת לשם אישורו. ברגע שהארגון יאושר תקבל/י על כך עדכון במייל, ותוכל/י להתחיל את הפרקטיקום.'
            : `קורות החיים שלך יועברו ל${orgChoice || 'ארגון'}, והארגון יצור איתך קשר להמשך תהליך המיון. בסיום התהליך תקבל/י עדכון במייל.`}
        </p>
        {partnerLost && (
          <p className="text-[13.5px] leading-[1.6] rounded-xl px-4 py-3 mt-4"
            style={{ background: 'rgba(180,83,9,0.1)', border: '1px solid #b45309', color: '#92400e' }}>
            שימו לב: בחירת השותף/ה לא נשמרה (העמודה חסרה במסד). קורות החיים והארגון נשמרו — אנא עדכנו את הרכזת מי השותף/ה.
          </p>
        )}
        {/* The mutual-confirmation nudge. Says only that confirmation is missing — never
            what the other student marked, and never whether they submitted at all. */}
        {mutual === 'unconfirmed' && (
          <p className="text-[13.5px] leading-[1.6] rounded-xl px-4 py-3 mt-4" data-ma-mutual-warning
            style={{ background: 'rgba(180,83,9,0.1)', border: '1px solid #b45309', color: '#92400e' }}>
            {mutualNotice('unconfirmed', partnerNames)}
          </p>
        )}
        {mutual === 'confirmed' && (
          <p className="text-[13.5px] leading-[1.6] rounded-xl px-4 py-3 mt-4" data-ma-mutual-ok
            style={{ background: 'rgba(5,150,105,0.08)', border: '1px solid rgba(5,150,105,0.35)', color: '#065f46' }}>
            ✓ הסימון הדדי — גם השותף/ה סימן/ה אותך.
          </p>
        )}
        <button type="button" onClick={() => { setStatus('idle'); setFile(null); }}
          className="text-[13px] underline mt-6"
          style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
          לעדכן משהו נוסף
        </button>
        <div className="mono text-[11px] uppercase tracking-[0.14em] mt-8" style={{ color: 'var(--text-soft)' }}>
          Ariel University · Management · Practicum
        </div>
      </div>
    );
  }

  const busy = status === 'uploading';
  const identified = lookup.ok;

  return (
    <div className="max-w-[520px] mx-auto p-10">
      <div className="chapter-mark mb-4">פרקטיקום · תואר שני</div>
      <h1 className="serif text-[36px] leading-[1.1] tracking-tight mb-2" style={{ color: 'var(--ink)' }}>
        קורות חיים, ארגון ושותף/ה
      </h1>
      <p className="text-[15px] leading-[1.55] mb-6" style={{ color: 'var(--ink)', opacity: 0.82 }}>
        שלושה דברים במקום אחד: העלאת קורות חיים מעודכנים, בחירת הארגון (או הצעת ארגון משלך),
        וציון אם הפרקטיקום ייעשה לבד או עם שותף/ה מהקורס.
      </p>

      {/* Coordinator-facing, deliberately loud: the link cannot record a partner yet. */}
      {schema === 'missing' && (
        <div className="rounded-xl px-4 py-3 mb-6 text-[13px] leading-[1.6]" data-ma-schema-warning
          style={{ background: 'rgba(180,83,9,0.1)', border: '1px solid #b45309', color: '#92400e' }}>
          <strong>למנהל/ת המערכת:</strong> עמודות השותף/ה חסרות בטבלת <code>cv_updates</code>.
          יש להריץ את <code>cv_updates_ma_partner.sql</code> ב‑Supabase לפני שליחת הקישור לסטודנטים.
        </div>
      )}
      {blobFailed && (
        <div className="rounded-xl px-4 py-3 mb-6 text-[13px] leading-[1.6]"
          style={{ background: 'rgba(122,30,43,0.07)', border: '1px solid var(--accent)', color: 'var(--accent)' }}>
          לא הצלחנו לטעון את נתוני הקורס. רעננו את הדף — ואם זה חוזר, פנו לרכזת.
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {/* ── who ─────────────────────────────────────────────────────── */}
        <div>
          <label className="block">
            <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>
              {prefillEmail ? 'הקישור האישי שלך' : 'המייל שאיתו את/ה רשום/ה בתכנית *'}
            </span>
            {/* A personal link carries the identity, so there is nothing to type and nothing
                to mistype — the same arrangement the BA form has. Read-only rather than
                hidden: the student should see whose form this is before uploading a CV. */}
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              readOnly={!!prefillEmail} data-ma-email
              className="input w-full" style={{
                padding: '12px 16px', fontSize: '14.5px',
                opacity: prefillEmail ? 0.7 : 1, cursor: prefillEmail ? 'default' : undefined,
              }} />
          </label>
          {emailLooksComplete(email) && blob && (
            identified ? (
              <div className="mt-2 text-[13px] leading-[1.5] rounded-lg px-3 py-2" data-ma-identified
                style={{ background: 'rgba(5,150,105,0.08)', border: '1px solid rgba(5,150,105,0.3)', color: '#065f46' }}>
                ✓ זיהינו אותך: <strong>{me?.name}</strong> · {lookup.ok ? lookup.courseName : ''}{me?.year ? ` · ${me.year}` : ''}
                {/* Identified by a typed name, and the card carries a different address: say
                    which one the submission lands on. That is the address the coordinator
                    answers, and the one the partner question is asked about. */}
                {lookup.ok && lookup.identifiedBy === 'preview' && (
                  <div className="mt-1" data-ma-preview>
                    זו תצוגה מקדימה של הטופס, לא רשומת סטודנט. שליחה מכאן <strong>כן</strong> נשמרת
                    כהגשה אמיתית בטבלת cv_updates, וכדאי למחוק אותה אחרי הבדיקה.
                  </div>
                )}
                {lookup.ok && lookup.identifiedBy === 'name' && filedEmail !== normEmail(email) && (
                  <div className="mt-1" data-ma-filed-under>
                    ההגשה תירשם על הכתובת שרשומה אצלנו: <strong>{filedEmail}</strong>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-2 text-[13px] leading-[1.5] rounded-lg px-3 py-2" data-ma-unknown
                style={{ background: 'rgba(122,30,43,0.07)', border: '1px solid var(--accent)', color: 'var(--accent)' }}>
                {lookup.ok === false && lookup.reason === 'unknown-name'
                  ? 'לא מצאנו סטודנט/ית בשם הזה ברשימות התכנית. בדקו את האיות והשם המלא, או פנו לרכזת.'
                  : lookup.ok === false && lookup.reason === 'ambiguous-name'
                    ? 'יש יותר מסטודנט/ית אחד/ת בשם הזה. הזינו את המייל שרשום בתכנית, או פנו לרכזת.'
                    : 'הכתובת הזו אינה מופיעה ברשימת הסטודנטים. הוסיפו את שמכם המלא למטה כדי שנזהה אתכם לפיו.'}
              </div>
            )
          )}

          {/* THE SECOND KEY. Shown only once the address has failed to identify anyone, so
              the ordinary case stays a single field — and typed, never a list: a public page
              that offered the cohort by name would let anyone holding the link read off who
              is in it. The partner picker may show those names, but only to someone the
              form has already identified. */}
          {emailLooksComplete(email) && blob && !identified && (
            <label className="block mt-3">
              <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>
                השם המלא שלך, כפי שהוא רשום בתכנית *
              </span>
              <input type="text" value={typedName} onChange={e => setTypedName(e.target.value)}
                data-ma-name autoComplete="name" placeholder="שם פרטי ושם משפחה"
                className="input w-full" style={{ padding: '12px 16px', fontSize: '14.5px' }} />
            </label>
          )}
        </div>

        {/* ── the CV ───────────────────────────────────────────────────── */}
        <div>
          <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>
            {hasExistingCv ? 'קורות חיים (PDF / Word) — אופציונלי' : 'קורות חיים (PDF / Word) *'}
          </span>
          <label className="block border-2 border-dashed rounded-xl p-5 cursor-pointer transition-colors hover:bg-[rgba(122,30,43,0.03)]"
            style={{ borderColor: file ? 'var(--accent)' : 'var(--divider)' }}>
            <input type="file" accept=".pdf,.doc,.docx" data-ma-file
              onChange={e => setFile(e.target.files?.[0] || null)} className="hidden" />
            <div className="flex items-center gap-3">
              <span className="serif text-[28px]" style={{ color: file ? 'var(--accent)' : 'var(--text-soft)' }}>{file ? '✓' : '📎'}</span>
              <div className="flex-1">
                <div className="text-[14px]" style={{ color: file ? 'var(--ink)' : 'var(--text-soft)' }}>
                  {file ? file.name : (hasExistingCv ? 'יש קו״ח שמור — לחצו להחלפה, או השאירו ריק' : 'לחצו כדי לבחור קובץ')}
                </div>
                {file && <div className="mono text-[11px] uppercase tracking-[0.12em] mt-0.5" style={{ color: 'var(--text-soft)' }}>{(file.size / 1024).toFixed(0)} KB</div>}
              </div>
              {file && (
                <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); setFile(null); }}
                  className="mono text-[10px] uppercase tracking-[0.14em] opacity-60 hover:opacity-100">הסר</button>
              )}
            </div>
          </label>
        </div>

        {/* ── the organization ─────────────────────────────────────────── */}
        <div>
          <span className="small-caps block mb-2" style={{ letterSpacing: '0.12em' }}>הארגון *</span>
          {!identified ? (
            <div className="rounded-lg px-4 py-3 text-[13px] leading-[1.6]"
              style={{ background: 'rgba(122,30,43,0.05)', border: '1px solid rgba(122,30,43,0.2)', color: 'var(--text-soft)' }}>
              הזינו את המייל למעלה כדי לראות את הארגונים של הפרקטיקום שלך.
            </div>
          ) : (
            <div className="space-y-2.5">
              {orgs.map(o => {
                const selected = !proposing && orgChoice === o.name;
                return (
                  <label key={o.name} data-ma-org={o.name}
                    className="block rounded-xl border p-4 cursor-pointer transition-colors"
                    style={{
                      borderColor: selected ? 'var(--accent)' : 'var(--divider)',
                      background: selected ? 'rgba(122,30,43,0.05)' : 'transparent',
                    }}>
                    <div className="flex items-start gap-3">
                      <input type="radio" name="ma-org" checked={selected}
                        onChange={() => { setOrgChoice(o.name); setProposing(false); }}
                        style={{ accentColor: 'var(--accent)', width: 16, height: 16, marginTop: 3 }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[15px] font-semibold" style={{ color: selected ? 'var(--accent)' : 'var(--ink)' }}>{o.name}</div>
                        <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-soft)' }}>{placesNote(o)}</div>
                        {o.notes.trim() && (
                          <div className="text-[12.5px] leading-[1.6] mt-1.5 whitespace-pre-wrap" style={{ color: 'var(--ink)', opacity: 0.78 }}>{o.notes}</div>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}

              <label data-ma-propose className="block rounded-xl border p-4 cursor-pointer transition-colors"
                style={{
                  borderColor: proposing ? 'var(--accent)' : 'var(--divider)',
                  background: proposing ? 'rgba(122,30,43,0.05)' : 'transparent',
                }}>
                <div className="flex items-start gap-3">
                  <input type="radio" name="ma-org" checked={proposing}
                    onChange={() => { setProposing(true); setOrgChoice(''); }}
                    style={{ accentColor: 'var(--accent)', width: 16, height: 16, marginTop: 3 }} />
                  <div className="flex-1">
                    <div className="text-[15px] font-semibold" style={{ color: proposing ? 'var(--accent)' : 'var(--ink)' }}>אני מציע/ה ארגון אחר</div>
                    <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-soft)' }}>קשר אישי או ארגון שאינו ברשימה — כפוף לאישור מנחה התכנית</div>
                  </div>
                </div>
              </label>

              {orgs.length === 0 && (
                <div className="rounded-lg px-4 py-3 text-[13px] leading-[1.6]"
                  style={{ background: 'rgba(122,30,43,0.05)', border: '1px solid rgba(122,30,43,0.2)', color: 'var(--text-soft)' }}>
                  אין כרגע ארגון מאושר ברשימה של הפרקטיקום שלך — אפשר להציע ארגון בעצמך למעלה.
                </div>
              )}
            </div>
          )}

          {proposing && (
            <div className="mt-3 rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--accent)', background: 'rgba(122,30,43,0.04)' }}>
              <p className="text-[12.5px] leading-[1.55]" style={{ color: 'var(--ink)', opacity: 0.85 }}>
                ההצעה כפופה לאישור מנחה התכנית, ואם תאושר — הארגון יהפוך ל<strong>בחירה הראשונה שלך</strong>,
                בדיוק כמו בפרקטיקום משאבי אנוש. יש למלא את פרטי איש/אשת הקשר במלואם, כדי שנוכל לפנות לארגון.
              </p>
              <Field label="שם הארגון *" value={pName} onChange={setPName} testid="ma-p-name" />
              <Field label="שם איש/אשת הקשר *" value={pContact} onChange={setPContact} testid="ma-p-contact" />
              <Field label="תפקיד *" value={pRole} onChange={setPRole} placeholder="למשל: מנהלת משאבי אנוש" testid="ma-p-role" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="אימייל *" value={pEmail} onChange={setPEmail} type="email" testid="ma-p-email" />
                <Field label="טלפון *" value={pPhone} onChange={setPPhone} type="tel" testid="ma-p-phone" />
              </div>
              <Field label="מיקום (אופציונלי)" value={pLocation} onChange={setPLocation} testid="ma-p-location" />
              <div>
                <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>הקשר שלך לארגון (אופציונלי)</span>
                <textarea value={pNotes} onChange={e => setPNotes(e.target.value)} rows={3}
                  className="input w-full" style={{ padding: '10px 14px', fontSize: '14px', resize: 'vertical', lineHeight: 1.6 }} />
              </div>
            </div>
          )}
        </div>

        {/* ── alone or with a partner ──────────────────────────────────── */}
        <div>
          <span className="small-caps block mb-2" style={{ letterSpacing: '0.12em' }}>הפרקטיקום ייעשה *</span>
          <div className="grid grid-cols-2 gap-2.5">
            {([['alone', 'לבד'], ['with', 'עם שותף/ה']] as const).map(([mode, label]) => {
              const selected = partnerMode === mode;
              return (
                <label key={mode} data-ma-mode={mode}
                  className="rounded-xl border p-4 cursor-pointer text-center transition-colors"
                  style={{
                    borderColor: selected ? 'var(--accent)' : 'var(--divider)',
                    background: selected ? 'rgba(122,30,43,0.05)' : 'transparent',
                  }}>
                  <input type="radio" name="ma-partner-mode" checked={selected} className="hidden"
                    onChange={() => { setPartnerMode(mode); if (mode === 'alone') { setPartner1(''); setPartner2(''); setWantsSecond(false); } }} />
                  <span className="text-[15px] font-semibold" style={{ color: selected ? 'var(--accent)' : 'var(--ink)' }}>{label}</span>
                </label>
              );
            })}
          </div>

          {savedMutual === 'unconfirmed' && (
            <div className="mt-2.5 text-[13px] leading-[1.6] rounded-lg px-3 py-2.5" data-ma-saved-mutual-warning
              style={{ background: 'rgba(180,83,9,0.1)', border: '1px solid #b45309', color: '#92400e' }}>
              {mutualNotice('unconfirmed', (myHistory[0]?.partner_names || []) as string[])}
            </div>
          )}

          {partnerMode === 'with' && (
            <div className="mt-3 space-y-3">
              {!identified ? (
                <div className="rounded-lg px-4 py-3 text-[13px]" style={{ background: 'rgba(122,30,43,0.05)', border: '1px solid rgba(122,30,43,0.2)', color: 'var(--text-soft)' }}>
                  הזינו את המייל למעלה כדי לראות את רשימת הסטודנטים בפרקטיקום שלך.
                </div>
              ) : partners.length === 0 ? (
                <div className="rounded-lg px-4 py-3 text-[13px]" style={{ background: 'rgba(122,30,43,0.05)', border: '1px solid rgba(122,30,43,0.2)', color: 'var(--text-soft)' }}>
                  לא מצאנו סטודנטים נוספים בפרקטיקום שלך. אם יש לך שותף/ה — פנו לרכזת.
                </div>
              ) : (
                <>
                  <label className="block">
                    <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>השותף/ה *</span>
                    <select value={partner1} onChange={e => setPartner1(e.target.value)} data-ma-partner1
                      className="input w-full" style={{ padding: '12px 16px', fontSize: '14.5px' }}>
                      <option value="">— בחרו מהרשימה —</option>
                      {partners.filter(p => p.name !== partner2).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                    </select>
                  </label>
                  {wantsSecond ? (
                    <label className="block">
                      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>שותף/ה נוסף/ת (אופציונלי)</span>
                      <select value={partner2} onChange={e => setPartner2(e.target.value)} data-ma-partner2
                        className="input w-full" style={{ padding: '12px 16px', fontSize: '14.5px' }}>
                        <option value="">— ללא —</option>
                        {partners.filter(p => p.name !== partner1).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                      </select>
                    </label>
                  ) : (
                    <button type="button" onClick={() => setWantsSecond(true)} className="text-[13px] underline"
                      style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      + הוסף שותף/ה נוסף/ת
                    </button>
                  )}
                  <p className="text-[12px] leading-[1.5]" style={{ color: 'var(--text-soft)' }}>
                    הרשימה נגזרת מהסטודנטים בפרקטיקום שלך. גם השותף/ה צריך/ה למלא את הטופס בעצמו/ה.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── earlier submissions ──────────────────────────────────────── */}
        {myHistory.length > 0 && (
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--divider)' }}>
            <div className="small-caps mb-2" style={{ letterSpacing: '0.12em' }}>ההגשות שלך</div>
            <div className="space-y-1.5">
              {myHistory.map((row, i) => {
                let when = row.uploaded_at;
                try { when = new Date(row.uploaded_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }); } catch { /* keep raw */ }
                const ps = partnerSummary(row.partner_mode, row.partner_names as string[] | null);
                return (
                  <div key={row.id} className="text-[12.5px] flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--text-soft)' }}>
                    <span className="font-semibold" style={{ color: i === 0 ? 'var(--accent)' : 'var(--text-soft)' }}>{when}{i === 0 ? ' · אחרונה' : ''}</span>
                    {row.org_pref_1 && <span>· {row.org_pref_1}</span>}
                    {ps && <span>· {ps}</span>}
                    {row.cv_file_path && (
                      <button type="button" onClick={() => openCv(`storage://candidate-uploads/${row.cv_file_path}`)}
                        className="underline" style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>קו״ח ↗</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div ref={errRef}>
          {err && (
            <div className="text-[13.5px] leading-[1.5] rounded-xl px-4 py-3 flex items-start gap-2" data-ma-error
              style={{ background: 'rgba(122,30,43,0.08)', border: '1px solid var(--accent)', color: 'var(--accent)' }}>
              <span aria-hidden>⚠️</span><span style={{ fontWeight: 600 }}>{err}</span>
            </div>
          )}
        </div>

        <button type="submit" disabled={busy} data-ma-submit style={{
          display: 'block', width: '100%', padding: '16px', fontSize: '15px', fontWeight: 600,
          background: busy ? 'var(--divider)' : 'var(--accent)', color: 'white', border: 'none',
          borderRadius: '12px', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
        }}>{busy ? 'שולח...' : 'שליחה ←'}</button>
      </form>
    </div>
  );
}

/** PostgREST's answer when a column in the payload does not exist on the table. */
function isMissingColumn(e: { code?: string; message?: string } | null): boolean {
  if (!e) return false;
  const code = String(e.code || '');
  const msg = String(e.message || '');
  return code === '42703' || code === 'PGRST204'
    || /partner_mode|partner_names/.test(msg) && /column|schema|does not exist|could not find/i.test(msg);
}

function Field({ label, value, onChange, type = 'text', placeholder, testid }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; testid?: string;
}) {
  return (
    <label className="block">
      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        data-testid={testid}
        className="input w-full" style={{ padding: '10px 14px', fontSize: '14px' }} />
    </label>
  );
}

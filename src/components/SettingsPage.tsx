import { useState } from 'react';
import { btnPrimary, btnSecondary } from '../lib/design';
import type { PageProps } from './pageShared';
import { saveSnapshot } from '../lib/dataApi';
import { showToast } from '../lib/toast';
import type { PlacementSettings } from '../lib/supabase';
import { getDefaultPlacementSettings } from '../lib/placement';

export default function SettingsPage({ data, userName, onRefresh }: PageProps & { data: any }) {
  return (
    <main className="max-w-[900px] mx-auto px-4 sm:px-10 pt-14 pb-28">

      <section className="pt-4 pb-12 border-b mb-12" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-6">VII · הגדרות</div>
        <h1 className="serif text-[30px] sm:text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>הגדרות</h1>
        <p className="text-[15px] sm:text-[17.5px] max-w-[620px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
          מיילים, גיבוי ושיתוף עם רחל.
        </p>
      </section>

      <EmailSettingsCard data={data} userName={userName} onRefresh={onRefresh!} />
      <PlacementSettingsCard data={data} userName={userName} onRefresh={onRefresh!} />
      <JsonBackupCard data={data} />
      <SharingGuide />

      <section>
        <div className="flex items-baseline gap-6 py-3 border-b" style={{ borderColor: 'var(--divider)' }}>
          <span className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold w-52 shrink-0" style={{ color: 'var(--text-soft)' }}>
            משתמש
          </span>
          <span className="text-[15px]" style={{ color: 'var(--ink)', fontFamily: 'ui-monospace, monospace' }}>
            {userName}
          </span>
        </div>
      </section>

    </main>
  );
}

/* ─── Email Settings ─────────────────────────────────────────────────────── */

function EmailSettingsCard({ data, userName, onRefresh }: { data: any; userName: string; onRefresh: () => void }) {
  const [coordEmail, setCoordEmail]   = useState((data.coordinatorEmail as string) || '');
  const [supEmail,   setSupEmail]     = useState((data.supervisorEmail  as string) || '');
  const [extras,     setExtras]       = useState<string[]>((data.notifyEmails as string[]) || []);
  const [newExtra,   setNewExtra]     = useState('');
  const [saving,     setSaving]       = useState(false);
  const [msg,        setMsg]          = useState<string | null>(null);

  function addExtra() {
    const v = newExtra.trim().toLowerCase();
    if (!v) return;
    if (extras.includes(v)) { setMsg('המייל כבר קיים ברשימה'); setTimeout(() => setMsg(null), 2000); return; }
    setExtras(prev => [...prev, v]);
    setNewExtra('');
  }

  function removeExtra(email: string) {
    setExtras(prev => prev.filter(e => e !== email));
  }

  async function save() {
    setSaving(true); setMsg(null);
    const res = await saveSnapshot(
      { ...data, coordinatorEmail: coordEmail.trim(), supervisorEmail: supEmail.trim(), notifyEmails: extras },
      { name: userName },
      { action: 'עודכן', entity: 'הגדרות', target: 'מיילים' }
    );
    setSaving(false);
    if (!res.ok) { setMsg('שגיאה: ' + (res.error || '')); return; }
    data.coordinatorEmail = coordEmail.trim();
    data.supervisorEmail  = supEmail.trim();
    data.notifyEmails     = extras;
    showToast('✓ הגדרות נשמרו', 'success');
    setMsg('✓ נשמר');
    onRefresh();
    setTimeout(() => setMsg(null), 2500);
  }

  return (
    <section className="mb-16">
      <div className="flex items-baseline justify-between gap-8 mb-8 pb-5 border-b" style={{ borderColor: 'var(--divider)' }}>
        <h2 className="serif text-[30px] tracking-tight" style={{ color: 'var(--ink)' }}>הגדרות מייל</h2>
      </div>
      <p className="text-[15px] max-w-[720px] leading-[1.6] mb-6" style={{ color: 'var(--ink)', opacity: 0.82 }}>
        כאשר מועמד מגיש טופס, מעסיק ממלא משוב, או נשלחת הודעת קבלה/דחייה — הכתובות הבאות מקבלות עותק.
      </p>

      <div className="max-w-[560px] space-y-5">
        <label className="block">
          <span className="mono text-[11px] uppercase tracking-[0.14em] font-semibold block mb-1.5" style={{ color: 'var(--text-soft)' }}>
            מייל הרכזת (רחל)
          </span>
          <input type="email" value={coordEmail} onChange={e => setCoordEmail(e.target.value)}
            placeholder="rachel@ariel.ac.il" className="input w-full"
            style={{ padding: '10px 14px', fontSize: '14px' }} />
        </label>

        <label className="block">
          <span className="mono text-[11px] uppercase tracking-[0.14em] font-semibold block mb-1.5" style={{ color: 'var(--text-soft)' }}>
            מייל המפקח האקדמי (יריב)
          </span>
          <input type="email" value={supEmail} onChange={e => setSupEmail(e.target.value)}
            placeholder="itzkovichyariv@gmail.com" className="input w-full"
            style={{ padding: '10px 14px', fontSize: '14px' }} />
        </label>

        {/* Extra notify emails */}
        <div>
          <span className="mono text-[11px] uppercase tracking-[0.14em] font-semibold block mb-2" style={{ color: 'var(--text-soft)' }}>
            מיילים נוספים לעדכון (CC)
          </span>
          {extras.length > 0 && (
            <ul className="flex flex-wrap gap-2 mb-3">
              {extras.map(e => (
                <li key={e} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border"
                  style={{ borderColor: 'var(--divider)', background: 'rgba(122,30,43,0.05)' }}>
                  <span className="mono text-[12px]" style={{ color: 'var(--ink)' }}>{e}</span>
                  <button onClick={() => removeExtra(e)}
                    className="opacity-50 hover:opacity-100 text-[13px] leading-none"
                    style={{ color: 'var(--accent)' }}>✕</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input type="email" value={newExtra} onChange={e => setNewExtra(e.target.value)}
              placeholder="הוסף כתובת מייל..."
              className="input flex-1" style={{ padding: '9px 14px', fontSize: '13px' }}
              onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); addExtra(); } }} />
            <button onClick={addExtra} style={btnSecondary()}>+ הוסף</button>
          </div>
        </div>

        <button onClick={save} disabled={saving} style={btnPrimary(saving)}>
          {saving ? 'שומר...' : 'שמור הגדרות'}
        </button>
        {msg && (
          <div className="mono text-[11.5px] uppercase tracking-[0.14em]"
            style={{ color: msg.startsWith('✓') ? 'var(--accent)' : '#b91c1c' }}>
            {msg}
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── Placement Settings ─────────────────────────────────────────────────── */

const TEMPLATE_FIELDS: { key: keyof PlacementSettings; label: string; rows?: number; desc?: string }[] = [
  { key: 'whatsappTemplate',                      label: 'WhatsApp — שליחת מועמדות',          rows: 6,  desc: 'נשלח למעסיק כשמגישים מועמדות.' },
  { key: 'emailSubjectTemplate',                  label: 'אימייל שורת נושא — שליחת מועמדות', rows: 1 },
  { key: 'emailBodyTemplate',                     label: 'אימייל גוף — שליחת מועמדות',        rows: 7 },
  { key: 'whatsappWithdrawalTemplate',            label: 'WhatsApp — ביטול מועמדות',           rows: 5,  desc: 'נשלח למעסיק בעת ביטול.' },
  { key: 'emailWithdrawalSubjectTemplate',        label: 'אימייל נושא — ביטול מועמדות',       rows: 1 },
  { key: 'emailWithdrawalBodyTemplate',           label: 'אימייל גוף — ביטול מועמדות',        rows: 6 },
  { key: 'studentNotifyApprovedTemplateWhatsApp', label: 'WhatsApp — הודעה לסטודנט: אושר',   rows: 5,  desc: 'נשלח לסטודנט אחרי אישור הצעת מעסיק.' },
  { key: 'studentNotifyApprovedTemplateEmailSubject', label: 'אימייל נושא — הודעה לסטודנט: אושר', rows: 1 },
  { key: 'studentNotifyApprovedTemplateEmailBody',    label: 'אימייל גוף — הודעה לסטודנט: אושר',  rows: 6 },
  { key: 'studentNotifyRejectedTemplateWhatsApp', label: 'WhatsApp — הודעה לסטודנט: נדחה',   rows: 5,  desc: 'נשלח לסטודנט אחרי דחיית הצעת מעסיק.' },
  { key: 'studentNotifyRejectedTemplateEmailSubject', label: 'אימייל נושא — הודעה לסטודנט: נדחה', rows: 1 },
  { key: 'studentNotifyRejectedTemplateEmailBody',    label: 'אימייל גוף — הודעה לסטודנט: נדחה',  rows: 6 },
  // coordinatorPhone and coordinatorWhatsapp used to live here, at the bottom of
  // seventeen multi-line templates behind a collapsed "הצג ועדוך תבניות הודעות". They
  // are one-line facts that every employer message depends on, and burying them made a
  // five-second edit into a hunt. They now have their own block above, always visible.
  //
  // No coordinatorEmail field anywhere — this screen already edits
  // data.coordinatorEmail / data.supervisorEmail above, and {contactBack} is seeded
  // from those. Two boxes for one address is how they drift apart.
  { key: 'publicSiteUrl',       label: 'כתובת האתר הציבורית', rows: 1, desc: 'הבסיס לקישור התשובה שנשלח למעסיק (למשל https://practicum-v2.pages.dev). ריק = הכתובת שממנה נשלח — שעלולה להיות localhost או תצוגה מקדימה.' },
];

const TOKEN_HELP = [
  '{contactBack}',
  '{studentName}', '{contactName}', '{employerName}', '{positionTitle}',
  '{courseName}', '{cvLink}', '{adminName}', '{scope}',
];

function PlacementSettingsCard({ data, userName, onRefresh }: { data: any; userName: string; onRefresh: () => void }) {
  const defaults = getDefaultPlacementSettings();
  const saved: PlacementSettings = { ...defaults, ...(data.placementSettings || {}) };

  const [prefCount,       setPrefCount]   = useState(String(saved.defaultPreferenceCount));
  const [agingDays,       setAgingDays]   = useState(String(saved.defaultAgingThresholdDays));
  const [templates,       setTemplates]   = useState<PlacementSettings>(saved);
  const [saving,          setSaving]      = useState(false);
  const [expanded,        setExpanded]    = useState(false);

  function setTpl(key: keyof PlacementSettings, val: string) {
    setTemplates(prev => ({ ...prev, [key]: val }));
  }

  async function save() {
    const updated: PlacementSettings = {
      ...templates,
      defaultPreferenceCount:     Math.max(1, Math.min(10, Number(prefCount) || defaults.defaultPreferenceCount)),
      defaultAgingThresholdDays:  Math.max(1, Math.min(90, Number(agingDays) || defaults.defaultAgingThresholdDays)),
    };
    setSaving(true);
    const res = await saveSnapshot(
      { ...data, placementSettings: updated },
      { name: userName },
      { action: 'עודכן', entity: 'הגדרות שיבוץ', target: 'תבניות' }
    );
    setSaving(false);
    if (!res.ok) { showToast('שגיאה: ' + (res.error || ''), 'error'); return; }
    data.placementSettings = updated;
    showToast('✓ הגדרות שיבוץ נשמרו', 'success');
    onRefresh();
  }

  return (
    <section className="mb-16" dir="rtl">
      <div className="flex items-baseline justify-between gap-8 mb-8 pb-5 border-b" style={{ borderColor: 'var(--divider)' }}>
        <h2 className="serif text-[30px] tracking-tight" style={{ color: 'var(--ink)' }}>🎯 הגדרות שיבוץ</h2>
      </div>
      <p className="text-[15px] max-w-[720px] leading-[1.6] mb-8" style={{ color: 'var(--ink)', opacity: 0.82 }}>
        ערכי ברירת מחדל לתהליך השיבוץ — מספר העדפות, סף הזדקנות, ותבניות הודעות.
      </p>

      {/* Numeric settings */}
      <div className="max-w-[560px] space-y-5 mb-8">
        <label className="block">
          <span className="mono text-[11px] uppercase tracking-[0.14em] font-semibold block mb-1.5" style={{ color: 'var(--text-soft)' }}>
            מספר העדפות ברירת מחדל לסטודנט
          </span>
          <input
            type="number" min="1" max="10" value={prefCount}
            onChange={e => setPrefCount(e.target.value)}
            className="input" style={{ width: '120px', padding: '10px 14px', fontSize: '14px' }} />
          <span className="text-[12px] mr-3" style={{ color: 'var(--text-soft)' }}>בין 1 ל-10</span>
        </label>

        <label className="block">
          <span className="mono text-[11px] uppercase tracking-[0.14em] font-semibold block mb-1.5" style={{ color: 'var(--text-soft)' }}>
            סף הזדקנות (ימים) — הדגשה אדומה אחרי N ימי המתנה
          </span>
          <input
            type="number" min="1" max="90" value={agingDays}
            onChange={e => setAgingDays(e.target.value)}
            className="input" style={{ width: '120px', padding: '10px 14px', fontSize: '14px' }} />
          <span className="text-[12px] mr-3" style={{ color: 'var(--text-soft)' }}>בין 1 ל-90 ימים</span>
        </label>
      </div>

      {/* The human route back, for when the one-click link fails. Two one-line fields that
          feed {contactBack} in EVERY employer template — edit once, every message
          updates — so they sit in the open rather than under the templates fold. */}
      <div className="mb-6 p-4 rounded-xl" style={{ background: 'rgba(59,90,143,0.05)', border: '1px solid var(--divider)' }}>
        <div className="mono text-[11px] uppercase tracking-[0.14em] font-semibold mb-1" style={{ color: 'var(--text-soft)' }}>
          איך מעסיק חוזר אליך
        </div>
        <p className="text-[12.5px] mb-3" style={{ color: 'var(--text-soft)', lineHeight: 1.6 }}>
          מופיע בכל הודעה למעסיק דרך <code style={{ color: 'var(--accent)' }}>{'{contactBack}'}</code>, כדי שקישור שנשבר יעלה שיחת טלפון ולא השמה.
          המייל נלקח אוטומטית מהגדרות המערכת ואינו נערך כאן.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
          <label className="block">
            <span className="mono text-[11px] uppercase tracking-[0.14em] font-semibold block mb-1.5" style={{ color: 'var(--text-soft)' }}>
              הטלפון שלך
            </span>
            <input
              type="tel" dir="ltr" value={templates.coordinatorPhone || ''} placeholder="052-0000000"
              onChange={e => setTpl('coordinatorPhone', e.target.value)}
              className="input" style={{ width: '190px', padding: '10px 14px', fontSize: '14px', textAlign: 'start' }} />
          </label>
          <label className="block">
            <span className="mono text-[11px] uppercase tracking-[0.14em] font-semibold block mb-1.5" style={{ color: 'var(--text-soft)' }}>
              וואטסאפ, אם שונה
            </span>
            <input
              type="tel" dir="ltr" value={templates.coordinatorWhatsapp || ''} placeholder="ריק = אותו מספר"
              onChange={e => setTpl('coordinatorWhatsapp', e.target.value)}
              className="input" style={{ width: '190px', padding: '10px 14px', fontSize: '14px', textAlign: 'start' }} />
          </label>
        </div>
      </div>

      {/* Token reference */}
      <div className="mb-6 p-4 rounded-xl" style={{ background: 'rgba(122,30,43,0.04)', border: '1px solid var(--divider)' }}>
        <div className="mono text-[11px] uppercase tracking-[0.14em] font-semibold mb-2" style={{ color: 'var(--text-soft)' }}>
          אסימוני תבנית זמינים
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {TOKEN_HELP.map(tok => (
            <code key={tok} className="px-2 py-1 rounded text-[12px]"
              style={{ background: 'var(--bg)', border: '1px solid var(--divider)', color: 'var(--accent)', fontFamily: 'ui-monospace, monospace' }}>
              {tok}
            </code>
          ))}
        </div>
      </div>

      {/* Templates collapsible */}
      <div className="mb-6">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-2 text-[14px] font-semibold"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', padding: 0 }}>
          {expanded ? '▲' : '▼'} {expanded ? 'הסתר תבניות הודעות' : 'הצג ועדוך תבניות הודעות'}
        </button>
      </div>

      {expanded && (
        <div className="space-y-6 mb-8 max-w-[720px]">
          {TEMPLATE_FIELDS.map(({ key, label, rows = 4, desc }) => (
            <label key={key} className="block">
              <span className="mono text-[11px] uppercase tracking-[0.14em] font-semibold block mb-1"
                style={{ color: 'var(--text-soft)' }}>
                {label}
              </span>
              {desc && (
                <span className="text-[12px] block mb-1.5" style={{ color: 'var(--text-soft)' }}>{desc}</span>
              )}
              <textarea
                value={(templates as any)[key] || ''}
                onChange={e => setTpl(key, e.target.value)}
                rows={rows}
                className="input w-full"
                style={{ padding: '10px 14px', fontSize: '13px', fontFamily: 'ui-monospace, monospace', resize: 'vertical', direction: 'rtl' }}
              />
            </label>
          ))}
        </div>
      )}

      <button onClick={save} disabled={saving} style={btnPrimary(saving)}>
        {saving ? 'שומר...' : 'שמור הגדרות שיבוץ'}
      </button>
    </section>
  );
}

/* ─── JSON Backup ────────────────────────────────────────────────────────── */

function JsonBackupCard({ data }: { data: any }) {
  const [done, setDone] = useState(false);

  function download() {
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `גיבוי-פרקטיקום-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDone(true);
    setTimeout(() => setDone(false), 3000);
  }

  const counts = {
    students:   (data.students   || []).length,
    candidates: (data.candidates || []).length,
    employers:  (data.employers  || []).length,
    lectures:   (data.lectures   || []).length,
  };

  return (
    <section className="mb-16">
      <div className="flex items-baseline justify-between gap-8 mb-8 pb-5 border-b" style={{ borderColor: 'var(--divider)' }}>
        <h2 className="serif text-[30px] tracking-tight" style={{ color: 'var(--ink)' }}>גיבוי JSON ידני</h2>
      </div>
      <p className="text-[15px] max-w-[720px] leading-[1.6] mb-6" style={{ color: 'var(--ink)', opacity: 0.82 }}>
        הורד עותק מלא של כל הנתונים כקובץ JSON — גיבוי מקומי נוסף על גיבוי הענן האוטומטי.
      </p>

      <div className="flex flex-wrap items-center gap-6 mb-6">
        <div className="flex gap-5 text-[13px]" style={{ color: 'var(--text-soft)' }}>
          <span>👥 {counts.students} סטודנטים</span>
          <span>🎯 {counts.candidates} מועמדים</span>
          <span>🏢 {counts.employers} מעסיקים</span>
          <span>📚 {counts.lectures} הרצאות</span>
        </div>
      </div>

      <button onClick={download} style={{
        display: 'inline-block', padding: '12px 22px', fontSize: '13px', fontWeight: 600,
        background: done ? 'var(--accent)' : 'var(--accent)', color: 'white', border: 'none',
        borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
        opacity: done ? 0.75 : 1,
      }}>{done ? '✓ הקובץ הורד!' : '⬇ הורד גיבוי JSON →'}</button>
    </section>
  );
}

/* ─── Sharing Guide ──────────────────────────────────────────────────────── */

function SharingGuide() {
  const appUrl = 'https://practicum.yarivitzkovich.org/';

  return (
    <section className="mb-16">
      <div className="flex items-baseline justify-between gap-8 mb-8 pb-5 border-b" style={{ borderColor: 'var(--divider)' }}>
        <h2 className="serif text-[30px] tracking-tight" style={{ color: 'var(--ink)' }}>
          שיתוף עם רחל
        </h2>
        <span className="mono text-[11px] uppercase tracking-[0.15em] font-semibold px-3 py-1 rounded-full"
          style={{ color: 'var(--accent)', background: 'rgba(122,30,43,0.08)' }}>
          ☁️ ענן משותף
        </span>
      </div>

      <p className="text-[15px] max-w-[720px] leading-[1.6] mb-8" style={{ color: 'var(--ink)', opacity: 0.82 }}>
        המערכת שומרת את כל הנתונים ב‑<strong>Supabase Cloud</strong> — כל שינוי שאת או רחל עושות מתעדכן אוטומטית לשניכן תוך שניות. אין צורך לשלוח קבצים.
      </p>

      <div className="space-y-5">

        <div className="rounded-xl border p-6" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
          <div className="flex items-start gap-4">
            <div className="chapter-mark shrink-0 mt-1" style={{ fontSize: '11px', minWidth: '28px' }}>01</div>
            <div>
              <div className="serif text-[19px] mb-2" style={{ color: 'var(--ink)' }}>שלחי לרחל את קישור המערכת</div>
              <div className="mono text-[12.5px] px-4 py-2.5 rounded-lg select-all break-all"
                style={{ background: 'var(--bg)', border: '1px solid var(--divider)', color: 'var(--accent)' }}>
                {appUrl}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border p-6" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
          <div className="flex items-start gap-4">
            <div className="chapter-mark shrink-0 mt-1" style={{ fontSize: '11px', minWidth: '28px' }}>02</div>
            <div>
              <div className="serif text-[19px] mb-2" style={{ color: 'var(--ink)' }}>רחל מזינה סיסמה ומתחברת לענן</div>
              <ol className="text-[14px] leading-[1.85] space-y-1 pr-0" style={{ color: 'var(--ink)', opacity: 0.82 }}>
                <li><strong>א.</strong> מוצג מסך סיסמה — הסיסמה זהה לשלך.</li>
                <li><strong>ב.</strong> מוצג מסך "כניסה לענן" — רחל מכניסה מייל ולוחצת "שלח קוד".</li>
                <li><strong>ג.</strong> היא מקבלת קוד ב‑6 ספרות למייל ומזינה אותו.</li>
                <li><strong>ד.</strong> <strong>פעם אחת בלבד</strong> — הדפדפן זוכר את ההתחברות.</li>
              </ol>
            </div>
          </div>
        </div>

        <div className="rounded-xl border p-6" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
          <div className="flex items-start gap-4">
            <div className="chapter-mark shrink-0 mt-1" style={{ fontSize: '11px', minWidth: '28px' }}>03</div>
            <div>
              <div className="serif text-[19px] mb-2" style={{ color: 'var(--ink)' }}>עבודה שוטפת — ענן אוטומטי</div>
              <ul className="text-[14px] leading-[1.85] space-y-1" style={{ color: 'var(--ink)', opacity: 0.82 }}>
                <li>✓ כל שמירה עוברת מיד לענן ומופיעה אצל שניכן תוך שניות.</li>
                <li>✓ הנתונים משותפים לחלוטין — אין צורך לרענן ידנית.</li>
                <li>✓ ניתן להגדיר הרשאות לפי קורס כך שרחל רואה רק את הקורסים שלה.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="rounded-xl p-5" style={{ background: 'rgba(122,30,43,0.04)', border: '1px solid var(--divider)' }}>
          <div className="mono text-[11px] uppercase tracking-[0.15em] font-semibold mb-3" style={{ color: 'var(--text-soft)' }}>
            פתרון בעיות
          </div>
          <ul className="text-[13.5px] leading-[1.8] space-y-1" style={{ color: 'var(--ink)', opacity: 0.82 }}>
            <li>• <strong>לא קיבלתי קוד</strong> — בדקי ב‑Spam. המייל מגיע מ‑<em>noreply@mail.app.supabase.io</em></li>
            <li>• <strong>הנתונים לא מתעדכנים</strong> — לחצי "↻ רענן מהענן" בכל עמוד.</li>
            <li>• <strong>שאלה נוספת</strong> — <strong>yarivi@ariel.ac.il</strong></li>
          </ul>
        </div>

      </div>
    </section>
  );
}

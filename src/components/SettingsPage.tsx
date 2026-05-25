import { useEffect, useState } from 'react';
import type { PageProps } from './pageShared';
import { describePermissions, permissionsFor } from '../lib/permissions';
import * as ms from '../lib/msGraph';
import * as fs from '../lib/folderCreation';

export default function SettingsPage(props: PageProps) {
  const { userName, data } = props;
  const [clientId, setClientId] = useState('');
  const [tenant, setTenant] = useState('common');
  const [cfgOk, setCfgOk] = useState(ms.hasConfig());
  const [signedIn, setSignedIn] = useState(false);
  const [msEmail, setMsEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const existing = ms.getConfig();
      if (existing) {
        setClientId(existing.clientId);
        setTenant(existing.tenant);
        setCfgOk(true);
        setSignedIn(await ms.isSignedIn());
        setMsEmail(await ms.signedInEmail());
      }
    })();
  }, []);

  async function handleSaveConfig() {
    if (!clientId.trim()) { alert('הדבק את ה‑Application (client) ID מ‑Entra'); return; }
    ms.setConfig(clientId.trim(), tenant.trim() || 'common');
    setCfgOk(true);
    setMsg('✓ נשמר. עכשיו לחץ "התחבר לאאוטלוק"');
    setTimeout(() => setMsg(null), 3000);
  }

  async function handleConnect() {
    setBusy(true); setMsg(null);
    const r = await ms.signIn();
    setBusy(false);
    if (!r.ok) { setMsg('שגיאה: ' + (r.error || 'התחברות נכשלה')); return; }
    setSignedIn(true);
    setMsEmail(r.email || null);
    setMsg('✓ מחובר ל‑Outlook. כל הרצאה שתיצור/תערוך תסונכרן ליומן תוך שנייה.');
    setTimeout(() => setMsg(null), 6000);
  }

  async function handleDisconnect() {
    setBusy(true);
    await ms.signOut();
    setBusy(false);
    setSignedIn(false);
    setMsEmail(null);
    setMsg('✓ נותק');
    setTimeout(() => setMsg(null), 3000);
  }

  async function handleClear() {
    if (!confirm('למחוק את פרטי ההתחברות ל‑Entra? תצטרך להזין שוב.')) return;
    ms.clearConfig();
    setClientId(''); setTenant('common');
    setCfgOk(false); setSignedIn(false); setMsEmail(null);
  }

  return (
    <main className="max-w-[900px] mx-auto px-4 sm:px-10 pt-14 pb-28">

      <section className="pt-4 pb-12 border-b mb-12" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-6">VII · הגדרות</div>
        <h1 className="serif text-[30px] sm:text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>הגדרות</h1>
        <p className="text-[15px] sm:text-[17.5px] max-w-[620px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
          אינטגרציה עם יומן Outlook, הרשאות, והגדרות מערכת.
        </p>
      </section>

      {/* Outlook sync card */}
      <section className="mb-16">
        <div className="flex items-baseline justify-between gap-8 mb-8 pb-5 border-b" style={{ borderColor: 'var(--divider)' }}>
          <h2 className="serif text-[30px] tracking-tight" style={{ color: 'var(--ink)' }}>
            סנכרון ליומן Outlook
          </h2>
          <StatusChip signedIn={signedIn} cfgOk={cfgOk} />
        </div>

        <p className="text-[15px] max-w-[720px] leading-[1.6] mb-8" style={{ color: 'var(--ink)', opacity: 0.82 }}>
          חיבור חד‑פעמי של החשבון <strong>yarivi@ariel.ac.il</strong> ל‑Microsoft Graph.
          אחרי ההתחברות, כל הרצאה / ראיון שתיצור או תערוך במערכת תופיע ביומן Outlook שלך
          <em style={{ color: 'var(--accent)' }}>תוך שנייה</em>, אוטומטית.
        </p>

        {!cfgOk ? (
          <SetupInstructions
            clientId={clientId} setClientId={setClientId}
            tenant={tenant} setTenant={setTenant}
            onSave={handleSaveConfig}
          />
        ) : (
          <div className="space-y-3">
            <Row label="Application (Client) ID" value={clientId.slice(0,8) + '...' + clientId.slice(-4)} />
            <Row label="Tenant" value={tenant} />
            {signedIn && msEmail && <Row label="מחובר כ" value={msEmail} accent />}

            <div className="flex flex-wrap gap-3 pt-6">
              {!signedIn ? (
                <button onClick={handleConnect} disabled={busy} style={{
                  display: 'inline-block', padding: '12px 22px', fontSize: '13px', fontWeight: 600,
                  background: busy ? 'var(--divider)' : 'var(--accent)', color: 'white', border: 'none',
                  borderRadius: '999px', cursor: busy ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap', flexShrink: 0, opacity: busy ? 0.7 : 1,
                }}>{busy ? 'מתחבר...' : 'התחבר ל‑Outlook →'}</button>
              ) : (
                <button onClick={handleDisconnect} disabled={busy} style={{
                  display: 'inline-block', padding: '12px 20px', fontSize: '12px', fontWeight: 600,
                  background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)',
                  borderRadius: '999px', cursor: busy ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap', flexShrink: 0, opacity: busy ? 0.7 : 1,
                }}>{busy ? 'מתנתק...' : 'התנתק'}</button>
              )}
              <button onClick={handleClear}
                className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold mr-auto hover:opacity-70"
                style={{ color: 'var(--accent)' }}>
                אפס הגדרות Entra
              </button>
            </div>
          </div>
        )}

        {msg && (
          <div className="mt-6 mono text-[11.5px] uppercase tracking-[0.14em]" style={{ color: msg.startsWith('✓') ? 'var(--accent)' : 'var(--accent)' }}>
            {msg}
          </div>
        )}
      </section>

      {/* Folder creation card */}
      <FolderCreationCard data={data} />

      {/* JSON backup download */}
      <JsonBackupCard data={data} />

      {/* Sharing / collaboration guide */}
      <SharingGuide />

      {/* Profile card */}
      <section>
        <div className="flex items-baseline justify-between gap-8 mb-8 pb-5 border-b" style={{ borderColor: 'var(--divider)' }}>
          <h2 className="serif text-[30px] tracking-tight" style={{ color: 'var(--ink)' }}>פרופיל וגישה</h2>
        </div>
        <Row label="משתמש" value={userName} />
        <Row label="הרשאות" value={describePermissions(permissionsFor(null /* could be wired */))} accent />
      </section>
    </main>
  );
}

function FolderCreationCard({ data }: { data: any }) {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [supported] = useState(fs.isSupported());

  async function handleCreateAll() {
    if (!confirm('צור את כל תיקיות הקבצים עבור כל הקורסים/שנים הקיימים?\nפעולה זו דורשת לבחור פעם אחת את תיקיית "data" ב‑OneDrive.')) return;
    setBusy(true);
    setLog([]);
    const r = await fs.createFoldersForAllCourses(data);
    setBusy(false);
    setLog([
      `✓ נוצרו מבני תיקיות חדשים: ${r.fullyCreated}`,
      `🔧 הושלמו חסרות בקורסים קיימים: ${r.partiallyFilled}`,
      `⚠ כבר היו קיימים: ${r.alreadyExisted}`,
      r.errors > 0 ? `✗ שגיאות: ${r.errors}` : '',
      '',
      ...r.log,
    ].filter(Boolean));
  }

  async function handleRepick() {
    await fs.getOrRequestDataDir(true);
  }

  return (
    <section className="mb-16">
      <div className="flex items-baseline justify-between gap-8 mb-8 pb-5 border-b" style={{ borderColor: 'var(--divider)' }}>
        <h2 className="serif text-[30px] tracking-tight" style={{ color: 'var(--ink)' }}>
          תיקיות OneDrive — יצירה אוטומטית
        </h2>
        <span className="mono text-[11px] uppercase tracking-[0.15em] font-semibold px-3 py-1 rounded-full"
          style={{
            color: supported ? 'var(--accent)' : 'var(--text-soft)',
            background: supported ? 'rgba(122,30,43,0.08)' : 'transparent',
            border: supported ? 'none' : '1px solid var(--divider)',
          }}>
          {supported ? '✓ נתמך' : 'לא נתמך (נדרש Chrome/Edge)'}
        </span>
      </div>

      <p className="text-[15px] max-w-[720px] leading-[1.6] mb-6" style={{ color: 'var(--ink)', opacity: 0.82 }}>
        יצירה אוטומטית של מבנה התיקיות ב‑<strong>OneDrive</strong> עבור כל קורס/שנה:
        &nbsp;קורות חיים · טפסי הגשה · טפסי מועמדות · סיכומי ראיון · חוות דעת ארגון.
        <br />
        <span className="mono text-[11.5px] uppercase tracking-[0.12em] mt-3 inline-block" style={{ color: 'var(--text-soft)' }}>
          פעם ראשונה: הדפדפן יבקש לבחור את תיקיית "data" שבתוך "מערכת לניהול פרקטיקום" ב‑OneDrive. תידרש אישור פעם אחת בלבד.
        </span>
      </p>

      {!supported && (
        <div className="rounded-xl p-5 mb-5" style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid var(--accent)' }}>
          <div className="text-[14px]" style={{ color: 'var(--ink)' }}>
            תכונה זו דורשת File System Access API הזמין רק ב‑<strong>Chrome</strong> או <strong>Edge</strong> (מחשב).
            <br />Safari, Firefox, ומובייל — יש ליצור את התיקיות ידנית.
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button onClick={handleCreateAll} disabled={!supported || busy} style={{
          display: 'inline-block', padding: '12px 22px', fontSize: '13px', fontWeight: 600,
          background: (!supported || busy) ? 'var(--divider)' : 'var(--accent)', color: 'white', border: 'none',
          borderRadius: '999px', cursor: (!supported || busy) ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap', flexShrink: 0, opacity: (!supported || busy) ? 0.6 : 1,
        }}>{busy ? 'יוצר...' : '🗂 צור תיקיות לכל הקורסים →'}</button>
        {supported && (
          <button onClick={handleRepick} disabled={busy} style={{
            display: 'inline-block', padding: '12px 20px', fontSize: '12px', fontWeight: 600,
            background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)',
            borderRadius: '999px', cursor: busy ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap', flexShrink: 0, opacity: busy ? 0.7 : 1,
          }}>החלף תיקיית יעד</button>
        )}
      </div>

      {log.length > 0 && (
        <div className="mt-8 rounded-xl p-5 font-mono text-[12px] leading-[1.7]"
          style={{ background: 'rgba(26,22,18,0.04)', border: '1px solid var(--divider)', color: 'var(--ink)' }}>
          {log.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
    </section>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-6 py-3 border-b" style={{ borderColor: 'var(--divider)' }}>
      <span className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold w-52 shrink-0" style={{ color: 'var(--text-soft)' }}>
        {label}
      </span>
      <span className="text-[15px]" style={{ color: accent ? 'var(--accent)' : 'var(--ink)', fontFamily: accent ? undefined : 'ui-monospace, monospace' }}>
        {value}
      </span>
    </div>
  );
}

function StatusChip({ signedIn, cfgOk }: { signedIn: boolean; cfgOk: boolean }) {
  const text = !cfgOk ? 'לא מוגדר' : signedIn ? '✓ מחובר' : 'לא מחובר';
  const color = !cfgOk ? 'var(--text-soft)' : signedIn ? 'var(--accent)' : 'var(--text-soft)';
  return (
    <span className="mono text-[11px] uppercase tracking-[0.15em] font-semibold px-3 py-1 rounded-full whitespace-nowrap"
      style={{ color, background: signedIn ? 'rgba(122, 30, 43, 0.08)' : 'transparent', border: signedIn ? 'none' : '1px solid var(--divider)' }}>
      {text}
    </span>
  );
}

/* ─── JSON Backup Download ───────────────────────────────────────────── */
function JsonBackupCard({ data }: { data: any }) {
  const [done, setDone] = useState(false);

  function download() {
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
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
        הקובץ כולל סטודנטים, מועמדים, מעסיקים, הרצאות ועוד.
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
        background: done ? '#17a34a' : 'var(--accent)', color: 'white', border: 'none',
        borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
      }}>{done ? '✓ הקובץ הורד!' : '⬇ הורד גיבוי JSON →'}</button>
    </section>
  );
}

/* ─── Sharing / Collaboration Guide ─────────────────────────────────── */
function SharingGuide() {
  const appUrl = 'https://itzkovichyariv-star.github.io/Practicum-v2/';

  return (
    <section className="mb-16">
      <div className="flex items-baseline justify-between gap-8 mb-8 pb-5 border-b" style={{ borderColor: 'var(--divider)' }}>
        <h2 className="serif text-[30px] tracking-tight" style={{ color: 'var(--ink)' }}>
          שיתוף עם קולגה (רחל)
        </h2>
        <span className="mono text-[11px] uppercase tracking-[0.15em] font-semibold px-3 py-1 rounded-full"
          style={{ color: 'var(--accent)', background: 'rgba(122,30,43,0.08)' }}>
          ☁️ ענן משותף
        </span>
      </div>

      <p className="text-[15px] max-w-[720px] leading-[1.6] mb-8" style={{ color: 'var(--ink)', opacity: 0.82 }}>
        המערכת שומרת את כל הנתונים ב‑<strong>Supabase Cloud</strong> — כך שכל שינוי שאת או רחל עושות
        מתעדכן אוטומטית לשניכן תוך שניות. אין צורך לשלוח קבצים; כל שינוי נשמר מיד בענן.
      </p>

      <div className="space-y-6">

        {/* Step 1 */}
        <div className="rounded-xl border p-6" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
          <div className="flex items-start gap-4">
            <div className="chapter-mark shrink-0 mt-1" style={{ fontSize: '11px', minWidth: '28px' }}>01</div>
            <div>
              <div className="serif text-[19px] mb-2" style={{ color: 'var(--ink)' }}>שלח לרחל את קישור המערכת</div>
              <p className="text-[14px] leading-[1.6] mb-3" style={{ color: 'var(--ink)', opacity: 0.82 }}>
                שלח/י לרחל בווטסאפ / מייל את הקישור הבא. היא פותחת אותו בדפדפן — לא צריך להתקין כלום.
              </p>
              <div className="mono text-[12.5px] px-4 py-2.5 rounded-lg select-all break-all"
                style={{ background: 'var(--bg)', border: '1px solid var(--divider)', color: 'var(--accent)' }}>
                {appUrl}
              </div>
            </div>
          </div>
        </div>

        {/* Step 2 */}
        <div className="rounded-xl border p-6" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
          <div className="flex items-start gap-4">
            <div className="chapter-mark shrink-0 mt-1" style={{ fontSize: '11px', minWidth: '28px' }}>02</div>
            <div>
              <div className="serif text-[19px] mb-2" style={{ color: 'var(--ink)' }}>רחל מזינה סיסמה ומתחברת לענן</div>
              <ol className="text-[14px] leading-[1.85] space-y-1 pr-0" style={{ color: 'var(--ink)', opacity: 0.82 }}>
                <li><strong>א.</strong> כשנפתחת המערכת — מוצג מסך סיסמה. הסיסמה זהה לסיסמה שלך (צור קשר לקבלה).</li>
                <li><strong>ב.</strong> לאחר הסיסמה — מוצג מסך "כניסה לענן". רחל מכניסה את כתובת המייל שלה ולוחצת "שלח קוד".</li>
                <li><strong>ג.</strong> היא מקבלת קוד ב‑6 ספרות למייל — מזינה אותו ומאושרת.</li>
                <li><strong>ד.</strong> <strong>פעם אחת בלבד</strong> — לאחר מכן הדפדפן שלה זוכר את ההתחברות.</li>
              </ol>
            </div>
          </div>
        </div>

        {/* Step 3 */}
        <div className="rounded-xl border p-6" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
          <div className="flex items-start gap-4">
            <div className="chapter-mark shrink-0 mt-1" style={{ fontSize: '11px', minWidth: '28px' }}>03</div>
            <div>
              <div className="serif text-[19px] mb-2" style={{ color: 'var(--ink)' }}>עבודה שוטפת — ענן אוטומטי</div>
              <ul className="text-[14px] leading-[1.85] space-y-1" style={{ color: 'var(--ink)', opacity: 0.82 }}>
                <li>✓ כל שמירה (הוספת סטודנט, עדכון הרצאה, וכד') עוברת מיד לענן.</li>
                <li>✓ שתיכן רואות את אותם נתונים — הנתונים משותפים לחלוטין.</li>
                <li>✓ אין צורך לרענן ידנית — השינויים מופיעים אוטומטית תוך שניות (Realtime Sync).</li>
                <li>✓ כשרחל שומרת — את רואה את השינוי שלה תוך שנייה, ולהפך.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Step 4 */}
        <div className="rounded-xl border p-6" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
          <div className="flex items-start gap-4">
            <div className="chapter-mark shrink-0 mt-1" style={{ fontSize: '11px', minWidth: '28px' }}>04</div>
            <div>
              <div className="serif text-[19px] mb-2" style={{ color: 'var(--ink)' }}>הרשאות — מה רחל יכולה לראות</div>
              <p className="text-[14px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.82 }}>
                ניתן להגדיר הרשאות לפי קורס / שנה. כך רחל רואה רק את הקורסים שלה ואת עצמה.
                לשינוי הרשאות — עדכן את הקובץ <code className="mono text-[12px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(122,30,43,0.08)' }}>src/lib/permissions.ts</code> בקוד המקור.
              </p>
            </div>
          </div>
        </div>

        {/* Troubleshooting */}
        <div className="rounded-xl p-5" style={{ background: 'rgba(122,30,43,0.04)', border: '1px solid var(--divider)' }}>
          <div className="mono text-[11px] uppercase tracking-[0.15em] font-semibold mb-3" style={{ color: 'var(--text-soft)' }}>
            פתרון בעיות נפוצות
          </div>
          <ul className="text-[13.5px] leading-[1.8] space-y-1" style={{ color: 'var(--ink)', opacity: 0.82 }}>
            <li>• <strong>לא קיבלתי קוד במייל</strong> — בדקי ב-Spam. המייל מגיע מ‑<em>noreply@mail.app.supabase.io</em></li>
            <li>• <strong>הנתונים לא מתעדכנים</strong> — לחצי "↻ רענן מהענן" בכל עמוד. בדקי חיבור אינטרנט.</li>
            <li>• <strong>השתנו נתונים בטעות</strong> — ניתן לראות היסטוריית עריכות בעמוד "ניהול" → History.</li>
            <li>• <strong>שאלה נוספת</strong> — פנה לתמיכה טכנית: <strong>yarivi@ariel.ac.il</strong></li>
          </ul>
        </div>

      </div>
    </section>
  );
}

function SetupInstructions({
  clientId, setClientId, tenant, setTenant, onSave,
}: { clientId: string; setClientId: (v: string) => void; tenant: string; setTenant: (v: string) => void; onSave: () => void }) {
  return (
    <div className="rounded-xl border p-7 space-y-5" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>

      <div>
        <div className="chapter-mark mb-3" style={{ fontSize: '11px' }}>Step 1</div>
        <div className="serif text-[19px] mb-2" style={{ color: 'var(--ink)' }}>רשום אפליקציה ב‑Microsoft Entra</div>
        <ol className="text-[14px] leading-[1.7] space-y-1 pr-4" style={{ color: 'var(--ink)', opacity: 0.82 }}>
          <li>1. היכנס ל‑<a href="https://entra.microsoft.com" target="_blank" rel="noopener" style={{ color: 'var(--accent)', borderBottom: '1px solid var(--accent)' }}>entra.microsoft.com</a></li>
          <li>2. <strong>Applications → App registrations → New registration</strong></li>
          <li>3. שם: "Practicum v2"</li>
          <li>4. Supported account types: <strong>Accounts in any organizational directory</strong></li>
          <li>5. Redirect URI (<strong>Single-page application</strong>): <code style={{ background: 'rgba(122,30,43,0.08)', padding: '2px 6px', borderRadius: 4 }}>https://itzkovichyariv-star.github.io/Practicum-v2/</code></li>
          <li>6. <strong>Register</strong></li>
        </ol>
      </div>

      <div>
        <div className="chapter-mark mb-3" style={{ fontSize: '11px' }}>Step 2</div>
        <div className="serif text-[19px] mb-2" style={{ color: 'var(--ink)' }}>הוסף הרשאה ליומן</div>
        <ol className="text-[14px] leading-[1.7] space-y-1 pr-4" style={{ color: 'var(--ink)', opacity: 0.82 }}>
          <li>1. <strong>API permissions → Add a permission → Microsoft Graph → Delegated permissions</strong></li>
          <li>2. בחר: <code style={{ background: 'rgba(122,30,43,0.08)', padding: '2px 6px', borderRadius: 4 }}>Calendars.ReadWrite</code></li>
          <li>3. <strong>Add permissions</strong></li>
        </ol>
      </div>

      <div>
        <div className="chapter-mark mb-3" style={{ fontSize: '11px' }}>Step 3</div>
        <div className="serif text-[19px] mb-4" style={{ color: 'var(--ink)' }}>הדבק את ה‑Application (client) ID כאן</div>
        <div className="space-y-3">
          <label className="block">
            <span className="small-caps block mb-1.5">Application (Client) ID</span>
            <input
              type="text"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="input"
              style={{ padding: '12px 16px', fontSize: '14px', fontFamily: 'ui-monospace, monospace' }}
            />
          </label>
          <label className="block">
            <span className="small-caps block mb-1.5">Tenant (אופציונלי — ברירת מחדל: common)</span>
            <input
              type="text"
              value={tenant}
              onChange={e => setTenant(e.target.value)}
              placeholder="common"
              className="input"
              style={{ padding: '12px 16px', fontSize: '14px', fontFamily: 'ui-monospace, monospace' }}
            />
            <span className="text-[12px] mt-1 block" style={{ color: 'var(--text-soft)' }}>
              אם Ariel IT נתנו tenant ID ספציפי, הזן אותו. אחרת השאר "common".
            </span>
          </label>
          <button onClick={onSave} style={{
            display: 'inline-block', marginTop: '12px', padding: '12px 22px', fontSize: '13px', fontWeight: 600,
            background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px',
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}>שמור →</button>
        </div>
      </div>
    </div>
  );
}

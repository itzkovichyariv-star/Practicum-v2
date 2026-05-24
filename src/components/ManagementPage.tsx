import { useEffect, useRef, useState } from 'react';
import type { PageProps } from './pageShared';
import type { Course } from '../lib/supabase';
import { supabase } from '../lib/supabase';
import { normalizeYear } from '../lib/session';
import { saveSnapshot, randomId, loadSnapshots, restoreSnapshot, type SnapshotMeta } from '../lib/dataApi';
import { CONTACT_PATCHES } from '../lib/contactPatches';
import { showToast } from '../lib/toast';
import * as fs from '../lib/folderCreation';

export default function ManagementPage(props: PageProps) {
  return (
    <main className="max-w-[1200px] mx-auto px-10 pt-10 pb-28">

      <section className="pt-4 pb-10 border-b mb-10" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-4">X · ניהול</div>
        <h1 className="serif text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>ניהול</h1>
        <p className="text-[17.5px] max-w-[620px] leading-[1.55]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
          הוסף ונהל קורסים, שנים אקדמיות, ומוסדות. יצירת קורס חדש מאפשרת גם יצירת תיקיות ב‑OneDrive בלחיצה אחת.
        </p>
      </section>

      <SettingsSection {...props} />
      <SeedLecturesSection {...props} />
      <PatchContactsSection {...props} />
      <SeedTrainersSection {...props} />
      <ActivityLogSection {...props} />
      <SnapshotsSection {...props} />
      <YearsSection {...props} />
      <InstitutionsSection {...props} />
      <CoursesSection {...props} />
      <SlotsSection {...props} />
    </main>
  );
}

/* ====== Versioned Snapshots / Restore ====== */

function SnapshotsSection({ data, userName, onRefresh }: PageProps) {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  // Auto-load on mount so the list is always visible without a manual click
  useEffect(() => { fetchSnapshots(); }, []);

  async function fetchSnapshots() {
    setLoading(true);
    const list = await loadSnapshots();
    setSnapshots(list);
    setLoading(false);
  }

  async function handleRestore(snap: SnapshotMeta) {
    if (!confirm(
      `לשחזר לגרסה מ-${new Date(snap.created_at).toLocaleString('he-IL')} (ע"י ${snap.editor_name})?\n\nהנתונים הנוכחיים יידרסו ויוחלפו בגרסה זו.`
    )) return;
    setRestoring(snap.id);
    const res = await restoreSnapshot(snap.id);
    if (!res.ok || !res.data) {
      alert('שגיאה בשחזור: ' + (res.error || 'לא ידוע'));
      setRestoring(null);
      return;
    }
    const saveRes = await saveSnapshot(
      res.data,
      { name: userName },
      { action: 'שוחזר', entity: 'גיבוי', target: new Date(snap.created_at).toLocaleString('he-IL') }
    );
    setRestoring(null);
    if (!saveRes.ok) {
      alert('שגיאה בשמירה לאחר שחזור: ' + (saveRes.error || ''));
      return;
    }
    showToast('✓ שוחזר בהצלחה', 'success');
    onRefresh();
  }

  /** Download current in-memory data as a timestamped JSON file. */
  function handleDownloadBackup() {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `practicum-backup-${ts}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`✓ גיבוי הורד: ${filename}`, 'success');
  }

  function timeLabel(ts: string) {
    const d = new Date(ts);
    const diff = Date.now() - d.getTime();
    const m = Math.round(diff / 60000);
    if (m < 1) return 'עכשיו';
    if (m < 60) return `לפני ${m} דק׳`;
    const h = Math.round(m / 60);
    if (h < 24) return `לפני ${h} שע׳`;
    return d.toLocaleString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  return (
    <section className="mb-12 rounded-xl border p-6" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <div className="chapter-mark mb-1" style={{ fontSize: '11px' }}>גיבוי · Snapshots</div>
          <div className="serif text-[22px]" style={{ color: 'var(--ink)' }}>גרסאות לשחזור</div>
          <div className="text-[13px] mt-1" style={{ color: 'var(--text-soft)' }}>
            כל שמירה יוצרת גרסה אוטומטית (עד 50 גרסאות). גיבוי אוטומטי כל 12 שעות.
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={handleDownloadBackup}
            className="btn whitespace-nowrap"
            title="הורד קובץ JSON של כל הנתונים"
          >
            ⬇ הורד גיבוי
          </button>
          <button
            onClick={fetchSnapshots}
            disabled={loading}
            className="btn whitespace-nowrap"
          >
            {loading ? 'טוען...' : '↻ רענן'}
          </button>
        </div>
      </div>

      {!loading && snapshots.length === 0 && (
        <div className="mono text-[12px] uppercase tracking-[0.14em] py-4" style={{ color: 'var(--text-soft)' }}>
          אין גרסאות שמורות עדיין — הן נוצרות אוטומטית בכל שמירה.
          <br />
          <span className="text-[11px] mt-1 block">דרושה הרצת ה-SQL ביצירת הטבלה ב-Supabase Dashboard.</span>
        </div>
      )}

      {loading && (
        <div className="mono text-[12px] uppercase tracking-[0.14em] py-4" style={{ color: 'var(--text-soft)' }}>
          טוען גרסאות...
        </div>
      )}

      {!loading && snapshots.length > 0 && (
        <ul>
          {snapshots.map((snap, i) => (
            <li key={snap.id}
              className="py-3.5 border-b flex items-center gap-4"
              style={{ borderColor: 'var(--divider)' }}>
              <span className="mono text-[10.5px] uppercase tracking-[0.13em] w-5 shrink-0 text-right" style={{ color: 'var(--text-soft)' }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>
                  {snap.action}{snap.entity ? ` · ${snap.entity}` : ''}{snap.target ? ` — ${snap.target}` : ''}
                </div>
                <div className="mono text-[11px] mt-0.5" style={{ color: 'var(--text-soft)' }}>
                  {timeLabel(snap.created_at)} · ע"י {snap.editor_name} · v{snap.version}
                </div>
              </div>
              <button
                onClick={() => handleRestore(snap)}
                disabled={restoring === snap.id}
                className="mono text-[10.5px] uppercase tracking-[0.13em] font-semibold px-3 py-1.5 rounded-full border shrink-0 hover:bg-[rgba(122,30,43,0.06)] disabled:opacity-40"
                style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                {restoring === snap.id ? 'משחזר...' : 'שחזר'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ====== System Settings ====== */

function SettingsSection({ data, userName, onRefresh }: PageProps) {
  const [email, setEmail] = useState((data as any).coordinatorEmail || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setSaving(true); setMsg(null);
    const res = await saveSnapshot(
      { ...data, coordinatorEmail: email.trim() },
      { name: userName },
      { action: 'עודכן', entity: 'הגדרות', target: 'מייל רכזת' }
    );
    setSaving(false);
    if (!res.ok) { setMsg('שגיאה: ' + (res.error || '')); return; }
    (data as any).coordinatorEmail = email.trim();
    setMsg('✓ נשמר');
    showToast('✓ הגדרות נשמרו', 'success');
    onRefresh();
    setTimeout(() => setMsg(null), 2500);
  }

  return (
    <section className="mb-12 rounded-xl border p-6" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
      <div className="chapter-mark mb-1" style={{ fontSize: '11px' }}>הגדרות מערכת</div>
      <div className="serif text-[22px] mb-4" style={{ color: 'var(--ink)' }}>הגדרות</div>
      <div className="max-w-[480px] space-y-4">
        <label className="block">
          <span className="mono text-[11px] uppercase tracking-[0.14em] font-semibold block mb-1.5" style={{ color: 'var(--text-soft)' }}>
            מייל הרכזת (מקבל עותק ממשובי מעסיקים)
          </span>
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="rachel@ariel.ac.il"
              className="input flex-1"
              style={{ padding: '10px 14px', fontSize: '14px' }}
            />
            <button onClick={save} disabled={saving} className="btn btn-primary disabled:opacity-50 whitespace-nowrap">
              {saving ? 'שומר...' : 'שמור'}
            </button>
          </div>
          <div className="text-[12px] mt-1.5" style={{ color: 'var(--text-soft)' }}>
            כאשר מעסיק ממלא משוב דרך קישור ייעודי, עותק נשלח למייל זה אוטומטית.
          </div>
        </label>
        {msg && <div className="mono text-[11.5px] uppercase tracking-[0.14em]" style={{ color: msg.startsWith('✓') ? 'var(--accent)' : '#b91c1c' }}>{msg}</div>}
      </div>
    </section>
  );
}

/* ====== Seed lectures from 2025-2026 JSON ====== */

// All 23 lectures from the official JSON file — mapped to Practicum-v2 Lecture type
const SEED_LECTURES_RAW = [
  { id:1,  semester:'א', courseName:'מבוא לניהול משאבי אנוש',    institution:'מכללת תל חי',          date:'2025-11-13', startTime:'10:30', endTime:'12:00', lecturer:'סימונה עמיר',            lecturerEmail:'simonaami@telhai.ac.il',   lecturerPhone:'050-7214426',  topic:'משאבי אנוש - הסבר על רוחב היריעה', status:'מאושר',  type:'הרצאה', cost:'',   notes:'', location:'תל חי',    year:'2025-2026' },
  { id:2,  semester:'א', courseName:'מבוא לניהול משאבי אנוש',    institution:'מכללת תל חי',          date:'2025-11-27', startTime:'09:00', endTime:'10:30', lecturer:'למא אבו אחמד (אינבידיה)',  lecturerEmail:'labuahmad@nvidia.com',     lecturerPhone:'052-889-1960', topic:'מקורות גיוס',                         status:'מאושר',  type:'הרצאה', cost:'',   notes:'הרצאה בזום', location:'זום', year:'2025-2026' },
  { id:3,  semester:'א', courseName:'פרקטיקום משאבי אנוש',       institution:'אוניברסיטת אריאל',     date:'2025-11-30', startTime:'18:00', endTime:'19:30', lecturer:'חיה וגנר מישורי',          lecturerEmail:'hayawagner@gmail.com',     lecturerPhone:'054-7004049',  topic:'מסלול קרירה והתקדמות סטודנטית',     status:'מאושר',  type:'הרצאה', cost:'',   notes:'', location:'אריאל',   year:'2025-2026' },
  { id:4,  semester:'א', courseName:'פרקטיקום משאבי אנוש',       institution:'אוניברסיטת אריאל',     date:'2025-10-26', startTime:'18:30', endTime:'19:30', lecturer:'אופיר קרקו',              lecturerEmail:'ofirk@nishapro.co.il',     lecturerPhone:'050-4014350',  topic:'גיוס טכנולוגי',                       status:'מאושר',  type:'הרצאה', cost:'',   notes:'צריך לאשר כניסה', location:'אריאל', year:'2025-2026' },
  { id:5,  semester:'א', courseName:'פרקטיקום משאבי אנוש',       institution:'אוניברסיטת אריאל',     date:'2026-01-11', startTime:'18:00', endTime:'20:00', lecturer:'איילה ראובן ללונג',        lecturerEmail:'Ayalla@eq-el.co.il',       lecturerPhone:'054-4805614',  topic:'מיומנויות קריטיות',                   status:'מאושר',  type:'סדנה',  cost:'5000', notes:'קיבלה תאריך', location:'אריאל', year:'2025-2026' },
  { id:6,  semester:'ב', courseName:'פרקטיקום משאבי אנוש',       institution:'אוניברסיטת אריאל',     date:'2026-03-22', startTime:'17:00', endTime:'20:00', lecturer:'ענבל בנימין אלרן',         lecturerEmail:'',                         lecturerPhone:'054-7889607',  topic:'התמודדות משאבי אנוש עם מצבי קיצון', status:'מאושר',  type:'הרצאה', cost:'',   notes:'לעדכן את ענבל', location:'אריאל', year:'2025-2026' },
  { id:7,  semester:'ב', courseName:'פרקטיקום משאבי אנוש',       institution:'אוניברסיטת אריאל',     date:'2026-05-10', startTime:'17:00', endTime:'20:00', lecturer:'אורית שמש',               lecturerEmail:'orits@manpower.co.il',     lecturerPhone:'050-6694104',  topic:'LinkedIn',                              status:'ממתין',  type:'סדנה',  cost:'',   notes:'פגישה עם אורית 16.4', location:'אריאל', year:'2025-2026' },
  { id:8,  semester:'ב', courseName:'מיומנויות ייעוץ ב',          institution:'אוניברסיטת אריאל',     date:'2026-04-27', startTime:'19:00', endTime:'21:00', lecturer:'חיה וגנר מישורי',          lecturerEmail:'hayawagner@gmail.com',     lecturerPhone:'054-7004049',  topic:'בניית תכנית התערבות',                  status:'מאושר',  type:'הרצאה', cost:'',   notes:'', location:'אריאל',   year:'2025-2026' },
  { id:9,  semester:'ב', courseName:'מיומנויות ייעוץ ב',          institution:'אוניברסיטת אריאל',     date:'2026-05-04', startTime:'19:00', endTime:'21:00', lecturer:'שלה דיין',                 lecturerEmail:'shelladh@gmail.com',       lecturerPhone:'054-811-1247', topic:'הנחיית קבוצות',                        status:'ממתין',  type:'הרצאה', cost:'1000', notes:'לבדוק בסילבוס', location:'אריאל', year:'2025-2026' },
  { id:10, semester:'א', courseName:'מיומנויות ייעוץ א',           institution:'אוניברסיטת אריאל',     date:'2025-12-01', startTime:'19:00', endTime:'21:00', lecturer:'איילה ראובן ללונג',        lecturerEmail:'Ayalla@eq-el.co.il',       lecturerPhone:'054-480-5614', topic:'מיומנויות קריטיות',                   status:'מאושר',  type:'סדנה',  cost:'3000', notes:'', location:'אריאל', year:'2025-2026' },
  { id:11, semester:'א', courseName:'מבוא לניהול משאבי אנוש',    institution:'מכללת תל חי',          date:'2025-12-11', startTime:'09:30', endTime:'12:00', lecturer:'מרכז סימולציות',           lecturerEmail:'noashron@gmail.com',       lecturerPhone:'050-990-1858', topic:'סימולציות גיוס',                      status:'מאושר',  type:'הרצאה', cost:'',   notes:'', location:'תל חי',    year:'2025-2026' },
  { id:12, semester:'א', courseName:'מבוא לניהול משאבי אנוש',    institution:'מכללת תל חי',          date:'2025-12-18', startTime:'09:30', endTime:'12:00', lecturer:'נועה שמיר',               lecturerEmail:'noashron@gmail.com',       lecturerPhone:'050-990-1858', topic:'סימולציות גיוס',                      status:'מאושר',  type:'הרצאה', cost:'',   notes:'', location:'תל חי',    year:'2025-2026' },
  { id:13, semester:'א', courseName:'מבוא לניהול משאבי אנוש',    institution:'מכללת תל חי',          date:'2025-12-25', startTime:'09:30', endTime:'12:00', lecturer:'נועה שמיר',               lecturerEmail:'noashron@gmail.com',       lecturerPhone:'050-990-1858', topic:'סימולציות גיוס',                      status:'מאושר',  type:'הרצאה', cost:'',   notes:'', location:'תל חי',    year:'2025-2026' },
  { id:14, semester:'א', courseName:'מבוא לניהול משאבי אנוש',    institution:'מכללת תל חי',          date:'2026-01-01', startTime:'09:30', endTime:'12:00', lecturer:'נועה שמיר',               lecturerEmail:'noashron@gmail.com',       lecturerPhone:'050-990-1858', topic:'סימולציות גיוס',                      status:'מאושר',  type:'הרצאה', cost:'',   notes:'', location:'תל חי',    year:'2025-2026' },
  { id:15, semester:'א', courseName:'מבוא לניהול משאבי אנוש',    institution:'מכללת תל חי',          date:'2026-01-15', startTime:'09:30', endTime:'12:00', lecturer:'נועה שמיר',               lecturerEmail:'noashron@gmail.com',       lecturerPhone:'050-990-1858', topic:'סימולציית התעמרות',                   status:'מאושר',  type:'הרצאה', cost:'',   notes:'', location:'תל חי',    year:'2025-2026' },
  { id:16, semester:'א', courseName:'מיומנויות ייעוץ א',           institution:'אוניברסיטת אריאל',     date:'2025-12-08', startTime:'15:00', endTime:'16:30', lecturer:'מרכז סימולציות',           lecturerEmail:'noashron@gmail.com',       lecturerPhone:'050-990-1858', topic:'סימולציית כניסה לארגון',               status:'מאושר',  type:'הרצאה', cost:'',   notes:'', location:'אריאל',   year:'2025-2026' },
  { id:17, semester:'א', courseName:'מיומנויות ייעוץ א',           institution:'אוניברסיטת אריאל',     date:'2025-12-15', startTime:'15:00', endTime:'16:30', lecturer:'מרכז סימולציות',           lecturerEmail:'noashron@gmail.com',       lecturerPhone:'050-990-1858', topic:'סימולציית כניסה לארגון',               status:'מאושר',  type:'הרצאה', cost:'',   notes:'', location:'אריאל',   year:'2025-2026' },
  { id:18, semester:'א', courseName:'מיומנויות ייעוץ א',           institution:'אוניברסיטת אריאל',     date:'2025-12-29', startTime:'15:00', endTime:'16:30', lecturer:'מרכז סימולציות',           lecturerEmail:'noashron@gmail.com',       lecturerPhone:'050-990-1858', topic:'סימולציית ראיון',                      status:'בוטל',   type:'הרצאה', cost:'',   notes:'לעדכן את גלית וספיר', location:'אריאל', year:'2025-2026' },
  { id:19, semester:'א', courseName:'מיומנויות ייעוץ א',           institution:'אוניברסיטת אריאל',     date:'2026-01-05', startTime:'15:00', endTime:'16:30', lecturer:'מרכז סימולציות',           lecturerEmail:'noashron@gmail.com',       lecturerPhone:'050-990-1858', topic:'ראיון אבחוני',                          status:'בוטל',   type:'הרצאה', cost:'',   notes:'לעדכן את גלית וספיר', location:'אריאל', year:'2025-2026' },
  { id:20, semester:'א', courseName:'מיומנויות ייעוץ ב',          institution:'אוניברסיטת אריאל',     date:'2026-03-23', startTime:'15:00', endTime:'16:30', lecturer:'מרכז סימולציות',           lecturerEmail:'noashron@gmail.com',       lecturerPhone:'050-990-1858', topic:'התנגדויות',                            status:'מאושר',  type:'הרצאה', cost:'',   notes:'לעדכן את עולא וספיר', location:'אריאל', year:'2025-2026' },
  { id:21, semester:'ב', courseName:'מיומנויות ייעוץ ב',          institution:'אוניברסיטת אריאל',     date:'2026-03-30', startTime:'15:00', endTime:'16:30', lecturer:'מרכז סימולציות',           lecturerEmail:'noashron@gmail.com',       lecturerPhone:'050-990-1858', topic:'התנגדויות',                            status:'מאושר',  type:'הרצאה', cost:'',   notes:'לעדכן את עולא וספיר ומרכז סימולציות', location:'אריאל', year:'2025-2026' },
  { id:22, semester:'א', courseName:'מיומנויות ייעוץ ב',          institution:'אוניברסיטת אריאל',     date:'2026-05-11', startTime:'19:00', endTime:'20:30', lecturer:'למלם',                    lecturerEmail:'',                         lecturerPhone:'053-8306228',  topic:'תמיכה בהפעלת סדנאות',                  status:'ממתין',  type:'סדנה',  cost:'',   notes:'', location:'אריאל',   year:'2025-2026' },
  { id:23, semester:'ב', courseName:'מיומנויות ייעוץ ב',          institution:'אוניברסיטת אריאל',     date:'2026-05-18', startTime:'19:00', endTime:'20:30', lecturer:'יניב אלטראס (פא״י)',      lecturerEmail:'',                         lecturerPhone:'052-6324476',  topic:'האקטון',                               status:'מאושר',  type:'הרצאה', cost:'',   notes:'רונית סבא 050-4060711', location:'אריאל',   year:'2025-2026' },
];

function SeedLecturesSection({ data, userName, onRefresh }: PageProps) {
  const lectureCount = (data.lectures || []).length;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (lectureCount > 0 && !msg) {
    // Already has lectures — show compact status only (no reset button to avoid accidental data loss)
    return (
      <section className="mb-10 rounded-xl border p-5 flex items-center gap-4"
        style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
        <span className="serif text-[28px]">📚</span>
        <div>
          <div className="chapter-mark mb-0.5" style={{ fontSize: '11px' }}>הרצאות · Seed Data</div>
          <div className="serif text-[17px]" style={{ color: 'var(--ink)' }}>✓ יש {lectureCount} הרצאות במערכת</div>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-14 rounded-2xl border-2 p-8" style={{ borderColor: 'var(--accent)', background: 'rgba(122,30,43,0.04)' }}>
      <div className="flex items-start gap-6 mb-5">
        <span className="serif text-[40px] leading-none shrink-0">🌱</span>
        <div>
          <div className="chapter-mark mb-2" style={{ fontSize: '11px' }}>נתוני מקור · Seed</div>
          <h2 className="serif text-[26px] tracking-tight mb-2" style={{ color: 'var(--ink)' }}>
            ייבא 23 הרצאות מ-2025-2026
          </h2>
          <p className="text-[14px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.82 }}>
            הרצאות המקור של שנת תשפ"ו לא נטענו לענן. לחץ כדי לייבא אותן עכשיו — הפעולה דורשת לחיצה אחת ואי אפשר לבטל.
          </p>
        </div>
      </div>
      <button
        onClick={() => doSeed(data, userName, onRefresh, setBusy, setMsg)}
        disabled={busy}
        className="btn btn-primary disabled:opacity-50">
        {busy ? 'שומר לענן...' : '🌱 ייבא 23 הרצאות לענן'} <span className="serif text-[16px]">→</span>
      </button>
      {msg && (
        <div className="mt-4 mono text-[12px] uppercase tracking-[0.12em]"
          style={{ color: msg.startsWith('✓') ? 'var(--accent)' : '#b91c1c' }}>
          {msg}
        </div>
      )}
    </section>
  );
}

/* ── Contact patches imported from src/lib/contactPatches.ts ── */

/* ── Known lecturers seed (for Trainers page) ── */
const KNOWN_LECTURERS = [
  { name: 'סימונה עמיר',              phone: '050-7214426',  email: 'simonaami@telhai.ac.il',  role: 'מרצה', specialty: 'משאבי אנוש' },
  { name: 'למא אבו אחמד',             phone: '052-889-1960', email: 'labuahmad@nvidia.com',    role: 'מרצה', specialty: 'גיוס טכנולוגי', organization: 'NVIDIA' },
  { name: 'חיה וגנר מישורי',           phone: '054-7004049',  email: 'hayawagner@gmail.com',    role: 'מרצה', specialty: 'קריירה והתפתחות' },
  { name: 'אופיר קרקו',               phone: '050-4014350',  email: 'ofirk@nishapro.co.il',   role: 'מרצה', specialty: 'גיוס טכנולוגי' },
  { name: 'איילה ראובן ללונג',         phone: '054-4805614',  email: 'Ayalla@eq-el.co.il',      role: 'מרצה', specialty: 'מיומנויות קריטיות' },
  { name: 'ענבל בנימין אלרן',          phone: '054-7889607',  email: '',                        role: 'מרצה', specialty: 'HR במצבי קיצון' },
  { name: 'אורית שמש',               phone: '050-6694104',  email: 'orits@manpower.co.il',    role: 'מרצה', specialty: 'LinkedIn', organization: 'Manpower' },
  { name: 'שלה דיין',                 phone: '054-811-1247', email: 'shelladh@gmail.com',      role: 'מרצה', specialty: 'הנחיית קבוצות' },
  { name: 'נועה שמיר',               phone: '050-990-1858',  email: 'noashron@gmail.com',      role: 'מרצה', specialty: 'סימולציות גיוס', organization: 'מרכז סימולציות' },
  { name: 'למלם',                     phone: '053-8306228',  email: '',                        role: 'מרצה', specialty: 'הפעלת סדנאות' },
  { name: 'יניב אלטראס',             phone: '052-6324476',  email: '',                        role: 'מרצה', specialty: 'האקתון', organization: 'פא״י' },
  { name: 'רונית סבא',               phone: '050-4060711',  email: '',                        role: 'מרצה', specialty: 'האקתון', organization: 'פא״י' },
];

function PatchContactsSection({ data, userName, onRefresh }: PageProps) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const autoRunRef = useRef(false);

  const lectures: any[] = data.lectures || [];
  const needsPatch = lectures.filter(l => {
    const patch = CONTACT_PATCHES[l.lecturer || ''];
    if (!patch) return false;
    return (patch.name && l.lecturer !== patch.name)
      || (patch.phone && !l.lecturerPhone)
      || (patch.email && !l.lecturerEmail);
  });

  // Auto-patch removed — was causing data loss by saving partial state

  async function doPatch(silent = false) {
    if (!silent && !confirm(`לעדכן פרטי קשר ב-${needsPatch.length} הרצאות?`)) return;
    setBusy(true); setMsg(null);
    const patched = lectures.map(l => {
      const p = CONTACT_PATCHES[l.lecturer || ''];
      if (!p) return l;
      return {
        ...l,
        lecturer:      p.name  && l.lecturer !== p.name  ? p.name  : l.lecturer,
        lecturerPhone: p.phone && !l.lecturerPhone       ? p.phone : l.lecturerPhone,
        lecturerEmail: p.email && !l.lecturerEmail       ? p.email : l.lecturerEmail,
      };
    });
    const res = await saveSnapshot({ ...data, lectures: patched }, { name: userName });
    setBusy(false);
    setDone(true);
    if (!res.ok) { setMsg('שגיאה: ' + (res.error || '')); return; }
    setMsg(`✓ עודכנו ${needsPatch.length} הרצאות`);
    showToast(`✓ עודכנו פרטי קשר ב-${needsPatch.length} הרצאות`, 'success');
    onRefresh();
  }

  if (needsPatch.length === 0 || done) {
    return (
      <section className="mb-10 rounded-xl border p-5 flex items-center gap-4"
        style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
        <span className="serif text-[28px]">✅</span>
        <div>
          <div className="chapter-mark mb-0.5" style={{ fontSize: '11px' }}>פרטי קשר · הרצאות</div>
          <div className="serif text-[17px]" style={{ color: 'var(--ink)' }}>
            {msg || 'כל פרטי הקשר הידועים מולאו בהרצאות'}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-10 rounded-xl border-2 p-6"
      style={{ borderColor: 'rgba(180,60,60,0.4)', background: 'rgba(180,60,60,0.04)' }}>
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="chapter-mark mb-1" style={{ fontSize: '11px' }}>פרטי קשר · הרצאות</div>
          <div className="serif text-[20px] mb-1" style={{ color: 'var(--ink)' }}>
            {busy ? 'מעדכן פרטי קשר...' : `${needsPatch.length} הרצאות עם פרטים חסרים`}
          </div>
          <div className="text-[13px] leading-[1.6]" style={{ color: 'var(--text-soft)' }}>
            {needsPatch.map(l => l.lecturer || 'ללא שם').join(' · ')}
          </div>
        </div>
        <button onClick={() => doPatch(false)} disabled={busy}
          className="btn btn-primary shrink-0 disabled:opacity-50">
          {busy ? 'מעדכן...' : '📋 עדכן פרטים'} <span className="serif text-[16px]">→</span>
        </button>
      </div>
      {msg && <div className="mt-3 mono text-[11.5px]" style={{ color: msg.startsWith('✓') ? 'var(--accent)' : '#b91c1c' }}>{msg}</div>}
    </section>
  );
}

/* ====== Seed Trainers from known lecturers ====== */

function SeedTrainersSection({ data, userName, onRefresh }: PageProps) {
  const existing = data.trainers || [];
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Auto-seed removed — was causing data loss by saving partial state

  async function doSeedTrainers(silent = false) {
    if (!silent && !confirm(`לייבא ${KNOWN_LECTURERS.length} מנחים/מרצים לדף המנחים?`)) return;
    setBusy(true); setMsg(null);

    // Find the practicum course to associate with
    const courses: any[] = data.courses || [];
    const practicumCourse = courses.find(c =>
      c.name.includes('פרקטיקום') && (c.year || '').includes('2025')
    ) || courses[0];

    const newTrainers = KNOWN_LECTURERS.map((l, i) => ({
      id: `trainer-seed-${i + 1}`,
      name: l.name,
      phone: l.phone || '',
      email: l.email || '',
      organization: l.organization || '',
      role: l.role || 'מרצה',
      specialty: l.specialty || '',
      courseId: practicumCourse?.id || '',
      year: '2025-2026',
      notes: '',
    }));

    const res = await saveSnapshot(
      { ...data, trainers: newTrainers },
      { name: userName },
    );
    setBusy(false);
    setDone(true);
    if (!res.ok) {
      setMsg('שגיאה: ' + (res.error || ''));
      showToast('שגיאה בשמירת מנחים', 'error');
      return;
    }
    setMsg(`✓ נוספו ${newTrainers.length} מנחים לדף המנחים`);
    showToast(`✓ ${newTrainers.length} מנחים נשמרו בענן ☁️`, 'success');
    onRefresh();
  }

  if (existing.length > 0 && !msg) {
    // Already seeded — compact status only (no reset button to avoid accidental data loss)
    return (
      <section className="mb-10 rounded-xl border p-5 flex items-center gap-4"
        style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
        <span className="serif text-[28px]">🧑‍🏫</span>
        <div>
          <div className="chapter-mark mb-0.5" style={{ fontSize: '11px' }}>מנחים · Seed Data</div>
          <div className="serif text-[17px]" style={{ color: 'var(--ink)' }}>✓ יש {existing.length} מנחים במערכת</div>
        </div>
      </section>
    );
  }

  if (done && msg) {
    return (
      <section className="mb-10 rounded-xl border p-5 flex items-center gap-4"
        style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
        <span className="serif text-[28px]">🧑‍🏫</span>
        <div>
          <div className="chapter-mark mb-0.5" style={{ fontSize: '11px' }}>מנחים · Seed Data</div>
          <div className="serif text-[17px]" style={{ color: 'var(--ink)' }}>{msg}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-14 rounded-2xl border-2 p-8" style={{ borderColor: 'var(--accent)', background: 'rgba(122,30,43,0.04)' }}>
      <div className="flex items-start gap-6 mb-5">
        <span className="serif text-[40px] leading-none shrink-0">🧑‍🏫</span>
        <div>
          <div className="chapter-mark mb-2" style={{ fontSize: '11px' }}>נתוני מקור · Seed</div>
          <h2 className="serif text-[26px] tracking-tight mb-2" style={{ color: 'var(--ink)' }}>
            ייבא {KNOWN_LECTURERS.length} מנחים/מרצים
          </h2>
          <p className="text-[14px] leading-[1.6]" style={{ color: 'var(--ink)', opacity: 0.82 }}>
            {busy ? 'מייבא מנחים...' : 'דף המנחים ריק. הפרטים הידועים של המרצים יועברו אוטומטית.'}
          </p>
        </div>
      </div>
      <button
        onClick={() => doSeedTrainers(false)}
        disabled={busy}
        className="btn btn-primary disabled:opacity-50">
        {busy ? 'שומר לענן...' : `🧑‍🏫 ייבא ${KNOWN_LECTURERS.length} מנחים`} <span className="serif text-[16px]">→</span>
      </button>
      {msg && (
        <div className="mt-4 mono text-[12px] uppercase tracking-[0.12em]"
          style={{ color: msg.startsWith('✓') ? 'var(--accent)' : '#b91c1c' }}>
          {msg}
        </div>
      )}
    </section>
  );
}

/* ====== Activity log ====== */

function ActivityLogSection({ data }: PageProps) {
  const history: any[] = (data as any).history || [];
  const [showAll, setShowAll] = useState(false);
  const PAGE = 15;
  const visible = showAll ? history : history.slice(0, PAGE);

  function timeAgo(ts: string) {
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.round(diff / 60000);
    if (m < 1) return 'עכשיו';
    if (m < 60) return `לפני ${m} ד׳`;
    const h = Math.round(m / 60);
    if (h < 24) return `לפני ${h} שע׳`;
    const d = Math.round(h / 24);
    if (d < 7) return `לפני ${d} ימים`;
    return new Date(ts).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: '2-digit' });
  }

  if (history.length === 0) return null;

  return (
    <Section title="יומן פעולות" count={history.length}>
      <p className="text-[13.5px] leading-[1.55] mb-5" style={{ color: 'var(--text-soft)' }}>
        כל שינוי שנשמר בענן נרשם כאן אוטומטית.
      </p>
      <ul>
        {visible.map((h: any, i: number) => (
          <li key={i} className="flex items-baseline gap-4 py-3 border-b text-[13.5px]"
            style={{ borderColor: 'var(--divider)' }}>
            <span className="mono text-[10.5px] uppercase tracking-[0.14em] font-semibold shrink-0 w-24"
              style={{ color: 'var(--text-soft)' }}>
              {timeAgo(h.ts)}
            </span>
            <span className="mono text-[10.5px] uppercase tracking-[0.12em] shrink-0 w-14"
              style={{ color: 'var(--accent)' }}>
              {h.who}
            </span>
            <span style={{ color: 'var(--ink)' }} className="flex-1 leading-[1.4]">
              {h.action} <strong>{h.entity}</strong>
              {h.target ? <span style={{ color: 'var(--text-soft)' }}> — {h.target}</span> : ''}
            </span>
          </li>
        ))}
      </ul>
      {history.length > PAGE && (
        <button
          onClick={() => setShowAll(s => !s)}
          className="mt-5 mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-4 py-2 rounded-full border hover:opacity-70"
          style={{ borderColor: 'var(--divider)', color: 'var(--text-soft)' }}>
          {showAll ? `הסתר · הצג ${PAGE} אחרונים` : `הצג הכל (${history.length} פעולות)`}
        </button>
      )}
    </Section>
  );
}

async function doSeed(
  data: any,
  userName: string,
  onRefresh: () => void,
  setBusy: (b: boolean) => void,
  setMsg: (m: string) => void,
) {
  setBusy(true);
  setMsg('');
  const courses: any[] = data.courses || [];

  // Map courseName → courseId (fuzzy: trim + lowercase)
  const courseMap = new Map<string, string>();
  courses.forEach((c: any) => {
    courseMap.set(c.name.trim().toLowerCase(), c.id);
  });

  const lectures = SEED_LECTURES_RAW.map(raw => {
    const nameKey = raw.courseName.trim().toLowerCase();
    // Try exact, then partial match
    let courseId = courseMap.get(nameKey);
    if (!courseId) {
      for (const [k, v] of courseMap.entries()) {
        if (k.includes(nameKey) || nameKey.includes(k)) { courseId = v; break; }
      }
    }
    return {
      id: `seed-${raw.id}`,
      courseId: courseId || '',
      courseName: raw.courseName,
      year: raw.year,
      semester: raw.semester,
      topic: raw.topic,
      lecturer: raw.lecturer,
      lecturerEmail: raw.lecturerEmail,
      lecturerPhone: raw.lecturerPhone,
      date: raw.date,
      startTime: raw.startTime,
      endTime: raw.endTime,
      type: raw.type,
      institution: raw.institution,
      location: raw.location,
      status: raw.status,
      cost: raw.cost,
      notes: raw.notes,
    };
  });

  const res = await saveSnapshot(
    { ...data, lectures },
    { name: userName },
    { action: 'נוסף', entity: 'הרצאות', target: `ייבוא ${lectures.length} הרצאות מ-2025-2026` },
  );

  setBusy(false);
  if (!res.ok) {
    setMsg('שגיאה: ' + (res.error || 'לא ידוע'));
    return;
  }
  setMsg(`✓ ${lectures.length} הרצאות נשמרו בענן!`);
  onRefresh();
}

/* ====== Interview slots (live from public_interview_slots table) ====== */

type SlotRow = { id: string; date: string; start_time: string; end_time: string; capacity: number; booked_count: number; course_name?: string; note?: string };

function SlotsSection({ data }: PageProps) {
  const courses = data.courses || [];
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [form, setForm] = useState({ date: '', startTime: '10:00', endTime: '10:30', capacity: 1, courseName: '', note: '' });
  const [bulkForm, setBulkForm] = useState({ date: '', startTime: '10:00', endTime: '13:00', minutesEach: 30, courseName: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.from('public_interview_slots')
      .select('*').order('date', { ascending: true }).order('start_time', { ascending: true });
    if (error) {
      setError(
        error.code === '42P01' || /does not exist/i.test(error.message)
          ? 'טבלת מועדי הראיון לא קיימת. הרץ את supabase_slots.sql ב‑Supabase כדי להפעיל.'
          : error.message
      );
      return;
    }
    setSlots((data as SlotRow[]) || []);
    setError(null);
  }

  useEffect(() => { load(); }, []);

  async function addSlot() {
    if (!form.date || !form.startTime || !form.endTime) { alert('חסרים תאריך / שעות'); return; }
    setSaving(true);
    const { error } = await supabase.from('public_interview_slots').insert({
      id: randomId('slot'),
      date: form.date,
      start_time: form.startTime,
      end_time: form.endTime,
      capacity: Math.max(1, form.capacity),
      booked_count: 0,
      course_name: form.courseName || null,
      note: form.note || null,
    });
    setSaving(false);
    if (error) { alert('שגיאה: ' + error.message); return; }
    setForm({ ...form, date: '', note: '' });
    setAdding(false);
    load();
  }

  async function deleteSlot(id: string) {
    if (!confirm('למחוק מועד ראיון? אם מועמדים כבר בחרו בו, ההגשות שלהם יישמרו אך ללא מועד משויך.')) return;
    await supabase.from('public_interview_slots').delete().eq('id', id);
    load();
  }

  async function addSequentialSlots() {
    if (!bulkForm.date || !bulkForm.startTime || !bulkForm.endTime) { alert('חסרים תאריך / שעות'); return; }
    const [sh, sm] = bulkForm.startTime.split(':').map(Number);
    const [eh, em] = bulkForm.endTime.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const step = Math.max(5, bulkForm.minutesEach);
    if (endMin <= startMin) { alert('שעת הסיום חייבת להיות אחרי שעת ההתחלה'); return; }
    const rows: any[] = [];
    for (let t = startMin; t + step <= endMin; t += step) {
      const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      rows.push({
        id: randomId('slot'),
        date: bulkForm.date,
        start_time: fmt(t),
        end_time: fmt(t + step),
        capacity: 1,
        booked_count: 0,
        course_name: bulkForm.courseName || null,
        note: bulkForm.note || null,
      });
    }
    if (rows.length === 0) { alert('טווח השעות קצר מדי ליצירת מועד'); return; }
    if (!confirm(`יווצרו ${rows.length} מועדים של ${step} דקות כל אחד, קיבולת 1. להמשיך?`)) return;
    setSaving(true);
    const { error } = await supabase.from('public_interview_slots').insert(rows);
    setSaving(false);
    if (error) { alert('שגיאה: ' + error.message); return; }
    setBulkOpen(false);
    load();
  }

  return (
    <Section title="מועדי ראיון" count={slots.length}>
      <div className="mb-3 inline-block mono text-[10px] uppercase tracking-[0.14em] px-2 py-1 rounded"
        style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
        v2.0 · 23/4 15:30
      </div>
      <p className="text-[13.5px] leading-[1.55] mb-4" style={{ color: 'var(--text-soft)' }}>
        הוסף מועדי ראיון קבועים. מועמדים שמגישים טופס הרשמה יראו את המועדים הזמינים (שעדיין לא מולאו) ויבחרו אחד.
      </p>

      <div className="mb-5 flex gap-2 flex-wrap items-center rounded-xl p-4" style={{ background: 'rgba(122,30,43,0.08)', border: '2px solid var(--accent)' }}>
        <button onClick={() => setBulkOpen(true)} className="btn btn-primary" style={{ fontSize: '15px', padding: '14px 20px' }}>
          📅 צור רצף מועדים (מומלץ) <span className="serif text-[16px]">→</span>
        </button>
        <button onClick={() => setAdding(true)} className="btn">
          + מועד בודד
        </button>
      </div>

      <p className="text-[12px] leading-[1.5] mb-5" style={{ color: 'var(--text-soft)' }}>
        <strong style={{ color: 'var(--ink)' }}>רצף מועדים</strong> יוצר סלוטים נפרדים של 30 דקות (או לכל משך שתבחר) — כל מועמד בוחר שעה אחרת.
        <br />
        <strong style={{ color: 'var(--ink)' }}>מועד בודד</strong> יוצר סלוט אחד; אם הקיבולת שלו גדולה מ‑1, כל המועמדים יקבלו את אותה שעה (למשל ראיון קבוצתי).
      </p>

      {error ? (
        <div className="py-4 text-[14px]" style={{ color: 'var(--accent)' }}>⚠ {error}</div>
      ) : slots.length === 0 ? (
        <div className="py-6 text-[14px]" style={{ color: 'var(--text-soft)' }}>
          אין מועדי ראיון מוגדרים. מועמדים שמגישים כרגע לא רואים אפשרות בחירת מועד.
        </div>
      ) : (
        <ul>
          {slots.map(s => {
            const full = s.booked_count >= s.capacity;
            return (
              <li key={s.id} className="flex items-baseline gap-4 py-3 border-b" style={{ borderColor: 'var(--divider)' }}>
                <div className="serif text-[22px] leading-none w-14 shrink-0" style={{ color: 'var(--ink)' }}>
                  {new Date(s.date).toLocaleDateString('he-IL', { day: '2-digit', month: 'short' })}
                </div>
                <div className="flex-1">
                  <div className="serif text-[17px]" style={{ color: 'var(--ink)' }}>
                    {s.start_time}–{s.end_time}
                    {s.course_name && <span className="mono text-[11px] uppercase tracking-[0.14em] mr-3" style={{ color: 'var(--text-soft)' }}>· {s.course_name}</span>}
                  </div>
                  {s.note && <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-soft)' }}>{s.note}</div>}
                </div>
                <span className="mono text-[11px] uppercase tracking-[0.14em] font-semibold px-3 py-1 rounded-full"
                  style={{
                    color: full ? 'var(--bg)' : 'var(--accent)',
                    background: full ? 'var(--accent)' : 'rgba(122,30,43,0.08)',
                  }}>
                  {s.booked_count}/{s.capacity} {full ? 'מלא' : 'פנוי'}
                </span>
                <button onClick={() => deleteSlot(s.id)}
                  className="mono text-[12px] uppercase tracking-[0.14em] opacity-70 hover:opacity-100"
                  style={{ color: 'var(--accent)' }}>🗑</button>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <div className="mt-5 rounded-xl p-5" style={{ background: 'rgba(122,30,43,0.05)', border: '1px solid var(--accent)' }}>
          <div className="chapter-mark mb-3" style={{ fontSize: '11px' }}>מועד חדש</div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <LabelledInput label="תאריך" type="date" value={form.date} onChange={(v: string) => setForm({ ...form, date: v })} />
            <LabelledInput label="שעת התחלה" type="time" value={form.startTime} onChange={(v: string) => setForm({ ...form, startTime: v })} />
            <LabelledInput label="שעת סיום" type="time" value={form.endTime} onChange={(v: string) => setForm({ ...form, endTime: v })} />
            <LabelledInput label="קיבולת (מועמדים)" type="number" value={String(form.capacity)} onChange={(v: string) => setForm({ ...form, capacity: Number(v) || 1 })} />
            <LabelledSelect label="קורס (אופציונלי — כל הקורסים אם ריק)"
              value={form.courseName}
              onChange={(v: string) => setForm({ ...form, courseName: v })}
              options={['', ...courses.map(c => c.name)]} />
            <LabelledInput label="הערה" value={form.note} onChange={(v: string) => setForm({ ...form, note: v })} placeholder="למשל: ראיון זום" />
          </div>
          <div className="flex gap-2">
            <button onClick={addSlot} disabled={saving} className="btn btn-primary disabled:opacity-50">הוסף {saving ? '...' : ''} <span className="serif text-[16px]">→</span></button>
            <button onClick={() => setAdding(false)}
              className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold opacity-60 hover:opacity-100">בטל</button>
          </div>
        </div>
      ) : null}

      {bulkOpen && (
        <div className="mt-5 rounded-xl p-5" style={{ background: 'rgba(122,30,43,0.05)', border: '1px solid var(--accent)' }}>
          <div className="chapter-mark mb-1" style={{ fontSize: '11px' }}>רצף מועדים</div>
          <p className="text-[13px] mb-3" style={{ color: 'var(--text-soft)' }}>
            יווצרו מועדים רציפים בתאריך הזה, קיבולת 1 לכל אחד — כל מועמד יבחר שעה נפרדת.
          </p>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <LabelledInput label="תאריך" type="date" value={bulkForm.date} onChange={(v: string) => setBulkForm({ ...bulkForm, date: v })} />
            <LabelledInput label="שעת התחלה" type="time" value={bulkForm.startTime} onChange={(v: string) => setBulkForm({ ...bulkForm, startTime: v })} />
            <LabelledInput label="שעת סיום" type="time" value={bulkForm.endTime} onChange={(v: string) => setBulkForm({ ...bulkForm, endTime: v })} />
            <LabelledInput label="דקות לכל ראיון" type="number" value={String(bulkForm.minutesEach)} onChange={(v: string) => setBulkForm({ ...bulkForm, minutesEach: Number(v) || 30 })} />
            <LabelledSelect label="קורס (אופציונלי)"
              value={bulkForm.courseName}
              onChange={(v: string) => setBulkForm({ ...bulkForm, courseName: v })}
              options={['', ...courses.map(c => c.name)]} />
            <LabelledInput label="הערה" value={bulkForm.note} onChange={(v: string) => setBulkForm({ ...bulkForm, note: v })} placeholder="למשל: ראיון זום" />
          </div>
          <div className="flex gap-2">
            <button onClick={addSequentialSlots} disabled={saving} className="btn btn-primary disabled:opacity-50">צור {saving ? '...' : ''} <span className="serif text-[16px]">→</span></button>
            <button onClick={() => setBulkOpen(false)}
              className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold opacity-60 hover:opacity-100">בטל</button>
          </div>
        </div>
      )}
    </Section>
  );
}


/* ====== Courses ====== */

function CoursesSection({ data, userName, onRefresh }: PageProps) {
  const courses = data.courses || [];
  const years = data.academicYears || [];
  const institutions = data.institutions || [];
  const newCourseRef = useRef<HTMLDivElement>(null);

  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', year: years[0] || 'תשפ״ו', institution: institutions[0] || 'אוניברסיטת אריאל' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<{ year: string; name: string } | null>(null);
  const [folderMsg, setFolderMsg] = useState<string | null>(null);

  async function saveCourse(next: Course[], action: string, target: string) {
    setSaving(true); setMsg(null);
    const res = await saveSnapshot({ ...data, courses: next }, { name: userName }, { action, entity: 'קורס', target });
    setSaving(false);
    if (!res.ok) { setMsg('שגיאה: ' + (res.error || '')); return false; }
    (data.courses as Course[]) = next;
    // Best-effort sync to public_courses table so the registration form sees them
    try {
      // Upsert each course
      await supabase.from('public_courses').upsert(
        next.map(c => ({ id: c.id, name: c.name, year: c.year || null, institution: c.institution || null, updated_at: new Date().toISOString() })),
        { onConflict: 'id' }
      );
      // Remove any courses that were deleted
      const existingIds = next.map(c => c.id);
      if (existingIds.length > 0) {
        await supabase.from('public_courses').delete().not('id', 'in', `(${existingIds.map(i => `"${i}"`).join(',')})`);
      }
    } catch (e) {
      console.warn('public_courses sync failed (run supabase_public_courses.sql):', e);
    }
    onRefresh();
    setMsg('✓ נשמר');
    setTimeout(() => setMsg(null), 2500);
    return true;
  }

  async function addCourse() {
    if (!form.name.trim()) { alert('שם קורס חסר'); return; }
    const newCourse: Course = {
      id: randomId('course'),
      name: form.name.trim(),
      year: normalizeYear(form.year),
      institution: form.institution,
    };
    // Duplicate check
    const dup = courses.find(c => c.name === newCourse.name && normalizeYear(c.year || '') === newCourse.year);
    if (dup) { alert('קורס באותו שם ושנה כבר קיים'); return; }
    const ok = await saveCourse([...courses, newCourse], 'נוסף', newCourse.name);
    if (ok) {
      setForm({ name: '', year: years[0] || 'תשפ״ו', institution: institutions[0] || 'אוניברסיטת אריאל' });
      setAdding(false);
      // Surface a button (fresh user gesture required for showDirectoryPicker)
      if (fs.isSupported()) {
        setJustAdded({ year: newCourse.year || 'ללא_שנה', name: newCourse.name });
        setFolderMsg(null);
      }
    }
  }

  async function createFoldersForJustAdded() {
    if (!justAdded) return;
    setFolderMsg('יוצר...');
    const r = await fs.createCourseFolders(justAdded.year, justAdded.name);
    setFolderMsg(r.message);
    if (r.ok) setTimeout(() => { setJustAdded(null); setFolderMsg(null); }, 3000);
  }

  async function createFoldersForCourse(c: Course) {
    if (!fs.isSupported()) { alert('הדפדפן לא תומך ביצירת תיקיות. פתח ב‑Chrome / Edge בדסקטופ.'); return; }
    const year = c.year ? normalizeYear(c.year) : 'ללא_שנה';
    const r = await fs.createCourseFolders(year, c.name);
    alert(r.message);
  }

  async function updateCourse(id: string, patch: Partial<Course>) {
    const next = courses.map(c => c.id === id ? { ...c, ...patch, year: patch.year ? normalizeYear(patch.year) : c.year } : c);
    await saveCourse(next, 'עודכן', next.find(c => c.id === id)?.name || '');
  }

  async function deleteCourse(c: Course) {
    const students = (data.students || []).filter(s => s.courseId === c.id).length;
    const employers = (data.employers || []).filter(e => e.courseId === c.id).length;
    if (students > 0 || employers > 0) {
      if (!confirm(`לקורס "${c.name}" יש ${students} סטודנטים ו‑${employers} מעסיקים. למחוק בכל זאת? (הרשומות יישארו במערכת אך ללא קורס משויך)`)) return;
    } else {
      if (!confirm(`למחוק את הקורס "${c.name}"?`)) return;
    }
    await saveCourse(courses.filter(x => x.id !== c.id), 'נמחק', c.name);
  }

  return (
    <Section title="קורסים" count={courses.length}>
      <ul>
        {courses.map(c => (
          <li key={c.id} className="flex items-baseline gap-4 py-3 border-b" style={{ borderColor: 'var(--divider)' }}>
            {editing === c.id ? (
              <CourseEditInline
                course={c}
                years={years}
                institutions={institutions}
                onSave={async (patch) => { await updateCourse(c.id, patch); setEditing(null); }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <>
                <div className="flex-1">
                  <div className="serif text-[19px]" style={{ color: 'var(--ink)' }}>{c.name}</div>
                  <div className="mono text-[11px] uppercase tracking-[0.14em] mt-0.5" style={{ color: 'var(--text-soft)' }}>
                    {c.year ? normalizeYear(c.year) : 'ללא שנה'} · {c.institution || 'ללא מוסד'}
                  </div>
                </div>
                <button onClick={() => createFoldersForCourse(c)}
                  title="צור תיקיות OneDrive (אם חסרות)"
                  className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-3 py-1 rounded-full border"
                  style={{ borderColor: 'var(--divider)', color: 'var(--ink)' }}>
                  🗂 תיקיות
                </button>
                <button onClick={() => setEditing(c.id)}
                  className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-3 py-1 rounded-full border"
                  style={{ borderColor: 'var(--divider)', color: 'var(--ink)' }}>
                  ערוך
                </button>
                <button onClick={() => deleteCourse(c)}
                  className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold opacity-70 hover:opacity-100"
                  style={{ color: 'var(--accent)' }}>
                  🗑
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {justAdded && (
        <div className="mt-5 rounded-xl p-5 flex items-start gap-4" style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid var(--accent)' }}>
          <div className="flex-1">
            <div className="serif text-[17px]" style={{ color: 'var(--ink)' }}>
              ✓ הקורס <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>{justAdded.name}</em> ({justAdded.year}) נוסף
            </div>
            <div className="text-[13px] mt-1" style={{ color: 'var(--text-soft)' }}>
              רוצה שאצור גם את תיקיות הקבצים ב‑OneDrive? לחצן הוא הפעלה ידנית — הדפדפן דורש זאת.
            </div>
            {folderMsg && (
              <div className="mono text-[11.5px] uppercase tracking-[0.14em] mt-2" style={{ color: 'var(--accent)' }}>
                {folderMsg}
              </div>
            )}
          </div>
          <button onClick={createFoldersForJustAdded} className="btn btn-primary whitespace-nowrap">
            🗂 צור תיקיות <span className="serif text-[16px]">→</span>
          </button>
          <button onClick={() => setJustAdded(null)}
            className="mono text-[11.5px] uppercase tracking-[0.14em] opacity-60 hover:opacity-100">
            דלג
          </button>
        </div>
      )}

      <button
        onClick={() => { setAdding(true); setTimeout(() => newCourseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}
        className="btn mt-5"
        style={{ display: adding ? 'none' : undefined }}>
        + הוסף קורס
      </button>

      {adding && (
        <div ref={newCourseRef} className="mt-5 rounded-xl p-5" style={{ background: 'rgba(122,30,43,0.05)', border: '1px solid var(--accent)' }}>
          <div className="chapter-mark mb-3" style={{ fontSize: '11px' }}>קורס חדש</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <LabelledInput label="שם קורס" value={form.name} onChange={v => setForm({ ...form, name: v })} placeholder="למשל: פרקטיקום משאבי אנוש" />
            {/* Year — free text with datalist: user can type תשפ״ז or pick from list */}
            <LabelledInputList label="שנה" value={form.year} onChange={v => setForm({ ...form, year: v })}
              options={years} listId="new-course-years" placeholder="למשל: תשפ״ז" />
            <LabelledInputList label="מוסד" value={form.institution} onChange={v => setForm({ ...form, institution: v })}
              options={institutions} listId="new-course-inst" placeholder="שם המוסד" />
          </div>
          <div className="flex gap-2">
            <button onClick={addCourse} disabled={saving} className="btn btn-primary disabled:opacity-50">
              הוסף {saving ? '...' : ''} <span className="serif text-[16px]">→</span>
            </button>
            <button onClick={() => { setAdding(false); setForm({ name: '', year: years[0] || 'תשפ״ו', institution: institutions[0] || 'אוניברסיטת אריאל' }); }}
              className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold opacity-60 hover:opacity-100">
              בטל
            </button>
          </div>
        </div>
      )}
      {msg && <div className="mono text-[11.5px] uppercase tracking-[0.14em] mt-3" style={{ color: 'var(--accent)' }}>{msg}</div>}
    </Section>
  );
}

function CourseEditInline({ course, years, institutions, onSave, onCancel }: {
  course: Course;
  years: string[];
  institutions: string[];
  onSave: (patch: Partial<Course>) => void;
  onCancel: () => void;
}) {
  const yearListId = `years-dl-${course.id}`;
  const instListId = `inst-dl-${course.id}`;
  const [form, setForm] = useState({
    name: course.name,
    year: normalizeYear(course.year || years[0] || 'תשפ״ו'),
    institution: course.institution || institutions[0] || '',
  });
  return (
    /* Two-row layout — name full width on top, fields + actions on bottom */
    <div className="flex-1 space-y-2">
      <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
        className="input w-full" style={{ padding: '7px 12px', fontSize: '14px' }} />
      <div className="flex flex-wrap items-center gap-2">
        {/* Year — free-text with datalist so Hebrew years can be typed */}
        <input value={form.year} onChange={e => setForm({ ...form, year: e.target.value })}
          list={yearListId} placeholder="שנה"
          className="input" style={{ padding: '6px 12px', fontSize: '13px', width: 110 }} />
        <datalist id={yearListId}>
          {years.map(y => <option key={y} value={normalizeYear(y)} />)}
        </datalist>
        {/* Institution */}
        <input value={form.institution} onChange={e => setForm({ ...form, institution: e.target.value })}
          list={instListId} placeholder="מוסד"
          className="input" style={{ padding: '6px 12px', fontSize: '13px', width: 180 }} />
        <datalist id={instListId}>
          {institutions.map(i => <option key={i} value={i} />)}
        </datalist>
        <button onClick={() => onSave(form)}
          className="mono text-[11px] uppercase tracking-[0.14em] font-semibold px-4 py-1.5 rounded-full"
          style={{ background: 'var(--accent)', color: 'var(--bg)', whiteSpace: 'nowrap' }}>
          שמור
        </button>
        <button onClick={onCancel}
          className="mono text-[11px] uppercase tracking-[0.14em] opacity-60 hover:opacity-100"
          style={{ whiteSpace: 'nowrap' }}>
          בטל
        </button>
      </div>
    </div>
  );
}

/* ====== Years ====== */

function YearsSection({ data, userName, onRefresh }: PageProps) {
  const years = data.academicYears || [];
  const [newYear, setNewYear] = useState('');
  const [saving, setSaving] = useState(false);

  async function addYear() {
    const y = normalizeYear(newYear.trim());
    if (!y) return;
    if (years.map(normalizeYear).includes(y)) { alert('השנה כבר קיימת'); return; }
    setSaving(true);
    await saveSnapshot({ ...data, academicYears: [...years, y].sort().reverse() },
      { name: userName }, { action: 'נוספה', entity: 'שנה', target: y });
    setSaving(false);
    (data.academicYears as string[]) = [...years, y].sort().reverse();
    onRefresh();
    setNewYear('');
  }

  async function deleteYear(y: string) {
    if (!confirm(`למחוק את שנת הלימודים ${y}?`)) return;
    setSaving(true);
    const next = years.filter(x => normalizeYear(x) !== normalizeYear(y));
    await saveSnapshot({ ...data, academicYears: next },
      { name: userName }, { action: 'נמחקה', entity: 'שנה', target: y });
    setSaving(false);
    (data.academicYears as string[]) = next;
    onRefresh();
  }

  return (
    <Section title="שנים אקדמיות" count={years.length}>
      <ul className="flex flex-wrap gap-2">
        {years.map(y => (
          <li key={y} className="flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(122,30,43,0.08)', color: 'var(--accent)' }}>
            <span className="mono text-[12px] uppercase tracking-[0.14em] font-semibold">{y}</span>
            <button onClick={() => deleteYear(y)} className="text-[12px] opacity-70 hover:opacity-100">✕</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 mt-5 items-baseline">
        <input value={newYear} onChange={e => setNewYear(e.target.value)} placeholder="למשל: תשפ״ז"
          className="input" style={{ padding: '8px 14px', fontSize: '14px', width: 200 }}
          onKeyDown={e => { if (e.key === 'Enter') addYear(); }} />
        <button onClick={addYear} disabled={saving || !newYear.trim()}
          className="btn btn-primary disabled:opacity-50">+ הוסף שנה</button>
      </div>
    </Section>
  );
}

/* ====== Institutions ====== */

function InstitutionsSection({ data, userName, onRefresh }: PageProps) {
  const institutions = data.institutions || ['אוניברסיטת אריאל', 'מכללת תל חי'];
  const [newInst, setNewInst] = useState('');
  const [saving, setSaving] = useState(false);

  async function addInst() {
    const n = newInst.trim();
    if (!n) return;
    if (institutions.includes(n)) { alert('המוסד כבר קיים'); return; }
    setSaving(true);
    await saveSnapshot({ ...data, institutions: [...institutions, n] },
      { name: userName }, { action: 'נוסף', entity: 'מוסד', target: n });
    setSaving(false);
    (data.institutions as string[]) = [...institutions, n];
    onRefresh();
    setNewInst('');
  }

  async function deleteInst(n: string) {
    if (!confirm(`למחוק את ${n} מרשימת המוסדות?`)) return;
    setSaving(true);
    const next = institutions.filter(i => i !== n);
    await saveSnapshot({ ...data, institutions: next },
      { name: userName }, { action: 'נמחק', entity: 'מוסד', target: n });
    setSaving(false);
    (data.institutions as string[]) = next;
    onRefresh();
  }

  return (
    <Section title="מוסדות" count={institutions.length}>
      <ul className="flex flex-wrap gap-2">
        {institutions.map(i => (
          <li key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-full border"
            style={{ borderColor: 'var(--divider)', color: 'var(--ink)' }}>
            <span className="text-[13px]">{i}</span>
            <button onClick={() => deleteInst(i)} className="text-[12px] opacity-60 hover:opacity-100"
              style={{ color: 'var(--accent)' }}>✕</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 mt-5 items-baseline">
        <input value={newInst} onChange={e => setNewInst(e.target.value)} placeholder="למשל: המכללה האקדמית עמק יזרעאל"
          className="input" style={{ padding: '8px 14px', fontSize: '14px', width: 300 }}
          onKeyDown={e => { if (e.key === 'Enter') addInst(); }} />
        <button onClick={addInst} disabled={saving || !newInst.trim()}
          className="btn btn-primary disabled:opacity-50">+ הוסף מוסד</button>
      </div>
    </Section>
  );
}

/* ====== Helpers ====== */

function Section({ title, count, children }: { title: string; count?: number; children: any }) {
  return (
    <section className="mb-14">
      <div className="flex items-baseline justify-between gap-8 mb-6 pb-3 border-b" style={{ borderColor: 'var(--divider)' }}>
        <h2 className="serif text-[30px] tracking-tight" style={{ color: 'var(--ink)' }}>{title}</h2>
        {count != null && (
          <span className="mono text-[12px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-soft)' }}>
            {count} רשומות
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function LabelledInput({ label, value, onChange, placeholder, type = 'text' }: any) {
  return (
    <label className="block">
      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="input w-full" style={{ padding: '10px 14px', fontSize: '14px' }} />
    </label>
  );
}

function LabelledSelect({ label, value, onChange, options }: any) {
  return (
    <label className="block">
      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="input w-full" style={{ padding: '10px 14px', fontSize: '14px',
          appearance: 'none', WebkitAppearance: 'none',
          backgroundImage: 'linear-gradient(45deg, transparent 50%, var(--accent) 50%), linear-gradient(135deg, var(--accent) 50%, transparent 50%)',
          backgroundPosition: 'calc(100% - 14px) center, calc(100% - 10px) center',
          backgroundSize: '5px 5px', backgroundRepeat: 'no-repeat', paddingLeft: '28px' }}>
        {(options || []).map((o: string) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

/** Like LabelledInput but with a <datalist> for suggestions — user can type freely OR pick */
function LabelledInputList({ label, value, onChange, options, listId, placeholder }: any) {
  return (
    <label className="block">
      <span className="small-caps block mb-1.5" style={{ letterSpacing: '0.12em' }}>{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)}
        list={listId} placeholder={placeholder}
        className="input w-full" style={{ padding: '10px 14px', fontSize: '14px' }} />
      <datalist id={listId}>
        {(options || []).map((o: string) => <option key={o} value={o} />)}
      </datalist>
    </label>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { PageProps } from './pageShared';
import type { Course, Employer } from '../lib/supabase';
import { btnPrimary, btnSecondary, btnTab, btnGhost, btnDanger, btnSmall } from '../lib/design';
import { supabase } from '../lib/supabase';
import { normalizeYear } from '../lib/session';
import { saveSnapshot, randomId, loadSnapshots, restoreSnapshot, type SnapshotMeta } from '../lib/dataApi';
import { CONTACT_PATCHES } from '../lib/contactPatches';
import { showToast } from '../lib/toast';
import * as fs from '../lib/folderCreation';
import { countSlotsByStatus } from '../lib/placement';
import EmployerEditor from './EmployerEditor';

export default function ManagementPage(props: PageProps) {
  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-10 pt-10 pb-28">

      <section className="pt-4 pb-10 border-b mb-10" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-4">X · ניהול</div>
        <h1 className="serif text-[30px] sm:text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>ניהול</h1>
        <p className="text-[15px] sm:text-[17.5px] max-w-[620px] leading-[1.55]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
          מועדי ראיון, גרסאות שחזור, קורסים ושנים אקדמיות.
        </p>
      </section>

      <SlotsSection {...props} />
      <SnapshotsSection {...props} />
      <SeedLecturesSection {...props} />
      <PatchContactsSection {...props} />
      <SeedTrainersSection {...props} />
      <YearsSection {...props} />
      <InstitutionsSection {...props} />
      <CoursesSection {...props} />
    </main>
  );
}

/* ====== Versioned Snapshots / Restore ====== */

function SnapshotsSection({ data, userName, onRefresh }: PageProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  async function fetchSnapshots() {
    setLoading(true);
    const list = await loadSnapshots();
    setSnapshots(list);
    setLoading(false);
  }

  function handleToggle() {
    if (collapsed && snapshots.length === 0 && !loading) fetchSnapshots();
    setCollapsed(c => !c);
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
    <section className="mb-12 rounded-xl border" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
      {/* Collapsible header */}
      <div
        className="flex items-center justify-between gap-4 px-6 py-4 cursor-pointer select-none"
        onClick={handleToggle}
        style={{ borderBottom: collapsed ? 'none' : '1px solid var(--divider)' }}
      >
        <div>
          <div className="chapter-mark" style={{ fontSize: '11px', marginBottom: '2px' }}>גיבוי · Snapshots</div>
          <div className="serif text-[20px]" style={{ color: 'var(--ink)' }}>
            גרסאות לשחזור
            {!collapsed && snapshots.length > 0 && (
              <span className="mono text-[11px] font-normal mr-3" style={{ color: 'var(--text-soft)' }}>
                {snapshots.length} גרסאות
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
          <button onClick={handleDownloadBackup} title="הורד קובץ JSON של כל הנתונים" style={btnSecondary()}>⬇ הורד גיבוי</button>
          {!collapsed && (
            <button onClick={fetchSnapshots} disabled={loading} style={btnSecondary(loading)}>
              {loading ? 'טוען...' : '↻ רענן'}
            </button>
          )}
          <button
            onClick={handleToggle}
            className="mono text-[11px] uppercase tracking-[0.14em] font-semibold px-3 py-1 rounded-full border"
            style={{ borderColor: 'var(--divider)', color: 'var(--text-soft)' }}>
            {collapsed ? 'הצג' : 'הסתר'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-6 pb-5 pt-4">
          <div className="text-[13px] mb-4" style={{ color: 'var(--text-soft)' }}>
            כל שמירה יוצרת גרסה אוטומטית (עד 50 גרסאות). גיבוי אוטומטי כל 12 שעות.
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
        </div>
      )}
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

  if (lectureCount > 0 && !msg) return null;

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
      <button onClick={() => doSeed(data, userName, onRefresh, setBusy, setMsg)} disabled={busy} style={btnPrimary(busy)}>{busy ? 'שומר לענן...' : '🌱 ייבא 23 הרצאות לענן →'}</button>
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

  if (needsPatch.length === 0 || done) return null;

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
        <button onClick={() => doPatch(false)} disabled={busy} style={btnPrimary(busy)}>{busy ? 'מעדכן...' : '📋 עדכן פרטים →'}</button>
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

  if ((existing.length > 0 || done) && !msg) return null;
  if (done && msg) return null;

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
      <button onClick={() => doSeedTrainers(false)} disabled={busy} style={btnPrimary(busy)}>{busy ? 'שומר לענן...' : `🧑‍🏫 ייבא ${KNOWN_LECTURERS.length} מנחים →`}</button>
      {msg && (
        <div className="mt-4 mono text-[12px] uppercase tracking-[0.12em]"
          style={{ color: msg.startsWith('✓') ? 'var(--accent)' : '#b91c1c' }}>
          {msg}
        </div>
      )}
    </section>
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

type SlotRow = { id: string; date: string; start_time: string; end_time: string; capacity: number; booked_count: number; course_name?: string; note?: string; booked_by?: string };
type DayConfig = { uid: string; date: string; startTime: string; endTime: string; minutesEach: number; note: string };

function newDayConfig(): DayConfig {
  const today = new Date().toISOString().slice(0, 10);
  return { uid: Math.random().toString(36).slice(2), date: today, startTime: '09:00', endTime: '13:00', minutesEach: 15, note: '' };
}

function fmtMin(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function countSlots(d: DayConfig): number {
  if (!d.date || !d.startTime || !d.endTime) return 0;
  const [sh, sm] = d.startTime.split(':').map(Number);
  const [eh, em] = d.endTime.split(':').map(Number);
  const step = Math.max(5, d.minutesEach);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return diff > 0 ? Math.floor(diff / step) : 0;
}

function SlotsSection({ data, userName, onRefresh }: PageProps) {
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [zoomSavingDate, setZoomSavingDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [days, setDays] = useState<DayConfig[]>([newDayConfig()]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ start_time: '', end_time: '', note: '' });
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [view, setView] = useState<'all' | 'booked'>('all');
  const sectionRef = useRef<HTMLDivElement>(null);

  async function load() {
    const { data: rows, error: err } = await supabase
      .from('public_interview_slots')
      .select('*')
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });
    if (err) {
      setError(/does not exist|42P01/i.test(err.message)
        ? 'טבלת מועדי הראיון לא קיימת. הרץ את supabase_slots.sql ב‑Supabase.'
        : err.message);
      return;
    }
    setSlots((rows as SlotRow[]) || []);
    setError(null);
  }

  useEffect(() => { load(); }, []);

  // Zoom link per interview DAY — stored in practicum_data.interviewZoomLinks,
  // INDEPENDENT of the slot rows (deleting slots never deletes the link). Pass an
  // empty value to remove the link for that day (its own delete).
  async function saveZoom(date: string, value: string) {
    const map: Record<string, string> = { ...(data.interviewZoomLinks || {}) };
    const v = value.trim();
    if (v) map[date] = v; else delete map[date];
    setZoomSavingDate(date);
    const res = await saveSnapshot({ ...data, interviewZoomLinks: map }, { name: userName });
    setZoomSavingDate(null);
    if (res.ok) { showToast(v ? '✓ קישור הזום נשמר ליום זה' : '✓ קישור הזום הוסר', 'success'); onRefresh?.(); }
    else showToast('שגיאה בשמירת קישור הזום', 'error');
  }

  function updateDay(uid: string, patch: Partial<DayConfig>) {
    setDays(ds => ds.map(d => d.uid === uid ? { ...d, ...patch } : d));
  }

  const totalPreview = days.reduce((s, d) => s + countSlots(d), 0);
  const validDays = days.filter(d => d.date && d.startTime && d.endTime && countSlots(d) > 0);

  async function generateAll() {
    if (validDays.length === 0) {
      showToast('הגדר לפחות יום אחד עם תאריך ושעות תקינות', 'error');
      return;
    }
    const rows: any[] = [];
    for (const d of validDays) {
      const [sh, sm] = d.startTime.split(':').map(Number);
      const step = Math.max(5, d.minutesEach);
      const endMin = d.endTime.split(':').map(Number).reduce((h, m, i) => i === 0 ? h + m * 60 : h + m, 0);
      for (let t = sh * 60 + sm; t + step <= endMin; t += step) {
        rows.push({
          date: d.date,
          start_time: fmtMin(t),
          end_time: fmtMin(t + step),
          capacity: 1,
          booked_count: 0,
          note: d.note || null,
          course_name: null,
        });
      }
    }
    // Dedup: skip slots that already exist for the same date+start_time
    const existingKeys = new Set(slots.map(s => `${s.date}|${s.start_time}`));
    const newRows = rows.filter(r => !existingKeys.has(`${r.date}|${r.start_time}`));
    if (newRows.length === 0) {
      showToast('כל המועדים שהגדרת כבר קיימים', 'error');
      return;
    }
    setSaving(true);
    for (let i = 0; i < newRows.length; i += 20) {
      const { error: err } = await supabase.from('public_interview_slots').insert(newRows.slice(i, i + 20));
      if (err) {
        setSaving(false);
        showToast('שגיאה: ' + (err.message || err.details || err.code || JSON.stringify(err)), 'error');
        return;
      }
    }
    setSaving(false);
    setPlannerOpen(false);
    setDays([newDayConfig()]);
    load();
    showToast(`✓ נוצרו ${newRows.length} מועדי ראיון`, 'success');
    setTimeout(() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  function downloadIcs() {
    function fmtDt(date: string, time: string) {
      return date.replace(/-/g, '') + 'T' + time.replace(':', '') + '00';
    }
    const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'PRODID:-//Practicum//Interview Slots//HE',
      'X-WR-CALNAME:מועדי ראיון — פרקטיקום',
      'X-WR-TIMEZONE:Asia/Jerusalem', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ];
    for (const s of slots) {
      const noteStr = s.note ? ` — ${s.note}` : '';
      const summary = s.booked_by ? `ראיון: ${s.booked_by}${noteStr}` : `ראיון פרקטיקום${noteStr}`;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:slot-${s.id}@practicum.yarivitzkovich.org`);
      lines.push(`DTSTAMP:${now}`);
      lines.push(`DTSTART;TZID=Asia/Jerusalem:${fmtDt(s.date, s.start_time)}`);
      lines.push(`DTEND;TZID=Asia/Jerusalem:${fmtDt(s.date, s.end_time)}`);
      lines.push(`SUMMARY:${summary.replace(/[\\;,\n]/g, c => '\\' + c)}`);
      lines.push(`STATUS:${s.booked_count >= s.capacity ? 'CONFIRMED' : 'TENTATIVE'}`);
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'practicum-interviews.ics';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function deleteSlot(id: string) {
    await supabase.from('public_interview_slots').delete().eq('id', id);
    load();
  }

  async function deleteAll() {
    const ids = slots.map(s => s.id);
    for (let i = 0; i < ids.length; i += 20) {
      await supabase.from('public_interview_slots').delete().in('id', ids.slice(i, i + 20));
    }
    setConfirmDeleteAll(false);
    load();
    showToast(`✓ נמחקו ${ids.length} מועדים`, 'success');
  }

  function startEdit(s: SlotRow) {
    setEditingId(s.id);
    setEditForm({ start_time: s.start_time, end_time: s.end_time, note: s.note || '' });
  }

  async function saveEdit(id: string) {
    const { error: err } = await supabase.from('public_interview_slots')
      .update({ start_time: editForm.start_time, end_time: editForm.end_time, note: editForm.note || null })
      .eq('id', id);
    if (err) { alert('שגיאה: ' + err.message); return; }
    setEditingId(null);
    load();
  }

  // Group existing slots by date for display
  const byDate: Record<string, SlotRow[]> = {};
  for (const s of slots) { (byDate[s.date] = byDate[s.date] || []).push(s); }

  return (
    <div ref={sectionRef}>
    <Section title="מועדי ראיון" count={slots.length}>
      <p className="text-[13.5px] leading-[1.55] mb-5" style={{ color: 'var(--text-soft)' }}>
        הגדר ימי ראיון — כל מועמד שמגיש טופס יבחר שעה פנויה. כל ראיון מקבל מקום אחד (קיבולת 1).
      </p>

      {/* Main action button */}
      <button
        type="button"
        onClick={() => { setPlannerOpen(v => !v); }}
        style={{ ...btnPrimary(), marginBottom: '24px' }}
      >
        📅 {plannerOpen ? 'סגור תכנון' : 'תכנן מועדי ראיון'}
      </button>

      {/* ── Multi-day planner ── */}
      {plannerOpen && (
        <div className="mb-8 rounded-2xl p-5" style={{ background: 'rgba(122,30,43,0.04)', border: '1px solid var(--accent)' }}>
          <div className="mono text-[11px] uppercase tracking-[0.18em] font-semibold mb-4" style={{ color: 'var(--accent)' }}>
            תכנון מועדי ראיון
          </div>

          <div className="space-y-3">
            {days.map((d, i) => (
              <div key={d.uid} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid var(--divider)' }}>
                {/* Row header */}
                <div className="flex items-center justify-between mb-3">
                  <span className="mono text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--text-soft)' }}>
                    יום {i + 1}
                    {countSlots(d) > 0 && (
                      <span style={{ color: 'var(--accent)', marginRight: '8px' }}>· {countSlots(d)} מועדים</span>
                    )}
                  </span>
                  {days.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDays(ds => ds.filter(x => x.uid !== d.uid))}
                      className="mono text-[11px] opacity-50 hover:opacity-100"
                      style={{ color: 'var(--accent)' }}
                    >✕ הסר</button>
                  )}
                </div>

                {/* Fields — stack on mobile, row on wider screens */}
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-2">
                  <div className="flex flex-col gap-1 sm:w-36">
                    <label className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-soft)' }}>תאריך</label>
                    <input type="date" value={d.date} dir="ltr"
                      onChange={e => updateDay(d.uid, { date: e.target.value })}
                      className="input" style={{ fontSize: '13px', padding: '8px 10px' }} />
                  </div>
                  <div className="flex gap-2 flex-1">
                    <div className="flex flex-col gap-1 flex-1 min-w-[80px]">
                      <label className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-soft)' }}>התחלה</label>
                      <input type="time" value={d.startTime} dir="ltr"
                        onChange={e => updateDay(d.uid, { startTime: e.target.value })}
                        className="input" style={{ fontSize: '13px', padding: '8px 10px' }} />
                    </div>
                    <div className="flex flex-col gap-1 flex-1 min-w-[80px]">
                      <label className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-soft)' }}>סיום</label>
                      <input type="time" value={d.endTime} dir="ltr"
                        onChange={e => updateDay(d.uid, { endTime: e.target.value })}
                        className="input" style={{ fontSize: '13px', padding: '8px 10px' }} />
                    </div>
                    <div className="flex flex-col gap-1 w-20 shrink-0">
                      <label className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-soft)' }}>דק׳ לראיון</label>
                      <input type="number" min={5} max={120} value={d.minutesEach}
                        onChange={e => updateDay(d.uid, { minutesEach: Number(e.target.value) || 15 })}
                        className="input" style={{ fontSize: '13px', padding: '8px 10px' }} />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 sm:flex-1 sm:min-w-[120px]">
                    <label className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-soft)' }}>הערה (אופציונלי)</label>
                    <input type="text" value={d.note} placeholder="למשל: זום / קמפוס"
                      onChange={e => updateDay(d.uid, { note: e.target.value })}
                      className="input" style={{ fontSize: '13px', padding: '8px 10px' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add day */}
          <button
            type="button"
            onClick={() => setDays(ds => [...ds, newDayConfig()])}
            className="mt-3 mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-4 py-2 rounded-full border w-full"
            style={{ borderColor: 'var(--divider)', color: 'var(--ink)' }}
          >
            + הוסף יום נוסף
          </button>

          {/* Summary + generate */}
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--divider)' }}>
            <div className="text-[13px] mb-3" style={{ color: 'var(--text-soft)' }}>
              {totalPreview > 0
                ? <><strong style={{ color: 'var(--ink)' }}>{totalPreview} מועדים</strong> ב‑{validDays.length} ימים</>
                : 'הגדר תאריך ושעות כדי לראות תצוגה מקדימה'}
            </div>
            <button
              type="button"
              onClick={generateAll}
              disabled={saving}
              style={{
                display: 'block',
                width: '100%',
                padding: '12px 20px',
                fontSize: '14px',
                fontWeight: 600,
                background: saving ? 'var(--divider)' : 'var(--accent)',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'יוצר...' : totalPreview > 0 ? `צור ${totalPreview} מועדים ←` : 'צור מועדים ←'}
            </button>
            <button
              type="button"
              onClick={() => { setPlannerOpen(false); setDays([newDayConfig()]); }}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px',
                marginTop: '8px',
                fontSize: '12px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-soft)',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >בטל</button>
          </div>
        </div>
      )}

      {/* ── Existing slots ── */}
      {error ? (
        <div className="py-4 text-[14px]" style={{ color: 'var(--accent)' }}>⚠ {error}</div>
      ) : slots.length === 0 ? (
        <div className="py-6 text-[14px]" style={{ color: 'var(--text-soft)' }}>
          אין מועדי ראיון מוגדרים. מועמדים שמגישים כרגע לא רואים אפשרות בחירת מועד.
        </div>
      ) : (
        <>
          {/* View tabs */}
          <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: 'rgba(0,0,0,0.05)', display: 'inline-flex' }}>
            {(['all', 'booked'] as const).map(v => (
              <button key={v} type="button" onClick={() => setView(v)} style={btnTab(view === v)}>
                {v === 'all' ? `כל המועדים (${slots.length})` : `נקבעו (${slots.filter(s => s.booked_count > 0).length})`}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-3">
              <span className="mono text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-soft)' }}>
                {view === 'all' ? `${slots.length} מועדים מוגדרים` : `${slots.filter(s => s.booked_count > 0).length} פגישות קבועות`}
              </span>
              <button type="button" onClick={downloadIcs}
                style={btnGhost()}>
                📥 רענן לוח שנה
              </button>
              <button type="button" onClick={() => {
                const booked = slots.filter(s => s.booked_count > 0);
                const rows = (view === 'booked' ? booked : slots).map(s =>
                  `<tr><td>${s.date}</td><td dir="ltr">${s.start_time}–${s.end_time}</td><td>${s.booked_by || '—'}</td><td>${s.note || ''}</td></tr>`
                ).join('');
                const title = view === 'booked' ? 'פגישות קבועות — מועדי ראיון' : 'כל מועדי הראיון';
                const html = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:Arial,sans-serif;direction:rtl;margin:1.5cm;color:#1a1a1a}
h1{font-size:16pt;margin-bottom:4pt}
.sub{font-size:10pt;color:#888;margin-bottom:16pt}
table{width:100%;border-collapse:collapse;font-size:11pt}
th,td{border:0.5pt solid #ccc;padding:6pt 8pt;text-align:right}
th{background:#f5f0f0;font-weight:bold}
@media print{@page{size:A4;margin:1.2cm}}</style></head>
<body><h1>${title}</h1><div class="sub">פרקטיקום · אוניברסיטת אריאל · ${new Date().toLocaleDateString('he-IL')}</div>
<table><thead><tr><th>תאריך</th><th>שעה</th><th>שם המועמד/ת</th><th>הערה</th></tr></thead><tbody>${rows}</tbody></table>
<script>setTimeout(()=>window.print(),400)<\/script></body></html>`;
                const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener';
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 10000);
              }}
                style={btnGhost()}>
                🖨 הדפס רשימה
              </button>
            </span>
            {confirmDeleteAll ? (
              <span className="flex items-center gap-2">
                <button onClick={deleteAll} style={btnDanger()}>
                  אשר מחיקה
                </button>
                <button onClick={() => setConfirmDeleteAll(false)} className="mono text-[11px] uppercase tracking-[0.14em] opacity-60 hover:opacity-100" style={{ color: 'var(--ink)' }}>
                  ביטול
                </button>
              </span>
            ) : (
              <button onClick={() => setConfirmDeleteAll(true)} style={btnDanger()}>
                🗑 מחק הכל
              </button>
            )}
          </div>
          {view === 'booked' ? (
            <div className="space-y-2">
              {slots.filter(s => s.booked_count > 0).length === 0 ? (
                <div className="py-4 text-[14px]" style={{ color: 'var(--text-soft)' }}>עדיין לא נקבעו פגישות.</div>
              ) : slots.filter(s => s.booked_count > 0).map(s => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid var(--accent)' }}>
                  <span className="mono text-[13px] font-semibold" dir="ltr" style={{ color: 'var(--accent)', minWidth: '120px' }}>
                    {s.date} {s.start_time}–{s.end_time}
                  </span>
                  <span className="text-[14px] font-semibold flex-1" style={{ color: 'var(--ink)' }}>
                    {s.booked_by || '—'}
                  </span>
                  {s.note && <span className="text-[12px]" style={{ color: 'var(--text-soft)' }}>{s.note}</span>}
                </div>
              ))}
            </div>
          ) : Object.entries(byDate).map(([date, daySlots]) => (
            <div key={date} className="mb-4">
              <div className="mono text-[11px] uppercase tracking-[0.14em] font-semibold py-2 mb-1"
                style={{ color: 'var(--text-soft)', borderBottom: '1px solid var(--divider)' }}>
                {new Date(date).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}
                <span className="mr-2 opacity-60">· {daySlots.length} מועדים</span>
              </div>
              {/* Zoom link for this interview DAY — independent of the slots (deleting
                  slots won't delete it); the same link goes to every candidate
                  interviewing this day in their submission-confirmation email. */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[13px]" title="קישור זום ליום זה">🔗</span>
                <input
                  type="url"
                  dir="ltr"
                  data-zoom-date={date}
                  key={date + '|' + (data.interviewZoomLinks?.[date] || '')}
                  defaultValue={data.interviewZoomLinks?.[date] || ''}
                  placeholder="קישור זום ליום זה (אופציונלי) — כל המועמדים שמתראיינים ביום זה יקבלו אותו"
                  onBlur={e => { const v = e.target.value.trim(); if (v !== (data.interviewZoomLinks?.[date] || '')) saveZoom(date, v); }}
                  className="input flex-1 min-w-[180px]"
                  style={{ fontSize: '12.5px', padding: '6px 10px', textAlign: 'left' }}
                />
                {zoomSavingDate === date && <span className="mono text-[10px] shrink-0" style={{ color: 'var(--text-soft)' }}>שומר…</span>}
                {data.interviewZoomLinks?.[date] && (
                  <button type="button" onClick={() => saveZoom(date, '')} title="מחק את קישור הזום ליום זה (לא מוחק את המועדים)"
                    className="mono text-[11px] px-2 py-1 rounded-md border shrink-0" style={{ borderColor: 'var(--divider)', color: '#b03030' }}>✕ מחק קישור</button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {daySlots.map(s => {
                  const full = s.booked_count >= s.capacity;
                  if (editingId === s.id) {
                    return (
                      <div key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl w-full"
                        style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid var(--accent)' }}>
                        <input type="time" value={editForm.start_time} dir="ltr"
                          onChange={e => setEditForm(f => ({ ...f, start_time: e.target.value }))}
                          className="input" style={{ fontSize: '13px', padding: '5px 8px', width: '100px' }} />
                        <span className="mono text-[12px]" style={{ color: 'var(--text-soft)' }}>–</span>
                        <input type="time" value={editForm.end_time} dir="ltr"
                          onChange={e => setEditForm(f => ({ ...f, end_time: e.target.value }))}
                          className="input" style={{ fontSize: '13px', padding: '5px 8px', width: '100px' }} />
                        <input type="text" value={editForm.note} placeholder="הערה"
                          onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))}
                          className="input flex-1 min-w-[80px]" style={{ fontSize: '13px', padding: '5px 8px' }} />
                        <button onClick={() => saveEdit(s.id)} style={{
                          display: 'inline-block', padding: '5px 12px', fontSize: '12px', fontWeight: 600,
                          background: 'var(--accent)', color: 'white', border: 'none',
                          borderRadius: '8px', cursor: 'pointer', whiteSpace: 'nowrap',
                        }}>שמור</button>
                        <button onClick={() => setEditingId(null)} className="mono text-[11px] opacity-60 hover:opacity-100" style={{ color: 'var(--ink)' }}>בטל</button>
                      </div>
                    );
                  }
                  return (
                    <div key={s.id}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full"
                      style={{
                        background: full ? 'var(--accent)' : 'rgba(122,30,43,0.07)',
                        border: '1px solid',
                        borderColor: full ? 'var(--accent)' : 'var(--divider)',
                      }}>
                      <span className="mono text-[12px] tracking-[0.06em]" dir="ltr"
                        style={{ color: full ? 'var(--bg)' : 'var(--ink)' }}>
                        {s.start_time}–{s.end_time}
                      </span>
                      {s.note && (
                        <span className="text-[11px]" style={{ color: full ? 'rgba(255,255,255,0.7)' : 'var(--text-soft)' }}>
                          · {s.note}
                        </span>
                      )}
                      {s.booked_count > 0 && (
                        <span className="mono text-[9px] uppercase tracking-[0.1em]"
                          style={{ color: full ? 'rgba(255,255,255,0.8)' : 'var(--accent)' }}>
                          {s.booked_count}/{s.capacity}
                        </span>
                      )}
                      {!full && (
                        <button onClick={() => startEdit(s)}
                          className="opacity-40 hover:opacity-100 text-[11px] leading-none"
                          style={{ color: 'var(--ink)' }}>✎</button>
                      )}
                      <button onClick={() => deleteSlot(s.id)}
                        className="opacity-40 hover:opacity-100 text-[11px] leading-none"
                        style={{ color: full ? 'var(--bg)' : 'var(--accent)' }}>✕</button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </Section>
    </div>
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
  const [form, setForm] = useState({
    name: '', year: years[0] || 'תשפ״ו', institution: institutions[0] || 'אוניברסיטת אריאל',
    autoSendAcceptance: true, autoSendRejection: false,
    type: 'other' as 'practicum' | 'other', preferenceCount: 3, reviewAgingThresholdDays: 14, acceptanceNote: '', workshopDate: '',
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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
      autoSendAcceptance: form.autoSendAcceptance,
      autoSendRejection: form.autoSendRejection,
      type: form.type,
      preferenceCount: form.type === 'practicum' ? form.preferenceCount : undefined,
      reviewAgingThresholdDays: form.type === 'practicum' ? form.reviewAgingThresholdDays : undefined,
      acceptanceNote: form.type === 'practicum' ? form.acceptanceNote : undefined,
      workshopDate: form.type === 'practicum' ? form.workshopDate : undefined,
    };
    // Duplicate check
    const dup = courses.find(c => c.name === newCourse.name && normalizeYear(c.year || '') === newCourse.year);
    if (dup) { alert('קורס באותו שם ושנה כבר קיים'); return; }
    const ok = await saveCourse([...courses, newCourse], 'נוסף', newCourse.name);
    if (ok) {
      setForm({ name: '', year: years[0] || 'תשפ״ו', institution: institutions[0] || 'אוניברסיטת אריאל', autoSendAcceptance: true, autoSendRejection: false, type: 'other', preferenceCount: 3, reviewAgingThresholdDays: 14, acceptanceNote: '', workshopDate: '' });
      setAdding(false);
    }
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
          <li key={c.id} className="py-3 border-b" style={{ borderColor: 'var(--divider)' }}>
            {editing === c.id ? (
              <div className="flex items-baseline gap-4">
                <CourseEditInline
                  course={c}
                  years={years}
                  institutions={institutions}
                  onSave={async (patch) => { await updateCourse(c.id, patch); setEditing(null); }}
                  onCancel={() => setEditing(null)}
                />
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-4">
                  <div className="flex-1">
                    <div className="serif text-[19px]" style={{ color: 'var(--ink)' }}>{c.name}</div>
                    <div className="mono text-[11px] uppercase tracking-[0.14em] mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: 'var(--text-soft)' }}>
                      <span>{c.year ? normalizeYear(c.year) : 'ללא שנה'} · {c.institution || 'ללא מוסד'}</span>
                      {c.type === 'practicum' && (
                        <span style={{ color: 'var(--accent)' }}>🎯 פרקטיקום · {(c as any).preferenceCount ?? 3} העדפות</span>
                      )}
                      {(c.autoSendAcceptance !== false) && (
                        <span style={{ color: 'var(--accent)' }}>✉ קבלה-אוטו</span>
                      )}
                      {c.autoSendRejection && (
                        <span style={{ color: 'var(--accent)', opacity: 0.7 }}>✉ דחייה-אוטו</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setEditing(c.id)}
                    className="w-7 h-7 rounded-full grid place-items-center hover:bg-[rgba(122,30,43,0.08)]"
                    style={{ color: 'var(--ink)' }}
                    title="ערוך קורס">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button onClick={() => deleteCourse(c)}
                    className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold opacity-70 hover:opacity-100"
                    style={{ color: 'var(--accent)' }}>
                    🗑
                  </button>
                </div>
                {/* Institution linker — all courses */}
                <InstitutionLinkerSection
                  course={c}
                  allInstitutions={institutions}
                  onUpdate={(patch) => updateCourse(c.id, patch)}
                />
                {/* Employer attach section — practicum courses only */}
                {c.type === 'practicum' && (
                  <EmployerAttachSection
                    course={c}
                    data={data}
                    userName={userName}
                    onRefresh={onRefresh}
                  />
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      <button
        onClick={() => { setAdding(true); setTimeout(() => newCourseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}
        style={{ ...btnSecondary(), display: adding ? 'none' : 'inline-block', marginTop: '20px' }}>+ הוסף קורס</button>

      {adding && (
        <div ref={newCourseRef} className="mt-5 rounded-xl p-5" style={{ background: 'rgba(122,30,43,0.05)', border: '1px solid var(--accent)' }}>
          <div className="chapter-mark mb-3" style={{ fontSize: '11px' }}>קורס חדש</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <LabelledInput label="שם קורס" value={form.name} onChange={v => setForm({ ...form, name: v })} placeholder="למשל: פרקטיקום משאבי אנוש" />
            <LabelledInputList label="שנה" value={form.year} onChange={v => setForm({ ...form, year: v })}
              options={years} listId="new-course-years" placeholder="למשל: תשפ״ז" />
            <LabelledInputList label="מוסד" value={form.institution} onChange={v => setForm({ ...form, institution: v })}
              options={institutions} listId="new-course-inst" placeholder="שם המוסד" />
          </div>
          {/* Course type */}
          <div className="flex items-center gap-4 mb-4">
            <span className="mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-soft)' }}>סוג:</span>
            {(['practicum', 'other'] as const).map(t => (
              <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="new-course-type" value={t} checked={form.type === t}
                  onChange={() => setForm({ ...form, type: t })}
                  style={{ accentColor: 'var(--accent)' }} />
                <span className="mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink)' }}>
                  {t === 'practicum' ? 'פרקטיקום' : 'אחר'}
                </span>
              </label>
            ))}
          </div>
          {/* Practicum-only fields */}
          {form.type === 'practicum' && (
            <div className="space-y-2 p-3 mb-4 rounded-lg" style={{ background: 'rgba(122,30,43,0.04)', border: '1px solid var(--divider)' }}>
              <div className="flex flex-wrap gap-3">
                <label className="block">
                  <span className="mono text-[10px] uppercase tracking-[0.12em] block mb-1" style={{ color: 'var(--text-soft)' }}>מספר העדפות (1-10)</span>
                  <input type="number" min={1} max={10} value={form.preferenceCount}
                    onChange={e => setForm({ ...form, preferenceCount: Number(e.target.value) || 3 })}
                    className="input" style={{ padding: '5px 10px', fontSize: '13px', width: 70 }} />
                </label>
                <label className="block">
                  <span className="mono text-[10px] uppercase tracking-[0.12em] block mb-1" style={{ color: 'var(--text-soft)' }}>סף המתנה (ימים)</span>
                  <input type="number" min={1} value={form.reviewAgingThresholdDays}
                    onChange={e => setForm({ ...form, reviewAgingThresholdDays: Number(e.target.value) || 14 })}
                    className="input" style={{ padding: '5px 10px', fontSize: '13px', width: 70 }} />
                </label>
              </div>
              <label className="block">
                <span className="mono text-[10px] uppercase tracking-[0.12em] block mb-1" style={{ color: 'var(--text-soft)' }}>הערת קבלה לסטודנט</span>
                <textarea value={form.acceptanceNote}
                  onChange={e => setForm({ ...form, acceptanceNote: e.target.value })}
                  rows={2} className="input w-full" style={{ padding: '6px 10px', fontSize: '13px', resize: 'vertical' }} />
              </label>
            </div>
          )}
          {/* Email automation toggles */}
          <div className="flex flex-wrap gap-5 mb-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.autoSendAcceptance}
                onChange={e => setForm({ ...form, autoSendAcceptance: e.target.checked })}
                style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
              <span className="mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink)' }}>שלח אישור קבלה אוטומטית</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.autoSendRejection}
                onChange={e => setForm({ ...form, autoSendRejection: e.target.checked })}
                style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
              <span className="mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink)' }}>שלח הודעת דחייה אוטומטית</span>
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={addCourse} disabled={saving} style={btnPrimary(saving)}>{saving ? 'שומר...' : 'הוסף →'}</button>
            <button onClick={() => { setAdding(false); setForm({ name: '', year: years[0] || 'תשפ״ו', institution: institutions[0] || 'אוניברסיטת אריאל', autoSendAcceptance: true, autoSendRejection: false, type: 'other', preferenceCount: 3, reviewAgingThresholdDays: 14, acceptanceNote: '' }); }}
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

/* ====== Employer Attach Section ====== */

function EmployerAttachSection({ course, data, userName, onRefresh }: {
  course: Course;
  data: any;
  userName: string;
  onRefresh: () => void;
}) {
  const allEmployers: Employer[] = data.employers || [];
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [showNewEmployer, setShowNewEmployer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingPositions, setEditingPositions] = useState<string | null>(null);
  const [editPositionsValue, setEditPositionsValue] = useState(0);

  // Employers attached to this course
  const attached = allEmployers.filter(e => {
    const cids: string[] = (e as any).courseIds || ((e as any).courseId ? [(e as any).courseId] : []);
    return cids.includes(course.id);
  });

  // Employers NOT attached (for the "pick from pool" modal)
  const unattached = allEmployers.filter(e => {
    const cids: string[] = (e as any).courseIds || ((e as any).courseId ? [(e as any).courseId] : []);
    return !cids.includes(course.id);
  });

  // Vacancy summary across all attached employers
  const summary = attached.reduce(
    (acc, emp) => {
      const counts = countSlotsByStatus(emp as any, course.id);
      acc.total += counts.total;
      acc.available += counts.available;
      acc.tentative += counts.tentative;
      acc.under_review += counts.under_review;
      acc.placed += counts.placed;
      return acc;
    },
    { total: 0, available: 0, tentative: 0, under_review: 0, placed: 0 }
  );

  async function attachEmployer(emp: Employer) {
    setSaving(true);
    const updatedEmp = { ...emp, courseIds: [...((emp as any).courseIds || []), course.id] };
    const nextEmployers = allEmployers.map(e => e.id === emp.id ? updatedEmp : e);
    const res = await saveSnapshot({ ...data, employers: nextEmployers }, { name: userName },
      { action: 'שויך לקורס', entity: 'מעסיק', target: emp.name });
    setSaving(false);
    if (res.ok) { onRefresh(); showToast(`✓ ${emp.name} שויך לקורס`, 'success'); }
    else showToast('שגיאה: ' + (res.error || ''), 'error');
  }

  async function detachEmployer(emp: Employer) {
    // R15: block if tentative/under_review/placed > 0 for this course
    const counts = countSlotsByStatus(emp as any, course.id);
    if (counts.tentative + counts.under_review + counts.placed > 0) {
      showToast(`לא ניתן להסיר — יש מועמדויות פתוחות/שיבוצים (${counts.tentative} ממתינים, ${counts.under_review} בבדיקה, ${counts.placed} שובצו)`, 'error');
      return;
    }
    if (!confirm(`להסיר את "${emp.name}" מהקורס "${course.name}"?`)) return;
    setSaving(true);
    const newCourseIds = ((emp as any).courseIds || []).filter((id: string) => id !== course.id);
    const updatedEmp = { ...emp, courseIds: newCourseIds };
    const nextEmployers = allEmployers.map(e => e.id === emp.id ? updatedEmp : e);
    const res = await saveSnapshot({ ...data, employers: nextEmployers }, { name: userName },
      { action: 'הוסר מקורס', entity: 'מעסיק', target: emp.name });
    setSaving(false);
    if (res.ok) { onRefresh(); showToast(`✓ ${emp.name} הוסר מהקורס`, 'success'); }
    else showToast('שגיאה: ' + (res.error || ''), 'error');
  }

  async function savePositionsTotal(emp: Employer, newTotal: number) {
    const counts = countSlotsByStatus(emp as any, course.id);
    const occupied = counts.tentative + counts.under_review + counts.placed;
    // R14: block if decreasing below occupied
    if (newTotal < occupied) {
      showToast(`לא ניתן להפחית — ${occupied} מקומות תפוסים (${counts.tentative} ממתינים, ${counts.under_review} בבדיקה, ${counts.placed} שובצו)`, 'error');
      return;
    }
    setSaving(true);
    const existingSlots: any[] = (emp as any).vacancySlots || [];
    const courseSlots = existingSlots.filter((s: any) => s.courseId === course.id);
    const otherSlots = existingSlots.filter((s: any) => s.courseId !== course.id);
    const now = new Date().toISOString();

    // Resize slots array
    let newCourseSlots = [...courseSlots];
    if (newTotal > courseSlots.length) {
      // Add new available slots
      for (let i = courseSlots.length; i < newTotal; i++) {
        newCourseSlots.push({
          id: `${emp.id}-${course.id}-s${i + 1}`,
          courseId: course.id,
          status: 'available',
          studentId: null,
          prefRank: null,
          history: [{ at: now, from: null, to: 'available', by: 'admin', actorId: userName }],
        });
      }
    } else if (newTotal < courseSlots.length) {
      // Remove available slots from the end
      newCourseSlots = courseSlots.slice(0, newTotal);
    }

    const updatedEmp = { ...emp, positionsTotal: newTotal, vacancySlots: [...otherSlots, ...newCourseSlots] };
    const nextEmployers = allEmployers.map(e => e.id === emp.id ? updatedEmp : e);
    const res = await saveSnapshot({ ...data, employers: nextEmployers }, { name: userName },
      { action: 'עודכן מספר מקומות', entity: 'מעסיק', target: emp.name });
    setSaving(false);
    setEditingPositions(null);
    if (res.ok) { onRefresh(); showToast(`✓ עודכן ל-${newTotal} מקומות`, 'success'); }
    else showToast('שגיאה: ' + (res.error || ''), 'error');
  }

  async function handleNewEmployerSave(emp: Employer) {
    setSaving(true);
    const newEmp = {
      ...emp,
      courseIds: [...((emp as any).courseIds || []), course.id],
      addedBy: 'admin',
      approvalStatus: 'approved',
      restrictedToStudentId: null,
      positionsTotal: emp.positions || 1,
    };
    // Build vacancy slots
    const now = new Date().toISOString();
    (newEmp as any).vacancySlots = Array.from({ length: newEmp.positionsTotal }, (_, i) => ({
      id: `${newEmp.id}-s${i + 1}`,
      courseId: course.id,
      status: 'available',
      studentId: null,
      prefRank: null,
      history: [{ at: now, from: null, to: 'available', by: 'admin', actorId: userName }],
    }));
    const nextEmployers = [...allEmployers, newEmp];
    const res = await saveSnapshot({ ...data, employers: nextEmployers }, { name: userName },
      { action: 'נוסף', entity: 'מעסיק', target: newEmp.name });
    setSaving(false);
    setShowNewEmployer(false);
    if (res.ok) { onRefresh(); showToast(`✓ ${newEmp.name} נוסף ושויך לקורס`, 'success'); }
    else showToast('שגיאה: ' + (res.error || ''), 'error');
  }

  const courses = data.courses || [];

  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px dashed var(--divider)' }}>
      <div className="mono text-[11px] uppercase tracking-[0.14em] mb-2 font-semibold" style={{ color: 'var(--text-soft)' }}>
        מעסיקים מוצמדים לקורס
      </div>

      {/* Vacancy summary chips */}
      {attached.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {[
            { label: `סה"כ: ${summary.total}`, color: 'var(--ink)' },
            { label: `פנויים: ${summary.available}`, color: '#059669' },
            { label: `ממתינים: ${summary.tentative}`, color: '#d97706' },
            { label: `בבדיקה: ${summary.under_review}`, color: '#2563eb' },
            { label: `שובצו: ${summary.placed}`, color: 'var(--accent)' },
          ].map(chip => (
            <span key={chip.label}
              className="mono text-[10.5px] px-2.5 py-0.5 rounded-full"
              style={{ border: `1px solid ${chip.color}30`, color: chip.color, background: `${chip.color}10` }}>
              {chip.label}
            </span>
          ))}
        </div>
      )}

      {attached.length === 0 && (
        <div className="text-[13px] mb-3" style={{ color: 'var(--text-soft)' }}>
          אין מעסיקים מוצמדים לקורס זה.
        </div>
      )}

      {/* Attached employer rows */}
      {attached.map(emp => {
        const counts = countSlotsByStatus(emp as any, course.id);
        const isPending = (emp as any).approvalStatus === 'pending';
        return (
          <div key={emp.id}
            className="flex flex-wrap items-center gap-3 py-2 px-3 mb-1 rounded-lg"
            style={{
              background: isPending ? 'rgba(217,119,6,0.07)' : 'rgba(0,0,0,0.03)',
              border: isPending ? '1px solid rgba(217,119,6,0.4)' : '1px solid var(--divider)',
            }}>
            <div className="flex-1 min-w-0">
              <span className="text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>{emp.name}</span>
              {isPending && (
                <span className="mono text-[10px] mr-2 px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(217,119,6,0.15)', color: '#b45309' }}>ממתין לאישור</span>
              )}
              <span className="mono text-[11px] mr-2" style={{ color: 'var(--text-soft)' }}>
                {counts.available}פ · {counts.tentative}מ · {counts.under_review}ב · {counts.placed}ש
              </span>
            </div>
            {editingPositions === emp.id ? (
              <div className="flex items-center gap-2">
                <input type="number" min={0} value={editPositionsValue}
                  onChange={e => setEditPositionsValue(Number(e.target.value) || 0)}
                  className="input" style={{ width: 60, padding: '4px 8px', fontSize: '13px' }} />
                <button onClick={() => savePositionsTotal(emp, editPositionsValue)} disabled={saving}
                  style={{ ...btnSmall(saving), fontSize: '11px' }}>שמור</button>
                <button onClick={() => setEditingPositions(null)}
                  className="mono text-[11px] opacity-60 hover:opacity-100">בטל</button>
              </div>
            ) : (
              <button onClick={() => { setEditingPositions(emp.id); setEditPositionsValue((emp as any).positionsTotal || 0); }}
                style={btnSmall()}>ערוך מקומות ({(emp as any).positionsTotal ?? counts.total})</button>
            )}
            <button onClick={() => detachEmployer(emp)} disabled={saving}
              className="mono text-[11px] uppercase tracking-[0.12em] font-semibold opacity-70 hover:opacity-100"
              style={{ color: 'var(--accent)' }}>הסר מקורס</button>
          </div>
        );
      })}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={() => setShowAttachModal(true)} style={btnSecondary()}>
          ➕ בחר מעסיק מהמאגר
        </button>
        <button onClick={() => setShowNewEmployer(true)} style={btnSecondary()}>
          ➕ הוסף מעסיק חדש
        </button>
      </div>

      {/* Pick from pool modal */}
      {showAttachModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl border p-6 max-w-[520px] w-full mx-4 max-h-[80vh] overflow-y-auto"
            style={{ background: 'var(--bg)', borderColor: 'var(--divider)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div className="flex items-baseline justify-between mb-4">
              <div className="serif text-[22px]" style={{ color: 'var(--ink)' }}>בחר מעסיק מהמאגר</div>
              <button onClick={() => setShowAttachModal(false)} className="mono text-[11px] opacity-60 hover:opacity-100">✕</button>
            </div>
            {unattached.length === 0 ? (
              <div className="text-[14px]" style={{ color: 'var(--text-soft)' }}>כל המעסיקים כבר מוצמדים לקורס זה.</div>
            ) : (
              <ul>
                {unattached.map(emp => (
                  <li key={emp.id} className="flex items-center justify-between gap-3 py-2 border-b" style={{ borderColor: 'var(--divider)' }}>
                    <div>
                      <div className="text-[14px] font-medium" style={{ color: 'var(--ink)' }}>{emp.name}</div>
                      {emp.location && <div className="mono text-[11px]" style={{ color: 'var(--text-soft)' }}>{emp.location}</div>}
                    </div>
                    <button onClick={async () => { await attachEmployer(emp); setShowAttachModal(false); }} disabled={saving}
                      style={btnSmall(saving)}>צרף →</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* New employer modal */}
      {showNewEmployer && (
        <EmployerEditor
          employer={null}
          courses={courses}
          years={[]}
          defaultCourseId={course.id}
          onSave={handleNewEmployerSave}
          onClose={() => setShowNewEmployer(false)}
        />
      )}
    </div>
  );
}

/* ====== Institution Linker Section ====== */

function InstitutionLinkerSection({ course, allInstitutions, onUpdate }: {
  course: Course;
  allInstitutions: string[];
  onUpdate: (patch: Partial<Course>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const linked: string[] = (course as any).linkedInstitutions || [];
  const listId = `inst-link-dl-${course.id}`;

  function addInstitution() {
    const v = inputVal.trim();
    if (!v) return;
    if (linked.includes(v)) { setInputVal(''); return; }
    onUpdate({ linkedInstitutions: [...linked, v] });
    setInputVal('');
  }

  function removeInstitution(name: string) {
    onUpdate({ linkedInstitutions: linked.filter(i => i !== name) });
  }

  return (
    <div className="mt-2" style={{ borderTop: '1px dashed var(--divider)', paddingTop: '8px' }}>
      {/* Toggle button */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0',
          display: 'flex', alignItems: 'center', gap: '5px',
        }}>
        <span style={{ fontSize: '12px', color: 'var(--text-soft)', transition: 'transform 0.15s', display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'none' }}>▶</span>
        <span className="mono text-[10.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--text-soft)' }}>
          🏫 מוסדות{linked.length > 0 ? ` (${linked.length})` : ' — הוסף'}
        </span>
        {linked.length > 0 && !expanded && (
          <span className="text-[11px]" style={{ color: 'var(--text-soft)', opacity: 0.7 }}>
            {linked.slice(0, 3).join(' · ')}{linked.length > 3 ? ` +${linked.length - 3}` : ''}
          </span>
        )}
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="mt-2 p-3 rounded-lg" style={{ background: 'rgba(122,30,43,0.03)', border: '1px solid var(--divider)' }}>
          {/* Existing chips */}
          {linked.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
              {linked.map(inst => (
                <span key={inst}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    padding: '3px 10px', borderRadius: '999px', fontSize: '12px',
                    background: 'rgba(122,30,43,0.07)', border: '1px solid rgba(122,30,43,0.2)',
                    color: 'var(--ink)',
                  }}>
                  {inst}
                  <button
                    onClick={() => removeInstitution(inst)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'var(--accent)', opacity: 0.6, fontSize: '12px' }}
                    title="הסר">✕</button>
                </span>
              ))}
            </div>
          ) : (
            <div className="text-[12px] mb-2" style={{ color: 'var(--text-soft)' }}>אין מוסדות מקושרים לקורס זה.</div>
          )}

          {/* Add input */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              type="text"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              list={listId}
              placeholder="הוסף מוסד..."
              className="input"
              style={{ padding: '5px 10px', fontSize: '12px', flex: 1, maxWidth: '260px' }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addInstitution(); } }}
            />
            <datalist id={listId}>
              {allInstitutions.filter(i => !linked.includes(i)).map(i => <option key={i} value={i} />)}
            </datalist>
            <button onClick={addInstitution} style={{ padding: '5px 12px', fontSize: '12px', borderRadius: '999px', background: 'var(--accent)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
              + הוסף
            </button>
          </div>
        </div>
      )}
    </div>
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
    autoSendAcceptance: course.autoSendAcceptance ?? true,
    autoSendRejection: course.autoSendRejection ?? false,
    type: (course as any).type || 'other',
    preferenceCount: (course as any).preferenceCount ?? 3,
    reviewAgingThresholdDays: (course as any).reviewAgingThresholdDays ?? 14,
    acceptanceNote: (course as any).acceptanceNote || '',
    workshopDate: (course as any).workshopDate || '',
  });
  return (
    <div className="flex-1 space-y-3">
      <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
        className="input w-full" style={{ padding: '7px 12px', fontSize: '14px' }} />
      <div className="flex flex-wrap items-center gap-2">
        <input value={form.year} onChange={e => setForm({ ...form, year: e.target.value })}
          list={yearListId} placeholder="שנה"
          className="input" style={{ padding: '6px 12px', fontSize: '13px', width: 110 }} />
        <datalist id={yearListId}>
          {years.map(y => <option key={y} value={normalizeYear(y)} />)}
        </datalist>
        <input value={form.institution} onChange={e => setForm({ ...form, institution: e.target.value })}
          list={instListId} placeholder="מוסד"
          className="input" style={{ padding: '6px 12px', fontSize: '13px', width: 180 }} />
        <datalist id={instListId}>
          {institutions.map(i => <option key={i} value={i} />)}
        </datalist>
      </div>
      {/* Course type */}
      <div className="flex items-center gap-4">
        <span className="mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--text-soft)' }}>סוג:</span>
        {(['practicum', 'other'] as const).map(t => (
          <label key={t} className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name={`type-${course.id}`} value={t} checked={form.type === t}
              onChange={() => setForm({ ...form, type: t })}
              style={{ accentColor: 'var(--accent)' }} />
            <span className="mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink)' }}>
              {t === 'practicum' ? 'פרקטיקום' : 'אחר'}
            </span>
          </label>
        ))}
      </div>
      {/* Practicum-only fields */}
      {form.type === 'practicum' && (
        <div className="space-y-2 p-3 rounded-lg" style={{ background: 'rgba(122,30,43,0.04)', border: '1px solid var(--divider)' }}>
          <div className="flex flex-wrap gap-3">
            <label className="block">
              <span className="mono text-[10px] uppercase tracking-[0.12em] block mb-1" style={{ color: 'var(--text-soft)' }}>מספר העדפות</span>
              <input type="number" min={1} max={10} value={form.preferenceCount}
                onChange={e => setForm({ ...form, preferenceCount: Number(e.target.value) || 3 })}
                className="input" style={{ padding: '5px 10px', fontSize: '13px', width: 70 }} />
            </label>
            <label className="block">
              <span className="mono text-[10px] uppercase tracking-[0.12em] block mb-1" style={{ color: 'var(--text-soft)' }}>סף המתנה (ימים)</span>
              <input type="number" min={1} value={form.reviewAgingThresholdDays}
                onChange={e => setForm({ ...form, reviewAgingThresholdDays: Number(e.target.value) || 14 })}
                className="input" style={{ padding: '5px 10px', fontSize: '13px', width: 70 }} />
            </label>
          </div>
          <label className="block">
            <span className="mono text-[10px] uppercase tracking-[0.12em] block mb-1" style={{ color: 'var(--text-soft)' }}>הערת קבלה לסטודנט</span>
            <textarea value={form.acceptanceNote}
              onChange={e => setForm({ ...form, acceptanceNote: e.target.value })}
              rows={2} className="input w-full" style={{ padding: '6px 10px', fontSize: '13px', resize: 'vertical' }} />
          </label>
          <label className="block">
            <span className="mono text-[10px] uppercase tracking-[0.12em] block mb-1" style={{ color: 'var(--text-soft)' }}>
              תאריך סדנת הכנה לפרקטיקום
              <span style={{ color: 'var(--accent)', marginInlineStart: 4 }}>← מוזן אוטומטית בהודעת הקבלה</span>
            </span>
            <input
              type="text"
              value={form.workshopDate}
              onChange={e => setForm({ ...form, workshopDate: e.target.value })}
              placeholder="לדוגמה: 15.07.2026"
              className="input"
              style={{ padding: '5px 10px', fontSize: '13px', width: 160 }}
            />
          </label>
        </div>
      )}
      {/* Email automation toggles */}
      <div className="flex flex-wrap gap-4 pt-1">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={form.autoSendAcceptance}
            onChange={e => setForm({ ...form, autoSendAcceptance: e.target.checked })}
            style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
          <span className="mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink)' }}>
            שלח אישור קבלה אוטומטית
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={form.autoSendRejection}
            onChange={e => setForm({ ...form, autoSendRejection: e.target.checked })}
            style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
          <span className="mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink)' }}>
            שלח הודעת דחייה אוטומטית
          </span>
        </label>
      </div>
      <div className="flex gap-2">
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
        <button onClick={addYear} disabled={saving || !newYear.trim()} style={btnPrimary(saving || !newYear.trim())}>+ הוסף שנה</button>
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
        <button onClick={addInst} disabled={saving || !newInst.trim()} style={btnPrimary(saving || !newInst.trim())}>+ הוסף מוסד</button>
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

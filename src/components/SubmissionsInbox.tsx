import { useEffect, useState } from 'react';
import { btnPrimary, btnSecondary } from '../lib/design';
import { supabase } from '../lib/supabase';
import JSZip from 'jszip';

type Questionnaire = {
  studyTracks?: string;
  gpa?: string;
  workHistory?: string;
  favRole?: string;
  leastFavRole?: string;
  whyPracticum?: string;
  whySuitable?: string;
  persistence?: string;
  expectations?: string;
};

const Q_LABELS: { key: keyof Questionnaire; label: string }[] = [
  { key: 'studyTracks',   label: 'חוגי לימוד' },
  { key: 'gpa',           label: 'ממוצע ציונים א׳+ב׳' },
  { key: 'workHistory',   label: 'ניסיון תעסוקתי' },
  { key: 'favRole',       label: 'תפקיד שאהבת במיוחד' },
  { key: 'leastFavRole',  label: 'תפקיד שפחות התחברת אליו' },
  { key: 'whyPracticum',  label: 'מדוע נרשמת לפרקטיקום' },
  { key: 'whySuitable',   label: 'מדוע אתה מתאים/ה' },
  { key: 'persistence',   label: 'התמדה במשימה מאתגרת' },
  { key: 'expectations',  label: 'ציפיות מהפרקטיקום' },
];

type Submission = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  course_name: string | null;
  year: string | null;
  cv_file_path: string | null;
  application_file_path: string | null;
  notes: string | null;
  questionnaire: Questionnaire | null;
  submitted_at: string;
  processed: boolean;
};

type Props = {
  onAcceptIntoCandidates: (sub: Submission) => Promise<void>;
  refreshKey?: number;
};

export default function SubmissionsInbox({ onAcceptIntoCandidates, refreshKey }: Props) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);
  const [showProcessed, setShowProcessed] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    const { data, error } = await supabase
      .from('candidate_submissions')
      .select('*')
      .order('submitted_at', { ascending: false });
    setLoading(false);
    if (error) {
      setError(
        error.code === '42P01' || error.message.includes('does not exist')
          ? 'טבלת ההגשות לא קיימת. הרץ את supabase_registration.sql ב‑Supabase כדי להפעיל.'
          : error.message
      );
      return;
    }
    setSubmissions(data || []);
  }

  useEffect(() => { load(); }, [refreshKey]);

  const visible = submissions.filter(s => showProcessed || !s.processed);

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  }

  function toggleAll() {
    if (selectedIds.size === visible.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(visible.map(s => s.id)));
  }

  async function bulkDownload(mode: 'cv' | 'application' | 'both') {
    if (selectedIds.size === 0) return;
    setDownloading(true); setDownloadMsg(null);
    try {
      const zip = new JSZip();
      const selected = submissions.filter(s => selectedIds.has(s.id));
      let count = 0;
      for (const sub of selected) {
        const base = (sub.name || 'candidate').replace(/[^\u0590-\u05FFa-zA-Z0-9]/g, '_');
        if ((mode === 'cv' || mode === 'both') && sub.cv_file_path) {
          const { data } = await supabase.storage.from('candidate-uploads')
            .download(sub.cv_file_path);
          if (data) {
            const ext = sub.cv_file_path.split('.').pop() || 'pdf';
            const folder = mode === 'both' ? 'קורות_חיים/' : '';
            zip.file(`${folder}${base}_CV.${ext}`, data);
            count++;
          }
        }
        if ((mode === 'application' || mode === 'both') && sub.application_file_path) {
          const { data } = await supabase.storage.from('candidate-uploads')
            .download(sub.application_file_path);
          if (data) {
            const ext = sub.application_file_path.split('.').pop() || 'pdf';
            const folder = mode === 'both' ? 'טפסי_מועמדות/' : '';
            zip.file(`${folder}${base}_application.${ext}`, data);
            count++;
          }
        }
      }
      if (count === 0) {
        setDownloadMsg('אין קבצים להורדה בבחירה הנוכחית');
        setDownloading(false);
        return;
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const name = mode === 'cv' ? 'קורות_חיים' : mode === 'application' ? 'טפסי_מועמדות' : 'מסמכי_מועמדים';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setDownloadMsg(`✓ הורדו ${count} קבצים`);
      setTimeout(() => setDownloadMsg(null), 4000);
    } catch (e: any) {
      setDownloadMsg('שגיאה: ' + (e?.message || 'הורדה נכשלה'));
    }
    setDownloading(false);
  }

  async function acceptSelected() {
    const selected = submissions.filter(s => selectedIds.has(s.id) && !s.processed);
    if (selected.length === 0) return;
    for (const sub of selected) {
      await onAcceptIntoCandidates(sub);
      await supabase.from('candidate_submissions')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('id', sub.id);
    }
    setSelectedIds(new Set());
    load();
  }

  async function deleteOne(sub: Submission) {
    const filesWillBeKept = sub.processed;
    const msg = sub.processed
      ? `למחוק את רשומת ההגשה של "${sub.name}"?\nהמועמד/ת כבר נקלט/ה — הקבצים יישמרו בכרטיס המועמד.`
      : `למחוק את ההגשה של "${sub.name}"? הפעולה גם מוחקת את קבצי ה‑CV והטופס שהועלו.`;
    if (!confirm(msg)) return;
    // Only remove files from storage if submission was NOT processed (files not yet linked to a candidate)
    if (!filesWillBeKept) {
      const paths = [sub.cv_file_path, sub.application_file_path].filter(Boolean) as string[];
      if (paths.length > 0) {
        await supabase.storage.from('candidate-uploads').remove(paths);
      }
    }
    // Remove submission row
    await supabase.from('candidate_submissions').delete().eq('id', sub.id);
    // Remove from selection if it was selected
    const next = new Set(selectedIds);
    next.delete(sub.id);
    setSelectedIds(next);
    load();
  }

  async function deleteSelected() {
    const selected = submissions.filter(s => selectedIds.has(s.id));
    if (selected.length === 0) return;
    const unprocessed = selected.filter(s => !s.processed);
    const processed   = selected.filter(s =>  s.processed);
    const msg = processed.length > 0
      ? `למחוק ${selected.length} הגשות?\n${unprocessed.length} שלא נקלטו — הקבצים שלהן יימחקו.\n${processed.length} שנקלטו — הקבצים יישמרו בכרטיסי המועמדים.\nפעולה זו לא ניתנת לשחזור.`
      : `למחוק ${selected.length} הגשות וגם את כל הקבצים שלהן?\nפעולה זו לא ניתנת לשחזור.`;
    if (!confirm(msg)) return;
    // Only delete files for unprocessed submissions
    const paths: string[] = [];
    for (const s of unprocessed) {
      if (s.cv_file_path) paths.push(s.cv_file_path);
      if (s.application_file_path) paths.push(s.application_file_path);
    }
    if (paths.length > 0) {
      const { error: storageErr } = await supabase.storage.from('candidate-uploads').remove(paths);
      if (storageErr) console.warn('file delete error:', storageErr);
    }
    const ids = selected.map(s => s.id);
    const { data: deleted, error: delErr } = await supabase
      .from('candidate_submissions')
      .delete()
      .in('id', ids)
      .select();
    if (delErr) {
      alert('שגיאת מחיקה: ' + delErr.message + '\n\nייתכן שחסרה מדיניות DELETE. הרץ בSupabase SQL Editor:\n\nCREATE POLICY "auth_delete" ON candidate_submissions FOR DELETE TO authenticated USING (true);');
      return;
    }
    if (!deleted || deleted.length < ids.length) {
      alert(`נמחקו רק ${deleted?.length || 0} מתוך ${ids.length} — RLS חוסם חלק מהשורות. הרץ:\n\nCREATE POLICY "auth_delete" ON candidate_submissions FOR DELETE TO authenticated USING (true);`);
    }
    setSelectedIds(new Set());
    load();
  }

  return (
    <section className="mb-12 rounded-xl border" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
      <div className="flex items-baseline justify-between gap-4 p-5 border-b" style={{ borderColor: 'var(--divider)' }}>
        <div>
          <div className="chapter-mark mb-1" style={{ fontSize: '11px' }}>Inbox</div>
          <h2 className="serif text-[24px] tracking-tight" style={{ color: 'var(--ink)' }}>
            הגשות שהתקבלו
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <label className="mono text-[11px] uppercase tracking-[0.14em] font-semibold cursor-pointer flex items-center gap-2" style={{ color: 'var(--text-soft)' }}>
            <input type="checkbox" checked={showProcessed} onChange={e => setShowProcessed(e.target.checked)} />
            הצג גם מעובדים
          </label>
          <button onClick={load} className="mono text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--accent)' }}>
            ↻ רענן
          </button>
        </div>
      </div>

      {error ? (
        <div className="p-6 text-[14px]" style={{ color: 'var(--accent)' }}>
          ⚠ {error}
        </div>
      ) : loading ? (
        <div className="p-6 text-[14px]" style={{ color: 'var(--text-soft)' }}>טוען...</div>
      ) : visible.length === 0 ? (
        <div className="p-8 text-center text-[14px]" style={{ color: 'var(--text-soft)' }}>
          אין הגשות חדשות. הפצת קישור הרשמה:
          <div className="mono text-[12px] mt-3 p-3 rounded-lg" style={{ background: 'rgba(122,30,43,0.08)', color: 'var(--ink)', userSelect: 'all', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
            {location.origin}/register/?course=פרקטיקום+משאבי+אנוש&year=תשפ״ז
          </div>
        </div>
      ) : (
        <>
          <div className="p-4 flex flex-wrap gap-3 items-center border-b" style={{ borderColor: 'var(--divider)' }}>
            <button onClick={toggleAll} className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-3 py-1 rounded-full border"
              style={{ borderColor: 'var(--divider)', color: 'var(--ink)' }}>
              {selectedIds.size === visible.length ? '☐ נקה בחירה' : '☑ בחר הכל'}
            </button>
            <span className="mono text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-soft)' }}>
              {selectedIds.size} נבחרו / {visible.length} סה״כ
            </span>
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap gap-2 mr-auto">
                <button onClick={() => bulkDownload('cv')} disabled={downloading} style={btnSecondary(downloading)}>📄 הורד CV נבחרים</button>
                <button onClick={acceptSelected} disabled={downloading} style={btnPrimary(downloading)}>
                  ✓ קלוט למערכת
                </button>
                <button onClick={deleteSelected} disabled={downloading}
                  className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-3.5 py-1.5 rounded-full border"
                  style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                  🗑 מחק נבחרים
                </button>
              </div>
            )}
          </div>

          {downloadMsg && (
            <div className="px-5 py-2 mono text-[11.5px] uppercase tracking-[0.14em]" style={{ color: 'var(--accent)' }}>
              {downloadMsg}
            </div>
          )}

          <ul>
            {visible.map(s => <SubmissionCard key={s.id} s={s} selected={selectedIds.has(s.id)} onToggle={() => toggle(s.id)} onDelete={() => deleteOne(s)} />)}
          </ul>
        </>
      )}
    </section>
  );
}

function SubmissionCard({ s, selected, onToggle, onDelete }: {
  s: Submission; selected: boolean; onToggle: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasQ = s.questionnaire && Object.values(s.questionnaire).some(v => v?.trim());

  return (
    <li className="border-b" style={{ borderColor: 'var(--divider)', opacity: s.processed ? 0.6 : 1 }}>
      {/* ── header row ── */}
      <div className="flex items-start gap-4 px-5 py-4 hover:bg-[rgba(122,30,43,0.02)]">
        <input type="checkbox" checked={selected} onChange={onToggle} className="mt-1 cursor-pointer" />
        <div className="flex-1 min-w-0">
          <div className="serif text-[18px] leading-[1.2]" style={{ color: 'var(--ink)' }}>
            {s.name}
            {s.processed && (
              <span className="mono text-[10px] uppercase tracking-[0.14em] font-semibold mr-2 px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(122,30,43,0.08)', color: 'var(--accent)' }}>✓ נקלט</span>
            )}
          </div>
          <div className="text-[12.5px] flex flex-wrap gap-x-3 gap-y-0.5 mt-1" style={{ color: 'var(--text-soft)' }}>
            {s.phone && <span dir="ltr">{s.phone}</span>}
            {s.email && <span>{s.email}</span>}
            {s.questionnaire?.studyTracks && <span>· {s.questionnaire.studyTracks}</span>}
            {s.questionnaire?.gpa && <span>· ממוצע {s.questionnaire.gpa}</span>}
            {s.course_name && <span>· {s.course_name}</span>}
            {s.year && <span>· {s.year}</span>}
            <span>· {new Date(s.submitted_at).toLocaleDateString('he-IL')}</span>
          </div>
          {s.notes && (
            <div className="mt-1.5 mono text-[11px] tracking-[0.04em] px-2 py-1 rounded"
              style={{ background: 'rgba(122,30,43,0.06)', color: 'var(--accent)', display: 'inline-block' }}>
              {s.notes}
            </div>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0 items-center mt-0.5">
          {s.cv_file_path && <FilePill label="CV" path={s.cv_file_path} />}
          {s.application_file_path && <FilePill label="טופס" path={s.application_file_path} />}
          {hasQ && (
            <button onClick={() => setOpen(o => !o)}
              className="mono text-[10.5px] uppercase tracking-[0.14em] font-semibold px-2.5 py-1 rounded-full border hover:bg-[rgba(122,30,43,0.08)]"
              style={{ borderColor: 'var(--divider)', color: open ? 'var(--accent)' : 'var(--text-soft)' }}>
              שאלון {open ? '▲' : '▼'}
            </button>
          )}
          <button onClick={onDelete} title="מחק הגשה"
            className="w-7 h-7 rounded-full grid place-items-center text-[13px] hover:bg-[rgba(122,30,43,0.1)]"
            style={{ color: 'var(--accent)' }}>🗑</button>
        </div>
      </div>

      {/* ── questionnaire panel ── */}
      {open && hasQ && (
        <div className="px-14 pb-5 space-y-4">
          {Q_LABELS.filter(({ key }) => s.questionnaire?.[key]?.trim()).map(({ key, label }) => (
            <div key={key}>
              <div className="mono text-[10.5px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--accent)' }}>{label}</div>
              <p className="text-[13.5px] leading-[1.65] whitespace-pre-wrap" style={{ color: 'var(--ink)' }}>
                {s.questionnaire![key]}
              </p>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function FilePill({ label, path }: { label: string; path: string }) {
  const [loading, setLoading] = useState(false);

  async function open() {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const isWord = ext === 'docx' || ext === 'doc';

    const { data } = supabase.storage.from('candidate-uploads').getPublicUrl(path);
    const publicUrl = data.publicUrl;

    if (isWord) {
      // Word: Office Online viewer — synchronous, no popup blocker issue
      const target = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(publicUrl)}`;
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }

    // PDF: fetch via public URL, force application/pdf so browser shows inline (not download)
    setLoading(true);
    const win = window.open('about:blank', '_blank'); // open before await
    try {
      const resp = await fetch(publicUrl);
      const buf = await resp.arrayBuffer();
      const blob = new Blob([buf], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      if (win) win.location.href = blobUrl;
      else window.open(blobUrl, '_blank');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
    } catch {
      if (win) win.location.href = publicUrl;
      else window.open(publicUrl, '_blank');
    }
    setLoading(false);
  }

  return (
    <button onClick={open} disabled={loading}
      className="mono text-[10.5px] uppercase tracking-[0.14em] font-semibold px-2.5 py-1 rounded-full border hover:bg-[rgba(122,30,43,0.08)] disabled:opacity-50"
      style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
      {loading ? '...' : `${label} ↗`}
    </button>
  );
}

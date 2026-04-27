import { useState } from 'react';
import * as XLSX from 'xlsx';
import type { PracticumData, Student, Candidate, Trainer, Employer } from '../lib/supabase';
import { saveSnapshot, randomId } from '../lib/dataApi';
import { normalizeYear } from '../lib/session';

type ImportKind = 'students' | 'candidates' | 'trainers' | 'employers';

// Column name aliases → canonical field name.
// Matches Hebrew + English variants case-insensitively.
const ALIASES: Record<string, string[]> = {
  name:         ['שם', 'שם מלא', 'שם_מלא', 'name', 'full name', 'fullname'],
  phone:        ['טלפון', 'נייד', 'phone', 'mobile', 'tel'],
  email:        ['מייל', 'אימייל', 'דוא״ל', 'email', 'e-mail'],
  city:         ['עיר', 'עיר מגורים', 'city'],
  courseName:   ['קורס', 'שם קורס', 'course'],
  year:         ['שנה', 'שנה אקדמית', 'year'],
  notes:        ['הערות', 'הערה', 'notes', 'comment', 'comments'],
  // Candidate-specific
  applicationDate: ['תאריך הגשה', 'תאריך הגשת מועמדות', 'תאריך הרשמה', 'application date'],
  interviewDate:   ['תאריך ראיון', 'interview date'],
  interviewResult: ['תוצאה', 'תוצאת ראיון', 'result'],
  preferredArea:   ['תחום', 'תחום מבוקש', 'desired field', 'area'],
  evalScore:       ['ציון', 'ציון כולל', 'score'],
  // Student-specific
  acceptedOrg:   ['ארגון', 'ארגון מאכסן', 'organization', 'placed'],
  hoursReported: ['שעות', 'שעות מדווחות', 'hours'],
  // Trainer-specific
  role:          ['תפקיד', 'role', 'position', 'title'],
  specialty:     ['התמחות', 'specialty', 'expertise', 'domain'],
  organization:  ['ארגון', 'מוסד', 'organization', 'company', 'employer'],
  // Employer-specific
  contactPerson: ['איש קשר', 'contact', 'contact person', 'נציג'],
  contactPhone:  ['טלפון איש קשר', 'contact phone', 'נייד איש קשר'],
  contactEmail:  ['מייל איש קשר', 'contact email'],
  positions:     ['משרות', 'מספר משרות', 'positions', 'slots'],
  location:      ['מיקום', 'עיר', 'location', 'city'],
};

function normalize(s: string): string {
  return String(s || '').replace(/["']/g, '').trim().toLowerCase();
}

function buildColumnMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, idx) => {
    const n = normalize(h);
    if (!n) return;
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (map[field] != null) continue;
      if (aliases.some(a => normalize(a) === n || n.includes(normalize(a)))) {
        map[field] = idx;
        return;
      }
    }
  });
  return map;
}

type Props = {
  kind: ImportKind;
  data: PracticumData;
  userName: string;
  onDone: () => void;
};

export default function ExcelImport({ kind, data, userName, onDone }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][]; map: Record<string, number> } | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);

  async function handleFile(f: File) {
    setFile(f);
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
    if (rows.length < 2) { alert('הקובץ ריק או חסר שורת כותרת'); return; }
    const headers = (rows[0] as any[]).map(String);
    const body = (rows.slice(1) as any[][]).filter(r => r.some(c => String(c).trim() !== ''));
    setParsed({
      headers,
      rows: body.map(r => r.map(c => String(c))),
      map: buildColumnMap(headers),
    });
    setResult(null);
  }

  async function doImport() {
    if (!parsed) return;
    const { rows, map } = parsed;
    const get = (row: string[], field: string) => map[field] != null ? (row[map[field]] || '').trim() : '';

    const courses = data.courses || [];
    const findCourseId = (courseName: string) => {
      if (!courseName) return courses[0]?.id || '';
      const c = courses.find(x => x.name.trim() === courseName.trim());
      return c?.id || courses[0]?.id || '';
    };

    const existingArr =
      kind === 'students'   ? (data.students   || []) :
      kind === 'candidates' ? (data.candidates || []) :
      kind === 'trainers'   ? (data.trainers   || []) :
                              (data.employers  || []);

    const existingEmails = new Set((existingArr as any[]).map((x: any) => (x.email || x.contactEmail || '').toLowerCase()).filter(Boolean));
    const existingNames  = new Set((existingArr as any[]).map((x: any) => (x.name || '').trim().toLowerCase()).filter(Boolean));

    let added = 0, skipped = 0;
    const newRecords: any[] = [];

    for (const row of rows) {
      const name = get(row, 'name');
      if (!name) { skipped++; continue; }
      const email = (get(row, 'email') || get(row, 'contactEmail')).toLowerCase();
      if ((email && existingEmails.has(email)) || (!email && existingNames.has(name.toLowerCase()))) {
        skipped++; continue;
      }

      if (kind === 'students') {
        newRecords.push({
          id: randomId('s'),
          name,
          phone: get(row, 'phone'),
          email: get(row, 'email'),
          city: get(row, 'city'),
          courseId: findCourseId(get(row, 'courseName')),
          year: normalizeYear(get(row, 'year')) || '',
          acceptedOrg: get(row, 'acceptedOrg'),
          hoursReported: Number(get(row, 'hoursReported')) || 0,
          preparation: { passed: false },
          notes: get(row, 'notes'),
        } as Student);
      } else if (kind === 'candidates') {
        const resultValue = get(row, 'interviewResult');
        newRecords.push({
          id: randomId('cand'),
          name,
          phone: get(row, 'phone'),
          email: get(row, 'email'),
          city: get(row, 'city'),
          courseId: findCourseId(get(row, 'courseName')),
          year: normalizeYear(get(row, 'year')) || '',
          applicationDate: get(row, 'applicationDate'),
          interviewDate: get(row, 'interviewDate'),
          interviewResult: /עבר|passed|pass/.test(resultValue) ? 'passed'
            : /דחה|fail|לא התקבל/.test(resultValue) ? 'failed' : 'pending',
          preferredArea: get(row, 'preferredArea'),
          evalScore: get(row, 'evalScore') ? Number(get(row, 'evalScore')) : undefined,
          notes: get(row, 'notes'),
        } as Candidate);
      } else if (kind === 'trainers') {
        newRecords.push({
          id: randomId('trainer'),
          name,
          phone: get(row, 'phone'),
          email: get(row, 'email'),
          organization: get(row, 'organization'),
          role: get(row, 'role'),
          specialty: get(row, 'specialty'),
          courseId: findCourseId(get(row, 'courseName')),
          year: normalizeYear(get(row, 'year')) || '',
          notes: get(row, 'notes'),
        } as Trainer);
      } else {
        // employers
        newRecords.push({
          id: randomId('emp'),
          name,
          contactPerson: get(row, 'contactPerson'),
          contactPhone: get(row, 'contactPhone') || get(row, 'phone'),
          contactEmail: get(row, 'contactEmail') || get(row, 'email'),
          positions: Number(get(row, 'positions')) || 0,
          filledPositions: 0,
          location: get(row, 'location') || get(row, 'city'),
          courseId: findCourseId(get(row, 'courseName')),
          year: normalizeYear(get(row, 'year')) || '',
        } as Employer);
      }

      added++;
      if (email) existingEmails.add(email);
      existingNames.add(name.toLowerCase());
    }

    if (added === 0) {
      setResult({ added: 0, skipped });
      return;
    }

    setImporting(true);
    const entityLabel =
      kind === 'students' ? 'סטודנטים' :
      kind === 'candidates' ? 'מועמדים' :
      kind === 'trainers' ? 'מנחים' : 'מעסיקים';

    const nextData: PracticumData =
      kind === 'students'   ? { ...data, students:   [...(data.students   || []), ...newRecords] as Student[]   } :
      kind === 'candidates' ? { ...data, candidates: [...(data.candidates || []), ...newRecords] as Candidate[] } :
      kind === 'trainers'   ? { ...data, trainers:   [...(data.trainers   || []), ...newRecords] as Trainer[]   } :
                              { ...data, employers:  [...(data.employers  || []), ...newRecords] as Employer[]  };

    const res = await saveSnapshot(nextData, { name: userName }, {
      action: `יובאו מ‑Excel (${added})`,
      entity: entityLabel,
      target: file?.name || '',
    });
    setImporting(false);
    if (!res.ok) { alert('שגיאה: ' + (res.error || '')); return; }
    if (kind === 'students')   (data.students   as any) = nextData.students;
    else if (kind === 'candidates') (data.candidates as any) = nextData.candidates;
    else if (kind === 'trainers')   (data.trainers   as any) = nextData.trainers;
    else                            (data.employers  as any) = nextData.employers;
    setResult({ added, skipped });
    onDone();
  }

  const recognizedFields = parsed ? Object.keys(parsed.map) : [];
  const unrecognizedColumns = parsed ? parsed.headers.filter((_, i) => !Object.values(parsed.map).includes(i)) : [];

  return (
    <div className="rounded-xl p-5" style={{ background: 'rgba(122,30,43,0.04)', border: '1px solid var(--divider)' }}>
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <div className="serif text-[20px]" style={{ color: 'var(--ink)' }}>
          ייבוא {{students:'סטודנטים',candidates:'מועמדים',trainers:'מנחים',employers:'מעסיקים'}[kind]} מ‑Excel
        </div>
        <span className="mono text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-soft)' }}>
          .xlsx / .xls / .csv
        </span>
      </div>

      <p className="text-[13px] leading-[1.55] mb-4" style={{ color: 'var(--text-soft)' }}>
        עלה קובץ עם שורת כותרת. עמודות מזוהות: שם · טלפון · מייל · קורס · שנה · הערות
        {kind === 'candidates' && ' · עיר · תאריך הגשה · תאריך ראיון · תוצאה · תחום · ציון'}
        {kind === 'students'   && ' · עיר · ארגון · שעות'}
        {kind === 'trainers'   && ' · ארגון · תפקיד · התמחות'}
        {kind === 'employers'  && ' · איש קשר · טלפון איש קשר · מייל איש קשר · משרות · מיקום'}
        .&nbsp;עמודות לא מוכרות מתעלמים מהן.
      </p>

      {!parsed ? (
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="text-[13.5px]"
        />
      ) : (
        <>
          <div className="mono text-[11.5px] uppercase tracking-[0.14em] mb-3" style={{ color: 'var(--text-soft)' }}>
            {parsed.rows.length} שורות בקובץ · {recognizedFields.length} עמודות זוהו
            {unrecognizedColumns.length > 0 && ` · ${unrecognizedColumns.length} דולגו`}
          </div>

          <div className="grid grid-cols-2 gap-2 mb-4">
            <div>
              <div className="small-caps mb-1.5" style={{ color: 'var(--accent)' }}>✓ זוהו</div>
              <div className="text-[12.5px]" style={{ color: 'var(--ink)' }}>
                {recognizedFields.join(' · ') || '—'}
              </div>
            </div>
            {unrecognizedColumns.length > 0 && (
              <div>
                <div className="small-caps mb-1.5" style={{ color: 'var(--text-soft)' }}>↷ דולגו</div>
                <div className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
                  {unrecognizedColumns.join(' · ')}
                </div>
              </div>
            )}
          </div>

          {result ? (
            <div className="mono text-[12px] uppercase tracking-[0.14em] p-3 rounded-lg"
              style={{ background: 'rgba(122,30,43,0.08)', color: 'var(--accent)' }}>
              ✓ יובאו {result.added} · דולגו {result.skipped} (כפילויות או שורות ריקות)
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={doImport} disabled={importing} className="btn btn-primary disabled:opacity-50">
                {importing ? 'מייבא...' : `ייבא ${parsed.rows.length} שורות`} <span className="serif text-[16px]">→</span>
              </button>
              <button onClick={() => { setParsed(null); setFile(null); }}
                className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold opacity-60 hover:opacity-100">
                בטל
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import type { Student, Course, Employer } from '../lib/supabase';

type Props = {
  student: Student;
  courses: Course[];
  employers: Employer[];
  onClose: () => void;
};

export default function EvaluationForm({ student, courses, employers, onClose }: Props) {
  const course = courses.find(c => c.id === student.courseId);
  const employer = employers.find(e => e.name === student.acceptedOrg);

  const [mentor, setMentor] = useState(employer?.contactPerson || '');
  const [hours, setHours] = useState(String(student.hoursReported || 0));
  const [today] = useState(new Date().toLocaleDateString('he-IL'));

  // Body-scroll-lock — same technique as Modal.tsx
  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.overflow = 'hidden';
    return () => {
      body.style.position = '';
      body.style.top = '';
      body.style.left = '';
      body.style.right = '';
      body.style.overflow = '';
      window.scrollTo(0, scrollY);
    };
  }, []);

  function handlePrint() { window.print(); }

  return (
    <div className="fixed inset-0 z-[200] print:static"
      style={{ background: 'rgba(26,22,18,0.55)', backdropFilter: 'blur(4px)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } as any}
      onClick={onClose}>

      <div className="max-w-[820px] mx-auto my-6 px-6 print:my-0 print:max-w-full print:px-10"
        onClick={e => e.stopPropagation()}>

        {/* Non-print toolbar */}
        <div className="flex items-center justify-between gap-3 mb-3 print:hidden">
          <div className="mono text-[11px] uppercase tracking-[0.15em] font-semibold" style={{ color: 'var(--bg)' }}>
            טופס הערכת סטודנט/ית בפרקטיקום
          </div>
          <div className="flex gap-2">
            <button onClick={handlePrint} className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-4 py-1.5 rounded-full"
              style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
              🖨 הדפס / PDF
            </button>
            <button onClick={onClose} className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-4 py-1.5 rounded-full"
              style={{ background: 'rgba(244,239,230,0.15)', color: 'var(--bg)', border: '1px solid rgba(244,239,230,0.4)' }}>
              סגור ✕
            </button>
          </div>
        </div>

        {/* Form — print layout */}
        <div className="rounded-2xl p-10 print:rounded-none print:p-6" style={{ background: 'var(--bg)' }}>

          {/* Header */}
          <header className="border-b pb-5 mb-6" style={{ borderColor: 'var(--divider)' }}>
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="chapter-mark mb-2">Evaluation Form</div>
                <h1 className="serif text-[28px] leading-[1.1]" style={{ color: 'var(--ink)' }}>
                  טופס הערכת סטודנט/ית
                </h1>
                <div className="text-[13px] mt-1" style={{ color: 'var(--text-soft)' }}>
                  פרקטיקום במשאבי אנוש · אוניברסיטת אריאל
                </div>
              </div>
              <div className="text-left">
                <div className="small-caps mb-1">תאריך המילוי</div>
                <div className="serif text-[22px]" style={{ color: 'var(--ink)' }}>{today}</div>
              </div>
            </div>
          </header>

          {/* א — פרטי הסטודנט/ית */}
          <Section letter="א" title="פרטי הסטודנט/ית">
            <Row label="שם מלא" value={student.name} />
            <Row label="קורס" value={course?.name || '—'} />
            <Row label="שנה אקדמית" value={student.year || '—'} />
            <Row label="טלפון" value={student.phone || '—'} />
            <Row label="אימייל" value={student.email || '—'} />
          </Section>

          {/* ב — פרטי ההשמה */}
          <Section letter="ב" title="פרטי ההשמה">
            <Row label="ארגון מאכסן" value={student.acceptedOrg || '—'} />
            <Row label="איש קשר / מנחה בארגון" input onInput={setMentor} value={mentor} />
            <Row label="תפקיד המנחה בארגון" input />
            <Row label="תקופת ההתנסות" input placeholder="מ‑____ עד ____" />
            <Row label="היקף שעות מדווח" input value={hours} onInput={setHours} suffix="שעות" />
            <Row label="היקף שעות מאושר" input suffix="שעות" />
          </Section>

          {/* ג — הערכת תפקוד */}
          <Section letter="ג" title="הערכת תפקוד — דרג כל קריטריון (1 = נמוך מאוד, 5 = מצטיין)">
            {CRITERIA_GROUPS.map(group => (
              <div key={group.label} className="mb-5">
                <div className="mono text-[11px] uppercase tracking-[0.14em] font-semibold mb-2 mt-3"
                  style={{ color: 'var(--text-soft)' }}>
                  {group.label}
                </div>
                {group.items.map(c => <CriterionRow key={c} label={c} />)}
                <div className="mt-2">
                  <div className="small-caps mb-1 text-[11px]">הסבר / פירוט (אופציונלי)</div>
                  <TextArea lines={2} />
                </div>
              </div>
            ))}
          </Section>

          {/* ד — שביעות רצון כללית (50% מהציון) */}
          <Section letter="ד" title="שביעות רצון כללית מהסטודנט/ית">
            <div className="rounded-lg p-4 mb-5"
              style={{ background: 'rgba(122,30,43,0.06)', border: '1px solid var(--divider)' }}>
              <div className="text-[13px] leading-[1.6]" style={{ color: 'var(--ink)' }}>
                <strong>הערה חשובה:</strong> הציון בסעיף זה מהווה <strong>50% מהציון הסופי בקורס</strong>,
                בהתאם למרכיבי הסילבוס הבאים: נוכחות ומחויבות, תרומה לארגון, יחסי אנוש, ועמידה בדרישות.
                יש לתת ציון מ‑0 עד 100.
              </div>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-6 items-start mb-4">
              <div>
                <div className="small-caps mb-2">ציון שביעות רצון כללית (0–100)</div>
                <input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="___"
                  className="bg-transparent border-b outline-none text-[28px] font-semibold w-24 text-center py-1"
                  style={{ color: 'var(--ink)', borderColor: 'var(--accent)' }}
                />
              </div>
              <div className="text-right">
                <div className="small-caps mb-2">המלצה כוללת</div>
                <div className="flex flex-col gap-2">
                  {['ממליץ/ה בחום', 'ממליץ/ה', 'ממליץ/ה עם הסתייגויות', 'לא ממליץ/ה'].map(opt => (
                    <label key={opt} className="flex items-center gap-2 text-[13.5px]" style={{ color: 'var(--ink)' }}>
                      <input type="radio" name="overall-rec" />
                      {opt}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="mb-4">
              <div className="small-caps mb-2">חוזקות בולטות</div>
              <TextArea lines={3} />
            </div>

            <div className="mb-4">
              <div className="small-caps mb-2">תחומים לשיפור / פידבק</div>
              <TextArea lines={3} />
            </div>

            <div>
              <div className="small-caps mb-2">הערות נוספות</div>
              <TextArea lines={2} />
            </div>
          </Section>

          {/* Signatures */}
          <Section letter="ה" title="חתימות">
            <div className="grid grid-cols-2 gap-8 mt-3">
              <SigBox label="חתימת המנחה בארגון" />
              <SigBox label="חתימת הסטודנט/ית" />
            </div>
            <div className="text-[12px] mt-6 leading-[1.6]" style={{ color: 'var(--text-soft)' }}>
              אנא החזירו את הטופס המלא ל‑<strong>yarivi@ariel.ac.il</strong>
              &nbsp;· ניתן לסרוק את הטופס המודפס או למלא באופן דיגיטלי ולשלוח PDF.
            </div>
          </Section>

        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 1.2cm; }
          body { background: var(--bg) !important; }
          input, textarea { border-color: rgba(0,0,0,0.25) !important; }
        }
      `}</style>
    </div>
  );
}

// Criteria organized by thematic groups
const CRITERIA_GROUPS = [
  {
    label: 'יחסי אנוש ותקשורת',
    items: [
      'יחסי אנוש ועבודת צוות',
      'כישורי תקשורת כתובים',
      'כישורי תקשורת בעל‑פה',
    ],
  },
  {
    label: 'מקצועיות ואחריות',
    items: [
      'אחריות ועמידה בזמנים',
      'שליטה בתחום המקצועי',
      'תרומה כללית לארגון',
    ],
  },
  {
    label: 'יכולת ולמידה',
    items: [
      'יוזמה ועצמאות בעבודה',
      'יכולת למידה והסתגלות',
      'כישורי ניתוח וחשיבה',
      'התמודדות עם לחץ',
    ],
  },
];

function Section({ letter, title, children }: { letter: string; title: string; children: any }) {
  return (
    <section className="mb-8">
      <h2 className="mono text-[12.5px] uppercase tracking-[0.14em] font-semibold pb-2 mb-4 border-b flex items-center gap-3"
        style={{ color: 'var(--accent)', borderColor: 'var(--divider)' }}>
        <span className="serif text-[16px] font-normal" style={{ color: 'var(--text-soft)' }}>{letter}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({
  label, value, input, onInput, placeholder, suffix,
}: { label: string; value?: string; input?: boolean; onInput?: (v: string) => void; placeholder?: string; suffix?: string }) {
  return (
    <div className="flex items-baseline gap-4 py-2 border-b" style={{ borderColor: 'rgba(122,30,43,0.1)' }}>
      <div className="small-caps w-44 shrink-0" style={{ letterSpacing: '0.12em' }}>{label}</div>
      {input ? (
        <div className="flex-1 flex items-baseline gap-3">
          <input
            defaultValue={value}
            onInput={(e) => onInput?.((e.target as HTMLInputElement).value)}
            placeholder={placeholder}
            className="flex-1 bg-transparent border-b outline-none text-[15px] py-1"
            style={{ color: 'var(--ink)', borderColor: 'var(--divider)' }}
          />
          {suffix && <span className="text-[13px]" style={{ color: 'var(--text-soft)' }}>{suffix}</span>}
        </div>
      ) : (
        <div className="flex-1 text-[15px]" style={{ color: 'var(--ink)' }}>{value}</div>
      )}
    </div>
  );
}

function CriterionRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4 py-2 border-b" style={{ borderColor: 'rgba(122,30,43,0.08)' }}>
      <div className="flex-1 text-[14.5px]" style={{ color: 'var(--ink)' }}>{label}</div>
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4, 5].map(n => (
          <label key={n} className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--ink)' }}>
            <input type="radio" name={label} value={n} />
            <span>{n}</span>
          </label>
        ))}
        <span className="text-[12px] mr-3" style={{ color: 'var(--text-soft)' }}>לא רלוונטי</span>
        <input type="radio" name={label} value="na" />
      </div>
    </div>
  );
}

function TextArea({ lines = 3 }: { lines?: number }) {
  return (
    <textarea rows={lines} className="w-full bg-transparent border rounded-md p-3 text-[14px] mt-1"
      style={{ borderColor: 'var(--divider)', color: 'var(--ink)', resize: 'vertical', minHeight: `${lines * 24}px` }}/>
  );
}

function SigBox({ label }: { label: string }) {
  return (
    <div>
      <div className="small-caps mb-1" style={{ letterSpacing: '0.12em' }}>{label}</div>
      <div className="h-16 border-b" style={{ borderColor: 'var(--ink)' }} />
      <div className="flex justify-between text-[12px] mt-1.5" style={{ color: 'var(--text-soft)' }}>
        <span>תאריך: _________</span>
        <span>שם מלא: _________</span>
      </div>
    </div>
  );
}

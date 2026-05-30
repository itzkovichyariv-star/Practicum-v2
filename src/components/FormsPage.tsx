import { useState, useEffect } from 'react';
import type { PageProps } from './pageShared';
import EvaluationForm from './EvaluationForm';

/* ─── Word / Print helpers ───────────────────────────────────────────── */

function wordWrap(bodyHtml: string, title: string): string {
  return `<html xmlns:o='urn:schemas-microsoft-com:office:office'
               xmlns:w='urn:schemas-microsoft-com:office:word'
               xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>${title}</title>
<style>
  body { font-family: Arial, sans-serif; direction: rtl; color: #1a1a1a; margin: 1.5cm; font-size: 11pt; }
  h1 { font-size: 18pt; margin: 0 0 4pt; }
  h2 { font-size: 12pt; font-weight: bold; border-bottom: 1pt solid #888; padding-bottom: 3pt; margin: 18pt 0 8pt; color: #5a1020; }
  .subtitle { font-size: 10pt; color: #888; margin-bottom: 16pt; }
  .row { display: flex; gap: 12pt; padding: 5pt 0; border-bottom: 0.5pt solid #ddd; }
  .lbl { font-size: 9.5pt; font-weight: bold; color: #555; width: 120pt; flex-shrink: 0; }
  .val { flex: 1; border-bottom: 0.5pt solid #bbb; min-height: 14pt; }
  .radio-grid { display: flex; gap: 14pt; flex-wrap: wrap; margin: 6pt 0; }
  .radio-opt { font-size: 10pt; }
  .crit-row { display: flex; align-items: center; gap: 10pt; padding: 5pt 0; border-bottom: 0.5pt solid #eee; font-size: 10.5pt; }
  .crit-label { flex: 1; }
  .crit-nums { display: flex; gap: 8pt; font-size: 10pt; color: #555; }
  .write-block { margin: 4pt 0 12pt; }
  .write-lbl { font-size: 9.5pt; font-weight: bold; color: #555; margin-bottom: 5pt; }
  .write-line { border-bottom: 0.5pt solid #999; height: 20pt; width: 100%; margin-bottom: 2pt; }
  .val.filled { color: #1a1a1a; font-weight: 600; border-bottom-color: #7a1e2b; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24pt; margin-top: 14pt; }
  .sig-lbl { font-size: 9pt; font-weight: bold; color: #555; margin-bottom: 3pt; }
  .sig-line { border-bottom: 0.5pt solid #333; height: 36pt; }
  .sig-sub { display: flex; justify-content: space-between; font-size: 9pt; color: #888; margin-top: 3pt; }
  .notice { background: #f9f0f2; border: 0.5pt solid #c8828e; padding: 8pt; font-size: 10pt; line-height: 1.5; margin-bottom: 10pt; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th, td { border: 0.5pt solid #ccc; padding: 5pt 7pt; text-align: right; }
  th { background: #f5f0f0; font-weight: bold; }
</style>
</head><body dir="rtl" lang="he-IL">${bodyHtml}</body></html>`;
}

function openBlobUrl(content: string, mimeType: string, forceDownload = false, filename?: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  if (forceDownload && filename) {
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
  } else {
    // Open in new tab \u2014 works reliably across browsers including mobile Safari
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
  }
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function downloadAsWord(bodyHtml: string, title: string, filename: string) {
  const full = wordWrap(bodyHtml, title);
  openBlobUrl('\ufeff' + full, 'application/msword', true, filename + '.doc');
}

function openInBrowser(bodyHtml: string, title: string) {
  const style = `
    body{font-family:Arial,sans-serif;direction:rtl;color:#1a1a1a;margin:2cm;font-size:11pt;background:#f9f6f0}
    h1{font-size:18pt;margin:0 0 4pt} h2{font-size:12pt;font-weight:700;border-bottom:1pt solid #7a1e2b;padding-bottom:3pt;margin:18pt 0 8pt;color:#7a1e2b}
    .subtitle{font-size:10pt;color:#888;margin-bottom:16pt}
    .row{display:flex;gap:12pt;padding:5pt 0;border-bottom:0.5pt solid rgba(122,30,43,0.15)}
    .lbl{font-size:9.5pt;font-weight:600;color:#666;width:130pt;flex-shrink:0}
    .val{flex:1;border-bottom:0.5pt solid #bbb;min-height:14pt}
    .radio-grid{display:flex;gap:14pt;flex-wrap:wrap;margin:6pt 0}
    .radio-opt{font-size:10.5pt}
    .crit-row{display:flex;align-items:center;gap:10pt;padding:5pt 0;border-bottom:0.5pt solid #eee;font-size:10.5pt}
    .crit-label{flex:1} .crit-nums{display:flex;gap:8pt;font-size:10pt;color:#555}
    .write-block{margin:4pt 0 12pt} .write-lbl{font-size:9.5pt;font-weight:600;color:#555;margin-bottom:5pt}
    .write-line{border-bottom:0.5pt solid #999;height:20pt;width:100%;margin-bottom:2pt}
    .val.filled{color:#1a1a1a;font-weight:600;border-bottom-color:#7a1e2b}
    .sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:24pt;margin-top:14pt}
    .sig-lbl{font-size:9pt;font-weight:600;color:#555;margin-bottom:3pt}
    .sig-line{border-bottom:1pt solid #333;height:36pt}
    .sig-sub{display:flex;justify-content:space-between;font-size:9pt;color:#888;margin-top:3pt}
    .notice{background:rgba(122,30,43,0.06);border:1pt solid rgba(122,30,43,0.25);border-radius:4pt;padding:8pt;font-size:10pt;line-height:1.5;margin-bottom:10pt}
    table{width:100%;border-collapse:collapse;font-size:10pt} th,td{border:0.5pt solid #ccc;padding:5pt 7pt;text-align:right} th{background:#f5f0f0;font-weight:700}
    @media print{body{background:white;margin:1.2cm}@page{size:A4;margin:1.2cm}}`;
  // Auto-print on open so user can save as PDF via browser print dialog
  const full = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><title>${title}</title><style>${style}</style></head><body>${bodyHtml}<script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script></body></html>`;
  // Use blob URL \u2014 avoids popup-blocker issues with window.open('','_blank')+document.write
  openBlobUrl(full, 'text/html;charset=utf-8');
}

/* ─── Form context (pre-filled student/candidate data) ──────────────── */

type FormContext = {
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  courseName?: string;
  year?: string;
  org?: string;
  hoursReported?: string;
  hoursApproved?: string;
};

/* ─── Form body generators (shared between print + Word) ─────────────── */

function blankRow(label: string, widthPt = 200) {
  return `<div class="row"><div class="lbl">${label}</div><div class="val" style="min-width:${widthPt}pt"></div></div>`;
}
function filledRow(label: string, value: string, widthPt = 200) {
  return `<div class="row"><div class="lbl">${label}</div><div class="val filled" style="min-width:${widthPt}pt;font-weight:600;color:#1a1a1a;border-bottom:1pt solid #7a1e2b">${value}</div></div>`;
}
function row(label: string, value: string | undefined, widthPt = 200) {
  return value ? filledRow(label, value, widthPt) : blankRow(label, widthPt);
}
function openBox(label: string, heightPt = 50) {
  const lineCount = Math.max(2, Math.round(heightPt / 20));
  const lines = Array(lineCount).fill('<div class="write-line"></div>').join('');
  return `<div class="write-block"><div class="write-lbl">${label}</div>${lines}</div>`;
}
function radioRow(_name: string, opts: string[]) {
  return `<div class="radio-grid">${opts.map(o => `<div class="radio-opt">☐ ${o}</div>`).join('')}</div>`;
}
function criterionRows(items: string[]) {
  return items.map(c => `<div class="crit-row"><div class="crit-label">${c}</div>
    <div class="crit-nums">${[1,2,3,4,5].map(n=>`<span>☐ ${n}</span>`).join('')} <span style="color:#aaa">☐ לא רלוונטי</span></div></div>`).join('');
}
function sigBox(label: string) {
  return `<div><div class="sig-lbl">${label}</div><div class="sig-line"></div><div class="sig-sub"><span>תאריך: _________</span><span>שם מלא: _________</span></div></div>`;
}
function contextBanner(ctx: FormContext) {
  if (!ctx.name) return '';
  return `<div style="background:#f0f8f0;border:0.5pt solid #5a9a5a;padding:6pt 10pt;margin-bottom:12pt;font-size:9.5pt;border-radius:3pt">
    <strong>✓ טופס מוכן עבור:</strong> ${ctx.name}${ctx.courseName ? ' · ' + ctx.courseName : ''}${ctx.year ? ' · ' + ctx.year : ''}
  </div>`;
}

// ── Evaluation ──────────────────────────────────────────────────────────
function evaluationBody(ctx: FormContext = {}) {
  return `
<h1>טופס הערכת סטודנט/ית בפרקטיקום</h1>
<div class="subtitle">פרקטיקום במשאבי אנוש · אוניברסיטת אריאל · תאריך מילוי: ___________</div>
${contextBanner(ctx)}
<h2>א — פרטי הסטודנט/ית</h2>
${row('שם מלא', ctx.name)}${row('קורס', ctx.courseName)}${row('שנה אקדמית', ctx.year)}${row('טלפון', ctx.phone)}${row('אימייל', ctx.email)}

<h2>ב — פרטי ההשמה</h2>
${row('ארגון מאכסן', ctx.org)}${blankRow('מנחה בארגון')}${blankRow('תפקיד המנחה')}${blankRow('תקופת ההתנסות')}${row('שעות מדווח', ctx.hoursReported)}${row('שעות מאושר', ctx.hoursApproved)}

<h2>ג — הערכת תפקוד (1=נמוך מאוד · 5=מצטיין)</h2>
<p style="font-size:9.5pt;color:#666;margin:0 0 6pt">יחסי אנוש ותקשורת</p>
${criterionRows(['יחסי אנוש ועבודת צוות','כישורי תקשורת כתובים','כישורי תקשורת בעל‑פה'])}
${openBox('הסבר / פירוט', 36)}
<p style="font-size:9.5pt;color:#666;margin:8pt 0 6pt">מקצועיות ואחריות</p>
${criterionRows(['אחריות ועמידה בזמנים','שליטה בתחום המקצועי','תרומה כללית לארגון'])}
${openBox('הסבר / פירוט', 36)}
<p style="font-size:9.5pt;color:#666;margin:8pt 0 6pt">יכולת ולמידה</p>
${criterionRows(['יוזמה ועצמאות בעבודה','יכולת למידה והסתגלות','כישורי ניתוח וחשיבה','התמודדות עם לחץ'])}
${openBox('הסבר / פירוט', 36)}

<h2>ד — שביעות רצון כללית (50% מהציון הסופי)</h2>
<div class="notice"><strong>הערה חשובה:</strong> ציון זה מהווה <strong>50% מהציון הסופי בקורס</strong>, בהתאם למרכיבי הסילבוס: נוכחות ומחויבות, תרומה לארגון, יחסי אנוש ועמידה בדרישות.</div>
${blankRow('ציון שביעות רצון כללית (0–100)', 60)}
<div style="margin-top:8pt;font-size:9.5pt;font-weight:bold;color:#555">המלצה כוללת</div>
${radioRow('rec', ['ממליץ/ה בחום','ממליץ/ה','ממליץ/ה עם הסתייגויות','לא ממליץ/ה'])}
${openBox('חוזקות בולטות', 45)}
${openBox('תחומים לשיפור', 45)}
${openBox('הערות נוספות', 32)}

<h2>ה — חתימות</h2>
<div class="sig-grid">${sigBox('חתימת המנחה בארגון')}${sigBox('חתימת הסטודנט/ית')}</div>
<div style="font-size:9pt;color:#888;margin-top:12pt">אנא החזירו את הטופס ל‑<strong>yarivi@ariel.ac.il</strong></div>`;
}

// ── Intake ───────────────────────────────────────────────────────────────
function intakeBody(ctx: FormContext = {}) {
  return `
<h1>טופס הגשת מועמדות לפרקטיקום</h1>
<div class="subtitle">פרקטיקום במשאבי אנוש · אוניברסיטת אריאל · תאריך: ___________</div>
${contextBanner(ctx)}
<h2>א — פרטים אישיים</h2>
${row('שם מלא', ctx.name)}${blankRow('ת.ז.')}${row('טלפון', ctx.phone)}${row('אימייל', ctx.email)}${row('עיר מגורים', ctx.city)}

<h2>ב — פרטי לימודים</h2>
${row('קורס', ctx.courseName)}${row('שנת לימוד', ctx.year)}${blankRow('ממוצע ציונים')}

<h2>ג — העדפות פרקטיקום</h2>
<div style="font-size:9.5pt;font-weight:bold;color:#555;margin:6pt 0 4pt">תחום עיסוק מועדף</div>
${radioRow('domain', ['גיוס ומיון','הכשרה ופיתוח','שכר ותנאים','רווחה ותרבות ארגונית','פסיכולוג/ית ארגונית','אחר'])}
${blankRow('ארגון מבוקש (1)')}${blankRow('ארגון מבוקש (2)')}${blankRow('אזור גיאוגרפי')}

<h2>ד — ניסיון וכישורים</h2>
${openBox('ניסיון תעסוקתי קודם רלוונטי', 55)}
${openBox('כישורים מיוחדים / שפות', 40)}
${openBox('מדוע פרקטיקום בתחום משאבי אנוש?', 55)}

<h2>ה — מסמכים מצורפים</h2>
${radioRow('docs', ['☐ קורות חיים (CV)','☐ תמונה','☐ גיליון ציונים'])}

<h2>ו — חתימה</h2>
<div class="sig-grid">${sigBox('חתימת המועמד/ת')}<div></div></div>`;
}

// ── Interview ────────────────────────────────────────────────────────────
function interviewBody(ctx: FormContext = {}) {
  const evalItems: [string, string[]][] = [
    ['מחויבות ומוטיבציה',   ['1 (נמוכה)','2 (בינונית)','3 (גבוהה)','4 (גבוהה מאוד)']],
    ['כישורי תקשורת',        ['1 (חלשים)','2 (בינוניים)','3 (טובים)','4 (מצוינים)']],
    ['היכרות עם תחום ה‑HR',  ['1 (אין)','2 (מעטה)','3 (טובה)','4 (רחבה)']],
    ['אנגלית',               ['1 (בסיסית)','2 (טובה)','3 (טובה מאוד)','4 (שפת אם)']],
    ['רושם כללי',            ['1 (נמוך)','2 (בינוני)','3 (גבוה)','4 (מצוין)']],
  ];
  return `
<h1>סיכום ראיון מועמד/ת</h1>
<div class="subtitle">פרקטיקום במשאבי אנוש · אוניברסיטת אריאל · תאריך ראיון: ___________</div>
${contextBanner(ctx)}
<h2>א — פרטי המועמד/ת</h2>
${row('שם מלא', ctx.name)}${row('קורס', ctx.courseName)}${blankRow('מראיין/ת')}

<h2>ב — הערכת הראיון</h2>
${evalItems.map(([lbl, opts]) => `<div class="crit-row"><div class="crit-label">${lbl}</div>
  <div class="crit-nums">${opts.map(o=>`<span>☐ ${o}</span>`).join('')}</div></div>`).join('')}
${blankRow('ציון כולל (0–100)', 60)}

<h2>ג — סיכום ראיון</h2>
${openBox('תחום עניין מועדף / נושאי ראיון', 50)}
${openBox('חוזקות שעלו בראיון', 50)}
${openBox('חששות / נקודות לשים לב', 50)}
${openBox('הערות נוספות', 40)}

<h2>ד — המלצה</h2>
${radioRow('dec', ['✓ עבר/ה — מתקבל/ת לפרקטיקום','✗ לא עבר/ה','⏳ ממתין/ה לגורם נוסף'])}
<div style="margin-top:6pt">${blankRow('סיבת דחייה (אם רלוונטי)', 280)}</div>

<h2>ה — חתימה</h2>
<div class="sig-grid">${sigBox('חתימת המראיין/ת')}<div></div></div>`;
}

// ── Prep ─────────────────────────────────────────────────────────────────
function prepBody(ctx: FormContext = {}) {
  return `
<h1>אישור השתתפות בסדנת הכנה לפרקטיקום</h1>
<div class="subtitle">פרקטיקום במשאבי אנוש · אוניברסיטת אריאל</div>
${contextBanner(ctx)}
<h2>א — פרטי הסטודנט/ית</h2>
${row('שם מלא', ctx.name)}${blankRow('מספר ת.ז.')}${row('קורס', ctx.courseName)}${row('שנת לימוד', ctx.year)}

<h2>ב — פרטי הסדנה</h2>
${blankRow('תאריך הסדנה')}${blankRow('מיקום')}${blankRow('שם המנחה')}

<h2>ג — נושאים שנלמדו</h2>
${radioRow('topics', ['זכויות וחובות בפרקטיקום','נורמות התנהגות ארגונית','כתיבת יומן פרקטיקום','דיווח שעות','תהליך קבלת משוב','אחר'])}

<h2>ד — הצהרה</h2>
<p style="font-size:10.5pt;line-height:1.7;margin:6pt 0">
אני הח"מ מאשר/ת כי השתתפתי בסדנת ההכנה לפרקטיקום כנדרש, קיבלתי את כל החומרים הרלוונטיים,
ואני מבין/ה את הציפיות ממני במסגרת הפרקטיקום.
</p>

<h2>ה — חתימות</h2>
<div class="sig-grid">${sigBox('חתימת הסטודנט/ית')}${sigBox('אישור מנחה / מרצה')}</div>`;
}

// ── Site Visit ────────────────────────────────────────────────────────────
function siteVisitBody(ctx: FormContext = {}) {
  return `
<h1>דוח ביקור תקופתי בארגון</h1>
<div class="subtitle">מדריך אקדמי · פרקטיקום במשאבי אנוש · אוניברסיטת אריאל</div>
${contextBanner(ctx)}
<h2>א — פרטי הביקור</h2>
${blankRow('תאריך ביקור')}${row('ארגון מארח', ctx.org)}${row('שם הסטודנט/ית', ctx.name)}${blankRow('מנחה בארגון')}${blankRow('שם המדריך האקדמי')}

<h2>ב — הערכת התפקוד בארגון (1–5)</h2>
${criterionRows(['שילוב בסביבת העבודה','מחויבות ונוכחות','ביצוע משימות','יחסי אנוש','התקדמות מקצועית'])}

<h2>ג — תצפיות ומסקנות</h2>
${openBox('תיאור פעילות הסטודנט/ית', 60)}
${openBox('נושאים שהועלו בפגישה', 55)}
${openBox('המלצות / פעולות נדרשות', 50)}

<h2>ד — חתימות</h2>
<div class="sig-grid">${sigBox('חתימת המדריך האקדמי')}${sigBox('חתימת המנחה בארגון')}</div>`;
}

// ── Hours ─────────────────────────────────────────────────────────────────
function hoursBody(ctx: FormContext = {}) {
  const emptyRows = Array(10).fill(0).map(() =>
    `<tr><td style="min-width:60pt">&nbsp;</td><td></td><td></td><td></td><td style="min-width:120pt"></td></tr>`
  ).join('');
  return `
<h1>דוח שעות פרקטיקום</h1>
<div class="subtitle">פרקטיקום במשאבי אנוש · אוניברסיטת אריאל</div>
${contextBanner(ctx)}
<h2>א — פרטים</h2>
${row('שם הסטודנט/ית', ctx.name)}${row('ארגון מאכסן', ctx.org)}${blankRow('תקופת הדיווח')}

<h2>ב — פירוט שעות</h2>
<table>
  <thead><tr><th>תאריך</th><th>כניסה</th><th>יציאה</th><th>סה"כ שעות</th><th>תיאור פעילות</th></tr></thead>
  <tbody>${emptyRows}</tbody>
  <tfoot><tr><th colspan="3" style="text-align:right">סה"כ שעות</th><td></td><td></td></tr></tfoot>
</table>

<h2>ג — אישור</h2>
<div class="sig-grid">${sigBox('חתימת הסטודנט/ית')}${sigBox('חתימת המנחה בארגון')}</div>`;
}

/* ─── Form definitions ───────────────────────────────────────────────── */

type FormDef = {
  key: string;
  title: string;
  description: string;
  emoji: string;
  filename: string;
  bodyFn: (ctx?: FormContext) => string;
  builtin?: boolean;
};

const BUILTIN_FORMS: FormDef[] = [
  {
    key: 'evaluation', emoji: '🖨', filename: 'טופס-הערכת-סטודנט', builtin: true,
    title: 'טופס הערכת סטודנט',
    description: 'למנחה בארגון. 10 קריטריונים, ציון שביעות רצון (50% מהציון), שדות פתוחים, חתימות.',
    bodyFn: evaluationBody,
  },
  {
    key: 'intake', emoji: '📝', filename: 'טופס-הגשת-מועמדות',
    title: 'טופס הגשת מועמדות',
    description: 'למועמד חדש לפרקטיקום — פרטים אישיים, תחומי עניין, העדפות ארגון.',
    bodyFn: intakeBody,
  },
  {
    key: 'interview', emoji: '🗒', filename: 'סיכום-ראיון-מועמד',
    title: 'סיכום ראיון מועמד',
    description: 'לוח דירוג של המראיין, ציון, תוצאה, הערות פתוחות.',
    bodyFn: interviewBody,
  },
  {
    key: 'prep', emoji: '✓', filename: 'אישור-הכנה',
    title: 'אישור הכנה',
    description: 'אישור שהסטודנט/ית סיימו את סדנת ההכנה לפרקטיקום.',
    bodyFn: prepBody,
  },
  {
    key: 'sitevisit', emoji: '🏢', filename: 'דוח-ביקור-ארגון',
    title: 'דוח ביקור בארגון',
    description: 'למדריך האקדמי — דוח ביקור תקופתי בארגון המאכסן.',
    bodyFn: siteVisitBody,
  },
  {
    key: 'hours', emoji: '⏱', filename: 'דוח-שעות',
    title: 'דוח שעות חתום',
    description: 'טבלת שעות יומית עם סיכום — חתומה ע"י המנחה בארגון.',
    bodyFn: hoursBody,
  },
];

/* ─── Sub-components ─────────────────────────────────────────────────── */

function QuickLinksCard() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://practicum.yarivitzkovich.org';
  const base = origin;
  const sections = [
    { title: '🎛 המערכת', links: [
      { label: 'דשבורד', url: `${base}/#dashboard`, hash: 'dashboard' },
      { label: 'סטודנטים', url: `${base}/#students`, hash: 'students' },
      { label: 'מועמדים', url: `${base}/#candidates`, hash: 'candidates' },
      { label: 'מעסיקים', url: `${base}/#employers`, hash: 'employers' },
      { label: 'הרצאות', url: `${base}/#lectures`, hash: 'lectures' },
      { label: 'לוח שנה', url: `${base}/#calendar`, hash: 'calendar' },
      { label: 'דוחות', url: `${base}/#reports`, hash: 'reports' },
      { label: 'טפסים', url: `${base}/#forms`, hash: 'forms' },
      { label: 'ניהול', url: `${base}/#management`, hash: 'management' },
      { label: 'הגדרות', url: `${base}/#settings`, hash: 'settings' },
    ]},
    { title: '🌐 ציבורי', links: [
      { label: 'שלב 1 · טופס הרשמת מועמדים', url: `${base}/register/`, hash: null },
      { label: 'שלב 2 · עדכון קו״ח + בחירת ארגון', url: `${base}/cv-update/`, hash: null },
      { label: 'שלב 2 · רשימת הארגונים', url: `${base}/organizations`, hash: null },
      { label: 'המערכת הישנה (v1)', url: 'https://itzkovichyariv-star.github.io/Practicum/', hash: null },
    ]},
    { title: '🛠 ניהול Supabase', links: [
      { label: 'SQL Editor', url: 'https://supabase.com/dashboard/project/vpqgmcmavnszcnakhiat/sql/new', hash: null },
      { label: 'טבלאות', url: 'https://supabase.com/dashboard/project/vpqgmcmavnszcnakhiat/editor', hash: null },
      { label: 'משתמשים', url: 'https://supabase.com/dashboard/project/vpqgmcmavnszcnakhiat/auth/users', hash: null },
    ]},
    { title: '📚 קוד', links: [
      { label: 'GitHub repo', url: 'https://github.com/itzkovichyariv-star/Practicum-v2', hash: null },
    ]},
  ];
  return (
    <section className="mb-14">
      <div className="flex items-baseline justify-between gap-8 mb-6 pb-3 border-b" style={{ borderColor: 'var(--divider)' }}>
        <h2 className="serif text-[26px] tracking-tight" style={{ color: 'var(--ink)' }}>קישורים מהירים</h2>
      </div>
      <div className="quick-links-grid grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-8">
        {sections.map(sec => (
          <div key={sec.title}>
            <div className="chapter-mark mb-3" style={{ fontSize: '11px' }}>{sec.title}</div>
            <ul className="space-y-1">
              {sec.links.map(l => <LinkRow key={l.label} label={l.label} url={l.url} hash={l.hash as any} />)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function LinkRow({ label, url, hash }: { label: string; url: string; hash: string | null }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); return; } catch {}
    }
    try {
      const ta = document.createElement('textarea'); ta.value = url; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta); setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { alert('העתקה לא אפשרית'); }
  }
  function openPage() {
    if (hash) { localStorage.setItem('practicum_v2_page', hash); window.location.reload(); }
    else window.open(url, '_blank');
  }
  return (
    <li className="flex items-center gap-2 py-1 text-[13.5px]">
      <button onClick={openPage} className="flex-1 text-right hover:opacity-70" style={{ color: 'var(--ink)' }}>{label}</button>
      <button onClick={copy} title="העתק קישור"
        className="mono text-[10px] uppercase tracking-[0.14em] font-semibold px-2 py-0.5 rounded-full border hover:bg-[rgba(122,30,43,0.08)]"
        style={{ borderColor: 'var(--divider)', color: copied ? 'var(--accent)' : 'var(--text-soft)' }}>
        {copied ? '✓' : 'העתק'}
      </button>
    </li>
  );
}

function RegistrationLinkCard() {
  const [copied, setCopied] = useState(false);
  const [base, setBase] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined')
      setBase(window.location.origin + window.location.pathname.replace(/\/?(?:[a-z]+\/?)?$/i, '/'));
  }, []);
  const COURSE_PARAM = encodeURIComponent('פרקטיקום משאבי אנוש');
  const YEAR_PARAM   = encodeURIComponent('תשפ״ז');
  const link = base
    ? `${base.replace(/\/$/, '')}/register/?course=${COURSE_PARAM}&year=${YEAR_PARAM}`
    : `https://practicum-v2.pages.dev/register/?course=${COURSE_PARAM}&year=${YEAR_PARAM}`;
  const displayLink = base
    ? `${base.replace(/\/$/, '')}/register/?course=פרקטיקום משאבי אנוש&year=תשפ״ז`
    : `https://practicum-v2.pages.dev/register/?course=פרקטיקום משאבי אנוש&year=תשפ״ז`;
  async function copy() {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); return; } catch {}
    }
    try {
      const ta = document.createElement('textarea'); ta.value = link; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      if (document.execCommand('copy')) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
      document.body.removeChild(ta);
    } catch { alert('העתק ידנית'); }
  }
  return (
    <section className="mb-10 rounded-2xl border p-7" style={{ borderColor: 'var(--accent)', background: 'rgba(122,30,43,0.04)' }}>
      <div className="flex items-start justify-between gap-6 mb-4">
        <div>
          <div className="chapter-mark mb-2" style={{ fontSize: '11px' }}>Public Form</div>
          <h2 className="serif text-[26px] leading-[1.15] tracking-tight" style={{ color: 'var(--ink)' }}>טופס הרשמה למועמדים</h2>
          <p className="text-[14px] mt-2 leading-[1.55]" style={{ color: 'var(--ink)', opacity: 0.82 }}>
            קישור ציבורי להפצה. מועמדים ממלאים פרטים ומעלים CV + טופס מועמדות — ההגשות מופיעות ב‑"מועמדים" → Inbox.
          </p>
        </div>
        <span className="serif text-[34px] leading-none shrink-0">📝</span>
      </div>
      <div className="flex flex-col gap-2">
        <div id="reg-link-display" className="w-full mono text-[12.5px] px-4 py-2.5 rounded-lg select-all"
          style={{ background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--divider)', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>{displayLink}</div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={copy} className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-4 py-2.5 rounded-lg"
            style={{ background: 'var(--accent)', color: 'var(--bg)' }}>{copied ? '✓ הועתק' : '📋 העתק'}</button>
          <a href={link} target="_blank" rel="noopener"
            className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-4 py-2.5 rounded-lg border"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>פתח ↗</a>
        </div>
      </div>
      <div className="mono text-[11px] uppercase tracking-[0.14em] mt-4" style={{ color: 'var(--text-soft)' }}>
        שלח במייל · WhatsApp · הטמע באתר הפקולטה
      </div>
    </section>
  );
}

function CopyOpenRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); return; } catch {}
    }
    try {
      const ta = document.createElement('textarea'); ta.value = url; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      if (document.execCommand('copy')) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
      document.body.removeChild(ta);
    } catch { alert('העתק ידנית'); }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="mono text-[10.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--text-soft)' }}>{label}</div>
      <div className="w-full mono text-[12.5px] px-4 py-2.5 rounded-lg select-all"
        style={{ background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--divider)', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>{url}</div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={copy} className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-4 py-2.5 rounded-lg"
          style={{ background: 'var(--accent)', color: 'var(--bg)' }}>{copied ? '✓ הועתק' : '📋 העתק'}</button>
        <a href={url} target="_blank" rel="noopener"
          className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold px-4 py-2.5 rounded-lg border"
          style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>פתח ↗</a>
      </div>
    </div>
  );
}

function Stage2LinkCard() {
  const [base, setBase] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined')
      setBase(window.location.origin + window.location.pathname.replace(/\/?(?:[a-z]+\/?)?$/i, '/'));
  }, []);
  const root = (base ? base.replace(/\/$/, '') : 'https://practicum.yarivitzkovich.org');
  const cvLink  = `${root}/cv-update/`;
  const orgLink = `${root}/organizations`;
  return (
    <section className="mb-10 rounded-2xl border p-7" style={{ borderColor: 'var(--accent)', background: 'rgba(122,30,43,0.04)' }}>
      <div className="flex items-start justify-between gap-6 mb-4">
        <div>
          <div className="chapter-mark mb-2" style={{ fontSize: '11px' }}>Public Form · Stage 2</div>
          <h2 className="serif text-[26px] leading-[1.15] tracking-tight" style={{ color: 'var(--ink)' }}>עדכון קו״ח + בחירת ארגון</h2>
          <p className="text-[14px] mt-2 leading-[1.55]" style={{ color: 'var(--ink)', opacity: 0.82 }}>
            נשלח למועמדים שהתקבלו (לאחר הסדנה). המועמד מעלה קו״ח מעודכן ומציין העדפת ארגון — ההגשות נקלטות אוטומטית בכרטיס הסטודנט.
            הקישור האישי לכל מועמד נשלח גם ממסך "מועמדים".
          </p>
        </div>
        <span className="serif text-[34px] leading-none shrink-0">🎓</span>
      </div>
      <div className="flex flex-col gap-5">
        <CopyOpenRow label="טופס עדכון קו״ח (שלב 2)" url={cvLink} />
        <CopyOpenRow label="רשימת הארגונים לעיון" url={orgLink} />
      </div>
    </section>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────── */

export default function FormsPage(props: PageProps) {
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [customForms, setCustomForms] = useState<FormDef[]>([]);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<string>(''); // '' = blank form

  const allForms = [...BUILTIN_FORMS, ...customForms];
  const students = props.data.students || [];
  const courses = props.data.courses || [];

  // Build FormContext from selected student
  const selectedStudent = students.find(s => s.id === selectedStudentId);
  const formCtx: FormContext | undefined = selectedStudent ? {
    name: selectedStudent.name,
    phone: selectedStudent.phone,
    email: selectedStudent.email,
    city: selectedStudent.city,
    courseName: courses.find(c => c.id === selectedStudent.courseId)?.name,
    year: selectedStudent.year,
    org: selectedStudent.acceptedOrg,
    hoursReported: selectedStudent.hoursReported ? String(selectedStudent.hoursReported) : undefined,
    hoursApproved: selectedStudent.hoursApproved ? String(selectedStudent.hoursApproved) : undefined,
  } : undefined;

  const filenameSuffix = selectedStudent ? `-${selectedStudent.name.replace(/\s+/g, '-')}` : '';

  function addCustomForm() {
    if (!newTitle.trim()) return;
    setCustomForms([...customForms, {
      key: 'custom-' + Date.now(),
      title: newTitle.trim(),
      description: newDesc.trim() || 'טופס מותאם אישית',
      emoji: '📄',
      filename: 'טופס-מותאם',
      bodyFn: () => `<h1>${newTitle.trim()}</h1>`,
    }]);
    setNewTitle(''); setNewDesc(''); setAdding(false);
  }

  return (
    <main className="max-w-[1200px] mx-auto px-4 md:px-10 pt-10 pb-28">

      <section className="pt-4 pb-10 border-b mb-10" style={{ borderColor: 'var(--divider)' }}>
        <div className="chapter-mark mb-4">IX · טפסים</div>
        <h1 className="serif text-[30px] sm:text-[44px] leading-[1.08] tracking-tight mb-3" style={{ color: 'var(--ink)' }}>טפסים</h1>
        <p className="text-[15px] sm:text-[17.5px] max-w-[620px] leading-[1.55]" style={{ color: 'var(--ink)', opacity: 0.8 }}>
          ספרייה של טפסים מוכנים — הדפסה/PDF בדפדפן, או הורדה כקובץ Word לעריכה.
        </p>
      </section>

      <RegistrationLinkCard />
      <Stage2LinkCard />

      {/* ── Student picker ── */}
      <section className="mb-8 rounded-xl border p-5" style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.35)' }}>
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1">
            <div className="mono text-[11px] uppercase tracking-[0.16em] font-semibold mb-1.5" style={{ color: 'var(--text-soft)' }}>
              הכנת טופס עבור
            </div>
            <select
              value={selectedStudentId}
              onChange={e => setSelectedStudentId(e.target.value)}
              className="input w-full"
              style={{ padding: '10px 16px', fontSize: '14.5px' }}>
              <option value="">📄 טופס נקי — ללא שם (מולא ידנית)</option>
              {students.map(s => {
                const course = courses.find(c => c.id === s.courseId);
                return (
                  <option key={s.id} value={s.id}>
                    {s.name}{course ? ' · ' + course.name : ''}{s.acceptedOrg ? ' · ' + s.acceptedOrg : ''}
                  </option>
                );
              })}
            </select>
          </div>
          {selectedStudent && (
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg shrink-0"
              style={{ background: 'rgba(90,154,90,0.1)', border: '1px solid rgba(90,154,90,0.3)' }}>
              <span style={{ color: '#3a7a3a', fontSize: '18px' }}>✓</span>
              <div>
                <div className="mono text-[11px] uppercase tracking-[0.13em] font-semibold" style={{ color: '#3a7a3a' }}>
                  טופס מוכן עבור
                </div>
                <div className="serif text-[17px]" style={{ color: '#1a4a1a' }}>{selectedStudent.name}</div>
              </div>
              <button onClick={() => setSelectedStudentId('')}
                className="opacity-50 hover:opacity-100 mr-1"
                style={{ color: '#3a7a3a' }}>✕</button>
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
        {allForms.map(f => (
          <div key={f.key}
            className="rounded-xl border p-6"
            style={{ borderColor: 'var(--divider)', background: 'rgba(255,255,255,0.3)' }}>
            <div className="flex items-start gap-4">
              <div className="serif text-[32px] leading-none shrink-0">{f.emoji}</div>
              <div className="flex-1">
                <div className="serif text-[22px] tracking-tight mb-1" style={{ color: 'var(--ink)' }}>
                  {f.title}
                </div>
                <p className="text-[13.5px] leading-[1.5] mb-4" style={{ color: 'var(--text-soft)' }}>
                  {f.description}
                </p>

                {/* Action buttons */}
                <div className="form-card-actions flex flex-wrap gap-2">

                  {/* Interactive built-in form (evaluation only) */}
                  {f.builtin && selectedStudent && (
                    <button onClick={() => setOpenForm(f.key)}
                      className="mono text-[11px] uppercase tracking-[0.13em] font-semibold px-3 py-1.5 rounded-full"
                      style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
                      ✎ פתח טופס אינטראקטיבי
                    </button>
                  )}

                  {/* Print in browser */}
                  <button
                    onClick={() => openInBrowser(f.bodyFn(formCtx), f.title + (selectedStudent ? ` — ${selectedStudent.name}` : ''))}
                    className="mono text-[11px] uppercase tracking-[0.13em] font-semibold px-3 py-1.5 rounded-full border hover:bg-[rgba(122,30,43,0.06)]"
                    style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                    🖨 {selectedStudent ? `הדפס עם שם` : 'הדפס / PDF'}
                  </button>

                  {/* Download as Word */}
                  <button
                    onClick={() => downloadAsWord(f.bodyFn(formCtx), f.title, f.filename + filenameSuffix)}
                    className="mono text-[11px] uppercase tracking-[0.13em] font-semibold px-3 py-1.5 rounded-full border hover:bg-[rgba(122,30,43,0.06)]"
                    style={{ borderColor: 'var(--divider)', color: 'var(--ink)' }}>
                    ⬇ Word (.doc)
                  </button>

                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Add custom form */}
        {!adding ? (
          <button onClick={() => setAdding(true)}
            className="rounded-xl p-6 border-2 border-dashed text-right hover:bg-[rgba(122,30,43,0.04)]"
            style={{ borderColor: 'var(--divider)' }}>
            <div className="serif text-[22px] tracking-tight mb-1" style={{ color: 'var(--accent)' }}>+ הוסף טופס חדש</div>
            <p className="text-[13.5px]" style={{ color: 'var(--text-soft)' }}>הגדר טופס מותאם אישית.</p>
          </button>
        ) : (
          <div className="rounded-xl p-5 border-2 border-dashed" style={{ borderColor: 'var(--accent)' }}>
            <div className="chapter-mark mb-3" style={{ fontSize: '11px' }}>טופס חדש</div>
            <div className="space-y-3">
              <div>
                <span className="small-caps block mb-1.5">כותרת</span>
                <input value={newTitle} onChange={e=>setNewTitle(e.target.value)} className="input w-full" placeholder="כותרת הטופס" style={{ padding: '10px 14px', fontSize: '14px' }}/>
              </div>
              <div>
                <span className="small-caps block mb-1.5">תיאור</span>
                <input value={newDesc} onChange={e=>setNewDesc(e.target.value)} className="input w-full" placeholder="אופציונלי" style={{ padding: '10px 14px', fontSize: '14px' }}/>
              </div>
              <div className="flex gap-2">
                <button onClick={addCustomForm} style={{
                  display: 'inline-block', padding: '12px 22px', fontSize: '13px', fontWeight: 600,
                  background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '999px',
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                }}>הוסף →</button>
                <button onClick={() => { setAdding(false); setNewTitle(''); setNewDesc(''); }}
                  className="mono text-[11.5px] uppercase tracking-[0.14em] font-semibold opacity-60 hover:opacity-100">בטל</button>
              </div>
            </div>
          </div>
        )}
      </section>

      <p className="text-[13px] mt-4 leading-[1.55]" style={{ color: 'var(--text-soft)' }}>
        💡 טופס הערכה עם פרטי סטודנט ספציפי — פתח את כרטיס הסטודנט/ית במודול "סטודנטים" ולחץ על "🖨 טופס הערכה".
      </p>

      {/* ── Admin links (minimal) ── */}
      <div className="mt-16 pt-6 border-t flex flex-wrap gap-x-6 gap-y-2" style={{ borderColor: 'var(--divider)' }}>
        {[
          { label: 'SQL Editor', url: 'https://supabase.com/dashboard/project/vpqgmcmavnszcnakhiat/sql/new' },
          { label: 'טבלאות Supabase', url: 'https://supabase.com/dashboard/project/vpqgmcmavnszcnakhiat/editor' },
          { label: 'GitHub', url: 'https://github.com/itzkovichyariv-star/Practicum-v2' },
        ].map(l => (
          <a key={l.label} href={l.url} target="_blank" rel="noopener"
            className="mono text-[11px] uppercase tracking-[0.14em] font-semibold hover:opacity-70"
            style={{ color: 'var(--text-soft)' }}>
            {l.label} ↗
          </a>
        ))}
      </div>

      {openForm === 'evaluation' && selectedStudent && (
        <EvaluationForm
          student={selectedStudent}
          courses={props.data.courses || []}
          employers={props.data.employers || []}
          onClose={() => setOpenForm(null)}
        />
      )}
    </main>
  );
}

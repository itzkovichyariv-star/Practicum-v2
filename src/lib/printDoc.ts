/**
 * Print / save-as-PDF that works where `window.print()` does not.
 *
 * Yariv 2026-10-06: "הדפסת דוחות לא עובדת … הכפתור לא מגיב". The app runs installed on his
 * phone (manifest `display: standalone`), and there `window.print()` on the app's own page
 * is a silent no-op — no dialog, no error, nothing. `window.open('', '_blank')` +
 * `document.write` fails the same way (it returns null in a standalone web app), which
 * is why FormsPage already opens a blob URL through an anchor instead.
 *
 * So a printable thing is a DOCUMENT of its own: clean RTL HTML, opened in a new tab by
 * an anchor click inside the user's tap (never blocked), printing itself on load, and
 * carrying its own visible "הדפס / שמור PDF" button for when auto-print is suppressed —
 * in Safari's share sheet that is also where "Save to Files" as PDF lives.
 */

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function printableTableHtml(title: string, headers: unknown[], rows: unknown[][], subtitle = ''): string {
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c) || '—'}</td>`).join('')}</tr>`).join('');
  return `<h1>${esc(title)}</h1>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function printableDocument(title: string, bodyHtml: string): string {
  const style = `
    *{box-sizing:border-box}
    body{font-family:Arial,'Segoe UI',sans-serif;direction:rtl;color:#1a1a1a;margin:0;padding:24px;font-size:12pt;background:#fff}
    h1{font-size:18pt;margin:0 0 4pt;color:#7a1e2b}
    .sub{font-size:10pt;color:#777;margin-bottom:14pt}
    table{width:100%;border-collapse:collapse;font-size:10pt}
    th,td{border:0.5pt solid #ccc;padding:5pt 7pt;text-align:right;vertical-align:top}
    th{background:#f5f0f0;font-weight:700}
    tr{page-break-inside:avoid}
    .bar{position:sticky;top:0;display:flex;gap:8px;justify-content:flex-start;padding:10px 0 14px;background:#fff}
    .bar button{font:inherit;font-size:14px;padding:10px 16px;border-radius:10px;border:1px solid #7a1e2b;background:#7a1e2b;color:#fff;cursor:pointer}
    @media print{.bar{display:none}body{padding:0}@page{size:A4;margin:1.2cm}}`;
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${style}</style></head>
<body><div class="bar"><button type="button" onclick="window.print()">🖨 הדפס / שמור PDF</button></div>
${bodyHtml}
<script>window.addEventListener('load',function(){setTimeout(function(){try{window.print()}catch(e){}},400)});<\/script>
</body></html>`;
}

/** Open a printable document in a new tab. Call it straight from the click handler. */
export function openPrintable(title: string, bodyHtml: string): void {
  const blob = new Blob([printableDocument(title, bodyHtml)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Open an already-complete HTML document in a new tab, adding the print button and
 *  auto-print if it has none. For the editors that build their own full page. */
export function openHtmlDocument(fullHtml: string, autoPrint = true): void {
  let html = fullHtml;
  if (autoPrint && !/window\.print\(\)/.test(html)) {
    const extra = `<div class="__bar" style="padding:10px 0 14px"><button type="button" onclick="window.print()" style="font:inherit;font-size:14px;padding:10px 16px;border-radius:10px;border:1px solid #7a1e2b;background:#7a1e2b;color:#fff;cursor:pointer">🖨 הדפס / שמור PDF</button></div>`
      + `<style>@media print{.__bar{display:none}}</style>`
      + `<script>window.addEventListener('load',function(){setTimeout(function(){try{window.print()}catch(e){}},400)});<\/script>`;
    html = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (m) => m + extra) : extra + html;
  }
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * A real PDF of a table, made in the browser with no library.
 *
 * Yariv 2026-10-06, after the printable page shipped: "נפתח חלון חדש עם שמור והדפס ושוב
 * הוא לא מגיב". On his phone the app runs installed, and NOTHING there can print a web
 * page — not the app's own page, not a page it opens. What the phone can do is take a
 * FILE: hand it a PDF and the share sheet offers Print, Save to Files, Mail.
 *
 * So the table is drawn onto canvas pages (the browser lays out the Hebrew itself, right
 * to left, in a system font — no font embedding, no shaping code), each page becomes a
 * JPEG, and the JPEGs are wrapped in a minimal PDF written by hand below. Everything is
 * synchronous on purpose: iOS lets navigator.share() run only inside the tap that asked
 * for it, and an `await` before it would lose that.
 */

const PT = 2.5;                       // canvas pixels per PDF point — sharp enough to print

interface Page { jpeg: Uint8Array; w: number; h: number; pw: number; ph: number }

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= max || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  // A single word wider than the cell: cut it by characters rather than overflow.
  return lines.flatMap((l) => {
    if (ctx.measureText(l).width <= max) return [l];
    const out: string[] = []; let s = '';
    for (const ch of l) { if (ctx.measureText(s + ch).width > max && s) { out.push(s); s = ch; } else s += ch; }
    if (s) out.push(s);
    return out;
  });
}

function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function renderPages(title: string, subtitle: string, headers: string[], rows: string[][]): Page[] {
  const landscape = headers.length > 5;
  const pw = landscape ? 842 : 595, ph = landscape ? 595 : 842;   // A4, points
  const M = 28, FONT = 8.5, HFONT = 8.5, PAD = 4, LINE = FONT * 1.35;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(pw * PT); canvas.height = Math.round(ph * PT);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(PT, PT);
  const family = 'Arial, "Arial Hebrew", "Noto Sans Hebrew", "Segoe UI", sans-serif';

  // Column widths: share of the usable width by the longest text in each column.
  ctx.font = `${FONT}pt ${family}`;
  const usable = pw - 2 * M;
  const want = headers.map((h, c) => {
    const longest = Math.max(ctx.measureText(String(h)).width,
      ...rows.slice(0, 400).map((r) => ctx.measureText(String(r[c] ?? '')).width));
    return Math.min(Math.max(longest + 2 * PAD, 34), 170);
  });
  const sum = want.reduce((a, b) => a + b, 0);
  const widths = want.map((w) => (w / sum) * usable);

  const pages: Page[] = [];
  let y = 0, first = true;
  const start = () => {
    ctx.setTransform(PT, 0, 0, PT, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pw, ph);
    ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    y = M;
    if (first) {
      ctx.fillStyle = '#7a1e2b'; ctx.font = `bold 15pt ${family}`;
      ctx.fillText(title, pw - M, y); y += 22;
      if (subtitle) { ctx.fillStyle = '#777'; ctx.font = `${FONT}pt ${family}`; ctx.fillText(subtitle, pw - M, y); y += 16; }
      y += 4;
    }
    drawRow(headers, true);
  };
  const flush = () => {
    pages.push({ jpeg: dataUrlBytes(canvas.toDataURL('image/jpeg', 0.88)), w: canvas.width, h: canvas.height, pw, ph });
    first = false;
  };
  const cellLines = (cells: string[], head: boolean) => {
    ctx.font = `${head ? 'bold ' : ''}${head ? HFONT : FONT}pt ${family}`;
    return cells.map((t, c) => wrap(ctx, String(t ?? '') || (head ? '' : '—'), widths[c] - 2 * PAD));
  };
  function drawRow(cells: string[], head = false) {
    const lines = cellLines(cells, head);
    const h = Math.max(...lines.map((l) => l.length)) * LINE + 2 * PAD;
    if (head) { ctx.fillStyle = '#f5f0f0'; ctx.fillRect(M, y, usable, h); }
    ctx.strokeStyle = '#cfcfcf'; ctx.lineWidth = 0.5;
    let xRight = pw - M;
    for (let c = 0; c < cells.length; c++) {
      ctx.strokeRect(xRight - widths[c], y, widths[c], h);
      ctx.fillStyle = head ? '#1a1a1a' : (cells[c] ? '#1a1a1a' : '#999');
      lines[c].forEach((ln, i) => ctx.fillText(ln, xRight - PAD, y + PAD + i * LINE));
      xRight -= widths[c];
    }
    y += h;
  }

  start();
  for (const r of rows) {
    const cells = headers.map((_, c) => String(r[c] ?? ''));
    const h = Math.max(...cellLines(cells, false).map((l) => l.length)) * LINE + 2 * PAD;
    if (y + h > ph - M) { flush(); start(); }
    drawRow(cells);
  }
  flush();
  return pages;
}

/** Minimal PDF: one JPEG image per page, drawn full-page. */
function writePdf(pages: Page[]): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; chunks.push(u); pos += u.length; };
  const obj = (n: number, body: () => void) => { offsets[n] = pos; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length;
  // 1 catalog, 2 pages, then per page: page, content, image
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
  pages.forEach((p, i) => {
    const pageN = 3 + i * 3, contN = pageN + 1, imgN = pageN + 2;
    obj(pageN, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.pw} ${p.ph}] /Resources << /XObject << /Im${i} ${imgN} 0 R >> >> /Contents ${contN} 0 R >>`));
    const content = `q ${p.pw} 0 0 ${p.ph} 0 0 cm /Im${i} Do Q`;
    obj(contN, () => { push(`<< /Length ${content.length} >>\nstream\n`); push(content); push('\nendstream'); });
    obj(imgN, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg); push('\nendstream');
    });
  });
  const total = 3 + n * 3;
  const xref = pos;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

export function tablePdf(title: string, subtitle: string, headers: unknown[], rows: unknown[][]): Blob {
  return writePdf(renderPages(title, subtitle, headers.map(String), rows.map((r) => r.map((c) => String(c ?? '')))));
}

// Shared helpers for the practicum visual audit suite.
//
// Mirrors the family-tasks audit-lib pattern (see
// ~/.claude/projects/-Users-yarivitzkovich-Downloads/memory/skill_visual_deploy_audit.md)
// adapted for:
//   • Astro 5 + React + Supabase stack
//   • localhost:4325 dev server
//   • Existing auth via localStorage injection (mirrors auth.setup.ts)
//   • Supabase REST queries (instead of wrangler d1)
//
// Convention:
//   import { Audit } from './audit-lib.mjs';
//   const audit = new Audit({ name: 'registration' });
//   await audit.setup();
//   audit.assertSeed(...)              // verify DB matches expectation
//   await audit.page.goto(...)
//   audit.observerMark()               // start capturing console/network errors
//   ...interactions...
//   const obs = audit.observerSnapshot();
//   audit.recordCell({ ... });
//   await audit.teardown();

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

export const ROOT = '/Users/yarivitzkovich/Code/practicum-v2';
// Default target is the dev server; set AUDIT_BASE_URL to run a cell against another
// origin (e.g. AUDIT_BASE_URL=https://practicum.yarivitzkovich.org to verify PRODUCTION
// after a deploy — the DB/storage are the same project either way).
export const BASE_URL = process.env.AUDIT_BASE_URL || 'http://localhost:4325';

// Supabase project — same constants the app uses. The publishable
// "anon" key is intentionally readable; RLS gates real access.
const SUPABASE_URL = 'https://vpqgmcmavnszcnakhiat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_qzAiDZ6UTTaT-9xR_TxK0g_QKUIUsRt';

// ─── DB helpers (Supabase PostgREST) ──────────────────────────────────
//
// Direct PostgREST against the anon key. Reads are gated by RLS, so the
// audit user must have an authenticated session OR the table must allow
// anon SELECT. For tables that are auth-only (most of them), use
// `sbAuthed` after audit.setup() so the request carries the bearer.
//
// dbExec is for INSERT/UPDATE/DELETE via PostgREST. Heavy lifting
// (truncate / bulk reset) is best done in SQL Editor; the audit only
// needs targeted seed mutations.
export async function sbQuery(table, { filter = '', select = '*', headers = {} } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}${filter ? '&' + filter : ''}`;
  const r = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      ...headers,
    },
  });
  if (!r.ok) throw new Error(`sbQuery ${table} failed ${r.status}: ${await r.text().catch(() => '')}`);
  return r.json();
}

export async function sbInsert(table, row, { headers = {} } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...headers,
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`sbInsert ${table} failed ${r.status}: ${await r.text().catch(() => '')}`);
  return r.json();
}

export async function sbDelete(table, filter, { headers = {} } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}`;
  const r = await fetch(url, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      ...headers,
    },
  });
  if (!r.ok && r.status !== 404) {
    throw new Error(`sbDelete ${table} failed ${r.status}: ${await r.text().catch(() => '')}`);
  }
}

// ─── The Audit class ─────────────────────────────────────────────────
export class Audit {
  constructor({ name, baseUrl = BASE_URL, slowMo = 250, viewport = { width: 1400, height: 900 } }) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.slowMo = slowMo;
    this.viewport = viewport;
    this.ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.out = `/tmp/practicum-audit-${name}-${this.ts}`;
    this.cells = [];
    this._consoleErrors = [];
    this._pageErrors = [];
    this._netFailures = [];
  }

  log(msg) {
    const t = Math.round((Date.now() - this.startMs) / 1000);
    process.stdout.write(`+${String(t).padStart(3, ' ')}s [${this.name}] ${msg}\n`);
  }

  async setup() {
    this.startMs = Date.now();
    mkdirSync(this.out, { recursive: true });
    this.log(`OUT = ${this.out}`);
    // Headless by default so audit runs don't steal window focus / pop up windows.
    // Opt into a visible browser with AUDIT_HEADED=1 when you want to watch.
    const headed = process.env.AUDIT_HEADED === '1';
    this.log(headed ? 'Launching headed Chromium...' : 'Launching headless Chromium (set AUDIT_HEADED=1 to watch)...');
    this.browser = await chromium.launch({ headless: !headed, slowMo: headed ? this.slowMo : 0 });
    this.ctx = await this.browser.newContext({
      viewport: this.viewport,
      locale: 'he-IL',
      timezoneId: 'Asia/Jerusalem',
    });

    // NEVER send real emails from an audit. The notify-* Supabase edge functions
    // send via Resend (a metered daily quota); stub them so any cell that submits
    // a form (registration, org-suggestion, …) costs zero quota. Returns a fake
    // 200 so the client-side success path still runs.
    await this.ctx.route(/\/functions\/v1\/notify-(submission|acceptance|org-suggestion)/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"stubbed":true}' }).catch(() => {}));

    this.page = await this.ctx.newPage();

    // Universal error observers. Console/page errors / network failures
    // captured between observerMark() and observerSnapshot() are
    // attributed to the cell that called them, so each cell can assert
    // "and no errors fired during this interaction."
    this.page.on('console', (m) => {
      if (m.type() === 'error') {
        const text = m.text();
        // Filter known-noisy messages.
        if (/Failed to load resource.*[4-5]\d{2}/.test(text)) return;       // any 4xx/5xx HTTP noise
        if (/Hydration completed but contains mismatches/.test(text)) return;
        if (/A tree hydrated but/.test(text)) return;                       // React hydration warning
        if (/Hostname \/api was supplied/.test(text)) return;               // Astro dev quirk
        // Supabase RLS 401/403 on tables an unauthenticated visitor can't see
        if (/JSON object requested.*0 rows/.test(text)) return;
        if (/permission denied for/.test(text)) return;
        if (/PGRST116|PGRST204/.test(text)) return;                         // PostgREST "no rows" codes
        // React duplicate-key warnings — bug was fixed 2026-05-28 (Select
        // component now deduplicates options + uses index keys). Filter
        // removed so future regressions are caught as real failures.
        this._consoleErrors.push(text);
      }
    });
    this.page.on('pageerror', (e) => this._pageErrors.push(String(e)));
    this.page.on('requestfailed', (req) => {
      const url = req.url();
      if (/favicon\.ico|\.map$/.test(url)) return;
      this._netFailures.push(`${req.method()} ${url} — ${req.failure()?.errorText || 'failed'}`);
    });

    // Auth via localStorage injection — mirrors e2e/auth.setup.ts so we
    // skip the UI login form. The audit acts as the "yarivi@ariel.ac.il"
    // admin user who has read/write access to all tables under RLS.
    await this.page.goto(`${this.baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await this.page.evaluate(() => {
      localStorage.setItem('practicum_v2_session', JSON.stringify({
        profile: { name: 'יריב בדיקה', email: 'yarivi@ariel.ac.il' },
      }));
      localStorage.setItem('practicum_v2_context', JSON.stringify({
        courseId: '__all__', year: '__all__',
      }));
    });
    await this.page.reload({ waitUntil: 'networkidle' });
    this.log('Logged in (admin session injected)');
  }

  async teardown() {
    await this.writeReport();
    await this.ctx.close().catch(() => {});
    await this.browser.close().catch(() => {});
    const pass = this.cells.filter((c) => c.pass === true).length;
    const failed = this.cells.filter((c) => c.pass === false);
    const total = this.cells.length;
    this.log(`Report: ${this.out}/report.html  (${pass}/${total} pass)`);

    // A failing CELL has to fail the SUITE. Until 2026-08-10 teardown() only printed the
    // tally, so a suite with red cells still exited 0 and the gate announced "PASSED" —
    // only a crash ever failed it. Two real reds rode through exactly that way
    // (STRIP-mixed-actions, QUEUE-lists-who-waits) on a run reported green. `pass: null`
    // stays non-fatal: an honest "could not check" is not a failure.
    if (failed.length) {
      this.log(`❌ ${failed.length} cell(s) failed: ${failed.map((c) => c.id).join(', ')}`);
      process.exitCode = 1;
    }
  }

  observerMark() {
    this._consoleErrors.length = 0;
    this._pageErrors.length = 0;
    this._netFailures.length = 0;
    this._reactKeyWarnings = 0;
  }

  observerSnapshot() {
    return {
      consoleErrors: [...this._consoleErrors],
      pageErrors: [...this._pageErrors],
      netFailures: [...this._netFailures],
      // Counted separately so cells can surface this known issue
      // without it failing the gate (until the underlying bug is fixed).
      reactKeyWarnings: this._reactKeyWarnings || 0,
    };
  }

  // assertSeed: run a list of SQL-ish checks. Each entry is
  //   { query: () => Promise<Array>, expect: object | (rows) => boolean, label }
  // Returns array of failure strings (empty if all passed).
  async assertSeed(checks) {
    const fails = [];
    for (const { query, expect, label } of checks) {
      try {
        const rows = await query();
        if (typeof expect === 'function') {
          if (!expect(rows)) fails.push(`${label}: predicate failed on ${JSON.stringify(rows).slice(0, 200)}`);
        } else {
          const row = rows?.[0];
          if (!row) { fails.push(`${label}: no row`); continue; }
          for (const k of Object.keys(expect)) {
            const want = expect[k];
            const got = row[k] === undefined ? 'undefined' : row[k] === null ? 'null' : String(row[k]);
            const wantStr = String(want);
            if (got !== wantStr) fails.push(`${label}.${k}: want=${wantStr} got=${got}`);
          }
        }
      } catch (e) {
        fails.push(`${label}: query threw — ${e.message.slice(0, 120)}`);
      }
    }
    return fails;
  }

  async shot(name) {
    const p = `${this.out}/${name}.png`;
    await this.page.screenshot({ path: p, fullPage: false }).catch(() => {});
    return p;
  }

  recordCell({ id, tableRef = '', expected, observed, pass, before, after, notes = '' }) {
    this.cells.push({ id, tableRef, expected, observed, pass, before, after, notes });
    const tick = pass === true ? '✅' : pass === false ? '❌' : '⏸';
    this.log(`  → ${tick} ${id}: ${observed}`);
  }

  async writeReport() {
    const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"/><title>Practicum audit — ${this.name}</title>
<style>
body { font-family: -apple-system, system-ui, sans-serif; padding: 20px; background: #fafafa; }
table { border-collapse: collapse; width: 100%; margin-top: 12px; background: white; }
th, td { padding: 10px; border-bottom: 1px solid #eee; vertical-align: top; text-align: start; }
th { background: #333; color: white; }
.pass { color: #0a7; font-weight: bold; }
.fail { color: #c33; font-weight: bold; }
.skip { color: #888; }
.cell-id { font-weight: 600; }
img { max-width: 320px; border: 1px solid #ddd; }
pre { white-space: pre-wrap; font-size: 12px; margin: 0; }
</style></head>
<body>
<h1>Practicum audit — ${this.name}</h1>
<p>Generated ${new Date().toISOString()}. Pass = expected outcome verified, Fail = mismatch, Skip = couldn't run.</p>
<table>
<thead><tr><th>#</th><th>Cell</th><th>Ref</th><th>Expected</th><th>Observed</th><th>Notes</th><th>Before</th><th>After</th></tr></thead>
<tbody>
${this.cells.map((c, i) => `
<tr>
<td>${i + 1}</td>
<td class="cell-id ${c.pass === true ? 'pass' : c.pass === false ? 'fail' : 'skip'}">${c.id}<br>${c.pass === true ? '✅' : c.pass === false ? '❌' : '⏸'}</td>
<td>${c.tableRef}</td>
<td><pre>${escapeHtml(c.expected)}</pre></td>
<td><pre>${escapeHtml(c.observed)}</pre></td>
<td><pre>${escapeHtml(c.notes)}</pre></td>
<td>${c.before ? `<img src="${c.before.replace(this.out + '/', '')}"/>` : ''}</td>
<td>${c.after ? `<img src="${c.after.replace(this.out + '/', '')}"/>` : ''}</td>
</tr>
`).join('')}
</tbody></table>
</body></html>`;
    writeFileSync(`${this.out}/report.html`, html);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Edge Function: notify-submission
// Deploy via Supabase Dashboard → Functions → Create → paste this.
// Requires secret: RESEND_API_KEY

// deno-lint-ignore-file no-explicit-any
const ADMIN_TO = ['yarivi@ariel.ac.il', 'rachelshal@ariel.ac.il'];
const FROM = 'Practicum <onboarding@resend.dev>'; // swap to verified domain later
const RESEND_URL = 'https://api.resend.com/emails';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://vpqgmcmavnszcnakhiat.supabase.co';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Fail loudly if the API key is missing — surface the error to the client
  // instead of silently returning 200 with no email sent.
  if (!RESEND_API_KEY) {
    const msg = 'RESEND_API_KEY secret is not set on this function';
    console.error(msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload = await req.json().catch(() => ({} as any));
  const rec = payload.record ?? payload ?? {};

  const name = rec.name ?? '';
  const email = rec.email ?? '';
  const phone = rec.phone ?? '';
  const city = rec.city ?? '';
  const courseName = rec.course_name ?? '';
  const year = rec.year ?? '';
  const notes = rec.notes ?? '';
  const cvPath = rec.cv_file_path ?? '';
  const appPath = rec.application_file_path ?? '';

  // Build signed URLs for the uploaded files (valid 7 days)
  const cvUrl = cvPath ? await signedUrl(cvPath, 60 * 60 * 24 * 7) : '';
  const appUrl = appPath ? await signedUrl(appPath, 60 * 60 * 24 * 7) : '';

  // Extract slot info from notes if present
  const slotMatch = String(notes).match(/בחר מועד ראיון:\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?:–\d{1,2}:\d{2})?)/);
  const slotDate = slotMatch?.[1];
  const slotTime = slotMatch?.[2];

  const slotBlock = slotDate
    ? `<div style="background:rgba(122,30,43,.06);border:1px solid #7a1e2b;padding:16px;border-radius:10px;margin:16px 0">
         <div style="font-size:12px;color:#7a1e2b;letter-spacing:.1em;text-transform:uppercase">מועד ראיון שנבחר</div>
         <div style="font-size:20px;margin-top:4px">${escapeHtml(slotDate)} · ${escapeHtml(slotTime || '')}</div>
       </div>`
    : '';

  const results: any = {};

  // Email to candidate — with admins on CC so they see confirmation + slot too
  if (email) {
    const candidateHtml = `
      <div dir="rtl" style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px">
        <h2 style="color:#7a1e2b">תודה, ${escapeHtml(name)}</h2>
        <p>המועמדות נקלטה במערכת הפרקטיקום של אוניברסיטת אריאל.</p>
        ${slotDate ? slotBlock : `<p>הצוות ייצור איתך קשר תוך מספר ימים לתיאום מועד ראיון.</p>`}
        <p style="color:#666;font-size:13px;margin-top:24px">בברכה,<br>ד"ר יריב איצקוביץ<br>Ariel University · Management</p>
      </div>
    `;

    results.candidate = await sendMail({
      to: email,
      cc: ADMIN_TO,
      subject: `✓ קיבלנו את הגשתך — ${courseName || 'פרקטיקום'}${slotDate ? ' · מועד ראיון ' + slotDate : ''}`,
      html: candidateHtml,
    });
  }

  // Separate admin-only email with full details + download links (always sent, independent of candidate email)
  const adminHtml = buildAdminBody(rec, cvUrl, appUrl, slotBlock);
  results.admin = await sendMail({
    to: ADMIN_TO,
    subject: `📥 הגשה חדשה: ${name}${slotDate ? ' · ראיון ' + slotDate + ' ' + (slotTime||'') : ''}`,
    html: adminHtml,
  });

  // If any send failed, return 500 with details so the client can surface the error
  const allOk = Object.values(results).every((r: any) => r?.ok);
  if (!allOk) {
    return new Response(JSON.stringify({ ok: false, results }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

async function sendMail(msg: { to: string | string[]; cc?: string[]; subject: string; html: string }): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not set' };
  const r = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: Array.isArray(msg.to) ? msg.to : [msg.to],
      cc: msg.cc,
      subject: msg.subject,
      html: msg.html,
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    console.error('Resend error:', r.status, body);
    return { ok: false, error: `Resend ${r.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true };
}

async function signedUrl(path: string, expiresIn: number): Promise<string> {
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/candidate-uploads/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn }),
  });
  if (!r.ok) return '';
  const j = await r.json();
  return `${SUPABASE_URL}/storage/v1${j.signedURL || j.signedUrl || ''}`;
}

function buildAdminBody(rec: any, cvUrl: string, appUrl: string, slotBlock: string): string {
  return `
    <div dir="rtl" style="font-family:system-ui,sans-serif;max-width:600px;margin:auto;padding:24px">
      <h2 style="color:#7a1e2b">הגשה חדשה — ${escapeHtml(rec.name || '')}</h2>
      ${slotBlock}
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:#666;width:90px">טלפון</td><td>${escapeHtml(rec.phone || '')}</td></tr>
        <tr><td style="padding:6px 0;color:#666">מייל</td><td>${escapeHtml(rec.email || '')}</td></tr>
        <tr><td style="padding:6px 0;color:#666">עיר</td><td>${escapeHtml(rec.city || '')}</td></tr>
        <tr><td style="padding:6px 0;color:#666">קורס</td><td>${escapeHtml(rec.course_name || '')}</td></tr>
        <tr><td style="padding:6px 0;color:#666">שנה</td><td>${escapeHtml(rec.year || '')}</td></tr>
        <tr><td style="padding:6px 0;color:#666">הערות</td><td>${escapeHtml(rec.notes || '')}</td></tr>
      </table>
      <p style="margin-top:20px;font-size:14px">
        ${cvUrl ? `<a href="${cvUrl}" style="color:#7a1e2b;font-weight:600">📄 הורד CV</a>` : '<span style="color:#999">אין CV</span>'}
        &nbsp;·&nbsp;
        ${appUrl ? `<a href="${appUrl}" style="color:#7a1e2b;font-weight:600">📝 הורד טופס מועמדות</a>` : '<span style="color:#999">אין טופס</span>'}
      </p>
      <p style="margin-top:24px;font-size:12px;color:#999">
        הקישורים תקפים לשבוע. לגישה קבועה היכנס למערכת הניהול →
        <a href="https://itzkovichyariv-star.github.io/Practicum-v2/" style="color:#7a1e2b">מועמדים → Inbox</a>
      </p>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

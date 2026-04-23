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

  // Email to candidate
  if (email) {
    const candidateHtml = `
      <div dir="rtl" style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px">
        <h2 style="color:#7a1e2b">תודה, ${escapeHtml(name)}</h2>
        <p>המועמדות נקלטה במערכת הפרקטיקום של אוניברסיטת אריאל.</p>
        ${slotDate ? `
          <div style="background:rgba(122,30,43,.06);border:1px solid #7a1e2b;padding:16px;border-radius:10px;margin:16px 0">
            <div style="font-size:12px;color:#7a1e2b;letter-spacing:.1em;text-transform:uppercase">מועד הראיון שנבחר</div>
            <div style="font-size:20px;margin-top:4px">${escapeHtml(slotDate)} · ${escapeHtml(slotTime || '')}</div>
          </div>
        ` : `<p>הצוות ייצור איתך קשר תוך מספר ימים לתיאום מועד ראיון.</p>`}
        <p style="color:#666;font-size:13px;margin-top:24px">בברכה,<br>ד"ר יריב איצקוביץ<br>Ariel University · Management</p>
      </div>
    `;

    await sendMail({
      to: email,
      cc: ADMIN_TO,
      subject: `✓ קיבלנו את הגשתך — ${courseName || 'פרקטיקום'}`,
      html: candidateHtml,
    });
  }

  // Admin-only email (in case candidate had no email)
  if (!email) {
    const adminHtml = buildAdminBody(rec, cvUrl, appUrl);
    await sendMail({
      to: ADMIN_TO,
      subject: `הגשה חדשה: ${name} — ${courseName}`,
      html: adminHtml,
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

async function sendMail(msg: { to: string | string[]; cc?: string[]; subject: string; html: string }) {
  if (!RESEND_API_KEY) { console.warn('RESEND_API_KEY not set'); return; }
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
  if (!r.ok) console.warn('Resend error:', await r.text());
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

function buildAdminBody(rec: any, cvUrl: string, appUrl: string): string {
  return `
    <div dir="rtl" style="font-family:system-ui,sans-serif;max-width:600px;margin:auto;padding:24px">
      <h2 style="color:#7a1e2b">הגשה חדשה — ${escapeHtml(rec.name || '')}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:#666">טלפון</td><td>${escapeHtml(rec.phone || '')}</td></tr>
        <tr><td style="padding:6px 0;color:#666">מייל</td><td>${escapeHtml(rec.email || '')}</td></tr>
        <tr><td style="padding:6px 0;color:#666">עיר</td><td>${escapeHtml(rec.city || '')}</td></tr>
        <tr><td style="padding:6px 0;color:#666">קורס</td><td>${escapeHtml(rec.course_name || '')}</td></tr>
        <tr><td style="padding:6px 0;color:#666">שנה</td><td>${escapeHtml(rec.year || '')}</td></tr>
        <tr><td style="padding:6px 0;color:#666">הערות</td><td>${escapeHtml(rec.notes || '')}</td></tr>
      </table>
      <p style="margin-top:20px">
        ${cvUrl ? `<a href="${cvUrl}" style="color:#7a1e2b">📄 CV</a>` : ''}
        ${appUrl ? ` · <a href="${appUrl}" style="color:#7a1e2b">📝 טופס מועמדות</a>` : ''}
      </p>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

// Supabase Edge Function — Candidate Submission Notification
// Sends:
//   1. Confirmation email to the candidate
//   2. Admin notification (with file links) to coordinatorEmail + supervisorEmail
//
// Deploy: supabase functions deploy notify-submission
// Secrets: RESEND_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { record } = await req.json();
    if (!record) return new Response(JSON.stringify({ ok: false, error: 'no record' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      console.warn('RESEND_API_KEY not set');
      return new Response(JSON.stringify({ ok: true, sent: false, reason: 'no key' }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // Load coordinator + supervisor emails from practicum_data
    const { data: row } = await supabase.from('practicum_data').select('data').eq('org_id', 'default').single();
    const d = (row?.data || {}) as any;
    const coordEmail: string    = d.coordinatorEmail || '';
    const supervisorEmail: string = d.supervisorEmail || 'itzkovichyariv@gmail.com';

    const submittedAt = record.submittedAt || record.submitted_at
      ? new Date(record.submittedAt || record.submitted_at).toLocaleString('he-IL')
      : new Date().toLocaleString('he-IL');

    const candidateName: string = record.name || 'מועמד/ת';
    const cvPath: string        = record.cv_file_path || record.cvUrl || '';
    const appPath: string       = record.application_file_path || record.applicationUrl || '';

    // Build public storage URL from path
    function storageUrl(path: string): string {
      if (!path) return '';
      if (path.startsWith('http')) return path;
      return `https://vpqgmcmavnszcnakhiat.supabase.co/storage/v1/object/public/candidate-uploads/${path}`;
    }

    const results: Record<string, any> = {};

    // ── 1. Confirmation to candidate ────────────────────────────────────
    if (record.email) {
      const course = record.course_name || record.courseId || '';
      // The booked slot is recorded in `notes` as "בחר מועד ראיון: <date> <start>–<end>".
      const note = String(record.notes || '');
      const slotMatch = note.match(/בחר מועד ראיון:\s*(.+)/);
      const bookedSlot = slotMatch ? slotMatch[1].trim() : '';

      const interviewSection = bookedSlot
        ? `
          <div style="background:#fff;border-radius:8px;padding:16px;margin:18px 0;border:1px solid #7a1e2b">
            <div style="color:#7a1e2b;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:6px">מועד הראיון שבחרת</div>
            <div style="font-size:18px;font-weight:bold;color:#3d0f14">📅 ${bookedSlot}</div>
            <div style="font-size:13px;color:#666;margin-top:8px">נא להגיע במועד שנבחר. אם יש צורך לשנות — ניתן לפנות אלינו.</div>
          </div>`
        : `
          <div style="background:#fff;border-radius:8px;padding:16px;margin:18px 0;border:1px solid #e8e0d5;line-height:1.65">
            <p style="margin:0 0 8px;font-size:15px">מאחר ולא היו מועדי ראיון פנויים לבחירה בעת ההגשה, יש <strong>ליצור קשר ביוזמתך</strong> עם מנחה הפרקטיקום לתיאום מועד ראיון:</p>
            <div style="font-size:15px;font-weight:bold">ד״ר יריב איצקוביץ · <a href="mailto:yarivi@ariel.ac.il" style="color:#7a1e2b">yarivi@ariel.ac.il</a></div>
            <div style="font-size:13px;color:#666;margin-top:8px">בכל שאלה או בעיה אחרת ניתן לפנות לד״ר יריב איצקוביץ או לרחל שליו.</div>
          </div>`;

      const confirmHtml = `
        <!DOCTYPE html><html dir="rtl" lang="he">
        <head><meta charset="UTF-8"></head>
        <body style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;color:#3d0f14;background:#f4efe6;direction:rtl">
          <div style="border-bottom:2px solid #7a1e2b;padding-bottom:14px;margin-bottom:20px">
            <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7a1e2b;margin-bottom:5px">פרקטיקום · אוניברסיטת אריאל</div>
            <h1 style="font-family:Georgia,serif;font-size:26px;margin:0;color:#3d0f14">קיבלנו את מועמדותך!</h1>
          </div>
          <p style="font-size:15px;line-height:1.65">שלום ${candidateName},</p>
          <p style="font-size:15px;line-height:1.65">
            טופס המועמדות וקורות החיים שלך לפרקטיקום <strong>${course}</strong> נקלטו בהצלחה.
          </p>
          ${interviewSection}
          ${cvPath || appPath ? `
          <div style="background:#fff;border-radius:8px;padding:14px 16px;margin:20px 0;border:1px solid #e8e0d5;font-size:13px">
            <div style="color:#888;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px">קבצים שהועלו</div>
            ${cvPath ? `<div>📄 קורות חיים — <a href="${storageUrl(cvPath)}" style="color:#7a1e2b">צפייה</a></div>` : ''}
            ${appPath ? `<div style="margin-top:4px">📋 טופס מועמדות — <a href="${storageUrl(appPath)}" style="color:#7a1e2b">צפייה</a></div>` : ''}
          </div>
          ` : ''}
          <div style="margin-top:28px;padding-top:14px;border-top:1px solid #ddd;font-size:13px;color:#555">
            בברכה,<br>
            <strong>רחל שליו</strong><br>
            רכזת פרקטיקום · המחלקה לניהול · אוניברסיטת אריאל
          </div>
        </body></html>
      `;

      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'practicum@yarivitzkovich.org',
          to: [record.email],
          subject: `אישור קבלת מועמדות — ${candidateName}`,
          html: confirmHtml,
        }),
      });
      results.candidate = await r.json();
    }

    // ── 2. Admin notification (to coordinator + supervisor) ─────────────
    const adminRecipients = [coordEmail, supervisorEmail].filter(Boolean);
    if (adminRecipients.length > 0) {
      const fileRows = [
        cvPath  ? `<tr><td style="padding:5px 12px 5px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:.08em">CV</td><td><a href="${storageUrl(cvPath)}" style="color:#7a1e2b">פתח ↗</a></td></tr>` : '',
        appPath ? `<tr><td style="padding:5px 12px 5px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:.08em">טופס</td><td><a href="${storageUrl(appPath)}" style="color:#7a1e2b">פתח ↗</a></td></tr>` : '',
      ].filter(Boolean).join('');

      const adminHtml = `
        <!DOCTYPE html><html dir="rtl" lang="he">
        <head><meta charset="UTF-8"></head>
        <body style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#3d0f14;background:#f4efe6;direction:rtl">
          <div style="border-bottom:2px solid #7a1e2b;padding-bottom:14px;margin-bottom:20px">
            <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7a1e2b;margin-bottom:5px">פרקטיקום · הגשה חדשה</div>
            <h1 style="font-family:Georgia,serif;font-size:26px;margin:0;color:#3d0f14">מועמד/ת חדש/ה: ${candidateName}</h1>
            <div style="font-size:12px;color:#888;margin-top:4px">${submittedAt}</div>
          </div>
          <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:14px">
            <tr><td style="padding:5px 12px 5px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:.08em">שם</td><td style="font-weight:bold">${candidateName}</td></tr>
            <tr><td style="padding:5px 12px 5px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:.08em">מייל</td><td>${record.email || '—'}</td></tr>
            <tr><td style="padding:5px 12px 5px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:.08em">טלפון</td><td>${record.phone || '—'}</td></tr>
            <tr><td style="padding:5px 12px 5px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:.08em">עיר</td><td>${record.city || '—'}</td></tr>
            <tr><td style="padding:5px 12px 5px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:.08em">קורס</td><td>${record.course_name || record.courseId || '—'}</td></tr>
            <tr><td style="padding:5px 12px 5px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:.08em">שנה</td><td>${record.year || '—'}</td></tr>
            ${fileRows}
          </table>
          ${record.notes ? `<div style="background:#fff;border-radius:8px;padding:12px 14px;font-size:13px;border:1px solid #e8e0d5"><div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px">הערות</div>${record.notes}</div>` : ''}
          <div style="margin-top:24px;padding-top:14px;border-top:1px solid #ddd;font-size:11px;color:#aaa;letter-spacing:.1em;text-transform:uppercase">
            פרקטיקום · אוניברסיטת אריאל · נשלח אוטומטית
          </div>
        </body></html>
      `;

      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'practicum@yarivitzkovich.org',
          to: adminRecipients,
          subject: `הגשה חדשה — ${candidateName}`,
          html: adminHtml,
        }),
      });
      results.admin = await r.json();
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});

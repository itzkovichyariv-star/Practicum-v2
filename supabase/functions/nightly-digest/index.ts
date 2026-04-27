// Supabase Edge Function — Nightly Practicum Digest
// Deploy: supabase functions deploy nightly-digest
// Schedule (supabase/config.toml):
//   [functions.nightly-digest]
//   schedule = "0 17 * * *"   # 20:00 Israel time (UTC+3)
//
// Required secrets (set via: supabase secrets set KEY=value):
//   RESEND_API_KEY  — from resend.com
//   DIGEST_TO       — recipient email (e.g. itzkovichyariv@gmail.com)
//   SUPABASE_URL    — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async () => {
  try {
    // Load practicum data
    const { data: row, error } = await supabase
      .from('practicum_data')
      .select('data')
      .eq('org_id', 'default')
      .single();

    if (error || !row) {
      return new Response('no data', { status: 500 });
    }

    const data = row.data;
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    // 1. Tomorrow's lectures
    const tomorrowLectures = (data.lectures || []).filter((l: any) =>
      l.date === tomorrowStr && l.status !== 'בוטל'
    );

    // 2. Candidates with no interview date and not failed
    const candidatesWaiting = (data.candidates || []).filter((c: any) =>
      !c.interviewDate && c.interviewResult !== 'failed'
    );

    // 3. Students who passed prep but have no placement
    const readyNotPlaced = (data.students || []).filter((s: any) =>
      s.preparation?.passed && !s.acceptedOrg && !s.hired
    );

    // 4. Employers with open positions
    const openEmployers = (data.employers || []).filter((e: any) => {
      const total = Number(e.positions) || 0;
      const filled = Number(e.filledPositions) || 0;
      return total > 0 && filled < total;
    });

    // Build HTML email
    const sections: string[] = [];

    if (tomorrowLectures.length > 0) {
      sections.push(`
        <h2 style="color:#7a1e2b;font-family:Georgia,serif;font-size:20px;margin:24px 0 8px">📅 הרצאות מחר (${tomorrowLectures.length})</h2>
        <ul style="padding-right:20px;line-height:1.7">
          ${tomorrowLectures.map((l: any) =>
            `<li><strong>${l.topic || 'הרצאה'}</strong> · ${l.lecturer || '—'} · ${l.startTime || ''} · ${l.location || ''}</li>`
          ).join('')}
        </ul>
      `);
    }

    if (candidatesWaiting.length > 0) {
      sections.push(`
        <h2 style="color:#7a1e2b;font-family:Georgia,serif;font-size:20px;margin:24px 0 8px">⏳ מועמדים ממתינים לראיון (${candidatesWaiting.length})</h2>
        <ul style="padding-right:20px;line-height:1.7">
          ${candidatesWaiting.slice(0, 10).map((c: any) =>
            `<li>${c.name} · ${c.phone || '—'}</li>`
          ).join('')}
          ${candidatesWaiting.length > 10 ? `<li style="color:#888">ועוד ${candidatesWaiting.length - 10}...</li>` : ''}
        </ul>
      `);
    }

    if (readyNotPlaced.length > 0) {
      sections.push(`
        <h2 style="color:#7a1e2b;font-family:Georgia,serif;font-size:20px;margin:24px 0 8px">🎓 מוכנים לשיבוץ — טרם שובצו (${readyNotPlaced.length})</h2>
        <ul style="padding-right:20px;line-height:1.7">
          ${readyNotPlaced.slice(0, 10).map((s: any) =>
            `<li>${s.name} · ${s.phone || '—'}</li>`
          ).join('')}
        </ul>
      `);
    }

    if (openEmployers.length > 0) {
      sections.push(`
        <h2 style="color:#7a1e2b;font-family:Georgia,serif;font-size:20px;margin:24px 0 8px">🏢 מעסיקים עם משרות פתוחות (${openEmployers.length})</h2>
        <ul style="padding-right:20px;line-height:1.7">
          ${openEmployers.slice(0, 8).map((e: any) => {
            const open = (Number(e.positions) || 0) - (Number(e.filledPositions) || 0);
            return `<li>${e.name} · ${open} פתוחות</li>`;
          }).join('')}
        </ul>
      `);
    }

    if (sections.length === 0) {
      sections.push('<p style="color:#888">אין פריטים דחופים להיום.</p>');
    }

    const dateStr = now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const html = `
      <!DOCTYPE html>
      <html dir="rtl" lang="he">
      <head><meta charset="UTF-8"></head>
      <body style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#3d0f14;background:#f4efe6;direction:rtl">
        <div style="border-bottom:2px solid #7a1e2b;padding-bottom:16px;margin-bottom:20px">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#7a1e2b;margin-bottom:6px">פרקטיקום · ניהול</div>
          <h1 style="font-family:Georgia,serif;font-size:28px;margin:0;color:#3d0f14">סיכום יומי</h1>
          <div style="font-size:13px;color:#888;margin-top:4px">${dateStr}</div>
        </div>
        ${sections.join('\n')}
        <div style="margin-top:32px;padding-top:16px;border-top:1px solid #ddd;font-size:11px;color:#aaa;letter-spacing:0.12em;text-transform:uppercase">
          פרקטיקום · אוניברסיטת אריאל · נשלח אוטומטית
        </div>
      </body>
      </html>
    `;

    // Send via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const recipient = Deno.env.get('DIGEST_TO') || 'itzkovichyariv@gmail.com';

    if (!resendKey) {
      console.warn('RESEND_API_KEY not set — skipping email send');
      return new Response(JSON.stringify({ ok: true, sent: false, reason: 'no key' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'practicum@yarivitzkovich.org',
        to: recipient,
        subject: `סיכום פרקטיקום — ${dateStr}`,
        html,
      }),
    });

    const emailData = await emailRes.json();
    return new Response(JSON.stringify({ ok: true, sent: true, emailData }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

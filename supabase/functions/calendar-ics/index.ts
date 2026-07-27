// Supabase Edge Function — Interview Slots ICS Calendar Feed
// Returns a .ics calendar file with all interview slots.
// Subscribe to this URL in Outlook / Google Calendar / Apple Calendar:
//   https://vpqgmcmavnszcnakhiat.supabase.co/functions/v1/calendar-ics
//
// Deploy: supabase functions deploy calendar-ics --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function fmtDt(date: string, time: string): string {
  // "2026-05-25" + "09:00" → "20260525T090000"
  return date.replace(/-/g, '') + 'T' + time.replace(':', '') + '00';
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const { data: slots, error } = await supabase
    .from('public_interview_slots')
    .select('*')
    .order('date')
    .order('start_time');

  if (error) {
    return new Response('Error: ' + error.message, { status: 500 });
  }

  const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';

  // Interview Zoom links, so a subscribed calendar event is one tap from joining.
  // Per-day link wins, else the permanent default room — the SAME resolution the
  // candidate's confirmation screen/email uses (RegistrationForm / notify-submission).
  let zoomLinks: Record<string, string> = {};
  let zoomDefault = '';
  try {
    const { data: pd } = await supabase.from('practicum_data').select('data').eq('org_id', 'default').single();
    zoomLinks = ((pd as any)?.data?.interviewZoomLinks) || {};
    zoomDefault = String((pd as any)?.data?.interviewZoomLinkDefault || '').trim();
  } catch (_) { /* non-fatal — events simply carry no join link */ }
  const zoomFor = (d: string): string => String(zoomLinks[String(d).slice(0, 10)] || zoomDefault || '').trim();

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Practicum//Interview Slots//HE',
    'X-WR-CALNAME:מועדי ראיון — פרקטיקום',
    'X-WR-TIMEZONE:Asia/Jerusalem',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const slot of (slots || [])) {
    const full = slot.booked_count >= slot.capacity;
    const noteStr = slot.note ? ` — ${slot.note}` : '';
    const summary = slot.booked_by
      ? `ראיון: ${slot.booked_by}${noteStr}`
      : full
        ? `ראיון פרקטיקום${noteStr} (תפוס)`
        : `ראיון פרקטיקום${noteStr} (פנוי)`;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:slot-${slot.id}@practicum.yarivitzkovich.org`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART;TZID=Asia/Jerusalem:${fmtDt(slot.date, slot.start_time)}`);
    lines.push(`DTEND;TZID=Asia/Jerusalem:${fmtDt(slot.date, slot.end_time)}`);
    lines.push(`SUMMARY:${escapeIcs(summary)}`);
    lines.push(`STATUS:${full ? 'CONFIRMED' : 'TENTATIVE'}`);
    const zoom = zoomFor(slot.date);
    if (zoom) {
      lines.push(`LOCATION:${escapeIcs(zoom)}`);
      lines.push(`URL:${escapeIcs(zoom)}`);
    }
    const desc = [slot.note || '', zoom ? `קישור לראיון בזום: ${zoom}` : ''].filter(Boolean).join(' — ');
    if (desc) lines.push(`DESCRIPTION:${escapeIcs(desc)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return new Response(lines.join('\r\n'), {
    headers: {
      ...CORS,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="practicum-interviews.ics"',
    },
  });
});

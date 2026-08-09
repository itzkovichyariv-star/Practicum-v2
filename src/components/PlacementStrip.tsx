/**
 * The placement strip — one line per student row saying where they stand and whose
 * move it is, so the list reads as a work queue instead of a roster.
 *
 * Design: docs/design/2026-08-09-placement-status-strip.md (approved 2026-08-09).
 * The state itself comes from lib/placementStatus.ts — this file only renders it.
 *
 * Two rules from Yariv that shape the layout:
 *  · "the line that explains the status is the one that is most important" — the
 *    sentence is the primary element; the turn label and colour are scanning aids.
 *  · every action opens a warning naming its consequence before anything happens.
 *
 * Org chips are tappable: they open the employer's real contact details, including for
 * an org a student proposed themselves (Yariv 2026-08-09 — those were unreachable, so
 * he could not simply phone the contact instead of firing a templated message).
 */

import { useEffect, useRef, useState } from 'react';
import type { PlacementStatus, PlacementChip, PlacementAction } from '../lib/placementStatus';
import { TURN_LABEL, TURN_COLOR, actionsForChip } from '../lib/placementStatus';
import { openWhatsApp } from '../lib/placement';
import { openMailto } from '../lib/openMailto';
import { PhoneIcon, WhatsAppIcon, MailIcon } from './icons';

const TONE_STYLE: Record<PlacementChip['tone'], { color: string; border: string; bg: string }> = {
  plain: { color: 'var(--text-soft)', border: 'var(--divider)', bg: 'transparent' },
  sent:  { color: '#3b5a8f', border: 'rgba(59,90,143,0.45)', bg: 'transparent' },
  late:  { color: '#b91c1c', border: 'rgba(185,28,28,0.55)', bg: 'rgba(185,28,28,0.07)' },
  dead:  { color: 'var(--text-soft)', border: 'var(--divider)', bg: 'transparent' },
  pass:  { color: '#15803d', border: 'rgba(21,128,61,0.5)', bg: 'transparent' },
};

function EmployerDetails({ emp, orgName, onClose }: { emp: any | null; orgName: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [onClose]);

  const phone = emp?.contactPhone || '';
  const email = emp?.contactEmail || '';
  const btn: React.CSSProperties = {
    display: 'inline-grid', placeItems: 'center', width: 34, height: 34, borderRadius: '50%',
    border: '0.5px solid rgba(122,30,43,0.25)', background: 'var(--bg)', color: 'var(--accent)', cursor: 'pointer',
  };

  return (
    <div ref={ref} data-employer-details={orgName}
      style={{
        position: 'absolute', zIndex: 40, insetInlineStart: 0, top: 'calc(100% + 6px)',
        width: 'min(320px, 88vw)', background: 'var(--bg)', border: '1px solid var(--divider)',
        borderRadius: 12, boxShadow: '0 16px 40px rgba(61,15,20,0.18)', padding: '13px 15px', textAlign: 'right',
      }}>
      <div className="serif" style={{ fontSize: 17, color: 'var(--ink)', marginBottom: 2 }}>{emp?.name || orgName}</div>
      {!emp && (
        <div style={{ fontSize: 12.5, color: '#b45309' }}>
          הארגון לא נמצא ברשימת המעסיקים — ייתכן שהשם בדירוג אינו תואם.
        </div>
      )}
      {emp && (
        <>
          {emp.restrictedToStudentId && (
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>
              🔒 ארגון פרטי — בהצעת הסטודנט/ית
            </div>
          )}
          <div style={{ fontSize: 13, lineHeight: 1.75, color: 'var(--ink)' }}>
            {emp.contactPerson && <div><span style={{ color: 'var(--text-soft)' }}>איש קשר: </span><b>{emp.contactPerson}</b></div>}
            {phone && <div><span style={{ color: 'var(--text-soft)' }}>טלפון: </span><span dir="ltr">{phone}</span></div>}
            {email && <div style={{ wordBreak: 'break-all' }}><span style={{ color: 'var(--text-soft)' }}>מייל: </span><span dir="ltr">{email}</span></div>}
            {emp.location && <div><span style={{ color: 'var(--text-soft)' }}>מיקום: </span>{emp.location}</div>}
            {!emp.contactPerson && !phone && !email && (
              <div style={{ color: '#b45309' }}>לא הוזנו פרטי קשר לארגון הזה.</div>
            )}
          </div>
          {emp.notes && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--divider)', fontSize: 12, lineHeight: 1.6, color: 'var(--text-soft)', maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
              {emp.notes}
            </div>
          )}
          {(phone || email) && (
            <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
              {phone && <button type="button" title={`התקשר ל${emp.contactPerson || emp.name}`} style={btn}
                onClick={() => { window.location.href = `tel:${phone.replace(/[^\d+]/g, '')}`; }}><PhoneIcon size={15} /></button>}
              {phone && <button type="button" title="WhatsApp — הודעה חופשית" style={btn}
                onClick={() => openWhatsApp(phone, { name: emp.name })}><WhatsAppIcon size={15} /></button>}
              {email && <button type="button" title="מייל — הודעה חופשית" style={btn}
                onClick={() => openMailto(`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`פרקטיקום — ${emp.name}`)}`)}><MailIcon size={15} /></button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConfirmDialog({ action, tone, onCancel, onConfirm }: {
  action: PlacementAction; tone: string; onCancel: () => void; onConfirm: () => void;
}) {
  const goRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    goRef.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onCancel]);

  const [body, warn] = action.warnBody.split('\n⚠ ');
  return (
    <div onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onCancel(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(26,22,18,0.55)' }}>
      <div role="dialog" aria-modal="true" data-placement-confirm={action.id}
        style={{ background: 'var(--bg)', border: '1px solid var(--divider)', borderRadius: 16, maxWidth: 470, width: '100%', padding: '22px 24px', textAlign: 'right', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
        <div className="mono" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.13em', color: tone, marginBottom: 6 }}>
          אישור פעולה
        </div>
        <div className="serif" style={{ fontSize: 23, color: 'var(--ink)', marginBottom: 10 }}>{action.warnTitle}</div>
        <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--text-soft)', margin: 0 }}>{body}</p>
        {warn && (
          <div style={{ marginTop: 10, padding: '8px 11px', borderRadius: 8, background: 'rgba(185,28,28,0.08)', color: '#b91c1c', fontWeight: 600, fontSize: 12.5 }}>
            ⚠ {warn}
          </div>
        )}
        {action.isNew && (
          <div style={{ marginTop: 10, padding: '8px 11px', borderRadius: 8, background: 'rgba(180,83,9,0.1)', color: '#b45309', fontWeight: 600, fontSize: 12.5 }}>
            פעולה חדשה — עדיין לא קיימת במערכת.
          </div>
        )}
        <div style={{ display: 'flex', gap: 9, marginTop: 18 }}>
          <button ref={goRef} type="button" data-confirm-go onClick={onConfirm}
            style={{ fontSize: 13, fontWeight: 700, padding: '8px 18px', borderRadius: 9, border: 'none', background: tone, color: '#fff', cursor: 'pointer' }}>
            {action.confirmLabel}
          </button>
          <button type="button" onClick={onCancel}
            style={{ fontSize: 13, fontWeight: 700, padding: '8px 18px', borderRadius: 9, border: '1px solid var(--divider-strong)', background: 'transparent', color: 'var(--text-soft)', cursor: 'pointer' }}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PlacementStrip({ status, employers, onAction }: {
  status: PlacementStatus;
  employers: any[];
  onAction: (action: PlacementAction) => void;
}) {
  const [openOrg, setOpenOrg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PlacementAction | null>(null);
  // Which org the action will act on. Mirrors the card's own tick-then-send mechanism
  // (OrgHub's data-send-cv checkbox) — Yariv 2026-08-09: "מסמנים את אחת הבחירות ושולחים
  // לה". Seeded with the classifier's recommendation, so the target is never ambiguous
  // even before the coordinator touches anything.
  const targets = status.chips.filter(c => c.available && (status.action?.id === 'send_cv' || status.action?.id === 'place_direct'));
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = targets.find(c => c.orgName === picked) || targets.find(c => c.recommended) || targets[0] || null;
  // An org the student brought can be approved straight into a placement OR sent a CV;
  // an org from the shared list only ever gets a CV, and reaches placement through a
  // passed interview (Yariv 2026-08-09). Selecting a list org must therefore never leave
  // "אשר השמה" on the button — the bug he caught on נישה פרו.
  const offered = chosen ? actionsForChip(chosen)
    : (status.action ? [status.action] : []);
  const tone = TURN_COLOR[status.turn];
  const tinted = status.turn === 'ours';

  const norm = (s: any) => String(s ?? '').trim().toLowerCase();
  const findEmp = (name: string) =>
    (employers || []).find((e: any) => e?.name === name)
    || (employers || []).find((e: any) => norm(e?.name) === norm(name))
    || (employers || []).find((e: any) => { const n = norm(e?.name); return !!n && (n.startsWith(norm(name)) || norm(name).startsWith(n)); })
    || null;

  return (
    <div
      data-placement-strip={status.key}
      data-turn={status.turn}
      onClick={e => e.stopPropagation()}
      style={{
        display: 'flex', gap: 13, alignItems: 'flex-start', flexWrap: 'wrap',
        margin: '0 0 12px', padding: '10px 13px 11px', borderRadius: 10,
        border: '1px solid var(--divider)', boxShadow: `inset -3px 0 0 0 ${tone}`,
        background: tinted ? 'rgba(185,28,28,0.05)' : 'transparent',
        position: 'relative',
      }}
    >
      <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: tone, whiteSpace: 'nowrap', paddingTop: 3, display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone, flexShrink: 0 }} />
        {TURN_LABEL[status.turn]}
      </span>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {/* The sentence IS the status — largest, darkest thing in the strip. */}
        <div data-strip-headline style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.5, overflowWrap: 'break-word' }}>
          {status.headline}
        </div>
        {status.sub && (
          <div style={{ fontSize: 12.5, color: 'var(--ink)', opacity: 0.72, lineHeight: 1.5 }}>{status.sub}</div>
        )}

        {status.chips.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 7px', alignItems: 'center', minWidth: 0 }}>
            {status.chips.map((c, i) => {
              const t = TONE_STYLE[c.tone];
              const emp = findEmp(c.orgName);
              const isOpen = openOrg === `${c.orgName}#${i}`;
              const selectableState = status.action?.id === 'send_cv' || status.action?.id === 'place_direct';
              const isTarget = selectableState && c.available;
              const selectable = isTarget && targets.length > 1;
              const isChosen = isTarget && chosen?.orgName === c.orgName;
              return (
                <span key={`${c.orgName}#${i}`} style={{ position: 'relative', minWidth: 0, maxWidth: '100%' }}>
                  <span
                    data-org-chip={c.orgName}
                    data-org-available={c.available ? '1' : '0'}
                    data-org-selected={isTarget && chosen?.orgName === c.orgName ? '1' : '0'}
                    onClick={() => { if (selectable) setPicked(c.orgName); }}
                    style={{
                      display: 'inline-flex', alignItems: 'flex-start', gap: 6,
                      font: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '4px 9px', borderRadius: 7,
                      border: `${isChosen ? 2 : 1}px ${c.suggested ? 'dashed' : 'solid'} ${isChosen ? tone : (c.suggested ? 'var(--divider-strong)' : t.border)}`,
                      background: isChosen ? `${tone}12` : t.bg,
                      color: t.color, cursor: selectable ? 'pointer' : 'default',
                      whiteSpace: 'normal', textAlign: 'right', maxWidth: '100%',
                      overflowWrap: 'break-word', lineHeight: 1.45,
                      textDecoration: c.tone === 'dead' ? 'line-through' : 'none',
                      opacity: c.tone === 'dead' ? 0.7 : (c.available === false && selectableState ? 0.72 : 1),
                    }}>
                    {/* Rank badge — was 9.5px at 60% opacity and unreadable on a phone
                        (Yariv 2026-08-09: "המספור קטן ולא רואים"). Now a solid badge. */}
                    <span aria-label={`בחירה ${c.rank}`} style={{
                      flexShrink: 0, display: 'inline-grid', placeItems: 'center',
                      width: 17, height: 17, borderRadius: '50%', marginTop: 1,
                      background: isChosen ? tone : 'var(--accent-soft)',
                      color: isChosen ? '#fff' : 'var(--accent)',
                      fontSize: 10.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                    }}>{c.rank}</span>
                    <span style={{ minWidth: 0 }}>
                      {c.suggested && <span aria-hidden style={{ opacity: 0.55, fontSize: 9, marginInlineEnd: 4 }}>◆</span>}
                      <b style={{ color: c.tone === 'plain' ? 'var(--ink)' : t.color }}>{c.orgName}</b>
                      {c.suffix && <span style={{ fontWeight: 500 }}> · {c.suffix}</span>}
                      {selectableState && !c.available && c.blockedReason && (
                        <span data-org-blocked style={{ display: 'block', fontWeight: 700, color: '#b45309', fontSize: 11 }}>
                          {c.blockedReason}
                        </span>
                      )}
                    </span>
                    {/* Details stay reachable without stealing the tap that selects. */}
                    <span
                      role="button" tabIndex={0} data-org-info={c.orgName}
                      title={emp ? 'פרטי המעסיק' : 'הארגון לא נמצא ברשימת המעסיקים'}
                      onClick={e => { e.stopPropagation(); setOpenOrg(isOpen ? null : `${c.orgName}#${i}`); }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpenOrg(isOpen ? null : `${c.orgName}#${i}`); } }}
                      style={{
                        flexShrink: 0, display: 'inline-grid', placeItems: 'center', marginTop: 1,
                        width: 17, height: 17, borderRadius: '50%', cursor: 'pointer',
                        border: '1px solid var(--divider-strong)', color: 'var(--accent)',
                        fontSize: 10, fontWeight: 800,
                      }}>i</span>
                  </span>
                  {isOpen && <EmployerDetails emp={emp} orgName={c.orgName} onClose={() => setOpenOrg(null)} />}
                </span>
              );
            })}
          </div>
        )}

        {offered.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
            {offered.map((a, ai) => (
              <button
                key={a.id}
                type="button"
                data-strip-action={a.id}
                data-strip-target={chosen?.orgName || ''}
                onClick={() => setConfirm(a)}
                style={{
                  font: 'inherit', fontSize: 11.5, fontWeight: 700,
                  padding: '4px 12px', borderRadius: 7, cursor: 'pointer',
                  // The first action is the primary route; a secondary one (send a CV to
                  // an org the student brought) stays visibly subordinate.
                  background: 'transparent',
                  border: `1px ${ai === 0 ? 'solid' : 'dashed'} ${ai === 0 ? tone : 'var(--divider-strong)'}`,
                  color: ai === 0 ? tone : 'var(--text-soft)',
                }}>
                {chosen ? `${a.label} ל‑${chosen.orgName}` : a.label}
              </button>
            ))}
          </div>
        )}
        {targets.length > 1 && (
          <div style={{ fontSize: 11, color: 'var(--text-soft)', marginTop: -1 }}>
            לשליחה לארגון אחר — סמן/י אותו למעלה
          </div>
        )}
      </div>

      {status.age && (
        <div className="mono" style={{ fontSize: 11, fontWeight: 600, color: tone, paddingTop: 3, flexShrink: 0, maxWidth: '100%' }}>
          {status.age}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          action={confirm} tone={tone}
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const a = confirm; setConfirm(null); onAction(a); }}
        />
      )}
    </div>
  );
}

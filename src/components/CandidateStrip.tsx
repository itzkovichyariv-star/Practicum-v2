import { useState } from 'react';
import {
  candidateStatus, CANDIDATE_TURN_LABEL, CANDIDATE_TURN_COLOR,
  type CandidateAction, type CandidateChipTone, type CandidateStatus,
} from '../lib/candidateStatus';
import type { Candidate } from '../lib/supabase';
import { resolveCvUrl, openCv } from '../lib/cvUrl';

/**
 * The applicants-page counterpart to PlacementStrip: the status sentence, whose
 * turn it is, and the single next action — with the evaluation opening underneath.
 *
 * Deliberately the same shape as the placement strip (turn dot + label on the
 * right, sentence in the middle, action on the left, inset rule in the turn's
 * colour) because a coordinator moves between the two pages all day and a second
 * visual language would cost more than it teaches. What differs is only what the
 * chips carry: no employers here, so they carry the intake and the evaluation.
 */

const TONE_STYLE: Record<CandidateChipTone, { bg: string; border: string; color: string }> = {
  plain:   { bg: 'transparent',            border: 'var(--divider-strong)', color: 'var(--ink)' },
  good:    { bg: 'rgba(21,128,61,0.08)',   border: 'rgba(21,128,61,0.35)',  color: '#15803d' },
  weak:    { bg: 'rgba(180,83,9,0.08)',    border: 'rgba(180,83,9,0.35)',   color: '#b45309' },
  missing: { bg: 'transparent',            border: 'var(--divider)',        color: 'var(--text-soft)' },
  done:    { bg: 'rgba(59,90,143,0.08)',   border: 'rgba(59,90,143,0.32)',  color: '#3b5a8f' },
};

export default function CandidateStrip({
  candidate, enrolled, onAction, now,
}: {
  candidate: Candidate;
  enrolled: boolean;
  /** The page owns every side effect; the strip only reports which one was asked for. */
  onAction?: (action: CandidateAction) => void;
  now?: number;
}) {
  const [open, setOpen] = useState(false);
  const status: CandidateStatus | null = candidateStatus({ candidate, enrolled, now });
  if (!status) return null;

  const tone = CANDIDATE_TURN_COLOR[status.turn];
  // Only OUR overdue states tint. A candidate we are simply waiting on is not a
  // problem, and tinting it would make the page read as all-alarm.
  const tinted = status.turn === 'ours';

  return (
    <div
      data-candidate-strip={status.key}
      data-turn={status.turn}
      onClick={e => e.stopPropagation()}
      style={{
        display: 'flex', gap: 13, alignItems: 'flex-start', flexWrap: 'wrap',
        margin: '0 0 10px', padding: '9px 12px 10px', borderRadius: 10,
        border: '1px solid var(--divider)', boxShadow: `inset -3px 0 0 0 ${tone}`,
        background: tinted ? 'rgba(185,28,28,0.05)' : 'transparent',
      }}
    >
      <span className="mono" style={{
        fontSize: 10.5, fontWeight: 700, color: tone, whiteSpace: 'nowrap', paddingTop: 3,
        display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone, flexShrink: 0 }} />
        <span className="turn-label-text">{CANDIDATE_TURN_LABEL[status.turn]}</span>
      </span>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div data-strip-headline style={{
          fontSize: 14.5, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.5,
          ...(open ? { overflowWrap: 'break-word' } : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
        }}>
          {status.headline}
        </div>

        {status.sub && (
          <div style={{
            fontSize: 12.5, color: 'var(--ink)', opacity: 0.72, lineHeight: 1.5,
            ...(open ? {} : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
          }}>
            {status.sub}
          </div>
        )}

        {/* The evaluation, collapsed by default. A candidate row is a queue item first;
            the five scales and the score are what you open when you are deciding. */}
        {open && status.chips.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 7px', alignItems: 'center', minWidth: 0 }}>
            {status.chips.map((c, i) => {
              const t = TONE_STYLE[c.tone];
              const body = (
                <>
                  <span style={{ opacity: 0.7 }}>{c.label}</span>
                  <b style={{ color: t.color }}>{c.value}</b>
                </>
              );
              const style = {
                display: 'inline-flex', alignItems: 'center', gap: 5,
                font: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '4px 9px', borderRadius: 7,
                border: `1px ${c.tone === 'missing' ? 'dashed' : 'solid'} ${t.border}`,
                background: t.bg, color: t.color, lineHeight: 1.45,
                opacity: c.tone === 'missing' ? 0.75 : 1,
              } as const;
              // Resolved HERE, never in the pure status module: a stored CV is
              // `storage://bucket/path`, which a browser cannot follow, and a .docx will
              // not render inline even once resolved. Both give a blank tab.
              const href = c.fileRef ? resolveCvUrl(c.fileRef) : '';
              return href
                ? <a key={`${c.label}#${i}`} data-cand-chip={c.label} href={href}
                     target="_blank" rel="noopener noreferrer"
                     onClick={e => { e.preventDefault(); void openCv(c.fileRef); }}
                     style={{ ...style, textDecoration: 'none' }}>{body}</a>
                : <span key={`${c.label}#${i}`} data-cand-chip={c.label} style={style}>{body}</span>;
            })}
          </div>
        )}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, paddingTop: 1,
        ...(open ? { flexBasis: '100%', flexWrap: 'wrap', minWidth: 0 } : { flexShrink: 0 }),
      }}>
        {status.action && onAction && (
          <button
            type="button"
            data-strip-action={status.action.id}
            onClick={() => onAction(status.action!)}
            title={status.action.label}
            style={{
              font: 'inherit', fontSize: 11.5, fontWeight: 700,
              whiteSpace: open ? 'normal' : 'nowrap', maxWidth: '100%', overflowWrap: 'break-word',
              padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
              background: tone, border: '1px solid transparent', color: '#fff',
            }}>
            {open ? status.action.label : status.action.short}
          </button>
        )}
        {status.chips.length > 0 && (
          <button
            type="button"
            data-strip-toggle
            aria-expanded={open}
            aria-label={open ? 'סגור/י את פרטי ההערכה' : 'פתח/י את פרטי ההערכה'}
            onClick={() => setOpen(o => !o)}
            style={{
              width: 24, height: 24, borderRadius: 7, cursor: 'pointer',
              border: '1px solid var(--divider)', background: 'transparent',
              color: 'var(--text-soft)', fontSize: 11, lineHeight: 1,
            }}>
            {open ? '⌃' : '⌄'}
          </button>
        )}
      </div>
    </div>
  );
}

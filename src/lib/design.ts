/**
 * Design tokens — shared button styles and colors.
 * Import these instead of writing inline styles ad-hoc.
 * All values are plain React CSSProperties so they work with the
 * inline-style approach required by the Safari RTL bug workaround.
 */

import type { CSSProperties } from 'react';

// ── Button styles ────────────────────────────────────────────────────────────

const BASE_BTN: CSSProperties = {
  display: 'inline-block',
  fontWeight: 600,
  border: 'none',
  borderRadius: '999px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  lineHeight: 1,
  letterSpacing: '0.02em',
};

/** Filled wine — primary action */
export function btnPrimary(disabled = false): CSSProperties {
  return {
    ...BASE_BTN,
    padding: '12px 22px',
    fontSize: '13px',
    background: disabled ? 'var(--divider)' : 'var(--accent)',
    color: disabled ? 'var(--text-soft)' : 'white',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}

/** Outlined wine — secondary action */
export function btnSecondary(disabled = false): CSSProperties {
  return {
    ...BASE_BTN,
    padding: '12px 20px',
    fontSize: '12px',
    background: 'transparent',
    color: disabled ? 'var(--text-soft)' : 'var(--accent)',
    border: `1px solid ${disabled ? 'var(--divider)' : 'var(--accent)'}`,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
  };
}

/** Small outlined — tertiary / communication buttons */
export function btnSmall(disabled = false): CSSProperties {
  return {
    ...BASE_BTN,
    padding: '8px 16px',
    fontSize: '12px',
    background: 'transparent',
    color: disabled ? 'var(--text-soft)' : 'var(--accent)',
    border: `1px solid ${disabled ? 'var(--divider)' : 'var(--accent)'}`,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
  };
}

/** Tab pill — active/inactive state */
export function btnTab(active: boolean): CSSProperties {
  return {
    ...BASE_BTN,
    padding: '7px 16px',
    fontSize: '12px',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? 'white' : 'var(--text-soft)',
    border: 'none',
    borderRadius: '9px',
  };
}

/** Ghost — text-only, no border */
export function btnGhost(): CSSProperties {
  return {
    display: 'inline-block',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-soft)',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.14em',
    padding: '4px 2px',
    flexShrink: 0,
  };
}

/** Danger ghost — delete/destructive text action */
export function btnDanger(): CSSProperties {
  return {
    display: 'inline-block',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--accent)',
    fontSize: '11.5px',
    fontWeight: 600,
    letterSpacing: '0.15em',
    padding: '4px 2px',
    flexShrink: 0,
  };
}

// ── Event / calendar colors ──────────────────────────────────────────────────

export const EVENT_COLORS = {
  lecture:   { bg: 'var(--accent)',     text: 'white' },
  interview: { bg: '#0a6e44',           text: 'white' },
  prep:      { bg: '#7a5a1e',           text: 'white' },
  slot:      { bg: '#4a6b8a',           text: 'white' },
  other:     { bg: 'var(--text-soft)',  text: 'white' },
} as const;

export type EventType = keyof typeof EVENT_COLORS;

// ── Status badge styles ──────────────────────────────────────────────────────

/** Muted pill — neutral status tag */
export function tagNeutral(): CSSProperties {
  return {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.1em',
    background: 'var(--tag-neutral-bg)',
    color: 'var(--text-soft)',
    whiteSpace: 'nowrap',
  };
}

/** Wine-tinted pill — positive/active status */
export function tagAccent(): CSSProperties {
  return {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.1em',
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    whiteSpace: 'nowrap',
  };
}

/** Warning pill — orange */
export function tagWarning(): CSSProperties {
  return {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.1em',
    background: 'rgba(217,119,6,0.12)',
    color: '#b45309',
    whiteSpace: 'nowrap',
  };
}

// ── Toast colors ─────────────────────────────────────────────────────────────

export const TOAST_COLORS = {
  success: { bg: '#7a1e2b', text: 'white' },
  error:   { bg: '#7a1e2b', text: 'white' },
  warn:    { bg: '#78350f', text: 'white' },
  info:    { bg: '#1e3a5f', text: 'white' },
} as const;

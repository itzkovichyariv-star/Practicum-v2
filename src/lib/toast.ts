/**
 * Practicum · Global toast notification utility
 * Usage: showToast('הסטודנט נשמר ✓', 'success')
 * The ToastContainer in App.tsx listens for these events.
 */

export type ToastType = 'success' | 'error' | 'info' | 'warn';

export interface ToastEvent {
  msg: string;
  type: ToastType;
  duration?: number;
}

export function showToast(msg: string, type: ToastType = 'success', duration = 3500) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('practicum:toast', {
    detail: { msg, type, duration } satisfies ToastEvent,
  }));
}

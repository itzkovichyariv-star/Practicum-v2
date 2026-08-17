/**
 * Cancellation, recorded without a schema change.
 *
 * A candidate who withdraws leaves a submission that is neither "waiting" nor
 * "taken in". There is no column for that, and adding one means a migration on
 * the live database — so the state is written into the notes the submission
 * already carries. Notes are free text, appended to rather than replaced, and
 * the slot line the intake parses out of them is left untouched.
 *
 * Why it has to be recorded at all: without it, a withdrawn candidate looks
 * exactly like an intake that failed — stamped נקלט with no candidate card —
 * and the inbox would keep offering to take them in again.
 */
export const CANCELLED_MARK = '[בוטל]';

export const isCancelledSubmission = (notes?: string | null): boolean =>
  (notes || '').includes(CANCELLED_MARK);

/** Append the marker once. Cancelling twice must not stack two of them. */
export const markNotesCancelled = (notes: string | null | undefined, isoDay: string): string => {
  const current = (notes || '').trim();
  if (isCancelledSubmission(current)) return current;
  return `${current}\n${CANCELLED_MARK} ${isoDay}`.trim();
};

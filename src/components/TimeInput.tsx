import { useId, useState, type CSSProperties } from 'react';
import { parseTime } from '../lib/timeInput';

/**
 * The one time field. A plain text box read by `parseTime` — see src/lib/timeInput.ts
 * for why every native <input type="time"> in the app was replaced by this.
 *
 * What it promises:
 *   • What is typed stays exactly as typed while typing — no mask, no reformatting per
 *     keystroke, so no digit can land anywhere except where the caret is.
 *   • On leaving the field a readable time is rewritten as HH:MM ("1700" → "17:00").
 *   • An unreadable one is left as typed and explained underneath, never replaced.
 *   • It never reads the clock. An empty field stays empty.
 *
 * The parent stores the raw text and must run `parseTime` again before saving: a save
 * can come from Enter inside the field, before any blur has normalised it.
 */
type Props = {
  value: string | undefined;
  onChange: (value: string) => void;
  /** DOM id — lets a parent focus the field after a refused save. */
  id?: string;
  /** Written to data-time-input; the offline checks find the field by it. */
  name?: string;
  /** Show the error now (after a save attempt), not only once the field is left. */
  showError?: boolean;
  /** An empty field is an error, not "no time". */
  required?: boolean;
  /** false: mark the field red but leave the sentence to the parent — for fields too
   *  narrow to explain themselves (the interview-slot rows). */
  inlineError?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  style?: CSSProperties;
};

export default function TimeInput({
  value, onChange, id, name, showError, required, inlineError = true, onFocus, onBlur, placeholder = 'למשל 17:00', style,
}: Props) {
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  const autoId = useId();
  const errId = `${id || autoId}-error`;

  const text = value ?? '';
  const parsed = parseTime(text);
  const error = !parsed.ok ? parsed.error : required && !parsed.value ? 'חסרה שעה — הקלד/י למשל 09:00' : '';
  // Not while typing: "17:" is on its way to "17:30", not a mistake. After a refused
  // save the error stays up even in the focused field, so it is there to be read.
  const errorVisible = !!error && (!!showError || (touched && !focused));

  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        // An empty field is RTL so the Hebrew placeholder reads right; once there are
        // digits it is LTR, so "17:" stays "17:" instead of the bidi algorithm drawing ":17".
        dir={text.trim() ? 'ltr' : 'rtl'}
        value={text}
        placeholder={placeholder}
        aria-invalid={errorVisible || undefined}
        aria-describedby={errorVisible && inlineError ? errId : undefined}
        data-time-input={name || ''}
        onChange={e => onChange(e.target.value)}
        onFocus={() => { setFocused(true); onFocus?.(); }}
        onBlur={e => {
          setFocused(false);
          setTouched(true);
          const r = parseTime(e.target.value);
          if (r.ok && r.value !== e.target.value) onChange(r.value);
          onBlur?.();
        }}
        className="input"
        style={{
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          ...(errorVisible ? { borderColor: 'var(--tl-red)' } : null),
          ...style,
        }}
      />
      {errorVisible && inlineError && (
        <span id={errId} role="alert" data-time-error={name || ''}
          className="block mt-1.5 text-[12.5px] leading-snug" style={{ color: 'var(--tl-red)' }}>
          {error}
        </span>
      )}
    </>
  );
}

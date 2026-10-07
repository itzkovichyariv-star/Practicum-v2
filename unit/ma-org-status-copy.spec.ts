import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * The sentences Yariv dictated, pinned to the files that must say them.
 *
 * These are not paraphrases to be improved on: each is something he asked for in his own
 * words while reading the form, and a student reading the link is the only audience. The
 * form is not reachable from this sandbox, so a reworded promise fails here rather than
 * reaching the 15 students as a promise nobody kept.
 */

const form  = readFileSync(new URL('../src/components/MaPracticumForm.tsx', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../src/components/StudentEditor.tsx', import.meta.url), 'utf8');

/** The source between two markers, so a slice cannot silently run past its block. */
function between(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  expect(a, `marker missing: ${from}`).toBeGreaterThan(-1);
  return src.slice(a, b > a ? b : a + 1200);
}

test('NO ORGANIZATION: go to the practicum supervisor, and the door stays open', () => {
  // "באין ארגון כרגע צריך להיות כתוב אנא פנה למנחה הפרקטיקום לתיאום ובתוספת אפשר לחזור
  //  בכל רגע נתון ולהוסיף ארגון"
  const panel = between(form, 'data-ma-none-panel', 'data-ma-status-note');
  expect(panel).toContain('מנחה התכנית');
  expect(panel).toContain('לתיאום');
  expect(panel).toContain('בכל רגע נתון');
  expect(panel).toContain('להוסיף ארגון');
  // And the confirmation screen says the same, rather than something else.
  const next = between(form, 'data-ma-next', 'data-ma-note-lost');
  expect(next).toContain('מנחה התכנית');
  expect(next).toContain('בכל רגע נתון');
  expect(next).toContain('להוסיף ארגון');
});

test('HOLD: come back and update the form when the organization may be approached', () => {
  // "בקשר עם ארגון עוד לא לפנו הסטודנט צריך לראות חזור ועדכן את הטופס כאשר ניתן יהיה
  //  לפנות לארגון"
  // Said on the form, BEFORE sending — a student who learns it only on the confirmation
  // screen has already decided without knowing what releases us.
  const hold = between(form, 'data-ma-hold-note', '</div>');
  expect(hold).toContain('חזרו ועדכנו את הטופס');
  expect(hold).toContain('כאשר ניתן יהיה לפנות לארגון');
  // Only one "not yet" answer remains — the dated one was struck.
  expect(form).toContain("contactPermission === 'later'");
  // And again on the confirmation screen they are left looking at.
  const next = between(form, 'data-ma-next', 'data-ma-note-lost');
  expect(next).toContain('חזרו ועדכנו את הטופס');
});

test('THE CLOSING MESSAGE: details saved, and Itzkovich updated on the status', () => {
  // "בכל מקרה צריך להיות כפתור שלח והודעה מסכמת לאחר שליחה שאומרת הפרטים נשמרו
  //  וד״ר איצקוביץ עודכן בסטטוס"
  expect(form).toContain('data-ma-submit');                 // the send button
  const sent = between(form, 'data-ma-summary', '</p>');
  expect(sent).toContain('הפרטים נשמרו');
  expect(sent).toContain('עודכן בסטטוס');
  // "בכל מקרה" — said whatever was answered, so the sentence is flat text with no branch
  // in it, and every answer has to actually mail him or the sentence is false.
  expect(sent).not.toMatch(/\?|orgStatus ===|proposing \?/);
  expect(form).toContain('void notifyCoordinator(');
  expect(form).toContain('void notifyNoOrg()');
  expect(form).toContain("chosenOrg: org || ''");
});

test('THE FOUR EXPLANATION QUESTIONS are on screen, in his ordering', () => {
  // "יותר חשוב מה הארגון מציע ומה סיכמת עם איש אשת הקשר ומה אופי הקשר (משפחה וכו)",
  // and "איך הגיע" last, since he called it the least important.
  // Anchored on the fields themselves, not on the surrounding prose: the comment above
  // them quotes all four phrases in one line and would satisfy any looser check.
  const panel = between(form, '<Area label="מה הארגון מציע', 'data-ma-none-panel');
  const order = ['מה הארגון מציע? *', 'מה סוכם עם איש/אשת הקשר? *', 'מה אופי הקשר שלך לארגון? *', 'איך הגעת לארגון? (אופציונלי)'];
  let at = -1;
  for (const q of order) {
    const i = panel.indexOf(q);
    expect(i, q).toBeGreaterThan(at);
    at = i;
  }
  // The connection question carries his own example, which is what makes it answerable.
  expect(panel).toMatch(/משפחה/);
});

test('THE TIMING QUESTION is now two answers, with no date to invent', () => {
  // "אם הארגון בתהליך בדיקה בין הסטודנט לארגון אני צריך לדעת מתי אוכל לפנות" — then,
  // 2026-10-07: "לא צריך תאריך שיוגדר זה במילא לא ראלי". A date a student guesses at is
  // a date nobody honours, so the middle option and its picker are gone.
  const perm = between(form, 'data-ma-permission', 'data-ma-hold-note');
  expect(perm).toContain('data-ma-permission-opt={value}');
  for (const v of ['now', 'later']) expect(perm).toContain(`'${v}'`);
  expect(perm).not.toContain('data-ma-contact-after');
  expect(form).not.toContain('type="date"');
});

test('RELEASE: one click, and the mail it sends', () => {
  // "יוסיף ארגון או יאשר שהקשר שלו עם הארגון הסתיים וניתן לפנות לארגון … ואני אקבל
  //  הודעה שאומרת סטודנט x עדכן שניתן לפנות לארגון"
  expect(form).toContain('data-ma-release-go');
  expect(form).toContain('isRelease');
  expect(form).toContain("notifyCoordinator(org, 'now', true)");
});

test('ADMIN: the permission and the note reach the student card', () => {
  const block = between(admin, 'data-pending-status', '</div>\n                  )}');
  expect(block).toContain('contactPermissionLine');   // in words, not a bare date
  expect(block).toContain('student_note');
  // And the permission is a dated line in the submission history.
  expect(admin).toContain('data-history-status');
});

test('a row saved before the migration cannot swallow the answer silently', () => {
  // The insert is a ladder, and every rung that drops something says so on screen.
  expect(form).toContain('setNoteLost(true)');
  expect(form).toContain('data-ma-note-lost');
  expect(form).toContain('data-ma-schema-warning');
});

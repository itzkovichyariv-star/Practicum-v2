import { test, expect } from '@playwright/test';
import { resolveActionTargets } from '../src/lib/placementStatus';

/**
 * The argument the buttons were losing.
 *
 * Yariv 2026-08-26: "רציתי לשחרר את הארגון והכפתור לא עובד ... לא עושה כלום", and
 * "אפשר לשנות את הסטטוס ... מתוך הכרטיס אבל לא מחוצה לו". One cause for both.
 *
 * The ✕ (drop_org) and ↻ (unsend) stamp the clicked chip onto the action. The
 * confirmation dialog then overwrote `targetOrg` with the ticked selection — and the
 * strip only builds a selection when the ROW's action is send_cv or place_direct. On a
 * row asking to remind, the selection is empty, the stamped org became undefined, and
 * the handler's `if (!orgName) return` swallowed the click.
 *
 * Wired the whole way down, losing its argument on the last step. Hence: silent, and
 * only outside the card.
 */

test('THE BUG: a per-chip action keeps its own target when nothing is ticked', () => {
  // Exactly the screenshot: the row's action is remind, so the selection is empty.
  const r = resolveActionTargets({ targetOrg: 'UCL Group' }, []);
  expect(r.targetOrg).toBe('UCL Group');
  expect(r.targetOrgs).toEqual(['UCL Group']);
});

test('a per-chip action is NOT overridden by an unrelated selection', () => {
  // Ticking is for send_cv. It must never redirect a ✕ or ↻ at a different employer —
  // releasing the wrong organization is worse than releasing none.
  const r = resolveActionTargets({ targetOrg: 'UCL Group' }, [{ orgName: 'Codeoasis' }]);
  expect(r.targetOrg).toBe('UCL Group');
  expect(r.targetOrgs).toEqual(['UCL Group']);
});

test('a row-level action still takes the ticked selection', () => {
  const r = resolveActionTargets({}, [{ orgName: 'Codeoasis' }, { orgName: 'עיריית אריאל' }]);
  expect(r.targetOrg).toBe('Codeoasis');
  expect(r.targetOrgs).toEqual(['Codeoasis', 'עיריית אריאל']);
});

test('nothing named and nothing ticked yields nothing — the handler then reports it', () => {
  const r = resolveActionTargets({}, []);
  expect(r.targetOrg).toBeUndefined();
  expect(r.targetOrgs).toEqual([]);
});

test('a blank or whitespace target falls back to the selection rather than winning', () => {
  expect(resolveActionTargets({ targetOrg: '' }, [{ orgName: 'Codeoasis' }]).targetOrg).toBe('Codeoasis');
  expect(resolveActionTargets({ targetOrg: '   ' }, [{ orgName: 'Codeoasis' }]).targetOrg).toBe('Codeoasis');
});

test('a malformed selection cannot produce an empty-string target', () => {
  // targetOrgs feeds a lookup by name; an empty entry would match nothing and read as
  // "not found" rather than as the bug it is.
  const r = resolveActionTargets({}, [{ orgName: '' } as any, { orgName: 'Codeoasis' }]);
  expect(r.targetOrgs).toEqual(['Codeoasis']);
  expect(r.targetOrg).toBe('Codeoasis');
});

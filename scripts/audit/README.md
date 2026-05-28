# Practicum v2 — Visual deploy audit

Handoff doc for the audit workstream. Read this first whenever you (or a new Claude session) pick up the audit work.

## Current state (as of v0.2 tag)

| Cell file | Cells | Pass | Notes |
|---|---|---|---|
| `01-registration.mjs` | REG-validation, REG-happy-path | ✅ 2/2 | Catches React duplicate-key warnings as known issue |
| `02-interview-slots.mjs` | — | — | TO BUILD |
| `03-admin-review.mjs` | — | — | TO BUILD |
| `04-accept-reject.mjs` | — | — | TO BUILD |
| `05-organization.mjs` | — | — | TO BUILD |

## How to run

```bash
cd ~/Code/practicum-v2
npm run dev                       # http://localhost:4325
node scripts/deploy-gate.mjs      # run every cell
node scripts/deploy-gate.mjs --only 01  # just one suite
```

When green: `npm run deploy`.

## Known issues to fix (BEFORE building more cells)

1. **React duplicate-key warnings** (34 of them) fire during a normal registration submit. The audit captures these in `audit-lib.mjs` and silences them via a filter (look for `same key` in the regex chain). They are a real bug, not test noise. **Fix the underlying duplicate-key issue, then remove the filter so future regressions are caught.**
2. **Supabase `DELETE` via anon key returns 500** — currently logged as `pre-clean (non-fatal)`. Either grant anon DELETE on `candidate_submissions WHERE email LIKE 'audit-%@audit.local'` via an RLS policy, OR move cleanup to a service-role helper. Until then, the unique-email-per-run pattern keeps the test isolated.

## How to build the next cell (recipe)

Each new cell follows `01-registration.mjs` as the template:

1. **Decide the flow.** What does the user click? What table changes? What visible state changes?
2. **Compute the absolute expected outcome BEFORE clicking.** Not "something happens" — the exact row, the exact text, the exact timestamp window.
3. **Reseed.** Delete any audit-tagged rows for THIS cell. Insert clean state if needed. Run `audit.assertSeed(...)` to verify the seed took.
4. **`observerMark()`** before the click.
5. **Click + wait.** Use Playwright locators by visible role/text whenever possible.
6. **Read the visible state AND the DB row.** Compare to expected — EVERY field.
7. **`observerSnapshot()`** after; assert no errors.
8. **Cleanup.** Delete what your cell created.
9. **Report cell pass/fail with a SPECIFIC `notes:` string for each failure mode.**

## Cells still to build (priority order)

### 02-interview-slots.mjs

Admin slot CRUD + capacity gating. Worth pinning:
- Creating a new slot writes to `public_interview_slots` with the exact date/start/end the admin typed.
- A slot at `booked_count >= capacity` does NOT appear in the public /register picker (regression: capacity filter accidentally removed).
- Deleting a slot with bookings prompts confirm; bookings preserved or cleaned per the design.

### 03-admin-review.mjs

Candidate review queue + notes persistence:
- Opening a candidate from the queue shows EVERY submitted field non-null (where the candidate filled it).
- The interview-notes textarea persists across page reload (catches "save button doesn't save" class of bugs).
- Status changes (`pending → interviewing → accepted/rejected`) write to the right column with the right value.

### 04-accept-reject.mjs

Accept/reject notifications:
- Clicking "Accept" calls the notify edge function with the right payload (use Playwright `page.on('request', ...)` to inspect outbound body).
- "Reject" sends the rejection template.
- Re-clicking the same decision twice does NOT send a second email (idempotency on `notification_log`).
- Template field substitution: name, course, slot, organization — all resolve to the candidate's actual values.

### 05-organization.mjs

Organization placement:
- Picking an org for a candidate creates a `placements` row with matching candidate_id + organization_id.
- The candidate's dashboard shows the placement.
- Placing an already-placed candidate elsewhere shows the right error (no double-placement).

## Rollback

The `v0.2` git tag points at this baseline state. If a future change regresses the audit, return to the known-good:

```bash
cd ~/Code/practicum-v2
git checkout v0.2
```

Then re-deploy or branch off to fix.

## When you (or a fresh session) pick this up

1. Open Claude Code in `~/Code/practicum-v2`. Memory files load automatically.
2. Say: "continue the audit work — read scripts/audit/README.md".
3. Pick a cell to build from the priority list. Use `01-registration.mjs` as the structural template.
4. Build it. Run it. Fix until green. Commit.
5. When you have meaningful new cells passing, bump the git tag: `git tag v0.3 -m "..."`.

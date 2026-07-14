# Employer capacity & placement redesign — characterization + plan (2026-07-14)

Owner: Yariv. Author: Claude. Status: **approved, implementing Phase 1.**
Trigger: editing an employer for next year shows this year's positions (should reset per course); no clear way to delete an employer; Employers page + ניהול are long scrolls with no course/year picker; student request should temporarily hold a place until status resolves.

## 1. Current state (verified in code, file:line)

Two overlapping capacity models coexist and disagree:

- **Legacy global scalars** — `Employer.positions`, `filledPositions`, `positionsTotal` (`src/lib/supabase.ts:137,140`): ONE number per employer, shared across all its courses. Edited in `EmployerEditor.tsx:129-130` ("סה״כ משרות"/"משרות מאוישות") and Excel import; summed globally in `Dashboard.tsx:70-72` and `EmployersPage.tsx:147-149,165-167`.
- **Per-course slot ledger** — `Employer.vacancySlots[]`, each slot `{ id, courseId, status: 'available'|'tentative'|'under_review'|'placed', studentId, prefRank, history }` (`supabase.ts:14-28`). This is already per-(employer×course). `openVacancies`/`totalVacancies`/`countSlotsByStatus(emp, courseId)` derive counts from it (`placement.ts:546-588`); Organizations page + `orgAvailability.ts` use this path.

Consequences / bugs found:
- **Editor is global & inert**: checking a course in `EmployerEditor` only appends to `courseIds` (`:112-118`); it never creates/edits slots and only writes the global scalar — so a new/future course inherits this year's number instead of resetting.
- **`positionsTotal` clobber**: `ManagementPage.savePositionsTotal` (`:1294-1335`) resizes only *this* course's slots (correct) but writes a GLOBAL `positionsTotal = this course's count` (`:1327`) — wrong for multi-course employers.
- **Divergent "open" math**: slot-derived (`openVacancies`) vs scalar-derived (`Dashboard.tsx:72`, `EmployersPage.tsx:167`).
- **Delete is hidden + unguarded**: only a 🗑 inside the editor modal (`EmployerEditor.tsx:170-175` → `EmployersPage.handleDelete` `:189-192`); no row action; no guard, so deleting an employer with placements orphans students (`detach` IS guarded, delete is not). ManagementPage only detaches from a course.
- **ניהול (`ManagementPage.tsx`)**: one long scroll, no course/year selector; per-course capacity buried in `CoursesSection` → `EmployerAttachSection` (`:1225`).
- **Student flow disconnected**: `/organizations` (`OrganizationsPage.tsx`) is READ-ONLY — no student identity, no apply button; it only shows available places. The real pick is `/cv-update` (`CvUpdateForm.tsx:115`) which writes free-text org names to the separate `cv_updates` table, non-binding, never touching the ledger. The `available→tentative` hold is created ONLY by admin actions (`placement.ts:367-379,430-435`, called from `StudentEditor`). The `by:'student'` history variant exists (`supabase.ts:24`) but is unused.

**Net:** the per-course capacity + temporary-hold mechanism the redesign needs mostly EXISTS in `vacancySlots`; the work is (a) make it the single source of truth and expose it per-course in the UI, and (b) wire the student's own request to it.

## 2. Locked decisions (Yariv, 2026-07-14)

1. **Single source of truth = the per-course slot ledger.** Retire the global scalars as authoritative; DERIVE filled/available from slot statuses (no manual filled number → can't drift).
2. **Student's own request creates the hold.** When a student requests an employer via their link, a course-matched `available` slot flips to `tentative` (held, decrements available) until resolved (accepted→`placed`, rejected→released back to `available`).
3. **Delete = guard + archive.** Hard-delete only when the employer has no active holds/placements; otherwise archive/deactivate (hidden from students, kept for history). Never orphan.
4. **Phased delivery** (each shipped + verified before the next).

## 3. Target model

- Capacity is per `(employer × course)`, represented solely by `vacancySlots` filtered on `courseId`.
- Per course: `total = slots(course).length`, `available = slots(course, 'available')`, `held = tentative+under_review`, `placed = placed`. Everything derived.
- New/attached course starts at **0** slots (admin sets the number → materializes that many `available` slots tagged with the course id).
- Global scalars (`positions`, `filledPositions`, `positionsTotal`) become derived display mirrors only (or removed), never authored.

## 4. Per-surface design

| Surface | Change |
|---|---|
| Employer editor | Per-attached-course capacity: "מקומות בקורס {name}: [N]"; N resizes that course's slots (shared helper); default 0 on newly-checked course; filled/available shown derived + read-only. Remove the single global positions/filled inputs. |
| Employers page | Course + year picker → that course's employers with live available places; delete action discoverable per row (guard+archive). |
| ניהול screen | Course+year selector at top; jump to a course instead of scrolling. |
| Delete | Guard: block hard-delete when any tentative/under_review/placed slot exists → offer archive (`approvalStatus:'rejected'` or an `archived` flag) instead. |
| Student flow | Student-identified request on the acceptance link flips a course-matched slot to `tentative` (reuse reservation logic; `by:'student'`); availability reflects it live; expiry/one-active-hold rules TBD in Phase 3. |

## 5. Phased plan + checklists

### Phase 1 — admin capacity: single per-course source of truth
- [ ] Shared helper `setCourseCapacity(emp, courseId, n)` in `placement.ts` (partition slots by course, grow with `available` / shrink only from `available`, never below occupied) — extracted from `ManagementPage.savePositionsTotal`, WITHOUT clobbering a global `positionsTotal`.
- [ ] `EmployerEditor`: replace global positions/filled inputs with per-attached-course capacity rows using the helper; default 0 for newly-checked course.
- [ ] Unify counts: `Dashboard` + `EmployersPage` totals derive from slots (`totalVacancies`/`openVacancies`/`countSlotsByStatus`), not scalars.
- [ ] Fix `ManagementPage.savePositionsTotal` clobber (stop writing global `positionsTotal`; derive).
- [ ] Migration: single-course legacy employers → materialize existing `positions` as that course's slots; multi-course legacy → assign to primary/current course, others 0, flag for review.
- [ ] Verify: gate cells for employer capacity per-course; preview EmployerEditor + Dashboard + EmployersPage + Organizations counts agree.

### Phase 2 — navigation + safe delete
- [ ] Employers page: course+year picker (clean id-based, not the name/id-mixed context) + available-places column.
- [ ] ניהול: course+year selector at top.
- [ ] Delete: row-level, discoverable, guard+archive.

### Phase 3 — student request → temporary hold
- [ ] Student identity on the acceptance link (email/token) reaching `/organizations` (or upgrade `/cv-update`).
- [ ] Request flips a course-matched `available` slot → `tentative` (`by:'student'`); course match resolves org→course slot like `buildPlacementPreferences`.
- [ ] Rules: one active hold per student (or per rank), expiry/TTL, conflict handling, release on reject/withdraw.
- [ ] Availability + admin views reflect student holds distinctly.

## 6. Verification (every phase)
Per repo rules: build → preview-verify the touched screens → deploy-gate green (add capacity cells) → one deploy per phase → LIVE-PROGRESS updated. Capacity math is load-bearing (real students/employers) — assert derived counts on real prod data before deploy.

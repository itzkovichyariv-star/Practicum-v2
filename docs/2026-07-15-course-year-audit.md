# Practicum — (course × year) architecture audit (2026-07-15)

> Multi-agent audit: 6 dimensions × find → adversarial verify → synthesize. 19/24 findings confirmed real. Verdict: structure SOUND, no redesign.

# Practicum (course × year) — Architecture Assessment

## 1. VERDICT

The (course × year) structure is **fundamentally sound and salvageable with targeted fixes — it does not need a redesign.** The core modeling decision (per-year course rows that share a `name`, so `courseId` encodes course-name × year, with an employer-side `vacancySlots` ledger as the single source of truth for capacity) is correct and should be kept. Every confirmed failure is a *localized code-path bug* — a handful of display/derivation sites that bypass the year-scoped helpers, two write paths (intake + ad-hoc dispatch) that don't reconcile year, and some data hygiene — not a flaw in the schema itself. The prod data confirms this: 86/86 students resolve a `courseId`, all 18 `placed` slots match their student's exact (course × year) with **zero** real mismatches, and no employer is attached to two courses in the same year.

## 2. WHAT'S ACTUALLY BROKEN (confirmed, ranked)

### MAJOR

**M1 — Employer capacity bar reads UNSCOPED total/filled while showing per-year "open".** `EmployersPage.tsx:651` (EmployerRow) and `:534` (EmployerCard) destructure `total`/`filled` from `orgAvailability(emp)` (all years) while `open` comes from the year-scoped `yearAv`. On the default screen, Manpower with תשפ״ז selected renders **"5/10 · 5 פתוחות" at 50%** when תשפ״ז is actually 0/5 (all 5 "filled" are last year's students); אוניברסיטת אריאל renders a 100%-full bar on a year where it has zero places. **Fix:** source `total`/`filled`/`fillPct` from `yearAv` (the year-scoped `orgAvailability(emp, scopeCourseIds)`), same as `open`.

**M2 — `hiredCount`/`hiredNames` join students to employers by NAME only, course/year-blind.** `EmployersPage.tsx:460` and `:482` compute `students.filter(s => s.acceptedOrg === e.name)` with no scope. אוניברסיטת אריאל (HR-only, ledger = 1 placed) renders **"👤 3 סטודנטים"** by pulling in 2 counseling-תשפ״ו students (בורשטיין לוסי, טובי מור), contradicting the same card's 1/1 ledger. **Fix:** scope the hired set by (course × year) — join through the slot ledger, or `filter(s => s.acceptedOrg === e.name && scopeCourseIds.includes(s.courseId))`.

**M3 — Ad-hoc dispatch grabs ANY available slot, ignoring (course × year).** `placement.ts:573` (`addPlacementPreference`) and its sibling `:510` (`buildPlacementPreferences`) fall back to `slots.find(s => s.status === 'available')` with no course guard. Reachable from `StudentEditor.tsx:432` with the full unfiltered `employers` array; because 23/24 prod employers span both years and several (Manpower, עיריית אריאל, BDO) have available slots **only** in תשפ״ז, dispatching a תשפ״ו student flips a תשפ״ז slot to tentative — re-introducing the TLVtech/שגיא cross-year bug. (Note: the durable corruption is partly self-healed by migration step 5b on next load, and no prod row currently triggers `:510` because all preference lists are empty — but `:573` is guaranteed on the ad-hoc control.) **Fix:** add `&& s.courseId === student.courseId` to both `available`-slot finds.

**M4 — ReportsPage YoY silently drops the course filter (name-vs-id mismatch).** The top bar sets `context.courseId` to a course **NAME** (`App.tsx:318`, `value: c.name`), but `ReportsPage.tsx:42/50/58` resolve it with `courses.find(c => c.id === context.courseId)` (id-only). A name never matches an id, `sel` is undefined, the guard returns the **entire** dataset, and the default YoY tab merges all courses instead of the selected one. **Fix:** add `|| c.name === context.courseId` to the three `.find` calls (mirror `pageShared.ts:40`).

**M5 — Public intake resolves course by NAME with a year-losing fallback, while `.year` comes from the submission independently.** `CandidatesPage.tsx:391-393` does `find(nameMatch && c.year===subYear) || find(nameMatch)`; the second clause binds `courseId` to a *different year's* same-name row, while `:466` sets `year: sub.year || 'תשפ״ז'` from the submission. The two sources can disagree and the drift rides verbatim into the student on convert (`:298-299`, `:554-555`). The raw `c.year === subYear` compare (not `normalizeYear`) makes clause-1 miss on quote/whitespace variants, widening the trigger. On total no-match, `courseId` hard-defaults to `courses[0]` = hr-practicum/תשפ״ו regardless of submitted year (`:465`). **Fix:** compare years through `normalizeYear`; derive `student.year` from the *resolved course*, not the submission; on no-match, surface an error instead of silently defaulting to `courses[0]`.

**M6 — 7 occupied slots reference 3 student IDs that no longer exist (dangling FKs).** Tentative/under_review slots at נישה פרו, מעוף משאבי אנוש, עיריית אריאל, אוסם נסטלה point to deleted students; occupancy math is inflated (understating open places in תשפ״ו) and `EmployerEditor.tsx:151/161/177` uses the phantom count to block course-detach and clamp the capacity stepper. No crash (resolvers fall back to `#<id>`), no cross-year leak (all 7 are תשפ״ו). *(This is the same set the employer-separation dimension flags as "held by deleted students" — one defect, not two.)* **Fix:** one-time data repair + add a slot reaper to the student-delete paths in `StudentsPage.tsx:338-401`.

### MINOR (bundle — guardrail gaps, latent holes, and data hygiene)

- **StudentEditor course & year are two uncoupled `<select>`s** (`StudentEditor.tsx:690-695`) — an admin can save a course from one year with another year's label; no consistency check in `handleSubmit`. (Same uncoupled pattern in `CandidateEditor`/`LectureEditor`.)
- **`student.year` is redundant with `course.year` but is the field trusted downstream** (`pageShared.ts:49/64`, `Dashboard.tsx:194-198`), so any drift distorts year-scoped views. *(The cited `folderCreation.ts:155` is actually drift-tolerant — it unions the course's own year — so the real load-bearing consumers are pageShared/Dashboard.)*
- **`posFilter` uses unscoped `totalVacancies`/`openVacancies`** (`EmployersPage.tsx:182-186`) — the open/full/none chips contradict the per-year status pill for cross-year employers.
- **Lazy slot-gen defaults to `emp.courseIds[0]`** (arbitrary first year) at `placement.ts:501/566` instead of the student's course — unreachable today (no employer has empty slots) but inconsistent with the correct sibling path.
- **`!stCourse ||` wildcard** at `placement.ts:286/636` lets a courseless student occupy any-year slot — latent (86/86 have a courseId today).
- **`deleteCourse` counts attached employers via legacy `e.courseId`** (`ManagementPage.tsx:1067`) with no `courseIds[]` fallback — returns 0 for **every** course on current data, degrading the delete-confirmation warning. Same legacy read in `folderCreation.ts:156`.
- **Courseless identified student sees a clickable "request" button** (`OrganizationsPage.tsx:88`) that `studentRequestHold` then safely rejects — UX only.
- **Data:** students 47/49 have `acceptedOrg='אוניברסיטת אריאל'` (an HR-only employer with no counseling slot); 7 students carry free-text `acceptedOrg` naming non-employers (צה״ל, בני עקיבא, etc.); 1 synthetic `audit-stu-…` test student with blank year is polluting hr-practicum/תשפ״ו rollups. These are the "1 mismatched student" the scouting flagged — its year is **empty**, not a wrong Hebrew year.

## 3. THE DEPLOYMENT GAP

**The live site is v1.24.2. The repo is at v1.24.5 — editor course-scoping (v1.24.3) and default-year + history (v1.24.4) are committed but UNDEPLOYED.** This matters enormously for interpreting "it doesn't work": **the year-scoped machinery that fixes the bulk of cross-year summing — the year-scoped stat boxes, the status pill via `*_(emp, yearCourseIds)`, `normalizeYear` quote-folding, and the per-year student-facing org list — largely does not exist on the live build the user has been testing.** Much of what looks like a structural failure is the user exercising *old* behavior that predates per-year scoping.

Quantifying: of the confirmed display defects, the **primary** aggregates (top stat boxes, status pill, student-facing organization list, `studentRequestHold` guard) are already correct in the repo and simply not shipped — **deploying closes most of the gap.** What genuinely survives a deploy and needs code fixes is a **short, bounded list**: M1 (capacity bar), M2 (hired count), M4 (ReportsPage YoY), the M3 dispatch slot guard, the M5 intake write path, and the minor filter/coupling gaps. In other words: roughly the *majority* of "the years are mixed up" is the deployment gap; the *residual* is ~4 display/derivation sites + 2 write paths that bypass the year-scoped helpers, plus data cleanup.

## 4. CONSOLIDATION PLAN (minimal, ordered)

**Data model:** No schema change required. Keep per-year course rows. The one worthwhile hardening is an **invariant**: treat `course.year` as the sole year authority and either derive `student.year` from `courseId` or add a load-time check that flags any row where `item.year ≠ course.year` (that single check catches M5's drift and the audit-student anomaly). A larger, optional refactor — make the top-bar context carry an explicit `{courseName|'__all__', year|'__all__'}` (or a canonical `courseKey`) instead of a name-as-id, and route all scoping through one `sameContext()` helper — would collapse the ~6 divergent name/id matchers and eliminate the whole M4 collision class. Recommended, not required for correctness.

**Step 1 — Code fixes (single deploy, batched by concept):**
1. `EmployersPage.tsx:651` & `:534` — capacity bar `total`/`filled`/`fillPct` from `yearAv`. *(M1)*
2. `EmployersPage.tsx:460` & `:482` — scope `hiredHere` by (course × year). *(M2)*
3. `EmployersPage.tsx:182-186` — `posFilter` uses year-scoped counts. *(minor)*
4. `ReportsPage.tsx:42/50/58` — add `|| c.name === context.courseId`. *(M4)*
5. `placement.ts:510` & `:573` — add `&& s.courseId === student.courseId`. *(M3)*
6. `placement.ts:501` & `:566` — flip lazy-gen default to `student.courseId || emp.courseIds[0]`. *(minor)*
7. `placement.ts:286` & `:636` — drop the `!stCourse ||` wildcard (skip when courseless). *(minor)*
8. `CandidatesPage.tsx:391-393/465-466` — compare years via `normalizeYear`; set `student.year` from the resolved course; warn instead of silently defaulting `courseId` to `courses[0]`. *(M5)*
9. `StudentEditor.tsx:690-695` — couple the course→year selects (or validate in `handleSubmit`). *(minor)*
10. `ManagementPage.tsx:1067` & `folderCreation.ts:156` — use the `empCourseIds()` fallback, not legacy `e.courseId`. *(minor)*
11. `StudentsPage.tsx:338-401` — reap employer `vacancySlots` on student delete. *(prevents future M6)*

**Step 2 — One-time data repair (script against the prod blob, `org_id=default`):**
- Reap the 7 dangling-FK occupied slots (студentIds `s-gubboe22…`, `s-rxkehw53…`, `s-ogcpstij…`). *(M6)*
- Delete the `audit-stu-1784022002656` test student.
- Reconcile students 47/49: either add the counseling course + slots to the אוניברסיטת אריאל employer, or correct their `acceptedOrg` (confirm intent with the user — this is a real-world "who accepted them" question, not pure corruption).
- Leave the 7 external free-text `acceptedOrg` values as-is (legitimate "placed elsewhere") but note the naive exact-string joins in `EmployerFeedback.tsx`/`EvaluationForm.tsx` silently drop them.

**Step 3 — Deploy:** run `npm run build` then the deploy-gate; ship the fixed HEAD as v1.24.6. Deploying is what actually makes per-year scoping live for the first time — do it *with* the leak fixes so the known display bugs never reach production. Bump `version.ts` + `VERSIONS.md` with the wrangler id.

## 5. WHAT'S ALREADY CORRECT (do NOT rip up)

- **The per-year course-row model** — `courseId` encoding (course-name × year) with shared names. Right call; keep it.
- **The `vacancySlots` ledger as the single source of capacity truth** — every slot strictly attributed to one course via `slot.courseId`; prod is clean (0 unresolved slot.courseIds, 0 slots outside their employer's course list).
- **Candidate → student conversion** copies `courseId`/`year` 1:1 faithfully (`CandidatesPage.tsx:298-299`, `:554-555`).
- **The migration/reconcile paths** — `migratePlacementData` steps 4b/5/5b, `occupyAcceptedOrgSlot`, `studentRequestHold` all attribute slots to the **student's own** exact `courseId`; step 5b self-heals year-mismatched occupied slots (it healed the live TLVtech/שגיא slot) and is idempotent. The migration never moves a placement to the wrong (course × year).
- **The core employer aggregates** — top stat boxes and status pill via `*_(emp, yearCourseIds)`, with `normalizeYear` folding quote variants — are correctly year-scoped and never sum across years (in the repo; pending deploy).
- **The student-facing organization list** — `OrganizationsPage.tsx:118/131` scopes availability and badge counts to `student.courseId`; `studentRequestHold` (`placement.ts:439`) only flips a slot with `s.courseId === student.courseId`. No path lets a student see or claim another year's places.
- **Prod placement integrity** — all 18 `placed` slots resolve to real students with matching (course × year); 0 real year mismatches; no employer in two same-year courses; 13/13 candidates resolve with `year === course.year`.

Bottom line: keep the schema, deploy what's already built, apply ~11 surgical code fixes and a small data cleanup, and (course × year) is rock-solid.

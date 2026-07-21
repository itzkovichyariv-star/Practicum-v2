# Student-editor redesign — canonical spec (approved 2026-07-21)

**Status:** APPROVED by Yariv, direction locked. Build in phases, gated + iPhone-verified each step.
**Scope:** the COORDINATOR's student-editor modal (`src/components/StudentEditor.tsx` + the `PlacementPanel.tsx` it embeds). RTL, mobile-first (iPhone). Coordinators = Yariv or Rachel.

## Why
Yariv's words: "יש יותר מדי בלאגן בדף … עמוס מאוד שלא לצורך." The CV appears in ~3 places, the org world is fragmented across 4 (submitted list + 3 ranked fields + build box + PlacementPanel), and the interview-result fields are NOT in the student's chosen order. Reorganise + declutter — **no function is cut.**

## Approved refinements (Yariv, from the AskUserQuestion)
1. **Palette:** use the app's own colours — `--accent` = maroon `#7a1e2b`, `--accent-soft`. **NO blue** (the mockup's blue was the generic CDS default). Subtle colours everywhere, including the top strip.
2. **Send model:** ranked-only. A coordinator **checks** an org (one or several) and sends via **WhatsApp or Outlook** (channel choice). No stray sends outside the ranked list.
3. **Admin re-rank:** the coordinator can **reorder** the ranked list (drag or up/down).
4. **Top strip:** KEEP the thin stage stepper + single next-action banner, with subtle colouring.

## Target structure (top → bottom, single RTL column)
1. **Sticky header** (always) — name · one status pill (maroon-soft) · contact icons (📞/WhatsApp/✉) · ✕.
2. **Stage stepper** (always, passive, subtle) — `הכנה · קו״ח · העדפות ושליחה · ראיון · שובץ · שעות`; current lit in maroon; tap = scroll, never hide.
3. **Next-action banner** (only when there's one thing to do) — e.g. adopt re-submission (`applyPendingCv`), approve suggested org, send stage-2 link, mark accepted. Subtle amber/maroon.
4. **CV strip** (always) — ONE CV (current: `cvUpdatedUrl` → `cvUrl` → red warn). `פתח ↗` / `העתק`. `היסטוריית קו״ח (N)` toggle → replaced original (line-through) + all `cvHistory` files (each openable via `viewableCvUrl`). Absorbs the green box (#4), the CV panel (#5), and #9's CV field.
5. **Org hub** (always, centerpiece) — one ranked-org CARD per org, in the student's chosen order, **re-rankable by the coordinator**. See below.
6–10. **Collapsed accordions**, each with a live header hint: `פרטים ועריכה` (details+course+prep), `ראיון שיבוץ (רחל)` (scheduling only), `השמה סופית ושעות` (auto-opens on נקלט), `מסמכים וחוו״ד מעסיק` (docs + feedback controls + raw CV paths), `הערות`, `היסטוריה` (old CVs + past submissions).
11. **Sticky footer** (always) — one `שמור` + the current next-action + `⋯` (delete, print).

## The ranked-org card (the heart)
One full-width card per org, **in the student's chosen rank order**, coordinator-reorderable:
- **rank badge** `#N` + drag/▲▼ to re-rank.
- **org name** — editable combobox, gated (`gatedOrgOptions`) + `showAllOrgs` toggle above the list; unresolved name → subtle `לא זוהה מעסיק`.
- **`תוצאת ראיון`** — 3-way segmented (`טרם רואיין / עבר / לא עבר`), **bound to the org's identity** (not a rank slot) so re-rank never detaches a result. THIS IS THE DATA-MODEL FIX.
- **select checkbox** + a **send action** (WhatsApp / Outlook) — check org(s) → send the CV (`handleDispatch`, takes the slot). Ranked-only.
- **status pill** (`ממתין לשליחה / נשלח — בבדיקה / נקלט / נדחה`) + capacity chip (`countSlotsByStatus`) + aging badge.
- under review → `✓ נקלט` / `✕ נדחה` (`handleResult`) inline.
- private/suggested org → `כבר במגעים — אשר שיבוץ` (`handlePlaceDirect`).
- `⋯`: `הסר מהדירוג` (`handleRelease`).
- bottom of list: `➕ הוסף ארגון לדירוג` (absorbs `addExtraEmployer`, as a ranked card).

The four old fragments collapse into this one card type: submitted-list → card order + a thin `הוגש ע״י… · DATE` caption; the 3 named fields → the ordered card array; the build box → build-on-send (+ optional bulk `הכן הכל`); PlacementPanel per-pref cards → the card's status/actions.

## Data model (Phase 0 — unblocks everything)
Today there are TWO representations: `firstChoiceOrg/second/thirdChoiceOrg` + `*ChoiceResult` (editor fields) AND `preferences: StudentPreference[] {rank, employerId, slotId, status}` (PlacementPanel). Unify into ONE ordered, org-keyed list:
- `StudentPreference` gains **`orgName`** (display, for unresolved) and **`interviewResult?: 'pending'|'passed'|'failed'`** — result travels WITH the org on re-rank.
- Order = `rank` (1..N), coordinator-reorderable.
- Migration: seed `preferences[]` from the ordered `firstChoiceOrg/second/third` + their `*ChoiceResult`, in that order; keep reading the legacy fields during transition (compat shim) so nothing breaks; new writes go to `preferences[]`.
- Keep `resolveEmployerForOrg` fuzzy match + the `לא זוהה מעסיק` flag.

## Phasing (each phase: build → preview all importers → deploy-gate green → iPhone smoke → ship)
- **Phase 0** — data model: `interviewResult` on `StudentPreference`, org-keyed; seed order from submission; re-rankable. Compat shim for legacy `*ChoiceOrg/*Result`.
- **Phase 1** — the org hub card (highest value/risk): fold submitted-list + 3 fields + build box + PlacementPanel into one card type; checkbox-select + WhatsApp/Outlook send (ranked-only); re-rank; suggested-org path; `addExtraEmployer`. Reuse `buildPlacementPreferences`/`handleDispatch`/`handleResult`/`handlePlaceDirect`; editing a card's org after a slot is taken must `handleRelease` the old slot (capacity leak guard).
- **Phase 2** — CV strip: current-only + history toggle; pending-adopt → next-action banner.
- **Phase 3** — collapse #1-3, #7-10 into accordions with live header hints; relocate feedback controls + raw CV paths.
- **Phase 4** — cockpit: status pill + passive stepper + derived next-action banner. Its predicates MUST equal the handlers' gates (updated CV to dispatch; free course-scoped slot; acceptedOrg before hired/hours/complete; 120 approved hours to complete) or it points at a blocked step.

## Guardrails
- All colours from the app palette (`--accent` maroon, `--accent-soft`, semantic green/amber/red for status only), never blue.
- Channel picker as a bottom-sheet, not a clipping `position:absolute` popover (mobile).
- Two save models coexist (form `onSave` vs autosaving `onDataChange` from send/build/result) — label Save so a persisted dispatch isn't "unsaved".
- Never claim a phase done without an iPhone smoke test (RTL, keyboard, sticky-bar/safe-area, in-gesture `window.open`).
- Coordinator-edit logging (v1.32.1) stays.

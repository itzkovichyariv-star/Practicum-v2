# Design brief — placement-status strip on the student card (2026-08-09)

**Status: AWAITING YARIV'S APPROVAL. No code written.**
Interactive mockup: `docs/design/2026-08-09-placement-status-strip.html`
(published privately at https://claude.ai/code/artifact/5868f69e-7da3-4190-b04d-85f063791f3d)

## The request (Yariv, 2026-08-09)

> ברשימת הסטודנטים לאחר שסטודנט הגיש רשימה — אם נשלחו קורות החיים שלו למקום, אני רוצה
> שיהיה כתוב "נשלחו ל‑2 מקומות" או 3, הכרטיס פשוט מתרחב. שיהיה כתוב בכרטיס לפני שנכנסים
> לפרטים שלו. וגם אם שלח רשימת העדפות וזו לא טופלה עדיין — שיהיה כתוב "רשימת העדפות
> נשלחה — יש לטפל מול המעסיק". […] זה יעזור לי ולרחל לקבל החלטות לגבי מועמדים ולקדם
> את ההשמה שלהם. אם אתה חושב שצריך סטטוסים נוספים — תוסיף.

## Why this is worth more than the two badges asked for

`StudentRow` (StudentsPage.tsx:908) today receives only `s: Student` and `employers`.
It renders placement as a binary: `acceptedOrg` → org name, else `טרם שובץ/ה בארגון`
(StudentsPage.tsx:1028-1048). Everything between "accepted to the course" and "placed"
— the submitted list, the CV sends, the interview results, the rejections — lives inside
the card (OrgHub) and is invisible from the list.

**Live evidence, pulled from prod on 2026-08-09** (83 students / 32 employers / 177 dispatches):

| Student | What happened | What the list shows today |
|---|---|---|
| עינה נוימן | submitted 3 ranked orgs on **6.8** via `/cv-update` | nothing |
| נטע נידם | submitted 3 ranked orgs on **5.8** (twice) | nothing |
| עדי גורביץ' | submitted 3 orgs **28.7**; only 1 unrelated org on her record | nothing |
| הדר עוזירי | 3 orgs ranked, CV ready, **no CV sent to anyone** | nothing |
| שובל קוממי | CV sent to Icon Group **5 days ago**, awaiting reply | nothing |

Two of those (עינה, נטע) are stuck *before* the list even reaches the student record:
the `/cv-update` submission lands in the `cv_updates` table and waits for a manual
"adopt" in the card (StudentEditor.tsx:105-135). Nobody is told it arrived. That state
is not in the original request — it is the most urgent one on the board.

## The organising idea: whose turn is it

Every state answers one question — **אצל מי הכדור** — because that is the question that
turns a list into a work queue for Yariv and Rachel:

- 🔴 **אצלנו** — we owe an action (adopt a list, send CVs, chase a silent employer, find new orgs)
- 🟠 **אצל הסטודנט/ית** — waiting on them (no submission, no updated CV)
- 🔵 **אצל המעסיק** — sent, within the waiting window
- 🟢 **סגור** — placed

Colour carries it, but so does form: the "ours" strip gets a tinted background plus the
severity rail; the others get the rail only. The wine accent (`--accent`) is never used
in the strip — it stays the app's identity colour, so urgency can never be mistaken for
chrome.

## The eleven states

| # | State | Trigger (existing data) | Card text | Turn |
|---|---|---|---|---|
| 0 | טרם הוגש | no `cv_updates` row, no ranked orgs | טרם הוגשו קו״ח מעודכנים והעדפות | student |
| 1 | הגשה ממתינה לקליטה | unseen `cv_updates` row whose orgs/CV differ from the record | רשימת העדפות התקבלה — יש לקלוט לכרטיס | **ours** |
| 2 | הצעת ארגון ממתינה לאישור | employer with `approvalStatus === 'pending'` from this student | הצעת ארגון חדש — יש לבדוק ולאשר את הארגון | **ours** |
| 3 | ארגון בהצעת הסטודנט/ית | approved employer with `restrictedToStudentId === student.id`, still `tentative` | ארגון בהצעת הסטודנט/ית — יש לשוחח עם המעסיק ולאשר | **ours** |
| 4 | רשימה נקלטה, טרם נשלח | ≥1 **list** pref `tentative`, 0 `under_review` | **רשימת העדפות נשלחה — יש לטפל מול המעסיק** | **ours** |
| 5 | חסום — חסר קו״ח | **list** org ranked but no `cvUpdatedUrl` (OrgHub.tsx:428) | רשימת העדפות נשלחה — חסר קו״ח מעודכן | student |
| 6 | קו״ח נשלחו ל‑N | N = prefs `under_review`, oldest dispatch under threshold | **קו״ח נשלחו ל‑2 מקומות · ממתין לתשובת המעסיק** | employer |
| 7 | שתיקה מעבר לסף | oldest pending dispatch > `reviewAgingThresholdDays` (14) | קו״ח נשלחו ל‑3 מקומות · 21 ימים ללא תשובה | **ours** |
| 8 | עבר/ה ראיון | any pref `interviewResult === 'passed'`, not placed | עבר/ה ראיון ב‑X — ממתין להחלטת המעסיק | employer |
| 9 | נדחה — מיצוי הרשימה | ≥1 `rejected`, no `tentative`/`under_review` left | נדחה/תה ב‑2 מקומות — יש להציע ארגונים חדשים | **ours** |
| 10 | שובץ/ה | `acceptedOrg` | שובץ/ה ב‑X · תאריך | closed |

States 4 and 6 are Yariv's exact asks, in his exact wording. The rest close the gaps that
would otherwise leave the strip blank mid-pipeline.

### A self-suggested org is a different route (Yariv, 2026-08-09 — corrected mid-design)

> במצב של מעסיק שהמועמד הציע — זה לא שצריך לשלוח קורות חיים למעסיק אלא לטפל מול
> המעסיק, כלומר אני אמור לשוחח איתו ולאשר, ואז ככל הנראה יש השמה. במקרים שהמעסיק
> יבקש קורות חיים הם יישלחו אליו, אבל זה מקרה פחות שכיח כשהמועמד כבר יצר קשר.

The code already models this and my first draft flattened it. When a student brought the
org themselves, OrgHub renders a **separate** action — `✓ כבר במגעים — אשר שיבוץ`
(OrgHub.tsx:509-513, `place_direct`), whose own tooltip says *"אישורך מהווה שיבוץ (השמה),
ללא שליחת קו״ח"*. Consequences the classifier must honour:

- State 3 says **שוחח ואשר**, never "send CV". A CV goes out only if the employer asks —
  the uncommon path, and it's already possible from the same card.
- **The missing-CV blocker (state 5) must not fire for a suggested org.** `place_direct`
  has no `canSend` guard, so a student whose only org is their own suggestion is not
  blocked by a missing updated CV. Firing state 5 there would invent a blocker.
- **Mixed is the common shape.** `studentSuggestedOrgName` (placement.ts:433) pins the
  suggested org at rank #1 and the list fills #2–#3, so one student can need *both*
  actions. The strip leads with the suggestion (the fast route to a placement) and names
  the list orgs second. Suggested orgs are marked by form — a dashed chip with ◆ — not by
  a colour of their own, so the turn colour stays readable.

**Live today:** both students in this state have self-suggested orgs.
עדי גורביץ' → `מרקמן טומשין ושו״ת` (her own, approved) — pure case.
הדר עוזירי → `מערך הדיגיטל הלאומי` (her own, approved) at #1 plus נישה פרו / עיריית אריאל
from the list — the mixed case. Under the first draft both would have read "send CV",
which is wrong for the #1 org in each.

## No schema change needed

Both clocks already exist:

- **"ממתינה 6 ימים"** (states 1-3) = days since `cv_updates.uploaded_at` for the student's
  latest submission. This measures the thing that matters — how long the *student* has
  been waiting — and it survives regardless of when the coordinator adopts the list.
- **"נשלח לפני 5 ימים"** (states 4-5) = `Dispatch.sentAt`, already used by OrgHub's aging
  chip (OrgHub.tsx:423-426).

**Important trap for whoever implements this:** `submissionStatus === 'submitted'` does
**not** mean the student submitted a preferences list. `migratePlacementData`
(placement.ts:184-186) sets it from `cvUrl` alone, so all 11 תשפ״ז students carry
`'submitted'` — including four with no list at all. The list must be derived with
`buildUnifiedOrgList(student, employers)` (placement.ts:575), which is what the editor
itself uses.

## Implementation sketch (after approval)

1. `StudentsPage` — pass `dispatches` into `StudentRow` (it already holds them,
   StudentsPage.tsx:873) and fetch `cv_updates` once for the whole list, latest-per-email,
   the same way `PendingSuggestionsBanner` does (StudentsPage.tsx:78-92).
2. New pure classifier `src/lib/placementStatus.ts` — `(student, employers, dispatches,
   pendingSubmission, course) → { turn, state, headline, chips, age }`. One function, so
   the strip and any future filter/report read the same rule (per the canonical-spec
   gatekeeper pattern). It must split each ranked org into **suggested** (`employer
   .restrictedToStudentId === student.id`) vs **list**, because the two carry different
   actions and different blockers.
3. `StudentRow` — render the strip below the two zones. Card grows; no layout above it moves.
4. Filter chips on the students page keyed by `turn`, with counts.
5. Gate cells: one per state (9), asserting headline text + turn colour; plus a lint that
   every `turn` value has a colour and every state has a cell.

## Open decisions — need Yariv's answer before coding

- **א.** Strip always, or only when there is something to say? (Mockup: only when active.
  Always = more consistent, adds a line to 53 students not in the flow.)
- **ב.** Action button inside the strip ("קלוט לכרטיס" / "שלח קו״ח") — yes or no?
  Saves opening the card; adds a one-click action to a list row.
- **ג.** Silence threshold — keep the course's existing 14 days, or drop to 10?
- **ד.** In the mixed case, is leading with the self-suggested org right? (It is the
  shortest route to a placement, so the mockup leads with it.)

## Log

- 2026-08-09 — brief + interactive mockup written; grounded in prod data. Awaiting approval.
- 2026-08-09 (later) — Yariv corrected the model mid-design: a self-suggested employer is
  talk-and-approve (direct placement), not send-CV. Added states 2 and 3, scoped the
  missing-CV blocker to list orgs only, added the mixed suggested+list shape. 9 states → 11.

---
name: "yariv-app-map"
description: "Which of Yariv's repositories owns which app, so a bug report lands in the right code on the first search. Covers the tasks app (Maestro, tasks.yarivitzkovich.org, the reminders bell and AI capture screens, Emma on WhatsApp) living in family-tasks rather than Practicum-v2, how to attach that repo from a session started here, the branch its work merges to, the AI-diagnostics page that names a failing AI hop, and the hosts this cloud sandbox cannot reach. Use when a screenshot or report mentions תזכורות, הפקת תזכורות, משימות, Maestro, Emma, WhatsApp, or the tasks app, or when a Hebrew UI string cannot be found in the current repo."
---

# Which repo owns which app

Recorded 2026-09-10 after a session launched in Practicum-v2 received a
screenshot of the tasks app and searched the wrong codebase first.

## The rule

**A report about reminders, tasks, AI capture, Maestro or Emma belongs to
`itzkovichyariv-star/family-tasks`, not to Practicum-v2.** Search there first.

Evidence: the strings in the screenshot ("הפקת תזכורות", "הפק תזכורות
חדשות (AI)", "לא הצלחתי להבין. נסה: תזכיר לי [מתי] [לעשות מה]") do not exist
in Practicum-v2. They live in `family-tasks/src/components/RemindersBell.tsx`
and `family-tasks/src/lib/parse-error-suggestion.ts`. Practicum-v2's own
`package.json` deploy script points at `/Users/yarivitzkovich/Code/family-tasks`,
which is the tell.

| App | Repo | Live URL | Working branch |
|---|---|---|---|
| Practicum (placements, CV updates) | `itzkovichyariv-star/practicum-v2` | Cloudflare Pages `practicum-v2` | default branch |
| Maestro tasks app + Emma (WhatsApp worker) | `itzkovichyariv-star/family-tasks` | `https://tasks.yarivitzkovich.org` | `b8-rebuild` (PRs target it; no CI runs on PRs to it) |

## From a session started in Practicum-v2

Attach and clone once, then register it so its CLAUDE.md loads:

```
add_repo owner=itzkovichyariv-star repo=family-tasks access=push
git clone --depth 1 https://github.com/itzkovichyariv-star/family-tasks /home/user/family-tasks
register_repo_root owner=itzkovichyariv-star repo=family-tasks directory=/home/user/family-tasks
```

The repo's CLAUDE.md then gives the literal deploy commands. The app deploy is:

```
npm --prefix /Users/yarivitzkovich/Code/family-tasks run app:deploy
```

## When an AI screen says "I could not understand"

Both AI screens (reminders bell, tasks basket) call `/api/router/decompose`,
which calls Claude through a Cloudflare AI Gateway. Since PR #139 (merged
2026-09-10) a failed AI hop is reported as such, and this owner-only page
names the failing hop:

```
https://tasks.yarivitzkovich.org/api/diagnostics/ai
```

Verdicts: `ok`, `no_api_key`, `gateway_down_direct_ok`, `anthropic_refused`,
`all_down`. Ask Yariv for the verdict line before guessing at the cause.

## Sandbox limits (verified 2026-09-10)

- `gateway.ai.cloudflare.com` and `docs.anthropic.com` are blocked by the
  cloud sandbox's egress proxy. `api.anthropic.com` is reachable.
- `tasks.yarivitzkovich.org` is blocked too (CONNECT 403, verified later the
  same day). The build stamp, the diagnostics page and the live app can only
  be checked by Yariv from his phone or Mac; give him the URL, never claim to
  have looked.
- Local dev has no `ANTHROPIC_API_KEY`, so the AI parse cannot be exercised
  outside production. Test the code around it; report that gap plainly.

## "בעיה חוזרת" — the same AI failure again

When the screen already shows the post-#139 line ("שירות ה-AI לא הגיב …")
and Yariv says it keeps happening, do two things in the same turn:

1. Ask for the two lines only he can fetch, as copy-and-open URLs:
   `https://tasks.yarivitzkovich.org/api/diagnostics/ai` (the `verdict` and
   `detail` fields) and `https://tasks.yarivitzkovich.org/build-id.txt`.
2. Do not wait for them. Read the AI hop in code for a failure that repeats
   by construction. Found this way on 2026-09-10: a gateway that hangs
   spent the whole 15 s budget, so the direct retry #139 added never ran
   (fixed by reserving 6 s for the direct road, family-tasks PR "AI hop:
   keep the direct road's budget, and show the diagnosis on screen").

Since that fix the red line ends with `פרטים: …` naming the hop and the
upstream message (for example `Anthropic 400 (gateway): invalid_request_error:
Your credit balance is too low`, or `gateway: timed out after 9000 ms`).
A screenshot of that tail is the diagnosis; ask for it before anything else.

## A merge does not deploy, and the Mac clone does not pull itself

Verified 2026-09-10: PR #139 merged at 13:27 UTC; Yariv ran the deploy
command at 13:27 local from his Mac and the new page returned 404. His
deploy output listed no `ai_*.mjs` chunk and an `anthropic-endpoint` chunk
of 0.63 KiB (the merged code builds it at ~3 KiB, plus a 2.4 KiB `ai` chunk).
The clone on the Mac was still at the pre-merge commit, so the deploy
reshipped the old code. **Always give the pull before the deploy, as two
copy-and-run lines:**

```
git -C /Users/yarivitzkovich/Code/family-tasks pull origin b8-rebuild
```

```
npm --prefix /Users/yarivitzkovich/Code/family-tasks run app:deploy
```

To tell from a pasted deploy log whether the right code shipped, compare the
chunk list against a local `npm run build` of the merged commit: a missing
chunk or a much smaller one means a stale checkout.

The fastest live check is the build stamp, which needs no login:

```
https://tasks.yarivitzkovich.org/build-id.txt
```

It must match the `bump-sw-version` line of the deploy that carried the
change. A "still 404" report that arrives while a deploy is running (Yariv
reports as he goes) is answered by this URL, not by re-reading the code.

## How Yariv works with these PRs

He merges a fix himself within the hour and deploys from his Mac. Give the
deploy command and the verification URL in the final message, each on its
own line, copy-and-run. Provisional: seen once.

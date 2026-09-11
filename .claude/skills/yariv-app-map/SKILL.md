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

Better still, read the bracketed code the screen itself now shows (PR #142):
`[AI 404 direct]` is the upstream Anthropic status and road, `[HTTP 502]`
this app's own. **Put the diagnosis on the screen he is already looking at
rather than sending him to a second page.** He reports from his phone as he
goes; a second URL plus a login is a round trip he often will not make, and
the answer then stalls for hours. Confirmed twice, 2026-09-10 and 09-11.

A failure message must also name the right layer. The first version of this
fix collapsed every non-2xx into "the AI service failed", so an expired
login read as a broken AI — the same wrong-layer mistake the fix existed to
correct. When writing a failure message, enumerate every status the endpoint
can actually return before choosing the wording.

## When every AI surface dies at once, check the model id first

**Verified 2026-09-11.** The whole AI side of the tasks app stopped. Cause:
the call sites named the DATED SNAPSHOT `claude-haiku-4-5-20251001`, which
Anthropic had stopped serving; it answers a model it does not serve with
`400 invalid_request_error`. The current id is the bare alias
`claude-haiku-4-5`.

**Rule: always use the bare alias, never a date-suffixed id.** An alias
survives a retirement; a pin does not. `src/lib/model-ids.test.ts` in
family-tasks now fails the build on any dated id outside a test file.

The diagnostic that found it, worth reusing: **list every model id in the
repo and split it by which surfaces still work.**

```
grep -rn "claude-[a-z0-9-]*" --include=*.ts -o src workers | sed 's/.*:claude/claude/' | sort | uniq -c | sort -rn
```

Dead surfaces all carried the dated id; working ones (capture, Emma's main
tiers) carried bare aliases. That split also **ruled out the account-level
theories I had been pushing** — an exhausted balance or a revoked key would
have killed Emma too. A partial outage is evidence: ask what the working
paths do differently before asking the user to check billing.

Never answer an Anthropic API question from memory. Load the `claude-api`
skill; its model table is the authority on current ids, and it is what
identified the dated id here.

## Sandbox limits (verified 2026-09-10)

- `gateway.ai.cloudflare.com` and `docs.anthropic.com` are blocked by the
  cloud sandbox's egress proxy. `api.anthropic.com` is reachable.
- Local dev has no `ANTHROPIC_API_KEY`, so the AI parse cannot be exercised
  outside production. Test the code around it; report that gap plainly.

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

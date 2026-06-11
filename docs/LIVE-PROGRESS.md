# LIVE PROGRESS — running log (updated after every step)

**For a NEW session:** open Claude Code in `~/Code/practicum-v2` and say:
> Read docs/LIVE-PROGRESS.md and continue from the last line.

**Yariv's copy-link (GitHub):** https://github.com/itzkovichyariv-star/Practicum-v2/blob/main/docs/LIVE-PROGRESS.md
**Local path:** /Users/yarivitzkovich/Code/practicum-v2/docs/LIVE-PROGRESS.md

Binding rule (same as family-tasks): during any working session the assistant appends a line here after EVERY meaningful step and commits it (and pushes, once a remote exists). Newest entries at the bottom.

---
## LOG (newest at bottom)

- 2026-06-11 — Live-progress log created (family-tasks pattern). BLOCKER for the live link: no GitHub remote on this repo — Yariv to approve creating a PRIVATE repo (or create one and `git remote add origin <url>`).
- 2026-06-11 — Remote wired to github.com/itzkovichyariv-star/Practicum-v2. The GitHub copy was a stale April-27 upload (66 commits, unrelated history); plan: ours-merge absorbing it + normal push, executed by Yariv (assistant push was permission-gated). Verified before touching anything: Cloudflare Pages has NO git integration for practicum-v2 (deploys = direct upload from the Mac), live site 200 serving v1.14.4+build.43 — students/registration unaffected by ANY GitHub operation.
- 2026-06-11 — 🔴 INCIDENT + RECOVERY: עינה נוימן accidentally reverted to submissions (13:42Z) and re-accepted (13:43Z) → her candidate card was rebuilt bare: interviewConducted, evalScore 90, all 5 eval dimensions, interview summary and preferredArea wiped. FULL restore performed from snapshot v879 (12:24Z, practicum_snapshots table — the auto-snapshot-on-every-save system held; last 50 versions kept). Verified live in app: badge ראיון בוצע back, score 90, summary intact, original record id restored.
- 2026-06-11 — Safety guard shipped (v1.14.5, f70bbc18): revert-to-submission — the one destructive action with NO confirm — now shows a detailed warning listing exactly which of THAT candidate's data will be lost + points to ניהול→גרסאות for recovery; candidate-delete confirm strengthened; both write labeled snapshots (action/entity/target) instead of anonymous 'שמירה'. Browser-verified: click ↩ הגשות → correct warning with her 4 at-risk items, cancel → record untouched.

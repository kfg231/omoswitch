---
description: Resume OmOswitch phase 2 (provider & model management) from the committed handoff
---

<command-instruction>
You are resuming work on **OmOswitch** in a fresh session. Follow these steps in order.

**Step 1 — Read the handoff before anything else.**
Read `C:\Users\tom\Downloads\omoswitch\.omo\plans\RESUME.md` in full. It states the
stop point, the verified current numbers, why phase 2 exists, six traps that already
bit this project, and the pending decisions.

**Step 2 — Read the plan sections you need.**
From `C:\Users\tom\Downloads\omoswitch\.omo\plans\omoswitch.md` read, in this order:
`# PHASE 2 PLAN — decisions (D1–D15)`, `## Phase 2 contract additions`,
`## Phase 2 file ownership`, `## Phase 2 waves`,
`## Phase 2 scenario contract`, `## Phase 2 success criteria`.
That file is the single source of truth. Do NOT re-research OmO or CC Switch on
GitHub — every fact needed is already verified and written there.

**Step 3 — Confirm the state yourself, do not trust this text.**
```
git -C C:\Users\tom\Downloads\omoswitch log --oneline -3
git -C C:\Users\tom\Downloads\omoswitch status --short
```
Expect last commit `122d02f docs(plan): add RESUME handoff for phase 2` and a clean
tree. If the tree is dirty or the head differs, STOP and report what you found
before changing anything — someone else may have worked in this worktree.

**Step 4 — Dispatch Wave 1, one task only.**
Spawn T0 from `## Phase 2 waves` and nothing else:
`task(category="deep-low", load_skills=["programming","context7-mcp"], run_in_background=true, prompt=<T0 brief>)`
T0 solely owns `error.rs`, `paths.rs`, `lib.rs`, and `Cargo.toml`. Launching any
Wave 2 task before T0 lands will collide on those files.

**Step 5 — Verify, commit, then advance.**
After each task: run its acceptance command yourself and read the output. A subagent
report is not evidence — test counts and file listings are. Then commit that task
with its Conventional Commit message from the plan, staging only its files.
Proceed wave by wave; verify a wave's criteria before dispatching the next.

**Hard constraints carried over.**
- Never write to the `[opencode]` block of `omo.jsonc`. CC Switch v3.20.4 writes that
  same file and has already destroyed data in it.
- Never echo API key values. Fixture keys are literally `TEST-NOT-A-REAL-KEY`.
- Playwright runs on the Edge channel; the Chromium download times out here.
- All QA runs against a temp dir via `OMOSWITCH_OMO_HOME`. The real
  `~/.omo` is touched only in P-final, and only after the user explicitly approves.
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>

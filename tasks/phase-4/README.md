# Phase 4 — Stubs

## task-01 — Git diff capture

After the SDK run finishes successfully, the worker runs `git diff --stat` and `git diff` on the worktree, emits a `diff_ready` message with stat and full patch.

## task-02 — `gh pr create` integration

When the user clicks "Open PR" on a card in `review` status, parent sends `approve_pr` with title/body to the worker. Worker:
1. `git push -u origin <branchName>`
2. `gh pr create --title ... --body ... --base <baseBranch> --head <branchName>`
3. Emits `pr_opened` with the URL.

If `gh` is missing or unauthenticated, surface a clear card-level error and disable the button.

## task-03 — `PreToolUse` hook for tracing

Add a `PreToolUse` hook in worker `runAgent`. Records `(timestamp, tool, args)` to a separate trace file at `~/.claude-kanban/traces/<runId>.jsonl`. UI can render this as a "what the agent did" timeline distinct from the streaming log.

## task-04 — Skill loading toggle

Per-card option: "Load skills from `<repoPath>/.claude/skills/`?" When true, worker passes `settingSources: ["project"]` and includes `Skill` in `allowedTools`. Document the security implication: the user is trusting whatever skills exist in that repo.

**Phase-4 done when:** Successful runs produce real PRs. Skill loading is opt-in per card.

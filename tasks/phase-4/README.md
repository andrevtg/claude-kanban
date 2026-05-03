# Phase 4

See individual task files in this directory:

- `task-01-git-diff.md` — capture `git diff --stat` and the full patch
  after a successful run; render in the drawer's diff pane
- `task-02-gh-pr-create.md` — push branch and open a PR via the GitHub
  CLI on user approval; pre-flight `gh` install/auth state; ADR-010
- `task-03-pretooluse-hook.md` — `PreToolUse` hook records every tool
  call to `~/.claude-kanban/traces/<runId>.jsonl`; drawer trace pane
- `task-04-skill-loading-toggle.md` — per-card opt-in for loading
  skills from `<repoPath>/.claude/skills/`; default off, per-session
  re-confirmation

**Phase-4 done when:** Successful runs produce real PRs. Skill loading
is opt-in per card. Every tool call is traced. Diffs are visible in
the drawer.

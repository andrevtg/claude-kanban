# 00 — Overview

## What we're building

A single-user web app that mimics the Cursor `agent-kanban` UX, but uses the Claude Agent SDK in local mode as the runtime.

A **card** on the board represents one task the agent will perform on a real local git repository — for example, "fix the failing test in `auth.spec.ts`" or "add a `--dry-run` flag to the CLI." When the user moves a card from `Backlog` to `In Progress` (or clicks "Run"), the system:

1. Picks up the configured repo path and base branch.
2. Spawns a worker subprocess.
3. The worker creates a fresh working tree (git worktree) at a scratch path under `~/.claude-kanban/work/<run_id>/`.
4. The worker invokes `query()` from `@anthropic-ai/claude-agent-sdk` with the user's prompt, the worktree as `cwd`, and a curated `allowedTools`.
5. SDK messages stream from the worker to the Next.js process via stdout (NDJSON), then from Next.js to the browser via SSE.
6. When the run terminates, if it exited successfully and produced a non-empty diff, the worker offers to push the branch and open a PR using `gh pr create`. The user approves the PR step from the card UI before it runs.

## Why local first

- **Skill build.** The Agent SDK surface (query/options/streaming/permissions/hooks) is the same primitives the Managed Agents version will use. Internalize it without the operational layer.
- **Faster iteration.** No network round trips, no session-hour billing, no beta-header churn.
- **Demo-friendly.** Runs on a laptop with `pnpm dev` and an `ANTHROPIC_API_KEY`. Nothing else.
- **Real PRs.** Because the worker has access to the local working copy and `gh`, demos can show end-to-end "task → PR opened" without any cloud setup.

## Why a worker subprocess

The naive thing is to call `query()` inside a Next.js route handler. Don't do that:

- A long agent run blocks the route handler and starves the event loop for everything else.
- A crash in the SDK process takes down the whole web app.
- The SDK spawns a Claude Code subprocess of its own; nesting that under Next's dev server is fragile.
- Worker isolation is exactly the boundary Managed Agents enforces. Building it now means the eventual port is a *substitution*, not a *rewrite*.

So: each run is its own Node process. Long-lived. Crashes only kill that one run. The protocol between Next.js and worker is explicit, typed, and small.

## Non-goals

- Multi-user / auth / RBAC.
- Cloud deployment. (`localhost`-only is fine.)
- Multiple repos open simultaneously per card. One repo per card.
- Visual diff viewer beyond a text/markdown rendering of `git diff`.
- Custom MCP servers or skills in phase 1. Hooks for these land in phase 4.
- Replacing the Cursor cookbook 1:1. We're inspired by it, not bound to its API.

## Success criteria for v1

A user can:

1. Configure a local repo path and `ANTHROPIC_API_KEY` once via a settings screen.
2. Create a card, type a task description, drag it to "In Progress."
3. Watch agent output stream live: tool calls, file edits, reasoning text.
4. See a final summary with files changed and a button "Open PR."
5. Click "Open PR" → branch is pushed, `gh pr create` runs, PR URL appears on the card.
6. Reload the page; all cards and their event logs are still there.

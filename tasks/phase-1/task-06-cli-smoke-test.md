# phase-1 / task-06 — CLI smoke test

## Goal

Wire everything from tasks 01–05 into a tiny CLI that proves the architecture works end-to-end without a UI. After this task, you have a working agent runner that we'll hang the kanban onto in phase 2.

## Inputs

- All of phase-1 so far

## Outputs

### `src/cli/index.ts`

A `tsx`-runnable entrypoint:

```
pnpm cli run --repo <path> --base <branch> --prompt "<text>" [--model claude-opus-4-7]
```

Behavior:
1. Loads `GlobalSettings`; if `apiKeyPath` not configured or `ANTHROPIC_API_KEY` not set, prints a clear setup message and exits 1.
2. Creates a `Card` document for this CLI invocation (status `running`, persisted via the store).
3. Calls `supervisor.startRun(card, settings)`.
4. Subscribes to `run-event` and pretty-prints a compact form to the terminal:
   - `[init]   model=... cwd=...`
   - `[think]  <first 80 chars of assistant text>...`
   - `[tool]   <tool_name>(<arg summary>)`
   - `[result] success | failure: <message>`
5. Exits with the worker's exit code.

### `package.json`

Add a `cli` script: `"cli": "tsx src/cli/index.ts"`.

## Acceptance

Manual smoke test (documented in this task file's acceptance section, not automated):

1. `cd ~/some-real-git-repo`
2. `pnpm cli run --repo "$PWD" --base main --prompt "Read the README and summarize what this project does in 3 bullet points."`
3. You should see `[init]`, several `[think]` and `[tool]` lines, and a final `[result] success`.
4. `~/.claude-kanban/cards/` contains a card JSON.
5. `~/.claude-kanban/logs/run_*.ndjson` contains the full event log.
6. `~/.claude-kanban/work/run_*` contains a worktree with no committed changes (the prompt was read-only).

A second smoke test with a write prompt:

7. `pnpm cli run --repo "$PWD" --base main --prompt "Add a TODO.md at the repo root with three sample items."`
8. After completion, the worktree directory contains the new file.

## Out of scope

- Capturing the diff or opening a PR (phase-4).
- Rendering events to anything other than terminal stdout.
- Watching the run from another terminal.

## Marker for end of phase 1

When this task is done and the smoke tests pass, **phase-1 is complete**. The architectural skeleton works. Phase 2 starts a Next.js app that consumes the same supervisor.

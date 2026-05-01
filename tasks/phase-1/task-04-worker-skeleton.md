**STATUS: done**

# phase-1 / task-04 — Worker skeleton

## Goal

Build the worker entrypoint that:

1. Reads an `init` `WireMessage` from stdin.
2. Creates a git worktree at `paths.runDir(runId)` based on `repoPath` + `baseBranch`.
3. Calls `query()` from the Agent SDK, forwards every SDK message to the parent as an `event` `WireMessage`.
4. On termination, emits `done` and exits.

Cancellation, PR flow, and diff capture are **not** in this task — they're task-05 and phase-4.

## Inputs

- `src/protocol/` types
- `docs/02-agent-sdk-usage.md` — the SDK invocation pattern

## Outputs

### `src/worker/stdio.ts`

- Async generator that yields parsed `WireMessage`s from stdin (newline-delimited JSON).
- `send(msg: WireMessage)` writes a line to stdout, flushing if needed.
- Treats stdin EOF as an implicit cancel signal.

### `src/worker/git.ts`

- `createWorktree(repoPath, baseBranch, runId): Promise<{ worktreePath, branchName }>`.
  - Branch name: `claude-kanban/<runId>`.
  - Throws a typed error if the repo has uncommitted changes blocking the operation, or if the base branch doesn't exist.
- `cleanupWorktree(worktreePath)` — best-effort, logs on failure but doesn't throw.

### `src/worker/run.ts`

- `runAgent(init: InitPayload, send: SendFn): Promise<{ exitCode }>`.
- Constructs `query()` options from init payload + global settings.
- Iterates the async generator, wraps each `SDKMessage` in an `event` `WireMessage`, and calls `send`.
- Handles SDK errors by emitting an `error` message and returning a non-zero exit code.

### `src/worker/index.ts`

- Glue: read init, run, cleanup, exit.
- Process exit codes: `0` success, `1` SDK error, `2` git error, `3` protocol/init error.

## Acceptance

- A unit test for `stdio.ts` that pipes synthetic NDJSON in and verifies `WireMessage` outputs.
- A unit test for `git.ts` that runs against a temp repo (use a fixture: `git init`, one commit, then `createWorktree`).
- A small integration smoke test (skipped by default, opt-in via `RUN_LIVE_SDK_TESTS=1` env var) that calls `runAgent` with a trivial prompt against a fixture repo and asserts at least one `assistant` message and one `result` message arrive.

## Out of scope

- Cancellation handling (task-05).
- Diff/PR logic (phase-4).
- Permission callbacks beyond `permissionMode: "acceptEdits"` (phase-4).

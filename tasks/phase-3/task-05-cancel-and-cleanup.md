# phase-3 / task-05 — Cancel button and stale-run cleanup

## Goal

Two related lifecycle gaps from phase-1/2:

1. The phase-2 UI has no way to stop a running card. The endpoint
   exists (`POST …/cancel`) but the worker's SDK loop in
   `src/worker/run.ts` doesn't read its stdin, so cancellation only
   takes effect via the supervisor's SIGTERM/SIGKILL escalation
   (5+5s). Wire cooperative cancel via `query.interrupt()` so
   clicking Cancel feels responsive, then expose the button in the UI.
2. Worktree directories under `~/.claude-kanban/work/` are created
   per run and (per `aa2d1db`) intentionally retained after a run
   exits for inspection. With nothing pruning them, they accumulate
   indefinitely. Add a stale-run sweep that runs once on supervisor
   start and removes worktrees whose run has finished and is older
   than a configurable threshold.

## Inputs

- `src/worker/run.ts` (or wherever the SDK iterator lives) — needs a
  concurrent reader that consumes wire messages from stdin and calls
  `query.interrupt()` on `{ type: "cancel" }`
- `src/lib/supervisor/index.ts` — `cancel(runId)` already writes the
  cancel message to the worker's stdin and starts the SIGTERM/SIGKILL
  escalation timers; no change needed unless the cooperative path
  warrants extending the escalation timeline
- `src/app/api/cards/[id]/runs/[runId]/cancel/route.ts` — already
  returns `202`; no changes
- `src/lib/paths.ts` — `workDir()`, `runDir(runId)`
- `src/lib/store/index.ts` — needed for the sweep to map worktree
  directory names back to runs and check `endedAt`
- `tasks/phase-3/task-04-card-detail-drawer.md` — where the Cancel
  button lives in the UI
- `docs/01-architecture.md` "User cancels mid-run" failure-mode row
- The note at the bottom of the original `phase-3/README.md` stub
  about `q.interrupt()` and concurrent stdin reading

## Outputs

### Worker-side cooperative cancel

In `src/worker/run.ts`:

- Run the SDK iterator and a `readWireMessages(stdin)` loop
  concurrently.
- On a `{ type: "cancel" }` wire message, call `query.interrupt()`
  (the SDK promise/iterator handle returned by `query()`). Continue
  reading stdin until the SDK iterator settles, so a second cancel
  while one is in flight is a no-op.
- On any other inbound message that the worker handles
  (`approve_pr`), keep existing behavior.
- Write a `worker` `AgentEvent` indicating cancellation was received,
  so the SSE stream surfaces it before the run terminates.

Document the chosen concurrency primitive (Promise.race over a
generator pump, an `AbortController`, etc.) in the file's top comment.

### Supervisor adjustment (only if needed)

The existing escalation timers (5s SIGTERM, 5s SIGKILL) stay as a
backstop. With cooperative cancel working, the worker should exit
well before SIGTERM fires. No changes to `Supervisor.cancel` are
expected; if the escalation feels too aggressive once cooperative
cancel lands, tune the defaults — don't restructure the API.

### Stale-run sweep

New: `src/lib/supervisor/cleanup.ts` (or co-located in
`src/lib/supervisor/index.ts`):

```ts
export async function sweepStaleWorktrees(
  store: Store,
  opts?: { maxAgeMs?: number; now?: Date },
): Promise<{ removed: string[]; kept: string[]; orphans: string[] }>;
```

Behavior:

- List directories under `workDir()`. Each directory name is a `run_<ulid>`.
- For each, find the owning run by scanning `store.listCards()` for a
  card whose `runs[]` contains the matching `id`.
- Remove the worktree if **all** of:
  - The run is found and has an `endedAt`.
  - `now - endedAt >= maxAgeMs` (default: 24h).
- Skip (keep) if the run is found and has no `endedAt` (active or
  crashed-but-state-not-yet-flushed).
- Track as `orphans` if no card claims the run id. Do **not** delete
  orphans automatically — log them and let the user decide. (A
  follow-up CLI command can remove orphans; out of scope here.)
- Return the three lists; the caller decides what to log.

Wire the sweep into `getSupervisor()` so it runs once per supervisor
construction (i.e. once per Next.js process / HMR cycle). Fire-and-forget
with a `.catch` that writes to `process.stderr` — no silent failures.

### Cancel button in UI

In the drawer (task-04):

- When the selected run is the active one (no `endedAt`), show a
  Cancel button next to the run history row.
- Click → `POST /api/cards/:id/runs/:runId/cancel`. Always succeeds
  (`202`). Mark the row as "cancelling…" until the SSE stream emits
  the `done` frame. Then mark it as "cancelled" (or `failed` per the
  worker's terminal status; whichever the SDK reports).

A condensed Cancel affordance also lives on the running-column board
card (task-02) so the user doesn't have to open the drawer for the
common case. Both routes hit the same endpoint.

## Acceptance

Manual acceptance — exercise each behavior:

1. **Cancel button visible only on the active run.** Open the drawer
   for a card with one finished run. No Cancel button. Trigger a new
   run; while it's active, Cancel is visible on that run's row in
   history and on the board card. After the run ends, Cancel
   disappears.
2. **Cooperative cancel — quick exit.** Trigger a long-running run
   (something with a few tool calls). Click Cancel. Within ~1s, the
   event log emits a "cancelling" `worker` event, then the SDK
   iterator settles and the SSE stream emits `done`. Total time from
   click to `done` should be well under the 5s SIGTERM threshold.
   Verify `Supervisor.escalate`'s SIGTERM did *not* fire by checking
   the per-run stderr file in `~/.claude-kanban/logs/` — no signal
   noise.
3. **Cancel idempotency.** Click Cancel twice in quick succession on
   the same run. Both `POST` calls return `202`; only one
   "cancelling" event appears in the log; the run still ends cleanly.
4. **Cancel after the run already finished.** With a finished run
   selected, no Cancel button is visible (per acceptance 1). If you
   force the request via `curl POST …/cancel`, the route still
   returns `202` (idempotent per task-02 acceptance) and nothing
   else happens.
5. **Stale-run sweep on startup — removes old worktree.** Manually
   create `~/.claude-kanban/work/run_<ulid>/` for a `runId` that
   matches a card whose run has `endedAt` set to >24h ago (edit the
   card JSON by hand). Restart `pnpm dev`. The directory is gone;
   stderr logs `removed: [run_<ulid>]`.
6. **Stale-run sweep — keeps recent finished run.** Same setup but
   with `endedAt` set to 5 minutes ago. Restart. Directory is still
   there; stderr logs `kept: [...]`.
7. **Stale-run sweep — keeps active run.** Setup: a worktree exists
   for a run with no `endedAt`. Restart. Directory is still there.
   No spurious removal of a run that the supervisor will adopt as
   active on the next click (although v1 doesn't actually re-adopt;
   that's phase 5).
8. **Stale-run sweep — orphan logged not deleted.** Create
   `~/.claude-kanban/work/run_DEADBEEF/` with no matching card.
   Restart. Directory is still there; stderr logs the orphan id.
9. **Phase-2/3 regressions.** Run, event log, board, drawer, settings
   all still work. CLI smoke test still works.

## Out of scope

- A CLI subcommand to prune orphans interactively. Future task.
- Re-adopting an already-running worker on supervisor restart. v1 of
  the supervisor (task-05 phase-1) explicitly accepted that an HMR
  cycle abandons in-flight runs; that decision stands.
- Configurable sweep schedule (running every N hours instead of
  once at startup). Startup-only is enough for a local single-user
  tool.
- A "sweep now" button in the settings page. Phase 5 polish.
- Cleaning up `~/.claude-kanban/logs/*.ndjson` files. Logs are
  forensic gold per `docs/01-architecture.md`; they stay until the
  user deletes them by hand.
- Cancelling via SIGINT / Ctrl-C in the terminal that runs `pnpm dev`.
  Out of scope — this is a UI cancel.
- Hooks intercepting Cancel — phase 4.

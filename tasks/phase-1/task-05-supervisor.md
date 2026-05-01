**STATUS: done**

# phase-1 / task-05 — Supervisor

## Goal

Build the parent-side supervisor that spawns workers, multiplexes their stdout into the store and an in-memory event bus, and enforces invariants (one active run per card, wall-clock timeout, clean cancellation).

## Inputs

- task-02 protocol types
- task-03 store
- task-04 worker
- ADR-001 in `docs/03-decisions.md`

## Outputs

### `src/lib/supervisor/index.ts`

```ts
class Supervisor {
  startRun(card: Card, settings: GlobalSettings): Promise<RunHandle>;
  cancel(runId: string): Promise<void>;
  approvePr(runId: string, pr: PrApprovalPayload): Promise<void>;
  on(event: "run-event", listener: (runId: string, e: EventLogEntry) => void): this;
  on(event: "run-done", listener: (runId: string, exit: number) => void): this;
}

interface RunHandle {
  runId: string;
  cardId: string;
  pid: number;
  startedAt: string;
}
```

### Behavior

- `startRun` rejects if another run for the same `cardId` is active. Returns a handle once the worker emits `ready`.
- Spawns the worker via `child_process.spawn("node", [workerEntry], { stdio: ["pipe","pipe","pipe"] })`.
- Pipes stdout through a line-buffer + `parseWireMessage`. Invalid lines emit a synthetic `error` event (don't crash).
- Pipes worker stderr to a per-run file under `~/.claude-kanban/logs/<runId>.stderr` and to the parent's stderr (prefixed with run id).
- Emits each parsed `event` over the `run-event` event; also passes it to `store.appendEvent`.
- On `done`, calls `store.patchRun` with `endedAt` and `exitCode`, emits `run-done`, removes from active map.
- Wall-clock timeout: configurable per run (default 30 min). On timeout, sends `cancel`, then `SIGTERM` 5s later, then `SIGKILL` 5s later.

## Acceptance

- `node --test` tests (run via tsx) with a **fake worker**: a small Node script that emits scripted NDJSON to stdout and exits with a chosen code. Covers:
  - happy path: ready → events → done.
  - malformed line: synthetic error emitted, supervisor stays alive.
  - timeout path: worker hangs; supervisor escalates SIGTERM → SIGKILL.
  - duplicate-run rejection.
- No real SDK invocation in unit tests.

## Out of scope

- HTTP/SSE plumbing (task-06 / phase-2).
- PR approval payload handling beyond passing it through (phase-4 implements the worker side).
- Resource limits (memory, CPU). Add when there's a reason.

## Design notes

The supervisor is a long-lived singleton inside the Next.js process. Phase 2 will wire it as a module-level instance behind `getSupervisor()`. Don't try to share it across Next.js dev-server reloads cleanly in v1; the dev experience of "one supervisor per HMR cycle" is acceptable.

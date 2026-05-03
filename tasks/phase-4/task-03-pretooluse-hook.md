# phase-4 / task-03 — `PreToolUse` hook for tracing

## Goal

Add a `PreToolUse` hook to the Agent SDK invocation in the worker that
records `(timestamp, tool, args)` for every tool call to a structured
trace file at `~/.claude-kanban/traces/<runId>.jsonl`. The trace file
sits alongside the per-run NDJSON event log but is separate, so the UI
can render a focused "what the agent actually did" timeline distinct
from the streaming reasoning/tool/result chips already shown in the
event log. The hook never blocks or modifies tool calls in v1 — it is
a pure observer.

## Inputs

- `src/worker/run.ts` — where the SDK `query()` is invoked; the
  `hooks` option lands here
- `src/worker/index.ts` — the worker entry; the trace file's path
  arrives via the init payload (worker doesn't import `paths.ts`)
- `src/protocol/messages.ts` — `RunInitPayloadSchema` gains
  `tracePath` (worker writes to it directly; not a wire-protocol
  concern beyond the init carrying the path)
- `src/lib/paths.ts` — add `tracesDir()` and `tracePath(runId)`
- `src/lib/supervisor/index.ts` — populates `init.tracePath`; ensures
  `tracesDir()` exists at supervisor construction
- `src/lib/supervisor/cleanup.ts` — extend the stale-run sweep to
  also remove `traces/<runId>.jsonl` past the age threshold (mirroring
  the way task-01 extends the sweep for `diffs/`)
- `src/components/card-drawer.tsx` — host for the new trace timeline
- `docs/02-agent-sdk-usage.md` — the deferred section explicitly
  lists hooks as a phase-4 concern; this task flips that flag and
  documents the hook configuration
- `docs/01-architecture.md` — Failure-modes table gains a row for
  "trace write fails"
- `tasks/phase-3/task-04-card-detail-drawer.md` — the drawer this
  timeline plugs into

## Outputs

### SDK option update (`src/worker/run.ts`)

Add a `hooks` block to the `query()` options. The hook is a
`PreToolUse` matcher that runs for all tools and returns the
permission default ("continue") — it never blocks. Sketch:

```ts
hooks: {
  PreToolUse: [
    {
      matcher: { },     // all tools
      hooks: [async (input) => {
        await traceWriter.append({
          ts: new Date().toISOString(),
          tool: input.tool_name,
          args: redactArgs(input.tool_input),
        });
        return { decision: "continue" };
      }],
    },
  ],
}
```

The exact shape comes from the SDK's typed hook surface — confirm
against the agent-sdk skill before locking in. If the surface differs,
match the SDK's actual API rather than the sketch above.

`redactArgs` is a small pure function in `src/worker/trace.ts` that
truncates string fields to `MAX_ARG_BYTES` (default 4 KiB) and
replaces binary or huge payloads with `"[truncated N bytes]"`. The
trace file is forensic, not a content store; long tool inputs go into
the regular event log.

### New module: `src/worker/trace.ts`

```ts
export interface TraceEntry {
  ts: string;
  tool: string;
  args: unknown;            // already redacted
}

export interface TraceWriter {
  append(entry: TraceEntry): Promise<void>;
  close(): Promise<void>;
}

export function openTraceWriter(path: string): TraceWriter;
export function redactArgs(input: unknown, maxBytes?: number): unknown;
```

`openTraceWriter` opens the file in append mode and serializes writes
via an internal queue so concurrent hook invocations don't interleave.
On any write failure, it emits a worker event (via an injected
`SendFn`) and continues — trace failures must not crash the run. This
mirrors CLAUDE.md's "no silent failures" rule while keeping the hook
non-blocking.

Tests in `src/worker/trace.test.ts`: append round-trip, redaction at
the cap, concurrent appends preserve order, write-failure path emits
exactly one warning event.

### Worker integration (`src/worker/index.ts`)

After `createWorktree` succeeds, open the trace writer with
`init.tracePath`. Pass it down to `runAgent`. On worker exit (success
or failure), close the writer. If the trace file is empty at close
time (no tool calls fired), leave it as a zero-byte file — the
presence of the file documents that tracing was active for the run.

### Supervisor wiring (`src/lib/supervisor/index.ts`)

- Ensure `tracesDir()` exists at supervisor construction.
- Populate `init.tracePath = tracePath(runId)` when constructing
  `RunInitPayload`.
- No new wire messages; the trace file is purely a worker-side
  artifact, served to the UI via a new API route below.

### Stale-run sweep extension

`src/lib/supervisor/cleanup.ts`: extend the sweep to also remove
`~/.claude-kanban/traces/<runId>.jsonl` for runs past the age
threshold. Same orphan semantics: an orphan trace (no matching card)
is logged but not auto-deleted. Tests added.

### New API route: `GET /api/cards/:id/runs/:runId/trace`

Streams the JSONL trace file with
`Content-Type: application/x-ndjson`. Returns `404 trace_not_found`
if the file doesn't exist (e.g., older runs from before this task).
Live updates are not in scope for v1; the timeline polls or refetches
when the SSE stream emits a `done` frame. Live tailing of the trace
file would duplicate the SSE event log's role; v1 keeps them separate
and accepts a one-shot fetch.

### UI: `src/components/run-trace.tsx`

Client component. Props: `{ cardId, runId, runDone }`. Behavior:

- On mount and on `runDone` flipping true, fetch
  `/api/cards/:id/runs/:runId/trace`, parse line-by-line, render as
  a vertical timeline: one row per tool call with timestamp, tool
  name, and a collapsed args preview.
- Empty file: "No tool calls recorded for this run."
- 404: "Tracing not enabled for this run."
- Fetch error: inline error with retry.

Mounted inside `<CardDrawer>` as a tab or sibling pane next to the
event log and (if task-01 lands first) the diff pane. Tab/pane layout
is the frontend-design / shadcn skills' call.

### Documentation updates

`docs/02-agent-sdk-usage.md`:

- Move the `PreToolUse` bullet out of "Hooks and skills (deferred)"
  into a new "Hooks" subsection that documents the actual hook
  configuration used and points at `src/worker/run.ts`.
- Skills bullet stays deferred to task-04.

`docs/01-architecture.md`:

- Failure-modes table gains: | Trace write fails mid-run | Worker
  emits a single `worker warn` event; tracing degrades to
  best-effort; the run continues. |
- Data-model section: add a sentence noting `traces/<runId>.jsonl`
  alongside the existing `logs/` and `work/` entries.

## Acceptance

Manual acceptance — verify each visible state:

1. **Trace file created on first hook fire.** Run a card whose
   prompt triggers at least one tool call. After the first tool
   fires, verify `~/.claude-kanban/traces/<runId>.jsonl` exists and
   contains one line with `ts`, `tool`, and `args`.
2. **Trace file appended on subsequent fires.** As the run continues,
   `wc -l ~/.claude-kanban/traces/<runId>.jsonl` increases by one
   per tool call. Each line is independently `JSON.parse`-able.
3. **Trace file persists after run completes.** After the run ends,
   the file is still on disk. The drawer's trace pane fetches and
   renders it as a timeline of tool calls.
4. **Trace file survives until the stale-run sweep removes it.**
   With a run record older than 24h, restart `pnpm dev`. Both the
   worktree and the trace file are removed; stderr logs both
   removals.
5. **Run with zero tool calls produces an empty trace file.** Run a
   prompt that emits only assistant text (no tools). Trace file
   exists but is zero bytes; the drawer shows "No tool calls
   recorded for this run."
6. **Trace write failure does not crash the run.** Force a write
   failure (e.g., chmod the traces dir to read-only mid-run, or
   inject a failing writer in tests). The run continues to
   completion; the event log shows exactly one
   `worker warn: trace write failed` event; subsequent tool calls
   do not produce more warnings (write attempts skip silently after
   the first failure).
7. **Hook never blocks tool execution.** Compare a run with the
   hook active to a sentinel run with the hook bypassed (test-only
   flag). Wall-clock difference is within noise (target: under 50ms
   total overhead for a 20-tool-call run).
8. **Args redaction.** Run a prompt that triggers a tool with a
   >4 KiB string arg. The trace entry contains
   `"[truncated N bytes]"` for that arg; the regular event log
   still carries the full arg.
9. **Older runs (pre-task) show 404.** A run that completed before
   this task lands has no trace file. Drawer pane shows "Tracing
   not enabled for this run."
10. **Worker tests.** `node --test src/worker/trace.test.ts` passes
    for append round-trip, redaction, concurrent ordering, and the
    write-failure path.
11. **Supervisor sweep test.** A new test in
    `src/lib/supervisor/cleanup.test.ts` covers trace-file removal
    at age threshold and orphan-trace logging.

### Regression checks

- Phase-2 run pipeline: drag a card to running, watch events stream
  end-to-end.
- Phase-3/task-01 card CRUD: create, edit, delete still work.
- Phase-3/task-02 DnD: drag between columns still works.
- Phase-3/task-03 settings page: GET/PUT still work.
- Phase-3/task-04 drawer: opens, run history, log selection still
  work; the new trace pane is additive.
- Phase-3/task-05 cancel + sweep: cancel still cooperates within
  ~1s; sweep still runs on supervisor construction; trace-file
  removal joins the existing removals without breaking either.
- Phase-4/task-01 diff capture: `diff_ready` still persists
  `diffStat` and the diff pane still renders.
- Phase-4/task-02 PR creation: pre-flight, push, and PR creation
  still work; `prUrl` still persists.
- `pnpm cli run …` still works.
- `pnpm typecheck` and `pnpm lint` pass.

## Note for phase-5/task-04 handoff

Hooks are an Agent SDK concept that applies identically in both
local and Managed Agents modes; the hook callback itself ports
cleanly. What changes is the trace-file storage: in Managed Agents
mode the trace lives as a session artifact in the cloud sandbox
rather than at `~/.claude-kanban/traces/`, and the API route fetches
it from the session instead of the local FS. The UI's `<RunTrace>`
component is unchanged — only its data source flips.

## Out of scope

- `PostToolUse`, `Stop`, or other hooks beyond `PreToolUse`. Future
  task if a use case appears.
- Hooks that block or modify tool calls (the "deny risky bash" use
  case). Out of scope; v1's bash allowlist already covers it
  bluntly.
- Live-tailing the trace file in the UI. The SSE event log already
  shows tool calls live; the trace pane is for retrospective review.
- A "what tools were used" aggregate view across runs. Phase 5
  polish.
- Trace redaction policy beyond byte-cap truncation (e.g., regex on
  secret-looking strings). Out of scope; users are responsible for
  prompts that don't leak secrets into args.
- MCP server configuration, the Managed Agents port itself,
  multi-repo per card, multi-PR per run, scheduled runs, watch mode,
  deployable form — deferred to phase 5+.

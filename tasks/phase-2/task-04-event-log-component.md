**STATUS: done**

# phase-2 / task-04 — Event log on a single card

## Goal

Make the phase-2 work visible in a browser. Render exactly one hardcoded
card on the home page with a "Run" button. Clicking Run posts to the
run endpoint, then opens the SSE stream and renders incoming events into
a scrolling log. This is the smallest UI that proves the full pipeline
(route handler → supervisor → worker → SSE → browser) works end to end.

No kanban columns. No drag-and-drop. No multi-card. No card editing.
Those are phase 3.

## Inputs

- `docs/01-architecture.md` — endpoint list, SSE contract
- `src/protocol/messages.ts` — `WireMessage`, `AgentEvent`, `SDKMessage`
  shapes (the consumer will pattern-match on `message.type` to decide
  how to render each event)
- `src/cli/index.ts` — phase-1 reference for which SDK message shapes
  are worth surfacing (`init`, `assistant.text`, `assistant.tool_use`,
  `result`)
- The endpoints from task-02 and the SSE stream from task-03

## Outputs

### `src/components/run-log.tsx`

A client component (`"use client"`) that:

- Accepts `{ cardId: string; runId: string }` as props.
- Opens `new EventSource("/api/cards/${cardId}/runs/${runId}/events")`.
- Maintains an append-only list of rendered entries. Each entry is keyed
  by a monotonic counter (events are duplicate-tolerant per task-03's
  known race; don't try to dedupe in v1).
- Renders a fixed-height scrolling region; auto-scrolls to the bottom
  on new events unless the user has scrolled up.
- Closes the `EventSource` on the `done` SSE event (and on unmount).

The visual treatment is intentionally not pre-decided in this task file
— the frontend-design skill is the right place for layout, spacing,
typography, and color. This task's job is the data plumbing and the
rendering decisions about *which* events to show as *what kind* of row
(reasoning text vs. tool call vs. tool result vs. terminal status).

A reasonable starting taxonomy, mirroring the CLI:

- `system / init` → "Run started" header row.
- `assistant` content blocks: `text` → reasoning row; `tool_use` →
  tool-call row with name and truncated args.
- `user / tool_result` → tool-result row, truncated.
- `result` → terminal row with success/failure.
- `worker` events (`AgentEvent.kind === "worker"`) → diagnostic row.
- `error` `WireMessage`s → error row.

### `src/components/run-card.tsx`

A client component that:

- Holds local state for the current `runId` (null if no run yet).
- Renders the hardcoded card's title + prompt + "Run" button.
- On click: `POST /api/cards/${cardId}/run`, sets `runId` from the
  response, mounts `<RunLog>`. Disables the button while a run is
  active; re-enables on the SSE `done` frame.
- Surfaces a `409 run_active` response as an inline error with the
  active `runId` (so the user can still mount the log for that run).

### `src/app/page.tsx`

Replace the placeholder from task-01 with a server component that:

- On render, ensures one hardcoded card exists in the store. If none
  with id `card_phase2_demo` (or similar fixed sentinel) exists, create
  it using a fixed prompt — e.g. "Read the README and write a one-line
  summary to SUMMARY.md.".
- Reads the card from the store and passes it to `<RunCard>`.

The exact prompt and `repoPath`/`baseBranch` defaults are best decided
when running it: leave them configurable via environment variables
(`PHASE2_DEMO_REPO`, `PHASE2_DEMO_BRANCH`) with no fallback — render a
clear "set these env vars to use the demo" message if either is missing,
rather than guessing.

### Optional `src/components/log-row.tsx`

Extract the row presentation if it makes `run-log.tsx` cleaner. Not
required.

## Acceptance

UI testing is explicitly excluded by CLAUDE.md hard rules. Acceptance for
this task is manual:

1. `pnpm dev`, set `PHASE2_DEMO_REPO=$PWD` and `PHASE2_DEMO_BRANCH=main`
   on a real local git repo, navigate to `http://localhost:3000`.
2. The card is visible with title, prompt, and a "Run" button.
3. Click Run. Within ~1s, the log starts populating with init, then
   reasoning/tool rows, then a terminal "success" row.
4. Refresh the page mid-run — the log replays from the start (per the
   SSE replay-then-tail design from task-03) and continues.
5. Click Run a second time while a run is active → an inline
   `run_active` error appears with the existing run id.
6. The phase-1 CLI smoke test (`pnpm cli run ...`) still works in
   another terminal — no regression in the worker subprocess path.

Document the manual run as the acceptance evidence in the close-out
checklist; no automated UI tests.

## Out of scope

- Multiple cards or any card list — phase 3 task-01 / task-02.
- Drag-and-drop columns — phase 3 task-02.
- Card create/edit modals — phase 3 task-01.
- Settings page or any settings UI — phase 3 task-03.
- Card detail drawer with run history — phase 3 task-04.
- Cancel button — phase 3 task-05.
- Diff and PR rendering — phase 4.
- Token-level streaming inside an assistant message — deferred per
  `docs/02-agent-sdk-usage.md`.
- Polish, theming, responsive layout. The frontend-design skill informs
  these when the kanban lands; in phase 2 the bar is "legible and
  obviously working", not "designed".
- Any persistence or selection state across reloads beyond what falls
  out of the store.
